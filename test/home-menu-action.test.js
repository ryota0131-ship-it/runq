const assert = require('assert');
const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '..', 'app', 'runq.html'), 'utf8');

assert.match(app, /function openWorkoutLog\(date\)/, '記録フォームを開く処理を共通化する');
assert.match(app, /action==='open-log'\)\{\s*openWorkoutLog\(btn\.dataset\.date\)/, '結果を記録する操作は共通の遷移処理を呼ぶ');
assert.match(app, /\.home-workout-actions\{[^}]*position:relative[^}]*z-index:1[^}]*pointer-events:auto/, 'ホームの操作領域はカード内の前面でタップを受ける');
assert.match(app, /\.home-workout-actions \.btn-primary\{[^}]*min-height:44px[^}]*touch-action:manipulation/, '結果を記録するボタンはiOS向けの十分なタップ領域を持つ');
assert.match(app, /data-action="open-log" data-date="'\+it\.date\+'">結果を記録する/, '今日のメニューに記録操作を出す');
assert.match(app, /data-action="skip-item" data-date="'\+it\.date\+'">今回は見送る/, '予定をこなせない日は見送りとして記録できる');
assert.match(app, /values\.completionType!=='skipped' && !values\.distanceKm/, '見送りには走行数値を必須にしない');
assert.match(app, /見送りは実走ではないため、ワークアウトを新規作成・更新しない/, '見送りで実走記録を増やさない');

console.log('home menu action checks: passed');
