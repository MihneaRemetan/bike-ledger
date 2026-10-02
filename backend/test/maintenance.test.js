const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');
const { decorateRule } = require('../src/lib/maintenance');

let c;
before(async () => { c = await setup('maint'); });
after(() => c.cleanup());

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const mkRule = (bikeId, extra = {}) => c.A.post('/api/maintenance/rules').send({ bikeId, title: 'Lube chain', serviceType: 'CLEAN', everyKm: 300, ...extra });

describe('rules: create and validate', () => {
  test('creates a rule that starts today by default, with zeroed counters', async () => {
    const bike = await c.mkBike();
    const r = await mkRule(bike.id, { everyDays: '30' });
    assert.equal(r.status, 201);
    assert.deepEqual([r.body.title, r.body.serviceType, r.body.everyKm, r.body.everyDays, r.body.startDate, r.body.status], ['Lube chain', 'CLEAN', 300, 30, today(), 'OK']);
    assert.deepEqual([r.body.kmSince, r.body.kmRemaining, r.body.daysRemaining, r.body.pct, r.body.bikeName], [0, 300, 30, 0, bike.name]);
  });
  test('needs at least one interval; values are range checked; every service type works', async () => {
    const bike = await c.mkBike();
    const none = await c.A.post('/api/maintenance/rules').send({ bikeId: bike.id, title: 'x', serviceType: 'CLEAN' });
    assert.equal(none.status, 400);
    assert.ok(none.body.details.some((d) => d.field === 'everyKm'));
    for (const body of [{ title: '' }, { title: 'x'.repeat(121) }, { serviceType: 'WASH' }, { everyKm: 0 }, { everyKm: 200001 }, { everyDays: 0 }, { everyDays: 1.5 }, { everyDays: 3651 }, { startDate: '1/1/2025' }, { bikeId: undefined }]) {
      const r = await c.A.post('/api/maintenance/rules').send({ bikeId: bike.id, title: 'x', serviceType: 'CLEAN', everyKm: 100, ...body });
      assert.equal(r.status, 400, JSON.stringify(body));
    }
    for (const serviceType of ['REPLACE', 'CLEAN', 'ADJUST', 'REPAIR', 'INSPECTION']) {
      assert.equal((await mkRule(bike.id, { serviceType, title: serviceType })).status, 201);
    }
    assert.equal((await mkRule(bike.id, { everyKm: '', everyDays: 10, componentId: '' })).status, 201); // form-style empty values
  });
  test('the bike must be yours; a part must have been on that bike', async () => {
    const mine = await c.mkBike();
    const other = await c.mkBike();
    const foreign = await c.mkBike(c.B);
    const partOnOther = await c.mkComp(other.id);
    const partOfMine = await c.mkComp(mine.id);
    assert.equal((await mkRule(foreign.id)).status, 404);
    assert.equal((await mkRule(mine.id, { componentId: partOnOther.id })).status, 400);
    assert.equal((await mkRule(mine.id, { componentId: partOfMine.id })).status, 201);
    assert.equal((await c.B.post('/api/maintenance/rules').send({ bikeId: foreign.id, title: 'x', serviceType: 'CLEAN', everyKm: 1, componentId: partOfMine.id })).status, 404);
  });
});

describe('rules: when something is due', () => {
  test('distance: OK below 80%, DUE from 80%, OVERDUE from 100%', async () => {
    const bike = await c.mkBike();
    const rule = (await mkRule(bike.id, { startDate: '2024-01-01', everyKm: 1000 })).body;
    const check = async () => (await c.A.get(`/api/maintenance/rules/${rule.id}`)).body;
    const ride = (await c.mkRide(bike.id, '2024-02-01T08:00:00Z', 700)).body;
    assert.equal((await check()).status, 'OK');
    await c.A.put(`/api/rides/${ride.id}`).send({ distanceKm: 800 });
    let r = await check();
    assert.deepEqual([r.status, r.kmSince, r.kmRemaining, r.pct], ['DUE', 800, 200, 0.8]);
    await c.A.put(`/api/rides/${ride.id}`).send({ distanceKm: 1200 });
    r = await check();
    assert.deepEqual([r.status, r.kmRemaining], ['OVERDUE', 0]);
  });
  test('time: counted in days since the start date and shows the next due date', async () => {
    const bike = await c.mkBike();
    const fresh = (await mkRule(bike.id, { startDate: daysAgo(10), everyKm: '', everyDays: 100 })).body;
    assert.deepEqual([fresh.status, fresh.daysRemaining, fresh.kmRemaining], ['OK', 90, null]);
    const due = (await mkRule(bike.id, { startDate: daysAgo(85), everyKm: '', everyDays: 100 })).body;
    assert.equal(due.status, 'DUE');
    const over = (await mkRule(bike.id, { startDate: daysAgo(130), everyKm: '', everyDays: 100 })).body;
    assert.deepEqual([over.status, over.daysRemaining], ['OVERDUE', 0]);
    assert.equal(fresh.nextDueDate, new Date(Date.parse(daysAgo(10)) + 100 * 86400000).toISOString().slice(0, 10));
  });
  test('with both limits, the one that is closer decides', async () => {
    const bike = await c.mkBike();
    const rule = (await mkRule(bike.id, { startDate: daysAgo(10), everyKm: 100, everyDays: 100 })).body;
    await c.mkRide(bike.id, `${daysAgo(5)}T08:00:00Z`, 90);
    const r = (await c.A.get(`/api/maintenance/rules/${rule.id}`)).body;
    assert.equal(r.status, 'DUE'); // 90% of the distance, only 10% of the time
    assert.equal(r.pct, 0.9);
  });
  test('rides before the start date or on other bikes do not count', async () => {
    const bike = await c.mkBike();
    const other = await c.mkBike();
    const rule = (await mkRule(bike.id, { startDate: '2024-06-01', everyKm: 100 })).body;
    await c.mkRide(bike.id, '2024-05-31T23:00:00Z', 500);
    await c.mkRide(other.id, '2024-07-01T08:00:00Z', 500);
    await c.mkRide(bike.id, '2024-06-01T08:00:00Z', 20); // the start day counts
    assert.equal((await c.A.get(`/api/maintenance/rules/${rule.id}`)).body.kmSince, 20);
  });
  test('a matching service restarts the counters; other types and other parts do not', async () => {
    const bike = await c.mkBike();
    const chain = await c.mkComp(bike.id, { type: 'CHAIN' });
    const tyre = await c.mkComp(bike.id, { type: 'TYRE_REAR' });
    const general = (await mkRule(bike.id, { startDate: '2024-01-01', everyKm: 100 })).body;
    const forChain = (await mkRule(bike.id, { startDate: '2024-01-01', everyKm: 100, componentId: chain.id, title: 'Chain wax' })).body;
    await c.mkRide(bike.id, '2024-02-01T08:00:00Z', 150);
    await c.mkService(bike.id, { type: 'REPAIR', date: '2024-03-01' }); // wrong type
    await c.mkService(bike.id, { type: 'CLEAN', date: '2024-03-02', componentId: tyre.id }); // right type, other part
    const get = async (id) => (await c.A.get(`/api/maintenance/rules/${id}`)).body;
    assert.equal((await get(general.id)).kmSince, 0); // a general rule accepts a clean of any part
    assert.equal((await get(forChain.id)).kmSince, 150); // but the chain rule needs the chain
    await c.mkService(bike.id, { type: 'CLEAN', date: '2024-03-03', componentId: chain.id });
    const r = await get(forChain.id);
    assert.deepEqual([r.kmSince, r.lastDoneAt, r.lastServiceAt, r.status], [0, '2024-03-03', '2024-03-03', 'OK']);
    const never = (await mkRule(bike.id, { title: 'never done', serviceType: 'INSPECTION', startDate: '2024-01-01' })).body;
    assert.deepEqual([never.lastServiceAt, never.lastDoneAt], [null, '2024-01-01']); // no matching service yet: counting from the start date
  });
  test('a retired part pauses its rules', async () => {
    const bike = await c.mkBike();
    const part = await c.mkComp(bike.id);
    const rule = (await mkRule(bike.id, { componentId: part.id, everyDays: 1, startDate: daysAgo(50) })).body;
    assert.equal(rule.status, 'OVERDUE');
    await c.A.put(`/api/components/${part.id}`).send({ retiredAt: today() });
    assert.equal((await c.A.get(`/api/maintenance/rules/${rule.id}`)).body.status, 'PAUSED');
    assert.equal((await c.A.get(`/api/maintenance/rules?bikeId=${bike.id}&status=due`)).body.some((r) => r.id === rule.id), false);
  });
});

describe('rules: list, update, delete, complete', () => {
  test('list is filtered by bike and status and sorted most urgent first', async () => {
    const bike = await c.mkBike();
    const ok = (await mkRule(bike.id, { title: 'ok rule', everyDays: 1000 })).body;
    const over = (await mkRule(bike.id, { title: 'overdue rule', everyKm: '', everyDays: 10, startDate: daysAgo(40) })).body;
    const due = (await mkRule(bike.id, { title: 'due rule', everyKm: '', everyDays: 100, startDate: daysAgo(90) })).body;
    const all = (await c.A.get(`/api/maintenance/rules?bikeId=${bike.id}`)).body;
    assert.deepEqual(all.map((r) => r.id), [over.id, due.id, ok.id]);
    assert.deepEqual((await c.A.get(`/api/maintenance/rules?bikeId=${bike.id}&status=due`)).body.map((r) => r.id), [over.id, due.id]);
    assert.deepEqual((await c.A.get(`/api/maintenance/rules?bikeId=${bike.id}&status=ok`)).body.map((r) => r.id), [ok.id]);
    assert.equal((await c.A.get('/api/maintenance/rules?status=nope')).status, 400);
    assert.equal((await c.B.get(`/api/maintenance/rules?bikeId=${bike.id}`)).body.length, 0);
  });
  test('update is partial and keeps at least one interval', async () => {
    const bike = await c.mkBike();
    const rule = (await mkRule(bike.id, { everyDays: 30 })).body;
    const r = await c.A.put(`/api/maintenance/rules/${rule.id}`).send({ title: 'Renamed', everyKm: '' });
    assert.equal(r.status, 200);
    assert.deepEqual([r.body.title, r.body.everyKm, r.body.everyDays], ['Renamed', null, 30]);
    assert.equal((await c.A.put(`/api/maintenance/rules/${rule.id}`).send({ everyDays: '' })).status, 400);
    assert.equal((await c.A.put(`/api/maintenance/rules/${rule.id}`).send({ everyKm: -1 })).status, 400);
    assert.equal((await c.A.put(`/api/maintenance/rules/${rule.id}`).send({})).status, 200);
    const moved = await c.A.put(`/api/maintenance/rules/${rule.id}`).send({ startDate: '2020-01-01', serviceType: 'INSPECTION' });
    assert.deepEqual([moved.body.startDate, moved.body.serviceType], ['2020-01-01', 'INSPECTION']);
    assert.equal((await c.A.put(`/api/maintenance/rules/${rule.id}`).send({ startDate: '' })).body.startDate, '2020-01-01'); // cannot be emptied
  });
  test('moving a rule to another bike checks ownership and the part', async () => {
    const b1 = await c.mkBike();
    const b2 = await c.mkBike();
    const foreign = await c.mkBike(c.B);
    const part = await c.mkComp(b1.id);
    const rule = (await mkRule(b1.id, { componentId: part.id })).body;
    assert.equal((await c.A.put(`/api/maintenance/rules/${rule.id}`).send({ bikeId: foreign.id })).status, 404);
    assert.equal((await c.A.put(`/api/maintenance/rules/${rule.id}`).send({ bikeId: b2.id })).status, 400); // part never on b2
    assert.equal((await c.A.put(`/api/maintenance/rules/${rule.id}`).send({ bikeId: b2.id, componentId: '' })).body.bikeId, b2.id);
  });
  test('detail, delete, and other users get 404', async () => {
    const bike = await c.mkBike();
    const rule = (await mkRule(bike.id)).body;
    assert.equal((await c.B.get(`/api/maintenance/rules/${rule.id}`)).status, 404);
    assert.equal((await c.B.put(`/api/maintenance/rules/${rule.id}`).send({ title: 'x' })).status, 404);
    assert.equal((await c.B.delete(`/api/maintenance/rules/${rule.id}`)).status, 404);
    assert.equal((await c.A.get('/api/maintenance/rules/abc')).status, 400);
    assert.equal((await c.A.delete(`/api/maintenance/rules/${rule.id}`)).status, 204);
    assert.equal((await c.A.get(`/api/maintenance/rules/${rule.id}`)).status, 404);
  });
  test('"complete" logs a service of the rule type, on its part, and resets the rule', async () => {
    const bike = await c.mkBike();
    const part = await c.mkComp(bike.id);
    const rule = (await mkRule(bike.id, { componentId: part.id, serviceType: 'ADJUST', title: 'Adjust cable', startDate: '2024-01-01', everyKm: 100 })).body;
    await c.mkRide(bike.id, '2024-02-01T08:00:00Z', 150);
    const r = await c.A.post(`/api/maintenance/rules/${rule.id}/complete`).send({ cost: '12.5', notes: 'Done at home' });
    assert.equal(r.status, 201);
    assert.deepEqual([r.body.service.type, r.body.service.componentId, r.body.service.cost, r.body.service.notes, r.body.service.date], ['ADJUST', part.id, 12.5, 'Done at home', today()]);
    assert.deepEqual([r.body.rule.status, r.body.rule.kmSince, r.body.rule.lastDoneAt], ['OK', 0, today()]);
    const dated = await c.A.post(`/api/maintenance/rules/${rule.id}/complete`).send({ date: '2024-03-01' });
    assert.equal(dated.body.service.notes, 'Adjust cable'); // defaults to the rule title
    assert.equal(dated.body.rule.lastDoneAt, today()); // the latest service wins
    assert.equal((await c.A.post(`/api/maintenance/rules/${rule.id}/complete`).send({ cost: -1 })).status, 400);
    assert.equal((await c.B.post(`/api/maintenance/rules/${rule.id}/complete`).send({})).status, 404);
    assert.equal((await c.A.post(`/api/maintenance/rules/${rule.id}/complete`)).status, 201); // no body at all
  });
  test('deleting a bike or a part removes its rules', async () => {
    const bike = await c.mkBike();
    const part = await c.mkComp(bike.id);
    const partRule = (await mkRule(bike.id, { componentId: part.id })).body;
    const bikeRule = (await mkRule(bike.id)).body;
    await c.A.delete(`/api/components/${part.id}`);
    assert.equal((await c.A.get(`/api/maintenance/rules/${partRule.id}`)).status, 404);
    await c.A.delete(`/api/bikes/${bike.id}`);
    assert.equal((await c.A.get(`/api/maintenance/rules/${bikeRule.id}`)).status, 404);
  });
});

describe('suggested rules and the dashboard', () => {
  test('suggested rules are added once and keep existing ones', async () => {
    const bike = await c.mkBike();
    const first = await c.A.post('/api/maintenance/suggested').send({ bikeId: bike.id });
    assert.equal(first.status, 201);
    assert.equal(first.body.length, 3);
    assert.ok(first.body.every((r) => r.status === 'OK'));
    const again = await c.A.post('/api/maintenance/suggested').send({ bikeId: bike.id });
    assert.equal(again.body.length, 3);
    await c.A.delete(`/api/maintenance/rules/${first.body[0].id}`);
    assert.equal((await c.A.post('/api/maintenance/suggested').send({ bikeId: bike.id })).body.length, 3); // the missing one comes back
    assert.equal((await c.A.post('/api/maintenance/suggested').send({})).status, 400);
    assert.equal((await c.B.post('/api/maintenance/suggested').send({ bikeId: bike.id })).status, 404);
  });
  test('the dashboard lists due and overdue rules, not the ones that are fine', async () => {
    const bike = await c.mkBike(c.A, { name: 'Dash bike' });
    await mkRule(bike.id, { title: 'fine', everyDays: 1000 });
    const late = (await mkRule(bike.id, { title: 'late', everyKm: '', everyDays: 10, startDate: daysAgo(30) })).body;
    const { maintenance } = (await c.A.get('/api/stats/dashboard')).body;
    const mine = maintenance.filter((m) => m.bikeName === 'Dash bike');
    assert.deepEqual(mine.map((m) => [m.id, m.status, m.title]), [[late.id, 'OVERDUE', 'late']]);
    assert.equal((await c.B.get('/api/stats/dashboard')).body.maintenance.length, 0);
  });
});

describe('decorateRule (pure)', () => {
  const rule = (o) => ({ everyKm: 100, everyDays: null, kmSince: 0, daysSince: 0, lastDoneAt: '2025-01-01', componentRetiredAt: null, ...o });
  test('thresholds, remaining values and the next due date', () => {
    assert.equal(decorateRule(rule({ kmSince: 79 })).status, 'OK');
    assert.equal(decorateRule(rule({ kmSince: 80 })).status, 'DUE');
    assert.equal(decorateRule(rule({ kmSince: 100 })).status, 'OVERDUE');
    const d = decorateRule(rule({ everyKm: null, everyDays: 30, daysSince: 5, lastDoneAt: '2025-01-31' }));
    assert.deepEqual([d.daysRemaining, d.kmRemaining, d.nextDueDate], [25, null, '2025-03-02']);
    assert.equal(decorateRule(rule({ kmSince: 500 })).kmRemaining, 0);
    assert.equal('componentRetiredAt' in decorateRule(rule({})), false);
  });
});
