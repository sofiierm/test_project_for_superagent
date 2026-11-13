// Разделение доступа по HTTP (#7): то, что видит посторонний.
//
// Отдельный файл, а не дополнение к api.test.mjs: конфигурация читается при
// импорте, поэтому AUTH_REQUIRED нужно выставить до загрузки сервера. В одном
// процессе совместить «режим без входа» и «режим с входом» нельзя.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-auth-api-'));
process.env.DATA_DIR = tmpDir;
process.env.DB_PATH = path.join(tmpDir, 'auth.db');
process.env.PROVIDER = 'demo';
process.env.SEED_DEMO = 'false';
process.env.SYNC_SCHEDULER = 'false';
process.env.AUTH_REQUIRED = 'true';
process.env.SESSION_SECRET = 'test-secret-at-least-16-chars-long';

const { createServer } = await import('../../src/server.mjs');
const { closeDb, getDb } = await import('../../src/db/index.mjs');
const { insertAccount, listAccounts } = await import('../../src/db/accounts.mjs');
const { hashPassword } = await import('../../src/lib/auth.mjs');
const { insertUser } = await import('../../src/db/users.mjs');

getDb();

const server = createServer({ mode: 'demo', providerReason: 'тестовый режим' });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

test.after(() => {
  server.close();
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const request = (pathname, options = {}) => fetch(base + pathname, { redirect: 'manual', ...options });

/**
 * CSRF-cookie и токен со страницы формы.
 *
 * Браузер получает их обычным GET; тест делает то же самое, иначе проверял бы
 * сценарий, недоступный настоящему пользователю без JavaScript.
 */
async function csrfFromForm(pathname) {
  const page = await request(pathname);
  const html = await page.text();
  const token = html.match(/name="_csrf" value="([^"]+)"/)?.[1] ?? '';
  const cookie = (page.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  return { token, cookie };
}

/** Вход так, как его делает браузер: GET формы → POST с токеном из неё. */
async function signIn(email, password) {
  const { token, cookie: preCookie } = await csrfFromForm('/login');
  const response = await request('/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie: preCookie },
    body: new URLSearchParams({ email, password, _csrf: token }),
  });
  const setCookies = response.headers.getSetCookie?.() ?? [];
  const cookie = setCookies.map((c) => c.split(';')[0]).join('; ');
  const csrf = setCookies.find((c) => c.startsWith('ca_csrf='))?.split(';')[0]?.split('=')[1] ?? '';
  return { status: response.status, cookie, csrf };
}

test('на пустой базе гость получает предложение настроить доступ', async () => {
  const page = await request('/');
  assert.equal(page.status, 303);
  assert.equal(page.headers.get('location'), '/setup');

  const setup = await request('/setup');
  assert.equal(setup.status, 200);
  assert.match(await setup.text(), /Настройте доступ/);
});

test('API и страницы закрыты без сессии', async () => {
  for (const pathname of ['/api/accounts', '/api/videos', '/accounts', '/videos', '/compare']) {
    const response = await request(pathname);
    assert.equal(response.status, 303, `${pathname} отдан гостю`);
    assert.equal(response.headers.get('location'), '/setup');
  }
});

test('настройка владельца сразу входит в сервис', async () => {
  const { token, cookie: preCookie } = await csrfFromForm('/setup');
  assert.ok(token, 'на форме настройки нет CSRF-токена');

  const setup = await request('/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie: preCookie },
    body: new URLSearchParams({
      email: 'owner@example.com', password: 'password123', name: 'Владелец', _csrf: token,
    }),
  });
  assert.equal(setup.status, 303);
  assert.equal(setup.headers.get('location'), '/');

  const cookie = (setup.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  assert.match(cookie, /ca_session=/);

  const dashboard = await request('/', { headers: { cookie } });
  assert.equal(dashboard.status, 200);
  assert.match(await dashboard.text(), /Обзор/);
});

test('второй раз настроить владельца нельзя', async () => {
  const repeat = await request('/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: 'attacker@example.com', password: 'password123' }),
  });
  // Форма настройки больше не показывается, а POST перенаправляет на вход.
  assert.equal(repeat.status, 303);
  assert.equal(repeat.headers.get('location'), '/login');
});

test('изменяющий запрос без CSRF-токена отклоняется', async () => {
  const { cookie } = await signIn('owner@example.com', 'password123');
  const response = await request('/api/accounts', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: '@csrf_channel', platform: 'youtube' }),
  });
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.match(body.error, /CSRF/);
});

test('с CSRF-токеном владелец добавляет аккаунт и видит его', async () => {
  const { cookie, csrf } = await signIn('owner@example.com', 'password123');
  assert.ok(csrf, 'вход не выдал CSRF-cookie');

  const created = await request('/api/accounts', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json', 'x-csrf-token': csrf },
    body: JSON.stringify({ account: '@owner_channel', platform: 'youtube' }),
  });
  assert.equal(created.status, 201);

  const list = await request('/api/accounts', { headers: { cookie } });
  const { accounts } = await list.json();
  assert.deepEqual(accounts.map((a) => a.handle), ['owner_channel'], 'владелец не видит свой аккаунт');
});

test('наблюдатель не видит и не открывает чужие аккаунты', async () => {
  // Аккаунт владельца уже есть; создаём наблюдателя и его собственный аккаунт.
  const viewer = insertUser({
    email: 'viewer@example.com', passwordHash: hashPassword('password123'), role: 'viewer',
  });
  insertAccount({ platform: 'tiktok', handle: 'viewer_channel', ownerId: viewer.id });

  const { cookie, csrf } = await signIn('viewer@example.com', 'password123');

  const list = await request('/api/accounts', { headers: { cookie } });
  const { accounts } = await list.json();
  assert.deepEqual(accounts.map((a) => a.handle), ['viewer_channel'], 'видны чужие аккаунты');

  // Прямой адрес чужого аккаунта должен отвечать 404, а не 403: 403
  // подтвердил бы, что аккаунт существует.
  const ownerAccount = listAccounts().find((a) => a.handle === 'owner_channel');
  const foreign = await request(`/accounts/${ownerAccount.id}`, { headers: { cookie } });
  assert.equal(foreign.status, 404, 'чужой аккаунт открылся по прямому адресу');

  const foreignApi = await request(`/api/accounts/${ownerAccount.id}/videos`, { headers: { cookie } });
  assert.equal(foreignApi.status, 404);

  // Наблюдателю запрещена любая запись — и своя, и чужая. Ответ 403 здесь не
  // выдаёт существование аккаунта: он одинаков для любого id.
  const remove = await request(`/api/accounts/${ownerAccount.id}`, {
    method: 'DELETE', headers: { cookie, 'x-csrf-token': csrf },
  });
  assert.equal(remove.status, 403, 'наблюдатель смог удалить аккаунт');
  assert.match((await remove.json()).error, /Наблюдатель не может менять данные/);

  const removeOwn = await request(`/api/accounts/${accounts[0].id}`, {
    method: 'DELETE', headers: { cookie, 'x-csrf-token': csrf },
  });
  assert.equal(removeOwn.status, 403, 'наблюдатель смог удалить свой аккаунт');

  // Свой аккаунт по-прежнему доступен на чтение.
  const own = await request(`/accounts/${accounts[0].id}`, { headers: { cookie } });
  assert.equal(own.status, 200);
});

test('второй владелец получает 404 на чужой аккаунт, а не 403', async () => {
  // Роль позволяет удалять, поэтому отказ идёт по владению: 403 подтвердил бы,
  // что аккаунт существует (#7).
  insertUser({ email: 'owner2@example.com', passwordHash: hashPassword('password123'), role: 'owner' });
  const { cookie, csrf } = await signIn('owner2@example.com', 'password123');

  const foreign = listAccounts().find((a) => a.handle === 'owner_channel');
  const remove = await request(`/api/accounts/${foreign.id}`, {
    method: 'DELETE', headers: { cookie, 'x-csrf-token': csrf },
  });
  assert.equal(remove.status, 404, 'чужой аккаунт удалось удалить');

  const sync = await request(`/api/accounts/${foreign.id}/sync`, {
    method: 'POST', headers: { cookie, 'x-csrf-token': csrf },
  });
  assert.equal(sync.status, 404, 'чужой аккаунт удалось синхронизировать');

  // Аккаунт действительно на месте.
  assert.ok(listAccounts().some((a) => a.id === foreign.id));
});

test('фильтр роликов по чужому аккаунту не подтверждает его существование', async () => {
  const { cookie } = await signIn('viewer@example.com', 'password123');
  const ownerAccount = listAccounts().find((a) => a.handle === 'owner_channel');
  const response = await request(`/api/videos?account=${ownerAccount.id}`, { headers: { cookie } });
  assert.equal(response.status, 404);
});

test('выход закрывает доступ по старой cookie', async () => {
  const { cookie } = await signIn('owner@example.com', 'password123');
  assert.equal((await request('/', { headers: { cookie } })).status, 200);

  const out = await request('/logout', { method: 'POST', headers: { cookie } });
  assert.equal(out.status, 303);

  const after = await request('/', { headers: { cookie } });
  assert.equal(after.status, 303, 'сессия жива после выхода');
  assert.equal(after.headers.get('location'), '/login');
});

test('неверный пароль показывает форму с ошибкой, но не открывает сервис', async () => {
  const { token, cookie } = await csrfFromForm('/login');
  const response = await request('/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams({ email: 'owner@example.com', password: 'wrong-password', _csrf: token }),
  });
  assert.equal(response.status, 401);
  const html = await response.text();
  assert.match(html, /Неверный email или пароль/);
  assert.doesNotMatch(html, /ca_session/);
});

test('HTML-форма входа работает без JavaScript, с CSRF в скрытом поле', async () => {
  // Браузер без JS не умеет поставить заголовок, поэтому токен обязан
  // приниматься из тела формы — иначе вход был бы доступен только со скриптами.
  const page = await request('/login');
  const html = await page.text();
  const match = html.match(/name="_csrf" value="([^"]+)"/);
  assert.ok(match, 'на странице входа нет скрытого CSRF-поля');

  const cookie = (page.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  const response = await request('/login', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      email: 'owner@example.com', password: 'password123', _csrf: match[1],
    }),
  });
  assert.equal(response.status, 303, 'вход формой без JS не сработал');
  assert.equal(response.headers.get('location'), '/');
});

test('форма без CSRF-поля отклоняется', async () => {
  const response = await request('/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: 'owner@example.com', password: 'password123' }),
  });
  assert.equal(response.status, 403, 'форма без токена прошла');
});

test('наблюдатель не может открыть управление доступом', async () => {
  const { cookie } = await signIn('viewer@example.com', 'password123');
  const response = await request('/access', { headers: { cookie } });
  assert.equal(response.status, 403);
});
