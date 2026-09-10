# runQ. アーキテクチャ

対象読者: Claude Code / Codex等、本リポジトリで作業する開発者・AIエージェント。まずこのドキュメントで現状を把握してから変更に着手してください。

## 1. 現在の構成の全体像

```
                ┌───────────────────────────────────────┐
                │        app/runq.html (単一ファイル)      │
                │  IIFE 1本 / state + render() でDOM再構築  │
                └───────────────┬─────────────────────────┘
                                │
                 window.claude.use('db')   window.claude.use('sample')
                 (Claude Artifact capability)  (Claude Artifact capability)
                                │                         │
                     ┌──────────┴─────────┐     AIコーチ応答(JSON構造化)
                     │  db が使える場合   │
                     │  (Claude Artifact  │
                     │   として開いた時)  │
                     └──────────┬─────────┘
                                │ 使えない場合は自動フォールバック
                     ┌──────────┴─────────┐
                     │   localStorage     │
                     │ (ブラウザ内、同期無し) │
                     └────────────────────┘
```

- フレームワーク・バンドラは使用していない。素のHTML/CSS/JavaScript。
- 状態管理は`state`オブジェクト1つ + `render()`による`#app`のinnerHTML全再構築(仮想DOM等は無し)。
- `app/runq.html`はClaude Artifactへ公開する形式(`<!doctype>`/`<html>`/`<head>`/`<body>`を持たない断片、`<title>`/`<link>`/`<style>`の後に`<div id="app">`と`<script>`が続く)のまま管理している。これはClaude Artifactへの既存の公開フローと1バイトも変えずに使い回すための意図的な選択。
- `npm run build`(`scripts/build.js`)は、この断片を標準的なHTMLドキュメントでラップして`dist/index.html`を生成するだけの処理(依存パッケージなし)。ローカル確認やVercel等への将来的な静的デプロイのためのもので、アプリのロジック自体には一切手を加えない。

## 2. データ保存(現状)

永続化層は`Store`オブジェクト(`app/runq.html`内)に集約されている。**各メソッドは「`db` capabilityが使えればそちらを使い、使えなければ`localStorage`にフォールバックする」という分岐を既に持っている**(今回のGitHub移行以前からの実装)。

```js
async savePlan(plan){
  if (db) { await db.collection('plans').doc(plan.id).set(plan); return; }
  // db が無い環境(Claude Artifact以外で開いた場合)は localStorage へ
  const list = JSON.parse(localStorage.getItem('paceplan.plans') || '[]');
  // ...
  localStorage.setItem('paceplan.plans', JSON.stringify(list));
}
```

- `db`が使える場合(=Claude Artifactとして開いている場合)のドキュメントパス:
  - `plans/{planId}` — Quest + Race + TrainingPlanが一体化したドキュメント
  - `progress/{planId}` — チェックボックスの完了状況
  - `logs/{planId}` — 練習記録(Workout Result)。日付キー
  - `forecast/{planId}` — RACE FORECASTの履歴(直近20件)
  - `coachLog/{planId}` — AIコーチの会話履歴(直近30件にローテーション。提案の完全なプランJSON・undo用スナップショットは容量対策で非永続化)
  - `profile/main` — Runner Profile(PB・シューズ・Training Settings等、全プラン共通)
- `db`が使えない場合(ローカル起動時・Vercel等の静的ホスティング時など)は、上記に対応する`localStorage`キー(`paceplan.plans`, `paceplan.progress.{id}`, `paceplan.logs.{id}`, `paceplan.forecast.{id}`, `paceplan.coachLog.{id}`, `paceplan.profile`)に読み書きする。ブラウザ・端末をまたいだ同期は行われない。

### 重要な制約

`sample` capability(AIコーチ)は、Claude Artifact以外の環境では利用できない(`sampleFn`が`null`になり、AIコーチ機能はUI上非表示になる。これは既存の作り)。したがって、**ローカル起動やVercel等へそのまま静的デプロイしただけでは、トレーニングプラン生成・記録・PACE CALCULATOR・RACE TIME PREDICTOR・RACE FORECAST等の数値計算機能は動作するが、AIコーチとの対話機能は動作しない**。AIコーチをClaude Artifact以外の環境でも使えるようにするには、後述の「AI Provider」節の対応が必要になる。

## 3. 主要データモデルの関係

```
Runner Profile (profile/main)
 ├─ pbs[]                 … 自己ベスト(種目別、複数)
 ├─ shoes[]                … シューズ(id, name, brand, startDate, active, note)
 ├─ weeklyRunDays / availableWeekdays
 ├─ longestRunManualKm          … 実績が無い場合の手動最長ロング走
 ├─ injuryNote / courseNote / constitutionNote / scheduleNote
 └─ 新規Quest作成時のプロフィール正本。既存のlongRunWeekday/courseNoteは
    互換目的で保持し、新規プランの曜日・レース固有コース情報には使用しない

Training Plan (plans/{planId})  … Quest + Race + TrainingPlan が1ドキュメントに一体化
 ├─ id, createdAt
 ├─ meta: { name, distanceLabel, distanceKm, raceDate, startDate,
 │          targetLabel, mpLabel, easyLabel, pbLabel, heelCaution,
 │          injuryNote, courseNote, constitutionNote, scheduleNote,
 │          linkedFromPlanId, peakLongRunKm, policy:[...] }
 ├─ weeks: [{ label, phase, dateRange, items:[{type, day, date, title, desc, flag, ...}] }]
 ├─ extras: { fueling:[...], cautions:[...] }
 └─ history: [{ ts, reason, summary }]        … プラン変更の履歴

Workout Result (logs/{planId}["{date}"])
 ├─ distanceKm, avgPace, avgHr, durationMin, calories
 ├─ fuelingNote, note, shoeId
 ├─ rpe (1〜4 or null)
 ├─ pain { level: 0〜3, parts: [部位名] } or null
 ├─ completionType ('as_planned' | 'partial' | 'skipped' or null)
 ├─ feedback, loggedAt
 └─ (将来のActivity Import拡張ポイント。4.1参照)

Race Forecast (forecast/{planId})
 └─ history: [{ predictedSec, predictedMinSec, predictedMaxSec,
               recommendedGoalSec, challengeGoalSec, safeGoalSec,
               mainFactors[], confidence, algorithmVersion, generatedAt }]
     (直近20件保持。estimateRacePerformance()が生成)

AI Coach / Plan Change Proposal (coachLog/{planId}、および実行時のstate)
 ├─ messages: [{ id, role:'user'|'coach', kind, text, ... }]
 │    kind: advice | options | confirmed | dismissed | error
 ├─ options提案の完全なplan本体・confirmed後のundo用スナップショットは
 │    容量対策のためstateのみ保持(非永続化)
 └─ Plan変更確定時は Training Plan (plans/{planId}) を更新し、history[]に追記
```

## 4. AI Coach の構成(Coach Service / LLM Provider抽象化。OpenAI API対応済み)

### 全体像

```
Application (UI / state)
   コーチタブ / 記録直後フィードバック / プラン変更提案
        │
        ▼
buildAdjustPrompt() / planContextLines()   … プロンプト組み立て(Quest・目標タイム・Training Plan・
        │                                     Runner Profile・PB・シューズ・直近Workout・RPE・pain・
        │                                     RACE FORECAST・直近コーチ会話 等を含む。変更なし)
        ▼
CoachService.request(prompt, opts)   … 呼び出し口はこの1関数のみ。UI側は下記どちらのProviderが
        │                              実際にAIを呼んでいるか意識しない(sampleFn.json(prompt, opts)と
        │                              同じ入出力シグネチャを維持)
        ▼
selectCoachProvider()   … Provider選択ロジックを1箇所に集約(app/runq.html内)
        │
        ├─ ClaudeArtifactProvider   … `window.claude.use('sample')` が使える場合はこちらを使う
        │                             (Claude Artifactとして開いている場合。既存動作を完全維持)
        │
        └─ OpenAIProvider          … 上記が使えない場合(ローカル起動・Vercel等)はこちら
                │                     ブラウザから直接OpenAIは呼ばない。必ずサーバー側 /api/coach を経由する
                ▼
           fetch('/api/coach', { prompt, modelTier })
                │
                ▼
           runQ Backend: api/coach.js (Vercel Serverless Function / ローカルはdev-server.jsが橋渡し)
                │  OPENAI_API_KEY はここだけで保持し、レスポンスにもクライアントにも含めない
                ▼
           OpenAI Responses API (https://api.openai.com/v1/responses)
                │  Structured Outputs (text.format: json_schema) で
                │  既存の { mode, summary, risk, options[].{label,summary,plan} } 形式を強制
                ▼
           api/coach.js が結果をそのままクライアントへ返す(新しい独自形式は作っていない)
```

- **Provider選択は`selectCoachProvider()`の1箇所のみ**(`app/runq.html`)。`ClaudeArtifactProvider.available()`(=`window.claude.use('sample')`が使えるか)を優先し、使えない場合のみ`OpenAIProvider`にフォールバックする。Claude Artifactとして開いている限り、この移行前と挙動は変わらない。
- **レスポンス形式は既存のまま**: `{mode:'advice'|'options', summary, risk, options[].{label,summary,plan}}`。新しい独自スキーマを作るのではなく、Claude Artifact版が既に返していた形式をOpenAI側にも合わせている。下流(`buildAdjustPrompt`の解釈・`applyPlanChange`等)は無変更で動く。
- **画像解析はCoachとは分離**: `extractFromImage`はClaude Artifactでは従来の`sampleFn`を使い、通常Web/Vercelでは`/api/run-extract`を使う。コーチ相談の`CoachService`に画像を混在させないため、既存のコーチ応答形式・プラン変更フローには影響しない。
- 数値計算(プラン生成・RACE FORECAST・PACE CALCULATOR・RACE TIME PREDICTOR等)は`estimateRacePerformance()`等の独立した純粋関数が担当し、AIは説明文・提案・対話のみを担当する設計を維持している(この原則はOpenAI移行後も変えていない)。
- プラン変更は「GPT/Claudeが`options[].plan`としてJSON提案 → UIが選択肢を提示 → ユーザーが選択 → 既存の`applyPlanChange()`がTraining Planへ適用」という流れを維持。AIが直接Training Planを書き換えることはない。

### 4.1 Coach Service / Provider(実装箇所)

`app/runq.html`内、`planContextLines()`の直前に配置。主要なオブジェクト:

- `ClaudeArtifactProvider` — `sampleFn.json(prompt, opts)`をそのままラップ。
- `OpenAIProvider` — `fetch('/api/coach', {method:'POST', body:{prompt, modelTier}})`。ネットワークエラー・非200・不正JSONをそれぞれ`{code:'coach_unreachable'|'rate_limited'|'invalid_json'|'cancelled'}`という例外に正規化し、呼び出し元(`runAdjust`/`runLogFeedback`)の既存のcatch節・`adjustErrorMessage(code)`にそのまま渡せるようにしている。
- `selectCoachProvider()` — 上記2つからどちらを使うか決定する唯一の箇所。
- `CoachService.request(prompt, opts)` — UI側の唯一の呼び出し口。

将来`ClaudeArtifactProvider`を削除する場合も、`selectCoachProvider()`の中身を変えるだけで済む構造にしている。

### 4.2 /api/coach (サーバー側)

`api/coach.js`(Vercel Serverless Function規約。フレームワーク・追加依存パッケージなし、Node18+のグローバル`fetch`のみ使用):

- リクエスト: `POST { prompt: string, modelTier?: string }`。`prompt`が空・非文字列・上限(60,000文字)超過の場合は400/413を返す。
- 環境変数: `OPENAI_API_KEY`(必須。未設定時は500 `coach_unavailable`)、`OPENAI_MODEL`(省略可。デフォルト値`api/coach.js`内の`DEFAULT_MODEL`定数の1箇所のみで管理)。
- OpenAI呼び出し: Responses API (`POST https://api.openai.com/v1/responses`)。`text.format`にJSON Schema(`RESPONSE_SCHEMA`、既存の`{mode,summary,risk,options[]}`形式)を指定し、Structured Outputsとして構造化された応答を要求(`strict:false`。`options[].plan`はトレーニングプラン全体を含む複雑な構造のため、既存のクライアント側`normalizeAdjustedPlan()`による正規化・検証を安全網としている)。
- OpenAI APIキーはレスポンスにもエラーメッセージにも一切含めない。OpenAI側のエラー詳細(内部メッセージ等)もクライアントへそのまま流さず、`{error:'coach_unavailable'|'rate_limited'|'invalid_request'|'prompt_too_large'|'invalid_json'|'method_not_allowed'}`という限られたコードのみ返す。
- ユーザー入力(`prompt`)はOpenAIへの`user`メッセージとして渡すのみで、システム指示(`SYSTEM_INSTRUCTION`)を上書きできないよう分離している。
- テスト容易性のため、`apiKey`/`model`/`fetchImpl`を第3引数`opts`で差し替え可能にしている(`module.exports.handler`等もexport)。

### 4.3 Capacitor化を見据えた設計

- APIキーはCapacitorアプリ内にも一切埋め込まない。アプリは常にHTTPS経由で`/api/coach`(または将来`RUNQ_API_BASE_URL`のような設定でホスト先を切り替え)を呼ぶ想定。
- `api/run-extract.js`はOpenAI Responses APIの画像入力を使い、Garmin等のスクリーンショットから構造化した走行実績を抽出する。画像はブラウザ側で最大辺2048px・JPEGに縮小した後、リクエスト中だけVercel/OpenAIへ渡す。runQ.のStorage・Vercel Blobには保存しない。
- 受け付ける形式はJPEG/PNG/WebP、解析用画像は3MB以下。Vercel Functionのリクエスト本文上限に余裕を持たせるためであり、超過時は端末側で再縮小してから送信する。
- 現在は認証機構を持たないV1のため、公開Vercel URLでのAPIコスト濫用を完全には防げない。本格公開前に認証と共有レート制限を導入するまで、Vercel Firewall等で公開範囲を制限する。
- 開発・本番でのAPI URL切り替え・CORS等は、現時点では過剰に作り込まず、必要になった段階で最小限の設定を追加する方針とする。

## 5. 将来の Activity Import(Garmin / Apple Health / Strava等)を見据えた設計

**今回のGitHub移行では、外部連携そのものは実装しない。** ただし、将来Garmin/Apple Health/Strava等からランニング実績を自動取得できるようにする可能性があるため、Workout Result(`logs/{planId}`の各エントリ)を「手入力されたデータしか保存できない構造」に強く依存させないことを設計上の方針とする。

現状のログの型:

```
{
  distanceKm, avgPace, avgHr, durationMin, calories,
  fuelingNote, note, shoeId,
  rpe, pain, completionType,
  source, imageImport, // source: 'manual' | 'screenshot'。画像本体は保持しない
  feedback, loggedAt
}
```

将来、外部Activityを取り込む場合に拡張可能な項目の例(今回は追加しない。設計メモとして残すのみ):

```
{
  source,              // 'manual' | 'garmin' | 'apple_health' | 'strava'
  externalActivityId,  // 外部サービス側のID(重複取り込み防止用)
  distance,
  duration,
  pace,
  heartRate,
  date,
  activityType
}
```

これらは`logs/{planId}`のエントリに後方互換な形で追加していく想定で、既存の手入力フィールド(`distanceKm`, `avgPace`等)を置き換えるものではない。実際に連携を実装する段階になったら、このドキュメントを更新した上で着手すること。

## 6. 秘密情報・環境変数

`app/runq.html`(クライアント側)にAPIキー等の秘密情報はハードコードされていない(確認済み)。`OPENAI_API_KEY`は`api/coach.js`および`api/run-extract.js`のサーバー側からのみ`process.env`として読み込まれ、クライアントへ返さない。外部ネットワーク呼び出しはGoogle Fontsの読み込みと、サーバー側からの`https://api.openai.com/v1/responses`呼び出しのみ。`.env.example`および README の「環境変数」を参照。

## 7. デプロイ

- **現状**: Claude Artifactとして公開(`app/runq.html`の内容をArtifactツールで公開)。ユーザーが実際に使っているのはこちら。この経路では`ClaudeArtifactProvider`が使われ、`OPENAI_API_KEY`等は一切関与しない。
- **今回のGitHub移行後**: `app/runq.html`をGitHub上の正本として管理し、Claude Artifactへの公開は引き続きこのファイルの内容をそのまま使う運用とする。
- **Vercel等への静的+サーバーレスデプロイ**: `npm run build`で生成される`dist/index.html`と`api/coach.js`/`api/run-extract.js`を組み合わせてデプロイできる。`OPENAI_API_KEY`を設定すればAI Coachとスクリーンショット解析の両方を利用できる。
- **ローカル開発**: `npm run dev`で起動する`scripts/dev-server.js`が`/api/coach`と`/api/run-extract`を橋渡しする。ルート直下に`.env`を置けば`OPENAI_API_KEY`/`OPENAI_MODEL`を自動で読み込む。
