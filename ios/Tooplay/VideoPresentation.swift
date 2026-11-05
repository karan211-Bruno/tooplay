import SwiftUI
import AVFoundation
import UIKit

enum VideoDisplayMode: String, CaseIterable, Identifiable {
    case fit, fill
    var id: String { rawValue }
    var title: String { self == .fit ? "원본 비율" : "화면 채우기" }
    var gravity: AVLayerVideoGravity { self == .fit ? .resizeAspect : .resizeAspectFill }
}

final class PlayerSurfaceView: UIView {
    override class var layerClass: AnyClass { AVPlayerLayer.self }
    var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .black
        clipsToBounds = true
        isAccessibilityElement = true
        accessibilityLabel = "동영상"
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    func configure(player: AVPlayer?, mode: VideoDisplayMode) {
        if playerLayer.player !== player { playerLayer.player = player }
        playerLayer.videoGravity = mode.gravity
        accessibilityValue = mode.title
    }
}

struct PlayerSurface: UIViewRepresentable {
    let player: AVPlayer?
    let mode: VideoDisplayMode
    func makeUIView(context: Context) -> PlayerSurfaceView {
        let view = PlayerSurfaceView()
        view.configure(player: player, mode: mode)
        return view
    }
    func updateUIView(_ view: PlayerSurfaceView, context: Context) {
        view.configure(player: player, mode: mode)
    }
    static func dismantleUIView(_ view: PlayerSurfaceView, coordinator: ()) {
        // The controller owns playback. Moving between surfaces must not stop or reset it.
        view.playerLayer.player = nil
    }
}

struct FullscreenPlayerView: View {
    @ObservedObject var media: MediaController
    @Binding var mode: VideoDisplayMode
    @Environment(\.dismiss) private var dismiss
    @State private var controlsVisible = true
    @State private var seeking = false
    @State private var interaction = UUID()

    private func keepControlsVisible() {
        controlsVisible = true
        interaction = UUID()
    }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            PlayerSurface(player: media.player, mode: mode)
                .ignoresSafeArea()
                .accessibilityIdentifier("fullscreen-video-player")
                .contentShape(Rectangle())
                .onTapGesture {
                    controlsVisible.toggle()
                    interaction = UUID()
                }
                .accessibilityAction(named: "재생 제어 표시") { keepControlsVisible() }

            VStack(spacing: 0) {
                if controlsVisible {
                    HStack(spacing: 16) {
                        Button { dismiss() } label: {
                            Label("닫기", systemImage: "arrow.down.right.and.arrow.up.left")
                                .padding(.vertical, 12)
                        }
                        .accessibilityLabel("전체화면 닫기")
                        .accessibilityIdentifier("fullscreen-close")
                        Text(media.title).font(.headline).lineLimit(1)
                        Spacer(minLength: 0)
                        if !media.subtitleName.isEmpty {
                            Button { media.toggleSubtitles(); keepControlsVisible() } label: {
                                Image(systemName: media.subtitlesVisible ? "captions.bubble.fill" : "captions.bubble")
                                    .padding(12)
                            }.accessibilityLabel(media.subtitlesVisible ? "자막 숨기기" : "자막 표시")
                        }
                    }
                    .padding(.horizontal, 20)
                    .background(.black.opacity(0.65))
                }
                Spacer(minLength: 8)
                if !media.subtitleText.isEmpty {
                    Text(media.subtitleText)
                        .font(.title3.weight(.semibold))
                        .multilineTextAlignment(.center)
                        .foregroundStyle(.white)
                        .padding(10)
                        .background(.black.opacity(0.7), in: RoundedRectangle(cornerRadius: 8))
                        .accessibilityIdentifier("fullscreen-subtitle")
                        .padding(.horizontal, 24)
                        .padding(.bottom, controlsVisible ? 12 : 28)
                        .allowsHitTesting(false)
                }
                if controlsVisible {
                    VStack(spacing: 12) {
                        HStack(spacing: 12) {
                            ForEach(VideoDisplayMode.allCases) { value in
                                Button {
                                    mode = value
                                    keepControlsVisible()
                                } label: {
                                    Label(value.title, systemImage: mode == value ? "checkmark.circle.fill" : "circle")
                                        .padding(.horizontal, 14).padding(.vertical, 10)
                                        .background(mode == value ? Color.white.opacity(0.22) : .clear, in: Capsule())
                                }
                                .accessibilityIdentifier("fullscreen-\(value.rawValue)")
                                .accessibilityAddTraits(mode == value ? .isSelected : [])
                            }
                        }
                        PlaybackControls(playing: media.playing, current: media.position, duration: media.duration,
                            playPause: { media.playPause(); keepControlsVisible() },
                            seek: { media.seek($0); keepControlsVisible() },
                            onSeekingChanged: { seeking = $0; keepControlsVisible() })
                    }
                    .frame(maxWidth: 760)
                    .padding(.horizontal, 20).padding(.vertical, 12)
                    .background(.black.opacity(0.65), in: RoundedRectangle(cornerRadius: 18))
                    .padding(.horizontal, 12).padding(.bottom, 8)
                }
            }
            .foregroundStyle(.white)
            .tint(.white)
            .buttonStyle(.plain)
        }
        .statusBarHidden(true)
        .persistentSystemOverlays(.hidden)
        .preferredColorScheme(.dark)
        .task(id: interaction) {
            guard controlsVisible, media.playing, !seeking, !UIAccessibility.isVoiceOverRunning else { return }
            do { try await Task.sleep(nanoseconds: 4_000_000_000) } catch { return }
            if media.playing { controlsVisible = false }
        }
        .onAppear { UIApplication.shared.isIdleTimerDisabled = media.playing || media.casting }
        .onChange(of: media.playing) { value in
            UIApplication.shared.isIdleTimerDisabled = value || media.casting
            keepControlsVisible()
        }
        .onChange(of: media.hasMedia) { if !$0 { dismiss() } }
        .onChange(of: media.casting) { if $0 { dismiss() } }
        .onDisappear { UIApplication.shared.isIdleTimerDisabled = media.casting }
    }
}
