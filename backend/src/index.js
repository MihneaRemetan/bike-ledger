const config = require('./lib/config');
const { migrate } = require('./db/migrate');
const { createApp } = require('./app');

async function main() {
  await migrate();
  createApp().listen(config.port, () => console.log(`BikeLedger API listening on :${config.port}`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
