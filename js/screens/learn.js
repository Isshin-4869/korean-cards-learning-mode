// モード1: 学習（Quizlet の Learn）

import { h, quizTop, promptBlock, choiceGrid, markChoices, answerInput, progressBar } from '../ui.js';
import { state, save, saveSession, cardsInRange, currentRangeKey, rangeLabel } from '../state.js';
import { canWrite } from '../deck.js';
import { pickRoundCards, pickReviewCards, newRound, applyAnswer, undoAnswer, roundDone, roundSummary, directionFor } from '../learn.js';
import { summarize } from '../progress.js';
import { todayReview } from '../review.js';
import { addReview } from '../streak.js';
import { jstDate } from '../memory.js';
import { go } from '../router.js';
import { judgeWritten, rememberAccepted, writtenFeedback, continueControl, autoSpeak, choiceKeys } from './common.js';

const STATUS_LABEL = { mastered: '習得', learning: '学習中', review: '要復習' };

/**
 * params.resume: 保存した途中経過から続ける（「学習する」ページの「続きから」）
 * params.review: 今日の復習（記憶の見込みが下がった単語を自動で選ぶ）
 * params.ids: その単語だけで学習する（テストで間違えた単語など）
 * どれもなければ、いま選んでいる範囲で新しく始める（途中経過は捨てる。確認は「学習する」ページで出す）
 */
export function learnScreen(params = {}) {
  const deck = state.deck;
  const settings = state.settings;
  let sess = params.resume ? state.sessions.learn : null;
  const scope = sess?.scope ?? (params.review ? { review: jstDate(Date.now()) } : params.ids ? { ids: params.ids } : { range: currentRangeKey() });
  const isReview = !!scope.review;
  // 今日の復習は、始めた時点で選んだ単語（上限まで）を順にラウンドに分けて出す
  if (isReview && !sess) sess = { scope, plan: todayReview(state).cards.map((c) => c.id), counted: [], phase: 'new' };

  const pool = () => (scope.ids ? scope.ids.map((id) => deck.get(id)).filter(Boolean) : isReview ? sess.plan.map((id) => deck.get(id)).filter(Boolean) : cardsInRange());
  // 「学習する」ページの「続きから」に出す名前と時刻も一緒に保存する
  const label = isReview ? '今日の復習' : scope.ids ? '選んだ単語' : `${rangeLabel()} · ${state.selection.types.join('・')}`;
  const persist = () => {
    if (sess) Object.assign(sess, { label: sess.label ?? label, savedAt: Date.now() });
    return saveSession('learn', sess);
  };
  const exit = () => go('home');
  const root = h('div');
  const show = (...kids) => root.replaceChildren(...kids.flat().filter(Boolean));
  const focusLater = (input) => (root.isConnected ? input.focus() : (root.onMounted = () => input.focus()));

  function startRound(review = false) {
    if (isReview) {
      const counted = new Set(sess.counted);
      const picked = sess.plan.filter((id) => !counted.has(id)).slice(0, settings.roundSize).map((id) => deck.get(id)).filter(Boolean);
      if (!picked.length) return reviewDone();
      sess = { ...sess, round: newRound(picked, state.progress), phase: 'q' };
      persist();
      return showQuestion();
    }
    const cards = pool();
    let picked = pickRoundCards(cards, state.progress, settings.roundSize);
    if (!picked.length && review) picked = pickReviewCards(cards, state.progress, settings.roundSize);
    if (!picked.length) return allDone(cards.length);
    sess = { scope, round: newRound(picked, state.progress), phase: 'q' };
    persist();
    showQuestion();
  }

  function doneCount(round) {
    const pending = new Set(round.queue.slice(round.pos).map((q) => q.id));
    return round.ids.filter((id) => !pending.has(id)).length;
  }

  function showQuestion() {
    const round = sess.round;
    if (roundDone(round)) return showSummary();
    const item = round.queue[round.pos];
    const card = deck.get(item.id);
    if (!card) {
      round.pos++;
      persist();
      return showQuestion();
    }
    let type = item.type;
    if (type === 'written' && !canWrite(card)) type = 'rmc';
    item.dir ??= directionFor(type, settings.direction);
    const dir = item.dir;
    const top = quizTop(exit, doneCount(round), round.ids.length);
    const tag = (item.retry ? 'もう一度 · ' : '') + `${card.lesson} · ${card.ftype === '会話表現' ? card.type : card.ftype}`;
    const promptArea = h('div', { class: 'fill center' }, promptBlock(card, dir, { tag }));
    const bottom = h('div', { class: 'bottom stack' });
    show(top, promptArea, bottom);
    if (dir === 'ko') autoSpeak(card);

    if (type === 'written') {
      const { el: inputRow, input } = answerInput({ lang: dir === 'ja' ? 'ko' : 'ja', onSubmit: (v) => v.trim() && answered(v) });
      bottom.append(inputRow, h('button', { class: 'btn text block', onClick: () => answered('') }, '分からない'));
      focusLater(input);

      function answered(value) {
        const result = value ? judgeWritten(card, dir, value) : { correct: false };
        const undo = record(result.correct);
        if (dir === 'ja' || result.correct === false) autoSpeakAnswer(card, dir);
        bottom.replaceChildren(
          writtenFeedback({
            card, dir, input: value, result,
            onOverride: () => {
              undoAnswer(round, state.progress, undo);
              rememberAccepted(card, dir, value);
              record(true);
              showQuestion();
            },
          }),
          continueControl(root, next),
        );
        promptArea.classList.remove('center');
      }
    } else {
      const choices = deck.choices(card, dir);
      const grid = choiceGrid(choices, (i) => picked(i), dir === 'ja');
      bottom.append(grid, h('button', { class: 'btn text block', onClick: () => picked(-1) }, '分からない'));
      const stopKeys = choiceKeys((i) => picked(i), choices.length);
      let answeredOnce = false;

      function picked(i) {
        if (answeredOnce) return;
        answeredOnce = true;
        stopKeys();
        const correct = i >= 0 && choices[i].correct;
        record(correct);
        markChoices(grid, choices, i);
        if (dir === 'ja') autoSpeakAnswer(card, dir);
        bottom.replaceChildren(grid,
          h('div', { class: `verdict ${correct ? 'ok' : 'ng'}`, style: 'min-height:24px' }, correct ? '正解' : i < 0 ? '答えは緑のものです' : '不正解'),
          continueControl(root, next));
      }
    }
  }

  function record(correct) {
    const id = sess.round.queue[sess.round.pos].id;
    const undo = applyAnswer(sess.round, state.progress, correct, { needWritten: settings.needWritten });
    // 今日の復習で、その単語を初めて答えたら「今日復習した枚数」に数える（1日の上限に使う）
    if (isReview && !sess.counted.includes(id)) {
      sess.counted.push(id);
      addReview(state.days);
      save.days();
    }
    save.progress();
    persist();
    return undo;
  }

  function autoSpeakAnswer(card, dir) {
    if (dir === 'ja') autoSpeak(card);
  }

  function next() {
    if (roundDone(sess.round)) {
      sess.phase = 'summary';
      persist();
      return showSummary();
    }
    showQuestion();
  }

  function showSummary() {
    const sum = roundSummary(sess.round, state.progress);
    const all = summarize(pool(), state.progress);
    const order = { review: 0, learning: 1, mastered: 2 };
    sum.sort((a, b) => order[a.status] - order[b.status]);
    show(
      h('div', { class: 'top' }, h('h1', { class: 'grow' }, 'ラウンド完了')),
      h('div', { class: 'scroll' },
        h('div', { class: 'list' }, sum.map(({ id, status }) => {
          const c = deck.get(id);
          if (!c) return null;
          return h('div', { class: 'lrow' },
            h('div', { class: 'grow' }, h('div', { class: 'ko', lang: 'ko' }, c.term), h('div', { class: 'muted small' }, c.definition)),
            h('span', { class: `st ${status}` }, STATUS_LABEL[status]));
        })),
        isReview ? [
          h('div', { class: 'section-title' }, '今日の復習'),
          progressBar(sess.counted.length, 0, sess.plan.length),
          h('div', { class: 'muted small', style: 'margin-top:6px' }, `${sess.counted.length} / ${sess.plan.length} 枚`),
        ] : [
          h('div', { class: 'section-title' }, scope.ids ? '選んだ単語全体の進捗' : '範囲全体の進捗'),
          progressBar(all.mastered, all.learning, all.total),
          h('div', { class: 'muted small', style: 'margin-top:6px' }, `習得 ${all.mastered} · 学習中 ${all.learning} · 未学習 ${all.unseen}（全${all.total}）`),
        ],
        h('div', { style: 'height:16px' })),
      h('div', { class: 'bottom stack' },
        h('button', { class: 'btn primary', onClick: () => startRound() }, isReview && sess.counted.length >= sess.plan.length ? '復習を終える' : '次のラウンドへ'),
        h('button', { class: 'btn text block', onClick: () => { saveSession('learn', null); exit(); } }, 'ホームへ')));
  }

  function allDone(total) {
    sess = null;
    saveSession('learn', null);
    show(
      h('div', { class: 'top' }, h('button', { class: 'btn text', onClick: exit }, '戻る')),
      h('div', { class: 'fill center', style: 'text-align:center' },
        h('h2', null, total ? 'この範囲はすべて習得しました' : 'この範囲にカードがありません'),
        h('p', { class: 'muted' }, total ? '習得済みの単語を記述で復習できます。間違えた単語は学習中に戻ります。' : '「学習する」で課と種別を選んでください。')),
      h('div', { class: 'bottom stack' },
        total ? h('button', { class: 'btn primary', onClick: () => startRound(true) }, '習得済みから復習') : null,
        h('button', { class: 'btn text block', onClick: exit }, 'ホームへ')));
  }

  function reviewDone() {
    const n = sess.counted.length;
    sess = null;
    saveSession('learn', null);
    show(
      h('div', { class: 'top' }, h('button', { class: 'btn text', onClick: exit }, '戻る')),
      h('div', { class: 'fill center', style: 'text-align:center' },
        h('h2', null, n ? '今日の復習が終わりました' : '今日の復習はありません'),
        h('p', { class: 'muted' }, n ? `${n} 枚を復習しました。` : '忘れかけている単語はありません。「学習する」で新しい単語を進めましょう。')),
      h('div', { class: 'bottom stack' }, h('button', { class: 'btn primary', onClick: exit }, 'ホームへ')));
  }

  // 初回の表示（「続きから」なら保存された途中経過から）
  if (!sess || sess.phase === 'new' || !sess.round) startRound();
  else if (sess.phase === 'summary' || roundDone(sess.round)) showSummary();
  else showQuestion();
  return root;
}
