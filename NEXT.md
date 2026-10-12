# 再開メモ

## 公開中（v1.0.4）
- **アプリ：** https://isshin-4869.github.io/korean-cards-learning-mode/
  - リポジトリ：https://github.com/Isshin-4869/korean-cards-learning-mode
- **デザイン：** 宇宙デザイン案1（課ごとの習得率でドット絵の惑星が育つ）。`js/planet.js`
- **同期：** Firebase（korean-cards-c2e8e）
- **通知とウィジェットの中継：** Cloudflare Worker `korean-cards-push`（`worker/`）
  - KV：`b11f0fc6f77f4d6db2fa34a3b6d68329`
  - 毎時0分に cron で動く
- **アイコンのバッジ：** 学習中の枚数。`js/widget.js` の `updateBadge`
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
