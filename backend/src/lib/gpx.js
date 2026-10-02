const zlib = require('zlib');
const { XMLParser, XMLValidator } = require('fast-xml-parser');
const { HttpError } = require('./http');

const EARTH_RADIUS_KM = 6371.0088;
const NOISE_THRESHOLD_M = 3;

const rad = (d) => (d * Math.PI) / 180;

function haversineKm(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

function elevationGain(elevations) {
  const eles = elevations.filter((e) => Number.isFinite(e));
  if (eles.length < 2) return null;
  let ref = eles[0];
  let gain = 0;
  for (const e of eles) {
    if (e - ref > NOISE_THRESHOLD_M) {
      gain += e - ref;
      ref = e;
    } else if (ref - e > NOISE_THRESHOLD_M) {
      ref = e;
    }
  }
  return gain;
}

const text = (v) => {
  if (v == null) return null;
  const s = String(typeof v === 'object' && '#text' in v ? v['#text'] : v).trim();
  return s || null;
};

const arr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

const MAX_UNZIPPED_BYTES = 60 * 1024 * 1024;
const MAX_ROUTE_POINTS = 1200;

// Gzip is common for Strava bulk exports (activity.gpx.gz).
function unzipIfNeeded(buffer) {
  if (buffer.length > 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) {
    try {
      return zlib.gunzipSync(buffer, { maxOutputLength: MAX_UNZIPPED_BYTES });
    } catch {
      throw new HttpError(400, 'Could not decompress the file');
    }
  }
  return buffer;
}

const parseTime = (v) => {
  const t = text(v);
  return t && !Number.isNaN(Date.parse(t)) ? new Date(t) : null;
};

function pointsFromGpx(gpx) {
  const points = [];
  const add = (pt) => {
    const lat = Number(pt['@_lat']);
    const lon = Number(pt['@_lon']);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    points.push({ lat, lon, ele: pt.ele != null ? Number(text(pt.ele)) : NaN, time: parseTime(pt.time) });
  };
  for (const trk of arr(gpx.trk)) for (const seg of arr(trk.trkseg)) arr(seg.trkpt).forEach(add);
  // Planned routes (rte) have no timestamps but still give a path
  if (!points.length) for (const rte of arr(gpx.rte)) arr(rte.rtept).forEach(add);
  const trk0 = arr(gpx.trk)[0] || arr(gpx.rte)[0];
  const metadata = gpx.metadata || {};
  return {
    points,
    name: text(trk0 && trk0.name) || text(metadata.name),
    metaTime: parseTime(metadata.time),
  };
}

function pointsFromTcx(tcx) {
  const points = [];
  for (const act of arr(tcx.Activities && tcx.Activities.Activity)) {
    for (const lap of arr(act.Lap)) {
      for (const track of arr(lap.Track)) {
        for (const tp of arr(track.Trackpoint)) {
          const lat = Number(text(tp.Position && tp.Position.LatitudeDegrees));
          const lon = Number(text(tp.Position && tp.Position.LongitudeDegrees));
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
          points.push({ lat, lon, ele: tp.AltitudeMeters != null ? Number(text(tp.AltitudeMeters)) : NaN, time: parseTime(tp.Time) });
        }
      }
    }
  }
  return { points, name: null, metaTime: null };
}

// Time spent moving: sums the gaps between consecutive points but skips long ones (auto-pause, stops).
// A gap counts as a pause when it is much longer than the usual recording interval of the file.
function movingMinutes(times) {
  if (times.length < 2) return null;
  const gaps = [];
  for (let i = 1; i < times.length; i++) gaps.push((times[i] - times[i - 1]) / 1000);
  const sorted = [...gaps].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const limit = Math.max(60, 10 * median);
  const moving = gaps.filter((g) => g >= 0 && g <= limit).reduce((s, g) => s + g, 0);
  return Math.round(moving / 60);
}

// Ramer-Douglas-Peucker on a flat-earth approximation, then a stride cap.
function simplifyRoute(points, epsilonDeg = 0.00004) {
  const pts = points.map((p) => [p.lat, p.lon]);
  if (pts.length <= 2) return pts.map(([a, b]) => [round5(a), round5(b)]);
  const k = Math.cos(rad(pts[0][0]));
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop();
    const [ay, ax] = pts[lo];
    const [by, bx] = pts[hi];
    const dx = (bx - ax) * k;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let maxD = 0;
    let idx = -1;
    for (let i = lo + 1; i < hi; i++) {
      const px = (pts[i][1] - ax) * k;
      const py = pts[i][0] - ay;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
      const d = Math.hypot(px - t * dx, py - t * dy);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > epsilonDeg && idx !== -1) {
      keep[idx] = 1;
      stack.push([lo, idx], [idx, hi]);
    }
  }
  let out = pts.filter((_, i) => keep[i]);
  if (out.length > MAX_ROUTE_POINTS) {
    const step = Math.ceil(out.length / MAX_ROUTE_POINTS);
    out = out.filter((_, i) => i % step === 0 || i === out.length - 1);
  }
  return out.map(([a, b]) => [round5(a), round5(b)]);
}
const round5 = (n) => Math.round(n * 1e5) / 1e5;

// Reads a GPX or TCX file (optionally gzipped), e.g. an export from Strava or Garmin.
function parseActivityFile(rawBuffer, filename = 'ride.gpx') {
  const xml = unzipIfNeeded(rawBuffer).toString('utf8');
  if (XMLValidator.validate(xml) !== true) throw new HttpError(400, 'Invalid XML file');

  const doc = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    isArray: (name) => ['trk', 'trkseg', 'trkpt', 'rte', 'rtept', 'Activity', 'Lap', 'Track', 'Trackpoint'].includes(name),
  }).parse(xml);

  let parsed;
  if (doc.gpx && typeof doc.gpx === 'object') parsed = pointsFromGpx(doc.gpx);
  else if (doc.TrainingCenterDatabase) parsed = pointsFromTcx(doc.TrainingCenterDatabase);
  else throw new HttpError(400, 'Not a GPX or TCX file');

  const { points, name, metaTime } = parsed;
  if (points.length < 2) throw new HttpError(400, 'File needs at least 2 track points');

  let km = 0;
  for (let i = 1; i < points.length; i++) km += haversineKm(points[i - 1], points[i]);
  const distanceKm = Math.round(km * 100) / 100;
  if (distanceKm <= 0) throw new HttpError(400, 'Track has zero distance');

  const times = points.map((p) => p.time).filter(Boolean);
  const durationMin = movingMinutes(times);
  const gain = elevationGain(points.map((p) => p.ele));
  const date = times[0] || metaTime || new Date();
  const title = name || filename.replace(/\.(gpx|tcx)(\.gz)?$/i, '').replace(/\.gz$/i, '') || null;

  return {
    title,
    date: date.toISOString(),
    distanceKm,
    durationMin: durationMin != null && durationMin >= 0 ? durationMin : null,
    elevationM: gain == null ? null : Math.round(gain),
    route: simplifyRoute(points),
  };
}

// Same as parseActivityFile, without the route (used where only the numbers matter).
function parseGpx(buffer, filename) {
  const { route, ...rest } = parseActivityFile(buffer, filename);
  return rest;
}

module.exports = { parseGpx, parseActivityFile, simplifyRoute, haversineKm, elevationGain };
