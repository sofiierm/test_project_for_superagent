#!/usr/bin/env node
// Скриншоты для визуальной проверки: контрольные разрешения, светлая и тёмная
// темы, состояния меню, формы, лайтбокса и аккордеона.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'test-results/screens');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173';
fs.mkdirSync(OUT, { recursive: true });

// Быстрый режим для CI: два разрешения вместо пяти и без полностраничных
// снимков — полный набор снимается локально перед выкладкой.
const QUICK = process.env.SHOTS_QUICK === '1';

const ALL_VIEWPORTS = [
  { name: 'mobile-320', width: 320, height: 640, deviceScaleFactor: 1, isMobile: true, hasTouch: true },
  { name: 'mobile-390', width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true },
  { name: 'tablet-768', width: 768, height: 1024, deviceScaleFactor: 1, hasTouch: true },
  { name: 'desktop-1366', width: 1366, height: 768, deviceScaleFactor: 1 },
  { name: 'desktop-1920', width: 1920, height: 1080, deviceScaleFactor: 1 },
];

const VIEWPORTS = QUICK
  ? ALL_VIEWPORTS.filter((viewport) => viewport.name === 'mobile-390' || viewport.name === 'desktop-1366')
  : ALL_VIEWPORTS;

const browser = await chromium.launch();
const consoleErrors = [];
const failures = [];

async function newPage(viewport, theme) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.deviceScaleFactor,
    isMobile: Boolean(viewport.isMobile),
    hasTouch: Boolean(viewport.hasTouch),
    locale: 'ru-RU',
    colorScheme: theme,
    reducedMotion: 'no-preference',
  });
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(`[${viewport.name}/${theme}] ${msg.text()}`);
  });
  page.on('pageerror', (error) => consoleErrors.push(`[${viewport.name}/${theme}] pageerror: ${error.message}`));
  page.on('requestfailed', (request) => {
    const url = request.url();
    if (url.startsWith(BASE)) failures.push(`[${viewport.name}/${theme}] request failed: ${url}`);
  });
  page.on('response', (response) => {
    if (response.url().startsWith(BASE) && response.status() >= 400) {
      failures.push(`[${viewport.name}/${theme}] HTTP ${response.status()}: ${response.url()}`);
    }
  });
  // Баннер cookie перекрывает нижние элементы на мобильном — в скриншотах
  // он не нужен, кроме отдельного кадра ниже.
  await context.addInitScript(() => {
    try {
      localStorage.setItem('cookie-consent', 'necessary');
    } catch {
      /* ignore */
    }
  });
  return { context, page };
}

// Баннер cookie не должен перекрывать нижние элементы в кадрах.
async function closeBanner(page) {
  const accept = page.locator('[data-cookie-accept]');
  if (await accept.count()) {
    const visible = await accept.first().isVisible().catch(() => false);
    if (visible) await accept.first().click().catch(() => {});
  }
}

for (const viewport of VIEWPORTS) {
  for (const theme of ['light', 'dark']) {
    const { context, page } = await newPage(viewport, theme);
    console.log('viewport', viewport.name, theme);
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);

    // Прокрутить всю страницу, чтобы сработали lazy-load и reveal-анимации.
    await page.evaluate(async () => {
      const step = window.innerHeight * 0.8;
      for (let y = 0; y < document.body.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 60));
      }
      window.scrollTo(0, 0);
      await new Promise((r) => setTimeout(r, 250));
    });
    await closeBanner(page);
    await page.waitForTimeout(300);

    const themeState = await page.evaluate(() => document.documentElement.dataset.theme);
    if (themeState !== theme) failures.push(`[${viewport.name}] тема ${themeState} вместо ${theme}`);

    await page.screenshot({ path: path.join(OUT, `${viewport.name}-${theme}-01-hero.png`) });
    if (!QUICK && (viewport.name === 'desktop-1366' || viewport.name === 'mobile-390')) {
      await page.screenshot({ path: path.join(OUT, `${viewport.name}-${theme}-full.png`), fullPage: true });
    }

    if (!QUICK && viewport.name === 'desktop-1366') {
      for (const id of ['about', 'benefits', 'directions', 'process', 'portfolio', 'materials', 'reviews', 'faq', 'contact', 'contacts']) {
        const section = page.locator(`#${id}`);
        if (await section.count()) {
          await section.scrollIntoViewIfNeeded();
          await page.waitForTimeout(250);
          await page.screenshot({ path: path.join(OUT, `${viewport.name}-${theme}-sec-${id}.png`) });
        }
      }
    }

    await context.close();
  }
}

/* --------------------------- интерактивные состояния (desktop + mobile) */
for (const viewport of QUICK ? VIEWPORTS : [VIEWPORTS[1], VIEWPORTS[3]]) {
  for (const theme of ['light', 'dark']) {
    const { context, page } = await newPage(viewport, theme);
    console.log('viewport', viewport.name, theme);
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });

    // Меню (мобильный бургер).
    if (viewport.name === 'mobile-390') {
      await page.click('[data-burger]');
      await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(OUT, `${viewport.name}-${theme}-menu.png`) });
      await page.click('[data-burger]');
      await page.waitForTimeout(200);
    }

    // Модальное окно заявки.
    console.log('  modal', viewport.name, theme);
    await page.locator('[data-open-lead]:visible').first().click();
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(OUT, `${viewport.name}-${theme}-modal.png`) });

    // Ошибки валидации.
    await page.click('#lead-modal [data-submit]');
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, `${viewport.name}-${theme}-modal-errors.png`) });

    // Заполнение и успешная отправка.
    await page.fill('#lead-modal-name', 'Анна');
    await page.fill('#lead-modal-phone', '9161234567');
    await page.check('#lead-modal input[name="consent"]');
    await page.click('#lead-modal [data-submit]');
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(OUT, `${viewport.name}-${theme}-modal-success.png`) });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // Лайтбокс портфолио.
    console.log('  lightbox', viewport.name, theme);
    await page.locator('#portfolio').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.click('[data-lightbox="0"]');
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, `${viewport.name}-${theme}-lightbox.png`) });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // FAQ: раскрытие второго вопроса.
    console.log('  faq', viewport.name, theme);
    await page.locator('#faq').scrollIntoViewIfNeeded();
    await page.click('#faq-q-1');
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, `${viewport.name}-${theme}-faq.png`) });

    await context.close();
  }
}

await browser.close();

fs.writeFileSync(path.join(ROOT, 'test-results/screens/report.json'), JSON.stringify({ consoleErrors, failures }, null, 2));
console.log('screens:', fs.readdirSync(OUT).length - 1);
if (failures.length) console.log('FAILURES:\n' + failures.join('\n'));
if (consoleErrors.length) console.log('CONSOLE ERRORS:\n' + consoleErrors.join('\n'));
if (!failures.length && !consoleErrors.length) console.log('нет ошибок консоли и сетевых сбоев');
