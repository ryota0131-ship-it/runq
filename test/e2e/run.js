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
const CAPTURE_DIR = path.join(ROOT, 'test-artifacts', 'coach-companion');

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

async function captureIfRequested(page, name, fullPage = false) {
  if (!process.env.RUNQ_CAPTURE) return;
  fs.mkdirSync(CAPTURE_DIR, { recursive: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(CAPTURE_DIR, name), fullPage });
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
      { label: 'Week 1', phase: 'ベース構築期', dateRange: '', items: [
        { type: 'long', day: '日', date: today, title: 'ロング走', desc: '14km。余裕を残せるペースで。' },
      ] },
    ],
    extras: { fueling: [], cautions: [] },
    history: [],
  };
  const profile = {
    pbs: [{ label: '10km', timeLabel: '40:00' }],
    shoes: [{ id: 'shoe1', name: 'E2Eテストシューズ', brand: 'TestBrand', active: true }],
    weeklyRunDays: 3,
    availableWeekdays: ['3', '6', '0'],
    longestRunManualKm: 12,
    injuryNote: '',
    constitutionNote: '',
    scheduleNote: '',
    onboarding: { version: 1, walkthroughCompleted: true, profileCompleted: true, draft: null },
  };
  const workouts = [{
    id: 'health-today-14km', user_id: 'runner_e2e',
    started_at: today + 'T06:30:00.000', ended_at: today + 'T08:18:25.000',
    duration_seconds: 6505, distance_meters: 14000, average_pace_seconds_per_km: 465,
    average_heart_rate: 142, max_heart_rate: 156, calories: 860,
    source: 'apple_health', source_workout_id: 'apple-e2e-today-14km', source_device: 'Apple Watch',
    imported_at: today + 'T09:00:00.000', created_at: today + 'T09:00:00.000', updated_at: today + 'T09:00:00.000',
    plan_id: 'aqualine-2026', scheduled_item_ref: 'aqualine-2026:w0-i0', scheduled_item_date: today,
    completion_status: 'matched', time_precision: 'exact',
    source_refs: [{ source: 'apple_health', source_workout_id: 'apple-e2e-today-14km' }],
    duplicate_candidate_ids: [], metadata: { note: '後半も余裕あり', rpe: 2, pain: { level: 0, parts: [] } },
  }];
  return { plan, profile, workouts };
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

      const { plan, profile, workouts } = seedPlan();
      await context.addInitScript(({ plan, profile, workouts }) => {
        if (!localStorage.getItem('paceplan.plans')) localStorage.setItem('paceplan.plans', JSON.stringify([plan]));
        if (!localStorage.getItem('paceplan.profile')) localStorage.setItem('paceplan.profile', JSON.stringify(profile));
        if (!localStorage.getItem('paceplan.workouts')) localStorage.setItem('paceplan.workouts', JSON.stringify(workouts));
      }, { plan, profile, workouts });

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
      await page.waitForFunction(() => (document.querySelector('.forecast-card') || {}).innerText && document.querySelector('.forecast-card').innerText.includes('直近4週の実走'));
      const forecastText = await page.locator('.forecast-card').innerText();
      check('[予測] Health同期済み14kmを直近4週の実走として集計する', forecastText.includes('直近4週の実走') && forecastText.includes('14km'));
      check('[予測] データ不足時は秒単位・好調時/安全目安で断定しない', forecastText.includes('走力の目安') && !forecastText.includes('好調時') && !forecastText.includes('安全目安') && !forecastText.includes('データ十分に基づく予想'));

      // コーチタブへ
      const coachNav = page.locator('.bottom-nav *').filter({ hasText: 'コーチ' }).first();
      await coachNav.click({ force: true });
      await page.waitForTimeout(300);
      check('[2] OpenAIProvider経路でもコーチタブが非表示にならない(adjust-formが見える)', (await page.locator('#adjust-form').count()) > 0);

      // --- advice応答 ---
      coachMockMode = 'advice';
      await page.locator('#adjust-input').fill('今日の練習メニュー');
      await page.locator('#adjust-input').press('Enter');
      await page.locator('#adjust-input').type('どうすればいい?');
      check('[3] コーチ入力欄ではEnterで改行でき、送信されない', (await page.locator('#adjust-input').inputValue()) === '今日の練習メニュー\nどうすればいい?' && !lastCoachRequestBody);
      await page.locator('.chat-send-btn').click();
      await page.waitForSelector('.chat-bubble', { timeout: 10000 });
      await page.waitForTimeout(300);
      const threadTextAfterAdvice = await page.locator('#coach-thread').innerText();
      check('[3] advice応答がチャットに表示される', threadTextAfterAdvice.includes('イージーjog'));
      await captureIfRequested(page, 'coach-chat.png');
      check('[8] コーチへのリクエストにPB(自己ベスト)情報が含まれる', !!lastCoachRequestBody && lastCoachRequestBody.includes('自己ベスト') && lastCoachRequestBody.includes('40:00'));
      check('[8] コーチへのリクエストにシューズ情報が含まれる', !!lastCoachRequestBody && lastCoachRequestBody.includes('E2Eテストシューズ'));
      check('[コーチ文脈] 今日のHealth同期済み14kmと予定メニューが含まれる', !!lastCoachRequestBody && lastCoachRequestBody.includes('Appleヘルスケア') && lastCoachRequestBody.includes('14km') && lastCoachRequestBody.includes('ロング走') && lastCoachRequestBody.includes('RPE 2/4'));

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
      check('[9] コーチAPIエラー後もマイページ等、他の機能は利用できる', (await page.locator('text=ランナープロフィール').count()) > 0);

      check('[コーチ] マイページで3種類のコーチを比較できる', await page.locator('[data-action="select-coach-persona"]').count() === 3);
      await page.locator('[data-action="select-coach-persona"][data-persona="analyst"]').click();
      await page.waitForTimeout(100);
      check('[コーチ] 分析型の選択をプロフィールへ保存する', await page.evaluate(() => JSON.parse(localStorage.getItem('paceplan.profile')).coachPersona === 'analyst'));
      await page.reload({ waitUntil: 'load' });
      await page.locator('.bottom-nav *').filter({ hasText: 'マイページ' }).first().click({ force: true });
      await page.waitForTimeout(250);
      const companionAfterReload = { profile: await page.evaluate(() => JSON.parse(localStorage.getItem('paceplan.profile') || '{}').coachPersona), selected: await page.locator('[data-action="select-coach-persona"][data-persona="analyst"][aria-pressed="true"]').count() };
      check('[コーチ] 再起動後も選択したコーチを保持する', companionAfterReload.profile === 'analyst' && companionAfterReload.selected === 1);
      await captureIfRequested(page, 'companion-selection.png', true);
      await page.locator('.bottom-nav *').filter({ hasText: 'コーチ' }).first().click({ force: true });
      await page.waitForTimeout(250);
      coachMockMode = 'advice';
      await page.locator('#adjust-input').fill('コーチの確認です');
      await page.locator('.chat-send-btn').click();
      await page.waitForFunction(() => document.querySelectorAll('#coach-thread .chat-msg').length > 1);
      check('[コーチ] 選択した口調指示を既存のコーチ呼び出しへ追加する', !!lastCoachRequestBody && lastCoachRequestBody.includes('冷静な分析型'));

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

    console.log('=== scenario 3: Capacitor版AI Coach ===');
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      const { plan, profile } = seedPlan();
      await context.addInitScript(({ plan, profile }) => {
        localStorage.setItem('paceplan.plans', JSON.stringify([plan]));
        localStorage.setItem('paceplan.profile', JSON.stringify(profile));
        window.Capacitor = { isNativePlatform: () => true, Plugins: {} };
      }, { plan, profile });
      let nativeApiHit = false;
      await page.route('https://runq-umber.vercel.app/api/coach', async (route) => {
        nativeApiHit = true;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' },
          body: JSON.stringify({ mode: 'advice', summary: 'iPhoneアプリ経由の応答です', risk: null }),
        });
      });
      await page.goto(baseUrl + '/', { waitUntil: 'load' });
      await page.locator('.bottom-nav *').filter({ hasText: 'コーチ' }).first().click({ force: true });
      await page.locator('#adjust-input').fill('iPhoneから相談です');
      await page.locator('.chat-send-btn').click();
      await page.waitForTimeout(300);
      const nativeThreadText = await page.locator('#coach-thread').innerText();
      check('[Capacitor] コーチAPIはVercel本番URLへ送信する', nativeApiHit && nativeThreadText.includes('iPhoneアプリ経由の応答です'));
      await context.close();
    }

    console.log('=== scenario 4: iOS HealthKit取り込み ===');
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      const today = new Date().toISOString().slice(0, 10);
      const { plan, profile } = seedPlan();
      plan.weeks = [{ label: 'Week 1', phase: 'ベース構築期', dateRange: '', items: [
        { type: 'easy', day: '今日', date: today, title: 'イージー', desc: '8km' },
      ] }];
      await context.addInitScript(({ plan, profile, today }) => {
        localStorage.setItem('paceplan.plans', JSON.stringify([plan]));
        localStorage.setItem('paceplan.profile', JSON.stringify(profile));
        const start = `${today}T06:30:00.000Z`;
        const end = `${today}T07:20:00.000Z`;
        const health = {
          isAvailable: async () => ({ available: true, platform: 'ios' }),
          requestAuthorization: async () => ({ readAuthorized: ['workouts', 'heartRate', 'distance', 'calories'], readDenied: [], writeAuthorized: [], writeDenied: [] }),
          queryWorkouts: async () => ({ workouts: [{ workoutType: 'running', duration: 3000, totalDistance: 8240, totalEnergyBurned: 510, startDate: start, endDate: end, sourceName: 'Apple Watch', platformId: 'healthkit-e2e-1' }] }),
          readSamples: async () => ({ samples: [{ value: 145 }, { value: 155 }, { value: 150 }] }),
        };
        window.Capacitor = { isNativePlatform: () => true, registerPlugin: () => health, Plugins: { Health: health } };
      }, { plan, profile, today });
      await page.goto(baseUrl + '/', { waitUntil: 'load' });
      await page.locator('.bottom-nav *').filter({ hasText: 'マイページ' }).first().click({ force: true });
      await page.locator('[data-action="mypage-nav"][data-view="data-connections"]').click();
      await page.locator('[data-action="health-connect"][data-platform="appleHealth"]').click();
      await page.waitForTimeout(500);
      const healthData = await page.evaluate(() => ({
        workouts: JSON.parse(localStorage.getItem('paceplan.workouts') || '[]'),
        logs: JSON.parse(localStorage.getItem('paceplan.logs.aqualine-2026') || '{}'),
        progress: JSON.parse(localStorage.getItem('paceplan.progress.aqualine-2026') || '{}'),
        profile: JSON.parse(localStorage.getItem('paceplan.profile') || '{}'),
      }));
      check('[HealthKit] Running Workoutを共通Workoutとして保存する', healthData.workouts.length === 1 && healthData.workouts[0].source === 'apple_health' && healthData.workouts[0].distance_meters === 8240 && healthData.workouts[0].average_heart_rate === 150 && healthData.workouts[0].max_heart_rate === 155);
      check('[HealthKit] 同日の予定メニューへ自動反映する', healthData.logs[today] && healthData.logs[today].source === 'apple_health' && healthData.progress['w0-0'] === true);
      check('[HealthKit] 連携状態と最終同期日時を保存する', healthData.profile.healthConnections.appleHealth.enabled === true && !!healthData.profile.healthConnections.appleHealth.lastSyncedAt);
      await page.locator('[data-action="health-sync"][data-platform="appleHealth"]').click();
      await page.waitForTimeout(300);
      const repeatedSyncWorkouts = await page.evaluate(() => JSON.parse(localStorage.getItem('paceplan.workouts') || '[]'));
      check('[重複] 同じ外部記録を繰り返し同期しても1件のまま', repeatedSyncWorkouts.length === 1 && repeatedSyncWorkouts[0].source_workout_id === 'healthkit-e2e-1');
      await page.evaluate(() => {
        const button = document.querySelector('[data-action="health-sync"][data-platform="appleHealth"]');
        button.click(); button.click();
      });
      await page.waitForTimeout(300);
      const concurrentSyncWorkouts = await page.evaluate(() => JSON.parse(localStorage.getItem('paceplan.workouts') || '[]'));
      check('[重複] 同期操作が同時に走っても外部記録は1件のまま', concurrentSyncWorkouts.length === 1);
      await page.locator('[data-action="mypage-nav"][data-view="main"]').click();
      const mypageText = await page.locator('.form-card').innerText();
      check('[マイページ] 今月の集計と最近のワークアウトに共通Workoutを表示する', mypageText.includes('今月のランニング') && mypageText.includes('8km') && mypageText.includes('最近のワークアウト'));
      await page.locator('[data-action="mypage-nav"][data-view="workout-history"]').click();
      check('[マイページ] すべての記録画面へ遷移できる', (await page.locator('.form-card').innerText()).includes('これまでの記録'));
      await page.locator('[data-action="open-workout-detail"]').first().click();
      check('[マイページ] ワークアウト詳細に実績と予定の関係を表示する', (await page.locator('.form-card').innerText()).includes('ワークアウト詳細') && (await page.locator('.form-card').innerText()).includes('予定：イージー'));
      await context.close();
    }

    console.log('=== scenario 4b: 取得元横断の重複候補と安全な統合 ===');
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      const today = new Date().toISOString().slice(0, 10);
      const { plan, profile } = seedPlan();
      await context.addInitScript(({ plan, profile, today }) => {
        localStorage.setItem('paceplan.plans', JSON.stringify([plan]));
        localStorage.setItem('paceplan.profile', JSON.stringify(profile));
        // スクリーンショットは実行時刻まで読めたケース: Healthと確実に同一なら自動統合する。
        localStorage.setItem('paceplan.workouts', JSON.stringify([{
          id: 'screenshot-1', started_at: `${today}T06:30:00.000Z`, ended_at: `${today}T08:18:00.000Z`, duration_seconds: 6480, distance_meters: 14000,
          source: 'screenshot', source_workout_id: 'screenshot-1', source_refs: [{ source: 'screenshot', source_workout_id: 'screenshot-1' }], time_precision: 'exact',
          metadata: { note: '給水を1回', image_import: { startTime: '06:30' } }, created_at: `${today}T09:00:00.000Z`
        }]));
        const health = {
          isAvailable: async () => ({ available: true, platform: 'ios' }),
          requestAuthorization: async () => ({ readDenied: [] }),
          queryWorkouts: async () => ({ workouts: [{ duration: 6480, totalDistance: 14000, startDate: `${today}T06:30:00.000Z`, endDate: `${today}T08:18:00.000Z`, platformId: 'health-same-run', sourceName: 'Apple Watch' }] }),
          readSamples: async () => ({ samples: [] }),
        };
        window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios', Plugins: { Health: health }, registerPlugin: () => health };
      }, { plan, profile, today });
      await page.goto(baseUrl + '/', { waitUntil: 'load' });
      await page.locator('.bottom-nav *').filter({ hasText: 'マイページ' }).first().click({ force: true });
      await page.locator('[data-action="mypage-nav"][data-view="data-connections"]').click();
      await page.locator('[data-action="health-connect"][data-platform="appleHealth"]').click();
      await page.waitForTimeout(300);
      const screenshotAndHealth = await page.evaluate(() => JSON.parse(localStorage.getItem('paceplan.workouts') || '[]'));
      check('[重複] 画像とHealthで開始・距離・時間が一致する記録は1件に統合し、画像メモを残す', screenshotAndHealth.length === 1 && screenshotAndHealth[0].metadata.note === '給水を1回' && screenshotAndHealth[0].source_refs.length === 2);
      await context.close();
    }

    console.log('=== scenario 4c: あいまいな手入力は確認後だけ統合 ===');
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      const today = new Date().toISOString().slice(0, 10);
      const { plan, profile } = seedPlan();
      await context.addInitScript(({ plan, profile, today }) => {
        localStorage.setItem('paceplan.plans', JSON.stringify([plan]));
        localStorage.setItem('paceplan.profile', JSON.stringify(profile));
        // 手入力には開始時刻が無い。日付と距離が近いだけではHealth記録を自動削除しない。
        localStorage.setItem('paceplan.workouts', JSON.stringify([{
          id: 'manual-1', started_at: `${today}T12:00:00.000`, duration_seconds: 6480, distance_meters: 14000,
          source: 'manual', source_workout_id: 'manual-1', source_refs: [{ source: 'manual', source_workout_id: 'manual-1' }], time_precision: 'estimated', metadata: { note: '手入力メモ' }
        }]));
        const health = {
          isAvailable: async () => ({ available: true, platform: 'ios' }), requestAuthorization: async () => ({ readDenied: [] }),
          // 夕方のほぼ同距離ランも返す。同日2回でも外部IDと時刻の重なりが無いので別記録として残る。
          queryWorkouts: async () => ({ workouts: [
            { duration: 6480, totalDistance: 14000, startDate: `${today}T06:30:00.000Z`, endDate: `${today}T08:18:00.000Z`, platformId: 'health-morning', sourceName: 'Apple Watch' },
            { duration: 6500, totalDistance: 14100, startDate: `${today}T18:30:00.000Z`, endDate: `${today}T20:18:20.000Z`, platformId: 'health-evening', sourceName: 'Apple Watch' },
          ] }), readSamples: async () => ({ samples: [] }),
        };
        window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios', Plugins: { Health: health }, registerPlugin: () => health };
      }, { plan, profile, today });
      await page.goto(baseUrl + '/', { waitUntil: 'load' });
      await page.locator('.bottom-nav *').filter({ hasText: 'マイページ' }).first().click({ force: true });
      await page.locator('[data-action="mypage-nav"][data-view="data-connections"]').click();
      await page.locator('[data-action="health-connect"][data-platform="appleHealth"]').click();
      await page.waitForTimeout(300);
      const beforeConfirmation = await page.evaluate(() => JSON.parse(localStorage.getItem('paceplan.workouts') || '[]'));
      check('[重複] 時刻が不明な手入力は同日・近距離でも自動統合せず、同日2回のHealth記録も残す', beforeConfirmation.length === 3 && beforeConfirmation.some((w) => (w.duplicate_candidate_ids || []).length));
      await page.locator('[data-action="mypage-nav"][data-view="main"]').click();
      await page.locator('[data-action="mypage-nav"][data-view="workout-history"]').click();
      await page.locator('[data-action="open-workout-detail"][data-id="manual-1"]').click();
      check('[重複] あいまいな記録には確認メッセージを表示する', (await page.locator('.form-card').innerText()).includes('同じランニングの可能性があります'));
      await page.locator('[data-action="request-workout-merge"]').first().click();
      check('[重複] 統合前に確認ダイアログを表示する', (await page.locator('.modal-card').innerText()).includes('統合しますか'));
      await page.locator('[data-action="confirm-workout-merge"]').click();
      await page.waitForTimeout(200);
      const afterConfirmation = await page.evaluate(() => JSON.parse(localStorage.getItem('paceplan.workouts') || '[]'));
      check('[重複] 確認後の統合だけが保存・集計対象を減らし、別時間帯のランは残す', afterConfirmation.length === 2 && afterConfirmation.some((w) => w.source_workout_id === 'health-evening'));
      await context.close();
    }

    console.log('=== scenario 5: プラン週境界(月曜始まり) ===');
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      // 新規プラン作成フォーム(#gen-form)は、ランニングプロフィール(週の回数・曜日・
      // 最長ロング走)が設定済み(profileTrainingReady())でないと表示されず、代わりに
      // 「先にランニングプロフィールを設定してください」という別画面になる。
      // このシナリオはプラン作成そのものを検証するため、事前にプロフィールを投入しておく
      const { profile: seededProfile, plan: seededPlan } = seedPlan();
      await context.addInitScript(({ profile, plan }) => {
        localStorage.setItem('paceplan.profile', JSON.stringify(profile));
        localStorage.setItem('paceplan.plans', JSON.stringify([plan]));
      }, { profile: seededProfile, plan: seededPlan });
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

    console.log('=== scenario 6: 初回ウォークスルーとレースなしQUEST ===');
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(baseUrl + '/', { waitUntil: 'load' });
      check('[初回導線] 新規利用者にウォークスルーを表示する', await page.locator('.onboarding').count() === 1 && (await page.locator('.onboarding').innerText()).includes('目標から'));
      await page.locator('[data-action="onboarding-next"]').click();
      await page.locator('[data-action="onboarding-next"]').click();
      await page.locator('[data-action="onboarding-next"]').click();
      await page.locator('input[name="ob-name"]').fill('テストランナー');
      await page.locator('#onboarding-profile-form button[type="submit"]').click();
      await page.locator('#onboarding-profile-form button[type="submit"]').click();
      await page.locator('[data-action="onboarding-day"][data-day="1"]').click();
      await page.locator('#onboarding-profile-form button[type="submit"]').click();
      await page.locator('#onboarding-profile-form button[type="submit"]').click();
      await page.locator('[data-action="onboarding-quest-type"][data-type="first_5k"]').click();
      await page.locator('[data-action="onboarding-quest-next"]').click();
      await page.locator('#onboarding-quest-form button[type="submit"]').click();
      await page.locator('[data-action="onboarding-create"]').click();
      await page.waitForTimeout(150);
      const firstRun = await page.evaluate(() => ({ plans: JSON.parse(localStorage.getItem('paceplan.plans') || '[]'), profile: JSON.parse(localStorage.getItem('paceplan.profile') || '{}') }));
      check('[初回導線] 5km QUESTを生成し、プロフィールと完了状態を保存する', firstRun.plans.length === 1 && firstRun.plans[0].meta.questType === 'first_5k' && firstRun.profile.onboarding.profileCompleted === true);
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
