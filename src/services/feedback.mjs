// Обратная связь: проверка полей, нормализация телефона и ограничение частоты.
//
// Форма публичная, поэтому проверки здесь строже обычных: сервер не должен
// принимать мусор, даже если браузерная валидация обойдена. Ограничение
// частоты хранится в памяти процесса — как и у попыток входа (#7): для одного
// узла этого достаточно, а база не растёт мусорными записями.
import {
  countFeedback as countStoredFeedback,
  deleteFeedback as deleteStoredFeedback,
  insertFeedback,
  listFeedback as listStoredFeedback,
} from '../db/feedback.mjs';

export const NAME_MIN = 2;
export const NAME_MAX = 80;
export const COMMENT_MAX = 1000;

const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 10;
const rateHits = new Map();

const NAME_RE = /^[\p{L}][\p{L}\p{M}\s'’.-]*$/u;

export function normalizeName(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

/**
 * Российский номер в каноническом виде `+7XXXXXXXXXX`.
 *
 * Принимаем привычные варианты: `+7 (999) 123-45-67`, `8 999 123 45 67`,
 * `9991234567`. Всё остальное считаем ошибкой — выдумывать код страны нельзя.
 */
export function normalizePhone(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) return `+7${digits}`;
  if (digits.length === 11 && (digits[0] === '7' || digits[0] === '8')) {
    return `+7${digits.slice(1)}`;
  }
  return '';
}

/** Человеческий вид канонического номера; нераспознанное возвращаем как есть. */
export function formatPhone(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  const rest = digits.length === 11 && (digits[0] === '7' || digits[0] === '8')
    ? digits.slice(1)
    : digits;
  if (rest.length !== 10) return String(value ?? '').trim();
  return `+7 (${rest.slice(0, 3)}) ${rest.slice(3, 6)}-${rest.slice(6, 8)}-${rest.slice(8, 10)}`;
}

/**
 * Проверка полей формы.
 *
 * При ошибке возвращаем и то, что ввёл человек: перерисовывать пустую форму
 * после опечатки в телефоне — худший способ «помочь». Для телефона отдаём
 * исходную строку, чтобы поле не обнулялось.
 */
export function validateFeedback(input = {}) {
  const name = normalizeName(input.name);
  const phoneInput = String(input.phone ?? '').trim();
  const phone = normalizePhone(phoneInput);
  const comment = String(input.comment ?? '').trim();
  const errors = {};

  if (!name) errors.name = 'Укажите имя.';
  else if (name.length < NAME_MIN) errors.name = `Имя — не короче ${NAME_MIN} символов.`;
  else if (name.length > NAME_MAX) errors.name = `Имя — не длиннее ${NAME_MAX} символов.`;
  else if (!NAME_RE.test(name)) errors.name = 'В имени допустимы буквы, пробел, дефис и точка.';
  else if (name.replace(/[^\p{L}]/gu, '').length < NAME_MIN) errors.name = 'Укажите настоящее имя.';

  if (!phoneInput) errors.phone = 'Укажите телефон в формате +7 (999) 123-45-67.';
  else if (!phone) errors.phone = 'Нужен российский номер: 10 или 11 цифр.';

  if (comment.length > COMMENT_MAX) errors.comment = `Комментарий — не длиннее ${COMMENT_MAX} символов.`;

  const values = { name, phone: phoneInput, comment };
  if (Object.keys(errors).length) return { ok: false, errors, values };
  return { ok: true, values: { name, phone, comment } };
}

/** Состояние ограничения частоты для IP; не меняет счётчик. */
export function feedbackRateState(ip, { now = Date.now() } = {}) {
  const key = String(ip ?? '');
  const entries = (rateHits.get(key) ?? []).filter((time) => now - time < RATE_WINDOW_MS);
  if (entries.length) rateHits.set(key, entries); else rateHits.delete(key);
  return {
    blocked: entries.length >= RATE_MAX,
    remaining: Math.max(0, RATE_MAX - entries.length),
    retryAfter: entries.length
      ? Math.ceil((RATE_WINDOW_MS - (now - entries[0])) / 1000)
      : 0,
  };
}

function noteFeedback(ip, { now = Date.now() } = {}) {
  const key = String(ip ?? '');
  const entries = (rateHits.get(key) ?? []).filter((time) => now - time < RATE_WINDOW_MS);
  entries.push(now);
  rateHits.set(key, entries);
}

/** Только для тестов: сбрасывает накопленные отправки. */
export function resetFeedbackRateLimit() {
  rateHits.clear();
}

/**
 * Принять обращение.
 *
 * Honeypot проверяем до валидации: бот, заполнивший скрытое поле, не должен
 * получать подсказку, какие поля он пропустил. Отвечаем «успехом», но ничего
 * не сохраняем.
 */
export function submitFeedback(input = {}, { ip = '', now = Date.now(), db } = {}) {
  const values = {
    name: normalizeName(input.name),
    phone: String(input.phone ?? '').trim(),
    comment: String(input.comment ?? '').trim(),
  };

  if (String(input.website ?? '').trim()) {
    return { ok: true, honeypot: true, values };
  }

  const validated = validateFeedback(values);
  if (!validated.ok) {
    return { ok: false, status: 422, errors: validated.errors, values: validated.values };
  }

  const rate = feedbackRateState(ip, { now });
  if (rate.blocked) {
    return {
      ok: false,
      status: 429,
      error: `Слишком много обращений. Повторите через ${Math.max(1, Math.ceil(rate.retryAfter / 60))} мин.`,
      values: validated.values,
    };
  }

  const feedback = insertFeedback(validated.values, db);
  noteFeedback(ip, { now });
  return { ok: true, feedback, values: validated.values };
}

export function listFeedback(options = {}, db) {
  return listStoredFeedback(options, db).map((item) => ({
    ...item,
    phoneFormatted: formatPhone(item.phone),
  }));
}

export const countFeedback = countStoredFeedback;
export const deleteFeedback = deleteStoredFeedback;
