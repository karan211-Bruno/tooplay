# Fullscreen and aspect-ratio tests

Two isolated runners test the actual app without application test hooks. Run them against a synthetic 16:9 MP4 longer than 20 seconds and an SRT whose first cue spans the test playback time. The audible 30-second fixture and 30-second Korean SRT used by NativePlayback fit these requirements.

## Hosted renderer test

`FullscreenNativeTests.swift` imports the real application module and uses its real `MediaController`, `PlayerSurfaceView`, `AVPlayer`, and `AVPlayerLayer`. It opens the fixture, pauses at 8 seconds, loads its subtitle, transfers the same player between inline and fullscreen surfaces, and checks actual `videoRect` geometry for fit/fill at portrait and landscape dimensions. Fit must retain the source ratio within the viewport; fill must use `resizeAspectFill` and cover the viewport while preserving the item's source `presentationSize`. In fill mode, `videoRect` reports the visible clipped bounds, so the test does not incorrectly require that clipped rectangle to retain the source ratio. It also verifies current-item identity, paused position, subtitle preservation, and resumed playback after the reverse handoff. This covers the rendering and ownership behavior; it does not exercise SwiftUI modal presentation or button taps. The UI runner separately checks actual displayed fit/fill pixels.

Build the app with `ENABLE_TESTABILITY=YES`, then:

```sh
python3 Tests/Fullscreen/generate-native.py \
  /tmp/Tooplay-fullscreen-native /path/to/Debug-iphonesimulator \
  /path/to/synthetic-video.mp4 /path/to/synthetic-subtitle.srt

xcodebuild -project /tmp/Tooplay-fullscreen-native/NativePlaybackTests.xcodeproj \
  -scheme NativePlaybackTests -configuration Debug -sdk iphonesimulator \
  -destination 'platform=iOS Simulator,id=SIMULATOR_UDID' \
  -derivedDataPath /tmp/Tooplay-fullscreen-native/DerivedData \
  -resultBundlePath /tmp/Tooplay-fullscreen-native/Result.xcresult \
  -parallel-testing-enabled NO test
```

## Blackbox UI test

`FullscreenUITests.swift` uses the actual app and normal Files picker. Before running, install the current simulator app and copy the fixtures to its Documents directory as `Tooplay-fullscreen-video.mp4` and `Tooplay-fullscreen-subtitle.srt`.

```sh
python3 Tests/Fullscreen/generate-ui.py /tmp/Tooplay-fullscreen-ui
xcodebuild -project /tmp/Tooplay-fullscreen-ui/FullscreenUITests.xcodeproj \
  -scheme FullscreenUITests -configuration Debug -sdk iphonesimulator \
  -destination 'platform=iOS Simulator,id=SIMULATOR_UDID' \
  -derivedDataPath /tmp/Tooplay-fullscreen-ui/DerivedData \
  -resultBundlePath /tmp/Tooplay-fullscreen-ui/Result.xcresult \
  -parallel-testing-enabled NO test
```

The UI test imports video and subtitle, pauses/seeks, enters fullscreen, switches both modes, compares actual portrait screenshot pixels to distinguish letterbox from filled video, rotates to landscape, exits fullscreen, and resumes the original movie. Screenshots and printed measurements are retained in the `.xcresult`. It attempts one folder-icon tap and a Search-button/search-field fallback; a picker failure is a failed UI test and must not be reported as fullscreen UI success.

The test requires these accessibility identifiers: `local-fullscreen-open`, `fullscreen-close`, `fullscreen-video-player`, `fullscreen-fit`, `fullscreen-fill`, `local-subtitle`, `fullscreen-subtitle`, and `playback-current-time`. It uses normal Korean playback button labels.

Portrait and landscape layout checks wait for two consecutive stable accessibility-frame observations. The close button must remain near the top, and every playback button, time label, aspect button, subtitle, and seek slider must lie fully inside the fullscreen viewport. Frame measurements are printed as `FULLSCREEN_LAYOUT_EVIDENCE`. The landscape attachment uses `XCUIScreen.main.screenshot()` rather than a cropped application screenshot, and records image size/orientation to distinguish screenshot orientation artifacts from actual offscreen controls.

### Explicit staged-fixture fallback

If Files navigation prevents the blackbox test from reaching fullscreen, generate a separate runner with `python3 Tests/Fullscreen/generate-ui.py /tmp/Tooplay-fullscreen-ui-staged --staged`. This changes only the generated test source: its method is named `testStagedFixtureFullscreenModesRotationAndReturnPreservePausedMovieAndSubtitle`, it omits the video/subtitle picker calls, and its evidence prefix is `STAGED_FULLSCREEN_UI_EVIDENCE`. The canonical normal-import test remains unchanged.

This runner requires a separately staged test application that calls the real `MediaController.open` and `openSubtitle` on the two Documents fixtures at startup. Keep that startup modification out of the canonical application source and shipped app. The generated runner exercises the same actual LocalView, fullscreen presentation, playback, mode controls, subtitle positioning, orientation, and return behavior. It waits for video playback before pausing/seeking and verifies the already imported subtitle. Success validates those UI paths only; it does not establish that normal Files selection/import passed. Preserve failed normal-import results and label staged screenshots/results separately.

Passing either runner does not prove a physical iPad display, hardware rotation, or Chromecast behavior. Record actual run results separately; the existence of these tests is not evidence that they have passed.

The expected geometry follows Apple's [aspect fill behavior](https://developer.apple.com/documentation/AVFoundation/AVLayerVideoGravity/resizeAspectFill) and [`videoRect`](https://developer.apple.com/documentation/avfoundation/avplayerlayer/videorect) documentation.
