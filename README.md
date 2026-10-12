# 韓国語カード

iPhone で使う個人用の韓国語暗記アプリです。PWA として作っています。

- **モード：** 学習（Quizlet の Learn 相当）、単語カード、テスト、スペル（聞き取り）、マッチの5つ
- **カード：** 第1〜22課と会話表現、全2114枚を同梱
- **保存：** 進捗は端末内（IndexedDB）に保存します。回答するたびに保存するので、途中で閉じても続きから再開できます。
- **オフライン：** 一度開けば、アプリ本体とカードデータは電波がなくても使えます。
- **構成：** ビルド工程はありません。素の HTML / CSS / JavaScript（ES Modules）なので、GitHub Pages にそのまま置けば動きます。

## GitHub Pages で公開する

1. GitHub で新しいリポジトリを作ります（例：`korean-cards`）。無料プランで公開する場合は Public にします。
2. このフォルダの中身をリポジトリに push します。`node_modules/` と `test-results/` は `.gitignore` で除外済みです。
   ```bash
   git init
   ```
   ```bash
   git add -A
   ```
   ```bash
   git commit -m "初版"
   ```
   ```bash
   git branch -M main
   ```
   ```bash
   git remote add origin https://github.com/<ユーザー名>/korean-cards.git
   ```
   ```bash
   git push -u origin main
   ```
3. GitHub のリポジトリ画面で **Settings → Pages** を開きます。
4. **Build and deployment** の Source を「Deploy from a branch」にし、Branch を `main`、フォルダを `/ (root)` にして Save します。
5. 1〜2分待つと、`https://<ユーザー名>.github.io/korean-cards/` で開けるようになります。

ファイルはすべて相対パスで参照しているので、サブフォルダ（`/korean-cards/`）で公開しても動きます。

## iPhone のホーム画面に追加する

1. iPhone の **Safari** で、公開した URL を開きます。Chrome など他のブラウザではホーム画面アプリになりません。
2. 画面下の共有ボタン（四角から矢印が出ているアイコン）をタップします。
3. **「ホーム画面に追加」** をタップし、右上の「追加」を押します。
4. ホーム画面の「韓国語カード」から起動すると、アドレスバーのない全画面で開きます。

補足：

- **データの保存場所：** Safari とホーム画面のアプリでは、保存場所が別々です。進捗を引き継ぎたいときは、設定の「バックアップを書き出す」→「バックアップから復元」を使います。
- **読み上げ：** 韓国語の音声がない場合は、iPhone の **設定 → アクセシビリティ → 読み上げコンテンツ → 声 → 韓国語** から追加します。
- **文字の大きさ：** iPhone の設定（画面表示と明るさ → テキストサイズ）に合わせて変わります。

## カードデータを更新する

方法は2つあります。どちらの場合も、カードIDは「課＋種別＋用語＋定義」から作っているので、内容が変わっていないカードの進捗はそのまま引き継がれます。

### A. アプリの設定から読み込む（その端末だけ）

1. 新しい md ファイルを iPhone の「ファイル」アプリに保存します。
2. アプリの **設定 → データ → カードデータ（md）を読み込む** で、そのファイルを選びます。
3. 読み込んだ枚数と、追加・削除された枚数が表示されます。
4. 元のデータに戻すときは「同梱のカードデータに戻す」を押します。

### B. 同梱データを差し替える（全端末に反映）

1. `data/cards.md` を新しいファイルで置き換えます。
2. `sw.js` の `VERSION` を上げます（下の「アプリを更新するとき」を参照）。
3. commit して push します。

md の形式：

- ` ```text ` ブロックの中に、1行1カードで書きます。
- 列は Tab 区切りで「課・種別・用語・定義」の順です。
- 1行目は見出し行です。

## アプリを更新するとき（大事）

コードやデータを変えて push するときは、**必ず `sw.js` の `VERSION` を上げてください。**

```js
const VERSION = 'v1.0.1'; // ← 変更のたびに上げる
```

- Service Worker はアプリ本体をキャッシュしています。`VERSION` が同じままだと、iPhone に古いファイルが残り続けます。
- 新しいバージョンは、更新後にアプリを1回開いた後、**次に起動したとき**から使われます。
  - 学習中に勝手に画面が入れ替わらないよう、自動で再読み込みはしません。
- 設定画面の下に出るバージョン表示は、`js/state.js` の `APP_VERSION` です。合わせて上げておくと、どちらが動いているか分かります。
- ファイルを追加・削除したときは、`sw.js` の `APP_FILES` も直します。漏れは `npm test` で検出できます。

## 手元で動かす・テストする

ES Modules と Service Worker を使うので、`file://` では動きません。ローカルサーバーで開きます。

```bash
npx http-server -p 8000 -c-1
```

http://localhost:8000 を開きます。

テストの実行には Node.js 20 以上が必要です。

```bash
npm install
```

```bash
npm test
```

```bash
npm run e2e
```

- **`npm test`：** 読み込み、答え合わせ、学習ラウンド、4択の誤答候補、Service Worker のキャッシュ一覧のユニットテストです。
- **`npm run e2e`：** iPhone サイズ（390×844）で5モードを一通り操作し、`test-results/` にスクリーンショットを保存します。
  - 途中再開、バックアップ、ダークテーマ、大きい文字、オフライン起動も確かめます。
  - Playwright 同梱のブラウザがなければ、インストール済みの Google Chrome を使います。

## ファイル構成

| パス | 内容 |
|---|---|
| `index.html` / `manifest.webmanifest` / `sw.js` | PWA の入口・マニフェスト・Service Worker |
| `css/app.css` | 見た目（デザイン方針は `CLAUDE.md`） |
| `data/cards.md` | 同梱のカードデータ |
| `js/store.js` | 保存処理（`get / set / delete` のみ。Firestore への差し替え口） |
| `js/cards.js` | md の読み込み、カードID、分類（語・文・文型）。分類の基準は `CLASSIFY_RULES` |
| `js/answer.js` | 答え合わせ（正規化、「A / B」、注記、分かち書き、打ち間違いの許容） |
| `js/deck.js` | 範囲の絞り込み、4択の選択肢、スペルの対象 |
| `js/learn.js` | 学習モードのラウンド組み立てと段階の進み方 |
| `js/quiz.js` | テストの問題づくり |
| `js/progress.js` / `js/state.js` | 進捗と、アプリ全体の状態・バックアップ |
| `js/screens/*.js` | 各画面 |
| `tests/` | ユニットテストと E2E |
| `design-options.html` | 最初のレイアウト5案（比較用。アプリでは使わない） |

## このあと追加する予定のもの

- **Firebase（Firestore）同期：** `js/store.js` の `setBackend()` に、`get / set / delete` を持つ Firestore 版を渡して差し替えます。
- **Web Push 通知：** Cloudflare Workers から送ります。`sw.js` に `push` イベントを追加します。
