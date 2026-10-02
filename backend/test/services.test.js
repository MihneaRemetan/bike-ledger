const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');

let c;
before(async () => { c = await setup('svc'); });
after(() => c.cleanup());

describe('services: create and validate', () => {
  test('every service type is accepted and the response has bike and component details', async () => {
    const bike = await c.mkBike(c.A, { name: 'Svc bike' });
    const comp = await c.mkComp(bike.id, { type: 'BRAKE_PADS', brand: 'Shimano', model: 'L03A' });
    for (const type of ['CLEAN', 'ADJUST', 'REPAIR', 'INSPECTION']) {
      const r = await c.A.post('/api/services').send({ bikeId: bike.id, componentId: comp.id, date: '2025-05-01', type, cost: 10, notes: 'n' });
      assert.equal(r.status, 201, type);
      assert.deepEqual([r.body.bikeName, r.body.componentType, r.body.componentBrand, r.body.componentModel], ['Svc bike', 'BRAKE_PADS', 'Shimano', 'L03A']);
    }
  });
  test('non-REPLACE services never retire the part', async () => {
    const bike = await c.mkBike();
    const comp = await c.mkComp(bike.id);
    await c.mkService(bike.id, { componentId: comp.id, type: 'REPAIR' });
    assert.equal((await c.A.get(`/api/components/${comp.id}`)).body.retiredAt, null);
  });
  test('validation: required fields, enum, date format, cost range', async () => {
    const bike = await c.mkBike();
    const base = { bikeId: bike.id, date: '2025-05-01', type: 'CLEAN' };
    const bad = [
      [{ ...base, date: undefined }, 'date'], [{ ...base, date: '1/5/2025' }, 'date'], [{ ...base, type: undefined }, 'type'],
      [{ ...base, type: 'WASH' }, 'type'], [{ ...base, cost: -1 }, 'cost'], [{ ...base, cost: 100001 }, 'cost'],
      [{ ...base, notes: 'n'.repeat(1001) }, 'notes'], [{ ...base, bikeId: undefined }, 'bikeId'],
    ];
    for (const [body, field] of bad) {
      const r = await c.A.post('/api/services').send(body);
      assert.equal(r.status, 400, field);
      assert.ok(r.body.details.some((d) => d.field === field), `${field}: ${JSON.stringify(r.body.details)}`);
    }
    const ok = await c.A.post('/api/services').send({ ...base, cost: '', notes: '', componentId: '' });
    assert.equal(ok.status, 201);
    assert.deepEqual([ok.body.cost, ok.body.notes, ok.body.componentId], [null, null, null]);
  });
  test('component of another user -> 404, of another own bike -> 400', async () => {
    const mine = await c.mkBike();
    const other = await c.mkBike();
    const foreignBike = await c.mkBike(c.B);
    const foreignComp = (await c.B.post('/api/components').send({ bikeId: foreignBike.id, type: 'CHAIN', installedAt: '2024-01-01' })).body;
    const otherComp = await c.mkComp(other.id);
    assert.equal((await c.A.post('/api/services').send({ bikeId: mine.id, componentId: foreignComp.id, date: '2025-01-01', type: 'CLEAN' })).status, 404);
    assert.equal((await c.A.post('/api/services').send({ bikeId: mine.id, componentId: otherComp.id, date: '2025-01-01', type: 'CLEAN' })).status, 400);
  });
});

describe('services: REPLACE details', () => {
  test('without a replacement it only retires the old part', async () => {
    const bike = await c.mkBike();
    const old = await c.mkComp(bike.id);
    const r = await c.A.post('/api/services').send({ bikeId: bike.id, componentId: old.id, date: '2024-06-01', type: 'REPLACE' });
    assert.equal(r.status, 201);
    assert.equal(r.body.retiredComponentId, old.id);
    assert.equal(r.body.newComponent, null);
    assert.equal((await c.A.get(`/api/components?bikeId=${bike.id}&status=active`)).body.length, 0);
  });
  test('replacing an already retired part keeps its original retirement date', async () => {
    const bike = await c.mkBike();
    const old = await c.mkComp(bike.id, { retiredAt: '2024-03-01' });
    const r = await c.A.post('/api/services').send({ bikeId: bike.id, componentId: old.id, date: '2024-06-01', type: 'REPLACE', replacement: { brand: 'N' } });
    assert.equal(r.status, 201);
    assert.equal((await c.A.get(`/api/components/${old.id}`)).body.retiredAt, '2024-03-01');
    assert.equal(r.body.newComponent.brand, 'N');
  });
  test('replacement fields: brand, model, price, own wear limit; the new part starts at 0 km', async () => {
    const bike = await c.mkBike();
    const old = await c.mkComp(bike.id, { type: 'TYRE_REAR', maxKm: 4000, initialKm: 500 });
    const r = await c.A.post('/api/services').send({ bikeId: bike.id, componentId: old.id, date: '2024-06-01', type: 'REPLACE', cost: 90, replacement: { brand: 'Schwalbe', model: 'Marathon', maxKm: '6000', price: '90' } });
    const n = r.body.newComponent;
    assert.deepEqual([n.type, n.brand, n.model, n.maxKm, n.price, n.initialKm, n.wearKm, n.installedAt, n.status], ['TYRE_REAR', 'Schwalbe', 'Marathon', 6000, 90, 0, 0, '2024-06-01', 'OK']);
  });
  test('replacement validation errors are reported per field', async () => {
    const bike = await c.mkBike();
    const old = await c.mkComp(bike.id);
    const r = await c.A.post('/api/services').send({ bikeId: bike.id, componentId: old.id, date: '2024-06-01', type: 'REPLACE', replacement: { maxKm: -1, price: -1 } });
    assert.equal(r.status, 400);
    assert.ok(r.body.details.some((d) => d.field === 'replacement.maxKm'));
    assert.equal((await c.A.get(`/api/components/${old.id}`)).body.retiredAt, null); // nothing was changed
  });
  test('the whole REPLACE is atomic: a failure rolls everything back', async () => {
    const bike = await c.mkBike();
    const old = await c.mkComp(bike.id);
    await c.pool.query('ALTER TABLE components ADD CONSTRAINT tmp_fail CHECK (brand IS DISTINCT FROM \'boom\') NOT VALID');
    try {
      const r = await c.A.post('/api/services').send({ bikeId: bike.id, componentId: old.id, date: '2024-06-01', type: 'REPLACE', replacement: { brand: 'boom' } });
      assert.equal(r.status, 400);
    } finally {
      await c.pool.query('ALTER TABLE components DROP CONSTRAINT tmp_fail');
    }
    assert.equal((await c.A.get(`/api/components/${old.id}`)).body.retiredAt, null);
    assert.equal((await c.A.get(`/api/services?bikeId=${bike.id}`)).body.length, 0);
  });
});

describe('services: list, detail, update, delete', () => {
  test('list filters by bike and dates, newest first, with limit', async () => {
    const b1 = await c.mkBike();
    const b2 = await c.mkBike();
    for (const d of ['2025-01-10', '2025-02-10', '2025-03-10']) await c.mkService(b1.id, { date: d, cost: 1 });
    await c.mkService(b2.id, { date: '2025-02-11' });
    const dates = async (qs) => (await c.A.get(`/api/services?bikeId=${b1.id}${qs}`)).body.map((s) => s.date);
    assert.deepEqual(await dates(''), ['2025-03-10', '2025-02-10', '2025-01-10']);
    assert.deepEqual(await dates('&from=2025-02-10'), ['2025-03-10', '2025-02-10']);
    assert.deepEqual(await dates('&to=2025-02-10'), ['2025-02-10', '2025-01-10']);
    assert.deepEqual(await dates('&limit=1'), ['2025-03-10']);
    assert.equal((await c.A.get('/api/services?from=nope')).status, 400);
    assert.equal((await c.B.get(`/api/services?bikeId=${b1.id}`)).body.length, 0);
  });
  test('detail with ids validated', async () => {
    const bike = await c.mkBike();
    const s = await c.mkService(bike.id);
    assert.equal((await c.A.get(`/api/services/${s.id}`)).body.id, s.id);
    assert.equal((await c.B.get(`/api/services/${s.id}`)).status, 404);
    assert.equal((await c.A.get('/api/services/abc')).status, 400);
    assert.equal((await c.A.get('/api/services/99999999')).status, 404);
  });
  test('partial update of type, cost, date, notes; can unlink the component', async () => {
    const bike = await c.mkBike();
    const comp = await c.mkComp(bike.id);
    const s = await c.mkService(bike.id, { componentId: comp.id, cost: 10 });
    const r = await c.A.put(`/api/services/${s.id}`).send({ type: 'REPAIR', cost: '55', date: '2025-08-01', notes: 'new' });
    assert.deepEqual([r.body.type, r.body.cost, r.body.date, r.body.notes, r.body.componentId], ['REPAIR', 55, '2025-08-01', 'new', comp.id]);
    const unlinked = await c.A.put(`/api/services/${s.id}`).send({ componentId: '' });
    assert.equal(unlinked.body.componentId, null);
    assert.equal(unlinked.body.componentType, null);
    assert.equal((await c.A.put(`/api/services/${s.id}`).send({ cost: -1 })).status, 400);
    assert.equal((await c.A.put(`/api/services/${s.id}`).send({})).status, 200);
  });
  test('update keeps the component/bike pairing consistent', async () => {
    const b1 = await c.mkBike();
    const b2 = await c.mkBike();
    const foreign = await c.mkBike(c.B);
    const c1 = await c.mkComp(b1.id);
    const c1b = await c.mkComp(b1.id, { type: 'CABLES' });
    const c2 = await c.mkComp(b2.id);
    const s = await c.mkService(b1.id, { componentId: c1.id });
    assert.equal((await c.A.put(`/api/services/${s.id}`).send({ componentId: c1b.id })).body.componentId, c1b.id);
    assert.equal((await c.A.put(`/api/services/${s.id}`).send({ componentId: c2.id })).status, 400); // part on another bike
    assert.equal((await c.A.put(`/api/services/${s.id}`).send({ bikeId: b2.id })).status, 400); // linked part stays on old bike
    assert.equal((await c.A.put(`/api/services/${s.id}`).send({ bikeId: b2.id, componentId: c2.id })).body.bikeId, b2.id);
    const free = await c.mkService(b1.id);
    assert.equal((await c.A.put(`/api/services/${free.id}`).send({ bikeId: b2.id })).body.bikeId, b2.id); // no part: can move
    assert.equal((await c.A.put(`/api/services/${free.id}`).send({ bikeId: foreign.id })).status, 404);
    assert.equal((await c.B.put(`/api/services/${free.id}`).send({ notes: 'x' })).status, 404);
  });
  test('deleting a service does not un-retire the replaced part', async () => {
    const bike = await c.mkBike();
    const old = await c.mkComp(bike.id);
    const r = (await c.A.post('/api/services').send({ bikeId: bike.id, componentId: old.id, date: '2024-06-01', type: 'REPLACE' })).body;
    assert.equal((await c.B.delete(`/api/services/${r.id}`)).status, 404);
    assert.equal((await c.A.delete(`/api/services/${r.id}`)).status, 204);
    assert.equal((await c.A.delete(`/api/services/${r.id}`)).status, 404);
    assert.equal((await c.A.get(`/api/components/${old.id}`)).body.status, 'RETIRED');
  });
  test('service costs feed the bike maintenance cost and cost per km', async () => {
    const bike = await c.mkBike();
    await c.mkRide(bike.id, '2025-01-01T08:00:00Z', 200);
    await c.mkService(bike.id, { cost: 30 });
    await c.mkService(bike.id, { cost: 20 });
    await c.mkService(bike.id, {}); // no cost
    const d = (await c.A.get(`/api/bikes/${bike.id}`)).body;
    assert.equal(d.maintenanceCost, 50);
    assert.equal(d.costPerKm, 0.25);
  });
});
