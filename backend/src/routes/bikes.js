const express = require('express');
const { query, one, buildUpdate } = require('../db/pool');
const { ah, HttpError, parseId } = require('../lib/http');
const { assertBikeOwner } = require('../lib/ownership');
const schemas = require('../lib/schemas');
const { WEAR_SELECT, decorate } = require('../lib/wear');
const { withComponentForecasts } = require('../lib/forecast');

const router = express.Router();
const FIELDS = ['name', 'type', 'brand', 'model', 'year', 'notes'];

const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

const BIKE_STATS = `
  COALESCE((SELECT SUM(r.distance_km) FROM rides r WHERE r.bike_id = b.id), 0) AS total_km,
  (SELECT COUNT(*)::int FROM rides r WHERE r.bike_id = b.id) AS ride_count,
  COALESCE((SELECT SUM(s.cost) FROM services s WHERE s.bike_id = b.id), 0) AS maintenance_cost`;

router.get(
  '/',
  ah(async (req, res) => {
    const rows = await query(
      `SELECT b.*, ${BIKE_STATS},
        (SELECT COUNT(*)::int FROM components c WHERE c.bike_id = b.id AND c.retired_at IS NULL) AS active_components,
        (SELECT COUNT(*)::int FROM (
           SELECT ${WEAR_SELECT} FROM components c WHERE c.bike_id = b.id AND c.retired_at IS NULL
         ) w WHERE w.wear_km >= 0.8 * w.max_km) AS alerts
       FROM bikes b WHERE b.user_id = $1 ORDER BY b.created_at DESC, b.id DESC`,
      [req.userId]
    );
    res.json(rows.map((b) => ({ ...b, totalKm: round(b.totalKm), maintenanceCost: round(b.maintenanceCost, 2) })));
  })
);

router.get(
  '/:id',
  ah(async (req, res) => {
    const id = parseId(req.params.id);
    const bike = await one(`SELECT b.*, ${BIKE_STATS} FROM bikes b WHERE b.id = $1 AND b.user_id = $2`, [
      id,
      req.userId,
    ]);
    if (!bike) throw new HttpError(404, 'Bike not found');

    const [components, recentRides, recentServices] = await Promise.all([
      query(
        `SELECT ${WEAR_SELECT} FROM components c WHERE c.bike_id = $1
         ORDER BY (c.retired_at IS NOT NULL), c.installed_at DESC, c.id DESC`,
        [id]
      ),
      query('SELECT * FROM rides WHERE bike_id = $1 ORDER BY date DESC, id DESC LIMIT 10', [id]),
      query(
        `SELECT s.*, c.type AS component_type, c.brand AS component_brand, c.model AS component_model
         FROM services s LEFT JOIN components c ON c.id = s.component_id
         WHERE s.bike_id = $1 ORDER BY s.date DESC, s.id DESC LIMIT 10`,
        [id]
      ),
    ]);

    res.json({
      ...bike,
      totalKm: round(bike.totalKm),
      maintenanceCost: round(bike.maintenanceCost, 2),
      costPerKm: bike.totalKm > 0 ? round(bike.maintenanceCost / bike.totalKm, 3) : 0,
      components: await withComponentForecasts(components.map(decorate)),
      recentRides,
      recentServices,
    });
  })
);

router.post(
  '/',
  ah(async (req, res) => {
    const d = schemas.bike.parse(req.body);
    const bike = await one(
      `INSERT INTO bikes (user_id, name, brand, model, type, year, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.userId, d.name, d.brand ?? null, d.model ?? null, d.type, d.year ?? null, d.notes ?? null]
    );
    res.status(201).json(bike);
  })
);

router.put(
  '/:id',
  ah(async (req, res) => {
    const id = parseId(req.params.id);
    await assertBikeOwner(id, req.userId);
    const d = schemas.bikeUpdate.parse(req.body);
    const { sets, values } = buildUpdate(d, FIELDS);
    if (!sets.length) return res.json(await assertBikeOwner(id, req.userId));
    const bike = await one(
      `UPDATE bikes SET ${sets.join(', ')} WHERE id = $${values.length + 1} RETURNING *`,
      [...values, id]
    );
    res.json(bike);
  })
);

router.delete(
  '/:id',
  ah(async (req, res) => {
    const id = parseId(req.params.id);
    await assertBikeOwner(id, req.userId);
    await query('DELETE FROM bikes WHERE id = $1', [id]);
    res.status(204).end();
  })
);

module.exports = router;
