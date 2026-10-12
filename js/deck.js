// カード集合に対する処理: 範囲の絞り込み、出題の向き、正解の候補、4択の誤答候補

import { lessonOrder, stripNotes, KIND_PATTERN, KIND_SENTENCE } from './cards.js';
import { normalizeForCompare, speechParts, answerVariants } from './answer.js';

// dir: 'ko' = 韓国語を見て日本語で答える / 'ja' = 日本語を見て韓国語で答える
export const promptText = (card, dir) => (dir === 'ko' ? card.term : card.definition);
export const answerText = (card, dir) => (dir === 'ko' ? card.definition : card.term);

// 同じ文字列かどうかの判定キー（注記・空白・文末記号を無視）
export const textKey = (s) => normalizeForCompare(s);

export function makeRng(seed = Date.now()) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function rangeKey(sel) {
  return [...sel.lessons].sort((a, b) => lessonOrder(a) - lessonOrder(b)).join(',') + '|' + [...sel.types].sort().join(',');
}

export class Deck {
  constructor(cards) {
    this.cards = cards;
    this.byId = new Map(cards.map((c) => [c.id, c]));
    this.byPrompt = { ko: new Map(), ja: new Map() };
    for (const c of cards) {
      for (const dir of ['ko', 'ja']) {
        const k = textKey(promptText(c, dir));
        const list = this.byPrompt[dir].get(k) ?? [];
        list.push(c);
        this.byPrompt[dir].set(k, list);
      }
    }
  }

  // 打ち間違いが別のカードの正解になっていないか調べるための、全カードの正解の集合
  rejectKeys(dir) {
    this._reject ??= {};
    if (!this._reject[dir]) {
      const set = new Set();
      for (const c of this.cards) {
        const a = answerText(c, dir);
        for (const v of [a, ...answerVariants(a, { splitComma: splitCommaFor(c) })]) set.add(textKey(v));
      }
      this._reject[dir] = set;
    }
    return this._reject[dir];
  }

  get(id) {
    return this.byId.get(id);
  }

  inRange(sel) {
    const ls = new Set(sel.lessons);
    const ts = new Set(sel.types);
    return this.cards.filter((c) => ls.has(c.lesson) && ts.has(c.ftype));
  }

  // 同じ問題文になるカード（「일」→ 1 と ～日）の答えもまとめて返す
  answersFor(card, dir) {
    const same = this.byPrompt[dir].get(textKey(promptText(card, dir))) ?? [card];
    const list = [answerText(card, dir)];
    for (const c of same) if (c !== card) list.push(answerText(c, dir));
    return list;
  }

  /**
   * 4択の選択肢。誤答は正解と同じ分類から、なるべく同じ種別・近い課を選ぶ。
   * 正解と同じ文字列のもの、同じ問題文で別の正解になるものは除く。
   */
  choices(card, dir, n = 4, rng = Math.random) {
    const correct = answerText(card, dir);
    const banned = new Set(this.answersFor(card, dir).map(textKey));
    const promptK = textKey(promptText(card, dir));
    const lo = lessonOrder(card.lesson);
    const pick = (pool) => {
      const scored = pool
        .filter((c) => c !== card && !banned.has(textKey(answerText(c, dir))) && textKey(promptText(c, dir)) !== promptK)
        .map((c) => ({
          c,
          s: (c.ftype === card.ftype ? 0 : 8) + Math.min(Math.abs(lessonOrder(c.lesson) - lo), 10) + rng() * 4,
        }))
        .sort((a, b) => a.s - b.s);
      const out = [];
      const used = new Set();
      for (const { c } of scored) {
        const k = textKey(answerText(c, dir));
        if (used.has(k)) continue;
        used.add(k);
        out.push(c);
        if (out.length >= n - 1) break;
      }
      return out;
    };
    let wrong = pick(this.cards.filter((c) => c.kind === card.kind));
    if (wrong.length < n - 1) {
      const extra = pick(this.cards.filter((c) => c.kind !== card.kind && !wrong.includes(c)));
      wrong = wrong.concat(extra.filter((c) => !wrong.some((w) => textKey(answerText(w, dir)) === textKey(answerText(c, dir))))).slice(0, n - 1);
    }
    return shuffle(
      [{ id: card.id, text: correct, correct: true }, ...wrong.map((c) => ({ id: c.id, text: answerText(c, dir), correct: false }))],
      rng,
    );
  }

  // 1組ずつ用語も定義も重ならないカードを選ぶ（マッチ・線結び用）
  distinctPairs(pool, n, rng = Math.random) {
    const terms = new Set();
    const defs = new Set();
    const out = [];
    for (const c of shuffle(pool, rng)) {
      const t = textKey(c.term);
      const d = textKey(c.definition);
      if (terms.has(t) || defs.has(d)) continue;
      terms.add(t);
      defs.add(d);
      out.push(c);
      if (out.length >= n) break;
    }
    return out;
  }
}

// 記述問題に出せるか（文型・解説は記述に出さない）
export const canWrite = (card) => card.kind !== KIND_PATTERN;

// スペル（聞き取り）の対象: 語と短い文。文型・解説と「○○」を含むものは除く
export const SPELL_MAX_SENTENCE = 16;
export function canSpell(card) {
  if (card.kind === KIND_PATTERN || card.term.includes('○○')) return false;
  if (!speechParts(card.term).length) return false;
  if (card.kind === KIND_SENTENCE && textKey(card.term).length > SPELL_MAX_SENTENCE) return false;
  return true;
}

// 「、」で答えを分けるか（文は分けない）
export const splitCommaFor = (card) => card.kind !== KIND_SENTENCE;

export const displayText = (s) => stripNotes(s);
