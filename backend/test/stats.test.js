const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');

let c;
before(async () => { c = await setup('stats'); });
after(() => c.cleanup());

const monthStart = (offset) => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 10, 12));
};
const ym = (d) => d.toISOString().slice(0, 7);

describe('dashboard stats', () => {
  test('a brand new user gets zeros, 12 empty months and no alerts', async () => {
    const r = await c.A.get('/api/stats/dashboard');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.totals, { bikes: 0, rides: 0, km: 0, elevationM: 0, maintenanceCost: 0, activeComponents: 0 });
    assert.equal(r.body.months.length, 12);
    assert.ok(r.body.months.every((m) => m.km === 0 && m.cost === 0));
    assert.deepEqual(r.body.alerts, []);
  });
  test('months are ascending, end with the current month and place km and cost in the right month', async () => {
    const bike = await c.mkBike();
    await c.mkRide(bike.id, monthStart(0).toISOString(), 40.5, { elevationM: 100 });
    await c.mkRide(bike.id, monthStart(-2).toISOString(), 25, { elevationM: 50 });
    await c.mkRide(bike.id, monthStart(-2).toISOString(), 5);
    await c.mkRide(bike.id, monthStart(-12).toISOString(), 999); // outside the 12-month window
    await c.mkService(bike.id, { date: monthStart(-1).toISOString().slice(0, 10), cost: 80 });
    const { months, totals } = (await c.A.get('/api/stats/dashboard')).body;
    const keys = months.map((m) => m.month);
    assert.deepEqual(keys, [...keys].sort());
    assert.equal(keys[11], ym(monthStart(0)));
    assert.equal(keys[0], ym(monthStart(-11)));
    const by = Object.fromEntries(months.map((m) => [m.month, m]));
    assert.equal(by[ym(monthStart(0))].km, 40.5);
    assert.equal(by[ym(monthStart(-2))].km, 30);
    assert.equal(by[ym(monthStart(-1))].cost, 80);
    assert.equal(by[ym(monthStart(-1))].km, 0);
    assert.equal(totals.km, 40.5 + 30 + 999); // totals cover all time
    assert.equal(totals.elevationM, 150);
    assert.equal(totals.maintenanceCost, 80);
    assert.equal(totals.rides, 4);
    assert.equal(totals.bikes, 1);
  });
  test('alerts: only active WARN/REPLACE parts, worst first, with bike name; retired parts never alert', async () => {
    const bike = await c.mkBike(c.A, { name: 'Alert bike' });
    await c.mkRide(bike.id, '2024-02-01T08:00:00Z', 900);
    const warn = await c.mkComp(bike.id, { type: 'CHAIN', maxKm: 1000, installedAt: '2024-01-01' }); // 90%
    const bad = await c.mkComp(bike.id, { type: 'TYRE_REAR', maxKm: 800, installedAt: '2024-01-01' }); // 112%
    await c.mkComp(bike.id, { type: 'CABLES', maxKm: 9000, installedAt: '2024-01-01' }); // OK
    await c.mkComp(bike.id, { type: 'BAR_TAPE', maxKm: 100, installedAt: '2024-01-01', retiredAt: '2024-12-01' }); // retired
    const { alerts, totals } = (await c.A.get('/api/stats/dashboard')).body;
    const mine = alerts.filter((a) => a.bikeName === 'Alert bike');
    assert.deepEqual(mine.map((a) => [a.id, a.status]), [[bad.id, 'REPLACE'], [warn.id, 'WARN']]);
    for (let i = 1; i < alerts.length; i++) assert.ok(alerts[i - 1].wearPct >= alerts[i].wearPct);
    assert.equal(totals.activeComponents, 3);
  });
  test("stats never include another user's data", async () => {
    const r = await c.B.get('/api/stats/dashboard');
    assert.equal(r.body.totals.bikes, 0);
    assert.equal(r.body.totals.km, 0);
    assert.equal(r.body.alerts.length, 0);
  });
});
