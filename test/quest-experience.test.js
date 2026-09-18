const assert = require('assert');
const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '..', 'app', 'runq.html'), 'utf8');

assert.ok(app.includes('coachDailyBriefHTML(plan,today)'), 'home starts with a short coach brief');
assert.ok(app.includes('今日は休んで強くなる日。'), 'rest days are framed positively');
assert.ok(!app.includes('今日は予定を入れていません'), 'home no longer leads with an empty-schedule message');
assert.ok(app.includes('class="home-workout-details"'), 'long workout instructions are expandable');
assert.ok(app.includes('NEXT MILESTONE'), 'home shows the next achievable milestone');
assert.ok(app.includes('RECENT WIN'), 'home shows a recent achievement');
// ROAD TO GOAL: 5段階の抽象ステージ表示(quest-journey)は廃止し、週単位のノードを
// 蛇行パスでつなぐ表示(quest-path / planPathHTML)に置き換えた(2026-09-18)。
assert.ok(app.includes('class="quest-path"'), 'plan view renders the road-to-goal path');
assert.ok(app.includes('function planPathHTML(plan)'), 'planPathHTML renders the week-by-week path');
assert.ok(app.includes('function planChainNodes(plan)'), 'the path walks the linkedFromPlanId chain into one node list');
assert.ok(app.includes('data-action="path-node"'), 'path nodes are tappable');
assert.ok(!app.includes('class="quest-journey"'), 'the old 5-stage abstract journey markup is removed');
assert.ok(app.includes('class="coach-proposal"'), 'plan changes use a dedicated proposal card');
assert.ok(app.includes('if(m.resolved) return \'\';'), 'resolved proposal cards collapse from the conversation');
assert.ok(app.includes('<strong>プランを変更しました</strong>'), 'confirmed changes use a short completion message');

console.log('quest experience checks: passed');
