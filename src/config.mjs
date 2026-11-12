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
  appName: 'Creator Analytics',
};

export default config;
