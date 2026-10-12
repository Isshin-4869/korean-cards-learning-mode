// ホーム画面ウィジェット（Scriptable）とアイコンのバッジ。
// 連続記録・今週・今日の復習・記憶の予測の要約を Cloudflare Worker（/summary）に置き、ウィジェットは GET /widget/<token> で読む。
// 要約は数字だけ（カードの中身は送らない）。送るのは中身が変わったときだけで、多くても 2 分に 1 回。

import { PUSH } from './config.js';
import { Store } from './store.js';
import { idToken, currentUser } from './firebase.js';
import { state as appState, onChange } from './state.js';
import { forecast } from './memory.js';
import { streakOf, weekOf } from './streak.js';
import { todayReview } from './review.js';

const TOKEN_KEY = 'widgetToken'; // { uid, token }
const SENT_KEY = 'widgetSent'; // 最後に送れた要約（updatedAt なしの JSON）
const MIN_GAP = 2 * 60 * 1000;
const WATCH = new Set(['progress', 'selection', 'days', 'settings']); // 変わったら送り直すキー

export const widgetConfigured = () => !!PUSH.workerUrl;
const base = () => PUSH.workerUrl.replace(/\/$/, '');

/**
 * ウィジェットに渡す要約（2KB 未満）。v: 2 は連続記録・復習の形（v1 は惑星の形）。
 * week は月曜はじまりの 7 日（d: 学習した / t: 今日）、recall は今日から 7 日後までの記憶の見込み（%、全部のカード）
 */
export function buildSummary(s = appState, now = Date.now()) {
  const st = streakOf(s.days, now);
  const { remaining, done, limit, due } = todayReview(s, now);
  const fc = forecast(s.cards, s.progress, now, 7);
  return {
    v: 2,
    streak: { days: st.days, best: st.best, todayDone: st.todayDone },
    week: weekOf(s.days, now).map((d) => ({ l: d.label, d: d.done ? 1 : 0, t: d.today ? 1 : 0 })),
    review: { remaining, done, limit, due },
    recall: fc.values,
    studied: fc.studied,
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

// ---- アイコンのバッジ（今日の復習の残り枚数）。iOS では通知の許可が要る。だめなら何もしない ----
export const badgeCount = (s = appState, now = Date.now()) => todayReview(s, now).remaining;

export function updateBadge(s = appState) {
  if (typeof navigator === 'undefined' || !('setAppBadge' in navigator) || !s.deck) return;
  try {
    const n = badgeCount(s);
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
    if (!WATCH.has(key)) return;
    updateBadge();
    scheduleSummary();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSummary();
    else {
      // 日付が変わる・時間がたつと連続記録や復習どきの枚数が変わるので、開くたびに数え直す（同じなら送らない）
      updateBadge();
      scheduleSummary();
    }
  });
  // 起動時にも 1 回（ログイン情報の読み込みを待つ。変わっていなければ送らない）
  setTimeout(scheduleSummary, 3000);
}
