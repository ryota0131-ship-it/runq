# runQ.

大会を選ぶ。
目標を決める。
あとはrunQ.と走る。

## runQ.とは何か

runQ.(ランクエ / "Run your quest.")は、ランニング初心者〜継続中のランナーが、マラソン等の大会に向けたトレーニングを継続できるよう支援するアプリです。大会・目標タイムを登録すると期分け(復帰期→ベース構築期→ピーク期→テーパー期)されたトレーニングプランを自動生成し、日々の練習記録・AIコーチとの相談・レースタイム予測などを通じて、大会本番まで伴走します。

現在はプロトタイプ段階を終え、実際に開発者本人が日常的に利用するV1として運用中です。本リポジトリは、そのV1のソースコードをGitHub上で継続開発していくためのものです。

## 現在のV1の目的

- 自分自身が実際の大会準備で使い続けられる、実用に足るトレーニング管理アプリにすること
- 今後、Claude Code / Codex / GitHub / Vercel等へのデプロイ / AI Coach API / データベース / 認証 / Garmin・Apple Health・Strava等の外部連携、といった発展に耐える形でコードをGitHub上の正本(Single Source of Truth)として管理すること
- ただし本リポジトリへの移行それ自体では、上記の外部連携や認証・課金・大規模DB移行などは実装しない(既存の機能・デザイン・データ構造を壊さずそのまま移行することを最優先とする)

## 技術構成

- **フレームワークなし**: 素のHTML / CSS / JavaScript(単一ファイル、IIFE1本)。React/Vue等のUIフレームワークやビルドツール(webpack/vite等)は使用していません。
- **言語**: JavaScript(TypeScriptではありません)。
- **状態管理**: シンプルな`state`オブジェクト + `render()`によるDOM全再構築(仮想DOM等は無し)。
- **データ保存**: 現在はClaude Artifactの`db` capability(`window.claude.use('db')`)。`db`が使えない環境(= Claude Artifact以外の場所で開いた場合)では`localStorage`へ自動フォールバックする作りに既になっています。
- **AI Coach / 画像解析**: CoachはClaude Artifactの`sample` capabilityまたはサーバー側`/api/coach`を使います。スクリーンショット解析はClaude Artifactでは`sample`、通常Web/Vercelではサーバー側`/api/run-extract`からOpenAI画像入力を使います。OpenAI APIキーはサーバー側だけで保持し、ブラウザ・Capacitorアプリには一切埋め込みません。
- **外部依存**: Google Fonts(`fonts.googleapis.com`)の読み込みのみ。それ以外の外部CDN・APIへの依存はありません。

このため、現状は「ビルド」と呼べる工程はほぼ無く、`app/runq.html`という1ファイルがアプリの実体そのものです。詳しくは[docs/architecture.md](./docs/architecture.md)を参照してください。

## ローカル起動方法

依存パッケージのインストールは不要です(Node標準機能のみで動作します)。

```bash
npm run dev
```

`http://localhost:3000` でアプリが開きます(内部では `npm run build` → `dist/index.html` の生成 → 簡易static server起動、の順で実行されます)。

> 注意: ローカルやVercel等、Claude Artifact以外の環境で開いた場合、`db` capabilityは存在しないため、データ保存は`localStorage`(ブラウザごとのローカル保存。同期はされません)になります。これは既存の作り(capabilityが無い場合のフォールバック処理)によるもので、今回のGitHub移行にあたって新たに追加したものではありません。AI Coachは`OPENAI_API_KEY`を設定すれば`OpenAIProvider`経由で引き続き利用できます(未設定の場合はAI Coachのみ利用不可になりますが、Plan/Workout/Forecast/Shoes等の他機能は通常通り使えます)。

## 環境変数

AI Coach(`OpenAIProvider`)をローカルで試す場合は、リポジトリ直下に`.env`を作成し、以下を設定してください(`.env.example`をコピーして使うと簡単です)。

```bash
cp .env.example .env
# .env を編集して OPENAI_API_KEY= の後ろに実際のキーを入力
```

- `OPENAI_API_KEY` — OpenAI APIキー。サーバー側(`api/coach.js`/`api/run-extract.js`)だけで読み込まれ、クライアントには一切渡りません。未設定でもアプリ自体は起動し、AI Coachと画像解析のみ利用できません。
- `OPENAI_MODEL` — 使用するモデル名(省略可。未設定時は`api/coach.js`内の`DEFAULT_MODEL`にフォールバック)。

`.env`はコミットしないでください(`.gitignore`済み)。値を書かない変数を先回りして`.env.example`に大量に追加しないでください(詳細は`.env.example`のコメントを参照)。

## ビルド方法

```bash
npm run build
```

`app/runq.html`(Claude Artifactへ公開する形式そのままの断片)を、標準的なHTMLドキュメント(`<!doctype>`/`<html>`/`<head>`/`<body>`)でラップして`dist/index.html`を生成するだけの処理です(`scripts/build.js`、依存パッケージなし)。アプリのロジック・スタイル・マークアップ自体は一切変更しません。

## テスト

```bash
npm test        # api/coach.js の単体テスト(依存パッケージ不要。モックしたfetchでOpenAI呼び出しを検証)
npm run build && npm run test:e2e   # ブラウザ(Playwright)でのE2Eテスト。要 npm install
```

- `npm test` はNode標準機能のみで動作し、`api/coach.js`が正常系・エラー系(レート制限・ネットワークエラー・不正なJSON・APIキー未設定等)を正しく処理するかを検証します。
- `npm run test:e2e` は実際のOpenAI APIを呼ばず、ブラウザから`/api/coach`へのリクエストをモックすることで、コーチタブの表示・相談(advice)・プラン変更提案(options)・承認後のプラン反映・APIエラー時の挙動・Claude Artifact版(既存の`sample` capability経路)が壊れていないこと、を実ブラウザ上で確認します。Playwright(devDependencies)のインストールが必要です(`npm install`)。アプリ本体の起動・利用には一切不要です。

## ディレクトリ構成

```
runq/
├─ app/
│  └─ runq.html        # アプリ本体(Claude Artifact公開用の断片形式のまま管理。ここが正本)
├─ api/
│  └─ coach.js          # AI Coach用サーバーエンドポイント(Vercel Serverless Function。OpenAI API呼び出し)
│  └─ run-extract.js    # スクリーンショット解析用エンドポイント(画像は保存しない)
├─ scripts/
│  ├─ build.js          # app/runq.html → dist/index.html への変換(依存なし)
│  └─ dev-server.js     # dist/ を配信する最小static server + /api/coach への橋渡し(依存なし)
├─ test/
│  ├─ coach.api.test.js # api/coach.js の単体テスト(依存なし。`npm test`)
│  └─ e2e/run.js         # ブラウザ(Playwright)でのE2Eテスト(`npm run test:e2e`。要npm install)
├─ docs/
│  ├─ requirements.md   # V1要件定義(基準仕様)
│  └─ architecture.md   # 現行アーキテクチャ・データモデル・将来方針
├─ AGENTS.md            # AI開発エージェント(Claude Code / Codex 共通)向けルール
├─ CLAUDE.md            # → AGENTS.mdを参照する薄いポインタ
├─ package.json
├─ .env.example
├─ .gitignore
└─ README.md
```

## 開発時の基本ルール

詳細は[AGENTS.md](./AGENTS.md)を参照してください。要点のみ:

- [docs/requirements.md](./docs/requirements.md)を基準仕様とする
- 既存コード(`app/runq.html`)を最大限利用し、理由のない全面リファクタリングはしない
- V1の範囲外の機能を勝手に追加しない
- モバイルファースト
- 既存データ(QUEST・プロフィール・PB・シューズ等)を破壊しない
- 大きな変更の前には影響範囲を確認する
- 数値計算(RACE FORECAST・PACE CALCULATOR・RACE TIME PREDICTOR等)は決定論的なロジックで行い、AIには説明・提案のみを担当させる

## Git運用

- `main`: 安定して動作するバージョン
- 機能開発は `feature/xxx` ブランチで行う
- 個人開発規模のため、複雑なGit FlowやCI/CDは導入していません

## 現在の公開先(Claude Artifact)

現時点でユーザーが実際に使っているrunQ.は、引き続きClaude Artifactとして公開されています。

- https://claude.ai/code/artifact/24944fd0-ce2e-4080-a01d-9010510a4d78

今回のGitHub移行は「コードの正本をGitHubに置く」ことが目的であり、既存の公開先・既存データはこの移行によって変更・削除されません。今後この公開先を更新する場合は、`app/runq.html`の内容をそのままClaude Artifactとして再公開する運用になります(将来的にVercel等への本番デプロイへ切り替える場合は、その時点で改めて方針を決定します)。
