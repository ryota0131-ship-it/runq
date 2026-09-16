const assert = require('assert');
const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '..', 'app', 'runq.html'), 'utf8');

assert.ok(app.includes('const BACKGROUND_THEMES'), 'background themes are centrally defined');
assert.ok(app.includes('--bg:#f5f7fa'), 'RUNQ base theme has tokens');
['snow','ice','mint','sand','lavender','night'].forEach((theme) => {
  assert.ok(app.includes('data-theme="' + theme + '"'), theme + ' has theme tokens');
});
assert.ok(app.includes('backgroundTheme:\'runq\''), 'existing profiles default to RUNQ theme');
assert.ok(app.includes('data-action="select-background-theme"'), 'settings renders persistent theme choices');
assert.ok(app.includes('document.documentElement.dataset.theme=theme'), 'theme applies to the entire app at render time');
assert.ok(!app.includes('prefers-color-scheme'), 'device color scheme does not override the selected RUNQ theme');
assert.ok(app.includes('let html = \'<div class="mypage-main">\';'), 'main My Page no longer has a surrounding form card');

console.log('background theme checks: passed');
