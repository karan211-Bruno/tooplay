import XCTest
import AVFoundation
import UIKit
@testable import Tooplay

/// Exercises the actual app renderer, actual AVPlayer and AVPlayerLayer geometry.
/// Modal presentation and taps are separately covered by FullscreenUITests.
final class FullscreenNativeTests: XCTestCase {
    @MainActor
    private func waitFor(_ timeout: Double = 10, _ condition: () -> Bool) async -> Bool {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            if condition() { return true }
            try? await Task.sleep(nanoseconds: 50_000_000)
        }
        return condition()
    }

    @MainActor
    func testRealLayerFitFillLayoutAndRendererHandoffPreservePlayback() async throws {
        continueAfterFailure = false
        let bundle = Bundle(for: Self.self)
        let video = try XCTUnwrap(bundle.url(forResource: "Tooplay-smoke-video", withExtension: "mp4"))
        let subtitle = try XCTUnwrap(bundle.url(forResource: "Tooplay-smoke-subtitle", withExtension: "srt"))
        let media = MediaController(cast: CastController())
        defer { media.stop() }
        await media.open(video)
        XCTAssertNil(media.message)
        let originalItem = try XCTUnwrap(media.player.currentItem)
        let ready = await waitFor { originalItem.status == .readyToPlay && media.player.currentTime().seconds > 0.2 }
        XCTAssertTrue(ready)
        let presentationSize = originalItem.presentationSize
        XCTAssertGreaterThan(presentationSize.width, 0)
        XCTAssertGreaterThan(presentationSize.height, 0)
        let sourceAspect = presentationSize.width / presentationSize.height
        XCTAssertEqual(sourceAspect, 16.0 / 9.0, accuracy: 0.01, "This geometry fixture must be 16:9")
        media.player.pause()
        media.seek(8)
        let sought = await waitFor { abs(media.player.currentTime().seconds - 8) < 0.15 }
        XCTAssertTrue(sought)
        await media.openSubtitle(subtitle)
        let subtitleReady = await waitFor { !media.subtitleText.isEmpty }
        XCTAssertTrue(subtitleReady)
        let subtitleBefore = media.subtitleText

        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let window = UIWindow(windowScene: scene)
        let controller = UIViewController()
        window.rootViewController = controller
        window.makeKeyAndVisible()
        defer { window.isHidden = true }

        let inline = PlayerSurfaceView(frame: CGRect(x: 0, y: 0, width: 640, height: 360))
        controller.view.addSubview(inline)
        inline.configure(player: media.player, mode: .fit)
        let inlineReady = await waitFor { inline.playerLayer.isReadyForDisplay }
        XCTAssertTrue(inlineReady)
        XCTAssertTrue(inline.playerLayer.player === media.player)
        let pausedAt = media.player.currentTime().seconds

        // This is the same renderer ownership transition used by fullScreenCover.
        inline.configure(player: nil, mode: .fit)
        let fullscreen = PlayerSurfaceView(frame: CGRect(x: 0, y: 0, width: 768, height: 1024))
        controller.view.addSubview(fullscreen)
        fullscreen.configure(player: media.player, mode: .fit)
        let fullscreenReady = await waitFor { fullscreen.playerLayer.isReadyForDisplay }
        XCTAssertTrue(fullscreenReady)
        XCTAssertNil(inline.playerLayer.player)
        XCTAssertTrue(fullscreen.playerLayer.player === media.player)
        XCTAssertTrue(media.player.currentItem === originalItem)
        XCTAssertEqual(media.player.rate, 0)

        var geometry: [[String: Any]] = []
        for size in [CGSize(width: 768, height: 1024), CGSize(width: 1024, height: 768)] {
            fullscreen.frame = CGRect(origin: .zero, size: size)
            fullscreen.setNeedsLayout()
            fullscreen.layoutIfNeeded()
            for mode in [VideoDisplayMode.fit, VideoDisplayMode.fill] {
                fullscreen.configure(player: media.player, mode: mode)
                let expectedGravity: AVLayerVideoGravity = mode == .fit ? .resizeAspect : .resizeAspectFill
                XCTAssertEqual(fullscreen.playerLayer.videoGravity, expectedGravity)
                let rectReady = await waitFor {
                    let rect = fullscreen.playerLayer.videoRect
                    if rect.width <= 0 || rect.height <= 0 { return false }
                    if mode == .fit {
                        return rect.width <= size.width + 1 && rect.height <= size.height + 1 &&
                            (abs(rect.width - size.width) < 1 || abs(rect.height - size.height) < 1)
                    }
                    return rect.width >= size.width - 1 && rect.height >= size.height - 1
                }
                XCTAssertTrue(rectReady, "Unexpected videoRect for \(mode.rawValue): \(fullscreen.playerLayer.videoRect)")
                let rect = fullscreen.playerLayer.videoRect
                // In aspectFill, videoRect reports the visible clipped image bounds,
                // so its aspect can equal the viewport rather than the source image.
                XCTAssertEqual(originalItem.presentationSize, presentationSize,
                               "Changing display mode must not replace or reshape the source presentation")
                XCTAssertEqual(rect.midX, size.width / 2, accuracy: 1)
                XCTAssertEqual(rect.midY, size.height / 2, accuracy: 1)
                if mode == .fit {
                    XCTAssertEqual(rect.width / rect.height, sourceAspect, accuracy: 0.01,
                                   "Fit must display the complete image at its original ratio")
                    XCTAssertGreaterThanOrEqual(rect.minX, -1)
                    XCTAssertGreaterThanOrEqual(rect.minY, -1)
                    XCTAssertLessThanOrEqual(rect.maxX, size.width + 1)
                    XCTAssertLessThanOrEqual(rect.maxY, size.height + 1)
                } else {
                    XCTAssertLessThanOrEqual(rect.minX, 1)
                    XCTAssertLessThanOrEqual(rect.minY, 1)
                    XCTAssertGreaterThanOrEqual(rect.maxX, size.width - 1)
                    XCTAssertGreaterThanOrEqual(rect.maxY, size.height - 1)
                    XCTAssertTrue(fullscreen.clipsToBounds)
                }
                geometry.append(["width": size.width, "height": size.height, "mode": mode.rawValue,
                                 "gravity": fullscreen.playerLayer.videoGravity.rawValue,
                                 "visibleVideoRect": NSCoder.string(for: rect),
                                 "sourcePresentationSize": NSCoder.string(for: originalItem.presentationSize)])
            }
        }
        XCTAssertEqual(media.player.currentTime().seconds, pausedAt, accuracy: 0.1)
        XCTAssertEqual(media.subtitleText, subtitleBefore)
        fullscreen.configure(player: nil, mode: .fill)
        inline.configure(player: media.player, mode: .fit)
        XCTAssertNil(fullscreen.playerLayer.player)
        XCTAssertTrue(inline.playerLayer.player === media.player)
        XCTAssertTrue(media.player.currentItem === originalItem)
        XCTAssertEqual(media.player.currentTime().seconds, pausedAt, accuracy: 0.1)
        media.playPause()
        let resumed = await waitFor { media.player.currentTime().seconds > pausedAt + 0.4 }
        XCTAssertTrue(resumed, "The same player must still resume after returning from fullscreen")

        let evidence: [String: Any] = ["actualAppRenderer": "Tooplay.PlayerSurfaceView",
            "geometry": geometry, "pausedAt": pausedAt, "currentItemPreserved": true,
            "subtitlePreserved": media.subtitleText == subtitleBefore, "resumedAfterHandoff": resumed]
        let json = try JSONSerialization.data(withJSONObject: evidence, options: [.sortedKeys, .prettyPrinted])
        let attachment = XCTAttachment(data: json, uniformTypeIdentifier: "public.json")
        attachment.name = "Actual fullscreen renderer evidence"; attachment.lifetime = .keepAlways; add(attachment)
        print("FULLSCREEN_NATIVE_EVIDENCE " + String(decoding: json, as: UTF8.self))
    }
}
