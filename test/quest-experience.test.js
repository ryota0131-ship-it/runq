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
assert.ok(app.includes('class="quest-journey"'), 'plan view renders the journey to the goal');
['ベースづくり','距離を伸ばす','ピーク','テーパー','レース'].forEach((stage) => {
  assert.ok(app.includes(stage), 'race journey includes ' + stage);
});
assert.ok(app.includes('class="coach-proposal"'), 'plan changes use a dedicated proposal card');
assert.ok(app.includes('if(m.resolved) return \'\';'), 'resolved proposal cards collapse from the conversation');
assert.ok(app.includes('<strong>プランを変更しました</strong>'), 'confirmed changes use a short completion message');

console.log('quest experience checks: passed');
