# Tooplay 0.3.0

로컬 영상을 재생하고 Chromecast / Google TV로 전송하는 데스크톱 플레이어입니다. macOS Apple Silicon, Windows x64, Ubuntu/Linux x64용 설치 파일을 만듭니다. AirPlay는 별도 Swift 앱인 `../HanPlay`에서 제공합니다.


## 0.3.0: 휴대폰 리모컨 (2026-11-05)

상단 **휴대폰 연결**을 누르면 같은 Wi-Fi에서 사용할 컴퓨터 주소와 6자리 코드가 나타납니다. 모바일 앱의 **컴퓨터 연결** 또는 휴대폰 브라우저에서 주소를 열어 코드를 입력하세요. 코드는 2분 동안 유효하며 한 번만 사용할 수 있습니다. 연결을 끄면 모든 기기의 권한이 즉시 해제됩니다. 앱을 다시 켤 때 연결 기능은 꺼져 있습니다.

휴대폰에서 현재 열린 영상의 재생/일시정지, 탐색, 볼륨, 자막 선택, 컴퓨터를 통한 Chromecast 시작/종료를 조작합니다. 영상 파일 선택은 컴퓨터에서 합니다. 파일 시스템 탐색이나 임의 명령 실행 기능은 없습니다. 신뢰하는 같은 Wi-Fi의 사설 IPv4 네트워크를 사용하세요.

관련 모바일 소스는 상위 디렉터리의 `android/`, `ios/`에 있습니다. Android는 테스트 APK를 제공하며, iPhone/iPad는 Xcode에서 개인 기기에 설치하는 프로젝트를 제공합니다. 플랫폼별 검증 범위는 각 README와 릴리스 검증 문서를 확인하세요.

## 0.2.1: Chromecast 장시간 버퍼링 완화 (2026-11-05)

- TV에는 별도 H.264 Main 3.1, 최대 1280×720/30fps 스트림을 보냅니다. 영상 목표 2.5Mbps, 최대 3Mbps, AAC 128kbps로 전송량을 제한합니다. 컴퓨터 재생은 기존 소스를 사용합니다.
- MP4도 TV로 보낼 때는 이 제한을 적용합니다. 높은 비트레이트·프레임 수의 원본이 TV로 그대로 넘어가는 경로를 제거했습니다.
- 완성된 8초 분량을 확보한 뒤 연결합니다. 짧은 영상은 변환 완료 후 연결합니다.
- 중간 위치에서 전송할 때는 해당 지점부터 변환하고, TV 재생 시각과 자막 시각을 원본 위치에 맞춥니다. 아직 만들어지지 않은 구간이나 이전 구간으로 이동하면 새 스트림을 준비합니다.
- 전송 준비를 취소하거나 영상을 바꿀 때 인코더와 대기 요청을 함께 정리합니다.

회귀 명령: `npm test`, `npm run test:cast-buffering`, `npm run test:smoke`. `test:cast-buffering`은 실제 변환된 HLS 조각의 크기로 5Mbps 연결의 10분 재생을 모델링하는 빠른 테스트입니다. 실제 Chromecast 하드웨어 시험과 구분해야 합니다. 별도 하드웨어 테스트 결과는 릴리스의 수정내역과검증결과.md에 기록합니다.

## 사용 방법

- **macOS**: DMG를 열고 Tooplay를 Applications 폴더로 복사합니다. 동기화 폴더에서 앱 번들을 직접 실행하는 것보다 DMG로 설치하는 방식을 권장합니다.
- **Windows**: `Tooplay-Setup-0.3.0.exe`를 실행합니다.
- **Ubuntu**: `sudo apt install ./Tooplay-0.3.0-amd64.deb`로 설치합니다.
- **Linux AppImage**: 실행 권한을 부여한 뒤 실행합니다. 시스템의 FUSE 지원이 필요할 수 있습니다.

영상 열기 버튼 또는 드래그 앤 드롭으로 영상을 엽니다. 같은 이름의 자막을 같은 폴더나 `Subs` 폴더에 두면 자동으로 읽습니다. 자막 버튼에서 트랙을 바꾸거나 자막 파일을 추가할 수 있습니다. TV 전송 버튼에서는 같은 네트워크에 있는 Chromecast / Google TV를 선택합니다.

## 기능

- H.264/AAC 등 호환 코덱을 담은 MP4/M4V/MOV는 직접 재생합니다. 다른 코덱 또는 MKV/AVI/WebM/TS 등의 파일은 ffmpeg로 H.264/AAC HLS로 변환합니다.
- 변환이 진행되는 동안 재생할 수 있습니다. 전체 영상 길이는 유지되며, 아직 변환되지 않은 위치를 선택하면 변환이 끝난 구간으로 제한합니다. 플레이리스트 갱신을 기다려야 하는 탐색은 요청한 위치를 저장했다가 적용합니다.
- SRT, VTT, ASS, SSA, SMI, SAMI 외부 자막과 내장 텍스트 자막을 지원합니다. UTF-8, UTF-16 및 EUC-KR 한국어를 처리합니다.
- TV 전송 시 재생 위치와 일시정지 상태를 유지합니다. 전송 중 추가한 자막은 현재 위치를 유지해 TV에 다시 로드합니다.
- 재생/일시정지, 탐색, 볼륨, 음소거, 전체화면을 제공합니다.

단축키: Space 재생/일시정지, 방향키 좌우 5초 이동, Cmd/Ctrl+좌우 10초 이동, 방향키 상하 볼륨, M 음소거, F 전체화면, C 자막 메뉴, Cmd/Ctrl+O 영상 열기, Cmd/Ctrl+Shift+S 자막 열기.

## 개발 실행과 검증

Node.js 22 이상과 npm을 사용합니다.

```bash
npm ci
npm start
npm test
npm run test:smoke
npm run test:remote-web
```

`npm test`는 자막, HTTP Range, 코덱 선택, 변환 실패 처리, Cast 연결 취소·재연결·검색 오류를 검증합니다. `test:smoke`는 테스트 영상을 생성한 뒤 Electron 화면에서 실제 영상 디코딩, 외부/내장 자막, 탐색, 전체화면, 8분 영상의 변환 중 재생과 취소, 잘못된 파일에서 복구를 검증합니다.

완성된 macOS 번들을 검사할 때:

```bash
TOOPLAY_APP="/Applications/Tooplay.app/Contents/MacOS/Tooplay" npm run test:smoke
```

## 패키징

```bash
npm run dist:mac
npm run dist:win
npm run dist:linux
```

빌드 결과는 `dist/`에 생성됩니다.

- macOS: `Tooplay.app`, `Tooplay-0.3.0-mac-arm64.dmg` (빌드하는 Mac의 아키텍처 기준)
- Windows x64: `Tooplay-Setup-0.3.0.exe`
- Ubuntu/Linux x64: `Tooplay-0.3.0-amd64.deb`, `Tooplay-0.3.0-x86_64.AppImage`

빌드는 임시 로컬 폴더에서 수행합니다. 의존성은 lockfile로 다시 설치하고, 캐시가 있으면 먼저 사용합니다. File Provider의 확장 속성을 복제하지 않으며, 앱 코드는 ASAR에 담습니다. Windows/Linux용 ffmpeg는 대상 플랫폼에 맞게 내려받습니다. macOS arm64용 ffprobe는 ffprobe-static의 잘못된 아키텍처를 검사하여 고정된 upstream 바이너리로 교체하고 SHA-256을 확인합니다.

macOS는 로컬 사용용 ad-hoc 서명을 수행합니다. 외부 배포용 Developer ID 서명·공증과 Windows 배포 인증서 서명은 별도로 필요합니다. 동기화 서비스가 `.app`에 Finder 속성을 다시 추가할 수 있으므로 DMG 안의 앱을 설치하세요.

## 검증 범위와 제한

macOS에서 번들 실행, 31개 자동 테스트, 실제 Electron 재생 테스트를 통과했습니다. 0.3.0 설치 파일은 macOS ARM64용을 제공합니다. Windows/Linux 소스 빌드 스크립트는 포함되지만 이 버전의 설치·실행은 검증하지 않았습니다. Chromecast HD에서 수정판 0.2.1의 실제 10분 전송 시험을 통과했습니다(시작 후 버퍼링 0회, 재생 시각 지연 증가 없음). 다른 Cast 모델과 AirPlay 하드웨어는 미검증입니다. PGS/VobSub 같은 이미지 자막은 지원하지 않습니다.

Chromecast가 보이지 않으면 같은 Wi-Fi/LAN인지, VPN·게스트망·AP 격리가 없는지, 로컬 네트워크 권한과 방화벽이 검색 및 HTTP 스트림을 허용하는지 확인하세요.

## 바이너리 출처

ffmpeg와 macOS ARM64 ffprobe는 [ffmpeg-static b6.1.1](https://github.com/eugeneware/ffmpeg-static/releases/tag/b6.1.1) 릴리스에서 가져옵니다. ARM64 ffprobe 원본 SHA-256은 `bb2db6f5d8cef919da12fbf592119a987202a8c060a886f3cab091f9cab90b64`입니다. 다른 플랫폼의 ffprobe는 lockfile에 고정된 ffprobe-static 패키지에서 제공합니다.
