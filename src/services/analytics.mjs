// Сборка данных для страниц и API. Вся логика «что показать» — здесь,
// чтобы страницы оставались простыми функциями отрисовки.
import { getDb } from '../db/index.mjs';
import { getAccount, listAccounts } from '../db/accounts.mjs';
import { engagementRateOf, getVideo, listSnapshots, listVideos } from '../db/videos.mjs';
import { listRuns } from '../db/runs.mjs';
import {
  bestTimes, buildSeries, cadence, engagementRate, followerReach, growthFromSnapshots,
  periodDelta, rankVideos, summariseVideos,
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
