#!/usr/bin/env node
/**
 * dev-server.js
 *
 * dist/ を配信するだけの、依存パッケージ無しの最小static serverです。
 * `npm install` すら不要にするための最小実装(Node標準モジュールのみ)。
 * ビルドツール導入を避け、現状の「素のHTML/CSS/JS」という構成を保つための選択です。
 *
 * OpenAI経由のAI Coachをローカルでも試せるよう、`POST /api/coach` だけは
 * api/coach.js のハンドラへ直接橋渡しする(Vercel Dev等を導入せず、
 * 依存パッケージ無しで最小限のAPIルーティングを行うための実装)。
 * それ以外のパスは従来通り dist/ の静的ファイル配信のみ。
 *
 * 使い方: node scripts/dev-server.js [port]  (または `npm run dev`。内部でbuildも実行)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'dist');
const PORT = Number(process.argv[2]) || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

if (!fs.existsSync(path.join(ROOT, 'index.html'))) {
  console.error('dist/index.html が見つかりません。先に `npm run build` を実行してください。');
  process.exit(1);
}

/**
 * .env を読み込む最小実装(依存パッケージなし)。
 * KEY=VALUE 形式の行のみ対応(引用符・改行を含む値やコメント展開等は非対応の簡易版で十分)。
 * 既に process.env に設定済みの値は上書きしない(実行環境側の指定を優先)。
 */
function loadDotEnvIfPresent() {
  const envPath = path.resolve(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && !(key in process.env)) process.env[key] = value;
  }
}

loadDotEnvIfPresent();

const coachHandler = require(path.resolve(__dirname, '..', 'api', 'coach.js'));

function handleApiCoach(req, res) {
  // api/coach.js は Vercel の (req, res) 規約に合わせて書かれているため、
  // Node標準の http.ServerResponse に無い res.status()/res.json() をここで簡易的に付与する。
  res.status = function status(code) { res.statusCode = code; return res; };
  res.json = function json(payload) {
    const body = JSON.stringify(payload);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(body);
  };
  Promise.resolve(coachHandler(req, res)).catch((err) => {
    console.error('api/coach handler error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'coach_unavailable' });
    }
  });
}

const server = http.createServer((req, res) => {
  const reqPath = decodeURIComponent(req.url.split('?')[0]);

  if (reqPath === '/api/coach') {
    handleApiCoach(req, res);
    return;
  }

  let staticPath = reqPath;
  if (staticPath === '/') staticPath = '/index.html';
  const filePath = path.join(ROOT, staticPath);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`runQ. dev server: http://localhost:${PORT}`);
  console.log(process.env.OPENAI_API_KEY
    ? '  /api/coach: OPENAI_API_KEY 設定済み(OpenAI呼び出し有効)'
    : '  /api/coach: OPENAI_API_KEY 未設定(呼び出すと coach_unavailable エラーを返します)');
});
