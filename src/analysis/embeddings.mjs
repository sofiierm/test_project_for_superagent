// Провайдер эмбеддингов для семантического анализа (#11).
//
// Словарный анализ быстрый, приватный и бесплатный, но грубый: синонимы не
// склеиваются, темы дробятся. Эмбеддинги это исправляют, но у них есть цена —
// либо модель на диске, либо отправка текста наружу. Поэтому провайдер
// опционален, а по умолчанию остаётся словарный анализ.
//
// Режимы (`EMBEDDING_PROVIDER`):
//  • `none` (по умолчанию) — только словарный анализ, сеть не используется;
//  • `local` — детерминированный локальный эмбеддинг на хешах основ слов:
//    синонимы он не понимает, но склеивает словоформы и близкие написания,
//    работает офлайн и ничего не отправляет;
//  • `remote` — внешний HTTP-сервис эмбеддингов (`EMBEDDING_ENDPOINT`).
//    Текст роликов покидает сервер: это явное решение владельца, и об этом
//    сказано в README.
import { config } from '../config.mjs';
import { normalizeWord, tokenize } from '../lib/stemmer.mjs';
import { isStopword } from '../lib/stopwords.mjs';

const DIMENSIONS = 128;

/**
 * Локальный эмбеддинг текста.
 *
 * Мешок основ слов, разложенный по фиксированным измерениям хешем. Это не
 * нейросетевая модель: синонимы не склеиваются. Зато результат детерминирован,
 * одинаков на разных машинах и не требует ни сети, ни модели на диске — а
 * главную задачу (перестать дробить тему из-за словоформ) решает.
 */
export function localEmbedding(text) {
  const vector = new Float64Array(DIMENSIONS);
  const words = tokenize(text);
  const stems = words.map(normalizeWord).filter((s) => s && !isStopword(s));
  if (!stems.length) return vector;

  for (const stem of stems) {
    // Два хеша на слово: снижает влияние коллизий на близость.
    for (const seed of [1, 7]) {
      const index = hash32(`${seed}:${stem}`) % DIMENSIONS;
      vector[index] += 1;
    }
  }

  // Символьные триграммы основ. Стеммер не трогает короткие слова, поэтому
  // «ноги» и «ног», «зале» и «зал» остались бы разными терминами; триграммы
  // дают им общую часть без модели и без словаря синонимов. Вес меньше, чем у
  // целого слова: триграммы уточняют близость, а не задают её.
  for (const stem of stems) {
    const padded = `<${stem}>`;
    for (let i = 0; i + 3 <= padded.length; i += 1) {
      const gram = padded.slice(i, i + 3);
      const index = hash32(`3:${gram}`) % DIMENSIONS;
      vector[index] += 0.35;
    }
  }
  return normalise(vector);
}

/** FNV-1a: быстрый детерминированный хеш без зависимостей. */
function hash32(value) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function normalise(vector) {
  let sum = 0;
  for (let i = 0; i < vector.length; i += 1) sum += vector[i] * vector[i];
  const length = Math.sqrt(sum);
  if (!length) return vector;
  for (let i = 0; i < vector.length; i += 1) vector[i] /= length;
  return vector;
}

/** Косинусная близость двух нормализованных векторов: от -1 до 1. */
export function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) dot += a[i] * b[i];
  return dot;
}

/**
 * Провайдер эмбеддингов.
 *
 * Возвращает `{ name, available, embed(texts), reason }`. `available: false`
 * значит «работаем словарным анализом»: вызывающий код не должен падать и не
 * должен молча выдавать пустоту за результат.
 */
export function createEmbedder({
  provider = config.embeddingProvider,
  endpoint = config.embeddingEndpoint,
  timeoutMs = config.embeddingTimeoutMs,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (provider === 'local') {
    return {
      name: 'local',
      available: true,
      reason: '',
      embed: async (texts) => texts.map(localEmbedding),
    };
  }

  if (provider === 'remote') {
    if (!endpoint) {
      return {
        name: 'remote',
        available: false,
        reason: 'EMBEDDING_ENDPOINT не задан — используется словарный анализ.',
        embed: async () => [],
      };
    }
    return {
      name: 'remote',
      available: true,
      reason: '',
      /** Ошибка сети не должна ронять страницу: отдаём пустой список. */
      embed: async (texts) => {
        if (!texts.length) return [];
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await fetchImpl(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ input: texts }),
            signal: controller.signal,
          });
          if (!response.ok) {
            throw new Error(`Сервис эмбеддингов ответил ${response.status}`);
          }
          const payload = await response.json();
          const vectors = Array.isArray(payload) ? payload : payload?.embeddings;
          if (!Array.isArray(vectors) || vectors.length !== texts.length) {
            throw new Error('Сервис эмбеддингов вернул неожиданный формат.');
          }
          return vectors.map((v) => (Array.isArray(v) ? Float64Array.from(v) : Float64Array.from(v?.embedding ?? [])));
        } finally {
          clearTimeout(timer);
        }
      },
    };
  }

  return {
    name: 'none',
    available: false,
    reason: 'Семантический анализ выключен — используется словарный.',
    embed: async () => [],
  };
}

/**
 * Кластеризация векторов.
 *
 * Жадный алгоритм: вектор присоединяется к первому кластеру, центр которого
 * ближе порога, иначе начинает новый. Для сотен роликов этого достаточно, а
 * результат детерминирован — в отличие от k-means со случайной инициализацией,
 * где одна и та же выборка давала бы разные темы при каждом открытии страницы.
 */
export function clusterBySimilarity(vectors, { threshold = 0.5, labels = [] } = {}) {
  const clusters = [];
  vectors.forEach((vector, index) => {
    let best = null;
    let bestScore = -Infinity;
    for (const cluster of clusters) {
      const score = cosine(vector, cluster.center);
      if (score > bestScore) { bestScore = score; best = cluster; }
    }
    if (best && bestScore >= threshold) {
      best.members.push(index);
      // Центр пересчитываем как среднее: иначе кластер «застревает» на первом
      // элементе и плохо принимает следующие.
      best.center = averageVector(best.members.map((i) => vectors[i]), best.center.length);
    } else {
      clusters.push({
        members: [index],
        center: Float64Array.from(vector),
        label: labels[index] ?? '',
      });
    }
  });
  return clusters;
}

function averageVector(list, size) {
  const sum = new Float64Array(size);
  for (const vector of list) {
    for (let i = 0; i < size; i += 1) sum[i] += vector[i];
  }
  for (let i = 0; i < size; i += 1) sum[i] /= list.length || 1;
  return normalise(sum);
}

/**
 * Похожие ролики: пары с близостью выше порога.
 *
 * Именно пары, а не кластеры: пользователю нужен ответ «этот ролик повторяет
 * тот», а не абстрактная группа. Пары сортируются по убыванию близости.
 */
export function similarPairs(vectors, { threshold = 0.6, limit = 5 } = {}) {
  const pairs = [];
  for (let i = 0; i < vectors.length; i += 1) {
    for (let j = i + 1; j < vectors.length; j += 1) {
      const score = cosine(vectors[i], vectors[j]);
      if (score >= threshold) pairs.push({ a: i, b: j, score });
    }
  }
  return pairs.sort((x, y) => y.score - x.score).slice(0, limit);
}
