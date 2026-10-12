// テスト用の偽物: メモリ上の KV、Google 公開鍵を返す fetch、Firebase 風トークンの発行

import { b64url } from '../src/index.js';
import { generateVapidKeys } from '../scripts/gen-vapid.mjs';

export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
export const PROJECT = 'korean-cards-c2e8e';
// 2026-10-12 11:00 UTC = JST 20:00
export const NOW = Date.UTC(2026, 9, 12, 11, 0, 0);

const enc = new TextEncoder();

// list はページを小さくしてカーソル処理も通す
export class FakeKV {
  constructor(pageSize = 2) {
    this.map = new Map();
    this.pageSize = pageSize;
  }
  async get(k) {
    return this.map.has(k) ? this.map.get(k) : null;
  }
  async put(k, v) {
    this.map.set(k, String(v));
  }
  async delete(k) {
    this.map.delete(k);
  }
  async list({ cursor } = {}) {
    const names = [...this.map.keys()].sort();
    const start = cursor ? Number(cursor) : 0;
    const keys = names.slice(start, start + this.pageSize).map((name) => ({ name }));
    const end = start + keys.length;
    return end >= names.length ? { keys, list_complete: true } : { keys, list_complete: false, cursor: String(end) };
  }
  json(k) {
    return this.map.has(k) ? JSON.parse(this.map.get(k)) : null;
  }
}

export async function makeRsa(kid) {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  return { kid, privateKey: pair.privateKey, jwk: { ...jwk, kid, alg: 'RS256', use: 'sig' } };
}

export async function signToken(rsa, claims, { kid = rsa.kid, alg = 'RS256' } = {}) {
  const part = (o) => b64url(enc.encode(JSON.stringify(o)));
  const input = `${part({ alg, kid, typ: 'JWT' })}.${part(claims)}`;
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', rsa.privateKey, enc.encode(input));
  return `${input}.${b64url(sig)}`;
}

export const goodClaims = (now = NOW, extra = {}) => ({
  aud: PROJECT,
  iss: `https://securetoken.google.com/${PROJECT}`,
  sub: 'user-1',
  iat: Math.floor(now / 1000) - 60,
  exp: Math.floor(now / 1000) + 3600,
  ...extra,
});

/** Google の JWK と push サービスを真似る fetch。pushStatus[endpoint] で返すステータスを変えられる */
export function mockFetch({ jwks, pushStatus = {} }) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url) === GOOGLE_JWKS_URL) {
      return new Response(JSON.stringify({ keys: jwks() }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600, must-revalidate' },
      });
    }
    return new Response(null, { status: pushStatus[String(url)] ?? 201 });
  };
  fn.calls = calls;
  fn.pushCalls = () => calls.filter((c) => c.url !== GOOGLE_JWKS_URL);
  return fn;
}

export async function makeEnv(kv = new FakeKV()) {
  const vapid = await generateVapidKeys();
  return {
    SUBS: kv,
    FIREBASE_PROJECT_ID: PROJECT,
    ALLOWED_ORIGIN: 'https://isshin-4869.github.io',
    VAPID_PUBLIC_KEY: vapid.publicKey,
    VAPID_PRIVATE_JWK: vapid.privateJwk,
    VAPID_SUBJECT: 'https://isshin-4869.github.io/korean-cards-learning-mode/',
  };
}

export const clock = (t = NOW) => {
  const c = { t, now: () => c.t };
  return c;
};

export const sub = (n) => ({
  endpoint: `https://push${n}.example.com/send/abc${n}`,
  keys: { p256dh: `BPkey${n}`, auth: `auth${n}` },
});
