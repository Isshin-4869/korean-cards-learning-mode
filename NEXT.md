# 再開メモ

## 状態（2026-10-12）
- NEXT.md の残り作業はすべて完了（README・最終一覧・WebKit での動作確認）
- テスト
  - `npm test`：ユニット31件
  - `npm run e2e`：Chrome
  - `npm run e2e:webkit`：Safari と同じ WebKit
  - どれも成功

## 残っていること
- 実機の iPhone でしか確かめられない項目
  - キーボード表示中の入力欄の位置
  - 読み上げの声
  - 共有シートでのバックアップ保存
  - Dynamic Type
- iOS シミュレーターでも確認したい場合は、ターミナルで `sudo xcodebuild -license` を実行して Xcode のライセンスに同意してもらう必要がある
- GitHub Pages への公開（手順は README）
