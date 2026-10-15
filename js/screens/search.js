// 単語を探す（韓国語・日本語のどちらでも）

import { h, iconButton, speakButton } from '../ui.js';
import { state } from '../state.js';
import { searchCards } from '../search.js';
import { rec } from '../progress.js';
import { go } from '../router.js';

const LIMIT = 100;
const STATUS = ['未学習', '学習中', '習得'];
let lastQuery = '';

export function searchScreen() {
  const input = h('input', {
    class: 'field grow', type: 'search', enterkeyhint: 'search', autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false',
    placeholder: '韓国語・日本語で検索', 'aria-label': '単語を検索', value: lastQuery,
  });
  const info = h('div', { class: 'small muted', role: 'status', style: 'margin:12px 0 4px' });
  const list = h('div', { class: 'list' });

  function render() {
    lastQuery = input.value;
    const { total, items } = searchCards(state.cards, input.value, LIMIT);
    if (!input.value.trim()) {
      info.textContent = '例：기다리다、待つ、학교';
      list.replaceChildren();
      return;
    }
    info.textContent = total ? (total > LIMIT ? `${total} 件（上位 ${LIMIT} 件を表示）` : `${total} 件`) : '見つかりませんでした';
    list.replaceChildren(...items.map((c) => h('div', { class: 'lrow', style: 'align-items:flex-start' },
      h('div', { class: 'grow' },
        h('div', { class: 'ko', lang: 'ko', style: 'font-size:1.125rem;overflow-wrap:anywhere' }, c.term),
        h('div', { style: 'overflow-wrap:anywhere' }, c.definition),
        h('div', { class: 'tag' }, `${c.lesson} · ${c.ftype === '会話表現' ? c.type : c.ftype} · ${STATUS[rec(state.progress, c.id).s] ?? ''}`)),
      speakButton(c.term))));
  }

  // 打つたびに探す（日本語・韓国語の変換中も候補が見えるように）
  let timer = 0;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(render, 120);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) input.blur(); // 検索ボタンでキーボードを閉じて結果を見る
  });
  render();

  const root = h('div', null,
    h('div', { class: 'top' }, iconButton('back', '戻る', () => go('home')), h('h1', { class: 'grow' }, '検索')),
    h('div', { class: 'row' }, input),
    h('div', { class: 'scroll' }, info, list, h('div', { style: 'height:16px' })));
  root.onMounted = () => input.focus();
  return root;
}
