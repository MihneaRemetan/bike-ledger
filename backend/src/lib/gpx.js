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

function parseGpx(buffer, filename = 'ride.gpx') {
  const xml = buffer.toString('utf8');
  if (XMLValidator.validate(xml) !== true) throw new HttpError(400, 'Invalid XML file');

  const doc = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    isArray: (name) => ['trk', 'trkseg', 'trkpt'].includes(name),
  }).parse(xml);

  if (!doc.gpx || typeof doc.gpx !== 'object') throw new HttpError(400, 'Not a GPX file (missing <gpx>)');

  const trks = doc.gpx.trk || [];
  const points = [];
  for (const trk of trks) {
    for (const seg of trk.trkseg || []) {
      for (const pt of seg.trkpt || []) {
        const lat = Number(pt['@_lat']);
        const lon = Number(pt['@_lon']);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        const ele = pt.ele != null ? Number(text(pt.ele)) : NaN;
        const t = text(pt.time);
        const time = t && !Number.isNaN(Date.parse(t)) ? new Date(t) : null;
        points.push({ lat, lon, ele, time });
      }
    }
  }
  if (points.length < 2) throw new HttpError(400, 'GPX file needs at least 2 track points');

  let km = 0;
  for (let i = 1; i < points.length; i++) km += haversineKm(points[i - 1], points[i]);
  const distanceKm = Math.round(km * 100) / 100;
  if (distanceKm <= 0) throw new HttpError(400, 'GPX track has zero distance');

  const times = points.map((p) => p.time).filter(Boolean);
  const durationMin =
    times.length >= 2 ? Math.round((times[times.length - 1] - times[0]) / 60000) : null;

  const gain = elevationGain(points.map((p) => p.ele));
  const metadata = doc.gpx.metadata || {};
  const metaTime = text(metadata.time);
  const date =
    times[0] || (metaTime && !Number.isNaN(Date.parse(metaTime)) ? new Date(metaTime) : new Date());
  const title =
    text(trks[0] && trks[0].name) || text(metadata.name) || filename.replace(/\.gpx$/i, '') || null;

  return {
    title,
    date: date.toISOString(),
    distanceKm,
    durationMin: durationMin != null && durationMin >= 0 ? durationMin : null,
    elevationM: gain == null ? null : Math.round(gain),
  };
}

module.exports = { parseGpx, haversineKm, elevationGain };
