// 毎時の cron
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker, { runCron, jstNow } from '../src/index.js';
import { mockFetch, makeEnv, clock, sub, FakeKV, NOW } from './helpers.mjs';

let env, kv, f;

const rec = (over = {}) =>
  JSON.stringify({
    subs: [{ ...sub(1), createdAt: 1 }],
    hour: 20,
    enabled: true,
    lastActive: '2026-10-11',
    ...over,
  });

beforeEach(async () => {
  kv = new FakeKV(2);
  env = await makeEnv(kv);
  f = mockFetch({ jwks: () => [] });
});

const run = (t = NOW) => runCron(env, { fetch: f, now: clock(t).now });

test('jstNow は UTC+9 の日付と時', () => {
  assert.deepEqual(jstNow(NOW), { date: '2026-10-12', hour: 20 });
  assert.deepEqual(jstNow(Date.UTC(2026, 9, 12, 15, 0)), { date: '2026-10-13', hour: 0 });
});

test('JST の時が合えば送る（ページをまたいでも全員見る）', async () => {
  await kv.put('a', rec({ hour: 9 }));
  await kv.put('b', rec({ hour: 9 }));
  await kv.put('c', rec({ hour: 9 }));
  await kv.put('u', rec({ subs: [{ ...sub(1), createdAt: 1 }, { ...sub(2), createdAt: 2 }] }));
  const s = await run();
  assert.equal(s.hour, 20);
  assert.equal(s.users, 1);
  assert.equal(s.sent, 2);
  assert.deepEqual(f.pushCalls().map((c) => c.url).sort(), [sub(1).endpoint, sub(2).endpoint]);
});

test('今日もう学習していれば送らない', async () => {
  await kv.put('u', rec({ lastActive: '2026-10-12' }));
  await run();
  assert.equal(f.pushCalls().length, 0);
});

test('時が違えば送らない', async () => {
  await kv.put('u', rec({ hour: 21 }));
  await run();
  assert.equal(f.pushCalls().length, 0);
});

test('enabled: false なら送らない', async () => {
  await kv.put('u', rec({ enabled: false }));
  await run();
  assert.equal(f.pushCalls().length, 0);
});

test('410 / 404 が返った購読は消え、全部消えたらキーも消える', async () => {
  await kv.put('u', rec({ subs: [{ ...sub(1), createdAt: 1 }, { ...sub(2), createdAt: 2 }] }));
  f = mockFetch({ jwks: () => [], pushStatus: { [sub(1).endpoint]: 410 } });
  const s = await run();
  assert.equal(s.removed, 1);
  assert.deepEqual(kv.json('u').subs.map((x) => x.endpoint), [sub(2).endpoint]);
  f = mockFetch({ jwks: () => [], pushStatus: { [sub(2).endpoint]: 404 } });
  await run();
  assert.equal(kv.map.has('u'), false);
});

test('scheduled は waitUntil に渡し、予定時刻で判定する', async () => {
  await kv.put('u', rec({ hour: 20 }));
  const orig = globalThis.fetch;
  const pushes = [];
  globalThis.fetch = async (url) => {
    pushes.push(String(url));
    return new Response(null, { status: 201 });
  };
  try {
    const waits = [];
    worker.scheduled({ scheduledTime: NOW, cron: '0 * * * *' }, env, { waitUntil: (p) => waits.push(p) });
    assert.equal(waits.length, 1);
    await Promise.all(waits);
    assert.deepEqual(pushes, [sub(1).endpoint]);
  } finally {
    globalThis.fetch = orig;
  }
});
