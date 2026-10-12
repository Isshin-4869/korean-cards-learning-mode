import { h, iconButton, progressBar } from '../ui.js';
import { state, save, cardsInRange, currentRangeKey, rangeLabel } from '../state.js';
import { TYPES } from '../cards.js';
import { summarize } from '../progress.js';
import { go, rerender } from '../router.js';
import { updateReady } from '../update.js';
import { STAGES, stageOfSummary, planetCanvas, rangePlanetName, rng } from '../planet.js';

let rangeMode = false;
let anchor = null;

export function homeScreen() {
  const sel = state.selection;
  const pool = cardsInRange();
  const sum = summarize(pool, state.progress);

  const typeChips = h('div', { class: 'seg-ctl', role: 'group', 'aria-label': '種別' },
    TYPES.map((t) => h('button', {
      class: 'btn small', 'aria-pressed': String(sel.types.includes(t)),
      onClick: () => {
        const on = sel.types.includes(t);
        if (on && sel.types.length === 1) return;
        sel.types = on ? sel.types.filter((x) => x !== t) : [...sel.types, t];
        save.selection();
        rerender();
      },
    }, t)));

  const tiles = h('div', { class: 'lgrid' }, state.lessons.map((l) => {
    const cs = state.cards.filter((c) => c.lesson === l && sel.types.includes(c.ftype));
    const all = cs.length ? cs : state.cards.filter((c) => c.lesson === l);
    const s = summarize(all, state.progress);
    // 全部習得するまで 100% と出さない（惑星の「完成」とずれないように切り捨て）
    const pct = s.total ? Math.floor((s.mastered / s.total) * 100) : 0;
    const stage = stageOfSummary(s);
    return h('button', {
      class: `ltile${anchor === l ? ' anchor' : ''}`, 'aria-pressed': String(sel.lessons.includes(l)),
      'aria-label': `${l} 習得${pct}% ${cs.length}枚 ${STAGES[stage]}`,
      onClick: () => tapLesson(l),
    }, planetCanvas(l, stage, 28, 16), h('span', null, l === '会話表現' ? '会話' : l.replace('第', '')), h('span', { class: 'muted small dot' }, `${pct}%`));
  }));

  function tapLesson(l) {
    if (rangeMode) {
      if (!anchor) {
        anchor = l;
      } else {
        const a = state.lessons.indexOf(anchor);
        const b = state.lessons.indexOf(l);
        sel.lessons = state.lessons.slice(Math.min(a, b), Math.max(a, b) + 1);
        anchor = null;
        rangeMode = false;
        save.selection();
      }
    } else {
      const on = sel.lessons.includes(l);
      if (on && sel.lessons.length === 1) return;
      sel.lessons = on ? sel.lessons.filter((x) => x !== l) : [...sel.lessons, l];
      save.selection();
    }
    rerender();
  }

  const learnSess = state.sessions.learn;
  const resumable = learnSess && learnSess.scope?.range === currentRangeKey() && learnSess.phase === 'q';
  const startLabel = resumable
    ? `学習の続き（${Math.min(learnSess.round.pos + 1, learnSess.round.queue.length)}/${learnSess.round.queue.length}）`
    : `学習 · ${pool.length}枚`;

  const stage = stageOfSummary(sum);

  return h('div', { class: 'home' },
    stars(),
    h('div', { class: 'scroll' },
      h('div', { class: 'top' }, h('h1', { class: 'grow' }, '韓国語カード'), iconButton('gear', '設定', () => go('settings'))),
      updateReady() ? h('div', { class: 'row', style: 'margin-bottom:8px' }, h('span', { class: 'grow small' }, '新しいバージョンがあります'), h('button', { class: 'btn text', onClick: () => location.reload() }, '更新')) : null,
      h('div', { class: 'home-planet' },
        planetCanvas(rangePlanetName(currentRangeKey()), stage, 150),
        h('div', { class: 'muted small' }, `${rangeLabel()}の星 · ${STAGES[stage]}`)),
      h('div', { class: 'stats' },
        h('div', null, h('b', { class: 'acc' }, sum.mastered), h('span', { class: 'muted small' }, '習得')),
        h('div', null, h('b', null, sum.learning), h('span', { class: 'muted small' }, '学習中')),
        h('div', null, h('b', null, sum.unseen), h('span', { class: 'muted small' }, '未学習'))),
      progressBar(sum.mastered, sum.learning, sum.total),
      h('div', { class: 'section-title' }, '種別'),
      typeChips,
      h('div', { class: 'row', style: 'margin:20px 0 8px' },
        h('span', { class: 'muted small grow' }, rangeMode ? (anchor ? '終わりの課をタップ' : '始まりの課をタップ') : '課（タップで範囲に入れる・外す）'),
        h('button', { class: 'btn text small', 'aria-pressed': String(rangeMode), onClick: () => { rangeMode = !rangeMode; anchor = null; rerender(); } }, rangeMode ? 'やめる' : '範囲指定'),
        h('button', { class: 'btn text small', onClick: () => { sel.lessons = [...state.lessons]; save.selection(); rerender(); } }, '全部')),
      tiles,
      state.cardsSource === 'custom' ? h('p', { class: 'muted small' }, '設定から読み込んだカードデータを使っています') : null,
      h('div', { style: 'height:16px' })),
    h('div', { class: 'bottom', style: 'padding-top:12px' },
      h('button', { class: 'btn primary', disabled: !pool.length, onClick: () => go('learn') }, startLabel),
      h('div', { class: 'modes' },
        h('button', { class: 'btn', onClick: () => go('flash') }, '単語カード'),
        h('button', { class: 'btn', onClick: () => go('test') }, 'テスト'),
        h('button', { class: 'btn', onClick: () => go('spell') }, 'スペル'),
        h('button', { class: 'btn', onClick: () => go('match') }, 'マッチ'))));
}

// 背景の星。位置は番号だけで決まり、データが変わっても動かない
const STAR_POS = (() => {
  const r = rng(3);
  return Array.from({ length: 40 }, () => [r() * 100, r() * 100, r() < 0.15]);
})();
const stars = () => h('div', { class: 'stars', 'aria-hidden': 'true' },
  STAR_POS.map(([x, y, big]) => h('i', { class: big ? 'b' : null, style: `left:${x.toFixed(2)}%;top:${y.toFixed(2)}%` })));
