// Shared setup for the integration tests: two users (A and B) on the real database, and small factories.
const request = require('supertest');
const { createApp } = require('../src/app');
const { migrate } = require('../src/db/migrate');
const { pool } = require('../src/db/pool');

async function setup(prefix) {
  await migrate({ log: () => {} });
  const app = createApp();
  const run = `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const emailA = `a-${run}@test.dev`;
  const emailB = `b-${run}@test.dev`;
  const reg = (name, email) => request(app).post('/api/auth/register').send({ name, email, password: 'password-test' });
  const [ra, rb] = [await reg('Tester A', emailA), await reg('Tester B', emailB)];

  const as = (token) => ({
    get: (u) => request(app).get(u).set('Authorization', `Bearer ${token}`),
    post: (u) => request(app).post(u).set('Authorization', `Bearer ${token}`),
    put: (u) => request(app).put(u).set('Authorization', `Bearer ${token}`),
    delete: (u) => request(app).delete(u).set('Authorization', `Bearer ${token}`),
  });
  const A = as(ra.body.token);
  const B = as(rb.body.token);

  const mkBike = async (client = A, extra = {}) =>
    (await client.post('/api/bikes').send({ name: 'Test bike', type: 'GRAVEL', ...extra })).body;
  const mkRide = (bikeId, date, km, extra = {}) => A.post('/api/rides').send({ bikeId, date, distanceKm: km, ...extra });
  const mkComp = async (bikeId, extra = {}) =>
    (await A.post('/api/components').send({ bikeId, type: 'CHAIN', installedAt: '2024-01-01', maxKm: 1000, ...extra })).body;
  const mkService = async (bikeId, extra = {}) =>
    (await A.post('/api/services').send({ bikeId, date: '2024-06-01', type: 'CLEAN', ...extra })).body;

  const cleanup = async () => {
    await pool.query('DELETE FROM users WHERE email = ANY($1)', [[emailA, emailB]]);
    await pool.end();
  };

  return { app, A, B, tokenA: ra.body.token, tokenB: rb.body.token, emailA, emailB, userA: ra.body.user, mkBike, mkRide, mkComp, mkService, cleanup, pool };
}

// A minimal GPX with `n` points walking north, one every `stepSec` seconds
function gpxFile(n = 20, { name = 'Test ride', stepSec = 10, start = '2025-06-14T06:30:00Z', eleStep = 1 } = {}) {
  const t0 = Date.parse(start);
  const pts = Array.from({ length: n }, (_, i) =>
    `<trkpt lat="${(45.7 + i * 0.001).toFixed(6)}" lon="21.2"><ele>${(100 + i * eleStep).toFixed(1)}</ele><time>${new Date(t0 + i * stepSec * 1000).toISOString()}</time></trkpt>`
  ).join('');
  return Buffer.from(`<?xml version="1.0"?><gpx xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${name}</name><trkseg>${pts}</trkseg></trk></gpx>`);
}

module.exports = { setup, gpxFile, request };
