// 読み上げ音声のファイル名（読み上げる文から決まる）。tools/make-audio.mjs とアプリで共通

import { hash53 } from './cards.js';

export const audioKey = (text) => 'v' + hash53(String(text).normalize('NFC').trim());
