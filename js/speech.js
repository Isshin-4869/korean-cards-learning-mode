// 韓国語の読み上げ（Web Speech API, ko-KR）
// iOS は最初の読み上げをユーザー操作の中で行う必要があるので、最初のタップで無音の発話を1回流して解錠する。
// 声は端末ごとに違うので、選んだ声と速さは同期せず端末内（Store の 'speech'）にだけ保存する。

import { speechParts } from './answer.js';
import { Store } from './store.js';

const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
let unlocked = false;
let voices = [];
let prefs = { voiceURI: '', rate: 0.9 };

export const RATES = [[0.75, 'ゆっくり'], [0.9, 'ふつう'], [1.05, 'はやめ']];

// 自然に聞こえる順: プレミアム ＞ 拡張 ＞ ふつう。iPhone の「設定」で追加した声がここに並ぶ
// iPhone では高音質版も名前は「Yuna」のままで、違いは voiceURI（com.apple.voice.enhanced… など）にしか出ないことがある
export function voiceQuality(v) {
  const n = `${v.name} ${v.voiceURI ?? ''}`;
  if (/premium|プレミアム|고급/i.test(n)) return 3;
  if (/enhanced|拡張|향상/i.test(n)) return 2;
  if (/compact|簡易/i.test(n)) return 0;
  return 1;
}
export const QUALITY_LABEL = ['簡易', '', '拡張', 'プレミアム'];

const isKorean = (v) => v.lang?.replace('_', '-').toLowerCase().startsWith('ko');
// Apple の「キャラクター風の声」（Eddy・Grandma など）は学習に向かないので出さない
const NOVELTY = /^(Eddy|Flo|Grandma|Grandpa|Reed|Rocko|Sandy|Shelley|Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Good News|Jester|Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox|Fred|Junior|Kathy|Ralph)\b/i;
// ふつうの声の中でも、韓国語のネイティブの声を前に
const NATIVE = /Yuna|유나|Minsu|민수|Jian|Suhyun|Sora|Google/i;

function loadVoices() {
  if (!synth) return;
  voices = synth.getVoices()
    .filter((v) => isKorean(v) && !NOVELTY.test(v.name))
    .sort((a, b) => voiceQuality(b) - voiceQuality(a) || Number(NATIVE.test(b.name)) - Number(NATIVE.test(a.name)) || Number(b.localService) - Number(a.localService));
}

/** 韓国語の声（自然な順） */
export function koreanVoices() {
  if (!voices.length) loadVoices();
  return voices;
}

function currentVoice() {
  const vs = koreanVoices();
  return vs.find((v) => v.voiceURI === prefs.voiceURI) ?? vs[0] ?? null;
}

export const speechAvailable = () => !!synth;
export const hasKoreanVoice = () => koreanVoices().length > 0;
export const speechPrefs = () => ({ ...prefs, voiceURI: currentVoice()?.voiceURI ?? '' });

export async function loadSpeechPrefs() {
  prefs = { ...prefs, ...((await Store.get('speech')) ?? {}) };
}

export function setSpeechPrefs(p) {
  prefs = { ...prefs, ...p };
  return Store.set('speech', prefs);
}

export function unlockSpeech() {
  if (unlocked || !synth) return;
  unlocked = true;
  const u = new SpeechSynthesisUtterance(' ');
  u.volume = 0;
  u.lang = 'ko-KR';
  synth.speak(u);
}

if (synth) {
  loadVoices();
  synth.addEventListener?.('voiceschanged', loadVoices);
  for (const ev of ['pointerdown', 'touchend', 'keydown']) {
    document.addEventListener(ev, unlockSpeech, { capture: true, once: true });
  }
}

// 「/」「·」区切りは順に読む。opts.rate は設定の速さに掛ける倍率（ゆっくり聞く = 0.7）
export function speak(term, { rate = 1 } = {}) {
  if (!synth) return;
  const parts = speechParts(term);
  if (!parts.length) return;
  synth.cancel();
  const voice = currentVoice();
  for (const p of parts) {
    const u = new SpeechSynthesisUtterance(p);
    u.lang = voice?.lang ?? 'ko-KR';
    if (voice) u.voice = voice;
    u.rate = Math.max(0.5, Math.min(1.5, prefs.rate * rate));
    synth.speak(u);
  }
}

export function stopSpeech() {
  synth?.cancel();
}
