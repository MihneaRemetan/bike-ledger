const fs = require('fs'); // importa modulul fs din Node si il pune intr o variabila fs pt citire/scriere de fisiere
const path = require('path');
const { pool } = require('./pool');

const DIR = path.join(__dirname, 'migrations');
const LOCK_ID = 727274;

async function migrate({ log = console.log } = {}) {
  const client = await pool.connect(); // ia o conexiune dedicata din pool
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]); // pg_advisory_lock -> blocheaza executia daca alta instanta ruleaza deja migrarile
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         name TEXT PRIMARY KEY,
         applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`
    );
    const { rows } = await client.query('SELECT name FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.name)); // pune tot continutul schema_migrations intr un Set
    const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();

    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = fs.readFileSync(path.join(DIR, file), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        log(`migration applied: ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
  } finally { // elibereaza lock ul si returneaza conexiunea in pool, indiferent daca totul a mers sau a dat eroare
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    client.release();
  }
}

module.exports = { migrate };

if (require.main === module) {
  migrate()
    .then(() => pool.end())
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
