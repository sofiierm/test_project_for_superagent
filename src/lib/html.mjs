import fs from 'node:fs';
import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '..', '..');
export const manifest = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'assets/img/manifest.json'), 'utf8'),
);
const byId = new Map(manifest.map((item) => [item.id, item]));

export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function image(id) {
  const item = byId.get(id);
  if (!item) throw new Error(`Unknown image: ${id}`);
  return item;
}

const srcset = (item, ext) =>
  item.widths.map((w) => `/assets/img/${item.files[w][ext]} ${w}w`).join(', ');

/**
 * Responsive <picture> with AVIF → WebP → JPEG fallbacks, intrinsic size and a
 * blurred inline placeholder, so layout never shifts while images decode.
 */
export function picture(
  id,
  {
    sizes,
    className = '',
    loading = 'lazy',
    fetchpriority = 'auto',
    decorative = false,
    alt,
    imgClass = '',
    width,
    height,
  } = {},
) {
  const item = image(id);
  const w = width ?? item.widths[item.widths.length - 1];
  const h = height ?? item.files[w].height;
  const altText = decorative ? '' : alt ?? item.alt;
  const cls = [className, imgClass].filter(Boolean).join(' ');
  return `<picture class="picture ${cls}"${decorative ? ' aria-hidden="true"' : ''}>
  <source type="image/avif" srcset="${srcset(item, 'avif')}" sizes="${sizes ?? item.sizes}">
  <source type="image/webp" srcset="${srcset(item, 'webp')}" sizes="${sizes ?? item.sizes}">
  <img src="/assets/img/${item.files[w].jpg}" srcset="${srcset(item, 'jpg')}" sizes="${sizes ?? item.sizes}"
       width="${w}" height="${h}" alt="${escapeHtml(altText)}" loading="${loading}"
       decoding="async" fetchpriority="${fetchpriority}"
       style="background-image:url('${item.lqip}')"${cls ? ` class="${cls}"` : ''}>
</picture>`;
}

export function phoneHref(phone) {
  return 'tel:' + phone.replace(/[^\d+]/g, '');
}

export function formatDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const months = [
    'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
  ];
  return `${d} ${months[m - 1]} ${y}`;
}
