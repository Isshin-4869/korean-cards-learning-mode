// 記憶の見積もり（あくまで目安）。
// 単語ごとに「記憶の持ち（日）」S を決め、最後に出題してからの経過日数 d で、思い出せる見込みを R = e^(-d/S) とする。
// S は段階（学習中 1.5 日・習得 4 日）を、日をまたいで正解し続けた回数 k だけ 2 倍ずつ伸ばし、間違いが多いほど縮める。
// → 習得した単語の復習どきは、およそ 1.4・2.9・5.7・11・23 日…と間隔が広がる。

import { rec, LEARNING, MASTERED } from './progress.js';

export const DAY = 864e5;
export const DUE_AT = 0.7; // これを下回ったら「復習どき」
export const FORGET_AT = 0.6; // グラフの「忘れかけ」の線
const BASE = { [LEARNING]: 1.5, [MASTERED]: 4 };
const K_MAX = 8;

export const jstDate = (ms) => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10);

export function stability(r) {
  const base = BASE[r?.s];
  if (!base) return 0;
  return (base * 2 ** Math.min(r.k ?? 0, K_MAX)) / (1 + 0.15 * Math.min(r.w ?? 0, 10));
}

/** 思い出せる見込み（0〜1）。まだ学習していない単語は null */
export function recall(r, now = Date.now()) {
  const S = stability(r);
  if (!S || !r.t) return null;
  return Math.exp(-Math.max(0, now - r.t) / DAY / S);
}

/**
 * 回答したときの k（日をまたいだ連続正解の回数）。put する前の記録 prev から計算する。
 * 同じ日のうちに何度正解しても 1 回分。間違えたら 0 に戻す。
 */
export function nextK(prev, correct, now = Date.now()) {
  if (!correct) return 0;
  const k = prev?.k ?? 0;
  if (!prev?.t || jstDate(prev.t) === jstDate(now)) return k;
  return Math.min(k + 1, K_MAX);
}

/** 復習どきの単語（見込みの低い順）。limit 枚まで */
export function dueCards(cards, progress, now = Date.now(), limit = Infinity) {
  const out = [];
  for (const c of cards) {
    const R = recall(rec(progress, c.id), now);
    if (R != null && R < DUE_AT) out.push([c, R]);
  }
  out.sort((a, b) => a[1] - b[1]);
  return out.slice(0, limit).map(([c]) => c);
}

/** 今日から days 日後まで、このまま復習しなかったときの平均の見込み（%）と、学習した枚数 */
export function forecast(cards, progress, now = Date.now(), days = 7) {
  const rs = [];
  for (const c of cards) {
    const r = rec(progress, c.id);
    if (stability(r) && r.t) rs.push(r);
  }
  const values = Array.from({ length: days + 1 }, (_, d) => {
    if (!rs.length) return 0;
    const t = now + d * DAY;
    return Math.round((rs.reduce((s, r) => s + recall(r, t), 0) / rs.length) * 100);
  });
  const below = values.findIndex((v) => v < FORGET_AT * 100);
  return { values, studied: rs.length, belowDay: below };
}
