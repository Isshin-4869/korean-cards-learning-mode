# 再開メモ

## 公開中（v1.0.6）
- **アプリ：** https://isshin-4869.github.io/korean-cards-learning-mode/
  - リポジトリ：https://github.com/Isshin-4869/korean-cards-learning-mode
- **デザイン：** シンプル（生成り＋青）。惑星とドット書体は外した
  - 表紙：連続記録・記憶の予測（`js/memory.js`）・今日の復習（`js/review.js`。1日の上限 30／50／100）
  - 課の選択は「学習する」・各モードの先のページ（`js/screens/start.js`、リング）
  - 途中のラウンドがあれば「続きから」。新しく始めるときは確認シートを出す
- **同期：** Firebase（korean-cards-c2e8e）
- **通知とウィジェットの中継：** Cloudflare Worker `korean-cards-push`（`worker/`）
  - KV：`b11f0fc6f77f4d6db2fa34a3b6d68329`
  - 毎時0分に cron で動く
- **アイコンのバッジ：** 今日の復習の残り枚数。`js/widget.js` の `badgeCount` / `updateBadge`
- **Scriptable ウィジェット：** `widget/scriptable-widget.js`

## 秘密情報の置き場所（リポジトリには入れない）
- `~/.config/korean-cards/cloudflare-token`：Cloudflare の API トークン（Workers の編集のみ）
- `~/.config/korean-cards/vapid.json`：VAPID の鍵の組。秘密鍵は Worker の secret `VAPID_PRIVATE_JWK` にも登録済み
- GitHub：Fine-grained トークン（このリポジトリの Contents と Pages のみ）。30日で切れる

## テスト
- `npm test`：ユニットと Worker
- `npm run e2e` と `npm run e2e:webkit`

## 残っていること
- 実機の iPhone での確認
  - 通知の受け取り
  - バッジの表示
  - Scriptable ウィジェットの見え方
  - キーボード表示中の入力欄の位置
