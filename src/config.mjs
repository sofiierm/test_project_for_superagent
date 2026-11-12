// Конфигурация сервиса. Все значения читаются из переменных окружения,
// чтобы сервис можно было запускать локально, в CI и на хостинге без правок кода.
import path from 'node:path';

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
  appName: 'Creator Analytics',
};

export default config;
