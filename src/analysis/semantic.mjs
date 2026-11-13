// Семантический анализ содержания (#11).
//
// Словарный анализ в `text.mjs` остаётся основным: он работает офлайн, без
// модели и без отправки чужого контента наружу. Этот модуль добавляет
// необязательный слой поверх него:
//  • темы объединяются по близости текстов, а не по точному совпадению основ;
//  • находятся пары похожих роликов — повторяющиеся форматы;
//  • если провайдер недоступен, всё возвращается к словарному результату
//    с явной пометкой, а не к пустому списку.
import { createEmbedder, clusterBySimilarity, cosine, similarPairs } from './embeddings.mjs';
import { extractTopics } from './text.mjs';

function videoText(video) {
  return [video.title, video.description, video.transcript].filter(Boolean).join(' \n ');
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Подпись кластера.
 *
 * Из самого ролика-представителя берётся заголовок: он читается человеком, в
 * отличие от списка основ. Если заголовка нет — первая тема, иначе «Без темы».
 */
function clusterLabel(videos, members) {
  const titles = members
    .map((i) => String(videos[i]?.title ?? '').trim())
    .filter((t) => t.length >= 3)
    .sort((a, b) => a.length - b.length);
  if (titles.length) {
    // Самый короткий заголовок обычно и есть суть формата.
    const title = titles[0];
    return title.length > 60 ? `${title.slice(0, 57)}…` : title;
  }
  return 'Без темы';
}

/**
 * Темы по эмбеддингам.
 *
 * Возвращает ту же форму, что `extractTopics`, плюс `members` — индексы
 * роликов кластера. Совместимость важна: страницы уже умеют рисовать темы, и
 * менять их ради нового провайдера не нужно.
 */
export function semanticTopics(videos, vectors, { threshold = 0.45, limit = 12 } = {}) {
  if (!videos.length) return [];
  const clusters = clusterBySimilarity(vectors, { threshold });

  const avgViewsAll = mean(videos.map((v) => Number(v.views) || 0));
  const avgErAll = mean(videos.map((v) => Number(v.engagementRate) || 0));
  const total = Math.max(1, videos.length);

  return clusters
    .map((cluster) => {
      const members = cluster.members;
      const clusterVideos = members.map((i) => videos[i]);
      const avgViews = mean(clusterVideos.map((v) => Number(v.views) || 0));
      const avgEr = mean(clusterVideos.map((v) => Number(v.engagementRate) || 0));
      return {
        stem: `cluster:${members.join('-')}`,
        label: clusterLabel(videos, members),
        count: members.length,
        share: (members.length / total) * 100,
        avgViews: Math.round(avgViews),
        avgEr,
        lift: avgViewsAll ? avgViews / avgViewsAll : 0,
        erLift: avgErAll ? avgEr / avgErAll : 0,
        videoIds: clusterVideos.map((v) => v.id).filter(Boolean),
        videoIndexes: members,
        members,
        semantic: true,
      };
    })
    .sort((a, b) => (b.count - a.count) || (b.avgViews - a.avgViews))
    .slice(0, Math.floor(limit));
}

/**
 * Похожие ролики: повторяющиеся форматы.
 *
 * Порог выше, чем у кластеров: «похожий» должен значить «правда тот же формат»,
 * иначе список заполняется почти-random парами и теряет смысл.
 */
export function similarVideos(videos, vectors, { threshold = 0.6, limit = 5 } = {}) {
  const pairs = similarPairs(vectors, { threshold, limit });
  return pairs.map((pair) => ({
    a: {
      id: videos[pair.a]?.id ?? null,
      title: String(videos[pair.a]?.title ?? '').trim(),
      views: Number(videos[pair.a]?.views) || 0,
    },
    b: {
      id: videos[pair.b]?.id ?? null,
      title: String(videos[pair.b]?.title ?? '').trim(),
      views: Number(videos[pair.b]?.views) || 0,
    },
    score: pair.score,
  }));
}

/**
 * Полный семантический слой.
 *
 * `fallbackTopics` передаётся вызывающим кодом: если провайдер выключен или
 * упал, возвращаем именно словарные темы. Пересчитывать их здесь значило бы
 * делать одну и ту же работу дважды.
 */
export async function analyseContent(videos, {
  embedder = createEmbedder(),
  fallbackTopics = null,
  topicThreshold = 0.45,
  pairThreshold = 0.6,
  limit = 12,
  pairLimit = 5,
} = {}) {
  const base = fallbackTopics ?? extractTopics(videos, { limit });

  if (!embedder.available || !videos.length) {
    return {
      mode: embedder.name,
      active: false,
      reason: embedder.reason,
      topics: base,
      similar: [],
    };
  }

  let vectors;
  try {
    vectors = await embedder.embed(videos.map(videoText));
  } catch (error) {
    // Ошибка сети или чужого сервиса не должна ронять страницу: показываем
    // словарный результат и честно говорим, что семантика не применилась.
    return {
      mode: embedder.name,
      active: false,
      reason: `Семантический анализ недоступен: ${error.message}. Показан словарный.`,
      topics: base,
      similar: [],
    };
  }

  if (!vectors.length || vectors.some((v) => !v || !v.length)) {
    return {
      mode: embedder.name,
      active: false,
      reason: 'Семантический анализ вернул пустой результат. Показан словарный.',
      topics: base,
      similar: [],
    };
  }

  // Вырожденный случай: все тексты пустые и векторы нулевые. Кластеризация
  // слепила бы их в одну «тему» — лучше честно остаться на словарном анализе.
  const allZero = vectors.every((v) => v.every((x) => x === 0));
  if (allZero) {
    return {
      mode: embedder.name,
      active: false,
      reason: 'В роликах нет текста для семантического анализа. Показан словарный.',
      topics: base,
      similar: [],
    };
  }

  return {
    mode: embedder.name,
    active: true,
    reason: '',
    topics: semanticTopics(videos, vectors, { threshold: topicThreshold, limit }),
    similar: similarVideos(videos, vectors, { threshold: pairThreshold, limit: pairLimit }),
    // Средняя близость — грубый индикатор «насколько канал однообразен».
    cohesion: mean(vectors.map((v, i) => (i ? cosine(v, vectors[0]) : 1))),
  };
}
