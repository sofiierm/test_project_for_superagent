#!/usr/bin/env node
// Проверки макета, которые не требуют визуального осмотра: видимость первого
// экрана (ТЗ §3.2), отсутствие наложений и обрезанного текста, корректная
// сетка и последовательность заголовков.
import path from 'node:path';
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173';
const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok, detail });

const browser = await chromium.launch();
const context = await browser.newContext({ locale: 'ru-RU' });
await context.addInitScript(() => {
  try {
    localStorage.setItem('cookie-consent', 'necessary');
  } catch {
    /* ignore */
  }
});
const page = await context.newPage();
await page.goto(BASE + '/', { waitUntil: 'networkidle' });

/* ------------------------- первый экран: оффер, кнопка и фото без прокрутки */
for (const [width, height] of [
  [1366, 768],
  [390, 844],
  [320, 640],
  [1920, 1080],
]) {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(250);
  const hero = await page.evaluate(() => {
    const h1 = document.querySelector('#hero-title').getBoundingClientRect();
    const cta = document.querySelector('.hero__actions .btn').getBoundingClientRect();
    const media = document.querySelector('.hero__media img');
    const mediaRect = media.getBoundingClientRect();
    const style = getComputedStyle(media);
    return {
      h1Bottom: h1.bottom,
      h1Top: h1.top,
      ctaBottom: cta.bottom,
      ctaHeight: cta.height,
      mediaHeight: mediaRect.height,
      mediaVisible: style.display !== 'none' && mediaRect.height > 100,
      viewport: window.innerHeight,
      heroLeadVisible: document.querySelector('.hero__lead').getBoundingClientRect().bottom <= window.innerHeight,
    };
  });
  check(`оффер и CTA видны без прокрутки ${width}×${height}`, hero.h1Bottom <= height && hero.ctaBottom <= height, JSON.stringify(hero));
  check(`изображение первого экрана на месте ${width}×${height}`, hero.mediaVisible && hero.mediaHeight > 200, String(hero.mediaHeight));
  check(`зона CTA не меньше 44 px ${width}×${height}`, hero.ctaHeight >= 44, String(hero.ctaHeight));
}

/* --------------------------------- обрезанный текст и наложения в карточках */
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(200);
const clipped = await page.evaluate(() => {
  const nodes = [...document.querySelectorAll('h1, h2, h3, p, .eyebrow, .btn, .nav__link, .stat-value')];
  const bad = [];
  for (const node of nodes) {
    const style = getComputedStyle(node);
    if (style.overflow === 'visible' && style.textOverflow !== 'ellipsis') continue;
    if (node.scrollWidth > node.clientWidth + 1 && node.clientWidth > 0) {
      bad.push({ text: node.textContent.trim().slice(0, 30), scrollW: node.scrollWidth, clientW: node.clientWidth });
    }
  }
  return bad;
});
check('нет обрезанного текста в блоках с overflow', clipped.length === 0, JSON.stringify(clipped.slice(0, 4)));

/* ------------------------------------------- text-overflow в кнопках и меню */
const overlapping = await page.evaluate(() => {
  // Ищем пары текстовых блоков, чьи прямоугольники существенно пересекаются.
  const nodes = [...document.querySelectorAll('h1, h2, h3, .trust__item, .stat-value, .work__caption, .btn')];
  const rects = nodes
    .map((node) => ({ node, rect: node.getBoundingClientRect() }))
    .filter((item) => item.rect.width > 0 && item.rect.height > 0);
  const bad = [];
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      const a = rects[i];
      const b = rects[j];
      if (a.node.contains(b.node) || b.node.contains(a.node)) continue;
      const overlapX = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
      const overlapY = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);
      if (overlapX > 8 && overlapY > 8) {
        bad.push([a.node.textContent.trim().slice(0, 20), b.node.textContent.trim().slice(0, 20)]);
      }
    }
  }
  return bad;
});
check('нет наложений текстовых блоков', overlapping.length === 0, JSON.stringify(overlapping.slice(0, 4)));

/* -------------------------------------------------- последовательность блоков */
const order = await page.evaluate(() => {
  const ids = ['top', 'about', 'benefits', 'directions', 'process', 'portfolio', 'materials', 'guarantees', 'reviews', 'faq', 'contact', 'contacts'];
  return ids.map((id) => {
    const el = document.getElementById(id);
    return el ? { id, top: Math.round(el.getBoundingClientRect().top + window.scrollY) } : { id, top: -1 };
  });
});
const missing = order.filter((item) => item.top < 0).map((item) => item.id);
check('все блоки ТЗ §3 присутствуют', missing.length === 0, missing.join(', '));
const sorted = order.every((item, index) => index === 0 || item.top >= order[index - 1].top);
check('блоки идут в порядке ТЗ §3', sorted, JSON.stringify(order.map((item) => item.id)));

/* ---------------------------------------------------- иерархия заголовков */
const headings = await page.evaluate(() =>
  [...document.querySelectorAll('h1, h2, h3')].map((node) => ({ level: Number(node.tagName[1]), text: node.textContent.trim().slice(0, 30) })),
);
let jumps = 0;
for (let i = 1; i < headings.length; i += 1) {
  if (headings[i].level - headings[i - 1].level > 1) jumps += 1;
}
check('нет пропусков уровней заголовков', jumps === 0, `${jumps} скачков`);

/* ---------------------------------------------------- сетка и выравнивание */
const grid = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.directions__grid .direction')];
  const tops = new Set(cards.map((card) => Math.round(card.getBoundingClientRect().top)));
  const widths = cards.map((card) => Math.round(card.getBoundingClientRect().width));
  return { rows: tops.size, uniqueWidths: [...new Set(widths)], count: cards.length };
});
check('карточки направлений выровнены по сетке', grid.rows <= 2 && grid.uniqueWidths.length <= 2, JSON.stringify(grid));

/* ------------------------------------------------------------- шрифты/тем */
const fonts = await page.evaluate(() => {
  const body = getComputedStyle(document.body);
  const h1 = getComputedStyle(document.querySelector('h1'));
  return {
    bodyFamily: body.fontFamily,
    h1Family: h1.fontFamily,
    size: parseFloat(body.fontSize),
    lineHeight: parseFloat(body.lineHeight) / parseFloat(body.fontSize),
  };
});
check('основной текст не меньше 16 px', fonts.size >= 16, String(fonts.size));
check('межстрочный интервал 1.4–1.6', fonts.lineHeight >= 1.4 && fonts.lineHeight <= 1.6, fonts.lineHeight.toFixed(2));
check('не больше двух гарнитур', new Set([fonts.bodyFamily, fonts.h1Family]).size === 2, JSON.stringify(fonts));

/* --------------------------------------------------- интерактивные состояния */
for (const theme of ['light', 'dark']) {
  await page.evaluate((value) => {
    localStorage.setItem('theme', value);
    document.documentElement.dataset.theme = value;
  }, theme);
  await page.waitForTimeout(150);
  const focus = await page.evaluate(() => {
    const button = document.querySelector('.hero .btn--primary');
    button.focus();
    const style = getComputedStyle(button);
    return { outline: style.outlineStyle, width: style.outlineWidth, colorScheme: getComputedStyle(document.documentElement).colorScheme };
  });
  check(`видимый focus в ${theme}-теме`, focus.outline !== 'none' && parseFloat(focus.width) >= 2, JSON.stringify(focus));
}

await browser.close();
const failed = results.filter((item) => !item.ok);
for (const item of results) if (!item.ok) console.log(`✗ ${item.name}${item.detail ? ' — ' + item.detail : ''}`);
console.log(`\n${results.length - failed.length}/${results.length} проверок макета пройдено`);
if (failed.length) process.exit(1);
