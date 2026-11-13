// Конфигурация сервиса. Все значения читаются из переменных окружения,
// чтобы сервис можно было запускать локально, в CI и на хостинге без правок кода.
import fs from 'node:fs';
import path from 'node:path';

// Читаем .env, если он есть: README и .env.example обещают, что скопированный
// файл подхватится сам. Формат простой (KEY=VALUE, # — комментарий), поэтому
// обходимся без зависимости. Уже заданные переменные окружения не перетираем:
// приоритет у того, что передали в командной строке.
function loadDotEnv() {
  const file = path.resolve('.env');
  if (!fs.existsSync(file)) return;
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return;
  }
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv();

function bool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(value);
}

function int(value, fallback) {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}

const dataDir = path.resolve(process.env.DATA_DIR || 'data');
const dbPath = process.env.DB_PATH || path.join(dataDir, 'app.db');

export const config = {
  port: int(process.env.PORT, 4180),
  host: process.env.HOST || '127.0.0.1',
  dataDir,
  dbPath,
  // Часовой пояс, в котором считаются «лучшие часы публикаций» и подписи дат.
  timeZone: process.env.APP_TIME_ZONE || 'Europe/Moscow',
  seedDemo: bool(process.env.SEED_DEMO, true),
  // Сколько последних видео забирать у источника за одну синхронизацию.
  syncLimit: Math.max(1, int(process.env.SYNC_LIMIT, 24)),
  // Провайдер данных: auto | demo | ytdlp. auto выбирает yt-dlp, если он доступен.
  provider: process.env.PROVIDER || 'auto',
  ytDlpPath: process.env.YTDLP_PATH || 'yt-dlp',
  // Жёсткий предел ожидания ответа источника, мс.
  providerTimeoutMs: int(process.env.PROVIDER_TIMEOUT_MS, 60_000),
  // Разрешать произвольные адреса при добавлении аккаунта.
  allowArbitraryAccounts: bool(process.env.ALLOW_ANY_ACCOUNT, true),
  // Фоновая синхронизация. Включена по умолчанию: без неё цифры стареют,
  // пока пользователь не нажмёт кнопку. Отключается SYNC_SCHEDULER=false.
  syncScheduler: bool(process.env.SYNC_SCHEDULER, true),
  // Базовый интервал между синхронизациями одного аккаунта, минуты.
  syncIntervalMinutes: Math.max(15, int(process.env.SYNC_INTERVAL_MINUTES, 180)),
  // Как часто планировщик проверяет, кому пора синхронизироваться, мс.
  syncTickMs: Math.max(1000, int(process.env.SYNC_TICK_MS, 60_000)),
  // База экспоненциальной паузы после ошибки источника, минуты.
  syncBackoffMinutes: Math.max(1, int(process.env.SYNC_BACKOFF_MINUTES, 15)),
  syncBackoffMaxMinutes: Math.max(15, int(process.env.SYNC_BACKOFF_MAX_MINUTES, 12 * 60)),
  // ---- Доступ (#7) ----
  // AUTH_REQUIRED=false — локальный запуск одного человека: вход не нужен, все
  // действия принадлежат владельцу. Для общего доступа включается true, и тогда
  // без сессии видна только страница входа.
  authRequired: bool(process.env.AUTH_REQUIRED, false),
  // Секрет подписи cookie сессии. В локальном режиме не нужен; в режиме с
  // входом обязателен — иначе сессии подделываются. Проверяется при старте.
  sessionSecret: process.env.SESSION_SECRET || '',
  // Secure-флаг cookie: включать за HTTPS, иначе браузер не сохранит cookie
  // на http://localhost и вход будет «молча» не работать.
  cookieSecure: bool(process.env.COOKIE_SECURE, false),
  // ---- Семантический анализ (#11) ----
  // none | local | remote. По умолчанию none: словарный анализ работает офлайн
  // и ничего не отправляет наружу. local склеивает словоформы без сети,
  // remote отправляет тексты роликов во внешний сервис — это осознанный выбор.
  embeddingProvider: process.env.EMBEDDING_PROVIDER || 'none',
  embeddingEndpoint: process.env.EMBEDDING_ENDPOINT || '',
  embeddingTimeoutMs: Math.max(1000, int(process.env.EMBEDDING_TIMEOUT_MS, 15_000)),
  appName: 'Creator Analytics',
};

/**
 * Проверка конфигурации доступа (#7).
 *
 * Без секрета подпись cookie — фикция: подделать сессию смог бы любой. Молча
 * поднимать сервис в таком виде нельзя, поэтому отказываемся стартовать.
 * В локальном режиме секрет не нужен: сессии там не используются.
 */
export function assertAuthConfig(cfg = config) {
  if (!cfg.authRequired) return;
  if (!cfg.sessionSecret || cfg.sessionSecret.length < 16) {
    throw new Error(
      'AUTH_REQUIRED=true требует SESSION_SECRET длиной не менее 16 символов. '
      + 'Сгенерируйте его: node -e "console.log(require(\'node:crypto\').randomBytes(32).toString(\'base64url\'))"',
    );
  }
}

export default config;
