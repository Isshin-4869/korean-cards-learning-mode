// 表紙: 連続記録・記憶の予測・今日の復習。課の選択は「学習する」の先のページ（start.js）

import { h, iconButton } from '../ui.js';
import { state } from '../state.js';
import { streakOf, weekOf } from '../streak.js';
import { forecast, FORGET_AT } from '../memory.js';
import { todayReview } from '../review.js';
import { updateReady } from '../update.js';
import { go } from '../router.js';

const SVG = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs, ...kids) => {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(...kids);
  return el;
};

function streakCard() {
  const s = streakOf(state.days);
  const sub = s.todayDone
    ? `今日も学習しました。最高記録 ${s.best} 日`
    : s.days ? `今日やれば ${s.days + 1} 日。最高記録 ${s.best} 日` : s.best ? `今日からまた始めましょう。最高記録 ${s.best} 日` : '今日から始めましょう';
  return h('section', { class: 'card', 'aria-label': `${s.days}日連続` },
    h('div', { class: 'streak-num' }, String(s.days), h('small', null, ' 日連続')),
    h('div', { class: 'small muted', style: 'margin-top:6px' }, sub),
    h('div', { class: 'week' }, weekOf(state.days).map((d) => h('div', null,
      h('div', { class: 'tag' }, d.label),
      h('div', { class: `d${d.done ? ' on' : d.today ? ' today' : ''}`, 'aria-label': `${d.label}曜日${d.done ? ' 学習した' : d.today ? ' 今日' : ''}` }, d.done ? '✓' : d.today ? '今日' : '')))));
}

// 記憶の予測: このまま復習しなかったときの、学習した単語の平均の見込み（今日〜7日後）
function forecastCard() {
  const f = forecast(state.cards, state.progress);
  const head = h('div', { class: 'row' }, h('span', { class: 'grow', style: 'font-weight:600' }, '記憶の予測'), f.studied ? h('span', { class: 'small muted' }, `学習した ${f.studied} 枚`) : null);
  if (!f.studied) return h('section', { class: 'card' }, head, h('p', { class: 'small muted', style: 'margin:8px 0 0' }, '学習すると、覚えた単語がこの先どれくらい残りそうかをここに出します。'));
  const W = 326, H = 120, min = 0, max = 100;
  const x = (i) => 8 + (i * (W - 16)) / (f.values.length - 1);
  const y = (v) => 8 + ((max - Math.max(min, v)) * (H - 16)) / (max - min);
  const g = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `記憶の予測。今日 ${f.values[0]}%、7日後 ${f.values.at(-1)}%` },
    ...[100, 50].flatMap((v) => [svg('line', { x1: 0, x2: W, y1: y(v), y2: y(v), stroke: 'var(--sep)' }), svg('text', { x: W, y: y(v) + 12, 'text-anchor': 'end' }, `${v}%`)]),
    svg('line', { x1: 0, x2: W, y1: y(FORGET_AT * 100), y2: y(FORGET_AT * 100), stroke: 'var(--fg2)', 'stroke-dasharray': '3 3' }),
    svg('text', { x: 2, y: y(FORGET_AT * 100) + 13 }, '忘れかけ'),
    svg('polyline', { fill: 'none', stroke: 'var(--accent)', 'stroke-width': 2.5, 'stroke-linejoin': 'round', points: f.values.map((v, i) => `${x(i)},${y(v)}`).join(' ') }),
    svg('circle', { cx: x(0), cy: y(f.values[0]), r: 4, fill: 'var(--accent)' }));
  const msg = f.belowDay === 0 ? 'いま「忘れかけ」です。今日の復習で取り戻しましょう'
    : f.belowDay > 0 ? `このままだと ${f.belowDay}日後 に「忘れかけ」に`
      : '7日後まで「忘れかけ」にはなりません';
  return h('section', { class: 'card' }, head,
    h('div', { class: 'chart', style: 'margin-top:8px' }, g),
    h('div', { class: 'row tag', style: 'justify-content:space-between;margin-top:2px' }, h('span', null, '今日'), h('span', null, '3日後'), h('span', null, '7日後')),
    h('div', { class: 'small', style: 'margin-top:8px' }, msg));
}

function reviewBlock(rv) {
  if (rv.remaining) {
    return h('section', { class: 'card' },
      h('button', { class: 'btn primary', onClick: () => go('learn', { review: true }) }, `今日の復習 ${rv.remaining} 枚`),
      h('div', { class: 'small muted', style: 'margin-top:8px;text-align:center' },
        rv.done ? `今日 ${rv.done} 枚復習済み · 上限 ${rv.limit} 枚` : `忘れかけている単語から自動で選びます · 上限 ${rv.limit} 枚`));
  }
  const text = rv.done && rv.due ? `今日の上限（${rv.limit} 枚）まで復習しました`
    : rv.done ? `今日の復習は終わりました（${rv.done} 枚）`
      : '今は復習どきの単語はありません';
  return h('section', { class: 'card' }, h('div', { style: 'font-weight:600' }, '今日の復習'), h('div', { class: 'small muted', style: 'margin-top:4px' }, text));
}

export function homeScreen() {
  const rv = todayReview(state);
  const mode = (name, label) => h('button', { class: 'btn', onClick: () => go('start', { mode: name }) }, label);
  return h('div', null,
    h('div', { class: 'scroll' },
      h('div', { class: 'top' }, h('h1', { class: 'grow' }, '韓国語カード'), iconButton('search', '検索', () => go('search')), iconButton('gear', '設定', () => go('settings'))),
      updateReady() ? h('div', { class: 'row', style: 'margin-bottom:8px' }, h('span', { class: 'grow small' }, '新しいバージョンがあります'), h('button', { class: 'btn text', onClick: () => location.reload() }, '更新')) : null,
      streakCard(),
      forecastCard(),
      reviewBlock(rv),
      state.cardsSource === 'custom' ? h('p', { class: 'muted small' }, '設定から読み込んだカードデータを使っています') : null,
      h('div', { style: 'height:16px' })),
    h('div', { class: 'bottom', style: 'padding-top:12px' },
      // 今日の復習が残っているときは、そちらを主ボタンにする（主ボタンは画面に 1 つ）
      h('button', { class: rv.remaining ? 'btn block' : 'btn primary', style: rv.remaining ? 'min-height:56px;font-weight:600' : '', onClick: () => go('start', { mode: 'learn' }) }, '学習する'),
      h('div', { class: 'modes' }, mode('flash', '単語カード'), mode('test', 'テスト'), mode('spell', 'スペル'), mode('match', 'マッチ'))));
}
