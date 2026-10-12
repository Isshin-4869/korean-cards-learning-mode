import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stageOf, stageOfSummary, seedOf, rangePlanetName, STAGES } from '../js/planet.js';

test('習得率の境目で段階が変わる', () => {
  const cases = [[0, 0], [1, 1], [24, 1], [25, 2], [49, 2], [50, 3], [74, 3], [75, 4], [99, 4], [100, 5]];
  for (const [pct, stage] of cases) assert.equal(stageOf(pct, 0), stage, `${pct}%`);
  assert.equal(stageOf(99.9, 0.1), 4, '丸めて 100% でも全部習得するまでは完成にしない');
  assert.equal(STAGES.length, 6);
});

test('習得 0 でも学習中があれば「ちり」から岩の星になる', () => {
  assert.equal(stageOf(0, 0), 0);
  assert.equal(stageOf(0, 3), 1);
  assert.equal(stageOfSummary({ total: 0, mastered: 0, learning: 0 }), 0);
  assert.equal(stageOfSummary({ total: 4, mastered: 1, learning: 0 }), 2);
  assert.equal(stageOfSummary({ total: 3, mastered: 2, learning: 1 }), 3);
});

test('seed は名前だけで決まる', () => {
  assert.equal(seedOf('第4課'), seedOf('第4課'));
  assert.notEqual(seedOf('第4課'), seedOf('第5課'));
  for (const n of ['range', '第1課', '会話表現', '']) {
    const s = seedOf(n);
    assert.ok(Number.isInteger(s) && s >= 1 && s <= 1000, n);
  }
});

test('範囲の惑星: 1課だけなら課と同じ星、種別では形が変わらない', () => {
  assert.equal(rangePlanetName('第1課|単語,文法'), '第1課');
  assert.equal(rangePlanetName('第1課,第2課|単語'), rangePlanetName('第1課,第2課|単語,文法'));
  assert.notEqual(rangePlanetName('第1課,第2課|単語'), rangePlanetName('第1課,第3課|単語'));
});
