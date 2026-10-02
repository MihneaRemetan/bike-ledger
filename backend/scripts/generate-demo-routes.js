// One-off helper: builds realistic demo routes around Timisoara with the public OpenStreetMap
// bike router and saves them to src/db/demo-routes.json. The seed reads that file, so running
// the seed needs no internet. Usage: node scripts/generate-demo-routes.js
const fs = require('fs');
const path = require('path');
const { simplifyRoute } = require('../src/lib/gpx');

const BASE = 'https://routing.openstreetmap.de/routed-bike/route/v1/driving';
const C = [21.2257, 45.7537]; // Piata Victoriei, [lon, lat]

// Waypoints are [lon, lat]; the router snaps each one to the nearest road or track.
const ROUTES = [
  { name: 'Dumbravita and Ghiroda loop', kind: 'gravel', via: [C, [21.19, 45.7886], [21.286, 45.799], C] },
  { name: 'South loop via Giroc', kind: 'gravel', via: [C, [21.219, 45.712], [21.26, 45.682], [21.3, 45.71], C] },
  { name: 'West loop to Sacalaz', kind: 'gravel', via: [C, [21.17, 45.7217], [21.098, 45.786], [21.19, 45.7886], C] },
  { name: 'Long southern ride', kind: 'gravel', via: [C, [21.219, 45.712], [21.19, 45.66], [21.13, 45.64], [21.17, 45.7217], C] },
  { name: 'East side ride', kind: 'gravel', via: [C, [21.286, 45.799], [21.35, 45.76], [21.3, 45.71], C] },
  { name: 'Northern long loop', kind: 'gravel', via: [C, [21.19, 45.7886], [21.2, 45.84], [21.29, 45.83], [21.286, 45.799], C] },
  { name: 'Home to work', kind: 'commute', via: [[21.233, 45.736], [21.24, 45.7669]] },
  { name: 'Work via the park', kind: 'commute', via: [[21.24, 45.7669], [21.2285, 45.7495], [21.233, 45.736]] },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const out = [];
  for (const r of ROUTES) {
    const coords = r.via.map((p) => p.join(',')).join(';');
    const res = await fetch(`${BASE}/${coords}?overview=full&geometries=geojson`);
    const data = await res.json();
    if (data.code !== 'Ok') {
      console.error('FAILED', r.name, data.code);
      continue;
    }
    const route = data.routes[0];
    const points = simplifyRoute(route.geometry.coordinates.map(([lon, lat]) => ({ lat, lon })));
    out.push({ name: r.name, kind: r.kind, distanceKm: Math.round(route.distance / 100) / 10, points });
    console.log(r.name, route.distance / 1000, 'km', points.length, 'points');
    await sleep(1500);
  }
  fs.writeFileSync(path.join(__dirname, '../src/db/demo-routes.json'), JSON.stringify(out));
}
main();
