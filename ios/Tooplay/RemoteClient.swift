import Foundation
import Combine

struct RemoteSubtitle: Decodable, Identifiable { let id: String; let name: String }
struct RemoteDevice: Decodable, Identifiable { let id: String; let name: String; let model: String? }
struct RemoteState: Decodable {
    let protocolVersion: Int
    let title: String
    let hasMedia: Bool
    let playing: Bool
    let currentTime: Double
    let duration: Double
    let volume: Double
    let casting: Bool
    let castDevice: RemoteDevice?
    let subtitles: [RemoteSubtitle]
    let selectedSubtitleId: String?
    let devices: [RemoteDevice]
    let preparing: Bool
    let lastError: String?
}
private struct PairReply: Decodable { let token: String; let serverName: String; let protocolVersion: Int }
private struct RemoteHTTPFailure: LocalizedError {
    let status: Int
    let message: String
    var errorDescription: String? { message }
}
private final class NoRedirect: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}

@MainActor final class RemoteClient: ObservableObject {
    @Published var address = UserDefaults.standard.string(forKey: "remoteAddress") ?? ""
    @Published var code = ""
    @Published private(set) var serverName = ""
    @Published private(set) var state: RemoteState?
    @Published private(set) var connected = false
    @Published private(set) var healthy = false
    @Published private(set) var busy = false
    @Published var error: String?
    private let noRedirect = NoRedirect()
    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 12
        config.timeoutIntervalForResource = 20
        config.httpShouldSetCookies = false
        config.urlCache = nil
        return URLSession(configuration: config, delegate: noRedirect, delegateQueue: nil)
    }()
    private var baseURL: URL?
    private var token: String?
    private var pollTask: Task<Void, Never>?
    private var pollID: UUID?
    private var refreshID: UUID?
    private var visible = false
    private var generation = UUID()

    private func request(_ url: URL, method: String = "GET", body: [String: Any]? = nil, token: String? = nil) async throws -> Data {
        var req = URLRequest(url: url); req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body { req.httpBody = try JSONSerialization.data(withJSONObject: body); req.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        let (data, response) = try await session.data(for: req)
        guard data.count <= 1024 * 1024, let http = response as? HTTPURLResponse else { throw AppFailure("컴퓨터의 응답이 올바르지 않습니다.") }
        guard (200..<300).contains(http.statusCode) else {
            let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
            throw RemoteHTTPFailure(status: http.statusCode, message: message ?? (http.statusCode == 401 ? "연결이 만료되었습니다. 새 코드로 연결하세요." : "컴퓨터 응답 오류 (\(http.statusCode))"))
        }
        return data
    }
    func pair() async {
        guard !busy else { return }
        disconnect()
        let id = generation
        busy = true; error = nil
        defer { if generation == id { busy = false } }
        do {
            let base = try LANAddress.baseURL(address)
            guard code.utf8.count == 6, code.utf8.allSatisfy({ $0 >= 48 && $0 <= 57 }) else { throw AppFailure("컴퓨터에 표시된 6자리 연결 코드를 입력하세요.") }
            let data = try await request(base.appendingPathComponent("api/pair"), method: "POST", body: ["code": code, "name": "Tooplay iPhone / iPad"])
            let reply = try JSONDecoder().decode(PairReply.self, from: data)
            guard generation == id, !Task.isCancelled else {
                revoke(base: base, token: reply.token)
                return
            }
            guard reply.protocolVersion == 1, !reply.token.isEmpty else { throw AppFailure("컴퓨터 Tooplay를 최신 버전으로 업데이트하세요.") }
            baseURL = base; token = reply.token; serverName = reply.serverName; connected = true; code = ""
            UserDefaults.standard.set(base.absoluteString, forKey: "remoteAddress")
            await refresh()
            if generation == id { startPolling() }
        } catch {
            guard generation == id, !Task.isCancelled else { return }
            self.error = error.localizedDescription; healthy = false
        }
    }
    func setVisible(_ value: Bool) {
        visible = value
        if value { startPolling() } else { stopPolling() }
    }
    private func stopPolling() {
        pollID = nil; pollTask?.cancel(); pollTask = nil
    }
    private func startPolling() {
        guard visible, connected, pollTask == nil else { return }
        let id = UUID(); pollID = id
        pollTask = Task { [weak self] in
            defer {
                if self?.pollID == id { self?.pollTask = nil; self?.pollID = nil }
            }
            while !Task.isCancelled {
                guard let self, self.connected else { return }
                await self.refresh()
                do { try await Task.sleep(nanoseconds: 1_000_000_000) } catch { return }
            }
        }
    }
    private func refresh() async {
        guard refreshID == nil, let baseURL, let token else { return }
        let id = generation, requestID = UUID(); refreshID = requestID
        defer { if refreshID == requestID { refreshID = nil } }
        do {
            let data = try await request(baseURL.appendingPathComponent("api/state"), token: token)
            let next = try JSONDecoder().decode(RemoteState.self, from: data)
            guard generation == id, !Task.isCancelled else { return }
            guard next.protocolVersion == 1, next.currentTime.isFinite, next.duration.isFinite, next.volume.isFinite else { throw AppFailure("재생 상태를 읽을 수 없습니다.") }
            state = next; healthy = true; error = next.lastError
        } catch {
            guard generation == id, !Task.isCancelled else { return }
            handleFailure(error)
        }
    }
    func command(_ command: String, value: Double? = nil, deviceID: String? = nil, trackID: String? = nil) async {
        guard let baseURL, let token, !busy else { return }
        let id = generation
        busy = true; error = nil
        defer { if generation == id { busy = false } }
        var payload: [String: Any] = ["command": command]
        if let value, value.isFinite { payload["value"] = value }
        if let deviceID { payload["deviceId"] = deviceID }
        if command == "subtitle" { payload["trackId"] = trackID.map { $0 as Any } ?? NSNull() }
        do {
            _ = try await request(baseURL.appendingPathComponent("api/command"), method: "POST", body: payload, token: token)
            guard generation == id, !Task.isCancelled else { return }
            await refresh()
        } catch {
            guard generation == id, !Task.isCancelled else { return }
            handleFailure(error)
        }
    }
    private func revoke(base: URL, token: String) {
        Task { _ = try? await request(base.appendingPathComponent("api/session"), method: "DELETE", token: token) }
    }
    private func handleFailure(_ failure: Error) {
        if let http = failure as? RemoteHTTPFailure, http.status == 401 {
            clearConnection()
            code = ""
        }
        healthy = false; error = failure.localizedDescription
    }
    private func clearConnection() {
        generation = UUID(); stopPolling(); refreshID = nil
        token = nil; baseURL = nil; state = nil; connected = false; healthy = false; busy = false; serverName = ""
    }
    func disconnect() {
        if let baseURL, let token { revoke(base: baseURL, token: token) }
        clearConnection(); error = nil
    }
}
