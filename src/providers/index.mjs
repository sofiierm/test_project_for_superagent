// Выбор источника данных и синхронизация аккаунта.
//
// Режимы:
//  • demo     — детерминированные данные, работают всегда и без сети;
//  • ytdlp    — реальные публичные данные через yt-dlp (разбор страниц);
//  • official — официальные API платформ по ключу/токену (#8);
//  • auto     — official, если настроен ключ; иначе ytdlp, если установлен;
//               иначе demo (с явным предупреждением).
import { config } from '../config.mjs';
import { demoProfile, demoVideos } from './demo-data.mjs';
import { ProviderError, fetchAccount as fetchLive, probeYtDlp } from './ytdlp.mjs';
import {
  OfficialApiError, SUPPORTED_PLATFORMS, fetchAccount as fetchOfficial, officialConfigured, probeOfficial,
} from './official.mjs';
import { getDb } from '../db/index.mjs';
import { getAccount, insertAccount, setSyncState, updateAccount } from '../db/accounts.mjs';
import { recordSnapshot, upsertVideo } from '../db/videos.mjs';
import { finishRun, startRun } from '../db/runs.mjs';
import { nowIso } from '../lib/dates.mjs';
import { parseAccountInput } from '../lib/account-url.mjs';
import { intervalFor, nextRunAfterFailure, nextRunAfterSuccess } from '../lib/schedule.mjs';
import { clearInFlight, isSyncInFlight, markInFlight } from '../lib/sync-lock.mjs';

let cachedProbe = null;

export async function resolveProvider({ refresh = false } = {}) {
  if (config.provider === 'demo') return { name: 'demo', version: null, reason: 'режим demo задан в конфигурации' };

  if (config.provider === 'official') {
    const probe = probeOfficial();
    if (!probe.available) {
      // Сервис должен подняться и объяснить проблему в интерфейсе, а не упасть
      // на старте: иначе владелец видит трейс в консоли вместо страницы.
      // Официальные данные при этом не подменяются демо-данными молча —
      // добавление аккаунта вернёт понятную ошибку.
      return {
        name: 'official',
        version: 'v3',
        unavailable: true,
        reason: probe.reason,
        hint: 'Добавьте YOUTUBE_API_KEY или выберите PROVIDER=auto.',
      };
    }
    return { name: 'official', version: 'v3', reason: probe.reason };
  }

  if (config.provider === 'ytdlp') {
    const probe = await probeYtDlp();
    if (!probe.available) {
      throw new ProviderError(
        'Выбран режим ytdlp, но yt-dlp не найден.',
        'ytdlp_missing',
        'Установите yt-dlp или переключитесь на PROVIDER=demo.',
      );
    }
    return { name: 'ytdlp', version: probe.version, reason: 'режим ytdlp задан в конфигурации' };
  }
  // auto: официальный API предпочтительнее разбора HTML — он стабильнее и
  // не ломается от смены вёрстки. Но только если ключ действительно задан.
  if (officialConfigured()) {
    return { name: 'official', version: 'v3', reason: 'ключ YouTube Data API задан' };
  }
  if (!cachedProbe || refresh) cachedProbe = await probeYtDlp();
  if (cachedProbe.available) {
    return { name: 'ytdlp', version: cachedProbe.version, reason: 'yt-dlp найден в окружении' };
  }
  return {
    name: 'demo',
    version: null,
    reason: 'yt-dlp не найден — включён демо-режим, данные сгенерированы',
  };
}

/**
 * Добавление аккаунта: разбираем вход, забираем профиль и последние ролики.
 * Если живой источник недоступен, аккаунт создаётся в демо-режиме с честной
 * пометкой, а не падает с 500.
 */
export async function addAccount(input, { platformHint, notes = '', ownerId = null, db = getDb() } = {}) {
  const parsed = parseAccountInput(input, platformHint);
  const existing = db.prepare('SELECT id FROM accounts WHERE platform = ? AND handle = ?')
    .get(parsed.platform, parsed.handle);
  if (existing) {
    const error = new Error('Этот аккаунт уже добавлен.');
    error.code = 'duplicate';
    error.accountId = existing.id;
    throw error;
  }

  const provider = await resolveProvider();
  let accountData = null;
  let videos = [];
  let source = 'demo';
  let warning = '';

  if (provider.name === 'official') {
    if (!SUPPORTED_PLATFORMS.includes(parsed.platform)) {
      // Платформа без официального API: не выдаём демо-данные за официальные.
      const demo = demoProfile(parsed.platform, parsed.handle);
      accountData = demo ?? {
        platform: parsed.platform,
        handle: parsed.handle,
        displayName: parsed.handle,
        url: parsed.url,
        bio: '',
        followers: 0,
        following: 0,
        postsCount: 0,
        avatarUrl: '',
      };
      videos = demoVideos(parsed.platform, parsed.handle, { limit: config.syncLimit });
      source = 'demo';
      warning = `${probeOfficial(parsed.platform).reason} Показаны демонстрационные данные.`;
    } else {
      try {
        const result = await fetchOfficial(parsed.platform, parsed.handle, { limit: config.syncLimit });
        accountData = result.account;
        videos = result.videos;
        source = 'official';
        warning = result.warnings.join(' ');
      } catch (error) {
        if (!(error instanceof OfficialApiError)) throw error;
        throw error;
      }
    }
  } else if (provider.name === 'ytdlp') {
    try {
      const result = await fetchLive(parsed.platform, parsed.handle, { limit: config.syncLimit });
      accountData = result.account;
      videos = result.videos;
      source = 'ytdlp';
      warning = result.warnings.join(' ');
    } catch (error) {
      const demo = demoProfile(parsed.platform, parsed.handle);
      if (!demo) {
        throw error;
      }
      accountData = demo;
      videos = demoVideos(parsed.platform, parsed.handle, { limit: config.syncLimit });
      source = 'demo';
      warning = `Живой источник недоступен (${error.message}). Показаны демонстрационные данные.`;
    }
  } else {
    const demo = demoProfile(parsed.platform, parsed.handle);
    accountData = demo ?? {
      platform: parsed.platform,
      handle: parsed.handle,
      displayName: parsed.handle,
      url: parsed.url,
      bio: '',
      followers: 0,
      following: 0,
      postsCount: 0,
      avatarUrl: '',
    };
    videos = demoVideos(parsed.platform, parsed.handle, { limit: config.syncLimit });
    source = 'demo';
    if (!demo) {
      warning = 'Для этого аккаунта нет демо-профиля: метрики будут нулевыми до синхронизации с живым источником.';
    }
  }

  const account = insertAccount({
    ...parsed,
    ...accountData,
    platform: parsed.platform,
    handle: parsed.handle,
    notes,
    source,
    // Владелец из сессии (#7): без него аккаунт создался бы «ничей» и пропал
    // бы из списка своего же пользователя.
    ownerId,
  }, db);

  const runId = startRun(account.id, source, db);
  let created = 0;
  for (const video of videos) {
    const { created: isNew, id } = upsertVideo({ ...video, accountId: account.id }, db);
    if (isNew) created += 1;
    recordSnapshot(id, db);
  }

  finishRun(runId, {
    status: 'success',
    videosFound: videos.length,
    videosNew: created,
    message: warning,
  }, db);
  setSyncState(account.id, {
    status: 'success',
    error: '',
    syncedAt: nowIso(),
    attempts: 0,
    errorCode: '',
    // Новый аккаунт сразу попадает в расписание: иначе фоновая синхронизация
    // не подхватит его до перезапуска сервиса.
    nextSyncAt: nextRunAfterSuccess({
      intervalMinutes: intervalFor(account, config.syncIntervalMinutes),
      random: Math.random,
    }),
  }, db);

  return {
    account: getAccount(account.id, db),
    provider: source,
    videosFound: videos.length,
    videosNew: created,
    warning,
  };
}

/**
 * Повторная синхронизация существующего аккаунта.
 *
 * Один аккаунт не синхронизируется дважды одновременно: если снаружи уже
 * идёт запуск, возвращаем статус `busy`, а не начинаем второй. Это нужно и
 * планировщику, и ручной кнопке — иначе два похода в платформу приходят
 * одновременно, а второй запуск затирает состояние первого.
 */
export async function syncAccount(accountId, { db = getDb(), force = false } = {}) {
  const account = getAccount(accountId, db);
  if (!account) {
    const error = new Error('Аккаунт не найден.');
    error.code = 'not_found';
    throw error;
  }
  if (!force && isSyncInFlight(account.id)) {
    return {
      account,
      provider: account.source,
      status: 'busy',
      videosFound: 0,
      videosNew: 0,
      warning: '',
      error: 'Синхронизация этого аккаунта уже идёт.',
    };
  }

  markInFlight(account.id);
  try {
    return await performSync(account, { db });
  } finally {
    clearInFlight(account.id);
  }
}

async function performSync(account, { db }) {
  const provider = await resolveProvider();
  const effective = account.source === 'demo' ? 'demo' : provider.name;
  setSyncState(account.id, { status: 'running' }, db);
  const runId = startRun(account.id, effective, db);

  let videos = [];
  let warning = '';
  let status = 'success';
  let errorCode = '';

  if (effective === 'ytdlp') {
    try {
      const result = await fetchLive(account.platform, account.handle, { limit: config.syncLimit });
      videos = result.videos;
      warning = result.warnings.join(' ');
      updateAccount(account.id, {
        displayName: result.account.displayName || account.displayName,
        bio: result.account.bio || account.bio,
        followers: result.account.followers || account.followers,
        postsCount: result.account.postsCount || account.postsCount,
        avatarUrl: result.account.avatarUrl || account.avatarUrl,
      }, db);
    } catch (error) {
      status = 'error';
      errorCode = error.code || 'provider_error';
      warning = error.hint ? `${error.message} ${error.hint}` : error.message;
      finishRun(runId, { status, message: warning }, db);
      setSyncState(account.id, {
        status: 'error',
        error: warning,
        attempts: Number(account.syncAttempts) + 1,
        errorCode,
        nextSyncAt: nextRunAfterFailure({
          attempts: Number(account.syncAttempts) + 1,
          errorCode,
          baseMinutes: config.syncBackoffMinutes,
          maxMinutes: config.syncBackoffMaxMinutes,
          jitter: 0.1,
        }),
      }, db);
      return {
        account: getAccount(account.id, db),
        status,
        errorCode,
        error: warning,
        videosFound: 0,
        videosNew: 0,
        warning,
      };
    }
  } else {
    videos = demoVideos(account.platform, account.handle, { limit: config.syncLimit });
    if (!videos.length) {
      warning = 'Демо-профиль не найден, данные не изменились.';
    }
  }

  let created = 0;
  for (const video of videos) {
    const { created: isNew, id } = upsertVideo({ ...video, accountId: account.id }, db);
    if (isNew) created += 1;
    recordSnapshot(id, db);
  }

  finishRun(runId, { status, videosFound: videos.length, videosNew: created, message: warning }, db);
  setSyncState(account.id, {
    status: 'success',
    error: '',
    syncedAt: nowIso(),
    attempts: 0,
    errorCode: '',
    nextSyncAt: nextRunAfterSuccess({
      intervalMinutes: intervalFor(account, config.syncIntervalMinutes),
    }),
  }, db);
  return {
    account: getAccount(account.id, db),
    provider: effective,
    status,
    errorCode,
    videosFound: videos.length,
    videosNew: created,
    warning,
  };
}
