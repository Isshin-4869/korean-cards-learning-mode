// 韓国語の読み上げ（Web Speech API, ko-KR）
// iOS は最初の読み上げをユーザー操作の中で行う必要があるので、最初のタップで無音の発話を1回流して解錠する。

import { speechParts } from './answer.js';

const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
let unlocked = false;
let voice = null;

function pickVoice() {
  if (!synth) return;
  const vs = synth.getVoices();
  voice = vs.find((v) => v.lang === 'ko-KR' && /Yuna|유나/.test(v.name)) ?? vs.find((v) => v.lang?.replace('_', '-').startsWith('ko')) ?? null;
}

export const speechAvailable = () => !!synth;
export const hasKoreanVoice = () => !!voice;

export function unlockSpeech() {
  if (unlocked || !synth) return;
  unlocked = true;
  const u = new SpeechSynthesisUtterance(' ');
  u.volume = 0;
  u.lang = 'ko-KR';
  synth.speak(u);
}

if (synth) {
  pickVoice();
  synth.addEventListener?.('voiceschanged', pickVoice);
  for (const ev of ['pointerdown', 'touchend', 'keydown']) {
    document.addEventListener(ev, unlockSpeech, { capture: true, once: true });
  }
}

// 「/」「·」区切りは順に読む。rate はゆっくりのとき 0.6
export function speak(term, { rate = 1 } = {}) {
  if (!synth) return;
  const parts = speechParts(term);
  if (!parts.length) return;
  synth.cancel();
  for (const p of parts) {
    const u = new SpeechSynthesisUtterance(p);
    u.lang = 'ko-KR';
    if (voice) u.voice = voice;
    u.rate = rate;
    synth.speak(u);
  }
}

export function stopSpeech() {
  synth?.cancel();
}
