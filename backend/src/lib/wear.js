const DEFAULT_MAX_KM = {
  CHAIN: 4000,
  CASSETTE: 12000,
  CHAINRING: 20000,
  TYRE_FRONT: 6000,
  TYRE_REAR: 4000,
  BRAKE_PADS: 2500,
  BRAKE_ROTORS: 15000,
  CABLES: 8000,
  BAR_TAPE: 6000,
  OTHER: 5000,
};

// Wear is never stored: initial km plus every ride on a bike the part was mounted on, on a day inside
// that mount (see component_mounts). The end of a mount, and the retirement day, are exclusive, so a ride
// on the day of a swap or move counts for the new part only.
const WEAR_SELECT = `
  c.*,
  c.initial_km + COALESCE((
    SELECT SUM(r.distance_km)
    FROM component_mounts m
    JOIN rides r ON r.bike_id = m.bike_id
      AND (r.date AT TIME ZONE 'UTC')::date >= m.from_date
      AND (m.to_date IS NULL OR (r.date AT TIME ZONE 'UTC')::date < m.to_date)
      AND (c.retired_at IS NULL OR (r.date AT TIME ZONE 'UTC')::date < c.retired_at)
    WHERE m.component_id = c.id
  ), 0) AS wear_km`;

function decorate(row) {
  const wearKm = Math.round(row.wearKm * 10) / 10;
  const wearPct = Math.round((row.wearKm / row.maxKm) * 1000) / 1000;
  let status = 'OK';
  if (row.retiredAt) status = 'RETIRED';
  else if (wearPct >= 1) status = 'REPLACE';
  else if (wearPct >= 0.8) status = 'WARN';
  return {
    ...row,
    wearKm,
    wearPct,
    remainingKm: Math.max(0, Math.round((row.maxKm - row.wearKm) * 10) / 10),
    status,
  };
}

module.exports = { DEFAULT_MAX_KM, WEAR_SELECT, decorate };
