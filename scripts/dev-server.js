#!/usr/bin/env node
/**
 * dev-server.js
 *
 * dist/ を配信するだけの、依存パッケージ無しの最小static serverです。
 * `npm install` すら不要にするための最小実装(Node標準モジュールのみ)。
 * ビルドツール導入を避け、現状の「素のHTML/CSS/JS」という構成を保つための選択です。
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

const server = http.createServer((req, res) => {
  let reqPath = decodeURIComponent(req.url.split('?')[0]);
  if (reqPath === '/') reqPath = '/index.html';
  const filePath = path.join(ROOT, reqPath);
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
});
