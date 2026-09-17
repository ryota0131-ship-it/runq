# TestFlight / Xcode Cloud 配布

RUNQ.のiOS版は、普段の確認をTestFlightへ切り替えることで、MacとiPhoneをケーブル接続せずに更新できます。さらにXcode Cloudを設定すると、`main`へのマージを起点にビルドし、TestFlightへ自動配布できます。

## 目指す更新フロー

1. GitHubでPull Requestを`main`へマージする
2. Xcode CloudがWebアプリをビルドしてCapacitorへ同期する
3. iOSアプリをArchiveする
4. TestFlightへ配布する
5. iPhoneのTestFlightから更新する

Xcode Cloudでは`ci_scripts/ci_post_clone.sh`が`npm ci`、Webビルド、`npx cap sync ios`を実行します。APIキーはiOSアプリへ埋め込まず、従来どおりサーバー側で保持します。

## リポジトリ側で用意済みのもの

- Xcode Cloudから参照できる共有Scheme `App`
- Clone後にCapacitorを同期するCIスクリプト
- ローカル用のiOS同期・起動コマンド
- TestFlightへ再アップロードするときのビルド番号更新コマンド

```bash
npm run ios:sync          # WebをビルドしてiOSへ同期
npm run ios:open          # 同期後にXcodeを開く
npm run ios:build-number  # CURRENT_PROJECT_VERSIONを1増やす
npm run ios:release       # ビルド番号を増やして同期
```

## 初回だけMacで行う設定

### 1. Apple Developerの準備

- Apple Developer Programの有効なメンバーシップを確認する
- XcodeのSettings > Accountsで、そのApple IDへサインインする

無料のPersonal Teamでも実機起動はできますが、TestFlightとXcode Cloudでの継続配布にはApple Developer Programが必要です。

### 2. Signingを確認する

```bash
npm ci
npm run ios:open
```

Xcodeで`App`ターゲットを選び、Signing & Capabilitiesで次を確認します。

- Automatically manage signing: ON
- Team: 自分のApple Developerチーム
- Bundle Identifier: `com.astome.runq`
- HealthKit capabilityが存在する

Teamは開発者アカウント固有のため、リポジトリには固定していません。

### 3. App Store Connectにアプリを作る

App Store Connectの「マイApp」から新規iOSアプリを作成します。

- 名前: `RUNQ.`（利用可能な名前に調整可）
- Bundle ID: `com.astome.runq`
- SKU: 例 `runq-ios`

表示される契約・税務・暗号化・プライバシー等の確認項目は、実際のアプリとアカウントに合わせて回答します。

### 4. 最初のビルドをTestFlightへ送る

Xcodeで実機ではなく`Any iOS Device (arm64)`を選び、Product > Archiveを実行します。OrganizerでDistribute App > App Store Connect > Uploadを選びます。

アップロード後、App Store ConnectのTestFlightで自分を内部テスターへ追加します。iPhoneにTestFlightアプリを入れ、RUNQ.をインストールします。以後、ケーブル接続は不要です。

## Xcode Cloudを一度だけ設定する

XcodeでProduct > Xcode CloudからWorkflow作成を開始します（Xcodeのバージョンにより表記が少し異なる場合があります）。

推奨設定:

- Repository: RUNQ.のGitHubリポジトリ
- Scheme: `App`
- Start Condition: `main`ブランチへの変更
- Action: Archive（iOS）
- Post Action: TestFlight Internal Testingへ配布

初回はGitHubへのアクセス許可とApp Store Connect上の権限確認が必要です。Workflowの検証が通ったら、次回からはPRをマージするだけでTestFlight版が作られます。

Xcode Cloud側で自動ビルド番号管理を有効にする場合、通常のクラウド配布ではローカルの`npm run ios:build-number`は不要です。Xcodeから手動アップロードする場合は、以前送ったビルドより大きい番号へ更新してからArchiveします。

## 日常の使い分け

| 用途 | 方法 |
| --- | --- |
| ブラウザで素早くUI確認 | `npm run dev` |
| Mac上でiOS機能を確認 | `npm run ios:open` |
| 自分のiPhoneへ普段使い版を届ける | `main`へマージ → Xcode Cloud → TestFlight |
| Xcode Cloud障害時の予備 | `npm run ios:release` → Xcode Archive → Upload |

HealthKitやCapacitorプラグインを変更したときは、TestFlight配布前にXcodeで一度動作確認します。通常のHTML/CSS/JavaScript変更は、同じ自動配布フローで反映できます。
