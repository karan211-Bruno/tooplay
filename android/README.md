# Tooplay Android 0.3.2 · 개인 기기 테스트판

한 앱에서 **내 기기 영상 재생·TV 전송**과 **컴퓨터 Tooplay 원격 조작**을 제공합니다.

## 설치와 사용

`Tooplay-0.3.2-android-test.apk`를 Android 기기에 내려받아 설치합니다. 기존에 전달한 0.3.0 APK와 같은 인증서로 서명하여 삭제 없이 업데이트할 수 있습니다. 이 APK는 개발용 인증서로 서명한 개인 테스트판이며 Google Play 배포용으로 서명한 버전은 아닙니다. 파일을 여는 앱에서 요청하는 ‘이 출처의 앱 설치’ 허용이 필요할 수 있습니다. Android 6(API 23) 이상을 대상으로 하며, Chromecast 기능은 Google Play 서비스를 사용하는 기기가 필요합니다.

### 전체화면과 화면 비율 (0.3.2)

- 영상 아래 **전체화면**을 누릅니다. 화면을 터치하면 재생 조작과 상단 버튼이 표시됩니다. 재생 중에는 약 4초 뒤 조작 버튼이 자동으로 숨겨집니다.
- **원본 비율**: 영상을 자르지 않고 원래 가로세로 비율을 유지합니다. 디스플레이 비율에 따라 검은 여백이 생길 수 있습니다.
- **화면 채우기**: 비율을 유지하며 화면을 채웁니다. 가장자리 일부가 잘릴 수 있으며, 자막은 화면 안에 유지됩니다.
- **닫기** 또는 Android **뒤로 가기**로 원래 화면에 돌아옵니다. 전환과 기기 회전 중에도 같은 영상·재생 위치·자막을 유지합니다.
- 선택한 비율은 다음 실행에도 저장됩니다. 이 설정은 **Android 기기의 영상 화면**에 적용됩니다.

### 내 기기 영상

1. **영상 열기**로 기기의 파일 선택기에서 영상을 고릅니다. 기기 전체 저장소 접근 권한은 요청하지 않습니다.
2. **자막 열기**로 SRT 또는 VTT를 선택합니다. UTF-8, UTF-16, EUC-KR 자막을 처리합니다(최대 4MB).
3. TV와 같은 Wi-Fi에 연결한 뒤 **TV 전송**을 누르고 Chromecast를 선택합니다.
4. TV용 파일 준비가 끝나면 현재 위치부터 전송합니다. 처음 전송할 때 전체 영상을 H.264/AAC MP4, 1280×720, 최대 30fps, 영상 목표 2.5Mbps로 변환합니다. 가로세로 비율은 유지하고 필요한 여백을 추가합니다. 긴 영상은 준비 시간과 저장 공간이 필요합니다.
5. 준비 중에는 앱을 열어 두세요. 앱을 나가면 준비가 취소됩니다. 준비 완료 후에는 전송 알림과 포그라운드 서비스로 파일을 제공합니다. 전송 중지 또는 재생 완료 시 서비스를 정리합니다.

기기 재생은 Android의 Media3/MediaCodec이 지원하는 형식에 따라 달라집니다. 모든 MKV·AVI 파일이나 모든 코덱을 보장하지 않습니다. 호환되지 않는 파일은 컴퓨터 Tooplay에서 열고 원격 조작할 수 있습니다. 이 버전은 모바일에서 MP4(H.264/AAC)를 우선 권장합니다. 모바일 내장 자막 자동 추출, 이미지 자막, SMI/ASS 외부 자막은 아직 지원하지 않습니다.

### 컴퓨터 연결

1. 컴퓨터에 Tooplay **0.3.0 이상**을 설치하고 영상을 엽니다.
2. 컴퓨터의 **휴대폰 연결**을 켭니다.
3. 모바일 **컴퓨터 연결** 화면에 표시된 주소(예: `192.168.1.20:43123`)와 6자리 코드를 입력합니다.
4. 재생·일시정지·탐색·볼륨·자막 선택·컴퓨터에서 전송할 TV 선택을 조작합니다.

| 기능 | Android 구현 |
|---|---|
| 기기 영상 재생·탐색·일시정지 | Media3 ExoPlayer |
| 전체화면·회전·화면 비율 | 원본 비율 / 비율 유지 화면 채우기, 자막 별도 표시 |
| 외부 SRT/VTT 자막 | 로컬 화면 및 TV 전달 |
| 단독 Chromecast 전송 | 기기에서 전체 파일 준비 후 HTTP Range로 제공 |
| TV 재생·탐색·볼륨·중지 | 공식 Google Cast SDK |
| 컴퓨터 연결 | 같은 LAN의 주소 + 1회용 6자리 코드 |
| 원격 재생·자막·Cast 제어 | 데스크톱 0.3 프로토콜 |
| 컴퓨터 파일 탐색·업로드 | 제공하지 않음. 컴퓨터에서 영상 열기 |

연결 토큰은 앱 메모리에만 보관합니다. 앱을 종료하거나 연결을 해제하면 다시 연결해야 합니다. 컴퓨터에서 휴대폰 연결을 끄면 권한이 철회됩니다. 통신은 같은 사설 LAN의 HTTP를 사용하므로 신뢰하는 Wi-Fi에서 사용하세요. 인터넷 포트포워딩을 설정할 필요가 없습니다.

## 빌드

JDK 17, Android SDK Platform 34 및 Build Tools 34.0.0이 필요합니다. SDK 경로는 로컬 `local.properties`의 `sdk.dir=...` 또는 `ANDROID_HOME`으로 설정합니다. Gradle 8.7 wrapper에는 배포 파일 SHA-256이 고정되어 있습니다.

```sh
./gradlew assembleDebug testDebugUnitTest
./gradlew assembleDebugAndroidTest
```

산출물: `app/build/outputs/apk/debug/app-debug.apk`. APK 생성에 사용한 개인/개발 서명 키는 소스 묶음에 포함하지 않습니다. 다른 개발 서명 키로 다시 만든 APK는 기존 테스트판을 삭제한 뒤 설치해야 할 수 있습니다.

실제 Android 에뮬레이터/기기에서:

```sh
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb shell am instrument -w -e class com.tooplay.mobile.DeviceSmokeTest com.tooplay.mobile.test/androidx.test.runner.AndroidJUnitRunner
adb shell am instrument -w -e class com.tooplay.mobile.FullscreenPlaybackTest com.tooplay.mobile.test/androidx.test.runner.AndroidJUnitRunner
```

실제 데스크톱과 연결하는 별도 통합 테스트 `DesktopRemoteTest`는 `desktopAddress`, `desktopCode` instrumentation 인수가 필요합니다. 12초 테스트 영상과 자막을 컴퓨터에 열고 위치0에서 일시정지한 별도 테스트 세션을 사용합니다. 인수가 없으면 이 테스트만 건너뜁니다. 실제 TV를 켜거나 현재 콘텐츠를 바꾸는 자동 테스트는 포함하지 않습니다.

## 검증 범위

0.3.2의 검증 결과는 [검증 요약](../docs/validation.md)에 정리했습니다. 아래 기존 데스크톱 연동·TV 파일 변환 기록은 0.3.0부터의 검증 이력을 포함합니다.

- 6개 JVM 테스트: HTTP 바이트 범위, 잘못된 범위 거부, 한국어/인코딩/타임코드 유지, 잘못된 자막 거부, 사설 주소 제한.
- API 34 ARM64 에뮬레이터: 실제 영상 디코딩·재생·탐색·일시정지, 실제 한국어 자막 큐, HTTP 206/416/비공개 경로 검사.
- 실행 중인 패키지된 macOS Tooplay 0.3.0과 Android 앱을 연결해 재생·일시정지·10초 탐색·자막 목록·연결 해제를 검증했습니다.
- 실제 앱의 TV 파일 준비 경로로 4초·60fps 영상을 변환하고, 1280×720 / 120프레임(약30fps) 결과를 확인했습니다. 실제 TV에 보내지는 않았습니다.
- APK v1/v2 서명 검증 통과.
- Android 실물 휴대폰·태블릿, 실제 TV로 Android에서 전송, 장시간 재생·배터리·화면 잠금은 아직 실기 검증하지 않았습니다. macOS 버전의 TV 테스트 결과와 구분해야 합니다.

공식 개발 자료: [Android Media3](https://developer.android.com/media/media3/exoplayer/hello-world), [Google Cast Android](https://developers.google.com/cast/docs/android_sender).
