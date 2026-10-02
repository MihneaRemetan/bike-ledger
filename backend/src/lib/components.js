const { query, one } = require('../db/pool');
const { HttpError } = require('./http');
const { findOwned } = require('./ownership');

const todayUtc = () => new Date().toISOString().slice(0, 10);

// Inserts a component together with its first mount (on `bikeId`, from the installation date).
async function insertComponent(client, d) {
  const created = await one(
    `INSERT INTO components (bike_id, type, brand, model, installed_at, initial_km, max_km, price, retired_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [d.bikeId, d.type, d.brand ?? null, d.model ?? null, d.installedAt, d.initialKm ?? 0, d.maxKm, d.price ?? null, d.retiredAt ?? null],
    client
  );
  await query('INSERT INTO component_mounts (component_id, bike_id, from_date) VALUES ($1,$2,$3)', [created.id, d.bikeId, d.installedAt], client);
  return created.id;
}

// Moves a part to another bike as of `date`: closes the current mount and opens a new one.
// Rides on the move day count for the new bike only.
async function moveComponent(client, component, bikeId, date) {
  if (component.retiredAt) throw new HttpError(400, 'A retired part cannot be moved');
  if (bikeId === component.bikeId) throw new HttpError(400, 'The part is already on this bike');
  const open = await one(
    'SELECT * FROM component_mounts WHERE component_id = $1 AND to_date IS NULL ORDER BY from_date DESC, id DESC LIMIT 1',
    [component.id],
    client
  );
  if (date < open.fromDate) throw new HttpError(400, 'Move date cannot be before the part was mounted on its current bike');
  await query('UPDATE component_mounts SET to_date = $1 WHERE id = $2', [date, open.id], client);
  await query('INSERT INTO component_mounts (component_id, bike_id, from_date) VALUES ($1,$2,$3)', [component.id, bikeId, date], client);
  await query('UPDATE components SET bike_id = $1 WHERE id = $2', [bikeId, component.id], client);
}

// Mount history of a part with the km it did on each bike.
async function mountsOf(componentId, client) {
  const rows = await query(
    `SELECT m.id, m.bike_id, b.name AS bike_name, m.from_date, m.to_date,
       COALESCE((
         SELECT SUM(r.distance_km) FROM rides r
         WHERE r.bike_id = m.bike_id
           AND (r.date AT TIME ZONE 'UTC')::date >= m.from_date
           AND (m.to_date IS NULL OR (r.date AT TIME ZONE 'UTC')::date < m.to_date)
           AND (c.retired_at IS NULL OR (r.date AT TIME ZONE 'UTC')::date < c.retired_at)
       ), 0) AS km
     FROM component_mounts m
     JOIN bikes b ON b.id = m.bike_id
     JOIN components c ON c.id = m.component_id
     WHERE m.component_id = $1 ORDER BY m.from_date, m.id`,
    [componentId],
    client
  );
  return rows.map((m) => ({ ...m, km: Math.round(m.km * 10) / 10 }));
}

// The component must belong to the user (404) and have been mounted on `bikeId` at some point (400).
// A part that later moved to another bike can still have older services and rules on its previous bike.
async function assertComponentOnBike(componentId, bikeId, userId, client) {
  const component = await findOwned('components', componentId, userId, client);
  const mounted = await one('SELECT 1 AS ok FROM component_mounts WHERE component_id = $1 AND bike_id = $2', [componentId, bikeId], client);
  if (!mounted) throw new HttpError(400, 'Component is not on this bike');
  return component;
}

module.exports = { assertComponentOnBike, todayUtc, insertComponent, moveComponent, mountsOf };
