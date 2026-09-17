# RUNQ. 認証・Supabase移行・Health連携修正

## 目的

RUNQ.を開発者本人だけでなくAndroidユーザーの友人にも安全に試してもらえる状態にする。

中心価値は「目標、全プラン、最近の走りを理解した一人のAIコーチが伴走すること」。認証やDB移行によって既存のプラン、コーチ、Apple Health、Health Connect、画像登録、共有を壊さない。

## 実装前提

- 最新mainを正とする。
- 現行はNext.jsではなく、単一HTML/CSS/JavaScript + Capacitor中心の実装。今回は全面リライトやNext.js移行をしない。
- 既存のStore/localStorage/Claude Artifact DBを調査してから移行する。
- 実機未確認の項目を「確認済み」と報告しない。
- SecretやService Role Keyをクライアント、リポジトリ、ビルド成果物へ入れない。

## 最新コードと引き継ぎ資料の差分

最新mainでは以下が未実装または不一致になっている。

- Supabase Auth/DB/RLS
- ログイン画面
- 認証用Deep Link
- ユーザー別の永続データ
- DBレベルのWorkout一意制約
- アプリ起動・復帰時のHealth自動同期（UIには実行すると表示）
- 日本のローカル日付によるHealth Workoutと予定メニューの照合
- Health履歴権限が拒否・非対応の場合の取得範囲フォールバック

これらを今回のスコープに含める。

---

## A. 認証

Supabase Authで次を提供する。

1. Appleで続ける
2. Googleで続ける
3. メールアドレスに届く6桁コードで続ける

パスワード認証は不要。

表示順:

- iOS: Apple → Google → メール
- Android: Google → Apple → メール
- Web: Google・Apple・メール

### Apple

- iOSでは可能な限りネイティブSign in with Appleを使用する。
- ID tokenをSupabase `signInWithIdToken`へ渡す。
- nonceを正しく生成・検証する。
- 「メールを非公開」に対応する。
- 氏名は初回取得時に保存し、取得できなくても失敗させない。
- キャンセルで画面を壊さない。
- 既存のHealthKit entitlementとApple Healthを壊さない。
- Appleの秘密鍵やClient Secretをアプリへ埋め込まない。

### Google

- Androidでは可能な限りネイティブGoogle Sign-Inを使用する。
- ID tokenをSupabase `signInWithIdToken`へ渡す。
- Android/iOS/WebのOAuth Clientを適切に分離する。
- 必要なnonce/stateを扱う。
- キャンセルで画面を壊さない。
- Capacitor 8互換の方法を選び、依存を増やしすぎない。
- Google Client Secretをアプリへ埋め込まない。

### メールOTP

- マジックリンクを主経路にせず、アプリ内で6桁コードを入力する。
- 再送、再送待ち時間、コード違い、期限切れ、通信エラーを扱う。
- 数字キーボードとOSのワンタイムコード自動入力へ可能な範囲で対応する。
- 二重送信を防ぐ。

### セッション

- 再起動後もセッションを復元する。
- 復元完了前に別ユーザーのキャッシュを表示しない。
- token refresh失敗時だけログインへ戻す。
- ログアウト時は画面・メモリ・ユーザー別キャッシュを切り替え、別ユーザーのデータを表示しない。

### 複数identity

- メール一致だけを根拠に独自の危険な自動統合をしない。
- Supabase Auth identitiesを利用する。
- Apple非公開メールなど同一性を証明できない場合は勝手に統合しない。
- 今回安全なidentity連携UIまで実装できない場合は制約をREADMEへ明記する。

### アカウント削除

アプリ内に削除導線を用意する。

- 確認を入れる。
- profile/plans/progress/logs/workouts/coach data等を削除する。
- Auth user削除はService Roleを必要とする安全なサーバー側処理にする。
- サーバー削除成功前にローカルデータを消さない。
- 成功後にユーザー別キャッシュとセッションを削除する。

---

## B. Supabase DB/RLS

実装前に現在のStoreメソッド、localStorage keys、Claude Artifact DB pathsをすべて棚卸しする。

最低限保存対象:

- profile、onboarding、theme、coach persona
- PB、longest run、曜日、週回数、生活制約
- shoes
- plans、active plan、progress、plan logs
- common workouts、duplicate candidates、source refs
- notes、RPE、pain、feedback
- forecast
- coach conversation/history/safety state
- Health connection stateとlast synced time

最低限の責務:

- `profiles`
- `plans`
- `plan_progress`
- `plan_logs`
- `workouts`
- `coach_messages`または同等
- 必要に応じて`shoes`等

既存モデルがJSON中心なので過剰な正規化は不要。ただしRLS、検索、一意制約に必要な値は通常カラムにする。全ユーザーデータに`user_id`を持たせ、日時は原則`timestamptz`を使う。

### Workout一意制約

DBで最低限、次を一意にする。

`user_id + source + source_workout_id`

Apple Health/Health Connectなどexternal IDのあるWorkoutはこのキーでupsertする。

- 同期ボタン連打で増えない。
- 自動同期と手動同期の競合で増えない。
- 別ユーザーとは衝突しない。
- 再同期でsource_refs、メモ、RPE、痛み、AI feedbackを失わない。
- external IDのない手動/画像記録は既存の近似判定を維持する。
- 曖昧な一致は勝手に削除・統合しない。

### RLS

全ユーザーテーブルでRLSを有効化する。

- `auth.uid() = user_id`のみSELECT/INSERT/UPDATE/DELETE可能。
- 未認証はアクセス不可。
- 他人のuser_idで保存できない。
- migration SQLをリポジトリへ追加する。
- Service Role Keyをクライアントへ渡さない。

### API

`/api/coach`と`/api/run-extract`を確認する。

- Supabase access tokenをAuthorization headerで送り、サーバーでユーザーを検証する。
- 未認証のAPI濫用を防ぐ。
- OpenAI keyや内部情報を返さない。
- Capacitor/Web双方を壊さない。
- 既存の緊急症状ガード、レート制限、ネットワークエラー表示を維持する。

---

## C. 既存端末データの移行

既存iPhoneには端末内データがある可能性がある。絶対に消さない。

ログイン後に端末データを検出した場合:

「この端末に保存されているRUNQ.のデータを、このアカウントへ引き継ぎますか？」

- 明示確認後に移行する。
- 移行前に削除しない。
- 全サーバー保存成功後に完了マークを付ける。
- 途中失敗から再試行できる。
- 再実行しても重複しない。
- 安定確認まではローカルバックアップを保持する。
- 別アカウントへ同じデータを自動移行しない。
- 移行先user idを端末で記録する。
- 件数を検証し「○件引き継ぎました」と表示する。
- 既存ユーザーへオンボーディングを強制し直さない。

Supabaseを正本としつつ、通信断で画面を空にしないためユーザー別ローカルキャッシュを利用してよい。完全なオフライン同期基盤は不要だが、ユーザー混入とデータ消失を防ぐ。

---

## D. Health同期修正

### ローカル日付

現在のUTC ISO文字列の`slice(0,10)`によるプラン照合を修正する。

- `started_at`は正確なUTC時刻で保存する。
- 端末のIANA timezoneまたはoffsetを保持する。
- プラン照合用local dateを端末ローカル時間から生成する。
- 日本時間9月17日06:00のRunが9月17日の予定へ紐づくこと。
- 表示/集計/照合は共通の日付関数へ寄せる。
- UTC日付とローカル日付が異なる単体テストを追加する。

### 起動・復帰時の自動同期

UI文言どおり実装する。

同期契機:

- ログイン後の初期ロード完了後
- cold start
- backgroundからactiveへの復帰
- 手動同期

条件:

- 接続済み
- auto import ON
- 前回同期から一定時間経過
- 同期中でない

起動表示をブロックせず、失敗してもアプリを開けること。自動同期と手動同期は排他する。手動同期は結果を明確に表示する。Apple Health/Health Connect双方へ適用する。

### 初回履歴

- 履歴権限あり: 最大90日
- 履歴権限なし: Health Connectが許可する範囲へ短縮
- 機能非対応: 通常権限だけで同期継続
- 古い履歴が読めなくても同期全体を失敗させない
- 必要なら「直近の記録だけ同期しました」と表示する

### 増分同期

現在の10分overlapでは遅延書き込みを取りこぼす可能性がある。external ID upsertを前提に24時間以上、必要なら数日の安全なoverlapへ変更し、理由をコメント/READMEへ残す。

### 部分権限

Workoutは読めるが心拍/距離/カロリーが拒否された場合、同期は継続してよい。ただし「接続済み」だけでなく、欠けている情報と設定導線を日本語で示す。

### walking

散歩が通常のランニング履歴へ大量混入しないようにする。ランニングは通常同期し、walkingは初心者/ダイエット/運動習慣系プランで利用するか、複雑にならない設定を選ぶ。

---

## E. Deep Link/ネイティブ設定

ネイティブID token方式を優先する。Web OAuth fallbackや将来の認証リンクで必要なら`com.astome.runq://auth/callback`等を設定する。

- Android Intent Filter
- iOS URL Types
- Capacitor appUrlOpen
- Supabase redirect allowlist
- state検証
- 失敗/キャンセル後の安全な復帰

Health、共有、通常起動を壊さない。

---

## F. UI/UX

ログイン画面の文言例:

- 「RUNQ.をはじめる」
- 「目標まで、あなたのコーチが伴走します。」
- Appleで続ける
- Googleで続ける
- メールアドレスで続ける

要件:

- 現行デザインに合わせる。
- カード内カードを避ける。
- 説明を増やしすぎない。
- 十分な文字サイズと44px程度以上のtap target。
- 処理中/失敗/再試行が分かる。
- OS dark modeへ勝手に依存しない。
- keyboard/Android Back/認証キャンセルで白画面にしない。

---

## G. README/設定

READMEへ次を追加する。

- 実際の技術構成
- Supabase作成・環境変数・migration
- Google OAuth（Web/Android/iOS client、SHA-1/SHA-256）
- Apple Developer/Sign in with Apple/Supabase provider
- メールOTP
- Redirect URL
- Android Studio/Xcode
- ローカルデータ移行
- アカウント削除
- 実機テスト

公開可能なSupabase URL/publishable keyは環境差し替え可能にする。Service Role、Apple private key、Google Client Secret、OpenAI keyはサーバー環境のみ。

管理画面で人間の設定が必要な箇所は、コードだけで完了扱いにせず手順を明記する。

---

## H. テスト

最低限追加する。

### Auth

- 未認証画面
- session restore
- logout後のデータ非表示
- Apple/Google cancel
- OTP wrong/expired/network error
- 別ユーザーcache混入防止

### DB/RLS

- user Aがuser Bをread/update不可
- 未認証アクセス不可
- external Workout upsert
- 再同期で件数不変

### Migration

- 初回移行
- 中断後再試行
- 再実行で重複なし
- 別accountへ自動移行なし
- 元データ非削除

### Health

- JST 06:00を当日へ照合
- UTC/local date差
- 同期連打
- auto/manual競合
- 履歴権限なし
- 部分権限
- 新規0件/複数件/再同期
- AI coach contextへ反映

### Regression

- Apple Health
- Health Connect
- manual/image workout
- plan creation
- coach continuity
- SNS share/cancel
- themes/onboarding

既存`npm test`も通す。

---

## 完了条件

1. iPhoneでApple login可能。
2. AndroidでGoogle login可能。
3. 両OSでメールOTP可能。
4. 再起動後もsession維持。
5. user dataがSupabase/RLSで分離。
6. 既存端末データを確認付き・冪等に移行。
7. DB uniqueでHealth重複を防止。
8. JST local dateで正しい予定へ照合。
9. 接続済みなら起動/復帰時に安全に自動同期。
10. 履歴権限なしでも可能範囲を同期。
11. Health workoutをAI coachが把握。
12. logoutで別ユーザーdataを表示しない。
13. アプリ内account deletion。
14. Apple Health/Health Connect/画像/共有を壊さない。
15. README/migration/testを更新。
16. 実機未確認事項を明記。

## 完了報告

- 変更概要とファイル一覧
- DB schema/RLS
- auth flow
- data migration flow
- Health/date/dedup changes
- Apple/Google/Supabaseで必要な手動設定
- 実行したtestと結果
- Android Studio/Xcode build結果
- Android/iPhone実機確認範囲
- 未確認事項/既知制約
- 友人へAndroid版を渡すまでの手順

不明点は既存コードを確認せず推測で実装しないこと。大きな変更は段階的に行い、既存データを最優先で保護すること。
