import Foundation
import Combine
import GoogleCast
import SwiftUI

@MainActor final class CastController: NSObject, ObservableObject, @preconcurrency GCKRequestDelegate {
    @Published private(set) var connected = false
    @Published private(set) var deviceName = "TV 선택"
    @Published private(set) var playing = false
    @Published private(set) var position: Double = 0
    @Published private(set) var volume: Double = 1
    @Published var error: String?
    private var timer: Timer?
    private var pending: (GCKRequest, CheckedContinuation<Void, Error>)?
    var onDisconnected: (() -> Void)?
    private var client: GCKRemoteMediaClient? { GCKCastContext.sharedInstance().sessionManager.currentCastSession?.remoteMediaClient }

    static func configure() {
        let criteria = GCKDiscoveryCriteria(applicationID: kGCKDefaultMediaReceiverApplicationID)
        let options = GCKCastOptions(discoveryCriteria: criteria)
        GCKCastContext.setSharedInstanceWith(options)
        GCKCastContext.sharedInstance().useDefaultExpandedMediaControls = true
    }
    override init() {
        super.init()
        timer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in Task { @MainActor in self?.refresh() } }
    }
    private func refresh() {
        let session = GCKCastContext.sharedInstance().sessionManager.currentCastSession
        let wasConnected = connected
        connected = session?.connectionState == .connected
        deviceName = session?.device.friendlyName ?? "TV 선택"
        if let client, let status = client.mediaStatus {
            position = max(0, client.approximateStreamPosition())
            playing = status.playerState == .playing
            volume = Double(status.volume)
        }
        if wasConnected && !connected { cancelPending(); onDisconnected?() }
    }
    func load(url: URL, title: String, duration: Double, time: Double, subtitleURL: URL?, subtitleName: String, subtitlesEnabled: Bool, autoplay: Bool = true) async throws {
        guard let client, connected else { throw AppFailure("먼저 Cast 버튼에서 TV를 선택해 주세요.") }
        cancelPending(); error = nil
        let metadata = GCKMediaMetadata(metadataType: .movie)
        metadata.setString(title, forKey: kGCKMetadataKeyTitle)
        let info = GCKMediaInformationBuilder(contentURL: url)
        info.contentType = "video/mp4"; info.streamType = .buffered; info.metadata = metadata
        if duration.isFinite && duration > 0 { info.streamDuration = duration }
        if let subtitleURL, let track = GCKMediaTrack(identifier: 1, contentIdentifier: subtitleURL.absoluteString,
            contentType: "text/vtt", type: .text, textSubtype: .subtitles, name: subtitleName, languageCode: "und", customData: nil) {
            info.mediaTracks = [track]
        }
        let load = GCKMediaLoadRequestDataBuilder()
        load.mediaInformation = info.build(); load.autoplay = NSNumber(value: autoplay)
        load.startTime = time.isFinite ? max(0, time) : 0
        load.activeTrackIDs = subtitleURL != nil && subtitlesEnabled ? [NSNumber(value: 1)] : []
        try await withCheckedThrowingContinuation { continuation in
            let request = client.loadMedia(with: load.build())
            pending = (request, continuation); request.delegate = self
            DispatchQueue.main.asyncAfter(deadline: .now() + 25) { [weak self, weak request] in
                guard let self, let request, self.pending?.0 === request else { return }
                let waiting = self.pending; self.pending = nil
                waiting?.1.resume(throwing: AppFailure("TV가 영상 요청에 응답하지 않습니다. 같은 Wi-Fi인지 확인하세요."))
            }
        }
    }
    func requestDidComplete(_ request: GCKRequest) {
        guard pending?.0 === request else { return }
        let waiting = pending; pending = nil; waiting?.1.resume()
    }
    func request(_ request: GCKRequest, didFailWithError error: GCKError) {
        self.error = error.localizedDescription
        guard pending?.0 === request else { return }
        let waiting = pending; pending = nil; waiting?.1.resume(throwing: error)
    }
    func request(_ request: GCKRequest, didAbortWith abortReason: GCKRequestAbortReason) {
        guard pending?.0 === request else { return }
        cancelPending()
    }
    private func cancelPending() {
        let waiting = pending; pending = nil; waiting?.1.resume(throwing: CancellationError())
    }
    func playPause() { if playing { client?.pause().delegate = self } else { client?.play().delegate = self } }
    func seek(_ seconds: Double) {
        guard seconds.isFinite else { return }
        let options = GCKMediaSeekOptions(); options.interval = max(0, seconds)
        client?.seek(with: options).delegate = self
    }
    func setVolume(_ level: Double) { client?.setStreamVolume(Float(min(1, max(0, level)))).delegate = self }
    func setSubtitles(_ visible: Bool) { client?.setActiveTrackIDs(visible ? [NSNumber(value: 1)] : []).delegate = self }
    func stop() { cancelPending(); client?.stop().delegate = self }
    func disconnect() { stop(); GCKCastContext.sharedInstance().sessionManager.endSessionAndStopCasting(true) }
}

struct CastButton: UIViewRepresentable {
    func makeUIView(context: Context) -> GCKUICastButton {
        let button = GCKUICastButton(frame: .zero)
        button.tintColor = .white
        button.accessibilityLabel = "Chromecast TV 선택"
        return button
    }
    func updateUIView(_ uiView: GCKUICastButton, context: Context) {}
}
