// Фоновый планировщик синхронизации.
//
// Зачем: раньше метрики обновлялись только по кнопке, поэтому цифры в
// интерфейсе старели, пока пользователь не зайдёт. Планировщик раз в
// SYNC_TICK_MS смотрит, у каких аккаунтов наступило `next_sync_at`, и
// обновляет их без участия человека.
//
// Разделение ответственности:
//  • `src/lib/schedule.mjs` — чистая арифметика расписания и пауз, без базы;
//  • `syncAccount` — единственное место, где меняются статус, счётчик попыток
//    и `next_sync_at`, поэтому ручная кнопка и планировщик ведут себя одинаково;
//  • здесь — только выбор «кому пора» и защита от наложения тиков.
//
// Аккаунт не синхронизируется дважды одновременно: замок `sync-lock`
// проверяется в `syncAccount`, а планировщик дополнительно пропускает уже
// занятые аккаунты, чтобы не считать их неудачными.
import { config } from '../config.mjs';
import { getDb } from '../db/index.mjs';
import { getAccount, listAccounts, setSyncState } from '../db/accounts.mjs';
import { syncAccount } from '../providers/index.mjs';
import { isDue, nextRunAfterFailure } from '../lib/schedule.mjs';
import { inFlightIds, isSyncInFlight } from '../lib/sync-lock.mjs';

export { inFlightIds, isSyncInFlight };

/**
 * Один проход планировщика: берём аккаунты, которым пора, и синхронизируем
 * их последовательно. Ничего не ждёт по таймеру, поэтому тесты вызывают его
 * напрямую и не спят.
 */
export async function runDueSyncs({
  now = new Date(),
  db = getDb(),
  sync = syncAccount,
  accounts = null,
} = {}) {
  const all = accounts ?? listAccounts(db);
  const due = [];
  const skipped = [];

  for (const account of all) {
    if (isSyncInFlight(account.id)) {
      skipped.push({ id: account.id, handle: account.handle, reason: 'in_flight' });
      continue;
    }
    if (!isDue(account, now)) continue;
    if (account.syncStatus === 'running') {
      // Процесс мог упасть посреди запуска: статус остался running, а замка
      // уже нет. Такой аккаунт не считается занятым — его пора обновить.
      skipped.push({ id: account.id, handle: account.handle, reason: 'stale_running' });
    }
    due.push(account);
  }

  const results = [];
  for (const account of due) {
    try {
      const outcome = await sync(account.id, { db });
      // Страховка: если провайдер сообщил об ошибке, но не записал её сам,
      // аккаунт не должен остаться в `running` без паузы перед повтором.
      if (outcome?.status === 'error') {
        const current = getAccount(account.id, db);
        if (current && current.syncStatus !== 'error') {
          const attempts = (Number(current.syncAttempts) || 0) + 1;
          setSyncState(account.id, {
            status: 'error',
            error: outcome.error ?? 'Синхронизация завершилась ошибкой.',
            attempts,
            errorCode: outcome.errorCode ?? 'provider_error',
            nextSyncAt: nextRunAfterFailure({
              attempts,
              errorCode: outcome.errorCode ?? 'provider_error',
              baseMinutes: config.syncBackoffMinutes,
              maxMinutes: config.syncBackoffMaxMinutes,
              jitter: 0.1,
            }),
          }, db);
        }
      }
      results.push({
        id: account.id,
        handle: account.handle,
        status: outcome?.status === 'error' ? 'error' : outcome?.status === 'busy' ? 'busy' : 'success',
        videosNew: outcome?.videosNew ?? 0,
        error: outcome?.error ?? '',
        nextSyncAt: outcome?.account?.nextSyncAt ?? null,
      });
    } catch (error) {
      // Планировщик не должен падать из-за одного аккаунта: ошибку записываем
      // в отчёт, остальные аккаунты продолжают синхронизироваться.
      //
      // Обычные ошибки источника `syncAccount` записывает сам. Сюда попадают
      // только неожиданные исключения, после которых состояние в базе
      // неизвестно, — тогда расписание и счётчик попыток двигает планировщик,
      // иначе аккаунт застрял бы в статусе `running` без паузы.
      const attempts = (Number(account.syncAttempts) || 0) + 1;
      const nextSyncAt = nextRunAfterFailure({
        attempts,
        errorCode: 'provider_error',
        baseMinutes: config.syncBackoffMinutes,
        maxMinutes: config.syncBackoffMaxMinutes,
        jitter: 0.1,
      });
      try {
        setSyncState(account.id, {
          status: 'error',
          error: error.message,
          attempts,
          errorCode: 'provider_error',
          nextSyncAt,
        }, db);
      } catch { /* сообщение об ошибке не должно ронять тик */ }
      results.push({
        id: account.id,
        handle: account.handle,
        status: 'failed',
        videosNew: 0,
        error: error.message,
        nextSyncAt,
      });
    }
  }

  return {
    checked: all.length,
    due: due.length,
    synced: results.filter((r) => r.status === 'success').length,
    failed: results.filter((r) => r.status === 'error' || r.status === 'failed').length,
    skipped,
    staleRunning: skipped.filter((s) => s.reason === 'stale_running').length,
    results,
  };
}

/**
 * Запуск периодического тика. Возвращает функцию остановки: сервер вызывает
 * её при SIGINT/SIGTERM, чтобы процесс завершился без висящего таймера.
 */
export function startScheduler({
  tickMs = config.syncTickMs,
  db = getDb(),
  log = (line) => process.stdout.write(`${line}\n`),
} = {}) {
  let running = false;
  let stopped = false;

  const tick = async () => {
    // Тик не должен наслаиваться сам на себя, если прошлый ещё идёт.
    if (running || stopped) return;
    running = true;
    try {
      const report = await runDueSyncs({ db });
      if (report.due) {
        log(`[scheduler] синхронизировано ${report.synced} из ${report.due}, ошибок ${report.failed}`);
      }
    } catch (error) {
      log(`[scheduler] тик упал: ${error.message}`);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(tick, Math.max(1000, Number(tickMs) || 60_000));
  timer.unref?.();
  // Первый тик — сразу, чтобы не ждать минуту на старте.
  void tick();

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
