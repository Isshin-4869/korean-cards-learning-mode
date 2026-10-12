// モード4: スペル（聞き取り）。韓国語を聞いてハングルで書く

import { h, quizTop, answerInput, iconButton, svg } from '../ui.js';
import { state, save, saveSession, cardsInRange, currentRangeKey, rangeLabel } from '../state.js';
import { canSpell, shuffle } from '../deck.js';
import { markWrongOutsideLearn, markRightOutsideLearn, rec } from '../progress.js';
import { nextK } from '../memory.js';
import { speak, speechAvailable, hasKoreanVoice } from '../speech.js';
import { go } from '../router.js';
import { judgeWritten, rememberAccepted, writtenFeedback, continueControl } from './common.js';

const PER_SESSION = 10;
const SLOW = 0.7; // 設定の速さに掛ける倍率

export function spellScreen() {
  const deck = state.deck;
  const root = h('div');
  const show = (...kids) => root.replaceChildren(...kids.flat().filter(Boolean));
  const focusLater = (input) => (root.isConnected ? input.focus() : (root.onMounted = () => input.focus()));
  let sess = state.sessions.spell;
  const persist = () => saveSession('spell', sess);

  function setup() {
    const pool = cardsInRange().filter(canSpell);
    const resumable = sess && sess.i < sess.ids.length && sess.range === currentRangeKey();
    show(
      h('div', { class: 'top' }, iconButton('back', '戻る', () => go('home')), h('h1', { class: 'grow' }, 'スペル')),
      h('div', { class: 'fill' },
        h('div', { class: 'muted small' }, `${rangeLabel()} · 対象 ${pool.length}枚`),
        h('p', null, '韓国語を読み上げます。聞こえたとおりにハングルで書いてください。'),
        h('p', { class: 'muted small' }, '対象は語と短い文です（文型・解説と「○○」を含むカードは出しません）。'),
        !speechAvailable() ? h('p', { class: 'verdict ng' }, 'この端末では読み上げが使えません。') : !hasKoreanVoice() ? h('p', { class: 'muted small' }, '韓国語の音声が見つからない場合は、iPhone の設定 → アクセシビリティ → 読み上げコンテンツ → 声 → 韓国語 で追加できます。') : null),
      h('div', { class: 'bottom stack' },
        resumable ? h('button', { class: 'btn primary', onClick: () => showQuestion() }, `続きから（${sess.i + 1}/${sess.ids.length}）`) : null,
        h('button', { class: resumable ? 'btn block' : 'btn primary', disabled: !pool.length, onClick: () => start(pool) }, `${Math.min(PER_SESSION, pool.length)}問はじめる`)));
  }

  function start(pool) {
    sess = { range: currentRangeKey(), ids: shuffle(pool).slice(0, PER_SESSION).map((c) => c.id), i: 0, results: [] };
    persist();
    showQuestion();
  }

  function showQuestion() {
    if (sess.i >= sess.ids.length) return showResult();
    const card = deck.get(sess.ids[sess.i]);
    if (!card) { sess.i++; return showQuestion(); }
    const listenArea = h('div', { class: 'fill center', style: 'align-items:center;gap:16px', 'data-card': card.id },
      h('button', { class: 'speak', style: 'width:96px;height:96px;border-radius:48px', 'aria-label': 'もう一度聞く', onClick: () => speak(card.term) }, svg('speak')),
      h('div', { class: 'row' },
        h('button', { class: 'btn', onClick: () => speak(card.term) }, 'もう一度聞く'),
        h('button', { class: 'btn', onClick: () => speak(card.term, { rate: SLOW }) }, 'ゆっくり聞く')));
    const bottom = h('div', { class: 'bottom stack' });
    const { el, input } = answerInput({ lang: 'ko', placeholder: '聞こえたとおりに', onSubmit: (v) => v.trim() && answered(v) });
    bottom.append(el, h('button', { class: 'btn text block', onClick: () => answered('') }, '分からない'));
    show(quizTop(() => go('home'), sess.i, sess.ids.length), listenArea, bottom);
    focusLater(input);
    speak(card.term);

    function answered(value) {
      const result = value ? judgeWritten(card, 'spell', value, [card.term]) : { correct: false };
      const r = { id: card.id, correct: result.correct, given: value, prev: state.progress[card.id] ? { ...state.progress[card.id] } : null };
      if (!r.correct) markWrongOutsideLearn(state.progress, card.id);
      else markRightOutsideLearn(state.progress, card.id, nextK(rec(state.progress, card.id), true));
      sess.results[sess.i] = r;
      sess.i++;
      save.progress();
      persist();
      listenArea.replaceChildren(h('div', { class: 'prompt' }, h('div', { class: 'tag' }, `${card.lesson} · 意味`), h('div', { class: 'q ja' }, card.definition)));
      bottom.replaceChildren(
        writtenFeedback({
          card, dir: 'ja', input: value, result,
          onOverride: () => {
            if (r.prev) state.progress[card.id] = r.prev;
            else delete state.progress[card.id];
            r.correct = true;
            rememberAccepted(card, 'spell', value);
            save.progress();
            persist();
            bottom.firstChild.replaceWith(writtenFeedback({ card, dir: 'ja', input: value, result: { correct: true } }));
          },
        }),
        continueControl(root, showQuestion));
    }
  }

  function showResult() {
    const rs = sess.results.filter(Boolean);
    const ok = rs.filter((r) => r.correct).length;
    const wrong = rs.filter((r) => !r.correct);
    show(
      h('div', { class: 'top' }, h('h1', { class: 'grow' }, 'スペル結果')),
      h('div', { class: 'scroll' },
        h('div', { class: 'stats' }, h('div', null, h('b', { class: 'acc' }, `${ok} / ${rs.length}`), h('span', { class: 'muted small' }, '正解'))),
        wrong.length ? h('div', { class: 'section-title' }, '間違えた単語') : null,
        h('div', { class: 'list' }, wrong.map((r) => {
          const c = deck.get(r.id);
          return c && h('div', { class: 'lrow' },
            h('div', { class: 'grow' }, h('div', { class: 'ko', lang: 'ko' }, c.term), h('div', { class: 'muted small' }, c.definition),
              h('div', { class: 'small ko', style: 'color:var(--ng)' }, r.given || '（分からない）')),
            h('button', { class: 'speak', 'aria-label': '読み上げ', onClick: () => speak(c.term) }, svg('speak')));
        }))),
      h('div', { class: 'bottom stack' },
        h('button', { class: 'btn primary', onClick: () => { sess = null; saveSession('spell', null); setup(); } }, 'もう一度'),
        h('button', { class: 'btn text block', onClick: () => { saveSession('spell', null); go('home'); } }, 'ホームへ')));
  }

  if (sess && sess.i >= sess.ids.length) showResult();
  else setup();
  return root;
}
