// 毎日の復習リマインダー（Web Push）を送る Cloudflare Worker。
// 端末の購読情報を KV（SUBS、キーは Firebase の uid）に置き、毎時の cron で指定時刻（JST）の人にだけ送る。
//
// 送るのは中身なし（ペイロードなし）の push。暗号化が要らず、文面は Service Worker 側で組み立てる。
// その日すでに学習していれば（/activity で lastActive が今日になっていれば）送らない。
//
// KV の値: { subs: [{ endpoint, keys: { p256dh, auth }, createdAt }], hour, enabled, lastActive }
//
// ホーム画面ウィジェット（Scriptable）用に、学習の要約も同じ KV に置く。
//   widget:<uid>    → { summary, updatedAt, token }
//   wtoken:<token>  → uid
// ウィジェットはログインできないので、推測できない token を URL に入れて GET /widget/<token> で読む。

const GOOGLE_JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const MAX_SUBS = 5;
const MAX_BODY = 10 * 1024;
const PUSH_TTL = 43200; // 12 時間
const MAX_SUMMARY = 4 * 1024;
const WIDGET_PREFIX = 'widget:';
const WTOKEN_PREFIX = 'wtoken:';
const TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;
const JST_OFFSET = 9 * 3600 * 1000;

const enc = new TextEncoder();
const dec = new TextDecoder();

// fetch / 時刻はテストで差し替えられるようにする
const defaultDeps = () => ({ fetch: (...a) => fetch(...a), now: () => Date.now() });

// ---- base64url ----
export function b64url(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const b64urlJson = (obj) => b64url(enc.encode(JSON.stringify(obj)));
const parseB64urlJson = (part) => JSON.parse(dec.decode(b64urlDecode(part)));

// ---- JST の日付と時 ----
export function jstNow(ms) {
  const d = new Date(ms + JST_OFFSET);
  return { date: d.toISOString().slice(0, 10), hour: d.getUTCHours() };
}

// ---- Firebase ID トークンの検証 ----
// Google の公開鍵は Cache-Control の max-age のあいだ使い回す。知らない kid が来たら取り直す（連打はしない）
const REFETCH_GAP = 10 * 1000;
let jwks = { keys: new Map(), expires: 0, fetchedAt: 0 };

export function resetJwksCache() {
  jwks = { keys: new Map(), expires: 0, fetchedAt: 0 };
}

async function loadJwks(deps) {
  const res = await deps.fetch(GOOGLE_JWKS_URL);
  if (!res.ok) throw new Error(`jwks ${res.status}`);
  const body = await res.json();
  const keys = new Map();
  for (const k of body.keys ?? []) {
    if (k.kty !== 'RSA' || !k.kid) continue;
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: 'RSA', n: k.n, e: k.e },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    keys.set(k.kid, key);
  }
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '')?.[1] ?? 0);
  const now = deps.now();
  jwks = { keys, expires: now + maxAge * 1000, fetchedAt: now };
}

async function publicKeyFor(kid, deps) {
  const now = deps.now();
  if (now >= jwks.expires || (!jwks.keys.has(kid) && now - jwks.fetchedAt >= REFETCH_GAP)) await loadJwks(deps);
  return jwks.keys.get(kid);
}

/** 正しければ uid を返す。だめなら例外 */
export async function verifyFirebaseToken(token, projectId, deps = defaultDeps()) {
  const parts = typeof token === 'string' ? token.split('.') : [];
  if (parts.length !== 3) throw new Error('malformed token');
  let header, payload;
  try {
    header = parseB64urlJson(parts[0]);
    payload = parseB64urlJson(parts[1]);
  } catch {
    throw new Error('malformed token');
  }
  if (header.alg !== 'RS256') throw new Error('bad alg');
  if (typeof header.kid !== 'string' || !header.kid) throw new Error('no kid');
  const key = await publicKeyFor(header.kid, deps);
  if (!key) throw new Error('unknown kid');
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    b64urlDecode(parts[2]),
    enc.encode(`${parts[0]}.${parts[1]}`),
  );
  if (!ok) throw new Error('bad signature');
  const now = Math.floor(deps.now() / 1000);
  if (payload.aud !== projectId) throw new Error('bad aud');
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) throw new Error('bad iss');
  if (typeof payload.exp !== 'number' || payload.exp <= now) throw new Error('expired');
  if (typeof payload.iat !== 'number' || payload.iat > now + 300) throw new Error('bad iat');
  if (typeof payload.sub !== 'string' || !payload.sub) throw new Error('no sub');
  return payload.sub;
}

// ---- VAPID ----
let vapidKey = { src: '', key: null };

async function vapidSigningKey(jwkStr) {
  if (vapidKey.src === jwkStr && vapidKey.key) return vapidKey.key;
  const j = JSON.parse(jwkStr);
  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', x: j.x, y: j.y, d: j.d },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  vapidKey = { src: jwkStr, key };
  return key;
}

// WebCrypto の ECDSA 署名は r||s（64 バイト）で、そのまま JWS の形になっている
export async function vapidJwt(endpoint, env, nowMs) {
  const key = await vapidSigningKey(env.VAPID_PRIVATE_JWK);
  const head = b64urlJson({ typ: 'JWT', alg: 'ES256' });
  const claims = b64urlJson({
    aud: new URL(endpoint).origin,
    exp: Math.floor(nowMs / 1000) + 12 * 3600,
    sub: env.VAPID_SUBJECT,
  });
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${head}.${claims}`));
  return `${head}.${claims}.${b64url(sig)}`;
}

export async function vapidAuthHeader(endpoint, env, nowMs) {
  return `vapid t=${await vapidJwt(endpoint, env, nowMs)}, k=${env.VAPID_PUBLIC_KEY}`;
}

const vapidReady = (env) => Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_JWK && env.VAPID_SUBJECT);

/** 1 件送る。戻り値は HTTP ステータス（通信エラーは 0） */
export async function sendPush(sub, env, deps = defaultDeps()) {
  try {
    const res = await deps.fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        TTL: String(PUSH_TTL),
        Urgency: 'normal',
        Authorization: await vapidAuthHeader(sub.endpoint, env, deps.now()),
      },
      body: new Uint8Array(0), // 中身なし（Content-Length: 0 は実行環境が付ける）
    });
    return res.status;
  } catch {
    return 0;
  }
}

const isSuccess = (status) => status === 200 || status === 201 || status === 202;
const isGone = (status) => status === 404 || status === 410;

/** その人の全端末に送り、もう無い購読（404/410）は KV から消す */
export async function pushToUser(uid, rec, env, deps = defaultDeps()) {
  const results = await Promise.all(
    rec.subs.map(async (s) => {
      const status = await sendPush(s, env, deps);
      return { endpoint: s.endpoint, status, ok: isSuccess(status) };
    }),
  );
  const gone = new Set(results.filter((r) => isGone(r.status)).map((r) => r.endpoint));
  if (gone.size) {
    const subs = rec.subs.filter((s) => !gone.has(s.endpoint));
    if (subs.length) await env.SUBS.put(uid, JSON.stringify({ ...rec, subs }));
    else await env.SUBS.delete(uid);
  }
  return results;
}

// ---- KV ----
async function getRecord(env, uid) {
  const raw = await env.SUBS.get(uid);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const putRecord = (env, uid, rec) => env.SUBS.put(uid, JSON.stringify(rec));

// ウィジェット用のキーは cron の対象外
export const isWidgetKey = (name) => name.startsWith(WIDGET_PREFIX) || name.startsWith(WTOKEN_PREFIX);

// ---- ウィジェットの要約 ----
// 32 バイトの乱数（base64url で 43 文字）
export const newWidgetToken = () => b64url(crypto.getRandomValues(new Uint8Array(32)));

async function getWidget(env, uid) {
  const raw = await env.SUBS.get(WIDGET_PREFIX + uid);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const putWidget = (env, uid, rec) => env.SUBS.put(WIDGET_PREFIX + uid, JSON.stringify(rec));

// 中身が同じかどうか（端末側の時刻 updatedAt は比べない）
const sameSummary = (a, b) => {
  const strip = (s) => (s && typeof s === 'object' ? { ...s, updatedAt: undefined } : s);
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
};

// ---- 入力チェック ----
const validHour = (h) => Number.isInteger(h) && h >= 0 && h <= 23;

export function validSubscription(s) {
  if (!s || typeof s.endpoint !== 'string' || s.endpoint.length > 2048) return false;
  try {
    if (new URL(s.endpoint).protocol !== 'https:') return false;
  } catch {
    return false;
  }
  const k = s.keys;
  const b64 = /^[A-Za-z0-9_\-+/=]{1,256}$/;
  return Boolean(k && typeof k.p256dh === 'string' && typeof k.auth === 'string' && b64.test(k.p256dh) && b64.test(k.auth));
}

// ---- CORS ----
export function allowedOrigin(origin, env) {
  if (!origin) return null;
  if (origin === env.ALLOWED_ORIGIN) return origin;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
  return null;
}

function corsHeaders(req, env) {
  const origin = allowedOrigin(req.headers.get('Origin'), env);
  const h = { Vary: 'Origin' };
  if (origin) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

const json = (data, status, cors) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...cors } });

async function readBody(req) {
  if (Number(req.headers.get('Content-Length') ?? 0) > MAX_BODY) return { error: 413 };
  const text = await req.text();
  if (text.length > MAX_BODY) return { error: 413 };
  if (!text) return { body: {} };
  try {
    const body = JSON.parse(text);
    return body && typeof body === 'object' && !Array.isArray(body) ? { body } : { error: 400 };
  } catch {
    return { error: 400 };
  }
}

// ---- 各 API ----
const routes = {
  async '/subscribe'(uid, body, env, deps) {
    const { subscription, hour } = body;
    if (!validSubscription(subscription)) return [400, { error: 'invalid subscription' }];
    if (!validHour(hour)) return [400, { error: 'invalid hour' }];
    const rec = (await getRecord(env, uid)) ?? { subs: [], enabled: true, lastActive: '' };
    const prev = rec.subs.find((s) => s.endpoint === subscription.endpoint);
    const sub = {
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
      createdAt: prev?.createdAt ?? deps.now(),
    };
    // 同じ endpoint は上書き。多すぎたら古いものから捨てる
    const subs = [...rec.subs.filter((s) => s.endpoint !== sub.endpoint), sub]
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(-MAX_SUBS);
    const next = { ...rec, subs, hour, enabled: true };
    await putRecord(env, uid, next);
    return [200, { ok: true, hour, enabled: true, count: subs.length }];
  },

  async '/unsubscribe'(uid, body, env) {
    if (typeof body.endpoint !== 'string') return [400, { error: 'invalid endpoint' }];
    const rec = await getRecord(env, uid);
    if (!rec) return [200, { ok: true, count: 0 }];
    const subs = rec.subs.filter((s) => s.endpoint !== body.endpoint);
    if (subs.length) await putRecord(env, uid, { ...rec, subs });
    else await env.SUBS.delete(uid);
    return [200, { ok: true, count: subs.length }];
  },

  async '/settings'(uid, body, env) {
    if (body.hour !== undefined && !validHour(body.hour)) return [400, { error: 'invalid hour' }];
    if (body.enabled !== undefined && typeof body.enabled !== 'boolean') return [400, { error: 'invalid enabled' }];
    const rec = await getRecord(env, uid);
    if (!rec) return [404, { error: 'not subscribed' }];
    if (body.hour !== undefined) rec.hour = body.hour;
    if (body.enabled !== undefined) rec.enabled = body.enabled;
    await putRecord(env, uid, rec);
    return [200, { ok: true, hour: rec.hour, enabled: rec.enabled }];
  },

  // 今日はもう学習した → 今日のリマインダーは送らない。同じ日なら書き込まない（KV の書き込み回数節約）
  async '/activity'(uid, body, env, deps) {
    const today = jstNow(deps.now()).date;
    const rec = await getRecord(env, uid);
    if (rec && rec.lastActive !== today) await putRecord(env, uid, { ...rec, lastActive: today });
    return [200, { ok: true, lastActive: today }];
  },

  // ウィジェット用の要約を置く。初回だけ token を作る。中身が前と同じなら書き込まない
  async '/summary'(uid, body, env, deps) {
    const { summary } = body;
    if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return [400, { error: 'invalid summary' }];
    if (enc.encode(JSON.stringify(summary)).length > MAX_SUMMARY) return [413, { error: 'summary too large' }];
    const rec = await getWidget(env, uid);
    if (rec?.token && sameSummary(rec.summary, summary)) return [200, { ok: true, token: rec.token, changed: false }];
    let token = rec?.token;
    if (!token) {
      token = newWidgetToken();
      await env.SUBS.put(WTOKEN_PREFIX + token, uid);
    }
    await putWidget(env, uid, { summary, updatedAt: deps.now(), token });
    return [200, { ok: true, token, changed: true }];
  },

  // URL が漏れたときのために token を作り直す（古い URL は使えなくなる）
  async '/widget-token/rotate'(uid, body, env) {
    const rec = await getWidget(env, uid);
    if (!rec) return [404, { error: 'no widget' }];
    const token = newWidgetToken();
    await env.SUBS.put(WTOKEN_PREFIX + token, uid);
    await putWidget(env, uid, { ...rec, token });
    if (rec.token) await env.SUBS.delete(WTOKEN_PREFIX + rec.token);
    return [200, { ok: true, token }];
  },

  async '/test'(uid, body, env, deps) {
    if (!vapidReady(env)) return [500, { error: 'vapid not configured' }];
    const rec = await getRecord(env, uid);
    if (!rec || !rec.subs.length) return [404, { error: 'not subscribed' }];
    const results = await pushToUser(uid, rec, env, deps);
    return [200, { ok: results.some((r) => r.ok), results: results.map(({ endpoint, status }) => ({ endpoint, status })) }];
  },
};

export async function handleRequest(req, env, ctx, deps = defaultDeps()) {
  const cors = corsHeaders(req, env);
  const { pathname } = new URL(req.url);

  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        ...cors,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Max-Age': '86400',
      },
    });
  }
  if (req.method === 'GET' && pathname === '/') return json({ ok: true }, 200, cors);
  if (req.method === 'GET' && pathname.startsWith('/widget/')) return widgetGet(pathname.slice(8), env, cors);

  const route = req.method === 'POST' && Object.hasOwn(routes, pathname) ? routes[pathname] : null;
  if (!route) return json({ error: 'not found' }, 404, cors);

  const m = /^Bearer\s+(\S+)$/.exec(req.headers.get('Authorization') ?? '');
  let uid;
  try {
    if (!m) throw new Error('no token');
    uid = await verifyFirebaseToken(m[1], env.FIREBASE_PROJECT_ID, deps);
  } catch {
    return json({ error: 'unauthorized' }, 401, cors);
  }

  const { body, error } = await readBody(req);
  if (error) return json({ error: error === 413 ? 'body too large' : 'invalid json' }, error, cors);

  try {
    const [status, data] = await route(uid, body, env, deps);
    return json(data, status, cors);
  } catch {
    return json({ error: 'internal error' }, 500, cors);
  }
}

// ウィジェットが読む。token そのものが鍵なのでログインは要らない
async function widgetGet(token, env, cors) {
  const h = { ...cors, 'Cache-Control': 'no-store' };
  const notFound = () => json({ error: 'not found' }, 404, h);
  if (!TOKEN_RE.test(token)) return notFound();
  const uid = await env.SUBS.get(WTOKEN_PREFIX + token);
  if (!uid) return notFound();
  const rec = await getWidget(env, uid);
  if (!rec || rec.token !== token) return notFound();
  return json({ v: 1, summary: rec.summary, updatedAt: rec.updatedAt }, 200, h);
}

// ---- cron（毎時 0 分） ----
export async function runCron(env, deps = defaultDeps()) {
  const { date, hour } = jstNow(deps.now());
  const summary = { hour, date, users: 0, sent: 0, removed: 0 };
  if (!vapidReady(env)) return summary;
  let cursor;
  do {
    const page = await env.SUBS.list(cursor ? { cursor } : {});
    for (const { name } of page.keys) {
      if (isWidgetKey(name)) continue;
      const rec = await getRecord(env, name);
      if (!rec || !rec.enabled || rec.hour !== hour || rec.lastActive === date || !rec.subs?.length) continue;
      const results = await pushToUser(name, rec, env, deps);
      summary.users++;
      summary.sent += results.filter((r) => r.ok).length;
      summary.removed += results.filter((r) => isGone(r.status)).length;
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return summary;
}

export default {
  fetch(req, env, ctx) {
    return handleRequest(req, env, ctx);
  },
  scheduled(controller, env, ctx) {
    const deps = defaultDeps();
    // cron の予定時刻を基準にする（少し遅れて起動しても時がずれないように）
    if (controller?.scheduledTime) deps.now = () => controller.scheduledTime;
    ctx.waitUntil(runCron(env, deps));
  },
};
