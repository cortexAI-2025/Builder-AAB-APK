#!/usr/bin/env bash
# Executed only in the untrusted build container, never on the API host.
set -euo pipefail
root="${1:?project root required}"
[[ -f "$root/package.json" ]] || exit 0
command -v node >/dev/null && command -v npm >/dev/null || { echo 'Node.js/npm absent from builder image' >&2; exit 1; }
kind=$(node -e 'const p=require(process.argv[1]);const d={...p.devDependencies,...p.dependencies};console.log(d.expo?"expo":d["react-native"]?"react-native":"other")' "$root/package.json")
[[ "$kind" != other ]] || { echo 'Unsupported JavaScript project' >&2; exit 1; }
[[ -f "$root/package-lock.json" ]] || { echo 'A committed package-lock.json is required; yarn/pnpm need an explicit adapter' >&2; exit 1; }
cd "$root"
# Lockfile resolution and engine check; lifecycle scripts disabled by default.
timeout 600 npm ci --ignore-scripts --engine-strict --no-audit --no-fund
if [[ "$kind" == expo && ! -d android ]]; then
    [[ -f app.json || -f app.config.js || -f app.config.ts ]] || { echo 'Expo config missing' >&2; exit 1; }
    [[ -x node_modules/.bin/expo ]] || exit 1
    CI=1 timeout 300 node_modules/.bin/expo prebuild --platform android --no-install
fi
[[ -f android/gradlew ]] || { echo 'Android project not generated; native config/plugins require adaptation' >&2; exit 1; }
