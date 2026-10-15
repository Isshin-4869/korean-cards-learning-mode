import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseCardsMarkdown } from '../js/cards.js';
import { searchCards } from '../js/search.js';

const { cards } = parseCardsMarkdown(fs.readFileSync(fileURLToPath(new URL('../data/cards.md', import.meta.url)), 'utf8'));

test('韓国語で探す: 完全一致が先頭、同じ用語で意味違いのカードも全部出る', () => {
  const r = searchCards(cards, '일');
  assert.ok(r.total > 3);
  const first = r.items.slice(0, 3).map((c) => c.term);
  assert.deepEqual(first, ['일', '일', '일']);
});

test('日本語で探す・空白や全角半角や「～」の違いを無視する', () => {
  assert.ok(searchCards(cards, '待つ').items.some((c) => c.term === '기다리다'));
  assert.equal(searchCards(cards, '학교옆에').items[0].term, '학교 옆에 카페가 있어요.');
  assert.ok(searchCards(cards, 'に').items.some((c) => c.definition === '～に'));
  assert.equal(searchCards(cards, '  ').total, 0);
});

test('件数の上限', () => {
  const r = searchCards(cards, 'ます', 10);
  assert.equal(r.items.length, 10);
  assert.ok(r.total > 10);
});
