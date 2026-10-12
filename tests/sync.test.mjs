import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeAll, mergeProgress, sameValue, syncNow } from '../js/sync.js';
import { FIREBASE } from '../js/config.js';
import { signIn, signOut } from '../js/firebase.js';
import { state, save, resetProgress, DEFAULT_SETTINGS } from '../js/state.js';

const doc = (v, u) => ({ v, u });
const P = (s, t, extra = {}) => ({ s, w: 0, wc: 0, t, ...extra });

test('進捗: 別々に学習したカードは両方残り、同じカードは新しいほう', () => {
  const m = mergeProgress({ a: P(1, 100), b: P(2, 300) }, { b: P(1, 200), c: P(2, 150) });
  assert.deepEqual(Object.keys(m).sort(), ['a', 'b', 'c']);
  assert.equal(m.b.s, 2);
});

test('リセット時刻より前の記録は捨てる。復元した記録（u）はリセット後扱い', () => {
  const m = mergeProgress({ a: P(1, 100), b: P(1, 50, { u: 500 }) }, { c: P(2, 400) }, 300);
  assert.deepEqual(Object.keys(m).sort(), ['b', 'c']);
});

test('mergeAll: 設定は最後に変えたほう、マッチは速いほう、変化なしなら何も書かない', () => {
  const local = {
    settings: doc({ ...DEFAULT_SETTINGS, roundSize: 10 }, 200),
    selection: doc({ lessons: ['第1課'], types: ['単語'] }, 0),
    progress: doc({ a: P(1, 100) }, 100),
    flash: doc({}, 0),
    matchBest: doc({ r1: 9000, r2: 5000 }, 100),
    accepted: doc({}, 0),
  };
  const remote = {
    settings: doc({ ...DEFAULT_SETTINGS, roundSize: 5 }, 100),
    selection: doc({ lessons: ['第2課'], types: ['単語'] }, 150),
    matchBest: doc({ r1: 8000 }, 90),
  };
  const { toLocal, toRemote } = mergeAll(local, remote, 0);
  assert.equal(toRemote.settings.v.roundSize, 10);
  assert.equal(toLocal.selection.v.lessons[0], '第2課');
  assert.deepEqual(toLocal.matchBest.v, { r1: 8000, r2: 5000 });
  assert.ok(toRemote.progress);
  // 反映したあとは、もう一度まとめても何も起きない（キーの順番が違っても同じとみなす）
  const local2 = { ...local, ...toLocal };
  const remote2 = { ...remote, ...toRemote };
  remote2.progress = doc(JSON.parse(JSON.stringify(local2.progress.v)), 100);
  const again = mergeAll(local2, remote2, 0);
  assert.deepEqual(Object.keys(again.toLocal), []);
  assert.deepEqual(Object.keys(again.toRemote), []);
});

test('mergeAll: 片方でリセットしたら、もう片方の古い進捗・印・記録も消える', () => {
  const local = { progress: doc({ a: P(2, 100), late: P(1, 900) }, 900), flash: doc({ a: true }, 100), matchBest: doc({ r: 3000 }, 100) };
  const remote = { meta: doc({ resetAt: 500 }, 500), progress: doc({}, 500), flash: doc({}, 500), matchBest: doc({}, 500) };
  const { resetAt, toLocal } = mergeAll(local, remote, 0);
  assert.equal(resetAt, 500);
  assert.deepEqual(Object.keys(toLocal.progress.v), ['late']);
  assert.deepEqual(toLocal.flash.v, {});
  assert.deepEqual(toLocal.matchBest.v, {});
});

test('sameValue はキーの順番を無視する', () => {
  assert.ok(sameValue({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 }));
  assert.ok(!sameValue({ a: 1 }, { a: 1, b: 2 }));
});

// ---- Firestore を模した偽サーバーで、2台の端末が交互に同期する ----
function fakeFirebase() {
  const db = new Map();
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    calls.push(url);
    const json = (body, status = 200) => ({ ok: status < 300, status, json: async () => body });
    if (url.includes('accounts:signInWithPassword')) {
      const b = JSON.parse(opts.body);
      if (b.password !== 'pw') return json({ error: { message: 'INVALID_LOGIN_CREDENTIALS' } }, 400);
      return json({ localId: 'uid1', email: b.email, idToken: 'tok', refreshToken: 'ref', expiresIn: '3600' });
    }
    assert.equal(opts.headers?.authorization, 'Bearer tok');
    if (url.endsWith(':commit')) {
      for (const w of JSON.parse(opts.body).writes) db.set(w.update.name.split('/').pop(), w.update.fields);
      return json({});
    }
    if (url.includes('/users/uid1/data')) {
      return json({ documents: [...db].map(([k, fields]) => ({ name: `x/users/uid1/data/${k}`, fields })) });
    }
    return json({}, 404);
  };
  return { db, calls };
}

function becomeDevice(dev) {
  state.progress = dev.progress;
  state.flash = dev.flash;
  state.matchBest = dev.matchBest;
  state.accepted = dev.accepted;
  state.settings = dev.settings;
  state.selection = dev.selection;
  state.syncMeta = dev.syncMeta;
}
const newDevice = () => ({ progress: {}, flash: {}, matchBest: {}, accepted: {}, settings: { ...DEFAULT_SETTINGS }, selection: { lessons: ['第1課'], types: ['単語'] }, syncMeta: { updated: {}, resetAt: 0 } });
const snapshot = () => ({ progress: state.progress, flash: state.flash, matchBest: state.matchBest, accepted: state.accepted, settings: state.settings, selection: state.selection, syncMeta: state.syncMeta });

test('2台の端末で同期（ログイン・学習・設定変更・リセット）', async () => {
  const { db } = fakeFirebase();
  FIREBASE.apiKey = 'k';
  FIREBASE.projectId = 'p';
  await assert.rejects(signIn('me@example.com', 'wrong'), /メールアドレスかパスワードが違います/);
  await signIn('me@example.com', 'pw');

  // 端末A: 2枚学習して同期
  becomeDevice(newDevice());
  state.progress.a = P(1, 1000);
  state.progress.b = P(2, 1001);
  save.progress();
  await syncNow();
  const A = snapshot();
  assert.ok(db.has('progress'));

  // 端末B: 別のカードを学習し、設定を変えて同期 → A の分も入る
  becomeDevice(newDevice());
  state.progress.c = P(1, 2000);
  save.progress();
  state.settings.roundSize = 15;
  save.settings();
  await syncNow();
  assert.deepEqual(Object.keys(state.progress).sort(), ['a', 'b', 'c']);
  const B = snapshot();

  // 端末A に戻って同期 → B の学習と設定が届く
  becomeDevice(A);
  await syncNow();
  assert.deepEqual(Object.keys(state.progress).sort(), ['a', 'b', 'c']);
  assert.equal(state.settings.roundSize, 15);

  // 端末A で進捗をリセット → B でも消える
  await resetProgress();
  await syncNow();
  becomeDevice(B);
  await syncNow();
  assert.deepEqual(state.progress, {});

  await signOut();
});
