// Database layer, configuration, API documentation and demo data.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { createApp } = require('../src/app');
const { migrate } = require('../src/db/migrate');
const { pool, query, one, transaction } = require('../src/db/pool');
const openapi = require('../src/openapi');
const { haversineKm } = require('../src/lib/gpx');

const root = path.join(__dirname, '..');
after(() => pool.end());
before(() => migrate({ log: () => {} }));

describe('database layer', () => {
  test('migrate is idempotent and records every migration file once', async () => {
    const logs = [];
    await migrate({ log: (m) => logs.push(m) });
    await migrate({ log: (m) => logs.push(m) });
    assert.deepEqual(logs, []); // nothing left to apply
    const applied = (await query('SELECT name FROM schema_migrations ORDER BY name')).map((r) => r.name);
    const files = fs.readdirSync(path.join(root, 'src/db/migrations')).filter((f) => f.endsWith('.sql')).sort();
    assert.deepEqual(applied, files);
  });
  test('all tables, indexes and constraints exist', async () => {
    const tables = (await query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")).map((r) => r.tableName);
    for (const t of ['users', 'bikes', 'components', 'rides', 'services', 'ride_tracks', 'schema_migrations']) assert.ok(tables.includes(t), t);
    const idx = (await query("SELECT indexname FROM pg_indexes WHERE schemaname = 'public'")).map((r) => r.indexname);
    for (const i of ['bikes_user_idx', 'components_bike_idx', 'rides_bike_date_idx', 'services_bike_idx']) assert.ok(idx.includes(i), i);
  });
  test('query() returns camelCase keys, one() returns the first row or null', async () => {
    const r = await one('SELECT 1 AS some_value, now() AS created_at');
    assert.deepEqual(Object.keys(r), ['someValue', 'createdAt']);
    assert.equal(await one('SELECT 1 WHERE false'), null);
  });
  test('DATE columns come back as YYYY-MM-DD strings and COUNT as numbers', async () => {
    const r = await one("SELECT DATE '2025-03-04' AS d, COUNT(*)::int AS n FROM users");
    assert.equal(r.d, '2025-03-04');
    assert.equal(typeof r.n, 'number');
  });
  test('the session timezone is UTC', async () => {
    assert.equal((await one("SELECT current_setting('timezone') AS tz")).tz, 'UTC');
  });
  test('transaction commits on success and rolls back on error', async () => {
    const email = `tx-${Date.now()}@test.dev`;
    await transaction((client) => query("INSERT INTO users (name, email, password) VALUES ('t', $1, 'x')", [email], client));
    assert.equal((await query('SELECT 1 FROM users WHERE email = $1', [email])).length, 1);
    const email2 = `tx2-${Date.now()}@test.dev`;
    await assert.rejects(transaction(async (client) => {
      await query("INSERT INTO users (name, email, password) VALUES ('t', $1, 'x')", [email2], client);
      throw new Error('fail after insert');
    }), /fail after insert/);
    assert.equal((await query('SELECT 1 FROM users WHERE email = $1', [email2])).length, 0);
    await query('DELETE FROM users WHERE email = $1', [email]);
  });
  test('table constraints reject bad data even without the API', async () => {
    const u = await one("INSERT INTO users (name, email, password) VALUES ('c', $1, 'x') RETURNING id", [`c-${Date.now()}@test.dev`]);
    const bad = [
      ["INSERT INTO bikes (user_id, name, type) VALUES ($1, 'b', 'UNICYCLE')"],
      ["INSERT INTO bikes (user_id, name, type, year) VALUES ($1, 'b', 'ROAD', 1800)"],
    ];
    for (const [sql] of bad) await assert.rejects(pool.query(sql, [u.id]), (e) => e.code === '23514');
    const bike = await one("INSERT INTO bikes (user_id, name, type) VALUES ($1, 'b', 'ROAD') RETURNING id", [u.id]);
    await assert.rejects(pool.query("INSERT INTO rides (bike_id, date, distance_km) VALUES ($1, now(), 0)", [bike.id]), (e) => e.code === '23514');
    await assert.rejects(pool.query("INSERT INTO components (bike_id, type, installed_at, max_km, retired_at) VALUES ($1, 'CHAIN', '2025-02-01', 100, '2025-01-01')", [bike.id]), (e) => e.code === '23514');
    await assert.rejects(pool.query("INSERT INTO services (bike_id, date, type) VALUES (999999999, '2025-01-01', 'CLEAN')"), (e) => e.code === '23503');
    await assert.rejects(pool.query("INSERT INTO users (name, email, password) VALUES ('d', (SELECT email FROM users WHERE id = $1), 'x')", [u.id]), (e) => e.code === '23505');
    await pool.query('DELETE FROM users WHERE id = $1', [u.id]);
  });
});

describe('migrations: applying and failing', () => {
  const dir = path.join(root, 'src/db/migrations');
  test('a new migration file is applied once and recorded', async () => {
    const file = 'zzz_test_ok.sql';
    fs.writeFileSync(path.join(dir, file), 'CREATE TABLE tmp_migration_ok (id int);');
    try {
      const logs = [];
      await migrate({ log: (m) => logs.push(m) });
      assert.deepEqual(logs, [`migration applied: ${file}`]);
      assert.equal((await query("SELECT to_regclass('tmp_migration_ok') AS t"))[0].t, 'tmp_migration_ok');
      await migrate({ log: (m) => logs.push(m) });
      assert.equal(logs.length, 1);
    } finally {
      fs.unlinkSync(path.join(dir, file));
      await pool.query('DROP TABLE IF EXISTS tmp_migration_ok');
      await pool.query('DELETE FROM schema_migrations WHERE name = $1', [file]);
    }
  });
  test('a failing migration is rolled back completely, not recorded, and the error is thrown', async () => {
    const file = 'zzz_test_bad.sql';
    fs.writeFileSync(path.join(dir, file), 'CREATE TABLE tmp_migration_bad (id int); SELECT 1/0;');
    try {
      await assert.rejects(migrate({ log: () => {} }), /division by zero/);
      assert.equal((await query("SELECT to_regclass('tmp_migration_bad') AS t"))[0].t, null);
      assert.equal((await query('SELECT 1 FROM schema_migrations WHERE name = $1', [file])).length, 0);
    } finally {
      fs.unlinkSync(path.join(dir, file));
    }
    await migrate({ log: () => {} }); // the lock was released: later runs work
  });
  test('the CLI scripts exit 0 on success and 1 when the database is unreachable', () => {
    const env = { ...process.env };
    assert.equal(spawnSync(process.execPath, ['src/db/migrate.js'], { cwd: root, env, encoding: 'utf8' }).status, 0);
    const bad = { ...process.env, DATABASE_URL: 'postgresql://x:y@127.0.0.1:1/none' };
    assert.equal(spawnSync(process.execPath, ['src/db/migrate.js'], { cwd: root, env: bad, encoding: 'utf8' }).status, 1);
    assert.equal(spawnSync(process.execPath, ['src/db/seed.js'], { cwd: root, env: bad, encoding: 'utf8' }).status, 1);
  });
});

describe('server startup', () => {
  test('index.js migrates, listens on PORT and serves /api/health', async () => {
    const { spawn } = require('node:child_process');
    const port = 40000 + Math.floor(Math.random() * 20000);
    const child = spawn(process.execPath, ['src/index.js'], { cwd: root, env: { ...process.env, PORT: String(port) } });
    try {
      let res;
      for (let i = 0; i < 50 && !res; i++) {
        res = await fetch(`http://127.0.0.1:${port}/api/health`).catch(() => null);
        if (!res) await new Promise((r) => setTimeout(r, 100));
      }
      assert.ok(res, 'server did not start');
      assert.deepEqual(await res.json(), { status: 'ok' });
    } finally {
      child.kill();
    }
  });
});

describe('configuration', () => {
  const load = (env) =>
    spawnSync(process.execPath, ['-e', "const c = require('./src/lib/config'); console.log(JSON.stringify(c))"], {
      cwd: root, env: { PATH: process.env.PATH, ...env }, encoding: 'utf8',
    });
  test('production refuses to start without JWT_SECRET', () => {
    const r = load({ NODE_ENV: 'production' });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /JWT_SECRET must be set/);
  });
  test('production with a secret works and uses it', () => {
    const r = load({ NODE_ENV: 'production', JWT_SECRET: 'abc', PORT: '4000', DATABASE_URL: 'postgresql://x' });
    assert.equal(r.status, 0);
    const cfg = JSON.parse(r.stdout);
    assert.deepEqual([cfg.jwtSecret, cfg.port, cfg.databaseUrl, cfg.jwtExpiresIn], ['abc', 4000, 'postgresql://x', '7d']);
  });
  test('development has safe defaults', () => {
    const cfg = JSON.parse(load({}).stdout);
    assert.equal(cfg.env, 'development');
    assert.equal(cfg.port, 3000);
    assert.equal(cfg.maxGpxBytes, 15 * 1024 * 1024);
  });
});

describe('API documentation', () => {
  // Collect every route registered on the Express app, as "METHOD /api/path/{id}"
  function routesOf(app) {
    const out = [];
    const mountOf = (layer) => {
      const m = layer.regexp.source.match(/^\^\\\/(.+?)\\\/\?\(\?=\\\/\|\$\)$/);
      return m ? `/${m[1].replace(/\\\//g, '/')}` : '';
    };
    const walk = (stack, prefix) => {
      for (const layer of stack) {
        if (layer.route) {
          for (const method of Object.keys(layer.route.methods)) out.push(`${method.toUpperCase()} ${prefix}${layer.route.path}`.replace(/:(\w+)/g, '{$1}').replace(/\/$/, ''));
        } else if (layer.name === 'router' && layer.handle.stack) {
          walk(layer.handle.stack, prefix + mountOf(layer));
        }
      }
    };
    walk(app._router.stack, '');
    return out;
  }
  const documented = () => Object.entries(openapi.paths).flatMap(([p, ops]) => Object.keys(ops).map((m) => `${m.toUpperCase()} /api${p}`));

  test('every API route is documented in the OpenAPI spec and nothing extra is documented', () => {
    const real = routesOf(createApp()).filter((r) => r.includes('/api/') && !r.includes('/api/docs')).sort();
    assert.ok(real.length >= 25, `only found ${real.length} routes`);
    assert.deepEqual(documented().sort(), real);
  });
  test('spec basics: version, bearer auth, public routes marked, every schema reference resolves', () => {
    assert.equal(openapi.openapi, '3.0.3');
    assert.equal(openapi.components.securitySchemes.bearerAuth.scheme, 'bearer');
    for (const p of ['/auth/login', '/auth/register', '/health']) {
      const op = Object.values(openapi.paths[p])[0];
      assert.deepEqual(op.security, [], p);
    }
    assert.deepEqual(openapi.paths['/bikes'].get.security, [{ bearerAuth: [] }]);
    const refs = JSON.stringify(openapi).match(/#\/components\/schemas\/(\w+)/g) || [];
    for (const ref of refs) assert.ok(openapi.components.schemas[ref.split('/').pop()], ref);
  });
});

describe('demo data', () => {
  const routes = require('../src/db/demo-routes.json');
  test('demo routes are well formed and located around Timisoara', () => {
    assert.ok(routes.filter((r) => r.kind === 'gravel').length >= 6);
    assert.ok(routes.filter((r) => r.kind === 'commute').length >= 2);
    for (const r of routes) {
      assert.ok(r.name && ['gravel', 'commute'].includes(r.kind), r.name);
      assert.ok(r.points.length >= 2, r.name);
      assert.ok(r.points.every(([lat, lon]) => lat > 45.5 && lat < 45.95 && lon > 20.9 && lon < 21.5), `${r.name} leaves the Timisoara area`);
    }
  });
  test('the seed creates a consistent demo account (run on a throwaway email)', () => {
    const email = `seedtest-${Date.now()}@test.dev`;
    const run = spawnSync(process.execPath, ['src/db/seed.js'], { cwd: root, env: { ...process.env, SEED_EMAIL: email }, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /Seeded \d+ rides/);
    return (async () => {
      try {
        const rides = await query(`SELECT r.id, r.title, r.distance_km, r.source, t.points, b.name AS bike
          FROM rides r JOIN bikes b ON b.id = r.bike_id JOIN users u ON u.id = b.user_id LEFT JOIN ride_tracks t ON t.ride_id = r.id WHERE u.email = $1`, [email]);
        assert.ok(rides.length > 150);
        assert.deepEqual([...new Set(rides.map((r) => r.bike))].sort(), ['Commuter', 'Gravel']);
        // Every ride has a route and its distance equals the length of the drawn line
        for (const r of rides.slice(0, 80)) {
          assert.ok(r.points && r.source === 'GPX', r.title);
          let km = 0;
          for (let i = 1; i < r.points.length; i++) km += haversineKm({ lat: r.points[i - 1][0], lon: r.points[i - 1][1] }, { lat: r.points[i][0], lon: r.points[i][1] });
          assert.ok(Math.abs(km - r.distanceKm) <= 0.1, `${r.title}: ${km} vs ${r.distanceKm}`);
        }
        const comps = await query(`SELECT c.type, c.retired_at, c.installed_at,
          c.initial_km + COALESCE((SELECT SUM(r.distance_km) FROM rides r WHERE r.bike_id = c.bike_id AND (r.date AT TIME ZONE 'UTC')::date >= c.installed_at AND (c.retired_at IS NULL OR (r.date AT TIME ZONE 'UTC')::date < c.retired_at)), 0) / c.max_km AS pct
          FROM components c JOIN bikes b ON b.id = c.bike_id JOIN users u ON u.id = b.user_id WHERE u.email = $1`, [email]);
        assert.ok(comps.some((c) => c.retiredAt), 'a retired part');
        assert.ok(comps.some((c) => !c.retiredAt && c.pct >= 1), 'a part past its limit');
        assert.ok(comps.some((c) => !c.retiredAt && c.pct >= 0.8 && c.pct < 1), 'a part in warning');
        assert.ok(comps.some((c) => !c.retiredAt && c.pct < 0.8), 'a healthy part');
        const services = await query('SELECT DISTINCT s.type FROM services s JOIN bikes b ON b.id = s.bike_id JOIN users u ON u.id = b.user_id WHERE u.email = $1', [email]);
        assert.deepEqual(services.map((s) => s.type).sort(), ['ADJUST', 'CLEAN', 'INSPECTION', 'REPAIR', 'REPLACE']);
        // every part has mounts that match its bike; one part has moved between bikes
        const mounts = await query(`SELECT c.id, c.bike_id, COUNT(m.id)::int AS n, bool_or(m.to_date IS NULL AND m.bike_id = c.bike_id) AS open_on_current
          FROM components c JOIN bikes b ON b.id = c.bike_id JOIN users u ON u.id = b.user_id JOIN component_mounts m ON m.component_id = c.id
          WHERE u.email = $1 GROUP BY c.id, c.bike_id`, [email]);
        assert.equal(mounts.length, comps.length);
        assert.ok(mounts.every((m) => m.openOnCurrent));
        assert.ok(mounts.some((m) => m.n === 2), 'a part that moved between bikes');
        // maintenance rules cover the three states
        const rules = await query(`SELECT r.title, r.every_km, r.every_days FROM maintenance_rules r JOIN bikes b ON b.id = r.bike_id JOIN users u ON u.id = b.user_id WHERE u.email = $1`, [email]);
        assert.equal(rules.length, 5);
      } finally {
        await query('DELETE FROM users WHERE email = $1', [email]);
      }
    })();
  });
});
