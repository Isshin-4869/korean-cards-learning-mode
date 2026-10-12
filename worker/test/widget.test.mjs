// ウィジェット（Scriptable）用の要約: /summary・/widget-token/rotate・GET /widget/<token>
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest, resetJwksCache, runCron, isWidgetKey } from '../src/index.js';
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

const call = (path, { body, method = 'POST', auth = true } = {}) => {
  const h = { Origin: ORIGIN };
  if (auth) h.Authorization = `Bearer ${token}`;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const req = new Request(`https://push.example.workers.dev${path}`, {
    method,
    headers: h,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  return handleRequest(req, env, {}, { fetch: f, now: c.now });
};
const getWidget = (t) => call(`/widget/${t}`, { method: 'GET', auth: false });

const summary = (over = {}) => ({ range: '第1〜5課', total: 140, mastered: 76, learning: 31, unseen: 33, pct: 54, stage: 3, seed: 'range', today: 21, lessons: [{ n: '1', pct: 100, stage: 5 }], updatedAt: NOW, ...over });

// 書き込み回数を数える
const countPuts = () => {
  const orig = kv.put.bind(kv);
  const n = { puts: 0 };
  kv.put = async (k, v) => {
    n.puts++;
    return orig(k, v);
  };
  return n;
};

test('初回の /summary で token ができ、2回目以降も同じ token', async () => {
  let r = await call('/summary', { body: { summary: summary() } });
  assert.equal(r.status, 200);
  const first = await r.json();
  assert.equal(first.ok, true);
  assert.match(first.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(await kv.get(`wtoken:${first.token}`), 'user-1');
  assert.equal(kv.json('widget:user-1').token, first.token);
  assert.equal(kv.json('widget:user-1').updatedAt, NOW);

  c.t += 60_000;
  r = await call('/summary', { body: { summary: summary({ pct: 55 }) } });
  assert.equal((await r.json()).token, first.token);
  assert.equal(kv.json('widget:user-1').summary.pct, 55);
  assert.equal(kv.json('widget:user-1').updatedAt, NOW + 60_000);
  // token の対応は 1 つだけ
  assert.equal([...kv.map.keys()].filter((k) => k.startsWith('wtoken:')).length, 1);
});

test('中身が同じなら KV に書き込まない（updatedAt だけの違いは同じとみなす）', async () => {
  await call('/summary', { body: { summary: summary() } });
  const n = countPuts();
  c.t += 60_000;
  const r = await call('/summary', { body: { summary: summary({ updatedAt: NOW + 60_000 }) } });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).changed, false);
  assert.equal(n.puts, 0);
  assert.equal(kv.json('widget:user-1').updatedAt, NOW);
});

test('GET /widget/<token> は要約を返す（ログイン不要、キャッシュしない）', async () => {
  const { token: wt } = await (await call('/summary', { body: { summary: summary() } })).json();
  const r = await getWidget(wt);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await r.json(), { v: 1, summary: summary(), updatedAt: NOW });
});

test('知らない token・形の違う token は 404', async () => {
  await call('/summary', { body: { summary: summary() } });
  for (const t of ['A'.repeat(43), 'short', 'A'.repeat(42) + '.', '']) {
    const r = await getWidget(t);
    assert.equal(r.status, 404, t);
    assert.equal(r.headers.get('Cache-Control'), 'no-store');
  }
  assert.equal((await call('/widget/', { method: 'GET', auth: false })).status, 404);
});

test('rotate で token が変わり、古い URL は 404', async () => {
  const { token: old } = await (await call('/summary', { body: { summary: summary() } })).json();
  const r = await call('/widget-token/rotate');
  assert.equal(r.status, 200);
  const { token: next } = await r.json();
  assert.notEqual(next, old);
  assert.equal((await getWidget(old)).status, 404);
  assert.equal(kv.map.has(`wtoken:${old}`), false);
  assert.equal((await getWidget(next)).status, 200);
  // 以後の /summary は新しい token を返す
  assert.equal((await (await call('/summary', { body: { summary: summary({ pct: 60 }) } })).json()).token, next);
});

test('rotate は要約がまだなければ 404、ログインなしは 401', async () => {
  assert.equal((await call('/widget-token/rotate')).status, 404);
  assert.equal((await call('/widget-token/rotate', { auth: false })).status, 401);
});

test('ログインなしの /summary は 401 で、何も書かない', async () => {
  assert.equal((await call('/summary', { auth: false, body: { summary: summary() } })).status, 401);
  token = 'a.b.c';
  assert.equal((await call('/summary', { body: { summary: summary() } })).status, 401);
  assert.equal(kv.map.size, 0);
});

test('入力チェック: 形が違えば 400、4KB を超えれば 413', async () => {
  for (const body of [{}, { summary: null }, { summary: [1, 2] }, { summary: 'x' }, { summary: 3 }]) {
    assert.equal((await call('/summary', { body })).status, 400, JSON.stringify(body));
  }
  assert.equal((await call('/summary', { body: '{not json' })).status, 400);
  assert.equal((await call('/summary', { body: { summary: { pad: 'x'.repeat(5000) } } })).status, 413);
  assert.equal((await call('/summary', { body: { summary: { pad: 'x'.repeat(20000) } } })).status, 413);
  assert.equal(kv.map.size, 0);
});

test('cron はウィジェット用のキーを読まずに飛ばし、購読の人には送る', async () => {
  kv.pageSize = 1;
  await call('/summary', { body: { summary: summary() } });
  await kv.put('u', JSON.stringify({ subs: [{ ...sub(1), createdAt: 1 }], hour: 20, enabled: true, lastActive: '' }));
  const read = [];
  const orig = kv.get.bind(kv);
  kv.get = async (k) => {
    read.push(k);
    return orig(k);
  };
  const s = await runCron(env, { fetch: f, now: c.now });
  assert.equal(s.users, 1);
  assert.deepEqual(read, ['u']);
  assert.deepEqual(f.pushCalls().map((x) => x.url), [sub(1).endpoint]);
  assert.ok(isWidgetKey('widget:user-1') && isWidgetKey('wtoken:abc') && !isWidgetKey('user-1'));
});
