import SwiftUI
import UIKit

@MainActor @main struct TooplayApp: App {
    @StateObject private var cast: CastController
    @StateObject private var media: MediaController
    @StateObject private var remote = RemoteClient()
    @Environment(\.scenePhase) private var phase
    @State private var tab = 0
    init() {
        CastController.configure()
        let controller = CastController()
        _cast = StateObject(wrappedValue: controller)
        _media = StateObject(wrappedValue: MediaController(cast: controller))
    }
    var body: some Scene {
        WindowGroup {
            TabView(selection: $tab) {
                LocalView(media: media, cast: cast).tag(0)
                    .tabItem { Label("내 기기 영상", systemImage: "play.rectangle.fill") }
                RemoteView(remote: remote).tag(1)
                    .tabItem { Label("컴퓨터 연결", systemImage: "desktopcomputer") }
            }
            .tint(Theme.accent).preferredColorScheme(.dark)
            .onChange(of: tab) { remote.setVisible($0 == 1 && phase == .active) }
            .onChange(of: phase) { value in
                remote.setVisible(value == .active && tab == 1)
                if value == .background { media.enterBackground() }
            }
        }
    }
}
