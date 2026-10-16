// 読み上げ音声を作る（macOS の say と afconvert を使う。Mac で実行する）
// 使い方: node tools/make-audio.mjs        … まだ無い音声だけ作る
//         node tools/make-audio.mjs --all  … 全部作り直す
//
// - 声は「Yuna (Premium)」。システム設定 → アクセシビリティ → リーダーと読み上げ → 声 で韓国語の Yuna（プレミアム）を入れておく
// - 1 つの文（読み上げの区切り「/」「·」ごと）を 1 ファイル。冒頭 0.4 秒・末尾 0.2 秒の無音を入れる（再生の頭が切れないように）
// - ファイル名は文のハッシュ（js/speech.js の audioKey と同じ）。audio/manifest.json に一覧を書く

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { parseCardsMarkdown } from '../js/cards.js';
import { speechParts } from '../js/answer.js';
import { audioKey } from '../js/audio-key.js';

const run = promisify(execFile);
const root = fileURLToPath(new URL('..', import.meta.url));
const outDir = path.join(root, 'audio');
const VOICE = 'Yuna (Premium)';
const LEAD_MS = 400;
const TAIL_MS = 200;
const BITRATE = 48000;
// 設定画面の「試す」で読む文
const EXTRA = ['안녕하세요. 만나서 반갑습니다.'];

const all = process.argv.includes('--all');
const voices = (await run('say', ['-v', '?'])).stdout;
// say は声が無いと黙って別の声で読むので、先に確かめる
if (!voices.split('\n').some((l) => l.startsWith(VOICE + ' '))) {
  console.error(`声「${VOICE}」が入っていません。システム設定から追加してください`);
  process.exit(1);
}

const { cards } = parseCardsMarkdown(fs.readFileSync(path.join(root, 'data/cards.md'), 'utf8'));
const texts = [...new Set([...cards.flatMap((c) => speechParts(c.term)), ...EXTRA])];
fs.mkdirSync(outDir, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'korean-audio-'));

const files = {};
let made = 0;
let i = 0;
async function worker() {
  while (i < texts.length) {
    const text = texts[i++];
    const key = audioKey(text);
    const file = path.join(outDir, key + '.m4a');
    files[key] = text;
    if (!all && fs.existsSync(file)) continue;
    const aiff = path.join(tmp, key + '.aiff');
    await run('say', ['-v', VOICE, '-o', aiff, `[[slnc ${LEAD_MS}]] ${text} [[slnc ${TAIL_MS}]]`]);
    await run('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', String(BITRATE), aiff, file]);
    fs.unlinkSync(aiff);
    made++;
    if (made % 100 === 0) console.log(`${made} 個作成…`);
  }
}
await Promise.all(Array.from({ length: Math.max(2, os.cpus().length - 2) }, worker));
fs.rmdirSync(tmp);

// 使われなくなった音声は消す（データを差し替えたとき）
let removed = 0;
for (const f of fs.readdirSync(outDir)) {
  if (f.endsWith('.m4a') && !files[f.slice(0, -4)]) {
    fs.unlinkSync(path.join(outDir, f));
    removed++;
  }
}
const manifest = { voice: VOICE, leadMs: LEAD_MS, keys: Object.keys(files).sort() };
fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest));
const bytes = fs.readdirSync(outDir).filter((f) => f.endsWith('.m4a')).reduce((s, f) => s + fs.statSync(path.join(outDir, f)).size, 0);
console.log(`音声 ${texts.length} 個（今回作成 ${made}・削除 ${removed}）、合計 ${(bytes / 1048576).toFixed(1)} MB`);
