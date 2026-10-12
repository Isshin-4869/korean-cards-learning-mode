// 毎日の復習リマインダー（Web Push）。購読の登録・解除は Cloudflare Worker に、Firebase の ID トークン付きで送る。
// 通知の文面は Service Worker（sw.js）が端末内の進捗から作る。

import { PUSH } from './config.js';
import { Store } from './store.js';
import { idToken, currentUser } from './firebase.js';

export const pushConfigured = () => !!(PUSH.workerUrl && PUSH.vapidPublicKey);
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const isStandalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;

const LOCAL_KEY = 'push'; // この端末の通知設定 { enabled, hour }
export const DEFAULT_HOUR = 20;

export async function loadPushSettings() {
  return { enabled: false, hour: DEFAULT_HOUR, ...((await Store.get(LOCAL_KEY)) ?? {}) };
}
const savePushSettings = (s) => Store.set(LOCAL_KEY, s);

async function api(path, body = {}) {
  const res = await fetch(PUSH.workerUrl.replace(/\/$/, '') + path, {
    method: 'POST',
    headers: { authorization: `Bearer ${await idToken()}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`通知サーバーのエラー（${res.status}${json.error ? ` ${json.error}` : ''}）`);
  return json;
}

function keyBytes(b64url) {
  const s = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** オンにする。通知の許可を求めるので、タップの処理の中から呼ぶこと */
export async function enablePush(hour) {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('通知が許可されませんでした。iPhone の設定 → 通知 → 韓国語カード で許可できます');
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription())
    ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(PUSH.vapidPublicKey) }));
  await api('/subscribe', { subscription: sub.toJSON(), hour });
  await savePushSettings({ enabled: true, hour });
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    await api('/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
  const s = await loadPushSettings();
  await savePushSettings({ ...s, enabled: false });
}

export async function setPushHour(hour) {
  const s = await loadPushSettings();
  await savePushSettings({ ...s, hour });
  if (s.enabled) await api('/settings', { hour });
}

export const sendTestPush = () => api('/test');

// 今日学習したことを知らせる（その日のリマインダーを止めるため）。1日1回だけ送る
const jstDate = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
let activitySentFor = null;
export async function reportActivity() {
  if (!pushConfigured() || !currentUser()) return;
  const today = jstDate();
  if (activitySentFor === today) return;
  activitySentFor ??= (await Store.get('pushActivity')) ?? '';
  if (activitySentFor === today) return;
  const s = await loadPushSettings();
  if (!s.enabled) return;
  activitySentFor = today;
  try {
    await api('/activity');
    await Store.set('pushActivity', today);
  } catch {
    activitySentFor = '';
  }
}
