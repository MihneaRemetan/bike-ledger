const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, gpxFile } = require('./helpers');
const { toCsv, cell } = require('../src/lib/csv');

let c;
let seeded;
after(() => c.cleanup());

const parse = (res) => JSON.parse(res.text);
const upload = (client, json, name = 'export.json') => client.post('/api/data/import').attach('file', Buffer.from(typeof json === 'string' ? json : JSON.stringify(json)), name);

// A small but complete account for A
before(async () => {
  c = await setup('data');
  const gravel = await c.mkBike(c.A, { name: 'Gravel', brand: 'Canyon', year: 2024 });
  const city = await c.mkBike(c.A, { name: 'City, "old" one', type: 'CITY' });
  const chain = await c.mkComp(gravel.id, { type: 'CHAIN', installedAt: '2024-01-01', price: 100, maxKm: 4000 });
  const tyre = await c.mkComp(city.id, { type: 'TYRE_REAR', installedAt: '2024-01-01', price: 60 });
  await c.A.post(`/api/components/${tyre.id}/move`).send({ bikeId: gravel.id, date: '2024-06-01' });
  const manual = (await c.mkRide(gravel.id, '2024-02-01T08:00:00Z', 40, { title: '=HYPERLINK("evil")', durationMin: 90 })).body;
  const imported = (await c.A.post('/api/rides/import-gpx').field('bikeId', gravel.id).attach('file', gpxFile(30, { name: 'With route' }), 'a.gpx')).body;
  await c.mkRide(city.id, '2024-03-01T08:00:00Z', 12);
  await c.mkService(gravel.id, { componentId: chain.id, type: 'CLEAN', cost: 15, notes: 'multi\nline, with comma' });
  await c.A.post('/api/maintenance/rules').send({ bikeId: gravel.id, componentId: chain.id, title: 'Chain wax', serviceType: 'CLEAN', everyKm: 300 });
  seeded = { gravel, city, chain, tyre, manual, imported };
});

describe('export', () => {
  test('JSON export has everything, with part history and without tracks by default', async () => {
    const r = await c.A.get('/api/data/export');
    assert.equal(r.status, 200);
    assert.match(r.headers['content-disposition'], /attachment; filename="bikeledger-\d{4}-\d{2}-\d{2}\.json"/);
    const d = parse(r);
    assert.deepEqual([d.app, d.version], ['BikeLedger', 1]);
    assert.deepEqual([d.bikes.length, d.components.length, d.rides.length, d.services.length, d.rules.length], [2, 2, 3, 1, 1]);
    assert.equal(d.tracks, undefined);
    const tyre = d.components.find((x) => x.id === seeded.tyre.id);
    assert.equal(tyre.mounts.length, 2);
    assert.equal(JSON.stringify(d).includes('password'), false);
  });
  test('?tracks=true adds the GPS tracks', async () => {
    const d = parse(await c.A.get('/api/data/export?tracks=true'));
    assert.equal(d.tracks.length, 1);
    assert.equal(d.tracks[0].rideId, seeded.imported.id);
    assert.ok(d.tracks[0].points.length >= 2);
  });
  test('an export only holds the requesting user data', async () => {
    const d = parse(await c.B.get('/api/data/export'));
    assert.deepEqual([d.bikes.length, d.rides.length, d.components.length], [0, 0, 0]);
  });
  test('every CSV downloads with a header, a BOM, and the right rows', async () => {
    const expected = { bikes: 2, components: 2, rides: 3, services: 1, rules: 1 };
    for (const [name, rows] of Object.entries(expected)) {
      const r = await c.A.get(`/api/data/export/${name}.csv`);
      assert.equal(r.status, 200, name);
      assert.match(r.headers['content-type'], /text\/csv/);
      assert.match(r.headers['content-disposition'], new RegExp(`bikeledger-${name}\\.csv`));
      assert.ok(r.text.startsWith('﻿'), 'BOM');
      assert.equal(r.text.trim().split('\r\n').length > rows, true, name); // header + rows (multi-line cells add more)
    }
    const rides = (await c.A.get('/api/data/export/rides.csv')).text;
    assert.match(rides, /^﻿id,date,bike,title,distance_km,duration_min,elevation_m,source,notes\r\n/);
    assert.match(rides, /'=HYPERLINK\(""evil""\)/); // formula neutralised and quotes escaped
    const bikes = (await c.A.get('/api/data/export/bikes.csv')).text;
    assert.ok(bikes.includes('"City, ""old"" one"'));
    const services = (await c.A.get('/api/data/export/services.csv')).text;
    assert.ok(services.includes('"multi\nline, with comma"'));
  });
  test('unknown CSV names are a 404, and exports need a login', async () => {
    assert.equal((await c.A.get('/api/data/export/passwords.csv')).status, 404);
    assert.equal((await c.A.get('/api/data/export/rides')).status, 404);
    const request = require('supertest');
    assert.equal((await request(c.app).get('/api/data/export')).status, 401);
    assert.equal((await request(c.app).get('/api/data/export/rides.csv')).status, 401);
  });
});

describe('csv helper', () => {
  test('quotes, escapes and neutralises formulas', () => {
    assert.equal(cell('plain'), 'plain');
    assert.equal(cell('a,b'), '"a,b"');
    assert.equal(cell('say "hi"'), '"say ""hi"""');
    assert.equal(cell('line\nbreak'), '"line\nbreak"');
    for (const bad of ['=1+1', '+1', '-1+2', '@SUM(A1)']) assert.equal(cell(bad), `'${bad}`);
    assert.equal(cell(-5), '-5'); // real numbers stay numbers
    assert.equal(cell(null), '');
    assert.equal(cell(undefined), '');
    assert.equal(cell(true), 'true');
    assert.equal(cell(new Date('2025-01-02T03:04:05Z')), '2025-01-02T03:04:05.000Z');
  });
  test('toCsv writes header and rows with CRLF', () => {
    const out = toCsv([{ header: 'a', value: (r) => r.a }, { header: 'b', value: (r) => r.b }], [{ a: 1, b: 'x' }, { a: 2, b: null }]);
    assert.equal(out, '﻿a,b\r\n1,x\r\n2,\r\n');
  });
});

describe('import', () => {
  test('a full export can be imported into another account, with links, history and tracks intact', async () => {
    const file = parse(await c.A.get('/api/data/export?tracks=true'));
    const r = await upload(c.B, file);
    assert.equal(r.status, 201);
    assert.deepEqual(r.body.imported, { bikes: 2, components: 2, rides: 3, services: 1, rules: 1, tracks: 1 });
    const bikes = (await c.B.get('/api/bikes')).body;
    assert.deepEqual(bikes.map((b) => b.name).sort(), ['City, "old" one', 'Gravel']);
    const gravel = bikes.find((b) => b.name === 'Gravel');
    assert.equal(gravel.totalKm > 40, true);
    const tyre = (await c.B.get('/api/components')).body.find((x) => x.type === 'TYRE_REAR');
    const detail = (await c.B.get(`/api/components/${tyre.id}`)).body;
    assert.equal(detail.mounts.length, 2);
    assert.equal(detail.bikeName, 'Gravel');
    const chain = (await c.B.get('/api/components')).body.find((x) => x.type === 'CHAIN');
    const svc = (await c.B.get('/api/services')).body[0];
    assert.equal(svc.componentId, chain.id); // re-linked to the new copy
    const routes = (await c.B.get('/api/rides/routes')).body;
    assert.equal(routes.length, 1);
    assert.equal(routes[0].title, 'With route');
    const rules = (await c.B.get('/api/maintenance/rules')).body;
    assert.equal(rules[0].componentId, chain.id);
    // the original account is untouched
    assert.equal((await c.A.get('/api/bikes')).body.length, 2);
  });
  test('wear is identical after a round trip', async () => {
    const before = (await c.A.get('/api/components')).body.map((x) => [x.type, x.wearKm]).sort();
    const after = (await c.B.get('/api/components')).body.map((x) => [x.type, x.wearKm]).sort();
    assert.deepEqual(after, before);
  });
  test('importing twice adds the data twice (nothing is merged)', async () => {
    const file = parse(await c.A.get('/api/data/export'));
    await upload(c.A, file);
    assert.equal((await c.A.get('/api/bikes')).body.length, 4);
  });
  test('input problems are 400s and nothing is saved', async () => {
    const bikesBefore = (await c.B.get('/api/bikes')).body.length;
    assert.equal((await c.B.post('/api/data/import')).status, 400); // no file
    assert.equal((await upload(c.B, 'not json {')).status, 400);
    assert.equal((await upload(c.B, { app: 'Other', version: 1, bikes: [] })).status, 400);
    assert.equal((await upload(c.B, { app: 'BikeLedger', version: 2, bikes: [] })).status, 400);
    assert.equal((await upload(c.B, { app: 'BikeLedger', version: 1 })).status, 400); // no bikes list
    const ok = { app: 'BikeLedger', version: 1, bikes: [{ id: 1, name: 'B', type: 'ROAD' }] };
    const badBike = await upload(c.B, { ...ok, bikes: [{ id: 1, name: '', type: 'ROAD' }] });
    assert.equal(badBike.status, 400);
    assert.ok(badBike.body.details.some((d) => d.field.startsWith('bikes')));
    assert.equal((await upload(c.B, { ...ok, rides: [{ id: 1, bikeId: 1, date: '2025-01-01', distanceKm: 0 }] })).status, 400);
    assert.equal((await c.B.get('/api/bikes')).body.length, bikesBefore);
  });
  test('references to things that are not in the file are rejected as a whole', async () => {
    const bikesBefore = (await c.B.get('/api/bikes')).body.length;
    const ok = { app: 'BikeLedger', version: 1, bikes: [{ id: 1, name: 'B', type: 'ROAD' }] };
    const cases = [
      { rides: [{ id: 1, bikeId: 99, date: '2025-01-01', distanceKm: 5 }] },
      { components: [{ id: 1, bikeId: 99, type: 'CHAIN', installedAt: '2025-01-01', maxKm: 100 }] },
      { components: [{ id: 1, bikeId: 1, type: 'CHAIN', installedAt: '2025-01-01', maxKm: 100, mounts: [{ bikeId: 99, fromDate: '2025-01-01' }] }] },
      { services: [{ bikeId: 1, componentId: 5, date: '2025-01-01', type: 'CLEAN' }] },
      { rules: [{ bikeId: 1, componentId: 5, title: 'x', serviceType: 'CLEAN', everyKm: 5 }] },
      { tracks: [{ rideId: 7, points: [[1, 1], [2, 2]] }] },
    ];
    for (const extra of cases) {
      const r = await upload(c.B, { ...ok, ...extra });
      assert.equal(r.status, 400, JSON.stringify(extra));
      assert.match(r.body.error, /not in it/);
    }
    assert.equal((await c.B.get('/api/bikes')).body.length, bikesBefore);
  });
  test('a database rule violation in the middle rolls everything back', async () => {
    const before = (await c.B.get('/api/bikes')).body.length;
    const file = { app: 'BikeLedger', version: 1, bikes: [{ id: 1, name: 'Will vanish', type: 'ROAD' }],
      components: [{ id: 1, bikeId: 1, type: 'CHAIN', installedAt: '2025-01-01', maxKm: 100, mounts: [{ bikeId: 1, fromDate: '2025-05-01', toDate: '2025-01-01' }] }] };
    assert.equal((await upload(c.B, file)).status, 400);
    assert.equal((await c.B.get('/api/bikes')).body.length, before);
  });
  test('defaults: a part without a limit gets the default for its type, a part without mounts gets one', async () => {
    const file = { app: 'BikeLedger', version: 1, bikes: [{ id: 1, name: 'Minimal', type: 'ROAD' }], components: [{ id: 1, bikeId: 1, type: 'CASSETTE', installedAt: '2025-01-01' }] };
    assert.equal((await upload(c.B, file)).status, 201);
    const part = (await c.B.get('/api/components')).body.find((x) => x.bikeName === 'Minimal');
    assert.equal(part.maxKm, 12000);
    assert.equal((await c.B.get(`/api/components/${part.id}`)).body.mounts.length, 1);
  });
  test('files over 30 MB are rejected', async () => {
    const r = await c.B.post('/api/data/import').attach('file', Buffer.alloc(30 * 1024 * 1024 + 1024, 'a'), 'big.json');
    assert.equal(r.status, 413);
  });
  test('a large import (thousands of rides) works in one go', async () => {
    const rides = Array.from({ length: 3500 }, (_, i) => ({ id: i + 1, bikeId: 1, date: new Date(Date.UTC(2020, 0, 1) + i * 86400000).toISOString(), distanceKm: 10 + (i % 5), source: 'MANUAL' }));
    const r = await upload(c.B, { app: 'BikeLedger', version: 1, bikes: [{ id: 1, name: 'Bulk', type: 'ROAD' }], rides });
    assert.equal(r.status, 201);
    assert.equal(r.body.imported.rides, 3500);
    const bulk = (await c.B.get('/api/bikes')).body.find((b) => b.name === 'Bulk');
    assert.equal(bulk.rideCount, 3500);
  });
});
