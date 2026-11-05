#!/bin/bash
# Run real UI tests on an explicitly selected, disposable simulator.
set -euo pipefail
TASK_IOS_ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
if [ "$#" -lt 2 ] || [ "$#" -gt 4 ]; then
  echo "Usage: $0 /path/Tooplay.app SIMULATOR-UDID [output-directory] [desktop-fixture.json]" >&2
  exit 2
fi
TASK_APP="$1"
TASK_UDID="$2"
TASK_OUTPUT="${3:-/private/tmp/Tooplay-iOS-smoke}"
TASK_REMOTE_FIXTURE="${4:-}"
TASK_UI_TEST="${TOOPLAY_UI_TEST:-remote}"
TASK_TEST_FILTER=()
case "$TASK_UI_TEST" in
  remote)
    if [ -z "$TASK_REMOTE_FIXTURE" ]; then
      echo "Remote UI verification requires desktop-fixture.json as the fourth argument." >&2
      echo "TOOPLAY_UI_TEST=local runs the experimental Files picker UI path; use NativePlayback tests for verified native decoding." >&2
      exit 2
    fi
    TASK_TEST_FILTER=(-only-testing:SmokeTests/SmokeTests/test01DesktopRemote) ;;
  local) TASK_TEST_FILTER=(-only-testing:SmokeTests/SmokeTests/test02LocalImportPlaybackSubtitle) ;;
  all) ;;
  *) echo "TOOPLAY_UI_TEST must be remote, local or all" >&2; exit 2 ;;
esac
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
test -x "$TASK_APP/Tooplay"
python3 - "$TASK_APP/Info.plist" <<'PY'
import plistlib,sys
with open(sys.argv[1],'rb') as f: info=plistlib.load(f)
assert info.get('CFBundleIdentifier')=='com.tooplay.mobile', 'Expected the Tooplay simulator app'
assert info.get('UIFileSharingEnabled') and info.get('LSSupportsOpeningDocumentsInPlace'), 'Files sharing must be enabled for the real document picker fixture'
assert info.get('DTPlatformName')=='iphonesimulator', 'Expected a simulator build'
PY
mkdir -p "$TASK_OUTPUT"
TASK_RUN="$(mktemp -d "$TASK_OUTPUT/Smoke.XXXXXX")"
TASK_FFMPEG="${TOOPLAY_FFMPEG:-$TASK_IOS_ROOT/../desktop/node_modules/ffmpeg-static/ffmpeg}"
if [ ! -x "$TASK_FFMPEG" ]; then TASK_FFMPEG="$(command -v ffmpeg || true)"; fi
test -x "$TASK_FFMPEG"
"$TASK_FFMPEG" -hide_banner -loglevel error -f lavfi -i 'testsrc2=size=640x360:rate=30' \
  -f lavfi -i 'sine=frequency=440:sample_rate=48000:duration=30' -t 30 -c:v libx264 -preset ultrafast -pix_fmt yuv420p \
  -c:a aac -ac 2 -movflags +faststart "$TASK_RUN/Tooplay-smoke-video.mp4"
cat > "$TASK_RUN/Tooplay-smoke-subtitle.srt" <<'SRT'
1
00:00:00,000 --> 00:00:30,000
TOOPLAY 자막 확인
SRT
xcrun simctl bootstatus "$TASK_UDID" -b
xcrun simctl install "$TASK_UDID" "$TASK_APP"
TASK_CONTAINER="$(xcrun simctl get_app_container "$TASK_UDID" com.tooplay.mobile data)"
mkdir -p "$TASK_CONTAINER/Documents"
cp "$TASK_RUN/Tooplay-smoke-video.mp4" "$TASK_RUN/Tooplay-smoke-subtitle.srt" "$TASK_CONTAINER/Documents/"
TASK_GENERATE=(python3 "$TASK_IOS_ROOT/Tests/SimulatorSmoke/generate-project.py" "$TASK_RUN/Runner")
if [ -n "$TASK_REMOTE_FIXTURE" ]; then TASK_GENERATE+=("$TASK_REMOTE_FIXTURE"); fi
"${TASK_GENERATE[@]}"
echo "$TASK_RUN" > "$TASK_OUTPUT/latest-run.txt"
echo "Simulator smoke artifacts: $TASK_RUN"
TASK_XCODE_ARGS=(-project "$TASK_RUN/Runner/SmokeTests.xcodeproj" -scheme SmokeTests
  -destination "platform=iOS Simulator,id=$TASK_UDID" -destination-timeout 60
  -derivedDataPath "$TASK_RUN/DerivedData"
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO ONLY_ACTIVE_ARCH=YES)
xcodebuild "${TASK_XCODE_ARGS[@]}" build-for-testing 2>&1 | tee "$TASK_RUN/runner-build.log"
if [ -n "$TASK_REMOTE_FIXTURE" ]; then
  # A pairing code lasts two minutes. Refresh it after compiling the runner.
  node "$TASK_IOS_ROOT/Tests/SimulatorSmoke/verify-remote.js" "$TASK_REMOTE_FIXTURE" reset --revoke-clients
  cp "$TASK_REMOTE_FIXTURE" "$TASK_RUN/DerivedData/Build/Products/Debug-iphonesimulator/SmokeTests-Runner.app/PlugIns/SmokeTests.xctest/remote-fixture.json"
fi
xcodebuild "${TASK_XCODE_ARGS[@]}" -resultBundlePath "$TASK_RUN/Smoke.xcresult" \
  "${TASK_TEST_FILTER[@]}" \
  -parallel-testing-enabled NO -maximum-concurrent-test-simulator-destinations 1 \
  test-without-building 2>&1 | tee "$TASK_RUN/smoke.log"
xcrun simctl io "$TASK_UDID" screenshot "$TASK_RUN/final-screen.png"
echo "Passed real application UI checks. Result bundle: $TASK_RUN/Smoke.xcresult"
