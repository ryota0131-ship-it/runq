const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseArguments, readBuildNumbers, updateBuildNumber } = require('../scripts/bump-ios-build');

const fixture = `
  CURRENT_PROJECT_VERSION = 7;
  CURRENT_PROJECT_VERSION = 7;
`;

assert.deepEqual(readBuildNumbers(fixture), [7, 7]);
assert.deepEqual(parseArguments([]), {});
assert.deepEqual(parseArguments(['--set', '12']), { requestedNumber: 12 });
assert.throws(() => parseArguments(['--set', 'abc']), /整数/);

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'runq-ios-release-'));
const projectPath = path.join(temporaryDirectory, 'project.pbxproj');

try {
  fs.writeFileSync(projectPath, fixture);
  assert.equal(updateBuildNumber(projectPath), 8);
  assert.deepEqual(readBuildNumbers(fs.readFileSync(projectPath, 'utf8')), [8, 8]);

  assert.equal(updateBuildNumber(projectPath, 21), 21);
  assert.deepEqual(readBuildNumbers(fs.readFileSync(projectPath, 'utf8')), [21, 21]);

  fs.writeFileSync(projectPath, fixture.replace(/7;(\s+)CURRENT/, '8;$1CURRENT'));
  assert.throws(() => updateBuildNumber(projectPath), /一致していません/);
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}

const repositoryRoot = path.join(__dirname, '..');
const schemePath = path.join(
  repositoryRoot,
  'ios',
  'App',
  'App.xcodeproj',
  'xcshareddata',
  'xcschemes',
  'App.xcscheme'
);
const ciScriptPath = path.join(repositoryRoot, 'ci_scripts', 'ci_post_clone.sh');

assert.equal(fs.existsSync(schemePath), true, '共有Schemeが必要です');
assert.match(fs.readFileSync(schemePath, 'utf8'), /BlueprintName = "App"/);
assert.equal(fs.existsSync(ciScriptPath), true, 'Xcode Cloud用スクリプトが必要です');
assert.match(fs.readFileSync(ciScriptPath, 'utf8'), /npm ci[\s\S]*npm run build[\s\S]*npx cap sync ios/);

console.log('ios-release tests passed');
