// Семантический анализ (#11).
//
// Главное, что здесь проверяется, — не «эмбеддинги работают», а два обещания:
// без провайдера сеть не используется и результат остаётся прежним, а при
// включённом провайдере раскладка детерминирована (одинакова на одном наборе).
import test from 'node:test';
import assert from 'node:assert/strict';

const {
  clusterBySimilarity, cosine, createEmbedder, localEmbedding, similarPairs,
} = await import('../../src/analysis/embeddings.mjs');
const { analyseContent, semanticTopics, similarVideos } = await import('../../src/analysis/semantic.mjs');

const videos = [
  { id: 1, title: 'Рецепт борща на обед', description: 'быстрый обед', views: 1000, engagementRate: 5 },
  { id: 2, title: 'Рецепты борща: быстрый обед', description: '', views: 900, engagementRate: 4 },
  { id: 3, title: 'Тренировка ног в зале', description: 'зал и штанга', views: 2000, engagementRate: 7 },
  { id: 4, title: 'Тренировки на ноги: зал', description: '', views: 1800, engagementRate: 6 },
  { id: 5, title: 'Как приготовить борщ дома', description: 'рецепт', views: 1200, engagementRate: 5 },
];

// ---- Локальный эмбеддинг ----

test('локальный эмбеддинг детерминирован и нормализован', () => {
  const a = localEmbedding('рецепт борща на обед');
  const b = localEmbedding('рецепт борща на обед');
  assert.deepEqual([...a], [...b], 'один текст даёт разные векторы');

  const length = Math.sqrt([...a].reduce((sum, x) => sum + x * x, 0));
  assert.ok(Math.abs(length - 1) < 1e-9, `вектор не нормализован: длина ${length}`);
});

test('близость отражает смысл: похожие тексты ближе разных', () => {
  const soup = localEmbedding('рецепт борща на обед');
  const soupVariant = localEmbedding('рецепты борща: быстрый обед');
  const gym = localEmbedding('тренировка ног в зале');

  assert.ok(cosine(soup, soupVariant) > 0.7, 'варианты одного рецепта не близки');
  assert.ok(cosine(soup, gym) < 0.3, 'рецепт и тренировка слишком близки');
  assert.ok(Math.abs(cosine(soup, soup) - 1) < 1e-9, 'близость с самим собой не 1');
});

test('пустой текст даёт нулевой вектор, а не мусор', () => {
  const vector = localEmbedding('');
  assert.ok([...vector].every((x) => x === 0));
  // И не ломает близость.
  assert.equal(cosine(vector, localEmbedding('рецепт')), 0);
});

test('косинус не падает на векторах разной длины', () => {
  assert.equal(cosine(new Float64Array([1, 0]), new Float64Array([1, 0, 0])), 0);
  assert.equal(cosine(null, new Float64Array([1])), 0);
});

// ---- Кластеризация ----

test('кластеризация склеивает близкие тексты и разделяет далёкие', () => {
  const vectors = videos.map((v) => localEmbedding(v.title));
  const clusters = clusterBySimilarity(vectors, { threshold: 0.45 });
  const soupCluster = clusters.find((c) => c.members.includes(0));
  assert.ok(soupCluster.members.includes(1), 'варианты борща не в одном кластере');
  const gymCluster = clusters.find((c) => c.members.includes(2));
  assert.ok(gymCluster.members.includes(3), 'варианты тренировки не в одном кластере');
  assert.notEqual(soupCluster, gymCluster, 'разные темы слились в один кластер');
});

test('кластеризация детерминирована: одинаковый вход — одинаковая раскладка', () => {
  const vectors = videos.map((v) => localEmbedding(v.title));
  const first = clusterBySimilarity(vectors, { threshold: 0.45 }).map((c) => c.members.join(','));
  const second = clusterBySimilarity(vectors, { threshold: 0.45 }).map((c) => c.members.join(','));
  assert.deepEqual(first, second, 'раскладка меняется между запусками');
});

test('пары похожих роликов не дублируются зеркально', () => {
  const vectors = videos.map((v) => localEmbedding(v.title));
  const pairs = similarPairs(vectors, { threshold: 0.6, limit: 10 });
  assert.ok(pairs.length > 0);
  for (const pair of pairs) {
    assert.ok(pair.a < pair.b, 'пара записана дважды или в обратном порядке');
  }
  // Отсортировано по убыванию близости.
  for (let i = 1; i < pairs.length; i += 1) {
    assert.ok(pairs[i - 1].score >= pairs[i].score);
  }
});

// ---- Провайдеры и деградация ----

test('по умолчанию провайдер выключен и сеть не используется', async () => {
  let calls = 0;
  const embedder = createEmbedder({
    provider: 'none',
    fetchImpl: async () => { calls += 1; throw new Error('сеть не должна вызываться'); },
  });
  assert.equal(embedder.available, false);

  const result = await analyseContent(videos, { embedder });
  assert.equal(result.active, false);
  assert.equal(calls, 0, 'выключенный провайдер полез в сеть');
  assert.ok(result.topics.length > 0, 'без семантики темы пропали');
  assert.match(result.reason, /выключен/);
});

test('без провайдера возвращаются именно словарные темы', async () => {
  const { extractTopics } = await import('../../src/analysis/text.mjs');
  const fallback = extractTopics(videos, { limit: 12 });
  const result = await analyseContent(videos, {
    embedder: createEmbedder({ provider: 'none' }),
    fallbackTopics: fallback,
  });
  assert.deepEqual(result.topics, fallback, 'словарные темы не сохранены');
});

test('локальный провайдер работает без сети и помечает темы как семантические', async () => {
  let calls = 0;
  const embedder = createEmbedder({
    provider: 'local',
    fetchImpl: async () => { calls += 1; throw new Error('локальный режим не должен ходить в сеть'); },
  });
  const result = await analyseContent(videos, { embedder });
  assert.equal(calls, 0, 'локальный провайдер обратился к сети');
  assert.equal(result.active, true);
  assert.ok(result.topics.every((t) => t.semantic), 'темы не помечены как семантические');
  assert.ok(result.topics.length < videos.length, 'темы не объединились');
});

test('remote без адреса деградирует с объяснением, а не падает', async () => {
  const result = await analyseContent(videos, { embedder: createEmbedder({ provider: 'remote', endpoint: '' }) });
  assert.equal(result.active, false);
  assert.match(result.reason, /EMBEDDING_ENDPOINT/);
  assert.ok(result.topics.length > 0);
});

test('падение внешнего сервиса не роняет анализ', async () => {
  const embedder = createEmbedder({
    provider: 'remote',
    endpoint: 'http://example.invalid/embed',
    fetchImpl: async () => { throw new Error('сервис недоступен'); },
  });
  const result = await analyseContent(videos, { embedder });
  assert.equal(result.active, false, 'падение выдано за успех');
  assert.match(result.reason, /недоступен/);
  assert.ok(result.topics.length > 0, 'страница осталась без тем');
});

test('внешний сервис с неверным форматом ответа не ломает страницу', async () => {
  const embedder = createEmbedder({
    provider: 'remote',
    endpoint: 'http://example.invalid/embed',
    fetchImpl: async () => ({ ok: true, json: async () => ({ unexpected: true }) }),
  });
  const result = await analyseContent(videos, { embedder });
  assert.equal(result.active, false);
  assert.match(result.reason, /неожиданный формат/);
});

test('успешный внешний сервис используется как эмбеддинги', async () => {
  const vectors = videos.map((v) => localEmbedding(v.title));
  const embedder = createEmbedder({
    provider: 'remote',
    endpoint: 'http://example.invalid/embed',
    fetchImpl: async () => ({ ok: true, json: async () => ({ embeddings: vectors.map((v) => [...v]) }) }),
  });
  const result = await analyseContent(videos, { embedder });
  assert.equal(result.active, true);
  assert.ok(result.topics.length > 0);
});

test('пустой набор роликов не вызывает провайдера', async () => {
  let calls = 0;
  const embedder = createEmbedder({
    provider: 'local',
    fetchImpl: async () => { calls += 1; },
  });
  const result = await analyseContent([], { embedder });
  assert.equal(calls, 0);
  assert.deepEqual(result.topics, []);
  assert.deepEqual(result.similar, []);
});

test('нулевые векторы не превращаются в одну фиктивную тему', async () => {
  // Все тексты пустые: эмбеддинг нулевой, кластеризация слепила бы всё в один
  // кластер — это выглядело бы как «одна тема на весь канал».
  const empty = [
    { id: 1, title: '', description: '', views: 10, engagementRate: 1 },
    { id: 2, title: '', description: '', views: 20, engagementRate: 2 },
  ];
  const result = await analyseContent(empty, { embedder: createEmbedder({ provider: 'local' }) });
  assert.equal(result.active, false);
  assert.match(result.reason, /нет текста/);
});

// ---- Раскладка тем ----

test('семантические темы считают метрики по своим роликам', () => {
  const vectors = videos.map((v) => localEmbedding(v.title));
  const topics = semanticTopics(videos, vectors, { threshold: 0.45, limit: 10 });
  for (const topic of topics) {
    const own = topic.members.map((i) => videos[i]);
    assert.equal(topic.count, own.length);
    assert.equal(topic.videoIds.length, own.length);
    const avg = own.reduce((s, v) => s + v.views, 0) / own.length;
    assert.equal(topic.avgViews, Math.round(avg));
  }
  // Сумма по кластерам равна числу роликов: ни один не потерян.
  assert.equal(topics.reduce((s, t) => s + t.count, 0), videos.length);
});

test('похожие ролики возвращают заголовки и ссылки на id', () => {
  const vectors = videos.map((v) => localEmbedding(v.title));
  const pairs = similarVideos(videos, vectors, { threshold: 0.6, limit: 5 });
  assert.ok(pairs.length > 0);
  for (const pair of pairs) {
    assert.ok(pair.a.id && pair.b.id, 'потерян id ролика — ссылка не построится');
    assert.ok(pair.a.title.length > 0);
    assert.ok(pair.score > 0 && pair.score <= 1);
  }
});

test('повторный анализ того же набора даёт тот же результат', async () => {
  const embedder = createEmbedder({ provider: 'local' });
  const first = await analyseContent(videos, { embedder });
  const second = await analyseContent(videos, { embedder });
  assert.deepEqual(
    first.topics.map((t) => `${t.label}:${t.count}`),
    second.topics.map((t) => `${t.label}:${t.count}`),
  );
});
