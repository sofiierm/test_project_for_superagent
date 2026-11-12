// Сценарии в браузере: то, что не проверить на уровне HTML.
//
// Скрипт сам поднимает сервер на отдельной базе, прогоняет проверки и гасит
// его. Так `npm run test:e2e` работает одной командой локально и в CI.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const PORT = Number(process.env.E2E_PORT || 4321);
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-e2e-'));

let server;
let browser;
const failures = [];
let passed = 0;

async function scenario(name, fn) {
  try {
    await fn();
    passed += 1;
    process.stdout.write(`  ✓ ${name}\n`);
  } catch (error) {
    failures.push({ name, error });
    process.stderr.write(`  ✗ ${name}: ${error.message}\n`);
  }
}

async function waitForServer(url, timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // сервер ещё поднимается
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`сервер не ответил за ${timeoutMs} мс`);
}

async function main() {
  process.stdout.write('Сценарии в браузере\n');

  server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'scripts/serve.mjs'], {
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      DATA_DIR: dataDir,
      DB_PATH: path.join(dataDir, 'e2e.db'),
      PROVIDER: 'demo',
      SEED_DEMO: 'true',
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const serverLog = [];
  server.stdout.on('data', (chunk) => serverLog.push(String(chunk)));
  server.stderr.on('data', (chunk) => serverLog.push(String(chunk)));

  await waitForServer(`${BASE}/api/health`);
  browser = await chromium.launch();

  await scenario('главная показывает сводку и график', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    assert.match(await page.title(), /Обзор/);
    assert.equal(await page.locator('h1').innerText(), 'Обзор');
    assert.ok(await page.locator('svg.chart').count() >= 1, 'нет графика');
    const cards = await page.locator('.stat__value').count();
    assert.ok(cards >= 4, `карточек метрик: ${cards}`);
    const values = await page.locator('.stat__value').allInnerTexts();
    assert.ok(!values.some((v) => /NaN|undefined/.test(v)), values.join('|'));
    await page.close();
  });

  await scenario('навигация переключает разделы без ошибок', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    for (const [label, heading] of [['Аккаунты', 'Аккаунты'], ['Ролики', 'Ролики'], ['Как это работает', 'Как это работает'], ['Обзор', 'Обзор']]) {
      await page.click(`.nav__link:text-is("${label}")`);
      await page.waitForLoadState('networkidle');
      assert.equal(await page.locator('h1').innerText(), heading, `раздел ${label}`);
      const current = await page.locator('.nav__link[aria-current="page"]').innerText();
      assert.equal(current, label, 'подсветка активного раздела');
    }
    assert.deepEqual(errors, []);
    await page.close();
  });

  await scenario('добавление аккаунта через диалог', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${BASE}/accounts`, { waitUntil: 'networkidle' });
    await page.click('[data-open-add-account]');
    await page.fill('#account-input', 'https://www.instagram.com/studio.kadr/');
    await page.click('#add-account-submit');
    await page.waitForURL(/\/accounts\/\d+$/, { timeout: 15_000 });
    const heading = await page.locator('h1').innerText();
    assert.match(heading, /studio\.kadr|Студия/i, `заголовок: ${heading}`);
    const body = await page.content();
    assert.ok(!body.includes('NaN'));
    // Повторное добавление того же аккаунта должно дать понятную ошибку.
    await page.goto(`${BASE}/accounts`, { waitUntil: 'networkidle' });
    await page.click('[data-open-add-account]');
    await page.fill('#account-input', 'studio.kadr');
    await page.selectOption('#platform-hint', 'instagram');
    await page.click('#add-account-submit');
    await page.waitForSelector('#add-account-error:not([hidden])', { timeout: 10_000 });
    const error = await page.locator('#add-account-error').innerText();
    assert.match(error, /уже|добавлен/i, `текст ошибки: ${error}`);
    await page.close();
  });

  await scenario('некорректный ввод показывает ошибку, а не падает', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${BASE}/accounts`, { waitUntil: 'networkidle' });
    await page.click('[data-open-add-account]');
    await page.fill('#account-input', 'https://vk.com/nobody');
    await page.click('#add-account-submit');
    await page.waitForSelector('#add-account-error:not([hidden])', { timeout: 10_000 });
    const text = await page.locator('#add-account-error').innerText();
    assert.ok(text.length > 5, 'пустое сообщение об ошибке');
    // Поле помечено как невалидное для скринридера.
    assert.equal(await page.getAttribute('#account-input', 'aria-invalid'), 'true');
    await page.close();
  });

  await scenario('синхронизация обновляет страницу и показывает уведомление', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${BASE}/accounts`, { waitUntil: 'networkidle' });
    await page.locator('[data-sync-account]').first().click();
    await page.waitForSelector('#toast[data-visible="true"]', { timeout: 20_000 });
    const toast = await page.locator('#toast').innerText();
    assert.ok(toast.length > 5, 'пустое уведомление');
    await page.close();
  });

  await scenario('страница ролика связана с аккаунтом и другими роликами', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${BASE}/videos`, { waitUntil: 'networkidle' });
    await page.locator('table.data tbody tr a').first().click();
    await page.waitForLoadState('networkidle');
    assert.match(page.url(), /\/videos\/\d+$/);
    assert.ok(await page.locator('.breadcrumbs a').count() >= 2, 'нет хлебных крошек');
    assert.equal(await page.locator('.video-head__title').count(), 1);
    await page.close();
  });

  await scenario('удаление требует подтверждения и убирает аккаунт', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${BASE}/accounts`, { waitUntil: 'networkidle' });
    const before = await page.locator('.account-card').count();
    page.on('dialog', (dialog) => dialog.accept());
    await page.locator('[data-delete-account]').first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('.account-card').length === n - 1,
      before,
      { timeout: 15_000 },
    );
    await page.close();
  });

  await scenario('мобильный экран без горизонтальной прокрутки', async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    for (const route of ['/', '/accounts', '/videos', '/help']) {
      await page.goto(BASE + route, { waitUntil: 'networkidle' });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(overflow <= 0, `${route}: прокрутка ${overflow}px`);
    }
    await page.close();
  });

  await scenario('работает без JavaScript: контент отрисован на сервере', async () => {
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    assert.equal(await page.locator('h1').innerText(), 'Обзор');
    assert.ok(await page.locator('svg.chart').count() >= 1);
    const rows = await page.locator('table.data tbody tr').count();
    assert.ok(rows > 0, 'таблица роликов пуста без JS');
    await context.close();
  });

  await scenario('страница 404 объясняет, что произошло', async () => {
    const page = await browser.newPage();
    const response = await page.goto(`${BASE}/accounts/99999`);
    assert.equal(response.status(), 404);
    assert.match(await page.locator('body').innerText(), /не найдена/i);
    await page.close();
  });

  await scenario('CSP не блокирует собственные ресурсы', async () => {
    const page = await browser.newPage();
    const violations = [];
    page.on('console', (m) => {
      if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text());
    });
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await page.click('[data-open-add-account]');
    await page.waitForTimeout(300);
    assert.deepEqual(violations, [], violations.join(' | '));
    await page.close();
  });

  process.stdout.write(`\nСценарии: ${passed} прошло, ${failures.length} упало\n`);
}

try {
  await main();
} finally {
  if (browser) await browser.close();
  if (server) server.kill('SIGTERM');
  fs.rmSync(dataDir, { recursive: true, force: true });
}

if (failures.length) {
  process.stderr.write('\nПровалы:\n');
  for (const failure of failures) {
    process.stderr.write(`  ${failure.name}\n    ${failure.error.stack?.split('\n')[0]}\n`);
  }
  process.exit(1);
}
