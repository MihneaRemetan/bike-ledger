const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');

let c;
before(async () => { c = await setup('bikes'); });
after(() => c.cleanup());

describe('bikes', () => {
  test('create requires name and a valid type; optional fields accept empty strings', async () => {
    const bad = await c.A.post('/api/bikes').send({ type: 'ROAD' });
    assert.equal(bad.status, 400);
    assert.ok(bad.body.details.some((d) => d.field === 'name'));
    for (const body of [{ name: 'x', type: 'BMX' }, { name: 'x', type: 'ROAD', year: 1800 }, { name: 'x', type: 'ROAD', year: 2101 }, { name: 'x', type: 'ROAD', year: 20.5 }, { name: 'x'.repeat(81), type: 'ROAD' }, { name: 'x', type: 'ROAD', notes: 'n'.repeat(1001) }]) {
      assert.equal((await c.A.post('/api/bikes').send(body)).status, 400, JSON.stringify(body).slice(0, 60));
    }
    const ok = await c.A.post('/api/bikes').send({ name: 'Full', type: 'MTB', brand: 'Trek', model: 'X', year: '2020', notes: '' });
    assert.equal(ok.status, 201);
    assert.deepEqual([ok.body.brand, ok.body.year, ok.body.notes], ['Trek', 2020, null]);
  });
  test('every bike type is accepted', async () => {
    for (const type of ['ROAD', 'MTB', 'GRAVEL', 'CITY', 'OTHER']) {
      assert.equal((await c.A.post('/api/bikes').send({ name: type, type })).status, 201);
    }
  });
  test('update is partial, can clear optional fields, validates, and an empty update is a no-op', async () => {
    const bike = await c.mkBike(c.A, { brand: 'Canyon', year: 2022 });
    const cleared = await c.A.put(`/api/bikes/${bike.id}`).send({ brand: '' });
    assert.equal(cleared.body.brand, null);
    assert.equal(cleared.body.year, 2022);
    assert.equal((await c.A.put(`/api/bikes/${bike.id}`).send({ type: 'NOPE' })).status, 400);
    assert.equal((await c.A.put(`/api/bikes/${bike.id}`).send({ name: '' })).status, 400);
    const noop = await c.A.put(`/api/bikes/${bike.id}`).send({});
    assert.equal(noop.status, 200);
    assert.equal(noop.body.name, bike.name);
  });
  test('non-numeric and unknown ids', async () => {
    assert.equal((await c.A.get('/api/bikes/abc')).status, 400);
    assert.equal((await c.A.get('/api/bikes/0')).status, 400);
    assert.equal((await c.A.get('/api/bikes/99999999')).status, 404);
    assert.equal((await c.A.put('/api/bikes/99999999').send({ name: 'x' })).status, 404);
    assert.equal((await c.A.delete('/api/bikes/99999999')).status, 404);
  });
  test('list returns only own bikes, newest first, with totals, cost, active parts and alerts', async () => {
    const bike = await c.mkBike(c.A, { name: 'Stats bike' });
    await c.mkRide(bike.id, '2025-01-10T08:00:00Z', 100);
    await c.mkRide(bike.id, '2025-01-11T08:00:00Z', 50);
    await c.mkService(bike.id, { cost: 40 });
    await c.mkService(bike.id, { cost: '10.5' });
    await c.mkComp(bike.id, { maxKm: 1000, installedAt: '2024-01-01' }); // 150/1000 OK
    await c.mkComp(bike.id, { type: 'TYRE_REAR', maxKm: 160, installedAt: '2024-01-01' }); // 94% -> alert
    await c.mkComp(bike.id, { type: 'CABLES', maxKm: 100, installedAt: '2024-01-01', retiredAt: '2024-02-01' }); // retired
    const list = (await c.A.get('/api/bikes')).body;
    assert.equal(list[0].id >= list[list.length - 1].id, true);
    const b = list.find((x) => x.id === bike.id);
    assert.equal(b.totalKm, 150);
    assert.equal(b.rideCount, 2);
    assert.equal(b.maintenanceCost, 50.5);
    assert.equal(b.activeComponents, 2);
    assert.equal(b.alerts, 1);
    assert.equal((await c.B.get('/api/bikes')).body.some((x) => x.id === bike.id), false);
  });
  test('detail has stats, cost per km, parts (active first), 10 recent rides and services with part info', async () => {
    const bike = await c.mkBike();
    for (let i = 1; i <= 12; i++) await c.mkRide(bike.id, `2025-03-${String(i).padStart(2, '0')}T08:00:00Z`, 10);
    const retired = await c.mkComp(bike.id, { type: 'CASSETTE', installedAt: '2024-01-01', retiredAt: '2024-02-01', maxKm: 5000 });
    const active = await c.mkComp(bike.id, { type: 'CHAIN', installedAt: '2024-03-01', brand: 'KMC', model: 'X11', maxKm: 4000 });
    await c.mkService(bike.id, { componentId: active.id, cost: 120, date: '2025-04-01' });
    for (let i = 0; i < 11; i++) await c.mkService(bike.id, { date: `2025-05-${String(i + 1).padStart(2, '0')}` });
    const d = (await c.A.get(`/api/bikes/${bike.id}`)).body;
    assert.equal(d.totalKm, 120);
    assert.equal(d.rideCount, 12);
    assert.equal(d.maintenanceCost, 120);
    assert.equal(d.costPerKm, 1);
    assert.deepEqual(d.components.map((x) => x.id), [active.id, retired.id]);
    assert.equal(d.components[1].status, 'RETIRED');
    assert.equal(d.recentRides.length, 10);
    assert.ok(d.recentRides[0].date >= d.recentRides[9].date);
    assert.equal(d.recentServices.length, 10);
    const withPart = (await c.A.get(`/api/bikes/${bike.id}`)).body.recentServices.find((s) => s.componentId === active.id);
    assert.equal(withPart, undefined); // oldest dropped: only the 10 newest are shown
    const empty = (await c.A.get(`/api/bikes/${(await c.mkBike()).id}`)).body;
    assert.equal(empty.costPerKm, 0);
  });
  test('recent services carry the component type, brand and model', async () => {
    const bike = await c.mkBike();
    const comp = await c.mkComp(bike.id, { type: 'BRAKE_PADS', brand: 'Swissstop', model: 'Green' });
    await c.mkService(bike.id, { componentId: comp.id });
    const s = (await c.A.get(`/api/bikes/${bike.id}`)).body.recentServices[0];
    assert.deepEqual([s.componentType, s.componentBrand, s.componentModel], ['BRAKE_PADS', 'Swissstop', 'Green']);
  });
  test('deleting a bike cascades to its components, rides, services and tracks', async () => {
    const bike = await c.mkBike();
    const comp = await c.mkComp(bike.id);
    const ride = (await c.mkRide(bike.id, '2025-01-01T08:00:00Z', 10)).body;
    await c.pool.query('INSERT INTO ride_tracks (ride_id, points) VALUES ($1, $2)', [ride.id, '[[45,21],[45.1,21]]']);
    const svc = await c.mkService(bike.id, { componentId: comp.id });
    assert.equal((await c.A.delete(`/api/bikes/${bike.id}`)).status, 204);
    for (const [table, id] of [['components', comp.id], ['rides', ride.id], ['services', svc.id]]) {
      assert.equal((await c.pool.query(`SELECT 1 FROM ${table} WHERE id = $1`, [id])).rowCount, 0, table);
    }
    assert.equal((await c.pool.query('SELECT 1 FROM ride_tracks WHERE ride_id = $1', [ride.id])).rowCount, 0);
  });
});
