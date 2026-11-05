import XCTest
import UIKit

/// Blackbox checks against the actual installed app and its normal Files picker.
/// Requires synthetic video + SRT copied into the app Documents folder first.
final class FullscreenUITests: XCTestCase {
    private var app: XCUIApplication!
    private let videoName = "Tooplay-fullscreen-video.mp4"
    private let subtitleName = "Tooplay-fullscreen-subtitle.srt"

    override func setUpWithError() throws {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        app = XCUIApplication(bundleIdentifier: "com.tooplay.mobile")
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        addUIInterruptionMonitor(withDescription: "Local network permission") { alert in
            for name in ["Allow", "OK", "허용", "확인"] where alert.buttons[name].exists {
                alert.buttons[name].tap(); return true
            }
            return false
        }
        app.launch()
    }

    override func tearDownWithError() throws {
        XCUIDevice.shared.orientation = .portrait
    }

    private func wait(_ description: String, timeout: TimeInterval = 15, _ condition: @escaping () -> Bool) {
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in condition() }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: timeout), .completed, description + "\n" + app.debugDescription)
    }

    private func tap(_ element: XCUIElement) {
        XCTAssertTrue(element.waitForExistence(timeout: 10), app.debugDescription)
        for _ in 0..<4 where !element.isHittable { app.swipeUp() }
        XCTAssertTrue(element.isHittable, app.debugDescription)
        element.tap()
    }

    private func attach(_ name: String, screenshot: XCUIScreenshot? = nil) {
        let attachment = XCTAttachment(screenshot: screenshot ?? app.screenshot())
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }

    private func chooseFile(_ filename: String) {
        let stem = (filename as NSString).deletingPathExtension
        let file = app.cells.matching(NSPredicate(format: "label == %@ OR label BEGINSWITH %@", filename, stem)).firstMatch
        if !file.waitForExistence(timeout: 2) {
            let browse = app.buttons.matching(NSPredicate(format: "label == 'Browse' OR label == '둘러보기'")).firstMatch
            if browse.waitForExistence(timeout: 8), browse.isHittable { browse.tap() }
            let local = app.descendants(matching: .any).matching(NSPredicate(format: "label == 'On My iPhone' OR label == 'On My iPad' OR label == '나의 iPhone' OR label == '나의 iPad'")).firstMatch
            if local.waitForExistence(timeout: 4), local.isHittable { local.tap() }
            let folder = app.cells.matching(NSPredicate(format: "label == 'Tooplay' OR label BEGINSWITH 'Tooplay,'")).firstMatch
            if folder.waitForExistence(timeout: 5) {
                // Files grid cells include a tall title/details region. Tap the
                // actual folder icon, not the cell center below that icon.
                folder.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25)).tap()
            }
        }
        if !file.waitForExistence(timeout: 3) {
            // Recent iPadOS exposes search as a button until it is opened.
            let searchButton = app.buttons.matching(NSPredicate(format: "label == 'Search' OR label == '검색'")).firstMatch
            if searchButton.waitForExistence(timeout: 3), searchButton.isHittable { searchButton.tap() }
            let search = app.searchFields.firstMatch
            if search.waitForExistence(timeout: 3), search.isHittable {
                search.tap(); search.typeText(stem + "\n")
            }
        }
        attach("Files picker " + filename)
        XCTAssertTrue(file.waitForExistence(timeout: 10), app.debugDescription)
        file.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25)).tap()
        let open = app.buttons.matching(NSPredicate(format: "label == 'Open' OR label == '열기'")).firstMatch
        if open.exists && open.isHittable { open.tap() }
    }

    private var seconds: Double {
        let label = app.staticTexts["playback-current-time"].firstMatch.label
        return label.split(separator: ":").compactMap { Double($0) }.reduce(0) { $0 * 60 + $1 }
    }

    private var fullscreen: XCUIElement { app.descendants(matching: .any)["fullscreen-video-player"].firstMatch }

    private func showControls() {
        if !app.buttons["fullscreen-close"].isHittable {
            fullscreen.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.45)).tap()
        }
        XCTAssertTrue(app.buttons["fullscreen-close"].waitForExistence(timeout: 5))
    }

    private func verifyStableFullscreenLayout(landscape: Bool) {
        let uniqueControls: [(String, XCUIElement)] = [
            ("close", app.buttons["fullscreen-close"]),
            ("fit", app.buttons["fullscreen-fit"]),
            ("fill", app.buttons["fullscreen-fill"]),
            ("subtitle", app.staticTexts["fullscreen-subtitle"])
        ]
        let visibleQueries: [(String, XCUIElementQuery)] = [
            ("seek", app.sliders.matching(identifier: "재생 위치")),
            ("back", app.buttons.matching(identifier: "10초 뒤로")),
            ("play", app.buttons.matching(identifier: "재생")),
            ("forward", app.buttons.matching(identifier: "10초 앞으로")),
            ("time", app.staticTexts.matching(identifier: "playback-current-time")),
            ("duration", app.staticTexts.matching(identifier: "playback-duration"))
        ]
        func visibleControls() -> [(String, XCUIElement)]? {
            var result = uniqueControls
            for (name, query) in visibleQueries {
                // SwiftUI may retain the covered inline controls in the AX tree.
                // Geometry must inspect the hittable fullscreen controls only.
                guard let element = query.allElementsBoundByIndex.first(where: { $0.isHittable }) else { return nil }
                result.append((name, element))
            }
            return result
        }
        var previous: [CGRect] = []
        var stableObservations = 0
        wait("Fullscreen layout must settle with every control on screen", timeout: 20) {
            let viewport = self.fullscreen.frame
            guard viewport.width > 0, viewport.height > 0,
                  (viewport.width > viewport.height) == landscape,
                  let controls = visibleControls(),
                  controls.allSatisfy({ $0.1.exists }) else {
                stableObservations = 0; return false
            }
            let frames = [viewport] + controls.map { $0.1.frame }
            let visibleBounds = viewport.insetBy(dx: -1, dy: -1)
            let close = frames[1]
            guard frames.dropFirst().allSatisfy({ !$0.isEmpty && visibleBounds.contains($0) }),
                  close.maxY <= viewport.minY + max(90, viewport.height * 0.2) else {
                stableObservations = 0; return false
            }
            let unchanged = previous.count == frames.count && zip(previous, frames).allSatisfy { a, b in
                abs(a.minX - b.minX) < 0.5 && abs(a.minY - b.minY) < 0.5 &&
                    abs(a.width - b.width) < 0.5 && abs(a.height - b.height) < 0.5
            }
            stableObservations = unchanged ? stableObservations + 1 : 1
            previous = frames
            return stableObservations >= 2
        }
        let viewport = fullscreen.frame
        guard let controls = visibleControls() else {
            XCTFail("Fullscreen controls must be hittable after layout settles")
            return
        }
        for (name, element) in controls {
            XCTAssertTrue(viewport.insetBy(dx: -1, dy: -1).contains(element.frame),
                          "\(name) must be fully inside fullscreen bounds: \(element.frame), viewport: \(viewport)")
        }
        XCTAssertLessThanOrEqual(app.buttons["fullscreen-close"].frame.maxY,
                                 viewport.minY + max(90, viewport.height * 0.2),
                                 "Close control must remain at the top of the landscape/portrait viewport")
        XCTAssertLessThanOrEqual(app.staticTexts["fullscreen-subtitle"].frame.maxY,
                                 app.buttons["fullscreen-fit"].frame.minY)
        let frames = Dictionary(uniqueKeysWithValues: controls.map { ($0.0, NSCoder.string(for: $0.1.frame)) })
        let evidence: [String: Any] = ["landscape": landscape, "viewport": NSCoder.string(for: viewport),
                                      "application": NSCoder.string(for: app.frame), "controls": frames,
                                      "stableObservations": stableObservations]
        let data = try! JSONSerialization.data(withJSONObject: evidence, options: [.sortedKeys])
        print("FULLSCREEN_LAYOUT_EVIDENCE " + String(decoding: data, as: UTF8.self))
    }

    private func topBandBrightness(_ screenshot: XCUIScreenshot) -> Double {
        guard let image = screenshot.image.cgImage else { XCTFail("No screenshot image"); return 0 }
        // Portrait + 16:9 source: this strip is black letterbox in fit mode,
        // but contains actual video pixels in fill mode. Exclude top controls.
        let rect = CGRect(x: Double(image.width) * 0.2, y: Double(image.height) * 0.2,
                          width: Double(image.width) * 0.6, height: Double(image.height) * 0.04)
        guard let cropped = image.cropping(to: rect) else { XCTFail("Cannot crop video pixels"); return 0 }
        var bytes = [UInt8](repeating: 0, count: 64 * 8 * 4)
        bytes.withUnsafeMutableBytes { buffer in
            let context = CGContext(data: buffer.baseAddress, width: 64, height: 8, bitsPerComponent: 8,
                                    bytesPerRow: 64 * 4, space: CGColorSpaceCreateDeviceRGB(),
                                    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
            context.draw(cropped, in: CGRect(x: 0, y: 0, width: 64, height: 8))
        }
        let rgb = bytes.enumerated().filter { $0.offset % 4 != 3 }.map { Double($0.element) }
        return rgb.reduce(0, +) / Double(rgb.count)
    }

    func testFullscreenModesRotationAndReturnPreservePausedMovieAndSubtitle() throws {
        tap(app.buttons["영상 열기"])
        chooseFile(videoName)
        XCTAssertTrue(app.staticTexts[videoName].waitForExistence(timeout: 20))
        wait("Imported video should start") { self.seconds >= 1 }
        tap(app.buttons["일시정지"].firstMatch)
        XCTAssertTrue(app.buttons["재생"].firstMatch.waitForExistence(timeout: 5))
        tap(app.buttons["10초 앞으로"].firstMatch)
        wait("Seek should advance the paused movie") { self.seconds >= 9 }
        tap(app.buttons["자막 열기"])
        chooseFile(subtitleName)
        XCTAssertTrue(app.staticTexts["local-subtitle"].waitForExistence(timeout: 10))
        let subtitle = app.staticTexts["local-subtitle"].label
        let pausedAt = seconds
        tap(app.buttons["local-fullscreen-open"])
        XCTAssertTrue(fullscreen.waitForExistence(timeout: 10))
        showControls()
        XCTAssertTrue(app.buttons["재생"].firstMatch.exists, "Paused movie must remain paused on entry")
        XCTAssertTrue(app.staticTexts["fullscreen-subtitle"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.staticTexts["fullscreen-subtitle"].label, subtitle)
        XCTAssertLessThanOrEqual(app.staticTexts["fullscreen-subtitle"].frame.maxY,
                                 app.buttons["fullscreen-fit"].frame.minY,
                                 "Subtitle must remain above the controls, not underneath them")
        XCTAssertLessThanOrEqual(abs(seconds - pausedAt), 1)
        XCTAssertGreaterThanOrEqual(fullscreen.frame.width, app.frame.width * 0.95)
        XCTAssertGreaterThanOrEqual(fullscreen.frame.height, app.frame.height * 0.90)
        verifyStableFullscreenLayout(landscape: false)

        tap(app.buttons["fullscreen-fit"])
        let fit = fullscreen.screenshot()
        attach("Fullscreen portrait original ratio", screenshot: fit)
        tap(app.buttons["fullscreen-fill"])
        // Wait for Core Animation to display the requested gravity before taking pixels.
        wait("Fill mode should replace the portrait letterbox with video pixels") {
            self.topBandBrightness(self.fullscreen.screenshot()) > 25
        }
        let fill = fullscreen.screenshot()
        attach("Fullscreen portrait fill", screenshot: fill)
        let fitBrightness = topBandBrightness(fit), fillBrightness = topBandBrightness(fill)
        XCTAssertLessThan(fitBrightness, 15, "Fit must retain black letterboxing for 16:9 video in portrait")
        XCTAssertGreaterThan(fillBrightness, fitBrightness + 20, "Fill must visibly fill the screen, not only change a label")
        XCTAssertLessThanOrEqual(abs(seconds - pausedAt), 1)

        XCUIDevice.shared.orientation = .landscapeLeft
        wait("Fullscreen should follow landscape rotation") { self.fullscreen.frame.width > self.fullscreen.frame.height }
        showControls()
        XCTAssertGreaterThanOrEqual(fullscreen.frame.width, app.frame.width * 0.95)
        XCTAssertGreaterThanOrEqual(fullscreen.frame.height, app.frame.height * 0.90)
        tap(app.buttons["fullscreen-fit"])
        verifyStableFullscreenLayout(landscape: true)
        let landscapeScreenshot = XCUIScreen.main.screenshot()
        attach("Fullscreen landscape original ratio - full screen capture", screenshot: landscapeScreenshot)
        print("FULLSCREEN_SCREENSHOT_EVIDENCE landscapeSize=\(landscapeScreenshot.image.size) imageOrientation=\(landscapeScreenshot.image.imageOrientation.rawValue)")
        XCTAssertEqual(app.staticTexts["fullscreen-subtitle"].label, subtitle)
        XCTAssertLessThanOrEqual(abs(seconds - pausedAt), 1)
        tap(app.buttons["fullscreen-close"])
        wait("Fullscreen should dismiss") { !self.app.buttons["fullscreen-close"].exists }
        XCTAssertTrue(app.buttons["local-fullscreen-open"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.staticTexts["local-subtitle"].label, subtitle)
        XCTAssertLessThanOrEqual(abs(seconds - pausedAt), 1)
        tap(app.buttons["재생"].firstMatch)
        wait("The same movie should resume after closing fullscreen") { self.seconds >= pausedAt + 2 }
        attach("Inline playback resumed after fullscreen")
        print("FULLSCREEN_UI_EVIDENCE fitTopBand=\(fitBrightness) fillTopBand=\(fillBrightness) pausedAt=\(pausedAt) resumedAt=\(seconds)")
    }
}
