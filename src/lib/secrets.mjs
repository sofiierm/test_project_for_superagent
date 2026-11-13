// Шифрование секретов при хранении (#8).
//
// Токены доступа к API платформ дают доступ к чужим аккаунтам, поэтому в базе
// они лежат зашифрованными: утечка файла базы не отдаёт рабочие токены.
//
// AES-256-GCM, а не просто HMAC: нужно уметь расшифровать обратно, чтобы
// сделать запрос к API. GCM даёт и шифрование, и проверку целостности: если
// кто-то поменяет байты в базе, расшифровка не вернёт мусор, а упадёт.
import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // Рекомендуемая длина для GCM.
const PREFIX = 'v1';

/**
 * Ключ шифрования из секрета приложения.
 *
 * Отдельная соль и HKDF, а не просто sha256(secret): один и тот же секрет
 * используется и для подписи cookie, и здесь — разные производные ключи не
 * дают компрометации одного механизма ослабить другой.
 */
export function deriveKey(secret, salt = 'creator-analytics/provider-tokens') {
  return Buffer.from(crypto.hkdfSync('sha256', String(secret), salt, 'aes-256-gcm', 32));
}

/**
 * Шифрование строки.
 *
 * Формат: `v1.<iv>.<tag>.<ciphertext>` в base64url. Версия в префиксе нужна,
 * чтобы можно было сменить схему, не гадая, чем зашифрована конкретная запись.
 */
export function encryptSecret(value, key) {
  if (typeof value !== 'string' || !value) {
    throw new Error('Шифровать можно только непустую строку.');
  }
  if (!key || key.length !== 32) throw new Error('Ключ шифрования должен быть 32 байта.');
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

/**
 * Расшифровка. Возвращает `null` при любой проблеме, а не бросает.
 *
 * Повреждённая запись — это «токена нет», а не падение страницы: пользователь
 * должен увидеть «подключите заново», а не 500.
 */
export function decryptSecret(payload, key) {
  if (typeof payload !== 'string' || !key || key.length !== 32) return null;
  const parts = payload.split('.');
  if (parts.length !== 4 || parts[0] !== PREFIX) return null;
  try {
    const iv = Buffer.from(parts[1], 'base64url');
    const tag = Buffer.from(parts[2], 'base64url');
    const ciphertext = Buffer.from(parts[3], 'base64url');
    if (iv.length !== IV_BYTES || tag.length !== 16) return null;
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** Маска для показа токена в интерфейсе: последние 4 символа. */
export function maskSecret(value) {
  const text = String(value ?? '');
  if (!text) return '';
  if (text.length <= 4) return '••••';
  return `••••${text.slice(-4)}`;
}
