// Шифрование секретов и хранение токенов платформ (#8).
//
// Проверяем именно обещание приватности: в базе нет открытого токена, чужой
// ключ его не расшифрует, а повреждённая запись не роняет приложение.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-tokens-'));
process.env.DATA_DIR = tmpDir;
process.env.DB_PATH = path.join(tmpDir, 'tokens.db');
process.env.TOKEN_SECRET = 'test-secret-at-least-16-chars';
process.env.PROVIDER = 'demo';
process.env.SEED_DEMO = 'false';

const { decryptSecret, deriveKey, encryptSecret, maskSecret } = await import('../../src/lib/secrets.mjs');
const { closeDb, getDb } = await import('../../src/db/index.mjs');
const { insertAccount } = await import('../../src/db/accounts.mjs');
const {
  deleteToken, getToken, getTokenMeta, isExpired, listTokens, saveToken,
} = await import('../../src/db/tokens.mjs');

getDb();

test.after(() => {
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---- Криптография ----

test('токен шифруется и расшифровывается обратно', () => {
  const key = deriveKey('secret-one');
  const encrypted = encryptSecret('ya29.secret-token', key);
  assert.notEqual(encrypted, 'ya29.secret-token');
  assert.equal(decryptSecret(encrypted, key), 'ya29.secret-token');
});

test('шифрование недетерминировано: одинаковый вход даёт разный шифртекст', () => {
  const key = deriveKey('secret-one');
  const a = encryptSecret('same-token', key);
  const b = encryptSecret('same-token', key);
  assert.notEqual(a, b, 'одинаковый шифртекст выдаёт повторное использование IV');
  // Но расшифровываются оба.
  assert.equal(decryptSecret(a, key), 'same-token');
  assert.equal(decryptSecret(b, key), 'same-token');
});

test('чужим ключом токен не расшифровать', () => {
  const encrypted = encryptSecret('token', deriveKey('secret-one'));
  assert.equal(decryptSecret(encrypted, deriveKey('secret-two')), null);
});

test('подмена байтов в шифртексте обнаруживается', () => {
  const key = deriveKey('secret-one');
  const encrypted = encryptSecret('token-value', key);
  const parts = encrypted.split('.');
  // Портим последний байт шифртекста: GCM обязан это заметить.
  const tampered = [...parts];
  const raw = Buffer.from(tampered[3], 'base64url');
  raw[raw.length - 1] ^= 0xff;
  tampered[3] = raw.toString('base64url');
  assert.equal(decryptSecret(tampered.join('.'), key), null);
});

test('мусор вместо шифртекста возвращает null, а не исключение', () => {
  const key = deriveKey('secret-one');
  for (const value of ['', 'garbage', 'v1.a.b', 'v2.a.b.c', 'v1..,.,.', null, undefined, 42]) {
    assert.equal(decryptSecret(value, key), null, `значение ${value} не отклонено`);
  }
});

test('маска показывает только хвост токена', () => {
  assert.equal(maskSecret('ya29.abcdefgh'), '••••efgh');
  assert.equal(maskSecret('ab'), '••••');
  assert.equal(maskSecret(''), '');
  // Главное: начало токена не утекает.
  assert.ok(!maskSecret('ya29.very-secret-value').includes('ya29'));
});

// ---- Хранилище ----

let accountId;

test('токен сохраняется зашифрованным и не читается из базы напрямую', () => {
  const account = insertAccount({ platform: 'youtube', handle: 'token_channel' });
  accountId = account.id;
  saveToken({ accountId: account.id, platform: 'youtube', accessToken: 'ya29.super-secret' });

  const raw = getDb().prepare('SELECT * FROM platform_tokens WHERE account_id = ?').get(account.id);
  assert.ok(raw, 'токен не сохранён');
  const dump = JSON.stringify(raw);
  assert.ok(!dump.includes('ya29.super-secret'), 'токен лежит в базе открытым текстом');
  assert.match(raw.access_token, /^v1\./, 'токен не зашифрован');

  // Внутренний код получает расшифрованное значение.
  assert.equal(getToken(account.id)?.accessToken, 'ya29.super-secret');
});

test('наружу отдаётся маска, а не токен', () => {
  const meta = getTokenMeta(accountId);
  assert.ok(meta);
  assert.equal('accessToken' in meta, false, 'метаданные содержат сам токен');
  assert.match(meta.hint, /^••••/);
  assert.ok(!JSON.stringify(meta).includes('super-secret'));
});

test('повторное сохранение обновляет токен, а не создаёт дубль', () => {
  saveToken({ accountId, platform: 'youtube', accessToken: 'ya29.updated' });
  assert.equal(listTokens().length, 1);
  assert.equal(getToken(accountId)?.accessToken, 'ya29.updated');
});

test('refresh-токен тоже шифруется', () => {
  saveToken({
    accountId, platform: 'youtube', accessToken: 'access', refreshToken: 'refresh-secret-1',
  });
  const raw = getDb().prepare('SELECT refresh_token FROM platform_tokens WHERE account_id = ?').get(accountId);
  assert.ok(!raw.refresh_token.includes('refresh-secret-1'));
  assert.equal(getToken(accountId)?.refreshToken, 'refresh-secret-1');
});

test('срок действия токена определяется корректно', () => {
  saveToken({ accountId, platform: 'youtube', accessToken: 'a', expiresAt: '2020-01-01T00:00:00Z' });
  assert.equal(isExpired(accountId), true);

  saveToken({ accountId, platform: 'youtube', accessToken: 'a', expiresAt: '2099-01-01T00:00:00Z' });
  assert.equal(isExpired(accountId), false);

  // Ключ API без срока — бессрочный.
  saveToken({ accountId, platform: 'youtube', accessToken: 'a', expiresAt: null });
  assert.equal(isExpired(accountId), false);
});

test('отсутствующий токен — это null, а не ошибка', () => {
  const other = insertAccount({ platform: 'tiktok', handle: 'no_token_channel' });
  assert.equal(getToken(other.id), null);
  assert.equal(getTokenMeta(other.id), null);
});

test('удаление токена работает и идемпотентно', () => {
  assert.equal(deleteToken(accountId), true);
  assert.equal(getToken(accountId), null);
  assert.equal(deleteToken(accountId), false);
});
