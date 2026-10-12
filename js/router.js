// 画面の切り替え。各画面は要素を返す関数で、片付けは onLeave に登録する。

import { stopSpeech } from './speech.js';

const registry = {};
let leaveFns = [];
let current = { name: null, params: {} };

export function register(name, fn) {
  registry[name] = fn;
}

export function go(name, params = {}) {
  for (const fn of leaveFns) fn();
  leaveFns = [];
  stopSpeech();
  current = { name, params };
  const root = document.getElementById('app');
  const el = registry[name](params);
  el.classList.add('screen', 'enter');
  root.replaceChildren(el);
  el.onMounted?.();
  el.addEventListener('animationend', () => el.classList.remove('enter'), { once: true });
  return el;
}

export function onLeave(fn) {
  leaveFns.push(fn);
}

// 画面にいる間だけ有効なイベント
export function listen(target, type, fn, opts) {
  target.addEventListener(type, fn, opts);
  onLeave(() => target.removeEventListener(type, fn, opts));
}

export const currentScreen = () => current;
export const rerender = () => go(current.name, current.params);
