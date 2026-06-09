#!/usr/bin/env node
const path = require('node:path');
const { RuntimeStore, migrateJsonToSqlite } = require('../src/db/runtime-store');

function getArg(name, fallback = '') {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }
  const index = process.argv.indexOf(`--${name}`);
  if (index !== -1 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }
  return fallback;
}

const dataDir = path.resolve(getArg('data-dir', path.join(process.cwd(), 'data')));
const dbFile = path.resolve(getArg('db-file', process.env.DATA_DB_FILE || path.join(dataDir, 'app.db')));

try {
  const store = new RuntimeStore({ dbFile, dataDir });
  const result = migrateJsonToSqlite({ store, dataDir });
  console.log(JSON.stringify({
    ok: true,
    dataDir,
    dbFile,
    ...result
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    dataDir,
    dbFile,
    error: error.message
  }, null, 2));
  process.exit(1);
}
