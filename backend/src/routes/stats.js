const express = require('express');
const { query, one } = require('../db/pool');
const { ah } = require('../lib/http');
const schemas = require('../lib/schemas');
const { WEAR_SELECT, decorate } = require('../lib/wear');
const { listRules } = require('../lib/maintenance');

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

    const maintenance = (await listRules('b.user_id = $1', [uid])).filter((r) => r.status === 'DUE' || r.status === 'OVERDUE');

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
      maintenance,
    });
  })
);

const pickRide = (r) => r && { id: r.id, title: r.title, date: r.date, distanceKm: r.distanceKm, elevationM: r.elevationM, durationMin: r.durationMin, bikeName: r.bikeName };

// Yearly report: totals, months, per-bike figures, personal records and what each part costs per km
router.get(
  '/overview',
  ah(async (req, res) => {
    const uid = req.userId;
    const thisYear = new Date().getUTCFullYear();
    const { year = thisYear } = schemas.yearQuery.parse(req.query);
    const inYear = "date_part('year', r.date AT TIME ZONE 'UTC') = $2";

    const [years, sum, months, bikes, longest, climb, fastest, svcCost, partCost, parts] = await Promise.all([
      query(
        `SELECT DISTINCT date_part('year', r.date AT TIME ZONE 'UTC')::int AS year FROM rides r JOIN bikes b ON b.id = r.bike_id WHERE b.user_id = $1 ORDER BY year DESC`,
        [uid]
      ),
      one(
        `SELECT COALESCE(SUM(r.distance_km), 0) AS km, COUNT(*)::int AS rides, COALESCE(SUM(r.elevation_m), 0)::int AS elevation_m,
           COALESCE(SUM(r.duration_min), 0)::int AS moving_min, COUNT(DISTINCT (r.date AT TIME ZONE 'UTC')::date)::int AS active_days,
           COALESCE(SUM(r.distance_km) FILTER (WHERE r.duration_min > 0), 0) AS timed_km, COALESCE(SUM(r.duration_min) FILTER (WHERE r.duration_min > 0), 0) AS timed_min
         FROM rides r JOIN bikes b ON b.id = r.bike_id WHERE b.user_id = $1 AND ${inYear}`,
        [uid, year]
      ),
      query(
        `SELECT m AS month, COALESCE(SUM(r.distance_km), 0) AS km, COUNT(r.id)::int AS rides, COALESCE(SUM(r.elevation_m), 0)::int AS elevation_m
         FROM generate_series(1, 12) AS m
         LEFT JOIN (SELECT r.* FROM rides r JOIN bikes b ON b.id = r.bike_id WHERE b.user_id = $1 AND ${inYear}) r
           ON date_part('month', r.date AT TIME ZONE 'UTC') = m
         GROUP BY m ORDER BY m`,
        [uid, year]
      ),
      query(
        `SELECT b.id, b.name, b.type,
           COALESCE((SELECT SUM(r.distance_km) FROM rides r WHERE r.bike_id = b.id AND ${inYear}), 0) AS km,
           (SELECT COUNT(*)::int FROM rides r WHERE r.bike_id = b.id AND ${inYear}) AS rides,
           COALESCE((SELECT SUM(r.elevation_m) FROM rides r WHERE r.bike_id = b.id AND ${inYear}), 0)::int AS elevation_m,
           COALESCE((SELECT SUM(r.duration_min) FROM rides r WHERE r.bike_id = b.id AND ${inYear}), 0)::int AS moving_min,
           COALESCE((SELECT SUM(s.cost) FROM services s WHERE s.bike_id = b.id AND date_part('year', s.date) = $2), 0) AS service_cost
         FROM bikes b WHERE b.user_id = $1 ORDER BY km DESC, b.id`,
        [uid, year]
      ),
      one(`SELECT r.*, b.name AS bike_name FROM rides r JOIN bikes b ON b.id = r.bike_id WHERE b.user_id = $1 AND ${inYear} ORDER BY r.distance_km DESC, r.id LIMIT 1`, [uid, year]),
      one(`SELECT r.*, b.name AS bike_name FROM rides r JOIN bikes b ON b.id = r.bike_id WHERE b.user_id = $1 AND ${inYear} AND r.elevation_m IS NOT NULL ORDER BY r.elevation_m DESC, r.id LIMIT 1`, [uid, year]),
      // fastest average speed, ignoring short rides and rides without a time
      one(
        `SELECT r.*, b.name AS bike_name, r.distance_km / (r.duration_min / 60.0) AS avg_speed
         FROM rides r JOIN bikes b ON b.id = r.bike_id
         WHERE b.user_id = $1 AND ${inYear} AND r.duration_min > 0 AND r.distance_km >= 10 ORDER BY avg_speed DESC, r.id LIMIT 1`,
        [uid, year]
      ),
      one("SELECT COALESCE(SUM(s.cost), 0) AS total FROM services s JOIN bikes b ON b.id = s.bike_id WHERE b.user_id = $1 AND date_part('year', s.date) = $2", [uid, year]),
      one("SELECT COALESCE(SUM(c.price), 0) AS total FROM components c JOIN bikes b ON b.id = c.bike_id WHERE b.user_id = $1 AND date_part('year', c.installed_at) = $2", [uid, year]),
      query(`SELECT ${WEAR_SELECT}, b.name AS bike_name FROM components c JOIN bikes b ON b.id = c.bike_id WHERE b.user_id = $1 AND c.price > 0`, [uid]),
    ]);

    const km = round(sum.km);
    const services = round(svcCost.total, 2);
    const partsSpent = round(partCost.total, 2);
    const bestMonth = months.reduce((best, m) => (m.km > (best ? best.km : 0) ? m : best), null);
    const yearList = [...new Set([thisYear, ...years.map((y) => y.year)])].sort((a, b) => b - a);

    res.json({
      year,
      years: yearList,
      summary: {
        km,
        rides: sum.rides,
        elevationM: sum.elevationM,
        movingMin: sum.movingMin,
        activeDays: sum.activeDays,
        avgDistanceKm: sum.rides ? round(sum.km / sum.rides) : 0,
        avgSpeedKmh: sum.timedMin ? round(sum.timedKm / (sum.timedMin / 60)) : null,
      },
      costs: {
        services,
        parts: partsSpent,
        total: round(services + partsSpent, 2),
        perKm: km > 0 ? round((services + partsSpent) / km, 3) : null,
      },
      months: months.map((m) => ({ month: `${year}-${String(m.month).padStart(2, '0')}`, km: round(m.km), rides: m.rides, elevationM: m.elevationM })),
      bikes: bikes.map((b) => ({
        id: b.id, name: b.name, type: b.type, km: round(b.km), rides: b.rides, elevationM: b.elevationM, movingMin: b.movingMin,
        serviceCost: round(b.serviceCost, 2), costPerKm: b.km > 0 ? round(b.serviceCost / b.km, 3) : null,
      })),
      records: {
        longestRide: pickRide(longest),
        mostElevation: pickRide(climb),
        fastestRide: fastest && { ...pickRide(fastest), avgSpeedKmh: round(fastest.avgSpeed) },
        bestMonth: bestMonth && { month: `${year}-${String(bestMonth.month).padStart(2, '0')}`, km: round(bestMonth.km) },
      },
      // what each part cost per km ridden so far (all time), the most expensive per km first
      parts: parts
        .map(decorate)
        .map((c) => ({
          id: c.id, type: c.type, brand: c.brand, model: c.model, bikeName: c.bikeName, status: c.status, price: c.price, wearKm: c.wearKm,
          costPerKm: c.wearKm > 0 ? round(c.price / c.wearKm, 3) : null,
        }))
        .sort((a, b) => (b.costPerKm ?? -1) - (a.costPerKm ?? -1) || a.id - b.id),
    });
  })
);

module.exports = router;
