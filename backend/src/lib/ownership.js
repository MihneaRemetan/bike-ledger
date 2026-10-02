const { one } = require('../db/pool');
const { HttpError } = require('./http');

async function assertBikeOwner(bikeId, userId, client) {
  const bike = await one('SELECT * FROM bikes WHERE id = $1 AND user_id = $2', [bikeId, userId], client);
  if (!bike) throw new HttpError(404, 'Bike not found');
  return bike;
}

const TABLES = { components: 'components', rides: 'rides', services: 'services' };

// Finds a row in a bike-owned table, only if its bike belongs to the user.
async function findOwned(table, id, userId, client) {
  if (!TABLES[table]) throw new Error(`Unknown table ${table}`);
  const row = await one(
    `SELECT t.* FROM ${TABLES[table]} t JOIN bikes b ON b.id = t.bike_id
     WHERE t.id = $1 AND b.user_id = $2`,
    [id, userId],
    client
  );
  if (!row) throw new HttpError(404, 'Not found');
  return row;
}

module.exports = { assertBikeOwner, findOwned };
