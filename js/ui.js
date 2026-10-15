// 画面部品

import { speak } from './speech.js';
import { stripNotes } from './cards.js';

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value' || k === 'checked' || k === 'disabled') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : String(kid));
  }
  return el;
}

export const icons = {
  close: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  back: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  speak: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/></svg>',
  search: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>',
  gear: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 9 4.6V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 19.4 9H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 2z"/></svg>',
};

export const svg = (name) => {
  const s = h('span', { style: 'display:inline-flex' });
  s.innerHTML = icons[name];
  return s;
};

export function iconButton(name, label, onClick) {
  return h('button', { class: 'btn icon', 'aria-label': label, onClick }, svg(name));
}

export function speakButton(term, opts) {
  return h('button', { class: 'speak', 'aria-label': '読み上げ', onClick: (e) => (e.stopPropagation(), speak(term, opts)) }, svg('speak'));
}

export function progressBar(mastered, learning, total) {
  const pct = (n) => (total ? (n / total) * 100 : 0);
  return h('div', { class: 'bar', role: 'img', 'aria-label': `習得 ${mastered} / 学習中 ${learning} / 全 ${total}` },
    h('div', { class: 'm', style: `width:${pct(mastered)}%` }),
    h('div', { class: 'l', style: `width:${pct(learning)}%` }));
}

export function segBar(done, total) {
  return h('div', { class: 'seg grow', role: 'img', 'aria-label': `${done} / ${total}` },
    Array.from({ length: total }, (_, i) => h('i', { class: i < done ? 'on' : '' })));
}

// 出題画面のヘッダー: 閉じる・進捗
export function quizTop(onClose, done, total, label) {
  return h('div', { class: 'top' },
    iconButton('close', '閉じる', onClose),
    total <= 20 ? segBar(done, total) : h('div', { class: 'grow' }, progressBar(done, 0, total)),
    h('span', { class: 'muted small', style: 'min-width:3em;text-align:right' }, label ?? `${Math.min(done + 1, total)}/${total}`));
}

const isKo = (dir, side) => (dir === 'ko') === (side === 'prompt');

// 問題文（韓国語なら大きく、読み上げボタン付き）
export function promptBlock(card, dir, { tag, text } = {}) {
  const t = text ?? (dir === 'ko' ? card.term : card.definition);
  const ko = isKo(dir, 'prompt');
  const long = t.length > (ko ? 12 : 24);
  return h('div', { class: 'prompt', 'data-card': card.id },
    h('div', { class: 'tag' }, tag ?? `${card.lesson} · ${card.ftype === '会話表現' ? card.type : card.ftype}`),
    h('div', { class: `q ${ko ? 'ko' : 'ja'}${long ? ' long' : ''}`, lang: ko ? 'ko' : 'ja' }, t),
    ko ? speakButton(card.term) : null);
}

// 選択肢。長いものがあれば1列、短ければ 2×2
export function choiceGrid(choices, onPick, koAnswers) {
  const long = choices.some((c) => stripNotes(c.text).length > (koAnswers ? 10 : 14));
  const wrap = h('div', { class: `choices${long ? ' one' : ''}` });
  choices.forEach((c, i) => {
    const b = h('button', { class: `choice${koAnswers ? ' ko' : ''}`, lang: koAnswers ? 'ko' : 'ja', 'data-card': c.id, onClick: () => onPick(i) },
      h('span', { class: 'k' }, i + 1), h('span', null, c.text));
    wrap.append(b);
  });
  return wrap;
}

export function markChoices(wrap, choices, picked) {
  [...wrap.children].forEach((b, i) => {
    b.disabled = true;
    if (choices[i].correct) b.classList.add('ok');
    else if (i === picked) b.classList.add('ng');
    else b.classList.add('dim');
  });
}

// 韓国語 IME の変換中は Enter で送信しない
export function answerInput({ lang, onSubmit, placeholder }) {
  const input = h('input', {
    class: `field grow${lang === 'ko' ? ' ko' : ''}`, lang, type: 'text', autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false',
    enterkeyhint: 'done', placeholder: placeholder ?? (lang === 'ko' ? '韓国語で入力' : '日本語で入力'), 'aria-label': '回答',
  });
  const submit = () => onSubmit(input.value);
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    submit();
  });
  const btn = h('button', { class: 'btn', style: 'background:var(--accent);color:var(--on-accent);min-height:52px;font-weight:600', onClick: submit }, '回答');
  return { el: h('div', { class: 'row' }, input, btn), input };
}

export function fmtTime(ms) {
  const s = Math.max(0, ms) / 1000;
  const m = Math.floor(s / 60);
  return m ? `${m}分${String(Math.floor(s % 60)).padStart(2, '0')}秒` : `${s.toFixed(1)}秒`;
}

export const kindTag = (card) => `${card.lesson} · ${card.ftype === '会話表現' ? card.type : card.ftype}`;
