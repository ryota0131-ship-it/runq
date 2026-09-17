const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_PROJECT_PATH = path.join(
  __dirname,
  '..',
  'ios',
  'App',
  'App.xcodeproj',
  'project.pbxproj'
);

function readBuildNumbers(source) {
  return [...source.matchAll(/CURRENT_PROJECT_VERSION = (\d+);/g)].map((match) => Number(match[1]));
}

function updateBuildNumber(projectPath, requestedNumber) {
  const source = fs.readFileSync(projectPath, 'utf8');
  const buildNumbers = readBuildNumbers(source);

  if (buildNumbers.length === 0) {
    throw new Error('CURRENT_PROJECT_VERSION が見つかりません。');
  }

  if (new Set(buildNumbers).size !== 1) {
    throw new Error(`Debug/Release のビルド番号が一致していません: ${buildNumbers.join(', ')}`);
  }

  const nextNumber = requestedNumber ?? buildNumbers[0] + 1;
  if (!Number.isSafeInteger(nextNumber) || nextNumber < 1) {
    throw new Error('ビルド番号には1以上の整数を指定してください。');
  }

  const updated = source.replace(
    /CURRENT_PROJECT_VERSION = \d+;/g,
    `CURRENT_PROJECT_VERSION = ${nextNumber};`
  );
  fs.writeFileSync(projectPath, updated);
  return nextNumber;
}

function parseArguments(args) {
  const setIndex = args.indexOf('--set');
  if (setIndex === -1) return {};

  const value = Number(args[setIndex + 1]);
  if (!Number.isSafeInteger(value)) {
    throw new Error('--set の後に整数を指定してください。');
  }
  return { requestedNumber: value };
}

if (require.main === module) {
  try {
    const { requestedNumber } = parseArguments(process.argv.slice(2));
    const nextNumber = updateBuildNumber(DEFAULT_PROJECT_PATH, requestedNumber);
    console.log(`iOS build number: ${nextNumber}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { parseArguments, readBuildNumbers, updateBuildNumber };
