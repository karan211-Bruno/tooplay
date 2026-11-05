# Native UI remote verification

This isolated XCTest UI runner controls the installed `com.tooplay.mobile` app. It does not add debug hooks to Tooplay or change the app project.

Start a separate packaged desktop fixture from `desktop`:

```sh
TOOPLAY_APP=/path/Tooplay.app/Contents/MacOS/Tooplay \
TOOPLAY_REMOTE_FIXTURE=/private/tmp/tooplay-pairing.json \
node scripts/smoke-test.js
```

Wait for the fixture JSON to exist. From `ios`, start the independent video observer before the UI test:

```sh
node Tests/SimulatorSmoke/verify-remote.js /private/tmp/tooplay-pairing.json monitor \
  --timeout-ms=300000 --output=/private/tmp/tooplay-desktop-evidence.json
```

Then run the UI test on an explicitly selected disposable simulator:

```sh
./scripts/smoke-ios.sh /path/Tooplay.app SIMULATOR-UDID \
  /private/tmp/Tooplay-smoke /private/tmp/tooplay-pairing.json
```

The script refreshes the short-lived pairing code after the runner compiles. The default test checks pairing, play, pause, forward seek and disconnect. The independent observer requires actual desktop decoded-frame progress as well as the expected player states. The original desktop fixture has a 20-minute timeout; restart it before a later run if necessary.

Finish the specific fixture after testing:

```sh
node Tests/SimulatorSmoke/verify-remote.js /private/tmp/tooplay-pairing.json finish
```

`TOOPLAY_UI_TEST=local` and `all` retain an experimental Files picker UI test. On the current iOS 27.2 simulator, XCTest reached the Tooplay folder but did not enter it; this path has **not passed**. Use the separate `NativePlayback` hosted XCTest for verified AVPlayer import, decoded pixels, transport and subtitle behavior. Neither test establishes physical Chromecast playback.
