# Native playback integration tests

These hosted XCTests import the real `Tooplay` application module. The video test opens a synthetic video through `MediaController`, verifies changing decoded `AVPlayerItemVideoOutput` frames and advancing playback, then checks pause, an exact seek, and SRT display/hide/restore. It records two decoded frame images and JSON measurements in the `.xcresult` bundle. These images are decoded media frames, not screenshots of the app UI.

The audio regression added in iOS 0.3.1 (build 2) first sets the session to `soloAmbient`, then opens the fixture through the real `MediaController`. It checks that local playback selects the `playback` category and `moviePlayback` mode, and that the player is not muted and has positive gain. An independent `AVAssetReader` decodes the fixture's audio to 16-bit PCM and requires a peak above 300. This detects the former silent fixture and missing audio-session policy; it does not measure actual AVPlayer output, system volume, audio routing, or sound from a physical speaker.

Build the actual simulator app with `ENABLE_TESTABILITY=YES`. The generator requires its products directory, including `Tooplay.swiftmodule` and `GoogleCast.framework`, a synthetic MP4 longer than 10 seconds **with non-silent audio**, and an SRT fixture whose first cue occurs before the video's end. The current `scripts/smoke-ios.sh` creates a 440Hz AAC fixture. The separate device test file is named `Tooplay-audio-test.mp4`; the old device file `Tooplay-test-video.mp4` contains silence and cannot validate audible playback. The generator copies the app into the isolated runner directory; the original app and Xcode project are not changed. Both normal host binaries and Xcode's `Tooplay.debug.dylib` layout are supported.

```sh
python3 Tests/NativePlayback/generate-project.py \
  /tmp/Tooplay-native-playback \
  /path/to/DerivedData/Build/Products/Debug-iphonesimulator \
  /path/to/synthetic-video.mp4 /path/to/synthetic-subtitle.srt

xcodebuild \
  -project /tmp/Tooplay-native-playback/NativePlaybackTests.xcodeproj \
  -scheme NativePlaybackTests -configuration Debug -sdk iphonesimulator \
  -destination 'platform=iOS Simulator,id=SIMULATOR_UDID' \
  -derivedDataPath /tmp/Tooplay-native-playback/DerivedData \
  -resultBundlePath /tmp/Tooplay-native-playback/NativePlayback.xcresult \
  -parallel-testing-enabled NO test

xcrun xcresulttool export attachments \
  --path /tmp/Tooplay-native-playback/NativePlayback.xcresult \
  --output-path /tmp/Tooplay-native-playback/evidence
```

Use a fresh result bundle path for each run. These tests do not exercise the Files picker, physical speaker output, or Cast to a physical TV. Real device installation, audibility and physical TV transmission require separate validation.

For iOS 0.3.1, the iPad simulator passed both tests with zero failures on 2026-11-05: the original video/subtitle test and the new audio regression. Reported audio evidence was category `playback`, mode `moviePlayback`, and decoded PCM peak 2979. Separately, on 2026-11-05 the user ran the installed 0.3.1 app on the physical iPad and confirmed normal sound during local playback. This is a human listening confirmation, not automated or instrumented measurement of physical speaker output. Full Files-picker UI and physical Chromecast testing remain separate.

Earlier iOS 0.3.0 validation on 2026-11-05 used Xcode 27.2 and iOS Simulator 27.2: iPhone and iPad each passed the video integration test with zero failures. The 30-second MP4 produced 15 and 17 distinct decoded frame hashes respectively, an exact seek to 8.0 seconds, and the expected Korean SRT cue. Exported evidence in `../../verification/native-iphone` and `../../verification/native-ipad` is from that earlier video-only validation.
