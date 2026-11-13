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
  -- Расписание фоновой синхронизации. NULL в sync_interval_minutes значит
  -- «как у всех»: берётся глобальный SYNC_INTERVAL_MINUTES.
  sync_interval_minutes INTEGER,
  next_sync_at  TEXT,
  sync_attempts INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT NOT NULL DEFAULT '',
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

-- Пользователи и сессии (#7). Пароль хранится только как scrypt-хеш, токен
-- сессии — только как SHA-256: утечка базы не даёт ни паролей, ни готовых cookie.
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('owner', 'viewer')),
  created_at    TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  user_agent  TEXT NOT NULL DEFAULT '',
  ip          TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, expires_at DESC);

-- Токены официальных API (#8). Хранятся зашифрованными (AES-256-GCM): утечка
-- базы не должна отдавать доступ к чужим аккаунтам платформ.
CREATE TABLE IF NOT EXISTS platform_tokens (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id    INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  platform      TEXT NOT NULL,
  access_token  TEXT NOT NULL,
  refresh_token TEXT NOT NULL DEFAULT '',
  expires_at    TEXT,
  scope         TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (account_id)
);
`;

let instance = null;

// Колонки, добавленные после первой версии схемы. `CREATE TABLE IF NOT EXISTS`
// не меняет уже существующую таблицу, поэтому базу предыдущей версии нужно
// догонять явно — иначе сервис падает на «no such column: next_sync_at».
const ACCOUNT_MIGRATIONS = [
  ['sync_interval_minutes', 'INTEGER'],
  ['next_sync_at', 'TEXT'],
  ['sync_attempts', 'INTEGER NOT NULL DEFAULT 0'],
  ['last_error_code', "TEXT NOT NULL DEFAULT ''"],
  // Владение аккаунтом (#7). NULL значит «до появления пользователей»:
  // такие аккаунты достаются владельцу при первой настройке, а не теряются.
  ['owner_id', 'INTEGER REFERENCES users(id) ON DELETE CASCADE'],
];

function addColumns(db, table, migrations) {
  const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
  for (const [name, definition] of migrations) {
    if (!columns.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  }
}

function migrate(db) {
  addColumns(db, 'accounts', ACCOUNT_MIGRATIONS);
  // Индекс по владельцу создаём после миграции: на старой базе колонки ещё нет.
  db.exec('CREATE INDEX IF NOT EXISTS idx_accounts_owner ON accounts(owner_id)');
}

export function getDb(dbPath = config.dbPath) {
  if (instance) return instance;
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  instance = new DatabaseSync(dbPath);
  instance.exec(SCHEMA);
  migrate(instance);
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
