#!/usr/bin/env node
// Контраст текста первого экрана поверх фотографии. Пиксельная выборка тут
// ненадёжна, поэтому считаем аналитически: берём настоящую геометрию блока
// (из браузера) и настоящие стопы градиента-затемнения (из CSS), а фотографию
// заменяем двумя крайностями — полностью белой и полностью чёрной. Если текст
// читается на обеих, он читается на любой фотографии при том же затемнении.
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173';

const relLum = (rgb) => {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const l1 = relLum(a);
  const l2 = relLum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};
const parseRgba = (value) => {
  const nums = value.match(/[\d.]+/g).map(Number);
  return { rgb: nums.slice(0, 3), alpha: nums.length > 3 ? nums[3] : 1 };
};
const mix = (fg, bg, alpha) => fg.map((c, i) => c * alpha + bg[i] * (1 - alpha));

/**
 * Минимальная альфа затемнения на отрезке [start, end] вдоль оси градиента.
 * Стопы заданы как [(позиция 0..1, цвет)], позиция — доля длины градиента.
 */
function minAlphaOver(stops, start, end) {
  const points = [start, end, ...stops.map((s) => s.at).filter((at) => at > start && at < end)];
  let min = 1;
  for (const point of points) {
    // Интерполируем альфу в точке.
    let alpha = stops[stops.length - 1].alpha;
    for (let i = 0; i < stops.length - 1; i += 1) {
      const a = stops[i];
      const b = stops[i + 1];
      if (point >= a.at && point <= b.at) {
        const k = (point - a.at) / (b.at - a.at || 1);
        alpha = a.alpha + (b.alpha - a.alpha) * k;
        break;
      }
    }
    if (point <= stops[0].at) alpha = stops[0].alpha;
    min = Math.min(min, alpha);
  }
  return min;
}

const TARGETS = [
  { name: 'первый экран 1366×768', viewport: { width: 1366, height: 768 }, sel: '.hero__content' },
  { name: 'первый экран 390×844', viewport: { width: 390, height: 844 }, sel: '.hero__content' },
  { name: 'первый экран 320×640', viewport: { width: 320, height: 640 }, sel: '.hero__content' },
];

const PHOTOS = [
  { name: 'белая фотография', rgb: [255, 255, 255] },
  { name: 'чёрная фотография', rgb: [0, 0, 0] },
];

const browser = await chromium.launch();
const problems = [];

for (const theme of ['light', 'dark']) {
  const context = await browser.newContext({ colorScheme: theme, locale: 'ru-RU' });
  const page = await context.newPage();

  for (const target of TARGETS) {
    await page.setViewportSize(target.viewport);
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.evaluate((value) => {
      localStorage.setItem('theme', value);
      document.documentElement.dataset.theme = value;
    }, theme);
    await page.waitForTimeout(150);

    const data = await page.evaluate((selector) => {
      const hero = document.querySelector('.hero');
      const block = document.querySelector(selector);
      const heroRect = hero.getBoundingClientRect();
      const blockRect = block.getBoundingClientRect();
      const style = getComputedStyle(hero, '::after');
      const textStyle = getComputedStyle(document.querySelector('.hero h1'));
      const leadStyle = getComputedStyle(document.querySelector('.hero__lead'));
      return {
        background: style.backgroundImage,
        hero: { x: heroRect.x, y: heroRect.y, w: heroRect.width, h: heroRect.height },
        block: { x: blockRect.x, y: blockRect.y, w: blockRect.width, h: blockRect.height },
        h1: { color: textStyle.color },
        lead: { color: leadStyle.color },
      };
    }, target.sel);

    // Разбираем градиент из CSS: linear-gradient(105deg, rgb(...) A%, ...).
    // Без угла градиент идёт сверху вниз — эквивалент 180deg.
    const angleMatch = data.background.match(/(-?[\d.]+)deg/);
    const angle = angleMatch ? Number(angleMatch[1]) : 180;
    // Стопы могут быть без процентов: тогда они распределяются равномерно,
    // а крайние прижимаются к 0% и 100% — как это делает браузер.
    const rawStops = [...data.background.matchAll(/rgba?\(([^)]+)\)\s*([\d.]+%)?/g)].map((match) => {
      const parts = match[1].split(/[,/]/).map((part) => Number(part.trim()));
      return {
        rgb: parts.slice(0, 3),
        alpha: parts.length > 3 ? parts[3] : 1,
        at: match[2] ? Number(match[2].replace('%', '')) / 100 : null,
      };
    });
    if (rawStops.length && rawStops[0].at === null) rawStops[0].at = 0;
    if (rawStops.length && rawStops[rawStops.length - 1].at === null) rawStops[rawStops.length - 1].at = 1;
    const missing = rawStops.map((stop, index) => (stop.at === null ? index : -1)).filter((index) => index >= 0);
    for (let i = 0; i < rawStops.length; i += 1) {
      if (rawStops[i].at !== null) continue;
      const before = rawStops.slice(0, i).filter((stop) => stop.at !== null).pop();
      const after = rawStops.slice(i).find((stop) => stop.at !== null);
      const steps = missing.filter((index) => index > (rawStops.indexOf(before) ) && index < rawStops.indexOf(after)).length + 1;
      const from = before ? before.at : 0;
      const to = after ? after.at : 1;
      rawStops[i].at = from + ((to - from) * (missing.filter((idx) => idx <= i).length)) / (steps + 1);
    }
    const stops = rawStops.sort((a, b) => a.at - b.at);
    if (stops.length < 2) throw new Error('Не разобрать градиент: ' + data.background);

    // Проекция блока текста на ось градиента.
    const rad = (angle * Math.PI) / 180;
    const dirX = Math.sin(rad);
    const dirY = -Math.cos(rad);
    const length = Math.abs(data.hero.w * dirX) + Math.abs(data.hero.h * dirY);
    const project = (x, y) => {
      const dx = x - data.hero.x - data.hero.w / 2;
      const dy = y - data.hero.y - data.hero.h / 2;
      return (dx * dirX + dy * dirY) / length + 0.5;
    };
    const samples = [
      project(data.block.x, data.block.y),
      project(data.block.x + data.block.w, data.block.y),
      project(data.block.x, data.block.y + data.block.h),
      project(data.block.x + data.block.w, data.block.y + data.block.h),
    ];
    const minAlpha = minAlphaOver(stops, Math.max(0, Math.min(...samples)), Math.min(1, Math.max(...samples)));

    const report = [];
    for (const photo of PHOTOS) {
      // Худший случай: минимальное затемнение и самая невыгодная фотография.
      const bg = mix(stops[0].rgb, photo.rgb, minAlpha);
      for (const [label, color] of [
        ['h1', data.h1.color],
        ['подзаголовок', data.lead.color],
      ]) {
        const ratio = contrast(parseRgba(color).rgb, bg);
        report.push({ photo: photo.name, label, ratio });
      }
    }

    const worst = report.reduce((min, item) => (item.ratio < min.ratio ? item : min), report[0]);
    const ok = worst.ratio >= 4.5;
    if (!ok) problems.push({ theme, target: target.name, ...worst });
    console.log(
      `${ok ? '✓' : '✗'} ${theme} / ${target.name}: минимальная альфа ${(minAlpha * 100).toFixed(0)}%, ` +
        `худший контраст ${worst.ratio.toFixed(2)} (${worst.label}, ${worst.photo})`,
    );
  }

  await context.close();
}

await browser.close();
if (problems.length) {
  console.log('\nКонтраст текста поверх фотографии ниже AA:');
  for (const problem of problems) {
    console.log(`  - ${problem.theme}/${problem.target}: ${problem.ratio.toFixed(2)} (${problem.label}, ${problem.photo})`);
  }
  process.exit(1);
}
console.log('\nТекст первого экрана проходит AA на любой фотографии в обеих темах');
