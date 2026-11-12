#!/usr/bin/env node
// Полный сброс демо-данных: удаляет базу и создаёт её заново.
// Полезно, когда хочется посмотреть сервис «с чистого листа».
import fs from 'node:fs';
import { config } from '../src/config.mjs';

if (!config.dbPath.startsWith(config.dataDir)) {
  process.stderr.write(`Отказ: база ${config.dbPath} вне каталога данных ${config.dataDir}\n`);
  process.exit(1);
}

for (const suffix of ['', '-wal', '-shm']) {
  const file = config.dbPath + suffix;
  if (fs.existsSync(file)) fs.rmSync(file);
}

const { getDb } = await import('../src/db/index.mjs');
const { seedDemoData } = await import('../src/services/seed.mjs');
getDb();
const created = seedDemoData();
process.stdout.write(`База пересоздана: ${config.dbPath}\n`);
process.stdout.write(`Демо-аккаунты: ${created.map((h) => `@${h}`).join(', ') || 'не созданы (PROVIDER не demo)'}\n`);
