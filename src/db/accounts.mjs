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
    videosCount: row.videos_count ?? 0,
    totalViews: row.total_views ?? 0,
    totalEngagements: row.total_engagements ?? 0,
    lastPublishedAt: row.last_published_at ?? null,
  };
}

export function listAccounts(db = getDb()) {
  return db.prepare(`
    SELECT a.*,
           (SELECT COUNT(*) FROM videos v WHERE v.account_id = a.id) AS videos_count,
           (SELECT COALESCE(SUM(v.views), 0) FROM videos v WHERE v.account_id = a.id) AS total_views,
           (SELECT COALESCE(SUM(v.likes + v.comments + v.shares), 0) FROM videos v WHERE v.account_id = a.id) AS total_engagements,
           (SELECT MAX(v.published_at) FROM videos v WHERE v.account_id = a.id) AS last_published_at
    FROM accounts a
    ORDER BY a.platform, a.handle
  `).all().map(mapAccount);
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
                          followers, following, posts_count, notes, source, added_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

export function setSyncState(id, { status, error = '', syncedAt }, db = getDb()) {
  if (syncedAt) {
    db.prepare('UPDATE accounts SET sync_status = ?, sync_error = ?, last_synced_at = ? WHERE id = ?')
      .run(status, error, syncedAt, Number(id));
  } else {
    db.prepare('UPDATE accounts SET sync_status = ?, sync_error = ? WHERE id = ?')
      .run(status, error, Number(id));
  }
  return getAccount(id, db);
}

export function deleteAccount(id, db = getDb()) {
  return db.prepare('DELETE FROM accounts WHERE id = ?').run(Number(id));
}

export function isPlatform(value) {
  return PLATFORMS.has(String(value || '').toLowerCase());
}

export const platforms = [...PLATFORMS];
