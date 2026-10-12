// アプリの状態。読み書きは Store を通す。
// 回答するたびに進捗とセッション（途中経過）を保存するので、途中でアプリを閉じても続きから再開できる。

import { Store } from './store.js';
import { parseCardsMarkdown, lessonsOf, TYPES } from './cards.js';
import { Deck, rangeKey } from './deck.js';

export const APP_VERSION = '1.0.2';
export const BACKUP_FORMAT = 'korean-cards-backup';

export const DEFAULT_SETTINGS = {
  roundSize: 7,
  direction: 'auto', // auto: 4択は韓→日、記述は日→韓 / ko / ja / mix
  needWritten: 1, // 2 なら「2回正解で習得」
  autoSpeak: true,
  allowTypo: true,
  strictSpacing: false,
  theme: 'auto',
  flashFront: 'ko',
  flashShuffle: false,
};

export const state = {
  cards: [],
  deck: null,
  lessons: [],
  settings: { ...DEFAULT_SETTINGS },
  selection: { lessons: ['第1課'], types: [...TYPES] },
  progress: {},
  flash: {}, // 単語カードの「覚えた」印（進捗とは別）
  matchBest: {},
  accepted: {}, // 「正解にする」で覚えた答え: cardId → { ko: [...], ja: [...] }
  sessions: {}, // mode → 途中経過
  cardsSource: 'bundled',
  // 同期用: キーごとの最終更新時刻と、進捗をリセットした時刻（端末内だけに保存）
  syncMeta: { updated: {}, resetAt: 0 },
};

// クラウドと同期するキー（途中経過のセッションは端末内だけ）
export const SYNC_KEYS = ['settings', 'selection', 'progress', 'flash', 'matchBest', 'accepted'];

const changeListeners = new Set();
export const onChange = (fn) => changeListeners.add(fn);

function touch(key) {
  state.syncMeta.updated[key] = Date.now();
  Store.set('syncMeta', state.syncMeta);
  for (const fn of changeListeners) fn(key);
}

// 同期で受け取った値を反映する（変更通知は出さない）
export async function applySynced(key, value, updatedAt) {
  state[key] = key === 'settings' ? { ...DEFAULT_SETTINGS, ...value } : value;
  state.syncMeta.updated[key] = updatedAt;
  await Store.set(key, state[key]);
  await Store.set('syncMeta', state.syncMeta);
}

export async function setResetAt(t) {
  state.syncMeta.resetAt = t;
  await Store.set('syncMeta', state.syncMeta);
}

export async function loadCards() {
  const custom = await Store.get('cardsMd');
  let md = custom;
  state.cardsSource = custom ? 'custom' : 'bundled';
  if (!md) md = await (await fetch('data/cards.md')).text();
  setCards(parseCardsMarkdown(md).cards);
}

export function setCards(cards) {
  state.cards = cards;
  state.deck = new Deck(cards);
  state.lessons = lessonsOf(cards);
}

export async function loadState() {
  const [settings, selection, progress, flash, matchBest, accepted] = await Promise.all(
    ['settings', 'selection', 'progress', 'flash', 'matchBest', 'accepted'].map((k) => Store.get(k)),
  );
  state.settings = { ...DEFAULT_SETTINGS, ...(settings ?? {}) };
  if (selection) state.selection = selection;
  state.progress = progress ?? {};
  state.flash = flash ?? {};
  state.matchBest = matchBest ?? {};
  state.accepted = accepted ?? {};
  state.syncMeta = { updated: {}, resetAt: 0, ...((await Store.get('syncMeta')) ?? {}) };
  for (const m of ['learn', 'flash', 'test', 'spell']) state.sessions[m] = (await Store.get('session:' + m)) ?? null;
  await loadCards();
  // データ更新で消えた課を選択から外す
  state.selection.lessons = state.selection.lessons.filter((l) => state.lessons.includes(l));
  if (!state.selection.lessons.length && state.lessons.length) state.selection.lessons = [state.lessons[0]];
}

export const save = Object.fromEntries(SYNC_KEYS.map((k) => [k, () => {
  touch(k);
  return Store.set(k, state[k]);
}]));

export function saveSession(mode, data) {
  state.sessions[mode] = data;
  return data ? Store.set('session:' + mode, data) : Store.delete('session:' + mode);
}

export const currentRangeKey = () => rangeKey(state.selection);
export const cardsInRange = () => state.deck.inRange(state.selection);

export function rangeLabel(sel = state.selection) {
  const ls = state.lessons.filter((l) => sel.lessons.includes(l));
  if (!ls.length) return '課が未選択';
  const nums = ls.filter((l) => l !== '会話表現').map((l) => Number(l.replace(/\D/g, '')));
  const parts = [];
  for (let i = 0; i < nums.length; i++) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
    parts.push(i === j ? `${nums[i]}` : `${nums[i]}〜${nums[j]}`);
    i = j;
  }
  const label = parts.length ? `第${parts.join('・')}課` : '';
  return [label, ls.includes('会話表現') ? '会話表現' : ''].filter(Boolean).join('＋');
}

// ---- バックアップ ----
export function makeBackup() {
  return {
    format: BACKUP_FORMAT,
    version: 1,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    settings: state.settings,
    selection: state.selection,
    progress: state.progress,
    flash: state.flash,
    matchBest: state.matchBest,
    accepted: state.accepted,
  };
}

export async function restoreBackup(obj) {
  if (!obj || obj.format !== BACKUP_FORMAT || typeof obj.progress !== 'object') throw new Error('このアプリのバックアップファイルではありません');
  state.settings = { ...DEFAULT_SETTINGS, ...(obj.settings ?? {}) };
  if (obj.selection?.lessons) state.selection = obj.selection;
  // 復元した内容をクラウドより優先させる: それ以前の記録は捨て、復元した記録には今の時刻を付ける
  const now = Date.now();
  await setResetAt(now - 1);
  state.progress = Object.fromEntries(Object.entries(obj.progress ?? {}).map(([id, r]) => [id, { ...r, u: now }]));
  state.flash = obj.flash ?? {};
  state.matchBest = obj.matchBest ?? {};
  state.accepted = obj.accepted ?? {};
  await Promise.all([save.settings(), save.selection(), save.progress(), save.flash(), save.matchBest(), save.accepted()]);
  for (const m of Object.keys(state.sessions)) await saveSession(m, null);
}

export async function resetProgress() {
  await setResetAt(Date.now());
  state.progress = {};
  state.flash = {};
  state.matchBest = {};
  await Promise.all([save.progress(), save.flash(), save.matchBest()]);
  for (const m of Object.keys(state.sessions)) await saveSession(m, null);
}

// md を読み込み直す。ID は内容から決まるので、変わっていないカードの進捗はそのまま引き継がれる
export async function importCardsMarkdown(md) {
  const { cards, issues } = parseCardsMarkdown(md);
  if (!cards.length) throw new Error('カードが1枚も読み込めませんでした');
  const before = new Set(state.cards.map((c) => c.id));
  const after = new Set(cards.map((c) => c.id));
  const added = cards.filter((c) => !before.has(c.id)).length;
  const removed = [...before].filter((id) => !after.has(id)).length;
  const kept = cards.filter((c) => before.has(c.id) && state.progress[c.id]).length;
  await Store.set('cardsMd', md);
  state.cardsSource = 'custom';
  setCards(cards);
  state.selection.lessons = state.selection.lessons.filter((l) => state.lessons.includes(l));
  if (!state.selection.lessons.length) state.selection.lessons = [state.lessons[0]];
  await save.selection();
  for (const m of Object.keys(state.sessions)) await saveSession(m, null);
  return { total: cards.length, added, removed, kept, issues };
}

export async function useBundledCards() {
  await Store.delete('cardsMd');
  await loadCards();
}
