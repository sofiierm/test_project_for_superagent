// Репозиторий обращений с формы «Обратная связь».
//
// Наружу — camelCase, как и в остальных репозиториях. Телефон хранится в
// каноническом виде `+7XXXXXXXXXX`, а форматируется уже на отображении:
// иначе один и тот же номер лежал бы в базе в десятке вариантов.
import { getDb } from './index.mjs';
import { nowIso } from '../lib/dates.mjs';

function mapFeedback(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    comment: row.comment,
    createdAt: row.created_at,
  };
}

export function insertFeedback({ name, phone, comment = '' }, db = getDb()) {
  const info = db.prepare(`
    INSERT INTO feedback (name, phone, comment, created_at)
    VALUES (?, ?, ?, ?)
  `).run(String(name), String(phone), String(comment ?? ''), nowIso());
  return getFeedback(Number(info.lastInsertRowid), db);
}

export function getFeedback(id, db = getDb()) {
  return mapFeedback(db.prepare('SELECT * FROM feedback WHERE id = ?').get(Number(id)));
}

export function listFeedback({ limit = 200 } = {}, db = getDb()) {
  const safeLimit = Math.min(Math.max(Number(limit) || 1, 1), 1000);
  return db.prepare('SELECT * FROM feedback ORDER BY created_at DESC, id DESC LIMIT ?')
    .all(safeLimit).map(mapFeedback);
}

export function countFeedback(db = getDb()) {
  return db.prepare('SELECT COUNT(*) AS n FROM feedback').get().n;
}

export function deleteFeedback(id, db = getDb()) {
  return db.prepare('DELETE FROM feedback WHERE id = ?').run(Number(id)).changes > 0;
}
