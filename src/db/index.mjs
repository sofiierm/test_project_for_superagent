// Хранилище: встроенный SQLite (node:sqlite), без внешних зависимостей.
// Схема создаётся идемпотентно при старте, поэтому сервис запускается
// на пустом каталоге data/.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../config.mjs';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS accounts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  platform      TEXT NOT NULL CHECK (platform IN ('instagram', 'youtube', 'tiktok')),
  handle        TEXT NOT NULL,
  display_name  TEXT NOT NULL DEFAULT '',
  url           TEXT NOT NULL DEFAULT '',
  avatar_url    TEXT NOT NULL DEFAULT '',
  bio           TEXT NOT NULL DEFAULT '',
  followers     INTEGER NOT NULL DEFAULT 0,
  following     INTEGER NOT NULL DEFAULT 0,
  posts_count   INTEGER NOT NULL DEFAULT 0,
  notes         TEXT NOT NULL DEFAULT '',
  source        TEXT NOT NULL DEFAULT 'demo',
  added_at      TEXT NOT NULL,
  last_synced_at TEXT,
  sync_status   TEXT NOT NULL DEFAULT 'idle',
  sync_error    TEXT NOT NULL DEFAULT '',
  UNIQUE (platform, handle)
);

CREATE TABLE IF NOT EXISTS videos (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id      INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  external_id     TEXT NOT NULL,
  url             TEXT NOT NULL DEFAULT '',
  title           TEXT NOT NULL DEFAULT '',
  description     TEXT NOT NULL DEFAULT '',
  transcript      TEXT NOT NULL DEFAULT '',
  hashtags        TEXT NOT NULL DEFAULT '[]',
  published_at    TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  views           INTEGER NOT NULL DEFAULT 0,
  likes           INTEGER NOT NULL DEFAULT 0,
  comments        INTEGER NOT NULL DEFAULT 0,
  shares          INTEGER NOT NULL DEFAULT 0,
  saves           INTEGER NOT NULL DEFAULT 0,
  thumbnail_url   TEXT NOT NULL DEFAULT '',
  language        TEXT NOT NULL DEFAULT 'ru',
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE (account_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_videos_account ON videos(account_id);
CREATE INDEX IF NOT EXISTS idx_videos_published ON videos(published_at DESC);

CREATE TABLE IF NOT EXISTS metric_snapshots (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id    INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  taken_at    TEXT NOT NULL,
  views       INTEGER NOT NULL DEFAULT 0,
  likes       INTEGER NOT NULL DEFAULT 0,
  comments    INTEGER NOT NULL DEFAULT 0,
  shares      INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_snapshots_video ON metric_snapshots(video_id, taken_at);

CREATE TABLE IF NOT EXISTS sync_runs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id    INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider      TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'running',
  started_at    TEXT NOT NULL,
  finished_at   TEXT,
  videos_found  INTEGER NOT NULL DEFAULT 0,
  videos_new    INTEGER NOT NULL DEFAULT 0,
  message       TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_sync_runs_account ON sync_runs(account_id, started_at DESC);
`;

let instance = null;

export function getDb(dbPath = config.dbPath) {
  if (instance) return instance;
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  instance = new DatabaseSync(dbPath);
  instance.exec(SCHEMA);
  return instance;
}

export function closeDb() {
  if (instance) {
    try { instance.close(); } catch { /* уже закрыта */ }
    instance = null;
  }
}

export function transaction(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
