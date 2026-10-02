// Pure unit tests: no database needed.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { decorate, DEFAULT_MAX_KM, WEAR_SELECT } = require('../src/lib/wear');
const schemas = require('../src/lib/schemas');
const { HttpError, ah, parseId } = require('../src/lib/http');
const { buildUpdate } = require('../src/db/pool');
const { errorHandler, notFound } = require('../src/middleware/error');
const { requireAuth, signToken } = require('../src/middleware/auth');
const { haversineKm, elevationGain, simplifyRoute, parseActivityFile, parseGpx } = require('../src/lib/gpx');

describe('wear.decorate', () => {
  const row = (wearKm, maxKm = 1000, retiredAt = null) => ({ wearKm, maxKm, retiredAt });
  test('status thresholds', () => {
    assert.equal(decorate(row(799)).status, 'OK');
    assert.equal(decorate(row(800)).status, 'WARN');
    assert.equal(decorate(row(999)).status, 'WARN');
    assert.equal(decorate(row(1000)).status, 'REPLACE');
    assert.equal(decorate(row(5000)).status, 'REPLACE');
    assert.equal(decorate(row(5000, 1000, '2025-01-01')).status, 'RETIRED');
  });
  test('status uses the percentage rounded to 0.1%, as in the specification', () => {
    assert.equal(decorate(row(799.4)).status, 'OK'); // 79.94% -> 0.799
    assert.equal(decorate(row(799.5)).status, 'WARN'); // 79.95% -> 0.8
    assert.equal(decorate(row(999.4)).status, 'WARN');
    assert.equal(decorate(row(999.5)).status, 'REPLACE'); // 99.95% -> 1
  });
  test('rounding, percentages and remaining km never go negative', () => {
    const d = decorate(row(333.333, 1000));
    assert.deepEqual([d.wearKm, d.wearPct, d.remainingKm], [333.3, 0.333, 666.7]);
    assert.equal(decorate(row(1500)).remainingKm, 0);
    assert.equal(decorate(row(0)).wearPct, 0);
  });
  test('keeps the other fields untouched and exposes the defaults and SQL', () => {
    assert.equal(decorate({ ...row(1), id: 7, brand: 'X' }).id, 7);
    assert.equal(DEFAULT_MAX_KM.CHAIN, 4000);
    assert.match(WEAR_SELECT, /wear_km/);
  });
});

describe('schemas', () => {
  test('bike: trims, coerces and turns "" into null while leaving undefined alone', () => {
    const r = schemas.bike.parse({ name: ' A ', type: 'ROAD', year: '2020', brand: '', notes: undefined });
    assert.deepEqual([r.name, r.year, r.brand, r.notes], ['A', 2020, null, undefined]);
  });
  test('partial updates do not apply defaults', () => {
    assert.deepEqual(schemas.componentUpdate.parse({}), {});
    assert.equal(schemas.component.parse({ bikeId: '1', type: 'CHAIN', installedAt: '2024-01-01' }).initialKm, 0);
  });
  test('component: retiredAt before installedAt is a field error', () => {
    const r = schemas.component.safeParse({ bikeId: 1, type: 'CHAIN', installedAt: '2024-05-01', retiredAt: '2024-01-01' });
    assert.equal(r.success, false);
    assert.deepEqual(r.error.issues[0].path, ['retiredAt']);
  });
  test('ride: dates with and without time, numbers as strings', () => {
    const r = schemas.ride.parse({ bikeId: '3', date: '2025-05-01', distanceKm: '12.5', durationMin: '' });
    assert.ok(r.date instanceof Date);
    assert.deepEqual([r.bikeId, r.distanceKm, r.durationMin], [3, 12.5, null]);
    assert.equal(schemas.ride.safeParse({ bikeId: 1, date: '', distanceKm: 1 }).success, false);
    assert.equal(schemas.ride.safeParse({ bikeId: 1, date: null, distanceKm: 1 }).success, false);
  });
  test('list query: limit defaults to 200, is capped at 500', () => {
    assert.equal(schemas.listQuery.parse({}).limit, 200);
    assert.equal(schemas.listQuery.parse({ limit: '50' }).limit, 50);
    assert.equal(schemas.listQuery.safeParse({ limit: '501' }).success, false);
    assert.equal(schemas.listQuery.parse({ from: '' }).from, null);
  });
  test('login and register normalise the email', () => {
    assert.equal(schemas.login.parse({ email: ' A@B.CO ', password: 'x' }).email, 'a@b.co');
    assert.equal(schemas.register.parse({ name: 'N', email: 'A@B.CO', password: '12345678' }).email, 'a@b.co');
  });
  test('service: replacement is optional and validated', () => {
    const base = { bikeId: 1, date: '2025-01-01', type: 'REPLACE', componentId: 2 };
    assert.equal(schemas.service.parse(base).replacement, undefined);
    assert.equal(schemas.service.parse({ ...base, replacement: { brand: 'x', maxKm: '' } }).replacement.maxKm, null);
    assert.equal(schemas.service.safeParse({ ...base, replacement: { maxKm: -1 } }).success, false);
  });
});

describe('http helpers', () => {
  test('parseId accepts positive integers only', () => {
    assert.equal(parseId('12'), 12);
    for (const bad of ['0', '-1', '1.5', 'abc', '', undefined]) assert.throws(() => parseId(bad), (e) => e instanceof HttpError && e.status === 400, String(bad));
  });
  test('ah forwards async errors to next()', async () => {
    const err = new Error('boom');
    let got;
    await ah(async () => { throw err; })({}, {}, (e) => { got = e; });
    assert.equal(got, err);
  });
  test('buildUpdate only uses whitelisted fields, skips undefined, keeps null, converts to snake_case', () => {
    const { sets, values } = buildUpdate({ maxKm: 5, brand: null, evil: 'x; DROP TABLE users', retiredAt: undefined }, ['maxKm', 'brand', 'retiredAt'], 3);
    assert.deepEqual(sets, ['max_km = $3', 'brand = $4']);
    assert.deepEqual(values, [5, null]);
  });
});

describe('middleware', () => {
  const res = () => {
    const r = { code: null, body: null };
    r.status = (s) => { r.code = s; return r; };
    r.json = (b) => { r.body = b; return r; };
    return r;
  };
  test('errorHandler maps known errors to status codes', () => {
    const cases = [
      [new HttpError(418, 'teapot'), 418, 'teapot'], [{ type: 'entity.parse.failed' }, 400, 'Malformed JSON body'],
      [{ code: 'LIMIT_FILE_SIZE' }, 413], [{ name: 'MulterError', message: 'Unexpected field' }, 400, 'Unexpected field'],
      [{ code: '23505' }, 409], [{ code: '23514' }, 400], [{ code: '23503' }, 400], [{ code: '22P02' }, 400],
    ];
    for (const [err, code, msg] of cases) {
      const r = res();
      errorHandler(err, {}, r, () => {});
      assert.equal(r.code, code, JSON.stringify(err));
      if (msg) assert.equal(r.body.error, msg);
    }
  });
  test('errorHandler hides unexpected errors behind a generic 500', (t) => {
    t.mock.method(console, 'error', () => {});
    const r = res();
    errorHandler(new Error('secret db detail'), {}, r, () => {});
    assert.equal(r.code, 500);
    assert.deepEqual(r.body, { error: 'Internal server error' });
  });
  test('zod errors become a field list', () => {
    const r = res();
    const parsed = schemas.bike.safeParse({});
    errorHandler(parsed.error, {}, r, () => {});
    assert.equal(r.code, 400);
    assert.equal(r.body.error, 'Validation failed');
    assert.ok(r.body.details.every((d) => d.field && d.message));
  });
  test('notFound answers 404', () => {
    const r = res();
    notFound({}, r);
    assert.equal(r.code, 404);
  });
  test('requireAuth sets req.userId from a valid token and rejects everything else', () => {
    const req = { headers: { authorization: `Bearer ${signToken(42)}` } };
    let err = 'unset';
    requireAuth(req, {}, (e) => { err = e; });
    assert.equal(err, undefined);
    assert.equal(req.userId, 42);
    requireAuth({ headers: {} }, {}, (e) => { err = e; });
    assert.equal(err.status, 401);
  });
});

describe('gpx helpers', () => {
  test('haversine is symmetric, zero for equal points and ~111.2 km per degree of latitude', () => {
    const a = { lat: 45, lon: 21 };
    const b = { lat: 46, lon: 21 };
    assert.equal(haversineKm(a, a), 0);
    assert.equal(haversineKm(a, b), haversineKm(b, a));
    assert.ok(Math.abs(haversineKm(a, b) - 111.19) < 0.05);
  });
  test('elevation gain: threshold, climbs after descents, missing data', () => {
    assert.equal(elevationGain([100, 101, 102, 101]), 0);
    assert.equal(elevationGain([100, 110, 100, 110]), 20);
    assert.equal(elevationGain([100]), null);
    assert.equal(elevationGain([NaN, NaN]), null);
    assert.equal(elevationGain([100, NaN, 110]), 10);
  });
  test('simplifyRoute keeps ends and corners, drops collinear points, rounds to 5 decimals, caps the size', () => {
    const line = Array.from({ length: 50 }, (_, i) => ({ lat: 45 + i * 0.001, lon: 21 }));
    const simple = simplifyRoute(line);
    assert.deepEqual(simple, [[45, 21], [45.049, 21]]);
    const corner = [...line, ...Array.from({ length: 50 }, (_, i) => ({ lat: 45.049, lon: 21 + (i + 1) * 0.001 }))];
    const withCorner = simplifyRoute(corner);
    assert.equal(withCorner.length, 3);
    assert.deepEqual(withCorner[1], [45.049, 21]);
    const zigzag = Array.from({ length: 5000 }, (_, i) => ({ lat: 45 + (i % 2) * 0.01, lon: 21 + i * 0.0001 }));
    assert.ok(simplifyRoute(zigzag).length <= 1201);
    assert.deepEqual(simplifyRoute([{ lat: 1.123456789, lon: 2 }]), [[1.12346, 2]]);
  });
  test('parse errors are 400s with clear messages', () => {
    const gpx = (body) => Buffer.from(`<gpx xmlns="http://www.topografix.com/GPX/1/1">${body}</gpx>`);
    assert.throws(() => parseActivityFile(Buffer.from('<<<')), /Invalid XML/);
    assert.throws(() => parseActivityFile(Buffer.from('<root/>')), /Not a GPX or TCX/);
    assert.throws(() => parseActivityFile(gpx('<trk><trkseg><trkpt lat="1" lon="1"/></trkseg></trk>')), /at least 2/);
    assert.throws(() => parseActivityFile(gpx('<trk><trkseg><trkpt lat="1" lon="1"/><trkpt lat="1" lon="1"/></trkseg></trk>')), /zero distance/);
    assert.throws(() => parseActivityFile(Buffer.from([0x1f, 0x8b, 0, 0])), /decompress/);
    assert.throws(() => parseActivityFile(gpx('<trk><trkseg><trkpt lat="x" lon="y"/><trkpt lat="1" lon="1"/></trkseg></trk>')), /at least 2/);
  });
  test('title and date fall back sensibly; a gzipped file works; parseGpx omits the route', () => {
    const body = '<trkseg><trkpt lat="45" lon="21"/><trkpt lat="45.01" lon="21"/></trkseg>';
    const noMeta = parseActivityFile(Buffer.from(`<gpx><trk>${body}</trk></gpx>`), 'Sunday ride.gpx');
    assert.equal(noMeta.title, 'Sunday ride');
    assert.ok(Math.abs(Date.now() - Date.parse(noMeta.date)) < 5000); // no time anywhere: now
    const meta = parseActivityFile(Buffer.from(`<gpx><metadata><name>M</name><time>2020-01-02T03:04:05Z</time></metadata><trk>${body}</trk></gpx>`), 'f.gpx');
    assert.deepEqual([meta.title, meta.date], ['M', '2020-01-02T03:04:05.000Z']);
    assert.equal(parseActivityFile(zlib.gzipSync(Buffer.from(`<gpx><trk>${body}</trk></gpx>`)), 'a.gpx.gz').title, 'a');
    assert.equal('route' in parseGpx(Buffer.from(`<gpx><trk>${body}</trk></gpx>`), 'f.gpx'), false);
  });
});
