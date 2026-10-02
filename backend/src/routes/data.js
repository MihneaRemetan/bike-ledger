const express = require('express');
const multer = require('multer');
const { query, one, transaction } = require('../db/pool');
const { ah, HttpError } = require('../lib/http');
const schemas = require('../lib/schemas');
const { toCsv } = require('../lib/csv');
const { WEAR_SELECT, DEFAULT_MAX_KM, decorate } = require('../lib/wear');
const { listRules } = require('../lib/maintenance');
const { mountsOf } = require('../lib/components');

const router = express.Router();
const MAX_IMPORT_BYTES = 30 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_IMPORT_BYTES } });
const BATCH = 1000;

const bikeRows = (uid) => query('SELECT * FROM bikes WHERE user_id = $1 ORDER BY id', [uid]);
const componentRows = async (uid) =>
  (await query(`SELECT ${WEAR_SELECT}, b.name AS bike_name FROM components c JOIN bikes b ON b.id = c.bike_id WHERE b.user_id = $1 ORDER BY c.id`, [uid])).map(decorate);
const rideRows = (uid) =>
  query('SELECT r.*, b.name AS bike_name FROM rides r JOIN bikes b ON b.id = r.bike_id WHERE b.user_id = $1 ORDER BY r.date, r.id', [uid]);
const serviceRows = (uid) =>
  query(
    `SELECT s.*, b.name AS bike_name, c.type AS component_type, c.brand AS component_brand
     FROM services s JOIN bikes b ON b.id = s.bike_id LEFT JOIN components c ON c.id = s.component_id
     WHERE b.user_id = $1 ORDER BY s.date, s.id`,
    [uid]
  );
const ruleRows = (uid) => listRules('b.user_id = $1', [uid]);

const partName = (type, brand) => [type, brand].filter(Boolean).join(' ');

// CSV layouts: what a person sees in a spreadsheet
const CSV = {
  bikes: {
    load: bikeRows,
    columns: [['id', (r) => r.id], ['name', (r) => r.name], ['brand', (r) => r.brand], ['model', (r) => r.model], ['type', (r) => r.type], ['year', (r) => r.year], ['notes', (r) => r.notes]],
  },
  components: {
    load: componentRows,
    columns: [['id', (r) => r.id], ['bike', (r) => r.bikeName], ['type', (r) => r.type], ['brand', (r) => r.brand], ['model', (r) => r.model], ['installed_at', (r) => r.installedAt], ['retired_at', (r) => r.retiredAt], ['initial_km', (r) => r.initialKm], ['max_km', (r) => r.maxKm], ['wear_km', (r) => r.wearKm], ['wear_pct', (r) => r.wearPct], ['status', (r) => r.status], ['price', (r) => r.price]],
  },
  rides: {
    load: rideRows,
    columns: [['id', (r) => r.id], ['date', (r) => r.date], ['bike', (r) => r.bikeName], ['title', (r) => r.title], ['distance_km', (r) => r.distanceKm], ['duration_min', (r) => r.durationMin], ['elevation_m', (r) => r.elevationM], ['source', (r) => r.source], ['notes', (r) => r.notes]],
  },
  services: {
    load: serviceRows,
    columns: [['id', (r) => r.id], ['date', (r) => r.date], ['bike', (r) => r.bikeName], ['type', (r) => r.type], ['component', (r) => (r.componentType ? partName(r.componentType, r.componentBrand) : null)], ['cost', (r) => r.cost], ['notes', (r) => r.notes]],
  },
  rules: {
    load: ruleRows,
    columns: [['id', (r) => r.id], ['bike', (r) => r.bikeName], ['title', (r) => r.title], ['service_type', (r) => r.serviceType], ['component', (r) => (r.componentType ? partName(r.componentType, r.componentBrand) : null)], ['every_km', (r) => r.everyKm], ['every_days', (r) => r.everyDays], ['start_date', (r) => r.startDate], ['last_done_at', (r) => r.lastDoneAt], ['km_since', (r) => r.kmSince], ['status', (r) => r.status]],
  },
};

const attachment = (res, filename, type) => {
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
};

router.get(
  '/export',
  ah(async (req, res) => {
    const uid = req.userId;
    const withTracks = req.query.tracks === 'true';
    const [bikes, components, rides, services, rules] = await Promise.all([bikeRows(uid), componentRows(uid), rideRows(uid), serviceRows(uid), ruleRows(uid)]);
    const mounts = new Map();
    for (const c of components) mounts.set(c.id, (await mountsOf(c.id)).map((m) => ({ bikeId: m.bikeId, fromDate: m.fromDate, toDate: m.toDate })));
    const out = {
      app: 'BikeLedger',
      version: 1,
      exportedAt: new Date().toISOString(),
      bikes: bikes.map(({ id, name, brand, model, type, year, notes }) => ({ id, name, brand, model, type, year, notes })),
      components: components.map((c) => ({
        id: c.id, bikeId: c.bikeId, type: c.type, brand: c.brand, model: c.model, installedAt: c.installedAt, retiredAt: c.retiredAt,
        initialKm: c.initialKm, maxKm: c.maxKm, price: c.price, mounts: mounts.get(c.id),
      })),
      rides: rides.map((r) => ({ id: r.id, bikeId: r.bikeId, date: r.date, title: r.title, distanceKm: r.distanceKm, durationMin: r.durationMin, elevationM: r.elevationM, source: r.source, notes: r.notes })),
      services: services.map((s) => ({ id: s.id, bikeId: s.bikeId, componentId: s.componentId, date: s.date, type: s.type, cost: s.cost, notes: s.notes })),
      rules: rules.map((r) => ({ id: r.id, bikeId: r.bikeId, componentId: r.componentId, title: r.title, serviceType: r.serviceType, everyKm: r.everyKm, everyDays: r.everyDays, startDate: r.startDate })),
    };
    if (withTracks) {
      out.tracks = (await query('SELECT t.ride_id, t.points FROM ride_tracks t JOIN rides r ON r.id = t.ride_id JOIN bikes b ON b.id = r.bike_id WHERE b.user_id = $1 ORDER BY t.ride_id', [uid])).map((t) => ({ rideId: t.rideId, points: t.points }));
    }
    attachment(res, `bikeledger-${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
    res.send(JSON.stringify(out));
  })
);

router.get(
  '/export/:file',
  ah(async (req, res) => {
    const m = /^(\w+)\.csv$/.exec(req.params.file);
    const def = m && CSV[m[1]];
    if (!def) throw new HttpError(404, 'Unknown export');
    const rows = await def.load(req.userId);
    attachment(res, `bikeledger-${m[1]}.csv`, 'text/csv; charset=utf-8');
    res.send(toCsv(def.columns.map(([header, value]) => ({ header, value })), rows));
  })
);

// Inserts rows in chunks with unnest(), keeping the order so returned ids line up with the input
async function insertRides(client, rides, bikeMap) {
  const newIds = [];
  for (let i = 0; i < rides.length; i += BATCH) {
    const chunk = rides.slice(i, i + BATCH);
    const rows = await query(
      `INSERT INTO rides (bike_id, date, title, distance_km, duration_min, elevation_m, source, notes)
       SELECT * FROM unnest($1::int[], $2::timestamptz[], $3::text[], $4::float8[], $5::int[], $6::int[], $7::text[], $8::text[])
       RETURNING id`,
      [
        chunk.map((r) => bikeMap.get(r.bikeId)), chunk.map((r) => r.date), chunk.map((r) => r.title ?? null), chunk.map((r) => r.distanceKm),
        chunk.map((r) => r.durationMin ?? null), chunk.map((r) => r.elevationM ?? null), chunk.map((r) => r.source), chunk.map((r) => r.notes ?? null),
      ],
      client
    );
    newIds.push(...rows.map((r) => r.id));
  }
  return newIds;
}

// Adds the contents of an export file to the current account. Nothing is merged or de-duplicated.
router.post(
  '/import',
  upload.single('file'),
  ah(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'Choose a BikeLedger export file (field "file")');
    let raw;
    try {
      raw = JSON.parse(req.file.buffer.toString('utf8'));
    } catch {
      throw new HttpError(400, 'The file is not valid JSON');
    }
    const data = schemas.exportFile.parse(raw);

    const bikeIds = new Set(data.bikes.map((b) => b.id));
    const compIds = new Set(data.components.map((c) => c.id));
    const rideIds = new Set(data.rides.map((r) => r.id));
    const need = (set, id, what) => {
      if (!set.has(id)) throw new HttpError(400, `The file refers to a ${what} (id ${id}) that is not in it`);
    };
    data.components.forEach((c) => { need(bikeIds, c.bikeId, 'bike'); (c.mounts || []).forEach((m) => need(bikeIds, m.bikeId, 'bike')); });
    data.rides.forEach((r) => need(bikeIds, r.bikeId, 'bike'));
    data.services.forEach((s) => { need(bikeIds, s.bikeId, 'bike'); if (s.componentId) need(compIds, s.componentId, 'component'); });
    data.rules.forEach((r) => { need(bikeIds, r.bikeId, 'bike'); if (r.componentId) need(compIds, r.componentId, 'component'); });
    data.tracks.forEach((t) => need(rideIds, t.rideId, 'ride'));

    const counts = await transaction(async (client) => {
      const bikeMap = new Map();
      for (const b of data.bikes) {
        const row = await one(
          'INSERT INTO bikes (user_id, name, brand, model, type, year, notes) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
          [req.userId, b.name, b.brand ?? null, b.model ?? null, b.type, b.year ?? null, b.notes ?? null],
          client
        );
        bikeMap.set(b.id, row.id);
      }
      const compMap = new Map();
      for (const c of data.components) {
        const row = await one(
          `INSERT INTO components (bike_id, type, brand, model, installed_at, initial_km, max_km, price, retired_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
          [bikeMap.get(c.bikeId), c.type, c.brand ?? null, c.model ?? null, c.installedAt, c.initialKm ?? 0, c.maxKm ?? DEFAULT_MAX_KM[c.type], c.price ?? null, c.retiredAt ?? null],
          client
        );
        compMap.set(c.id, row.id);
        const mounts = c.mounts && c.mounts.length ? c.mounts : [{ bikeId: c.bikeId, fromDate: c.installedAt, toDate: null }];
        for (const m of mounts) {
          await query('INSERT INTO component_mounts (component_id, bike_id, from_date, to_date) VALUES ($1,$2,$3,$4)', [row.id, bikeMap.get(m.bikeId), m.fromDate, m.toDate ?? null], client);
        }
      }
      const newRideIds = await insertRides(client, data.rides, bikeMap);
      const rideMap = new Map(data.rides.map((r, i) => [r.id, newRideIds[i]]));
      for (const t of data.tracks) {
        await query('INSERT INTO ride_tracks (ride_id, points) VALUES ($1,$2)', [rideMap.get(t.rideId), JSON.stringify(t.points)], client);
      }
      for (const s of data.services) {
        await query(
          'INSERT INTO services (bike_id, component_id, date, type, cost, notes) VALUES ($1,$2,$3,$4,$5,$6)',
          [bikeMap.get(s.bikeId), s.componentId ? compMap.get(s.componentId) : null, s.date, s.type, s.cost ?? null, s.notes ?? null],
          client
        );
      }
      for (const r of data.rules) {
        await query(
          'INSERT INTO maintenance_rules (bike_id, component_id, title, service_type, every_km, every_days, start_date) VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7::date, CURRENT_DATE))',
          [bikeMap.get(r.bikeId), r.componentId ? compMap.get(r.componentId) : null, r.title, r.serviceType, r.everyKm ?? null, r.everyDays ?? null, r.startDate ?? null],
          client
        );
      }
      return { bikes: data.bikes.length, components: data.components.length, rides: data.rides.length, services: data.services.length, rules: data.rules.length, tracks: data.tracks.length };
    });
    res.status(201).json({ imported: counts });
  })
);

module.exports = router;
