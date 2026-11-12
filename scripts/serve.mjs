#!/usr/bin/env node
// Мини-сервер для локальной проверки собранного сайта и для тестов.
// Отдаёт dist/ и принимает POST /api/lead (тот же обработчик, что и в
// serverless-функции api/lead.mjs) — так форма проверяется end-to-end.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { handleLead } from '../api/lead.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'dist');
const PORT = Number(process.env.PORT || 4173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

function send(res, status, body, type = 'text/plain; charset=utf-8', extra = {}) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...extra });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/api/lead') {
    if (req.method !== 'POST') {
      send(res, 405, JSON.stringify({ ok: false, message: 'Метод не поддерживается.' }), 'application/json');
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const result = await handleLead(Buffer.concat(chunks).toString('utf8'), req.headers['content-type'] || '');
    send(res, result.status, JSON.stringify(result.body), 'application/json; charset=utf-8', {
      'X-RateLimit-Remaining': String(result.remaining ?? ''),
    });
    return;
  }

  let pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith('/')) pathname += 'index.html';
  let file = path.join(DIST, pathname);

  if (!file.startsWith(DIST)) {
    send(res, 403, 'Forbidden');
    return;
  }

  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    const notFound = path.join(DIST, '404.html');
    if (fs.existsSync(notFound)) {
      send(res, 404, fs.readFileSync(notFound), 'text/html; charset=utf-8');
    } else {
      send(res, 404, 'Not found');
    }
    return;
  }

  const ext = path.extname(file).toLowerCase();
  send(res, 200, fs.readFileSync(file), MIME[ext] || 'application/octet-stream');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Сайт собран: http://127.0.0.1:${PORT}/`);
});
