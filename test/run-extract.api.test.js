#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');
const extract = require(path.resolve(__dirname, '..', 'api', 'run-extract.js'));

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok - ' + name); }
  catch (err) { failed++; console.error('  FAIL - ' + name); console.error(err.stack || err); }
}
function req(body, method) { return { method: method || 'POST', body }; }
function res() {
  return { statusCode:null, body:null, status(code){ this.statusCode=code; return this; }, json(body){ this.body=body; return this; } };
}
const tinyPng = 'data:image/png;base64,iVBORw0KGgo=';
const output = {
  activityDate:'2026-09-09', startTime:'19:58', distanceKm:4.2, durationMin:29.75, avgPace:'7:05 /km', avgHr:145,
  maxHr:null, calories:344, elevationGainM:null, cadence:null, activityType:'running', activityName:null, sourceApp:'Garmin',
  confidence:{activityDate:'high',startTime:'high',distanceKm:'high',durationMin:'high',avgPace:'high',avgHr:'medium'}
};

(async function main(){
  console.log('api/run-extract.js unit tests');
  await test('画像を構造化して返し、OpenAIには画像入力として渡す', async () => {
    let payload;
    const response = res();
    await extract.handler(req({imageDataUrl:tinyPng}), response, { apiKey:'test-key', model:'test-model', fetchImpl:async (_, options) => {
      payload=JSON.parse(options.body);
      return {ok:true,status:200,json:async()=>({output_text:JSON.stringify(output)})};
    }});
    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(response.body.avgPace, '7:05');
    assert.strictEqual(response.body.distanceKm, output.distanceKm);
    assert.strictEqual(payload.input[1].content[1].type, 'input_image');
    assert.strictEqual(payload.input[1].content[1].image_url, tinyPng);
    assert.ok(JSON.stringify(response.body).indexOf('test-key') === -1);
  });
  await test('画像以外・不正なdata URLは400', async () => {
    const response=res(); await extract.handler(req({imageDataUrl:'data:text/plain;base64,SGVsbG8='}), response, {apiKey:'test-key'});
    assert.strictEqual(response.statusCode,400); assert.strictEqual(response.body.error,'invalid_image');
  });
  await test('ペースの単位つき表記をm:ssへ正規化する', async () => {
    assert.strictEqual(extract.normalizePace('7:05/km'), '7:05');
    assert.strictEqual(extract.normalizePace("7'05\""), '7:05');
    assert.strictEqual(extract.normalizePace('7分 05秒'), '7:05');
    assert.strictEqual(extract.normalizePace('不明'), null);
  });
  await test('POST以外は405', async () => {
    const response=res(); await extract.handler(req({},'GET'), response, {apiKey:'test-key'});
    assert.strictEqual(response.statusCode,405);
  });
  await test('APIキー未設定時は画像を解析しない', async () => {
    const response=res(); await extract.handler(req({imageDataUrl:tinyPng}), response, {});
    assert.strictEqual(response.statusCode,500); assert.strictEqual(response.body.error,'extract_unavailable');
  });
  await test('OpenAIのレート制限は429として返す', async () => {
    const response=res(); await extract.handler(req({imageDataUrl:tinyPng}), response, {apiKey:'test-key',fetchImpl:async()=>({ok:false,status:429})});
    assert.strictEqual(response.statusCode,429); assert.strictEqual(response.body.error,'rate_limited');
  });
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exitCode=failed?1:0;
})();
