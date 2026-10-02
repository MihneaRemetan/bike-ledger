const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const { migrate } = require('../src/db/migrate');
const { pool } = require('../src/db/pool');
const { parseGpx, haversineKm, elevationGain } = require('../src/lib/gpx');

const app = createApp();
const run = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const emailA = `a-${run}@test.dev`;
const emailB = `b-${run}@test.dev`;
let tokenA, tokenB;
const api = (token) => ({
  get: (u) => request(app).get(u).set('Authorization', `Bearer ${token}`),
  post: (u) => request(app).post(u).set('Authorization', `Bearer ${token}`),
  put: (u) => request(app).put(u).set('Authorization', `Bearer ${token}`),
  delete: (u) => request(app).delete(u).set('Authorization', `Bearer ${token}`),
});
let A, B;

before(async () => {
  await migrate({ log: () => {} });
  const ra = await request(app).post('/api/auth/register').send({ name: 'A', email: emailA, password: 'password-a' });
  const rb = await request(app).post('/api/auth/register').send({ name: 'B', email: emailB, password: 'password-b' });
  tokenA = ra.body.token;
  tokenB = rb.body.token;
  A = api(tokenA);
  B = api(tokenB);
});

after(async () => {
  await pool.query('DELETE FROM users WHERE email = ANY($1)', [[emailA, emailB]]);
  await pool.end();
});

const mkBike = async (client = A, extra = {}) =>
  (await client.post('/api/bikes').send({ name: 'Test bike', type: 'GRAVEL', ...extra })).body;
const mkRide = (bikeId, date, km) => A.post('/api/rides').send({ bikeId, date, distanceKm: km });
const mkComp = async (bikeId, extra = {}) =>
  (await A.post('/api/components').send({ bikeId, type: 'CHAIN', installedAt: '2024-01-01', maxKm: 1000, ...extra })).body;

describe('auth', () => {
  test('wrong login -> 401', async () => {
    const r = await request(app).post('/api/auth/login').send({ email: emailA, password: 'nope-nope' });
    assert.equal(r.status, 401);
  });
  test('no token -> 401', async () => {
    assert.equal((await request(app).get('/api/bikes')).status, 401);
    assert.equal((await request(app).get('/api/bikes').set('Authorization', 'Bearer junk')).status, 401);
  });
  test('duplicate email -> 409', async () => {
    const r = await request(app).post('/api/auth/register').send({ name: 'X', email: emailA.toUpperCase(), password: 'password-x' });
    assert.equal(r.status, 409);
  });
  test('login is case-insensitive and hides the password', async () => {
    const r = await request(app).post('/api/auth/login').send({ email: `  ${emailA.toUpperCase()} `, password: 'password-a' });
    assert.equal(r.status, 200);
    assert.ok(r.body.token);
    assert.equal(JSON.stringify(r.body).includes('password'), false);
    const me = await A.get('/api/auth/me');
    assert.equal(me.body.email, emailA);
    assert.equal('password' in me.body, false);
  });
  test('short password -> 400', async () => {
    const r = await request(app).post('/api/auth/register').send({ name: 'X', email: `x-${run}@t.dev`, password: 'short' });
    assert.equal(r.status, 400);
  });
});

describe('bikes CRUD', () => {
  test('validation returns details', async () => {
    const r = await A.post('/api/bikes').send({ name: '', type: 'NOPE' });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'Validation failed');
    const fields = r.body.details.map((d) => d.field);
    assert.ok(fields.includes('name') && fields.includes('type'));
  });
  test('create coerces form values; partial update; list; delete', async () => {
    const c = await A.post('/api/bikes').send({ name: ' Roadie ', type: 'ROAD', year: '2022', brand: '', notes: '' });
    assert.equal(c.status, 201);
    assert.equal(c.body.year, 2022);
    assert.equal(c.body.brand, null);
    assert.equal(c.body.name, 'Roadie');
    const id = c.body.id;

    const u = await A.put(`/api/bikes/${id}`).send({ model: 'Tarmac' });
    assert.equal(u.body.model, 'Tarmac');
    assert.equal(u.body.name, 'Roadie');
    assert.equal(u.body.year, 2022);

    await mkRide(id, '2025-05-01T08:00:00Z', 50);
    const list = await A.get('/api/bikes');
    const found = list.body.find((b) => b.id === id);
    assert.equal(found.totalKm, 50);
    assert.equal(found.rideCount, 1);

    const detail = await A.get(`/api/bikes/${id}`);
    assert.equal(detail.body.recentRides.length, 1);

    assert.equal((await A.delete(`/api/bikes/${id}`)).status, 204);
    assert.equal((await A.get(`/api/bikes/${id}`)).status, 404);
  });
  test('malformed JSON -> 400', async () => {
    const r = await request(app).post('/api/bikes').set('Authorization', `Bearer ${tokenA}`)
      .set('Content-Type', 'application/json').send('{bad');
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'Malformed JSON body');
  });
});

describe('data isolation', () => {
  test('user B cannot see or touch user A data', async () => {
    const bike = await mkBike();
    const comp = await mkComp(bike.id);
    const ride = (await mkRide(bike.id, '2025-05-01T08:00:00Z', 10)).body;

    assert.equal((await B.get(`/api/bikes/${bike.id}`)).status, 404);
    assert.equal((await B.put(`/api/bikes/${bike.id}`).send({ name: 'hax' })).status, 404);
    assert.equal((await B.delete(`/api/bikes/${bike.id}`)).status, 404);
    assert.equal((await B.get(`/api/components/${comp.id}`)).status, 404);
    assert.equal((await B.get(`/api/rides/${ride.id}`)).status, 404);
    assert.equal((await B.delete(`/api/rides/${ride.id}`)).status, 404);
    assert.equal((await B.post('/api/rides').send({ bikeId: bike.id, date: '2025-05-02', distanceKm: 5 })).status, 404);
    assert.equal((await B.post('/api/components').send({ bikeId: bike.id, type: 'CHAIN', installedAt: '2025-01-01' })).status, 404);
    assert.equal((await B.get('/api/bikes')).body.some((b) => b.id === bike.id), false);

    const own = await mkBike(B);
    assert.equal((await B.put(`/api/rides/${ride.id}`).send({ bikeId: own.id })).status, 404);
    assert.equal((await A.put(`/api/rides/${ride.id}`).send({ bikeId: own.id })).status, 404);
  });
});

describe('wear', () => {
  test('rides before install are ignored; add/edit/delete change wear and status', async () => {
    const bike = await mkBike();
    await mkRide(bike.id, '2023-12-31T10:00:00Z', 500); // before installation
    const comp = await mkComp(bike.id, { maxKm: 1000, initialKm: 50 });
    const get = async () => (await A.get(`/api/components/${comp.id}`)).body;

    let c = await get();
    assert.equal(c.wearKm, 50);
    assert.equal(c.status, 'OK');

    const r = (await mkRide(bike.id, '2024-02-01T10:00:00Z', 750)).body;
    c = await get();
    assert.equal(c.wearKm, 800);
    assert.equal(c.wearPct, 0.8);
    assert.equal(c.status, 'WARN');
    assert.equal(c.remainingKm, 200);

    await A.put(`/api/rides/${r.id}`).send({ distanceKm: 1100 });
    c = await get();
    assert.equal(c.status, 'REPLACE');
    assert.equal(c.remainingKm, 0);

    await A.put(`/api/rides/${r.id}`).send({ distanceKm: 100 });
    assert.equal((await get()).status, 'OK');

    await A.delete(`/api/rides/${r.id}`);
    assert.equal((await get()).wearKm, 50);
  });
  test('validation rules', async () => {
    const bike = await mkBike();
    const bad = await A.post('/api/components').send({ bikeId: bike.id, type: 'CHAIN', installedAt: '2024-05-01', retiredAt: '2024-04-01' });
    assert.equal(bad.status, 400);
    const tooLong = await mkRide(bike.id, '2025-01-01', 2001);
    assert.equal(tooLong.status, 400);
    const comp = await mkComp(bike.id, { installedAt: '2024-05-01' });
    const upd = await A.put(`/api/components/${comp.id}`).send({ retiredAt: '2024-04-01' });
    assert.equal(upd.status, 400);
  });
  test('maxKm defaults from type', async () => {
    const bike = await mkBike();
    const c = (await A.post('/api/components').send({ bikeId: bike.id, type: 'BRAKE_PADS', installedAt: '2024-01-01' })).body;
    assert.equal(c.maxKm, 2500);
    const d = await A.get('/api/components/defaults');
    assert.equal(d.body.CHAIN, 4000);
  });
  test('deleting a component keeps its services with null component', async () => {
    const bike = await mkBike();
    const comp = await mkComp(bike.id);
    const s = (await A.post('/api/services').send({ bikeId: bike.id, componentId: comp.id, date: '2024-06-01', type: 'CLEAN' })).body;
    assert.equal((await A.delete(`/api/components/${comp.id}`)).status, 204);
    assert.equal((await A.get(`/api/services/${s.id}`)).body.componentId, null);
  });
});

describe('REPLACE service', () => {
  test('component from another bike -> 400', async () => {
    const b1 = await mkBike();
    const b2 = await mkBike();
    const comp = await mkComp(b1.id);
    const r = await A.post('/api/services').send({ bikeId: b2.id, componentId: comp.id, date: '2024-06-01', type: 'REPLACE' });
    assert.equal(r.status, 400);
  });
  test('replacement without REPLACE/componentId -> 400', async () => {
    const bike = await mkBike();
    const r = await A.post('/api/services').send({ bikeId: bike.id, date: '2024-06-01', type: 'CLEAN', replacement: { brand: 'x' } });
    assert.equal(r.status, 400);
  });
  test('date before installation -> 400', async () => {
    const bike = await mkBike();
    const comp = await mkComp(bike.id, { installedAt: '2024-06-01' });
    const r = await A.post('/api/services').send({ bikeId: bike.id, componentId: comp.id, date: '2024-05-01', type: 'REPLACE' });
    assert.equal(r.status, 400);
  });
  test('retires old part, mounts new one, rides after swap count only for the new part', async () => {
    const bike = await mkBike();
    const old = await mkComp(bike.id, { type: 'TYRE_REAR', maxKm: 3000, installedAt: '2024-01-01' });
    await mkRide(bike.id, '2024-03-01T10:00:00Z', 200);
    await mkRide(bike.id, '2024-06-01T10:00:00Z', 40); // swap day: new part only

    const r = await A.post('/api/services').send({
      bikeId: bike.id, componentId: old.id, date: '2024-06-01', type: 'REPLACE', cost: '60',
      replacement: { brand: 'Schwalbe', model: 'Marathon', maxKm: '', price: '60' },
    });
    assert.equal(r.status, 201);
    assert.equal(r.body.retiredComponentId, old.id);
    assert.equal(r.body.newComponent.type, 'TYRE_REAR');
    assert.equal(r.body.newComponent.maxKm, 3000);
    assert.equal(r.body.newComponent.installedAt, '2024-06-01');
    assert.equal(r.body.newComponent.initialKm, 0);

    await mkRide(bike.id, '2024-06-10T10:00:00Z', 25);

    const oldNow = (await A.get(`/api/components/${old.id}`)).body;
    const newNow = (await A.get(`/api/components/${r.body.newComponent.id}`)).body;
    assert.equal(oldNow.status, 'RETIRED');
    assert.equal(oldNow.retiredAt, '2024-06-01');
    assert.equal(oldNow.wearKm, 200);
    assert.equal(newNow.wearKm, 65);
    assert.equal(newNow.status, 'OK');
    assert.equal(newNow.services.length, 0);
    assert.equal(oldNow.services.length, 1);
  });
  test('explicit maxKm on the replacement wins', async () => {
    const bike = await mkBike();
    const old = await mkComp(bike.id, { maxKm: 3000 });
    const r = await A.post('/api/services').send({
      bikeId: bike.id, componentId: old.id, date: '2024-06-01', type: 'REPLACE', replacement: { maxKm: 5000 },
    });
    assert.equal(r.body.newComponent.maxKm, 5000);
  });
});

describe('GPX', () => {
  const gpx = (pts, extra = '') => `<?xml version="1.0"?>
<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1"><metadata><name>Meta name</name></metadata>
<trk>${extra}<trkseg>${pts.map((p) => `<trkpt lat="${p.lat}" lon="${p.lon}">${p.ele != null ? `<ele>${p.ele}</ele>` : ''}${p.time ? `<time>${p.time}</time>` : ''}</trkpt>`).join('')}</trkseg></trk></gpx>`;

  test('haversine ~111 km per degree of latitude', () => {
    const km = haversineKm({ lat: 0, lon: 0 }, { lat: 1, lon: 0 });
    assert.ok(Math.abs(km - 111.19) < 0.1);
  });
  test('elevation gain ignores noise under 3 m', () => {
    assert.equal(elevationGain([100, 102, 101, 103, 102]), 0);
    assert.equal(elevationGain([100, 104, 108, 100, 105]), 13);
  });
  test('parses distance, duration, elevation, title, date', () => {
    const buf = Buffer.from(gpx([
      { lat: 45, lon: 25, ele: 100, time: '2025-05-01T08:00:00Z' },
      { lat: 45.01, lon: 25, ele: 110, time: '2025-05-01T08:20:00Z' },
      { lat: 45.02, lon: 25, ele: 120, time: '2025-05-01T08:45:00Z' },
    ], '<name>Morning ride</name>'));
    const r = parseGpx(buf, 'file.gpx');
    assert.equal(r.title, 'Morning ride');
    assert.ok(Math.abs(r.distanceKm - 2.22) < 0.02);
    assert.equal(r.durationMin, 45);
    assert.equal(r.elevationM, 20);
    assert.equal(r.date, '2025-05-01T08:00:00.000Z');
  });
  test('title falls back to metadata then filename; missing time -> null duration', () => {
    const pts = [{ lat: 45, lon: 25 }, { lat: 45.01, lon: 25 }];
    assert.equal(parseGpx(Buffer.from(gpx(pts)), 'x.gpx').title, 'Meta name');
    assert.equal(parseGpx(Buffer.from(gpx(pts)), 'x.gpx').durationMin, null);
    const noMeta = gpx(pts).replace(/<metadata>.*<\/metadata>/, '');
    assert.equal(parseGpx(Buffer.from(noMeta), 'Sunday loop.gpx').title, 'Sunday loop');
  });
  test('errors on non-GPX, bad XML, too few points, zero distance', () => {
    assert.throws(() => parseGpx(Buffer.from('<html><body/></html>')), /Not a GPX/);
    assert.throws(() => parseGpx(Buffer.from('not xml <<<')), /Invalid XML/);
    assert.throws(() => parseGpx(Buffer.from(gpx([{ lat: 1, lon: 1 }]))), /at least 2/);
    assert.throws(() => parseGpx(Buffer.from(gpx([{ lat: 1, lon: 1 }, { lat: 1, lon: 1 }]))), /zero distance/);
  });
  test('import endpoint: preview, save, errors', async () => {
    const bike = await mkBike();
    const file = Buffer.from(gpx([
      { lat: 45, lon: 25, ele: 100, time: '2025-05-01T08:00:00Z' },
      { lat: 45.05, lon: 25, ele: 150, time: '2025-05-01T09:00:00Z' },
    ], '<name>Hill</name>'));

    const prev = await A.post('/api/rides/import-gpx').field('bikeId', bike.id).field('preview', 'true').attach('file', file, 'hill.gpx');
    assert.equal(prev.status, 200);
    assert.equal(prev.body.title, 'Hill');
    assert.equal(prev.body.durationMin, 60);
    assert.equal((await A.get(`/api/rides?bikeId=${bike.id}`)).body.length, 0);

    const saved = await A.post('/api/rides/import-gpx').field('bikeId', bike.id).attach('file', file, 'hill.gpx');
    assert.equal(saved.status, 201);
    assert.equal(saved.body.source, 'GPX');
    assert.ok(Math.abs(saved.body.distanceKm - 5.56) < 0.05);

    assert.equal((await A.post('/api/rides/import-gpx').field('bikeId', bike.id)).status, 400);
    assert.equal((await A.post('/api/rides/import-gpx').field('bikeId', bike.id).attach('file', Buffer.from('nope'), 'x.gpx')).status, 400);
    assert.equal((await B.post('/api/rides/import-gpx').field('bikeId', bike.id).attach('file', file, 'hill.gpx')).status, 404);
  });
});

describe('dashboard', () => {
  test('12 months, totals and alerts', async () => {
    const bike = await mkBike();
    const comp = await mkComp(bike.id, { maxKm: 100, installedAt: '2020-01-01' });
    const today = new Date().toISOString();
    await mkRide(bike.id, today, 90);
    await A.post('/api/services').send({ bikeId: bike.id, date: today.slice(0, 10), type: 'CLEAN', cost: 30 });

    const r = await A.get('/api/stats/dashboard');
    assert.equal(r.status, 200);
    assert.equal(r.body.months.length, 12);
    assert.equal(r.body.months[11].month, today.slice(0, 7));
    assert.ok(r.body.months[11].km >= 90);
    assert.ok(r.body.months[11].cost >= 30);
    assert.ok(r.body.totals.km >= 90);
    assert.ok(r.body.totals.bikes >= 1);
    const alert = r.body.alerts.find((a) => a.id === comp.id);
    assert.equal(alert.status, 'WARN');
    for (let i = 1; i < r.body.alerts.length; i++) {
      assert.ok(r.body.alerts[i - 1].wearPct >= r.body.alerts[i].wearPct);
    }
    // B has nothing
    const empty = await B.get('/api/stats/dashboard');
    assert.equal(empty.body.totals.km, 0);
  });
});

describe('misc', () => {
  test('health, docs and 404', async () => {
    assert.equal((await request(app).get('/api/health')).body.status, 'ok');
    assert.equal((await request(app).get('/api/docs/')).status, 200);
    assert.equal((await request(app).get('/api/nope')).status, 404);
  });
});
