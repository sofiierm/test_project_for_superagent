// Репозиторий видео и снимков метрик.
//
// Наружу отдаём объекты в camelCase: анализ, страницы и API работают с одним
// набором имён полей. Раньше смешение snake_case из SQLite и camelCase в
// аналитике давало молчаливые нули в графиках — теперь преобразование ровно
// одно, на границе базы.
import { getDb } from './index.mjs';
import { nowIso } from '../lib/dates.mjs';

function parseHashtags(raw) {
  try {
    const value = JSON.parse(raw || '[]');
    return Array.isArray(value) ? value.map(String) : [];
  } catch {
    return [];
  }
}

export function engagementOf(video) {
  return (Number(video.likes) || 0) + (Number(video.comments) || 0)
    + (Number(video.shares) || 0) + (Number(video.saves) || 0);
}

export function engagementRateOf(video) {
  const views = Number(video.views) || 0;
  return views ? (engagementOf(video) / views) * 100 : 0;
}

export function mapVideo(row) {
  if (!row) return null;
  return {
    id: row.id,
    accountId: row.account_id,
    externalId: row.external_id,
    url: row.url,
    title: row.title,
    description: row.description,
    transcript: row.transcript,
    hashtags: parseHashtags(row.hashtags),
    publishedAt: row.published_at,
    durationSeconds: row.duration_seconds,
    views: row.views,
    likes: row.likes,
    comments: row.comments,
    shares: row.shares,
    saves: row.saves,
    thumbnailUrl: row.thumbnail_url,
    language: row.language,
    platform: row.platform,
    handle: row.handle,
    displayName: row.display_name,
    followers: row.followers,
    avatarUrl: row.avatar_url,
  };
}

const SELECT_VIDEO = `
  SELECT v.*, a.platform, a.handle, a.display_name, a.followers, a.avatar_url
  FROM videos v JOIN accounts a ON a.id = v.account_id
`;

/**
 * Список роликов.
 *
 * `ownerId` (#7) ограничивает выборку аккаунтами владельца. `undefined` —
 * локальный режим, где разделения нет. Передавать `null` как «все» нельзя:
 * это ровно та ошибка, из-за которой чужой ролик попал бы в выдачу.
 */
export function listVideos({
  accountId = null, platform = null, limit = 200, ownerId,
} = {}, db = getDb()) {
  const where = [];
  const params = [];
  if (accountId) { where.push('v.account_id = ?'); params.push(Number(accountId)); }
  if (platform) { where.push('a.platform = ?'); params.push(platform); }
  if (Number.isInteger(ownerId)) { where.push('a.owner_id = ?'); params.push(ownerId); }
  const sql = `${SELECT_VIDEO}
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY v.published_at DESC
    LIMIT ?`;
  params.push(Math.max(1, Math.min(5000, Number(limit) || 200)));
  return db.prepare(sql).all(...params).map(mapVideo);
}

export function getVideo(id, db = getDb()) {
  return mapVideo(db.prepare(`${SELECT_VIDEO} WHERE v.id = ?`).get(Number(id)));
}

export function getVideoByExternal(accountId, externalId, db = getDb()) {
  return mapVideo(db.prepare(`${SELECT_VIDEO} WHERE v.account_id = ? AND v.external_id = ?`)
    .get(Number(accountId), String(externalId)));
}

export function upsertVideo(input, db = getDb()) {
  const now = nowIso();
  const hashtags = JSON.stringify(Array.isArray(input.hashtags) ? input.hashtags : []);
  const existing = db.prepare('SELECT id FROM videos WHERE account_id = ? AND external_id = ?')
    .get(Number(input.accountId), String(input.externalId));

  if (existing) {
    db.prepare(`
      UPDATE videos SET url = ?, title = ?, description = ?, transcript = ?,
        hashtags = ?, published_at = ?, duration_seconds = ?, views = ?, likes = ?,
        comments = ?, shares = ?, saves = ?, thumbnail_url = ?, language = ?, updated_at = ?
      WHERE id = ?
    `).run(
      input.url ?? '', input.title ?? '', input.description ?? '', input.transcript ?? '',
      hashtags, input.publishedAt, Math.round(Number(input.durationSeconds) || 0),
      Math.round(Number(input.views) || 0), Math.round(Number(input.likes) || 0),
      Math.round(Number(input.comments) || 0), Math.round(Number(input.shares) || 0),
      Math.round(Number(input.saves) || 0), input.thumbnailUrl ?? '',
      input.language ?? 'ru', now, existing.id,
    );
    return { id: existing.id, created: false };
  }

  const result = db.prepare(`
    INSERT INTO videos (account_id, external_id, url, title, description, transcript,
                        hashtags, published_at, duration_seconds, views, likes, comments,
                        shares, saves, thumbnail_url, language, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    Number(input.accountId), String(input.externalId), input.url ?? '', input.title ?? '',
    input.description ?? '', input.transcript ?? '', hashtags, input.publishedAt,
    Math.round(Number(input.durationSeconds) || 0), Math.round(Number(input.views) || 0),
    Math.round(Number(input.likes) || 0), Math.round(Number(input.comments) || 0),
    Math.round(Number(input.shares) || 0), Math.round(Number(input.saves) || 0),
    input.thumbnailUrl ?? '', input.language ?? 'ru', now, now,
  );
  return { id: Number(result.lastInsertRowid), created: true };
}

export function recordSnapshot(videoId, db = getDb()) {
  const video = db.prepare('SELECT views, likes, comments, shares FROM videos WHERE id = ?')
    .get(Number(videoId));
  if (!video) return null;
  db.prepare(`
    INSERT INTO metric_snapshots (video_id, taken_at, views, likes, comments, shares)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(Number(videoId), nowIso(), video.views, video.likes, video.comments, video.shares);
  return true;
}

export function listSnapshots(videoId, db = getDb()) {
  return db.prepare(`
    SELECT * FROM metric_snapshots WHERE video_id = ? ORDER BY taken_at ASC
  `).all(Number(videoId)).map((row) => ({
    id: row.id,
    videoId: row.video_id,
    takenAt: row.taken_at,
    views: row.views,
    likes: row.likes,
    comments: row.comments,
    shares: row.shares,
  }));
}

export function countVideos(db = getDb()) {
  return db.prepare('SELECT COUNT(*) AS n FROM videos').get().n;
}
