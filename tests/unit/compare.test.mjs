// Сравнение аккаунтов и произвольных периодов (#9).
//
// Проверяем то, что легко сломать незаметно: агрегаты при разном числе
// аккаунтов, границы периода и честное «сравнивать не с чем» вместо нуля.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compareAccounts, compareGrowth, parsePeriod, periodDays, previousPeriod, videosInPeriod,
} from '../../src/analysis/metrics.mjs';

const DAY = 24 * 3600 * 1000;
const NOW = new Date('2026-05-20T12:00:00Z');

function account(id, overrides = {}) {
  return { id, platform: 'youtube', handle: `a${id}`, displayName: `Аккаунт ${id}`, followers: 1000, ...overrides };
}
function video(id, accountId, daysAgo, overrides = {}) {
  return {
    id,
    accountId,
    publishedAt: new Date(NOW.getTime() - daysAgo * DAY).toISOString(),
    views: 1000,
    likes: 50,
    comments: 5,
    shares: 5,
    saves: 40,
    durationSeconds: 60,
    ...overrides,
  };
}

test('период по умолчанию — последние 30 дней включая сегодня', () => {
  const p = parsePeriod({ now: NOW });
  assert.equal(p.error, '');
  assert.equal(p.days, 30);
  assert.equal(p.to.toISOString(), NOW.toISOString());
});

test('явный период считается включительно', () => {
  const p = parsePeriod({ from: '2026-05-01', to: '2026-05-10', now: NOW });
  assert.equal(p.error, '');
  assert.equal(p.days, 10, '10 мая должно входить в период');
  assert.equal(p.from.toISOString(), '2026-05-01T00:00:00.000Z');
  // Конец даты без времени — конец дня, иначе «по 10 мая» отрезало бы 10 мая.
  assert.equal(p.to.toISOString(), '2026-05-10T23:59:59.999Z');
});

test('мусорные даты дают понятную ошибку, а не «весь диапазон»', () => {
  const bad = parsePeriod({ from: '2026-13-45', now: NOW });
  assert.ok(bad.error, 'ошибка не вернулась');
  assert.match(bad.error, /Начало периода/);
  assert.equal(bad.from, undefined, 'при ошибке период не должен считаться валидным');

  const reversed = parsePeriod({ from: '2026-05-10', to: '2026-05-01', now: NOW });
  assert.match(reversed.error, /позже конца/);

  const huge = parsePeriod({ from: '2015-01-01', to: '2026-01-01', now: NOW });
  assert.match(huge.error, /трёх лет/);
});

test('предыдущий период вплотную примыкает к текущему и не пересекается с ним', () => {
  const p = parsePeriod({ from: '2026-05-01', to: '2026-05-10', now: NOW });
  const prev = previousPeriod(p.from, p.to);
  assert.equal(prev.to.getTime(), p.from.getTime() - 1, 'между периодами дыра или нахлёст');
  assert.equal(periodDays(prev.from, prev.to), p.days, 'длина предыдущего периода другая');
});

test('в период попадают только ролики внутри границ включительно', () => {
  const videos = [video(1, 1, 0), video(2, 1, 5), video(3, 1, 40)];
  const p = parsePeriod({ from: '2026-05-10', to: '2026-05-20', now: NOW });
  const inside = videosInPeriod(videos, p.from, p.to);
  assert.deepEqual(inside.map((v) => v.id), [1, 2]);
});

test('сравнение считает метрики на роликах периода, а не на всём архиве', () => {
  const accounts = [account(1), account(2)];
  const videos = [
    // Первый аккаунт: один вирусный ролик в периоде и много старых.
    video(1, 1, 1, { views: 100_000 }),
    video(2, 1, 60, { views: 1 }),
    video(3, 1, 70, { views: 1 }),
    // Второй: два средних ролика в периоде.
    video(4, 2, 2, { views: 20_000 }),
    video(5, 2, 3, { views: 20_000 }),
  ];
  const p = parsePeriod({ from: '2026-04-21', to: '2026-05-20', now: NOW });
  const result = compareAccounts(accounts, videos, p);
  const first = result.rows.find((r) => r.account.id === 1);
  const second = result.rows.find((r) => r.account.id === 2);
  assert.equal(first.videos, 1, 'старые ролики попали в период');
  assert.equal(first.totalViews, 100_000);
  assert.equal(second.videos, 2);
  assert.equal(second.totalViews, 40_000);
  assert.equal(second.medianViews, 20_000);
});

test('аккаунт без публикаций в периоде остаётся в таблице с пометкой', () => {
  const accounts = [account(1), account(2)];
  const videos = [video(1, 1, 1)];
  const p = parsePeriod({ from: '2026-05-10', to: '2026-05-20', now: NOW });
  const result = compareAccounts(accounts, videos, p);
  assert.equal(result.rows.length, 2, 'пустой аккаунт пропал из сравнения');
  const empty = result.rows.find((r) => r.account.id === 2);
  assert.equal(empty.hasData, false);
  assert.equal(empty.totalViews, 0);
  assert.equal(empty.avgEr, 0);
});

test('лидеры определяются среди аккаунтов с данными, а не по нулям', () => {
  const accounts = [account(1), account(2), account(3)];
  const videos = [
    video(1, 1, 1, { views: 5000, likes: 100, comments: 50, shares: 50, saves: 100 }),
    video(2, 2, 1, { views: 9000, likes: 10, comments: 0, shares: 0, saves: 0 }),
    // У третьего публикаций в периоде нет: он не должен становиться лидером
    // по «нулевым» метрикам.
  ];
  const p = parsePeriod({ from: '2026-05-10', to: '2026-05-20', now: NOW });
  const { leaders } = compareAccounts(accounts, videos, p);
  assert.equal(leaders.views, 2, 'лидер по просмотрам определён неверно');
  assert.equal(leaders.er, 1, 'лидер по ER определён неверно');
});

test('пустой список аккаунтов не роняет сравнение', () => {
  const p = parsePeriod({ now: NOW });
  const result = compareAccounts([], [], p);
  assert.deepEqual(result.rows, []);
  assert.equal(result.leaders.views, null);
});

test('сравнение с одним аккаунтом работает: это вырожденный, но валидный случай', () => {
  const videos = [video(1, 1, 1, { views: 3000 })];
  const p = parsePeriod({ from: '2026-05-10', to: '2026-05-20', now: NOW });
  const result = compareAccounts([account(1)], videos, p);
  assert.equal(result.rows.length, 1);
  assert.equal(result.leaders.views, 1);
});

test('рост считается к предыдущему периоду той же длины', () => {
  const accounts = [account(1)];
  const videos = [
    video(1, 1, 5, { views: 2000 }),   // текущий период
    video(2, 1, 35, { views: 1000 }),  // предыдущий период
  ];
  const p = parsePeriod({ from: '2026-05-01', to: '2026-05-20', now: NOW });
  const growth = compareGrowth(accounts, videos, p);
  assert.equal(growth.length, 1);
  assert.equal(growth[0].hasComparison, true);
  assert.equal(Math.round(growth[0].viewsChange), 100, 'рост должен быть +100 %');
});

test('без публикаций в прошлом периоде изменение — null, а не 0 или +100 %', () => {
  const accounts = [account(1)];
  const videos = [video(1, 1, 5, { views: 2000 })];
  const p = parsePeriod({ from: '2026-05-01', to: '2026-05-20', now: NOW });
  const growth = compareGrowth(accounts, videos, p);
  assert.equal(growth[0].hasComparison, false);
  assert.equal(growth[0].viewsChange, null, 'отсутствие данных показано как изменение');
  assert.equal(growth[0].erChange, null);
});
