const assert = require('assert');
const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '..', 'app', 'runq.html'), 'utf8');

assert.match(app, /function openWorkoutLog\(date\)/, '記録フォームを開く処理を共通化する');
assert.match(app, /action==='open-log'\)\{[\s\S]{0,180}openWorkoutLog\(btn\.dataset\.date\)/, '結果を記録する操作は共通の遷移処理を呼ぶ');
assert.match(app, /data-home-open-log="true"/, 'ホームの記録操作をiOS向けの専用タップ対象として識別する');
assert.match(app, /addEventListener\('pointerup',[\s\S]*openHomeWorkoutLogFromGesture/, 'ホームの記録操作はclickが届かないWKWebViewでもpointerupで開く');
assert.match(app, /function bindHomeWorkoutActions\(root\)/, 'ホーム操作はボタン自身にもイベントを登録する');
assert.match(app, /querySelectorAll\('\[data-home-action\]'\)[\s\S]{0,800}addEventListener\('touchend',activate,\{passive:false\}\)/, '記録と見送りはiOSのtouchendでも確実に受ける');
assert.match(app, /data-home-action="record"/, '記録操作を直接バインドする');
assert.match(app, /data-home-action="skip"/, '見送り操作を直接バインドする');
assert.match(app, /action==='skip-item'\)\{[\s\S]{0,80}openWorkoutLog\(btn\.dataset\.date,\{values:\{completionType:'skipped'\}\}\)/, '見送りは共通の記録フォームを開く');
assert.match(app, /homeLogGestureAt<900/, 'pointerup後のclickでフォームを二重に開かない');
assert.match(app, /\.home-workout-actions\{[^}]*position:relative[^}]*z-index:2[^}]*pointer-events:auto/, 'ホームの操作領域はカード内の前面でタップを受ける');
assert.match(app, /\.home-workout-actions button\{[^}]*touch-action:manipulation/, 'ホームの操作はiOS向けのタップ最適化を持つ');
assert.match(app, /\.home-workout-actions \.btn-primary\{[^}]*min-height:44px/, '結果を記録するボタンは十分なタップ領域を持つ');
assert.match(app, /data-action="open-log" data-home-open-log="true" data-home-action="record" data-date="'\+it\.date\+'">結果を記録する/, '今日のメニューに記録操作を出す');
assert.match(app, /data-action="skip-item" data-home-action="skip" data-date="'\+it\.date\+'">今回は見送る/, '予定をこなせない日は見送りとして記録できる');
assert.match(app, /values\.completionType!=='skipped' && !values\.distanceKm/, '見送りには走行数値を必須にしない');
assert.match(app, /見送りは実走ではないため、ワークアウトを新規作成・更新しない/, '見送りで実走記録を増やさない');
assert.match(app, /data-action="open-plan-schedule">予定を詳しく見る/, 'ホームの週間予定は予定タブへの専用導線を使う');
assert.match(app, /action==='open-plan-schedule'\)\{[\s\S]{0,260}state\.planTab='schedule'/, '週間予定の導線はプラン画面の予定タブを選ぶ');
assert.match(app, /action==='open-plan-schedule'\)\{[\s\S]{0,360}state\.viewMode='week'/, '週間予定の導線は週表示を選ぶ');
assert.match(app, /action==='open-plan-schedule'\)\{[\s\S]{0,520}window\.scrollTo\(0,0\)/, '週間予定の導線はプラン画面の先頭へ戻す');

console.log('home menu action checks: passed');
