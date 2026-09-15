const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app', 'runq.html'), 'utf8');
const manifest = fs.readFileSync(path.join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8');
const variables = fs.readFileSync(path.join(root, 'android', 'variables.gradle'), 'utf8');
const build = fs.readFileSync(path.join(root, 'scripts', 'build.js'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

assert.ok(pkg.dependencies['@capacitor/android'], 'Android Capacitor runtime is configured');
assert.ok(pkg.dependencies['@capgo/capacitor-health'], 'Health Connect adapter is configured');
assert.match(variables, /minSdkVersion\s*=\s*26/, 'Android minSdk is compatible with Health Connect SDK');
assert.match(manifest, /READ_HEALTH_DATA_HISTORY/, 'initial history access is declared');
assert.match(manifest, /READ_STEPS" tools:node="remove"/, 'unrelated Health Connect permissions are removed');
assert.ok(fs.existsSync(path.join(root, 'app', 'privacypolicy.html')), 'privacy explanation has a source asset');
assert.ok(build.includes('PRIVACY_POLICY_SRC'), 'privacy explanation is copied into the Capacitor web bundle');
assert.ok(app.includes('HEALTH_INITIAL_LOOKBACK_DAYS=90'), 'initial sync window is limited to 90 days');
assert.ok(app.includes('HEALTH_INCREMENTAL_OVERLAP_MS'), 'later syncs use a bounded overlap window');
assert.ok(app.includes("for(const workoutType of ['running','walking'])"), 'running and walking are imported through the common path');
assert.ok(app.includes('source_workout_id'), 'external workout identity is preserved for upsert');
assert.ok(app.includes('rememberHealthConnectionError'), 'connection errors are persisted for a retry UI');
assert.ok(app.includes('health-open-settings'), 'Health Connect settings can be opened after an error');

console.log('android Health Connect checks: passed');
