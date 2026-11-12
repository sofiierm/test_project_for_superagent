#!/usr/bin/env node
// Демо-наполнение вручную: npm run demo:seed
// Создаёт три демо-аккаунта, если их ещё нет.
import { getDb } from '../src/db/index.mjs';
import { DEMO_HANDLES, seedDemoData } from '../src/services/seed.mjs';

getDb();
const created = seedDemoData();
if (created.length) {
  process.stdout.write(`Добавлены демо-аккаунты: ${created.map((h) => `@${h}`).join(', ')}\n`);
} else {
  process.stdout.write('Демо-аккаунты уже есть, ничего не менял.\n');
}
void DEMO_HANDLES;
