#!/usr/bin/env node
/**
 * test/coach.api.test.js
 *
 * api/coach.js の単体テスト。フレームワーク・依存パッケージは使わず、
 * Node標準の assert とグローバル fetch のモック(opts.fetchImpl差し替え)だけで検証する。
 *
 * 実行方法: node test/coach.api.test.js
 */
'use strict';

const assert = require('assert');
const { EventEmitter } = require('events');
const path = require('path');

const coach = require(path.resolve(__dirname, '..', 'api', 'coach.js'));

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL - ${name}`);
    console.error(`    ${err && err.stack ? err.stack : err}`);
  }
}

/** リクエストのモック(POSTボディをbodyに直接持たせる。api/coach.jsのreadJsonBodyはreq.bodyを優先して読む) */
function makeReq(body, method) {
  return { method: method || 'POST', body };
}

/** レスポンスのモック(Vercelのres.status().json()規約を再現し、呼ばれた内容を記録する) */
function makeRes() {
  const res = {
    statusCode: null,
    body: null,
    status(code) { res.statusCode = code; return res; },
    json(payload) { res.body = payload; return res; },
  };
  return res;
}

/** OpenAI Responses APIのHTTPレスポンスを模したfetchモックを作る */
function fakeOpenAIFetch({ ok = true, status = 200, outputText = '{"mode":"advice","summary":"ok","risk":null}' } = {}) {
  return async () => ({
    ok,
    status,
    async json() {
      return { output: [{ type: 'message', content: [{ type: 'output_text', text: outputText }] }] };
    },
  });
}

async function main() {
  console.log('api/coach.js unit tests');

  await test('正常系: promptを渡すとOpenAIの応答をそのまま返す', async () => {
    const req = makeReq({ prompt: '今日のメニューについて相談です' });
    const res = makeRes();
    await coach.handler(req, res, {
      apiKey: 'test-key',
      model: 'test-model',
      fetchImpl: fakeOpenAIFetch({ outputText: '{"mode":"advice","summary":"今日は軽めのjogにしましょう","risk":null}' }),
    });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.mode, 'advice');
    assert.strictEqual(res.body.summary, '今日は軽めのjogにしましょう');
    // APIキーがレスポンスに一切含まれていないこと
    assert.ok(JSON.stringify(res.body).indexOf('test-key') === -1);
  });

  await test('mode:optionsの既存レスポンス形式(options[].{label,summary,plan})をそのまま透過する', async () => {
    const optionsPayload = {
      mode: 'options',
      summary: 'プラン変更案です',
      risk: null,
      options: [
        { label: '控えめ案', summary: '距離を10%減らします', plan: { meta: { name: 'test' }, weeks: [] } },
      ],
    };
    const req = makeReq({ prompt: '来週のプランを緩めてほしい' });
    const res = makeRes();
    await coach.handler(req, res, {
      apiKey: 'test-key',
      fetchImpl: fakeOpenAIFetch({ outputText: JSON.stringify(optionsPayload) }),
    });
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res.body, optionsPayload);
  });

  await test('GET等POST以外のメソッドは405 method_not_allowed', async () => {
    const req = makeReq(undefined, 'GET');
    const res = makeRes();
    await coach.handler(req, res, { apiKey: 'test-key' });
    assert.strictEqual(res.statusCode, 405);
    assert.strictEqual(res.body.error, 'method_not_allowed');
  });

  await test('promptが空文字列の場合は400 invalid_request', async () => {
    const req = makeReq({ prompt: '' });
    const res = makeRes();
    await coach.handler(req, res, { apiKey: 'test-key' });
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.error, 'invalid_request');
  });

  await test('promptが上限文字数を超える場合は413 prompt_too_large', async () => {
    const req = makeReq({ prompt: 'あ'.repeat(60001) });
    const res = makeRes();
    await coach.handler(req, res, { apiKey: 'test-key' });
    assert.strictEqual(res.statusCode, 413);
    assert.strictEqual(res.body.error, 'prompt_too_large');
  });

  await test('OPENAI_API_KEY未設定(かつopts.apiKeyも無し)の場合は500 coach_unavailable', async () => {
    const req = makeReq({ prompt: 'こんにちは' });
    const res = makeRes();
    const savedKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      await coach.handler(req, res, {});
    } finally {
      if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
    }
    assert.strictEqual(res.statusCode, 500);
    assert.strictEqual(res.body.error, 'coach_unavailable');
  });

  await test('OpenAI側がレート制限(429)の場合は429 rate_limitedとして伝播する', async () => {
    const req = makeReq({ prompt: 'こんにちは' });
    const res = makeRes();
    await coach.handler(req, res, {
      apiKey: 'test-key',
      fetchImpl: fakeOpenAIFetch({ ok: false, status: 429 }),
    });
    assert.strictEqual(res.statusCode, 429);
    assert.strictEqual(res.body.error, 'rate_limited');
  });

  await test('OpenAI側がその他のエラー(500系)の場合は502 coach_unavailable(内部詳細は漏らさない)', async () => {
    const req = makeReq({ prompt: 'こんにちは' });
    const res = makeRes();
    await coach.handler(req, res, {
      apiKey: 'test-key',
      fetchImpl: fakeOpenAIFetch({ ok: false, status: 500 }),
    });
    assert.strictEqual(res.statusCode, 502);
    assert.strictEqual(res.body.error, 'coach_unavailable');
  });

  await test('ネットワークエラー(fetch自体が例外)の場合は502 coach_unavailable', async () => {
    const req = makeReq({ prompt: 'こんにちは' });
    const res = makeRes();
    await coach.handler(req, res, {
      apiKey: 'test-key',
      fetchImpl: async () => { throw new Error('network down'); },
    });
    assert.strictEqual(res.statusCode, 502);
    assert.strictEqual(res.body.error, 'coach_unavailable');
  });

  await test('OpenAIの出力がJSONとしてparseできない場合は502 invalid_json', async () => {
    const req = makeReq({ prompt: 'こんにちは' });
    const res = makeRes();
    await coach.handler(req, res, {
      apiKey: 'test-key',
      fetchImpl: fakeOpenAIFetch({ outputText: 'これはJSONではありません' }),
    });
    assert.strictEqual(res.statusCode, 502);
    assert.strictEqual(res.body.error, 'invalid_json');
  });

  await test('OpenAIの出力に mode が無い場合は502 invalid_json', async () => {
    const req = makeReq({ prompt: 'こんにちは' });
    const res = makeRes();
    await coach.handler(req, res, {
      apiKey: 'test-key',
      fetchImpl: fakeOpenAIFetch({ outputText: '{"foo":"bar"}' }),
    });
    assert.strictEqual(res.statusCode, 502);
    assert.strictEqual(res.body.error, 'invalid_json');
  });

  await test('OPENAI_MODELが未指定の場合、DEFAULT_MODELが実際にOpenAIへ渡るリクエストに使われる', async () => {
    const req = makeReq({ prompt: 'こんにちは' });
    const res = makeRes();
    let capturedBody = null;
    await coach.handler(req, res, {
      apiKey: 'test-key',
      // model省略 → DEFAULT_MODELが使われるはず
      fetchImpl: async (url, init) => {
        capturedBody = JSON.parse(init.body);
        return fakeOpenAIFetch()();
      },
    });
    assert.strictEqual(capturedBody.model, coach.DEFAULT_MODEL);
  });

  await test('readJsonBody: req.bodyが無い場合はNode標準のストリームからも読み取れる(ローカルdev-server経由を想定)', async () => {
    const req = new EventEmitter();
    req.method = 'POST';
    const res = makeRes();
    const promise = coach.handler(req, res, {
      apiKey: 'test-key',
      fetchImpl: fakeOpenAIFetch({ outputText: '{"mode":"advice","summary":"ok","risk":null}' }),
    });
    process.nextTick(() => {
      req.emit('data', Buffer.from(JSON.stringify({ prompt: 'ストリーム経由のテスト' })));
      req.emit('end');
    });
    await promise;
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.mode, 'advice');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
