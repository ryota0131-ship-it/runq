# AI開発エージェント向けルール(runQ.)

このファイルは、Claude Code / Codex等、どのAI開発エージェントが本リポジトリを編集する場合にも共通で守ってほしいルールです。「Claudeだけが理解できる状態」を避けるため、重要な仕様・設計判断は次のドキュメントに集約しています。作業前に必ず目を通してください。

- [README.md](./README.md) — プロダクト概要・技術構成・起動方法
- [docs/requirements.md](./docs/requirements.md) — V1の基準仕様(要件定義)
- [docs/architecture.md](./docs/architecture.md) — 現行アーキテクチャ・データモデル・将来方針

## 基本ルール

1. **`docs/requirements.md`を基準仕様とする**。機能追加・変更の際は、まずここに記載が無いか確認する。
2. **既存コード(`app/runq.html`)を最大限利用する**。同等の処理が既にある場合は新規実装せず流用・拡張する。
3. **不要な全面リファクタリングをしない**。動いているコードを「きれいにする」目的だけでの大規模書き換えは行わない。
4. **V1の範囲外の機能を勝手に追加しない**。要件に無い機能を思いつきで実装しない(提案したい場合は、実装せずに候補として提示する)。
5. **モバイルファースト**。UIの変更・追加はスマートフォンでの利用を前提に確認する。
6. **既存データを破壊しない**。`plans/{id}` / `profile/main` / `logs/{id}` 等のデータ構造やlocalStorageキー(`paceplan.*`)を変更する場合は、既存データとの後方互換性(または移行処理)を必ず用意する。
7. **大きな変更の前には影響範囲を確認する**。特に`state.mode`の分岐、`Store`層、`generatePlan()`まわりは他の多くの機能から参照されているため、変更前に呼び出し元を洗い出す。
8. **数値計算は可能な限り決定論的ロジックで行う**。RACE FORECAST・PACE CALCULATOR・RACE TIME PREDICTOR・トレーニングプラン生成等の数値は、AIの生成結果に依存せず、アプリ側の純粋関数で計算する。
9. **AIは説明・提案を担当し、重要な数値計算をLLM任せにしない**。AI Coachの役割は対話・説明・プラン変更の提案までであり、数値そのものを生成させない。

## 作業の進め方

- 変更は小さく、動作確認をしながら進める(既存のPlaywright回帰テストの考え方を踏襲する。テストコード自体は`claude`プロジェクト側で管理されてきた経緯があるため、リポジトリ内に無い場合は新規に用意する)。
- `app/runq.html`はClaude Artifactへ公開する形式(`<!doctype>`等を持たない断片)のまま維持する。`npm run build`で`dist/index.html`にラップする処理(`scripts/build.js`)を書き換える場合以外、この断片形式自体を変える必要はない。
- 秘密情報(APIキー等)を絶対にコードへ直接埋め込まない。必要になった場合は環境変数化し、`.env.example`に変数名だけを追記する(値は書かない)。
- 大きな設計判断(データモデルの変更、AI Providerの切り替え実装等)を行った場合は、`docs/architecture.md`を更新する。

## AI Coach(Coach Service / LLM Provider)を触る場合のルール

詳細は[docs/architecture.md §4](./docs/architecture.md#4-ai-coach-の構成coach-service--llm-provider抽象化openai-api対応済み)を参照。

1. **UI側(`runAdjust`/`runLogFeedback`等)は必ず`CoachService.request(prompt, opts)`を呼ぶ**。`sampleFn`や`fetch('/api/coach', ...)`を個別の呼び出し箇所から直接叩かない。
2. **Provider選択ロジックは`selectCoachProvider()`の1箇所に集約する**。新しいProviderを追加する場合もここだけを変更すれば済む構造を維持する。
3. **APIキー(`OPENAI_API_KEY`等)は絶対にクライアント側コード(`app/runq.html`)・ブラウザ・Capacitorアプリに埋め込まない**。サーバー側(`api/coach.js`)の`process.env`からのみ読み込む。
4. **レスポンス形式(`{mode, summary, risk, options[].{label,summary,plan}}`)を勝手に変えない**。新しいProvider・モデルを追加する場合も、この既存形式に合わせて出力させること(独自形式を新設しない)。
5. **プラン変更はAIに直接適用させない**。AIは`options[].plan`としてJSON提案を返すだけで、実際にTraining Planへ適用するのは既存の`applyPlanChange()`(ユーザーが選択肢を選んだ後)。
6. **RACE FORECAST・PACE CALCULATOR・RACE TIME PREDICTOR・トレーニングプランの基礎数値・距離や日程等、決定論的に算出できる値をAIに計算させない**。これらは既存の純粋関数(`estimateRacePerformance()`等)に任せ、AIは説明・評価・質問応答・アドバイス・プラン変更提案のみを担当する。
7. **モデルのデフォルト値は1箇所(`api/coach.js`の`DEFAULT_MODEL`)でのみ管理する**。切り替えは環境変数`OPENAI_MODEL`で行い、V1では単一モデル運用(tier別モデルの作り込みはしない)。
8. **ユーザー入力をシステム指示として扱わない**。`api/coach.js`は`prompt`を常に`user`ロールのメッセージとして渡し、`SYSTEM_INSTRUCTION`(役割・出力形式の指示)を上書きできないようにしている。この分離を崩さない。
9. **画像OCR(`extractFromImage`)は現時点で`CoachService`の対象外**。引き続き`sampleFn`を直接使う(Claude Artifact限定)。将来OpenAIの画像入力へ移行する場合も、既存のOCR呼び出し箇所を壊さないよう別途検討すること。
