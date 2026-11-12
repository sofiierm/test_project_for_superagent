#!/usr/bin/env node
// Собирает статический сайт в dist/: страницы, стили, скрипты, шрифты, картинки.
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { site, faq } from '../src/content/site.mjs';
import { manifest, picture } from '../src/lib/html.mjs';
import { renderIndex } from '../src/pages/index.mjs';
import { head, header, footer, overlays } from '../src/pages/layout.mjs';
import { renderPrivacy, renderCredits, render404 } from '../src/pages/legal.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'dist');
const SITE_URL = process.env.SITE_URL || 'https://les-i-liniya.ru';

const portfolio = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/portfolio-lightbox.json'), 'utf8'));

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

/* ---------------------------------------------------------------- страницы */
const TITLE = 'Мебель на заказ в Москве — мастерская «Лес и Линия»';
const DESCRIPTION =
  'Кухни, шкафы и мебель на заказ: своё производство в Москве, замер и смета бесплатно, срок 20–30 дней, гарантия 5 лет.';

const jsonLd = [
  {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${SITE_URL}/#organization`,
    name: site.brand,
    legalName: site.legalName,
    url: SITE_URL,
    logo: `${SITE_URL}/android-chrome-512.png`,
    email: site.email,
    telephone: site.phone,
    description: 'Мебельная мастерская полного цикла: проектирование, производство и монтаж мебели на заказ в Москве.',
    sameAs: [site.telegram, site.whatsapp].filter(Boolean),
  },
  {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    '@id': `${SITE_URL}/#localbusiness`,
    name: site.brand,
    image: `${SITE_URL}/phone-hero.jpg`,
    url: SITE_URL,
    telephone: site.phone,
    email: site.email,
    priceRange: '₽₽',
    address: {
      '@type': 'PostalAddress',
      streetAddress: 'Дербеневская набережная, 7, строение 2',
      addressLocality: 'Москва',
      postalCode: '115114',
      addressCountry: 'RU',
    },
    geo: { '@type': 'GeoCoordinates', latitude: site.map.lat, longitude: site.map.lon },
    openingHoursSpecification: [
      { '@type': 'OpeningHoursSpecification', dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], opens: '10:00', closes: '20:00' },
      { '@type': 'OpeningHoursSpecification', dayOfWeek: 'Saturday', opens: '11:00', closes: '17:00' },
    ],
    areaServed: { '@type': 'City', name: 'Москва' },
  },
  {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faq.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: { '@type': 'Answer', text: item.a },
    })),
  },
  {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${SITE_URL}/#website`,
    url: SITE_URL,
    name: site.brand,
    inLanguage: 'ru-RU',
    publisher: { '@id': `${SITE_URL}/#organization` },
  },
];

const indexHtml = renderIndex({
  head: head({
    canonical: `${SITE_URL}/`,
    title: TITLE,
    description: DESCRIPTION,
    ogImage: `${SITE_URL}/og-image.jpg`,
    jsonLd,
    scripts: ['/assets/js/main.js'],
  }),
  header: header(),
  footer: footer(),
  overlays: `${overlays()}
  <script type="application/json" id="portfolio-data">${JSON.stringify(portfolio)}</script>`,
});

fs.writeFileSync(path.join(DIST, 'index.html'), indexHtml);
fs.writeFileSync(path.join(DIST, 'privacy.html'), renderPrivacy());
fs.writeFileSync(path.join(DIST, 'credits.html'), renderCredits(manifest));
fs.writeFileSync(path.join(DIST, '404.html'), render404());

/* ------------------------------------------------------------------ стили */
const styles = fs.readdirSync(path.join(ROOT, 'src/styles')).filter((f) => f.endsWith('.css'));
// @import собираем вручную: esbuild умеет это сам, но порядок должен быть явным.
const order = ['tokens.css', 'base.css', 'components.css', 'sections.css', 'responsive.css'];
const css = order
  .map((file) => {
    if (!styles.includes(file)) throw new Error('Нет файла стилей: ' + file);
    return `/* ${file} */\n` + fs.readFileSync(path.join(ROOT, 'src/styles', file), 'utf8');
  })
  .join('\n');

const cssResult = await build({
  stdin: { contents: css, resolveDir: path.join(ROOT, 'src/styles'), loader: 'css' },
  bundle: true,
  minify: true,
  target: ['chrome100', 'safari15', 'firefox100'],
  write: false,
  external: ['/assets/fonts/*'],
});
fs.mkdirSync(path.join(DIST, 'assets/css'), { recursive: true });
fs.writeFileSync(path.join(DIST, 'assets/css/site.css'), cssResult.outputFiles[0].text);

// Отдельный небольшой файл для служебных страниц.
const docsCss = await build({
  stdin: {
    contents: fs.readFileSync(path.join(ROOT, 'src/styles/docs.css'), 'utf8'),
    resolveDir: path.join(ROOT, 'src/styles'),
    loader: 'css',
  },
  bundle: true,
  minify: true,
  target: ['chrome100', 'safari15', 'firefox100'],
  write: false,
});
fs.writeFileSync(path.join(DIST, 'assets/css/docs.css'), docsCss.outputFiles[0].text);

/* --------------------------------------------------------------- скрипты */
const jsResult = await build({
  entryPoints: [path.join(ROOT, 'src/js/main.mjs')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['chrome100', 'safari15', 'firefox100'],
  write: false,
  legalComments: 'none',
});
fs.mkdirSync(path.join(DIST, 'assets/js'), { recursive: true });
fs.writeFileSync(path.join(DIST, 'assets/js/main.js'), jsResult.outputFiles[0].text);
// Тот же скрипт в виде ES-модуля — для тестов и будущих интеграций.
fs.writeFileSync(path.join(DIST, 'assets/js/main.mjs'), jsResult.outputFiles[0].text);

/* --------------------------------------------------------------- ассеты */
const copyDir = (from, to) => {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dest);
    else fs.copyFileSync(src, dest);
  }
};

copyDir(path.join(ROOT, 'src/fonts'), path.join(DIST, 'assets/fonts'));
copyDir(path.join(ROOT, 'assets/img'), path.join(DIST, 'assets/img'));
copyDir(path.join(ROOT, 'src/static'), path.join(DIST));

/* ----------------------------------------------------------- sitemap/robots */
const today = new Date().toISOString().slice(0, 10);
fs.writeFileSync(
  path.join(DIST, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${SITE_URL}/</loc><lastmod>${today}</lastmod><changefreq>monthly</changefreq><priority>1.0</priority></url>
  <url><loc>${SITE_URL}/privacy.html</loc><lastmod>${today}</lastmod><changefreq>yearly</changefreq><priority>0.3</priority></url>
  <url><loc>${SITE_URL}/credits.html</loc><lastmod>${today}</lastmod><changefreq>yearly</changefreq><priority>0.2</priority></url>
</urlset>
`,
);

fs.writeFileSync(
  path.join(DIST, 'robots.txt'),
  `User-agent: *
Allow: /
Disallow: /api/

Sitemap: ${SITE_URL}/sitemap.xml
`,
);

/* ------------------------------------------------------------------- отчёт */
let bytes = 0;
let files = 0;
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else {
      files += 1;
      bytes += fs.statSync(full).size;
    }
  }
};
walk(DIST);
console.log(`dist: ${files} файлов, ${(bytes / 1024 / 1024).toFixed(2)} МБ`);
