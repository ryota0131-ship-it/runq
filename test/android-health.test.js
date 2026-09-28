const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

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
assert.ok(app.includes("for(const workoutType of ['running'])"), 'only running workouts are queried');
assert.ok(!app.includes("for(const workoutType of ['running','walking'])"), 'walking workouts are not imported');
assert.ok(app.includes('isRunningHealthWorkout(nativeWorkout,workoutType)'), 'returned workout types are also checked before saving');
assert.ok(app.includes("metadata: { workout_type:'running' }"), 'saved Health workouts retain their running type');
assert.ok(app.includes('source_workout_id'), 'external workout identity is preserved for upsert');
assert.ok(app.includes('deletedWorkoutRefs'), 'deleted synced workout identities are preserved to prevent re-import');
assert.ok(app.includes('request-workout-delete'), 'workout detail offers a confirmed delete action');
assert.ok(app.includes('この記録を削除'), 'workout detail makes the delete action visible independently from sharing');
assert.ok(app.includes('rememberHealthConnectionError'), 'connection errors are persisted for a retry UI');
assert.ok(app.includes('health-open-settings'), 'Health Connect settings can be opened after an error');
assert.ok(app.includes("data-action=\"health-resync\""), 'a user can safely re-read the initial window after a missed import');
assert.ok(app.includes('state.healthSyncDiagnostics'), 'Android sync exposes local diagnostics for emulator investigation');
assert.ok(app.includes('lastScannedAt'), 'a zero-result scan is recorded separately from the import cursor');
assert.ok(app.includes('distanceForHealthWorkout'), 'distance is retried from the time-matched distance samples when native aggregation is absent');

function extractFunction(name) {
  const marker = `function ${name}(`;
  const plainStart = app.indexOf(marker);
  assert.ok(plainStart >= 0, `${name} exists`);
  const start = app.slice(Math.max(0, plainStart - 6), plainStart) === 'async ' ? plainStart - 6 : plainStart;
  const bodyStart = app.indexOf('{', start);
  let depth = 0;
  for (let i = bodyStart; i < app.length; i += 1) {
    if (app[i] === '{') depth += 1;
    else if (app[i] === '}') {
      depth -= 1;
      if (depth === 0) return app.slice(start, i + 1);
    }
  }
  throw new Error(`could not extract ${name}`);
}

const sandbox = { Date, Math, Number, String, Promise, console, Set };
vm.createContext(sandbox);
vm.runInContext(`
  const HEALTH_INITIAL_LOOKBACK_DAYS=90;
  const HEALTH_INCREMENTAL_OVERLAP_MS=2*60*60*1000;
  async function heartRateForWorkout(){ return { average:null, max:null }; }
  ${extractFunction('healthSyncWindow')}
  ${extractFunction('shouldAdvanceHealthCursor')}
  ${extractFunction('normalizedHealthWorkoutType')}
  ${extractFunction('isRunningHealthWorkout')}
  ${extractFunction('distanceForHealthWorkout')}
  ${extractFunction('healthWorkoutToRunq')}
  ${extractFunction('workoutRefKey')}
  ${extractFunction('workoutRefKeys')}
  ${extractFunction('hasSharedExternalRef')}
  ${extractFunction('workoutOverlapSeconds')}
  ${extractFunction('workoutMatchKind')}
`, sandbox);

// running + 同時間帯のDistanceは5kmのRUNQ共通Workoutになる。
(async function runHealthSyncBehaviorTests(){
  assert.strictEqual(sandbox.isRunningHealthWorkout({ workoutType:'running' }, 'running'), true, 'running is accepted');
  assert.strictEqual(sandbox.isRunningHealthWorkout({ workoutType:'walking' }, 'running'), false, 'walking is rejected');
  const nativeWorkout = { workoutType:'running', startDate:'2026-09-28T09:43:00.000Z', endDate:'2026-09-28T10:13:00.000Z', duration:1800, platformId:'toolbox-run-1' };
  const runq = await sandbox.healthWorkoutToRunq({
    readSamples: async () => ({ samples:[{ value:5000, startDate:nativeWorkout.startDate, endDate:nativeWorkout.endDate }] })
  }, nativeWorkout, 'android');
  assert.strictEqual(runq.distance_meters, 5000, 'the matching Distance sample is attached to the running session');
  assert.strictEqual(runq.duration_seconds, 1800, 'ExerciseSession duration is retained');
  assert.strictEqual(runq.source, 'health_connect', 'Android sessions retain their source');

  const sameAgain = Object.assign({ source:'health_connect', source_workout_id:'toolbox-run-1', source_refs:[{source:'health_connect',source_workout_id:'toolbox-run-1'}], time_precision:'exact' }, runq);
  const existing = Object.assign({}, sameAgain, { id:'saved-run' });
  assert.strictEqual(sandbox.workoutMatchKind(existing, sameAgain), 'exact', 'the same Health Connect ID is deduplicated on a re-sync');

  const boundary = sandbox.healthSyncWindow('2026-09-28T10:19:00.000Z', Date.parse('2026-09-28T10:30:00.000Z'), false);
  assert.strictEqual(boundary.startDate, '2026-09-28T08:19:00.000Z', 'the incremental window overlaps the cursor by two hours');
  assert.strictEqual(sandbox.shouldAdvanceHealthCursor({ accepted:0 }), false, 'an empty query does not advance the import cursor');
  assert.strictEqual(sandbox.shouldAdvanceHealthCursor({ accepted:1 }), true, 'a confirmed running session advances the import cursor');
  const full = sandbox.healthSyncWindow('2026-09-28T10:19:00.000Z', Date.parse('2026-09-28T10:30:00.000Z'), true);
  assert.strictEqual(full.startDate, '2026-06-30T10:30:00.000Z', 'manual re-sync safely re-reads the initial 90-day window');
  console.log('android Health Connect behavior tests: passed');
})().catch(function(error){ console.error(error); process.exitCode=1; });

console.log('android Health Connect checks: passed');
