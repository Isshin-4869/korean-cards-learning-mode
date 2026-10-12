import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseCardsMarkdown, stripNotes } from '../js/cards.js';
import { Deck, makeRng, textKey, canSpell, canWrite } from '../js/deck.js';
import { pickRoundCards, newRound, applyAnswer, undoAnswer, roundDone, roundSummary, questionType, directionFor } from '../js/learn.js';
import { rec, markWrongOutsideLearn } from '../js/progress.js';

const md = fs.readFileSync(fileURLToPath(new URL('../data/cards.md', import.meta.url)), 'utf8');
const { cards } = parseCardsMarkdown(md);
const deck = new Deck(cards);
const find = (lesson, term, def) => cards.find((c) => c.lesson === lesson && c.term === term && (!def || c.definition.startsWith(def)));

test('範囲の絞り込み（課 × 種別）', () => {
  assert.equal(deck.inRange({ lessons: ['第1課', '第2課'], types: ['単語'] }).length, 35);
  assert.equal(deck.inRange({ lessons: ['第10課'], types: ['文法'] }).length, 90);
  assert.equal(deck.inRange({ lessons: ['会話表現'], types: ['会話表現'] }).length, 82);
  assert.equal(deck.inRange({ lessons: ['会話表現'], types: ['単語'] }).length, 0);
});

test('4択: 正解1つ＋同じ分類の誤答3つ、同じ文字列や別の正解は入らない', () => {
  const rng = makeRng(1);
  for (const c of cards.filter((_, i) => i % 7 === 0)) {
    for (const dir of ['ko', 'ja']) {
      const ch = deck.choices(c, dir, 4, rng);
      assert.equal(ch.length, 4, c.term);
      assert.equal(ch.filter((x) => x.correct).length, 1);
      const keys = ch.map((x) => textKey(x.text));
      assert.equal(new Set(keys).size, 4, `${c.term} ${dir} ${keys}`);
      const wrongKinds = ch.filter((x) => !x.correct).map((x) => deck.get(x.id).kind);
      assert.ok(wrongKinds.every((k) => k === c.kind), `${c.term} の誤答が別の分類`);
    }
  }
  // 「일＝1」の誤答に「～日」が入らない
  const il = find('第10課', '일', '1');
  for (let i = 0; i < 30; i++) {
    const texts = deck.choices(il, 'ko', 4, makeRng(i)).map((x) => stripNotes(x.text));
    assert.ok(!texts.includes('～日') && !texts.includes('こと、仕事'), texts.join(','));
  }
  // 別の課の同じカード（놉니다）は誤答に入らない
  const n8 = find('第8課', '놉니다');
  for (let i = 0; i < 30; i++) {
    const ch = deck.choices(n8, 'ja', 4, makeRng(i));
    assert.equal(ch.filter((x) => textKey(x.text) === textKey('놉니다')).length, 1);
  }
});

test('同じ問題文のカードの答えもまとめて正解の候補にする', () => {
  const il = find('第10課', '일', '1');
  assert.deepEqual(deck.answersFor(il, 'ko').map(stripNotes).sort(), ['1', 'こと、仕事', '～日'].sort());
});

test('ラウンドの組み立て: 学習中・間違いの多い単語で約6割、残りを未学習（課の順）', () => {
  const pool = deck.inRange({ lessons: ['第2課', '第3課'], types: ['単語'] });
  const progress = {};
  // 何もしていなければ未学習を課の順に
  const first = pickRoundCards(pool, progress, 7);
  assert.deepEqual(first.map((c) => c.term), pool.slice(0, 7).map((c) => c.term));
  // 学習中を 5 枚作る
  pool.slice(0, 5).forEach((c, i) => (progress[c.id] = { s: 1, w: i, wc: 0, t: i }));
  const next = pickRoundCards(pool, progress, 7);
  const review = next.filter((c) => rec(progress, c.id).s === 1);
  assert.equal(review.length, 4); // round(7 * 0.6)
  assert.equal(review[0].id, pool[4].id); // 間違いが一番多いものから
  assert.deepEqual(next.slice(4).map((c) => c.id), pool.slice(5, 8).map((c) => c.id));
  // 全部習得なら空
  pool.forEach((c) => (progress[c.id] = { s: 2, w: 0, wc: 1, t: 0 }));
  assert.equal(pickRoundCards(pool, progress, 7).length, 0);
});

test('段階: 4択正解で学習中、記述正解で習得、間違いは2問後に出し直し（段階は上げない）', () => {
  const pool = deck.inRange({ lessons: ['第2課'], types: ['単語'] }).slice(0, 5);
  const progress = {};
  const round = newRound(pool, progress, makeRng(3));
  assert.ok(round.queue.every((q) => q.type === 'mc'));
  const a = round.queue[0].id;
  const b = round.queue[1].id;
  applyAnswer(round, progress, true);
  assert.equal(rec(progress, a).s, 1);
  applyAnswer(round, progress, false);
  assert.equal(rec(progress, b).s, 0);
  assert.equal(rec(progress, b).w, 1);
  assert.equal(round.queue[round.pos + 2].id, b);
  assert.equal(round.queue[round.pos + 2].retry, 1);
  while (!roundDone(round)) applyAnswer(round, progress, true);
  assert.equal(rec(progress, b).s, 0, '出し直しの正解では上がらない');
  const sum = Object.fromEntries(roundSummary(round, progress).map((x) => [x.id, x.status]));
  assert.equal(sum[b], 'review');
  assert.equal(sum[a], 'learning');

  // 次のラウンド: 学習中は記述で出る → 正解で習得
  const r2 = newRound([deck.get(a)], progress);
  assert.equal(r2.queue[0].type, 'written');
  applyAnswer(r2, progress, true);
  assert.equal(rec(progress, a).s, 2);
});

test('記述で間違えたら学習中のまま、連続正解数をリセット。2回正解で習得の設定', () => {
  const c = find('第2課', '기다리다');
  const progress = { [c.id]: { s: 1, w: 0, wc: 1, t: 0 } };
  const r = newRound([c], progress);
  applyAnswer(r, progress, false, { needWritten: 2 });
  assert.deepEqual([rec(progress, c.id).s, rec(progress, c.id).wc, rec(progress, c.id).w], [1, 0, 1]);
  const r2 = newRound([c], progress);
  applyAnswer(r2, progress, true, { needWritten: 2 });
  assert.equal(rec(progress, c.id).s, 1);
  const r3 = newRound([c], progress);
  applyAnswer(r3, progress, true, { needWritten: 2 });
  assert.equal(rec(progress, c.id).s, 2);
});

test('文型・解説カードは記述の代わりに逆向き4択', () => {
  const p = cards.find((c) => c.term === '-러 / -으러');
  assert.ok(!canWrite(p));
  assert.equal(questionType(p, { s: 1 }), 'rmc');
  assert.equal(directionFor('rmc', 'ko'), 'ja');
  assert.equal(directionFor('mc', 'auto'), 'ko');
  assert.equal(directionFor('written', 'auto'), 'ja');
});

test('「正解にする」で回答を取り消して正解として反映できる', () => {
  const pool = deck.inRange({ lessons: ['第1課'], types: ['単語'] }).slice(0, 3);
  const progress = {};
  const round = newRound(pool, progress, makeRng(5));
  const id = round.queue[0].id;
  const undo = applyAnswer(round, progress, false);
  assert.equal(round.queue.length, 4);
  undoAnswer(round, progress, undo);
  assert.equal(round.queue.length, 3);
  assert.equal(progress[id], undefined);
  applyAnswer(round, progress, true);
  assert.equal(rec(progress, id).s, 1);
  assert.ok(!round.missed[id]);
});

test('テスト・スペルの間違い: 間違い回数を増やし、習得済みは学習中へ', () => {
  const progress = { x: { s: 2, w: 0, wc: 1, t: 0 } };
  markWrongOutsideLearn(progress, 'x');
  assert.deepEqual([progress.x.s, progress.x.w], [1, 1]);
});

test('スペルの対象は語と短い文のみ', () => {
  assert.ok(canSpell(find('第2課', '기다리다')));
  assert.ok(!canSpell(cards.find((c) => c.term === '-러 / -으러')));
  assert.ok(!canSpell(cards.find((c) => c.term === '○○ 씨는요?')));
  assert.ok(!canSpell(cards.find((c) => c.term.startsWith('봄에 마코토 씨하고'))));
});
