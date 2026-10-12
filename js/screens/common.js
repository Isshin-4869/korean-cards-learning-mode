// 学習・テスト・スペルで共通の、記述の判定と回答後の表示

import { h, speakButton } from '../ui.js';
import { state, save } from '../state.js';
import { checkAnswer, diffAnswer } from '../answer.js';
import { answerText, splitCommaFor } from '../deck.js';
import { speak } from '../speech.js';
import { listen } from '../router.js';

// base: 正解の候補（省略時は同じ問題文のカードの答えもまとめたもの）
export function judgeWritten(card, dir, input, base) {
  const s = state.settings;
  const answers = [...(base ?? state.deck.answersFor(card, dir)), ...(state.accepted[card.id]?.[dir] ?? [])];
  return checkAnswer(input, answers, {
    ignoreSpacing: !s.strictSpacing,
    allowTypo: s.allowTypo,
    splitComma: splitCommaFor(card),
    reject: state.deck.rejectKeys(dir),
  });
}

// 「正解にする」で押した答えを、そのカードの正解として覚える（次からはそのまま正解）
export function rememberAccepted(card, dir, input) {
  const v = String(input).trim();
  if (!v) return;
  const rec = (state.accepted[card.id] ??= {});
  const list = (rec[dir] ??= []);
  if (!list.includes(v)) list.push(v);
  save.accepted();
}

function answerValue(card, dir, input, highlight) {
  const text = answerText(card, dir);
  const ko = dir === 'ja';
  const val = h('div', { class: `val grow${ko ? ' ko' : ''}`, lang: ko ? 'ko' : 'ja' });
  const segs = highlight && input ? diffAnswer(input, text) : [];
  // 共通する文字がまったくないときは、全体に下線を引いても意味がないので強調しない
  if (segs.some((s) => s.op === 'same' && s.t.trim())) {
    for (const seg of segs) val.append(seg.op === 'miss' ? h('span', { class: 'miss' }, seg.t) : seg.t);
  } else {
    val.textContent = text;
  }
  return h('div', { class: 'row', style: 'align-items:flex-start' }, val, ko ? speakButton(card.term) : null);
}

/**
 * 記述の回答後の表示。
 * result: judgeWritten の戻り値。onOverride があれば不正解のとき「正解にする」を出す
 */
export function writtenFeedback({ card, dir, input, result, onOverride }) {
  const box = h('div', { class: 'stack' });
  if (result.correct) {
    const label = result.near ? '正解（打ち間違いあり）' : result.spacing ? '正解（分かち書きに注意）' : '正解';
    box.append(h('div', { class: 'answer-box ok' }, h('div', { class: 'lbl verdict' }, label), answerValue(card, dir, input, result.near || result.spacing)));
  } else {
    box.append(
      h('div', { class: 'answer-box ng' }, h('div', { class: 'lbl' }, 'あなたの回答'), h('div', { class: `val${dir === 'ja' ? ' ko' : ''}` }, input?.trim() ? input : '（分からない）')),
      h('div', { class: 'answer-box ok' }, h('div', { class: 'lbl' }, '正解'), answerValue(card, dir, input, !!input?.trim())),
      onOverride && input?.trim()
        ? h('div', { class: 'row' }, h('span', { class: 'verdict ng grow' }, '不正解'), h('button', { class: 'btn text', onClick: (e) => { e.stopPropagation(); onOverride(); } }, '正解にする'))
        : h('div', { class: 'verdict ng' }, '不正解'),
    );
  }
  return box;
}

/**
 * 回答後に止めて「続ける」を待つ。ボタン・画面タップ・Enter のどれでも進む。
 * 戻り値の button を画面下に置く。
 */
export function continueControl(screenEl, onContinue, label = '続ける') {
  let done = false;
  const armedAt = performance.now();
  const disarm = () => {
    done = true;
    document.removeEventListener('keydown', onKey);
    screenEl.removeEventListener('click', onTap);
  };
  const go = () => {
    if (done) return;
    disarm();
    onContinue();
  };
  // 「正解にする」などで画面が描き直され、ボタンが消えたら無効にする
  const stale = () => !btn.isConnected && (disarm(), true);
  const btn = h('button', { class: 'btn primary', onClick: (e) => { e.stopPropagation(); go(); } }, label);
  const onKey = (e) => {
    if (done || stale() || e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
    if (performance.now() - armedAt < 300) return; // 回答の Enter でそのまま進まないように
    e.preventDefault();
    go();
  };
  const onTap = (e) => {
    if (done || stale() || e.target.closest('button, input, select, a, label')) return;
    go();
  };
  listen(document, 'keydown', onKey);
  screenEl.addEventListener('click', onTap);
  return btn;
}

// 韓国語が出たとき・答えが韓国語のときの自動読み上げ
export function autoSpeak(card) {
  if (state.settings.autoSpeak) speak(card.term);
}

// 4択のキーボード操作（1〜4）
export function choiceKeys(onPick, count) {
  const fn = (e) => {
    const n = Number(e.key);
    if (n >= 1 && n <= count && !e.target.closest?.('input')) onPick(n - 1);
  };
  listen(document, 'keydown', fn);
  return () => document.removeEventListener('keydown', fn);
}
