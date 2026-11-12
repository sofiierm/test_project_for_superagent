// Обработчик заявок. Работает одинаково как serverless-функция (Vercel/Netlify/
// Cloudflare adapter) и в локальном scripts/serve.mjs, поэтому клиентская и
// серверная валидация проверяются на одном коде.
import fs from 'node:fs';
import { validateLead, parseBody, CONTACT_METHODS } from '../src/js/lead-validation.mjs';

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 5;
const hits = new Map();

function rateLimit(ip) {
  const now = Date.now();
  const entries = (hits.get(ip) || []).filter((time) => now - time < WINDOW_MS);
  if (entries.length >= MAX_PER_WINDOW) {
    hits.set(ip, entries);
    return false;
  }
  entries.push(now);
  hits.set(ip, entries);
  return true;
}

/** Уведомление ответственному: вебхук CRM/Telegram/e-mail из переменных окружения. */
async function notify(lead, env) {
  const url = env.LEAD_WEBHOOK_URL;
  if (!url) return { delivered: false, reason: 'LEAD_WEBHOOK_URL не задан' };
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(env.LEAD_WEBHOOK_TOKEN ? { Authorization: `Bearer ${env.LEAD_WEBHOOK_TOKEN}` } : {}),
      },
      body: JSON.stringify({ source: 'landing', receivedAt: new Date().toISOString(), lead }),
    });
    return { delivered: response.ok, reason: response.ok ? '' : `HTTP ${response.status}` };
  } catch (error) {
    return { delivered: false, reason: String(error?.message || error) };
  }
}

/** Резервная запись заявки, если основной канал не сработал (ТЗ, п. 10.1). */
function backup(entry, env) {
  const line = JSON.stringify(entry);
  if (env.LEAD_BACKUP_FILE) {
    try {
      fs.appendFileSync(env.LEAD_BACKUP_FILE, line + '\n', 'utf8');
      return;
    } catch (error) {
      console.warn('[lead] резервная запись не удалась:', String(error?.message || error));
    }
  }
  console.warn('[lead] не доставлено, резервная копия в логе:', line);
}

export async function handleLead(rawBody, contentType, { env = process.env, ip = '127.0.0.1' } = {}) {
  if (!rateLimit(ip)) {
    return { status: 429, body: { ok: false, message: 'Слишком много заявок. Попробуйте через минуту.' }, remaining: 0 };
  }

  const parsed = parseBody(rawBody, contentType);
  const result = validateLead(parsed);
  if (!result.ok) {
    return {
      status: 422,
      body: { ok: false, errors: result.errors, message: 'Проверьте поля заявки.' },
    };
  }

  // Согласие фиксируется вместе с заявкой: дата, версия документа, страница.
  const entry = {
    ...result.values,
    consentAt: new Date().toISOString(),
    page: String(parsed.page || '').slice(0, 200),
    userAgent: '',
  };

  const delivery = await notify(entry, env);
  if (!delivery.delivered) {
    // Резервное сохранение: в файл, если он задан, иначе в лог процесса —
    // хостинг заказчика определит постоянное хранилище (ТЗ, п. 10.1).
    backup(entry, env);
  }

  return {
    status: 200,
    body: {
      ok: true,
      message: 'Заявка отправлена, мы свяжемся с вами в течение 15 минут в рабочее время.',
      delivered: delivery.delivered,
    },
  };
}

export { CONTACT_METHODS };
