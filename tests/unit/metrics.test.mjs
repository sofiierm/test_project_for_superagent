// Тесты анализа: детерминированные данные, без сети и без базы.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bestTimes, buildSeries, cadence, engagementRate, erBenchmark, findOutliers, median,
  periodDelta, rankVideos, summariseVideos,
} from '../../src/analysis/metrics.mjs';
import {
  analyzeHooks, analyzeSentiment, detectHooks, extractHashtags, extractTopics,
} from '../../src/analysis/text.mjs';
import { buildInsights } from '../../src/analysis/insights.mjs';

const DAY = 24 * 3600 * 1000;

function video(overrides = {}) {
  return {
    id: overrides.id ?? 1,
    title: 'Как готовить ужин за 15 минут',
    description: 'Простой рецепт. Сохрани видео и напиши, что получилось.',
    transcript: '',
    hashtags: ['рецепты', 'ужин'],
    publishedAt: new Date(Date.now() - 3 * DAY).toISOString(),
    durationSeconds: 45,
    views: 10_000,
    likes: 500,
    comments: 40,
    shares: 10,
    saves: 50,
    ...overrides,
  };
}

test('ER считается от просмотров, а не от подписчиков', () => {
  const v = video({ views: 1000, likes: 50, comments: 30, shares: 10, saves: 10 });
  assert.equal(engagementRate(v), 10);
});

test('ER при нулевых просмотрах не даёт деления на ноль', () => {
  assert.equal(engagementRate(video({ views: 0 })), 0);
});

test('медиана устойчива к одному вирусному ролику', () => {
  assert.equal(median([1, 2, 3, 4, 1000]), 3);
  const summary = summariseVideos([
    video({ id: 1, views: 1000 }),
    video({ id: 2, views: 1100 }),
    video({ id: 3, views: 900 }),
    video({ id: 4, views: 1_000_000 }),
  ]);
  assert.equal(summary.medianViews, 1050);
  assert.ok(summary.avgViews > summary.medianViews * 10);
});

test('ряд по дням заполняет пустые интервалы нулями', () => {
  const now = new Date('2026-05-20T12:00:00Z');
  const rows = buildSeries([
    video({ publishedAt: '2026-05-19T10:00:00Z', views: 100 }),
  ], { days: 7, bucket: 'day', now });
  assert.equal(rows.length, 8);
  assert.equal(rows.find((r) => r.key === '2026-05-19').views, 100);
  assert.equal(rows.find((r) => r.key === '2026-05-18').views, 0);
});

test('ряд по неделям начинается с понедельника', () => {
  const now = new Date('2026-05-20T12:00:00Z'); // среда
  const rows = buildSeries([], { days: 14, bucket: 'week', now });
  for (const row of rows) {
    assert.equal(new Date(`${row.key}T00:00:00Z`).getUTCDay(), 1, `ключ ${row.key} не понедельник`);
  }
});

test('сравнение периодов возвращает null, когда сравнивать не с чем', () => {
  const delta = periodDelta([video({ publishedAt: new Date().toISOString() })], { days: 30 });
  assert.equal(delta.change, null);
  assert.match(delta.reason, /Недостаточно данных/);
});

test('сравнение периодов считает рост просмотров', () => {
  const now = new Date('2026-05-20T12:00:00Z');
  const videos = [
    video({ id: 1, publishedAt: '2026-05-10T10:00:00Z', views: 300 }),
    video({ id: 2, publishedAt: '2026-04-10T10:00:00Z', views: 200 }),
  ];
  const delta = periodDelta(videos, { days: 30, now, metric: 'views' });
  assert.equal(delta.current, 300);
  assert.equal(delta.previous, 200);
  assert.equal(Math.round(delta.change), 50);
});

test('выбросы определяются правилом Тьюки', () => {
  const videos = [
    video({ id: 1, views: 1000 }), video({ id: 2, views: 1100 }),
    video({ id: 3, views: 900 }), video({ id: 4, views: 1050 }),
    video({ id: 5, views: 950 }), video({ id: 6, views: 50_000 }),
  ];
  const outliers = findOutliers(videos);
  assert.equal(outliers.high.length, 1);
  assert.equal(outliers.high[0].views, 50_000);
});

test('на малой выборке выбросы не выдумываются', () => {
  const outliers = findOutliers([video({ id: 1 }), video({ id: 2 })]);
  assert.deepEqual(outliers.high, []);
  assert.equal(outliers.threshold, null);
});

test('ритм публикаций считает медианный интервал', () => {
  const now = new Date('2026-05-20T12:00:00Z');
  const videos = [
    video({ publishedAt: '2026-05-16T10:00:00Z' }),
    video({ publishedAt: '2026-05-14T10:00:00Z' }),
    video({ publishedAt: '2026-05-12T10:00:00Z' }),
  ];
  const pace = cadence(videos, { now });
  assert.equal(Math.round(pace.medianGapDays), 2);
  assert.equal(Math.round(pace.daysSinceLast), 4);
});

test('лучшие часы считаются в часовом поясе приложения', () => {
  const videos = [
    video({ id: 1, publishedAt: '2026-05-10T07:00:00Z' }), // 10:00 МСК
    video({ id: 2, publishedAt: '2026-05-11T07:00:00Z' }),
    video({ id: 3, publishedAt: '2026-05-12T07:00:00Z' }),
    video({ id: 4, publishedAt: '2026-05-13T17:00:00Z' }), // 20:00 МСК
  ];
  const times = bestTimes(videos);
  const tenOClock = times.hours.find((h) => h.key === 10);
  assert.ok(tenOClock, 'не найден час 10:00 МСК');
  assert.equal(tenOClock.count, 3);
  assert.equal(tenOClock.confidence, 'ok');
  const best = times.hours[0];
  assert.equal(best.key, 10);
});

test('ранжирование переворачивается в обратную сторону', () => {
  const videos = [video({ id: 1, views: 10 }), video({ id: 2, views: 99 }), video({ id: 3, views: 50 })];
  assert.equal(rankVideos(videos, { metric: 'views' })[0].id, 2);
  assert.equal(rankVideos(videos, { metric: 'views', direction: 'asc' })[0].id, 1);
});

test('темы не содержат стоп-слов и склеивают словоформы', () => {
  const videos = [
    video({ id: 1, title: 'Рецепт ужина', description: 'рецепты ужин', hashtags: [] }),
    video({ id: 2, title: 'Рецепты на неделю', description: 'рецептов много', hashtags: [] }),
    video({ id: 3, title: 'Ужины быстро', description: 'ужин', hashtags: [] }),
  ];
  const topics = extractTopics(videos, { includeHashtags: false });
  const labels = topics.map((t) => t.stem);
  assert.ok(labels.includes('рецепт'), `основы: ${labels.join(',')}`);
  assert.ok(labels.includes('ужин'));
  assert.ok(!labels.includes('и'));
  assert.ok(!labels.some((l) => l === 'виде' || l === 'смотри'));
  const recept = topics.find((t) => t.stem === 'рецепт');
  assert.equal(recept.count, 2);
});

test('темы различают охват: множитель больше единицы у результативных', () => {
  const blank = { description: 'Коротко о главном.', hashtags: [] };
  const videos = [
    video({ ...blank, id: 1, title: 'Рецепт', views: 10_000 }),
    video({ ...blank, id: 2, title: 'Рецепт', views: 10_000 }),
    video({ ...blank, id: 3, title: 'Съёмка', views: 1_000 }),
  ];
  const topics = extractTopics(videos, { includeHashtags: false });
  const recept = topics.find((t) => t.stem === 'рецепт');
  assert.ok(recept, 'тема «рецепт» не найдена');
  // Средний охват по всем роликам 7000, у роликов с темой — 10000.
  assert.ok(recept.lift > 1.3, `множитель ${recept.lift}`);
  const syomka = topics.find((t) => t.stem === 'съемк' || t.stem.startsWith('съем'));
  if (syomka) assert.ok(syomka.lift < 1, `у слабой темы множитель ${syomka.lift}`);
});

test('хештеги считаются без дублей внутри одного ролика', () => {
  const tags = extractHashtags([
    video({ id: 1, hashtags: ['рецепты', 'ужин'] }),
    video({ id: 2, hashtags: ['рецепты', 'ужин'] }),
  ]);
  assert.equal(tags[0].count, 2);
  assert.equal(tags.length, 2);
});

test('приёмы подачи распознаются в кириллическом тексте', () => {
  const withCta = detectHooks(video({ description: 'Подпишись и напиши в комментариях!' }));
  assert.equal(withCta.cta, true);
  const question = detectHooks(video({ title: 'А ты как делаешь?' }));
  assert.equal(question.question, true);
  const plain = detectHooks(video({ title: 'Тихий влог', description: 'Просто день.' }));
  assert.equal(plain.cta, false);
  assert.equal(plain.question, false);
});

test('призыв не срабатывает на слово, содержащее «лайк» внутри', () => {
  const hooks = detectHooks(video({ title: 'Лайкозависимость', description: 'Разбор термина.' }));
  assert.equal(hooks.cta, false);
});

test('анализ приёмов не сравнивает приёмы на пустой выборке', () => {
  const hooks = analyzeHooks([video({ id: 1 }), video({ id: 2 })]);
  for (const hook of hooks) {
    assert.equal(hook.hasEnoughData, false);
  }
});

test('тональность различает позитив и негатив', () => {
  const sentiment = analyzeSentiment([
    video({ id: 1, title: 'Отлично работает, рекомендую', description: 'полезно и легко' }),
    video({ id: 2, title: 'Провал и ошибка', description: 'сложно и больно' }),
    video({ id: 3, title: 'Просто день', description: 'ничего особенного' }),
  ]);
  assert.ok(sentiment.positive > 20, `позитив ${sentiment.positive}`);
  assert.ok(sentiment.negative > 20, `негатив ${sentiment.negative}`);
  assert.equal(Math.round(sentiment.positive + sentiment.negative + sentiment.neutral), 100);
});

test('тональность помечается ненадёжной на малой выборке', () => {
  assert.equal(analyzeSentiment([video()]).reliable, false);
});

test('выводы не пустые и отсортированы по важности', () => {
  const videos = Array.from({ length: 8 }, (_, i) => video({
    id: i + 1,
    views: i === 0 ? 100_000 : 5_000 + i * 100,
    publishedAt: new Date(Date.now() - (i * 3 + 1) * DAY).toISOString(),
  }));
  const insights = buildInsights(videos, { followers: 50_000, account: { platform: 'instagram' } });
  assert.ok(insights.length > 0);
  const order = { critical: 0, warning: 1, opportunity: 2, info: 3 };
  for (let i = 1; i < insights.length; i += 1) {
    assert.ok(order[insights[i - 1].level] <= order[insights[i].level], 'нарушен порядок важности');
  }
  for (const insight of insights) {
    assert.ok(insight.title.length > 0);
    assert.ok(insight.detail.length > 0);
  }
});

test('выводы на пустом наборе объясняют, что данных нет', () => {
  const insights = buildInsights([]);
  assert.equal(insights[0].id, 'no-data');
});

test('на обзоре нескольких аккаунтов ритм не смешивается', () => {
  const a = { id: 1, handle: 'a', platform: 'youtube' };
  const b = { id: 2, handle: 'b', platform: 'youtube' };
  const videos = [
    video({ id: 1, accountId: 1, publishedAt: new Date(Date.now() - 1 * DAY).toISOString() }),
    video({ id: 2, accountId: 1, publishedAt: new Date(Date.now() - 3 * DAY).toISOString() }),
    video({ id: 3, accountId: 2, publishedAt: new Date(Date.now() - 2 * DAY).toISOString() }),
    video({ id: 4, accountId: 2, publishedAt: new Date(Date.now() - 40 * DAY).toISOString() }),
  ];
  const insights = buildInsights(videos, { accounts: [a, b] });
  const cadenceInsights = insights.filter((i) => i.metric === 'cadence');
  // Второй аккаунт встал: должен быть вывод про него, а не «раз в день» по всем.
  if (cadenceInsights.length) {
    assert.match(cadenceInsights[0].title, /@[ab]/);
  }
});

test('ориентиры ER заданы для трёх платформ и только для них', () => {
  assert.equal(erBenchmark('instagram'), 4);
  assert.equal(erBenchmark('youtube'), 2.5);
  assert.equal(erBenchmark('tiktok'), 5);
  assert.equal(erBenchmark('vk'), null);
  assert.equal(erBenchmark(undefined), null);
});

test('низкий ER даёт предупреждение со ссылкой на ориентир платформы', () => {
  const videos = Array.from({ length: 6 }, (_, i) => video({
    id: i + 1,
    views: 100_000,
    likes: 300,
    comments: 20,
    shares: 5,
    saves: 5,
    publishedAt: new Date(Date.now() - (i + 1) * DAY).toISOString(),
  }));
  const insights = buildInsights(videos, { followers: 10_000, account: { platform: 'instagram' } });
  const low = insights.find((i) => i.id === 'er-low');
  assert.ok(low, 'нет вывода о низком ER');
  // В тексте — именно ориентир, а не «типичное значение» без источника.
  assert.match(low.detail, /ориентир/i);
});
