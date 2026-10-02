const { query } = require('../db/pool');

// Forecasts how soon a part reaches its limit, and when a km-based rule falls due, from how much the
// bike has been ridden lately. It is an estimate: it assumes the next weeks look like the last ones.
const WINDOW_DAYS = 90; // look at the last 3 months
const MIN_WINDOW_DAYS = 14; // a bike with only a few days of history is judged over at least two weeks
const MAX_HORIZON_DAYS = 3650; // beyond ten years "far away" is more honest than a date

const todayUtc = () => new Date().toISOString().slice(0, 10);
const addDays = (isoDate, days) => {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

// Average km per day of each bike over the recent window: Map(bikeId -> { kmPerDay, windowDays })
async function bikeRates(bikeIds, client) {
  const ids = [...new Set(bikeIds)];
  if (!ids.length) return new Map();
  const rows = await query(
    `SELECT b.id AS bike_id,
       COALESCE(SUM(r.distance_km) FILTER (WHERE (r.date AT TIME ZONE 'UTC')::date > CURRENT_DATE - $2::int
                                              AND (r.date AT TIME ZONE 'UTC')::date <= CURRENT_DATE), 0) AS km_window,
       (CURRENT_DATE - MIN((r.date AT TIME ZONE 'UTC')::date)) AS days_since_first
     FROM bikes b LEFT JOIN rides r ON r.bike_id = b.id
     WHERE b.id = ANY($1::int[]) GROUP BY b.id`,
    [ids, WINDOW_DAYS],
    client
  );
  return new Map(
    rows.map((r) => {
      const windowDays = r.daysSinceFirst == null || r.daysSinceFirst >= WINDOW_DAYS ? WINDOW_DAYS : Math.max(MIN_WINDOW_DAYS, r.daysSinceFirst + 1);
      return [r.bikeId, { kmPerDay: r.kmWindow / windowDays, windowDays }];
    })
  );
}

// Days until `km` more kilometres are ridden at `kmPerDay` (null when nothing is being ridden)
const daysFor = (km, kmPerDay) => (kmPerDay > 0 ? Math.ceil(km / kmPerDay) : null);

// status: DATE (a date is given), NOW (limit reached), NO_RECENT_RIDES (cannot estimate), FAR (more than ten years)
function componentForecast(component, rate, today = todayUtc()) {
  if (component.retiredAt) return null;
  const kmPerDay = rate ? round(rate.kmPerDay) : 0;
  const base = { kmPerDay, windowDays: rate ? rate.windowDays : WINDOW_DAYS, remainingKm: component.remainingKm };
  if (component.remainingKm <= 0) return { ...base, status: 'NOW', daysLeft: 0, date: null };
  const daysLeft = daysFor(component.remainingKm, rate ? rate.kmPerDay : 0);
  if (daysLeft === null) return { ...base, status: 'NO_RECENT_RIDES', daysLeft: null, date: null };
  if (daysLeft > MAX_HORIZON_DAYS) return { ...base, status: 'FAR', daysLeft, date: null };
  return { ...base, status: 'DATE', daysLeft, date: addDays(today, daysLeft) };
}

// For a maintenance rule: the earlier of the date its day interval ends and the date its distance interval is used up
function ruleForecast(rule, rate, today = todayUtc()) {
  if (rule.status === 'PAUSED' || rule.status === 'OVERDUE') return null;
  const candidates = [];
  if (rule.nextDueDate) candidates.push({ date: rule.nextDueDate, basis: 'DAYS' });
  if (rule.kmRemaining != null && rate) {
    const days = daysFor(rule.kmRemaining, rate.kmPerDay);
    if (days !== null && days <= MAX_HORIZON_DAYS) candidates.push({ date: addDays(today, days), basis: 'KM' });
  }
  if (!candidates.length) return null;
  return candidates.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))[0];
}

// Adds `forecast` to a list of decorated components (it needs their bikeId)
async function withComponentForecasts(components, client) {
  const rates = await bikeRates(components.map((c) => c.bikeId), client);
  return components.map((c) => ({ ...c, forecast: componentForecast(c, rates.get(c.bikeId)) }));
}

async function withRuleForecasts(rules, client) {
  const rates = await bikeRates(rules.map((r) => r.bikeId), client);
  return rules.map((r) => ({ ...r, forecast: ruleForecast(r, rates.get(r.bikeId)) }));
}

module.exports = { bikeRates, componentForecast, ruleForecast, withComponentForecasts, withRuleForecasts, addDays, WINDOW_DAYS, MIN_WINDOW_DAYS, MAX_HORIZON_DAYS };
