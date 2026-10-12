# 再開メモ

## 状態（2026-10-12）
- 公開済み：https://isshin-4869.github.io/korean-cards-learning-mode/
  - リポジトリ：https://github.com/Isshin-4869/korean-cards-learning-mode
- テスト
  - `npm test`：ユニット31件
  - `npm run e2e`：Chrome
  - `npm run e2e:webkit`：Safari と同じ WebKit
  - どれも成功
- 公開版を WebKit（iPhone サイズ）で開き、次を確認済み
  - 学習を始めて回答できる
  - オフラインで起動できる
  - 途中から再開できる

## 残っていること
- 実機の iPhone での確認
  - キーボード表示中の入力欄の位置
  - 読み上げの声
  - 共有シートでのバックアップ保存
  - Dynamic Type
- 更新して push するときは `sw.js` の `VERSION` を上げる
- GitHub の鍵（Fine-grained トークン）は30日で切れる
  - 切れたら作り直し、`gh auth login --with-token` でログインし直す
