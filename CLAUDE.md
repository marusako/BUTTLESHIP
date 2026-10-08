# The Day Of Sagittarius (ブラウザゲーム)

『涼宮ハルヒの暴走』「射手座の日」に登場するチーム対戦型の宇宙艦隊ゲームを再現する HTML/Canvas/JS のリポジトリ。ブランチは `main`。

**対象は PC のブラウザ (キーボード + マウス) だけ。** スマホ・タッチ対応は考えない。

**v3.0 からの方針 (ユーザーの指示)**: 原作ゲームの再現である**クラシック (`classic/`) を主流として開発する**。ユーザーがオリジナルで作った**モダン (一番上の `index.html` のゲーム・`logic.js`・`rule-ai.js`・`brain.js`・`learned-brain.js`・`watch.html` など) は廃止して凍結**する: タイトル画面から消し、ファイルは残すが、ユーザーの指示がない限り変更しない。AI 学習の仕組み (神経進化・評価・観戦) はクラシックでも使い、学習はクラシック用に第 1 世代から始める (モダンの学習は `training/archive/2026-10-08-modern-gen2086/` に退避)

## 構成
- `index.html` … タイトル画面・設定画面 (タイトルの「クラシック」で `classic/index.html` へ)。モダンのゲーム (描画・入力・ゲームループ) も入っているが凍結
- `logic.js` … 描画や DOM に依存しないロジック。ブラウザでは `<script src>` で `window.SagittariusLogic` に、Node では `require()` で読み込める形にする (ES Modules は `file://` で動かないため使わない)
- `logic.test.js` … `logic.js` の仕様テスト (`node:test`)
- `rule-ai.js` / `rule-ai.test.js` … 旧型 AI (人が書いたルールの AI。ゲームで選べる AI の 1 つで、学習の「ものさし」)
- `learned-brain.js` … 学習型 AI の脳 (ゲームで選べるもう 1 つの AI)。`npm run train` の終わりに自動で書き直される。手で書き換えない
- `brain.js` / `brain.test.js` … 学習で育てる AI の脳と、盤面 → 入力・出力 → 命令 の変換
- `watch.html` … 開発用の観戦画面 (配布しない)
- `settings.js` / `settings.test.js` … 設定 (キー配置・音量・自艦隊の名前・クレジット) とそのテスト
- `music.js` / `music.test.js` … BGM の楽譜データと、再生の予定を作る純粋な関数とそのテスト
- `sound.js` / `sound.test.js` … 効果音と BGM (Web Audio で合成) と、その計算の関数のテスト
- ゲームに必要なファイルを増やしたら、`scripts/package.js` の `GAME_FILES` にも加える (配布用 zip に入れるため)
- `classic/` … クラシック (原作ゲームの再現。v1.3 からジョブを取り除いたものから始める)。**v3.0 から主流の開発対象**
- `DESIGN.md` … 設計書。**作業に入る前に必ず読む**
- `PLAN.md` … MVP の計画
- `scripts/serve.js` … 依存なしの開発用サーバー
- `scripts/package.js` … バージョン別の配布用 zip を作る (テストは `scripts/package.test.js`)

## 設計書 (DESIGN.md) の管理
- コードを変えたら、**同じコミットで** DESIGN.md の該当箇所と「変更履歴」を更新する
- 仕様を決めた理由は「設計判断の記録」に残す
- 気づいた不具合や制約は、すぐ直さない場合でも「既知の課題・制約」に書く
- 設計書とコードが食い違っていたらコードを正として設計書を直す

## 運用ルール
- `PLAN.md` の「今後の計画」(今後の候補・exe 化・オンライン対戦) は、**ユーザーが判断したタイミングでだけ実行する**。Claude から提案するのはよいが、指示なしに着手しない
- バージョンは git の履歴で管理する。バージョン番号は注釈付きタグ `vX.Y` / `vX.Y.Z` で付ける
- **コミットしたら毎回 main を push する。ゲームの仕様 (ルール・動き・画面・AI・脳) を追加・修正したコミットでは、パッチ番号を 1 つ上げた注釈付きタグ (例: `v3.0.4` → `v3.0.5`) も付けて push する** (ユーザーの指示)。計画や記録だけのコミットではタグを付けない。タグのメッセージはリリースの説明になるので、その版で変わったことを書く。タグの push で GitHub Actions がリリースを作る。マイナー (`vX.Y`) を上げるのはユーザーが決める
- 外部パッケージは入れない (Node 標準機能のみ)
- 仕様の変更・追加は、先に `logic.test.js` にテストを書き、失敗を確認してから実装する
- バランス調整は、AI 同士のシミュレーション (プレイヤー艦隊も AI にして `step` を回す) で試合時間と勝率を確かめる。乱数は種が近くてもばらつくもの (mulberry32 など) を使う (種を 1, 2, 3… にした単純な乱数だと最初の値がどの試合もほぼ 0 になり、結果が偏る)。処理順の影響を見るため、艦隊の並び (青が先 / 赤が先) を入れ替えた結果も比べる
- 変更後は `npm test` を通し、ブラウザでも動作確認する (Browser pane の起動設定は `.claude/launch.json` の `sagittarius`)
- 確認のためにブラウザ上でロジックを書き換えた場合は、確認後すぐにページを再読み込みして本物に戻し、ユーザーに伝える

## コマンド
- `npm test` … テストを実行
- `npm run serve` … http://localhost:8080/ で配信
- `npm run train -- --minutes 60` … AI の脳を学習する (途中経過は `training/`)。**学習型 AI は毎回、前回の学習の続きからアップデートする** (`--fresh` は使わない)。終わると `learned-brain.js` が最新の脳で書き直されるので、差分を確認してコミットする (`npm run export-brain` でも書き出せる)。**学習時間は毎回ユーザーと相談して決める**。**各段階の終わりに「学習するか」「何分回すか」を確かめる**
- `npm run evaluate` … 学習型 AI 対 旧型 AI の勝率を測る
- `npm run imitate` … 旧型 AI の真似をする脳を作る (`training/imitation.json`)。`npm run train -- --fresh --from training/imitation.json` で学習の出発点にする (学習をやり直すときだけ。ユーザーの OK がいる)
- `npm run package -- vX.Y` … そのタグの配布用 zip を `dist/` に作る (引数なしなら全タグ分)。GitHub Releases に添付する手順は DESIGN.md の「配布」
