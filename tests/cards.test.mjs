import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  parseCardsMarkdown, countCards, classify, cardId, stripNotes,
  KIND_WORD, KIND_SENTENCE, KIND_PATTERN,
} from '../js/cards.js';

const mdPath = fileURLToPath(new URL('../data/cards.md', import.meta.url));
const md = fs.readFileSync(mdPath, 'utf8');

test('同梱データの件数が md 冒頭の記載と一致する', () => {
  const { cards, issues } = parseCardsMarkdown(md);
  assert.deepEqual(issues, []);
  const c = countCards(cards);
  assert.equal(c.total, 2114);
  assert.deepEqual(c.byType, { 単語: 878, 文法: 1154, 会話表現: 82 });
  assert.equal(Object.keys(c.byLesson).length, 23);
});

test('同じ課・同じ用語で意味違いのカードは別 ID になる', () => {
  const { cards } = parseCardsMarkdown(md);
  const il = cards.filter((c) => c.lesson === '第10課' && c.term === '일');
  assert.equal(il.length, 2);
  assert.notEqual(il[0].id, il[1].id);
  const man = cards.filter((c) => c.lesson === '第10課' && c.term === '만');
  assert.ok(man.length >= 2);
  assert.equal(new Set(man.map((c) => c.id)).size, man.length);
  assert.equal(new Set(cards.map((c) => c.id)).size, cards.length);
});

test('別の課の同じ用語・同じ定義は別カードだが same キーが一致する', () => {
  const { cards } = parseCardsMarkdown(md);
  const n = cards.filter((c) => c.term === '놉니다');
  assert.deepEqual(n.map((c) => c.lesson), ['第8課', '第14課']);
  assert.notEqual(n[0].id, n[1].id);
  assert.equal(n[0].same, n[1].same);
});

test('ID は内容から決まり、読み込み直しても同じ', () => {
  assert.equal(cardId('第1課', '単語', '아이', '子供'), cardId('第1課', '単語', '아이', '子供'));
  assert.notEqual(cardId('第1課', '単語', '아이', '子供'), cardId('第2課', '単語', '아이', '子供'));
  const a = parseCardsMarkdown(md).cards.map((c) => c.id);
  const b = parseCardsMarkdown(md.replace(/\n/g, '\r\n')).cards.map((c) => c.id);
  assert.deepEqual(a, b);
});

test('見出し行・空行を飛ばし、列数違いと重複を報告する', () => {
  const src = '```text\n課\t種別\t用語\t定義\n第1課\t単語\t아이\t子供\n\n第1課\t単語\t아이\t子供\n第1課\t単語\t오이\n```';
  const { cards, issues } = parseCardsMarkdown(src);
  assert.equal(cards.length, 1);
  assert.deepEqual(issues.map((i) => i.kind).sort(), ['columns', 'duplicate']);
});

test('分類: 語・文・文型', () => {
  const k = (lesson, type, term, definition) => classify({ lesson, type, term, definition });
  assert.equal(k('第1課', '単語', '아이', '子供'), KIND_WORD);
  assert.equal(k('第7課', '文法', '이게', 'これが（話し言葉の縮約形）'), KIND_WORD);
  assert.equal(k('第7課', '文法', '숙제가 아니에요.', '宿題ではありません。'), KIND_SENTENCE);
  assert.equal(k('第6課', '文法', '선배입니까?', '先輩ですか？（ハムニダ体）'), KIND_SENTENCE);
  assert.equal(k('会話表現', 'あいさつ', '천천히 말해 주세요', 'ゆっくり話してください'), KIND_SENTENCE);
  assert.equal(k('第19課', '文法', '-러 / -으러', '～しに'), KIND_PATTERN);
  assert.equal(k('第21課', '文法', 'ㄷ 불규칙', 'ㄷ変則'), KIND_PATTERN);
  assert.equal(k('第9課', '文法', '시 · 개 · 사람/명', '時・個・人/名'), KIND_PATTERN);
  assert.equal(k('会話表現', '自己紹介', '저는 ○○입니다', '私は○○です'), KIND_PATTERN);
  assert.equal(k('第8課', '文法', '이다 + -ㅂ니다 = 입니다', '指定詞'), KIND_PATTERN);
});

test('stripNotes は（注記）[発音] ⚠以降を除く', () => {
  assert.equal(stripNotes('何日 ⚠「何＋日」の組み合わせで書かない'), '何日');
  assert.equal(stripNotes('わたし（ぼく、おれ）'), 'わたし');
  assert.equal(stripNotes('（弟から見た）姉'), '姉');
  assert.equal(stripNotes('읽는 [잉는]'), '읽는');
});
