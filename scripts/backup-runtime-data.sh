#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/home/ubuntu/HtmlDeploy}"
BACKUP_DIR="${BACKUP_DIR:-/home/ubuntu/backups/htmldeploy}"
STAMP="$(date +%Y%m%d-%H%M%S)"

mkdir -p "$BACKUP_DIR"

if [ -f "$APP_DIR/data/app.db" ]; then
  sqlite3 "$APP_DIR/data/app.db" ".backup '$BACKUP_DIR/app-$STAMP.db'"
fi

if [ -d "$APP_DIR/storage" ]; then
  tar -czf "$BACKUP_DIR/storage-$STAMP.tgz" -C "$APP_DIR" storage
fi

find "$BACKUP_DIR" -type f -mtime +14 -delete
echo "Backup written to $BACKUP_DIR with stamp $STAMP"
