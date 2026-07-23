const fs = require('fs');
const path = require('path');
const { openDatabase } = require('./index');

const DEFAULT_CLASS_ID = '__unassigned__';

const storesByDbFile = new Map();

function nowIso() {
  return new Date().toISOString();
}

function readJsonFile(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function getJsonSnapshotMtimeMs(dataDir) {
  const files = [
    'sites.json',
    'classes.json',
    'settings.json',
    'private-ai-settings.json',
    'site-usage.json',
    'audit-log.json',
    'jobs.json'
  ];
  return files.reduce((latest, file) => {
    const filePath = path.join(dataDir, file);
    try {
      return Math.max(latest, fs.statSync(filePath).mtimeMs);
    } catch {
      return latest;
    }
  }, 0);
}

function normalizeBool(value, fallback = false) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === 0 || value === 1) {
    return Boolean(value);
  }
  return fallback;
}

function normalizeForbiddenWords(value) {
  const items = Array.isArray(value)
    ? value
    : String(value || '').split(/[\n,，、;；]+/);
  const seen = new Set();
  const words = [];
  for (const item of items) {
    const word = String(item || '').trim();
    const key = word.toLocaleLowerCase();
    if (!word || seen.has(key)) {
      continue;
    }
    seen.add(key);
    words.push(word);
  }
  return words.slice(0, 100000);
}

function normalizeSettings(settings = {}, { includeForbiddenWords = true, forbiddenWordsCount } = {}) {
  const { forbiddenWordsCount: _ignoredForbiddenWordsCount, ...baseSettings } = settings;
  const normalized = {
    ...baseSettings,
    allPassword: String(settings.allPassword || ''),
    allPasswordEnabled: settings.allPasswordEnabled !== false,
    lastUsedSiteNumber: Math.max(0, Number(settings.lastUsedSiteNumber) || 0),
    updatedAt: String(settings.updatedAt || '')
  };

  if (includeForbiddenWords) {
    normalized.forbiddenWords = normalizeForbiddenWords(settings.forbiddenWords);
  }

  if (forbiddenWordsCount !== undefined) {
    normalized.forbiddenWordsCount = Math.max(0, Number(forbiddenWordsCount) || 0);
  }

  return normalized;
}

function normalizeAiSettings(settings = {}) {
  return {
    apiKey: String(settings.apiKey || '').trim(),
    baseUrl: String(settings.baseUrl || '').trim(),
    model: String(settings.model || '').trim(),
    thinkingType: String(settings.thinkingType || '').trim(),
    thinkingOptimize: String(settings.thinkingOptimize || '').trim(),
    thinkingName: String(settings.thinkingName || '').trim(),
    temperature: settings.temperature === undefined ? undefined : Number(settings.temperature),
    nameTemperature: settings.nameTemperature === undefined ? undefined : Number(settings.nameTemperature),
    updatedAt: String(settings.updatedAt || '')
  };
}

function normalizeSite(site = {}) {
  const classId = String(site.classId || site.class_id || '').trim() || DEFAULT_CLASS_ID;
  return {
    id: String(site.id || '').trim(),
    number: String(site.number || '').trim(),
    title: String(site.title || '').trim(),
    author: String(site.author || '').trim(),
    classId,
    enabled: site.enabled !== false,
    starred: site.starred === true,
    forbiddenWhitelist: site.forbiddenWhitelist === true,
    forbiddenAuditField: String(site.forbiddenAuditField || ''),
    forbiddenAuditWord: String(site.forbiddenAuditWord || ''),
    forbiddenAuditMessage: String(site.forbiddenAuditMessage || ''),
    duplicateAuditKeepId: String(site.duplicateAuditKeepId || ''),
    duplicateAuditKeepTitle: String(site.duplicateAuditKeepTitle || ''),
    duplicateAuditMessage: String(site.duplicateAuditMessage || ''),
    storageBytes: Math.max(0, Number(site.storageBytes) || 0),
    storageUpdatedAt: String(site.storageUpdatedAt || ''),
    position: Math.max(0, Number(site.position) || 0),
    usagePreviewCount: Math.max(0, Number(site.usagePreviewCount) || 0),
    usageCodeCount: Math.max(0, Number(site.usageCodeCount) || 0),
    usageLastUsedAt: String(site.usageLastUsedAt || ''),
    createdAt: String(site.createdAt || nowIso()),
    updatedAt: String(site.updatedAt || ''),
    deletedAt: String(site.deletedAt || '')
  };
}

function rowToSite(row = {}) {
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    author: row.author,
    classId: row.class_id,
    enabled: row.enabled !== 0,
    starred: row.starred === 1,
    forbiddenWhitelist: row.forbidden_whitelist === 1,
    forbiddenAuditField: row.forbidden_audit_field || undefined,
    forbiddenAuditWord: row.forbidden_audit_word || undefined,
    forbiddenAuditMessage: row.forbidden_audit_message || undefined,
    duplicateAuditKeepId: row.duplicate_audit_keep_id || undefined,
    duplicateAuditKeepTitle: row.duplicate_audit_keep_title || undefined,
    duplicateAuditMessage: row.duplicate_audit_message || undefined,
    storageBytes: Math.max(0, Number(row.storage_bytes) || 0),
    storageUpdatedAt: row.storage_updated_at || '',
    position: Math.max(0, Number(row.position) || 0),
    usagePreviewCount: Math.max(0, Number(row.preview_count) || 0),
    usageCodeCount: Math.max(0, Number(row.code_count) || 0),
    usageLastUsedAt: row.last_used_at || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at || '',
    deletedAt: row.deleted_at || ''
  };
}

function rowToClass(row = {}) {
  return {
    id: row.id,
    name: row.name,
    password: row.password,
    uploadEnabled: row.upload_enabled !== 0,
    passwordEnabled: row.password_enabled !== 0,
    groupId: row.group_id || '',
    position: Math.max(0, Number(row.position) || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at || ''
  };
}

function normalizeStudentName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function rowToStudent(row = {}) {
  return {
    id: row.id,
    classId: row.class_id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at || ''
  };
}

function assertValidStudentName(name) {
  if (!name || name.length > 40) {
    const error = new Error('学生姓名必须为 1 到 40 个字符');
    error.code = 'STUDENT_NAME_INVALID';
    throw error;
  }
}

function normalizeClass(classItem = {}) {
  return {
    id: String(classItem.id || '').trim(),
    name: String(classItem.name || '').trim(),
    password: String(classItem.password || '').trim(),
    uploadEnabled: classItem.uploadEnabled !== false,
    passwordEnabled: classItem.passwordEnabled !== false,
    groupId: String(classItem.groupId || '').trim(),
    position: Math.max(0, Number(classItem.position) || 0),
    createdAt: String(classItem.createdAt || nowIso()),
    updatedAt: String(classItem.updatedAt || '')
  };
}

function rowToClassGroup(row = {}) {
  return {
    id: row.id,
    name: row.name,
    position: Math.max(0, Number(row.position) || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at || ''
  };
}

function normalizeClassGroup(group = {}) {
  return {
    id: String(group.id || '').trim(),
    name: String(group.name || '').trim(),
    position: Math.max(0, Number(group.position) || 0),
    createdAt: String(group.createdAt || nowIso()),
    updatedAt: String(group.updatedAt || '')
  };
}

function normalizeAuditLog(log = {}) {
  const createdAt = String(log.createdAt || nowIso());
  return {
    id: String(log.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`),
    type: String(log.type || 'general').trim() || 'general',
    action: String(log.action || '').trim(),
    summary: String(log.summary || '').trim(),
    siteIds: Array.isArray(log.siteIds) ? log.siteIds.map(String) : [],
    details: log.details && typeof log.details === 'object' ? log.details : {},
    createdAt
  };
}

function normalizeJobLog(log = {}) {
  const createdAt = String(log.createdAt || nowIso());
  return {
    id: String(log.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`),
    type: String(log.type || 'general').trim() || 'general',
    text: String(log.text || '').trim(),
    status: ['running', 'success', 'error'].includes(log.status) ? log.status : 'running',
    time: String(log.time || new Date(createdAt).toLocaleTimeString('zh-CN', { hour12: false })),
    createdAt
  };
}

function parseUsageFile(value) {
  if (!value) {
    return {};
  }
  const entries = Array.isArray(value)
    ? value
    : Object.entries(value.logs && !value.siteId ? {} : value).map(([siteId, usage]) => ({ siteId, ...usage }));
  const usageById = {};
  for (const entry of entries) {
    const siteId = String(entry.siteId || entry.id || '').trim();
    if (!siteId) {
      continue;
    }
    usageById[siteId] = {
      siteId,
      usagePreviewCount: Math.max(0, Number(entry.usagePreviewCount) || 0),
      usageCodeCount: Math.max(0, Number(entry.usageCodeCount) || 0),
      usageLastUsedAt: String(entry.usageLastUsedAt || '')
    };
  }
  return usageById;
}

function newestTime(left, right) {
  const leftTime = Date.parse(left || '');
  const rightTime = Date.parse(right || '');
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
    return leftTime >= rightTime ? left : right;
  }
  return Number.isFinite(leftTime) ? left : right || left || '';
}

function getSiteNumberValue(site) {
  const number = Number.parseInt(String(site.number || ''), 10);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function formatSiteNumber(value) {
  return String(Math.max(1, Number(value) || 1)).padStart(5, '0');
}

function normalizeSiteNumbers(sites) {
  const normalized = (Array.isArray(sites) ? sites : []).map((site, originalIndex) => ({
    site: { ...site },
    originalIndex,
    numberValue: getSiteNumberValue(site)
  }));
  const usedNumbers = new Set();
  const needsNumber = [];

  for (const item of normalized) {
    if (item.numberValue && !usedNumbers.has(item.numberValue)) {
      usedNumbers.add(item.numberValue);
      item.site.number = formatSiteNumber(item.numberValue);
    } else {
      needsNumber.push(item);
    }
  }

  let nextNumber = usedNumbers.size ? Math.max(...usedNumbers) + 1 : 1;
  needsNumber
    .sort((left, right) => {
      const leftTime = Date.parse(left.site.createdAt || '');
      const rightTime = Date.parse(right.site.createdAt || '');
      const leftHasTime = Number.isFinite(leftTime);
      const rightHasTime = Number.isFinite(rightTime);
      if (leftHasTime && rightHasTime && leftTime !== rightTime) {
        return leftTime - rightTime;
      }
      if (leftHasTime !== rightHasTime) {
        return leftHasTime ? -1 : 1;
      }
      return left.originalIndex - right.originalIndex;
    })
    .forEach((item) => {
      while (usedNumbers.has(nextNumber)) {
        nextNumber += 1;
      }
      item.site.number = formatSiteNumber(nextNumber);
      usedNumbers.add(nextNumber);
      nextNumber += 1;
    });

  return normalized.map((item) => item.site);
}

class RuntimeStore {
  constructor({ dbFile, dataDir }) {
    this.dbFile = dbFile;
    this.dataDir = dataDir;
    this.db = openDatabase({ dbFile });
    this.isMigrating = false;
  }

  ensureReady() {
    if (this.isMigrating) {
      return;
    }
    this.ensureMigratedFromJson();
  }

  getMeta(key) {
    return this.db.prepare('SELECT value FROM schema_meta WHERE key = ?').get(key)?.value || '';
  }

  setMeta(key, value) {
    this.db.prepare(`
      INSERT INTO schema_meta (key, value, updated_at)
      VALUES (@key, @value, @updatedAt)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run({ key, value: String(value), updatedAt: nowIso() });
  }

  ensureMigratedFromJson() {
    const latestJsonMtimeMs = getJsonSnapshotMtimeMs(this.dataDir);
    const importedJsonMtimeMs = Number(this.getMeta('migrated_json_mtime_ms')) || 0;
    if (this.getMeta('migrated_from_json_at') && latestJsonMtimeMs <= importedJsonMtimeMs) {
      return;
    }
    this.isMigrating = true;
    try {
      migrateJsonToSqlite({ store: this, dataDir: this.dataDir });
    } finally {
      this.isMigrating = false;
    }
  }

  ensureClass(classId) {
    const id = String(classId || DEFAULT_CLASS_ID).trim() || DEFAULT_CLASS_ID;
    const existing = this.db.prepare('SELECT id FROM classes WHERE id = ?').get(id);
    if (existing) {
      return id;
    }
    this.upsertClass({
      id,
      name: id === DEFAULT_CLASS_ID ? '未分班' : id,
      password: '000000',
      uploadEnabled: true,
      passwordEnabled: false,
      createdAt: nowIso(),
      updatedAt: nowIso()
    });
    return id;
  }

  upsertClass(classItem) {
    const item = normalizeClass(classItem);
    if (!item.id) {
      return;
    }
    this.db.prepare(`
      INSERT INTO classes (id, name, password, upload_enabled, password_enabled, group_id, created_at, updated_at, position)
      VALUES (@id, @name, @password, @uploadEnabled, @passwordEnabled, @groupId, @createdAt, @updatedAt, @position)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        password = excluded.password,
        upload_enabled = excluded.upload_enabled,
        password_enabled = excluded.password_enabled,
        group_id = excluded.group_id,
        created_at = COALESCE(classes.created_at, excluded.created_at),
        updated_at = excluded.updated_at,
        position = excluded.position
    `).run({
      id: item.id,
      name: item.name || item.id,
      password: item.password || '000000',
      uploadEnabled: item.uploadEnabled ? 1 : 0,
      passwordEnabled: item.passwordEnabled ? 1 : 0,
      groupId: item.groupId,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      position: item.position
    });
  }

  replaceClasses(classes) {
    const tx = this.db.transaction((items) => {
      this.db.prepare(`
        DELETE FROM classes
        WHERE id NOT IN (
          SELECT DISTINCT class_id FROM sites
          UNION
          SELECT DISTINCT class_id FROM students
        )
      `).run();
      for (const [position, item] of items.entries()) {
        this.upsertClass({ ...item, position });
      }
    });
    tx(Array.isArray(classes) ? classes : []);
  }

  listClasses() {
    this.ensureReady();
    return this.db.prepare(`
      SELECT c.*
      FROM classes c
      LEFT JOIN class_groups g ON g.id = c.group_id
      ORDER BY
        CASE WHEN c.group_id = '' OR g.id IS NULL THEN 1 ELSE 0 END ASC,
        g.position ASC,
        c.position ASC,
        c.created_at ASC,
        c.name ASC
    `).all().map(rowToClass);
  }

  upsertClassGroup(group) {
    this.ensureReady();
    const item = normalizeClassGroup(group);
    if (!item.id || !item.name) {
      return;
    }
    this.db.prepare(`
      INSERT INTO class_groups (id, name, position, created_at, updated_at)
      VALUES (@id, @name, @position, @createdAt, @updatedAt)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        position = excluded.position,
        updated_at = excluded.updated_at
    `).run(item);
  }

  replaceClassGroups(groups) {
    const tx = this.db.transaction((items) => {
      for (const [position, group] of items.entries()) {
        this.upsertClassGroup({ ...group, position });
      }
    });
    tx(Array.isArray(groups) ? groups : []);
  }

  listClassGroups() {
    this.ensureReady();
    return this.db.prepare('SELECT * FROM class_groups ORDER BY position ASC, created_at ASC, name ASC').all().map(rowToClassGroup);
  }

  deleteClassGroup(groupId) {
    this.ensureReady();
    const tx = this.db.transaction((id) => {
      this.db.prepare("UPDATE classes SET group_id = '' WHERE group_id = ?").run(id);
      return this.db.prepare('DELETE FROM class_groups WHERE id = ?').run(id).changes;
    });
    return tx(String(groupId || '').trim());
  }

  getSettings({ includeForbiddenWords = true, includeForbiddenWordsCount = true } = {}) {
    this.ensureReady();
    const rows = this.db.prepare('SELECT key, value FROM settings').all();
    const settings = {};
    for (const row of rows) {
      try {
        settings[row.key] = JSON.parse(row.value);
      } catch {
        settings[row.key] = row.value;
      }
    }
    let forbiddenWordsCount;
    if (includeForbiddenWords) {
      settings.forbiddenWords = this.listForbiddenWords();
      forbiddenWordsCount = settings.forbiddenWords.length;
    } else if (includeForbiddenWordsCount) {
      forbiddenWordsCount = this.countForbiddenWords();
    }
    return normalizeSettings(settings, { includeForbiddenWords, forbiddenWordsCount });
  }

  writeSettings(settings) {
    this.ensureReady();
    const normalized = normalizeSettings(settings);
    const tx = this.db.transaction(() => {
      const updatedAt = normalized.updatedAt || nowIso();
      for (const [key, value] of Object.entries(normalized)) {
        if (key === 'forbiddenWords') {
          continue;
        }
        const serialized = JSON.stringify(value === undefined ? null : value);
        this.db.prepare(`
          INSERT INTO settings (key, value, updated_at)
          VALUES (@key, @value, @updatedAt)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        `).run({ key, value: serialized, updatedAt });
      }
      this.replaceForbiddenWords(normalized.forbiddenWords);
    });
    tx();
  }

  listForbiddenWords() {
    return this.db.prepare('SELECT word FROM forbidden_words ORDER BY position ASC, word ASC').all().map((row) => row.word);
  }

  countForbiddenWords() {
    this.ensureReady();
    return Number(this.db.prepare('SELECT COUNT(*) AS count FROM forbidden_words').get()?.count) || 0;
  }

  replaceForbiddenWords(words) {
    const normalized = normalizeForbiddenWords(words);
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM forbidden_words').run();
      const insert = this.db.prepare(`
        INSERT INTO forbidden_words (word, created_at, updated_at, position)
        VALUES (@word, @createdAt, @updatedAt, @position)
        ON CONFLICT(word) DO UPDATE SET
          updated_at = excluded.updated_at,
          position = excluded.position
      `);
      const createdAt = nowIso();
      normalized.forEach((word, position) => {
        insert.run({ word, createdAt, updatedAt: createdAt, position });
      });
    });
    tx();
  }

  getAiSettings() {
    this.ensureReady();
    const row = this.db.prepare('SELECT * FROM ai_settings WHERE id = 1').get();
    if (!row) {
      return normalizeAiSettings();
    }
    return normalizeAiSettings({
      apiKey: row.api_key,
      baseUrl: row.base_url,
      model: row.model,
      thinkingType: row.thinking_type,
      thinkingOptimize: row.thinking_optimize,
      thinkingName: row.thinking_name,
      temperature: row.temperature,
      nameTemperature: row.name_temperature,
      updatedAt: row.updated_at
    });
  }

  writeAiSettings(settings) {
    this.ensureReady();
    const normalized = normalizeAiSettings(settings);
    this.db.prepare(`
      INSERT INTO ai_settings (id, api_key, base_url, model, thinking_type, thinking_optimize, thinking_name, temperature, name_temperature, updated_at)
      VALUES (1, @apiKey, @baseUrl, @model, @thinkingType, @thinkingOptimize, @thinkingName, @temperature, @nameTemperature, @updatedAt)
      ON CONFLICT(id) DO UPDATE SET
        api_key = excluded.api_key,
        base_url = excluded.base_url,
        model = excluded.model,
        thinking_type = excluded.thinking_type,
        thinking_optimize = excluded.thinking_optimize,
        thinking_name = excluded.thinking_name,
        temperature = excluded.temperature,
        name_temperature = excluded.name_temperature,
        updated_at = excluded.updated_at
    `).run({
      ...normalized,
      updatedAt: normalized.updatedAt || nowIso()
    });
    return this.getAiSettings();
  }

  upsertSite(site) {
    const item = normalizeSite(site);
    if (!item.id) {
      return;
    }
    const classId = this.ensureClass(item.classId);
    this.db.prepare(`
      INSERT INTO sites (
        id, number, title, author, class_id, enabled, starred, forbidden_whitelist,
        forbidden_audit_field, forbidden_audit_word, forbidden_audit_message,
        duplicate_audit_keep_id, duplicate_audit_keep_title, duplicate_audit_message,
        storage_bytes, storage_updated_at, created_at, updated_at, deleted_at, position
      )
      VALUES (
        @id, @number, @title, @author, @classId, @enabled, @starred, @forbiddenWhitelist,
        @forbiddenAuditField, @forbiddenAuditWord, @forbiddenAuditMessage,
        @duplicateAuditKeepId, @duplicateAuditKeepTitle, @duplicateAuditMessage,
        @storageBytes, @storageUpdatedAt, @createdAt, @updatedAt, @deletedAt, @position
      )
      ON CONFLICT(id) DO UPDATE SET
        number = excluded.number,
        title = excluded.title,
        author = excluded.author,
        class_id = excluded.class_id,
        enabled = excluded.enabled,
        starred = excluded.starred,
        forbidden_whitelist = excluded.forbidden_whitelist,
        forbidden_audit_field = excluded.forbidden_audit_field,
        forbidden_audit_word = excluded.forbidden_audit_word,
        forbidden_audit_message = excluded.forbidden_audit_message,
        duplicate_audit_keep_id = excluded.duplicate_audit_keep_id,
        duplicate_audit_keep_title = excluded.duplicate_audit_keep_title,
        duplicate_audit_message = excluded.duplicate_audit_message,
        storage_bytes = excluded.storage_bytes,
        storage_updated_at = excluded.storage_updated_at,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        deleted_at = excluded.deleted_at,
        position = excluded.position
    `).run({
      ...item,
      classId,
      enabled: item.enabled ? 1 : 0,
      starred: item.starred ? 1 : 0,
      forbiddenWhitelist: item.forbiddenWhitelist ? 1 : 0
    });
  }

  replaceSites(sites) {
    this.ensureReady();
    const items = Array.isArray(sites) ? sites : [];
    const ids = new Set(items.map((site) => String(site.id || '').trim()).filter(Boolean));
    const tx = this.db.transaction(() => {
      for (const [position, site] of items.entries()) {
        this.upsertSite({ ...site, position });
        if (Number(site.usagePreviewCount) || Number(site.usageCodeCount) || site.usageLastUsedAt) {
          this.upsertUsage({
            siteId: site.id,
            usagePreviewCount: site.usagePreviewCount,
            usageCodeCount: site.usageCodeCount,
            usageLastUsedAt: site.usageLastUsedAt
          });
        }
      }
      if (ids.size) {
        const placeholders = Array.from(ids).map(() => '?').join(',');
        this.db.prepare(`DELETE FROM sites WHERE id NOT IN (${placeholders})`).run(...ids);
      } else {
        this.db.prepare('DELETE FROM sites').run();
      }
    });
    tx();
  }

  listSites() {
    this.ensureReady();
    return this.db.prepare(`
      SELECT s.*, u.preview_count, u.code_count, u.last_used_at
      FROM sites s
      LEFT JOIN site_usage u ON u.site_id = s.id
      ORDER BY s.position ASC, CAST(s.number AS INTEGER) DESC, s.created_at DESC, s.id ASC
    `).all().map(rowToSite);
  }

  getSite(siteId) {
    this.ensureReady();
    const id = String(siteId || '').trim();
    if (!id) {
      return null;
    }

    const row = this.db.prepare(`
      SELECT s.*, u.preview_count, u.code_count, u.last_used_at
      FROM sites s
      LEFT JOIN site_usage u ON u.site_id = s.id
      WHERE s.id = ?
    `).get(id);
    return row ? rowToSite(row) : null;
  }

  getClass(classId) {
    this.ensureReady();
    const id = String(classId || '').trim();
    if (!id) {
      return null;
    }

    const row = this.db.prepare('SELECT * FROM classes WHERE id = ?').get(id);
    return row ? rowToClass(row) : null;
  }

  assertStudentClass(classId) {
    const id = String(classId || '').trim();
    const existing = id && this.db.prepare('SELECT id FROM classes WHERE id = ?').get(id);
    if (!existing) {
      const error = new Error('班级不存在');
      error.code = 'CLASS_NOT_FOUND';
      throw error;
    }
    return id;
  }

  listStudents({ classId, query } = {}) {
    this.ensureReady();
    const filters = [];
    const values = [];
    const normalizedClassId = String(classId || '').trim();
    const normalizedQuery = normalizeStudentName(query);
    if (normalizedClassId) {
      filters.push('class_id = ?');
      values.push(normalizedClassId);
    }
    if (normalizedQuery) {
      filters.push('name LIKE ? COLLATE NOCASE');
      values.push(`%${normalizedQuery}%`);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    return this.db.prepare(`
      SELECT * FROM students
      ${where}
      ORDER BY name COLLATE NOCASE ASC, created_at ASC, id ASC
    `).all(...values).map(rowToStudent);
  }

  getStudent(studentId) {
    this.ensureReady();
    const id = String(studentId || '').trim();
    if (!id) {
      return null;
    }
    const row = this.db.prepare('SELECT * FROM students WHERE id = ?').get(id);
    return row ? rowToStudent(row) : null;
  }

  createStudent(student = {}) {
    this.ensureReady();
    const id = String(student.id || '').trim();
    const classId = this.assertStudentClass(student.classId);
    const name = normalizeStudentName(student.name);
    assertValidStudentName(name);
    const createdAt = String(student.createdAt || nowIso());
    const updatedAt = String(student.updatedAt || '');
    this.db.prepare(`
      INSERT INTO students (id, class_id, name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, classId, name, createdAt, updatedAt || null);
    return this.getStudent(id);
  }

  updateStudent(studentId, changes = {}) {
    this.ensureReady();
    const existing = this.getStudent(studentId);
    if (!existing) {
      return null;
    }
    const classId = Object.prototype.hasOwnProperty.call(changes, 'classId')
      ? this.assertStudentClass(changes.classId)
      : existing.classId;
    const name = Object.prototype.hasOwnProperty.call(changes, 'name')
      ? normalizeStudentName(changes.name)
      : existing.name;
    assertValidStudentName(name);
    this.db.prepare(`
      UPDATE students
      SET class_id = ?, name = ?, updated_at = ?
      WHERE id = ?
    `).run(classId, name, nowIso(), existing.id);
    return this.getStudent(existing.id);
  }

  importStudents({ classId, names, idGenerator } = {}) {
    this.ensureReady();
    const items = Array.isArray(names) ? names : [];
    if (items.length > 2000) {
      const error = new Error('一次最多导入 2,000 名学生');
      error.code = 'STUDENT_IMPORT_LIMIT';
      throw error;
    }
    const targetClassId = this.assertStudentClass(classId);
    const result = {
      added: 0,
      internalDuplicates: 0,
      existing: 0,
      invalid: 0,
      students: []
    };
    const nextId = typeof idGenerator === 'function'
      ? idGenerator
      : () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const selectByName = this.db.prepare('SELECT id FROM students WHERE class_id = ? AND name = ?');
    const insert = this.db.prepare(`
      INSERT INTO students (id, class_id, name, created_at, updated_at)
      VALUES (?, ?, ?, ?, NULL)
    `);
    const importTransaction = this.db.transaction((items) => {
      const seen = new Set();
      for (const value of items) {
        const name = normalizeStudentName(value);
        if (!name || name.length > 40) {
          result.invalid += 1;
          continue;
        }
        if (seen.has(name)) {
          result.internalDuplicates += 1;
          continue;
        }
        seen.add(name);
        if (selectByName.get(targetClassId, name)) {
          result.existing += 1;
          continue;
        }
        const id = String(nextId() || '').trim();
        const createdAt = nowIso();
        insert.run(id, targetClassId, name, createdAt);
        result.added += 1;
        result.students.push(rowToStudent({
          id,
          class_id: targetClassId,
          name,
          created_at: createdAt,
          updated_at: null
        }));
      }
    });
    importTransaction(items);
    return result;
  }

  deleteStudents(ids) {
    this.ensureReady();
    const uniqueIds = [...new Set((Array.isArray(ids) ? ids : [])
      .map((id) => String(id || '').trim())
      .filter(Boolean))];
    const remove = this.db.prepare('DELETE FROM students WHERE id = ?');
    const transaction = this.db.transaction((items) => items.reduce((removed, id) => removed + remove.run(id).changes, 0));
    return transaction(uniqueIds);
  }

  countStudentsByClass(classId) {
    this.ensureReady();
    const id = String(classId || '').trim();
    return this.db.prepare('SELECT COUNT(*) AS count FROM students WHERE class_id = ?').get(id).count;
  }

  getUsageById() {
    this.ensureReady();
    const rows = this.db.prepare('SELECT * FROM site_usage').all();
    const usageById = {};
    for (const row of rows) {
      usageById[row.site_id] = {
        siteId: row.site_id,
        usagePreviewCount: Math.max(0, Number(row.preview_count) || 0),
        usageCodeCount: Math.max(0, Number(row.code_count) || 0),
        usageLastUsedAt: row.last_used_at || ''
      };
    }
    return usageById;
  }

  replaceUsage(usageById) {
    this.ensureReady();
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM site_usage').run();
      for (const [siteId, usage] of Object.entries(usageById || {})) {
        this.upsertUsage({ siteId, ...usage });
      }
    });
    tx();
  }

  upsertUsage(usage) {
    const siteId = String(usage.siteId || usage.id || '').trim();
    if (!siteId) {
      return;
    }
    this.db.prepare(`
      INSERT INTO site_usage (site_id, preview_count, code_count, last_used_at)
      VALUES (@siteId, @previewCount, @codeCount, @lastUsedAt)
      ON CONFLICT(site_id) DO UPDATE SET
        preview_count = MAX(site_usage.preview_count, excluded.preview_count),
        code_count = MAX(site_usage.code_count, excluded.code_count),
        last_used_at = CASE
          WHEN excluded.last_used_at > COALESCE(site_usage.last_used_at, '') THEN excluded.last_used_at
          ELSE site_usage.last_used_at
        END
    `).run({
      siteId,
      previewCount: Math.max(0, Number(usage.usagePreviewCount) || 0),
      codeCount: Math.max(0, Number(usage.usageCodeCount) || 0),
      lastUsedAt: String(usage.usageLastUsedAt || '')
    });
  }

  incrementUsage(site, type) {
    this.ensureReady();
    const siteId = String(site?.id || '').trim();
    if (!siteId || !['preview', 'code'].includes(type)) {
      return null;
    }
    const previewInc = type === 'preview' ? 1 : 0;
    const codeInc = type === 'code' ? 1 : 0;
    const lastUsedAt = nowIso();
    this.db.prepare(`
      INSERT INTO site_usage (site_id, preview_count, code_count, last_used_at)
      VALUES (@siteId, @previewInc, @codeInc, @lastUsedAt)
      ON CONFLICT(site_id) DO UPDATE SET
        preview_count = preview_count + @previewInc,
        code_count = code_count + @codeInc,
        last_used_at = @lastUsedAt
    `).run({ siteId, previewInc, codeInc, lastUsedAt });
    return this.getSite(siteId);
  }

  listAuditLogs() {
    this.ensureReady();
    return this.db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 500').all().map((row) => ({
      id: row.id,
      type: row.type,
      action: row.action,
      summary: row.summary,
      siteIds: JSON.parse(row.site_ids_json || '[]'),
      details: JSON.parse(row.details_json || '{}'),
      createdAt: row.created_at
    }));
  }

  appendAuditLog(log) {
    this.ensureReady();
    const normalized = normalizeAuditLog(log);
    this.db.prepare(`
      INSERT INTO audit_logs (id, type, action, summary, site_ids_json, details_json, created_at)
      VALUES (@id, @type, @action, @summary, @siteIdsJson, @detailsJson, @createdAt)
      ON CONFLICT(id) DO UPDATE SET
        type = excluded.type,
        action = excluded.action,
        summary = excluded.summary,
        site_ids_json = excluded.site_ids_json,
        details_json = excluded.details_json,
        created_at = excluded.created_at
    `).run({
      id: normalized.id,
      type: normalized.type,
      action: normalized.action,
      summary: normalized.summary,
      siteIdsJson: JSON.stringify(normalized.siteIds),
      detailsJson: JSON.stringify(normalized.details),
      createdAt: normalized.createdAt
    });
    return normalized;
  }

  listJobLogs() {
    this.ensureReady();
    return this.db.prepare('SELECT * FROM job_logs ORDER BY created_at DESC LIMIT 300').all().map((row) => ({
      id: row.id,
      type: row.type,
      text: row.text,
      status: row.status,
      time: row.time,
      createdAt: row.created_at
    }));
  }

  replaceJobLogs(logs) {
    this.ensureReady();
    const tx = this.db.transaction((items) => {
      this.db.prepare('DELETE FROM job_logs').run();
      for (const log of items.slice(0, 300)) {
        const normalized = normalizeJobLog(log);
        if (!normalized.text) {
          continue;
        }
        this.db.prepare(`
          INSERT INTO job_logs (id, type, text, status, time, created_at)
          VALUES (@id, @type, @text, @status, @time, @createdAt)
        `).run(normalized);
      }
    });
    tx(Array.isArray(logs) ? logs : []);
  }

  appendJobLog(log) {
    this.ensureReady();
    const normalized = normalizeJobLog(log);
    if (!normalized.text) {
      const error = new Error('日志内容不能为空');
      error.status = 400;
      throw error;
    }
    this.db.prepare(`
      INSERT INTO job_logs (id, type, text, status, time, created_at)
      VALUES (@id, @type, @text, @status, @time, @createdAt)
      ON CONFLICT(id) DO UPDATE SET
        type = excluded.type,
        text = excluded.text,
        status = excluded.status,
        time = excluded.time,
        created_at = excluded.created_at
    `).run(normalized);
    return normalized;
  }
}

function migrateJsonToSqlite({ store, dataDir }) {
  const db = store.db;
  const tx = db.transaction(() => {
    const classes = readJsonFile(path.join(dataDir, 'classes.json'), []);
    const settings = readJsonFile(path.join(dataDir, 'settings.json'), {});
    const aiSettings = readJsonFile(path.join(dataDir, 'private-ai-settings.json'), {});
    const sites = readJsonFile(path.join(dataDir, 'sites.json'), []);
    const usage = parseUsageFile(readJsonFile(path.join(dataDir, 'site-usage.json'), {}));
    const auditRaw = readJsonFile(path.join(dataDir, 'audit-log.json'), []);
    const auditLogs = Array.isArray(auditRaw) ? auditRaw : Array.isArray(auditRaw.logs) ? auditRaw.logs : [];
    const jobsRaw = readJsonFile(path.join(dataDir, 'jobs.json'), []);
    const jobLogs = Array.isArray(jobsRaw) ? jobsRaw : Array.isArray(jobsRaw.logs) ? jobsRaw.logs : [];

    for (const [position, classItem] of (Array.isArray(classes) ? classes : []).entries()) {
      store.upsertClass({ ...classItem, position });
    }

    store.writeSettings(settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {});
    store.writeAiSettings(aiSettings && typeof aiSettings === 'object' && !Array.isArray(aiSettings) ? aiSettings : {});

    for (const [position, site] of normalizeSiteNumbers(sites).entries()) {
      const normalized = normalizeSite(site);
      store.upsertSite({ ...normalized, position });
      const splitUsage = usage[normalized.id] || {};
      store.upsertUsage({
        siteId: normalized.id,
        usagePreviewCount: Math.max(normalized.usagePreviewCount, Number(splitUsage.usagePreviewCount) || 0),
        usageCodeCount: Math.max(normalized.usageCodeCount, Number(splitUsage.usageCodeCount) || 0),
        usageLastUsedAt: newestTime(normalized.usageLastUsedAt, splitUsage.usageLastUsedAt)
      });
    }

    for (const log of auditLogs) {
      const normalized = normalizeAuditLog(log);
      if (normalized.summary || normalized.action) {
        store.appendAuditLog(normalized);
      }
    }

    for (const log of jobLogs) {
      const normalized = normalizeJobLog(log);
      if (normalized.text) {
        store.appendJobLog(normalized);
      }
    }

    store.setMeta('migrated_from_json_at', nowIso());
    store.setMeta('migrated_json_mtime_ms', getJsonSnapshotMtimeMs(dataDir));
    store.setMeta('last_json_snapshot', dataDir);
  });
  tx();

  return {
    sites: store.listSites().length,
    classes: store.listClasses().length,
    forbiddenWords: store.listForbiddenWords().length,
    auditLogs: store.listAuditLogs().length
  };
}

function createRuntimeStore(options = {}) {
  const dataDir = options.dataDir || process.cwd();
  const dbFile = options.dbFile || path.join(dataDir, 'app.db');
  const key = path.resolve(dbFile);
  if (!storesByDbFile.has(key)) {
    storesByDbFile.set(key, new RuntimeStore({ dbFile: key, dataDir }));
  }
  return storesByDbFile.get(key);
}

module.exports = {
  DEFAULT_CLASS_ID,
  RuntimeStore,
  createRuntimeStore,
  migrateJsonToSqlite,
  normalizeForbiddenWords,
  normalizeStudentName,
  parseUsageFile
};
