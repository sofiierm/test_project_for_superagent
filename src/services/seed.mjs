// Демо-наполнение: три аккаунта (по одному на платформу) с роликами.
// Нужно, чтобы сервис было видно сразу после запуска. Демо-данные всегда
// создаются локально и не зависят от сети — даже если провайдер живой.
import { getDb } from '../db/index.mjs';
import { getAccountByHandle, insertAccount, listAccounts, setSyncState } from '../db/accounts.mjs';
import { recordSnapshot, upsertVideo } from '../db/videos.mjs';
import { finishRun, startRun } from '../db/runs.mjs';
import { demoProfile, demoVideos } from '../providers/demo-data.mjs';
import { nowIso } from '../lib/dates.mjs';

export const DEMO_HANDLES = ['masha.eats', 'ProCoding', 'danceka'];
const DEMO_PLATFORMS = { 'masha.eats': 'instagram', ProCoding: 'youtube', danceka: 'tiktok' };

export function seedDemoData({ handles = DEMO_HANDLES, db = getDb(), limit = 24 } = {}) {
  const created = [];
  for (const handle of handles) {
    const platform = DEMO_PLATFORMS[handle];
    if (!platform) continue;
    if (getAccountByHandle(platform, handle, db)) continue;
    const profile = demoProfile(platform, handle);
    if (!profile) continue;

    const account = insertAccount({ ...profile, source: 'demo', notes: 'Демо-аккаунт' }, db);
    const runId = startRun(account.id, 'demo', db);
    const videos = demoVideos(platform, handle, { limit });
    for (const video of videos) {
      const { id } = upsertVideo({ ...video, accountId: account.id }, db);
      recordSnapshot(id, db);
    }
    finishRun(runId, { status: 'success', videosFound: videos.length, videosNew: videos.length }, db);
    setSyncState(account.id, { status: 'success', error: '', syncedAt: nowIso() }, db);
    created.push(handle);
  }
  return created;
}

export function needsSeed(db = getDb()) {
  return listAccounts(db).length === 0;
}
