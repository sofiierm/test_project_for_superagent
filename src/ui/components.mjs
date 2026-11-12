// Переиспользуемые фрагменты интерфейса: бейджи, метрики, графики, пустые состояния.
import { html, raw } from './html.mjs';
import {
  formatNumber, formatPercent, formatShortDate, formatDuration, plural,
} from '../lib/dates.mjs';

export const PLATFORM_LABELS = {
  instagram: 'Instagram',
  youtube: 'YouTube',
  tiktok: 'TikTok',
};

export function platformBadge(platform) {
  return html`<span class="badge badge--${platform}">${PLATFORM_LABELS[platform] ?? platform}</span>`;
}

export function avatar(account, { size = 40 } = {}) {
  const initials = (account.displayName || account.handle || '?')
    .split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toLocaleUpperCase('ru-RU');
  const style = size === 40 ? '' : ` style="width:${size}px;height:${size}px;font-size:${Math.round(size / 2.6)}px"`;
  return html`<span class="avatar avatar--${account.platform}" aria-hidden="true"${raw(style)}>${initials}</span>`;
}

export function deltaBadge(change, { invert = false, suffix = '%' } = {}) {
  if (change === null || change === undefined || !Number.isFinite(change)) {
    return html`<span class="delta delta--flat">нет сравнения</span>`;
  }
  const rounded = Math.abs(change) < 0.5 ? 0 : change;
  const up = invert ? rounded < 0 : rounded > 0;
  const flat = rounded === 0;
  const cls = flat ? 'flat' : up ? 'up' : 'down';
  const arrow = flat ? '→' : rounded > 0 ? '↑' : '↓';
  const text = `${arrow} ${formatPercent(Math.abs(rounded))}${suffix === '%' ? '' : suffix}`;
  return html`<span class="delta delta--${cls}">${text}</span>`;
}

export function statCard({ label, value, meta, delta }) {
  return html`
    <div class="card stat">
      <span class="stat__label">${label}</span>
      <span class="stat__value">${value}</span>
      ${meta || delta ? html`<span class="stat__meta">${delta ?? ''}${meta ? html`<span>${meta}</span>` : ''}</span>` : ''}
    </div>`;
}

export function emptyState({ title, text, action }) {
  return html`
    <div class="empty">
      <p class="empty__title">${title}</p>
      <p class="empty__text">${text}</p>
      ${action ?? ''}
    </div>`;
}

/**
 * Линейный график с заливкой. Все координаты считаются здесь, а не в CSS:
 * так SVG выглядит одинаково в любом браузере и стабильно снимается в тестах.
 */
export function lineChart(rows, {
  width = 720, height = 240, valueKey = 'views', labelKey = 'key',
  labelFormatter = formatShortDate, ariaLabel = 'График', emptyText = 'Нет данных за период',
} = {}) {
  if (!rows.length) {
    return html`<p class="card__hint">${emptyText}</p>`;
  }
  const pad = { top: 16, right: 12, bottom: 26, left: 46 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const values = rows.map((r) => Number(r[valueKey]) || 0);
  const max = Math.max(...values, 1);
  const niceMax = niceCeil(max);
  const stepX = rows.length > 1 ? innerW / (rows.length - 1) : 0;
  const x = (i) => pad.left + i * stepX;
  const y = (v) => pad.top + innerH - (v / niceMax) * innerH;

  const points = rows.map((row, i) => `${round(x(i))},${round(y(Number(row[valueKey]) || 0))}`);
  const linePath = points.length > 1
    ? `M${points.join(' L')}`
    : `M${points[0]} L${pad.left + innerW},${points[0].split(',')[1]}`;
  const areaPath = `${linePath} L${round(x(rows.length - 1))},${round(pad.top + innerH)} L${round(pad.left)},${round(pad.top + innerH)} Z`;

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => niceMax * t);
  const labelEvery = Math.max(1, Math.ceil(rows.length / 7));

  return html`
    <svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${ariaLabel}" preserveAspectRatio="none">
      <defs>
        <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#7c9cff" stop-opacity="0.34"></stop>
          <stop offset="100%" stop-color="#7c9cff" stop-opacity="0"></stop>
        </linearGradient>
      </defs>
      ${ticks.map((tick) => html`
        <line class="chart__grid" x1="${pad.left}" x2="${width - pad.right}" y1="${round(y(tick))}" y2="${round(y(tick))}"></line>
        <text class="chart__axis" x="${pad.left - 8}" y="${round(y(tick) + 4)}" text-anchor="end">${formatNumber(tick, { compact: true })}</text>
      `)}
      <path class="chart__area" d="${areaPath}"></path>
      <path class="chart__line" d="${linePath}"></path>
      ${rows.map((row, i) => (i % labelEvery === 0 || i === rows.length - 1
        ? html`<text class="chart__axis" x="${round(x(i))}" y="${height - 8}" text-anchor="middle">${labelFormatter(row[labelKey])}</text>`
        : ''))}
      ${rows.map((row, i) => html`
        <circle class="chart__dot" cx="${round(x(i))}" cy="${round(y(Number(row[valueKey]) || 0))}" r="3">
          <title>${labelFormatter(row[labelKey])}: ${formatNumber(row[valueKey])}</title>
        </circle>
      `)}
    </svg>`;
}

export function barChart(rows, { valueKey = 'views', labelKey = 'label', height = 22 } = {}) {
  if (!rows.length) return html`<p class="card__hint">Нет данных</p>`;
  const max = Math.max(...rows.map((r) => Number(r[valueKey]) || 0), 1);
  return html`
    <div class="list">
      ${rows.map((row, i) => html`
        <div class="bar-row">
          <div class="bar-row__head">
            <span class="bar-row__label" title="${row[labelKey]}">${row[labelKey]}</span>
            <span class="bar-row__value">${formatNumber(row[valueKey])}</span>
          </div>
          <div class="bar-row__track">
            <div class="bar-row__fill" style="width:${Math.max(2, round(((Number(row[valueKey]) || 0) / max) * 100))}%;height:${height}px"></div>
          </div>
        </div>
      `)}
    </div>`;
}

/**
 * Столбчатая диаграмма по часам/дням недели.
 */
export function columnsChart(rows, { valueKey = 'avgEr', labelKey = 'key', labelFormatter = String, width = 360, height = 150 } = {}) {
  if (!rows.length) return html`<p class="card__hint">Недостаточно данных</p>`;
  const pad = { top: 8, right: 4, bottom: 22, left: 4 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const max = Math.max(...rows.map((r) => Number(r[valueKey]) || 0), 1);
  const gap = 4;
  const barW = Math.max(3, (innerW - gap * (rows.length - 1)) / rows.length);
  return html`
    <svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Распределение по времени публикаций">
      ${rows.map((row, i) => {
        const value = Number(row[valueKey]) || 0;
        const barH = Math.max(2, (value / max) * innerH);
        const x = pad.left + i * (barW + gap);
        return html`
          <rect class="chart__bar" x="${round(x)}" y="${round(pad.top + innerH - barH)}" width="${round(barW)}" height="${round(barH)}" rx="2">
            <title>${labelFormatter(row[labelKey])}: ${formatPercent(value)}</title>
          </rect>`;
      })}
      ${rows.map((row, i) => (rows.length <= 12
        ? html`<text class="chart__axis" x="${round(pad.left + i * (barW + gap) + barW / 2)}" y="${height - 6}" text-anchor="middle">${labelFormatter(row[labelKey])}</text>`
        : ''))}
    </svg>`;
}

export function videoRow(video, { showAccount = true } = {}) {
  return html`
    <tr>
      <td>
        <div class="cell-title">
          <a class="cell-title__main" href="/videos/${video.id}">${video.title}</a>
          <span class="cell-title__sub">
            ${showAccount ? `${PLATFORM_LABELS[video.platform] ?? video.platform} · ${video.handle} · ` : ''}${formatShortDate(video.publishedAt)}
            ${video.durationSeconds ? ` · ${formatDuration(video.durationSeconds)}` : ''}
          </span>
        </div>
      </td>
      <td class="num">${formatNumber(video.views)}</td>
      <td class="num">${formatNumber(video.likes)}</td>
      <td class="num">${formatNumber(video.comments)}</td>
      <td class="num">${formatPercent(video.engagementRate)}</td>
    </tr>`;
}

export function videosTable(videos, { showAccount = true, emptyText = 'Пока нет роликов.' } = {}) {
  if (!videos.length) {
    return html`<p class="card__hint" style="padding:16px 0">${emptyText}</p>`;
  }
  return html`
    <div class="table-wrap">
      <table class="data" aria-label="Ролики с метриками">
        <thead>
          <tr>
            <th scope="col">${showAccount ? 'Ролик' : 'Название'}</th>
            <th scope="col" class="num">Просмотры</th>
            <th scope="col" class="num">Лайки</th>
            <th scope="col" class="num">Комментарии</th>
            <th scope="col" class="num">ER</th>
          </tr>
        </thead>
        <tbody>${videos.map((v) => videoRow(v, { showAccount }))}</tbody>
      </table>
    </div>`;
}

export function insightList(insights) {
  if (!insights.length) {
    return html`<p class="card__hint">Наблюдений пока нет.</p>`;
  }
  const marks = { warning: '!', critical: '!', opportunity: '↑', info: 'i' };
  return html`
    <div>
      ${insights.map((item) => html`
        <div class="insight insight--${item.level}">
          <span class="insight__icon" aria-hidden="true">${marks[item.level] ?? 'i'}</span>
          <div class="insight__body">
            <span class="insight__title">${item.title}</span>
            <span class="insight__detail">${item.detail}</span>
            ${item.action ? html`<span class="insight__action">Что сделать: ${item.action}</span>` : ''}
          </div>
        </div>
      `)}
    </div>`;
}

export function topicsList(topics, { metric = 'lift' } = {}) {
  if (!topics.length) return html`<p class="card__hint">Темы не выделены: слишком мало текста.</p>`;
  const max = Math.max(...topics.map((t) => (metric === 'lift' ? t.lift : t.count)), 0.001);
  return html`
    <div class="list">
      ${topics.map((topic) => html`
        <div class="bar-row">
          <div class="bar-row__head">
            <span class="bar-row__label">${topic.label}</span>
            <span class="bar-row__value">
              ${metric === 'lift'
                ? html`×${topic.lift.toFixed(2)} к среднему охвату`
                : html`${topic.count} ${plural(topic.count, 'ролик', 'ролика', 'роликов')} · ${formatPercent(topic.share)}`}
            </span>
          </div>
          <div class="bar-row__track">
            <div class="bar-row__fill${topic.lift >= 1.15 ? ' bar-row__fill--good' : topic.lift < 0.85 ? ' bar-row__fill--warn' : ''}"
                 style="width:${Math.max(3, round(((metric === 'lift' ? topic.lift : topic.count) / max) * 100))}%"></div>
          </div>
        </div>
      `)}
    </div>`;
}

export function hookTable(hooks) {
  const rows = hooks.filter((h) => h.count > 0);
  if (!rows.length) return html`<p class="card__hint">Приёмы подачи не распознаны.</p>`;
  return html`
    <div class="table-wrap">
      <table class="data" aria-label="Приёмы подачи и вовлечённость">
        <thead>
          <tr>
            <th scope="col">Приём</th>
            <th scope="col" class="num">Роликов</th>
            <th scope="col" class="num">Средний ER</th>
            <th scope="col" class="num">Без приёма</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((h) => html`
            <tr>
              <td>${h.label}</td>
              <td class="num">${h.count} <span class="cell-title__sub">(${formatPercent(h.share, 0)})</span></td>
              <td class="num">${formatPercent(h.avgEr)}</td>
              <td class="num">${h.avgErWithout ? formatPercent(h.avgErWithout) : '—'}</td>
            </tr>
          `)}
        </tbody>
      </table>
    </div>`;
}

export function sentimentBar(sentiment) {
  const { positive, neutral, negative } = sentiment;
  return html`
    <div>
      <div style="display:flex;height:10px;border-radius:5px;overflow:hidden;background:var(--surface-2)">
        <div style="width:${round(positive)}%;background:var(--good)" title="Позитивные: ${formatPercent(positive)}"></div>
        <div style="width:${round(neutral)}%;background:var(--line-strong)" title="Нейтральные: ${formatPercent(neutral)}"></div>
        <div style="width:${round(negative)}%;background:var(--bad)" title="Негативные: ${formatPercent(negative)}"></div>
      </div>
      <div class="legend" style="margin-top:10px">
        <span class="legend__item"><span class="legend__swatch" style="background:var(--good)"></span>Позитивно ${formatPercent(positive, 0)}</span>
        <span class="legend__item"><span class="legend__swatch" style="background:var(--line-strong)"></span>Нейтрально ${formatPercent(neutral, 0)}</span>
        <span class="legend__item"><span class="legend__swatch" style="background:var(--bad)"></span>Негативно ${formatPercent(negative, 0)}</span>
      </div>
    </div>`;
}

export function notice(text, kind = 'info') {
  return html`<div class="notice notice--${kind}"><span>${text}</span></div>`;
}

function niceCeil(value) {
  if (value <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(value));
  const normalized = value / pow;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * pow;
}

function round(n) {
  return Math.round(Number(n) * 100) / 100;
}

export { round };
