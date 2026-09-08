#!/usr/bin/env node
/**
 * build.js
 *
 * runQ. のソースコード(app/runq.html)は、Claude Artifactとして公開する際の
 * 形式(<!doctype>/<html>/<head>/<body>を持たない断片: <title>/<link>/<style>の後に
 * ルート要素<div id="app">と<script>が続く)のまま管理している。
 * これはClaude Artifactへ公開する既存フローと1バイトも変えずに使い回すため。
 *
 * このスクリプトは、その断片を標準的なHTMLドキュメント(doctype + html + head + body)
 * でラップして dist/index.html を生成するだけの処理で、フレームワークやバンドラは
 * 一切使用しない(依存パッケージなし、Node標準モジュールのみ)。
 * アプリのロジック・スタイル・マークアップ自体には一切手を加えない
 * (head相当の内容とbody相当の内容を分割して所定の位置に挿入するだけ)。
 *
 * 使い方: node scripts/build.js  (または `npm run build`)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'app', 'runq.html');
const OUT_DIR = path.join(ROOT, 'dist');
const OUT_FILE = path.join(OUT_DIR, 'index.html');

const fragment = fs.readFileSync(SRC, 'utf8');

// app/runq.html は「<title>/<link>/<style>...(head相当)」に続けて
// 「<div id="app">...</div><script>...</script>(body相当)」という並びの断片。
// このマーカーでhead相当/body相当を分割する(内容自体は書き換えない)。
const BODY_MARKER = '<div class="wrap" id="app">';
const markerIndex = fragment.indexOf(BODY_MARKER);
if (markerIndex === -1) {
  console.error(`build.js: marker not found in ${SRC} — app/runq.html の構造が変わった場合はこのスクリプトの BODY_MARKER も更新してください`);
  process.exit(1);
}

const headPart = fragment.slice(0, markerIndex).trim();
const bodyPart = fragment.slice(markerIndex).trim();

const wrapped = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
${headPart}
</head>
<body>
${bodyPart}
</body>
</html>
`;

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_FILE, wrapped, 'utf8');

console.log(`built ${path.relative(ROOT, OUT_FILE)} (${wrapped.length} bytes) from ${path.relative(ROOT, SRC)}`);
