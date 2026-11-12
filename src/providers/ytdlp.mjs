// Живой источник данных на yt-dlp.
//
// Почему yt-dlp: это самый устойчивый открытый инструмент для публичных
// страниц YouTube, Instagram и TikTok. Он не требует ключей и работает с
// теми же публичными данными, что видит обычный посетитель.
//
// Честные ограничения, которые нельзя обойти кодом:
//  • платформы регулярно меняют разметку и включают защиту от автоматизации;
//  • Instagram и TikTok требуют cookies или прокси из «разрешённой» сети;
//  • метрика просмотров у TikTok на странице профиля неполная;
//  • yt-dlp должен быть установлен в окружении.
// Поэтому провайдер возвращает структурированную ошибку, а не выдуманные
// данные, и интерфейс предлагает демо-режим как запасной вариант.
import { execFile } from 'node:child_process';
import { config } from '../config.mjs';
import { buildProfileUrl } from '../lib/account-url.mjs';

const MAX_BUFFER = 24 * 1024 * 1024;

export class ProviderError extends Error {
  constructor(message, code = 'provider_error', hint = '') {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.hint = hint;
  }
}

function run(args, { timeoutMs = config.providerTimeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(config.ytDlpPath, args, {
      maxBuffer: MAX_BUFFER,
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    }, (error, stdout, stderr) => {
      if (error) {
        if (error.killed) {
          reject(new ProviderError(
            `Источник не ответил за ${Math.round(timeoutMs / 1000)} с.`,
            'timeout',
            'Попробуйте позже или увеличьте PROVIDER_TIMEOUT_MS.',
          ));
          return;
        }
        if (error.code === 'ENOENT') {
          reject(new ProviderError(
            'yt-dlp не установлен в этом окружении.',
            'ytdlp_missing',
            'Установите yt-dlp (pip install yt-dlp) или включите демо-режим: PROVIDER=demo.',
          ));
          return;
        }
        reject(classify(error, stderr || stdout || ''));
        return;
      }
      resolve(stdout);
    });
    child.stdin?.end();
  });
}

function classify(error, stderr) {
  const text = String(stderr || error.message || '');
  if (/Sign in to confirm|confirm you're not a bot|age-restricted/i.test(text)) {
    return new ProviderError(
      'Платформа требует подтверждения, что запрос делает человек.',
      'bot_check',
      'Для этого аккаунта нужны cookies авторизованной сессии или другой исходящий IP.',
    );
  }
  if (/login required|rate.?limit|429|too many requests/i.test(text)) {
    return new ProviderError(
      'Платформа ограничила частоту запросов.',
      'rate_limited',
      'Подождите 10–15 минут и повторите синхронизацию.',
    );
  }
  if (/private|not available|does not exist|404|unavailable/i.test(text)) {
    return new ProviderError(
      'Аккаунт не найден или закрыт для просмотра.',
      'not_found',
      'Проверьте написание ника и что профиль публичный.',
    );
  }
  if (/Unable to extract|Unable to download|no video|empty media|Unsupported URL/i.test(text)) {
    return new ProviderError(
      'Не удалось разобрать страницу аккаунта: платформа изменила формат или включила защиту.',
      'parse_failed',
      'Обновите yt-dlp (pip install -U yt-dlp) — поддержка платформ меняется еженедельно.',
    );
  }
  const firstLine = text.split('\n').find((line) => /ERROR/i.test(line)) || text.split('\n')[0];
  return new ProviderError(
    `Источник вернул ошибку: ${String(firstLine).slice(0, 240)}`,
    'provider_error',
  );
}

function toSeconds(value) {
  return Math.max(0, Math.round(Number(value) || 0));
}

function toInt(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function parseUploadDate(value) {
  if (!value) return null;
  const raw = String(value);
  // yt-dlp отдаёт YYYYMMDD для YouTube.
  if (/^\d{8}$/.test(raw)) {
    return new Date(`${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T12:00:00Z`).toISOString();
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizeEntry(entry, platform, handle) {
  const hashtags = new Set();
  const description = String(entry.description || '');
  for (const match of description.matchAll(/#([\p{L}\p{N}_]{2,40})/gu)) hashtags.add(match[1].toLowerCase());
  for (const match of String(entry.title || '').matchAll(/#([\p{L}\p{N}_]{2,40})/gu)) hashtags.add(match[1].toLowerCase());
  const directTags = Array.isArray(entry.tags) ? entry.tags : [];
  for (const tag of directTags.slice(0, 12)) {
    const clean = String(tag).replace(/^#/, '').trim().toLowerCase();
    if (clean) hashtags.add(clean);
  }

  const views = toInt(entry.view_count ?? entry.play_count ?? entry.viewCount);
  const likes = toInt(entry.like_count ?? entry.likeCount);
  const comments = toInt(entry.comment_count ?? entry.commentCount);
  const shares = toInt(entry.repost_count ?? entry.share_count);
  const duration = toSeconds(entry.duration);

  const publishedAt = parseUploadDate(entry.upload_date || entry.timestamp || entry.release_timestamp)
    || new Date().toISOString();

  return {
    externalId: String(entry.id || entry.display_id || entry.url || `${platform}-${Math.random()}`),
    url: String(entry.webpage_url || entry.url || ''),
    title: String(entry.title || entry.description?.split('\n')[0] || 'Без названия').slice(0, 300),
    description: description.slice(0, 5000),
    transcript: '',
    hashtags: [...hashtags].slice(0, 30),
    publishedAt,
    durationSeconds: duration,
    views,
    likes,
    comments,
    shares,
    saves: 0,
    thumbnailUrl: String(entry.thumbnail || ''),
    language: String(entry.language || 'ru').slice(0, 8),
    platform,
    handle,
  };
}

function normalizeChannel(info, platform, handle) {
  const followers = toInt(info.channel_follower_count ?? info.follower_count ?? info.uploader_follower_count);
  const postsCount = toInt(info.channel_video_count ?? info.playlist_count);
  return {
    platform,
    handle,
    displayName: String(info.channel || info.uploader || info.title || handle).slice(0, 120),
    url: String(info.channel_url || info.uploader_url || buildProfileUrl(platform, handle)),
    bio: String(info.description || '').slice(0, 2000),
    followers,
    following: 0,
    postsCount,
    avatarUrl: String(info.thumbnail || ''),
    source: 'ytdlp',
  };
}

function profileUrlFor(platform, handle) {
  return buildProfileUrl(platform, handle);
}

/**
 * Проверка доступности yt-dlp без сетевых запросов.
 */
export async function probeYtDlp() {
  try {
    const out = await run(['--version'], { timeoutMs: 10_000 });
    return { available: true, version: out.trim() };
  } catch (error) {
    return { available: false, version: null, error: error.message };
  }
}

/**
 * Загрузка профиля и последних роликов.
 * @returns {Promise<{account: object, videos: object[], warnings: string[]}>}
 */
export async function fetchAccount(platform, handle, { limit = config.syncLimit } = {}) {
  const url = profileUrlFor(platform, handle);
  const args = [
    '--no-warnings',
    '--ignore-errors',
    '--no-check-certificates',
    '--socket-timeout', '20',
    '--retries', '1',
    '--extractor-retries', '1',
    '--flat-playlist',
    '--playlist-end', String(Math.max(1, limit)),
    '--dump-single-json',
    '--no-progress',
    url,
  ];

  const stdout = await run(args, { timeoutMs: config.providerTimeoutMs });
  let payload;
  try {
    payload = JSON.parse(stdout);
  } catch {
    throw new ProviderError(
      'Ответ источника не является JSON: вероятно, платформа вернула страницу-заглушку.',
      'parse_failed',
      'Обновите yt-dlp и проверьте, открывается ли профиль в браузере без авторизации.',
    );
  }

  const entries = Array.isArray(payload.entries) ? payload.entries.filter(Boolean) : [];
  const warnings = [];
  if (!entries.length) {
    warnings.push('Источник не вернул ни одного ролика. Возможно, аккаунт закрыт или пуст.');
  }
  const missingMetrics = entries.filter((e) => !e.view_count && !e.play_count).length;
  if (missingMetrics && missingMetrics === entries.length) {
    warnings.push(
      'Источник не отдал просмотры по роликам: у TikTok и Instagram они часто скрыты на странице профиля. '
      + 'Метрики вовлечённости и анализ содержания при этом работают.',
    );
  }

  return {
    account: normalizeChannel(payload, platform, handle),
    videos: entries.map((entry) => normalizeEntry(entry, platform, handle)),
    warnings,
  };
}

export const providerName = 'ytdlp';
