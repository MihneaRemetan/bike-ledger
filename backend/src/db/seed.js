const bcrypt = require('bcryptjs');
const { pool, one, query } = require('./pool');
const { migrate } = require('./migrate');
const DEMO_ROUTES = require('./demo-routes.json'); // real streets around Timisoara, see scripts/generate-demo-routes.js

const DEMO_EMAIL = 'demo@bikeledger.app';
const DEMO_PASSWORD = 'demo1234';
const DAYS = 300;

// Deterministic LCG so every run produces the same demo data
function makeRng(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const pick = (list, rng) => list[Math.floor(rng() * list.length)];
// Real rides on the same route differ a little in length (detours, GPS noise)
const jitterKm = (km, rng) => Math.round(km * (0.97 + rng() * 0.06) * 10) / 10;

const dayStr = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);

async function seed() {
  await migrate({ log: () => {} });
  await query('DELETE FROM users WHERE email = $1', [DEMO_EMAIL]);
  const user = await one('INSERT INTO users (name, email, password) VALUES ($1,$2,$3) RETURNING id', [
    'Demo Rider',
    DEMO_EMAIL,
    await bcrypt.hash(DEMO_PASSWORD, 10),
  ]);

  const gravel = await one(
    `INSERT INTO bikes (user_id, name, brand, model, type, year, notes)
     VALUES ($1,'Gravel','Canyon','Grizl','GRAVEL',2024,'Weekend and long-distance bike') RETURNING id`,
    [user.id]
  );
  const commuter = await one(
    `INSERT INTO bikes (user_id, name, brand, model, type, year, notes)
     VALUES ($1,'Commuter','Btwin','Elops 520','CITY',2021,'Daily ride to work') RETURNING id`,
    [user.id]
  );

  const rng = makeRng(20240601);
  const gravelRoutes = DEMO_ROUTES.filter((r) => r.kind === 'gravel');
  const commuteRoutes = DEMO_ROUTES.filter((r) => r.kind === 'commute');
  const rides = [];
  for (let d = DAYS; d >= 0; d--) {
    const date = new Date(Date.now() - d * 86400000);
    const dow = date.getUTCDay();
    if (rng() < 0.4) {
      // About two thirds of the gravel rides follow one of the saved routes, the rest are logged by hand
      const route = rng() < 0.65 ? pick(gravelRoutes, rng) : null;
      const km = route ? jitterKm(route.distanceKm, rng) : Math.round((25 + rng() * 70) * 10) / 10;
      rides.push({
        bikeId: gravel.id, day: dayStr(d), hour: 8, km, route,
        min: Math.round((km / (20 + rng() * 6)) * 60), ele: Math.round(km * (1 + rng() * 2.5)),
        title: route ? route.name : km > 70 ? 'Long gravel loop' : km > 45 ? 'Gravel ride' : 'Quick spin',
      });
    }
    if (dow >= 1 && dow <= 5 && rng() < 0.6) {
      const route = pick(commuteRoutes, rng);
      const km = jitterKm(route.distanceKm, rng);
      rides.push({
        bikeId: commuter.id, day: dayStr(d), hour: 7, km, route,
        min: Math.round((km / 18) * 60), ele: Math.round(km * 1.5), title: 'Commute',
      });
    }
  }
  for (const r of rides) {
    const created = await one(
      `INSERT INTO rides (bike_id, date, title, distance_km, duration_min, elevation_m, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [r.bikeId, `${r.day}T${String(r.hour).padStart(2, '0')}:00:00Z`, r.title, r.km, r.min, r.ele, r.route ? 'GPX' : 'MANUAL']
    );
    if (r.route) {
      await query('INSERT INTO ride_tracks (ride_id, points) VALUES ($1, $2)', [created.id, JSON.stringify(r.route.points)]);
    }
  }

  // Wear in the seed data, used to pick max_km so each component lands on the intended status
  const kmBetween = (bikeId, from, to) =>
    rides
      .filter((r) => r.bikeId === bikeId && r.day >= from && (!to || r.day < to))
      .reduce((s, r) => s + r.km, 0);

  async function addComponent(bikeId, type, brand, model, installedDaysAgo, target, price, retiredDaysAgo) {
    const installed = dayStr(installedDaysAgo);
    const retired = retiredDaysAgo != null ? dayStr(retiredDaysAgo) : null;
    const wear = kmBetween(bikeId, installed, retired);
    const maxKm = Math.max(500, Math.round(wear / target / 100) * 100);
    return one(
      `INSERT INTO components (bike_id, type, brand, model, installed_at, max_km, price, retired_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [bikeId, type, brand, model, installed, maxKm, price, retired]
    );
  }

  // Gravel: old chain retired, current chain + pads in WARN, rear tyre due, rest OK
  const oldChain = await addComponent(gravel.id, 'CHAIN', 'KMC', 'X11', 290, 0.97, 95, 130);
  await addComponent(gravel.id, 'CHAIN', 'Shimano', 'CN-HG701', 130, 0.86, 120);
  await addComponent(gravel.id, 'CASSETTE', 'Shimano', 'CS-HG700', 290, 0.42, 280);
  await addComponent(gravel.id, 'CHAINRING', 'Shimano', 'GRX FC-RX600', 290, 0.2, 350);
  await addComponent(gravel.id, 'TYRE_FRONT', 'Schwalbe', 'G-One Bite', 200, 0.55, 190);
  await addComponent(gravel.id, 'TYRE_REAR', 'Schwalbe', 'G-One Bite', 290, 1.06, 95);
  await addComponent(gravel.id, 'BRAKE_PADS', 'Shimano', 'L03A Resin', 95, 0.9, 80);
  // Commuter
  await addComponent(commuter.id, 'CHAIN', 'KMC', 'Z7', 280, 0.35, 70);
  await addComponent(commuter.id, 'BRAKE_PADS', 'Swissstop', 'Green', 220, 0.6, 130);

  const insertService = (bikeId, componentId, daysAgo, type, cost, notes) =>
    query(
      `INSERT INTO services (bike_id, component_id, date, type, cost, notes) VALUES ($1,$2,$3,$4,$5,$6)`,
      [bikeId, componentId, dayStr(daysAgo), type, cost, notes]
    );
  await insertService(gravel.id, oldChain.id, 130, 'REPLACE', 120, 'Chain stretched past 0.75%, replaced with new Shimano chain');
  await insertService(gravel.id, null, 200, 'CLEAN', 25, 'Full drivetrain deep clean and re-lube');
  await insertService(commuter.id, null, 160, 'ADJUST', 40, 'Brake and derailleur adjustment at the shop');
  await insertService(gravel.id, null, 75, 'INSPECTION', 0, 'Pre-season check, all bolts torqued');
  await insertService(commuter.id, null, 40, 'REPAIR', 55, 'Rear wheel trued, two broken spokes replaced');

  console.log(`Seeded ${rides.length} rides. Login: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
}

seed()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
