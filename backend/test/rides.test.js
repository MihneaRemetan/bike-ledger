const zlib = require('node:zlib');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, gpxFile } = require('./helpers');

let c;
before(async () => { c = await setup('rides'); });
after(() => c.cleanup());

describe('rides: create and validate', () => {
  test('returns the ride with bike name, source MANUAL and no route', async () => {
    const bike = await c.mkBike(c.A, { name: 'Ride bike' });
    const r = await c.mkRide(bike.id, '2025-05-01T08:30:00Z', 42.5, { title: 'Morning', durationMin: 90, elevationM: 300, notes: 'ok' });
    assert.equal(r.status, 201);
    assert.deepEqual([r.body.bikeName, r.body.source, r.body.hasRoute, r.body.distanceKm, r.body.durationMin, r.body.elevationM], ['Ride bike', 'MANUAL', false, 42.5, 90, 300]);
  });
  test('accepts a date without time and form-style strings', async () => {
    const bike = await c.mkBike();
    const r = await c.A.post('/api/rides').send({ bikeId: String(bike.id), date: '2025-05-02', distanceKm: '12.3', durationMin: '', elevationM: '', title: '' });
    assert.equal(r.status, 201);
    assert.deepEqual([r.body.distanceKm, r.body.durationMin, r.body.elevationM, r.body.title], [12.3, null, null, null]);
    assert.ok(r.body.date.startsWith('2025-05-02'));
  });
  test('rejects missing and out-of-range values with field details', async () => {
    const bike = await c.mkBike();
    const base = { bikeId: bike.id, date: '2025-05-01', distanceKm: 10 };
    const bad = [
      [{ ...base, date: undefined }, 'date'], [{ ...base, date: 'yesterday' }, 'date'], [{ ...base, distanceKm: undefined }, 'distanceKm'],
      [{ ...base, distanceKm: 0 }, 'distanceKm'], [{ ...base, distanceKm: -3 }, 'distanceKm'], [{ ...base, distanceKm: 2001 }, 'distanceKm'],
      [{ ...base, distanceKm: 'abc' }, 'distanceKm'], [{ ...base, durationMin: -1 }, 'durationMin'], [{ ...base, durationMin: 2881 }, 'durationMin'],
      [{ ...base, durationMin: 1.5 }, 'durationMin'], [{ ...base, elevationM: -1 }, 'elevationM'], [{ ...base, elevationM: 20001 }, 'elevationM'],
      [{ ...base, title: 't'.repeat(121) }, 'title'], [{ ...base, bikeId: undefined }, 'bikeId'],
    ];
    for (const [body, field] of bad) {
      const r = await c.A.post('/api/rides').send(body);
      assert.equal(r.status, 400, field);
      assert.ok(r.body.details.some((d) => d.field === field), `${field}: ${JSON.stringify(r.body.details)}`);
    }
  });
});

describe('rides: list, filters and detail', () => {
  test('newest first, filter by bike and date range (inclusive), limit', async () => {
    const b1 = await c.mkBike();
    const b2 = await c.mkBike();
    for (const [d, km] of [['2025-02-01T08:00:00Z', 1], ['2025-02-15T08:00:00Z', 2], ['2025-03-01T23:30:00Z', 3]]) await c.mkRide(b1.id, d, km);
    await c.mkRide(b2.id, '2025-02-10T08:00:00Z', 9);
    const kms = async (qs) => (await c.A.get(`/api/rides?bikeId=${b1.id}${qs}`)).body.map((r) => r.distanceKm);
    assert.deepEqual(await kms(''), [3, 2, 1]);
    assert.deepEqual(await kms('&from=2025-02-15'), [3, 2]);
    assert.deepEqual(await kms('&to=2025-02-15'), [2, 1]);
    assert.deepEqual(await kms('&from=2025-02-15&to=2025-03-01'), [3, 2]);
    assert.deepEqual(await kms('&limit=1'), [3]);
    const both = (await c.A.get('/api/rides?from=2025-02-10&to=2025-02-10')).body;
    assert.ok(both.some((r) => r.distanceKm === 9));
    assert.ok(both.every((r) => r.bikeName));
  });
  test('invalid filters -> 400, other users see nothing', async () => {
    assert.equal((await c.A.get('/api/rides?from=2025/01/01')).status, 400);
    assert.equal((await c.A.get('/api/rides?limit=501')).status, 400);
    assert.equal((await c.A.get('/api/rides?bikeId=abc')).status, 400);
    const bike = await c.mkBike();
    await c.mkRide(bike.id, '2025-01-01T08:00:00Z', 5);
    assert.equal((await c.B.get(`/api/rides?bikeId=${bike.id}`)).body.length, 0);
  });
  test('detail, invalid and unknown ids', async () => {
    const ride = (await c.mkRide((await c.mkBike()).id, '2025-01-01T08:00:00Z', 5)).body;
    assert.equal((await c.A.get(`/api/rides/${ride.id}`)).body.id, ride.id);
    assert.equal((await c.A.get('/api/rides/abc')).status, 400);
    assert.equal((await c.A.get('/api/rides/99999999')).status, 404);
  });
});

describe('rides: update and delete', () => {
  test('partial update, clearing optional fields, validation', async () => {
    const ride = (await c.mkRide((await c.mkBike()).id, '2025-01-01T08:00:00Z', 5, { title: 'Old', elevationM: 100 })).body;
    const r = await c.A.put(`/api/rides/${ride.id}`).send({ title: '', elevationM: '', distanceKm: '6.5', date: '2025-01-02T10:00:00Z' });
    assert.equal(r.status, 200);
    assert.deepEqual([r.body.title, r.body.elevationM, r.body.distanceKm], [null, null, 6.5]);
    assert.ok(r.body.date.startsWith('2025-01-02T10:00'));
    assert.equal((await c.A.put(`/api/rides/${ride.id}`).send({ distanceKm: 0 })).status, 400);
    assert.equal((await c.A.put(`/api/rides/${ride.id}`).send({})).status, 200);
  });
  test('moving a ride moves its km from one bike to the other, only to own bikes', async () => {
    const b1 = await c.mkBike();
    const b2 = await c.mkBike();
    const foreign = await c.mkBike(c.B);
    const comp1 = await c.mkComp(b1.id);
    const comp2 = await c.mkComp(b2.id);
    const ride = (await c.mkRide(b1.id, '2024-02-01T08:00:00Z', 100)).body;
    assert.equal((await c.A.get(`/api/components/${comp1.id}`)).body.wearKm, 100);
    await c.A.put(`/api/rides/${ride.id}`).send({ bikeId: b2.id });
    assert.equal((await c.A.get(`/api/components/${comp1.id}`)).body.wearKm, 0);
    assert.equal((await c.A.get(`/api/components/${comp2.id}`)).body.wearKm, 100);
    assert.equal((await c.A.put(`/api/rides/${ride.id}`).send({ bikeId: foreign.id })).status, 404);
  });
  test('delete returns 204 once, then 404; other users cannot delete', async () => {
    const ride = (await c.mkRide((await c.mkBike()).id, '2025-01-01T08:00:00Z', 5)).body;
    assert.equal((await c.B.delete(`/api/rides/${ride.id}`)).status, 404);
    assert.equal((await c.A.delete(`/api/rides/${ride.id}`)).status, 204);
    assert.equal((await c.A.delete(`/api/rides/${ride.id}`)).status, 404);
  });
});

describe('rides: file import', () => {
  const attach = (client, bikeId, file, name = 'ride.gpx', extra = {}) => {
    let req = client.post('/api/rides/import-gpx');
    if (bikeId !== undefined) req = req.field('bikeId', bikeId);
    for (const [k, v] of Object.entries(extra)) req = req.field(k, v);
    return file ? req.attach('file', file, name) : req;
  };

  test('imports a GPX: values, GPX source, route stored, wear updated', async () => {
    const bike = await c.mkBike();
    const comp = await c.mkComp(bike.id, { installedAt: '2025-01-01' });
    const r = await attach(c.A, bike.id, gpxFile(30, { name: 'Imported' }), 'x.gpx');
    assert.equal(r.status, 201);
    assert.deepEqual([r.body.title, r.body.source, r.body.hasRoute], ['Imported', 'GPX', true]);
    assert.ok(r.body.distanceKm > 3 && r.body.distanceKm < 4);
    assert.ok(r.body.date.startsWith('2025-06-14T06:30'));
    assert.ok((await c.A.get(`/api/components/${comp.id}`)).body.wearKm > 3);
  });
  test('imports TCX and gzipped files', async () => {
    const bike = await c.mkBike();
    const tcx = Buffer.from('<TrainingCenterDatabase><Activities><Activity><Lap><Track><Trackpoint><Time>2025-07-01T08:00:00Z</Time><Position><LatitudeDegrees>45</LatitudeDegrees><LongitudeDegrees>25</LongitudeDegrees></Position></Trackpoint><Trackpoint><Time>2025-07-01T08:10:00Z</Time><Position><LatitudeDegrees>45.02</LatitudeDegrees><LongitudeDegrees>25</LongitudeDegrees></Position></Trackpoint></Track></Lap></Activity></Activities></TrainingCenterDatabase>');
    assert.equal((await attach(c.A, bike.id, tcx, 'a.tcx')).status, 201);
    assert.equal((await attach(c.A, bike.id, zlib.gzipSync(gpxFile(10)), 'a.gpx.gz')).status, 201);
    assert.equal((await c.A.get(`/api/rides?bikeId=${bike.id}`)).body.length, 2);
  });
  test('input errors: no file, no bike, bad bike id, garbage, other user bike', async () => {
    const bike = await c.mkBike();
    assert.equal((await attach(c.A, bike.id, null)).status, 400);
    assert.equal((await attach(c.A, undefined, gpxFile())).status, 400);
    assert.equal((await attach(c.A, 'abc', gpxFile())).status, 400);
    assert.equal((await attach(c.A, bike.id, Buffer.from('not xml at all'))).status, 400);
    assert.equal((await attach(c.A, bike.id, Buffer.from('<html/>'))).status, 400);
    assert.equal((await attach(c.A, bike.id, Buffer.from([0x1f, 0x8b, 1, 2, 3]))).status, 400); // fake gzip
    assert.equal((await attach(c.B, bike.id, gpxFile())).status, 404);
    assert.equal((await c.A.get(`/api/rides?bikeId=${bike.id}`)).body.length, 0);
  });
  test('files over 15 MB are rejected with 413', async () => {
    const bike = await c.mkBike();
    const r = await attach(c.A, bike.id, Buffer.alloc(15 * 1024 * 1024 + 1024, 'a'));
    assert.equal(r.status, 413);
  });
  test('preview computes values without saving anything', async () => {
    const bike = await c.mkBike();
    const r = await attach(c.A, bike.id, gpxFile(15), 'p.gpx', { preview: 'true' });
    assert.equal(r.status, 200);
    assert.ok(r.body.distanceKm > 0 && r.body.routePoints >= 2);
    assert.equal((await c.A.get(`/api/rides?bikeId=${bike.id}`)).body.length, 0);
  });
});

describe('rides: routes for the map', () => {
  test('only rides with a track, filtered by bike and dates, limited, with points', async () => {
    const b1 = await c.mkBike();
    const b2 = await c.mkBike();
    const imp = (bike, start) => c.A.post('/api/rides/import-gpx').field('bikeId', bike.id).attach('file', gpxFile(12, { start }), 'r.gpx');
    const r1 = (await imp(b1, '2025-03-01T08:00:00Z')).body;
    const r2 = (await imp(b1, '2025-04-01T08:00:00Z')).body;
    await imp(b2, '2025-03-15T08:00:00Z');
    await c.mkRide(b1.id, '2025-03-20T08:00:00Z', 10); // manual: no track
    const ids = async (qs) => (await c.A.get(`/api/rides/routes?${qs}`)).body.map((r) => r.id);
    assert.deepEqual(await ids(`bikeId=${b1.id}`), [r2.id, r1.id]);
    assert.deepEqual(await ids(`bikeId=${b1.id}&from=2025-03-15`), [r2.id]);
    assert.deepEqual(await ids(`bikeId=${b1.id}&to=2025-03-15`), [r1.id]);
    assert.deepEqual(await ids(`bikeId=${b1.id}&limit=1`), [r2.id]);
    const first = (await c.A.get(`/api/rides/routes?bikeId=${b1.id}&limit=1`)).body[0];
    assert.deepEqual(Object.keys(first).sort(), ['bikeId', 'bikeName', 'date', 'distanceKm', 'id', 'points', 'title']);
    assert.equal((await c.A.get('/api/rides/routes?from=bad')).status, 400);
  });
});
