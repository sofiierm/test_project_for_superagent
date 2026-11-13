// Сборка данных для страниц и API. Вся логика «что показать» — здесь,
// чтобы страницы оставались простыми функциями отрисовки.
import { getDb } from '../db/index.mjs';
import { getAccount, listAccounts } from '../db/accounts.mjs';
import { engagementRateOf, getVideo, listSnapshots, listVideos } from '../db/videos.mjs';
import { listRuns } from '../db/runs.mjs';
import {
  bestTimes, buildSeries, cadence, compareAccounts, compareGrowth, engagementRate,
  followerReach, growthFromSnapshots, parsePeriod, periodDays, previousPeriod, periodDelta,
  rankVideos, summariseVideos, videosInPeriod,
} from '../analysis/metrics.mjs';
import { analyzeHooks, analyzeSentiment, detectHooks, extractHashtags, extractTopics, textStats } from '../analysis/text.mjs';
import { buildInsights } from '../analysis/insights.mjs';

function decorate(video) {
  return {
    ...video,
    engagement: (Number(video.likes) || 0) + (Number(video.comments) || 0)
      + (Number(video.shares) || 0) + (Number(video.saves) || 0),
    engagementRate: engagementRate(video),
    hooks: detectHooks(video),
    text: textStats(video),
  };
}

export function prepareVideos(videos) {
  return videos.map(decorate);
}

export function dashboardData({ db = getDb(), platform = null, accountId = null } = {}) {
  const accounts = listAccounts(db).filter((a) => (!platform || a.platform === platform)
    && (!accountId || a.id === Number(accountId)));
  const accountIds = new Set(accounts.map((a) => a.id));
  const allVideos = prepareVideos(listVideos({ limit: 1000 }, db).filter((v) => accountIds.has(v.accountId)));

  const summary = summariseVideos(allVideos);
  const byPlatform = ['instagram', 'youtube', 'tiktok'].map((p) => {
    const list = allVideos.filter((v) => v.platform === p);
    const accs = accounts.filter((a) => a.platform === p);
    const s = summariseVideos(list);
    return {
      platform: p,
      accounts: accs.length,
      videos: list.length,
      views: s.totalViews,
      avgEr: s.avgEr,
      followers: accs.reduce((sum, a) => sum + a.followers, 0),
    };
  });

  return {
    accounts,
    videos: allVideos,
    summary,
    byPlatform,
    series: buildSeries(allVideos, { days: 120, bucket: 'week' }),
    dailySeries: buildSeries(allVideos, { days: 30, bucket: 'day' }),
    insights: buildInsights(allVideos, { followers: sum(accounts, 'followers'), accounts }),
    viewsDelta: periodDelta(allVideos, { metric: 'views' }),
    erDelta: periodDelta(allVideos, { metric: 'er' }),
    topVideos: rankVideos(allVideos, { limit: 5, metric: 'views' }),
    topErVideos: rankVideos(allVideos, { limit: 5, metric: 'er' }),
    topics: extractTopics(allVideos, { limit: 10 }),
    hashtags: extractHashtags(allVideos, { limit: 12 }),
    sentiment: analyzeSentiment(allVideos),
    hooks: analyzeHooks(allVideos),
  };
}

export function accountData(accountId, { db = getDb() } = {}) {
  const account = getAccount(accountId, db);
  if (!account) return null;
  const videos = prepareVideos(listVideos({ accountId: account.id, limit: 1000 }, db));
  const summary = summariseVideos(videos, { followers: account.followers });
  const pace = cadence(videos);
  const times = bestTimes(videos);
  const prevMonth = videos.filter((v) => {
    const d = new Date(v.publishedAt).getTime();
    return d < Date.now() - 30 * 24 * 3600 * 1000;
  });

  return {
    account,
    videos,
    summary,
    series: buildSeries(videos, { days: 180, bucket: 'week' }),
    insights: buildInsights(videos, { followers: account.followers, account }),
    topics: extractTopics(videos, { limit: 14 }),
    hashtags: extractHashtags(videos, { limit: 14 }),
    sentiment: analyzeSentiment(videos),
    hooks: analyzeHooks(videos),
    bestTimes: times,
    cadence: pace,
    outliers: rankVideos(videos, { limit: 3, metric: 'views' }),
    weakest: rankVideos(videos, { limit: 3, metric: 'views', direction: 'asc' }),
    viewsDelta: periodDelta(videos, { metric: 'views' }),
    erDelta: periodDelta(videos, { metric: 'er' }),
    runs: listRuns({ accountId: account.id, limit: 8 }, db),
    previousMonthViews: sum(prevMonth, 'views'),
    averageViewsRecent: videos.length
      ? Math.round(sum(videos.slice(0, 5), 'views') / Math.min(5, videos.length))
      : 0,
  };
}

export function videoData(videoId, { db = getDb() } = {}) {
  const raw = getVideo(videoId, db);
  if (!raw) return null;
  const video = decorate(raw);
  const account = getAccount(raw.accountId, db);
  const siblings = prepareVideos(listVideos({ accountId: raw.accountId, limit: 1000 }, db));
  const summary = summariseVideos(siblings, { followers: account?.followers ?? 0 });
  const rank = siblings
    .slice()
    .sort((a, b) => b.views - a.views)
    .findIndex((v) => v.id === video.id);
  const snapshots = listSnapshots(video.id, db);

  return {
    video,
    account,
    summary,
    percentile: summary.count ? 100 - (rank / summary.count) * 100 : null,
    rank,
    viewsVsMedian: summary.medianViews ? video.views / summary.medianViews : null,
    erVsAccount: summary.avgEr ? video.engagementRate / summary.avgEr : null,
    followerReach: followerReach(video, account?.followers ?? 0),
    siblings: siblings.filter((v) => v.id !== video.id).slice(0, 4),
    snapshots,
    growth: growthFromSnapshots(snapshots),
  };
}

export function overviewStats(db = getDb()) {
  const accounts = listAccounts(db);
  const videos = listVideos({ limit: 5000 }, db);
  return {
    accounts: accounts.length,
    videos: videos.length,
    platforms: new Set(accounts.map((a) => a.platform)).size,
    views: sum(videos, 'views'),
    lastSync: accounts.map((a) => a.lastSyncedAt).filter(Boolean).sort().at(-1) ?? null,
  };
}

function sum(rows, key) {
  return rows.reduce((acc, row) => acc + (Number(row[key]) || 0), 0);
}

/**
 * CSV для выгрузки в таблицы. Разделитель — точка с запятой и BOM:
 * так файл корректно открывается в русской локали Excel.
 */
export function videosToCsv(videos) {
  // В файле — привычные для таблиц имена в snake_case; в коде — camelCase.
  const headers = [
    'platform', 'handle', 'external_id', 'title', 'published_at', 'duration_seconds',
    'views', 'likes', 'comments', 'shares', 'saves', 'engagement_rate', 'url',
  ];
  const escape = (value) => {
    const text = String(value ?? '');
    return /[";\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const rows = videos.map((v) => [
    v.platform, v.handle, v.externalId, v.title, v.publishedAt, v.durationSeconds,
    v.views, v.likes, v.comments, v.shares, v.saves,
    engagementRateOf(v).toFixed(2), v.url,
  ].map(escape).join(';'));
  return `\uFEFF${headers.join(';')}\n${rows.join('\n')}\n`;
}

/**
 * Данные для страницы сравнения (#9).
 *
 * `ids` — выбранные аккаунты (2–4 по замыслу, но код не ломается на одном и
 * на пустом списке: пустое состояние честнее ошибки). Период задаётся явно
 * или берётся последние 30 дней. Выбор хранится в URL, поэтому страницу
 * можно переслать коллеге.
 */
export function comparisonData({ db = getDb(), ids = [], from = '', to = '', now = new Date() } = {}) {
  const allAccounts = listAccounts(db);
  const period = parsePeriod({ from, to, now });
  if (period.error) {
    // Форма ответа та же, что и у успешного: страница отрисовки не должна
    // падать на битом периоде — иначе пользователь увидит 500 вместо
    // объяснения, что не так с датами.
    return {
      error: period.error,
      accounts: allAccounts,
      selected: [],
      period: null,
      comparison: { rows: [], leaders: {} },
      growth: [],
      series: [],
      keys: [],
      bucket: 'day',
    };
  }

  // Порядок и количество выбранных сохраняем как пришли: пользователь выбрал
  // аккаунты в осмысленном порядке, пересортировка сбила бы сравнение.
  const selected = ids
    .map((id) => allAccounts.find((a) => a.id === Number(id)))
    .filter(Boolean);

  const videos = prepareVideos(listVideos({ limit: 5000 }, db));
  const selectedIds = new Set(selected.map((a) => a.id));
  const relevant = videos.filter((v) => selectedIds.has(v.accountId));

  const comparison = compareAccounts(selected, relevant, period);
  const growth = compareGrowth(selected, relevant, period);
  const prev = previousPeriod(period.from, period.to);

  // Ряды выравниваем по общим ключам, чтобы линии были сопоставимы по оси:
  // у каждого аккаунта свой набор недель, и «наложить» их можно только на
  // общий календарь.
  const currentSeries = selected.map((account) => ({
    key: account.id,
    label: account.displayName || `@${account.handle}`,
    rows: buildSeries(videosInPeriod(relevant.filter((v) => v.accountId === account.id), period.from, period.to), {
      days: periodDays(period.from, period.to),
      bucket: periodDays(period.from, period.to) <= 45 ? 'day' : 'week',
      now: period.to,
    }),
  }));
  const keys = [...new Set(currentSeries.flatMap((s) => s.rows.map((r) => r.key)))].sort();

  const series = currentSeries.map((s) => {
    const byKey = new Map(s.rows.map((r) => [r.key, r]));
    return { ...s, rows: keys.map((k) => byKey.get(k) ?? null) };
  });

  return {
    accounts: allAccounts,
    selected,
    period: {
      from: period.from.toISOString(),
      to: period.to.toISOString(),
      days: period.days,
      fromInput: period.from.toISOString().slice(0, 10),
      toInput: period.to.toISOString().slice(0, 10),
      previous: { from: prev.from?.toISOString() ?? null, to: prev.to?.toISOString() ?? null },
    },
    comparison,
    growth,
    series,
    keys,
    bucket: periodDays(period.from, period.to) <= 45 ? 'day' : 'week',
    error: '',
  };
}

/** Разбор `accounts` из query: «1,2,3», повторяющийся параметр, мусор отбрасываем. */
export function parseAccountIds(value) {
  const raw = Array.isArray(value) ? value : String(value ?? '').split(',');
  return raw
    .flatMap((part) => String(part).split(','))
    .map((part) => Number(String(part).trim()))
    .filter((id) => Number.isInteger(id) && id > 0);
}
