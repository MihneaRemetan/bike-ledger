const { query } = require('../db/pool');
const { HttpError } = require('./http');
const { withRuleForecasts } = require('./forecast');

const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const addDays = (isoDate, days) => {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

// A rule is satisfied by the latest service of its type (on its part, if it has one) on the same bike.
// Distance since then is the sum of the bike's rides from that day on, days since then is the calendar gap.
const RULE_SELECT = `
  WITH base AS (
    SELECT r.*, b.name AS bike_name, c.type AS component_type, c.brand AS component_brand, c.retired_at AS component_retired_at,
      ls.d AS last_service_at,
      GREATEST(r.start_date, COALESCE(ls.d, r.start_date)) AS last_done_at
    FROM maintenance_rules r
    JOIN bikes b ON b.id = r.bike_id
    LEFT JOIN components c ON c.id = r.component_id
    LEFT JOIN LATERAL (
      SELECT MAX(s.date) AS d FROM services s
      WHERE s.bike_id = r.bike_id AND s.type = r.service_type AND (r.component_id IS NULL OR s.component_id = r.component_id)
    ) ls ON TRUE
    WHERE __WHERE__
  )
  SELECT base.*,
    COALESCE((SELECT SUM(ri.distance_km) FROM rides ri WHERE ri.bike_id = base.bike_id AND (ri.date AT TIME ZONE 'UTC')::date >= base.last_done_at), 0) AS km_since,
    (CURRENT_DATE - base.last_done_at) AS days_since
  FROM base`;

const ORDER = { OVERDUE: 0, DUE: 1, OK: 2, PAUSED: 3 };

function decorateRule(r) {
  const kmPct = r.everyKm ? r.kmSince / r.everyKm : 0;
  const dayPct = r.everyDays ? r.daysSince / r.everyDays : 0;
  const pct = Math.max(kmPct, dayPct);
  let status = 'OK';
  if (r.componentRetiredAt) status = 'PAUSED'; // the part is gone, nothing left to maintain
  else if (pct >= 1) status = 'OVERDUE';
  else if (pct >= 0.8) status = 'DUE';
  const { componentRetiredAt, ...rest } = r;
  return {
    ...rest,
    kmSince: round(r.kmSince),
    kmRemaining: r.everyKm ? Math.max(0, round(r.everyKm - r.kmSince)) : null,
    daysRemaining: r.everyDays ? Math.max(0, r.everyDays - r.daysSince) : null,
    nextDueDate: r.everyDays ? addDays(r.lastDoneAt, r.everyDays) : null,
    pct: round(pct, 3),
    status,
  };
}

async function listRules(where, params, client) {
  const rows = await query(RULE_SELECT.replace('__WHERE__', where), params, client);
  const rules = await withRuleForecasts(rows.map(decorateRule), client);
  return rules.sort((a, b) => ORDER[a.status] - ORDER[b.status] || b.pct - a.pct || a.id - b.id);
}

async function findRule(id, userId, client) {
  const [rule] = await listRules('r.id = $1 AND b.user_id = $2', [id, userId], client);
  if (!rule) throw new HttpError(404, 'Rule not found');
  return rule;
}

// Rules offered to new users. Titles are used to avoid creating a suggestion twice.
const SUGGESTED_RULES = [
  { title: 'Clean and lube the chain', serviceType: 'CLEAN', everyKm: 300, everyDays: null },
  { title: 'Brake and gear adjustment', serviceType: 'ADJUST', everyKm: 2000, everyDays: 365 },
  { title: 'Full inspection', serviceType: 'INSPECTION', everyKm: null, everyDays: 365 },
];

module.exports = { listRules, findRule, decorateRule, SUGGESTED_RULES };
