const express = require('express');
const { query, one, transaction, buildUpdate } = require('../db/pool');
const { ah, HttpError, parseId } = require('../lib/http');
const { assertBikeOwner, findOwned } = require('../lib/ownership');
const schemas = require('../lib/schemas');
const { WEAR_SELECT, decorate } = require('../lib/wear');
const { insertComponent, assertComponentOnBike } = require('../lib/components');

const router = express.Router();
const FIELDS = ['bikeId', 'componentId', 'date', 'type', 'cost', 'notes'];

const SERVICE_SELECT = `
  SELECT s.*, b.name AS bike_name, c.type AS component_type, c.brand AS component_brand, c.model AS component_model
  FROM services s
  JOIN bikes b ON b.id = s.bike_id
  LEFT JOIN components c ON c.id = s.component_id
  WHERE`;

router.get(
  '/',
  ah(async (req, res) => {
    const q = schemas.listQuery.parse(req.query);
    const params = [req.userId];
    let where = 'b.user_id = $1';
    if (q.bikeId) {
      params.push(q.bikeId);
      where += ` AND s.bike_id = $${params.length}`;
    }
    if (q.from) {
      params.push(q.from);
      where += ` AND s.date >= $${params.length}::date`;
    }
    if (q.to) {
      params.push(q.to);
      where += ` AND s.date <= $${params.length}::date`;
    }
    params.push(q.limit);
    res.json(await query(`${SERVICE_SELECT} ${where} ORDER BY s.date DESC, s.id DESC LIMIT $${params.length}`, params));
  })
);

router.get(
  '/:id',
  ah(async (req, res) => {
    const id = parseId(req.params.id);
    await findOwned('services', id, req.userId);
    res.json(await one(`${SERVICE_SELECT} s.id = $1`, [id]));
  })
);

router.post(
  '/',
  ah(async (req, res) => {
    const d = schemas.service.parse(req.body);
    await assertBikeOwner(d.bikeId, req.userId);

    if (d.replacement && (d.type !== 'REPLACE' || !d.componentId)) {
      throw new HttpError(400, 'replacement requires type REPLACE and a componentId');
    }
    let old = null;
    if (d.componentId) {
      old = await assertComponentOnBike(d.componentId, d.bikeId, req.userId);
      if (d.type === 'REPLACE' && old.bikeId !== d.bikeId) {
        throw new HttpError(400, 'Only the part currently on this bike can be replaced');
      }
      if (d.type === 'REPLACE' && d.date < old.installedAt) {
        throw new HttpError(400, 'Service date cannot be before the component was installed');
      }
    }

    const result = await transaction(async (client) => {
      const service = await one(
        `INSERT INTO services (bike_id, component_id, date, type, cost, notes)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [d.bikeId, d.componentId ?? null, d.date, d.type, d.cost ?? null, d.notes ?? null],
        client
      );
      let retiredComponentId = null;
      let newComponent = null;

      if (d.type === 'REPLACE' && old) {
        if (!old.retiredAt) {
          await query('UPDATE components SET retired_at = $1 WHERE id = $2', [d.date, old.id], client);
        }
        retiredComponentId = old.id;
        if (d.replacement) {
          const r = d.replacement;
          const createdId = await insertComponent(client, {
            bikeId: d.bikeId, type: old.type, brand: r.brand, model: r.model, installedAt: d.date,
            initialKm: 0, maxKm: r.maxKm ?? old.maxKm, price: r.price,
          });
          newComponent = decorate(
            await one(`SELECT ${WEAR_SELECT} FROM components c WHERE c.id = $1`, [createdId], client)
          );
        }
      }
      return { id: service.id, retiredComponentId, newComponent };
    });

    const full = await one(`${SERVICE_SELECT} s.id = $1`, [result.id]);
    res.status(201).json({ ...full, retiredComponentId: result.retiredComponentId, newComponent: result.newComponent });
  })
);

router.put(
  '/:id',
  ah(async (req, res) => {
    const id = parseId(req.params.id);
    const existing = await findOwned('services', id, req.userId);
    const d = schemas.serviceUpdate.parse(req.body);

    const bikeId = d.bikeId ?? existing.bikeId;
    if (bikeId !== existing.bikeId) await assertBikeOwner(bikeId, req.userId);
    const componentId = d.componentId === undefined ? existing.componentId : d.componentId;
    if (componentId && (d.componentId !== undefined || bikeId !== existing.bikeId)) {
      await assertComponentOnBike(componentId, bikeId, req.userId);
    }

    const { sets, values } = buildUpdate(d, FIELDS);
    if (sets.length) {
      await query(`UPDATE services SET ${sets.join(', ')} WHERE id = $${values.length + 1}`, [...values, id]);
    }
    res.json(await one(`${SERVICE_SELECT} s.id = $1`, [id]));
  })
);

router.delete(
  '/:id',
  ah(async (req, res) => {
    const id = parseId(req.params.id);
    await findOwned('services', id, req.userId);
    await query('DELETE FROM services WHERE id = $1', [id]);
    res.status(204).end();
  })
);

module.exports = router;
