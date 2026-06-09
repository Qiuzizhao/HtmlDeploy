#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { openDatabase } = require('../src/db');

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

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function listDirectories(directory) {
  if (!fs.existsSync(directory)) {
    return [];
  }
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

const dataDir = path.resolve(getArg('data-dir', path.join(process.cwd(), 'data')));
const storageDir = path.resolve(getArg('storage-dir', path.join(process.cwd(), 'storage', 'sites')));
const dbFile = path.resolve(getArg('db-file', process.env.DATA_DB_FILE || path.join(dataDir, 'app.db')));
const strictOrphans = process.argv.includes('--strict-orphans');

try {
  const db = openDatabase({ dbFile });
  const sitesJson = readJson(path.join(dataDir, 'sites.json'), []);
  const classesJson = readJson(path.join(dataDir, 'classes.json'), []);
  const settingsJson = readJson(path.join(dataDir, 'settings.json'), {});
  const forbiddenWordsJson = Array.isArray(settingsJson.forbiddenWords)
    ? new Set(settingsJson.forbiddenWords.map((word) => String(word).toLocaleLowerCase())).size
    : 0;

  const sitesDb = db.prepare('SELECT COUNT(*) AS count FROM sites').get().count;
  const classesDb = db.prepare('SELECT COUNT(*) AS count FROM classes').get().count;
  const forbiddenWordsDb = db.prepare('SELECT COUNT(*) AS count FROM forbidden_words').get().count;
  const usageOrphans = db.prepare(`
    SELECT COUNT(*) AS count
    FROM site_usage u
    LEFT JOIN sites s ON s.id = u.site_id
    WHERE s.id IS NULL
  `).get().count;

  const activeSites = db.prepare("SELECT id, number FROM sites WHERE COALESCE(deleted_at, '') = ''").all();
  const activeIds = new Set(activeSites.map((site) => site.id));
  const storageIds = new Set(listDirectories(storageDir));
  const missingStorage = activeSites
    .filter((site) => !fs.existsSync(path.join(storageDir, site.id, 'index.html')))
    .map((site) => site.id);
  const orphanStorage = [...storageIds].filter((id) => !activeIds.has(id));
  const maxNumber = activeSites.reduce((max, site) => Math.max(max, Number.parseInt(site.number, 10) || 0), 0);
  const lastUsedRow = db.prepare("SELECT value FROM settings WHERE key = 'lastUsedSiteNumber'").get();
  const lastUsedSiteNumber = lastUsedRow ? Number(JSON.parse(lastUsedRow.value)) || 0 : 0;

  const result = {
    ok: true,
    dataDir,
    storageDir,
    dbFile,
    sitesJson: Array.isArray(sitesJson) ? sitesJson.length : 0,
    sitesDb,
    classesJson: Array.isArray(classesJson) ? classesJson.length : 0,
    classesDb,
    forbiddenWordsJson,
    forbiddenWordsDb,
    activeSites: activeSites.length,
    missingStorageCount: missingStorage.length,
    missingStorage,
    orphanStorageCount: orphanStorage.length,
    orphanStorage,
    usageOrphans,
    maxNumber,
    lastUsedSiteNumber
  };

  const failures = [];
  if (Array.isArray(sitesJson) && sitesJson.length && sitesDb < sitesJson.length) {
    failures.push('SQLite sites count is lower than sites.json count');
  }
  if (Array.isArray(classesJson) && classesJson.length && classesDb < classesJson.length) {
    failures.push('SQLite classes count is lower than classes.json count');
  }
  if (forbiddenWordsJson && forbiddenWordsDb < forbiddenWordsJson) {
    failures.push('SQLite forbidden words count is lower than settings.json count');
  }
  if (missingStorage.length) {
    failures.push('Active site storage is missing');
  }
  if (usageOrphans) {
    failures.push('site_usage contains orphan site_id rows');
  }
  if (lastUsedSiteNumber < maxNumber) {
    failures.push('lastUsedSiteNumber is lower than max active site number');
  }
  if (strictOrphans && orphanStorage.length) {
    failures.push('Storage contains orphan project directories');
  }

  if (failures.length) {
    result.ok = false;
    result.failures = failures;
    console.error(JSON.stringify(result, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    dataDir,
    storageDir,
    dbFile,
    error: error.message
  }, null, 2));
  process.exit(1);
}
