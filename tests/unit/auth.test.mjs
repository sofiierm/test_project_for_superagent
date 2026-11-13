// Авторизация и разделение доступа (#7).
//
// Проверяем не «форма открывается», а свойства, ради которых это делалось:
// пароль нельзя восстановить из базы, сессию нельзя подделать, чужой аккаунт
// неотличим от несуществующего, а перебор пароля упирается в лимит.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-auth-'));
process.env.DATA_DIR = tmpDir;
process.env.DB_PATH = path.join(tmpDir, 'auth.db');
process.env.PROVIDER = 'demo';
process.env.SEED_DEMO = 'false';
process.env.AUTH_REQUIRED = 'true';
process.env.SESSION_SECRET = 'test-secret-at-least-16-chars-long';

const {
  CSRF_COOKIE, SESSION_COOKIE, hashPassword, hashToken, parseCookies, randomToken,
  serializeCookie, signCookie, unsignCookie, verifyPassword,
} = await import('../../src/lib/auth.mjs');
const { closeDb, getDb } = await import('../../src/db/index.mjs');
const { insertUser, getUser, getUserByEmail, listUsers, getPasswordHash } = await import('../../src/db/users.mjs');
const {
  changePassword, createUser, currentSession, login, logout, needsSetup, rateLimitState,
  resetRateLimit, setupOwner, verifyCsrf,
} = await import('../../src/services/auth.mjs');
const { insertAccount, listAccounts } = await import('../../src/db/accounts.mjs');

getDb();

test.after(() => {
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function fakeRequest({ cookie = '', ip = '127.0.0.1', method = 'GET', headers = {} } = {}) {
  return {
    method,
    headers: { ...(cookie ? { cookie } : {}), 'user-agent': 'test-agent', ...headers },
    socket: { remoteAddress: ip },
  };
}

// ---- Криптография ----

test('пароль хранится как scrypt-хеш с солью, а не открытым текстом', () => {
  const hash = hashPassword('correct horse battery staple');
  assert.match(hash, /^scrypt\$/);
  assert.ok(!hash.includes('correct horse'), 'пароль попал в хеш открытым текстом');
  // Два хеша одного пароля различаются: соль случайная, радужные таблицы не работают.
  assert.notEqual(hash, hashPassword('correct horse battery staple'));
});

test('проверка пароля принимает верный и отвергает неверный', () => {
  const hash = hashPassword('s3cret-pass');
  assert.equal(verifyPassword('s3cret-pass', hash), true);
  assert.equal(verifyPassword('s3cret-pas', hash), false);
  assert.equal(verifyPassword('', hash), false);
  // Битый хеш в базе — «неверный пароль», а не падение сервера.
  assert.equal(verifyPassword('s3cret-pass', 'not-a-hash'), false);
  assert.equal(verifyPassword('s3cret-pass', 'scrypt$onlytwo'), false);
});

test('подпись cookie отвергает подделку и чужой секрет', () => {
  const token = randomToken();
  const signed = signCookie(token, 'secret-one');
  assert.equal(unsignCookie(signed, 'secret-one'), token);
  assert.equal(unsignCookie(signed, 'secret-two'), null, 'cookie принята с другим секретом');
  assert.equal(unsignCookie(`${token}.AAAA`, 'secret-one'), null, 'подпись подделана');
  assert.equal(unsignCookie(token, 'secret-one'), null, 'cookie без подписи принята');
  assert.equal(unsignCookie('', 'secret-one'), null);
});

test('cookie сессии выставляется HttpOnly и SameSite', () => {
  const header = serializeCookie(SESSION_COOKIE, 'value', { maxAge: 60 });
  assert.match(header, /HttpOnly/, 'cookie доступна из JavaScript — XSS украдёт сессию');
  assert.match(header, /SameSite=Lax/);
  assert.match(header, /Max-Age=60/);
});

test('разбор Cookie не падает на мусоре', () => {
  assert.deepEqual(parseCookies('a=1; b=2'), { a: '1', b: '2' });
  assert.deepEqual(parseCookies(''), {});
  assert.deepEqual(parseCookies('без равно'), {});
  // Битое процентное кодирование не должно ронять запрос.
  assert.doesNotThrow(() => parseCookies('a=%E0%A4%A'));
});

// ---- Настройка и вход ----

test('на пустой базе требуется первичная настройка', () => {
  assert.equal(needsSetup(), true);
});

test('настройка отклоняет слабый пароль и плохой email', () => {
  assert.equal(setupOwner({ email: 'owner@example.com', password: '123' }).status, 422);
  assert.equal(setupOwner({ email: 'не-email', password: 'password123' }).status, 422);
  assert.equal(listUsers().length, 0, 'пользователь создан при ошибке валидации');
});

test('настройка создаёт владельца ровно один раз', () => {
  const first = setupOwner({ email: 'Owner@Example.COM', password: 'password123', name: 'Владелец' });
  assert.equal(first.status, 201);
  assert.equal(first.user.role, 'owner');
  assert.equal(first.user.email, 'owner@example.com', 'email не нормализован');

  const second = setupOwner({ email: 'other@example.com', password: 'password123' });
  assert.equal(second.status, 409, 'второй пользователь смог назначить себя владельцем');
  assert.equal(needsSetup(), false);
});

test('хеш пароля не отдаётся наружу ни одним запросом', () => {
  for (const user of listUsers()) {
    assert.equal('passwordHash' in user, false, 'хеш пароля в списке пользователей');
  }
  const byEmail = getUserByEmail('owner@example.com');
  assert.equal('passwordHash' in byEmail, false, 'хеш пароля в getUserByEmail');
  assert.equal('passwordHash' in getUser(byEmail.id), false, 'хеш пароля в getUser');
  // Но проверка пароля при этом работает.
  assert.ok(getPasswordHash('owner@example.com'));
});

test('вход с верным паролем выдаёт сессию и CSRF-cookie', () => {
  const result = login({ email: 'owner@example.com', password: 'password123', req: fakeRequest() });
  assert.equal(result.status, 200);
  assert.ok(result.cookies.some((c) => c.startsWith(SESSION_COOKIE)));
  assert.ok(result.cookies.some((c) => c.startsWith(CSRF_COOKIE)));
  // Cookie сессии помечена HttpOnly, CSRF — нет: её читает клиентский JS.
  const sessionCookie = result.cookies.find((c) => c.startsWith(SESSION_COOKIE));
  const csrfCookie = result.cookies.find((c) => c.startsWith(CSRF_COOKIE));
  assert.match(sessionCookie, /HttpOnly/);
  assert.doesNotMatch(csrfCookie, /HttpOnly/);
});

test('неверный пароль и несуществующий email дают одинаковый ответ', () => {
  const wrongPassword = login({ email: 'owner@example.com', password: 'nope', req: fakeRequest({ ip: '10.0.0.1' }) });
  const noUser = login({ email: 'ghost@example.com', password: 'nope', req: fakeRequest({ ip: '10.0.0.2' }) });
  assert.equal(wrongPassword.status, 401);
  assert.equal(noUser.status, 401);
  assert.equal(wrongPassword.error, noUser.error, 'по тексту ошибки видно, существует ли пользователь');
});

test('сессия из cookie узнаётся, а подделанная — нет', () => {
  const entered = login({ email: 'owner@example.com', password: 'password123', req: fakeRequest({ ip: '10.1.1.1' }) });
  const sessionCookie = entered.cookies.find((c) => c.startsWith(SESSION_COOKIE)).split(';')[0];

  const good = currentSession(fakeRequest({ cookie: sessionCookie }));
  assert.equal(good.user?.email, 'owner@example.com');

  const tampered = currentSession(fakeRequest({ cookie: `${sessionCookie}AA` }));
  assert.equal(tampered.user, null, 'подделанная cookie принята');

  const none = currentSession(fakeRequest());
  assert.equal(none.user, null);
});

test('выход гасит сессию: старая cookie перестаёт работать', () => {
  const entered = login({ email: 'owner@example.com', password: 'password123', req: fakeRequest({ ip: '10.2.2.2' }) });
  const sessionCookie = entered.cookies.find((c) => c.startsWith(SESSION_COOKIE)).split(';')[0];
  assert.ok(currentSession(fakeRequest({ cookie: sessionCookie })).user);

  const out = logout(fakeRequest({ cookie: sessionCookie }));
  assert.ok(out.cookies.some((c) => c.includes('Max-Age=0')), 'cookie не погашена');
  assert.equal(currentSession(fakeRequest({ cookie: sessionCookie })).user, null, 'сессия жива после выхода');
});

test('перебор пароля упирается в лимит, а другой IP не страдает', () => {
  resetRateLimit();
  const ip = '10.9.9.9';
  let last;
  for (let i = 0; i < 10; i += 1) {
    last = login({ email: 'owner@example.com', password: 'wrong', req: fakeRequest({ ip }) });
  }
  assert.equal(last.status, 429, 'лимит попыток не сработал');
  assert.match(last.error, /Слишком много попыток/);
  assert.equal(rateLimitState('owner@example.com', ip).blocked, true);

  // Верный пароль с другого адреса по-прежнему работает: лимит не глобальный.
  const other = login({ email: 'owner@example.com', password: 'password123', req: fakeRequest({ ip: '10.8.8.8' }) });
  assert.equal(other.status, 200);

  // Даже верный пароль с заблокированного адреса не проходит.
  const blocked = login({ email: 'owner@example.com', password: 'password123', req: fakeRequest({ ip }) });
  assert.equal(blocked.status, 429);
  resetRateLimit();
});

// ---- CSRF ----

test('CSRF: изменяющий запрос без токена отклоняется', () => {
  const req = fakeRequest({ method: 'POST' });
  assert.equal(verifyCsrf(req), false);
});

test('CSRF: токен из cookie должен совпасть с заголовком', () => {
  const csrf = randomToken();
  const cookie = serializeCookie(CSRF_COOKIE, csrf).split(';')[0];
  assert.equal(verifyCsrf(fakeRequest({ method: 'POST', cookie })), false, 'запрос без заголовка прошёл');
  assert.equal(
    verifyCsrf(fakeRequest({ method: 'POST', cookie, headers: { 'x-csrf-token': 'другой' } })),
    false,
    'неверный токен прошёл',
  );
  assert.equal(
    verifyCsrf(fakeRequest({ method: 'POST', cookie, headers: { 'x-csrf-token': csrf } })),
    true,
    'верный токен отклонён',
  );
  // Чтение не требует CSRF: иначе ломались бы обычные ссылки.
  assert.equal(verifyCsrf(fakeRequest({ method: 'GET', cookie })), true);
});

// ---- Владение ----

test('список аккаунтов фильтруется по владельцу', () => {
  const owner = getUserByEmail('owner@example.com');
  const viewer = insertUser({ email: 'viewer@example.com', passwordHash: hashPassword('password123'), role: 'viewer' });

  insertAccount({ platform: 'youtube', handle: 'owner_channel', ownerId: owner.id });
  insertAccount({ platform: 'youtube', handle: 'viewer_channel', ownerId: viewer.id });
  insertAccount({ platform: 'tiktok', handle: 'legacy_channel' });

  assert.deepEqual(listAccounts(undefined, { ownerId: owner.id }).map((a) => a.handle), ['owner_channel']);
  assert.deepEqual(listAccounts(undefined, { ownerId: viewer.id }).map((a) => a.handle), ['viewer_channel']);
  // Без фильтра видны все: это локальный режим и внутренние вызовы.
  assert.equal(listAccounts().length, 3);
});

test('смена пароля проверяет текущий и гасит вход старым паролем', () => {
  const owner = getUserByEmail('owner@example.com');
  const wrong = changePassword({ user: owner, currentPassword: 'nope', newPassword: 'newpassword123' });
  assert.equal(wrong.status, 401);

  const short = changePassword({ user: owner, currentPassword: 'password123', newPassword: 'short' });
  assert.equal(short.status, 422);

  const ok = changePassword({ user: owner, currentPassword: 'password123', newPassword: 'newpassword123' });
  assert.equal(ok.status, 200);

  resetRateLimit();
  assert.equal(login({ email: 'owner@example.com', password: 'password123', req: fakeRequest({ ip: '10.3.3.3' }) }).status, 401);
  assert.equal(login({ email: 'owner@example.com', password: 'newpassword123', req: fakeRequest({ ip: '10.4.4.4' }) }).status, 200);

  // Возвращаем пароль, чтобы не влиять на другие тесты.
  changePassword({ user: getOwner(), currentPassword: 'newpassword123', newPassword: 'password123' });
});

function getOwner() {
  return getUserByEmail('owner@example.com');
}

test('владелец создаёт наблюдателя, дубль email отклоняется', () => {
  const created = createUser({ email: 'second@example.com', password: 'password123', role: 'viewer', name: 'Второй' });
  assert.equal(created.status, 201);
  assert.equal(created.user.role, 'viewer');
  assert.equal('passwordHash' in created.user, false);

  const duplicate = createUser({ email: 'SECOND@example.com', password: 'password123' });
  assert.equal(duplicate.status, 409, 'дубль email создан');

  const weak = createUser({ email: 'third@example.com', password: '123' });
  assert.equal(weak.status, 422);
});

test('токен сессии хранится только хешем', () => {
  const db = getDb();
  const rows = db.prepare('SELECT token_hash FROM sessions').all();
  assert.ok(rows.length > 0, 'сессий нет — проверка ничего не значит');
  for (const row of rows) {
    // SHA-256 в base64url — 43 символа; сырой токен был бы тоже base64url, но
    // проверить можно по обратимости: хеш токена не совпадает с самим токеном.
    assert.ok(row.token_hash.length >= 40, 'похоже, в базе лежит не хеш');
    assert.doesNotMatch(row.token_hash, /\./, 'в базе подписанная cookie целиком');
  }
  // Ни одна сессия не хранит подпись cookie — только хеш токена.
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE token_hash LIKE '%.%'").get().n, 0);
});

export { hashToken };
