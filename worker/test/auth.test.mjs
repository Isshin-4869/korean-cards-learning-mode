// Firebase ID トークンの検証
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { verifyFirebaseToken, resetJwksCache } from '../src/index.js';
import { makeRsa, signToken, goodClaims, mockFetch, clock, PROJECT, NOW, GOOGLE_JWKS_URL } from './helpers.mjs';

const rsa = await makeRsa('k1');
const other = await makeRsa('k1'); // 同じ kid で別の鍵 → 署名が合わない

beforeEach(() => resetJwksCache());

const deps = (keys = [rsa.jwk], c = clock()) => ({ fetch: mockFetch({ jwks: () => keys }), now: c.now });

test('正しいトークンなら uid を返す', async () => {
  const d = deps();
  assert.equal(await verifyFirebaseToken(await signToken(rsa, goodClaims()), PROJECT, d), 'user-1');
  // 2 回目は鍵をキャッシュから使う
  await verifyFirebaseToken(await signToken(rsa, goodClaims()), PROJECT, d);
  assert.equal(d.fetch.calls.filter((c) => c.url === GOOGLE_JWKS_URL).length, 1);
});

const rejects = (name, make) =>
  test(name, async () => {
    await assert.rejects(verifyFirebaseToken(await make(), PROJECT, deps()));
  });

rejects('aud 違いは拒否', () => signToken(rsa, goodClaims(NOW, { aud: 'other-project' })));
rejects('iss 違いは拒否', () => signToken(rsa, goodClaims(NOW, { iss: 'https://securetoken.google.com/other' })));
rejects('期限切れは拒否', () => signToken(rsa, goodClaims(NOW, { exp: Math.floor(NOW / 1000) - 1 })));
rejects('未来の iat は拒否', () => signToken(rsa, goodClaims(NOW, { iat: Math.floor(NOW / 1000) + 600 })));
rejects('sub が空なら拒否', () => signToken(rsa, goodClaims(NOW, { sub: '' })));
rejects('署名が違えば拒否', () => signToken(other, goodClaims()));
rejects('知らない kid は拒否', () => signToken(rsa, goodClaims(), { kid: 'unknown' }));
rejects('alg が RS256 以外は拒否', () => signToken(rsa, goodClaims(), { alg: 'HS256' }));
rejects('形が壊れていれば拒否', async () => 'abc.def');

test('知らない kid が来たら鍵を取り直す（鍵の入れ替え）', async () => {
  const k2 = await makeRsa('k2');
  let keys = [rsa.jwk];
  const c = clock();
  const d = { fetch: mockFetch({ jwks: () => keys }), now: c.now };
  await verifyFirebaseToken(await signToken(rsa, goodClaims()), PROJECT, d);
  keys = [rsa.jwk, k2.jwk];
  c.t += 60 * 1000;
  assert.equal(await verifyFirebaseToken(await signToken(k2, goodClaims(c.t)), PROJECT, d), 'user-1');
  assert.equal(d.fetch.calls.length, 2);
});
