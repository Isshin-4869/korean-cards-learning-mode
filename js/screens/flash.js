// モード2: 単語カード。タップで表裏、右スワイプで「覚えた」、左スワイプで「まだ」
// 「覚えた」は進捗とは別の印（state.flash）として保存する

import { h, quizTop, speakButton } from '../ui.js';
import { state, save, saveSession, cardsInRange, currentRangeKey } from '../state.js';
import { shuffle } from '../deck.js';
import { speak } from '../speech.js';
import { go, listen } from '../router.js';

const SWIPE = 80;

export function flashScreen() {
  const deck = state.deck;
  const settings = state.settings;
  const root = h('div');
  const show = (...kids) => root.replaceChildren(...kids.flat().filter(Boolean));
  let sess = state.sessions.flash;
  const persist = () => saveSession('flash', sess);

  function start(ids) {
    const cards = ids ? ids.map((id) => deck.get(id)).filter(Boolean) : cardsInRange();
    const ordered = settings.flashShuffle ? shuffle(cards) : cards;
    sess = { range: currentRangeKey(), ids: ordered.map((c) => c.id), i: 0, results: {}, pass: ids ? (sess?.pass ?? 1) + 1 : 1 };
    persist();
    showCard();
  }

  function mark(known) {
    const id = sess.ids[sess.i];
    sess.results[id] = known;
    state.flash[id] = known;
    sess.i++;
    save.flash();
    persist();
    showCard();
  }

  function showCard() {
    if (sess.i >= sess.ids.length) return showSummary();
    const card = deck.get(sess.ids[sess.i]);
    if (!card) { sess.i++; return showCard(); }
    const frontKo = settings.flashFront === 'ko';
    const koFace = (small) => [h('div', { class: 'ko', lang: 'ko', style: `font-size:${small ? '1.5rem' : card.term.length > 12 ? '1.75rem' : '2.5rem'};line-height:1.3;overflow-wrap:anywhere` }, card.term), h('div', { style: 'margin-top:12px' }, speakButton(card.term))];
    const jaFace = (small) => [h('div', { style: `font-size:${small ? '1.0625rem' : '1.375rem'};font-weight:600;overflow-wrap:anywhere` }, card.definition)];
    const known = state.flash[card.id];
    const front = h('div', { class: 'face front' }, h('div', { class: 'hint muted' }, `${card.lesson}${known ? ' · 覚えた' : ''}`), frontKo ? koFace() : jaFace());
    const back = h('div', { class: 'face back' }, h('div', { class: 'hint muted' }, '裏'), frontKo ? jaFace() : koFace(), h('div', { class: 'muted small', style: 'margin-top:12px' }, frontKo ? '' : card.definition));
    const flash = h('div', { class: 'flash' }, front, back);
    const wrap = h('div', { class: 'flash-wrap fill', style: 'margin:8px 0 12px' }, flash);
    const flip = () => {
      flash.classList.add('animate');
      flash.classList.toggle('flipped');
      const koShown = flash.classList.contains('flipped') !== frontKo;
      if (koShown && settings.autoSpeak) speak(card.term);
    };

    // スワイプは指に合わせて動かすだけ（離したら次のカードに切り替える）
    let sx = 0;
    let sy = 0;
    let dx = 0;
    let dragging = false;
    wrap.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      dragging = true;
      sx = e.clientX;
      sy = e.clientY;
      dx = 0;
      wrap.setPointerCapture(e.pointerId);
    });
    wrap.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      dx = e.clientX - sx;
      if (Math.abs(dx) > Math.abs(e.clientY - sy)) wrap.style.transform = `translateX(${dx}px)`;
    });
    const end = () => {
      if (!dragging) return;
      dragging = false;
      wrap.style.transform = '';
      if (dx > SWIPE) mark(true);
      else if (dx < -SWIPE) mark(false);
      else if (Math.abs(dx) < 8) flip();
    };
    wrap.addEventListener('pointerup', end);
    wrap.addEventListener('flip', flip);
    wrap.addEventListener('pointercancel', () => { dragging = false; wrap.style.transform = ''; });

    const controls = h('div', { class: 'row wrap', style: 'gap:8px' },
      h('button', { class: 'btn', onClick: () => { settings.flashFront = frontKo ? 'ja' : 'ko'; save.settings(); showCard(); } }, `表：${frontKo ? '韓国語' : '日本語'}`),
      h('button', { class: 'btn', 'aria-pressed': String(settings.flashShuffle), onClick: () => {
        settings.flashShuffle = !settings.flashShuffle;
        save.settings();
        const rest = sess.ids.slice(sess.i);
        sess.ids = sess.ids.slice(0, sess.i).concat(settings.flashShuffle ? shuffle(rest) : rest.sort((a, b) => deck.get(a).order - deck.get(b).order));
        persist();
        showCard();
      } }, 'シャッフル'),
      h('span', { class: 'grow' }),
      sess.i > 0 ? h('button', { class: 'btn text', onClick: () => { sess.i--; persist(); showCard(); } }, '1枚戻る') : null);

    show(
      quizTop(() => go('home'), sess.i, sess.ids.length),
      controls,
      wrap,
      h('div', { class: 'bottom' },
        h('div', { class: 'tf' },
          h('button', { class: 'btn', style: 'min-height:56px', onClick: () => mark(false) }, '← まだ'),
          h('button', { class: 'btn', style: 'min-height:56px', onClick: () => mark(true) }, '覚えた →')),
        h('p', { class: 'muted small', style: 'text-align:center;margin:8px 0 0' }, 'タップで裏返す・左右にスワイプ')));
    if (frontKo && settings.autoSpeak) speak(card.term);
  }

  function showSummary() {
    const vals = sess.ids.map((id) => sess.results[id]);
    const ok = vals.filter((v) => v === true).length;
    const notYet = sess.ids.filter((id) => sess.results[id] === false);
    show(
      h('div', { class: 'top' }, h('h1', { class: 'grow' }, `${sess.pass}周目 完了`)),
      h('div', { class: 'fill' },
        h('div', { class: 'stats' },
          h('div', null, h('b', { class: 'acc' }, ok), h('span', { class: 'muted small' }, '覚えた')),
          h('div', null, h('b', null, notYet.length), h('span', { class: 'muted small' }, 'まだ'))),
        h('p', { class: 'muted small' }, '「覚えた」は単語カードだけの印です。学習の進捗（習得）は学習・テストで決まります。')),
      h('div', { class: 'bottom stack' },
        notYet.length ? h('button', { class: 'btn primary', onClick: () => start(notYet) }, `「まだ」の${notYet.length}枚でもう1周`) : null,
        h('button', { class: notYet.length ? 'btn block' : 'btn primary', onClick: () => start() }, '最初から'),
        h('button', { class: 'btn text block', onClick: () => { saveSession('flash', null); go('home'); } }, 'ホームへ')));
  }

  listen(document, 'keydown', (e) => {
    if (!sess || sess.i >= sess.ids.length) return;
    if (e.key === 'ArrowRight') mark(true);
    else if (e.key === 'ArrowLeft') mark(false);
    else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); root.querySelector('.flash-wrap')?.dispatchEvent(new Event('flip')); }
  });

  if (sess && sess.range === currentRangeKey() && sess.i < sess.ids.length) showCard();
  else if (sess && sess.range === currentRangeKey()) showSummary();
  else start();
  return root;
}
