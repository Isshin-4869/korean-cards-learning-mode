import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCardsMarkdown } from '../js/cards.js';
import { speechParts } from '../js/answer.js';
import { audioKey } from '../js/audio-key.js';

const root = fileURLToPath(new URL('..', import.meta.url));

test('全カードの読み上げに収録音声がある（無ければ node tools/make-audio.mjs）', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'audio/manifest.json'), 'utf8'));
  const keys = new Set(manifest.keys);
  const { cards } = parseCardsMarkdown(fs.readFileSync(path.join(root, 'data/cards.md'), 'utf8'));
  const missing = cards.flatMap((c) => speechParts(c.term)).filter((t) => !keys.has(audioKey(t)));
  assert.deepEqual([...new Set(missing)].slice(0, 5), []);
  for (const k of keys) assert.ok(fs.existsSync(path.join(root, 'audio', k + '.m4a')), `${k}.m4a がない`);
});

test('ファイル名は読み上げる文から決まる', () => {
  assert.equal(audioKey('기다리다'), audioKey('기다리다'.normalize('NFD')));
  assert.notEqual(audioKey('일'), audioKey('이'));
});
