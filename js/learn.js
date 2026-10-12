// 学習モード（Quizlet の Learn）のラウンド組み立てと回答後の状態遷移。画面からは切り離してある。

import { lessonOrder } from './cards.js';
import { shuffle, canWrite } from './deck.js';
import { rec, put, UNSEEN, LEARNING, MASTERED } from './progress.js';

export const REVIEW_SHARE = 0.6; // 次のラウンドで「間違いが多い・学習中」に割く割合
export const RETRY_GAP = 2; // 間違えた単語を何問後に出し直すか
export const RETRY_MAX = 3; // 1ラウンドで同じ単語を出し直す上限

// 出題形式: mc = 4択, written = 記述, rmc = 答える側を逆にした4択（文型・解説カードの仕上げ）
export function questionType(card, r) {
  if (r.s === UNSEEN) return 'mc';
  return canWrite(card) ? 'written' : 'rmc';
}

// 出題の向き。setting: auto（4択は韓→日・記述は日→韓）/ ko / ja / mix
export function directionFor(type, setting, rng = Math.random) {
  const base = setting === 'mix' ? (rng() < 0.5 ? 'ko' : 'ja') : setting === 'ja' ? 'ja' : 'ko';
  if (setting === 'auto') return type === 'written' || type === 'rmc' ? 'ja' : 'ko';
  if (type === 'rmc') return base === 'ko' ? 'ja' : 'ko';
  return base;
}

/**
 * 次のラウンドの単語を選ぶ。
 * 間違いが多い単語・学習中の単語で約6割、残りを未学習（課の順）で埋める。
 * 範囲が全部習得済みなら空配列。
 */
export function pickRoundCards(cards, progress, size) {
  const review = [];
  const fresh = [];
  for (const c of cards) {
    const r = rec(progress, c.id);
    if (r.s === MASTERED) continue;
    if (r.s === LEARNING || r.w > 0) review.push(c);
    else fresh.push(c);
  }
  review.sort((a, b) => rec(progress, b.id).w - rec(progress, a.id).w || rec(progress, a.id).t - rec(progress, b.id).t);
  fresh.sort((a, b) => lessonOrder(a.lesson) - lessonOrder(b.lesson) || a.order - b.order);
  const nReview = Math.min(review.length, Math.round(size * REVIEW_SHARE));
  const picked = review.slice(0, nReview);
  picked.push(...fresh.slice(0, size - picked.length));
  if (picked.length < size) picked.push(...review.slice(nReview, nReview + size - picked.length));
  return picked;
}

// 習得済みの単語だけで復習ラウンドを作る（範囲を全部習得したとき）
export function pickReviewCards(cards, progress, size, rng = Math.random) {
  const done = cards.filter((c) => rec(progress, c.id).s === MASTERED);
  return shuffle(done, rng)
    .sort((a, b) => rec(progress, b.id).w - rec(progress, a.id).w)
    .slice(0, size);
}

// 保存してそのまま再開できる、ただのオブジェクトとしてラウンドを持つ
export function newRound(cards, progress, rng = Math.random) {
  const ordered = shuffle(cards, rng);
  return {
    ids: ordered.map((c) => c.id),
    queue: ordered.map((c) => ({ id: c.id, type: questionType(c, rec(progress, c.id)), retry: 0 })),
    pos: 0,
    missed: {},
    startedAt: Date.now(),
  };
}

export const roundDone = (round) => round.pos >= round.queue.length;

/**
 * 回答を反映する（進捗とラウンドの両方を書き換える）。
 * 戻り値は「正解にする」で取り消すための控え。
 */
export function applyAnswer(round, progress, correct, { needWritten = 1 } = {}) {
  const item = round.queue[round.pos];
  const undo = { pos: round.pos, rec: progress[item.id] ? { ...progress[item.id] } : undefined, missed: round.missed[item.id], queueLen: round.queue.length, queue: round.queue.slice() };
  const r = rec(progress, item.id);
  if (!item.retry) {
    if (item.type === 'mc') {
      put(progress, item.id, correct ? { ...r, s: LEARNING, wc: 0 } : { ...r, s: UNSEEN, w: r.w + 1, wc: 0 });
    } else if (correct) {
      const wc = r.wc + 1;
      put(progress, item.id, { ...r, wc, s: wc >= needWritten ? MASTERED : LEARNING });
    } else {
      put(progress, item.id, { ...r, s: LEARNING, w: r.w + 1, wc: 0 });
    }
  } else if (!correct) {
    // 出し直しで正解しても段階は上げない。間違えたら間違い回数だけ数える
    put(progress, item.id, { ...r, w: r.w + 1 });
  } else {
    put(progress, item.id, r);
  }
  if (!correct) {
    round.missed[item.id] = true;
    if (item.retry < RETRY_MAX) {
      const at = Math.min(round.pos + 1 + RETRY_GAP, round.queue.length);
      round.queue.splice(at, 0, { id: item.id, type: item.type, retry: item.retry + 1 });
    }
  }
  round.pos++;
  return undo;
}

export function undoAnswer(round, progress, undo) {
  const id = round.queue[undo.pos].id;
  if (undo.rec) progress[id] = undo.rec;
  else delete progress[id];
  round.queue = undo.queue;
  if (undo.missed) round.missed[id] = true;
  else delete round.missed[id];
  round.pos = undo.pos;
}

// ラウンド終了時の一覧: 要復習（このラウンドで間違えた）／習得／学習中
export function roundSummary(round, progress) {
  return round.ids.map((id) => ({
    id,
    status: round.missed[id] ? 'review' : rec(progress, id).s === MASTERED ? 'mastered' : 'learning',
  }));
}
