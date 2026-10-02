const express = require('express');
const { query, one, transaction, buildUpdate } = require('../db/pool');
const { ah, HttpError, parseId } = require('../lib/http');
const { assertBikeOwner, findOwned } = require('../lib/ownership');
const schemas = require('../lib/schemas');
const { DEFAULT_MAX_KM, WEAR_SELECT, decorate } = require('../lib/wear');
const { todayUtc, insertComponent, moveComponent, mountsOf } = require('../lib/components');

const router = express.Router();
// bikeId is not here: a part changes bike through moveComponent, which keeps its mount history
const FIELDS = ['type', 'brand', 'model', 'installedAt', 'initialKm', 'maxKm', 'price', 'retiredAt'];

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
    res.json({ ...component, services, mounts: await mountsOf(id) });
  })
);

router.post(
  '/',
  ah(async (req, res) => {
    const d = schemas.component.parse(req.body);
    await assertBikeOwner(d.bikeId, req.userId);
    const id = await transaction((client) =>
      insertComponent(client, { ...d, maxKm: d.maxKm ?? DEFAULT_MAX_KM[d.type] })
    );
    res.status(201).json(await loadDecorated(id));
  })
);

router.post(
  '/:id/move',
  ah(async (req, res) => {
    const id = parseId(req.params.id);
    const component = await findOwned('components', id, req.userId);
    const d = schemas.componentMove.parse(req.body);
    await assertBikeOwner(d.bikeId, req.userId);
    await transaction((client) => moveComponent(client, component, d.bikeId, d.date));
    res.json({ ...(await loadDecorated(id)), mounts: await mountsOf(id) });
  })
);

router.put(
  '/:id',
  ah(async (req, res) => {
    const id = parseId(req.params.id);
    const existing = await findOwned('components', id, req.userId);
    const d = schemas.componentUpdate.parse(req.body);
    if (d.maxKm === null) throw new HttpError(400, 'maxKm cannot be empty');
    const moveTo = d.bikeId !== undefined && d.bikeId !== existing.bikeId ? d.bikeId : null;
    if (moveTo) await assertBikeOwner(moveTo, req.userId);

    const installedAt = d.installedAt ?? existing.installedAt;
    const retiredAt = d.retiredAt === undefined ? existing.retiredAt : d.retiredAt;
    if (retiredAt && retiredAt < installedAt) {
      throw new HttpError(400, 'Retired date cannot be before installed date');
    }

    await transaction(async (client) => {
      const { sets, values } = buildUpdate(d, FIELDS);
      if (sets.length) {
        await query(`UPDATE components SET ${sets.join(', ')} WHERE id = $${values.length + 1}`, [...values, id], client);
      }
      if (d.installedAt && d.installedAt !== existing.installedAt) {
        // the first mount starts on the installation day
        await query(
          'UPDATE component_mounts SET from_date = $1 WHERE id = (SELECT id FROM component_mounts WHERE component_id = $2 ORDER BY from_date, id LIMIT 1)',
          [d.installedAt, id],
          client
        );
      }
      // changing the bike through a plain update moves the part as of today (or its mount start, if later)
      if (moveTo) {
        const current = await one('SELECT * FROM components WHERE id = $1', [id], client);
        const open = await one('SELECT from_date FROM component_mounts WHERE component_id = $1 AND to_date IS NULL ORDER BY from_date DESC LIMIT 1', [id], client);
        const today = todayUtc();
        await moveComponent(client, current, moveTo, today < open.fromDate ? open.fromDate : today);
      }
    });
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
