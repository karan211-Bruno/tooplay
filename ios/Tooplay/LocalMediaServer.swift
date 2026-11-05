import Foundation
import Network
import Darwin

/// Serves only explicitly registered files, behind an unguessable URL, on the LAN.
/// Each response reads at most 64 KiB ahead of the socket, including multi-GB movies.
// All mutable state is confined to queue.
final class LocalMediaServer: @unchecked Sendable {
    private struct Resource { let url: URL; let mime: String }
    private final class Transfer {
        let connection: NWConnection
        var header = Data()
        var file: FileHandle?
        var remaining: UInt64 = 0
        var started = false
        init(_ connection: NWConnection) { self.connection = connection }
        deinit { try? file?.close() }
    }
    private let queue = DispatchQueue(label: "com.tooplay.ios.media-http")
    private var listener: NWListener?
    private var transfers: [UUID: Transfer] = [:]
    private var resources: [String: Resource] = [:]
    private var startWaiters: [CheckedContinuation<URL, Error>] = []
    private var token = ""
    private var base: URL?

    func start() async throws -> URL {
        guard let address = Self.wifiAddress() else { throw AppFailure("TV와 같은 Wi-Fi에 연결해 주세요.") }
        return try await withCheckedThrowingContinuation { continuation in
            queue.async { [self] in
                if let base, listener != nil { continuation.resume(returning: base); return }
                startWaiters.append(continuation)
                if listener != nil { return }
                do {
                    let listener = try NWListener(using: .tcp, on: .any)
                    token = UUID().uuidString.replacingOccurrences(of: "-", with: "") + UUID().uuidString.replacingOccurrences(of: "-", with: "")
                    self.listener = listener
                    listener.stateUpdateHandler = { [weak self, weak listener] state in
                        guard let self, let listener, self.listener === listener else { return }
                        switch state {
                        case .ready:
                            guard let port = listener.port, let url = URL(string: "http://\(address):\(port.rawValue)/\(self.token)/") else {
                                self.stopOnQueue(error: AppFailure("영상 서버 주소를 만들 수 없습니다.")); return
                            }
                            self.base = url; self.finishStart(.success(url))
                        case .failed(let error): self.stopOnQueue(error: error)
                        case .cancelled: self.stopOnQueue(error: AppFailure("영상 서버가 중지되었습니다."))
                        default: break
                        }
                    }
                    listener.newConnectionHandler = { [weak self] connection in self?.accept(connection) }
                    listener.start(queue: self.queue)
                    self.queue.asyncAfter(deadline: .now() + 10) { [weak self, weak listener] in
                        guard let self, let listener, self.listener === listener, self.base == nil else { return }
                        self.stopOnQueue(error: AppFailure("Wi-Fi 영상 서버를 시작하지 못했습니다."))
                    }
                } catch { stopOnQueue(error: error) }
            }
        }
    }
    func register(_ url: URL, named name: String, mime: String) async throws -> URL {
        try await withCheckedThrowingContinuation { continuation in
            queue.async { [self] in
                guard let base = self.base, !name.contains("/"), url.isFileURL,
                      FileManager.default.fileExists(atPath: url.path) else {
                    continuation.resume(throwing: AppFailure("전송 파일을 찾을 수 없습니다.")); return
                }
                let exposed = base.appendingPathComponent(name)
                self.resources[exposed.path] = Resource(url: url, mime: mime)
                continuation.resume(returning: exposed)
            }
        }
    }
    func stop() {
        queue.async { [self] in
            stopOnQueue(error: AppFailure("영상 서버가 중지되었습니다."))
        }
    }
    private func finishStart(_ result: Result<URL, Error>) {
        let waiting = startWaiters; startWaiters.removeAll()
        for continuation in waiting { continuation.resume(with: result) }
    }
    private func stopOnQueue(error: Error) {
        let oldListener = listener; listener = nil; base = nil
        oldListener?.stateUpdateHandler = nil
        oldListener?.newConnectionHandler = nil
        oldListener?.cancel()
        for transfer in transfers.values { transfer.connection.cancel(); try? transfer.file?.close() }
        transfers.removeAll(); resources.removeAll()
        finishStart(.failure(error))
    }
    private func accept(_ connection: NWConnection) {
        guard transfers.count < 12, case let .hostPort(host, _) = connection.endpoint,
              LANAddress.isPrivate(String(describing: host)) else { connection.cancel(); return }
        let id = UUID(), transfer = Transfer(connection)
        transfers[id] = transfer
        connection.stateUpdateHandler = { [weak self] state in
            if case .failed = state { self?.close(id) }
            if case .cancelled = state { self?.close(id) }
        }
        connection.start(queue: queue)
        queue.asyncAfter(deadline: .now() + 10) { [weak self, weak transfer] in
            if transfer?.started == false { self?.close(id) }
        }
        receive(id)
    }
    private func close(_ id: UUID) {
        guard let item = transfers.removeValue(forKey: id) else { return }
        try? item.file?.close(); item.file = nil; item.connection.cancel()
    }
    private func receive(_ id: UUID) {
        guard let item = transfers[id] else { return }
        item.connection.receive(minimumIncompleteLength: 1, maximumLength: 8192) { [weak self] data, _, done, error in
            guard let self, self.transfers[id] != nil else { return }
            if let data { item.header.append(data) }
            guard item.header.count <= 16384 else { self.reply(id, status: "431 Request Header Fields Too Large"); return }
            if let end = item.header.range(of: Data("\r\n\r\n".utf8)) {
                item.started = true
                self.route(id, header: String(decoding: item.header[..<end.lowerBound], as: UTF8.self))
            } else if done || error != nil { self.close(id) }
            else { self.receive(id) }
        }
    }
    private func route(_ id: UUID, header: String) {
        guard let item = transfers[id] else { return }
        let lines = header.components(separatedBy: "\r\n"), first = lines.first?.split(separator: " ") ?? []
        guard first.count == 3 else { reply(id, status: "400 Bad Request"); return }
        let method = String(first[0]), route = String(first[1])
        guard let resource = resources[route] else { reply(id, status: "404 Not Found"); return }
        if method == "OPTIONS" { reply(id, status: "204 No Content", headers: ["Access-Control-Allow-Methods": "GET, HEAD, OPTIONS", "Access-Control-Allow-Headers": "Range"]); return }
        guard method == "GET" || method == "HEAD" else { reply(id, status: "405 Method Not Allowed"); return }
        var rangeHeader: String?
        for line in lines.dropFirst() {
            guard let colon = line.firstIndex(of: ":") else { continue }
            if line[..<colon].lowercased() == "range" {
                if rangeHeader != nil { reply(id, status: "400 Bad Request"); return }
                rangeHeader = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
            }
        }
        do {
            let attributes = try FileManager.default.attributesOfItem(atPath: resource.url.path)
            let size = (attributes[.size] as? NSNumber)?.uint64Value ?? 0
            let range: ByteRange
            do { range = try ByteRange.parse(rangeHeader, size: size) }
            catch { reply(id, status: "416 Range Not Satisfiable", headers: ["Content-Range": "bytes */\(size)"]); return }
            var headers = ["Content-Type": resource.mime, "Content-Length": "\(range.length)", "Accept-Ranges": "bytes"]
            if rangeHeader != nil { headers["Content-Range"] = "bytes \(range.start)-\(range.end)/\(size)" }
            let status = rangeHeader == nil ? "200 OK" : "206 Partial Content"
            if method == "HEAD" { reply(id, status: status, headers: headers); return }
            item.file = try FileHandle(forReadingFrom: resource.url)
            try item.file?.seek(toOffset: range.start); item.remaining = range.length
            item.connection.send(content: headerData(status, headers), completion: .contentProcessed { [weak self] error in
                if error != nil { self?.close(id) } else { self?.sendChunk(id) }
            })
        } catch { reply(id, status: "500 Internal Server Error") }
    }
    private func headerData(_ status: String, _ headers: [String: String]) -> Data {
        var all = headers
        all["Connection"] = "close"; all["Access-Control-Allow-Origin"] = "*"
        all["Access-Control-Expose-Headers"] = "Content-Length, Content-Range, Accept-Ranges"
        all["Cache-Control"] = "no-store"
        if all["Content-Length"] == nil { all["Content-Length"] = "0" }
        return Data(("HTTP/1.1 \(status)\r\n" + all.map { "\($0.key): \($0.value)\r\n" }.joined() + "\r\n").utf8)
    }
    private func reply(_ id: UUID, status: String, headers: [String: String] = [:]) {
        transfers[id]?.connection.send(content: headerData(status, headers), completion: .contentProcessed { [weak self] _ in self?.close(id) })
    }
    private func sendChunk(_ id: UUID) {
        guard let item = transfers[id] else { return }
        guard item.remaining > 0 else { close(id); return }
        do {
            guard let bytes = try item.file?.read(upToCount: Int(min(item.remaining, 65536))), !bytes.isEmpty else { close(id); return }
            item.remaining -= UInt64(bytes.count)
            item.connection.send(content: bytes, completion: .contentProcessed { [weak self] error in
                if error != nil { self?.close(id) } else { self?.sendChunk(id) }
            })
        } catch { close(id) }
    }
    static func wifiAddress() -> String? {
        var interfaces: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&interfaces) == 0 else { return nil }
        defer { freeifaddrs(interfaces) }
        var pointer = interfaces
        while let entry = pointer {
            defer { pointer = entry.pointee.ifa_next }
            guard let address = entry.pointee.ifa_addr, address.pointee.sa_family == UInt8(AF_INET),
                  String(cString: entry.pointee.ifa_name) == "en0" else { continue }
            var buffer = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            if getnameinfo(address, socklen_t(address.pointee.sa_len), &buffer, socklen_t(buffer.count), nil, 0, NI_NUMERICHOST) == 0 {
                let value = String(cString: buffer)
                if LANAddress.isPrivate(value) { return value }
            }
        }
        return nil
    }
}
