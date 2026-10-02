const express = require('express');
const { query, one } = require('../db/pool');
const { ah } = require('../lib/http');
const { WEAR_SELECT, decorate } = require('../lib/wear');

const router = express.Router();
const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

router.get(
  '/dashboard',
  ah(async (req, res) => {
    const uid = req.userId;
    const [totals, months, active] = await Promise.all([
      one(
        `SELECT
           (SELECT COUNT(*)::int FROM bikes WHERE user_id = $1) AS bikes,
           (SELECT COUNT(*)::int FROM rides r JOIN bikes b ON b.id = r.bike_id WHERE b.user_id = $1) AS rides,
           (SELECT COALESCE(SUM(r.distance_km),0) FROM rides r JOIN bikes b ON b.id = r.bike_id WHERE b.user_id = $1) AS km,
           (SELECT COALESCE(SUM(r.elevation_m),0)::int FROM rides r JOIN bikes b ON b.id = r.bike_id WHERE b.user_id = $1) AS elevation_m,
           (SELECT COALESCE(SUM(s.cost),0) FROM services s JOIN bikes b ON b.id = s.bike_id WHERE b.user_id = $1) AS maintenance_cost,
           (SELECT COUNT(*)::int FROM components c JOIN bikes b ON b.id = c.bike_id WHERE b.user_id = $1 AND c.retired_at IS NULL) AS active_components`,
        [uid]
      ),
      query(
        `SELECT to_char(m, 'YYYY-MM') AS month,
           COALESCE((SELECT SUM(r.distance_km) FROM rides r JOIN bikes b ON b.id = r.bike_id
                     WHERE b.user_id = $1 AND date_trunc('month', r.date AT TIME ZONE 'UTC') = m), 0) AS km,
           COALESCE((SELECT SUM(s.cost) FROM services s JOIN bikes b ON b.id = s.bike_id
                     WHERE b.user_id = $1 AND date_trunc('month', s.date::timestamp) = m), 0) AS cost
         FROM generate_series(
           date_trunc('month', now() AT TIME ZONE 'UTC') - interval '11 months',
           date_trunc('month', now() AT TIME ZONE 'UTC'),
           interval '1 month') AS m
         ORDER BY m`,
        [uid]
      ),
      query(
        `SELECT ${WEAR_SELECT}, b.name AS bike_name
         FROM components c JOIN bikes b ON b.id = c.bike_id
         WHERE b.user_id = $1 AND c.retired_at IS NULL`,
        [uid]
      ),
    ]);

    const alerts = active
      .map(decorate)
      .filter((c) => c.status === 'WARN' || c.status === 'REPLACE')
      .sort((a, b) => b.wearPct - a.wearPct);

    res.json({
      totals: {
        bikes: totals.bikes,
        rides: totals.rides,
        km: round(totals.km),
        elevationM: totals.elevationM,
        maintenanceCost: round(totals.maintenanceCost, 2),
        activeComponents: totals.activeComponents,
      },
      months: months.map((m) => ({ month: m.month, km: round(m.km), cost: round(m.cost, 2) })),
      alerts,
    });
  })
);

module.exports = router;
