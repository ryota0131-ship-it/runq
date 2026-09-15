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
  - `progress/{planId}` — 旧版の手動チェック状態（後方互換のため保持するが、現在の表示・集計・コーチ判断の根拠にはしない）
  - `logs/{planId}` — 練習記録(Workout Result)。日付キー
  - `forecast/{planId}` — RACE FORECASTの履歴(直近20件)
  - `coachLog/user-{workoutUserId}` — ユーザー専属コーチのメイン会話。`activePlanId`で会話を分けない。旧`coachLog/{planId}`は初回読込時に時系列で統合し、元ログは削除しない。提案の完全なプランJSON・undo用スナップショットは容量対策で非永続化
  - `profile/main` — Runner Profile(PB・シューズ・Training Settings等、全プラン共通)
  - `workouts/main` — 取り込み元を問わない共通Workoutの配列(予定日別ログを置換しない正本)
- `db`が使えない場合(ローカル起動時・Vercel等の静的ホスティング時など)は、上記に対応する`localStorage`キー(`paceplan.plans`, `paceplan.progress.{id}`, `paceplan.logs.{id}`, `paceplan.forecast.{id}`, `paceplan.coachLog.user-{workoutUserId}`, `paceplan.profile`, `paceplan.workouts`)に読み書きする。ブラウザ・端末をまたいだ同期は行われない。

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
 ├─ feedback, feedbackBasis { version, reasons[], sourceIds[] }, loggedAt
 └─ 既存の予定日別表示・入力との後方互換のため保持する

Common Workout (workouts/main.entries[])
 ├─ id, user_id, started_at, ended_at, duration_seconds, distance_meters
 ├─ average_pace_seconds_per_km, average_heart_rate, max_heart_rate, calories
 ├─ source: manual | screenshot | apple_health | health_connect | strava | garmin
 ├─ source_workout_id, source_device, imported_at, created_at, updated_at
 ├─ plan_id, scheduled_item_ref, scheduled_item_date, completion_status
 ├─ source_refs[]        … 統合した取得元と外部Workout IDを保持
 ├─ time_precision       … exact | estimated。手入力で時刻が無いことを区別する
 ├─ duplicate_candidate_ids[]
 └─ metadata { note, rpe, pain, feedback, image_import }
    … 取り込み元横断の正規化・重複防止・将来の同期用として保存する。

Race Forecast (forecast/{planId})
 └─ history: [{ predictedSec, predictedMinSec, predictedMaxSec,
               recommendedGoalSec, challengeGoalSec, safeGoalSec,
               mainFactors[], confidence, algorithmVersion, generatedAt }]
     (直近20件保持。estimateRacePerformance()が生成)

AI Coach / Plan Change Proposal (coachLog/user-{workoutUserId}、および実行時のstate)
 ├─ messages: [{ id, role:'user'|'coach'|'system', kind, text, basis?, contextPlanId?, ... }]
 │    kind: advice | options | confirmed | dismissed | error | system
 ├─ migratedPlanIds[] … 旧プラン別会話を一度だけ統合した対象。元ログは保持する
 ├─ options提案の完全なplan本体・confirmed後のundo用スナップショットは
 │    容量対策のためstateのみ保持(非永続化)
└─ Plan変更確定時は Training Plan (plans/{planId}) を更新し、history[]に追記
```

### 完了状態の正本

予定メニューの完了は、手動チェックではなく、`logs/{planId}[date]` またはその予定日に紐づいた `workouts/main` の実走から導く。`completionType:'as_planned'`（または旧データで種別未設定）の実績は「✓ 完了」、`partial` は「一部実施」、`skipped` は「見送り」として表示する。週・全体進捗、Race Forecast、プラン見直し、コーチの実施率も同じ基準を使う。

## 3.1 コーチ知識・安全レイヤー

コーチの知識は `data/coach-knowledge.json` に要約とメタデータだけを保持する。各出典にはタイトル、発行元、年、URL、対象者、要約、利用場面、根拠の強さ、確認日、バージョンを含め、著作物の全文は保存しない。追加・更新はこのJSONを編集して行える。

`api/coach.js` は次の三層を分離する。

1. `SAFETY_RULES` — システム指示より優先する固定ルール。胸痛・強い息苦しさ・めまい・失神を含む**今回の発言**は、LLMを呼ばず固定の安全案内を返す。会話履歴やプラン本文は安全検出の対象にしない。
2. `COACHING_RULES`（`app/runq.html`） — 実走、頻度、最長距離、RPE、痛み、予定実施、制約、目標を合わせて扱う構造化方針。単一の増加率を絶対条件にしない。
3. `data/coach-knowledge.json` — 公的ガイドライン・系統的レビューの要約参照。実行時に外部検索へ依存せず、取得失敗時も安全ルールは有効。

回答の本文は短いコーチ会話のままにし、`basis` に保存した判断理由と参照IDは利用者が「なぜ？」を開いたときだけ表示する。RUNQ内のプロフィール、目標、プラン、今後予定、共通Workout、予定日別ログ、RPE・痛み・メモを、`coachRunningContextLines()` を通じて最優先で参照する。

緊急症状はユーザーメッセージの `safetyEvent` として、症状ID・検出時刻・`active`/`resolved` 状態を会話ログに保存する。症状名を伴わない「治った」「大丈夫」は確認質問に留め、踵など別部位の改善では胸痛等の状態を解除しない。過去の緊急会話は通常のLLM会話履歴へ再注入しないため、無関係な発言に固定の緊急文面を繰り返さない。

## 4. AI Coach の構成(Coach Service / LLM Provider抽象化。OpenAI API対応済み)

### 全体像

```
Application (UI / state)
   コーチタブ / 記録直後フィードバック / プラン変更提案
        │
        ▼
buildAdjustPrompt() / planContextLines()   … プロンプト組み立て(Quest・目標タイム・Training Plan・
        │                                     Runner Profile・PB・シューズ・共通Workout・予定日別ログ・
        │                                     RPE・pain・RACE FORECAST・直近コーチ会話 等を含む)
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
           Web: fetch('/api/coach', { prompt, modelTier })
           Capacitor: fetch('https://runq-umber.vercel.app/api/coach', { prompt, modelTier })
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
- **コーチの人格は保存・表示層で分離**: `profile/main.coachPersona`に`companion`（ナギ コーチ）/ `analyst`（リツ コーチ）/ `cheer`（カイ コーチ）を保存する。`buildAdjustPrompt()`はリクエスト開始時に固定した人格の口調指示だけを加え、判断ルール・コンテキスト・JSON形式は共通に保つ。チャット履歴とWorkoutの`metadata.feedback_coach_persona`には生成時のコーチを保存するため、後でコーチを変更しても過去の表示は書き換わらない。
- `app/assets/coach/`には、提供された確定デザインから背景だけを透明化したコーチの静止PNG（通常・考え中・喜び）を置く。白いお腹や顔の白は透明化しない。画像は`aria-hidden`の装飾として扱い、テキストの状態表示を必ず併記する。
- **実走・予定の共通コンテキスト**: `loadRunningPlanLogs()`と`runningEvidence()`が、重複統合済みの`workouts/main.entries[]`を正本として、直近90日の実走（距離・時間・ペース・心拍・RPE・痛み・メモ・取得元・予定との紐付け）、当日の予定、今後7日間の予定を要約して渡す。90日より前の実走は全体集計に留める。旧来の`logs/{planId}`は、`workoutId`または予定日で共通Workoutに紐付いていない記録だけを補完情報として渡すため、同じ走行を二重に判断しない。コーチ呼び出しの直前に全プランの予定日別ログを読み直し、画面を開いたまま記録・同期した内容も会話へ反映する。
- **全プランの要約**: `allPlansCoachContext()`が、登録済みの各プランについてID、名称、種別、状態、主目標かどうか、大会日、開始日、距離、目標タイム、想定ペース、進捗、次回練習、大会までの日数、前後の大会を構造化して毎回渡す。詳細JSONは主目標だけに絞り、今回の発言に大会・プラン名が明示された場合だけ`namedPlanDetailsForCoach()`が該当する非アクティブプランの詳細を追加する。これにより、コーチは通常は主目標を優先しつつ、名称を指定された非アクティブプランや複数大会の関係も回答できる。対象が曖昧な変更は確認し、非アクティブプランを自動変更しない。
- **Race Forecastも同じ実走を使用**: `recomputeAndSaveForecast()`は`runningEvidence()`を使い、Health同期・画像・手動登録を含む直近4週の合計、実走日数、最長実走、MP走を共通の根拠として算出する。PBなどから見る走力の目安と、ロング走・週間走行量・痛みから見るフルへの準備度を別フィールドで保存する。痛みは走力タイムの自動減点には使わず、負荷調整の注意として扱う。データ量に応じて表示を丸め、少ない場合は秒単位や好調時／安全目安を表示しない。
- **レスポンス形式は既存のまま**: `{mode:'advice'|'options', summary, risk, options[].{label,summary,plan}}`。新しい独自スキーマを作るのではなく、Claude Artifact版が既に返していた形式をOpenAI側にも合わせている。下流(`buildAdjustPrompt`の解釈・`applyPlanChange`等)は無変更で動く。
- **画像解析はCoachとは分離**: `extractFromImage`はClaude Artifactでは従来の`sampleFn`を使い、通常Web/Vercelでは`/api/run-extract`を使う。コーチ相談の`CoachService`に画像を混在させないため、既存のコーチ応答形式・プラン変更フローには影響しない。
- 数値計算(プラン生成・RACE FORECAST・PACE CALCULATOR・RACE TIME PREDICTOR等)は`estimateRacePerformance()`等の独立した純粋関数が担当し、AIは説明文・提案・対話のみを担当する設計を維持している(この原則はOpenAI移行後も変えていない)。
- プラン変更は「GPT/Claudeが`options[].plan`としてJSON提案 → UIが選択肢を提示 → ユーザーが選択 → 既存の`applyPlanChange()`がTraining Planへ適用」という流れを維持。AIが直接Training Planを書き換えることはない。

### 4.1 Coach Service / Provider(実装箇所)

`app/runq.html`内、`planContextLines()`の直前に配置。主要なオブジェクト:

- `ClaudeArtifactProvider` — `sampleFn.json(prompt, opts)`をそのままラップ。
- `OpenAIProvider` — Web/Vercelでは`fetch('/api/coach', {method:'POST', body:{prompt, modelTier}})`、Capacitorでは`RUNQ_NATIVE_API_ORIGIN`（現在のVercel本番URL）を先頭に付けたHTTPS URLを呼ぶ。Vercel FunctionsはCapacitor WebViewからのJSON POST/OPTIONSにCORS応答する。ネットワークエラー・非200・不正JSONをそれぞれ`{code:'coach_unreachable'|'rate_limited'|'invalid_json'|'cancelled'}`という例外に正規化し、呼び出し元(`runAdjust`/`runLogFeedback`)の既存のcatch節・`adjustErrorMessage(code)`にそのまま渡せるようにしている。
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

- APIキーはCapacitorアプリ内にも一切埋め込まない。Web/Vercelは同一オリジンの`/api/coach`を、CapacitorアプリはHTTPSの`RUNQ_NATIVE_API_ORIGIN`を経由してVercel Functionを呼ぶ。公開URLは秘密情報ではないが、Vercelの本番ドメインを変更する際はこの定数も更新する。
- `api/run-extract.js`はOpenAI Responses APIの画像入力を使い、Garmin等のスクリーンショットから構造化した走行実績を抽出する。画像はブラウザ側で最大辺2048px・JPEGに縮小した後、リクエスト中だけVercel/OpenAIへ渡す。runQ.のStorage・Vercel Blobには保存しない。
- 受け付ける形式はJPEG/PNG/WebP、解析用画像は3MB以下。Vercel Functionのリクエスト本文上限に余裕を持たせるためであり、超過時は端末側で再縮小してから送信する。
- 現在は認証機構を持たないV1のため、公開Vercel URLでのAPIコスト濫用を完全には防げない。本格公開前に認証と共有レート制限を導入するまで、Vercel Firewall等で公開範囲を制限する。
- 開発・本番でのAPI URL切り替え・CORS等は、現時点では過剰に作り込まず、必要になった段階で最小限の設定を追加する方針とする。

## 5. 初回導線・ネイティブ・Activity Import

### 5.1 初回導線・QUESTの保存方針

初回表示の進行状態は新しい保存先を増やさず、既存の`profile/main`（Webでは`paceplan.profile`）の`onboarding`へ後方互換で保持する。

- `onboarding.version`、`walkthroughCompleted`、`profileCompleted`、`draft`を保存する。既存プロフィールを読む際は既定値を補うため、既存データを壊さない。
- ウォークスルーの再表示はマイページから可能で、再表示時にプロフィールやプランを変更しない。
- レースなしのQUESTは従来の`plans/{id}`と同じ形を使い、`meta.questType`を`first_5k`、`first_10k`、`habit`、`fitness_weight`として保存する。新規プランは目的を`meta.plan_goal_type`（`race` / `beginner` / `fitness_weight`）にも保存し、既存のレース形式プランは`questType`未設定でも`race`として後方互換で扱う。
- レースなしプランは`generateBeginnerPlan()`で決定論的に生成する。開始日以前のメニューは作らず、週表示は月曜から日曜までとする。AI CoachやRace Forecastに基礎数値の生成を委ねない。
- 旧デモプランは`id: aqualine-2026`かつ`meta.source: seed`に一致するものだけを起動時に削除する。ユーザー作成のプランや練習記録を一括削除しない。

### 5.2 ネイティブ起動画面

iOSは`LaunchScreen.storyboard`でRUNQ.名とタグラインを表示する。起動画面はOSが表示する静的な画面であり、HealthKitや保存済みプロフィールにはアクセスしない。起動後の初回判定・ウォークスルーはWebView側で共通に処理するため、iOS/Android/Webでデータの扱いは共通である。

### 5.3 Activity Import(HealthKit / Health Connect / Garmin / Strava)の基盤

共通Workoutを`workouts/main.entries[]`に追加した。手動登録・スクリーンショット登録は従来どおり予定日別の`logs/{planId}`へ保存したうえで、同じ実績を共通Workoutにも正規化して保存する。既存画面・既存データを壊さないため、`logs`を置き換えない。

- `normalizeWorkout(raw)`が各入力形式を共通フィールドへ変換する唯一の入口。
- `upsertWorkout(raw)`は同一`source`かつ`source_workout_id`（統合後は`source_refs[]`を含む）を最優先してupsertする。保存前のread-modify-writeはアプリ内キューで直列化し、手動同期・自動同期・連打が競合しても同じ外部記録を増やさない。
- 取得元が異なる場合は、両方に正確な開始時刻があり、実行時間帯の80%以上が重なり、距離（3%または250m以内）と所要時間（4%または3分以内）が一致する場合だけ自動統合する。時刻不明の手入力・画像記録、または時間帯が重ならない同日2回のランは自動統合しない。距離・所要時間が近い場合は`duplicate_candidate_ids[]`に候補として保存し、詳細画面で根拠を確認してから統合できる。
- 利用者が候補を統合したときは、取得元参照、メモ、画像由来情報、フィードバック、予定への紐付けを残す。既存記録は起動時に候補だけを付与し、自動削除・表示だけの非表示は行わない。
- `matchWorkoutToPlan(workout)`が同日予定を単純に探し、`plan_id`・`scheduled_item_ref`・`completion_status:'matched'`を保存する。高度なAI判定は行わない。
- 認証未導入のため`user_id`はプロフィール内の端末ローカルID(`workoutUserId`)を使う。将来認証を導入する際は、既存の共通Workoutを保持したままAuthのIDへ移行する。
- マイページの「データ連携」でAppleヘルスケア／Health Connectの連携状態、最終同期日時、自動登録設定を管理する。
- マイページの振り返り表示・月別履歴・ワークアウト詳細は、追加の保存先を作らず`workouts/main.entries[]`を読み取り専用で集計する。予定との関係は、共通Workoutの`plan_id`と`scheduled_item_date`から既存プランのメニューを参照する。距離差は予定説明文に明示された距離がある場合だけ表示し、推測で評価しない。
- `nativeHealthPlugin()` → `syncHealthWorkouts()`がCapacitorのHealthプラグインを呼び、Running Workoutのみを過去90日分ページング取得する。iOSではHealthKit、AndroidではHealth Connectを同じAdapterで扱う。
- 初回連携・手動同期では、ワークアウト・心拍・距離・消費カロリーの読み取り権限を要求する。心拍は各Workoutの時間範囲でサンプルを読み、平均・最大を決定論的に算出する。GPSルート・ケイデンス・標高・心拍ゾーンは未取得。
- 自動登録ON時、同日の予定メニューに一致したWorkoutだけを既存の予定日別ログと完了状態にも反映する。ユーザーが手動／スクショで保存済みのログは端末連携で上書きしない。予定の完了チェックだけではCommon Workoutを作らず、実際のWorkoutへの紐付けだけを行う。
- 記録入力では画像解析は入力欄への反映まで、Health同期はCommon Workoutへの保存までを担う。同期済みWorkoutを選んで保存すると、既存Workoutへメモ・RPE・痛みを追記し、新しい走行記録は作らない。記録後のAIフィードバックは`metadata.feedback`にも保存する。
- Web/VercelではネイティブAPIを呼べないため、連携操作は説明メッセージを表示して他の機能を継続できる。

各ネイティブ／外部ソースは、OS固有の値を画面へ渡さず、次の形で追加する。

```
HealthKit / Health Connect / Strava / Garmin
  -> source adapter
  -> normalizeWorkout(raw)
  -> upsertWorkout(raw)
  -> workouts/main
```

## 6. Race Catalog（大会候補）

大会候補は`data/race-catalog.json`を正本とするRUNQ独自マスタであり、RUNNET等の大会一覧を取得・保存する処理は実装しない。`app/race-catalog.generated.js`は同JSONから生成するブラウザ向けコピーで、`npm run build`時に`dist/`へコピーする。`app/runq.html`はこのローカルデータだけを検索するため、Web・Capacitor・ローカルファイル表示で同じ候補を扱える。

- `series[]`は名称、よみ、別名、開催地、主な距離、公式サイト、状態を持つ年をまたぐ大会シリーズ。`editions[]`は`race_series_id`、年、公式発表済みの開催日、募集期間、確認状態、出典URLを持つ年度情報である。日程が未発表なら`held_on:null`のままとし、前年から推測しない。
- `LocalRaceCatalogProvider`が現在の検索元。将来の正式連携は同じ検索結果形を返す`ExternalRaceCatalogProvider`として追加し、既存プランは`meta.raceCatalog`の`race_series_id` / `race_edition_id`で参照を維持する。
- `scripts/import-race-catalog.js --file <csv> --dry-run`で検証だけを行い、`--dry-run`なしではseries/editionをupsertしてブラウザ用コピーも更新する。CSVテンプレートは`data/race-catalog-template.csv`。正規化した名称・開催地・距離・公式URLでシリーズ重複を検出し、年・日付は年度情報として別管理する。
- 手入力大会は`profile/main.raceCatalogSubmissions[]`（Webでは`paceplan.profile`）へ`user_submitted`として本人の端末／アカウント範囲だけに保存する。共通候補に自動昇格せず、将来の運営確認で`master_verified`、不適切・重複なら`rejected`、終了なら`archived`にできる。
- 「まずは5km」など大会を伴わないQUESTは既存の`meta.questType`を使い、大会カタログには入れない。

## 6.1 Share Cards（共有カード）

共有カードは`workouts/main.entries[]`の共通Workout、紐付く予定、プラン、保存済みフィードバックからクライアント側で再現する。PNG・選択写真はDBやStorageへ保存しない。

- `PHOTO` / `COACH` / `ROAD TO RACE` の3テンプレートをCanvasで1080×1920（9:16）へ描画する。写真が無い、または読み込めない場合もRUNQ配色のカードを生成する。GPSルートは共通Workoutに未保存のため初期版では描画しない。
- 完了画面は軽量なHTML/CSSプレビューだけを表示し、高解像度Canvasは共有画面を開いた後に生成する。過去のWorkout詳細からも同じ元データを使って再共有できる。
- WebではWeb Share APIの`File`共有を優先し、未対応環境は一時Blobのダウンロードへフォールバックする。ネイティブでは`@capacitor/filesystem`のCacheへ一時PNGを書き、`@capacitor/share`へ渡す。共有先が遅延してファイルを読む場合に備えて共有呼び出し直後には削除せず、次回共有時に直前の一時ファイルを削除する。永続データには保存しない。
- 右下のロゴはホーム共通ヘッダーと同じ`RUNQ_LOGO_SRC`をCanvasに描画する。共有用途の短文は既存フィードバックを最大58文字に整形するだけで、共有のための追加AI呼び出しは行わない。

## 7. 秘密情報・環境変数

`app/runq.html`(クライアント側)にAPIキー等の秘密情報はハードコードされていない(確認済み)。`OPENAI_API_KEY`は`api/coach.js`および`api/run-extract.js`のサーバー側からのみ`process.env`として読み込まれ、クライアントへ返さない。外部ネットワーク呼び出しはGoogle Fontsの読み込みと、サーバー側からの`https://api.openai.com/v1/responses`呼び出しのみ。`.env.example`および README の「環境変数」を参照。

## 8. デプロイ

- **現状**: Claude Artifactとして公開(`app/runq.html`の内容をArtifactツールで公開)。ユーザーが実際に使っているのはこちら。この経路では`ClaudeArtifactProvider`が使われ、`OPENAI_API_KEY`等は一切関与しない。
- **今回のGitHub移行後**: `app/runq.html`をGitHub上の正本として管理し、Claude Artifactへの公開は引き続きこのファイルの内容をそのまま使う運用とする。
- **Vercel等への静的+サーバーレスデプロイ**: `npm run build`で生成される`dist/index.html`と`api/coach.js`/`api/run-extract.js`を組み合わせてデプロイできる。`OPENAI_API_KEY`を設定すればAI Coachとスクリーンショット解析の両方を利用できる。
- **ローカル開発**: `npm run dev`で起動する`scripts/dev-server.js`が`/api/coach`と`/api/run-extract`を橋渡しする。ルート直下に`.env`を置けば`OPENAI_API_KEY`/`OPENAI_MODEL`を自動で読み込む。
