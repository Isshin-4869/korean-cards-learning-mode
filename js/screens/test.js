// モード3: テスト

import { h, quizTop, promptBlock, choiceGrid, answerInput, fmtTime, iconButton } from '../ui.js';
import { state, save, saveSession, cardsInRange, currentRangeKey, rangeLabel } from '../state.js';
import { answerText, promptText, textKey } from '../deck.js';
import { buildTest, testItemCount, TEST_FORMATS } from '../quiz.js';
import { markWrongOutsideLearn, markRightOutsideLearn, rec } from '../progress.js';
import { nextK } from '../memory.js';
import { go, listen } from '../router.js';
import { judgeWritten, rememberAccepted, autoSpeak, choiceKeys } from './common.js';

const COUNTS = [10, 20, 30, 'all'];
let lastSetup = { count: 20, formats: ['mc', 'written'] };

export function testScreen() {
  const deck = state.deck;
  const root = h('div');
  const show = (...kids) => root.replaceChildren(...kids.flat().filter(Boolean));
  const focusLater = (input) => (root.isConnected ? input.focus() : (root.onMounted = () => input.focus()));
  let sess = state.sessions.test;
  let shownAt = 0;
  let cleanups = []; // 問題ごとのキー操作を、次の問題に持ち越さない
  const cleanup = () => { cleanups.forEach((f) => f()); cleanups = []; };
  const persist = () => saveSession('test', sess);

  function setup() {
    const pool = cardsInRange();
    const resumable = sess && sess.phase === 'q' && sess.range === currentRangeKey();
    const countCtl = h('div', { class: 'seg-ctl' }, COUNTS.map((c) => h('button', {
      class: 'btn', 'aria-pressed': String(lastSetup.count === c),
      onClick: () => { lastSetup.count = c; setup(); },
    }, c === 'all' ? `全部（${pool.length}）` : `${c}問`)));
    const fmtCtl = h('div', { class: 'seg-ctl' }, Object.entries(TEST_FORMATS).map(([k, label]) => h('button', {
      class: 'btn', 'aria-pressed': String(lastSetup.formats.includes(k)),
      onClick: () => {
        const on = lastSetup.formats.includes(k);
        if (on && lastSetup.formats.length === 1) return;
        lastSetup.formats = on ? lastSetup.formats.filter((x) => x !== k) : [...lastSetup.formats, k];
        setup();
      },
    }, label)));
    show(
      h('div', { class: 'top' }, iconButton('back', '戻る', () => go('home')), h('h1', { class: 'grow' }, 'テスト')),
      h('div', { class: 'scroll' },
        h('div', { class: 'muted small' }, `${rangeLabel()} · ${pool.length}枚`),
        h('div', { class: 'section-title' }, '問題数'), countCtl,
        h('div', { class: 'section-title' }, '問題形式（複数選べます）'), fmtCtl,
        h('p', { class: 'muted small' }, '正誤は「この意味で合っていますか」に○×で答えます。線結びは5組をタップでペアにします。文型・解説のカードは記述に出しません。')),
      h('div', { class: 'bottom stack' },
        resumable ? h('button', { class: 'btn primary', onClick: () => showQuestion() }, `続きから（${sess.i + 1}/${sess.qs.length}問目）`) : null,
        h('button', { class: resumable ? 'btn block' : 'btn primary', disabled: !pool.length, onClick: () => start(pool) }, resumable ? '新しく始める' : '始める')));
  }

  function start(pool) {
    const qs = buildTest(deck, pool, { count: lastSetup.count, formats: lastSetup.formats, direction: state.settings.direction });
    sess = { range: currentRangeKey(), qs, i: 0, answers: [], elapsed: 0, phase: 'q' };
    persist();
    showQuestion();
  }

  // 1問ぶんの結果を記録。間違いは進捗の間違い回数を増やし、習得済みなら学習中へ
  function record(results) {
    cleanup();
    for (const r of results) {
      r.prev = state.progress[r.id] ? { ...state.progress[r.id] } : null;
      if (!r.correct) markWrongOutsideLearn(state.progress, r.id);
      else markRightOutsideLearn(state.progress, r.id, nextK(rec(state.progress, r.id), true));
    }
    sess.answers[sess.i] = results;
    sess.elapsed += performance.now() - shownAt;
    sess.i++;
    if (sess.i >= sess.qs.length) sess.phase = 'result';
    save.progress();
    persist();
    sess.phase === 'result' ? showResult() : showQuestion();
  }

  function showQuestion() {
    cleanup();
    if (sess.i >= sess.qs.length) return showResult();
    shownAt = performance.now();
    const q = sess.qs[sess.i];
    const top = quizTop(() => go('home'), sess.i, sess.qs.length);
    const bottom = h('div', { class: 'bottom stack' });
    const card = deck.get(q.ids[0]);
    if (!card) return record([]);

    if (q.type === 'match') return showMatch(q, top);

    const promptArea = h('div', { class: 'fill center' }, promptBlock(card, q.dir, { tag: `${TEST_FORMATS[q.type]} · ${card.lesson}` }));
    show(top, promptArea, bottom);
    if (q.dir === 'ko') autoSpeak(card);

    if (q.type === 'mc') {
      let done = false;
      const pick = (i) => {
        if (done) return;
        done = true;
        record([{ id: card.id, correct: i >= 0 && q.choices[i].correct, given: i >= 0 ? q.choices[i].text : '' }]);
      };
      bottom.append(choiceGrid(q.choices, pick, q.dir === 'ja'), h('button', { class: 'btn text block', onClick: () => pick(-1) }, '分からない'));
      cleanups.push(choiceKeys(pick, q.choices.length));
    } else if (q.type === 'written') {
      const submit = (v) => record([{ id: card.id, correct: !!v.trim() && judgeWritten(card, q.dir, v).correct, given: v, written: true }]);
      const { el, input } = answerInput({ lang: q.dir === 'ja' ? 'ko' : 'ja', onSubmit: (v) => v.trim() && submit(v) });
      bottom.append(el, h('button', { class: 'btn text block', onClick: () => submit('') }, '分からない'));
      focusLater(input);
    } else if (q.type === 'tf') {
      const ko = q.dir === 'ja';
      promptArea.append(h('div', { class: 'prompt' }, h('div', { class: 'tag' }, 'この意味で合っていますか'),
        h('div', { class: `q ${ko ? 'ko' : 'ja'}`, lang: ko ? 'ko' : 'ja', style: 'font-size:1.375rem' }, q.shown)));
      const ans = (yes) => record([{ id: card.id, correct: yes === q.truth, given: yes ? '○' : '×' }]);
      bottom.append(h('div', { class: 'tf' },
        h('button', { class: 'choice', 'aria-label': '合っている', onClick: () => ans(true) }, '○'),
        h('button', { class: 'choice', 'aria-label': '違う', onClick: () => ans(false) }, '×')));
      const onKey = (e) => (e.key === 'o' ? ans(true) : e.key === 'x' ? ans(false) : null);
      listen(document, 'keydown', onKey);
      cleanups.push(() => document.removeEventListener('keydown', onKey));
    }
  }

  // 線結び: 左（韓国語）をタップしてから右（日本語）をタップでペアにする。もう一度タップで外す
  function showMatch(q, top) {
    const left = q.ids.map((id) => deck.get(id)).filter(Boolean);
    const right = q.right.map((id) => deck.get(id)).filter(Boolean);
    const pairs = new Map(); // leftId → rightId
    let selLeft = null;
    const grid = h('div', { class: 'pairs' });
    const submit = h('button', { class: 'btn primary', disabled: true, onClick: () => {
      record(left.map((c) => ({ id: c.id, correct: textKey(deck.get(pairs.get(c.id))?.definition ?? '') === textKey(c.definition), given: deck.get(pairs.get(c.id))?.definition ?? '' })));
    } }, '答え合わせ');
    function paint() {
      grid.replaceChildren();
      const num = (id, side) => {
        const keys = [...pairs.keys()];
        const idx = side === 'l' ? keys.indexOf(id) : [...pairs.values()].indexOf(id);
        return idx >= 0 ? idx + 1 : null;
      };
      for (let i = 0; i < left.length; i++) {
        const l = left[i];
        const r = right[i];
        const ln = num(l.id, 'l');
        const rn = r && num(r.id, 'r');
        grid.append(
          h('button', { class: `choice ko${selLeft === l.id ? ' sel' : ''}`, lang: 'ko', 'data-card': l.id, onClick: () => {
            if (pairs.has(l.id)) pairs.delete(l.id);
            selLeft = selLeft === l.id ? null : l.id;
            paint();
          } }, h('span', null, l.term), ln ? h('span', { class: 'n' }, ln) : null),
          r ? h('button', { class: 'choice', 'data-card': r.id, onClick: () => {
            for (const [k, v] of pairs) if (v === r.id) pairs.delete(k);
            if (selLeft) { pairs.set(selLeft, r.id); selLeft = null; }
            paint();
          } }, h('span', null, r.definition), rn ? h('span', { class: 'n' }, rn) : null) : h('span'));
      }
      submit.disabled = pairs.size !== left.length;
    }
    paint();
    show(top, h('div', { class: 'scroll' }, h('p', { class: 'muted small' }, '左の韓国語をタップしてから、右の意味をタップしてペアにします。同じ数字がペアです。'), grid),
      h('div', { class: 'bottom stack', style: 'padding-top:12px' }, submit));
  }

  function showResult() {
    const flat = sess.answers.flat().filter(Boolean);
    const total = testItemCount(sess.qs);
    const correct = flat.filter((r) => r.correct).length;
    const wrong = [];
    sess.answers.forEach((rs, qi) => rs?.forEach((r) => !r.correct && wrong.push({ r, q: sess.qs[qi] })));
    const pct = total ? Math.round((correct / total) * 100) : 0;
    show(
      h('div', { class: 'top' }, h('h1', { class: 'grow' }, 'テスト結果')),
      h('div', { class: 'scroll' },
        h('div', { class: 'stats' },
          h('div', null, h('b', { class: 'acc' }, `${pct}%`), h('span', { class: 'muted small' }, `${correct} / ${total} 正解`)),
          h('div', null, h('b', null, fmtTime(sess.elapsed)), h('span', { class: 'muted small' }, 'かかった時間'))),
        wrong.length ? h('div', { class: 'section-title' }, `間違えた問題（${wrong.length}）`) : h('p', null, '全問正解です。'),
        h('div', { class: 'list' }, wrong.map(({ r, q }) => {
          const c = deck.get(r.id);
          if (!c) return null;
          const dir = q.type === 'match' ? 'ko' : q.dir;
          return h('div', { class: 'lrow', style: 'align-items:flex-start' },
            h('div', { class: 'grow' },
              h('div', { class: dir === 'ko' ? 'ko' : '', lang: dir === 'ko' ? 'ko' : 'ja' }, promptText(c, dir)),
              h('div', null, h('span', { class: 'muted small' }, '正解 '), h('span', { class: dir === 'ja' ? 'ko' : '' }, answerText(c, dir))),
              h('div', { class: 'small', style: 'color:var(--ng)' }, `あなた: ${r.given || '（分からない）'}${q.type === 'tf' ? `（表示: ${q.shown}）` : ''}`)),
            r.written && r.given ? h('button', { class: 'btn text small', onClick: () => override(r, c, dir) }, '正解にする') : null);
        })),
        h('div', { style: 'height:16px' })),
      h('div', { class: 'bottom stack' },
        wrong.length ? h('button', { class: 'btn primary', onClick: () => { const ids = [...new Set(wrong.map((w) => w.r.id))]; saveSession('test', null); go('learn', { ids }); } }, '間違えた単語で学習する') : null,
        h('button', { class: wrong.length ? 'btn block' : 'btn primary', onClick: () => { sess = null; saveSession('test', null); setup(); } }, 'もう一度テスト'),
        h('button', { class: 'btn text block', onClick: () => { saveSession('test', null); go('home'); } }, 'ホームへ')));
  }

  function override(r, card, dir) {
    if (r.prev) state.progress[r.id] = r.prev;
    else delete state.progress[r.id];
    r.correct = true;
    rememberAccepted(card, dir, r.given);
    save.progress();
    persist();
    showResult();
  }

  if (sess?.phase === 'result') showResult();
  else setup();
  return root;
}
