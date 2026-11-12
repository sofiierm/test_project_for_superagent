#!/usr/bin/env node
// Generates responsive AVIF/WebP/JPEG derivatives from the CC-licensed originals
// and writes assets/img/manifest.json used by the templates and the tests.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const RAW_DIR = path.join(ROOT, 'candidates');
const OUT_DIR = path.join(ROOT, 'assets/img');

const finalMeta = JSON.parse(fs.readFileSync(path.join(ROOT, 'sources/images.json'), 'utf8'));
const plan = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/image-plan.json'), 'utf8'));

const rawForTitle = (title) => {
  const entry = finalMeta.find((x) => x.title === title);
  if (!entry) throw new Error('No source metadata for ' + title);
  return path.join(RAW_DIR, entry.file);
};

fs.mkdirSync(OUT_DIR, { recursive: true });
const manifest = [];

for (const item of plan) {
  const input = rawForTitle(item.source.title);
  if (!fs.existsSync(input)) throw new Error('Missing original: ' + input);
  const meta = await sharp(input).metadata();
  const base = sharp(input).rotate();

  const files = {};
  for (const width of item.widths) {
    const height = Math.round(width / item.aspect);
    const resized = base.clone().resize(width, height, { fit: 'cover', position: 'attention' });
    const name = `${item.id}-${width}`;
    await resized.clone().avif({ quality: 52, effort: 6 }).toFile(path.join(OUT_DIR, `${name}.avif`));
    await resized.clone().webp({ quality: 72, effort: 5 }).toFile(path.join(OUT_DIR, `${name}.webp`));
    await resized.clone().jpeg({ quality: 78, mozjpeg: true, progressive: true }).toFile(path.join(OUT_DIR, `${name}.jpg`));
    files[width] = { avif: `${name}.avif`, webp: `${name}.webp`, jpg: `${name}.jpg`, height };
  }

  // A tiny blurred placeholder keeps layout stable while the large file decodes.
  const lqip = await sharp(input).resize(24).blur(1.2).webp({ quality: 40 }).toBuffer();

  manifest.push({
    id: item.id,
    alt: item.alt,
    aspect: item.aspect,
    sizes: item.sizes,
    widths: item.widths,
    hero: item.hero,
    portfolio: item.portfolio,
    files,
    lqip: `data:image/webp;base64,${lqip.toString('base64')}`,
    source: item.source,
    original: { width: meta.width, height: meta.height },
  });
  console.log(item.id, item.widths.join('/'), 'ok');
}

fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('images:', manifest.length);
