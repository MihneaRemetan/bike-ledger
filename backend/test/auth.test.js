const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const config = require('../src/lib/config');
const { setup, request } = require('./helpers');

let ctx;
before(async () => { ctx = await setup('auth'); });
after(() => ctx.cleanup());

describe('register', () => {
  test('creates the account, trims and lowercases the email, returns token and public user', async () => {
    const email = `  New.User-${Date.now()}@Test.DEV `;
    const r = await request(ctx.app).post('/api/auth/register').send({ name: '  Ana ', email, password: 'longenough1' });
    assert.equal(r.status, 201);
    assert.ok(r.body.token);
    assert.equal(r.body.user.email, email.trim().toLowerCase());
    assert.equal(r.body.user.name, 'Ana');
    assert.deepEqual(Object.keys(r.body.user).sort(), ['createdAt', 'email', 'id', 'name']);
    await ctx.pool.query('DELETE FROM users WHERE email = $1', [r.body.user.email]);
  });
  test('rejects invalid input with field details', async () => {
    const cases = [
      [{ name: '', email: 'a@b.co', password: 'longenough1' }, 'name'],
      [{ name: 'X', email: 'not-an-email', password: 'longenough1' }, 'email'],
      [{ name: 'X', email: 'a@b.co', password: 'short' }, 'password'],
      [{ name: 'X', email: 'a@b.co', password: 'x'.repeat(129) }, 'password'],
      [{ name: 'x'.repeat(81), email: 'a@b.co', password: 'longenough1' }, 'name'],
      [{}, 'name'],
    ];
    for (const [body, field] of cases) {
      const r = await request(ctx.app).post('/api/auth/register').send(body);
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.ok(r.body.details.some((d) => d.field === field), `${field} missing in ${JSON.stringify(r.body.details)}`);
    }
  });
  test('duplicate email (any casing) -> 409 with a clear message', async () => {
    const r = await request(ctx.app).post('/api/auth/register').send({ name: 'Dup', email: ctx.emailA.toUpperCase(), password: 'longenough1' });
    assert.equal(r.status, 409);
    assert.match(r.body.error, /already registered/i);
  });
});

describe('login and sessions', () => {
  test('success returns a JWT valid for 7 days whose subject is the user id', async () => {
    const r = await request(ctx.app).post('/api/auth/login').send({ email: ctx.emailA, password: 'password-test' });
    assert.equal(r.status, 200);
    const payload = jwt.verify(r.body.token, config.jwtSecret);
    assert.equal(payload.sub, String(ctx.userA.id));
    assert.equal(payload.exp - payload.iat, 7 * 24 * 3600);
  });
  test('wrong password and unknown email give the same 401', async () => {
    const wrong = await request(ctx.app).post('/api/auth/login').send({ email: ctx.emailA, password: 'nope-nope-1' });
    const unknown = await request(ctx.app).post('/api/auth/login').send({ email: 'nobody@test.dev', password: 'nope-nope-1' });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.equal(wrong.body.error, unknown.body.error);
  });
  test('missing fields -> 400', async () => {
    assert.equal((await request(ctx.app).post('/api/auth/login').send({})).status, 400);
    assert.equal((await request(ctx.app).post('/api/auth/login').send({ email: ctx.emailA })).status, 400);
  });
  test('GET /auth/me returns the current user and never the password hash', async () => {
    const r = await ctx.A.get('/api/auth/me');
    assert.equal(r.status, 200);
    assert.equal(r.body.email, ctx.emailA);
    assert.equal('password' in r.body, false);
  });
});

describe('token validation', () => {
  const get = (auth) => request(ctx.app).get('/api/bikes').set('Authorization', auth);
  test('missing, malformed and non-bearer headers -> 401', async () => {
    assert.equal((await request(ctx.app).get('/api/bikes')).status, 401);
    assert.equal((await get('Bearer')).status, 401);
    assert.equal((await get('Basic abc')).status, 401);
    assert.equal((await get('Bearer not.a.jwt')).status, 401);
  });
  test('expired token and token signed with another secret -> 401', async () => {
    const expired = jwt.sign({ sub: String(ctx.userA.id) }, config.jwtSecret, { expiresIn: -10 });
    const forged = jwt.sign({ sub: String(ctx.userA.id) }, 'some-other-secret');
    assert.equal((await get(`Bearer ${expired}`)).status, 401);
    assert.equal((await get(`Bearer ${forged}`)).status, 401);
  });
  test('a valid token of a deleted user is rejected by /auth/me', async () => {
    const email = `gone-${Date.now()}@test.dev`;
    const reg = await request(ctx.app).post('/api/auth/register').send({ name: 'Gone', email, password: 'longenough1' });
    await ctx.pool.query('DELETE FROM users WHERE email = $1', [email]);
    const r = await request(ctx.app).get('/api/auth/me').set('Authorization', `Bearer ${reg.body.token}`);
    assert.equal(r.status, 401);
  });
  test('every data route requires a token', async () => {
    for (const path of ['/api/bikes', '/api/components', '/api/rides', '/api/rides/routes', '/api/services', '/api/stats/dashboard', '/api/places/bike-shops?lat=1&lon=1', '/api/components/defaults']) {
      assert.equal((await request(ctx.app).get(path)).status, 401, path);
    }
  });
});
