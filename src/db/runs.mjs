// Журнал синхронизаций: что и когда забирали у источника.
import { getDb } from './index.mjs';
import { nowIso } from '../lib/dates.mjs';

export function startRun(accountId, provider, db = getDb()) {
  const result = db.prepare(`
    INSERT INTO sync_runs (account_id, provider, status, started_at)
    VALUES (?, ?, 'running', ?)
  `).run(Number(accountId), provider ?? '', nowIso());
  return Number(result.lastInsertRowid);
}

export function finishRun(id, { status, videosFound = 0, videosNew = 0, message = '' }, db = getDb()) {
  db.prepare(`
    UPDATE sync_runs SET status = ?, finished_at = ?, videos_found = ?, videos_new = ?, message = ?
    WHERE id = ?
  `).run(status, nowIso(), videosFound, videosNew, message, Number(id));
}

export function listRuns({ accountId = null, limit = 20 } = {}, db = getDb()) {
  const where = accountId ? 'WHERE r.account_id = ?' : '';
  const params = accountId ? [Number(accountId)] : [];
  params.push(Math.max(1, Math.min(200, Number(limit) || 20)));
  return db.prepare(`
    SELECT r.*, a.platform, a.handle
    FROM sync_runs r JOIN accounts a ON a.id = r.account_id
    ${where}
    ORDER BY r.started_at DESC LIMIT ?
  `).all(...params);
}
