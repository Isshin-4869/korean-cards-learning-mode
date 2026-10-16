// 韓国語の読み上げ
// 1. 収録音声（Yuna プレミアムで作った audio/*.m4a。tools/make-audio.mjs）があればそれを再生する
// 2. 無いとき・設定で端末の声を選んだときは Web Speech API（ko-KR）
// iOS は最初の再生をユーザー操作の中で行う必要があるので、最初のタップで無音を 1 回流して解錠する。
// 声と速さは端末ごとに違うので、同期せず端末内（Store の 'speech'）にだけ保存する。

import { speechParts } from './answer.js';
import { audioKey } from './audio-key.js';
import { Store } from './store.js';

const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
const audio = typeof Audio !== 'undefined' ? new Audio() : null;
export const AUDIO_CACHE = 'korean-cards-audio';
let unlocked = false;
let voices = [];
let recorded = null; // 収録音声のキーの集合
let prefs = { source: 'recorded', voiceURI: '', rate: 0.9 };
let queue = [];
let playToken = 0;

export const RATES = [[0.75, 'ゆっくり'], [0.9, 'ふつう'], [1.05, 'はやめ']];
export const RECORDED_LABEL = 'Yuna プレミアム（収録音声）';

// ---- 端末の声 ----
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

// ---- 収録音声 ----
export async function loadRecorded() {
  try {
    const j = await (await fetch('audio/manifest.json')).json();
    recorded = new Set(j.keys);
  } catch {
    recorded = new Set();
  }
  return recorded;
}
export const recordedKeys = () => [...(recorded ?? [])];
export const hasRecorded = () => !!recorded?.size;
export const usingRecorded = () => prefs.source !== 'system' && hasRecorded();

export const speechAvailable = () => !!synth || hasRecorded();
export const hasKoreanVoice = () => koreanVoices().length > 0;
export const speechPrefs = () => ({ ...prefs, voiceURI: currentVoice()?.voiceURI ?? '' });

export async function loadSpeechPrefs() {
  prefs = { ...prefs, ...((await Store.get('speech')) ?? {}) };
}

export function setSpeechPrefs(p) {
  prefs = { ...prefs, ...p };
  return Store.set('speech', prefs);
}

// 0.01 秒の無音（iOS で音声を鳴らせるようにするための最初の 1 回）
function silentWav() {
  const n = 441;
  const b = new DataView(new ArrayBuffer(44 + n * 2));
  const w = (o, s) => [...s].forEach((c, i) => b.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); b.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true);
  b.setUint32(24, 44100, true); b.setUint32(28, 88200, true); b.setUint16(32, 2, true); b.setUint16(34, 16, true); w(36, 'data'); b.setUint32(40, n * 2, true);
  return URL.createObjectURL(new Blob([b.buffer], { type: 'audio/wav' }));
}

export function unlockSpeech() {
  if (unlocked) return;
  unlocked = true;
  if (audio && !queue.length) {
    audio.src = silentWav();
    audio.play().catch(() => {});
  }
  if (synth) {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    u.lang = 'ko-KR';
    synth.speak(u);
  }
}

if (typeof document !== 'undefined') {
  if (synth) {
    loadVoices();
    synth.addEventListener?.('voiceschanged', loadVoices);
  }
  for (const ev of ['pointerdown', 'touchend', 'keydown']) {
    document.addEventListener(ev, unlockSpeech, { capture: true, once: true });
  }
}

// 音声は一度ファイルとして読み込んでから鳴らす（Service Worker 経由だと iPhone の Safari で再生できないことがあるため）
const blobUrls = new Map();
async function urlFor(key) {
  if (blobUrls.has(key)) return blobUrls.get(key);
  const res = await fetch(`audio/${key}.m4a`);
  if (!res.ok) throw new Error('no audio');
  const url = URL.createObjectURL(await res.blob());
  blobUrls.set(key, url);
  if (blobUrls.size > 40) {
    const [k, u] = blobUrls.entries().next().value;
    URL.revokeObjectURL(u);
    blobUrls.delete(k);
  }
  return url;
}

function speakSystem(parts, rate) {
  if (!synth || !parts.length) return;
  const voice = currentVoice();
  for (const p of parts) {
    const u = new SpeechSynthesisUtterance(p);
    u.lang = voice?.lang ?? 'ko-KR';
    if (voice) u.voice = voice;
    u.rate = Math.max(0.5, Math.min(1.5, prefs.rate * rate));
    synth.speak(u);
  }
}

async function playRecorded(token, rate) {
  while (queue.length && token === playToken) {
    const part = queue.shift();
    try {
      const url = await urlFor(audioKey(part));
      if (token !== playToken) return;
      audio.src = url;
      // 収録音声は「ふつう」= 等倍。声の高さは変えずに速さだけ変える
      audio.defaultPlaybackRate = audio.playbackRate = Math.max(0.5, Math.min(1.5, (prefs.rate / 0.9) * rate));
      audio.preservesPitch = true;
      await audio.play();
      await new Promise((resolve) => {
        const done = () => {
          for (const ev of ['ended', 'error', 'pause']) audio.removeEventListener(ev, done);
          resolve();
        };
        for (const ev of ['ended', 'error', 'pause']) audio.addEventListener(ev, done);
      });
    } catch {
      // 再生できなかった（オフラインで未保存など）分は端末の声で読む
      if (token === playToken) speakSystem([part, ...queue.splice(0)], rate);
      return;
    }
  }
}

// 「/」「·」区切りは順に読む。opts.rate は設定の速さに掛ける倍率（ゆっくり聞く = 0.7）
export function speak(term, { rate = 1 } = {}) {
  const parts = speechParts(term);
  if (!parts.length) return;
  stopSpeech();
  if (usingRecorded() && audio && parts.every((p) => recorded.has(audioKey(p)))) {
    queue = [...parts];
    playRecorded(++playToken, rate);
    return;
  }
  speakSystem(parts, rate);
}

export function stopSpeech() {
  playToken++;
  queue = [];
  if (audio && !audio.paused) audio.pause();
  synth?.cancel();
}

// ---- まとめて保存（オフラインでも聞けるように）。Service Worker と同じ置き場 ----
export async function cachedCount() {
  if (typeof caches === 'undefined') return 0;
  const cache = await caches.open(AUDIO_CACHE);
  return (await cache.keys()).length;
}

export async function downloadAllAudio(onProgress) {
  const cache = await caches.open(AUDIO_CACHE);
  const have = new Set((await cache.keys()).map((r) => new URL(r.url).pathname.split('/').pop()));
  const all = recordedKeys();
  const todo = all.filter((k) => !have.has(k + '.m4a'));
  let done = all.length - todo.length;
  onProgress?.(done, all.length);
  let i = 0;
  const worker = async () => {
    while (i < todo.length) {
      const url = new URL(`audio/${todo[i++]}.m4a`, location.href).href;
      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok) await cache.put(url, res);
      onProgress?.(++done, all.length);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
}
