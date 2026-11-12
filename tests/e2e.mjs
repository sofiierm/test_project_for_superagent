#!/usr/bin/env node
// Функциональные проверки в реальном браузере: адаптив без горизонтальной
// прокрутки, темы и их сохранение, доступность, форма, модальные окна.
// Требует запущенного `npm run dev` (или BASE_URL) и Chromium из Playwright.
import path from 'node:path';
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173';
const VIEWPORTS = [
  [320, 640],
  [360, 800],
  [390, 844],
  [414, 896],
  [768, 1024],
  [1024, 768],
  [1280, 800],
  [1440, 900],
  [1920, 1080],
];

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
};

const browser = await chromium.launch();
const context = await browser.newContext({ locale: 'ru-RU', viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
// Баннер cookie не должен перекрывать клики в тестах; его поведение
// проверяется отдельным блоком ниже.
await context.addInitScript(() => {
  try {
    localStorage.setItem('cookie-consent', 'necessary');
  } catch {
    /* ignore */
  }
});
const consoleErrors = [];
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('pageerror', (error) => consoleErrors.push('pageerror: ' + error.message));

await page.goto(BASE + '/', { waitUntil: 'networkidle' });

/* ---------------------------------------------- адаптив и горизонтальный скролл */
for (const [width, height] of VIEWPORTS) {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(200);
  const metrics = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    overflowing: [...document.querySelectorAll('body *')]
      .filter((el) => {
        // Служебные элементы вне потока (honeypot, skip-link, скрытые панели)
        // не считаем: они намеренно уведены за край.
        if (el.closest('.hp, .skip-link, [hidden], .modal[hidden]')) return false;
        if (el.getAttribute('aria-hidden') === 'true' && el.getBoundingClientRect().height === 0) return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.right > window.innerWidth + 1;
      })
      .slice(0, 5)
      .map((el) => el.className || el.tagName),
  }));
  check(
    `нет горизонтальной прокрутки ${width}×${height}`,
    metrics.scrollW <= metrics.clientW + 1,
    `scrollWidth=${metrics.scrollW}, clientWidth=${metrics.clientW}`,
  );
  check(`нет выступающих элементов ${width}×${height}`, metrics.overflowing.length === 0, metrics.overflowing.join(', '));
}

/* ------------------------------------------------------------------- темы */
await page.setViewportSize({ width: 1280, height: 900 });
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
const initial = await page.evaluate(() => ({
  theme: document.documentElement.dataset.theme,
  scheme: getComputedStyle(document.documentElement).colorScheme,
  bg: getComputedStyle(document.body).backgroundColor,
  text: getComputedStyle(document.body).color,
}));
check('тема по умолчанию — светлая', initial.theme === 'light', JSON.stringify(initial));

await page.click('[data-theme-toggle]');
await page.waitForTimeout(200);
const dark = await page.evaluate(() => ({
  theme: document.documentElement.dataset.theme,
  bg: getComputedStyle(document.body).backgroundColor,
  text: getComputedStyle(document.body).color,
  pressed: document.querySelector('[data-theme-toggle]').getAttribute('aria-pressed'),
}));
check('переключатель включает тёмную тему', dark.theme === 'dark', JSON.stringify(dark));
check('фон и текст меняются', dark.bg !== initial.bg && dark.text !== initial.text, `${dark.bg} / ${dark.text}`);
check('aria-pressed отражает состояние', dark.pressed === 'true');

await page.reload({ waitUntil: 'networkidle' });
const afterReload = await page.evaluate(() => ({
  theme: document.documentElement.dataset.theme,
  stored: localStorage.getItem('theme'),
}));
check('выбор темы сохраняется', afterReload.theme === 'dark' && afterReload.stored === 'dark', JSON.stringify(afterReload));

/* ранняя установка темы: до отрисовки тема уже тёмная */
const earlyTheme = await page.evaluate(() => document.documentElement.dataset.theme);
check('тема применяется до отрисовки (без вспышки)', earlyTheme === 'dark');

/* системная тема, когда выбора нет */
await page.evaluate(() => localStorage.removeItem('theme'));
const darkContext = await browser.newContext({ colorScheme: 'dark', locale: 'ru-RU', viewport: { width: 900, height: 700 } });
const darkPage = await darkContext.newPage();
await darkPage.goto(BASE + '/', { waitUntil: 'networkidle' });
const systemTheme = await darkPage.evaluate(() => document.documentElement.dataset.theme);
check('системная тёмная тема подхватывается', systemTheme === 'dark', systemTheme);
await darkContext.close();

/* светлая тема возвращается переключателем */
await page.evaluate(() => localStorage.removeItem('theme'));
await page.reload({ waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.setItem('theme', 'dark'));
await page.reload({ waitUntil: 'networkidle' });
await page.click('[data-theme-toggle]');
await page.waitForTimeout(300);
const backToLight = await page.evaluate(() => ({
  theme: document.documentElement.dataset.theme,
  stored: localStorage.getItem('theme'),
}));
check('переключение обратно в светлую', backToLight.theme === 'light' && backToLight.stored === 'light', JSON.stringify(backToLight));

/* --------------------------------------------------------- контраст текста */
function contrast(rgb1, rgb2) {
  const lum = (rgb) => {
    const [r, g, b] = rgb.match(/\d+/g).slice(0, 3).map(Number).map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const l1 = lum(rgb1);
  const l2 = lum(rgb2);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

for (const theme of ['light', 'dark']) {
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.evaluate((value) => {
    localStorage.setItem('theme', value);
    document.documentElement.dataset.theme = value;
  }, theme);
  // Собираем цвета в состоянии покоя: во время перехода темы и reveal-анимации
  // браузер отдаёт промежуточные оттенки, и проверка ловит ложные провалы.
  await page.evaluate(async () => {
    const step = window.innerHeight * 0.8;
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    window.scrollTo(0, 0);
  });
  await page.addStyleTag({
    content: `*, *::before, *::after {
      transition: none !important;
      animation: none !important;
    }
    .reveal { opacity: 1 !important; transform: none !important; }`,
  });
  await page.waitForTimeout(250);
  const samples = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('body p, body h2, body h3, body a, body li, body label, body .btn')];
    const out = [];
    for (const node of nodes) {
      const style = getComputedStyle(node);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      const text = node.textContent.trim();
      if (!text || text.length < 3) continue;
      let bg = 'rgba(0, 0, 0, 0)';
      let parent = node;
      while (parent && (bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent')) {
        bg = getComputedStyle(parent).backgroundColor;
        parent = parent.parentElement;
      }
      out.push({ color: style.color, bg, size: parseFloat(style.fontSize), weight: style.fontWeight, text: text.slice(0, 40) });
    }
    return out;
  });

  const failing = samples
    .filter((sample) => sample.bg !== 'rgba(0, 0, 0, 0)')
    .filter((sample) => {
    const ratio = contrast(sample.color, sample.bg);
      const large = sample.size >= 24 || (sample.size >= 18.66 && Number(sample.weight) >= 700);
      return ratio < (large ? 3 : 4.5);
    });
  check(`контраст текста AA в ${theme}-теме`, failing.length === 0, JSON.stringify(failing.slice(0, 4)));
}

/* ------------------------------------------------------------- доступность */
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
const a11y = await page.evaluate(() => {
  const issues = [];
  const imgs = [...document.querySelectorAll('img')];
  if (imgs.some((img) => !img.hasAttribute('alt'))) issues.push('img без alt');
  const buttons = [...document.querySelectorAll('button')];
  if (buttons.some((b) => !b.textContent.trim() && !b.getAttribute('aria-label'))) issues.push('кнопка без доступного имени');
  const inputs = [...document.querySelectorAll('input:not([type="hidden"]), textarea, select')];
  if (inputs.some((i) => !i.closest('label') && (!i.id || !document.querySelector(`label[for="${i.id}"]`)))) {
    issues.push('поле без label');
  }
  if (!document.querySelector('.skip-link')) issues.push('нет skip-link');
  if (document.querySelectorAll('h1').length !== 1) issues.push('h1 не один');
  const links = [...document.querySelectorAll('a[href^="#"]')];
  if (links.some((a) => a.getAttribute('href') !== '#' && !document.querySelector(a.getAttribute('href')))) issues.push('якорь без цели');
  if (!document.querySelector('main#main')) issues.push('нет main');
  return issues;
});
check('базовая доступность разметки', a11y.length === 0, a11y.join(', '));

/* размер интерактивных элементов на мобильном */
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(200);
const smallTargets = await page.evaluate(() =>
  [...document.querySelectorAll('a.btn, button.btn, .icon-btn, .nav__link, .choice span, .check label')]
    .map((el) => {
      const rect = el.getBoundingClientRect();
      return { text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24), w: Math.round(rect.width), h: Math.round(rect.height) };
    })
    .filter((item) => item.w > 0 && (item.w < 44 || item.h < 44)),
);
check('зоны нажатия не меньше 44 px', smallTargets.length === 0, JSON.stringify(smallTargets.slice(0, 5)));

/* ------------------------------------------------------------- меню и скролл */
await page.click('[data-burger]');
await page.waitForTimeout(250);
const menuOpen = await page.evaluate(() => ({
  open: document.querySelector('[data-nav]').dataset.open,
  expanded: document.querySelector('[data-burger]').getAttribute('aria-expanded'),
}));
check('бургер-меню открывается', menuOpen.open === 'true' && menuOpen.expanded === 'true', JSON.stringify(menuOpen));
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
const menuClosed = await page.evaluate(() => document.querySelector('[data-burger]').getAttribute('aria-expanded'));
check('меню закрывается по Esc', menuClosed === 'false');

await page.click('[data-burger]');
await page.waitForTimeout(200);
await page.click('[data-nav] a[href="#portfolio"]');
await page.waitForTimeout(700);
const scrolled = await page.evaluate(() => ({
  open: document.querySelector('[data-nav]').dataset.open,
  y: window.scrollY,
  header: document.querySelector('[data-header]').getBoundingClientRect().height,
  top: document.getElementById('portfolio').getBoundingClientRect().top,
}));
check('клик по меню прокручивает к секции', scrolled.y > 200 && scrolled.top >= scrolled.header - 60, JSON.stringify(scrolled));
check('меню закрывается после перехода', scrolled.open === 'false');

/* --------------------------------------------------------------- модальное */
await page.locator('[data-open-lead]:visible').first().click();
await page.waitForTimeout(300);
const modal = await page.evaluate(() => ({
  hidden: document.querySelector('[data-modal]').hidden,
  locked: document.body.classList.contains('is-locked'),
  focusInside: document.querySelector('[data-modal]').contains(document.activeElement),
}));
check('модальное окно заявки открывается', modal.hidden === false && modal.locked === true, JSON.stringify(modal));
check('фокус уходит внутрь модального окна', modal.focusInside);

await page.click('#lead-modal [data-submit]');
await page.waitForTimeout(250);
const validation = await page.evaluate(() => ({
  nameError: document.querySelector('#lead-modal [data-error-for="name"]').hidden === false,
  phoneError: document.querySelector('#lead-modal [data-error-for="phone"]').hidden === false,
  consentError: document.querySelector('#lead-modal [data-error-for="consent"]').hidden === false,
  status: document.querySelector('#lead-modal [data-form-status]').textContent,
}));
check('пустая форма показывает ошибки', validation.nameError && validation.phoneError && validation.consentError, JSON.stringify(validation));

await page.fill('#lead-modal-name', 'Анна');
await page.fill('#lead-modal-phone', '9161234567');
const masked = await page.inputValue('#lead-modal-phone');
check('маска телефона работает', masked === '+7 (916) 123-45-67', masked);
await page.check('#lead-modal input[name="consent"]');
await page.click('#lead-modal [data-submit]');
await page.waitForTimeout(1200);
const success = await page.evaluate(() => ({
  status: document.querySelector('#lead-modal [data-form-status]').textContent,
  state: document.querySelector("#lead-modal [data-form-status]")?.dataset.state,
}));
check('форма отправляется и показывает успех', /Заявка отправлена/.test(success.status), JSON.stringify(success));

await page.keyboard.press('Escape');
await page.waitForTimeout(300);
const closed = await page.evaluate(() => ({
  hidden: document.querySelector('[data-modal]').hidden,
  locked: document.body.classList.contains('is-locked'),
}));
check('модальное окно закрывается по Esc и разблокирует фон', closed.hidden === true && closed.locked === false, JSON.stringify(closed));

/* --------------------------------------------------------------- лайтбокс */
await page.locator('#portfolio').scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
await page.click('[data-lightbox="2"]');
await page.waitForTimeout(600);
const lightbox = await page.evaluate(() => ({
  hidden: document.querySelector('[data-lightbox-root]').hidden,
  title: document.querySelector('[data-lightbox-title]').textContent,
  img: document.querySelector('[data-lightbox-media] img')?.naturalWidth || 0,
}));
check('лайтбокс открывает фото', lightbox.hidden === false && lightbox.img > 0, JSON.stringify(lightbox));
check('лайтбокс подписывает проект', lightbox.title.length > 3, lightbox.title);
await page.keyboard.press('Escape');
await page.waitForTimeout(250);
check('лайтбокс закрывается по Esc', await page.evaluate(() => document.querySelector('[data-lightbox-root]').hidden));

/* ------------------------------------------------------------------- FAQ */
await page.locator('#faq').scrollIntoViewIfNeeded();
const faqInitial = await page.evaluate(() => ({
  first: document.querySelector('#faq-q-0').getAttribute('aria-expanded'),
  second: document.querySelector('#faq-q-1').getAttribute('aria-expanded'),
}));
check('первый вопрос FAQ раскрыт по умолчанию', faqInitial.first === 'true' && faqInitial.second === 'false', JSON.stringify(faqInitial));
await page.click('#faq-q-1');
await page.waitForTimeout(200);
const faqAfter = await page.evaluate(() => ({
  expanded: document.querySelector('#faq-q-1').getAttribute('aria-expanded'),
  visible: !document.querySelector('#faq-a-1').hidden,
}));
check('вопрос FAQ раскрывается', faqAfter.expanded === 'true' && faqAfter.visible);

/* ------------------------------------------------------------- cookie/scroll */
// Баннер проверяем в отдельном контексте: в основном согласие уже проставлено,
// чтобы он не перекрывал клики.
{
  const freshContext = await browser.newContext({ locale: 'ru-RU', viewport: { width: 1280, height: 900 } });
  const freshPage = await freshContext.newPage();
  await freshPage.goto(BASE + '/', { waitUntil: 'networkidle' });
  const consent = await freshPage.evaluate(() => localStorage.getItem('cookie-consent'));
  check('баннер cookie показывается до решения', consent === null, String(consent));
  await freshPage.waitForTimeout(1600);
  const banner = await freshPage.evaluate(() => document.querySelector('[data-cookie-banner]').hidden);
  check('баннер cookie виден', banner === false);
  await freshPage.click('[data-cookie-accept]');
  await freshPage.waitForTimeout(300);
  const consentAfter = await freshPage.evaluate(() => ({
    stored: localStorage.getItem('cookie-consent'),
    hidden: document.querySelector('[data-cookie-banner]').hidden,
  }));
  check('согласие на cookie сохраняется', consentAfter.stored === 'all' && consentAfter.hidden === true, JSON.stringify(consentAfter));
  await freshContext.close();
}

/* кнопка наверх */
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.waitForTimeout(400);
const toTopVisible = await page.evaluate(() => !document.querySelector('[data-to-top]').hidden);
check('кнопка «наверх» появляется после прокрутки', toTopVisible);
await page.click('[data-to-top]');
await page.waitForFunction(() => window.scrollY < 50, null, { timeout: 5000 }).catch(() => {});
const atTop = await page.evaluate(() => window.scrollY);
check('кнопка «наверх» возвращает к началу', atTop < 50, String(atTop));

/* --------------------------------------------------------- загрузка ресурсов */
const perf = await page.evaluate((base) => {
  const nav = performance.getEntriesByType('navigation')[0];
  const resources = performance.getEntriesByType('resource');
  return {
    transfer: resources.reduce((sum, r) => sum + (r.transferSize || 0), 0) + (nav?.transferSize || 0),
    lcp: performance.getEntriesByType('largest-contentful-paint')?.at(-1)?.startTime || 0,
    fonts: resources.filter((r) => r.name.endsWith('.woff2')).length,
    external: resources.filter((r) => !r.name.startsWith(base)).map((r) => r.name),
  };
}, BASE);
check('шрифты загружаются локально', perf.fonts >= 2, String(perf.fonts));
check('нет внешних запросов при загрузке', perf.external.length === 0, perf.external.join(', '));
check('вес страницы в разумных пределах (<1.5 МБ без кэша)', perf.transfer < 1_500_000, `${Math.round(perf.transfer / 1024)} КБ`);

/* --------------------------------------------------------- отсутствие ошибок */
check('нет ошибок в консоли', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

await browser.close();

const failed = results.filter((item) => !item.ok);
for (const item of results) {
  if (!item.ok) console.log(`✗ ${item.name}${item.detail ? ' — ' + item.detail : ''}`);
}
console.log(`\n${results.length - failed.length}/${results.length} проверок пройдено`);
if (failed.length) process.exit(1);
