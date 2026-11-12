// HTTP-сервер: страницы, JSON API и выгрузка CSV.
//
// Без фреймворка: маршрутов немного, а лишняя зависимость здесь ничего не
// даёт. Статика отдаётся из public/ с явным белым списком типов.
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.mjs';
import { getDb } from './db/index.mjs';
import { deleteAccount, getAccount, listAccounts } from './db/accounts.mjs';
import { listVideos } from './db/videos.mjs';
import { listRuns } from './db/runs.mjs';
import { addAccount, resolveProvider, syncAccount } from './providers/index.mjs';
import { needsSeed, seedDemoData } from './services/seed.mjs';
import {
  accountData, dashboardData, overviewStats, prepareVideos, videoData, videosToCsv,
} from './services/analytics.mjs';
import { htmlToString } from './ui/html.mjs';
import {
  accountPage, accountsPage, dashboardPage, helpPage, notFoundPage, videoPage, videosPage,
} from './ui/pages.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const MAX_BODY = 32 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendHtml(res, status, template) {
  const body = htmlToString(template);
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    // Строгая CSP: разметка серверная, инлайновых скриптов нет, стили — только
    // из файла, но chart-компоненты используют атрибут style, поэтому
    // style-src допускает unsafe-inline. Скрипты остаются строгими.
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  res.end(body);
}

async function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext];
  if (!type) return false;
  try {
    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) return false;
    const cache = ext === '.woff2'
      ? 'public, max-age=31536000, immutable'
      : 'public, max-age=300';
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': stat.size,
      'Cache-Control': cache,
      'X-Content-Type-Options': 'nosniff',
    });
    fs.createReadStream(filePath).pipe(res);
    return true;
  } catch {
    return false;
  }
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) {
      const error = new Error('Слишком большой запрос.');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('Некорректный JSON в теле запроса.');
    error.status = 400;
    throw error;
  }
}

function notFound(res, mode) {
  return sendHtml(res, 404, notFoundPage({ mode, providerReason: '' }));
}

/**
 * Фабрика сервера. Отдельная функция нужна тестам: они поднимают сервер на
 * случайном порту и на изолированной базе.
 */
export function createServer({ mode = 'demo', providerReason = '' } = {}) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const route = url.pathname.replace(/\/+$/, '') || '/';

    try {
      // ---- Статика ----
      if (route.startsWith('/styles/') || route.startsWith('/js/') || route.startsWith('/fonts/')
          || route === '/favicon.svg') {
        const rel = path.normalize(route).replace(/^(\.\.[/\\])+/, '');
        const filePath = path.join(PUBLIC_DIR, rel);
        if (!filePath.startsWith(PUBLIC_DIR)) return sendJson(res, 403, { error: 'forbidden' });
        if (await sendFile(res, filePath)) return;
        return sendJson(res, 404, { error: 'not_found' });
      }

      // ---- JSON API ----
      if (route === '/api/accounts' && req.method === 'GET') {
        return sendJson(res, 200, { accounts: listAccounts() });
      }
      if (route === '/api/accounts' && req.method === 'POST') {
        const body = await readJsonBody(req);
        try {
          const result = await addAccount(body.account ?? '', {
            platformHint: body.platform,
            notes: body.notes ?? '',
          });
          return sendJson(res, 201, {
            account: result.account,
            provider: result.provider,
            videosFound: result.videosFound,
            warning: result.warning,
          });
        } catch (error) {
          if (error.code === 'duplicate') {
            return sendJson(res, 409, { error: error.message, accountId: error.accountId });
          }
          if (error.name === 'AccountParseError' || error.code === 'provider_error' || error.hint !== undefined) {
            return sendJson(res, 422, { error: error.message, hint: error.hint ?? '', code: error.code });
          }
          throw error;
        }
      }

      const accountSync = route.match(/^\/api\/accounts\/(\d+)\/sync$/);
      if (accountSync && req.method === 'POST') {
        const id = Number(accountSync[1]);
        if (!getAccount(id)) return sendJson(res, 404, { error: 'Аккаунт не найден.' });
        try {
          const result = await syncAccount(id);
          return sendJson(res, 200, {
            account: result.account,
            status: result.status,
            videosFound: result.videosFound,
            videosNew: result.videosNew,
            warning: result.warning ?? '',
            error: result.error ?? '',
          });
        } catch (error) {
          return sendJson(res, 422, { error: error.message, hint: error.hint ?? '' });
        }
      }

      const accountDelete = route.match(/^\/api\/accounts\/(\d+)$/);
      if (accountDelete && req.method === 'DELETE') {
        const id = Number(accountDelete[1]);
        if (!getAccount(id)) return sendJson(res, 404, { error: 'Аккаунт не найден.' });
        deleteAccount(id);
        return sendJson(res, 200, { ok: true });
      }

      const accountVideos = route.match(/^\/api\/accounts\/(\d+)\/videos$/);
      if (accountVideos && req.method === 'GET') {
        const id = Number(accountVideos[1]);
        if (!getAccount(id)) return sendJson(res, 404, { error: 'Аккаунт не найден.' });
        return sendJson(res, 200, { videos: prepareVideos(listVideos({ accountId: id, limit: 500 })) });
      }

      const accountCsv = route.match(/^\/api\/accounts\/(\d+)\/videos\.csv$/);
      if (accountCsv && req.method === 'GET') {
        const id = Number(accountCsv[1]);
        const account = getAccount(id);
        if (!account) return sendJson(res, 404, { error: 'Аккаунт не найден.' });
        const csv = videosToCsv(prepareVideos(listVideos({ accountId: id, limit: 1000 })));
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${account.platform}-${account.handle}.csv"`,
          'Cache-Control': 'no-store',
        });
        return res.end(csv);
      }

      if (route === '/api/videos' && req.method === 'GET') {
        const platform = url.searchParams.get('platform');
        const accountId = url.searchParams.get('account');
        return sendJson(res, 200, {
          videos: prepareVideos(listVideos({
            platform: platform || null,
            accountId: accountId ? Number(accountId) : null,
            limit: 500,
          })),
        });
      }

      if (route === '/api/videos.csv' && req.method === 'GET') {
        const platform = url.searchParams.get('platform');
        const csv = videosToCsv(prepareVideos(listVideos({ platform: platform || null, limit: 5000 })));
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="creator-analytics-videos.csv"',
          'Cache-Control': 'no-store',
        });
        return res.end(csv);
      }

      if (route === '/api/overview' && req.method === 'GET') {
        const data = dashboardData();
        return sendJson(res, 200, {
          summary: data.summary,
          byPlatform: data.byPlatform,
          insights: data.insights,
          series: data.series,
          topics: data.topics,
        });
      }

      if (route === '/api/health' && req.method === 'GET') {
        return sendJson(res, 200, { ok: true, mode, provider: providerReason, stats: overviewStats() });
      }

      if (route === '/api/runs' && req.method === 'GET') {
        return sendJson(res, 200, { runs: listRuns({ limit: 50 }) });
      }

      // ---- Страницы ----
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return sendJson(res, 405, { error: 'method_not_allowed' });
      }

      if (route === '/') {
        return sendHtml(res, 200, dashboardPage(dashboardData(), { mode, providerReason }));
      }
      if (route === '/accounts') {
        return sendHtml(res, 200, accountsPage(listAccounts(), { mode, providerReason }));
      }
      if (route === '/videos') {
        const platform = url.searchParams.get('platform');
        const videos = prepareVideos(listVideos({ platform: platform || null, limit: 500 }));
        return sendHtml(res, 200, videosPage(videos, { mode, providerReason, platform }));
      }
      if (route === '/help') {
        const provider = await resolveProvider();
        return sendHtml(res, 200, helpPage({
          mode, providerReason, provider, overview: overviewStats(),
        }));
      }

      const accountMatch = route.match(/^\/accounts\/(\d+)$/);
      if (accountMatch) {
        const data = accountData(Number(accountMatch[1]));
        if (!data) return notFound(res, mode);
        return sendHtml(res, 200, accountPage(data, { mode, providerReason }));
      }

      const videoMatch = route.match(/^\/videos\/(\d+)$/);
      if (videoMatch) {
        const data = videoData(Number(videoMatch[1]));
        if (!data) return notFound(res, mode);
        return sendHtml(res, 200, videoPage(data, { mode, providerReason }));
      }

      return notFound(res, mode);
    } catch (error) {
      const status = error.status ?? 500;
      if (status >= 500) {
        process.stderr.write(`[error] ${req.method} ${req.url}: ${error.stack || error.message}\n`);
      }
      if (res.headersSent) return res.end();
      if (req.url?.startsWith('/api/')) {
        return sendJson(res, status, { error: status >= 500 ? 'Внутренняя ошибка сервера.' : error.message });
      }
      return sendJson(res, status, { error: status >= 500 ? 'Внутренняя ошибка сервера.' : error.message });
    }
  });
  return server;
}

export async function start() {
  getDb();
  if (config.seedDemo && needsSeed()) seedDemoData();
  const provider = await resolveProvider();
  const server = createServer({ mode: provider.name === 'demo' ? 'demo' : 'live', providerReason: provider.reason });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, resolve);
  });
  return { server, provider };
}
