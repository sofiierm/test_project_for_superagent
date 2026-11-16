// Публичная форма обратной связи и список обращений: HTTP-сценарии на
// временной базе. Проверяем не только «форма есть», но и что сообщение
// действительно сохраняется, повторно показывается и удаляется.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-feedback-'));
process.env.DATA_DIR = tmpDir;
process.env.DB_PATH = path.join(tmpDir, 'feedback.db');
process.env.PROVIDER = 'demo';
process.env.SEED_DEMO = 'false';
process.env.SYNC_SCHEDULER = 'false';

const { createServer } = await import('../../src/server.mjs');
const { closeDb, getDb } = await import('../../src/db/index.mjs');
const { countFeedback, deleteFeedback, listFeedback } = await import('../../src/db/feedback.mjs');
const {
  resetFeedbackRateLimit, submitFeedback,
} = await import('../../src/services/feedback.mjs');

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

/** Токен и cookie из формы — так же, как их получает браузер без JS. */
async function csrfFromFeedback() {
  const page = await request('/feedback');
  const html = await page.text();
  const token = html.match(/name="_csrf" value="([^"]+)"/)?.[1] ?? '';
  const cookie = (page.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  return { token, cookie };
}

const formPost = (body, cookie = '') => request('/feedback', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(cookie ? { cookie } : {}) },
  body: new URLSearchParams(body),
});

test('публичная страница показывает все три поля и скрытый токен', async () => {
  const page = await request('/feedback');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  const html = await page.text();
  assert.match(html, /<h1 class="auth__title">Обратная связь<\/h1>/);
  assert.match(html, /name="name"/);
  assert.match(html, /name="phone"/);
  assert.match(html, /name="comment"/);
  assert.match(html, /name="_csrf"/);
  assert.match(html, /name="website"/, 'нет honeypot-поля');
});

test('корректное обращение сохраняется и показывает подтверждение', async () => {
  const { token, cookie } = await csrfFromFeedback();
  const response = await formPost({
    name: 'Анна Иванова',
    phone: '8 (999) 123-45-67',
    comment: 'Не открывается отчёт за сентябрь.',
    _csrf: token,
  }, cookie);

  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/feedback?sent=1');

  const saved = listFeedback();
  assert.equal(saved.length, 1);
  assert.equal(saved[0].name, 'Анна Иванова');
  assert.equal(saved[0].phone, '+79991234567', 'телефон сохранён не в каноническом виде');

  const confirmed = await request('/feedback?sent=1');
  const html = await confirmed.text();
  assert.match(html, /Спасибо! Обращение отправлено/);
});

test('владелец видит обращение в списке с человеческим телефоном', async () => {
  const page = await request('/access/feedback');
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Обращения/);
  assert.match(html, /Анна Иванова/);
  assert.match(html, /\+7 \(999\) 123-45-67/);
  assert.match(html, /Не открывается отчёт за сентябрь\./);
});

test('ошибка в телефоне возвращает форму с введённым именем, но не сохраняет', async () => {
  const before = countFeedback();
  const { token, cookie } = await csrfFromFeedback();
  const response = await formPost({
    name: 'Пётр', phone: '123', comment: 'Перезвоните', _csrf: token,
  }, cookie);

  assert.equal(response.status, 422);
  const html = await response.text();
  assert.match(html, /Нужен российский номер/);
  assert.match(html, /value="Пётр"/, 'форма потеряла введённое имя');
  assert.equal(countFeedback(), before, 'некорректное обращение попало в базу');
});

test('honeypot отвечает успехом, но ничего не сохраняет', async () => {
  const before = countFeedback();
  const { token, cookie } = await csrfFromFeedback();
  const response = await formPost({
    name: 'Бот', phone: '+79991234567', comment: 'реклама', website: 'spam.example', _csrf: token,
  }, cookie);

  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/feedback?sent=1');
  assert.equal(countFeedback(), before, 'сообщение бота сохранено');
});

test('обращение удаляется владельцем', async () => {
  const [item] = listFeedback();
  assert.ok(item, 'нет обращения для удаления');
  const response = await request(`/access/feedback/${item.id}/delete`, { method: 'POST' });
  assert.equal(response.status, 303);
  assert.equal(deleteFeedback(item.id), false, 'удаление не сработало');
  assert.equal(countFeedback(), 0);
});

test('слишком частые отправки с одного IP блокируются, а не копятся в базе', async () => {
  resetFeedbackRateLimit();
  const input = { name: 'Гость', phone: '+79991234567', comment: 'Проверка лимита' };
  for (let i = 0; i < 10; i += 1) {
    const result = submitFeedback(input, { ip: '203.0.113.9', now: 1_000_000 + i });
    assert.equal(result.ok, true, `отправка ${i + 1} отклонена раньше времени`);
  }
  const blocked = submitFeedback(input, { ip: '203.0.113.9', now: 1_000_100 });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.status, 429);
  assert.match(blocked.error, /Слишком много обращений/);
  assert.equal(countFeedback(), 10);
  resetFeedbackRateLimit();
});
