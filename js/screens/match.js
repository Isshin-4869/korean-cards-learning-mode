// モード5: マッチ。6組（12枚）を2回タップでペアにする。間違えたら1秒加算

import { h, iconButton, fmtTime } from '../ui.js';
import { state, save, cardsInRange, currentRangeKey, rangeLabel } from '../state.js';
import { stripNotes } from '../cards.js';
import { shuffle } from '../deck.js';
import { go, onLeave } from '../router.js';

const PAIRS = 6;
const PENALTY = 1000;
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function matchScreen() {
  const deck = state.deck;
  const root = h('div');
  const show = (...kids) => root.replaceChildren(...kids.flat().filter(Boolean));
  const key = currentRangeKey();
  let raf = 0;
  onLeave(() => cancelAnimationFrame(raf));

  function intro(result) {
    const pool = cardsInRange();
    const best = state.matchBest[key];
    show(
      h('div', { class: 'top' }, iconButton('back', '戻る', () => go('home')), h('h1', { class: 'grow' }, 'マッチ')),
      h('div', { class: 'fill center', style: 'text-align:center' },
        result ? h('div', null,
          h('div', { class: 'muted small' }, result.best ? '自己ベスト更新' : 'タイム'),
          h('div', { class: 'timer', style: 'font-size:2.5rem' }, fmtTime(result.time)),
          result.misses ? h('div', { class: 'muted small' }, `ミス ${result.misses}回（+${result.misses}秒）`) : null) : null,
        h('p', { class: 'muted' }, `${rangeLabel()}${best ? ` · 自己ベスト ${fmtTime(best)}` : ''}`),
        result ? null : h('p', { class: 'muted small' }, '韓国語と意味をタップしてペアにします。全部消すまでのタイムを競います。')),
      h('div', { class: 'bottom stack' },
        h('button', { class: 'btn primary', disabled: pool.length < 2, onClick: () => play(pool) }, result ? 'もう一度' : 'スタート'),
        result ? h('button', { class: 'btn text block', onClick: () => go('home') }, 'ホームへ') : null));
  }

  function play(pool) {
    const cards = deck.distinctPairs(pool, PAIRS);
    const tiles = shuffle(cards.flatMap((c) => [{ id: c.id, ko: true, text: c.term }, { id: c.id, ko: false, text: stripNotes(c.definition) || c.definition }]));
    const t0 = performance.now();
    let penalty = 0;
    let misses = 0;
    let left = cards.length;
    let sel = null;
    const timer = h('span', { class: 'timer' }, '0.0秒');
    const pen = h('span', { class: 'muted small' });
    const grid = h('div', { class: 'mgrid' });
    tiles.forEach((t) => {
      t.el = h('button', { class: `tile${t.ko ? ' ko' : ''}`, lang: t.ko ? 'ko' : 'ja', 'data-card': t.id, onClick: () => tap(t) }, t.text);
      grid.append(t.el);
    });
    const tick = () => {
      timer.textContent = fmtTime(performance.now() - t0 + penalty);
      raf = requestAnimationFrame(tick);
    };
    tick();

    function vanish(t) {
      t.done = true;
      t.el.disabled = true;
      if (reduceMotion()) return t.el.classList.add('gone');
      t.el.classList.add('vanish');
      t.el.addEventListener('animationend', () => t.el.classList.add('gone'), { once: true });
    }

    function tap(t) {
      if (t.done) return;
      if (!sel) {
        sel = t;
        t.el.classList.add('sel');
        return;
      }
      if (sel === t) {
        t.el.classList.remove('sel');
        sel = null;
        return;
      }
      const a = sel;
      sel = null;
      a.el.classList.remove('sel');
      if (a.id === t.id && a.ko !== t.ko) {
        vanish(a);
        vanish(t);
        if (--left === 0) finish();
      } else {
        penalty += PENALTY;
        misses++;
        pen.textContent = `+${misses}秒`;
        for (const x of [a, t]) {
          x.el.classList.add('ng');
          setTimeout(() => x.el.classList.remove('ng'), 400);
        }
      }
    }

    function finish() {
      cancelAnimationFrame(raf);
      const time = performance.now() - t0 + penalty;
      const prev = state.matchBest[key];
      const best = !prev || time < prev;
      if (best) {
        state.matchBest[key] = Math.round(time);
        save.matchBest();
      }
      setTimeout(() => intro({ time, best, misses }), reduceMotion() ? 0 : 250);
    }

    show(
      h('div', { class: 'top' }, iconButton('close', 'やめる', () => { cancelAnimationFrame(raf); intro(); }), h('span', { class: 'grow' }), pen, timer),
      h('div', { class: 'fill center' }, grid),
      h('div', { class: 'bottom' }));
  }

  intro();
  return root;
}
