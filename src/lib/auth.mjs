// Аутентификация: пароли, сессии, подписанные cookie, CSRF.
//
// Всё на стандартной библиотеке Node.js: scrypt для паролей, HMAC-SHA256 для
// подписи cookie, timingSafeEqual для сравнений. Внешние зависимости здесь
// особенно нежелательны — это код, который проверяет пароли.
import crypto from 'node:crypto';

export const SESSION_COOKIE = 'ca_session';
export const CSRF_COOKIE = 'ca_csrf';
export const CSRF_HEADER = 'x-csrf-token';

const SCRYPT_KEYLEN = 64;
const SALT_BYTES = 16;

/**
 * Хеш пароля в формате `scrypt$<salt>$<hash>`.
 *
 * Параметры scrypt по умолчанию (N=16384, r=8, p=1) подобраны так, чтобы
 * проверка занимала десятки миллисекунд: этого достаточно против перебора по
 * украденной базе и незаметно для пользователя при входе.
 */
export function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 1) {
    throw new Error('Пароль не может быть пустым.');
  }
  const salt = crypto.randomBytes(SALT_BYTES);
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

/**
 * Проверка пароля против сохранённого хеша.
 *
 * Сравнение постоянного времени: обычное `===` утекает информацию о том,
 * сколько первых байт совпало. При битом формате хеша возвращаем false, а не
 * бросаем исключение — иначе повреждённая строка в базе превратилась бы в 500
 * вместо «неверный пароль».
 */
export function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  let salt;
  let expected;
  try {
    salt = Buffer.from(parts[1], 'base64url');
    expected = Buffer.from(parts[2], 'base64url');
  } catch {
    return false;
  }
  if (!salt.length || !expected.length) return false;
  let actual;
  try {
    actual = crypto.scryptSync(password, salt, expected.length);
  } catch {
    return false;
  }
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

/** Случайный токен для cookie сессии и CSRF. */
export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

/**
 * В базе храним только хеш токена сессии.
 *
 * Утечка базы тогда не даёт готовых cookie: по хешу токен не восстановить.
 * SHA-256 без соли здесь достаточен — токен уже случайный и длинный, а
 * перебор 256-битного значения бессмыслен.
 */
export function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('base64url');
}

/**
 * Значение подписанной cookie: `<token>.<hmac>`.
 *
 * Подпись не даёт подделать сессию, даже если злоумышленник знает формат:
 * без секрета он не соберёт валидный HMAC. `timingSafeEqual` — чтобы не
 * утекало, сколько символов подписи совпало.
 */
export function signValue(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

export function signCookie(token, secret) {
  return `${token}.${signValue(token, secret)}`;
}

/**
 * Проверка подписанной cookie. Возвращает токен или `null`.
 *
 * Сравнение подписи идёт по HMAC, а не по самой строке: длина подписи
 * фиксирована, поэтому timingSafeEqual применим без утечки длины.
 */
export function unsignCookie(value, secret) {
  if (typeof value !== 'string') return null;
  const dot = value.lastIndexOf('.');
  if (dot <= 0) return null;
  const token = value.slice(0, dot);
  const signature = value.slice(dot + 1);
  if (!token || !signature) return null;
  const expected = signValue(token, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  return crypto.timingSafeEqual(a, b) ? token : null;
}

/** Разбор заголовка Cookie в простой объект. */
export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      out[key] = part.slice(eq + 1).trim();
    }
  }
  return out;
}

/** Сериализация Set-Cookie с безопасными по умолчанию атрибутами. */
export function serializeCookie(name, value, { maxAge, secure = false, httpOnly = true, sameSite = 'Lax', path = '/' } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, `SameSite=${sameSite}`];
  if (httpOnly) parts.push('HttpOnly');
  if (secure) parts.push('Secure');
  if (Number.isFinite(maxAge)) parts.push(`Max-Age=${Math.floor(maxAge)}`);
  return parts.join('; ');
}

/** Cookie для удаления: пустое значение и Max-Age=0. */
export function clearCookie(name, { path = '/' } = {}) {
  return `${name}=; Path=${path}; Max-Age=0; HttpOnly; SameSite=Lax`;
}
