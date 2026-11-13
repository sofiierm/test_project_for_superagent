// Официальные API платформ (#8).
//
// Сети в тестах нет: `fetchImpl` подменяется, поэтому проверяется наш разбор
// ответов и обработка ошибок, а не доступность googleapis.com из песочницы.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.YOUTUBE_API_KEY = 'test-key';
process.env.TOKEN_SECRET = 'test-secret-at-least-16-chars';

const {
  CAPABILITIES, OfficialApiError, SUPPORTED_PLATFORMS, fetchAccount, officialConfigured,
  parseDuration, probeOfficial, refreshVideoStats,
} = await import('../../src/providers/official.mjs');

/** Ответ YouTube API на запрос канала. */
const CHANNEL_RESPONSE = {
  items: [{
    id: 'UC123',
    snippet: { title: 'Тестовый канал', description: 'Описание канала', thumbnails: { high: { url: 'https://img/avatar.jpg' } } },
    statistics: { subscriberCount: '1500', videoCount: '42' },
    contentDetails: { relatedPlaylists: { uploads: 'UU123' } },
  }],
};

const PLAYLIST_RESPONSE = {
  items: [
    { contentDetails: { videoId: 'vid1' } },
    { contentDetails: { videoId: 'vid2' } },
  ],
};

const VIDEOS_RESPONSE = {
  items: [
    {
      id: 'vid1',
      snippet: {
        title: 'Рецепт борща',
        description: 'Простой рецепт #борщ #обед',
        publishedAt: '2026-10-01T10:00:00Z',
        tags: ['суп'],
        thumbnails: { high: { url: 'https://img/1.jpg' } },
        defaultAudioLanguage: 'ru',
      },
      statistics: { viewCount: '10000', likeCount: '500', commentCount: '50' },
      contentDetails: { duration: 'PT8M30S' },
    },
    {
      id: 'vid2',
      snippet: { title: 'Второй ролик', description: '', publishedAt: '2026-10-02T10:00:00Z' },
      statistics: { viewCount: '2000' },
      contentDetails: { duration: 'PT45S' },
    },
  ],
};

/** Подставной fetch: отвечает по пути запроса. */
function mockFetch(routes) {
  const calls = [];
  const impl = async (url) => {
    calls.push(String(url));
    for (const [fragment, handler] of Object.entries(routes)) {
      if (String(url).includes(fragment)) {
        const result = typeof handler === 'function' ? handler() : handler;
        if (result instanceof Error) throw result;
        if (result && result.status && result.status >= 400) {
          return { ok: false, status: result.status, json: async () => result.body ?? {} };
        }
        return { ok: true, status: 200, json: async () => result };
      }
    }
    throw new Error(`Неожиданный запрос: ${url}`);
  };
  impl.calls = calls;
  return impl;
}

const HAPPY_ROUTES = {
  '/channels': CHANNEL_RESPONSE,
  '/playlistItems': PLAYLIST_RESPONSE,
  '/videos': VIDEOS_RESPONSE,
};

// ---- Разбор ----

test('длительность ISO-8601 разбирается в секунды', () => {
  assert.equal(parseDuration('PT45S'), 45);
  assert.equal(parseDuration('PT1M30S'), 90);
  assert.equal(parseDuration('PT1H2M3S'), 3723);
  assert.equal(parseDuration('PT1H'), 3600);
  // Мусор не должен давать NaN: он попал бы в метрики.
  assert.equal(parseDuration('не длительность'), 0);
  assert.equal(parseDuration(''), 0);
  assert.equal(parseDuration(null), 0);
});

test('официальный провайдер считает себя настроенным только с ключом', () => {
  assert.equal(officialConfigured(), true);
});

test('YouTube указан как поддерживаемая платформа, Instagram и TikTok — нет', () => {
  assert.deepEqual(SUPPORTED_PLATFORMS, ['youtube']);
  assert.equal(probeOfficial('instagram').available, false);
  assert.match(probeOfficial('instagram').reason, /авторизации владельца/);
  assert.equal(probeOfficial('tiktok').available, false);
});

test('возможности API описаны честно: что есть и чего нет', () => {
  const youtube = CAPABILITIES.youtube;
  assert.ok(youtube.available.includes('просмотры'));
  // Сохранения YouTube не отдаёт — это должно быть записано, а не забыто.
  assert.ok(youtube.missing.includes('сохранения'));
  assert.ok(youtube.missing.includes('репосты'));
  assert.match(youtube.note, /нулевыми/);
});

// ---- Успешный разбор ----

test('профиль и ролики разбираются из ответов YouTube API', async () => {
  const fetchImpl = mockFetch(HAPPY_ROUTES);
  const result = await fetchAccount('youtube', '@testchan', { fetchImpl, limit: 10 });

  assert.equal(result.account.platform, 'youtube');
  assert.equal(result.account.displayName, 'Тестовый канал');
  assert.equal(result.account.followers, 1500);
  assert.equal(result.account.postsCount, 42);
  assert.equal(result.account.source, 'official');
  assert.equal(result.account.avatarUrl, 'https://img/avatar.jpg');

  assert.equal(result.videos.length, 2);
  const first = result.videos[0];
  assert.equal(first.externalId, 'vid1');
  assert.equal(first.views, 10000);
  assert.equal(first.likes, 500);
  assert.equal(first.comments, 50);
  assert.equal(first.durationSeconds, 510);
  assert.equal(first.url, 'https://www.youtube.com/watch?v=vid1');
  // Хештеги приходят и из описания, и из тегов.
  assert.ok(first.hashtags.includes('борщ'));
  assert.ok(first.hashtags.includes('обед'));
  assert.ok(first.hashtags.includes('суп'));
  // Сохранения и репосты API не отдаёт: ноль — это «нет данных», а не ошибка.
  assert.equal(first.shares, 0);
  assert.equal(first.saves, 0);
});

test('официальный провайдер делает три запроса, а не запрос на каждый ролик', async () => {
  const fetchImpl = mockFetch(HAPPY_ROUTES);
  await fetchAccount('youtube', '@testchan', { fetchImpl, limit: 10 });
  assert.equal(fetchImpl.calls.length, 3, `запросов: ${fetchImpl.calls.length}`);
  assert.ok(fetchImpl.calls[0].includes('/channels'));
  assert.ok(fetchImpl.calls[1].includes('/playlistItems'));
  assert.ok(fetchImpl.calls[2].includes('/videos'));
});

test('скрытые подписчики сопровождаются предупреждением', async () => {
  const fetchImpl = mockFetch({
    '/channels': {
      items: [{
        ...CHANNEL_RESPONSE.items[0],
        statistics: { hiddenSubscriberCount: true, videoCount: '10' },
      }],
    },
    '/playlistItems': PLAYLIST_RESPONSE,
    '/videos': VIDEOS_RESPONSE,
  });
  const result = await fetchAccount('youtube', '@hidden', { fetchImpl });
  assert.equal(result.account.followers, 0);
  assert.match(result.warnings.join(' '), /скрывает число подписчиков/);
});

test('пустой канал — это предупреждение, а не пустой экран без объяснений', async () => {
  const fetchImpl = mockFetch({
    '/channels': CHANNEL_RESPONSE,
    '/playlistItems': { items: [] },
  });
  const result = await fetchAccount('youtube', '@empty', { fetchImpl });
  assert.equal(result.videos.length, 0);
  assert.match(result.warnings.join(' '), /нет доступных роликов/);
});

// ---- Ошибки ----

test('ненайденный канал даёт понятную ошибку', async () => {
  const fetchImpl = mockFetch({ '/channels': { items: [] } });
  await assert.rejects(
    () => fetchAccount('youtube', '@nobody', { fetchImpl }),
    (error) => {
      assert.ok(error instanceof OfficialApiError);
      assert.equal(error.code, 'not_found');
      assert.match(error.hint, /Проверьте ник/);
      return true;
    },
  );
});

test('исчерпанная квота объясняется отдельно от прочих ошибок', async () => {
  const fetchImpl = mockFetch({
    '/channels': { status: 403, body: { error: { errors: [{ reason: 'quotaExceeded' }] } } },
  });
  await assert.rejects(
    () => fetchAccount('youtube', '@test', { fetchImpl }),
    (error) => {
      assert.equal(error.code, 'quota');
      assert.match(error.message, /Квота/);
      assert.match(error.hint, /полночь/);
      return true;
    },
  );
});

test('неверный ключ не маскируется под ошибку сети', async () => {
  const fetchImpl = mockFetch({
    '/channels': { status: 400, body: { error: { errors: [{ reason: 'keyInvalid' }] } } },
  });
  await assert.rejects(
    () => fetchAccount('youtube', '@test', { fetchImpl }),
    (error) => {
      assert.equal(error.code, 'bad_key');
      assert.match(error.hint, /YOUTUBE_API_KEY/);
      return true;
    },
  );
});

test('сетевая ошибка превращается в OfficialApiError, а не в голый TypeError', async () => {
  const fetchImpl = async () => { throw new Error('сеть недоступна'); };
  await assert.rejects(
    () => fetchAccount('youtube', '@test', { fetchImpl }),
    (error) => {
      assert.ok(error instanceof OfficialApiError);
      assert.equal(error.code, 'network');
      return true;
    },
  );
});

test('неподдерживаемая платформа отклоняется до запроса в сеть', async () => {
  let called = 0;
  const fetchImpl = async () => { called += 1; return { ok: true, json: async () => ({}) }; };
  await assert.rejects(
    () => fetchAccount('instagram', '@user', { fetchImpl }),
    (error) => {
      assert.equal(error.code, 'unsupported_platform');
      assert.match(error.hint, /PROVIDER=demo/);
      return true;
    },
  );
  assert.equal(called, 0, 'запрос ушёл, хотя платформа не поддерживается');
});

test('таймаут объясняется как таймаут', async () => {
  const fetchImpl = async () => {
    const error = new Error('aborted');
    error.name = 'AbortError';
    throw error;
  };
  await assert.rejects(
    () => fetchAccount('youtube', '@test', { fetchImpl }),
    (error) => {
      assert.equal(error.code, 'timeout');
      assert.match(error.hint, /PROVIDER_TIMEOUT_MS/);
      return true;
    },
  );
});

// ---- Обновление метрик ----

test('точечное обновление метрик читает только статистику', async () => {
  const fetchImpl = mockFetch({
    '/videos': { items: [{ id: 'vid1', statistics: { viewCount: '12345', likeCount: '600', commentCount: '70' } }] },
  });
  const stats = await refreshVideoStats(['vid1'], { fetchImpl });
  assert.deepEqual(stats, [{ externalId: 'vid1', views: 12345, likes: 600, comments: 70 }]);
  assert.ok(fetchImpl.calls[0].includes('part=statistics'));
});

test('пустой список id не вызывает API', async () => {
  let called = 0;
  const fetchImpl = async () => { called += 1; };
  assert.deepEqual(await refreshVideoStats([], { fetchImpl }), []);
  assert.equal(called, 0);
});
