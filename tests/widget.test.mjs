// ウィジェット用の要約（buildSummary）と惑星の段階
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseCardsMarkdown } from '../js/cards.js';
import { state, setCards } from '../js/state.js';
import { buildSummary, stageOf } from '../js/widget.js';
import * as planet from '../js/planet.js';
import { summarize } from '../js/progress.js';
import { rangeKey } from '../js/deck.js';

const md = fs.readFileSync(fileURLToPath(new URL('../data/cards.md', import.meta.url)), 'utf8');
setCards(parseCardsMarkdown(md).cards);

// 2026-10-12 11:00 UTC = JST 20:00
const NOW = Date.UTC(2026, 9, 12, 11, 0);
const sel = { lessons: ['第1課', '第2課', '第3課'], types: ['単語', '文法', '会話表現'] };

function setup(progress = {}) {
  state.selection = structuredClone(sel);
  state.progress = progress;
  return { ...state };
}

test('stageOf は design-space.html と同じしきい値', () => {
  assert.equal(stageOf(100, 0), 5);
  assert.equal(stageOf(75, 0), 4);
  assert.equal(stageOf(74, 0), 3);
  assert.equal(stageOf(50, 0), 3);
  assert.equal(stageOf(25, 0), 2);
  assert.equal(stageOf(24, 0), 1);
  assert.equal(stageOf(1, 0), 1);
  assert.equal(stageOf(0, 3), 1);
  assert.equal(stageOf(0, 0), 0);
});

test('何もしていなければ 0%・段階 0', () => {
  const s = buildSummary(setup(), NOW);
  const inRange = state.deck.inRange(sel).length;
  assert.equal(s.range, '第1〜3課');
  assert.equal(s.total, inRange);
  assert.deepEqual([s.mastered, s.learning, s.unseen, s.pct, s.stage, s.today], [0, 0, inRange, 0, 0, 0]);
  assert.equal(s.seed, 'range:第1課,第2課,第3課');
  assert.equal(s.updatedAt, NOW);
  assert.equal(s.lessons.length, state.lessons.length);
  assert.deepEqual(s.lessons[0], { n: '1', pct: 0, stage: 0 });
  assert.deepEqual(s.lessons.at(-1), { n: '会話', pct: 0, stage: 0 });
});

test('習得・学習中・今日（JST の日付）を数える', () => {
  const cards = state.deck.inRange(sel);
  const progress = {};
  const half = Math.ceil(cards.length / 2);
  cards.slice(0, half).forEach((c) => (progress[c.id] = { s: 2, w: 0, wc: 0, t: Date.UTC(2026, 9, 11, 14, 0) })); // JST 10/11 23:00
  cards.slice(half, half + 3).forEach((c) => (progress[c.id] = { s: 1, w: 1, wc: 0, t: Date.UTC(2026, 9, 11, 15, 30) })); // JST 10/12 0:30
  const other = state.cards.find((c) => c.lesson === '第10課');
  progress[other.id] = { s: 1, w: 0, wc: 0, t: NOW - 1000 }; // 範囲外でも今日の数には入る
  const s = buildSummary(setup(progress), NOW);
  assert.equal(s.mastered, half);
  assert.equal(s.learning, 3);
  assert.equal(s.unseen, cards.length - half - 3);
  assert.equal(s.pct, Math.round((half / cards.length) * 100));
  assert.equal(s.stage, 3);
  assert.equal(s.today, 4);
  assert.deepEqual(s.lessons.find((l) => l.n === '10'), { n: '10', pct: 0, stage: 1 });
});

test('全部習得で 100%・段階 5。1枚でも残れば 99% まで', () => {
  const cards = state.deck.inRange(sel);
  const all = Object.fromEntries(cards.map((c) => [c.id, { s: 2, w: 0, wc: 0, t: 1 }]));
  let s = buildSummary(setup(all), NOW);
  assert.equal(s.pct, 100);
  assert.equal(s.stage, 5);
  assert.deepEqual(s.lessons[0], { n: '1', pct: 100, stage: 5 });
  // 全カード中 1 枚だけ残す（四捨五入なら 100% になる）
  state.selection = { lessons: [...state.lessons], types: ['単語', '文法', '会話表現'] };
  state.progress = Object.fromEntries(state.cards.slice(1).map((c) => [c.id, { s: 2, w: 0, wc: 0, t: 1 }]));
  s = buildSummary(state, NOW);
  assert.equal(s.pct, 99);
  assert.equal(s.stage, 4);
});

test('要約は 2KB 未満', () => {
  const progress = Object.fromEntries(state.cards.map((c, i) => [c.id, { s: i % 3, w: 0, wc: 0, t: NOW }]));
  state.selection = { lessons: [...state.lessons], types: ['単語', '文法', '会話表現'] };
  state.progress = progress;
  const s = buildSummary(state, NOW);
  assert.equal(s.range, '第1〜22課＋会話表現');
  assert.ok(JSON.stringify(s).length < 2048, `${JSON.stringify(s).length} bytes`);
});

test('段階と seed は js/planet.js（アプリの惑星）と同じ', () => {
  for (const [m, l] of [[0, 0], [0, 0.1], [24.9, 0], [25, 0], [74.99, 3], [75, 0], [99.9, 0], [100, 0]]) {
    assert.equal(stageOf(m, l), planet.stageOf(m, l), `${m} ${l}`);
  }
  const cards = state.deck.inRange(sel);
  // 74.6% のように丸めると段階が変わる値でも一致する
  for (const ratio of [0, 0.01, 0.249, 0.5, 0.746, 0.999, 1]) {
    const n = Math.round(cards.length * ratio);
    const progress = Object.fromEntries(cards.slice(0, n).map((c) => [c.id, { s: 2, w: 0, wc: 0, t: 1 }]));
    const s = buildSummary(setup(progress), NOW);
    assert.equal(s.stage, planet.stageOfSummary(summarize(cards, progress)), `ratio ${ratio}`);
  }
  assert.equal(buildSummary(setup(), NOW).seed, planet.rangePlanetName(rangeKey(sel)));
});
