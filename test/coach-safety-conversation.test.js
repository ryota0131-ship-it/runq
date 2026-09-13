#!/usr/bin/env node
'use strict';

// ブラウザ上の実際の会話状態遷移を確認する回帰テスト。
// `npm run build` 後に `node test/coach-safety-conversation.test.js` で実行する。
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const port = 4186;
let passed = 0;
function check(name, condition) { assert.ok(condition, name); passed++; console.log('  ok - ' + name); }

function planForToday() {
  const today = new Date().toISOString().slice(0, 10);
  return {
    id: 'safety-test', meta: { name: '安全会話テスト', distanceLabel: '5km', distanceKm: 5, raceDate: '2026-12-01', startDate: today, targetLabel: '0:35:00', mpLabel: '7:00/km', easyLabel: '楽なペース', policy: [] },
    weeks: [{ label: 'WEEK 1', phase: '習慣づくり', dateRange: '', items: [{ type: 'easy', day: '日', date: today, title: 'イージー', desc: '20分。楽な強さで。' }] }], extras: { fueling: [], cautions: [] }, history: []
  };
}

async function main() {
  const server = http.createServer((req, res) => {
    const requestPath = decodeURIComponent(req.url.split('?')[0] || '/');
    const filename = requestPath === '/' ? 'index.html' : requestPath.replace(/^\//, '');
    fs.readFile(path.join(dist, filename), (error, data) => {
      if (error) { res.writeHead(404); res.end(); return; }
      res.writeHead(200); res.end(data);
    });
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    await context.addInitScript((plan) => {
      localStorage.setItem('paceplan.plans', JSON.stringify([plan]));
      localStorage.setItem('paceplan.profile', JSON.stringify({ onboarding: { version: 1, walkthroughCompleted: true, profileCompleted: true }, healthConnections: { autoImport: true, appleHealth: {}, healthConnect: {} } }));
    }, planForToday());
    const page = await context.newPage();
    let safetyRequests = [];
    await page.route('**/api/coach', async route => {
      const body = JSON.parse(route.request().postData() || '{}');
      safetyRequests.push(body.safetyMessage || '');
      const urgent = /胸(?:が|の)?痛|胸痛|強い(?:息苦し|息切れ)|呼吸が苦し|めまい/.test(body.safetyMessage || '');
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(urgent
        ? { mode: 'advice', summary: '今は走るのを中止してください。症状が今もあるか、治まったかも教えてください。', risk: '安全確認が必要です。', safety: { symptoms: ['chest_pain'] } }
        : { mode: 'advice', summary: '通常のコーチ応答です。今日の予定を一緒に確認しましょう。', risk: null }) });
    });
    await page.goto('http://127.0.0.1:' + port + '/');
    await page.locator('.bottom-nav-btn[data-action="tab"][data-tab="coach"]').click();

    async function send(text) {
      await page.locator('#adjust-input').fill(text);
      await page.locator('.chat-send-btn').click();
      await page.waitForFunction(() => !document.querySelector('#coach-thread .chat-typing'));
      return page.locator('#coach-thread .chat-msg.chat-coach .chat-bubble').last().innerText();
    }

    let text = await send('胸が痛くて息苦しい');
    check('1. 胸痛・息苦しさでは中止案内', text.includes('中止してください'));
    text = await send('まだ痛い');
    check('2. 継続時は状態継続に応じた受診案内', text.includes('症状が続いているなら'));
    text = await send('もう治まった');
    check('3. 症状名なしの改善は確認質問', text.includes('どの症状が治まった'));
    text = await send('胸の痛みは治まった');
    check('3. 症状名を明示した改善は慎重に解決', text.includes('治まったことを確認'));
    text = await send('今日のメニューは？');
    check('4. 過去の胸痛だけで緊急文を再送しない', text.startsWith('通常のコーチ応答です。今日の予定を一緒に確認しましょう。'));
    text = await send('踵が痛い');
    check('5. 踵の痛みでは胸痛案内にしない', text.startsWith('通常のコーチ応答です。今日の予定を一緒に確認しましょう。'));
    text = await send('踵はもう大丈夫');
    check('6. 踵の改善は胸痛状態を変更しない', text.startsWith('通常のコーチ応答です。今日の予定を一緒に確認しましょう。'));
    text = await send('ん');
    check('7. 相づちで緊急案内を再送しない', text.startsWith('通常のコーチ応答です。今日の予定を一緒に確認しましょう。'));
    text = await send('また胸が痛い');
    check('8. 新たな胸痛では再度安全ガード', text.startsWith('今は走るのを中止してください。症状が今もあるか、治まったかも教えてください。'));
    check('安全ガードは今回の発言だけをAPIへ渡す', safetyRequests.includes('今日のメニューは？') && safetyRequests.includes('また胸が痛い'));
    console.log('\n' + passed + ' passed');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
