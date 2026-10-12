// ホーム画面ウィジェット（Scriptable）とアイコンのバッジ。
// 選んでいる範囲の要約を Cloudflare Worker（/summary）に置き、ウィジェットは GET /widget/<token> で読む。
// 要約は数字だけ（カードの中身は送らない）。送るのは中身が変わったときだけで、多くても 2 分に 1 回。

import { PUSH } from './config.js';
import { Store } from './store.js';
import { idToken, currentUser } from './firebase.js';
import { state as appState, onChange, rangeLabel } from './state.js';
import { rangeKey } from './deck.js';
import { summarize, rec, MASTERED, LEARNING } from './progress.js';

const TOKEN_KEY = 'widgetToken'; // { uid, token }
const SENT_KEY = 'widgetSent'; // 最後に送れた要約（updatedAt なしの JSON）
const MIN_GAP = 2 * 60 * 1000;
const JST_OFFSET = 9 * 3600 * 1000;

export const widgetConfigured = () => !!PUSH.workerUrl;
const base = () => PUSH.workerUrl.replace(/\/$/, '');

// 以下 2 つは js/planet.js の stageOf / rangePlanetName と必ず同じにすること（アプリとウィジェットで星が変わってしまう）
// 習得率・学習中の率（0〜100、丸めない値）→ 惑星の段階
export function stageOf(mastered, learning = 0) {
  if (mastered >= 100) return 5;
  if (mastered >= 75) return 4;
  if (mastered >= 50) return 3;
  if (mastered >= 25) return 2;
  return mastered > 0 || learning > 0 ? 1 : 0;
}
// 範囲の惑星の名前（seed 用）。課の組み合わせで決まる
const rangePlanetName = (key) => 'range:' + key.split('|')[0];
const stageFor = (m, l, total) => (total ? stageOf((m / total) * 100, (l / total) * 100) : 0);

// 100% は全部習得したときだけ（四捨五入で 100 にしない）
const pctOf = (m, total) => (!total ? 0 : m >= total ? 100 : Math.min(99, Math.round((m / total) * 100)));
const jstDate = (ms) => new Date(ms + JST_OFFSET).toISOString().slice(0, 10);

/** ウィジェットに渡す要約（2KB 未満）。rangeLabel はアプリの状態の課一覧を使う。pct は表示用に丸めた値、stage は丸めない値から */
export function buildSummary(s = appState, now = Date.now()) {
  const sel = s.selection;
  const sum = summarize(s.deck.inRange(sel), s.progress);
  const pct = pctOf(sum.mastered, sum.total);
  const day = jstDate(now);
  let today = 0;
  for (const r of Object.values(s.progress)) if (r?.t && jstDate(r.t) === day) today++;
  // 課ごと: ホームの課のタイルと同じく、選んでいる種別で数える（その課に該当がなければ全種別）
  const lessons = s.lessons.map((l) => {
    const inLesson = s.cards.filter((c) => c.lesson === l);
    const typed = inLesson.filter((c) => sel.types.includes(c.ftype));
    const cs = typed.length ? typed : inLesson;
    let m = 0;
    let ln = 0;
    for (const c of cs) {
      const st = rec(s.progress, c.id).s;
      if (st === MASTERED) m++;
      else if (st === LEARNING) ln++;
    }
    return { n: l === '会話表現' ? '会話' : l.replace(/\D/g, ''), pct: pctOf(m, cs.length), stage: stageFor(m, ln, cs.length) };
  });
  return {
    range: rangeLabel(sel),
    total: sum.total,
    mastered: sum.mastered,
    learning: sum.learning,
    unseen: sum.unseen,
    pct,
    stage: stageFor(sum.mastered, sum.learning, sum.total),
    seed: rangePlanetName(rangeKey(sel)), // ウィジェットは seedOf(seed) で模様を決める
    today,
    lessons,
    updatedAt: now,
  };
}

const withoutTime = (summary) => JSON.stringify({ ...summary, updatedAt: undefined });

// ---- token（ウィジェットの URL） ----
let saved = null; // { uid, token }
let loaded = false;

export async function loadWidgetToken() {
  if (!loaded) {
    saved = (await Store.get(TOKEN_KEY)) ?? null;
    loaded = true;
  }
  return widgetUrl();
}

async function saveToken(token) {
  const uid = currentUser()?.uid;
  if (!uid || !token || (saved?.uid === uid && saved.token === token)) return;
  saved = { uid, token };
  loaded = true;
  await Store.set(TOKEN_KEY, saved);
}

/** ウィジェットに貼る URL。まだ作っていなければ null */
export function widgetUrl() {
  const uid = currentUser()?.uid;
  if (!widgetConfigured() || !uid || !saved?.token || saved.uid !== uid) return null;
  return `${base()}/widget/${saved.token}`;
}

async function api(path, body = {}) {
  const res = await fetch(base() + path, {
    method: 'POST',
    headers: { authorization: `Bearer ${await idToken()}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`ウィジェットのサーバーのエラー（${res.status}${json.error ? ` ${json.error}` : ''}）`);
  return json;
}

// ---- 送信 ----
let lastPostAt = 0;
let timer = null;
let inflight = null;
let pending = false; // 送れていない変更がある（圏外などで失敗したときも残る）

/** 今すぐ送る。中身が前回と同じなら送らない（force なら必ず送る） */
export async function postSummary({ force = false } = {}) {
  if (!widgetConfigured() || !currentUser() || !appState.deck) return null;
  if (inflight) return inflight;
  inflight = (async () => {
    await loadWidgetToken();
    const summary = buildSummary();
    const key = withoutTime(summary);
    const last = await Store.get(SENT_KEY);
    if (key === last?.key && last.uid === currentUser()?.uid && widgetUrl() && !force) {
      pending = false;
      return widgetUrl();
    }
    lastPostAt = Date.now();
    const r = await api('/summary', { summary });
    await saveToken(r.token);
    await Store.set(SENT_KEY, { uid: currentUser()?.uid, key });
    pending = false;
    return widgetUrl();
  })();
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

/** 変更があったら送る予約。前回から 2 分たっていなければ、その時刻まで待つ */
export function scheduleSummary() {
  if (!widgetConfigured() || !currentUser()) return;
  pending = true;
  if (timer) return;
  const wait = Math.max(0, lastPostAt + MIN_GAP - Date.now());
  timer = setTimeout(() => {
    timer = null;
    postSummary().catch(() => {});
  }, wait);
}

/** アプリが裏に回るときなど。送れていない変更があればすぐ送る */
export function flushSummary() {
  if (!pending) return Promise.resolve(null);
  clearTimeout(timer);
  timer = null;
  return postSummary().catch(() => null);
}

/** URL を作り直す（古い URL のウィジェットは表示できなくなる） */
export async function rotateWidgetToken() {
  const r = await api('/widget-token/rotate');
  await saveToken(r.token);
  return widgetUrl();
}

// ---- アイコンのバッジ（学習中の枚数）。iOS では通知の許可が要る。だめなら何もしない ----
export function updateBadge(s = appState) {
  if (typeof navigator === 'undefined' || !('setAppBadge' in navigator) || !s.deck) return;
  try {
    const n = summarize(s.deck.inRange(s.selection), s.progress).learning;
    const p = n > 0 ? navigator.setAppBadge(n) : navigator.clearAppBadge ? navigator.clearAppBadge() : navigator.setAppBadge(0);
    p?.catch?.(() => {});
  } catch {
    // 対応していない・許可がない
  }
}

/** app.js から 1 回呼ぶ */
export function initWidget() {
  updateBadge();
  loadWidgetToken().catch(() => {});
  onChange((key) => {
    if (key !== 'progress' && key !== 'selection') return;
    updateBadge();
    scheduleSummary();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSummary();
  });
  // 起動時にも 1 回（ログイン情報の読み込みを待つ。変わっていなければ送らない）
  setTimeout(scheduleSummary, 3000);
}
