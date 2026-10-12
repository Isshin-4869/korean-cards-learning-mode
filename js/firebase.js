// Firebase を SDK なしで REST API から使う（Authentication: メール / パスワード、Firestore）

import { FIREBASE } from './config.js';
import { Store } from './store.js';

export const firebaseConfigured = () => !!(FIREBASE.apiKey && FIREBASE.projectId);

const AUTH_KEY = 'auth';
let auth = null; // { uid, email, idToken, refreshToken, exp }

const ERRORS = {
  EMAIL_NOT_FOUND: 'メールアドレスかパスワードが違います',
  INVALID_PASSWORD: 'メールアドレスかパスワードが違います',
  INVALID_LOGIN_CREDENTIALS: 'メールアドレスかパスワードが違います',
  INVALID_EMAIL: 'メールアドレスの形式が違います',
  USER_DISABLED: 'このアカウントは無効になっています',
  TOO_MANY_ATTEMPTS_TRY_LATER: '試行回数が多すぎます。しばらくしてからやり直してください',
  TOKEN_EXPIRED: 'ログインの有効期限が切れました。ログインし直してください',
  INVALID_REFRESH_TOKEN: 'ログインの有効期限が切れました。ログインし直してください',
  USER_NOT_FOUND: 'アカウントが見つかりません。ログインし直してください',
};

async function post(url, body, form) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json' },
    body: form ? new URLSearchParams(body) : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = String(json.error?.message ?? res.status).split(' ')[0];
    const err = new Error(ERRORS[code] ?? `エラー: ${code}`);
    err.code = code;
    throw err;
  }
  return json;
}

export async function loadAuth() {
  auth = (await Store.get(AUTH_KEY)) ?? null;
  return auth;
}

export const currentUser = () => (auth ? { uid: auth.uid, email: auth.email } : null);

export async function signIn(email, password) {
  const r = await post(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE.apiKey}`, { email, password, returnSecureToken: true });
  auth = { uid: r.localId, email: r.email, idToken: r.idToken, refreshToken: r.refreshToken, exp: Date.now() + Number(r.expiresIn) * 1000 };
  await Store.set(AUTH_KEY, auth);
  return currentUser();
}

export async function signOut() {
  auth = null;
  await Store.delete(AUTH_KEY);
}

// 期限が近ければ更新した ID トークンを返す
export async function idToken() {
  if (!auth) throw new Error('ログインしていません');
  if (Date.now() < auth.exp - 60_000) return auth.idToken;
  try {
    const r = await post(`https://securetoken.googleapis.com/v1/token?key=${FIREBASE.apiKey}`, { grant_type: 'refresh_token', refresh_token: auth.refreshToken }, true);
    auth = { ...auth, idToken: r.id_token, refreshToken: r.refresh_token, exp: Date.now() + Number(r.expires_in) * 1000 };
    await Store.set(AUTH_KEY, auth);
    return auth.idToken;
  } catch (e) {
    if (['TOKEN_EXPIRED', 'INVALID_REFRESH_TOKEN', 'USER_NOT_FOUND', 'USER_DISABLED'].includes(e.code)) await signOut();
    throw e;
  }
}

// ---- Firestore: users/{uid}/data/{key} に { v: JSON 文字列, u: 更新時刻 } を置く ----
const root = () => `projects/${FIREBASE.projectId}/databases/(default)/documents`;
const docName = (key) => `${root()}/users/${auth.uid}/data/${key}`;

export async function fetchAllDocs() {
  const token = await idToken();
  const res = await fetch(`https://firestore.googleapis.com/v1/${root()}/users/${auth.uid}/data?pageSize=50`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`同期できませんでした（読み込み ${res.status}）`);
  const json = await res.json();
  const out = {};
  for (const d of json.documents ?? []) {
    const key = d.name.split('/').pop();
    try {
      out[key] = { v: JSON.parse(d.fields?.v?.stringValue ?? 'null'), u: Number(d.fields?.u?.integerValue ?? 0) };
    } catch {
      // 壊れたドキュメントは無視する（次の書き込みで直る）
    }
  }
  return out;
}

export async function writeDocs(docs) {
  const entries = Object.entries(docs);
  if (!entries.length) return;
  const token = await idToken();
  const res = await fetch(`https://firestore.googleapis.com/v1/${root()}:commit`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      writes: entries.map(([key, { v, u }]) => ({
        update: { name: docName(key), fields: { v: { stringValue: JSON.stringify(v) }, u: { integerValue: String(u) } } },
      })),
    }),
  });
  if (!res.ok) throw new Error(`同期できませんでした（書き込み ${res.status}）`);
}
