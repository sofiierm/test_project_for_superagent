// Проверки вёрстки: сетка, переносы, читаемость, доступность.
// Запуск: node scripts/check-layout.mjs (нужен работающий сервер на BASE_URL).
//
// Зачем: скриншоты смотрит человек, а эти проверки ловят регрессии
// автоматически — включая те, что не видны на одном удачном кадре.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Если BASE_URL задан, проверяем уже запущенный сервер (удобно при разработке).
// Иначе поднимаем свой на чистой базе, чтобы команда работала «из коробки».
const EXTERNAL = Boolean(process.env.BASE_URL);
const PORT = Number(process.env.LAYOUT_PORT || 4323);
const BASE = process.env.BASE_URL || `http://127.0.0.1:${PORT}`;
const dataDir = EXTERNAL ? null : fs.mkdtempSync(path.join(os.tmpdir(), 'ca-layout-'));

let server = null;

async function waitForServer(url, timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch { /* поднимается */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`сервер не ответил за ${timeoutMs} мс: ${url}`);
}

if (!EXTERNAL) {
  server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'scripts/serve.mjs'], {
    env: {
      ...process.env,
      PORT: String(PORT),
      DATA_DIR: dataDir,
      DB_PATH: path.join(dataDir, 'layout.db'),
      PROVIDER: 'demo',
      SEED_DEMO: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.resume();
  server.stderr.resume();
  await waitForServer(`${BASE}/api/health`);
}

function cleanup() {
  if (server) server.kill('SIGTERM');
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
}
process.on('exit', cleanup);
const VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 834, height: 1112 },
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'wide', width: 1920, height: 1080 },
];

// `/compare?accounts=1,2` — страница сравнения с реальным выбором: пустое
// состояние проверяет только его само, а таблицу и легенду надо увидеть.
const PATHS = ['/', '/accounts', '/compare?accounts=1,2', '/videos', '/help'];

function luminance([r, g, b]) {
  const channel = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(fg, bg) {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const [light, dark] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (light + 0.05) / (dark + 0.05);
}

function parseRgb(text) {
  const match = String(text).match(/rgba?\(([^)]+)\)/);
  if (!match) return null;
  const parts = match[1].split(',').map((p) => Number.parseFloat(p.trim()));
  return [parts[0], parts[1], parts[2], parts[3] ?? 1];
}

const failures = [];
const notes = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

const browser = await chromium.launch();

for (const viewport of VIEWPORTS) {
  for (const path of PATHS) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
    const page = await context.newPage();
    const consoleErrors = [];
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', (e) => consoleErrors.push(e.message));

    const response = await page.goto(BASE + path, { waitUntil: 'networkidle' });
    const label = `${viewport.name} ${path}`;
    check(response && response.status() === 200, `${label}: статус ${response?.status()}`);
    check(consoleErrors.length === 0, `${label}: ошибки консоли ${consoleErrors.join(' | ')}`);

    const metrics = await page.evaluate(() => {
      const doc = document.documentElement;
      const overflow = doc.scrollWidth - doc.clientWidth;
      const h1 = document.querySelectorAll('h1');
      // WCAG 2.2 SC 2.5.8: цель нажатия — не меньше 24×24 CSS-пикселей.
      // Обычные текстовые ссылки внутри абзаца исключены самим критерием
      // (inline-исключение), поэтому проверяем только элементы управления.
      const controls = [...document.querySelectorAll(
        'button, .btn, a.nav__link, a.brand, input:not([type="hidden"]), select, textarea',
      )];
      const tooSmall = controls.filter((el) => {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return false;
        if (el.closest('table')) return false; // строки таблицы — не отдельные цели
        return r.height < 24 || r.width < 24;
      }).map((el) => `${el.tagName}.${el.className}:${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`);
      const unlabeled = [...document.querySelectorAll('input, select, textarea')].filter((el) => {
        // Скрытые поля не попадают в дерево доступности: метка им не нужна,
        // и требовать её — ложное срабатывание, а не найденная проблема.
        if (el.type === 'hidden') return false;
        const id = el.id;
        const hasLabel = id && document.querySelector(`label[for="${id}"]`);
        const aria = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby');
        return !hasLabel && !aria;
      }).map((el) => el.id || el.tagName);
      const imagesWithoutAlt = [...document.querySelectorAll('img')].filter((img) => !img.hasAttribute('alt')).length;
      const charts = document.querySelectorAll('svg.chart').length;
      const chartsWithLabel = [...document.querySelectorAll('svg.chart')].filter((s) => s.getAttribute('aria-label') || s.getAttribute('role') === 'img').length;
      return {
        overflow, h1: h1.length, tooSmall, unlabeled, imagesWithoutAlt, charts, chartsWithLabel,
        title: document.title,
        lang: doc.lang,
      };
    });

    check(metrics.overflow <= 0, `${label}: горизонтальная прокрутка ${metrics.overflow}px`);
    check(metrics.h1 === 1, `${label}: заголовков h1 — ${metrics.h1}`);
    check(metrics.lang === 'ru', `${label}: lang="${metrics.lang}"`);
    check(metrics.title.length > 0, `${label}: пустой title`);
    check(metrics.tooSmall.length === 0, `${label}: мелкие кликабельные элементы ${metrics.tooSmall.join(', ')}`);
    check(metrics.unlabeled.length === 0, `${label}: поля без метки ${metrics.unlabeled.join(', ')}`);
    check(metrics.imagesWithoutAlt === 0, `${label}: img без alt`);
    check(metrics.charts === metrics.chartsWithLabel, `${label}: графики без aria-label`);

    // Таблицы: заголовки должны быть связаны с ячейками, у таблицы — имя.
    const tables = await page.evaluate(() => [...document.querySelectorAll('table.data')].map((t) => ({
      label: t.getAttribute('aria-label') || t.querySelector('caption')?.textContent?.trim() || '',
      allScope: [...t.querySelectorAll('th')].every((th) => th.hasAttribute('scope')),
    })));
    for (const table of tables) {
      check(table.allScope, `${label}: у таблицы есть th без scope`);
      check(table.label.length > 0, `${label}: у таблицы нет доступного имени`);
    }

    if (viewport.name === 'mobile' && path === '/') {
      notes.push(`${label}: графиков ${metrics.charts}`);
    }

    // Контраст текста: проверяем реальные вычисленные цвета.
    const contrast = await page.evaluate(() => {
      const parse = (text) => {
        const m = String(text).match(/rgba?\(([^)]+)\)/);
        if (!m) return null;
        const p = m[1].split(',').map((v) => Number.parseFloat(v.trim()));
        return [p[0], p[1], p[2], p[3] ?? 1];
      };
      const bgOf = (el) => {
        let node = el;
        while (node && node !== document.documentElement) {
          const c = parse(getComputedStyle(node).backgroundColor);
          if (c && c[3] > 0.75) return c;
          node = node.parentElement;
        }
        const body = parse(getComputedStyle(document.body).backgroundColor);
        return body || [11, 14, 20, 1];
      };
      const samples = [];
      for (const sel of ['h1', 'h2', '.stat__value', '.card__hint', '.page-head__lead', 'td', 'th', '.nav__link', '.badge', '.insight__detail', '.footer', '.cell-title__sub']) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const style = getComputedStyle(el);
        samples.push({
          sel,
          fg: parse(style.color),
          bg: bgOf(el),
          size: Number.parseFloat(style.fontSize),
          weight: Number.parseInt(style.fontWeight, 10) || 400,
        });
      }
      return samples;
    });

    for (const sample of contrast) {
      if (!sample.fg || !sample.bg) continue;
      const ratio = contrastRatio(sample.fg, sample.bg);
      // WCAG AA: 4.5 для обычного текста, 3.0 для крупного (>=24px или >=18.66px bold).
      const large = sample.size >= 24 || (sample.size >= 18.66 && sample.weight >= 700);
      const required = large ? 3 : 4.5;
      check(
        ratio >= required - 0.05,
        `${label}: контраст ${sample.sel} = ${ratio.toFixed(2)} < ${required}`,
      );
    }

    await context.close();
  }
}

// Клавиатурная доступность: модалка открывается, фокус уходит внутрь,
// Tab не выходит за её пределы, Esc закрывает и возвращает фокус на кнопку.
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.click('[data-open-add-account]');
  const open = await page.evaluate(() => document.querySelector('#add-account-dialog')?.open === true);
  check(open, 'модалка не открылась по кнопке');
  const focusInside = await page.evaluate(() => document.activeElement?.id === 'account-input');
  check(focusInside, 'фокус не перешёл в поле ввода модалки');

  const escapes = [];
  for (let i = 0; i < 16; i += 1) {
    await page.keyboard.press('Tab');
    const inside = await page.evaluate(() => document.querySelector('#add-account-dialog').contains(document.activeElement));
    if (!inside) escapes.push(i);
  }
  check(escapes.length === 0, `фокус выходит из модалки по Tab на шагах ${escapes.join(', ')}`);

  await page.keyboard.press('Escape');
  const closed = await page.evaluate(() => document.querySelector('#add-account-dialog')?.open === false);
  check(closed, 'модалка не закрывается по Escape');
  const restored = await page.evaluate(() => document.activeElement?.hasAttribute('data-open-add-account'));
  check(restored, 'после закрытия фокус не вернулся на кнопку открытия');
  await context.close();
}

await browser.close();
cleanup();

if (failures.length) {
  process.stderr.write(`Проверки вёрстки: ${failures.length} проблем\n`);
  for (const failure of failures) process.stderr.write(`  ✗ ${failure}\n`);
  process.exit(1);
}

process.stdout.write(`Проверки вёрстки: всё в порядке (${VIEWPORTS.length} разрешения × ${PATHS.length} страницы).\n`);
for (const note of notes) process.stdout.write(`  · ${note}\n`);
