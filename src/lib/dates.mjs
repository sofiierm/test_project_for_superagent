// Работа с датами: хранение в ISO/UTC, отображение в часовом поясе приложения.
import { config } from '../config.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;

export function nowIso() {
  return new Date().toISOString();
}

export function parseDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function toIso(value) {
  const d = parseDate(value);
  return d ? d.toISOString() : null;
}

export function daysBetween(a, b) {
  const first = parseDate(a);
  const second = parseDate(b);
  if (!first || !second) return 0;
  return (second.getTime() - first.getTime()) / DAY_MS;
}

export function addDays(value, days) {
  const d = parseDate(value) || new Date();
  return new Date(d.getTime() + days * DAY_MS).toISOString();
}

export function startOfDay(value) {
  const d = parseDate(value) || new Date();
  const copy = new Date(d);
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
}

const partsFormatter = new Intl.DateTimeFormat('ru-RU', {
  timeZone: config.timeZone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  weekday: 'short',
});

export function zonedParts(value) {
  const d = parseDate(value);
  if (!d) return null;
  const parts = Object.fromEntries(
    partsFormatter.formatToParts(d).map((p) => [p.type, p.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    weekday: parts.weekday,
  };
}

const WEEKDAYS_RU = {
  'пн': 1, 'вт': 2, 'ср': 3, 'чт': 4, 'пт': 5, 'сб': 6, 'вс': 7,
};

// 1 — понедельник, 7 — воскресенье, в часовом поясе приложения.
export function weekdayIndex(value) {
  const p = zonedParts(value);
  if (!p) return null;
  return WEEKDAYS_RU[p.weekday.replace('.', '')] ?? null;
}

export function zonedHour(value) {
  const p = zonedParts(value);
  return p ? p.hour : null;
}

const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  timeZone: config.timeZone, day: 'numeric', month: 'long', year: 'numeric',
});
const shortDateFormatter = new Intl.DateTimeFormat('ru-RU', {
  timeZone: config.timeZone, day: 'numeric', month: 'short',
});
const dateTimeFormatter = new Intl.DateTimeFormat('ru-RU', {
  timeZone: config.timeZone, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
});
const monthFormatter = new Intl.DateTimeFormat('ru-RU', {
  timeZone: config.timeZone, month: 'short',
});

export function formatDate(value) {
  const d = parseDate(value);
  return d ? dateFormatter.format(d) : '—';
}

export function formatShortDate(value) {
  const d = parseDate(value);
  return d ? shortDateFormatter.format(d).replace('.', '') : '—';
}

export function formatDateTime(value) {
  const d = parseDate(value);
  return d ? dateTimeFormatter.format(d).replace('.', '') : '—';
}

export function formatMonth(value) {
  const d = parseDate(value);
  return d ? monthFormatter.format(d).replace('.', '') : '';
}

export function monthKey(value) {
  const p = zonedParts(value);
  return p ? `${p.year}-${String(p.month).padStart(2, '0')}` : '';
}

export function formatRelative(value) {
  const d = parseDate(value);
  if (!d) return 'ещё не было';
  const diff = Date.now() - d.getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return 'только что';
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'вчера';
  if (days < 30) return `${days} дн назад`;
  return formatDate(d);
}

// «через 2 ч», «через 15 мин», «сейчас» — для расписания синхронизации.
export function formatIn(value, now = Date.now()) {
  const d = parseDate(value);
  if (!d) return '—';
  const diff = d.getTime() - Number(now);
  if (diff <= 60_000) return 'сейчас';
  const minutes = Math.round(diff / 60000);
  if (minutes < 60) return `через ${minutes} мин`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `через ${hours} ч`;
  const days = Math.round(hours / 24);
  return `через ${days} ${plural(days, 'день', 'дня', 'дней')}`;
}

export function formatNumber(value, { compact = false } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  if (compact) {
    const abs = Math.abs(n);
    if (abs >= 1_000_000) return `${trim(n / 1_000_000)} млн`;
    if (abs >= 1_000) return `${trim(n / 1_000)} тыс`;
  }
  return new Intl.NumberFormat('ru-RU').format(Math.round(n));
}

function trim(n) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(n);
}

export function formatPercent(value, digits = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(n)}%`;
}

export function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function plural(number, one, few, many) {
  const n = Math.abs(Number(number)) % 100;
  const n1 = n % 10;
  if (n > 10 && n < 20) return many;
  if (n1 > 1 && n1 < 5) return few;
  if (n1 === 1) return one;
  return many;
}
