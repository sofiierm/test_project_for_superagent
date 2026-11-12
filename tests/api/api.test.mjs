// Интеграционные тесты HTTP API и хранилища.
//
// Каждый запуск работает на свежей временной базе и на свободном порту:
// тесты не трогают рабочие данные и не конфликтуют между собой.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-test-'));
process.env.DATA_DIR = tmpDir;
process.env.DB_PATH = path.join(tmpDir, 'test.db');
process.env.PROVIDER = 'demo';
process.env.SEED_DEMO = 'true';

const { createServer } = await import('../../src/server.mjs');
const { getDb } = await import('../../src/db/index.mjs');
const { closeDb } = await import('../../src/db/index.mjs');
const { seedDemoData } = await import('../../src/services/seed.mjs');
const { listAccounts } = await import('../../src/db/accounts.mjs');
const { listVideos } = await import('../../src/db/videos.mjs');

getDb();
seedDemoData();

const server = createServer({ mode: 'demo', providerReason: 'тестовый режим' });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

test.after(() => {
  server.close();
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const request = (pathname, options = {}) => fetch(base + pathname, {
  headers: { 'Content-Type': 'application/json' },
  ...options,
});

test('демо-данные создают три аккаунта по одной платформе', () => {
  const accounts = listAccounts();
  assert.equal(accounts.length, 3);
  assert.deepEqual(
    accounts.map((a) => a.platform).sort(),
    ['instagram', 'tiktok', 'youtube'],
  );
  for (const account of accounts) {
    assert.equal(account.source, 'demo');
    assert.ok(account.videosCount > 0, `у @${account.handle} нет роликов`);
  }
});

test('главная страница отдаётся с корректным HTML и заголовком', async () => {
  const response = await request('/');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/html/);
  assert.match(response.headers.get('content-security-policy'), /default-src 'self'/);
  const body = await response.text();
  assert.match(body, /<h1>Обзор<\/h1>/);
  assert.match(body, /lang="ru"/);
  assert.ok(!body.includes('NaN'), 'в разметке есть NaN');
  assert.ok(!body.includes('undefined'), 'в разметке есть undefined');
});

test('неизвестный маршрут даёт 404, а не пустую страницу', async () => {
  assert.equal((await request('/nope')).status, 404);
  assert.equal((await request('/accounts/99999')).status, 404);
  assert.equal((await request('/videos/99999')).status, 404);
});

test('страницы аккаунта и ролика открываются по id', async () => {
  const account = listAccounts()[0];
  const accountPage = await request(`/accounts/${account.id}`);
  assert.equal(accountPage.status, 200);
  const html = await accountPage.text();
  assert.ok(html.includes(`@${account.handle}`));

  const video = listVideos({ accountId: account.id, limit: 1 })[0];
  const videoPage = await request(`/videos/${video.id}`);
  assert.equal(videoPage.status, 200);
});

test('API списка аккаунтов отдаёт метрики в camelCase', async () => {
  const response = await request('/api/accounts');
  assert.equal(response.status, 200);
  const { accounts } = await response.json();
  assert.equal(accounts.length, 3);
  for (const account of accounts) {
    assert.ok(account.displayName !== undefined);
    assert.equal(account.display_name, undefined);
    assert.ok(account.videosCount > 0);
    assert.ok(account.totalViews > 0);
  }
});

test('добавление аккаунта: валидация, дубль и успех', async () => {
  const invalid = await request('/api/accounts', {
    method: 'POST',
    body: JSON.stringify({ account: 'https://vk.com/someone' }),
  });
  assert.equal(invalid.status, 422);
  assert.match((await invalid.json()).error, /платформ/i);

  const duplicate = await request('/api/accounts', {
    method: 'POST',
    body: JSON.stringify({ account: 'masha.eats', platform: 'instagram' }),
  });
  assert.equal(duplicate.status, 409);

  const created = await request('/api/accounts', {
    method: 'POST',
    body: JSON.stringify({ account: 'https://www.instagram.com/coach.artem/' }),
  });
  assert.equal(created.status, 201);
  const payload = await created.json();
  assert.equal(payload.account.handle, 'coach.artem');
  assert.ok(payload.videosFound > 0);
});

test('аккаунт без демо-профиля создаётся с нулевыми метриками и предупреждением', async () => {
  const response = await request('/api/accounts', {
    method: 'POST',
    body: JSON.stringify({ account: 'https://www.tiktok.com/@unknown_creator_xyz' }),
  });
  assert.equal(response.status, 201);
  const payload = await response.json();
  assert.equal(payload.account.handle, 'unknown_creator_xyz');
  assert.ok(payload.warning.length > 0, 'нет предупреждения о демо-данных');

  // Не должно появиться выдуманных просмотров.
  const videos = listVideos({ accountId: payload.account.id });
  assert.equal(videos.length, 0);

  const accountPage = await request(`/accounts/${payload.account.id}`);
  assert.equal(accountPage.status, 200);
  const html = await accountPage.text();
  assert.ok(!html.includes('NaN'), 'в пустом аккаунте есть NaN');
});

test('синхронизация идемпотентна: повторный запуск не дублирует ролики', async () => {
  const account = listAccounts().find((a) => a.handle === 'ProCoding');
  const before = listVideos({ accountId: account.id }).length;
  const response = await request(`/api/accounts/${account.id}/sync`, { method: 'POST' });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.videosNew, 0, 'повторная синхронизация создала дубли');
  assert.equal(listVideos({ accountId: account.id }).length, before);
});

test('синхронизация несуществующего аккаунта даёт 404', async () => {
  const response = await request('/api/accounts/99999/sync', { method: 'POST' });
  assert.equal(response.status, 404);
});

test('CSV содержит BOM, разделитель и все ролики', async () => {
  const response = await request('/api/videos.csv');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/csv/);
  assert.match(response.headers.get('content-disposition'), /attachment/);
  // fetch().text() по спецификации срезает BOM, поэтому проверяем байты.
  const bytes = new Uint8Array(await response.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xEF, 0xBB, 0xBF], 'нет BOM для Excel');
  const text = new TextDecoder('utf-8').decode(bytes);
  const lines = text.trim().split('\n');
  const total = listVideos({ limit: 5000 }).length;
  assert.equal(lines.length, total + 1);
  assert.match(lines[0].replace(/^\uFEFF/, ''), /^platform;handle;external_id;title;/);
});

test('CSV экранирует точку с запятой и кавычки в названии', async () => {
  const response = await request('/api/videos.csv');
  const text = await response.text();
  // В демо-названиях есть длинные тире и запятые — проверяем, что строки не рвутся.
  for (const line of text.trim().split('\n').slice(1)) {
    const columns = splitCsv(line);
    assert.equal(columns.length, 13, `строка развалилась: ${line.slice(0, 80)}`);
  }
});

test('удаление аккаунта убирает его ролики', async () => {
  const created = await request('/api/accounts', {
    method: 'POST',
    body: JSON.stringify({ account: 'https://www.youtube.com/@ТихийВлог' }),
  });
  assert.equal(created.status, 201);
  const { account } = await created.json();
  assert.ok(listVideos({ accountId: account.id }).length > 0);

  const deleted = await request(`/api/accounts/${account.id}`, { method: 'DELETE' });
  assert.equal(deleted.status, 200);
  assert.equal(listVideos({ accountId: account.id }).length, 0);
  assert.equal((await request(`/accounts/${account.id}`)).status, 404);
});

test('API видео фильтрует по платформе', async () => {
  const response = await request('/api/videos?platform=youtube');
  assert.equal(response.status, 200);
  const { videos } = await response.json();
  assert.ok(videos.length > 0);
  for (const video of videos) assert.equal(video.platform, 'youtube');
});

test('нечисловой account в /api/videos — 422, а не все ролики', async () => {
  // Раньше Number('abc') давал NaN, фильтр молча исчезал, и клиент получал
  // ролики всех аккаунтов — правдоподобный, но чужой ответ.
  const response = await request('/api/videos?account=abc');
  assert.equal(response.status, 422);
  const payload = await response.json();
  assert.match(payload.error, /числовым id/);
  assert.equal(payload.videos, undefined, 'вместо ошибки пришли данные');
});

test('неизвестный account в /api/videos — 404, а не пустой список', async () => {
  const response = await request('/api/videos?account=99999');
  assert.equal(response.status, 404);
  assert.match((await response.json()).error, /не найден/i);
});

test('фильтр по account отдаёт только ролики этого аккаунта', async () => {
  const accounts = listAccounts();
  const response = await request(`/api/videos?account=${accounts[0].id}`);
  assert.equal(response.status, 200);
  const { videos } = await response.json();
  assert.ok(videos.length > 0);
  assert.deepEqual([...new Set(videos.map((v) => v.accountId))], [accounts[0].id]);
});

test('неизвестная платформа в /api/videos — 422 со списком допустимых', async () => {
  const response = await request('/api/videos?platform=myspace');
  assert.equal(response.status, 422);
  const payload = await response.json();
  assert.match(payload.hint, /instagram/);
  assert.match(payload.hint, /youtube/);
  assert.match(payload.hint, /tiktok/);
});

test('CSV с нечисловым account не отдаёт чужие данные', async () => {
  const response = await request('/api/videos.csv?account=abc');
  assert.equal(response.status, 422);
  assert.doesNotMatch(await response.text(), /platform;handle/, 'вместо ошибки пришёл CSV');
});

test('вовлечённость аккаунта включает сохранения и сходится с роликами', async () => {
  // ТЗ §5: вовлечённость = лайки + комментарии + репосты + сохранения.
  // Агрегат по аккаунту однажды потерял сохранения, и ER аккаунта разошёлся
  // с ER его же роликов.
  const account = listAccounts()[0];
  const videosResponse = await request(`/api/videos?account=${account.id}`);
  const { videos } = await videosResponse.json();
  const engagement = videos.reduce(
    (sum, v) => sum + v.likes + v.comments + v.shares + v.saves, 0,
  );
  const accountsResponse = await request('/api/accounts');
  const fromApi = (await accountsResponse.json()).accounts.find((a) => a.id === account.id);
  assert.equal(fromApi.totalEngagements, engagement);
  assert.ok(videos.some((v) => v.saves > 0), 'в демо-данных нет сохранений — проверка ничего не значит');
});

test('некорректный JSON в теле возвращает 400, а не падает', async () => {
  const response = await request('/api/accounts', { method: 'POST', body: '{не json' });
  assert.equal(response.status, 400);
});

test('неподдерживаемый метод возвращает 405', async () => {
  const response = await request('/accounts', { method: 'PUT' });
  assert.equal(response.status, 405);
});

test('статика отдаётся с правильным типом, обход каталога закрыт', async () => {
  const css = await request('/styles/app.css');
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type'), /text\/css/);

  const font = await request('/fonts/manrope-cyrillic.woff2');
  assert.equal(font.status, 200);
  assert.match(font.headers.get('content-type'), /font\/woff2/);
  assert.match(font.headers.get('cache-control'), /immutable/);

  // Попытка выйти за пределы public/ не должна отдавать файлы проекта.
  const traversal = await fetch(`${base}/styles/..%2f..%2fpackage.json`);
  assert.notEqual(traversal.status, 200);
});

test('health сообщает режим и статистику', async () => {
  const response = await request('/api/health');
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.mode, 'demo');
  assert.ok(payload.stats.accounts >= 3);
  assert.ok(payload.stats.videos > 0);
});

function splitCsv(line) {
  const values = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') { current += '"'; i += 1; } else if (char === '"') quoted = false;
      else current += char;
    } else if (char === '"') quoted = true;
    else if (char === ';') { values.push(current); current = ''; } else current += char;
  }
  values.push(current);
  return values;
}
