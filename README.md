# Tooplay

기기의 동영상과 자막을 재생하고 Chromecast로 보내거나, 휴대폰에서 컴퓨터의 Tooplay를 조작하는 앱입니다.

| 구성 | 버전 | 내용 |
| --- | --- | --- |
| [Android](android/README.md) | 0.3.2 · 코드 4 | 전체화면, 원본 비율/화면 채우기, 자막, Chromecast, 컴퓨터 리모컨 |
| [iPhone·iPad](ios/README.md) | 0.3.2 · 빌드 3 | 전체화면, 화면 비율, 소리 재생 개선, 자막, Chromecast, 컴퓨터 리모컨 |
| [데스크톱](desktop/README.md) | 0.3.0 | 로컬 재생, 자막, Chromecast 전송, 모바일·브라우저 리모컨 연결 |

## Android 설치

[v0.3.2 릴리스](https://github.com/karan211-Bruno/tooplay/releases/tag/v0.3.2)에서 **Tooplay-0.3.2-android-test.apk**를 Android 기기로 다운로드해 설치합니다. Android 6 이상용 개인 테스트판입니다. 기존에 전달한 0.3.0 APK와 같은 인증서를 사용하므로 삭제 없이 업데이트할 수 있습니다.

**내 기기 영상 → 영상 열기 → 전체화면** 순서로 사용합니다.

- **원본 비율**: 영상을 자르지 않고 전체를 보여 줍니다. 화면 비율에 따라 검은 여백이 생깁니다.
- **화면 채우기**: 비율을 유지하며 화면을 채웁니다. 영상 가장자리 일부는 잘릴 수 있고 자막은 화면 안에 남습니다.
- **닫기** 또는 Android 뒤로 가기로 돌아옵니다. 전체화면 전환과 회전 시 재생 위치와 자막을 유지합니다.

릴리스에는 APK, 설치 안내, SHA-256 파일이 있습니다. iPhone·iPad는 아래 소스를 본인 Apple 계정으로 빌드해 설치합니다.

## 컴퓨터 리모컨

컴퓨터 Tooplay에서 **휴대폰 연결**을 켜고, 같은 Wi-Fi의 모바일 앱에 표시된 주소와 6자리 연결 코드를 입력합니다. 앱 설치 없이 휴대폰 브라우저에서 해당 주소를 열어도 됩니다. 재생·일시정지·탐색·음량·자막과 컴퓨터의 TV 전송을 조작합니다.

## 개발

각 플랫폼 폴더의 README에 필요한 도구와 상세 절차가 있습니다.

```sh
# 데스크톱: Node.js와 npm
cd desktop
npm ci
npm test
npm start

# Android: JDK 17, Android SDK 34, Build Tools 34.0.0
cd ../android
./gradlew assembleDebug testDebugUnitTest

# iPhone·iPad: macOS와 Xcode
cd ../ios
./scripts/check.sh
open Tooplay.xcodeproj
```

Android SDK 위치는 `local.properties` 또는 `ANDROID_HOME`으로 설정합니다. iOS 기기 설치는 Xcode의 Signing & Capabilities에서 본인의 Team을 지정합니다. 저장소에 개인 서명 키와 기기 프로비저닝 프로파일은 포함하지 않습니다.

## 검증 범위

Android 0.3.2는 JVM 테스트 6개와 API 34 ARM64 에뮬레이터 테스트 4개를 통과했습니다. 전체화면, 두 비율의 실제 영상 크기, 회전, 한국어 자막, 재생 위치 유지, 뒤로 가기, 실제 터치 재생·일시정지를 확인했습니다.

iOS 0.3.2는 빌드, 실제 영상 레이어 검사와 iPad 시뮬레이터 전체화면 시험을 통과했고 개인 iPad에 설치·실행했습니다. 실제 Android 기기와 모바일 앱에서 실제 Chromecast로 전송하는 장시간 시험은 아직 하지 않았습니다. [플랫폼별 검증 요약](docs/validation.md)을 참고하세요.
