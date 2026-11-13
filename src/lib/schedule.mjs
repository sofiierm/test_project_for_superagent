// Расписание фоновой синхронизации: чистая арифметика без базы и таймеров.
//
// Здесь только функции «когда следующий запуск» и «сколько ждать после
// ошибки». Всё принимает часы и источник случайности параметрами, поэтому
// тесты проверяют расписание на поддельных часах, не дожидаясь реального
// времени.
import { parseDate } from './dates.mjs';

const MINUTE_MS = 60 * 1000;

export const BACKOFF_CODES = new Set(['bot_check', 'rate_limited']);
export const MIN_INTERVAL_MINUTES = 15;

/**
 * Джиттер разводит запуски разных аккаунтов, чтобы не бить в платформу
 * пачкой одновременно. Возвращает множитель в диапазоне
 * [1 - jitter, 1 + jitter].
 */
export function jitterFactor(random = Math.random, jitter = 0.2) {
  const share = Math.max(0, Math.min(1, Number(jitter) || 0));
  if (!share) return 1;
  const value = Number(random());
  const unit = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.5;
  return 1 + (unit * 2 - 1) * share;
}

/**
 * Следующий плановый запуск после успешной синхронизации.
 */
export function nextRunAfterSuccess({
  now = new Date(),
  intervalMinutes,
  jitter = 0.2,
  random = Math.random,
} = {}) {
  const base = parseDate(now) || new Date();
  const interval = Math.max(MIN_INTERVAL_MINUTES, Number(intervalMinutes) || MIN_INTERVAL_MINUTES);
  const ms = interval * MINUTE_MS * jitterFactor(random, jitter);
  return new Date(base.getTime() + ms).toISOString();
}

/**
 * Экспоненциальная пауза после ошибки источника: 1-я ошибка — base,
 * 2-я — 2·base, 3-я — 4·base и так до потолка. Для `bot_check` и
 * `rate_limited` база больше, потому что частые повторы усугубляют блокировку.
 */
export function backoffMinutes({
  attempts = 1,
  errorCode = '',
  baseMinutes = 15,
  maxMinutes = 12 * 60,
} = {}) {
  const base = BACKOFF_CODES.has(errorCode) ? baseMinutes * 4 : baseMinutes;
  const step = Math.max(1, Math.min(10, Number(attempts) || 1));
  return Math.min(maxMinutes, base * 2 ** (step - 1));
}

export function nextRunAfterFailure({
  now = new Date(),
  attempts = 1,
  errorCode = '',
  baseMinutes = 15,
  maxMinutes = 12 * 60,
  jitter = 0,
  random = Math.random,
} = {}) {
  const current = parseDate(now) || new Date();
  const minutes = backoffMinutes({ attempts, errorCode, baseMinutes, maxMinutes });
  return new Date(current.getTime() + minutes * MINUTE_MS * jitterFactor(random, jitter))
    .toISOString();
}

/**
 * Пора ли синхронизировать аккаунт. `next_sync_at` пустой означает «ещё ни
 * разу не планировали» — такой аккаунт считается должным.
 *
 * Статус `running` здесь намеренно не проверяется: он может остаться в базе
 * после падения процесса, и тогда аккаунт застрял бы навсегда. Занятость
 * определяется замком в памяти (`sync-lock`), а не полем в базе.
 */
export function isDue(account, now = new Date()) {
  if (!account) return false;
  const next = parseDate(account.nextSyncAt);
  if (!next) return true;
  return next.getTime() <= (parseDate(now) || new Date()).getTime();
}

/**
 * Человеческая причина, почему запуск отложен. Пустая строка — обычное
 * расписание без ограничений источника.
 */
export function delayReason(errorCode) {
  if (errorCode === 'bot_check') {
    return 'платформа требует подтверждения, что запрос делает человек';
  }
  if (errorCode === 'rate_limited') {
    return 'платформа ограничила частоту запросов';
  }
  if (errorCode === 'timeout') return 'источник не ответил вовремя';
  if (errorCode === 'ytdlp_missing') return 'живой источник не установлен';
  if (errorCode) return 'прошлая синхронизация завершилась ошибкой';
  return '';
}

/**
 * Нормализует интервал аккаунта: у аккаунта может быть свой интервал,
 * иначе берётся общий из конфигурации.
 */
export function intervalFor(account, fallbackMinutes) {
  const own = Number(account?.syncIntervalMinutes);
  if (Number.isFinite(own) && own > 0) return Math.max(MIN_INTERVAL_MINUTES, own);
  return Math.max(MIN_INTERVAL_MINUTES, Number(fallbackMinutes) || MIN_INTERVAL_MINUTES);
}
