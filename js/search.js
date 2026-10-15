// 単語の検索（韓国語・日本語のどちらでも）。注記も含めて探し、空白・全角半角・「～」の違いは無視する

// 完全一致・前方一致・部分一致のどれか（なければ Infinity）
const rank = (text, q, [exact, prefix, part]) => (text === q ? exact : text.startsWith(q) ? prefix : text.includes(q) ? part : Infinity);
const norm = (s) => String(s).normalize('NFKC').toLowerCase().replace(/[\s〜～~]/g, '').normalize('NFC');

/**
 * 一致の強さ: 完全一致 ＞ 前方一致 ＞ 部分一致。用語（韓国語）での一致を定義での一致より前に。
 * 同じ強さなら課の順（データの並び）
 */
export function searchCards(cards, query, limit = 100) {
  const q = norm(query);
  if (!q) return { total: 0, items: [] };
  const hits = [];
  for (const c of cards) {
    c._t ??= norm(c.term);
    c._d ??= norm(c.definition);
    const score = Math.min(rank(c._t, q, [0, 1, 3]), rank(c._d, q, [2, 4, 5]));
    if (score < Infinity) hits.push([score, c.order, c]);
  }
  hits.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return { total: hits.length, items: hits.slice(0, limit).map((x) => x[2]) };
}
