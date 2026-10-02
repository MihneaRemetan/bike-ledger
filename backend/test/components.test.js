const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');

let c;
before(async () => { c = await setup('comp'); });
after(() => c.cleanup());

describe('components: create and validate', () => {
  test('response includes bike name, wear fields and the status', async () => {
    const bike = await c.mkBike(c.A, { name: 'Named bike' });
    const r = await c.A.post('/api/components').send({ bikeId: bike.id, type: 'CHAIN', installedAt: '2024-01-01', maxKm: 1000 });
    assert.equal(r.status, 201);
    assert.equal(r.body.bikeName, 'Named bike');
    assert.deepEqual([r.body.wearKm, r.body.wearPct, r.body.remainingKm, r.body.status], [0, 0, 1000, 'OK']);
  });
  test('required fields, enums, ranges and date format are validated', async () => {
    const bike = await c.mkBike();
    const base = { bikeId: bike.id, type: 'CHAIN', installedAt: '2024-01-01' };
    const bad = [
      [{ ...base, type: undefined }, 'type'], [{ ...base, type: 'WHEEL' }, 'type'], [{ ...base, installedAt: undefined }, 'installedAt'],
      [{ ...base, installedAt: '01/02/2024' }, 'installedAt'], [{ ...base, maxKm: 0 }, 'maxKm'], [{ ...base, maxKm: 200001 }, 'maxKm'],
      [{ ...base, initialKm: -1 }, 'initialKm'], [{ ...base, price: -5 }, 'price'], [{ ...base, brand: 'x'.repeat(121) }, 'brand'],
      [{ ...base, bikeId: undefined }, 'bikeId'], [{ ...base, retiredAt: '2023-01-01' }, 'retiredAt'],
    ];
    for (const [body, field] of bad) {
      const r = await c.A.post('/api/components').send(body);
      assert.equal(r.status, 400, field);
      assert.ok(r.body.details.some((d) => d.field === field), `${field}: ${JSON.stringify(r.body.details)}`);
    }
  });
  test('form-style input: numbers as strings, empty strings become null/defaults', async () => {
    const bike = await c.mkBike();
    const r = await c.A.post('/api/components').send({ bikeId: String(bike.id), type: 'CABLES', installedAt: '2024-01-01', initialKm: '120.5', maxKm: '', price: '', brand: '' });
    assert.equal(r.status, 201);
    assert.deepEqual([r.body.initialKm, r.body.maxKm, r.body.price, r.body.brand], [120.5, 8000, null, null]);
  });
  test('every component type gets its default wear limit', async () => {
    const bike = await c.mkBike();
    const defaults = (await c.A.get('/api/components/defaults')).body;
    assert.equal(Object.keys(defaults).length, 10);
    for (const [type, km] of Object.entries(defaults)) {
      const r = await c.A.post('/api/components').send({ bikeId: bike.id, type, installedAt: '2024-01-01' });
      assert.equal(r.body.maxKm, km, type);
    }
  });
});

describe('components: wear calculation boundaries', () => {
  test('status thresholds: <80% OK, >=80% WARN, >=100% REPLACE; retired wins', async () => {
    const bike = await c.mkBike();
    const comp = await c.mkComp(bike.id, { maxKm: 1000 });
    const status = async () => (await c.A.get(`/api/components/${comp.id}`)).body;
    const ride = (await c.mkRide(bike.id, '2024-02-01T08:00:00Z', 799)).body;
    assert.equal((await status()).status, 'OK');
    await c.A.put(`/api/rides/${ride.id}`).send({ distanceKm: 800 });
    assert.equal((await status()).status, 'WARN');
    await c.A.put(`/api/rides/${ride.id}`).send({ distanceKm: 1000 });
    assert.equal((await status()).status, 'REPLACE');
    await c.A.put(`/api/components/${comp.id}`).send({ retiredAt: '2024-06-01' });
    assert.equal((await status()).status, 'RETIRED');
  });
  test('rides on install day count, rides on retirement day do not, other bikes are ignored', async () => {
    const bike = await c.mkBike();
    const other = await c.mkBike();
    const comp = await c.mkComp(bike.id, { installedAt: '2024-05-10', retiredAt: '2024-05-20' });
    await c.mkRide(bike.id, '2024-05-09T23:59:00Z', 1000); // before
    await c.mkRide(bike.id, '2024-05-10T00:00:00Z', 10); // install day: counts
    await c.mkRide(bike.id, '2024-05-19T23:00:00Z', 20); // day before retirement: counts
    await c.mkRide(bike.id, '2024-05-20T08:00:00Z', 1000); // retirement day: new part only
    await c.mkRide(other.id, '2024-05-15T08:00:00Z', 1000); // other bike
    assert.equal((await c.A.get(`/api/components/${comp.id}`)).body.wearKm, 30);
  });
  test('initial km counts toward wear and wear is rounded to 0.1 km / 0.1%', async () => {
    const bike = await c.mkBike();
    const comp = await c.mkComp(bike.id, { initialKm: 100.04, maxKm: 3000 });
    await c.mkRide(bike.id, '2024-02-01T08:00:00Z', 10.06);
    const d = (await c.A.get(`/api/components/${comp.id}`)).body;
    assert.equal(d.wearKm, 110.1);
    assert.equal(d.wearPct, 0.037);
    assert.equal(d.remainingKm, 2889.9);
  });
});

describe('components: list and detail', () => {
  test('filters by bike and status, active first, with limit', async () => {
    const b1 = await c.mkBike();
    const b2 = await c.mkBike();
    const old = await c.mkComp(b1.id, { retiredAt: '2024-03-01' });
    const act = await c.mkComp(b1.id, { type: 'TYRE_FRONT', installedAt: '2024-04-01' });
    const act2 = await c.mkComp(b1.id, { type: 'CABLES', installedAt: '2024-05-01' });
    await c.mkComp(b2.id);
    const all = (await c.A.get(`/api/components?bikeId=${b1.id}`)).body;
    assert.deepEqual(all.map((x) => x.id), [act2.id, act.id, old.id]);
    assert.ok(all.every((x) => x.bikeName));
    assert.deepEqual((await c.A.get(`/api/components?bikeId=${b1.id}&status=active`)).body.map((x) => x.id), [act2.id, act.id]);
    assert.deepEqual((await c.A.get(`/api/components?bikeId=${b1.id}&status=retired`)).body.map((x) => x.id), [old.id]);
    assert.equal((await c.A.get(`/api/components?bikeId=${b1.id}&limit=1`)).body.length, 1);
    assert.equal((await c.A.get('/api/components?status=weird')).status, 400);
    assert.equal((await c.A.get('/api/components?limit=0')).status, 400);
    assert.equal((await c.B.get(`/api/components?bikeId=${b1.id}`)).body.length, 0);
  });
  test('detail lists the services on that component', async () => {
    const bike = await c.mkBike();
    const comp = await c.mkComp(bike.id);
    await c.mkService(bike.id, { componentId: comp.id, date: '2024-07-01', type: 'CLEAN' });
    await c.mkService(bike.id, { componentId: comp.id, date: '2024-08-01', type: 'ADJUST' });
    await c.mkService(bike.id, { date: '2024-09-01' }); // not on this part
    const d = (await c.A.get(`/api/components/${comp.id}`)).body;
    assert.deepEqual(d.services.map((s) => s.type), ['ADJUST', 'CLEAN']);
    assert.equal((await c.A.get('/api/components/abc')).status, 400);
    assert.equal((await c.A.get('/api/components/99999999')).status, 404);
  });
});

describe('components: update and delete', () => {
  test('partial update of fields, wear limit and price', async () => {
    const bike = await c.mkBike();
    const comp = await c.mkComp(bike.id, { brand: 'Old' });
    const r = await c.A.put(`/api/components/${comp.id}`).send({ brand: 'New', maxKm: '2000', price: '99.9', type: 'CASSETTE' });
    assert.equal(r.status, 200);
    assert.deepEqual([r.body.brand, r.body.maxKm, r.body.price, r.body.type], ['New', 2000, 99.9, 'CASSETTE']);
    assert.equal((await c.A.put(`/api/components/${comp.id}`).send({})).status, 200);
  });
  test('maxKm cannot be emptied; invalid values are rejected', async () => {
    const comp = await c.mkComp((await c.mkBike()).id);
    assert.equal((await c.A.put(`/api/components/${comp.id}`).send({ maxKm: '' })).status, 400);
    assert.equal((await c.A.put(`/api/components/${comp.id}`).send({ maxKm: -5 })).status, 400);
    assert.equal((await c.A.put(`/api/components/${comp.id}`).send({ type: 'NOPE' })).status, 400);
  });
  test('retire and un-retire; dates are checked against the stored values', async () => {
    const comp = await c.mkComp((await c.mkBike()).id, { installedAt: '2024-05-01' });
    assert.equal((await c.A.put(`/api/components/${comp.id}`).send({ retiredAt: '2024-04-30' })).status, 400);
    const retired = await c.A.put(`/api/components/${comp.id}`).send({ retiredAt: '2024-06-01' });
    assert.equal(retired.body.status, 'RETIRED');
    assert.equal((await c.A.put(`/api/components/${comp.id}`).send({ installedAt: '2024-07-01' })).status, 400);
    const back = await c.A.put(`/api/components/${comp.id}`).send({ retiredAt: '' });
    assert.equal(back.body.retiredAt, null);
    assert.notEqual(back.body.status, 'RETIRED');
  });
  test('changing the bike in a plain update moves the part as of today; other users bikes are a 404', async () => {
    const b1 = await c.mkBike();
    const b2 = await c.mkBike();
    const foreign = await c.mkBike(c.B);
    const comp = await c.mkComp(b1.id);
    await c.mkRide(b1.id, '2024-02-01T08:00:00Z', 50);
    await c.mkRide(b2.id, '2024-02-01T08:00:00Z', 77); // before the move: not this part's
    const moved = await c.A.put(`/api/components/${comp.id}`).send({ bikeId: b2.id });
    assert.equal(moved.status, 200);
    assert.equal(moved.body.bikeId, b2.id);
    assert.equal(moved.body.wearKm, 50); // the km done on the first bike are kept
    assert.equal((await c.A.put(`/api/components/${comp.id}`).send({ bikeId: foreign.id })).status, 404);
  });
  test('another user can neither update nor delete it', async () => {
    const comp = await c.mkComp((await c.mkBike()).id);
    assert.equal((await c.B.put(`/api/components/${comp.id}`).send({ brand: 'x' })).status, 404);
    assert.equal((await c.B.delete(`/api/components/${comp.id}`)).status, 404);
    assert.equal((await c.A.delete(`/api/components/${comp.id}`)).status, 204);
    assert.equal((await c.A.delete(`/api/components/${comp.id}`)).status, 404);
  });
});
