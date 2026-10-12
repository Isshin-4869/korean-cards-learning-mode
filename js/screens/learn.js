// モード1: 学習（Quizlet の Learn）

import { h, quizTop, promptBlock, choiceGrid, markChoices, answerInput, progressBar } from '../ui.js';
import { state, save, saveSession, cardsInRange, currentRangeKey } from '../state.js';
import { canWrite } from '../deck.js';
import { pickRoundCards, pickReviewCards, newRound, applyAnswer, undoAnswer, roundDone, roundSummary, directionFor } from '../learn.js';
import { summarize } from '../progress.js';
import { STAGE_UP, stageOfSummary, planetCanvas, rangePlanetName } from '../planet.js';
import { go } from '../router.js';
import { judgeWritten, rememberAccepted, writtenFeedback, continueControl, autoSpeak, choiceKeys } from './common.js';

const STATUS_LABEL = { mastered: '習得', learning: '学習中', review: '要復習' };

/** params.ids があれば、その単語だけで学習する（テストで間違えた単語など） */
export function learnScreen(params = {}) {
  const deck = state.deck;
  const settings = state.settings;
  const scope = params.ids ? { ids: params.ids } : { range: currentRangeKey() };
  let sess = state.sessions.learn;
  if (!sess || JSON.stringify(sess.scope) !== JSON.stringify(scope)) sess = null;

  const pool = () => (scope.ids ? scope.ids.map((id) => deck.get(id)).filter(Boolean) : cardsInRange());
  const persist = () => saveSession('learn', sess);
  const exit = () => go('home');
  const root = h('div');
  const show = (...kids) => root.replaceChildren(...kids.flat().filter(Boolean));
  const focusLater = (input) => (root.isConnected ? input.focus() : (root.onMounted = () => input.focus()));

  function startRound(review = false) {
    const cards = pool();
    let picked = pickRoundCards(cards, state.progress, settings.roundSize);
    if (!picked.length && review) picked = pickReviewCards(cards, state.progress, settings.roundSize);
    if (!picked.length) return allDone(cards.length);
    // ラウンド開始時の惑星の段階（まとめで育ったかを見るため。再開しても残るようセッションに持つ）
    sess = { scope, round: newRound(picked, state.progress), phase: 'q', stageBefore: stageOfSummary(summarize(cards, state.progress)) };
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
    const undo = applyAnswer(sess.round, state.progress, correct, { needWritten: settings.needWritten });
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
    // 範囲の惑星: 段階が上がったときだけ「前 → 後」を見せる
    const planet = scope.range ? rangePlanetName(scope.range) : 'words';
    const stage = stageOfSummary(all);
    const grew = sess.stageBefore != null && stage > sess.stageBefore;
    const pct = all.total ? Math.floor((all.mastered / all.total) * 100) : 0;
    const after = grew ? planetCanvas(planet, stage, 110) : null;
    after?.classList.add('grown');
    show(
      h('div', { class: 'top' }, h('h1', { class: 'grow' }, 'ラウンド完了'), grew ? null : planetCanvas(planet, stage, 40)),
      h('div', { class: 'scroll' },
        grew ? [
          h('div', { class: 'grow-up' }, planetCanvas(planet, sess.stageBefore, 88), h('span', { class: 'muted', 'aria-hidden': 'true' }, '→'), after),
          h('div', { class: 'grow-msg' }, `${STAGE_UP[stage]}（習得 `, h('span', { class: 'dot' }, `${pct}%`), '）'),
        ] : null,
        h('div', { class: 'list' }, sum.map(({ id, status }) => {
          const c = deck.get(id);
          if (!c) return null;
          return h('div', { class: 'lrow' },
            h('div', { class: 'grow' }, h('div', { class: 'ko', lang: 'ko' }, c.term), h('div', { class: 'muted small' }, c.definition)),
            h('span', { class: `st ${status}` }, STATUS_LABEL[status]));
        })),
        h('div', { class: 'section-title' }, scope.ids ? '選んだ単語全体の進捗' : '範囲全体の進捗'),
        progressBar(all.mastered, all.learning, all.total),
        h('div', { class: 'muted small', style: 'margin-top:6px' }, `習得 ${all.mastered} · 学習中 ${all.learning} · 未学習 ${all.unseen}（全${all.total}）`),
        h('div', { style: 'height:16px' })),
      h('div', { class: 'bottom stack' },
        h('button', { class: 'btn primary', onClick: () => startRound() }, '次のラウンドへ'),
        h('button', { class: 'btn text block', onClick: () => { saveSession('learn', null); exit(); } }, 'ホームへ')));
  }

  function allDone(total) {
    sess = null;
    saveSession('learn', null);
    show(
      h('div', { class: 'top' }, h('button', { class: 'btn text', onClick: exit }, '戻る')),
      h('div', { class: 'fill center', style: 'text-align:center' },
        h('h2', null, total ? 'この範囲はすべて習得しました' : 'この範囲にカードがありません'),
        h('p', { class: 'muted' }, total ? '習得済みの単語を記述で復習できます。間違えた単語は学習中に戻ります。' : 'ホームで課と種別を選んでください。')),
      h('div', { class: 'bottom stack' },
        total ? h('button', { class: 'btn primary', onClick: () => startRound(true) }, '習得済みから復習') : null,
        h('button', { class: 'btn text block', onClick: exit }, 'ホームへ')));
  }

  // 初回の表示（保存された途中経過があれば続きから）
  if (!sess) startRound();
  else if (sess.phase === 'summary' || roundDone(sess.round)) showSummary();
  else showQuestion();
  return root;
}
