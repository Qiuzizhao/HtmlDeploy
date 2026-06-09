const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { applySchema } = require('./schema');

function openDatabase(options = {}) {
  const dbFile = options.dbFile || process.env.DATA_DB_FILE || path.join(process.cwd(), 'data', 'app.db');
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });

  const db = new Database(dbFile);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  applySchema(db);
  return db;
}

module.exports = {
  openDatabase
};
