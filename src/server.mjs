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
import {
  deleteAccount, getAccount, isPlatform, listAccounts, platforms,
} from './db/accounts.mjs';
import { listVideos } from './db/videos.mjs';
import { listRuns } from './db/runs.mjs';
import { addAccount, resolveProvider, syncAccount } from './providers/index.mjs';
import {
  authRequired, can, changePassword, createUser, csrfToken, currentSession, denyReason,
  issueCsrf, login, logout, needsSetup, removeUser, setupOwner, verifyCsrf,
} from './services/auth.mjs';
import { listUsers } from './db/users.mjs';
import { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE, serializeCookie, randomToken } from './lib/auth.mjs';
import { config as appConfig } from './config.mjs';
import { isSyncInFlight } from './lib/sync-lock.mjs';
import { startScheduler } from './services/scheduler.mjs';
import { needsSeed, seedDemoData } from './services/seed.mjs';
import {
  accountData, comparisonData, dashboardData, overviewStats, parseAccountIds, prepareVideos,
  videoData, videosToCsv,
} from './services/analytics.mjs';
import { htmlToString } from './ui/html.mjs';
import {
  accessPage, accountPage, accountsPage, comparePage, dashboardPage, helpPage, loginPage,
  notFoundPage, videoPage, videosPage,
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

function sendHtml(res, status, template, extraHeaders = {}) {
  const body = htmlToString(template);
  res.writeHead(status, {
    ...extraHeaders,
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

/**
 * Тело обычной HTML-формы (`application/x-www-form-urlencoded`).
 *
 * Вход и настройка отправляются формой, а не fetch: так они работают без
 * JavaScript, и пароль не проходит через клиентский код.
 */
async function readFormBody(req) {
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
  const params = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
  const out = {};
  for (const [key, value] of params) out[key] = value;
  return out;
}

function redirect(res, location, cookies = []) {
  const headers = { Location: location, 'Cache-Control': 'no-store' };
  if (cookies.length) headers['Set-Cookie'] = cookies;
  res.writeHead(303, headers);
  res.end();
}

function notFound(res, mode) {
  return sendHtml(res, 404, notFoundPage({ mode, providerReason: '' }));
}

/**
 * Фабрика сервера. Отдельная функция нужна тестам: они поднимают сервер на
 * случайном порту и на изолированной базе.
 */
/**
 * Разбор фильтров `/api/videos` и `/api/videos.csv`.
 *
 * Раньше нечисловой `account` превращался в `NaN`, фильтр молча исчезал, и
 * клиент получал ролики всех аккаунтов — правдоподобный, но чужой ответ.
 * Теперь мусорный параметр — 422, а неизвестный id — 404: существование
 * чужих аккаунтов не подтверждаем (пригодится для #7).
 */
function parseVideoFilter(url, owned = (id) => getAccount(id)) {
  const platform = url.searchParams.get('platform');
  const rawAccount = url.searchParams.get('account');
  const value = { platform: null, accountId: null };

  if (platform) {
    if (!isPlatform(platform)) {
      return {
        error: {
          status: 422,
          body: { error: `Неизвестная платформа «${platform}».`, hint: `Доступны: ${platforms.join(', ')}.` },
        },
      };
    }
    value.platform = platform.toLowerCase();
  }

  if (rawAccount) {
    const id = Number(rawAccount);
    if (!Number.isInteger(id) || id <= 0) {
      return {
        error: {
          status: 422,
          body: { error: `«account» должен быть числовым id, получено «${rawAccount}».` },
        },
      };
    }
    // Чужой аккаунт тоже «не найден»: иначе фильтр подтверждал бы его
    // существование (#7).
    if (!owned(id)) {
      return { error: { status: 404, body: { error: 'Аккаунт не найден.' } } };
    }
    value.accountId = id;
  }

  return { value, error: null };
}

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

      // ---- Доступ (#7) ----
      // Вход, настройка и статика выше: они должны быть доступны без сессии.
      const session = currentSession(req);

      if (route === '/login' || route === '/setup') {
        if (!authRequired()) return redirect(res, '/');
        if (route === '/setup' && !needsSetup()) return redirect(res, '/login');
        // Уже вошедшему форма входа не нужна.
        if (session.user) return redirect(res, '/');

        if (req.method === 'GET') {
          // Cookie выдаётся здесь же: без неё скрытое поле формы было бы пустым
          // и вход без JavaScript не работал бы.
          const csrf = issueCsrf(req);
          return sendHtml(res, 200, loginPage({
            mode, providerReason, needsSetup: route === '/setup', csrf: csrf.token,
            error: url.searchParams.get('error') === 'rate' ? 'Слишком много попыток входа. Попробуйте позже.' : '',
          }), csrf.cookie ? { 'Set-Cookie': csrf.cookie } : {});
        }
        if (req.method === 'POST') {
          const body = await readFormBody(req);
          // Вход тоже защищён CSRF: иначе чужой сайт мог бы подставить свою
          // учётную запись и человек продолжил бы работу под ней.
          if (!verifyCsrf(req, body._csrf ?? '')) {
            return sendHtml(res, 403, loginPage({
              mode, providerReason, needsSetup: route === '/setup', csrf: csrfToken(req),
              error: 'Форма устарела: обновите страницу и попробуйте снова.',
            }));
          }

          if (route === '/setup') {
            const result = setupOwner({ email: body.email, password: body.password, name: body.name });
            if (result.status !== 201) {
              return sendHtml(res, result.status, loginPage({
                mode, providerReason, needsSetup: true, error: result.error, email: body.email ?? '',
                csrf: csrfToken(req),
              }));
            }
            // Сразу входим созданным владельцем: заставлять вводить пароль,
            // который только что придумали, — лишний шаг.
            const entered = login({ email: body.email, password: body.password, req });
            return redirect(res, '/', entered.cookies ?? []);
          }

          const result = login({ email: body.email, password: body.password, req });
          if (result.status !== 200) {
            const status = result.status === 429 ? 429 : 401;
            return sendHtml(res, status, loginPage({
              mode, providerReason, error: result.error, email: body.email ?? '', csrf: csrfToken(req),
            }));
          }
          return redirect(res, '/', result.cookies);
        }
        return sendJson(res, 405, { error: 'method_not_allowed' });
      }

      if (route === '/logout' && req.method === 'POST') {
        // CSRF-проверка ниже сработала бы и здесь, но выход без токена не
        // опасен, поэтому разрешаем его и по обычной форме.
        const result = logout(req);
        return redirect(res, authRequired() ? '/login' : '/', result.cookies);
      }

      // Без входа показываем только форму: иначе любой, кто дотянулся до
      // порта, видит все аккаунты (#7).
      if (authRequired() && !session.user) {
        if (needsSetup()) return redirect(res, '/setup');
        if (req.url.startsWith('/api/')) {
          return sendJson(res, 401, { error: 'Требуется вход в сервис.' });
        }
        return redirect(res, '/login');
      }

      // CSRF для всех изменяющих запросов: токен из cookie должен совпасть с
      // присланным. HTML-форма не умеет ставить заголовки, поэтому её тело
      // читаем заранее и берём токен из скрытого поля.
      const isFormPost = req.method === 'POST'
        && String(req.headers['content-type'] ?? '').includes('application/x-www-form-urlencoded');
      const formBody = isFormPost ? await readFormBody(req) : null;
      if (!verifyCsrf(req, formBody?._csrf ?? '')) {
        return sendJson(res, 403, { error: 'CSRF-токен отсутствует или неверен. Обновите страницу.' });
      }

      // Владелец, в чьих данных работаем. `undefined` — локальный режим, где
      // разделения нет и видны все аккаунты; число — только его аккаунты.
      const ownerScope = session.local ? undefined : session.user.id;
      const scopedAccounts = () => listAccounts(undefined, { ownerId: ownerScope });
      // Чужой аккаунт должен выглядеть несуществующим: 403 подтвердил бы, что
      // он есть (#7). Поэтому проверяем принадлежность и отдаём 404.
      const ownedAccount = (id) => {
        const account = getAccount(id);
        if (!account) return null;
        if (ownerScope === undefined) return account;
        return account.ownerId === ownerScope ? account : null;
      };
      // Общий контекст шапки: кто вошёл и какие пункты меню ему доступны.
      // Наблюдателю «Доступ» не показываем — он всё равно получит 403.
      const nav = authRequired() && can(session.user, 'user:manage')
        ? [{ href: '/access', label: 'Доступ', key: 'access' }]
        : [];
      const view = {
        mode,
        providerReason,
        user: authRequired() ? session.user : null,
        nav,
        // Токен для скрытых полей форм: HTML-форма не может поставить заголовок.
        csrf: authRequired() ? csrfToken(req) : '',
      };

      // Наблюдатель только читает (#7). Отказ — 403 с объяснением, а не
      // молчаливое «ничего не произошло»: пользователь должен понять причину.
      // Возвращает `true`, если запрос отклонён: `sendJson` отдаёт undefined,
      // поэтому проверять его результат напрямую нельзя — отказ прошёл бы молча.
      const requireCapability = (capability) => {
        if (can(session.user, capability)) return false;
        sendJson(res, 403, { error: denyReason(capability) });
        return true;
      };

      // ---- Управление доступом (#7) ----
      if (route === '/access' || route.startsWith('/access/')) {
        if (!can(session.user, 'user:manage')) {
          return sendHtml(res, 403, notFoundPage({ mode, providerReason }));
        }
        if (route === '/access' && req.method === 'GET') {
          return sendHtml(res, 200, accessPage({
            users: listUsers(),
            currentUser: session.user,
            created: url.searchParams.get('created') ?? '',
            error: url.searchParams.get('error') ?? '',
          }, view));
        }
        if (route === '/access' && req.method === 'POST') {
          const body = formBody ?? await readFormBody(req);
          const result = createUser({ email: body.email, password: body.password, name: body.name, role: body.role });
          if (result.status !== 201) {
            return sendHtml(res, result.status, accessPage({
              users: listUsers(), currentUser: session.user, error: result.error,
            }, view));
          }
          return redirect(res, `/access?created=${encodeURIComponent(result.user.email)}`);
        }
        if (route === '/access/password' && req.method === 'POST') {
          const body = formBody ?? await readFormBody(req);
          const result = changePassword({
            user: session.user, currentPassword: body.currentPassword, newPassword: body.newPassword,
          });
          if (result.status !== 200) {
            return sendHtml(res, result.status, accessPage({
              users: listUsers(), currentUser: session.user, error: result.error,
            }, view));
          }
          return redirect(res, '/access');
        }
        const userDelete = route.match(/^\/access\/(\d+)\/delete$/);
        if (userDelete && req.method === 'POST') {
          const targetId = Number(userDelete[1]);
          // Себя удалить нельзя: иначе единственный владелец закрыл бы себе вход.
          if (targetId === session.user.id) {
            return redirect(res, '/access?error=Нельзя удалить собственную учётную запись.');
          }
          removeUser(targetId);
          return redirect(res, '/access');
        }
        return notFound(res, mode);
      }

      // ---- JSON API ----
      if (route === '/api/accounts' && req.method === 'GET') {
        return sendJson(res, 200, { accounts: scopedAccounts() });
      }
      if (route === '/api/accounts' && req.method === 'POST') {
        if (requireCapability('account:write')) return;
        const body = await readJsonBody(req);
        try {
          const result = await addAccount(body.account ?? '', {
            platformHint: body.platform,
            notes: body.notes ?? '',
            ownerId: ownerScope ?? null,
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
        if (requireCapability('account:sync')) return;
        const id = Number(accountSync[1]);
        if (!ownedAccount(id)) return sendJson(res, 404, { error: 'Аккаунт не найден.' });
        // Второй параллельный запуск не начинаем: отвечаем 409 и говорим,
        // что синхронизация уже идёт. 202 здесь соврал бы о результате.
        if (isSyncInFlight(id)) {
          return sendJson(res, 409, {
            error: 'Синхронизация этого аккаунта уже идёт.',
            status: 'busy',
            retryAfter: 5,
          });
        }
        try {
          const result = await syncAccount(id);
          return sendJson(res, 200, {
            account: result.account,
            status: result.status,
            videosFound: result.videosFound,
            videosNew: result.videosNew,
            warning: result.warning ?? '',
            error: result.error ?? '',
            nextSyncAt: result.account?.nextSyncAt ?? null,
          });
        } catch (error) {
          return sendJson(res, 422, { error: error.message, hint: error.hint ?? '' });
        }
      }

      const accountDelete = route.match(/^\/api\/accounts\/(\d+)$/);
      if (accountDelete && req.method === 'DELETE') {
        if (requireCapability('account:delete')) return;
        const id = Number(accountDelete[1]);
        if (!ownedAccount(id)) return sendJson(res, 404, { error: 'Аккаунт не найден.' });
        deleteAccount(id);
        return sendJson(res, 200, { ok: true });
      }

      const accountVideos = route.match(/^\/api\/accounts\/(\d+)\/videos$/);
      if (accountVideos && req.method === 'GET') {
        const id = Number(accountVideos[1]);
        if (!ownedAccount(id)) return sendJson(res, 404, { error: 'Аккаунт не найден.' });
        return sendJson(res, 200, { videos: prepareVideos(listVideos({ accountId: id, limit: 500 })) });
      }

      const accountCsv = route.match(/^\/api\/accounts\/(\d+)\/videos\.csv$/);
      if (accountCsv && req.method === 'GET') {
        const id = Number(accountCsv[1]);
        const account = ownedAccount(id);
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
        const filter = parseVideoFilter(url, ownedAccount);
        if (filter.error) return sendJson(res, filter.error.status, filter.error.body);
        return sendJson(res, 200, {
          videos: prepareVideos(listVideos({ ...filter.value, limit: 500, ownerId: ownerScope })),
        });
      }

      if (route === '/api/videos.csv' && req.method === 'GET') {
        const filter = parseVideoFilter(url, ownedAccount);
        if (filter.error) return sendJson(res, filter.error.status, filter.error.body);
        const csv = videosToCsv(prepareVideos(listVideos({ ...filter.value, limit: 5000, ownerId: ownerScope })));
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="creator-analytics-videos.csv"',
          'Cache-Control': 'no-store',
        });
        return res.end(csv);
      }

      if (route === '/api/overview' && req.method === 'GET') {
        const data = await dashboardData({ ownerId: ownerScope });
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
        return sendHtml(res, 200, dashboardPage(await dashboardData({ ownerId: ownerScope }), view));
      }
      if (route === '/accounts') {
        return sendHtml(res, 200, accountsPage(scopedAccounts(), view));
      }
      if (route === '/compare') {
        const ids = parseAccountIds(url.searchParams.get('accounts'));
        const data = comparisonData({
          ids,
          from: url.searchParams.get('from') ?? '',
          to: url.searchParams.get('to') ?? '',
          ownerId: ownerScope,
        });
        if (data.error) {
          return sendHtml(res, 422, comparePage(data, view));
        }
        return sendHtml(res, 200, comparePage(data, view));
      }
      if (route === '/videos') {
        const platform = url.searchParams.get('platform');
        const videos = prepareVideos(listVideos({ platform: platform || null, limit: 500, ownerId: ownerScope }));
        return sendHtml(res, 200, videosPage(videos, { ...view, platform }));
      }
      if (route === '/help') {
        const provider = await resolveProvider();
        return sendHtml(res, 200, helpPage({ ...view, provider, overview: overviewStats() }));
      }

      const accountMatch = route.match(/^\/accounts\/(\d+)$/);
      if (accountMatch) {
        // Проверка владения до построения страницы: чужой аккаунт должен
        // отвечать 404, а не отдавать данные с кодом 200.
        if (!ownedAccount(Number(accountMatch[1]))) return notFound(res, mode);
        const data = await accountData(Number(accountMatch[1]));
        if (!data) return notFound(res, mode);
        return sendHtml(res, 200, accountPage(data, view));
      }

      const videoMatch = route.match(/^\/videos\/(\d+)$/);
      if (videoMatch) {
        const data = videoData(Number(videoMatch[1]));
        if (!data) return notFound(res, mode);
        // Ролик чужого аккаунта не должен открываться по прямому id (#7).
        if (!ownedAccount(data.video.accountId)) return notFound(res, mode);
        return sendHtml(res, 200, videoPage(data, view));
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
  // Фоновую синхронизацию выключаем вместе с сервером: иначе таймер держит
  // процесс живым, и `npm start` не завершается по SIGTERM.
  const stopScheduler = config.syncScheduler ? startScheduler() : () => {};
  server.once('close', stopScheduler);
  return { server, provider, stopScheduler };
}
