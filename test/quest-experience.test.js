const assert = require('assert');
const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '..', 'app', 'runq.html'), 'utf8');

assert.ok(app.includes('coachDailyBriefHTML(plan,today)'), 'home starts with a short coach brief');
assert.ok(app.includes('今日は休んで強くなる日'), 'rest days are framed positively');
assert.ok(app.includes("html += coachDailyBriefHTML(plan,today)"), 'rest guidance is presented as the coach message');
assert.ok(app.includes("coachMascotHTML((state.profile||{}).coachPersona,'normal','small')"), 'daily coach brief includes the selected coach mascot');
assert.ok(!app.includes('今日は予定を入れていません'), 'home no longer leads with an empty-schedule message');
assert.ok(app.includes('class="home-workout-details"'), 'long workout instructions are expandable');
assert.ok(app.includes('NEXT MILESTONE'), 'home shows the next achievable milestone');
assert.ok(app.includes('RECENT WIN'), 'home shows a recent achievement');
assert.ok(app.includes('function journeyMomentHTML(plan,today,placement)'), 'journey moments are rendered from structured run and race context');
assert.ok(app.includes('assets/journey-dawn-v1.png'), 'journey moments use the local RUNQ scenic asset');
assert.ok(fs.existsSync(path.join(__dirname, '..', 'app', 'assets', 'journey-dawn-v1.png')), 'the scenic asset is included with the app');
assert.ok(app.includes("journeyMomentHTML(plan,today,'home')"), 'home only renders the scenic moment when its conditions are met');
const homeFunction = app.slice(app.indexOf('function homeHTML(){'), app.indexOf('function coachTabHTML(){'));
assert.ok(homeFunction.indexOf('homeGoalSummaryHTML(plan,today)') < homeFunction.indexOf('todayCardHTML(plan, today)'), 'home places the goal before today\'s menu');
assert.ok(homeFunction.indexOf('todayCardHTML(plan, today)') < homeFunction.indexOf('thisWeekCardHTML(plan, today)'), 'home places today\'s menu before the weekly schedule');
assert.ok(app.includes('page-section-tabs floating-section-tabs'), 'plan and mypage section tabs use the floating control');
assert.ok(app.includes("document.body.classList.toggle('has-floating-section-tabs'"), 'floating controls reserve space above the bottom navigation');
assert.ok(app.includes("document.body.classList.toggle('keyboard-open',keyboardOpen)"), 'floating controls hide while the software keyboard is visible');
assert.ok(app.includes('class="home-goal-summary-kicker">GOAL</span>'), 'home uses the concise GOAL label');
assert.ok(app.includes('plan-switcher-modal'), 'the plan switcher has a dedicated modal layout');
assert.ok(app.includes('plan-switcher-actions'), 'the plan switcher separates its close and management actions from the list');
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
assert.ok(app.includes('function currentPainCondition()'), 'pain history and current condition are evaluated separately');
assert.ok(app.includes("condition.status==='needs_checkin'"), 'recent unconfirmed pain triggers a check-in rather than an automatic load reduction');
assert.ok(app.includes('function evaluatePainConditionMessage'), 'a user can resolve a named pain condition in chat');
assert.ok(app.includes('過去の痛み・違和感が現在も続くとは断定しない'), 'coach prompt does not treat historical pain as current');

console.log('quest experience checks: passed');
