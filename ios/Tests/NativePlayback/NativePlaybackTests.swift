import XCTest
import AVFoundation
import CoreVideo
import CoreImage
import UIKit
import QuartzCore
@testable import Tooplay

final class NativePlaybackTests: XCTestCase {
    @MainActor
    func testLocalPlaybackUsesAudioSessionThatIsAudibleInSilentMode() async throws {
        // Start with the default policy which silences app audio in Silent Mode.
        let session = AVAudioSession.sharedInstance()
        try session.setActive(false, options: .notifyOthersOnDeactivation)
        try session.setCategory(.soloAmbient, mode: .default)
        let video = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "Tooplay-smoke-video", withExtension: "mp4"))
        let media = MediaController(cast: CastController())
        defer { media.stop() }
        await media.open(video)
        XCTAssertNil(media.message)
        XCTAssertTrue(media.hasMedia)
        XCTAssertEqual(session.category, .playback, "Local movie audio must remain audible in Silent Mode")
        XCTAssertEqual(session.mode, .moviePlayback)
        XCTAssertFalse(media.player.isMuted)
        XCTAssertGreaterThan(media.player.volume, 0)
        let asset = try XCTUnwrap(media.player.currentItem?.asset)
        let audioTracks = try await asset.loadTracks(withMediaType: .audio)
        let track = try XCTUnwrap(audioTracks.first)
        let reader = try AVAssetReader(asset: asset)
        let output = AVAssetReaderTrackOutput(track: track, outputSettings: [
            AVFormatIDKey: kAudioFormatLinearPCM,
            AVLinearPCMBitDepthKey: 16,
            AVLinearPCMIsFloatKey: false,
            AVLinearPCMIsBigEndianKey: false,
            AVLinearPCMIsNonInterleaved: false
        ])
        reader.add(output)
        XCTAssertTrue(reader.startReading())
        var peak: Int = 0
        var sampleCount = 0
        while let buffer = output.copyNextSampleBuffer() {
            guard let block = CMSampleBufferGetDataBuffer(buffer) else { continue }
            let length = CMBlockBufferGetDataLength(block)
            var bytes = [UInt8](repeating: 0, count: length)
            let status = bytes.withUnsafeMutableBytes { ptr in
                CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: length, destination: ptr.baseAddress!)
            }
            XCTAssertEqual(status, kCMBlockBufferNoErr)
            for offset in stride(from: 0, to: length - 1, by: 2) {
                peak = max(peak, abs(Int(Int16(bitPattern: UInt16(bytes[offset]) | UInt16(bytes[offset + 1]) << 8))))
                sampleCount += 1
            }
            if sampleCount >= 48_000 { break }
        }
        reader.cancelReading()
        XCTAssertGreaterThan(peak, 300, "Audio fixture must contain audible decoded PCM, not anullsrc silence")
        print("AUDIO_PLAYBACK_EVIDENCE category=\(session.category.rawValue) mode=\(session.mode.rawValue) decodedPCMPeak=\(peak) samples=\(sampleCount)")
    }

    @MainActor
    private func waitFor(_ timeout: Double = 8, condition: () -> Bool) async -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if condition() { return true }
            try? await Task.sleep(nanoseconds: 50_000_000)
        }
        return condition()
    }

    private func fingerprint(_ buffer: CVPixelBuffer) -> UInt64 {
        CVPixelBufferLockBaseAddress(buffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
        guard let address = CVPixelBufferGetBaseAddress(buffer) else { return 0 }
        let bytes = address.assumingMemoryBound(to: UInt8.self)
        let length = CVPixelBufferGetBytesPerRow(buffer) * CVPixelBufferGetHeight(buffer)
        var hash: UInt64 = 14695981039346656037
        for offset in stride(from: 0, to: length, by: max(1, length / 8192)) {
            hash = (hash ^ UInt64(bytes[offset])) &* 1099511628211
        }
        return hash
    }

    @MainActor
    func testActualMediaControllerDecodesPlaysPausesSeeksAndLoadsSRT() async throws {
        continueAfterFailure = false
        let bundle = Bundle(for: Self.self)
        let video = try XCTUnwrap(bundle.url(forResource: "Tooplay-smoke-video", withExtension: "mp4"))
        let subtitle = try XCTUnwrap(bundle.url(forResource: "Tooplay-smoke-subtitle", withExtension: "srt"))
        let expectedCues = SubtitleParser.parse(try SubtitleParser.decode(Data(contentsOf: subtitle)))
        let cue = try XCTUnwrap(expectedCues.first)
        // The real host app already configures Google Cast. No discovery or TV connection is initiated here.
        let media = MediaController(cast: CastController())
        defer { media.stop() }
        await media.open(video)
        XCTAssertNil(media.message)
        XCTAssertTrue(media.hasMedia)
        XCTAssertFalse(media.busy)
        XCTAssertGreaterThan(media.duration, 10)
        let item = try XCTUnwrap(media.player.currentItem)
        let output = AVPlayerItemVideoOutput(pixelBufferAttributes: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
        item.add(output)
        defer { item.remove(output) }
        let ready = await waitFor { item.status == .readyToPlay && media.playing }
        XCTAssertTrue(ready, "Actual AVPlayerItem did not become playable: \(String(describing: item.error))")

        let initialTime = media.player.currentTime().seconds
        var samples: [[String: Any]] = []
        var hashes = Set<UInt64>()
        let deadline = Date().addingTimeInterval(8)
        while Date() < deadline {
            let time = output.itemTime(forHostTime: CACurrentMediaTime())
            if output.hasNewPixelBuffer(forItemTime: time),
               let pixels = output.copyPixelBuffer(forItemTime: time, itemTimeForDisplay: nil) {
                let hash = fingerprint(pixels)
                hashes.insert(hash)
                samples.append(["itemTime": time.seconds, "hash": String(hash),
                                "width": CVPixelBufferGetWidth(pixels), "height": CVPixelBufferGetHeight(pixels)])
                if samples.count == 1 || samples.count == 12,
                   let frame = CIContext().createCGImage(CIImage(cvPixelBuffer: pixels), from: CGRect(x: 0, y: 0, width: CVPixelBufferGetWidth(pixels), height: CVPixelBufferGetHeight(pixels))) {
                    let attachment = XCTAttachment(image: UIImage(cgImage: frame))
                    attachment.name = "Decoded AVPlayer frame \(samples.count)"
                    attachment.lifetime = .keepAlways
                    add(attachment)
                }
            }
            if hashes.count >= 3 && media.player.currentTime().seconds - initialTime > 1.2 { break }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        XCTAssertGreaterThanOrEqual(samples.count, 3, "No decoded video frame sequence from the actual player")
        XCTAssertGreaterThanOrEqual(hashes.count, 3, "Decoded video frames did not change")
        let progressedTime = media.player.currentTime().seconds
        XCTAssertGreaterThan(progressedTime - initialTime, 1.2)

        media.playPause()
        let paused = await waitFor { !media.playing && media.player.rate == 0 }
        XCTAssertTrue(paused)
        let pauseTime = media.player.currentTime().seconds
        try await Task.sleep(nanoseconds: 350_000_000)
        XCTAssertEqual(media.player.currentTime().seconds, pauseTime, accuracy: 0.08)

        let seekTarget = min(media.duration - 1, 8)
        media.seek(seekTarget)
        let sought = await waitFor { abs(media.player.currentTime().seconds - seekTarget) < 0.15 }
        XCTAssertTrue(sought, "Actual player did not seek to \(seekTarget)")
        XCTAssertEqual(media.player.rate, 0)
        let soughtTime = media.player.currentTime().seconds

        await media.openSubtitle(subtitle)
        XCTAssertNil(media.message)
        XCTAssertEqual(media.subtitleName, subtitle.lastPathComponent)
        let cueTime = min(media.duration - 0.5, cue.start + min(1, (cue.end - cue.start) / 2))
        media.seek(cueTime)
        let visible = await waitFor { media.subtitleText == cue.text && abs(media.position - cueTime) < 0.15 }
        XCTAssertTrue(visible, "Loaded SRT did not follow the real player position")
        media.toggleSubtitles()
        let hidden = await waitFor { media.subtitleText.isEmpty }
        XCTAssertTrue(hidden)
        media.toggleSubtitles()
        let restored = await waitFor { media.subtitleText == cue.text }
        XCTAssertTrue(restored)

        let evidence: [String: Any] = ["mediaController": "Tooplay.MediaController (hosted application)",
            "duration": media.duration, "initialTime": initialTime, "progressedTime": progressedTime,
            "pauseTime": pauseTime, "seekTarget": seekTarget, "actualSeekTime": soughtTime,
            "decodedFrames": samples, "uniqueFrameHashes": hashes.count, "subtitle": media.subtitleText,
            "subtitleHideAndRestore": hidden && restored]
        let json = try JSONSerialization.data(withJSONObject: evidence, options: [.prettyPrinted, .sortedKeys])
        let attachment = XCTAttachment(data: json, uniformTypeIdentifier: "public.json")
        attachment.name = "Actual native playback evidence"
        attachment.lifetime = .keepAlways
        add(attachment)
        print("NATIVE_PLAYBACK_EVIDENCE " + String(decoding: json, as: UTF8.self))
    }
}
