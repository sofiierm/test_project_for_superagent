#!/usr/bin/env node
// Тесты без браузера: валидация заявки, обработчик API, наличие ассетов и
// базовая проверка собранного HTML (один h1, alt, размеры, canonical, JSON-LD).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { validateLead, normalizePhone, maskPhoneInput, formatPhone } from '../src/js/lead-validation.mjs';
import { handleLead } from '../api/lead.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'dist');

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    passed += 1;
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
  }
}

/* ------------------------------------------------------------- валидация */
test('имя и телефон проходят валидацию', () => {
  const result = validateLead({ name: 'Анна', phone: '+7 (916) 123-45-67', consent: true });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.values.phone, '+79161234567');
});

test('короткое имя отклоняется', () => {
  const result = validateLead({ name: 'А', phone: '+79161234567', consent: true });
  assert.equal(result.ok, false);
  assert.ok(result.errors.name);
});

test('имя из цифр отклоняется', () => {
  const result = validateLead({ name: '123', phone: '+79161234567', consent: true });
  assert.equal(result.ok, false);
});

test('восьмёрка нормализуется в +7', () => {
  assert.equal(normalizePhone('8 916 123 45 67'), '+79161234567');
  assert.equal(normalizePhone('9161234567'), '+79161234567');
});

test('неполный телефон отклоняется', () => {
  const result = validateLead({ name: 'Анна', phone: '+7 (916) 123', consent: true });
  assert.equal(result.ok, false);
  assert.ok(result.errors.phone);
});

test('согласие обязательно', () => {
  const result = validateLead({ name: 'Анна', phone: '+79161234567', consent: false });
  assert.equal(result.ok, false);
  assert.ok(result.errors.consent);
});

test('honeypot блокирует отправку', () => {
  const result = validateLead({ name: 'Анна', phone: '+79161234567', consent: true, website: 'http://spam' });
  assert.equal(result.ok, false);
});

test('длинный комментарий отклоняется', () => {
  const result = validateLead({ name: 'Анна', phone: '+79161234567', consent: true, comment: 'x'.repeat(501) });
  assert.equal(result.ok, false);
  assert.ok(result.errors.comment);
});

test('маска форматирует ввод', () => {
  assert.equal(maskPhoneInput('9161234567'), '+7 (916) 123-45-67');
  assert.equal(maskPhoneInput('89161234567'), '+7 (916) 123-45-67');
  assert.equal(formatPhone('79161234567'), '+7 (916) 123-45-67');
});

test('неизвестный способ связи отклоняется', () => {
  const result = validateLead({ name: 'Анна', phone: '+79161234567', consent: true, contactMethod: 'carrier-pigeon' });
  assert.equal(result.ok, false);
});

/* ------------------------------------------------------------------- API */
await testAsync('API принимает валидную заявку', async () => {
  const body = JSON.stringify({ name: 'Иван', phone: '+7 (916) 000-11-22', consent: true, contactMethod: 'call' });
  const result = await handleLead(body, 'application/json', { env: {}, ip: '10.0.0.1' });
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
});

await testAsync('API отклоняет невалидную заявку', async () => {
  const body = JSON.stringify({ name: 'A', phone: '123', consent: false });
  const result = await handleLead(body, 'application/json', { env: {}, ip: '10.0.0.2' });
  assert.equal(result.status, 422);
  assert.ok(result.body.errors?.phone);
});

await testAsync('API понимает form-urlencoded', async () => {
  const body = 'name=%D0%90%D0%BD%D0%BD%D0%B0&phone=%2B79161234567&consent=on';
  const result = await handleLead(body, 'application/x-www-form-urlencoded', { env: {}, ip: '10.0.0.3' });
  assert.equal(result.status, 200);
});

await testAsync('API ограничивает частоту', async () => {
  let last;
  for (let i = 0; i < 7; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    last = await handleLead(
      JSON.stringify({ name: 'Иван', phone: '+79160001122', consent: true }),
      'application/json',
      { env: {}, ip: '10.0.0.9' },
    );
  }
  assert.equal(last.status, 429);
});

/* ---------------------------------------------------------------- статика */
test('собранные страницы существуют', () => {
  for (const file of ['index.html', 'privacy.html', 'credits.html', '404.html', 'robots.txt', 'sitemap.xml', 'assets/css/site.css', 'assets/js/main.js', 'favicon.svg', 'og-image.jpg']) {
    assert.ok(fs.existsSync(path.join(DIST, file)), `нет файла ${file}`);
  }
});

test('в HTML один h1 и есть h2', () => {
  const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
  const h1 = html.match(/<h1[\s>]/g) || [];
  const h2 = html.match(/<h2[\s>]/g) || [];
  assert.equal(h1.length, 1, `h1 найдено ${h1.length}`);
  assert.ok(h2.length >= 8, `h2 найдено ${h2.length}`);
});

test('у всех img есть alt', () => {
  for (const file of ['index.html', 'privacy.html', 'credits.html', '404.html']) {
    const html = fs.readFileSync(path.join(DIST, file), 'utf8');
    const imgs = html.match(/<img\b[^>]*>/g) || [];
    for (const img of imgs) {
      assert.ok(/\salt="/.test(img), `без alt в ${file}: ${img.slice(0, 120)}`);
    }
  }
});

test('у изображений заданы width и height', () => {
  const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
  const imgs = html.match(/<img\b[^>]*>/g) || [];
  for (const img of imgs) {
    assert.ok(/\swidth="\d+"/.test(img) && /\sheight="\d+"/.test(img), `без размеров: ${img.slice(0, 120)}`);
  }
});

test('все локальные ссылки на ассеты существуют', () => {
  const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
  const refs = new Set();
  for (const match of html.matchAll(/(?:src|href)="(\/[^"#?]+)"/g)) refs.add(match[1]);
  for (const match of html.matchAll(/srcset="([^"]+)"/g)) {
    for (const part of match[1].split(',')) {
      const url = part.trim().split(/\s+/)[0];
      if (url.startsWith('/')) refs.add(url);
    }
  }
  const missing = [...refs].filter((ref) => !fs.existsSync(path.join(DIST, ref)));
  assert.deepEqual(missing, [], 'нет файлов: ' + missing.join(', '));
});

test('лайтбокс-данные ссылаются на существующие файлы', () => {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/portfolio-lightbox.json'), 'utf8'));
  for (const item of data) {
    for (const url of item.sources.jpgSrcset.split(',').map((s) => s.trim().split(/\s+/)[0])) {
      assert.ok(fs.existsSync(path.join(DIST, url)), 'нет ' + url);
    }
  }
});

test('canonical и OG-теги на месте', () => {
  const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
  assert.match(html, /<link rel="canonical" href="https:\/\/[^"]+"/);
  assert.match(html, /property="og:image"/);
  assert.match(html, /name="twitter:card"/);
});

test('JSON-LD разбирается и содержит FAQPage', () => {
  const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  assert.ok(blocks.length >= 3);
  const types = blocks.map((block) => JSON.parse(block[1])['@type']);
  assert.ok(types.includes('FAQPage'));
  assert.ok(types.includes('LocalBusiness'));
  assert.ok(types.includes('Organization'));
});

test('title и description в лимитах', () => {
  const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
  const title = html.match(/<title>([^<]+)<\/title>/)[1];
  const description = html.match(/<meta name="description" content="([^"]+)"/)[1];
  assert.ok(title.length <= 60, `title ${title.length} символов`);
  assert.ok(description.length <= 160, `description ${description.length} символов`);
});

test('ранний скрипт темы стоит до стилей', () => {
  const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
  const themeScript = html.indexOf("localStorage.getItem('theme')");
  const css = html.indexOf('stylesheet');
  assert.ok(themeScript > 0 && themeScript < css, 'скрипт темы должен идти до CSS');
});

test('нет ссылок на внешние CDN в разметке', () => {
  const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
  const external = [...html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)]
    .map((m) => m[1])
    .filter((url) => !/les-i-liniya\.ru|openstreetmap\.org|creativecommons\.org|schema\.org|t\.me|wa\.me/.test(url));
  assert.deepEqual(external, []);
});

test('robots.txt и sitemap.xml согласованы', () => {
  const robots = fs.readFileSync(path.join(DIST, 'robots.txt'), 'utf8');
  const sitemap = fs.readFileSync(path.join(DIST, 'sitemap.xml'), 'utf8');
  assert.match(robots, /Sitemap: https:\/\/.+\/sitemap\.xml/);
  assert.match(sitemap, /<urlset/);
  assert.match(sitemap, /<loc>https:\/\/.+\/<\/loc>/);
});

test('стили и скрипты минифицированы', () => {
  const css = fs.readFileSync(path.join(DIST, 'assets/css/site.css'), 'utf8');
  const js = fs.readFileSync(path.join(DIST, 'assets/js/main.js'), 'utf8');
  assert.ok(css.length > 5000);
  // В минифицированном CSS не бывает отступов и переводов строк между правилами.
  assert.ok(!/\n\s{2,}/.test(css), 'CSS не минифицирован');
  // В минифицированном JS не остаётся отступов в начале строк кода; длинные
  // переводы строк внутри шаблонных литералов допустимы.
  assert.ok(!/^\s{2,}(const|let|function|if|for)/m.test(js), 'JS не минифицирован');
  assert.ok(js.split('\n').length < 60, `JS слишком многострочный: ${js.split('\n').length} строк`);
});

test('все изображения манифеста имеют AVIF, WebP и JPEG', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/img/manifest.json'), 'utf8'));
  for (const item of manifest) {
    for (const width of item.widths) {
      for (const ext of ['avif', 'webp', 'jpg']) {
        const file = path.join(DIST, 'assets/img', item.files[width][ext]);
        assert.ok(fs.existsSync(file), 'нет ' + file);
      }
    }
  }
});

test('кредиты изображений перечисляют все исходники', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/img/manifest.json'), 'utf8'));
  const credits = fs.readFileSync(path.join(DIST, 'credits.html'), 'utf8');
  for (const item of manifest) {
    assert.ok(credits.includes(item.source.author) || item.source.author === '', 'нет автора ' + item.source.author);
    assert.ok(credits.includes(item.source.license), 'нет лицензии ' + item.source.license);
  }
});

/* ------------------------------------------------------------------ вывод */
if (failures.length) {
  console.error(`\n✗ ${failures.length} из ${passed + failures.length} проверок упали:\n`);
  for (const failure of failures) console.error('  - ' + failure);
  process.exit(1);
}
console.log(`✓ ${passed} проверок пройдено`);
