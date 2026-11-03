#!/usr/bin/env bash
# End-to-end updater test on an Android emulator. Run by .github/workflows/updater-e2e.yml.
# Expects in ./e2e-out: old-good.apk, old-badsig.apk, old-badsum.apk (version 1.0.1, each following
# a different test release), and the test releases already published on GitHub.
set -euo pipefail
PKG=com.opencard.app
HERE=$(cd "$(dirname "$0")" && pwd)
OUT=${OUT:-e2e-out}
mkdir -p "$OUT/shots"
step() { echo; echo "=== $* ==="; }
shot() { adb exec-out screencap -p > "$OUT/shots/$1.png" || true; }
js() { node "$HERE/cdp.mjs" eval "$1"; }
wait_js() { node "$HERE/cdp.mjs" wait "$1" "${2:-60}" || { shot "fail-$(date +%s)"; adb logcat -d -s Updater:* AndroidRuntime:E | tail -50; exit 1; }; }
version_code() { adb shell dumpsys package $PKG | grep -m1 -o 'versionCode=[0-9]*' | cut -d= -f2; }

launch() {
  adb shell am force-stop $PKG || true
  adb shell am start -W -n $PKG/.MainActivity >/dev/null
  for i in $(seq 1 30); do
    SOCK=$(adb shell cat /proc/net/unix | grep -o 'webview_devtools_remote_[0-9]*' | head -n1 || true)
    [ -n "$SOCK" ] && break; sleep 1
  done
  [ -n "$SOCK" ] || { echo "no WebView devtools socket"; exit 1; }
  adb forward --remove-all || true
  adb forward tcp:9222 localabstract:$SOCK >/dev/null
  wait_js "window.OpenCard && OpenCard.updater && OpenCard.updater.available" 60
}

tap_text() { # tap a button in Android's own UI (e.g. the installer) by its label
  for i in $(seq 1 40); do
    adb exec-out uiautomator dump /dev/tty > "$OUT/ui.xml" 2>/dev/null || true
    if XY=$(python3 "$HERE/tap.py" "$OUT/ui.xml" "$1"); then shot "installer"; adb shell input tap $XY; return 0; fi
    sleep 2
  done
  echo "button '$1' not found"; shot "no-button"; return 1
}

files_in_cache() { # lists the app-private update folder (test builds are debuggable, so run-as works)
  adb shell "run-as $PKG ls cache/updates 2>/dev/null" | tr -d '\r' || true
}

wifi_only() {
  adb shell svc data disable || true
  adb shell svc wifi enable
  for i in $(seq 1 30); do adb shell dumpsys connectivity | grep -q 'WIFI.*VALIDATED\|VALIDATED.*WIFI' && return 0; sleep 2; done
  echo "Wi-Fi did not come up"; adb shell dumpsys connectivity | head -40; exit 1
}

step "Setup: Wi-Fi only"
wifi_only

step "1. Good update: auto-check on launch -> download -> verify -> permission -> Android confirmation -> installed"
adb uninstall $PKG >/dev/null 2>&1 || true
adb install -r "$OUT/old-good.apk"
[ "$(version_code)" = "1" ]
adb shell appops set $PKG REQUEST_INSTALL_PACKAGES default # like a fresh install: not yet allowed
launch
wait_js "document.getElementById('update-banner') && /1\\.0\\.2/.test(document.getElementById('update-banner').textContent)" 90
shot "1-banner"
js "OpenCard.updater.open()"
wait_js "OpenCard.updater.state.state==='available' && /Download/.test(document.querySelector('.update-dialog').textContent)" 30
shot "1-available"
js "document.querySelector('.update-dialog [data-a=download]').click()"
wait_js "OpenCard.updater.state.state==='ready'" 180
shot "1-ready"
echo "cache after download: $(files_in_cache)"
files_in_cache | grep -q '^update-1.0.2.apk$'
js "document.querySelector('.update-dialog [data-a=install]').click()"
wait_js "OpenCard.updater.state.state==='needs_permission'" 30
shot "1-needs-permission"
# The user grants "Allow from this source" in Android Settings; the test does the same via appops.
adb shell appops set $PKG REQUEST_INSTALL_PACKAGES allow
adb shell input keyevent KEYCODE_HOME
sleep 1
adb shell am start -n $PKG/.MainActivity >/dev/null   # back to the app -> onResume continues the install
tap_text '(update|install)'                           # Android's own confirmation screen
for i in $(seq 1 60); do [ "$(version_code)" = "2" ] && break; sleep 2; done
echo "installed versionCode: $(version_code)"
[ "$(version_code)" = "2" ]
sleep 3
echo "cache after install: '$(files_in_cache)'"
[ -z "$(files_in_cache)" ]   # PackageReplacedReceiver removed the installer file
adb shell dumpsys package $PKG | grep -m1 versionName

step "2. Wrong signing key: downloaded, rejected, deleted"
adb uninstall $PKG >/dev/null
adb install -r "$OUT/old-badsig.apk"
launch
js "OpenCard.updater.check()"
wait_js "OpenCard.updater.state.state==='available'" 90
js "document.querySelector('.update-dialog [data-a=download]').click()"
wait_js "OpenCard.updater.state.state==='error' && OpenCard.updater.state.errorKind==='SIGNATURE_MISMATCH'" 180
shot "2-badsig"
[ -z "$(files_in_cache)" ]
[ "$(version_code)" = "1" ]

step "3. Checksum mismatch: refused before installing"
adb uninstall $PKG >/dev/null
adb install -r "$OUT/old-badsum.apk"
launch
js "OpenCard.updater.check()"
wait_js "OpenCard.updater.state.state==='available'" 90
js "document.querySelector('.update-dialog [data-a=download]').click()"
wait_js "OpenCard.updater.state.state==='error' && OpenCard.updater.state.errorKind==='CHECKSUM_MISMATCH'" 180
shot "3-badsum"
[ -z "$(files_in_cache)" ]

step "4. Mobile data only: no check, no download"
adb shell svc wifi disable
adb shell svc data enable || true
sleep 8
js "OpenCard.updater.check()"
wait_js "OpenCard.updater.state.state==='error' && (OpenCard.updater.state.errorKind==='NOT_WIFI' || OpenCard.updater.state.errorKind==='OFFLINE')" 60
js "JSON.stringify(OpenCard.updater.state)"
shot "4-no-wifi"
adb shell svc wifi enable

echo; echo "ALL UPDATER E2E SCENARIOS PASSED"
