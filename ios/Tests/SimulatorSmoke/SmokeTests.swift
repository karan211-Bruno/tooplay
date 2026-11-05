import XCTest
import UIKit

/// Runs against the actual installed app. No app debug hooks or simulated player state.
final class SmokeTests: XCTestCase {
    private var app: XCUIApplication!
    private let videoName = "Tooplay-smoke-video.mp4"
    private let subtitleName = "Tooplay-smoke-subtitle.srt"

    override func setUpWithError() throws {
        continueAfterFailure = false
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

    private func wait(_ explanation: String, timeout: TimeInterval = 15, _ condition: @escaping () -> Bool) {
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in condition() }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: timeout), .completed, explanation)
    }

    private func tapVisible(_ element: XCUIElement) {
        XCTAssertTrue(element.waitForExistence(timeout: 10), "Missing element: \(element)")
        for _ in 0..<5 {
            if element.isHittable { break }
            app.swipeUp()
        }
        XCTAssertTrue(element.isHittable)
        element.tap()
    }

    private func chooseFile(_ filename: String) {
        // UIDocumentPicker displays Files inside the application under test.
        let stem = (filename as NSString).deletingPathExtension
        let file = app.cells.matching(NSPredicate(format: "label == %@ OR label BEGINSWITH %@", filename, stem)).firstMatch
        if !file.waitForExistence(timeout: 2) {
            let browse = app.buttons["Browse"].firstMatch
            if browse.waitForExistence(timeout: 15) && browse.isHittable { browse.tap() }
            let local = app.descendants(matching: .any).matching(NSPredicate(format: "label == 'On My iPhone' OR label == 'On My iPad' OR label == '나의 iPhone' OR label == '나의 iPad'")).firstMatch
            XCTAssertTrue(local.waitForExistence(timeout: 10), app.debugDescription)
            local.tap()
            let folder = app.cells.matching(NSPredicate(format: "label BEGINSWITH 'Tooplay,'")).firstMatch
            XCTAssertTrue(folder.waitForExistence(timeout: 10), app.debugDescription)
            folder.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25)).tap()
        }
        XCTAssertTrue(file.waitForExistence(timeout: 10), app.debugDescription)
        file.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25)).tap()
        // Some Files configurations expose a final Open button after selecting an item.
        let open = app.buttons["Open"].firstMatch
        if open.exists && open.isHittable { open.tap() }
    }

    private var currentSeconds: Double {
        let text = app.staticTexts["playback-current-time"].firstMatch.label
        return text.split(separator: ":").compactMap { Double($0) }.reduce(0) { $0 * 60 + $1 }
    }

    private func attach(_ name: String, screenshot: XCUIScreenshot? = nil) {
        let attachment = XCTAttachment(screenshot: screenshot ?? app.screenshot())
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }

    private func centralPixels(_ screenshot: XCUIScreenshot) -> [UInt8] {
        guard let image = screenshot.image.cgImage else { XCTFail("Screenshot has no pixels"); return [] }
        // Exclude playback controls, subtitles and borders. Only compare the central video frame.
        let region = CGRect(x: Double(image.width) * 0.2, y: Double(image.height) * 0.2,
                            width: Double(image.width) * 0.6, height: Double(image.height) * 0.45)
        guard let cropped = image.cropping(to: region) else { XCTFail("Cannot crop video frame"); return [] }
        var pixels = [UInt8](repeating: 0, count: 64 * 36 * 4)
        pixels.withUnsafeMutableBytes { bytes in
            let context = CGContext(data: bytes.baseAddress, width: 64, height: 36, bitsPerComponent: 8,
                                    bytesPerRow: 64 * 4, space: CGColorSpaceCreateDeviceRGB(),
                                    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
            context.draw(cropped, in: CGRect(x: 0, y: 0, width: 64, height: 36))
        }
        return pixels
    }

    func test02LocalImportPlaybackSubtitle() throws {
        tapVisible(app.buttons["영상 열기"])
        chooseFile(videoName)
        XCTAssertTrue(app.staticTexts[videoName].waitForExistence(timeout: 20), app.debugDescription)
        wait("AVPlayer should advance after the real imported video is ready") { self.currentSeconds >= 1 }
        let player = app.descendants(matching: .any)["local-video-player"].firstMatch
        XCTAssertTrue(player.exists, app.debugDescription)
        XCTAssertGreaterThan(player.frame.width, 200)
        XCTAssertGreaterThan(player.frame.height, 100)
        let firstTime = currentSeconds
        let firstFrame = player.screenshot()
        wait("AVPlayer should keep decoding") { self.currentSeconds >= firstTime + 2 }
        let secondFrame = player.screenshot()
        let first = centralPixels(firstFrame), second = centralPixels(secondFrame)
        XCTAssertEqual(first.count, second.count)
        let changed = zip(first, second).enumerated().filter { $0.offset % 4 != 3 && abs(Int($0.element.0) - Int($0.element.1)) > 16 }.count
        XCTAssertGreaterThan(changed, 64 * 36 / 20, "Actual central video pixels should change; a running timer alone is insufficient")
        attach("01-native-video-frame-a", screenshot: firstFrame)
        attach("02-native-video-frame-b", screenshot: secondFrame)
        tapVisible(app.buttons["일시정지"].firstMatch)
        XCTAssertTrue(app.buttons["재생"].firstMatch.waitForExistence(timeout: 5))
        let pausedAt = currentSeconds
        Thread.sleep(forTimeInterval: 1.5)
        XCTAssertLessThanOrEqual(abs(currentSeconds - pausedAt), 1, "Pause should stop the actual player clock")
        tapVisible(app.buttons["10초 앞으로"].firstMatch)
        wait("Seek should move the actual AVPlayer by ten seconds") { self.currentSeconds >= pausedAt + 8 }
        tapVisible(app.buttons["자막 열기"])
        chooseFile(subtitleName)
        XCTAssertTrue(app.staticTexts["local-subtitle"].waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertEqual(app.staticTexts["local-subtitle"].label, "TOOPLAY 자막 확인")
        attach("03-native-subtitle-and-controls")
        let subtitleToggle = app.switches[subtitleName].firstMatch
        tapVisible(subtitleToggle)
        wait("Subtitle should hide") { !self.app.staticTexts["local-subtitle"].exists }
        tapVisible(subtitleToggle)
        wait("Subtitle should return") { self.app.staticTexts["local-subtitle"].exists }
    }

    func test01DesktopRemote() throws {
        // The optional remote fixture is a separate actual Electron app instance.
        guard let fixtureURL = Bundle(for: Self.self).url(forResource: "remote-fixture", withExtension: "json") else {
            throw XCTSkip("No actual desktop fixture configured; remote integration was not tested")
        }
        let fixture = try JSONSerialization.jsonObject(with: Data(contentsOf: fixtureURL)) as! [String: Any]
        let address = try XCTUnwrap(fixture["address"] as? String)
        let code = try XCTUnwrap(fixture["code"] as? String)
        // iPadOS places the adaptive tab strip outside XCUIElementTypeTabBar.
        tapVisible(app.buttons["컴퓨터 연결"].firstMatch)
        let addressField = app.textFields["컴퓨터 주소"]
        tapVisible(addressField); addressField.typeText(address)
        let codeField = app.textFields["6자리 연결 코드"]
        tapVisible(codeField); codeField.typeText(code)
        // Keyboard may cover the button on iPhone. Scrolling dismisses it only after a tap outside.
        app.staticTexts["컴퓨터 Tooplay와 연결"].tap()
        tapVisible(app.scrollViews.buttons["컴퓨터 연결"].firstMatch)
        wait("Should pair with the actual desktop fixture", timeout: 20) { self.app.buttons["연결 해제"].exists }
        XCTAssertTrue(app.staticTexts["컴퓨터에서 재생"].waitForExistence(timeout: 10))
        tapVisible(app.buttons["재생"].firstMatch)
        wait("Remote player should progress after play") { self.currentSeconds >= 2 }
        tapVisible(app.buttons["일시정지"].firstMatch)
        XCTAssertTrue(app.buttons["재생"].firstMatch.waitForExistence(timeout: 10))
        let remotePaused = currentSeconds
        tapVisible(app.buttons["10초 앞으로"].firstMatch)
        wait("Remote seek should update from the desktop") { self.currentSeconds >= remotePaused + 7 }
        attach("05-actual-desktop-remote-pause-seek")
        tapVisible(app.buttons["연결 해제"])
        XCTAssertTrue(app.textFields["컴퓨터 주소"].waitForExistence(timeout: 10))
        attach("06-remote-disconnected")
    }
}
