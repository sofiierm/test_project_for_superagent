#!/usr/bin/env node
// Генерирует статические ассеты: иконки, OG-картинку, карту из тайлов OSM.
// Карта — статичная картинка (без внешних скриптов), клик ведёт на openstreetmap.org.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const STATIC = path.join(ROOT, 'src/static');
const IMG = path.join(ROOT, 'assets/img');
fs.mkdirSync(STATIC, { recursive: true });

const site = (await import('../src/content/site.mjs')).site;

/* ------------------------------------------------------------------ favicon */
const logo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#a8451f"/>
  <g fill="none" stroke="#fdf8f2" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round">
    <path d="M13 52V20l19-9 19 9v32"/>
    <path d="M25 52V37h14v15"/>
    <path d="M13 52h38"/>
  </g>
</svg>`;
fs.writeFileSync(path.join(STATIC, 'favicon.svg'), logo);

const logoBuf = Buffer.from(logo);
await sharp(logoBuf).resize(32, 32).png().toFile(path.join(STATIC, 'favicon-32.png'));
await sharp(logoBuf).resize(180, 180).png().toFile(path.join(STATIC, 'apple-touch-icon.png'));
await sharp(logoBuf).resize(192, 192).png().toFile(path.join(STATIC, 'android-chrome-192.png'));
await sharp(logoBuf).resize(512, 512).png().toFile(path.join(STATIC, 'android-chrome-512.png'));

// favicon.ico: ICO-контейнер с одним 32×32 PNG внутри (читается всеми браузерами).
const png32 = await sharp(logoBuf).resize(32, 32).png().toBuffer();
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
const entry = Buffer.alloc(16);
entry[0] = 32;
entry[1] = 32;
entry[2] = 0;
entry[3] = 0;
entry.writeUInt16LE(1, 4);
entry.writeUInt16LE(32, 6);
entry.writeUInt32LE(png32.length, 8);
entry.writeUInt32LE(22, 12);
fs.writeFileSync(path.join(STATIC, 'favicon.ico'), Buffer.concat([header, entry, png32]));

/* --------------------------------------------------------------- webmanifest */
fs.writeFileSync(
  path.join(STATIC, 'site.webmanifest'),
  JSON.stringify(
    {
      name: `${site.brand} — мебель на заказ`,
      short_name: site.brand,
      description: 'Мебельная мастерская полного цикла: кухни, шкафы и мебель на заказ в Москве.',
      lang: 'ru',
      start_url: '/',
      scope: '/',
      display: 'browser',
      background_color: '#f7f4ef',
      theme_color: '#f7f4ef',
      icons: [
        { src: '/android-chrome-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/android-chrome-512.png', sizes: '512x512', type: 'image/png' },
        { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' },
      ],
    },
    null,
    2,
  ) + '\n',
);

/* ------------------------------------------------------------------ og-image */
const hero = JSON.parse(fs.readFileSync(path.join(IMG, 'manifest.json'), 'utf8')).find(
  (item) => item.id === 'hero-interior',
);
const heroSource = path.join(IMG, hero.files[1920].jpg);

const ogSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
  <defs>
    <linearGradient id="scrim" x1="0" y1="0" x2="1" y2="0.4">
      <stop offset="0" stop-color="#140f0b" stop-opacity="0.92"/>
      <stop offset="0.62" stop-color="#140f0b" stop-opacity="0.62"/>
      <stop offset="1" stop-color="#140f0b" stop-opacity="0.2"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#scrim)"/>
  <text x="72" y="300" font-family="Georgia, 'Times New Roman', serif" font-size="72" fill="#fdf8f2">Мебель на заказ</text>
  <text x="72" y="378" font-family="Georgia, 'Times New Roman', serif" font-size="42" fill="#e6d9c8">в Москве · с 2014 года</text>
  <text x="72" y="500" font-family="Helvetica, Arial, sans-serif" font-size="28" fill="#d9c9b4">Своё производство · замер бесплатно · гарантия 5 лет</text>
  <text x="72" y="576" font-family="Helvetica, Arial, sans-serif" font-size="26" fill="#f0a07c">${site.brand.toLowerCase()}</text>
</svg>`;

await sharp(heroSource)
  .resize(1200, 630, { fit: 'cover', position: 'attention' })
  .composite([{ input: Buffer.from(ogSvg), top: 0, left: 0 }])
  .jpeg({ quality: 82, mozjpeg: true, progressive: true })
  .toFile(path.join(STATIC, 'og-image.jpg'));

// Компактная версия для микроразметки Organization/LocalBusiness.
await sharp(heroSource).resize(1200, 630, { fit: 'cover' }).jpeg({ quality: 78, mozjpeg: true }).toFile(path.join(STATIC, 'phone-hero.jpg'));

/* ---------------------------------------------------------------------- карта */
// Сшиваем тайлы OpenStreetMap 2×2 вокруг точки мастерской. Тайлы кэшируются,
// чтобы повторная сборка не ходила в сеть.
const CACHE = path.join(ROOT, '.cache/osm');
fs.mkdirSync(CACHE, { recursive: true });

const lonToTile = (lon, z) => ((lon + 180) / 360) * 2 ** z;
const latToTile = (lat, z) => {
  const rad = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z;
};

async function fetchTile(z, x, y) {
  const file = path.join(CACHE, `${z}-${x}-${y}.png`);
  if (fs.existsSync(file)) return fs.readFileSync(file);
  const url = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
  const response = await fetch(url, { headers: { 'User-Agent': 'les-i-liniya-site-build/1.0 (static landing demo)' } });
  if (!response.ok) throw new Error(`Тайл ${z}/${x}/${y}: HTTP ${response.status}`);
  const buf = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(file, buf);
  return buf;
}

const Z = 15;
const centerX = lonToTile(site.map.lon, Z);
const centerY = latToTile(site.map.lat, Z);
const tileX = Math.floor(centerX);
const tileY = Math.floor(centerY);
const tileSize = 256;

const tiles = [];
for (let dy = -1; dy <= 1; dy += 1) {
  for (let dx = -1; dx <= 1; dx += 1) {
    // eslint-disable-next-line no-await-in-loop
    const buf = await fetchTile(Z, tileX + dx, tileY + dy);
    tiles.push({ input: buf, left: (dx + 1) * tileSize, top: (dy + 1) * tileSize });
  }
}

const canvas = 3 * tileSize;
const mapBase = await sharp({
  create: { width: canvas, height: canvas, channels: 3, background: '#e9e4da' },
})
  .composite(tiles)
  .png()
  .toBuffer();

// Маркер в точке мастерской.
const px = Math.round((centerX - (tileX - 1)) * tileSize);
const py = Math.round((centerY - (tileY - 1)) * tileSize);
const marker = `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="92" viewBox="0 0 72 92">
  <path d="M36 4c-16.6 0-30 13.2-30 29.5C6 57 36 88 36 88s30-31 30-54.5C66 17.2 52.6 4 36 4Z" fill="#a8451f" stroke="#fdf8f2" stroke-width="4"/>
  <circle cx="36" cy="33" r="10" fill="#fdf8f2"/>
</svg>`;

const markerBuf = Buffer.from(marker);
const composed = await sharp(mapBase)
  .composite([{ input: markerBuf, left: px - 36, top: py - 84 }])
  .png()
  .toBuffer();

// Кадрируем область 3:2 вокруг маркера, не выходя за пределы склеенной карты.
const cropW = canvas;
const cropH = Math.round((canvas * 2) / 3);
const cropLeft = 0;
const cropTop = Math.min(Math.max(py - cropH / 2, 0), canvas - cropH);
const crop = { left: cropLeft, top: Math.round(cropTop), width: cropW, height: cropH };

const widths = [960, 1440];
for (const width of widths) {
  const height = Math.round((width * 2) / 3);
  const resized = sharp(composed).extract(crop).resize(width, height);
  await resized.clone().avif({ quality: 55, effort: 5 }).toFile(path.join(IMG, `map-${width}.avif`));
  await resized.clone().webp({ quality: 76 }).toFile(path.join(IMG, `map-${width}.webp`));
  await resized.clone().jpeg({ quality: 80, mozjpeg: true }).toFile(path.join(IMG, `map-${width}.jpg`));
}

console.log('static assets:', fs.readdirSync(STATIC).sort().join(', '));
console.log('map:', widths.map((w) => `map-${w}`).join(', '));
