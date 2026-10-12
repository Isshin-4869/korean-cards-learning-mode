// テストモードの問題づくり（保存して再開できるよう、選択肢まで作ってただのオブジェクトにする）

import { shuffle, canWrite, answerText, textKey } from './deck.js';
import { directionFor } from './learn.js';

export const TEST_FORMATS = { mc: '4択', written: '記述', tf: '正誤', match: '線結び' };
export const MATCH_SIZE = 5;

/**
 * @param {Deck} deck
 * @param {Card[]} cards 範囲内のカード
 * @param {{count: number|'all', formats: string[], direction: string}} opts
 */
export function buildTest(deck, cards, { count, formats, direction }, rng = Math.random) {
  const pool = shuffle(cards, rng);
  const remaining = pool.slice(0, count === 'all' ? pool.length : Math.min(count, pool.length));
  const fmts = formats.length ? formats : ['mc'];
  const qs = [];
  while (remaining.length) {
    const card = remaining.shift();
    const usable = fmts.filter((f) => f !== 'written' || canWrite(card));
    let f = usable.length ? usable[Math.floor(rng() * usable.length)] : 'mc';
    if (f === 'match') {
      const group = [card];
      for (let j = 0; j < remaining.length && group.length < MATCH_SIZE;) {
        const c = remaining[j];
        if (group.every((g) => textKey(g.term) !== textKey(c.term) && textKey(g.definition) !== textKey(c.definition))) {
          group.push(c);
          remaining.splice(j, 1);
        } else j++;
      }
      if (group.length >= 3) {
        qs.push({ type: 'match', ids: group.map((c) => c.id), right: shuffle(group.map((c) => c.id), rng) });
        continue;
      }
      // 残りが少なくて線結びにならないときは別の形式にする
      remaining.unshift(...group.slice(1));
      f = usable.find((x) => x !== 'match') ?? 'mc';
    }
    const dir = directionFor(f === 'written' ? 'written' : 'mc', direction, rng);
    const q = { type: f, ids: [card.id], dir };
    if (f === 'mc') q.choices = deck.choices(card, dir, 4, rng);
    if (f === 'tf') {
      const wrong = deck.choices(card, dir, 2, rng).find((c) => !c.correct);
      q.truth = !wrong || rng() < 0.5;
      q.shown = q.truth ? answerText(card, dir) : wrong.text;
    }
    qs.push(q);
  }
  return qs;
}

export const testItemCount = (qs) => qs.reduce((n, q) => n + q.ids.length, 0);
