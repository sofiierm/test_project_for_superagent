// Скриншоты для ревью: одинаковые сценарии, разрешения и состояния.
//
// Скрипт поднимает сервер на чистой временной базе, чтобы кадры были
// воспроизводимыми, и складывает PNG в docs/screenshots/.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.SHOT_PORT || 4322);
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = path.resolve('docs/screenshots');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-shots-'));

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};

// fullPage включаем только там, где важен весь поток страницы; для обзора
// достаточно первого экрана — так кадры читаются с первого взгляда.
const SHOTS = [
  { name: 'after-dashboard-desktop', path: '/', viewport: 'desktop', fullPage: false },
  { name: 'after-dashboard-mobile', path: '/', viewport: 'mobile', fullPage: false },
  { name: 'after-accounts-desktop', path: '/accounts', viewport: 'desktop', fullPage: true },
  { name: 'after-account-desktop', path: '/accounts/1', viewport: 'desktop', fullPage: true },
  { name: 'after-videos-desktop', path: '/videos', viewport: 'desktop', fullPage: true },
  { name: 'after-video-desktop', path: '/videos/1', viewport: 'desktop', fullPage: true },
  { name: 'after-help-desktop', path: '/help', viewport: 'desktop', fullPage: true },
  { name: 'after-dashboard-empty', path: '/', viewport: 'desktop', fullPage: false, empty: true },
];

async function waitForServer(url, timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch { /* поднимается */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('сервер не поднялся');
}

async function startServer(dir, port, { seed = true } = {}) {
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'scripts/serve.mjs'], {
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: dir,
      DB_PATH: path.join(dir, 'shots.db'),
      PROVIDER: 'demo',
      // Пустое состояние снимаем на сервере без демо-наполнения.
      SEED_DEMO: seed ? 'true' : 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.resume();
  child.stderr.resume();
  await waitForServer(`http://127.0.0.1:${port}/api/health`);
  return child;
}

fs.mkdirSync(OUT, { recursive: true });
const server = await startServer(dataDir, PORT);
const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-empty-'));
const EMPTY_PORT = PORT + 1;
const emptyServer = await startServer(emptyDir, EMPTY_PORT, { seed: false });

const browser = await chromium.launch();
const written = [];

for (const shot of SHOTS) {
  const viewport = VIEWPORTS[shot.viewport];
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1, locale: 'ru-RU' });
  const base = shot.empty ? `http://127.0.0.1:${EMPTY_PORT}` : BASE;
  await page.goto(base + shot.path, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  // Гасим анимации: иначе кадр ловит середину перехода.
  await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' });
  await page.waitForTimeout(250);
  const file = path.join(OUT, `${shot.name}.png`);
  await page.screenshot({ path: file, fullPage: shot.fullPage });
  // Манифест фиксирует, что именно попало в кадр: так ревьюер и проверки
  // видят содержимое, не полагаясь на «файл существует».
  const facts = await page.evaluate(() => ({
    title: document.title,
    h1: document.querySelector('h1')?.textContent?.trim() ?? '',
    h2: [...document.querySelectorAll('h2')].map((h) => h.textContent.trim()).slice(0, 8),
    tableRows: document.querySelectorAll('table.data tbody tr').length,
    chartCount: document.querySelectorAll('svg.chart').length,
    statValues: [...document.querySelectorAll('.stat__value')].map((s) => s.textContent.trim()).slice(0, 6),
    insightTitles: [...document.querySelectorAll('.insight__title')].map((s) => s.textContent.trim()).slice(0, 4),
    hasNaN: /NaN|undefined/.test(document.body.innerText),
    viewport: { width: window.innerWidth, height: window.innerHeight },
    scrollHeight: document.documentElement.scrollHeight,
  }));
  written.push({ file, ...facts });
  await page.close();
}

await browser.close();
server.kill('SIGTERM');
emptyServer.kill('SIGTERM');
fs.rmSync(dataDir, { recursive: true, force: true });
fs.rmSync(emptyDir, { recursive: true, force: true });

const manifest = written.map((shot) => ({
  file: path.relative(process.cwd(), shot.file),
  bytes: fs.statSync(shot.file).size,
  ...shot,
  file: path.relative(process.cwd(), shot.file),
}));
fs.writeFileSync(path.join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

let problems = 0;
for (const shot of written) {
  const size = fs.statSync(shot.file).size;
  const empty = size < 5_000;
  const broken = shot.hasNaN;
  if (empty || broken) problems += 1;
  process.stdout.write(
    `${empty || broken ? '✗' : '✓'} ${path.relative(process.cwd(), shot.file)} — ${(size / 1024).toFixed(0)} КБ, «${shot.h1}», строк ${shot.tableRows}, графиков ${shot.chartCount}${broken ? ', ЕСТЬ NaN' : ''}\n`,
  );
}
process.stdout.write(`Манифест: ${path.join(OUT, 'manifest.json')}\n`);
if (problems) {
  process.stderr.write(`Проблемных кадров: ${problems}\n`);
  process.exit(1);
}
