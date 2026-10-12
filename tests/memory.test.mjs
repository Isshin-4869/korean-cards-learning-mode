import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recall, stability, nextK, dueCards, forecast, jstDate, DAY, DUE_AT } from '../js/memory.js';
import { streakOf, weekOf, recordAnswer, reviewedToday } from '../js/streak.js';
import { mergeAll } from '../js/sync.js';

const NOW = Date.parse('2026-10-17T12:00:00+09:00'); // 土曜

test('記憶の見積もり: 学習していない単語は null、時間がたつほど下がる', () => {
  assert.equal(recall({ s: 0, t: NOW }, NOW), null);
  const r = { s: 2, k: 0, w: 0, t: NOW };
  assert.equal(recall(r, NOW), 1);
  assert.ok(recall(r, NOW + DAY) > recall(r, NOW + 3 * DAY));
  // 日をまたいで正解し続けるほど持ちが伸びる、間違いが多いほど縮む
  assert.ok(stability({ s: 2, k: 2 }) > stability({ s: 2, k: 1 }));
  assert.ok(stability({ s: 2, k: 1, w: 5 }) < stability({ s: 2, k: 1, w: 0 }));
  assert.ok(stability({ s: 1 }) < stability({ s: 2 }));
});

test('k は日をまたいだ正解でだけ増え、間違いで 0 に戻る', () => {
  const prev = { s: 2, k: 2, t: NOW - DAY };
  assert.equal(nextK(prev, true, NOW), 3);
  assert.equal(nextK({ ...prev, t: NOW - 3600e3 }, true, NOW), 2); // 同じ日
  assert.equal(nextK(prev, false, NOW), 0);
  assert.equal(nextK({ s: 0 }, true, NOW), 0); // 初めて
});

test('復習どき: 見込みの低い順に上限まで', () => {
  const cards = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
  const progress = {
    a: { s: 2, k: 0, w: 0, t: NOW - 10 * DAY }, // とても低い
    b: { s: 2, k: 0, w: 0, t: NOW - 2 * DAY }, // 復習どき
    c: { s: 2, k: 4, w: 0, t: NOW - 2 * DAY }, // まだ大丈夫
    // d は未学習
  };
  assert.deepEqual(dueCards(cards, progress, NOW).map((c) => c.id), ['a', 'b']);
  assert.deepEqual(dueCards(cards, progress, NOW, 1).map((c) => c.id), ['a']);
  const f = forecast(cards, progress, NOW);
  assert.equal(f.studied, 3);
  assert.equal(f.values.length, 8);
  assert.ok(f.values[0] > f.values[7]);
  assert.ok(f.values.every((v) => v >= 0 && v <= 100));
  assert.ok(DUE_AT > 0.6);
});

test('連続日数: 今日まだなら昨日までを数える。最長も出す', () => {
  const days = {};
  for (const d of ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']) days[d] = { a: 5, r: 0 };
  for (const d of ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06', '2026-09-07']) days[d] = { a: 1, r: 0 };
  let s = streakOf(days, NOW);
  assert.deepEqual([s.days, s.todayDone, s.best], [5, false, 7]);
  recordAnswer(days, NOW, { review: true });
  s = streakOf(days, NOW);
  assert.deepEqual([s.days, s.todayDone], [6, true]);
  assert.equal(reviewedToday(days, NOW), 1);
  // 1日空いたら途切れる
  assert.equal(streakOf(days, NOW + 2 * DAY).days, 0);
});

test('今週は月曜はじまりの 7 日', () => {
  const w = weekOf({ '2026-10-12': { a: 1 }, '2026-10-17': { a: 2 } }, NOW);
  assert.deepEqual(w.map((x) => x.label), ['月', '火', '水', '木', '金', '土', '日']);
  assert.equal(w[0].date, '2026-10-12');
  assert.deepEqual([w[0].done, w[1].done, w[5].today, w[5].done, w[6].future], [true, false, true, true, true]);
  assert.equal(jstDate(NOW), '2026-10-17');
});

test('同期: 学習した日は日ごとに大きいほうを残し、リセットでは消えない', () => {
  const local = { days: { v: { '2026-10-16': { a: 3, r: 1 } }, u: 10 } };
  const remote = { days: { v: { '2026-10-16': { a: 5, r: 0 }, '2026-10-15': { a: 2, r: 2 } }, u: 5 }, meta: { v: { resetAt: 20 }, u: 20 } };
  const { toLocal } = mergeAll(local, remote, 0);
  assert.deepEqual(toLocal.days.v, { '2026-10-16': { a: 5, r: 1 }, '2026-10-15': { a: 2, r: 2 } });
});
