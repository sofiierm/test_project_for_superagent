// Хранение токенов официальных API (#8).
//
// Наружу токен не отдаётся никогда: `getToken` возвращает расшифрованное
// значение только внутреннему коду, а в интерфейс уходит маска.
import { getDb } from './index.mjs';
import { nowIso } from '../lib/dates.mjs';
import { config } from '../config.mjs';
import { decryptSecret, deriveKey, encryptSecret, maskSecret } from '../lib/secrets.mjs';

function key() {
  if (!config.tokenSecret) {
    throw new Error(
      'Для хранения токенов платформ нужен TOKEN_SECRET (или SESSION_SECRET). '
      + 'Без него токены нельзя зашифровать.',
    );
  }
  return deriveKey(config.tokenSecret);
}

function mapToken(row) {
  if (!row) return null;
  return {
    id: row.id,
    accountId: row.account_id,
    platform: row.platform,
    expiresAt: row.expires_at ?? null,
    scope: row.scope ?? '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // Только маска: полный токен наружу не уходит.
    hint: maskSecret(row.access_token ? 'x'.repeat(Math.max(8, row.access_token.length - 4)) : ''),
  };
}

/**
 * Сохранение токена. Повторная запись для того же аккаунта обновляет запись:
 * уникальность по `account_id` не даёт накопить дубли.
 */
export function saveToken({
  accountId, platform, accessToken, refreshToken = '', expiresAt = null, scope = '',
}, db = getDb()) {
  if (!accessToken) throw new Error('Нельзя сохранить пустой токен.');
  const encryptionKey = key();
  const now = nowIso();
  const encrypted = encryptSecret(accessToken, encryptionKey);
  const encryptedRefresh = refreshToken ? encryptSecret(refreshToken, encryptionKey) : '';

  db.prepare(`
    INSERT INTO platform_tokens (account_id, platform, access_token, refresh_token, expires_at, scope, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(account_id) DO UPDATE SET
      platform = excluded.platform,
      access_token = excluded.access_token,
      refresh_token = excluded.refresh_token,
      expires_at = excluded.expires_at,
      scope = excluded.scope,
      updated_at = excluded.updated_at
  `).run(Number(accountId), platform, encrypted, encryptedRefresh, expiresAt, String(scope ?? ''), now, now);

  return getTokenMeta(accountId, db);
}

/** Метаданные без секрета: то, что можно показать в интерфейсе. */
export function getTokenMeta(accountId, db = getDb()) {
  const row = db.prepare('SELECT * FROM platform_tokens WHERE account_id = ?').get(Number(accountId));
  if (!row) return null;
  const meta = mapToken(row);
  // Маска строится из расшифрованного значения, чтобы показать реальный хвост.
  const decrypted = decryptSecret(row.access_token, key());
  meta.hint = maskSecret(decrypted ?? '');
  return meta;
}

/**
 * Расшифрованный токен для запроса к API.
 *
 * Возвращает `null`, если токена нет или он повреждён: вызывающий код должен
 * решить, что делать, а не получить исключение из недр хранилища.
 */
export function getToken(accountId, db = getDb()) {
  const row = db.prepare('SELECT * FROM platform_tokens WHERE account_id = ?').get(Number(accountId));
  if (!row) return null;
  const encryptionKey = key();
  const accessToken = decryptSecret(row.access_token, encryptionKey);
  if (!accessToken) return null;
  return {
    platform: row.platform,
    accessToken,
    refreshToken: row.refresh_token ? decryptSecret(row.refresh_token, encryptionKey) ?? '' : '',
    expiresAt: row.expires_at ?? null,
    scope: row.scope ?? '',
  };
}

/** Истёк ли токен. Без `expires_at` считаем бессрочным (ключ API). */
export function isExpired(accountId, { now = new Date() } = {}, db = getDb()) {
  const row = db.prepare('SELECT expires_at FROM platform_tokens WHERE account_id = ?').get(Number(accountId));
  if (!row?.expires_at) return false;
  return new Date(row.expires_at).getTime() <= new Date(now).getTime();
}

export function deleteToken(accountId, db = getDb()) {
  return db.prepare('DELETE FROM platform_tokens WHERE account_id = ?').run(Number(accountId)).changes > 0;
}

export function listTokens(db = getDb()) {
  return db.prepare('SELECT * FROM platform_tokens ORDER BY created_at DESC').all().map(mapToken);
}
