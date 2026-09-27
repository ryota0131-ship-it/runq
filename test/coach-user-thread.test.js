#!/usr/bin/env node
'use strict';

// ユーザー単位のコーチ会話・次のゴール自動選択・旧ログ移行をブラウザで確認する回帰テスト。
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const port = 4187;
let passed = 0;
function check(name, condition) { assert.ok(condition, name); passed++; console.log('  ok - ' + name); }

function makePlan(id, name, raceDate) {
  return { id, meta:{name, distanceLabel:'フルマラソン', distanceKm:42.195, raceDate, startDate:'2026-09-01', targetLabel:'5:00:00', mpLabel:'7:00〜7:14/km', easyLabel:'7:38〜8:08/km', policy:[]}, weeks:[{label:'Week 1',phase:'ベース構築期',dateRange:'',items:[{type:'easy',day:'月',date:'2026-09-14',title:'イージー',desc:'4km'}]}],extras:{fueling:[],cautions:[]},history:[] };
}

async function main(){
  const server=http.createServer((req,res)=>{
    const url=decodeURIComponent(req.url.split('?')[0]||'/');
    fs.readFile(path.join(dist,url==='/'?'index.html':url.replace(/^\//,'')),(err,data)=>{ if(err){res.writeHead(404);res.end();return;} res.writeHead(200);res.end(data); });
  });
  await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
  const browser=await chromium.launch();
  try{
    const context=await browser.newContext();
    const plans=[makePlan('chiba','千葉アクアラインマラソン','2026-11-08'),makePlan('saitama','埼玉マラソン','2026-12-06'),makePlan('yachiyo','八千代ラン','2027-01-10')];
    await context.addInitScript(seed=>{
      localStorage.setItem('paceplan.plans',JSON.stringify(seed.plans));
      localStorage.setItem('paceplan.profile',JSON.stringify({workoutUserId:'runner-test',activePlanId:'chiba',onboarding:{version:1,walkthroughCompleted:true,profileCompleted:true},healthConnections:{autoImport:true,appleHealth:{},healthConnect:{}}}));
      localStorage.setItem('paceplan.coachLog.chiba',JSON.stringify([{id:'old-chiba',role:'user',text:'千葉の準備を相談したい',ts:100}]));
      localStorage.setItem('paceplan.coachLog.saitama',JSON.stringify([{id:'old-saitama',role:'coach',kind:'advice',text:'埼玉も把握しています',ts:200}]));
      localStorage.setItem('paceplan.coachLog.user-other-runner',JSON.stringify({messages:[{id:'other-user',role:'user',text:'別ユーザーの会話',ts:50}],migratedPlanIds:[]}));
    },{plans});
    const page=await context.newPage();
    let lastPrompt='';
    await page.route('**/api/coach',async route=>{
      const body=JSON.parse(route.request().postData()||'{}'); lastPrompt=body.prompt||'';
      const urgent=/胸(?:が|の)?痛|胸痛/.test(body.safetyMessage||'');
      await route.fulfill({contentType:'application/json',body:JSON.stringify(urgent?{mode:'advice',summary:'今は走るのを中止してください。',safety:{symptoms:['chest_pain']}}:{mode:'advice',summary:'登録中の大会を確認しました。'})});
    });
    await page.goto('http://127.0.0.1:'+port+'/');
    await page.locator('.bottom-nav-btn[data-tab="coach"]').click();
    await page.waitForFunction(()=>document.querySelector('#coach-thread') && document.querySelector('#coach-thread').innerText.includes('千葉の準備を相談したい'));
    let thread=await page.locator('#coach-thread').innerText();
    check('1. 旧プラン別の千葉会話を移行して表示する',thread.includes('千葉の準備を相談したい'));
    check('2. 旧プラン別の埼玉会話も時系列で保持する',thread.includes('埼玉も把握しています'));
    check('3. 別ユーザーの会話を混在させない',!thread.includes('別ユーザーの会話'));
    await page.locator('.bottom-nav-btn[data-tab="view"]').click();
    check('4. 開催日が最も近い大会を次のゴールに自動表示する',(await page.locator('#app').innerText()).includes('千葉アクアラインマラソン'));
    await page.locator('[data-action="open-plan-switcher"]').click();
    const switcher=await page.locator('#app').innerText();
    check('5. 手動の主目標切替ではなく大会の詳細を開ける',switcher.includes('次のゴール')&&switcher.includes('埼玉マラソン'));
    await page.getByRole('button',{name:'閉じる'}).click();
    check('5-2. 表示対象を切り替えずに一覧を閉じられる',await page.locator('[data-action="open-plan-switcher"]').count()===1);
    await page.locator('.bottom-nav-btn[data-tab="coach"]').click();
    await page.waitForFunction(()=>document.querySelector('#coach-thread') && document.querySelector('#coach-thread').innerText.includes('千葉の準備を相談したい'));
    thread=await page.locator('#coach-thread').innerText();
    check('5-3. 大会の詳細を見ても会話履歴が消えない',thread.includes('千葉の準備を相談したい')&&thread.includes('埼玉も把握しています'));
    await page.locator('#adjust-input').fill('登録中の全プランを教えて');
    await page.locator('.chat-send-btn').click();
    await page.waitForFunction(()=>!document.querySelector('#coach-thread .chat-typing'));
    check('6. コーチへ全プランの要約と次のゴールを渡す',lastPrompt.includes('千葉アクアラインマラソン')&&lastPrompt.includes('埼玉マラソン')&&lastPrompt.includes('八千代ラン')&&lastPrompt.includes('"next_goal":true'));
    await page.locator('#adjust-input').fill('八千代ランについて教えて');
    await page.locator('.chat-send-btn').click();
    await page.waitForFunction(()=>!document.querySelector('#coach-thread .chat-typing'));
    check('7. 次のゴール以外の八千代もコーチの参照対象',lastPrompt.includes('八千代ラン')&&lastPrompt.includes('今回名前が指定された次のゴール以外のプランの詳細'));
    await page.locator('#adjust-input').fill('胸が痛い');
    await page.locator('.chat-send-btn').click();
    await page.waitForFunction(()=>!document.querySelector('#coach-thread .chat-typing'));
    await page.locator('.bottom-nav-btn[data-tab="view"]').click();
    await page.locator('.bottom-nav-btn[data-tab="coach"]').click();
    await page.waitForFunction(()=>document.querySelector('#coach-thread') && document.querySelector('#coach-thread').innerText.includes('八千代ランについて教えて'));
    thread=await page.locator('#coach-thread').innerText();
    check('8. 大会の詳細を行き来しても同じ会話を維持する',thread.includes('八千代ランについて教えて'));
    await page.locator('#adjust-input').fill('まだ痛い');
    await page.locator('.chat-send-btn').click();
    check('9. 次のゴール表示の変更で安全状態を不正にリセットしない',(await page.locator('#coach-thread').innerText()).includes('症状が続いているなら'));
    await page.locator('.bottom-nav-btn[data-tab="profile"]').click();
    await page.getByRole('button',{name:/目標・大会/}).click();
    const management=await page.locator('#app').innerText();
    check('10. マイページで全プランを管理できる',management.includes('千葉アクアラインマラソン')&&management.includes('埼玉マラソン')&&management.includes('八千代ラン'));
    await page.locator('[data-action="open-plan-detail"][data-id="yachiyo"]').click();
    await page.locator('[data-action="open-delete-modal"]').click();
    check('11. 削除には確認画面を表示する',(await page.locator('#app').innerText()).includes('プランを削除しますか？'));
    console.log('\n'+passed+' passed');
  } finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
}
main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
