const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');

let c;
before(async () => { c = await setup('mounts'); });
after(() => c.cleanup());

const move = (client, id, body) => client.post(`/api/components/${id}/move`).send(body);
const get = async (id) => (await c.A.get(`/api/components/${id}`)).body;

describe('part history across bikes', () => {
  test('a new part starts with one open mount on its bike', async () => {
    const bike = await c.mkBike();
    const comp = await c.mkComp(bike.id, { installedAt: '2024-03-01' });
    const d = await get(comp.id);
    assert.equal(d.mounts.length, 1);
    assert.deepEqual([d.mounts[0].bikeId, d.mounts[0].fromDate, d.mounts[0].toDate], [bike.id, '2024-03-01', null]);
  });
  test('moving closes the old mount and opens a new one on the other bike', async () => {
    const b1 = await c.mkBike(c.A, { name: 'First' });
    const b2 = await c.mkBike(c.A, { name: 'Second' });
    const comp = await c.mkComp(b1.id, { installedAt: '2024-01-01' });
    const r = await move(c.A, comp.id, { bikeId: b2.id, date: '2024-06-01' });
    assert.equal(r.status, 200);
    assert.equal(r.body.bikeId, b2.id);
    assert.equal(r.body.bikeName, 'Second');
    assert.deepEqual(r.body.mounts.map((m) => [m.bikeName, m.fromDate, m.toDate]), [['First', '2024-01-01', '2024-06-01'], ['Second', '2024-06-01', null]]);
  });
  test('wear adds the km done on each bike during its mount; the move day counts for the new bike', async () => {
    const b1 = await c.mkBike();
    const b2 = await c.mkBike();
    const comp = await c.mkComp(b1.id, { installedAt: '2024-01-01', maxKm: 5000, initialKm: 10 });
    await c.mkRide(b1.id, '2024-02-01T08:00:00Z', 100); // on b1 while mounted there
    await c.mkRide(b2.id, '2024-02-01T08:00:00Z', 1000); // b2 before the part arrived: ignored
    await c.mkRide(b1.id, '2024-06-01T08:00:00Z', 7); // move day, on b1: not counted (mount ended)
    await c.mkRide(b2.id, '2024-06-01T09:00:00Z', 20); // move day, on b2: counted
    await move(c.A, comp.id, { bikeId: b2.id, date: '2024-06-01' });
    await c.mkRide(b2.id, '2024-07-01T08:00:00Z', 30);
    await c.mkRide(b1.id, '2024-07-01T08:00:00Z', 500); // b1 after the part left: ignored
    const d = await get(comp.id);
    assert.equal(d.wearKm, 10 + 100 + 20 + 30);
    assert.deepEqual(d.mounts.map((m) => m.km), [100, 50]);
  });
  test('it can move back and forth; every stretch is counted', async () => {
    const b1 = await c.mkBike();
    const b2 = await c.mkBike();
    const comp = await c.mkComp(b1.id, { installedAt: '2024-01-01' });
    await c.mkRide(b1.id, '2024-01-10T08:00:00Z', 10);
    await move(c.A, comp.id, { bikeId: b2.id, date: '2024-02-01' });
    await c.mkRide(b2.id, '2024-02-10T08:00:00Z', 20);
    await move(c.A, comp.id, { bikeId: b1.id, date: '2024-03-01' });
    await c.mkRide(b1.id, '2024-03-10T08:00:00Z', 40);
    await c.mkRide(b1.id, '2024-01-20T08:00:00Z', 1);
    const d = await get(comp.id);
    assert.equal(d.wearKm, 10 + 1 + 20 + 40);
    assert.equal(d.mounts.length, 3);
    assert.equal(d.bikeId, b1.id);
  });
  test('retirement ends the counting on whichever bike the part is on', async () => {
    const b1 = await c.mkBike();
    const b2 = await c.mkBike();
    const comp = await c.mkComp(b1.id, { installedAt: '2024-01-01' });
    await move(c.A, comp.id, { bikeId: b2.id, date: '2024-02-01' });
    await c.mkRide(b2.id, '2024-03-01T08:00:00Z', 10);
    await c.A.put(`/api/components/${comp.id}`).send({ retiredAt: '2024-04-01' });
    await c.mkRide(b2.id, '2024-05-01T08:00:00Z', 999);
    assert.equal((await get(comp.id)).wearKm, 10);
  });
  test('rules for moving: validation, ownership, retired parts', async () => {
    const b1 = await c.mkBike();
    const b2 = await c.mkBike();
    const foreign = await c.mkBike(c.B);
    const comp = await c.mkComp(b1.id, { installedAt: '2024-05-01' });
    assert.equal((await move(c.A, comp.id, { bikeId: b1.id, date: '2024-06-01' })).status, 400); // same bike
    assert.equal((await move(c.A, comp.id, { bikeId: b2.id, date: '2024-04-01' })).status, 400); // before it was mounted
    assert.equal((await move(c.A, comp.id, { bikeId: b2.id, date: 'soon' })).status, 400);
    assert.equal((await move(c.A, comp.id, { bikeId: b2.id })).status, 400);
    assert.equal((await move(c.A, comp.id, { bikeId: foreign.id, date: '2024-06-01' })).status, 404);
    assert.equal((await move(c.B, comp.id, { bikeId: foreign.id, date: '2024-06-01' })).status, 404);
    assert.equal((await move(c.A, 99999999, { bikeId: b2.id, date: '2024-06-01' })).status, 404);
    assert.equal((await get(comp.id)).mounts.length, 1); // nothing changed
    await c.A.put(`/api/components/${comp.id}`).send({ retiredAt: '2024-06-15' });
    assert.equal((await move(c.A, comp.id, { bikeId: b2.id, date: '2024-06-01' })).status, 400); // retired
  });
  test('changing the installation date moves the start of the first mount', async () => {
    const bike = await c.mkBike();
    const comp = await c.mkComp(bike.id, { installedAt: '2024-05-01' });
    await c.mkRide(bike.id, '2024-04-10T08:00:00Z', 25);
    assert.equal((await get(comp.id)).wearKm, 0);
    await c.A.put(`/api/components/${comp.id}`).send({ installedAt: '2024-04-01' });
    const d = await get(comp.id);
    assert.equal(d.wearKm, 25);
    assert.equal(d.mounts[0].fromDate, '2024-04-01');
  });
  test('the part list and the bike lists follow the current bike', async () => {
    const b1 = await c.mkBike();
    const b2 = await c.mkBike();
    const comp = await c.mkComp(b1.id);
    await move(c.A, comp.id, { bikeId: b2.id, date: '2024-06-01' });
    assert.equal((await c.A.get(`/api/components?bikeId=${b1.id}`)).body.length, 0);
    assert.equal((await c.A.get(`/api/components?bikeId=${b2.id}`)).body[0].id, comp.id);
    assert.equal((await c.A.get(`/api/bikes/${b2.id}`)).body.components[0].wearKm, comp.wearKm);
    assert.equal((await c.A.get('/api/bikes')).body.find((b) => b.id === b2.id).activeComponents, 1);
  });
  test('services stay valid on a bike the part used to be on, but not on a bike it never visited', async () => {
    const b1 = await c.mkBike();
    const b2 = await c.mkBike();
    const never = await c.mkBike();
    const comp = await c.mkComp(b1.id);
    await move(c.A, comp.id, { bikeId: b2.id, date: '2024-06-01' });
    const old = await c.A.post('/api/services').send({ bikeId: b1.id, componentId: comp.id, date: '2024-05-01', type: 'CLEAN' });
    assert.equal(old.status, 201);
    assert.equal((await c.A.post('/api/services').send({ bikeId: b2.id, componentId: comp.id, date: '2024-07-01', type: 'CLEAN' })).status, 201);
    assert.equal((await c.A.post('/api/services').send({ bikeId: never.id, componentId: comp.id, date: '2024-07-01', type: 'CLEAN' })).status, 400);
  });
  test('only the part that is currently on a bike can be replaced there', async () => {
    const b1 = await c.mkBike();
    const b2 = await c.mkBike();
    const comp = await c.mkComp(b1.id);
    await move(c.A, comp.id, { bikeId: b2.id, date: '2024-06-01' });
    const wrong = await c.A.post('/api/services').send({ bikeId: b1.id, componentId: comp.id, date: '2024-07-01', type: 'REPLACE' });
    assert.equal(wrong.status, 400);
    const right = await c.A.post('/api/services').send({ bikeId: b2.id, componentId: comp.id, date: '2024-07-01', type: 'REPLACE', replacement: { brand: 'New' } });
    assert.equal(right.status, 201);
    assert.equal(right.body.newComponent.bikeId, b2.id);
    assert.equal((await get(right.body.newComponent.id)).mounts.length, 1);
  });
  test('deleting a bike removes the mounts on it but keeps a part that moved away', async () => {
    const b1 = await c.mkBike();
    const b2 = await c.mkBike();
    const comp = await c.mkComp(b1.id);
    await move(c.A, comp.id, { bikeId: b2.id, date: '2024-06-01' });
    assert.equal((await c.A.delete(`/api/bikes/${b1.id}`)).status, 204);
    const d = await get(comp.id);
    assert.equal(d.bikeId, b2.id);
    assert.deepEqual(d.mounts.map((m) => m.bikeId), [b2.id]);
  });
});
