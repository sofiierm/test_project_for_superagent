#!/usr/bin/env node
// Клиентские данные лайтбокса: те же derivatives, что и в манифесте, но в
// плоском виде — так модальному окну не нужен второй запрос.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/img/manifest.json'), 'utf8'));
const { portfolio } = await import('../src/content/site.mjs');

const byId = new Map(manifest.map((item) => [item.id, item]));

const out = portfolio.map((item) => {
  const image = byId.get(item.image);
  if (!image) throw new Error('Нет изображения: ' + item.image);
  const widths = image.widths;
  const largest = widths[widths.length - 1];
  const srcsetFor = (ext) => widths.map((w) => `/assets/img/${image.files[w][ext]} ${w}w`).join(', ');
  return {
    title: item.title,
    details: item.details,
    term: item.term,
    alt: image.alt,
    width: largest,
    height: image.files[largest].height,
    sources: {
      avif: srcsetFor('avif'),
      webp: srcsetFor('webp'),
      jpg: `/assets/img/${image.files[largest].jpg}`,
      jpgSrcset: srcsetFor('jpg'),
    },
  };
});

fs.writeFileSync(path.join(ROOT, 'scripts/portfolio-lightbox.json'), JSON.stringify(out, null, 2) + '\n');
console.log('lightbox entries:', out.length);
