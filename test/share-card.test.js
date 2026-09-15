const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app', 'runq.html'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

assert.ok(pkg.dependencies['@capacitor/share'], 'native share plugin is configured');
assert.ok(pkg.dependencies['@capacitor/filesystem'], 'temporary native file handling is configured');
assert.ok(app.includes('id="share-card-canvas" width="1080" height="1920"'), 'story-size canvas exists');
assert.ok(app.includes("['photo','coach','road']"), 'all three share templates exist');
assert.ok(app.includes('RUNQ_LOGO_SRC'), 'cards use the existing RUNQ header logo asset');
assert.ok(app.includes('navigator.share'), 'web share fallback exists');
assert.ok(app.includes('pendingNativeShareFile'), 'native share retains the current temporary file while the OS share target reads it');
assert.ok(app.includes('native.Filesystem.deleteFile'), 'the prior native temporary share image is cleaned up before the next share');
assert.ok(app.includes('選択済み（この共有だけに使用）'), 'selected photos are explicitly temporary');
assert.ok(!app.includes('Store.set(\'share'), 'share card images are not persisted to the workout store');
assert.ok(app.includes('class="workout-row-share"'), 'past workout rows offer a direct share action');
assert.ok(app.includes('function workoutForCompletion'), 'plan and home resolve a saved workout before sharing');
assert.ok(app.includes('class="wmi-share"'), 'home weekly completed workouts offer sharing');

console.log('share card checks: passed');
