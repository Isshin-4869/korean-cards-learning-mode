// 答え合わせ（記述問題・スペル共通）

import { stripNotes } from './cards.js';

// 比較用にそろえる: NFKC（全角半角）→ 注記除去 → 波ダッシュ統一 → 文末記号除去 → 空白整理 → NFC
export function normalizeForCompare(s, { ignoreSpacing = true } = {}) {
  let t = String(s).normalize('NFKC');
  t = stripNotes(t);
  t = t.replace(/[〜～~]/g, ''); // 「～に」と「に」を同じにする
  t = t.trim().replace(/[.?!。？！]+$/u, '').trim();
  t = t.replace(/\s+/g, ignoreSpacing ? '' : ' ');
  return t.normalize('NFC');
}

// 「A / B」「A、B」をそれぞれの候補に分ける。文のカードでは「、」で分けない（「皆さん、こんにちは」を分けないため）
export function answerVariants(answer, { splitComma = true } = {}) {
  const base = stripNotes(String(answer).normalize('NFKC'));
  const sep = splitComma ? /\s*[\/、]\s*/ : /\s*\/\s*/;
  const parts = base.split(sep).map((p) => p.trim()).filter(Boolean);
  return parts.length ? parts : [base];
}

// 字母（NFD）に分解した編集距離
export function jamoDistance(a, b) {
  const x = [...a.normalize('NFD')];
  const y = [...b.normalize('NFD')];
  const prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= y.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (x[i - 1] === y[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[y.length];
}

// 1文字ミス許容は語（空白区切り）ごとに判定する（Duolingo と同じ考え方）。
// 字母に分解した長さが 4 以上の語は 1 字母まで、12 以上の語は 2 字母まで。短い語は許容しない（「이」と「일」を区別するため）
export const NEAR_MIN_LENGTH = 4;
export const NEAR_TWO_LENGTH = 12;
const typoBudget = (w) => {
  const n = [...w.normalize('NFD')].length;
  return n >= NEAR_TWO_LENGTH ? 2 : n >= NEAR_MIN_LENGTH ? 1 : 0;
};

// got・target は空白を1つにそろえた文字列。語数が同じなら語ごと、違えば（分かち書き違い）全体で判定
function withinTypo(got, target, strictSpacing) {
  const gw = got.split(' ');
  const tw = target.split(' ');
  if (gw.length === tw.length) {
    let diff = 0;
    for (let i = 0; i < tw.length; i++) {
      const d = jamoDistance(gw[i], tw[i]);
      if (d > typoBudget(tw[i])) return false;
      diff += d;
    }
    return diff > 0;
  }
  if (strictSpacing) return false;
  const a = got.replace(/ /g, '');
  const b = target.replace(/ /g, '');
  const d = jamoDistance(a, b);
  return d > 0 && d <= Math.min(typoBudget(b), Math.max(1, tw.length));
}

/**
 * 判定する。
 * @param {string} input 入力
 * @param {string|string[]} answers 正解（カードの用語または定義。同一扱いのカードの分、「正解にする」で覚えた答えも渡せる）
 * @param {{ignoreSpacing?: boolean, allowTypo?: boolean, splitComma?: boolean, reject?: Set<string>}} opts
 *   reject: ほかのカードの正解（normalizeForCompare 済み）。打ち間違いの結果がそれと同じなら、別の単語として不正解にする
 * @returns {{correct: boolean, near: boolean, spacing: boolean, matched: string|null}}
 *   near: 打ち間違いを許容して正解 / spacing: 分かち書きだけが違って正解
 */
export function checkAnswer(input, answers, opts = {}) {
  const { ignoreSpacing = true, allowTypo = true, splitComma = true, reject } = opts;
  const no = { correct: false, near: false, spacing: false, matched: null };
  const got = normalizeForCompare(input, { ignoreSpacing: false });
  if (!got) return no;
  const gotFlat = got.replace(/ /g, '');
  const list = (Array.isArray(answers) ? answers : [answers]).flatMap((a) => [a, ...answerVariants(a, { splitComma })]);
  const cands = list.map((a) => [a, normalizeForCompare(a, { ignoreSpacing: false })]).filter(([, n]) => n);
  for (const [a, n] of cands) if (n === got) return { ...no, correct: true, matched: a };
  for (const [a, n] of cands) {
    if (n.replace(/ /g, '') === gotFlat) return ignoreSpacing ? { ...no, correct: true, spacing: true, matched: a } : no;
  }
  if (!allowTypo || reject?.has(gotFlat)) return no;
  for (const [a, n] of cands) {
    if (withinTypo(got, n, !ignoreSpacing)) return { ...no, correct: true, near: true, matched: a };
  }
  return no;
}

// 入力と正解の違いを表示用に分ける（音節単位の LCS）。op: same / miss（正解にあって入力にない・違う）
export function diffAnswer(input, answer) {
  const a = [...String(input).normalize('NFC').replace(/\s+/g, '')];
  const b = [...String(answer).normalize('NFC')];
  const bi = b.map((ch, i) => [ch, i]).filter(([ch]) => !/\s/.test(ch));
  const n = a.length;
  const m = bi.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === bi[j][0] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const same = new Set();
  for (let i = 0, j = 0; i < n && j < m;) {
    if (a[i] === bi[j][0]) { same.add(bi[j][1]); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++;
  }
  const out = [];
  b.forEach((ch, i) => {
    const op = /\s/.test(ch) || same.has(i) ? 'same' : 'miss';
    if (out.length && out[out.length - 1].op === op) out[out.length - 1].t += ch;
    else out.push({ t: ch, op });
  });
  return out;
}

// 読み上げ用: [発音]・（注記）・○○・⚠以降を除き、「/」「·」区切りは順に読む部分に分ける
export function speechParts(term) {
  const parts = splitForSpeech(String(term).replace(/\[[^\]]*\]/g, ''));
  // 「[임니다]」のように発音表記だけのカードは、その発音を読む
  return parts.length ? parts : splitForSpeech(String(term).replace(/[\[\]]/g, ''));
}

function splitForSpeech(s) {
  return s
    .replace(/⚠.*$/s, '')
    .replace(/[（(][^（）()]*[）)]/g, '')
    .replace(/○○/g, '')
    .split(/\s*(?:\/|／|·|・|→|=|\+)\s*/)
    .map((p) => p.replace(/^[-－~～]+/, '').replace(/\s+/g, ' ').trim())
    .filter((p) => /[가-힣]/.test(p));
}
