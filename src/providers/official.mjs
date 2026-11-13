// Официальные API платформ (#8).
//
// Разбор HTML хрупок: платформы меняют разметку и защиту. Официальный API
// отдаёт те же метрики в стабильном формате. Цена — ключ, квоты и то, что
// часть метрик API не отдаёт вовсе.
//
// Что реализовано честно:
//  • YouTube Data API v3 по ключу API — публичные данные канала, без OAuth.
//  • Для Instagram и TikTok нужен OAuth пользователя-владельца аккаунта:
//    без него API не отдаёт даже публичную статистику. Эти платформы
//    возвращают понятную ошибку, а не притворяются работающими.
//
// Квоты YouTube: поиск канала и список роликов стоят дорого, поэтому за один
// вызов делаем минимум запросов (channels + playlistItems + videos).
import { config } from '../config.mjs';

export class OfficialApiError extends Error {
  constructor(message, code = 'official_error', hint = '') {
    super(message);
    this.name = 'OfficialApiError';
    this.code = code;
    this.hint = hint;
  }
}

const API_ROOT = 'https://www.googleapis.com/youtube/v3';

/** Платформы, для которых официальный API доступен без OAuth владельца. */
export const SUPPORTED_PLATFORMS = ['youtube'];

/**
 * Какие метрики даёт каждый API.
 *
 * Это часть контракта: пользователь должен знать, что увидит, а что нет.
 * Возвращается в интерфейс и документацию, чтобы «нет просмотров» не выглядело
 * багом.
 */
export const CAPABILITIES = Object.freeze({
  youtube: Object.freeze({
    available: ['просмотры', 'лайки', 'комментарии', 'подписчики', 'количество роликов', 'дата публикации', 'длительность', 'описание', 'теги'],
    missing: ['сохранения', 'репосты', 'просмотры по источникам трафика', 'демография'],
    note: 'YouTube Data API не отдаёт сохранения и репосты: в отчётах они остаются нулевыми.',
  }),
  instagram: Object.freeze({
    available: [],
    missing: ['все метрики без OAuth владельца аккаунта'],
    note: 'Instagram Graph API требует авторизации владельца бизнес-аккаунта. Без неё официальный провайдер недоступен.',
  }),
  tiktok: Object.freeze({
    available: [],
    missing: ['все метрики без OAuth владельца аккаунта'],
    note: 'TikTok Display API требует авторизации владельца аккаунта. Без неё официальный провайдер недоступен.',
  }),
});

/** Настроен ли официальный провайдер: есть ли ключ YouTube. */
export function officialConfigured() {
  return Boolean(config.youtubeApiKey);
}

/**
 * Проверка доступности официального API.
 *
 * `platform` необязателен: без него проверяем, настроен ли провайдер вообще.
 */
export function probeOfficial(platform = null) {
  if (platform && !SUPPORTED_PLATFORMS.includes(platform)) {
    return {
      available: false,
      reason: CAPABILITIES[platform]?.note ?? `Для платформы «${platform}» официальный API не подключён.`,
      capabilities: CAPABILITIES[platform] ?? null,
    };
  }
  if (!officialConfigured()) {
    return {
      available: false,
      reason: 'YOUTUBE_API_KEY не задан — официальный провайдер выключен.',
      capabilities: platform ? CAPABILITIES[platform] : null,
    };
  }
  return {
    available: true,
    reason: 'ключ YouTube Data API задан',
    capabilities: platform ? CAPABILITIES[platform] : null,
  };
}

/**
 * Запрос к YouTube Data API.
 *
 * Ошибки API переводятся в понятные: «квота кончилась» и «ключ неверен» — это
 * разные действия пользователя, и валить их в одно «ошибка 403» бесполезно.
 */
async function apiGet(path, params, { fetchImpl = globalThis.fetch, timeoutMs = config.providerTimeoutMs } = {}) {
  const url = new URL(`${API_ROOT}/${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  url.searchParams.set('key', config.youtubeApiKey);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(url, { signal: controller.signal });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new OfficialApiError('YouTube API не ответил за отведённое время.', 'timeout',
        'Проверьте сеть или увеличьте PROVIDER_TIMEOUT_MS.');
    }
    throw new OfficialApiError(`YouTube API недоступен: ${error.message}`, 'network',
      'Проверьте доступ к googleapis.com с этого сервера.');
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const payload = await safeJson(response);
    const reason = payload?.error?.errors?.[0]?.reason ?? '';
    if (reason === 'quotaExceeded') {
      throw new OfficialApiError('Квота YouTube API на сегодня исчерпана.', 'quota',
        'Квота считается на проект и сбрасывается в полночь по тихоокеанскому времени. До этого используйте демо-режим.');
    }
    if (reason === 'keyInvalid' || reason === 'badRequest') {
      throw new OfficialApiError('YouTube API отклонил ключ.', 'bad_key',
        'Проверьте YOUTUBE_API_KEY и что для проекта включён YouTube Data API v3.');
    }
    if (reason === 'forbidden' || response.status === 403) {
      throw new OfficialApiError('YouTube API запретил запрос.', 'forbidden',
        'Возможно, ключ ограничен по IP или у проекта нет доступа к API.');
    }
    throw new OfficialApiError(
      `YouTube API ответил ${response.status}${reason ? ` (${reason})` : ''}.`,
      'api_error',
      'Повторите позже или переключитесь на другой провайдер.',
    );
  }
  return response.json();
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** ISO-8601 с секундами → ISO без изменений; YouTube отдаёт уже готовую строку. */
function publishDate(value) {
  if (!value) return new Date().toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

/** ISO-8601 duration (`PT1M30S`) → секунды. */
export function parseDuration(value) {
  const match = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(String(value ?? ''));
  if (!match) return 0;
  const [, d, h, m, s] = match;
  return (Number(d) || 0) * 86400 + (Number(h) || 0) * 3600 + (Number(m) || 0) * 60
    + Math.round(Number(s) || 0);
}

function toInt(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
}

/** Хештеги из описания: отдельного поля в API нет. */
function hashtagsFrom(description, tags) {
  const set = new Set();
  for (const match of String(description ?? '').matchAll(/#([\p{L}\p{N}_]{2,40})/gu)) set.add(match[1].toLowerCase());
  for (const tag of Array.isArray(tags) ? tags.slice(0, 12) : []) {
    const clean = String(tag).replace(/^#/, '').trim().toLowerCase();
    if (clean) set.add(clean);
  }
  return [...set].slice(0, 30);
}

/**
 * Профиль канала и последние ролики через YouTube Data API.
 *
 * Запросы:
 *  1. `channels` — профиль и playlist id загрузок;
 *  2. `playlistItems` — последние ролики (только id);
 *  3. `videos` — статистика и метаданные этих роликов одним запросом.
 * Три запроса вместо N+1: квота расходуется экономно.
 */
export async function fetchAccount(platform, handle, {
  limit = config.syncLimit, fetchImpl = globalThis.fetch,
} = {}) {
  if (!SUPPORTED_PLATFORMS.includes(platform)) {
    throw new OfficialApiError(
      CAPABILITIES[platform]?.note ?? `Официальный API для «${platform}» не подключён.`,
      'unsupported_platform',
      'Используйте PROVIDER=demo или PROVIDER=ytdlp для этой платформы.',
    );
  }
  if (!officialConfigured()) {
    throw new OfficialApiError(
      'Официальный провайдер выключен: не задан YOUTUBE_API_KEY.',
      'no_key',
      'Добавьте YOUTUBE_API_KEY в окружение или выберите другой провайдер.',
    );
  }

  const warnings = [];
  // Ищем канал по handle. `forHandle` поддерживает @ник и стоит 1 единицу квоты.
  const channelPayload = await apiGet('channels', {
    part: 'snippet,statistics,contentDetails',
    forHandle: handle.startsWith('@') ? handle : `@${handle}`,
  }, { fetchImpl });

  const channel = channelPayload?.items?.[0];
  if (!channel) {
    throw new OfficialApiError(
      `Канал «${handle}» не найден через YouTube API.`,
      'not_found',
      'Проверьте ник: API ищет только существующие публичные каналы.',
    );
  }

  const uploads = channel.contentDetails?.relatedPlaylists?.uploads;
  const account = {
    platform,
    handle,
    displayName: String(channel.snippet?.title ?? handle).slice(0, 120),
    url: `https://www.youtube.com/@${handle.replace(/^@/, '')}`,
    bio: String(channel.snippet?.description ?? '').slice(0, 2000),
    followers: toInt(channel.statistics?.subscriberCount),
    following: 0,
    postsCount: toInt(channel.statistics?.videoCount),
    avatarUrl: String(channel.snippet?.thumbnails?.high?.url ?? channel.snippet?.thumbnails?.default?.url ?? ''),
    source: 'official',
  };

  if (!uploads) {
    warnings.push('API не вернул список загрузок канала: ролики не синхронизированы.');
    return { account, videos: [], warnings };
  }

  // Скрытые подписчики — нормальное явление, но об этом стоит сказать: иначе
  // нулевой охват выглядит ошибкой сервиса.
  if (channel.statistics?.hiddenSubscriberCount) {
    warnings.push('Канал скрывает число подписчиков: в отчётах оно будет нулевым.');
  }

  const playlistPayload = await apiGet('playlistItems', {
    part: 'contentDetails',
    playlistId: uploads,
    maxResults: Math.min(50, Math.max(1, limit)),
  }, { fetchImpl });

  const ids = (playlistPayload?.items ?? [])
    .map((item) => item.contentDetails?.videoId)
    .filter(Boolean)
    .slice(0, Math.max(1, limit));

  if (!ids.length) {
    warnings.push('В канале нет доступных роликов: возможно, все скрыты или удалены.');
    return { account, videos: [], warnings };
  }

  const videosPayload = await apiGet('videos', {
    part: 'snippet,statistics,contentDetails',
    id: ids.join(','),
    maxResults: ids.length,
  }, { fetchImpl });

  const videos = (videosPayload?.items ?? []).map((item) => {
    const description = String(item.snippet?.description ?? '');
    return {
      externalId: String(item.id),
      url: `https://www.youtube.com/watch?v=${item.id}`,
      title: String(item.snippet?.title ?? 'Без названия').slice(0, 300),
      description: description.slice(0, 5000),
      transcript: '',
      hashtags: hashtagsFrom(description, item.snippet?.tags),
      publishedAt: publishDate(item.snippet?.publishedAt),
      durationSeconds: parseDuration(item.contentDetails?.duration),
      views: toInt(item.statistics?.viewCount),
      likes: toInt(item.statistics?.likeCount),
      comments: toInt(item.statistics?.commentCount),
      // Сохранения и репосты YouTube Data API не отдаёт: нули здесь — не сбой.
      shares: 0,
      saves: 0,
      thumbnailUrl: String(
        item.snippet?.thumbnails?.high?.url
        ?? item.snippet?.thumbnails?.medium?.url
        ?? item.snippet?.thumbnails?.default?.url
        ?? '',
      ),
      language: String(item.snippet?.defaultAudioLanguage ?? 'ru').slice(0, 8),
    };
  });

  const missing = ids.length - videos.length;
  if (missing > 0) {
    warnings.push(`${missing} ролик(ов) из списка недоступны через API (удалены или приватны).`);
  }
  if (videos.every((v) => v.views === 0)) {
    warnings.push('API вернул нулевые просмотры по всем роликам: проверьте, что канал публичный.');
  }

  return { account, videos, warnings };
}

/**
 * Обновление метрик одного ролика.
 *
 * Нужно для точечной синхронизации: список роликов уже есть, а метрики
 * устарели. Отдельный запрос дешевле, чем перечитывать весь канал.
 */
export async function refreshVideoStats(videoIds, { fetchImpl = globalThis.fetch } = {}) {
  const ids = (Array.isArray(videoIds) ? videoIds : []).filter(Boolean).slice(0, 50);
  if (!ids.length) return [];
  if (!officialConfigured()) {
    throw new OfficialApiError('Официальный провайдер выключен: не задан YOUTUBE_API_KEY.', 'no_key');
  }
  const payload = await apiGet('videos', {
    part: 'statistics', id: ids.join(','), maxResults: ids.length,
  }, { fetchImpl });
  return (payload?.items ?? []).map((item) => ({
    externalId: String(item.id),
    views: toInt(item.statistics?.viewCount),
    likes: toInt(item.statistics?.likeCount),
    comments: toInt(item.statistics?.commentCount),
  }));
}

export const providerName = 'official';
