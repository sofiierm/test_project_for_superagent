#!/usr/bin/env node
// Снимает «до» (main без сайта) и «после» (собранный лендинг) в одинаковых
// условиях: те же разрешения, тема и сценарий. Результат — test-results/before-after.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'test-results/before-after');
const BEFORE = process.env.BEFORE_URL || 'http://127.0.0.1:4174';
const AFTER = process.env.AFTER_URL || 'http://127.0.0.1:4173';
fs.mkdirSync(OUT, { recursive: true });

const SHOTS = [
  { name: 'desktop-1440-light', width: 1440, height: 900, theme: 'light' },
  { name: 'desktop-1440-dark', width: 1440, height: 900, theme: 'dark' },
  { name: 'mobile-390-light', width: 390, height: 844, theme: 'light', mobile: true },
  { name: 'mobile-390-dark', width: 390, height: 844, theme: 'dark', mobile: true },
];

const browser = await chromium.launch();

for (const shot of SHOTS) {
  for (const [label, base] of [
    ['before', BEFORE],
    ['after', AFTER],
  ]) {
    const context = await browser.newContext({
      viewport: { width: shot.width, height: shot.height },
      deviceScaleFactor: 1,
      isMobile: Boolean(shot.mobile),
      hasTouch: Boolean(shot.mobile),
      colorScheme: shot.theme,
      locale: 'ru-RU',
    });
    const page = await context.newPage();
    const response = await page.goto(base + '/', { waitUntil: 'networkidle' }).catch(() => null);
    if (label === 'after') {
      await page.evaluate((theme) => {
        localStorage.setItem('theme', theme);
        document.documentElement.dataset.theme = theme;
      }, shot.theme);
      await page.waitForTimeout(400);
    }
    await page.screenshot({ path: path.join(OUT, `${shot.name}-${label}.png`) });
    console.log(`${shot.name} ${label}: HTTP ${response?.status() ?? 'n/a'} — ${await page.title()}`);
    await context.close();
  }
}

await browser.close();
console.log('готово:', fs.readdirSync(OUT).length, 'файлов в test-results/before-after');
