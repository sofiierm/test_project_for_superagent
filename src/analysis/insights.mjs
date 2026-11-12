// Выводы: превращаем метрики в короткие наблюдения на естественном языке.
//
// Правила сознательно консервативные. Мы не утверждаем причинность, не
// сравниваем часы публикаций при малой выборке и всегда показываем, на чём
// основан вывод, чтобы пользователь мог его перепроверить.
import { formatNumber, formatPercent, formatShortDate } from '../lib/dates.mjs';
import {
  bestTimes, cadence, engagementRate, erBenchmark, findOutliers, periodDelta,
  rankVideos, summariseVideos,
} from './metrics.mjs';

const LEVEL_ORDER = { critical: 0, warning: 1, opportunity: 2, info: 3 };

/**
 * @returns {Array<{id:string, level:'info'|'opportunity'|'warning'|'critical', title:string, detail:string, metric?:string, action?:string}>}
 */
export function buildInsights(videos, { followers = 0, account = null, now = new Date(), accounts = [] } = {}) {
  const insights = [];
  const summary = summariseVideos(videos, { followers });
  // На обзоре ролики принадлежат нескольким аккаунтам. Всё, что зависит от
  // ритма, имеет смысл только внутри одного аккаунта.
  const multiAccount = accounts.length > 1
    || new Set(videos.map((v) => v.accountId)).size > 1;
  const accountPaces = accounts.length
    ? accounts.map((acc) => ({
      account: acc,
      pace: cadence(videos.filter((v) => v.accountId === acc.id), { now }),
    }))
    : [];
  if (!videos.length) {
    return [{
      id: 'no-data',
      level: 'info',
      title: 'Нет данных для анализа',
      detail: 'У аккаунта пока не загружено ни одного ролика. Запустите синхронизацию, чтобы получить метрики.',
      action: 'Нажмите «Синхронизировать» на странице аккаунта.',
    }];
  }

  // 1. Динамика охвата.
  const viewsDelta = periodDelta(videos, { days: 30, now, metric: 'views' });
  if (viewsDelta.change !== null) {
    if (viewsDelta.change <= -25) {
      insights.push({
        id: 'views-drop',
        level: 'warning',
        title: `Охват упал на ${formatPercent(Math.abs(viewsDelta.change))}`,
        detail: `За последние 30 дней ролики собрали ${formatNumber(viewsDelta.current)} просмотров против ${formatNumber(viewsDelta.previous)} в предыдущие 30 дней.`,
        action: 'Проверьте, не изменился ли формат или тематика последних публикаций.',
        metric: 'views',
      });
    } else if (viewsDelta.change >= 25) {
      insights.push({
        id: 'views-growth',
        level: 'opportunity',
        title: `Охват вырос на ${formatPercent(viewsDelta.change)}`,
        detail: `Последние 30 дней дали ${formatNumber(viewsDelta.current)} просмотров против ${formatNumber(viewsDelta.previous)} в предыдущем периоде.`,
        action: 'Повторите формат и темы роликов, которые вышли в этом месяце.',
        metric: 'views',
      });
    }
  }

  // 2. ER против ориентира по платформе.
  const benchmark = erBenchmark(account?.platform);
  if (benchmark && summary.count >= 5) {
    if (summary.avgEr < benchmark * 0.6) {
      insights.push({
        id: 'er-low',
        level: 'warning',
        title: `Вовлечённость ниже ориентира: ${formatPercent(summary.avgEr)}`,
        detail: `Средний ER по ${summary.count} роликам — ${formatPercent(summary.avgEr)} при ориентире для ${platformName(account.platform)} около ${formatPercent(benchmark)}.`,
        action: 'Добавьте вопрос или призыв в конец ролика: это самый дешёвый способ поднять комментарии.',
        metric: 'er',
      });
    } else if (summary.avgEr > benchmark * 1.5) {
      insights.push({
        id: 'er-high',
        level: 'opportunity',
        title: `Вовлечённость выше ориентира: ${formatPercent(summary.avgEr)}`,
        detail: `Средний ER — ${formatPercent(summary.avgEr)} против ориентира ${formatPercent(benchmark)} для ${platformName(account.platform)}. Аудитория реагирует активно.`,
        action: 'Этот уровень вовлечённости можно монетизировать: предложите аудитории продукт или подписку.',
        metric: 'er',
      });
    }
  }

  // 3. Выбросы по охвату.
  const outliers = findOutliers(videos);
  if (outliers.high.length) {
    const top = outliers.high.sort((a, b) => b.views - a.views)[0];
    insights.push({
      id: 'outlier-high',
      level: 'opportunity',
      title: `Один ролик собрал ${formatNumber(top.views)} просмотров`,
      detail: `«${trimTitle(top.title)}» вышел ${formatShortDate(top.publishedAt)} и превысил верхнюю границу нормы (${formatNumber(outliers.threshold)} просмотров). Это ${outliers.high.length} из ${summary.count} роликов.`,
      action: 'Разберите этот ролик: тема, хук, длина, время публикации — и повторите формулу.',
      metric: 'views',
    });
  }

  // 4. Регулярность публикаций. Считаем по каждому аккаунту отдельно: если
  // смешать аккаунты в один список, интервалы между чужими роликами дают
  // бессмысленный «ритм раз в день».
  if (!multiAccount) {
    const pace = cadence(videos, { now });
    if (pace.medianGapDays !== null && pace.medianGapDays > 0) {
      if (pace.upcomingBreach) {
        insights.push({
          id: 'cadence-gap',
          level: 'warning',
          title: `Пауза ${Math.round(pace.daysSinceLast)} дн. при обычном ритме раз в ${Math.round(pace.medianGapDays)} дн.`,
          detail: `Медианный интервал между публикациями — ${pace.medianGapDays.toFixed(1)} дн., а с последнего ролика прошло ${Math.round(pace.daysSinceLast)} дн. Алгоритмы платформ хуже показывают аккаунты после долгих пауз.`,
          action: 'Вернитесь к привычному ритму: один ролик в ближайшие дни важнее идеального качества.',
          metric: 'cadence',
        });
      } else {
        insights.push({
          id: 'cadence-ok',
          level: 'info',
          title: `Ритм публикаций: раз в ${pace.medianGapDays.toFixed(1)} дн.`,
          detail: `Последний ролик вышел ${formatShortDate(pace.lastPublishedAt)}. Самый долгий перерыв — ${Math.round(pace.longestGapDays)} дн.`,
          metric: 'cadence',
        });
      }
    }
  } else {
    const stalled = accountPaces
      .filter((entry) => entry.pace.upcomingBreach && entry.pace.medianGapDays > 0)
      .sort((a, b) => b.pace.daysSinceLast - a.pace.daysSinceLast);
    if (stalled.length) {
      const worst = stalled[0];
      insights.push({
        id: 'cadence-gap',
        level: 'warning',
        title: `@${worst.account.handle} не публиковал ${Math.round(worst.pace.daysSinceLast)} дн.`,
        detail: `Обычный ритм аккаунта — раз в ${worst.pace.medianGapDays.toFixed(1)} дн.${stalled.length > 1 ? ` Похожая пауза ещё у ${stalled.length - 1} аккаунтов.` : ''}`,
        action: 'Проверьте, не встал ли контент-план: после долгих пауз охват восстанавливается не сразу.',
        metric: 'cadence',
      });
    }
  }

  // 5. Лучшее время — только при достаточной выборке.
  const times = bestTimes(videos);
  const goodHours = times.hours.filter((h) => h.confidence === 'ok');
  if (goodHours.length >= 2) {
    const best = goodHours[0];
    const worst = goodHours[goodHours.length - 1];
    if (best.avgEr > worst.avgEr * 1.4) {
      insights.push({
        id: 'best-time',
        level: 'opportunity',
        title: `Лучшее время публикации — ${String(best.key).padStart(2, '0')}:00`,
        detail: `Ролики, вышедшие в этот час, дают средний ER ${formatPercent(best.avgEr)} против ${formatPercent(worst.avgEr)} в худший час. Основано на ${goodHours.reduce((s, h) => s + h.count, 0)} роликах.`,
        action: 'Планируйте публикации на это время и сравните результат через месяц.',
        metric: 'timing',
      });
    }
  }

  // 6. Длина ролика.
  const shortVideos = videos.filter((v) => (Number(v.durationSeconds) || 0) <= 60);
  const longVideos = videos.filter((v) => (Number(v.durationSeconds) || 0) > 60);
  if (shortVideos.length >= 3 && longVideos.length >= 3) {
    const shortEr = avg(shortVideos.map(engagementRate));
    const longEr = avg(longVideos.map(engagementRate));
    if (shortEr > longEr * 1.3) {
      insights.push({
        id: 'duration-short',
        level: 'opportunity',
        title: 'Короткие ролики вовлекают сильнее',
        detail: `До 60 секунд средний ER ${formatPercent(shortEr)}, длиннее минуты — ${formatPercent(longEr)}. Выборка: ${shortVideos.length} и ${longVideos.length} роликов.`,
        action: 'Перенесите ключевую мысль в первые 30 секунд или сократите длинные выпуски.',
        metric: 'duration',
      });
    }
  }

  // 7. Форматы публикации YouTube (шортсы против длинных).
  if (account?.platform === 'youtube' && shortVideos.length && longVideos.length) {
    const shortViews = avg(shortVideos.map((v) => v.views));
    const longViews = avg(longVideos.map((v) => v.views));
    if (shortViews > longViews * 1.5) {
      insights.push({
        id: 'youtube-shorts',
        level: 'info',
        title: 'Shorts дают больше просмотров, чем длинные видео',
        detail: `Средние просмотры: ${formatNumber(shortViews)} у коротких и ${formatNumber(longViews)} у длинных роликов.`,
        metric: 'format',
      });
    }
  }

  // 8. Антитоп: слабый ролик.
  const weakest = rankVideos(videos, { limit: 1, metric: 'views', direction: 'asc' })[0];
  if (weakest && summary.medianViews > 0 && weakest.views < summary.medianViews * 0.4) {
    insights.push({
      id: 'weak-video',
      level: 'info',
      title: `Самый слабый ролик собрал ${formatNumber(weakest.views)} просмотров`,
      detail: `«${trimTitle(weakest.title)}» дал в ${(summary.medianViews / Math.max(1, weakest.views)).toFixed(1)} раза меньше медианы по аккаунту (${formatNumber(summary.medianViews)}).`,
      action: 'Сравните первые три секунды с вашими сильными роликами: чаще всего дело в хуке.',
      metric: 'views',
    });
  }

  // 9. Перекос по одному ролику.
  if (summary.count >= 5 && summary.totalViews > 0) {
    const top = rankVideos(videos, { limit: 1, metric: 'views' })[0];
    const share = (top.views / summary.totalViews) * 100;
    if (share > 45) {
      insights.push({
        id: 'single-video-dependence',
        level: 'warning',
        title: `${formatPercent(share)} всего охвата даёт один ролик`,
        detail: `«${trimTitle(top.title)}» собрал ${formatNumber(top.views)} из ${formatNumber(summary.totalViews)} просмотров. Аккаунт зависит от одного удачного видео.`,
        action: 'Сделайте серию по мотивам этого ролика, чтобы распределить охват.',
        metric: 'distribution',
      });
    }
  }

  return insights
    .sort((a, b) => (LEVEL_ORDER[a.level] ?? 9) - (LEVEL_ORDER[b.level] ?? 9))
    .slice(0, 8);
}

function avg(values) {
  return values.length ? values.reduce((s, v) => s + (Number(v) || 0), 0) / values.length : 0;
}

function trimTitle(title) {
  const text = String(title || 'Без названия').trim();
  return text.length > 64 ? `${text.slice(0, 63)}…` : text;
}

function platformName(platform) {
  return { instagram: 'Instagram', youtube: 'YouTube', tiktok: 'TikTok' }[platform] ?? 'платформы';
}

export const INSIGHT_LEVELS = {
  critical: 'Критично',
  warning: 'Внимание',
  opportunity: 'Возможность',
  info: 'Наблюдение',
};
