const express = require('express');
const multer = require('multer');
const { query, one, transaction, buildUpdate } = require('../db/pool');
const { ah, HttpError, parseId } = require('../lib/http');
const { assertBikeOwner, findOwned } = require('../lib/ownership');
const schemas = require('../lib/schemas');
const { parseActivityFile } = require('../lib/gpx');
const config = require('../lib/config');

const router = express.Router();
const FIELDS = ['bikeId', 'date', 'title', 'distanceKm', 'durationMin', 'elevationM', 'notes'];
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxGpxBytes } });

const withBike = (where) =>
  `SELECT r.*, b.name AS bike_name,
     EXISTS (SELECT 1 FROM ride_tracks t WHERE t.ride_id = r.id) AS has_route
   FROM rides r JOIN bikes b ON b.id = r.bike_id WHERE ${where}`;

// Shared by the list and the map: optional bike and date filters on the user's rides.
function rideFilters(q, userId) {
  const params = [userId];
  let where = 'b.user_id = $1';
  if (q.bikeId) {
    params.push(q.bikeId);
    where += ` AND r.bike_id = $${params.length}`;
  }
  if (q.from) {
    params.push(q.from);
    where += ` AND (r.date AT TIME ZONE 'UTC')::date >= $${params.length}::date`;
  }
  if (q.to) {
    params.push(q.to);
    where += ` AND (r.date AT TIME ZONE 'UTC')::date <= $${params.length}::date`;
  }
  return { params, where };
}

router.get(
  '/',
  ah(async (req, res) => {
    const q = schemas.listQuery.parse(req.query);
    const { params, where } = rideFilters(q, req.userId);
    params.push(q.limit);
    res.json(await query(`${withBike(where)} ORDER BY r.date DESC, r.id DESC LIMIT $${params.length}`, params));
  })
);

// Rides that have a GPS track, with their points, for the map page.
router.get(
  '/routes',
  ah(async (req, res) => {
    const q = schemas.listQuery.parse(req.query);
    const { params, where } = rideFilters(q, req.userId);
    params.push(q.limit);
    res.json(
      await query(
        `SELECT r.id, r.bike_id, b.name AS bike_name, r.date, r.title, r.distance_km, t.points
         FROM rides r JOIN bikes b ON b.id = r.bike_id JOIN ride_tracks t ON t.ride_id = r.id
         WHERE ${where} ORDER BY r.date DESC, r.id DESC LIMIT $${params.length}`,
        params
      )
    );
  })
);

router.post(
  '/import-gpx',
  upload.single('file'),
  ah(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'GPX file is required (field "file")');
    const bikeId = schemas.listQuery.shape.bikeId.parse(req.body.bikeId);
    if (!bikeId) throw new HttpError(400, 'bikeId is required');
    await assertBikeOwner(bikeId, req.userId);

    const { route, ...parsed } = parseActivityFile(req.file.buffer, req.file.originalname);
    if (req.body.preview === 'true') return res.json({ bikeId, ...parsed, routePoints: route.length });

    const ride = await transaction(async (client) => {
      const created = await one(
        `INSERT INTO rides (bike_id, date, title, distance_km, duration_min, elevation_m, source)
         VALUES ($1,$2,$3,$4,$5,$6,'GPX') RETURNING id`,
        [bikeId, parsed.date, parsed.title, parsed.distanceKm, parsed.durationMin, parsed.elevationM],
        client
      );
      await query('INSERT INTO ride_tracks (ride_id, points) VALUES ($1, $2)', [created.id, JSON.stringify(route)], client);
      return created;
    });
    res.status(201).json(await one(withBike('r.id = $1'), [ride.id]));
  })
);

router.get(
  '/:id',
  ah(async (req, res) => {
    const id = parseId(req.params.id);
    await findOwned('rides', id, req.userId);
    res.json(await one(withBike('r.id = $1'), [id]));
  })
);

router.post(
  '/',
  ah(async (req, res) => {
    const d = schemas.ride.parse(req.body);
    await assertBikeOwner(d.bikeId, req.userId);
    const ride = await one(
      `INSERT INTO rides (bike_id, date, title, distance_km, duration_min, elevation_m, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [d.bikeId, d.date, d.title ?? null, d.distanceKm, d.durationMin ?? null, d.elevationM ?? null, d.notes ?? null]
    );
    res.status(201).json(await one(withBike('r.id = $1'), [ride.id]));
  })
);

router.put(
  '/:id',
  ah(async (req, res) => {
    const id = parseId(req.params.id);
    const existing = await findOwned('rides', id, req.userId);
    const d = schemas.rideUpdate.parse(req.body);
    if (d.bikeId !== undefined && d.bikeId !== existing.bikeId) await assertBikeOwner(d.bikeId, req.userId);
    const { sets, values } = buildUpdate(d, FIELDS);
    if (sets.length) {
      await query(`UPDATE rides SET ${sets.join(', ')} WHERE id = $${values.length + 1}`, [...values, id]);
    }
    res.json(await one(withBike('r.id = $1'), [id]));
  })
);

router.delete(
  '/:id',
  ah(async (req, res) => {
    const id = parseId(req.params.id);
    await findOwned('rides', id, req.userId);
    await query('DELETE FROM rides WHERE id = $1', [id]);
    res.status(204).end();
  })
);

module.exports = router;
