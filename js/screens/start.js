// 「学習する」（と各モード）を押した先: 続きから / 課と種別を選んで新しく始める
// 学習の途中経過があるのに新しく始めるときは、続きが消えることをはっきり確認する

import { h, iconButton } from '../ui.js';
import { state, save, saveSession, cardsInRange, rangeLabel } from '../state.js';
import { TYPES } from '../cards.js';
import { rec, MASTERED } from '../progress.js';
import { go, rerender, listen } from '../router.js';

const MODE_TITLE = { learn: '学習する', flash: '単語カード', test: 'テスト', spell: 'スペル', match: 'マッチ' };
const SVG = 'http://www.w3.org/2000/svg';
let rangeMode = false;
let anchor = null;

// 丸の中に番号、線の長さが習得率
function ringSvg(pct, on) {
  const s = document.createElementNS(SVG, 'svg');
  s.setAttribute('viewBox', '0 0 48 48');
  s.setAttribute('aria-hidden', 'true');
  const r = 21, c = 2 * Math.PI * r;
  s.innerHTML = `<circle cx="24" cy="24" r="${r}" fill="${on ? 'var(--accent)' : 'none'}" stroke="var(--fill)" stroke-width="4"/>`
    + (pct ? `<circle cx="24" cy="24" r="${r}" fill="none" stroke="${on ? 'var(--on-accent)' : 'var(--accent)'}" stroke-width="4" stroke-linecap="round" stroke-dasharray="${(c * pct) / 100} ${c}" transform="rotate(-90 24 24)"/>` : '');
  return s;
}

function timeAgo(t) {
  if (!t) return '';
  const d = new Date(t);
  const today = new Date();
  const hm = d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return `今日 ${hm}`;
  const y = new Date(today);
  y.setDate(y.getDate() - 1);
  return d.toDateString() === y.toDateString() ? `昨日 ${hm}` : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

export function startScreen(params = {}) {
  const mode = MODE_TITLE[params.mode] ? params.mode : 'learn';
  const sel = state.selection;
  const pool = cardsInRange();
  const sess = mode === 'learn' ? state.sessions.learn : null;
  const resumable = sess?.round && (sess.phase === 'q' || sess.phase === 'summary');

  const rings = h('div', { class: 'rings', role: 'group', 'aria-label': '課' }, state.lessons.map((l) => {
    const cs = state.cards.filter((c) => c.lesson === l);
    const pct = cs.length ? Math.floor((cs.filter((c) => rec(state.progress, c.id).s === MASTERED).length / cs.length) * 100) : 0;
    const on = sel.lessons.includes(l);
    return h('button', {
      class: `ring${anchor === l ? ' anchor' : ''}`, 'aria-pressed': String(on), 'aria-label': `${l} 習得${pct}%`,
      onClick: () => tapLesson(l),
    }, ringSvg(pct, on), h('span', null, l === '会話表現' ? '会話' : l.replace(/\D/g, '')));
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

  const typeChips = h('div', { class: 'seg-ctl', role: 'group', 'aria-label': '種別', style: 'margin-top:16px' },
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

  const root = h('div');
  const startNew = () => {
    if (mode !== 'learn') return go(mode);
    if (resumable) return confirmDiscard();
    go('learn');
  };

  // 途中経過を消して新しく始めてよいかの確認（下から出るシート）
  function confirmDiscard() {
    const close = () => { scrim.remove(); sheet.remove(); };
    const scrim = h('div', { class: 'scrim', onClick: close });
    const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'discard-title' },
      h('div', { id: 'discard-title', style: 'font-size:1.125rem;font-weight:700' }, '途中のラウンドを終わりにしますか？'),
      h('p', { style: 'margin:8px 0 4px' }, `${sess.label ?? '前回'}のラウンド（`, h('b', null, `${Math.min(sess.round.pos + 1, sess.round.queue.length)}/${sess.round.queue.length} 問目`), '）の続きは', h('b', { style: 'color:var(--ng)' }, '保存されず、消えます'), '。'),
      h('p', { class: 'small muted', style: 'margin:0 0 16px' }, 'これまでに答えた単語の「習得・学習中」と間違い回数は残ります。'),
      h('button', { class: 'btn danger', onClick: () => { saveSession('learn', null); go('learn'); } }, '途中のラウンドを消して始める'),
      h('button', { class: 'btn block', style: 'margin-top:8px;min-height:52px', onClick: close }, 'やめる（続きを残す）'));
    root.append(scrim, sheet);
    sheet.querySelector('button.btn.block').focus();
  }
  listen(document, 'keydown', (e) => e.key === 'Escape' && root.querySelector('.scrim')?.click());

  root.append(
    h('div', { class: 'top' }, iconButton('back', '戻る', () => { rangeMode = false; anchor = null; go('home'); }), h('h1', { class: 'grow' }, MODE_TITLE[mode])),
    h('div', { class: 'scroll' },
      resumable ? h('section', { class: 'card', style: 'margin-bottom:20px' },
        h('div', { class: 'small muted' }, '続きから'),
        h('div', { style: 'font-weight:700' }, sess.label ?? rangeLabel()),
        h('div', { class: 'small muted' }, `${sess.phase === 'summary' ? 'ラウンドのまとめ' : `ラウンドの ${Math.min(sess.round.pos + 1, sess.round.queue.length)}/${sess.round.queue.length} 問目`}${sess.savedAt ? ` · ${timeAgo(sess.savedAt)}` : ''}`),
        h('button', { class: 'btn primary', style: 'margin-top:10px', onClick: () => go('learn', { resume: true }) }, '続きから')) : null,
      h('h2', { style: 'margin-bottom:4px' }, mode === 'learn' ? '新しく始める' : '範囲を選ぶ'),
      h('div', { class: 'row', style: 'margin-bottom:8px' },
        h('span', { class: 'muted small grow' }, rangeMode ? (anchor ? '終わりの課をタップ' : '始まりの課をタップ') : '課（タップで入れる・外す）'),
        h('button', { class: 'btn text small', 'aria-pressed': String(rangeMode), onClick: () => { rangeMode = !rangeMode; anchor = null; rerender(); } }, rangeMode ? 'やめる' : '範囲指定'),
        h('button', { class: 'btn text small', onClick: () => { sel.lessons = [...state.lessons]; save.selection(); rerender(); } }, '全部')),
      rings,
      typeChips,
      h('div', { class: 'row small', style: 'margin:12px 0' }, h('span', { class: 'grow' }, `${rangeLabel()} · ${sel.types.join('・')}`), h('span', { class: 'muted' }, `${pool.length}枚`)),
      h('div', { style: 'height:8px' })),
    h('div', { class: 'bottom', style: 'padding-top:12px' },
      h('button', { class: resumable ? 'btn block' : 'btn primary', style: resumable ? 'min-height:56px;font-weight:600' : '', disabled: !pool.length, onClick: startNew },
        mode === 'learn' ? 'この範囲で新しく始める' : 'この範囲で始める')));
  return root;
}
