import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkAnswer, normalizeForCompare, answerVariants, jamoDistance, speechParts, diffAnswer } from '../js/answer.js';

const ok = (input, ans, opts) => checkAnswer(input, ans, opts).correct;

test('前後の空白・文末記号・全角半角・NFC をそろえる', () => {
  assert.ok(ok('  숙제가 아니에요  ', '숙제가 아니에요.'));
  assert.ok(ok('선배입니까', '선배입니까?'));
  assert.ok(ok('どうですか', 'どうですか？'));
  assert.ok(ok('１', '1（数字）'));
  assert.ok(ok('잘했어요!!', '잘했어요!'));
  // NFD で入ってきたハングルも同じとみなす
  assert.ok(ok('아이'.normalize('NFD'), '아이'));
});

test('分かち書き: 既定は無視、設定オンなら判定する', () => {
  assert.ok(ok('학교옆에카페가있어요', '학교 옆에 카페가 있어요.'));
  assert.ok(!ok('학교옆에카페가있어요', '학교 옆에 카페가 있어요.', { ignoreSpacing: false, allowTypo: false }));
  assert.ok(ok('학교  옆에 카페가 있어요', '학교 옆에 카페가 있어요.', { ignoreSpacing: false }));
});

test('（注記）・[発音]・⚠以降は判定に使わない', () => {
  assert.ok(ok('わたし', 'わたし（ぼく、おれ）'));
  assert.ok(ok('姉', '（弟から見た）姉'));
  assert.ok(ok('何日', '何日 ⚠「何＋日」の組み合わせで書かない'));
  assert.ok(ok('先輩ですか', '先輩ですか？（ハムニダ体）'));
  assert.ok(ok('읽는', '읽는 [잉는]'));
});

test('「A / B」「A、B」はどれか1つで正解。文では「、」で分けない', () => {
  assert.ok(ok('안 읽어요', '안 읽어요 / 읽지 않아요'));
  assert.ok(ok('읽지 않아요', '안 읽어요 / 읽지 않아요'));
  assert.ok(ok('とても', 'とても／あまりに・～すぎる'));
  assert.ok(ok('初めて', 'はじめ、初めて'));
  assert.ok(ok('はじめ、初めて', 'はじめ、初めて'));
  assert.ok(!ok('皆さん', '皆さん、こんにちは。', { splitComma: false, allowTypo: false }));
  assert.ok(ok('皆さん、こんにちは', '皆さん、こんにちは。', { splitComma: false }));
  assert.deepEqual(answerVariants('A / B'), ['A', 'B']);
});

test('「～」の有無は区別しない', () => {
  assert.ok(ok('に', '～に'));
  assert.ok(ok('〜日', '～日（日付）'));
});

test('同じ用語で意味違いのカードは、両方の答えを渡せばどちらも正解', () => {
  const answers = ['1（数字）', '～日（日付）'];
  assert.ok(ok('1', answers));
  assert.ok(ok('日', answers));
  assert.ok(!ok('月', answers, { allowTypo: false }));
});

test('1文字ミス許容: 字母の編集距離1以内は「ほぼ正解」', () => {
  assert.equal(jamoDistance('읽어요', '일어요'), 1); // ㄺ→ㄹ
  const r = checkAnswer('기다르다', '기다리다');
  assert.deepEqual([r.correct, r.near], [true, true]);
  assert.ok(!ok('기다르다', '기다리다', { allowTypo: false }));
  assert.ok(!ok('기도르다', '기다리다')); // 2字母違い
  // 短すぎる正解は1文字違いを通さない
  assert.ok(!ok('이', '일'));
  assert.ok(!ok('2', '1'));
});

test('空の入力は不正解', () => {
  assert.ok(!ok('   ', '아이'));
  assert.equal(normalizeForCompare(' 아 이 '), '아이');
});

test('読み上げ用テキスト', () => {
  assert.deepEqual(speechParts('안 읽어요 / 읽지 않아요'), ['안 읽어요', '읽지 않아요']);
  assert.deepEqual(speechParts('○○ 씨는요?'), ['씨는요?']);
  assert.deepEqual(speechParts('읽는 [잉는]'), ['읽는']);
  assert.deepEqual(speechParts('-러 / -으러'), ['러', '으러']);
  assert.deepEqual(speechParts('ㄷ 불규칙'), ['ㄷ 불규칙']);
  assert.deepEqual(speechParts('[임니다]'), ['임니다']);
});

test('打ち間違いは語ごとに判定する（長い文で1語に1字母ずつなら正解、1語に2字母なら不正解）', () => {
  const ans = '학교 옆에 카페가 있어요.';
  const r = checkAnswer('학교 옆애 카패가 있어요', ans);
  assert.deepEqual([r.correct, r.near], [true, true]);
  assert.ok(!ok('학교 옆에 카페가 없어요', ans)); // 「있어요」→「없어요」は 2 字母以上の違い
  assert.ok(ok('하교 옆에 카페가 있어요', ans)); // 「학교」は 5 字母なので 1 字母まで可
});

test('打ち間違いの結果がほかのカードの正解になるなら不正解', () => {
  const reject = new Set(['일어요']);
  assert.ok(ok('일어요', '읽어요'));
  assert.ok(!ok('일어요', '읽어요', { reject }));
});

test('分かち書きだけが違う正解は spacing として知らせる', () => {
  const r = checkAnswer('학교옆에 카페가있어요', '학교 옆에 카페가 있어요.');
  assert.deepEqual([r.correct, r.near, r.spacing], [true, false, true]);
  assert.equal(checkAnswer('학교 옆에 카페가 있어요', '학교 옆에 카페가 있어요.').spacing, false);
});

test('正解との違いを音節単位で示す', () => {
  const d = diffAnswer('학교 옆에 카페가 없어요', '학교 옆에 카페가 있어요.');
  assert.deepEqual(d.filter((x) => x.op === 'miss').map((x) => x.t), ['있', '.']);
  assert.equal(d.map((x) => x.t).join(''), '학교 옆에 카페가 있어요.');
});
