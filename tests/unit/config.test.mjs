// Конфигурация: значения по умолчанию, разбор .env и приоритет окружения.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..', '..');

// Каждый случай выполняется в отдельном процессе: config читается один раз
// при импорте и меняет process.env, поэтому в общем процессе тесты бы влияли
// друг на друга.
function runConfig(env = {}, { files = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-conf-'));
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content);
  }
  const script = `
    const { config } = await import(${JSON.stringify(path.join(ROOT, 'src/config.mjs'))});
    console.log(JSON.stringify({ port: config.port, host: config.host, provider: config.provider,
      seedDemo: config.seedDemo, syncLimit: config.syncLimit, timeZone: config.timeZone }));
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: dir,
    env: { PATH: process.env.PATH, ...env },
    encoding: 'utf8',
  });
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.trim());
}

test('значения по умолчанию подходят для локального запуска', () => {
  const config = runConfig();
  assert.equal(config.port, 4180);
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.provider, 'auto');
  assert.equal(config.seedDemo, true);
  assert.equal(config.syncLimit, 24);
  assert.equal(config.timeZone, 'Europe/Moscow');
});

test('.env подхватывается автоматически', () => {
  const config = runConfig({}, {
    files: { '.env': 'PORT=5000\nHOST=0.0.0.0\nPROVIDER=demo\nSEED_DEMO=false\n' },
  });
  assert.equal(config.port, 5000);
  assert.equal(config.host, '0.0.0.0');
  assert.equal(config.provider, 'demo');
  assert.equal(config.seedDemo, false);
});

test('переменная окружения важнее .env', () => {
  const config = runConfig({ PORT: '7777' }, { files: { '.env': 'PORT=5000\n' } });
  assert.equal(config.port, 7777);
});

test('.env: комментарии, кавычки и мусор не ломают разбор', () => {
  const config = runConfig({}, {
    files: {
      '.env': [
        '# комментарий',
        '',
        'PORT="6001"',
        "SYNC_LIMIT='12'",
        'НЕВАЛИДНАЯ СТРОКА',
        'PROVIDER=ytdlp',
      ].join('\n'),
    },
  });
  assert.equal(config.port, 6001);
  assert.equal(config.syncLimit, 12);
  assert.equal(config.provider, 'ytdlp');
});

test('некорректные числа откатываются к значениям по умолчанию', () => {
  const config = runConfig({ PORT: 'не число', SYNC_LIMIT: '-5' });
  assert.equal(config.port, 4180);
  assert.equal(config.syncLimit, 1, 'отрицательный лимит должен стать 1');
});

test('.env.example не расходится с реальными ключами', () => {
  const example = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
  for (const key of ['PORT', 'HOST', 'DATA_DIR', 'APP_TIME_ZONE', 'SEED_DEMO', 'SYNC_LIMIT', 'PROVIDER', 'YTDLP_PATH']) {
    assert.ok(new RegExp(`^${key}=`, 'm').test(example), `в .env.example нет ${key}`);
  }
});
