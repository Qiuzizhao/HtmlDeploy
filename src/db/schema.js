const SCHEMA_VERSION = '1';

function applySchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS classes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      password TEXT NOT NULL,
      upload_enabled INTEGER NOT NULL DEFAULT 1,
      password_enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_classes_created_at ON classes(created_at);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sites (
      id TEXT PRIMARY KEY,
      number TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      author TEXT NOT NULL,
      class_id TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      starred INTEGER NOT NULL DEFAULT 0,
      forbidden_whitelist INTEGER NOT NULL DEFAULT 0,
      forbidden_audit_field TEXT,
      forbidden_audit_word TEXT,
      forbidden_audit_message TEXT,
      duplicate_audit_keep_id TEXT,
      duplicate_audit_keep_title TEXT,
      duplicate_audit_message TEXT,
      storage_bytes INTEGER NOT NULL DEFAULT 0,
      storage_updated_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      deleted_at TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (class_id) REFERENCES classes(id)
    );

    CREATE INDEX IF NOT EXISTS idx_sites_class_id ON sites(class_id);
    CREATE INDEX IF NOT EXISTS idx_sites_enabled_deleted ON sites(enabled, deleted_at);
    CREATE INDEX IF NOT EXISTS idx_sites_starred_deleted ON sites(starred, deleted_at);
    CREATE INDEX IF NOT EXISTS idx_sites_number ON sites(number);
    CREATE INDEX IF NOT EXISTS idx_sites_created_at ON sites(created_at);
    CREATE INDEX IF NOT EXISTS idx_sites_title ON sites(title);
    CREATE INDEX IF NOT EXISTS idx_sites_author ON sites(author);
    CREATE INDEX IF NOT EXISTS idx_sites_position ON sites(position);

    CREATE TABLE IF NOT EXISTS site_usage (
      site_id TEXT PRIMARY KEY,
      preview_count INTEGER NOT NULL DEFAULT 0,
      code_count INTEGER NOT NULL DEFAULT 0,
      last_used_at TEXT,
      FOREIGN KEY (site_id) REFERENCES sites(id)
    );

    CREATE INDEX IF NOT EXISTS idx_site_usage_counts ON site_usage(preview_count, code_count);

    CREATE TABLE IF NOT EXISTS ai_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      api_key TEXT,
      base_url TEXT,
      model TEXT,
      thinking_type TEXT,
      temperature REAL,
      name_temperature REAL,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS forbidden_words (
      word TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      position INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_forbidden_words_word ON forbidden_words(word);
    CREATE INDEX IF NOT EXISTS idx_forbidden_words_position ON forbidden_words(position);

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      action TEXT NOT NULL,
      summary TEXT NOT NULL,
      site_ids_json TEXT NOT NULL DEFAULT '[]',
      details_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_type ON audit_logs(type);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);

    CREATE TABLE IF NOT EXISTS job_logs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      text TEXT NOT NULL,
      status TEXT NOT NULL,
      time TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_job_logs_created_at ON job_logs(created_at);
  `);

  const forbiddenColumns = db.prepare('PRAGMA table_info(forbidden_words)').all().map((column) => column.name);
  if (!forbiddenColumns.includes('position')) {
    db.exec('ALTER TABLE forbidden_words ADD COLUMN position INTEGER NOT NULL DEFAULT 0');
  }

  const siteColumns = db.prepare('PRAGMA table_info(sites)').all().map((column) => column.name);
  if (!siteColumns.includes('position')) {
    db.exec('ALTER TABLE sites ADD COLUMN position INTEGER NOT NULL DEFAULT 0');
  }

  const aiSettingsColumns = db.prepare('PRAGMA table_info(ai_settings)').all().map((column) => column.name);
  if (!aiSettingsColumns.includes('thinking_optimize')) {
    db.exec('ALTER TABLE ai_settings ADD COLUMN thinking_optimize TEXT');
  }
  if (!aiSettingsColumns.includes('thinking_name')) {
    db.exec('ALTER TABLE ai_settings ADD COLUMN thinking_name TEXT');
  }

  db.prepare(`
    INSERT INTO schema_meta (key, value, updated_at)
    VALUES ('schema_version', @value, @updatedAt)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `).run({
    value: SCHEMA_VERSION,
    updatedAt: new Date().toISOString()
  });
}

module.exports = {
  SCHEMA_VERSION,
  applySchema
};
