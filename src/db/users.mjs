// Репозиторий пользователей и сессий.
//
// Наружу — camelCase, как в остальных репозиториях. Пароли и токены наружу не
// отдаются никогда: `mapUser` не содержит `passwordHash`, а сессии
// возвращаются без `tokenHash`.
import { getDb } from './index.mjs';
import { nowIso } from '../lib/dates.mjs';

export const ROLES = ['owner', 'viewer'];

function mapUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at ?? null,
  };
}

export function normaliseEmail(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function countUsers(db = getDb()) {
  return db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
}

export function listUsers(db = getDb()) {
  return db.prepare('SELECT id, email, name, role, created_at, last_login_at FROM users ORDER BY id')
    .all().map(mapUser);
}

// `SELECT *` здесь был бы утечкой: `mapUser` не отдаёт хеш, но полагаться на
// это в каждом запросе опасно — явный список колонок надёжнее.
const PUBLIC_COLUMNS = 'id, email, name, role, created_at, last_login_at';

export function getUser(id, db = getDb()) {
  return mapUser(db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = ?`).get(Number(id)));
}

export function getUserByEmail(email, db = getDb()) {
  return mapUser(db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE email = ?`).get(normaliseEmail(email)));
}

/** Хеш пароля — отдельно от `getUser`: наружу он не должен попадать случайно. */
export function getPasswordHash(email, db = getDb()) {
  const row = db.prepare('SELECT password_hash FROM users WHERE email = ?').get(normaliseEmail(email));
  return row?.password_hash ?? null;
}

export function insertUser({ email, name = '', passwordHash, role = 'viewer' }, db = getDb()) {
  const info = db.prepare(`
    INSERT INTO users (email, name, password_hash, role, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(normaliseEmail(email), String(name ?? ''), passwordHash, ROLES.includes(role) ? role : 'viewer', nowIso());
  return getUser(Number(info.lastInsertRowid), db);
}

export function updateUser(id, { name, role, passwordHash }, db = getDb()) {
  const fields = [];
  const values = [];
  if (name !== undefined) { fields.push('name = ?'); values.push(String(name)); }
  if (role !== undefined && ROLES.includes(role)) { fields.push('role = ?'); values.push(role); }
  if (passwordHash !== undefined) { fields.push('password_hash = ?'); values.push(passwordHash); }
  if (!fields.length) return getUser(id, db);
  values.push(Number(id));
  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getUser(id, db);
}

export function touchLogin(id, db = getDb()) {
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(nowIso(), Number(id));
}

export function deleteUser(id, db = getDb()) {
  return db.prepare('DELETE FROM users WHERE id = ?').run(Number(id)).changes > 0;
}

// ---- Сессии ----

/**
 * Создание сессии. В базу попадает только хеш токена, сам токен уходит в
 * cookie и больше нигде не хранится.
 */
export function insertSession({ userId, tokenHash, expiresAt, userAgent = '', ip = '' }, db = getDb()) {
  db.prepare(`
    INSERT INTO sessions (user_id, token_hash, created_at, expires_at, user_agent, ip)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(Number(userId), tokenHash, nowIso(), expiresAt, String(userAgent ?? '').slice(0, 300), String(ip ?? '').slice(0, 64));
}

/**
 * Поиск пользователя по хешу токена.
 *
 * Просроченные сессии отфильтровываются в SQL: если проверять срок в JS, то
 * забытая ветка легко пропустит истёкшую сессию. Сравнение с текущим временем
 * идёт как строковое — ISO-8601 в UTC сравнивается лексикографически корректно.
 */
export function findUserBySession(tokenHash, { now = new Date() } = {}, db = getDb()) {
  const row = db.prepare(`
    SELECT u.id, u.email, u.name, u.role, u.created_at, u.last_login_at FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `).get(String(tokenHash), new Date(now).toISOString());
  return mapUser(row);
}

export function deleteSession(tokenHash, db = getDb()) {
  return db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(String(tokenHash)).changes > 0;
}

export function deleteUserSessions(userId, db = getDb()) {
  return db.prepare('DELETE FROM sessions WHERE user_id = ?').run(Number(userId)).changes;
}

/** Уборка просроченных сессий: вызывается при входе, чтобы таблица не росла. */
export function purgeExpiredSessions({ now = new Date() } = {}, db = getDb()) {
  return db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date(now).toISOString()).changes;
}

export function listSessions(userId, db = getDb()) {
  return db.prepare(`
    SELECT id, created_at, expires_at, user_agent, ip FROM sessions
    WHERE user_id = ? ORDER BY created_at DESC
  `).all(Number(userId)).map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    userAgent: row.user_agent,
    ip: row.ip,
  }));
}
