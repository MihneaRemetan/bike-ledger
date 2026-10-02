const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');

let c;
before(async () => { c = await setup('overview'); });
after(() => c.cleanup());

const overview = async (client, year) => (await client.get(`/api/stats/overview${year ? `?year=${year}` : ''}`)).body;

describe('statistics overview', () => {
  test('a new user gets an empty report for the current year', async () => {
    const o = await overview(c.A);
    assert.equal(o.year, new Date().getUTCFullYear());
    assert.deepEqual(o.years, [o.year]);
    assert.deepEqual(o.summary, { km: 0, rides: 0, elevationM: 0, movingMin: 0, activeDays: 0, avgDistanceKm: 0, avgSpeedKmh: null });
    assert.deepEqual(o.costs, { services: 0, parts: 0, total: 0, perKm: null });
    assert.equal(o.months.length, 12);
    assert.deepEqual(o.bikes, []);
    assert.deepEqual(o.records, { longestRide: null, mostElevation: null, fastestRide: null, bestMonth: null });
    assert.deepEqual(o.parts, []);
  });
  test('invalid years are rejected', async () => {
    for (const y of ['abc', '1999', '2101', '20.5']) assert.equal((await c.A.get(`/api/stats/overview?year=${y}`)).status, 400, y);
    assert.equal((await c.A.get('/api/stats/overview?year=2020')).status, 200);
  });
  test('summary, months, bikes and records are computed per year', async () => {
    const gravel = await c.mkBike(c.A, { name: 'Gravel', type: 'GRAVEL' });
    const city = await c.mkBike(c.A, { name: 'City', type: 'CITY' });
    await c.mkRide(gravel.id, '2023-03-10T08:00:00Z', 50, { durationMin: 120, elevationM: 400, title: 'Spring' });
    await c.mkRide(gravel.id, '2023-03-20T08:00:00Z', 100, { durationMin: 300, elevationM: 900, title: 'Long one' });
    await c.mkRide(city.id, '2023-03-20T18:00:00Z', 5, { durationMin: 20, title: 'Commute' });
    await c.mkRide(city.id, '2023-07-01T08:00:00Z', 30, { durationMin: 60, elevationM: 100, title: 'Quick' });
    await c.mkRide(gravel.id, '2022-12-31T23:30:00Z', 999, { title: 'Other year' });
    await c.mkRide(gravel.id, '2024-01-01T00:30:00Z', 888, { title: 'Next year' });
    await c.mkService(gravel.id, { date: '2023-05-01', cost: 40 });
    await c.mkService(city.id, { date: '2023-06-01', cost: 10 });
    await c.mkService(city.id, { date: '2024-06-01', cost: 500 }); // other year
    const o = await overview(c.A, 2023);
    assert.equal(o.year, 2023);
    assert.ok(o.years.includes(2022) && o.years.includes(2023) && o.years.includes(2024));
    assert.ok(o.years.every((y, i, a) => !i || a[i - 1] > y)); // newest first
    assert.deepEqual(o.summary, { km: 185, rides: 4, elevationM: 1400, movingMin: 500, activeDays: 3, avgDistanceKm: 46.3, avgSpeedKmh: 22.2 });
    assert.deepEqual(o.months.map((m) => m.km), [0, 0, 155, 0, 0, 0, 30, 0, 0, 0, 0, 0]);
    assert.equal(o.months[2].month, '2023-03');
    assert.deepEqual([o.months[2].rides, o.months[2].elevationM], [3, 1300]);
    assert.deepEqual(o.bikes.map((b) => [b.name, b.km, b.rides, b.serviceCost]), [['Gravel', 150, 2, 40], ['City', 35, 2, 10]]);
    assert.equal(o.bikes[0].costPerKm, 0.267);
    assert.equal(o.records.longestRide.title, 'Long one');
    assert.equal(o.records.longestRide.bikeName, 'Gravel');
    assert.equal(o.records.mostElevation.title, 'Long one');
    assert.deepEqual([o.records.fastestRide.title, o.records.fastestRide.avgSpeedKmh], ['Quick', 30]); // 30 km in 1 h; the 5 km commute is too short to count
    assert.deepEqual(o.records.bestMonth, { month: '2023-03', km: 155 });
  });
  test('costs add service costs and the price of parts installed that year', async () => {
    const bike = await c.mkBike();
    await c.mkRide(bike.id, '2021-05-01T08:00:00Z', 200);
    await c.mkService(bike.id, { date: '2021-06-01', cost: 30 });
    await c.mkComp(bike.id, { installedAt: '2021-02-01', price: 70 });
    await c.mkComp(bike.id, { installedAt: '2020-02-01', price: 999 }); // another year
    const o = await overview(c.A, 2021);
    assert.deepEqual(o.costs, { services: 30, parts: 70, total: 100, perKm: 0.5 });
  });
  test('parts are ranked by cost per km, parts without price or km are handled', async () => {
    const bike = await c.mkBike();
    await c.mkRide(bike.id, '2020-05-01T08:00:00Z', 500);
    const cheap = await c.mkComp(bike.id, { type: 'CHAIN', installedAt: '2020-01-01', price: 50 }); // 0.1 / km
    const dear = await c.mkComp(bike.id, { type: 'CASSETTE', installedAt: '2020-01-01', price: 250 }); // 0.5 / km
    const unused = await c.mkComp(bike.id, { type: 'CABLES', installedAt: '2030-01-01', price: 10 }); // no km yet
    await c.mkComp(bike.id, { type: 'BAR_TAPE', installedAt: '2020-01-01' }); // no price: not listed
    const { parts } = await overview(c.A, 2020);
    const mine = parts.filter((p) => [cheap.id, dear.id, unused.id].includes(p.id));
    assert.deepEqual(mine.map((p) => [p.id, p.costPerKm]), [[dear.id, 0.5], [cheap.id, 0.1], [unused.id, null]]);
    assert.equal(parts.some((p) => p.type === 'BAR_TAPE' && p.bikeName === bike.name), false);
    assert.equal(mine[0].bikeName, bike.name);
  });
  test('it only ever includes the logged-in user data', async () => {
    const o = await overview(c.B, 2023);
    assert.equal(o.summary.km, 0);
    assert.deepEqual(o.bikes, []);
    assert.deepEqual(o.parts, []);
  });
  test('the dashboard keeps working and now also reports maintenance', async () => {
    const d = (await c.A.get('/api/stats/dashboard')).body;
    assert.ok(Array.isArray(d.maintenance));
  });
});
