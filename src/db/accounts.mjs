// Репозиторий аккаунтов. Наружу — camelCase, как и в videos.mjs.
import { getDb } from './index.mjs';
import { nowIso } from '../lib/dates.mjs';

const PLATFORMS = new Set(['instagram', 'youtube', 'tiktok']);

export function mapAccount(row) {
  if (!row) return null;
  return {
    id: row.id,
    platform: row.platform,
    handle: row.handle,
    displayName: row.display_name,
    url: row.url,
    avatarUrl: row.avatar_url,
    bio: row.bio,
    followers: row.followers,
    following: row.following,
    postsCount: row.posts_count,
    notes: row.notes,
    source: row.source,
    addedAt: row.added_at,
    lastSyncedAt: row.last_synced_at,
    syncStatus: row.sync_status,
    syncError: row.sync_error,
    syncIntervalMinutes: row.sync_interval_minutes ?? null,
    nextSyncAt: row.next_sync_at ?? null,
    syncAttempts: row.sync_attempts ?? 0,
    lastErrorCode: row.last_error_code ?? '',
    ownerId: row.owner_id ?? null,
    videosCount: row.videos_count ?? 0,
    totalViews: row.total_views ?? 0,
    totalEngagements: row.total_engagements ?? 0,
    lastPublishedAt: row.last_published_at ?? null,
  };
}

/**
 * Список аккаунтов.
 *
 * `ownerId` — фильтр по владельцу (#7). `undefined` значит «все» (локальный
 * режим и внутренние вызовы), число — только аккаунты этого пользователя.
 * Различать эти два случая важно: `null` как «все» рано или поздно привёл бы
 * к показу чужих данных.
 */
export function listAccounts(db = getDb(), { ownerId } = {}) {
  const filter = Number.isInteger(ownerId) ? 'WHERE a.owner_id = ?' : '';
  const params = Number.isInteger(ownerId) ? [ownerId] : [];
  return db.prepare(`
    SELECT a.*,
           (SELECT COUNT(*) FROM videos v WHERE v.account_id = a.id) AS videos_count,
           (SELECT COALESCE(SUM(v.views), 0) FROM videos v WHERE v.account_id = a.id) AS total_views,
           -- Вовлечённость по определению ТЗ §5 включает сохранения.
           -- Без них ER аккаунта расходился с ER его же роликов.
           (SELECT COALESCE(SUM(v.likes + v.comments + v.shares + v.saves), 0) FROM videos v WHERE v.account_id = a.id) AS total_engagements,
           (SELECT MAX(v.published_at) FROM videos v WHERE v.account_id = a.id) AS last_published_at
    FROM accounts a
    ${filter}
    ORDER BY a.platform, a.handle
  `).all(...params).map(mapAccount);
}

export function getAccount(id, db = getDb()) {
  return mapAccount(db.prepare('SELECT * FROM accounts WHERE id = ?').get(Number(id)));
}

export function getAccountByHandle(platform, handle, db = getDb()) {
  return mapAccount(db.prepare('SELECT * FROM accounts WHERE platform = ? AND handle = ?')
    .get(platform, handle));
}

export function countAccounts(db = getDb()) {
  return db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n;
}

export function insertAccount(account, db = getDb()) {
  const result = db.prepare(`
    INSERT INTO accounts (platform, handle, display_name, url, avatar_url, bio,
                          followers, following, posts_count, notes, source, added_at, owner_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    account.platform,
    account.handle,
    account.displayName ?? '',
    account.url ?? '',
    account.avatarUrl ?? '',
    account.bio ?? '',
    Number(account.followers) || 0,
    Number(account.following) || 0,
    Number(account.postsCount) || 0,
    account.notes ?? '',
    account.source ?? 'demo',
    nowIso(),
    Number.isInteger(account.ownerId) ? account.ownerId : null,
  );
  return getAccount(result.lastInsertRowid, db);
}

export function updateAccount(id, patch, db = getDb()) {
  const allowed = new Map([
    ['display_name', 'displayName'], ['url', 'url'], ['avatar_url', 'avatarUrl'],
    ['bio', 'bio'], ['followers', 'followers'], ['following', 'following'],
    ['posts_count', 'postsCount'], ['notes', 'notes'], ['source', 'source'],
  ]);
  const sets = [];
  const values = [];
  for (const [column, key] of allowed) {
    if (patch[key] !== undefined) {
      sets.push(`${column} = ?`);
      values.push(patch[key]);
    }
  }
  if (!sets.length) return getAccount(id, db);
  values.push(Number(id));
  db.prepare(`UPDATE accounts SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  return getAccount(id, db);
}

export function setSyncState(id, {
  status, error = '', syncedAt, nextSyncAt, attempts, errorCode,
}, db = getDb()) {
  const sets = ['sync_status = ?', 'sync_error = ?'];
  const values = [status, error];
  if (syncedAt) { sets.push('last_synced_at = ?'); values.push(syncedAt); }
  if (nextSyncAt !== undefined) { sets.push('next_sync_at = ?'); values.push(nextSyncAt); }
  if (attempts !== undefined) { sets.push('sync_attempts = ?'); values.push(Number(attempts) || 0); }
  if (errorCode !== undefined) { sets.push('last_error_code = ?'); values.push(String(errorCode ?? '')); }
  values.push(Number(id));
  db.prepare(`UPDATE accounts SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  return getAccount(id, db);
}

/**
 * Планирование следующего запуска без изменения статуса синхронизации.
 * Используется, когда расписание меняют из интерфейса или при старте сервиса.
 */
export function scheduleNext(id, { nextSyncAt, intervalMinutes }, db = getDb()) {
  const sets = [];
  const values = [];
  if (nextSyncAt !== undefined) { sets.push('next_sync_at = ?'); values.push(nextSyncAt); }
  if (intervalMinutes !== undefined) {
    sets.push('sync_interval_minutes = ?');
    values.push(intervalMinutes === null ? null : Math.max(1, Number(intervalMinutes) || 1));
  }
  if (!sets.length) return getAccount(id, db);
  values.push(Number(id));
  db.prepare(`UPDATE accounts SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  return getAccount(id, db);
}

export function deleteAccount(id, db = getDb()) {
  return db.prepare('DELETE FROM accounts WHERE id = ?').run(Number(id));
}

export function isPlatform(value) {
  return PLATFORMS.has(String(value || '').toLowerCase());
}

export const platforms = [...PLATFORMS];
