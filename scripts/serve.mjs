#!/usr/bin/env node
// Запуск сервиса: node scripts/serve.mjs
import { start } from '../src/server.mjs';

const { server, provider, stopScheduler } = await start();
const { config } = await import('../src/config.mjs');
const address = server.address();
const host = address.address === '::' || address.address === '0.0.0.0' ? '127.0.0.1' : address.address;
process.stdout.write(`Creator Analytics: http://${host}:${address.port}/\n`);
process.stdout.write(`Источник данных: ${provider.name} (${provider.reason})\n`);

const shutdown = (signal) => {
  process.stdout.write(`\n${signal}: останавливаю сервер\n`);
  stopScheduler?.();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
void config;
