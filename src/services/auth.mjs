// Аутентификация и авторизация (#7).
//
// Режимы:
//  • `AUTH_REQUIRED=false` (по умолчанию) — локальный запуск одного человека:
//    все запросы считаются запросами владельца, вход не нужен. Это сохраняет
//    поведение версии 1.0 и не ломает существующие развёртывания.
//  • `AUTH_REQUIRED=true` — общий доступ: без входа видно только страницу входа,
//    аккаунты принадлежат пользователю, чужие данные недоступны.
//
// Пароли — scrypt, сессии — только хешем в базе, cookie подписана HMAC.
import crypto from 'node:crypto';
import { config } from '../config.mjs';
import {
  CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE, clearCookie, hashPassword, hashToken,
  parseCookies, randomToken, serializeCookie, signCookie, unsignCookie, verifyPassword,
} from '../lib/auth.mjs';
import {
  countUsers, deleteSession, deleteUserSessions, findUserBySession, getPasswordHash,
  getUser, getUserByEmail, insertSession, insertUser, purgeExpiredSessions, touchLogin,
  updateUser,
} from '../db/users.mjs';
import { getDb } from '../db/index.mjs';

const SESSION_DAYS = 14;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX = 8;

/**
 * Ограничение частоты попыток входа (#7).
 *
 * Хранится в памяти процесса: при нескольких репликах нужен общий счётчик, но
 * для защиты от перебора на одном узле этого достаточно, а база не растёт
 * мусорными записями. Ключ — «email + IP»: только по IP один общий NAT
 * заблокировал бы всех, только по email — позволил бы перебирать с разных IP.
 */
const loginAttempts = new Map();

function attemptKey(email, ip) {
  return `${String(email ?? '').toLowerCase()}|${ip ?? ''}`;
}

export function rateLimitState(email, ip, { now = Date.now() } = {}) {
  const key = attemptKey(email, ip);
  const entry = loginAttempts.get(key);
  if (!entry) return { blocked: false, remaining: RATE_LIMIT_MAX, retryAfter: 0 };
  if (now - entry.first > RATE_LIMIT_WINDOW_MS) {
    loginAttempts.delete(key);
    return { blocked: false, remaining: RATE_LIMIT_MAX, retryAfter: 0 };
  }
  const remaining = Math.max(0, RATE_LIMIT_MAX - entry.count);
  return {
    blocked: remaining <= 0,
    remaining,
    retryAfter: Math.ceil((RATE_LIMIT_WINDOW_MS - (now - entry.first)) / 1000),
  };
}

function noteFailedAttempt(email, ip, { now = Date.now() } = {}) {
  const key = attemptKey(email, ip);
  const entry = loginAttempts.get(key);
  if (!entry || now - entry.first > RATE_LIMIT_WINDOW_MS) {
    loginAttempts.set(key, { count: 1, first: now });
    return;
  }
  entry.count += 1;
}

function clearAttempts(email, ip) {
  loginAttempts.delete(attemptKey(email, ip));
}

/** Только для тестов: сбрасывает накопленные попытки. */
export function resetRateLimit() {
  loginAttempts.clear();
}

/**
 * Владелец ли это по умолчанию (режим без входа).
 *
 * В локальном режиме пользователя в базе может не быть вовсе, поэтому
 * возвращаем синтетического владельца: маршруты не должны обрастать
 * проверками «а есть ли вообще пользователь».
 */
export const ANONYMOUS_OWNER = Object.freeze({
  id: 0,
  email: '',
  name: 'Локальный владелец',
  role: 'owner',
  createdAt: null,
  lastLoginAt: null,
  local: true,
});

export function authRequired() {
  return Boolean(config.authRequired);
}

/** Нужна ли первичная настройка: в режиме с входом и без единого пользователя. */
export function needsSetup(db = getDb()) {
  return authRequired() && countUsers(db) === 0;
}

/**
 * Текущий пользователь запроса.
 *
 * Возвращает `{ user, token }`, где `user` — владелец в локальном режиме,
 * `null` в режиме с входом без валидной сессии. Подпись cookie проверяется
 * до обращения к базе: подделанная cookie не должна даже вызывать запрос.
 */
export function currentSession(req, { db = getDb() } = {}) {
  if (!authRequired()) return { user: ANONYMOUS_OWNER, token: null, local: true };
  const cookies = parseCookies(req.headers.cookie);
  const raw = cookies[SESSION_COOKIE];
  if (!raw) return { user: null, token: null };
  const token = unsignCookie(raw, config.sessionSecret);
  if (!token) return { user: null, token: null };
  const user = findUserBySession(hashToken(token), {}, db);
  if (!user) return { user: null, token: null };
  return { user, token };
}

/** CSRF-токен из cookie; пустая строка, если cookie ещё нет. */
export function csrfToken(req) {
  const cookies = parseCookies(req.headers.cookie);
  return cookies[CSRF_COOKIE] || '';
}

/**
 * CSRF-токен с выдачей cookie при первом обращении.
 *
 * Без этого у нового посетителя cookie нет, скрытое поле формы остаётся пустым,
 * и вход без JavaScript становится невозможен: форма уходила бы без токена.
 * Возвращает `{ token, cookie }`, где `cookie` нужно отправить только когда
 * токен создан.
 */
export function issueCsrf(req) {
  const existing = csrfToken(req);
  if (existing) return { token: existing, cookie: null };
  const token = randomToken();
  return {
    token,
    cookie: serializeCookie(CSRF_COOKIE, token, {
      maxAge: SESSION_DAYS * 24 * 3600, secure: config.cookieSecure, httpOnly: false,
    }),
  };
}

/**
 * Проверка CSRF для изменяющих запросов.
 *
 * Токен обязан совпасть и в cookie, и в заголовке. Двойная отправка не требует
 * хранения на сервере, а сторонний сайт не может прочитать cookie жертвы,
 * поэтому подставить заголовок ему нечем. `SameSite=Lax` — вторая линия.
 */
export function verifyCsrf(req, bodyToken = '') {
  if (!authRequired()) return true;
  const method = String(req.method ?? 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;
  const fromCookie = csrfToken(req);
  // Токен приходит либо заголовком (fetch), либо скрытым полем формы:
  // HTML-форма не умеет ставить заголовки, а без этого вход и управление
  // доступом работали бы только с включённым JavaScript.
  const fromHeader = req.headers[CSRF_HEADER] || req.headers[CSRF_HEADER.toLowerCase()] || bodyToken;
  if (!fromCookie || !fromHeader) return false;
  if (fromCookie.length !== String(fromHeader).length) return false;
  // Сравнение постоянного времени: длина уже совпала, поэтому timingSafeEqual
  // применим напрямую.
  const a = Buffer.from(fromCookie);
  const b = Buffer.from(String(fromHeader));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function sessionExpiry(now = new Date()) {
  return new Date(now.getTime() + SESSION_DAYS * 24 * 3600 * 1000).toISOString();
}

function requestIp(req) {
  return (req.socket?.remoteAddress ?? '').replace(/^::ffff:/, '');
}

/**
 * Вход по email и паролю.
 *
 * Возвращает `{ status, user?, cookies?, error? }`. Одинаковый текст ошибки для
 * несуществующего пользователя и неверного пароля: иначе форма входа
 * превращается в проверку «какие email зарегистрированы».
 */
export function login({ email, password, req, db = getDb() }) {
  const ip = requestIp(req);
  const state = rateLimitState(email, ip);
  if (state.blocked) {
    return {
      status: 429,
      error: `Слишком много попыток входа. Повторите через ${Math.ceil(state.retryAfter / 60)} мин.`,
      retryAfter: state.retryAfter,
    };
  }

  const stored = getPasswordHash(email, db);
  const user = getUserByEmail(email, db);
  if (!stored || !user || !verifyPassword(password, stored)) {
    noteFailedAttempt(email, ip);
    return { status: 401, error: 'Неверный email или пароль.' };
  }

  clearAttempts(email, ip);
  purgeExpiredSessions({}, db);
  touchLogin(user.id, db);
  const token = randomToken();
  insertSession({
    userId: user.id,
    tokenHash: hashToken(token),
    expiresAt: sessionExpiry(),
    userAgent: req.headers['user-agent'] ?? '',
    ip,
  }, db);

  const csrf = randomToken();
  return {
    status: 200,
    user: getUser(user.id, db),
    token,
    csrf,
    cookies: [
      serializeCookie(SESSION_COOKIE, signCookie(token, config.sessionSecret), {
        maxAge: SESSION_DAYS * 24 * 3600, secure: config.cookieSecure,
      }),
      serializeCookie(CSRF_COOKIE, csrf, {
        maxAge: SESSION_DAYS * 24 * 3600, secure: config.cookieSecure, httpOnly: false,
      }),
    ],
  };
}

/** Выход: сессия удаляется в базе, cookie гасятся. */
export function logout(req, { db = getDb() } = {}) {
  const { token } = currentSession(req, { db });
  if (token) deleteSession(hashToken(token), db);
  return {
    cookies: [clearCookie(SESSION_COOKIE), clearCookie(CSRF_COOKIE)],
  };
}

/**
 * Первичная настройка: создание владельца.
 *
 * Разрешена только когда пользователей ещё нет. Иначе первый, кто дотянулся до
 * порта, назначил бы себя владельцем — это была бы дыра, а не удобство.
 */
export function setupOwner({ email, password, name = '' }, { db = getDb() } = {}) {
  if (!authRequired()) return { status: 409, error: 'Сервис работает без входа: настройка не требуется.' };
  if (countUsers(db) > 0) return { status: 409, error: 'Владелец уже создан. Войдите в сервис.' };
  const normalised = String(email ?? '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalised)) {
    return { status: 422, error: 'Укажите корректный email.' };
  }
  if (String(password ?? '').length < 8) {
    return { status: 422, error: 'Пароль должен быть не короче 8 символов.' };
  }
  const user = insertUser({
    email: normalised, name: String(name ?? ''), passwordHash: hashPassword(password), role: 'owner',
  }, db);
  return { status: 201, user };
}

/** Смена своего пароля: старая сессия сохраняется, остальные гасятся. */
export function changePassword({ user, currentPassword, newPassword }, { db = getDb() } = {}) {
  if (!user || user.local) return { status: 409, error: 'Сервис работает без входа.' };
  const stored = getPasswordHash(user.email, db);
  if (!stored || !verifyPassword(currentPassword, stored)) {
    return { status: 401, error: 'Текущий пароль неверен.' };
  }
  if (String(newPassword ?? '').length < 8) {
    return { status: 422, error: 'Новый пароль должен быть не короче 8 символов.' };
  }
  updateUser(user.id, { passwordHash: hashPassword(newPassword) }, db);
  return { status: 200, user: getUser(user.id, db) };
}

/** Создание пользователя владельцем. */
export function createUser({ email, password, name = '', role = 'viewer' }, { db = getDb() } = {}) {
  const normalised = String(email ?? '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalised)) {
    return { status: 422, error: 'Укажите корректный email.' };
  }
  if (String(password ?? '').length < 8) {
    return { status: 422, error: 'Пароль должен быть не короче 8 символов.' };
  }
  if (getUserByEmail(normalised, db)) return { status: 409, error: 'Пользователь с таким email уже есть.' };
  const user = insertUser({ email: normalised, name, passwordHash: hashPassword(password), role }, db);
  return { status: 201, user };
}

/** Удаление пользователя: его сессии и аккаунты уходят каскадом. */
export function removeUser(id, { db = getDb() } = {}) {
  deleteUserSessions(id, db);
  return db.prepare('DELETE FROM users WHERE id = ?').run(Number(id)).changes > 0;
}

/**
 * Матрица возможностей (#7).
 *
 * `viewer` — наблюдатель: видит свои данные, но ничего не меняет. Разделение
 * именно по изменениям, а не по чтению: иначе «наблюдатель» либо видел бы чужие
 * данные, либо не видел ничего.
 */
export const CAPABILITIES = Object.freeze({
  owner: Object.freeze(['account:write', 'account:delete', 'account:sync', 'user:manage', 'self:password']),
  viewer: Object.freeze(['self:password']),
});

export function can(user, capability) {
  if (!user) return false;
  if (user.local) return true; // Локальный режим: один человек, ограничивать нечего.
  return (CAPABILITIES[user.role] ?? []).includes(capability);
}

/** Для маршрутов: отказ должен быть 403 и внятным, а не молчаливым no-op. */
export function denyReason(capability) {
  return capability === 'user:manage'
    ? 'Управление пользователями доступно только владельцу.'
    : 'Наблюдатель не может менять данные: доступ только на чтение.';
}

export { ROLES } from '../db/users.mjs';
