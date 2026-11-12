// Тесты расписания синхронизации: поддельные часы, без сна и без сети.
//
// Проверяем три вещи, ради которых планировщик написан:
//  • интервалы соблюдаются, джиттер остаётся в границах;
//  • ошибки источника дают растущую паузу, а не шторм повторов;
//  • наложение запусков не создаёт дублей и не ломает статус аккаунта.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Переменные окружения — до первого импорта из src/: config.mjs читает их
// один раз при загрузке, и поздно выставленный DATA_DIR увёл бы тесты в
// рабочую базу.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-scheduler-'));
process.env.DATA_DIR = tmpDir;
process.env.DB_PATH = path.join(tmpDir, 'scheduler.db');
process.env.PROVIDER = 'demo';
process.env.SEED_DEMO = 'true';
process.env.SYNC_SCHEDULER = 'false';

const {
  backoffMinutes, delayReason, intervalFor, isDue, jitterFactor, nextRunAfterFailure,
  nextRunAfterSuccess, MIN_INTERVAL_MINUTES,
} = await import('../../src/lib/schedule.mjs');

const MINUTE = 60_000;
const NOW = new Date('2026-05-20T12:00:00Z');

test('джиттер держится в заданных границах и не выходит за них даже при мусорном random', () => {
  assert.equal(jitterFactor(() => 0.5, 0.2), 1);
  assert.ok(Math.abs(jitterFactor(() => 0, 0.2) - 0.8) < 1e-9);
  assert.ok(Math.abs(jitterFactor(() => 1, 0.2) - 1.2) < 1e-9);
  // random вернул мусор — не роняем расчёт, берём середину.
  assert.equal(jitterFactor(() => Number.NaN, 0.2), 1);
  assert.equal(jitterFactor(() => 0, 0), 1);
});

test('следующий запуск после успеха — интервал вперёд, не меньше минимума', () => {
  const next = nextRunAfterSuccess({ now: NOW, intervalMinutes: 180, random: () => 0.5 });
  assert.equal(next, '2026-05-20T15:00:00.000Z');

  // Слишком маленький интервал поднимается до минимума: чаще, чем раз в
  // 15 минут, платформу дёргать бессмысленно и вредно.
  const tooOften = nextRunAfterSuccess({ now: NOW, intervalMinutes: 1, random: () => 0.5 });
  assert.equal(tooOften, new Date(NOW.getTime() + MIN_INTERVAL_MINUTES * MINUTE).toISOString());
});

test('джиттер разводит одновременные запуски разных аккаунтов', () => {
  const a = nextRunAfterSuccess({ now: NOW, intervalMinutes: 60, random: () => 0.05 });
  const b = nextRunAfterSuccess({ now: NOW, intervalMinutes: 60, random: () => 0.95 });
  assert.notEqual(a, b);
  const spread = Math.abs(new Date(a) - new Date(b));
  assert.ok(spread > 10 * MINUTE, `разброс ${spread} мс слишком мал`);
  // И оба всё равно остаются около часа, а не улетают в соседние сутки.
  for (const iso of [a, b]) {
    const minutes = (new Date(iso) - NOW) / MINUTE;
    assert.ok(minutes >= 48 && minutes <= 72, `интервал ${minutes} мин вне ожиданий`);
  }
});

test('пауза после ошибки растёт экспоненциально и упирается в потолок', () => {
  assert.equal(backoffMinutes({ attempts: 1, baseMinutes: 15 }), 15);
  assert.equal(backoffMinutes({ attempts: 2, baseMinutes: 15 }), 30);
  assert.equal(backoffMinutes({ attempts: 3, baseMinutes: 15 }), 60);
  assert.equal(backoffMinutes({ attempts: 4, baseMinutes: 15 }), 120);
  assert.equal(backoffMinutes({ attempts: 20, baseMinutes: 15, maxMinutes: 720 }), 720);
});

test('bot_check и rate_limited ждут дольше обычной ошибки', () => {
  const usual = backoffMinutes({ attempts: 1, baseMinutes: 15, errorCode: 'timeout' });
  const bot = backoffMinutes({ attempts: 1, baseMinutes: 15, errorCode: 'bot_check' });
  const rate = backoffMinutes({ attempts: 1, baseMinutes: 15, errorCode: 'rate_limited' });
  assert.equal(usual, 15);
  assert.equal(bot, 60);
  assert.equal(rate, 60);
  // Потолок важнее множителя: пауза не превращается в год.
  assert.equal(backoffMinutes({ attempts: 5, baseMinutes: 15, errorCode: 'bot_check', maxMinutes: 120 }), 120);
});

test('следующий запуск после ошибки считается от «сейчас», а не от прошлого успеха', () => {
  const next = nextRunAfterFailure({ now: NOW, attempts: 2, baseMinutes: 15, errorCode: 'rate_limited' });
  assert.equal(next, new Date(NOW.getTime() + 120 * MINUTE).toISOString());
});

test('due-аккаунт: пустое расписание считается должным, будущее — нет', () => {
  assert.equal(isDue({ nextSyncAt: null }, NOW), true);
  assert.equal(isDue({ nextSyncAt: new Date(NOW.getTime() - 1).toISOString() }, NOW), true);
  assert.equal(isDue({ nextSyncAt: NOW.toISOString() }, NOW), true);
  assert.equal(isDue({ nextSyncAt: new Date(NOW.getTime() + MINUTE).toISOString() }, NOW), false);
  assert.equal(isDue(null, NOW), false);
});

test('зависший статус running не блокирует аккаунт навсегда', () => {
  // После падения процесса в базе остаётся running, а замка в памяти уже нет.
  // Если считать такой аккаунт занятым, он не синхронизируется никогда.
  assert.equal(isDue({ syncStatus: 'running', nextSyncAt: null }, NOW), true);
});

test('интервал берётся из аккаунта, иначе из конфигурации', () => {
  assert.equal(intervalFor({ syncIntervalMinutes: 45 }, 180), 45);
  assert.equal(intervalFor({ syncIntervalMinutes: null }, 180), 180);
  assert.equal(intervalFor({ syncIntervalMinutes: 0 }, 180), 180);
  assert.equal(intervalFor({ syncIntervalMinutes: 1 }, 180), MIN_INTERVAL_MINUTES);
});

test('причина задержки объясняется человеку, а не кодом ошибки', () => {
  assert.match(delayReason('bot_check'), /подтверждения/);
  assert.match(delayReason('rate_limited'), /частоту/);
  assert.match(delayReason('timeout'), /не ответил/);
  assert.match(delayReason('ytdlp_missing'), /не установлен/);
  assert.equal(delayReason(''), '');
});

// ---- Интеграция с базой: планировщик не создаёт дублей и уважает замок ----

const { getDb, closeDb } = await import('../../src/db/index.mjs');
const { listAccounts, setSyncState } = await import('../../src/db/accounts.mjs');
const { listVideos } = await import('../../src/db/videos.mjs');
const { runDueSyncs } = await import('../../src/services/scheduler.mjs');
const { syncAccount } = await import('../../src/providers/index.mjs');
const { seedDemoData } = await import('../../src/services/seed.mjs');
const lock = await import('../../src/lib/sync-lock.mjs');
const resetInFlight = lock.resetInFlight;

getDb();
seedDemoData();

test.after(() => {
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// Все три демо-аккаунта получают расписание при наполнении. Опустошаем его
// в начале каждого интеграционного теста: иначе порядок тестов решает, кому
// «пора», и проверки становятся хрупкими.
function planAllFor(iso) {
  for (const account of listAccounts()) {
    setSyncState(account.id, { status: 'success', nextSyncAt: iso });
  }
}

test('планировщик синхронизирует только тех, кому пора', async () => {
  resetInFlight();
  const future = new Date(Date.now() + 3600_000).toISOString();
  planAllFor(future);
  const accounts = listAccounts();
  const [first, second] = accounts;
  setSyncState(second.id, { status: 'success', nextSyncAt: new Date(Date.now() - 1000).toISOString() });

  const report = await runDueSyncs({ now: new Date() });
  assert.equal(report.checked, accounts.length);
  assert.equal(report.due, 1, 'должен быть один должный аккаунт');
  assert.deepEqual(report.results.map((r) => r.id), [second.id]);
  assert.equal(report.synced, 1);

  // После успешной синхронизации расписание сдвинулось в будущее.
  const updated = listAccounts().find((a) => a.id === second.id);
  assert.ok(new Date(updated.nextSyncAt) > new Date(), 'next_sync_at не сдвинулся вперёд');
  assert.equal(updated.syncAttempts, 0);
  // Аккаунт с будущим расписанием не тронут.
  assert.equal(listAccounts().find((a) => a.id === first.id).nextSyncAt, future);
});

test('повторный тик не синхронизирует аккаунт дважды подряд', async () => {
  resetInFlight();
  planAllFor(new Date(Date.now() + 3600_000).toISOString());
  const account = listAccounts()[0];
  setSyncState(account.id, { status: 'success', nextSyncAt: new Date(Date.now() - 1000).toISOString() });

  const first = await runDueSyncs({ now: new Date() });
  assert.deepEqual(first.results.map((r) => r.id), [account.id]);

  const second = await runDueSyncs({ now: new Date() });
  assert.equal(second.due, 0, 'аккаунт синхронизирован повторно до срока');
});

test('занятый аккаунт пропускается, а не считается ошибкой', async () => {
  resetInFlight();
  planAllFor(new Date(Date.now() + 3600_000).toISOString());
  const account = listAccounts()[0];
  setSyncState(account.id, { status: 'success', nextSyncAt: new Date(Date.now() - 1000).toISOString() });
  lock.markInFlight(account.id);
  try {
    const report = await runDueSyncs({ now: new Date() });
    assert.ok(report.skipped.some((s) => s.id === account.id && s.reason === 'in_flight'));
    assert.equal(report.due, 0);
    assert.equal(report.failed, 0, 'занятый аккаунт не должен попадать в ошибки');
  } finally {
    lock.clearInFlight(account.id);
  }
});

test('второй одновременный запуск ручной синхронизации возвращает busy', async () => {
  resetInFlight();
  const account = listAccounts()[0];
  lock.markInFlight(account.id);
  try {
    const result = await syncAccount(account.id);
    assert.equal(result.status, 'busy');
    assert.match(result.error, /уже идёт/);
  } finally {
    lock.clearInFlight(account.id);
  }
});

test('падение одного аккаунта не мешает синхронизировать остальные', async () => {
  resetInFlight();
  planAllFor(new Date(Date.now() - 1000).toISOString());
  const accounts = listAccounts();
  const messages = [];
  const report = await runDueSyncs({
    now: new Date(),
    accounts,
    sync: async (id) => {
      messages.push(id);
      if (id === accounts[0].id) throw new Error('источник недоступен');
      return { status: 'success', videosNew: 1, account: listAccounts().find((a) => a.id === id) };
    },
  });
  assert.equal(report.checked, accounts.length);
  assert.equal(report.failed, 1);
  assert.equal(messages.length, accounts.length, 'после ошибки цикл остановился');
  const failed = report.results.find((r) => r.status === 'failed');
  assert.equal(failed.id, accounts[0].id);
  assert.match(failed.error, /недоступен/);
});

test('ошибка источника оставляет аккаунт в статусе error с текстом причины', async () => {
  resetInFlight();
  planAllFor(new Date(Date.now() + 3600_000).toISOString());
  const account = listAccounts()[0];
  setSyncState(account.id, { status: 'success', nextSyncAt: new Date(Date.now() - 1000).toISOString() });

  const report = await runDueSyncs({
    now: new Date(),
    accounts: [listAccounts().find((a) => a.id === account.id)],
    sync: async () => ({
      status: 'error',
      error: 'Платформа ограничила частоту запросов.',
      errorCode: 'rate_limited',
      account: null,
    }),
  });
  assert.equal(report.failed, 1);
  const updated = listAccounts().find((a) => a.id === account.id);
  assert.equal(updated.syncStatus, 'error');
  assert.match(updated.syncError, /ограничила частоту/);
});

test('синхронизация не создаёт дубликатов роликов', async () => {
  resetInFlight();
  planAllFor(new Date(Date.now() + 3600_000).toISOString());
  const account = listAccounts()[1];
  const before = listVideos({ accountId: account.id, limit: 1000 }).length;
  await syncAccount(account.id);
  const after = listVideos({ accountId: account.id, limit: 1000 }).length;
  assert.equal(after, before, 'повторная синхронизация добавила ролики');
});
