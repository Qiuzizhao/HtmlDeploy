#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/home/ubuntu/HtmlDeploy}"
BACKUP_DIR="${BACKUP_DIR:-/home/ubuntu/backups/htmldeploy}"
STAMP="$(date +%Y%m%d-%H%M%S)"

mkdir -p "$BACKUP_DIR"

if [ -f "$APP_DIR/data/app.db" ]; then
  if command -v sqlite3 >/dev/null 2>&1; then
    sqlite3 "$APP_DIR/data/app.db" ".backup '$BACKUP_DIR/app-$STAMP.db'"
  else
    DB_FILE="$APP_DIR/data/app.db" BACKUP_FILE="$BACKUP_DIR/app-$STAMP.db" node <<'NODE'
const Database = require('better-sqlite3');

const db = new Database(process.env.DB_FILE, { readonly: true, fileMustExist: true });
db.backup(process.env.BACKUP_FILE)
  .then(() => {
    db.close();
  })
  .catch((error) => {
    db.close();
    console.error(error.message);
    process.exit(1);
  });
NODE
  fi
fi

if [ -d "$APP_DIR/storage" ]; then
  tar -czf "$BACKUP_DIR/storage-$STAMP.tgz" -C "$APP_DIR" storage
fi

find "$BACKUP_DIR" -type f -mtime +14 -delete
echo "Backup written to $BACKUP_DIR with stamp $STAMP"
