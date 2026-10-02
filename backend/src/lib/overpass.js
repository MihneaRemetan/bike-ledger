const { haversineKm } = require('./gpx');
const { HttpError } = require('./http');

// Public Overpass API instances (OpenStreetMap data). The main one answers in about a second but
// randomly fails with 504 under load, so it is retried quickly. A slower mirror is started in
// parallel after a short delay as a safety net; whichever succeeds first wins.
const MAIN = 'https://overpass-api.de/api/interpreter';
const MIRRORS = ['https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
const config = { retries: 5, retryDelayMs: 700, hedgeDelayMs: 4000, mainTimeoutMs: 15000, mirrorTimeoutMs: 35000 };
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX = 200;
const MAX_RESULTS = 40;

const cache = new Map(); // key -> { at, elements }

function buildQuery(lat, lon, radiusKm) {
  const around = `around:${Math.round(radiusKm * 1000)},${lat},${lon}`;
  return `[out:json][timeout:20];(node["shop"="bicycle"](${around});way["shop"="bicycle"](${around}););out center 120;`;
}

async function post(url, query, timeoutMs) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'BikeLedger/1.0 (student project)' },
    body: new URLSearchParams({ data: query }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (!Array.isArray(json.elements)) throw new Error('Unexpected response');
  return json.elements;
}

const sleep = (ms) =>
  new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    if (t.unref) t.unref();
  });

async function mainWithRetries(query) {
  let last;
  for (let i = 0; i < config.retries; i++) {
    try {
      return await post(MAIN, query, config.mainTimeoutMs);
    } catch (err) {
      last = err;
      await sleep(config.retryDelayMs * (i + 1));
    }
  }
  throw last;
}

async function mirrorsAfterDelay(query, isDone) {
  await sleep(config.hedgeDelayMs);
  if (isDone()) throw new Error('skipped');
  let last = new Error('no mirror');
  for (const url of MIRRORS) {
    try {
      return await post(url, query, config.mirrorTimeoutMs);
    } catch (err) {
      last = err;
    }
  }
  throw last;
}

async function fetchElements(query) {
  let done = false;
  try {
    return await Promise.any([mainWithRetries(query), mirrorsAfterDelay(query, () => done)]);
  } catch {
    throw new HttpError(502, 'The map data service is busy right now. Please try again in a moment.');
  } finally {
    done = true;
  }
}

const first = (...vals) => vals.find((v) => v && String(v).trim()) || null;

function normalize(el, center) {
  const t = el.tags || {};
  const lat = el.lat ?? (el.center && el.center.lat);
  const lon = el.lon ?? (el.center && el.center.lon);
  if (lat == null || lon == null) return null;
  const street = [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(' ');
  const address = first(t['addr:full'], [street, t['addr:city']].filter(Boolean).join(', '));
  const repair = ['yes', 'only'].includes(t['service:bicycle:repair']) || t.craft === 'bicycle_repair';
  return {
    id: `${el.type}/${el.id}`,
    name: first(t.name, t.brand) || 'Bicycle shop',
    lat,
    lon,
    address,
    phone: first(t.phone, t['contact:phone']),
    website: first(t.website, t['contact:website']),
    openingHours: first(t.opening_hours),
    brand: first(t.brand, t['service:bicycle:brand']),
    repair,
    distanceKm: Math.round(haversineKm(center, { lat, lon }) * 10) / 10,
  };
}

// Bicycle shops around a point, nearest first.
async function findBikeShops({ lat, lon, radiusKm }) {
  // Cache by a ~1 km grid cell so nearby searches share a result
  const cLat = Math.round(lat * 100) / 100;
  const cLon = Math.round(lon * 100) / 100;
  const key = `${cLat},${cLon},${radiusKm}`;
  let hit = cache.get(key);
  if (!hit || Date.now() - hit.at > CACHE_TTL_MS) {
    try {
      hit = { at: Date.now(), elements: await fetchElements(buildQuery(cLat, cLon, radiusKm + 1)) };
    } catch (err) {
      if (hit) return rank(hit.elements, { lat, lon }, radiusKm); // stale data beats an error
      throw err;
    }
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(key, hit);
  }
  return rank(hit.elements, { lat, lon }, radiusKm);
}

function rank(elements, center, radiusKm) {
  return elements
    .map((el) => normalize(el, center))
    .filter((s) => s && s.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, MAX_RESULTS);
}

module.exports = { findBikeShops, _cache: cache, _config: config };
