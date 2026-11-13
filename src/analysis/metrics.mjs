// Метрики аккаунта и роликов. Все определения собраны в одном месте, чтобы
// интерфейс, API и тесты считали одинаково.
//
// ER (engagement rate) = (лайки + комментарии + репосты + сохранения) / просмотры × 100.
// Это «ER по охвату»: он не зависит от числа подписчиков и потому пригоден для
// сравнения роликов между собой. ER по подписчикам считается отдельно.

import { addDays, daysBetween, parseDate, weekdayIndex, zonedHour, monthKey } from '../lib/dates.mjs';

export function sum(values) {
  return values.reduce((acc, v) => acc + (Number(v) || 0), 0);
}

export function mean(values) {
  return values.length ? sum(values) / values.length : 0;
}

export function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].map(Number).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function quantile(values, q) {
  if (!values.length) return 0;
  const sorted = [...values].map(Number).sort((a, b) => a - b);
  const pos = (sorted.length - 1) * Math.min(1, Math.max(0, q));
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] !== undefined
    ? sorted[base] + rest * (sorted[base + 1] - sorted[base])
    : sorted[base];
}

export function engagements(video) {
  return (Number(video.likes) || 0) + (Number(video.comments) || 0)
    + (Number(video.shares) || 0) + (Number(video.saves) || 0);
}

// Ориентиры вовлечённости по платформам, в процентах ER.
//
// Это НЕ официальные данные платформ и не результат нашего исследования.
// Отраслевые публикации и бенчмарк-отчёты (Metricool, Later, Rival IQ) из года
// в год называют для Instagram примерно 3–6 %, для YouTube — 2–4 %, для TikTok
// — 4–8 %; здесь взята середина диапазонов. Значения нужны как грубая система
// координат: «ER 0,8 % при ориентире 4 %» — сигнал, «ER 6 %» — норма.
// Если у пользователя есть свои цифры, их можно задать в ER_BENCHMARKS.
export const ER_BENCHMARKS = Object.freeze({ instagram: 4, youtube: 2.5, tiktok: 5 });

export function erBenchmark(platform) {
  return ER_BENCHMARKS[platform] ?? null;
}

export function engagementRate(video) {
  const views = Number(video.views) || 0;
  return views ? (engagements(video) / views) * 100 : 0;
}

export function followerReach(video, followers) {
  const f = Number(followers) || 0;
  return f ? ((Number(video.views) || 0) / f) * 100 : 0;
}

/**
 * Сводка по набору роликов.
 */
export function summariseVideos(videos, { followers = 0 } = {}) {
  const enriched = videos.map((v) => ({ ...v, engagementRate: engagementRate(v) }));
  const views = enriched.map((v) => Number(v.views) || 0);
  const ers = enriched.map((v) => v.engagementRate);
  const totalViews = sum(views);
  const totalEngagements = sum(enriched.map(engagements));

  return {
    count: enriched.length,
    totalViews,
    avgViews: Math.round(mean(views)),
    medianViews: Math.round(median(views)),
    totalEngagements,
    avgEngagements: Math.round(mean(enriched.map(engagements))),
    avgEr: mean(ers),
    medianEr: median(ers),
    maxEr: ers.length ? Math.max(...ers) : 0,
    avgFollowerReach: mean(enriched.map((v) => followerReach(v, followers))),
    totalLikes: sum(enriched.map((v) => v.likes)),
    totalComments: sum(enriched.map((v) => v.comments)),
    totalShares: sum(enriched.map((v) => v.shares)),
    totalSaves: sum(enriched.map((v) => v.saves)),
    avgDuration: Math.round(mean(enriched.map((v) => v.durationSeconds))),
    videos: enriched,
  };
}

/**
 * Ряд по дням или неделям. Обязательно заполняем пустые интервалы нулями:
 * иначе график «сжимает» периоды без публикаций и врёт о динамике.
 */
export function buildSeries(videos, { days = 90, bucket = 'week', now = new Date() } = {}) {
  const end = parseDate(now) || new Date();
  const start = new Date(end.getTime() - days * 24 * 3600 * 1000);
  const buckets = new Map();

  const keyOf = (iso) => {
    const d = parseDate(iso);
    if (!d) return null;
    if (bucket === 'day') return d.toISOString().slice(0, 10);
    if (bucket === 'month') return monthKey(d);
    const weekday = (d.getUTCDay() + 6) % 7;
    const monday = new Date(d.getTime() - weekday * 24 * 3600 * 1000);
    return monday.toISOString().slice(0, 10);
  };

  for (let cursor = new Date(start); cursor <= end; cursor = new Date(cursor.getTime() + 24 * 3600 * 1000)) {
    const key = keyOf(cursor);
    if (key && !buckets.has(key)) buckets.set(key, { key, views: 0, videos: 0, engagements: 0 });
  }

  for (const video of videos) {
    const key = keyOf(video.publishedAt);
    if (!key || !buckets.has(key)) continue;
    const row = buckets.get(key);
    row.views += Number(video.views) || 0;
    row.videos += 1;
    row.engagements += engagements(video);
  }

  const rows = [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key));
  return rows.map((row) => ({
    ...row,
    engagementRate: row.views ? (row.engagements / row.views) * 100 : 0,
  }));
}

/**
 * Динамика: сравниваем последние 30 дней с предыдущими 30. Если данных
 * недостаточно, возвращаем null — «ноль процентов» соврал бы.
 */
export function periodDelta(videos, { days = 30, now = new Date(), metric = 'views' } = {}) {
  const end = parseDate(now) || new Date();
  const currentStart = new Date(end.getTime() - days * 24 * 3600 * 1000);
  const previousStart = new Date(end.getTime() - 2 * days * 24 * 3600 * 1000);

  const current = videos.filter((v) => {
    const d = parseDate(v.publishedAt);
    return d && d >= currentStart && d <= end;
  });
  const previous = videos.filter((v) => {
    const d = parseDate(v.publishedAt);
    return d && d >= previousStart && d < currentStart;
  });

  if (!current.length || !previous.length) {
    return {
      metric, current: current.length, previous: previous.length, change: null,
      reason: 'Недостаточно данных для сравнения периодов',
    };
  }

  const pick = (list) => {
    if (metric === 'views') return sum(list.map((v) => v.views));
    if (metric === 'er') return mean(list.map(engagementRate));
    if (metric === 'videos') return list.length;
    return sum(list.map(engagements));
  };

  const cur = pick(current);
  const prev = pick(previous);
  return {
    metric,
    current: cur,
    previous: prev,
    change: prev ? ((cur - prev) / prev) * 100 : null,
    reason: prev ? '' : 'В прошлом периоде не было публикаций',
  };
}

/**
 * Лучшие часы и дни публикаций по среднему охвату. Возвращает только
 * интервалы, где есть хотя бы одно видео; сортировка — по среднему ER,
 * потому что абсолютные просмотры сильно зависят от давности ролика.
 */
export function bestTimes(videos) {
  const byHour = new Map();
  const byWeekday = new Map();
  const enriched = videos.map((v) => ({ ...v, er: engagementRate(v) }));

  for (const video of enriched) {
    const hour = zonedHour(video.publishedAt);
    const weekday = weekdayIndex(video.publishedAt);
    if (hour !== null) {
      if (!byHour.has(hour)) byHour.set(hour, []);
      byHour.get(hour).push(video);
    }
    if (weekday !== null) {
      if (!byWeekday.has(weekday)) byWeekday.set(weekday, []);
      byWeekday.get(weekday).push(video);
    }
  }

  const WEEKDAY_NAMES = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
  const aggregate = (map) => [...map.entries()].map(([key, list]) => ({
    key,
    count: list.length,
    avgViews: Math.round(mean(list.map((v) => v.views))),
    avgEr: mean(list.map((v) => v.er)),
    confidence: list.length >= 3 ? 'ok' : 'low',
  }));

  const hours = aggregate(byHour).sort((a, b) => b.avgEr - a.avgEr);
  const weekdays = aggregate(byWeekday)
    .map((row) => ({ ...row, label: WEEKDAY_NAMES[row.key - 1] }))
    .sort((a, b) => b.avgEr - a.avgEr);

  return { hours, weekdays, hoursCovered: byHour.size, weekdaysCovered: byWeekday.size };
}

/**
 * Топ и антитоп роликов. Метрика сортировки задаётся явно.
 */
export function rankVideos(videos, { limit = 5, metric = 'views', direction = 'desc' } = {}) {
  const enriched = videos.map((v) => ({ ...v, engagementRate: engagementRate(v) }));
  const factor = direction === 'asc' ? 1 : -1;
  const pick = (v) => {
    if (metric === 'er') return v.engagementRate;
    if (metric === 'comments') return Number(v.comments) || 0;
    if (metric === 'engagement') return engagements(v);
    return Number(v.views) || 0;
  };
  return enriched
    .slice()
    .sort((a, b) => factor * (pick(a) - pick(b)))
    .slice(0, limit);
}

/**
 * Выбросы: ролики, чей охват выше верхнего квартиля + 1.5 межквартильного
 * размаха. Это классическое правило Тьюки, а не «на глазок».
 */
export function findOutliers(videos) {
  if (videos.length < 5) return { high: [], low: [], threshold: null };
  const views = videos.map((v) => Number(v.views) || 0);
  const q1 = quantile(views, 0.25);
  const q3 = quantile(views, 0.75);
  const iqr = q3 - q1;
  const highThreshold = q3 + 1.5 * iqr;
  const lowThreshold = Math.max(0, q1 - 1.5 * iqr);
  const enriched = videos.map((v) => ({ ...v, engagementRate: engagementRate(v) }));
  return {
    high: enriched.filter((v) => (Number(v.views) || 0) > highThreshold),
    low: enriched.filter((v) => (Number(v.views) || 0) < lowThreshold),
    threshold: Math.round(highThreshold),
    q1: Math.round(q1),
    q3: Math.round(q3),
  };
}

/**
 * Регулярность: интервалы между публикациями и «застой» на конец периода.
 */
export function cadence(videos, { now = new Date() } = {}) {
  const sorted = videos
    .map((v) => parseDate(v.publishedAt))
    .filter(Boolean)
    .sort((a, b) => a - b);
  if (sorted.length < 2) {
    return { avgGapDays: null, medianGapDays: null, lastPublishedAt: sorted[0]?.toISOString() ?? null, daysSinceLast: null, longestGapDays: null, upcomingBreach: false };
  }
  const gaps = [];
  for (let i = 1; i < sorted.length; i += 1) gaps.push(daysBetween(sorted[i - 1], sorted[i]));
  const last = sorted[sorted.length - 1];
  const daysSinceLast = daysBetween(last, now);
  const medianGapDays = median(gaps);
  return {
    avgGapDays: mean(gaps),
    medianGapDays,
    longestGapDays: Math.max(...gaps),
    lastPublishedAt: last.toISOString(),
    daysSinceLast,
    expectedNext: addDays(last, medianGapDays).slice(0, 10),
    upcomingBreach: medianGapDays > 0 && daysSinceLast > medianGapDays * 2,
  };
}

/**
 * Сравнение с прошлым периодом по каждому ролику невозможно без истории,
 * но у нас есть снимки метрик — используем их там, где они есть.
 */
export function growthFromSnapshots(snapshots) {
  if (!snapshots || snapshots.length < 2) return null;
  const first = snapshots[0];
  const last = snapshots[snapshots.length - 1];
  const days = daysBetween(first.takenAt, last.takenAt);
  const growth = Number(last.views) - Number(first.views);
  return {
    days,
    viewsGrowth: growth,
    viewsGrowthPct: first.views ? (growth / first.views) * 100 : null,
    dailyViews: days > 0 ? growth / days : null,
  };
}

/**
 * Разбор периода из пользовательского ввода.
 *
 * Даты приходят из URL, поэтому мусор не должен превращаться в «весь диапазон»:
 * молча проигнорированная дата даёт правдоподобный, но не тот отчёт.
 * Возвращает `{ from, to }` как Date или `{ error }` с человеческим текстом.
 */
export function parsePeriod({ from, to, now = new Date() } = {}) {
  const end = parseDate(now) || new Date();
  // Дата без времени означает день целиком. Для начала периода это 00:00,
  // для конца — 23:59:59.999: иначе «по 20 мая» отрезало бы весь последний
  // день, и пользователь не увидел бы свежие ролики.
  const parseOne = (value, label, endOfDay = false) => {
    if (value === undefined || value === null || value === '') return null;
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
    const d = parseDate(dateOnly ? `${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z` : value);
    if (!d) return { error: `${label}: не удалось разобрать дату «${value}». Ожидается ГГГГ-ММ-ДД.` };
    return { date: d };
  };

  const start = parseOne(from, 'Начало периода');
  if (start?.error) return { error: start.error };
  const finish = parseOne(to, 'Конец периода', true);
  if (finish?.error) return { error: finish.error };

  // По умолчанию — последние 30 дней включительно.
  const toDate = finish?.date ?? end;
  const fromDate = start?.date ?? new Date(toDate.getTime() - 29 * 24 * 3600 * 1000);

  if (fromDate > toDate) {
    return { error: 'Начало периода позже конца: сравнение не имеет смысла.' };
  }
  const span = periodDays(fromDate, toDate);
  if (span > 366 * 3) {
    return { error: 'Период длиннее трёх лет: сузьте диапазон.' };
  }
  return { from: fromDate, to: toDate, days: span, error: '' };
}

/**
 * Длина периода в календарных днях, включительно.
 *
 * Оба конца периода входят в него, поэтому «1 мая 00:00 — 10 мая 23:59»
 * это 10 дней: целых суток между границами девять, плюс сам последний день.
 * `Math.floor(diff) + 1` одинаково верно считает и границы по полуночи, и
 * конец периода в последней миллисекунде дня.
 */
export function periodDays(from, to) {
  if (!from || !to) return 0;
  const diff = (to.getTime?.() ?? Number(to)) - (from.getTime?.() ?? Number(from));
  if (diff < 0) return 0;
  return Math.max(1, Math.floor(diff / (24 * 3600 * 1000)) + 1);
}

/**
 * Предыдущий период той же длины, вплотную перед текущим. Нужен, чтобы
 * «выбранный период» сравнивался с сопоставимым, а не с фиксированными 30 днями.
 */
export function previousPeriod(from, to) {
  if (!from || !to) return { from: null, to: null };
  const days = periodDays(from, to);
  // Конец предыдущего периода — последняя миллисекунда перед началом текущего:
  // так периоды примыкают без дыры и без нахлёста.
  const prevTo = new Date(from.getTime() - 1);
  const prevFrom = new Date(from.getTime() - days * 24 * 3600 * 1000);
  return { from: prevFrom, to: prevTo };
}

/** Ролики, опубликованные внутри периода включительно. */
export function videosInPeriod(videos, from, to) {
  if (!from || !to) return [];
  return videos.filter((v) => {
    const d = parseDate(v.publishedAt);
    return d && d >= from && d <= to;
  });
}

/**
 * Сравнение нескольких аккаунтов за один и тот же период.
 *
 * Метрики считаются на роликах периода, а не на всём архиве: иначе «кто растёт
 * быстрее» превращалось бы в «у кого длиннее история». Аккаунт без публикаций
 * в периоде остаётся в таблице с нулями и пометкой — пропажа строки выглядела
 * бы как пропажа аккаунта.
 */
export function compareAccounts(accounts, videos, { from, to } = {}) {
  const rows = accounts.map((account) => {
    const own = videos.filter((v) => v.accountId === account.id);
    const inPeriod = videosInPeriod(own, from, to);
    const summary = summariseVideos(inPeriod, { followers: account.followers });
    return {
      account,
      videos: inPeriod.length,
      totalViews: summary.totalViews,
      medianViews: summary.medianViews,
      totalEngagements: summary.totalEngagements,
      avgEr: summary.avgEr,
      medianEr: summary.medianEr,
      avgFollowerReach: summary.avgFollowerReach,
      videosPerWeek: periodDays(from, to) ? (inPeriod.length / (periodDays(from, to) / 7)) : 0,
      hasData: inPeriod.length > 0,
    };
  });

  const best = (key) => {
    const withData = rows.filter((r) => r.hasData);
    if (!withData.length) return null;
    return withData.reduce((a, b) => (b[key] > a[key] ? b : a)).account.id;
  };

  return {
    rows,
    // «Лидер» — максимум по метрике среди аккаунтов с данными. При равенстве
    // остаётся первый: подсветка двух лидеров сразу сбивает с толку.
    leaders: {
      views: best('totalViews'),
      er: best('avgEr'),
      reach: best('avgFollowerReach'),
      pace: best('videosPerWeek'),
    },
  };
}

/**
 * Динамика аккаунтов внутри периода против предыдущего периода той же длины.
 * Возвращает изменение в процентах по просмотрам и ER; null — если сравнивать
 * не с чем (в прошлом периоде не было публикаций).
 */
export function compareGrowth(accounts, videos, { from, to } = {}) {
  const prev = previousPeriod(from, to);
  return accounts.map((account) => {
    const own = videos.filter((v) => v.accountId === account.id);
    const current = videosInPeriod(own, from, to);
    const before = videosInPeriod(own, prev.from, prev.to);
    const curSummary = summariseVideos(current);
    const prevSummary = summariseVideos(before);
    const change = (cur, beforeValue) => (before.length && beforeValue
      ? ((cur - beforeValue) / beforeValue) * 100
      : null);

    return {
      account,
      videos: current.length,
      viewsChange: change(curSummary.totalViews, prevSummary.totalViews),
      erChange: before.length ? curSummary.avgEr - prevSummary.avgEr : null,
      hasComparison: before.length > 0,
    };
  });
}
