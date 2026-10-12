// HTTP API（fetch ハンドラー経由）
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker, { handleRequest, resetJwksCache } from '../src/index.js';
import { makeRsa, signToken, goodClaims, mockFetch, makeEnv, clock, sub, FakeKV, NOW } from './helpers.mjs';

const rsa = await makeRsa('k1');
const ORIGIN = 'https://isshin-4869.github.io';
let env, kv, c, f, token;

beforeEach(async () => {
  resetJwksCache();
  kv = new FakeKV();
  env = await makeEnv(kv);
  c = clock();
  f = mockFetch({ jwks: () => [rsa.jwk] });
  token = await signToken(rsa, goodClaims());
});

const call = (path, { body, method = 'POST', auth = true, origin = ORIGIN, headers = {} } = {}) => {
  const h = { ...headers };
  if (origin) h.Origin = origin;
  if (auth) h.Authorization = `Bearer ${token}`;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const req = new Request(`https://push.example.workers.dev${path}`, {
    method,
    headers: h,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  return handleRequest(req, env, {}, { fetch: f, now: c.now });
};

test('GET / は ok、知らないパスは 404', async () => {
  const r = await call('/', { method: 'GET', auth: false });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.equal((await call('/nope')).status, 404);
  assert.equal((await call('/subscribe', { method: 'GET' })).status, 404);
});

test('OPTIONS（プリフライト）', async () => {
  const r = await call('/subscribe', { method: 'OPTIONS', auth: false });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.match(r.headers.get('Access-Control-Allow-Headers'), /Authorization/);
  assert.match(r.headers.get('Access-Control-Allow-Headers'), /Content-Type/);
  assert.match(r.headers.get('Access-Control-Allow-Methods'), /POST/);
  const local = await call('/subscribe', { method: 'OPTIONS', auth: false, origin: 'http://localhost:8080' });
  assert.equal(local.headers.get('Access-Control-Allow-Origin'), 'http://localhost:8080');
  const evil = await call('/subscribe', { method: 'OPTIONS', auth: false, origin: 'https://evil.example' });
  assert.equal(evil.headers.get('Access-Control-Allow-Origin'), null);
});

test('トークンなし・不正トークンは 401', async () => {
  const r = await call('/subscribe', { auth: false, body: { subscription: sub(1), hour: 20 } });
  assert.equal(r.status, 401);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  token = 'a.b.c';
  assert.equal((await call('/subscribe', { body: { subscription: sub(1), hour: 20 } })).status, 401);
  assert.equal(kv.map.size, 0);
});

test('subscribe → settings → unsubscribe', async () => {
  let r = await call('/subscribe', { body: { subscription: sub(1), hour: 20 } });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  let rec = kv.json('user-1');
  assert.equal(rec.hour, 20);
  assert.equal(rec.enabled, true);
  assert.deepEqual(rec.subs.map((s) => s.endpoint), [sub(1).endpoint]);
  assert.equal(rec.subs[0].createdAt, NOW);

  // 同じ endpoint は上書き（増えない）、別の endpoint は追加
  await call('/subscribe', { body: { subscription: sub(1), hour: 21 } });
  c.t += 1000;
  await call('/subscribe', { body: { subscription: sub(2), hour: 21 } });
  rec = kv.json('user-1');
  assert.equal(rec.subs.length, 2);
  assert.equal(rec.hour, 21);

  r = await call('/settings', { body: { hour: 7, enabled: false } });
  assert.equal(r.status, 200);
  rec = kv.json('user-1');
  assert.equal(rec.hour, 7);
  assert.equal(rec.enabled, false);
  assert.equal((await call('/settings', { body: { hour: 24 } })).status, 400);
  assert.equal((await call('/settings', { body: { enabled: 'yes' } })).status, 400);

  // 再購読で enabled が戻る
  await call('/subscribe', { body: { subscription: sub(2), hour: 7 } });
  assert.equal(kv.json('user-1').enabled, true);

  r = await call('/unsubscribe', { body: { endpoint: sub(1).endpoint } });
  assert.deepEqual(await r.json(), { ok: true, count: 1 });
  r = await call('/unsubscribe', { body: { endpoint: sub(2).endpoint } });
  assert.deepEqual(await r.json(), { ok: true, count: 0 });
  assert.equal(kv.map.has('user-1'), false);
  assert.equal((await call('/settings', { body: { hour: 8 } })).status, 404);
});

test('入力チェック: hour・endpoint・JSON・サイズ', async () => {
  for (const hour of [24, -1, 7.5, '20', undefined]) {
    assert.equal((await call('/subscribe', { body: { subscription: sub(1), hour } })).status, 400, `hour=${hour}`);
  }
  const http = { ...sub(1), endpoint: 'http://push.example.com/x' };
  assert.equal((await call('/subscribe', { body: { subscription: http, hour: 20 } })).status, 400);
  assert.equal((await call('/subscribe', { body: { subscription: { endpoint: sub(1).endpoint }, hour: 20 } })).status, 400);
  assert.equal((await call('/subscribe', { body: '{not json' })).status, 400);
  assert.equal((await call('/subscribe', { body: 'x'.repeat(11 * 1024) })).status, 413);
  assert.equal(kv.map.size, 0);
});

test('購読は 1 人 5 件まで（古いものから捨てる）', async () => {
  for (let i = 1; i <= 7; i++) {
    c.t = NOW + i * 1000;
    await call('/subscribe', { body: { subscription: sub(i), hour: 20 } });
  }
  const rec = kv.json('user-1');
  assert.deepEqual(rec.subs.map((s) => s.endpoint), [3, 4, 5, 6, 7].map((i) => sub(i).endpoint));
});

test('/activity は lastActive を JST の日付にする', async () => {
  await call('/subscribe', { body: { subscription: sub(1), hour: 20 } });
  // 2026-10-12 14:59 UTC = JST 10/12 23:59
  c.t = Date.UTC(2026, 9, 12, 14, 59);
  token = await signToken(rsa, goodClaims(c.t));
  let r = await call('/activity');
  assert.deepEqual(await r.json(), { ok: true, lastActive: '2026-10-12' });
  assert.equal(kv.json('user-1').lastActive, '2026-10-12');
  // 2026-10-12 15:30 UTC = JST 10/13 00:30
  c.t = Date.UTC(2026, 9, 12, 15, 30);
  r = await call('/activity');
  assert.deepEqual(await r.json(), { ok: true, lastActive: '2026-10-13' });
  assert.equal(kv.json('user-1').lastActive, '2026-10-13');
});

test('/test は全端末に送ってステータスを返し、410 の購読は消す', async () => {
  await call('/subscribe', { body: { subscription: sub(1), hour: 20 } });
  await call('/subscribe', { body: { subscription: sub(2), hour: 20 } });
  f = mockFetch({ jwks: () => [rsa.jwk], pushStatus: { [sub(2).endpoint]: 410 } });
  resetJwksCache();
  const r = await call('/test');
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.deepEqual(
    data.results.sort((a, b) => a.endpoint.localeCompare(b.endpoint)),
    [
      { endpoint: sub(1).endpoint, status: 201 },
      { endpoint: sub(2).endpoint, status: 410 },
    ],
  );
  assert.equal(f.pushCalls().length, 2);
  assert.deepEqual(kv.json('user-1').subs.map((s) => s.endpoint), [sub(1).endpoint]);
});

test('/test は購読がなければ 404', async () => {
  assert.equal((await call('/test')).status, 404);
});

test('default export の fetch も動く', async () => {
  const r = await worker.fetch(new Request('https://x.workers.dev/', { headers: { Origin: ORIGIN } }), env, {});
  assert.equal(r.status, 200);
});
