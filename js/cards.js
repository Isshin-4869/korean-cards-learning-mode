// カードデータの読み込み・分類・ID 付け。ブラウザと Node（テスト）の両方で動く。

export const LESSON_CONVERSATION = '会話表現';

// 種別（絞り込み用）: 単語 / 文法 / 会話表現
export const TYPES = ['単語', '文法', '会話表現'];

// 分類（出題の仕方を変えるため）
export const KIND_WORD = 'word';       // 語
export const KIND_SENTENCE = 'sentence'; // 文
export const KIND_PATTERN = 'pattern';   // 文型・解説

export const KIND_LABEL = { word: '語', sentence: '文', pattern: '文型' };

// ---- 分類の判定基準（調整するときはここだけ触る） ----
export const CLASSIFY_RULES = {
  // 用語にこれらが含まれていたら文型・解説
  patternMarks: ['/', '／', '·', '・', '→', '[', '○○', '+', '='],
  // 用語の先頭がこれなら文型・解説（語尾・助詞の形）
  patternPrefixes: ['-', '－'],
  // 用語に単独の字母（ㄱ, ㅏ など）を含むなら文型・解説（「ㄷ 불규칙」など）
  standaloneJamo: /[ㄱ-ㆎ]/,
  // 定義（注記を除く）がこの文字数を超え、かつ文でないなら解説とみなす
  longDefinition: 24,
  // 定義にこれを含むなら解説（「～で：母音終わり…」のような説明）
  explanationMarks: ['：'],
  // 文末記号
  sentenceEnd: /[.?!。？！]$/,
};

export function classify({ lesson, type, term, definition }) {
  const r = CLASSIFY_RULES;
  const t = term.trim();
  if (r.patternPrefixes.some((p) => t.startsWith(p))) return KIND_PATTERN;
  if (r.patternMarks.some((m) => t.includes(m))) return KIND_PATTERN;
  if (r.standaloneJamo.test(t)) return KIND_PATTERN;
  if (r.explanationMarks.some((m) => definition.includes(m))) return KIND_PATTERN;
  if (lesson === LESSON_CONVERSATION) return KIND_SENTENCE;
  if (type === '文法' && r.sentenceEnd.test(t)) return KIND_SENTENCE;
  if (stripNotes(definition).length > r.longDefinition) return KIND_PATTERN;
  return KIND_WORD;
}

// （注記）・[発音]・⚠以降を取り除く（判定・同一判定用。表示には元の文字列を使う）
export function stripNotes(s) {
  return s
    .replace(/⚠.*$/s, '')
    .replace(/[（(][^（）()]*[）)]/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// cyrb53: 短く安定した 53bit ハッシュ
export function hash53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function cardId(lesson, type, term, definition) {
  return 'c' + hash53([lesson, type, term, definition].map((s) => s.normalize('NFC')).join('␟'));
}

// 「第10課」→ 10、会話表現 → 99（並び順用）
export function lessonOrder(lesson) {
  const m = /^第(\d+)課$/.exec(lesson);
  return m ? Number(m[1]) : 99;
}

// 絞り込み用の種別（会話表現の行は種別列にテーマ名が入っている）
export function filterType(card) {
  return card.lesson === LESSON_CONVERSATION ? '会話表現' : card.type;
}

// 別の課に同じ用語・同じ定義があるとき同一扱いにするためのキー
export function sameKey(term, definition) {
  return stripNotes(term.normalize('NFC')) + '␟' + stripNotes(definition.normalize('NFC'));
}

/**
 * md（または ```text ブロックの中身だけ）を読み込む。
 * 戻り値: { cards, issues }
 *   issues: 列数違い・不明な課・同一行の重複など
 */
export function parseCardsMarkdown(md) {
  const text = md.replace(/\r\n?/g, '\n');
  const block = /```text\n([\s\S]*?)```/.exec(text);
  const body = block ? block[1] : text;
  const lines = body.split('\n');
  const cards = [];
  const issues = [];
  const seen = new Map();
  let headerSkipped = false;
  lines.forEach((raw, i) => {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) return;
    const cols = line.split('\t');
    if (!headerSkipped && cols[0] === '課') {
      headerSkipped = true;
      return;
    }
    if (cols.length !== 4) {
      issues.push({ line: i + 1, kind: 'columns', text: line });
      return;
    }
    const [lesson, type, term, definition] = cols.map((c) => c.trim().normalize('NFC'));
    if (!/^第\d+課$/.test(lesson) && lesson !== LESSON_CONVERSATION) {
      issues.push({ line: i + 1, kind: 'lesson', text: line });
      return;
    }
    if (lesson !== LESSON_CONVERSATION && type !== '単語' && type !== '文法') {
      issues.push({ line: i + 1, kind: 'type', text: line });
    }
    if (!term || !definition) {
      issues.push({ line: i + 1, kind: 'empty', text: line });
      return;
    }
    const id = cardId(lesson, type, term, definition);
    if (seen.has(id)) {
      issues.push({ line: i + 1, kind: 'duplicate', text: line, firstLine: seen.get(id) });
      return;
    }
    seen.set(id, i + 1);
    const card = { id, lesson, type, term, definition };
    card.kind = classify(card);
    card.ftype = filterType(card);
    card.order = cards.length;
    card.same = sameKey(term, definition);
    cards.push(card);
  });
  return { cards, issues };
}

export function countCards(cards) {
  const byLesson = {};
  const byType = { 単語: 0, 文法: 0, 会話表現: 0 };
  const byKind = { word: 0, sentence: 0, pattern: 0 };
  for (const c of cards) {
    byLesson[c.lesson] ??= { 単語: 0, 文法: 0, 会話表現: 0, total: 0 };
    byLesson[c.lesson][c.ftype]++;
    byLesson[c.lesson].total++;
    byType[c.ftype]++;
    byKind[c.kind]++;
  }
  return { total: cards.length, byLesson, byType, byKind };
}

export function lessonsOf(cards) {
  return [...new Set(cards.map((c) => c.lesson))].sort((a, b) => lessonOrder(a) - lessonOrder(b));
}
