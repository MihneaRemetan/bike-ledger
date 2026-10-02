const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');
const { componentForecast, ruleForecast, addDays, MAX_HORIZON_DAYS } = require('../src/lib/forecast');

let c;
before(async () => { c = await setup('forecast'); });
after(() => c.cleanup());

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const rideOn = (bikeId, ago, km) => c.mkRide(bikeId, `${daysAgo(ago)}T08:00:00Z`, km);
const part = async (id) => (await c.A.get(`/api/components/${id}`)).body;

describe('componentForecast (pure)', () => {
  const comp = (o) => ({ remainingKm: 500, retiredAt: null, ...o });
  test('a date from the remaining km and the recent pace', () => {
    const f = componentForecast(comp({ remainingKm: 500 }), { kmPerDay: 10, windowDays: 90 }, '2026-01-01');
    assert.deepEqual([f.status, f.daysLeft, f.date, f.kmPerDay, f.windowDays], ['DATE', 50, '2026-02-20', 10, 90]);
  });
  test('rounds up to whole days', () => {
    assert.equal(componentForecast(comp({ remainingKm: 101 }), { kmPerDay: 10, windowDays: 90 }, '2026-01-01').daysLeft, 11);
  });
  test('NOW when the limit is reached, whatever the pace', () => {
    assert.deepEqual(componentForecast(comp({ remainingKm: 0 }), { kmPerDay: 10, windowDays: 90 }, '2026-01-01'), { kmPerDay: 10, windowDays: 90, remainingKm: 0, status: 'NOW', daysLeft: 0, date: null });
    assert.equal(componentForecast(comp({ remainingKm: 0 }), undefined).status, 'NOW');
  });
  test('NO_RECENT_RIDES without a pace', () => {
    assert.equal(componentForecast(comp(), { kmPerDay: 0, windowDays: 90 }).status, 'NO_RECENT_RIDES');
    assert.equal(componentForecast(comp(), undefined).status, 'NO_RECENT_RIDES');
  });
  test('FAR beyond ten years', () => {
    const f = componentForecast(comp({ remainingKm: 100000 }), { kmPerDay: 0.5, windowDays: 90 }, '2026-01-01');
    assert.deepEqual([f.status, f.date], ['FAR', null]);
    assert.ok(f.daysLeft > MAX_HORIZON_DAYS);
  });
  test('retired parts have no forecast', () => {
    assert.equal(componentForecast(comp({ retiredAt: '2025-01-01' }), { kmPerDay: 10, windowDays: 90 }), null);
  });
  test('addDays handles month ends and leap years', () => {
    assert.equal(addDays('2026-01-31', 1), '2026-02-01');
    assert.equal(addDays('2024-02-28', 1), '2024-02-29');
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  });
});

describe('ruleForecast (pure)', () => {
  const rule = (o) => ({ status: 'OK', nextDueDate: null, kmRemaining: null, ...o });
  test('the earlier of the day limit and the distance limit wins', () => {
    const rate = { kmPerDay: 10, windowDays: 90 };
    assert.deepEqual(ruleForecast(rule({ nextDueDate: '2026-03-01', kmRemaining: 100 }), rate, '2026-01-01'), { date: '2026-01-11', basis: 'KM' });
    assert.deepEqual(ruleForecast(rule({ nextDueDate: '2026-01-05', kmRemaining: 100 }), rate, '2026-01-01'), { date: '2026-01-05', basis: 'DAYS' });
  });
  test('works with only one kind of interval, or without a pace', () => {
    assert.deepEqual(ruleForecast(rule({ kmRemaining: 50 }), { kmPerDay: 5, windowDays: 90 }, '2026-01-01'), { date: '2026-01-11', basis: 'KM' });
    assert.deepEqual(ruleForecast(rule({ nextDueDate: '2026-05-05' }), undefined, '2026-01-01'), { date: '2026-05-05', basis: 'DAYS' });
    assert.equal(ruleForecast(rule({ kmRemaining: 50 }), { kmPerDay: 0, windowDays: 90 }), null);
    assert.equal(ruleForecast(rule({ kmRemaining: 50 }), undefined), null);
  });
  test('overdue and paused rules have nothing to predict', () => {
    assert.equal(ruleForecast(rule({ status: 'OVERDUE', nextDueDate: '2026-01-05' }), undefined), null);
    assert.equal(ruleForecast(rule({ status: 'PAUSED', nextDueDate: '2026-01-05' }), undefined), null);
  });
});

describe('forecast in the API', () => {
  test('uses the last 90 days of the bike: pace, date and remaining km', async () => {
    const bike = await c.mkBike();
    const comp = await c.mkComp(bike.id, { installedAt: daysAgo(200), maxKm: 1000 });
    await rideOn(bike.id, 200, 500); // old: counts for wear, not for the pace
    await rideOn(bike.id, 30, 180);
    await rideOn(bike.id, 10, 90); // 270 km in the window -> 3 km/day; wear 770, 230 left
    const f = (await part(comp.id)).forecast;
    assert.deepEqual([f.status, f.kmPerDay, f.windowDays, f.remainingKm, f.daysLeft], ['DATE', 3, 90, 230, 77]);
    assert.equal(f.date, addDays(today(), 77));
  });
  test('a young bike is judged over its own short history (at least 14 days)', async () => {
    const bike = await c.mkBike();
    const comp = await c.mkComp(bike.id, { installedAt: daysAgo(40), maxKm: 1000 });
    await rideOn(bike.id, 6, 70); // history of 7 days -> window of 14 days -> 5 km/day
    const f = (await part(comp.id)).forecast;
    assert.deepEqual([f.windowDays, f.kmPerDay], [14, 5]);
    assert.equal(f.daysLeft, Math.ceil(930 / 5));
    const bike2 = await c.mkBike();
    const comp2 = await c.mkComp(bike2.id, { installedAt: daysAgo(100), maxKm: 5000 });
    await rideOn(bike2.id, 30, 300); // 31 days of history
    assert.equal((await part(comp2.id)).forecast.windowDays, 31);
  });
  test('rides older than the window or in the future do not set the pace', async () => {
    const bike = await c.mkBike();
    const comp = await c.mkComp(bike.id, { installedAt: daysAgo(400), maxKm: 5000 });
    await rideOn(bike.id, 120, 400);
    await rideOn(bike.id, -5, 400); // planned ride in the future
    const f = (await part(comp.id)).forecast;
    assert.deepEqual([f.status, f.kmPerDay], ['NO_RECENT_RIDES', 0]);
  });
  test('a part at its limit is NOW; a retired part has no forecast', async () => {
    const bike = await c.mkBike();
    await rideOn(bike.id, 5, 100);
    const worn = await c.mkComp(bike.id, { installedAt: daysAgo(30), maxKm: 100 });
    const gone = await c.mkComp(bike.id, { installedAt: daysAgo(30), maxKm: 100, retiredAt: daysAgo(2), type: 'CABLES' });
    assert.equal((await part(worn.id)).forecast.status, 'NOW');
    assert.equal((await part(gone.id)).forecast, null);
  });
  test('the pace of a part follows the bike it is on now', async () => {
    const busy = await c.mkBike();
    const quiet = await c.mkBike();
    await rideOn(busy.id, 3, 90);
    await rideOn(quiet.id, 3, 9);
    const comp = await c.mkComp(busy.id, { installedAt: daysAgo(100), maxKm: 5000 });
    const before = (await part(comp.id)).forecast.kmPerDay;
    await c.A.post(`/api/components/${comp.id}/move`).send({ bikeId: quiet.id, date: today() });
    assert.ok((await part(comp.id)).forecast.kmPerDay < before);
  });
  test('the forecast is on the list, the bike page, the dashboard alerts and after a move', async () => {
    const bike = await c.mkBike();
    const other = await c.mkBike();
    await rideOn(bike.id, 10, 160);
    const comp = await c.mkComp(bike.id, { installedAt: daysAgo(50), maxKm: 200 }); // 80% -> alert
    assert.equal((await c.A.get(`/api/components?bikeId=${bike.id}`)).body[0].forecast.status, 'DATE');
    assert.equal((await c.A.get(`/api/bikes/${bike.id}`)).body.components[0].forecast.status, 'DATE');
    const alert = (await c.A.get('/api/stats/dashboard')).body.alerts.find((a) => a.id === comp.id);
    assert.equal(alert.forecast.status, 'DATE');
    const moved = await c.A.post(`/api/components/${comp.id}/move`).send({ bikeId: other.id, date: today() });
    assert.ok('forecast' in moved.body);
    const created = await c.A.post('/api/components').send({ bikeId: bike.id, type: 'CHAIN', installedAt: daysAgo(1) });
    assert.ok('forecast' in created.body);
  });
  test('maintenance rules get an expected date from the pace, or from their day interval', async () => {
    const bike = await c.mkBike();
    await rideOn(bike.id, 10, 100); // 100 km in 11 days of history -> window 14 -> ~7.14 km/day
    const byKm = (await c.A.post('/api/maintenance/rules').send({ bikeId: bike.id, title: 'km rule', serviceType: 'CLEAN', everyKm: 1000, startDate: daysAgo(20) })).body;
    assert.equal(byKm.forecast.basis, 'KM');
    assert.equal(byKm.forecast.date, addDays(today(), Math.ceil(900 / (100 / 14))));
    const byDays = (await c.A.post('/api/maintenance/rules').send({ bikeId: bike.id, title: 'day rule', serviceType: 'INSPECTION', everyDays: 30, startDate: daysAgo(20) })).body;
    assert.deepEqual(byDays.forecast, { date: addDays(today(), 10), basis: 'DAYS' });
    const overdue = (await c.A.post('/api/maintenance/rules').send({ bikeId: bike.id, title: 'late', serviceType: 'ADJUST', everyDays: 5, startDate: daysAgo(20) })).body;
    assert.equal(overdue.forecast, null);
  });
});
