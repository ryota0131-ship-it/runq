#!/usr/bin/env node
/**
 * test/e2e/run.js
 *
 * OpenAI移行後のAI Coach(CoachService / OpenAIProvider)を、実際のブラウザ(Playwright)で
 * 動作確認するE2Eテスト。実際のOpenAI APIは呼ばず、ブラウザからの `POST /api/coach` を
 * page.route() でモックすることで、ネットワーク不要・APIキー不要のまま検証する。
 *
 * このテストはリポジトリの「依存パッケージ無し」という方針の対象外(devDependencies扱い)。
 * 実行するには `npm install` (playwrightのみ)が必要。実行しなくてもアプリ本体・
 * ローカル起動(`npm run dev`)には一切影響しない。
 *
 * 実行方法: npm run build && npm run test:e2e
 */
'use strict';

const path = require('path');
const fs = require('fs');
const http = require('http');

const ROOT = path.resolve(__dirname, '..', '..');
const DIST_INDEX = path.join(ROOT, 'dist', 'index.html');
const PORT = 4173; // npm run dev の既定(3000)と衝突しないよう専用ポートを使う

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition) {
  if (condition) {
    passed++;
    console.log(`  ok - ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.error(`  FAIL - ${name}`);
  }
}

/** 最小限の「実行中クエスト」を1件localStorageへ直接投入する(NEW QUESTウィザードを介さず、
 *  Coach周りの検証に直接入るため。docs/architecture.mdのTraining Plan構造に合わせている) */
function seedPlan() {
  const today = new Date().toISOString().slice(0, 10);
  const plan = {
    // 'aqualine-2026' はapp/runq.htmlのboot()が「デフォルトのデモプラン」として特別扱いするid
    // (無ければ自動でシードし、currentIdとして選ぶ)。このidを使うことで、シードした
    // このプランがそのままcurrentPlan()になり、二重にプランが生成されるのを避けられる。
    id: 'aqualine-2026',
    createdAt: today,
    meta: {
      name: 'E2Eテスト大会',
      distanceLabel: 'フルマラソン',
      distanceKm: 42.195,
      raceDate: '2026-12-06',
      startDate: today,
      targetLabel: '4:00:00',
      mpLabel: '5:41/km',
      easyLabel: '6:30/km',
      pbLabel: '',
      heelCaution: false,
      injuryNote: '',
      courseNote: '',
      constitutionNote: '',
      scheduleNote: '',
      linkedFromPlanId: null,
      peakLongRunKm: 32,
      policy: [],
    },
    weeks: [
      { label: 'Week 1', phase: 'ベース構築期', dateRange: '', items: [] },
    ],
    extras: { fueling: [], cautions: [] },
    history: [],
  };
  const profile = {
    pbs: [{ label: '10km', timeLabel: '40:00' }],
    shoes: [{ id: 'shoe1', name: 'E2Eテストシューズ', brand: 'TestBrand', active: true }],
  };
  return { plan, profile };
}

function nextMondayIso(date) {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const offset = (8 - result.getDay()) % 7; // 月曜は0、火曜〜日曜は次の月曜へ
  result.setDate(result.getDate() + offset);
  return [
    result.getFullYear(),
    String(result.getMonth() + 1).padStart(2, '0'),
    String(result.getDate()).padStart(2, '0'),
  ].join('-');
}

async function createPlan(page, { name, startDate, raceDate }) {
  if (await page.locator('#gen-form').count() === 0) {
    await page.locator('[data-action="tab"][data-tab="create"]').first().click({ force: true });
    await page.locator('#gen-form').waitFor({ state: 'visible', timeout: 10000 });
  }
  await page.locator('#f_name').fill(name);
  await page.locator('#f_startDate').fill(startDate);
  await page.locator('#f_raceDate').fill(raceDate);
  await page.locator('#gen-form button[type="submit"]').click();
  await page.waitForTimeout(150);
  return page.evaluate((planName) => {
    const plans = JSON.parse(localStorage.getItem('paceplan.plans') || '[]');
    return plans.find((plan) => plan.meta && plan.meta.name === planName);
  }, name);
}

async function main() {
  if (!fs.existsSync(DIST_INDEX)) {
    console.error('dist/index.html が見つかりません。先に `npm run build` を実行してください。');
    process.exit(1);
  }

  let playwright;
  try {
    playwright = require('playwright');
  } catch (e) {
    console.error('playwright が見つかりません。`npm install` (devDependencies) を実行してから再度お試しください。');
    process.exit(1);
  }

  console.log('=== build check (npm run build) ===');
  {
    const { execSync } = require('child_process');
    try {
      execSync('npm run build', { cwd: ROOT, stdio: 'pipe' });
      check('npm run build succeeds', true);
    } catch (e) {
      check('npm run build succeeds', false);
    }
  }

  console.log('=== static check: API key not embedded in shipped code ===');
  {
    const distHtml = fs.readFileSync(DIST_INDEX, 'utf8');
    const appHtml = fs.readFileSync(path.join(ROOT, 'app', 'runq.html'), 'utf8');
    const suspicious = /sk-[A-Za-z0-9_-]{10,}/; // OpenAI style key pattern
    check('dist/index.html に process.env / OPENAI_API_KEY の値が含まれない', !suspicious.test(distHtml) && !/OPENAI_API_KEY\s*=\s*['"][^'"]+['"]/.test(distHtml));
    check('app/runq.html に process.env / OPENAI_API_KEY の値が含まれない', !suspicious.test(appHtml) && !/OPENAI_API_KEY\s*=\s*['"][^'"]+['"]/.test(appHtml));
  }

  // 静的サーバーだけを立てる(api/coach.jsへは到達させず、page.route側で完全にモックするため
  // dev-server.js は使わず、dist/ の素の配信だけで足りる)
  const server = http.createServer((req, res) => {
    let reqPath = decodeURIComponent(req.url.split('?')[0]);
    if (reqPath === '/') reqPath = '/index.html';
    const filePath = path.join(ROOT, 'dist', reqPath);
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
  });
  await new Promise((resolve) => server.listen(PORT, resolve));
  const baseUrl = `http://localhost:${PORT}`;

  const { chromium } = playwright;
  let browser;
  try {
    browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium/chrome-linux/chrome' });
  } catch (e) {
    browser = await chromium.launch();
  }

  try {
    console.log('=== scenario 1: Claude Artifact以外(OpenAIProvider経路)===');
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', (err) => pageErrors.push(String(err)));

      const { plan, profile } = seedPlan();
      await context.addInitScript(({ plan, profile }) => {
        localStorage.setItem('paceplan.plans', JSON.stringify([plan]));
        localStorage.setItem('paceplan.profile', JSON.stringify(profile));
      }, { plan, profile });

      let lastCoachRequestBody = null;
      let coachMockMode = 'advice';
      await page.route('**/api/coach', async (route) => {
        lastCoachRequestBody = route.request().postData();
        if (coachMockMode === 'advice') {
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ mode: 'advice', summary: '今日は5kmのイージーjogにしましょう。ペースはキロ6:30目安です。', risk: null }) });
        } else if (coachMockMode === 'options') {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              mode: 'options',
              risk: '直近の高負荷練習とイベントの間隔が短くなります',
              options: [
                { label: '案1: 控えめに調整', summary: '距離を1割減らして休養日を1日追加します', plan: { meta: {}, weeks: [{ label: 'Week 1 (調整済み)', phase: 'ベース構築期', dateRange: '', items: [] }], extras: { fueling: [], cautions: [] } } },
              ],
            }),
          });
        } else if (coachMockMode === 'error') {
          await route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'coach_unavailable' }) });
        }
      });

      await page.goto(baseUrl + '/', { waitUntil: 'load' });
      await page.waitForTimeout(500);

      check('[1] アプリがAI無しでも起動する(CURRENT QUESTが表示される)', (await page.locator('text=CURRENT QUEST').count()) > 0);
      check('[1] window.claude が無い(=Claude Artifact外)環境であること', await page.evaluate(() => typeof window.claude === 'undefined'));

      // コーチタブへ
      const coachNav = page.locator('.bottom-nav *').filter({ hasText: 'コーチ' }).first();
      await coachNav.click({ force: true });
      await page.waitForTimeout(300);
      check('[2] OpenAIProvider経路でもコーチタブが非表示にならない(adjust-formが見える)', (await page.locator('#adjust-form').count()) > 0);

      // --- advice応答 ---
      coachMockMode = 'advice';
      await page.locator('#adjust-input').fill('今日の練習メニューどうすればいい?');
      await page.locator('.chat-send-btn').click();
      await page.waitForSelector('.chat-bubble', { timeout: 10000 });
      await page.waitForTimeout(300);
      const threadTextAfterAdvice = await page.locator('#coach-thread').innerText();
      check('[3] advice応答がチャットに表示される', threadTextAfterAdvice.includes('イージーjog'));
      check('[8] コーチへのリクエストにPB(自己ベスト)情報が含まれる', !!lastCoachRequestBody && lastCoachRequestBody.includes('自己ベスト') && lastCoachRequestBody.includes('40:00'));
      check('[8] コーチへのリクエストにシューズ情報が含まれる', !!lastCoachRequestBody && lastCoachRequestBody.includes('E2Eテストシューズ'));

      // --- options応答 + プラン変更フロー ---
      const planBeforeChoice = await page.evaluate(() => JSON.parse(localStorage.getItem('paceplan.plans')).find(p => p.id === 'aqualine-2026').weeks[0].label);
      check('[5] 選択肢提示の直後はまだプランが変更されていない', planBeforeChoice === 'Week 1');

      coachMockMode = 'options';
      await page.locator('#adjust-input').fill('来月ファンランが入ったので調整して');
      await page.locator('.chat-send-btn').click();
      await page.waitForSelector('.option-choose-btn', { timeout: 10000 });
      const planStillBeforeChoice = await page.evaluate(() => JSON.parse(localStorage.getItem('paceplan.plans')).find(p => p.id === 'aqualine-2026').weeks[0].label);
      check('[5] 選択肢カード表示後・選択前はプラン未変更のまま', planStillBeforeChoice === 'Week 1');

      await page.locator('.option-choose-btn').first().click();
      await page.waitForTimeout(300);
      const planAfterChoice = await page.evaluate(() => JSON.parse(localStorage.getItem('paceplan.plans')).find(p => p.id === 'aqualine-2026').weeks[0].label);
      check('[6] 選択肢を選ぶとプランが更新される', planAfterChoice === 'Week 1 (調整済み)');
      check('[4] options応答(選択肢カード)が表示された', true); // 上のwaitForSelectorが成功した時点で満たされている

      // --- APIエラー時の挙動 ---
      coachMockMode = 'error';
      await page.locator('#adjust-input').fill('もう一度相談したい');
      await page.locator('.chat-send-btn').click();
      await page.waitForTimeout(1000);
      const threadTextAfterError = await page.locator('#coach-thread').innerText();
      check('[9] APIエラー時に指定のエラーメッセージが表示される', threadTextAfterError.includes('コーチとの通信に失敗しました。少し時間を置いてもう一度お試しください'));
      check('[9] APIエラーでページ自体はクラッシュしていない(pageerror無し)', pageErrors.length === 0);

      // 他機能(マイページ)が引き続き使えること
      const mypageNav = page.locator('.bottom-nav *').filter({ hasText: 'マイページ' }).first();
      await mypageNav.click({ force: true });
      await page.waitForTimeout(300);
      check('[9] コーチAPIエラー後もマイページ等、他の機能は利用できる', (await page.locator('text=RUNNER PROFILE').count()) > 0);

      await context.close();
    }

    console.log('=== scenario 2: Claude Artifact内(sample capability経由。既存動作の非破壊確認)===');
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      const { plan, profile } = seedPlan();

      let sampleCalled = false;
      let coachFetchCalled = false;
      await context.addInitScript(({ plan, profile }) => {
        localStorage.setItem('paceplan.plans', JSON.stringify([plan]));
        localStorage.setItem('paceplan.profile', JSON.stringify(profile));
        // Claude Artifact環境を模倣する: window.claude.use('sample') が使えるようにする
        window.claude = {
          use: async (name) => {
            if (name !== 'sample') return null;
            const fn = async (prompt, opts) => {
              window.__e2e_sampleCalled = true;
              return { mode: 'advice', summary: 'Claude Artifact経由のテスト応答です', risk: null };
            };
            fn.json = fn;
            return fn;
          },
        };
      }, { plan, profile });

      // Claude Artifact内ではCoachServiceがClaudeArtifactProviderを選ぶはずなので、
      // 万一ここに到達した場合(=OpenAIProviderが誤って選ばれた場合)を検知できるよう、
      // 明らかに別経路とわかる内容を返しておく(下のcoachApiHitで実際に到達したかも別途検証する)
      await page.route('**/api/coach', async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ mode: 'advice', summary: 'これはOpenAI経路の応答(呼ばれてはいけない)', risk: null }) });
      });
      let coachApiHit = false;
      page.on('request', (req) => { if (req.url().includes('/api/coach')) coachApiHit = true; });

      await page.goto(baseUrl + '/', { waitUntil: 'load' });
      await page.waitForTimeout(500);

      const coachNav = page.locator('.bottom-nav *').filter({ hasText: 'コーチ' }).first();
      await coachNav.click({ force: true });
      await page.waitForTimeout(300);
      await page.locator('#adjust-input').fill('相談です');
      await page.locator('.chat-send-btn').click();
      await page.waitForSelector('.chat-bubble', { timeout: 10000 });
      await page.waitForTimeout(300);

      sampleCalled = await page.evaluate(() => !!window.__e2e_sampleCalled);
      const threadText = await page.locator('#coach-thread').innerText();
      check('[12] Claude Artifact内ではClaudeArtifactProvider(sample capability)が使われる', sampleCalled);
      check('[12] Claude Artifact内では /api/coach へは一切リクエストされない', !coachApiHit);
      check('[12] Claude Artifact版の応答がそのままチャットに表示される(既存動作維持)', threadText.includes('Claude Artifact経由のテスト応答'));

      await context.close();
    }

    console.log('=== scenario 3: プラン週境界(月曜始まり) ===');
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(baseUrl + '/', { waitUntil: 'load' });
      await page.waitForTimeout(300);

      // デフォルト開始日は、月曜なら当日、それ以外なら次の月曜。
      await page.locator('[data-action="tab"][data-tab="create"]').first().click({ force: true });
      const defaultStart = await page.locator('#f_startDate').evaluate((element) => element.value);
      check('[日付] 新規プランの開始日初期値は次の月曜日', defaultStart === nextMondayIso(new Date()));

      const mondayPlan = await createPlan(page, { name: '月曜開始テスト', startDate: '2026-09-14', raceDate: '2026-10-04' });
      const mondayWeek1Dates = mondayPlan.weeks[0].items.map((item) => item.date).filter(Boolean);
      check('[日付] 月曜開始: Week 1は月曜〜日曜の表示期間', mondayPlan.weeks[0].dateRange === '9/14〜9/20');
      check('[日付] 月曜開始: Week 1の曜日メニューが正しい日付に並ぶ', JSON.stringify(mondayWeek1Dates) === JSON.stringify(['2026-09-14', '2026-09-16', '2026-09-19', '2026-09-20']));

      const midweekPlan = await createPlan(page, { name: '水曜開始テスト', startDate: '2026-09-09', raceDate: '2026-09-27' });
      const midweekWeek1Dates = midweekPlan.weeks[0].items.map((item) => item.date).filter(Boolean);
      const midweekWeek2Dates = midweekPlan.weeks[1].items.map((item) => item.date).filter(Boolean);
      check('[日付] 水曜開始: 初週は開始日を含む月曜〜日曜', midweekPlan.weeks[0].dateRange === '9/7〜9/13');
      check('[日付] 水曜開始: 開始日前の月曜メニューを生成しない', JSON.stringify(midweekWeek1Dates) === JSON.stringify(['2026-09-09', '2026-09-12', '2026-09-13']));
      check('[日付] 水曜開始: 翌月曜のMP走はWeek 2に入る', midweekPlan.weeks[1].dateRange === '9/14〜9/20' && midweekWeek2Dates[0] === '2026-09-14');

      const monthPlan = await createPlan(page, { name: '月またぎテスト', startDate: '2026-09-30', raceDate: '2026-10-18' });
      const monthWeek1Dates = monthPlan.weeks[0].items.map((item) => item.date).filter(Boolean);
      check('[日付] 月またぎ: Week 1の表示期間は月曜〜日曜をまたぐ', monthPlan.weeks[0].dateRange === '9/28〜10/4');
      check('[日付] 月またぎ: 開始日以降の水・土・日だけを生成する', JSON.stringify(monthWeek1Dates) === JSON.stringify(['2026-09-30', '2026-10-03', '2026-10-04']));

      const racePlan = await createPlan(page, { name: 'レース週テスト', startDate: '2026-09-14', raceDate: '2026-09-23' });
      const raceWeek = racePlan.weeks[racePlan.weeks.length - 1];
      const datedRaceItems = raceWeek.items.map((item) => item.date).filter(Boolean);
      check('[日付] レース週: 表示期間はレース後も含む月曜〜日曜', raceWeek.dateRange === '9/21〜9/27');
      check('[日付] レース週: レース日をまたぐトレーニングを生成しない', datedRaceItems.every((date) => date <= '2026-09-23') && datedRaceItems.includes('2026-09-23'));

      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error('failed checks:', failures.join(', '));
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
