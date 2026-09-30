const assert = require('assert');
const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '..', 'app', 'runq.html'), 'utf8');

assert.match(app, /function coachNeedsWebSearch\(instruction, historyLines\)/, '検索判定は会話履歴も受け取る');
assert.match(app, /searchIntent=.*検索.*探.*調べ.*候補/, '大会を探す表現を検索意図として扱う');
assert.match(app, /searchIntent\.test\(text\) && \(raceTopic\.test\(text\) \|\| raceTopic\.test\(history\)\)/, '指示語だけの続きも直近の大会文脈から検索する');
assert.match(app, /const webSearch=coachNeedsWebSearch\(instruction,historyLines\)/, 'コーチ呼び出し前に会話文脈込みで検索を判定する');
assert.match(app, /webSearch:webSearch/, '検索が必要な相談はCoachServiceへ渡す');

console.log('coach web search checks: passed');
