const express = require('express');
const { query, one, buildUpdate } = require('../db/pool');
const { ah, HttpError, parseId } = require('../lib/http');
const { assertBikeOwner, findOwned } = require('../lib/ownership');
const schemas = require('../lib/schemas');
const { DEFAULT_MAX_KM, WEAR_SELECT, decorate } = require('../lib/wear');

const router = express.Router();
const FIELDS = ['bikeId', 'type', 'brand', 'model', 'installedAt', 'initialKm', 'maxKm', 'price', 'retiredAt'];

async function loadDecorated(id) {
  const row = await one(
    `SELECT ${WEAR_SELECT}, b.name AS bike_name FROM components c JOIN bikes b ON b.id = c.bike_id WHERE c.id = $1`,
    [id]
  );
  return decorate(row);
}

router.get('/defaults', (req, res) => res.json(DEFAULT_MAX_KM));

router.get(
  '/',
  ah(async (req, res) => {
    const q = schemas.componentListQuery.parse(req.query);
    const params = [req.userId];
    let where = 'b.user_id = $1';
    if (q.bikeId) {
      params.push(q.bikeId);
      where += ` AND c.bike_id = $${params.length}`;
    }
    if (q.status === 'active') where += ' AND c.retired_at IS NULL';
    if (q.status === 'retired') where += ' AND c.retired_at IS NOT NULL';
    params.push(q.limit);
    const rows = await query(
      `SELECT ${WEAR_SELECT}, b.name AS bike_name
       FROM components c JOIN bikes b ON b.id = c.bike_id
       WHERE ${where}
       ORDER BY (c.retired_at IS NOT NULL), c.installed_at DESC, c.id DESC
       LIMIT $${params.length}`,
      params
    );
    res.json(rows.map(decorate));
  })
);

router.get(
  '/:id',
  ah(async (req, res) => {
    const id = parseId(req.params.id);
    await findOwned('components', id, req.userId);
    const component = await loadDecorated(id);
    const services = await query('SELECT * FROM services WHERE component_id = $1 ORDER BY date DESC, id DESC', [id]);
    res.json({ ...component, services });
  })
);

router.post(
  '/',
  ah(async (req, res) => {
    const d = schemas.component.parse(req.body);
    await assertBikeOwner(d.bikeId, req.userId);
    const created = await one(
      `INSERT INTO components (bike_id, type, brand, model, installed_at, initial_km, max_km, price, retired_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [
        d.bikeId, d.type, d.brand ?? null, d.model ?? null, d.installedAt, d.initialKm,
        d.maxKm ?? DEFAULT_MAX_KM[d.type], d.price ?? null, d.retiredAt ?? null,
      ]
    );
    res.status(201).json(await loadDecorated(created.id));
  })
);

router.put(
  '/:id',
  ah(async (req, res) => {
    const id = parseId(req.params.id);
    const existing = await findOwned('components', id, req.userId);
    const d = schemas.componentUpdate.parse(req.body);
    if (d.maxKm === null) throw new HttpError(400, 'maxKm cannot be empty');
    if (d.bikeId !== undefined && d.bikeId !== existing.bikeId) await assertBikeOwner(d.bikeId, req.userId);

    const installedAt = d.installedAt ?? existing.installedAt;
    const retiredAt = d.retiredAt === undefined ? existing.retiredAt : d.retiredAt;
    if (retiredAt && retiredAt < installedAt) {
      throw new HttpError(400, 'Retired date cannot be before installed date');
    }

    const { sets, values } = buildUpdate(d, FIELDS);
    if (sets.length) {
      await query(`UPDATE components SET ${sets.join(', ')} WHERE id = $${values.length + 1}`, [...values, id]);
    }
    res.json(await loadDecorated(id));
  })
);

router.delete(
  '/:id',
  ah(async (req, res) => {
    const id = parseId(req.params.id);
    await findOwned('components', id, req.userId);
    await query('DELETE FROM components WHERE id = $1', [id]);
    res.status(204).end();
  })
);

module.exports = router;
