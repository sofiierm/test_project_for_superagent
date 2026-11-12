/**
 * Правила заявки — один модуль для браузера и сервера, чтобы клиентская и
 * серверная валидация не расходились.
 */
export const NAME_MIN = 2;
export const NAME_MAX = 50;
export const COMMENT_MAX = 500;
export const CONTACT_METHODS = ['call', 'whatsapp', 'telegram'];
export const CONSENT_VERSION = '2026-11-12';

const CYRILLIC = 'а-яёА-ЯЁ';
const NAME_RE = new RegExp(`^[${CYRILLIC}A-Za-z][${CYRILLIC}A-Za-z\\s'’.-]*$`);

export function normalizeName(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

/** Оставляет только цифры и нормализует российский номер до +7XXXXXXXXXX. */
export function normalizePhone(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) return '+7' + digits;
  if (digits.length === 11 && (digits[0] === '7' || digits[0] === '8')) {
    return '+7' + digits.slice(1);
  }
  return '';
}

export function formatPhone(digits) {
  const d = String(digits ?? '').replace(/\D/g, '');
  const rest = d.startsWith('7') || d.startsWith('8') ? d.slice(1) : d;
  const p = rest.slice(0, 10);
  let out = '+7';
  if (p.length > 0) out += ' (' + p.slice(0, 3);
  if (p.length >= 3) out += ')';
  if (p.length > 3) out += ' ' + p.slice(3, 6);
  if (p.length > 6) out += '-' + p.slice(6, 8);
  if (p.length > 8) out += '-' + p.slice(8, 10);
  return out;
}

/** Маска для ввода: всегда возвращает строку вида «+7 (___) ___-__-__». */
export function maskPhoneInput(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  const normalized = digits.startsWith('8') ? '7' + digits.slice(1) : digits;
  return formatPhone(normalized.slice(0, 11));
}

export function normalizeComment(value) {
  return String(value ?? '').trim();
}

/**
 * @returns {{ok: boolean, values?: object, errors?: Record<string,string>}}
 */
export function validateLead(input) {
  const errors = {};
  const name = normalizeName(input?.name);
  const phone = normalizePhone(input?.phone);
  const comment = normalizeComment(input?.comment);
  const method = String(input?.contactMethod ?? 'call');
  const consent = input?.consent === true || input?.consent === 'on' || input?.consent === 'true';
  const honeypot = String(input?.website ?? '').trim();

  if (name.length < NAME_MIN) errors.name = `Укажите имя — от ${NAME_MIN} символов.`;
  else if (name.length > NAME_MAX) errors.name = `Имя короче ${NAME_MAX + 1} символа.`;
  else if (!NAME_RE.test(name)) errors.name = 'В имени допустимы буквы, пробел, дефис и точка.';
  else if (name.replace(/[^\p{L}]/gu, '').length < NAME_MIN) errors.name = 'Укажите настоящее имя.';

  if (!phone) errors.phone = 'Введите номер в формате +7 (___) ___-__-__.';
  else if (!/^\+7\d{10}$/.test(phone)) errors.phone = 'Нужен российский номер из 11 цифр.';

  if (comment.length > COMMENT_MAX) errors.comment = `Комментарий — до ${COMMENT_MAX} символов.`;

  if (!CONTACT_METHODS.includes(method)) errors.contactMethod = 'Выберите способ связи.';

  if (!consent) errors.consent = 'Без согласия на обработку данных мы не можем принять заявку.';
  if (honeypot) errors.website = 'Заявка не отправлена.';

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    values: { name, phone, comment, contactMethod: method, consent: true, consentVersion: CONSENT_VERSION },
  };
}

/** Декодирует тело запроса: JSON или form-urlencoded. */
export function parseBody(raw, contentType = '') {
  const text = typeof raw === 'string' ? raw : raw?.toString('utf8') ?? '';
  if (!text) return {};
  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(text);
    } catch {
      return {};
    }
  }
  const params = new URLSearchParams(text);
  const out = {};
  for (const [key, value] of params) out[key] = value;
  return out;
}
