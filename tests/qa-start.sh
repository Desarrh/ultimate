#!/usr/bin/env bash
# Starts a test Ultimate that never disturbs the user (rule 0 in C:\Dev\DIRECTION.md):
# separate profile (dev.local.launcher.qa), window created invisible and without focus, --hidden,
# ULTIMATE_TEST_SANDBOX (no real game, no real Vigie, no notification, never closes the installed
# Ultimate), low-priority build. Then drive it with: node tests/qol.mjs <out> <calls.log>
# Usage: tests/qa-start.sh <sandbox folder>   (stop: kill the target\debug ultimate.exe and vite)
set -e
SANDBOX="$1"
[ -d "$SANDBOX" ] || { echo "usage: $0 <sandbox folder>"; exit 2; }
cd "$(dirname "$0")/.."
CONF='{"identifier":"dev.local.launcher.qa","app":{"windows":[{"label":"main","title":"Ultimate QA","width":1440,"height":900,"minWidth":960,"minHeight":620,"backgroundColor":"#0A0A0C","visible":false,"focus":false}]}}'
(cd src-tauri && TAURI_CONFIG="$CONF" cmd //c "start /belownormal /b /wait cargo build" )
# fakes inside the sandbox: a game that only sleeps, a Vigie that logs its calls (tests/fakes)
mkdir -p "$SANDBOX/fakegame" "$SANDBOX/fakevigie"
[ -f "$SANDBOX/fakegame/Game.exe" ] || rustc -O tests/fakes/game.rs -o "$SANDBOX/fakegame/Game.exe"
[ -f "$SANDBOX/fakevigie/Vigie.exe" ] || rustc -O tests/fakes/vigie.rs -o "$SANDBOX/fakevigie/Vigie.exe"
rm -f "$SANDBOX"/fakegame/*.pdb "$SANDBOX"/fakevigie/*.pdb
touch -d 2020-01-01 src-tauri/target/debug/ultimate.exe # belt and braces: older than any running Ultimate
(nohup npx vite --port 1420 --strictPort < /dev/null > "${TEMP:-/tmp}/vite-qa.log" 2>&1 &)
sleep 3
(cd src-tauri && ULTIMATE_TEST_SANDBOX="$(cygpath -w "$SANDBOX")" WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 \
  nohup ./target/debug/ultimate.exe --hidden < /dev/null > "${TEMP:-/tmp}/ult-qa.log" 2>&1 &)
for i in $(seq 1 30); do curl -s http://127.0.0.1:9222/json/version > /dev/null && exit 0; sleep 1; done
echo "test app not reachable"; exit 1
