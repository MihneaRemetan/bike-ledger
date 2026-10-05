const express = require('express');
const { z } = require('zod');
const { query, one, updateRow } = require('../db/pool');
const { ah, HttpError, parseId } = require('../lib/http');
const { assertBikeOwner } = require('../lib/ownership');
const schemas = require('../lib/schemas');
const { listRules, findRule, SUGGESTED_RULES } = require('../lib/maintenance');
const { todayUtc, assertComponentOnBike } = require('../lib/components');

const router = express.Router();
const FIELDS = ['bikeId', 'componentId', 'title', 'serviceType', 'everyKm', 'everyDays', 'startDate'];

const listFilter = z.object({
  bikeId: schemas.listQuery.shape.bikeId,
  status: z.enum(['due', 'ok']).optional(),
});

router.get(
  '/rules',
  ah(async (req, res) => {
    const q = listFilter.parse(req.query);
    const params = [req.userId];
    let where = 'b.user_id = $1';
    if (q.bikeId) {
      params.push(q.bikeId);
      where += ` AND r.bike_id = $${params.length}`;
    }
    let rules = await listRules(where, params);
    if (q.status === 'due') rules = rules.filter((r) => r.status === 'DUE' || r.status === 'OVERDUE');
    if (q.status === 'ok') rules = rules.filter((r) => r.status === 'OK');
    res.json(rules);
  })
);

router.get('/rules/:id', ah(async (req, res) => res.json(await findRule(parseId(req.params.id), req.userId))));

router.post(
  '/rules',
  ah(async (req, res) => {
    const d = schemas.maintenanceRule.parse(req.body);
    await assertBikeOwner(d.bikeId, req.userId);
    if (d.componentId) await assertComponentOnBike(d.componentId, d.bikeId, req.userId);
    const created = await one(
      `INSERT INTO maintenance_rules (bike_id, component_id, title, service_type, every_km, every_days, start_date)
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7::date, CURRENT_DATE)) RETURNING id`,
      [d.bikeId, d.componentId ?? null, d.title, d.serviceType, d.everyKm ?? null, d.everyDays ?? null, d.startDate ?? null]
    );
    res.status(201).json(await findRule(created.id, req.userId));
  })
);

router.put(
  '/rules/:id',
  ah(async (req, res) => {
    const id = parseId(req.params.id);
    const existing = await findRule(id, req.userId);
    const d = schemas.maintenanceRuleUpdate.parse(req.body);
    if (d.startDate === null) delete d.startDate; // the start date cannot be emptied
    const bikeId = d.bikeId ?? existing.bikeId;
    if (d.bikeId !== undefined && d.bikeId !== existing.bikeId) await assertBikeOwner(bikeId, req.userId);
    const componentId = d.componentId === undefined ? existing.componentId : d.componentId;
    if (componentId && (d.componentId !== undefined || bikeId !== existing.bikeId)) await assertComponentOnBike(componentId, bikeId, req.userId);
    const km = d.everyKm === undefined ? existing.everyKm : d.everyKm;
    const days = d.everyDays === undefined ? existing.everyDays : d.everyDays;
    if (km == null && days == null) throw new HttpError(400, 'Set a distance, a number of days, or both');

    await updateRow('maintenance_rules', id, d, FIELDS);
    res.json(await findRule(id, req.userId));
  })
);

router.delete(
  '/rules/:id',
  ah(async (req, res) => {
    const id = parseId(req.params.id);
    await findRule(id, req.userId);
    await query('DELETE FROM maintenance_rules WHERE id = $1', [id]);
    res.status(204).end();
  })
);

// Marks a rule as done: logs a service of the rule's type (on its part, if any), which restarts the counters
router.post(
  '/rules/:id/complete',
  ah(async (req, res) => {
    const id = parseId(req.params.id);
    const rule = await findRule(id, req.userId);
    const d = schemas.maintenanceComplete.parse(req.body || {});
    const service = await one(
      `INSERT INTO services (bike_id, component_id, date, type, cost, notes) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [rule.bikeId, rule.componentId, d.date ?? todayUtc(), rule.serviceType, d.cost ?? null, d.notes ?? rule.title]
    );
    res.status(201).json({ service, rule: await findRule(id, req.userId) });
  })
);

// Adds the standard rules to a bike, skipping ones it already has
router.post(
  '/suggested',
  ah(async (req, res) => {
    const { bikeId } = schemas.maintenanceSuggest.parse(req.body);
    await assertBikeOwner(bikeId, req.userId);
    const have = new Set((await query('SELECT title FROM maintenance_rules WHERE bike_id = $1', [bikeId])).map((r) => r.title));
    for (const s of SUGGESTED_RULES.filter((x) => !have.has(x.title))) {
      await query(
        'INSERT INTO maintenance_rules (bike_id, title, service_type, every_km, every_days) VALUES ($1,$2,$3,$4,$5)',
        [bikeId, s.title, s.serviceType, s.everyKm, s.everyDays]
      );
    }
    res.status(201).json(await listRules('r.bike_id = $1 AND b.user_id = $2', [bikeId, req.userId]));
  })
);

module.exports = router;
