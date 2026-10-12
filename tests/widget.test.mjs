// ウィジェット用の要約（buildSummary）とアイコンのバッジ
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseCardsMarkdown } from '../js/cards.js';
import { state, setCards, DEFAULT_SETTINGS } from '../js/state.js';
import { buildSummary, badgeCount, updateBadge } from '../js/widget.js';
import { DAY } from '../js/memory.js';

const md = fs.readFileSync(fileURLToPath(new URL('../data/cards.md', import.meta.url)), 'utf8');
setCards(parseCardsMarkdown(md).cards);

// 2026-10-12（月）11:00 UTC = JST 20:00
const NOW = Date.UTC(2026, 9, 12, 11, 0);

function setup({ progress = {}, days = {}, settings = {} } = {}) {
  state.progress = progress;
  state.days = days;
  state.settings = { ...DEFAULT_SETTINGS, ...settings };
  return state;
}
// n 枚を ago 日前に習得した記録（4 日の持ちなので、10 日前なら復習どき）
const mastered = (n, ago) => Object.fromEntries(state.cards.slice(0, n).map((c) => [c.id, { s: 2, k: 0, w: 0, wc: 0, t: NOW - ago * DAY }]));

test('何もしていなければ 0 ばかり（v: 2 の形）', () => {
  const s = buildSummary(setup(), NOW);
  assert.deepEqual(s, {
    v: 2,
    streak: { days: 0, best: 0, todayDone: false },
    week: ['月', '火', '水', '木', '金', '土', '日'].map((l, i) => ({ l, d: 0, t: i === 0 ? 1 : 0 })),
    review: { remaining: 0, done: 0, limit: 50, due: 0 },
    recall: [0, 0, 0, 0, 0, 0, 0, 0],
    studied: 0,
    updatedAt: NOW,
  });
});

test('連続記録と今週（月曜はじまり、JST の日付）', () => {
  const days = { '2026-10-10': { a: 3, r: 0 }, '2026-10-11': { a: 1, r: 0 }, '2026-10-12': { a: 5, r: 0 } };
  for (const d of ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04']) days[d] = { a: 1, r: 0 };
  let s = buildSummary(setup({ days }), NOW);
  assert.deepEqual(s.streak, { days: 3, best: 4, todayDone: true });
  // 10/10・10/11 は先週なので、今週は月曜だけ
  assert.deepEqual(s.week.map((d) => d.d), [1, 0, 0, 0, 0, 0, 0]);
  // 今日まだなら昨日までの連続
  delete days['2026-10-12'];
  s = buildSummary(setup({ days }), NOW);
  assert.deepEqual(s.streak, { days: 2, best: 4, todayDone: false });
  assert.deepEqual(s.week[0], { l: '月', d: 0, t: 1 });
});

test('今日の復習は上限から今日やった分を引く。バッジも同じ数', () => {
  const st = setup({ progress: mastered(40, 10), days: { '2026-10-12': { a: 12, r: 10 } }, settings: { reviewLimit: 30 } });
  const s = buildSummary(st, NOW);
  assert.deepEqual(s.review, { remaining: 20, done: 10, limit: 30, due: 40 });
  assert.equal(badgeCount(st, NOW), 20);
  assert.equal(s.studied, 40);
  assert.equal(s.recall.length, 8);
  assert.ok(s.recall.every((v, i) => Number.isInteger(v) && (i === 0 || v <= s.recall[i - 1])), String(s.recall));
  // 上限まで復習したら 0
  assert.equal(badgeCount(setup({ progress: mastered(40, 10), days: { '2026-10-12': { a: 40, r: 30 } }, settings: { reviewLimit: 30 } }), NOW), 0);
  // 復習どきでなければ 0（今日習得したばかり）
  assert.equal(badgeCount(setup({ progress: mastered(40, 0) }), NOW), 0);
});

test('バッジ: 残りがあれば数字、0 なら消す', () => {
  const calls = [];
  const desc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { setAppBadge: (n) => calls.push(['set', n]), clearAppBadge: () => calls.push(['clear']) },
  });
  try {
    updateBadge(setup({ progress: mastered(5, 10) }));
    updateBadge(setup());
  } finally {
    if (desc) Object.defineProperty(globalThis, 'navigator', desc);
    else delete globalThis.navigator;
  }
  assert.deepEqual(calls, [['set', 5], ['clear']]);
});

test('要約は 2KB 未満', () => {
  const progress = Object.fromEntries(state.cards.map((c, i) => [c.id, { s: 1 + (i % 2), k: i % 9, w: i % 4, wc: 0, t: NOW - (i % 30) * DAY }]));
  const days = {};
  for (let i = 0; i < 400; i++) days[new Date(NOW - i * DAY).toISOString().slice(0, 10)] = { a: 999, r: 99 };
  const s = buildSummary(setup({ progress, days, settings: { reviewLimit: 100 } }), NOW);
  assert.ok(s.streak.days > 300);
  assert.ok(JSON.stringify(s).length < 2048, `${JSON.stringify(s).length} bytes`);
});
