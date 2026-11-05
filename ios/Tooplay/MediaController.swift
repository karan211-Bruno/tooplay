import Foundation
import AVFoundation
import UIKit
import Combine

@MainActor final class MediaController: ObservableObject {
    let player = AVPlayer()
    let cast: CastController
    @Published private(set) var title = "영상을 선택해 주세요"
    @Published private(set) var duration: Double = 0
    @Published private(set) var position: Double = 0
    @Published private(set) var playing = false
    @Published private(set) var subtitleText = ""
    @Published private(set) var subtitleName = ""
    @Published var subtitlesVisible = true
    @Published private(set) var hasMedia = false
    @Published private(set) var busy = false
    @Published private(set) var preparation = ""
    @Published private(set) var progress: Double = 0
    @Published private(set) var casting = false
    @Published var message: String?
    private var source: URL?
    private var directory: URL?
    private var preparedVideo: URL?
    private var server: LocalMediaServer?
    private var cues: [SubtitleCue] = []
    private var exporter: AVAssetExportSession?
    private var loadingCast = false
    private var resumeAfterPreparation = false
    private var generation = UUID()
    private var subtitleRequest = UUID()
    private var timer: Timer?
    private var itemObservation: NSKeyValueObservation?
    private let cacheRoot: URL

    init(cast: CastController) {
        self.cast = cast
        cacheRoot = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("TooplayMedia", isDirectory: true)
        try? FileManager.default.removeItem(at: cacheRoot)
        try? FileManager.default.createDirectory(at: cacheRoot, withIntermediateDirectories: true)
        cast.onDisconnected = { [weak self] in
            guard let self, self.casting else { return }
            self.stopCasting(); self.message = "TV 연결이 끊겼습니다. 전송 버튼으로 다시 연결하세요."
        }
        timer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in Task { @MainActor in self?.update() } }
    }
    private func update() {
        if casting { position = cast.position; playing = cast.playing }
        else {
            let seconds = player.currentTime().seconds
            position = seconds.isFinite ? max(0, seconds) : 0
            playing = player.timeControlStatus == .playing
        }
        subtitleText = subtitlesVisible && !casting ? SubtitleParser.visible(cues, at: position) : ""
        if let exporter { progress = Double(exporter.progress) }
    }
    func open(_ url: URL) async {
        guard !busy else { return }
        stopCasting(); player.pause(); generation = UUID()
        let id = generation
        busy = true; preparation = "영상을 가져오는 중"; progress = 0; message = nil
        defer { if generation == id { busy = false; preparation = "" } }
        do {
            let newDirectory = cacheRoot.appendingPathComponent(UUID().uuidString, isDirectory: true)
            try FileManager.default.createDirectory(at: newDirectory, withIntermediateDirectories: true)
            let ext = url.pathExtension.isEmpty ? "mp4" : url.pathExtension
            let copied = newDirectory.appendingPathComponent("source.\(ext)")
            do {
                try await Task.detached(priority: .userInitiated) {
                    let access = url.startAccessingSecurityScopedResource()
                    defer { if access { url.stopAccessingSecurityScopedResource() } }
                    try FileManager.default.copyItem(at: url, to: copied)
                }.value
                let asset = AVURLAsset(url: copied)
                let (playable, time) = try await asset.load(.isPlayable, .duration)
                guard playable, time.seconds.isFinite, time.seconds > 0 else { throw AppFailure("이 영상 형식은 iPhone에서 재생할 수 없습니다. MP4(H.264/AAC)로 변환하거나 컴퓨터 연결 모드를 이용해 주세요.") }
                guard generation == id else { try? FileManager.default.removeItem(at: newDirectory); return }
                let item = AVPlayerItem(asset: asset)
                itemObservation = item.observe(\.status, options: [.new]) { [weak self] item, _ in
                    guard item.status == .failed else { return }
                    Task { @MainActor in
                        guard let self, self.generation == id, self.player.currentItem === item else { return }
                        self.message = item.error?.localizedDescription ?? "영상을 재생하지 못했습니다."
                    }
                }
                player.replaceCurrentItem(with: item)
                if let directory { try? FileManager.default.removeItem(at: directory) }
                directory = newDirectory; source = copied; preparedVideo = nil
                cues = []; subtitleName = ""; subtitlesVisible = true
                duration = time.seconds; title = url.lastPathComponent; hasMedia = true; playLocally()
            } catch { try? FileManager.default.removeItem(at: newDirectory); throw error }
        } catch { if generation == id { message = error.localizedDescription } }
    }
    func openSubtitle(_ url: URL) async {
        guard hasMedia, !busy else { return }
        let id = generation, requestID = UUID(); subtitleRequest = requestID
        do {
            let data = try await Task.detached(priority: .userInitiated) {
                let access = url.startAccessingSecurityScopedResource()
                defer { if access { url.stopAccessingSecurityScopedResource() } }
                let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
                guard size <= 8 * 1024 * 1024 else { throw AppFailure("자막 파일은 8MB 이하로 선택해 주세요.") }
                let file = try FileHandle(forReadingFrom: url)
                defer { try? file.close() }
                var data = Data()
                while let chunk = try file.read(upToCount: min(65536, 8 * 1024 * 1024 + 1 - data.count)), !chunk.isEmpty {
                    data.append(chunk)
                    guard data.count <= 8 * 1024 * 1024 else { throw AppFailure("자막 파일은 8MB 이하로 선택해 주세요.") }
                }
                return data
            }.value
            guard generation == id, subtitleRequest == requestID else { return }
            let parsed = SubtitleParser.parse(try SubtitleParser.decode(data))
            guard !parsed.isEmpty else { throw AppFailure("SRT 또는 VTT 자막을 선택해 주세요.") }
            cues = parsed; subtitleName = url.lastPathComponent; subtitlesVisible = true
            if casting { await startCasting() }
        } catch { if generation == id, subtitleRequest == requestID { message = error.localizedDescription } }
    }
    func toggleSubtitles() {
        subtitlesVisible.toggle()
        if casting { cast.setSubtitles(subtitlesVisible) }
    }
    private func playLocally() {
        do {
            // Movie sound should remain audible when iPhone/iPad Silent Mode is on.
            // Activate only when playback is requested, so opening the app does not interrupt other audio.
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .moviePlayback)
            try session.setActive(true)
            player.play()
        } catch {
            message = "영상 소리를 준비하지 못했습니다. 다시 재생해 주세요. (\(error.localizedDescription))"
        }
    }
    func playPause() { if casting { cast.playPause() } else if playing { player.pause() } else { playLocally() } }
    func seek(_ seconds: Double) {
        let time = min(duration, max(0, seconds))
        if casting { cast.seek(time) }
        else { player.seek(to: CMTime(seconds: time, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero) }
    }
    func startCasting() async {
        guard !busy, let source, let directory else { return }
        guard cast.connected else { message = "상단 Cast 버튼에서 TV를 선택한 뒤 ‘이 영상을 TV로’를 눌러 주세요."; return }
        let id = generation, start = position, wasPlaying = playing
        busy = true; preparation = "TV용 720p 영상을 준비하는 중"; message = nil; progress = 0
        resumeAfterPreparation = !casting && wasPlaying
        if !casting { player.pause() }
        UIApplication.shared.isIdleTimerDisabled = true
        defer {
            if generation == id {
                busy = false; preparation = ""; exporter = nil
                UIApplication.shared.isIdleTimerDisabled = casting
            }
        }
        do {
            let video: URL
            if let preparedVideo { video = preparedVideo }
            else {
                let destination = directory.appendingPathComponent("cast-\(UUID().uuidString).mp4")
                defer { if preparedVideo != destination { try? FileManager.default.removeItem(at: destination) } }
                try? FileManager.default.removeItem(at: destination)
                let asset = AVURLAsset(url: source)
                guard let export = AVAssetExportSession(asset: asset, presetName: AVAssetExportPreset1280x720),
                      export.supportedFileTypes.contains(.mp4) else { throw AppFailure("이 영상을 TV용으로 변환할 수 없습니다. 컴퓨터 연결 모드를 이용해 주세요.") }
                let composition = AVMutableVideoComposition(propertiesOf: asset)
                composition.frameDuration = CMTime(value: 1, timescale: 30)
                export.videoComposition = composition
                export.outputURL = destination; export.outputFileType = .mp4; export.shouldOptimizeForNetworkUse = true
                exporter = export
                try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                    export.exportAsynchronously {
                        if export.status == .completed { continuation.resume() }
                        else { continuation.resume(throwing: export.error ?? AppFailure("영상 준비가 취소되었거나 저장 공간이 부족합니다.")) }
                    }
                }
                guard generation == id else { return }
                preparedVideo = destination; video = destination
            }
            guard generation == id else { return }
            preparation = "TV에 연결하는 중"; progress = 1
            if server == nil {
                let newServer = LocalMediaServer(); server = newServer
                _ = try await newServer.start()
                guard generation == id else { newServer.stop(); return }
            }
            guard let server, generation == id else { return }
            let videoURL = try await server.register(video, named: "movie.mp4", mime: "video/mp4")
            var subtitleURL: URL?
            if !cues.isEmpty {
                let path = directory.appendingPathComponent("subtitle.vtt")
                try SubtitleParser.vtt(cues).write(to: path, atomically: true, encoding: .utf8)
                subtitleURL = try await server.register(path, named: "subtitle-\(UUID().uuidString).vtt", mime: "text/vtt; charset=utf-8")
            }
            guard generation == id else { return }
            loadingCast = true
            defer { if generation == id { loadingCast = false } }
            try await cast.load(url: videoURL, title: title, duration: duration, time: start,
                                subtitleURL: subtitleURL, subtitleName: subtitleName, subtitlesEnabled: subtitlesVisible, autoplay: wasPlaying)
            guard generation == id else { return }
            player.pause(); casting = true; resumeAfterPreparation = false
        } catch {
            guard generation == id else { return }
            if !casting { server?.stop(); server = nil }
            if resumeAfterPreparation { playLocally(); resumeAfterPreparation = false }
            message = error.localizedDescription
        }
    }
    func cancelPreparation() {
        generation = UUID(); exporter?.cancelExport(); exporter = nil
        busy = false; preparation = ""
        if resumeAfterPreparation { playLocally(); resumeAfterPreparation = false }
        if loadingCast {
            cast.stop(); casting = false
            if position.isFinite { player.seek(to: CMTime(seconds: position, preferredTimescale: 600)) }
        }
        loadingCast = false
        if !casting { server?.stop(); server = nil }
        UIApplication.shared.isIdleTimerDisabled = casting
    }
    func stopCasting() {
        let resumeAt = casting ? cast.position : position
        let owned = casting || loadingCast
        cancelPreparation()
        if owned { cast.stop() }
        casting = false; server?.stop(); server = nil
        if resumeAt.isFinite { player.seek(to: CMTime(seconds: resumeAt, preferredTimescale: 600)) }
        UIApplication.shared.isIdleTimerDisabled = false
    }
    func enterBackground() {
        if casting || busy {
            stopCasting()
            message = "iPhone·iPad의 영상 전송은 앱이 열린 동안 사용할 수 있습니다. 앱을 열고 ‘이 영상을 TV로’를 눌러 이어서 보내세요."
        }
        player.pause()
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
    func stop() {
        stopCasting(); player.pause(); player.replaceCurrentItem(with: nil)
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        itemObservation = nil; source = nil; preparedVideo = nil; cues = []
        hasMedia = false; title = "영상을 선택해 주세요"; duration = 0; position = 0; subtitleName = ""
        if let directory { try? FileManager.default.removeItem(at: directory) }; directory = nil
    }
}
