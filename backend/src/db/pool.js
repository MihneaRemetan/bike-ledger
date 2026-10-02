const { Pool, types } = require('pg');
const config = require('../lib/config');

// DATE columns stay "YYYY-MM-DD" strings instead of JS Date objects
types.setTypeParser(1082, (v) => v);

const pool = new Pool({ connectionString: config.databaseUrl, options: '-c timezone=UTC' });

const camel = (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

function camelizeRow(row) {
  const out = {};
  for (const k of Object.keys(row)) out[camel(k)] = row[k];
  return out;
}

async function query(text, params = [], client = pool) {
  const res = await client.query(text, params);
  return res.rows.map(camelizeRow);
}

async function one(text, params = [], client = pool) {
  const rows = await query(text, params, client);
  return rows[0] || null;
}

async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

const snake = (s) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

// Builds "SET col = $n" fragments. Column names only come from the allowedFields whitelist.
function buildUpdate(data, allowedFields, startIndex = 1) {
  const sets = [];
  const values = [];
  for (const field of allowedFields) {
    if (data[field] === undefined) continue;
    values.push(data[field]);
    sets.push(`${snake(field)} = $${startIndex + values.length - 1}`);
  }
  return { sets, values };
}

module.exports = { pool, query, one, transaction, buildUpdate };
