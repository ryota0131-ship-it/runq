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
 ├─ weeklyRunDays / availableWeekdays / longRunWeekday
 ├─ injuryNote / courseNote / constitutionNote / scheduleNote
 └─ (New Questの曜日初期値として参照される)

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

## 4. AI Coach の現在の構成と将来方針

### 現在

```
UI(コーチタブ / 記録直後フィードバック)
        │
        ▼
buildAdjustPrompt() / planContextLines()   … プロンプト組み立て(PB・シューズ・FORECAST・直近ログ要約等を含む)
        │
        ▼
window.claude.use('sample')  … Claude Artifact capability
        │
        ▼
sampleFn.json(prompt, opts)  … JSON構造化応答(advice or options)を取得
```

- `sample` capability自体がAnthropicのモデルに紐づく前提のため、現状はモデル・プロバイダの切り替えは考慮していない。
- 数値計算(プラン生成・RACE FORECAST等)は`estimateRacePerformance()`等の独立した純粋関数が担当し、AIは説明文・提案・対話のみを担当する設計を既に徹底している(重要な数値をAIの生成任せにしない、という原則は今後も維持する)。

### 将来方針(今回は実装しない。段階的対応のための設計メモ)

AI Coachを将来的にOpenAI/Anthropic等、複数のLLMプロバイダから選択・比較できるようにしたい場合の理想構造:

```
Application (UI / state)
        │
        ▼
Coach Service          … buildAdjustPrompt()相当のプロンプト組み立て + レスポンス解釈(advice/options判定)は
        │                 現状のロジックをほぼそのまま抽象化の内側に据え置ける
        ▼
LLM Provider (interface)
        ├─ ClaudeArtifactProvider  … 現状の `window.claude.use('sample')` をそのままラップ
        ├─ AnthropicProvider       … Anthropic APIを直接呼ぶ場合(要 ANTHROPIC_API_KEY)
        └─ OpenAIProvider          … OpenAI APIを直接呼ぶ場合(要 OPENAI_API_KEY)
```

- 現在の実装を無理に全面変更する必要はない。まずは`sampleFn.json(prompt, opts)`相当のシグネチャ(プロンプト文字列 → JSON構造化応答)を持つ関数として`Coach Service`の呼び出し口を明示的に切り出し、その内部実装を`ClaudeArtifactProvider`とすることから始めると、既存コードへの影響を最小化しつつ将来の切り替えに備えられる。
- 環境変数(`OPENAI_API_KEY` / `ANTHROPIC_API_KEY`等)が必要になるのは、`AnthropicProvider` / `OpenAIProvider`を実際に実装する段階から。

## 5. 将来の Activity Import(Garmin / Apple Health / Strava等)を見据えた設計

**今回のGitHub移行では、外部連携そのものは実装しない。** ただし、将来Garmin/Apple Health/Strava等からランニング実績を自動取得できるようにする可能性があるため、Workout Result(`logs/{planId}`の各エントリ)を「手入力されたデータしか保存できない構造」に強く依存させないことを設計上の方針とする。

現状のログの型:

```
{
  distanceKm, avgPace, avgHr, durationMin, calories,
  fuelingNote, note, shoeId,
  rpe, pain, completionType,
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

現時点で`app/runq.html`にAPIキー等の秘密情報はハードコードされていない(確認済み)。外部ネットワーク呼び出しはGoogle Fontsの読み込みのみで、それ以外の外部API呼び出しは無い(AIはClaude Artifactの`sample` capability経由、DBは`db` capability経由のため、コード側で秘密情報を保持する必要がない)。`.env.example`および README の「環境変数」を参照。

## 7. デプロイ

- **現状**: Claude Artifactとして公開(`app/runq.html`の内容をArtifactツールで公開)。ユーザーが実際に使っているのはこちら。
- **今回のGitHub移行後**: `app/runq.html`をGitHub上の正本として管理し、Claude Artifactへの公開は引き続きこのファイルの内容をそのまま使う運用とする。
- **将来**: Vercel等への静的ホスティングへ切り替える場合、`npm run build`で生成される`dist/index.html`をデプロイ対象にできる。ただしその場合、`db`/`sample` capabilityが使えなくなる(localStorageへのフォールバック・AIコーチ非表示)ため、クロスデバイス同期・AIコーチを維持するには、DB(§2)・AI Provider(§4)の実装が別途必要になる。
