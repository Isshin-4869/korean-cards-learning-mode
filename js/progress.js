// 進捗（全モード共通）: s = 0 未学習 / 1 学習中 / 2 習得、w = 間違い回数、wc = 記述（または逆向き4択）の連続正解数、t = 最後に出題した時刻
// k = 日をまたいで正解し続けた回数（記憶の見積もりに使う。js/memory.js）

export const UNSEEN = 0;
export const LEARNING = 1;
export const MASTERED = 2;

export function rec(progress, id) {
  return progress[id] ?? { s: UNSEEN, w: 0, wc: 0, t: 0 };
}

export function put(progress, id, r) {
  progress[id] = { ...r, t: Date.now() };
}

// テスト・スペルで間違えたとき: 間違い回数を増やし、習得済みなら学習中に戻す
export function markWrongOutsideLearn(progress, id) {
  const r = rec(progress, id);
  put(progress, id, { ...r, w: r.w + 1, wc: 0, k: 0, s: r.s === MASTERED ? LEARNING : r.s });
}

// テスト・スペルで正解したとき: 段階は変えず、出題した時刻と k だけ更新する（k は js/memory.js の nextK で計算して渡す）
export function markRightOutsideLearn(progress, id, k) {
  const r = rec(progress, id);
  if (r.s === UNSEEN) return;
  put(progress, id, { ...r, k });
}

export function summarize(cards, progress) {
  const out = { total: cards.length, mastered: 0, learning: 0, unseen: 0 };
  for (const c of cards) {
    const s = rec(progress, c.id).s;
    if (s === MASTERED) out.mastered++;
    else if (s === LEARNING) out.learning++;
    else out.unseen++;
  }
  return out;
}
