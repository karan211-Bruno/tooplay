#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
TMP_DIR=$(mktemp -d /private/tmp/tooplay-ios-check.XXXXXX)
trap 'rm -rf "$TMP_DIR"' EXIT
swiftc -frontend -parse Tooplay/*.swift
plutil -lint Tooplay/Info.plist Tooplay.xcodeproj/project.pbxproj
swiftc -swift-version 5 -parse-as-library -module-cache-path "$TMP_DIR/module-cache" Tooplay/MediaCore.swift Tooplay/RemoteClient.swift Tooplay/LocalMediaServer.swift Tests/CoreTests.swift -o "$TMP_DIR/core-tests"
if [ "${TOOPLAY_INTEGRATION:-0}" = "1" ]; then
    node scripts/check-remote.js "$TMP_DIR/core-tests"
else
    "$TMP_DIR/core-tests"
fi
