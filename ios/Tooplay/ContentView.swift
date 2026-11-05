import SwiftUI
import AVKit
import UniformTypeIdentifiers

enum Theme {
    static let accent = Color(red: 0.32, green: 0.88, blue: 0.73)
    static let background = Color(red: 0.055, green: 0.063, blue: 0.078)
    static let card = Color(red: 0.105, green: 0.12, blue: 0.145)
}
private struct Panel<Content: View>: View {
    let content: Content
    init(@ViewBuilder content: () -> Content) { self.content = content() }
    var body: some View { VStack(alignment: .leading, spacing: 16) { content }.padding(20).frame(maxWidth: .infinity, alignment: .leading).background(Theme.card, in: RoundedRectangle(cornerRadius: 22)) }
}
private struct Notice: View {
    let text: String
    var body: some View { Label(text, systemImage: "info.circle").font(.subheadline).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
}
private struct MainButton: View {
    let label: String
    let symbol: String
    let action: () -> Void
    var body: some View {
        Button(action: action) { Label(label, systemImage: symbol).font(.headline).frame(maxWidth: .infinity).padding(.vertical, 8) }
            .buttonStyle(.borderedProminent).tint(Theme.accent).foregroundStyle(.black)
    }
}

struct LocalView: View {
    @ObservedObject var media: MediaController
    @ObservedObject var cast: CastController
    @State private var chooseVideo = false
    @State private var chooseSubtitle = false
    @State private var fullscreen = false
    @AppStorage("localVideoDisplayMode") private var displayMode: VideoDisplayMode = .fit
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    Text("내 기기의 영상을, 더 큰 화면으로.").font(.title2.bold()).padding(.top, 12)
                    if media.hasMedia {
                        ZStack(alignment: .bottom) {
                            PlayerSurface(player: fullscreen ? nil : media.player, mode: displayMode)
                                .accessibilityIdentifier("local-video-player")
                            if !media.subtitleText.isEmpty {
                                Text(media.subtitleText).font(.title3.weight(.semibold)).multilineTextAlignment(.center).accessibilityIdentifier("local-subtitle")
                                    .foregroundStyle(.white).padding(10).background(.black.opacity(0.7), in: RoundedRectangle(cornerRadius: 8))
                                    .padding(.horizontal, 18).padding(.bottom, 48).allowsHitTesting(false)
                            }
                            if media.casting {
                                VStack(spacing: 10) { Image(systemName: "tv").font(.largeTitle); Text("\(cast.deviceName)에서 재생 중").font(.headline) }
                                    .frame(maxWidth: .infinity, maxHeight: .infinity).background(Theme.card)
                            }
                        }.aspectRatio(16 / 9, contentMode: .fit).clipShape(RoundedRectangle(cornerRadius: 20))
                        Panel {
                            HStack {
                                Text(media.title).font(.headline).lineLimit(2)
                                Spacer(minLength: 12)
                                Button { fullscreen = true } label: {
                                    Label("전체화면", systemImage: "arrow.up.left.and.arrow.down.right")
                                }
                                .accessibilityIdentifier("local-fullscreen-open")
                                .disabled(media.busy || media.casting)
                            }
                            Picker("화면 비율", selection: $displayMode) {
                                ForEach(VideoDisplayMode.allCases) { mode in Text(mode.title).tag(mode) }
                            }.pickerStyle(.segmented).disabled(media.casting)
                            Text(displayMode == .fit ? "영상 전체를 원래 비율로 표시합니다." : "비율을 유지해 화면을 채우며 가장자리가 일부 잘릴 수 있습니다.")
                                .font(.caption).foregroundStyle(.secondary)
                            PlaybackControls(playing: media.playing, current: media.position, duration: media.duration,
                                playPause: media.playPause, seek: media.seek)
                                .disabled(media.busy)
                            HStack {
                                Image(systemName: "speaker.wave.2.fill").foregroundStyle(.secondary)
                                Slider(value: Binding(get: { media.casting ? cast.volume : Double(media.player.volume) },
                                    set: { if media.casting { cast.setVolume($0) } else { media.player.volume = Float($0) } }), in: 0...1)
                                    .accessibilityLabel("음량")
                            }
                            HStack {
                                Button { chooseSubtitle = true } label: { Label("자막 열기", systemImage: "captions.bubble") }
                                Spacer()
                                Button("영상 닫기", role: .destructive) { media.stop() }
                            }.disabled(media.busy)
                            if !media.subtitleName.isEmpty {
                                Toggle(isOn: Binding(get: { media.subtitlesVisible }, set: { _ in media.toggleSubtitles() })) {
                                    Text(media.subtitleName).font(.subheadline).lineLimit(1)
                                }
                            }
                        }
                    } else {
                        Panel {
                            Image(systemName: "play.rectangle.on.rectangle").font(.system(size: 56, weight: .light)).foregroundStyle(Theme.accent).padding(.vertical, 15)
                            Text("보고 싶은 영상을 선택하세요").font(.title3.bold())
                            Text("파일 앱의 영상을 열고, SRT·VTT 자막을 함께 볼 수 있어요.").foregroundStyle(.secondary)
                            MainButton(label: "영상 열기", symbol: "folder") { chooseVideo = true }
                        }
                    }
                    if media.busy {
                        Panel {
                            HStack { ProgressView(); Text(media.preparation).font(.headline) }
                            ProgressView(value: media.progress)
                            Notice(text: "TV용 영상 준비는 길이에 따라 시간이 걸립니다. 앱을 열어 두세요.")
                            Button("취소", role: .cancel) { media.cancelPreparation() }
                        }
                    }
                    if media.hasMedia {
                        Panel {
                            HStack {
                                VStack(alignment: .leading, spacing: 5) {
                                    Text("TV로 보내기").font(.title3.bold())
                                    Text(cast.connected ? cast.deviceName : "같은 Wi-Fi의 Chromecast를 선택하세요").font(.subheadline).foregroundStyle(.secondary)
                                }
                                Spacer(); CastButton().frame(width: 44, height: 44)
                            }
                            if media.casting {
                                MainButton(label: "TV 전송 중지", symbol: "stop.circle") { media.stopCasting() }
                            } else {
                                MainButton(label: "이 영상을 TV로", symbol: "tv") { Task { await media.startCasting() } }.disabled(media.busy)
                            }
                            Notice(text: "내 기기 영상을 전송할 때는 앱을 열어 두세요. 화면을 잠그거나 다른 앱으로 이동하면 전송을 중단합니다. 컴퓨터 연결 모드는 휴대폰 화면을 꺼도 컴퓨터에서 재생이 계속됩니다.")
                        }
                    }
                    if let message = media.message ?? cast.error { Notice(text: message).foregroundStyle(.orange) }
                    Notice(text: "MP4·MOV 등 iOS에서 지원하는 영상과 SRT·VTT 자막을 재생합니다. 지원하지 않는 영상은 컴퓨터 연결 모드를 이용하세요.")
                }.padding(20).frame(maxWidth: 900)
            }.frame(maxWidth: .infinity).background(Theme.background)
                .navigationTitle("TOOPLAY").navigationBarTitleDisplayMode(.inline)
                .toolbar { if media.hasMedia { Button { chooseVideo = true } label: { Image(systemName: "folder.badge.plus") }.disabled(media.busy).accessibilityLabel("다른 영상 열기") } }
        }
        .fullScreenCover(isPresented: $fullscreen) {
            FullscreenPlayerView(media: media, mode: $displayMode)
        }
        .fileImporter(isPresented: $chooseVideo, allowedContentTypes: [.movie, .video], allowsMultipleSelection: false) { result in
            switch result { case .success(let urls): if let url = urls.first { Task { await media.open(url) } }; case .failure(let error): media.message = error.localizedDescription }
        }
        .fileImporter(isPresented: $chooseSubtitle, allowedContentTypes: [.data, .text], allowsMultipleSelection: false) { result in
            switch result { case .success(let urls): if let url = urls.first { Task { await media.openSubtitle(url) } }; case .failure(let error): media.message = error.localizedDescription }
        }
    }
}

struct PlaybackControls: View {
    let playing: Bool
    let current: Double
    let duration: Double
    let playPause: () -> Void
    let seek: (Double) -> Void
    var onSeekingChanged: (Bool) -> Void = { _ in }
    @State private var dragging = false
    @State private var draft: Double = 0
    var body: some View {
        VStack(spacing: 10) {
            Slider(value: Binding(get: { dragging ? draft : min(max(0, current), max(1, duration)) }, set: { draft = $0 }),
                   in: 0...max(1, duration), onEditingChanged: { editing in
                onSeekingChanged(editing)
                if editing { draft = min(max(0, current), max(1, duration)); dragging = true }
                else { dragging = false; seek(draft) }
            }).disabled(duration <= 0).accessibilityLabel("재생 위치")
            HStack { Text(clockText(dragging ? draft : current)).accessibilityIdentifier("playback-current-time"); Spacer(); Text(clockText(duration)).accessibilityIdentifier("playback-duration") }.font(.caption.monospacedDigit()).foregroundStyle(.secondary)
            HStack(spacing: 42) {
                Button { seek(max(0, current - 10)) } label: { Image(systemName: "gobackward.10").font(.title) }.accessibilityLabel("10초 뒤로")
                Button(action: playPause) { Image(systemName: playing ? "pause.circle.fill" : "play.circle.fill").font(.system(size: 60)) }.accessibilityLabel(playing ? "일시정지" : "재생")
                Button { seek(min(duration, current + 10)) } label: { Image(systemName: "goforward.10").font(.title) }.accessibilityLabel("10초 앞으로")
            }.frame(maxWidth: .infinity).padding(.vertical, 4)
        }
    }
}

struct RemoteView: View {
    @ObservedObject var remote: RemoteClient
    @State private var volumeDraft: Double = 1
    @State private var volumeEditing = false
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    Text("컴퓨터의 재생을 손안에서.").font(.title2.bold()).padding(.top, 12)
                    if !remote.connected {
                        Panel {
                            Image(systemName: "desktopcomputer").font(.system(size: 50, weight: .light)).foregroundStyle(Theme.accent).padding(.vertical, 12)
                            Text("컴퓨터 Tooplay와 연결").font(.title3.bold())
                            Text("같은 Wi-Fi에서 컴퓨터의 ‘휴대폰 연결’을 열고, 표시된 주소와 코드를 입력하세요.").foregroundStyle(.secondary)
                            TextField("192.168.1.5:54321", text: $remote.address).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                                .padding(12).background(Theme.background, in: RoundedRectangle(cornerRadius: 10)).accessibilityLabel("컴퓨터 주소")
                            TextField("6자리 연결 코드", text: $remote.code).keyboardType(.numberPad).textContentType(.oneTimeCode)
                                .padding(12).background(Theme.background, in: RoundedRectangle(cornerRadius: 10))
                            MainButton(label: remote.busy ? "연결 중…" : "컴퓨터 연결", symbol: "link") { Task { await remote.pair() } }.disabled(remote.busy)
                        }
                    } else {
                        Panel {
                            HStack {
                                Label(remote.serverName, systemImage: remote.healthy ? "checkmark.circle.fill" : "wifi.exclamationmark").foregroundStyle(remote.healthy ? Theme.accent : .orange)
                                Spacer(); Button("연결 해제") { remote.disconnect() }
                            }
                            if let state = remote.state {
                                Text(state.hasMedia ? state.title : "컴퓨터에서 영상을 열어 주세요").font(.title3.bold()).lineLimit(3)
                                Text(state.casting ? "\(state.castDevice?.name ?? "TV")에서 재생" : "컴퓨터에서 재생").font(.subheadline).foregroundStyle(.secondary)
                                if state.preparing { HStack { ProgressView(); Text("TV 전송을 준비하고 있습니다…"); Spacer(); Button("취소") { Task { await remote.command("cast-stop") } } } }
                                PlaybackControls(playing: state.playing, current: state.currentTime, duration: state.duration,
                                    playPause: { Task { await remote.command(state.playing ? "pause" : "play") } },
                                    seek: { time in Task { await remote.command("seek", value: time) } })
                                    .disabled(!state.hasMedia || !remote.healthy || remote.busy || state.preparing)
                                HStack {
                                    Image(systemName: "speaker.wave.2.fill")
                                    Slider(value: $volumeDraft, in: 0...1, onEditingChanged: { editing in
                                        volumeEditing = editing
                                        if !editing { Task { await remote.command("volume", value: volumeDraft) } }
                                    }).accessibilityLabel("컴퓨터 또는 TV 음량")
                                }.disabled(!remote.healthy || remote.busy)
                                HStack {
                                    Menu {
                                        Button("자막 끄기") { Task { await remote.command("subtitle") } }
                                        ForEach(state.subtitles) { track in Button(track.name) { Task { await remote.command("subtitle", trackID: track.id) } } }
                                    } label: { Label("자막", systemImage: "captions.bubble") }
                                    Spacer()
                                    Button("영상 닫기", role: .destructive) { Task { await remote.command("stop") } }
                                }.disabled(!state.hasMedia || !remote.healthy || remote.busy)
                            } else { ProgressView("재생 상태를 가져오는 중…") }
                        }
                        if let state = remote.state, state.hasMedia {
                            Panel {
                                Text("컴퓨터에서 TV로 전송").font(.title3.bold())
                                if state.casting {
                                    Button("TV 전송 중지") { Task { await remote.command("cast-stop") } }
                                } else if state.devices.isEmpty {
                                    Notice(text: "같은 Wi-Fi의 Chromecast를 찾고 있습니다. TV 전원을 확인해 주세요.")
                                } else {
                                    ForEach(state.devices) { device in
                                        Button { Task { await remote.command("cast-connect", deviceID: device.id) } } label: {
                                            HStack { Image(systemName: "tv"); Text(device.name); Spacer(); Image(systemName: "chevron.right") }.padding(.vertical, 8)
                                        }
                                    }
                                }
                            }.disabled(!remote.healthy || remote.busy || state.preparing)
                        }
                    }
                    if let error = remote.error { Notice(text: error).foregroundStyle(.orange) }
                    Notice(text: "컴퓨터는 켜 두세요. 영상과 자막은 컴퓨터에서 선택하며, 연결한 휴대폰에서는 재생과 TV 전송을 조작할 수 있습니다.")
                }.padding(20).frame(maxWidth: 760)
            }.frame(maxWidth: .infinity).background(Theme.background)
                .navigationTitle("컴퓨터 연결").navigationBarTitleDisplayMode(.inline)
        }
        .onChange(of: remote.state?.volume) { value in if let value, !volumeEditing { volumeDraft = min(1, max(0, value)) } }
    }
}
