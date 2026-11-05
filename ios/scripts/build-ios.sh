#!/bin/bash
# Build with a real iOS SDK. Neither output is a device-installable signed IPA.
set -euo pipefail

TASK_IOS_ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
TASK_BUILD_KIND="${1:-all}"
TASK_OUTPUT_ROOT="${2:-/private/tmp/Tooplay-iOS-builds}"
case "$TASK_BUILD_KIND" in
  simulator|device|all) ;;
  -h|--help) echo "Usage: $0 [simulator|device|all] [output-directory]"; exit 0 ;;
  *) echo "Usage: $0 [simulator|device|all] [output-directory]" >&2; exit 2 ;;
esac

if [ -z "${DEVELOPER_DIR:-}" ]; then
  TASK_SELECTED_DEVELOPER="$(xcode-select -p 2>/dev/null || true)"
  if [ -x "$TASK_SELECTED_DEVELOPER/usr/bin/xcodebuild" ]; then
    export DEVELOPER_DIR="$TASK_SELECTED_DEVELOPER"
  elif [ -x /Applications/Xcode.app/Contents/Developer/usr/bin/xcodebuild ]; then
    export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
  else
    echo "전체 Xcode가 필요합니다. Xcode를 설치하고 한 번 실행한 뒤 이 명령을 다시 실행하세요." >&2
    echo "다른 경로에 설치했다면 DEVELOPER_DIR=/path/Xcode.app/Contents/Developer 를 지정하세요." >&2
    exit 2
  fi
fi
if [ ! -x "$DEVELOPER_DIR/usr/bin/xcodebuild" ]; then
  echo "DEVELOPER_DIR에 전체 Xcode가 없습니다: $DEVELOPER_DIR" >&2; exit 2
fi
TASK_XCODEBUILD="$DEVELOPER_DIR/usr/bin/xcodebuild"
if ! "$TASK_XCODEBUILD" -checkFirstLaunchStatus >/dev/null 2>&1; then
  echo "Xcode를 한 번 열어 라이선스와 추가 구성요소 설치를 완료하세요." >&2; exit 2
fi
if [ "$TASK_BUILD_KIND" != device ]; then
  xcrun --sdk iphonesimulator --show-sdk-path >/dev/null
fi
if [ "$TASK_BUILD_KIND" != simulator ]; then
  xcrun --sdk iphoneos --show-sdk-path >/dev/null
fi

python3 - "$TASK_IOS_ROOT" "$TASK_OUTPUT_ROOT" <<'PY'
from pathlib import Path
import sys
source,output=(Path(p).resolve() for p in sys.argv[1:])
if output == source or source in output.parents:
    sys.exit('출력 폴더는 iOS 소스 폴더 밖에 지정하세요. 예: /private/tmp/Tooplay-iOS-builds')
PY

mkdir -p "$TASK_OUTPUT_ROOT"
TASK_RUN="$(mktemp -d "$TASK_OUTPUT_ROOT/Tooplay.XXXXXX")"
TASK_STAGE="$TASK_RUN/source"
mkdir -p "$TASK_STAGE"
# Stage outside synced project folders; preserve the user's existing Team/Bundle ID.
python3 - "$TASK_IOS_ROOT" "$TASK_STAGE" <<'PY'
from pathlib import Path
import shutil,sys
source,stage=map(Path,sys.argv[1:])
for name in ['Tooplay','Tooplay.xcodeproj']:
    shutil.copytree(source/name,stage/name,ignore=shutil.ignore_patterns('xcuserdata','.DS_Store'))
PY

TASK_COMMON=(-project "$TASK_STAGE/Tooplay.xcodeproj" -scheme Tooplay -clonedSourcePackagesDirPath "$TASK_RUN/Packages")
"$TASK_XCODEBUILD" -version | tee "$TASK_RUN/xcode-version.txt"
"$TASK_XCODEBUILD" "${TASK_COMMON[@]}" -resolvePackageDependencies 2>&1 | tee "$TASK_RUN/packages.log"

if [ "$TASK_BUILD_KIND" != device ]; then
  "$TASK_XCODEBUILD" "${TASK_COMMON[@]}" -configuration Debug \
    -destination 'generic/platform=iOS Simulator' -derivedDataPath "$TASK_RUN/DerivedData" \
    -resultBundlePath "$TASK_RUN/Simulator.xcresult" \
    CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO build 2>&1 | tee "$TASK_RUN/simulator-build.log"
  TASK_SIM_APP="$TASK_RUN/DerivedData/Build/Products/Debug-iphonesimulator/Tooplay.app"
  test -f "$TASK_SIM_APP/Info.plist" && test -x "$TASK_SIM_APP/Tooplay"
  ditto -c -k --keepParent "$TASK_SIM_APP" "$TASK_RUN/Tooplay-iOS-Simulator.app.zip"
fi

if [ "$TASK_BUILD_KIND" != simulator ]; then
  "$TASK_XCODEBUILD" "${TASK_COMMON[@]}" -configuration Release \
    -destination 'generic/platform=iOS' -derivedDataPath "$TASK_RUN/DerivedData" \
    -archivePath "$TASK_RUN/Tooplay-unsigned.xcarchive" \
    -resultBundlePath "$TASK_RUN/DeviceArchive.xcresult" \
    CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO SKIP_INSTALL=NO archive 2>&1 | tee "$TASK_RUN/device-archive.log"
  TASK_DEVICE_APP="$TASK_RUN/Tooplay-unsigned.xcarchive/Products/Applications/Tooplay.app"
  test -f "$TASK_DEVICE_APP/Info.plist" && test -x "$TASK_DEVICE_APP/Tooplay"
  ditto -c -k --keepParent "$TASK_RUN/Tooplay-unsigned.xcarchive" "$TASK_RUN/Tooplay-iOS-unsigned.xcarchive.zip"
fi

python3 - "$TASK_RUN" "$TASK_BUILD_KIND" <<'PY'
from pathlib import Path
import hashlib,json,sys
root=Path(sys.argv[1])
artifacts={p.name:{'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(root.glob('*.zip'))}
report={'build':sys.argv[2],'xcode':(root/'xcode-version.txt').read_text().strip(),'artifacts':artifacts,
        'deviceSigned':False,'deviceInstalled':False,'simulatorExecuted':False,
        'notice':'Build artifacts only. The simulator app runs only in Simulator. The unsigned device archive requires Personal Team/developer signing and a registered device before installation.'}
(root/'build-result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
PY
echo "빌드 결과: $TASK_RUN"
echo "서명된 IPA는 생성하지 않았습니다. 개인 기기 설치는 Xcode에서 Personal Team과 연결된 기기를 선택해 실행하세요."
