// 端末内のデータと Firestore の同期。端末内（IndexedDB）が主で、オフラインでもそのまま動く。
// 電波があるときに、変更から数秒後・起動時・アプリに戻ったとき・閉じるときに同期する。
//
// まとめ方:
//   progress  … カードごとに新しいほうの記録を残す（2台で別々に学習しても両方生きる）
//   matchBest … 範囲ごとに速いほう
//   その他     … 最後に変更したほう（settings / selection / flash / accepted）
//   進捗のリセット・バックアップからの復元をした時刻（resetAt）より前の記録は、どちらの端末のものも捨てる

import { state, SYNC_KEYS, onChange, applySynced, setResetAt } from './state.js';
import { firebaseConfigured, loadAuth, currentUser, fetchAllDocs, writeDocs } from './firebase.js';

const RESETTABLE = new Set(['progress', 'flash', 'matchBest']);
const DEBOUNCE = 3000;

const stamp = (r) => Math.max(r?.t ?? 0, r?.u ?? 0);

export function mergeProgress(local = {}, remote = {}, resetAt = 0) {
  const out = {};
  for (const src of [remote, local]) {
    for (const [id, r] of Object.entries(src ?? {})) {
      if (stamp(r) <= resetAt) continue;
      if (!out[id] || stamp(r) > stamp(out[id])) out[id] = r;
    }
  }
  return out;
}

// キーの順番に関係なく同じ内容か
export function sameValue(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && sameValue(a[k], b[k]));
}

/**
 * local / remote: { key: { v, u } }。remote.meta.v.resetAt がリセット時刻
 * 戻り値: toLocal（端末に反映するもの）、toRemote（Firestore に書くもの）、resetAt
 */
export function mergeAll(local, remote, localResetAt = 0) {
  const remoteResetAt = remote.meta?.v?.resetAt ?? 0;
  const resetAt = Math.max(localResetAt, remoteResetAt);
  const toLocal = {};
  const toRemote = {};
  const alive = (key, d) => d && (!RESETTABLE.has(key) || d.u > resetAt);
  for (const key of SYNC_KEYS) {
    const L = local[key];
    const R = remote[key];
    const u = Math.max(L?.u ?? 0, R?.u ?? 0);
    let merged;
    if (key === 'progress') {
      merged = { v: mergeProgress(L?.v, R?.v, resetAt), u };
    } else if (key === 'matchBest') {
      const v = { ...(alive(key, R) ? R.v : {}) };
      for (const [k, t] of Object.entries(alive(key, L) ? L.v ?? {} : {})) v[k] = v[k] == null ? t : Math.min(v[k], t);
      merged = { v, u };
    } else {
      const cands = [L, R].filter((d) => alive(key, d) && d.v != null);
      if (cands.length) merged = cands.reduce((a, b) => (b.u > a.u ? b : a));
      else merged = { v: RESETTABLE.has(key) ? {} : L?.v, u: RESETTABLE.has(key) ? resetAt : u };
    }
    if (merged.v == null) continue;
    if (!L || !sameValue(merged.v, L.v)) toLocal[key] = merged;
    if (!R || !sameValue(merged.v, R.v)) toRemote[key] = merged;
  }
  if (remoteResetAt !== resetAt) toRemote.meta = { v: { resetAt }, u: resetAt };
  return { resetAt, toLocal, toRemote };
}

// ---- 実際の同期 ----
export const syncStatus = { state: 'off', last: 0, error: '' };
const statusListeners = new Set();
export const onSyncStatus = (fn) => {
  statusListeners.add(fn);
  return () => statusListeners.delete(fn);
};
const setStatus = (patch) => {
  Object.assign(syncStatus, patch);
  for (const fn of statusListeners) fn(syncStatus);
};

let timer = 0;
let running = false;
let again = false;
let onApplied = () => {};

export function scheduleSync(delay = DEBOUNCE) {
  if (!firebaseConfigured() || !currentUser()) return;
  clearTimeout(timer);
  timer = setTimeout(syncNow, delay);
}

export async function syncNow() {
  if (!firebaseConfigured() || !currentUser()) return setStatus({ state: 'off' });
  if (running) {
    again = true;
    return;
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return setStatus({ state: 'offline' });
  running = true;
  setStatus({ state: 'syncing', error: '' });
  try {
    const remote = await fetchAllDocs();
    const local = Object.fromEntries(SYNC_KEYS.map((k) => [k, { v: state[k], u: state.syncMeta.updated[k] ?? 0 }]));
    const { resetAt, toLocal, toRemote } = mergeAll(local, remote, state.syncMeta.resetAt);
    if (resetAt !== state.syncMeta.resetAt) await setResetAt(resetAt);
    for (const [key, d] of Object.entries(toLocal)) await applySynced(key, d.v, d.u);
    await writeDocs(toRemote);
    setStatus({ state: 'idle', last: Date.now() });
    if (Object.keys(toLocal).length) onApplied(Object.keys(toLocal));
  } catch (e) {
    setStatus({ state: 'error', error: e.message });
  } finally {
    running = false;
    if (again) {
      again = false;
      scheduleSync(0);
    }
  }
}

export async function initSync({ onRemoteApplied } = {}) {
  if (!firebaseConfigured()) return;
  onApplied = onRemoteApplied ?? onApplied;
  await loadAuth();
  setStatus({ state: currentUser() ? 'idle' : 'off' });
  onChange(() => scheduleSync());
  window.addEventListener('online', () => scheduleSync(0));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') syncNow();
    else scheduleSync(0);
  });
  scheduleSync(0);
}
