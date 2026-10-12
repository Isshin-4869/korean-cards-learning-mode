// VAPID の JWT と push リクエスト
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vapidAuthHeader, sendPush, b64urlDecode } from '../src/index.js';
import { makeEnv, mockFetch, clock, NOW, sub } from './helpers.mjs';

const dec = new TextDecoder();
const env = await makeEnv();

async function checkHeader(header, endpoint) {
  const m = /^vapid t=([^,]+), k=(\S+)$/.exec(header);
  assert.ok(m, header);
  const [h, c, s] = m[1].split('.');
  assert.equal(m[2], env.VAPID_PUBLIC_KEY);
  assert.deepEqual(JSON.parse(dec.decode(b64urlDecode(h))), { typ: 'JWT', alg: 'ES256' });
  const claims = JSON.parse(dec.decode(b64urlDecode(c)));
  assert.equal(claims.aud, new URL(endpoint).origin);
  assert.equal(claims.sub, env.VAPID_SUBJECT);
  assert.equal(claims.exp, Math.floor(NOW / 1000) + 12 * 3600);
  const raw = b64urlDecode(m[2]);
  assert.equal(raw.length, 65);
  assert.equal(raw[0], 4);
  const pub = await crypto.subtle.importKey('raw', raw, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const sig = b64urlDecode(s);
  assert.equal(sig.length, 64);
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, sig, new TextEncoder().encode(`${h}.${c}`));
  assert.ok(ok, '署名が公開鍵で検証できる');
}

test('Authorization ヘッダーの JWT が検証できる', async () => {
  const endpoint = 'https://fcm.googleapis.com/fcm/send/xyz:123';
  await checkHeader(await vapidAuthHeader(endpoint, env, NOW), endpoint);
});

test('sendPush は中身なしで TTL / Urgency 付きの POST を送る', async () => {
  const f = mockFetch({ jwks: () => [] });
  const s = sub(1);
  assert.equal(await sendPush(s, env, { fetch: f, now: clock().now }), 201);
  const [call] = f.calls;
  assert.equal(call.url, s.endpoint);
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.body.byteLength, 0); // 中身なしの push
  const h = new Headers(call.init.headers);
  assert.equal(h.get('TTL'), '43200');
  assert.equal(h.get('Urgency'), 'normal');
  await checkHeader(h.get('Authorization'), s.endpoint);
});

test('通信エラーはステータス 0', async () => {
  const f = async () => {
    throw new Error('network');
  };
  assert.equal(await sendPush(sub(1), env, { fetch: f, now: clock().now }), 0);
});
