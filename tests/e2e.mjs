// iPhone サイズ（390×844）で5モードを一通り操作し、スクリーンショットを test-results/ に保存する。
// 使い方: npm i && npm run e2e（Chrome） / npm run e2e:webkit（Safari と同じ WebKit。先に npx playwright install webkit）
// Playwright 同梱の Chromium がなければ、インストール済みの Chrome を使う。

import { chromium, webkit } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { parseCardsMarkdown, stripNotes } from '../js/cards.js';
import { normalizeForCompare } from '../js/answer.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const engine = process.env.E2E_BROWSER === 'webkit' ? 'webkit' : 'chromium';
const outDir = path.join(root, 'test-results', engine);
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const { cards } = parseCardsMarkdown(fs.readFileSync(path.join(root, 'data/cards.md'), 'utf8'));
const byId = new Map(cards.map((c) => [c.id, c]));

// ---- 静的サーバー ----
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.md': 'text/markdown; charset=utf-8', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.json': 'application/json' };
let swBump = false; // true にすると、新しい版を公開したのと同じ状態になる
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(root, p);
  fs.readFile(f, (err, buf) => {
    if (err || !f.startsWith(root)) return res.writeHead(404).end();
    if (swBump && p === '/sw.js') buf = Buffer.concat([buf, Buffer.from('\n// bump\n')]);
    res.writeHead(200, { 'content-type': types[path.extname(f)] ?? 'application/octet-stream' }).end(buf);
  });
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}/`;

let browser;
if (engine === 'webkit') {
  browser = await webkit.launch();
} else {
  try {
    browser = await chromium.launch();
  } catch {
    browser = await chromium.launch({ channel: 'chrome' });
  }
}
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ja-JP' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/favicon|Failed to preconnect/.test(m.text()) && errors.push(m.text()));

let n = 0;
process.on('uncaughtException', async (e) => {
  console.error(e);
  await page.screenshot({ path: path.join(outDir, 'failure.png') }).catch(() => {});
  console.error('errors:', errors);
  process.exit(1);
});
const shot = async (name) => {
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(outDir, `${String(++n).padStart(2, '0')}-${name}.png`) });
};
const log = (...a) => console.log('✓', ...a);
const btn = (name) => page.getByRole('button', { name, exact: false });
const promptCard = async () => byId.get(await page.locator('.prompt[data-card]').first().getAttribute('data-card'));
const promptIsKo = async () => (await page.locator('.prompt .q').first().getAttribute('class')).includes('ko');
const answerFor = (card, promptKo) => stripNotes(promptKo ? card.definition : card.term).split(/\s*[\/／]\s*/)[0];

async function tapLesson(label) {
  await page.locator('.ltile', { hasText: new RegExp(`^${label}`) }).click();
}

// ---- ホーム ----
await page.goto(base);
await page.waitForSelector('.ltile');
await shot('home');
log('ホーム表示');

// ---- 学習 ----
await btn(/^学習 ·/).click();
let mcWrongDone = false;
let writtenWrongDone = false;
let dontKnowDone = false;
let typoDone = false;
const seen = { mc: 0, written: 0, rmc: 0 };
async function answerLearnQuestion() {
  const card = await promptCard();
  const ko = await promptIsKo();
  if (await page.locator('.choices').count()) {
    seen.mc++;
    if (!mcWrongDone) {
      mcWrongDone = true;
      await shot('learn-mc');
      await page.locator(`.choice:not([data-card="${card.id}"])`).first().click();
      await shot('learn-mc-wrong');
    } else if (!dontKnowDone) {
      dontKnowDone = true;
      await btn('分からない').click();
    } else {
      await page.locator(`.choice[data-card="${card.id}"]`).click();
    }
  } else {
    seen.written++;
    const input = page.locator('input.field');
    if (!writtenWrongDone) {
      writtenWrongDone = true;
      await input.fill(ko ? 'まちがい' : '아니요아니요');
      await shot('learn-written');
      await input.press('Enter');
      await shot('learn-written-wrong');
      await btn('正解にする').click();
      return;
    }
    let value = answerFor(card, ko);
    if (!typoDone && !ko && [...value.normalize('NFD')].length >= 6) {
      // 最後の音節の終声を落とす／母音を変えるなど、1字母だけ違う入力
      typoDone = true;
      const chars = [...value];
      const last = chars.pop().normalize('NFD');
      value = chars.join('') + (last.length === 3 ? last.slice(0, 2) : last + 'ᆫ').normalize('NFC');
      await input.fill(value);
      await input.press('Enter');
      await shot('learn-written-typo');
      await btn('続ける').click();
      return;
    }
    await input.fill(value);
    await input.press('Enter');
  }
  await btn('続ける').click();
}
async function learnUntilSummary(maxSteps = 40) {
  for (let i = 0; i < maxSteps; i++) {
    if (await page.getByText('ラウンド完了').count()) return;
    await page.waitForSelector('.prompt[data-card], h1');
    await answerLearnQuestion();
  }
  throw new Error('ラウンドが終わらない');
}
await learnUntilSummary();
await shot('learn-summary');
log('学習ラウンド1完了', seen);
await btn('次のラウンドへ').click();
await learnUntilSummary();
await shot('learn-summary-2');
log('学習ラウンド2完了（記述あり）', seen);
assert.ok(seen.written > 0, '2ラウンド目で記述が出ていない');

// 途中でやめても続きから再開できる
await btn('次のラウンドへ').click();
await answerLearnQuestion();
await answerLearnQuestion();
const posBefore = await page.locator('.top .small').first().textContent();
await page.reload();
await page.waitForSelector('.ltile');
const resumeLabel = await page.locator('.btn.primary').textContent();
assert.match(resumeLabel, /学習の続き/);
await shot('home-resume');
await btn('学習の続き').click();
const posAfter = await page.locator('.top .small').first().textContent();
assert.equal(posAfter, posBefore);
log('再読み込み後に続きから再開', posBefore, '→', posAfter);
await page.getByRole('button', { name: '閉じる' }).click();

// ---- 範囲を第6課（単語＋文法）に変える ----
await tapLesson('6課');
await tapLesson('1課');
await shot('home-lesson6');

// ---- 単語カード ----
await btn('単語カード').click();
await page.waitForSelector('.flash');
await shot('flash-front');
await page.locator('.flash-wrap').click({ position: { x: 150, y: 200 } });
await page.waitForTimeout(300);
assert.ok(await page.locator('.flash.flipped').count(), '裏返らない');
await shot('flash-back');
const box = await page.locator('.flash-wrap').boundingBox();
await page.mouse.move(box.x + 100, box.y + 200);
await page.mouse.down();
await page.mouse.move(box.x + 200, box.y + 205, { steps: 5 });
await page.mouse.move(box.x + 300, box.y + 210, { steps: 5 });
await page.mouse.up();
assert.match(await page.locator('.top .small').first().textContent(), /^2\//);
await btn('まだ').click();
for (let i = 0; i < 200 && !(await page.getByText('周目 完了').count()); i++) await btn('覚えた').click();
await shot('flash-summary');
await btn('「まだ」の').click();
assert.match(await page.locator('.top .small').first().textContent(), /^1\/1$/);
log('単語カード: めくる・スワイプ・まだだけもう1周');
await page.getByRole('button', { name: '閉じる' }).click();

// ---- テスト ----
await btn('テスト').click();
await btn('10問').click();
await btn('正誤').click();
await btn('線結び').click();
await shot('test-setup');
await btn('始める').click();
let testWrong = 0;
const seenTest = new Set();
for (let i = 0; i < 20 && !(await page.getByText('テスト結果').count()); i++) {
  if (await page.locator('.pairs').count()) {
    seenTest.add('match');
    await shot('test-match');
    const lefts = await page.locator('.pairs .choice.ko').all();
    for (const l of lefts) {
      const id = await l.getAttribute('data-card');
      await l.click();
      await page.locator(`.pairs .choice:not(.ko)[data-card="${id}"]`).click();
    }
    await shot('test-match-paired');
    await btn('答え合わせ').click();
    continue;
  }
  const card = await promptCard();
  const ko = await promptIsKo();
  if (await page.locator('.tf').count()) {
    seenTest.add('tf');
    const shown = await page.locator('.prompt .q').nth(1).textContent();
    const truth = normalizeForCompare(shown) === normalizeForCompare(ko ? card.definition : card.term);
    await shot('test-tf');
    const wrongOnPurpose = testWrong++ === 0;
    await page.getByRole('button', { name: truth !== wrongOnPurpose ? '合っている' : '違う' }).click();
  } else if (await page.locator('.choices').count()) {
    seenTest.add('mc');
    await page.locator(`.choice[data-card="${card.id}"]`).click();
  } else {
    seenTest.add('written');
    const wrongOnPurpose = !seenTest.has('written-wrong');
    seenTest.add('written-wrong');
    await page.locator('input.field').fill(wrongOnPurpose ? '틀린답' : answerFor(card, ko));
    if (wrongOnPurpose) await shot('test-written');
    await page.locator('input.field').press('Enter');
  }
}
await shot('test-result');
log('テスト形式', [...seenTest]);
if (await btn('正解にする').count()) {
  await btn('正解にする').first().click();
  await shot('test-result-override');
}
if (await btn('間違えた単語で学習する').count()) {
  await btn('間違えた単語で学習する').click();
  await page.waitForSelector('.prompt[data-card]');
  await shot('test-to-learn');
  await page.getByRole('button', { name: '閉じる' }).click();
} else {
  await btn('ホームへ').click();
}
log('テスト結果と「間違えた単語で学習」');

// ---- スペル ----
await btn('スペル').click();
await shot('spell-intro');
await btn('問はじめる').click();
for (let i = 0; i < 12 && !(await page.getByText('スペル結果').count()); i++) {
  const id = await page.locator('[data-card]').first().getAttribute('data-card');
  const card = byId.get(id);
  if (i === 0) {
    await shot('spell-question');
    await page.locator('input.field').fill('가나다');
    await page.locator('input.field').press('Enter');
    await shot('spell-wrong');
  } else {
    await page.locator('input.field').fill(stripNotes(card.term));
    await page.locator('input.field').press('Enter');
  }
  await btn('続ける').click();
}
await shot('spell-result');
log('スペル完了');
await btn('ホームへ').click();

// ---- マッチ ----
await btn('マッチ').click();
await btn('スタート').click();
await page.waitForSelector('.tile');
await shot('match-board');
const tiles = await page.locator('.tile').all();
const ids = [...new Set(await Promise.all(tiles.map((t) => t.getAttribute('data-card'))))];
// わざと1回間違える
await page.locator(`.tile[data-card="${ids[0]}"]`).first().click();
await page.locator(`.tile[data-card="${ids[1]}"]`).first().click();
for (const id of ids) {
  const pair = page.locator(`.tile[data-card="${id}"]`);
  await pair.nth(0).click();
  await pair.nth(1).click();
}
await page.waitForSelector('text=もう一度');
await shot('match-result');
log('マッチ完了');
await btn('ホームへ').click();

// ---- 設定・ダークテーマ ----
await page.getByRole('button', { name: '設定' }).click();
await shot('settings');
// iPhone と同じく共有シート経由で書き出す経路を確かめる（共有シートの代わりに受け取ったファイルを控える）
await page.evaluate(() => {
  navigator.canShare = () => true;
  navigator.share = async (data) => { window.__shared = { name: data.files[0].name, text: await data.files[0].text() }; };
});
await btn('バックアップを書き出す').click();
const shared = await page.waitForFunction(() => window.__shared).then((h) => h.jsonValue());
assert.match(shared.name, /^korean-cards-backup-\d{8}\.json$/);
const backup = JSON.parse(shared.text);
assert.equal(backup.format, 'korean-cards-backup');
assert.ok(Object.keys(backup.progress).length > 0);
log('バックアップ書き出し', Object.keys(backup.progress).length, '件');
await btn('ダーク').click();
await page.getByRole('button', { name: '戻る' }).click();
await shot('home-dark');
await btn(/^学習/).click();
await page.waitForSelector('.prompt[data-card]');
await shot('learn-dark');
await page.getByRole('button', { name: '閉じる' }).click();

// ---- 文字を大きくしても崩れない（Dynamic Type の最大級を想定） ----
await page.addStyleTag({ content: 'html { font-size: 28px !important; }' });
await shot('home-large-text');
await btn(/^学習/).click();
await page.waitForSelector('.prompt[data-card]');
await shot('learn-large-text');
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
assert.ok(!overflow, '横にはみ出している');
await page.getByRole('button', { name: '閉じる' }).click();

// ---- オフライン起動 ----
await page.evaluate(() => navigator.serviceWorker.ready);
await page.reload();
await page.waitForSelector('.ltile');
await ctx.setOffline(true);
await page.reload();
await page.waitForSelector('.ltile', { timeout: 5000 });
await btn(/^学習/).click();
await page.waitForSelector('.prompt[data-card]');
await shot('offline-learn');
log('オフラインで起動・学習');
await ctx.setOffline(false);

// ---- アプリの更新: 新しい版を受け取ったらホームに知らせ、押したときだけ再読み込み ----
await page.getByRole('button', { name: '閉じる' }).click();
swBump = true;
await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()));
await page.getByText('新しいバージョンがあります').waitFor({ timeout: 10000 });
await shot('update-banner');
await btn('更新').click();
await page.waitForSelector('.ltile');
assert.equal(await page.getByText('新しいバージョンがあります').count(), 0);
log('更新の知らせ → 更新ボタンで再読み込み');

// ---- 同期: Firebase をまねたサーバーで、端末1で学習した進捗が端末2に届く ----
const fakeDb = new Map();
async function newSyncDevice() {
  // Service Worker 経由だと差し替えが効かないので止める
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ja-JP', serviceWorkers: 'block' });
  await c.route('**/js/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "export const FIREBASE = { apiKey: 'test', projectId: 'test' };\nexport const PUSH_WORKER_URL = '';" }));
  await c.route('https://identitytoolkit.googleapis.com/**', (r) => {
    const b = JSON.parse(r.request().postData());
    return b.password === 'pw'
      ? r.fulfill({ json: { localId: 'u1', email: b.email, idToken: 'tok', refreshToken: 'ref', expiresIn: '3600' } })
      : r.fulfill({ status: 400, json: { error: { message: 'INVALID_LOGIN_CREDENTIALS' } } });
  });
  await c.route('https://firestore.googleapis.com/**', (r) => {
    if (r.request().url().endsWith(':commit')) {
      for (const w of JSON.parse(r.request().postData()).writes) fakeDb.set(w.update.name.split('/').pop(), w.update.fields);
      return r.fulfill({ json: {} });
    }
    return r.fulfill({ json: { documents: [...fakeDb].map(([k, fields]) => ({ name: `x/users/u1/data/${k}`, fields })) } });
  });
  const p = await c.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(base);
  await p.waitForSelector('.ltile');
  return { c, p };
}
async function login(p, password) {
  await p.getByRole('button', { name: '設定' }).click();
  await p.getByLabel('メールアドレス').fill('me@example.com');
  await p.getByLabel('パスワード').fill(password);
  await p.getByRole('button', { name: 'ログイン', exact: true }).click();
}
{
  const d1 = await newSyncDevice();
  await login(d1.p, 'wrong');
  await d1.p.getByText('メールアドレスかパスワードが違います').waitFor();
  await d1.p.getByLabel('メールアドレス').scrollIntoViewIfNeeded();
  await d1.p.screenshot({ path: path.join(outDir, `${String(++n).padStart(2, '0')}-sync-login-error.png`) });
  await d1.p.getByLabel('パスワード').fill('pw');
  await d1.p.getByRole('button', { name: 'ログイン', exact: true }).click();
  await d1.p.getByText('ログインして同期しました').waitFor();
  await d1.p.getByText('ログイン中').scrollIntoViewIfNeeded();
  await d1.p.waitForTimeout(300);
  await d1.p.screenshot({ path: path.join(outDir, `${String(++n).padStart(2, '0')}-sync-logged-in.png`) });
  await d1.p.getByRole('button', { name: '戻る' }).click();
  await d1.p.getByRole('button', { name: /^学習/ }).click();
  const id = await d1.p.locator('.prompt[data-card]').getAttribute('data-card');
  await d1.p.locator(`.choice[data-card="${id}"]`).click();
  await d1.p.getByRole('button', { name: '閉じる' }).click();
  await d1.p.getByRole('button', { name: '設定' }).click();
  await d1.p.getByRole('button', { name: '今すぐ同期' }).click();
  await d1.p.getByText(/最終同期/).waitFor();
  assert.ok(fakeDb.has('progress'), '進捗が送られていない');

  const d2 = await newSyncDevice();
  assert.equal(await d2.p.locator('.stats b').nth(1).textContent(), '0');
  await login(d2.p, 'pw');
  await d2.p.getByText('ログインして同期しました').waitFor();
  await d2.p.getByRole('button', { name: '戻る' }).click();
  assert.equal(await d2.p.locator('.stats b').nth(1).textContent(), '1', '端末2に学習中の1枚が届いていない');
  await d2.p.screenshot({ path: path.join(outDir, `${String(++n).padStart(2, '0')}-sync-device2-home.png`) });
  log('同期: 端末1の学習が端末2に届く');
  await d1.c.close();
  await d2.c.close();
}

await browser.close();
server.close();
if (errors.length) {
  console.error('ページのエラー:', errors);
  process.exit(1);
}
console.log(`\nすべて成功（${engine}）。スクリーンショット ${n}枚 → test-results/${engine}/`);
