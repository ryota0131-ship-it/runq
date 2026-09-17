#!/bin/sh

set -eu

cd "${CI_PRIMARY_REPOSITORY_PATH:-$(pwd)}"

npm ci
npm run build
npx cap sync ios
