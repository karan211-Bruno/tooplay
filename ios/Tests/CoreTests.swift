import Foundation

@main struct CoreTests {
    static var count = 0
    static let networkSession: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil
        configuration.timeoutIntervalForRequest = 8
        return URLSession(configuration: configuration)
    }()
    static func check(_ condition: Bool, _ name: String) {
        guard condition else { fatalError("FAIL: \(name)") }
        count += 1; print("PASS: \(name)")
    }
    static func rejects(_ body: () throws -> Void) -> Bool { do { try body(); return false } catch { return true } }
    @MainActor static func waitUntil(_ predicate: () async throws -> Bool) async throws -> Bool {
        let deadline = Date().addingTimeInterval(4)
        while Date() < deadline {
            if try await predicate() { return true }
            try await Task.sleep(nanoseconds: 25_000_000)
        }
        return false
    }
    static func control(_ action: String, state: [String: Any]? = nil) async throws -> [String: Any] {
        let url = URL(string: ProcessInfo.processInfo.environment["TOOPLAY_TEST_CONTROL"]!)!
        var request = URLRequest(url: url); request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var body: [String: Any] = ["action": action]
        if let state { body["state"] = state }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await networkSession.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw AppFailure("Test control failed") }
        return try JSONSerialization.jsonObject(with: data) as! [String: Any]
    }
    @MainActor static func main() async throws {
        let srt = "\u{feff}1\r\n00:01:02,250 --> 00:01:04,500\r\n<b>첫 번째 줄</b>\r\n둘째 줄\r\n\r\n2\r\n00:01:04,000 --> 00:01:05,000\r\n次の字幕 &amp; more\r\n"
        let cues = SubtitleParser.parse(srt)
        check(cues.count == 2, "SRT BOM, CRLF and multiline")
        check(cues[0] == SubtitleCue(start: 62.25, end: 64.5, text: "첫 번째 줄\n둘째 줄"), "SRT precise timing and Korean")
        check(SubtitleParser.visible(cues, at: 64.25).contains("次の字幕 & more"), "overlapping cues")
        check(SubtitleParser.visible(cues, at: 65).isEmpty, "end time exclusive")
        check(SubtitleParser.parse(SubtitleParser.vtt(cues)) == cues, "SRT-to-VTT round trip")
        check(SubtitleParser.parse("WEBVTT\n\n00:10.001 --> 00:12.123 align:start\n日本語\n").first?.start == 10.001, "VTT short timestamps and cue settings")
        check(SubtitleParser.parse("1\n00:00:05,000 --> 00:00:01,000\nbad\n").isEmpty, "reject reversed cue")
        check(SubtitleParser.timestamp("NaN:00") == nil, "reject invalid cue time")
        check(SubtitleParser.timestamp("100000000000000000:00:00") == nil, "reject integer-overflow subtitle time")
        check(try SubtitleParser.decode(Data("한국어".utf8)) == "한국어", "UTF-8 decoding")
        check(try SubtitleParser.decode(Data([0xc7, 0xd1, 0xb1, 0xdb])) == "한글", "EUC-KR decoding without UTF-16 confusion")
        let utf16 = "日本語字幕".data(using: .utf16)!
        check(try SubtitleParser.decode(utf16) == "日本語字幕", "UTF-16 decoding")
        check(try ByteRange.parse(nil, size: 100) == ByteRange(start: 0, end: 99), "full media request")
        check(try ByteRange.parse("bytes=10-19", size: 100).length == 10, "bounded HTTP range")
        check(try ByteRange.parse("bytes=90-", size: 100) == ByteRange(start: 90, end: 99), "open-ended range")
        check(try ByteRange.parse("bytes=-12", size: 100) == ByteRange(start: 88, end: 99), "suffix range")
        check(try ByteRange.parse("bytes=95-9999999999", size: 100).end == 99, "clip range end")
        for value in ["bytes=100-", "bytes=90-10", "bytes=-0", "bytes=1-2,3-4", "items=0-1", "bytes=184467440737095516160-", "bytes=-", "bytes=+1-2", "bytes=1- 2"] {
            check(rejects { _ = try ByteRange.parse(value, size: 100) }, "reject malformed range \(value)")
        }
        check(rejects { _ = try ByteRange.parse(nil, size: 0) }, "reject empty media")
        for value in ["192.168.1.5:51234", "http://10.0.0.2:80", "http://172.16.0.1:1/"] {
            check(!rejects { _ = try LANAddress.baseURL(value) }, "accept explicit LAN endpoint \(value)")
        }
        for value in ["https://192.168.1.1:80", "http://8.8.8.8:80", "localhost:80", "127.0.0.1:80", "192.168.1.1", "http://evil.example:80", "http://user:pass@192.168.1.1:80", "192.168.1.1:80/x", "192.168.1.1:80?x=1", "192.168.1.1:80#x", "192.168.1.1:0", "172.32.0.1:80", "192.168.001.1:80"] {
            check(rejects { _ = try LANAddress.baseURL(value) }, "reject unsafe endpoint \(value)")
        }
        check(clockText(3661) == "1:01:01", "hour formatting")
        check(clockText(.infinity) == "0:00", "non-finite formatting")
        let data = Data("""
        {"protocolVersion":1,"title":"Movie","hasMedia":true,"playing":false,"currentTime":61.5,"duration":600,"volume":0.7,"casting":true,"castDevice":{"id":"tv-1","name":"거실"},"subtitles":[{"id":"ko","name":"한국어"}],"selectedSubtitleId":"ko","devices":[{"id":"tv-1","name":"거실"}],"preparing":false,"lastError":null}
        """.utf8)
        let state = try JSONDecoder().decode(RemoteState.self, from: data)
        check(state.castDevice?.name == "거실" && state.devices.count == 1, "desktop protocol device object")
        check(state.currentTime == 61.5 && state.subtitles.first?.id == "ko", "desktop protocol position and subtitles")
        if let address = ProcessInfo.processInfo.environment["TOOPLAY_TEST_ADDRESS"],
           let code = ProcessInfo.processInfo.environment["TOOPLAY_TEST_CODE"] {
            let client = RemoteClient(); client.address = address; client.code = code
            await client.pair()
            check(client.connected && client.healthy, "live remote pairing and authenticated state")
            await client.command("pause")
            check(client.error == nil, "live remote command")
            client.disconnect()
            check(!client.connected, "live remote disconnect")
            if ProcessInfo.processInfo.environment["TOOPLAY_TEST_CONTROL"] != nil {
                check(try await waitUntil { try await control("status")["tokens"] as? Int == 0 }, "disconnect revokes server token")
                client.code = try await control("renew")["code"] as! String
                await client.pair()
                check(client.connected && client.healthy, "pair again after disconnect")
                _ = try await control("expire")
                await client.command("pause")
                check(!client.connected && !client.busy && client.state == nil && client.error != nil, "command401 restores pairing screen and clears stale controls")

                client.code = try await control("renew")["code"] as! String
                await client.pair(); client.setVisible(true)
                _ = try await control("state", state: ["currentTime": 77.0])
                check(try await waitUntil { client.state?.currentTime == 77 }, "visible remote polls updated state")
                _ = try await control("expire")
                check(try await waitUntil { !client.connected }, "poll401 ends expired session")
                check(!client.healthy && client.state == nil && client.error != nil, "poll expiry removes stale state")

                client.code = try await control("renew")["code"] as! String
                await client.pair()
                _ = try await control("state", state: ["currentTime": 88.0])
                check(try await waitUntil { client.state?.currentTime == 88 }, "polling restarts after token expiry and re-pairing")
                client.setVisible(false)

                _ = try await control("holdCommand")
                let oldCommand = Task { await client.command("pause") }
                check(try await waitUntil { try await control("status")["heldCommand"] as? Bool == true }, "old command held in flight")
                client.disconnect()
                client.code = try await control("renew")["code"] as! String
                await client.pair()
                _ = try await control("releaseCommand"); await oldCommand.value
                check(client.connected && client.healthy && !client.busy && client.error == nil, "late command401 cannot disconnect new session")

                client.disconnect()
                client.code = try await control("renew")["code"] as! String
                _ = try await control("holdPair")
                let oldPair = Task { await client.pair() }
                check(try await waitUntil { try await control("status")["heldPair"] as? Bool == true }, "old pairing held in flight")
                client.disconnect()
                client.code = try await control("renew")["code"] as! String
                await client.pair()
                _ = try await control("releasePair"); await oldPair.value
                check(client.connected && client.healthy && !client.busy && client.error == nil, "late pairing error cannot overwrite new session")
                client.disconnect()
                check(try await waitUntil { try await control("status")["tokens"] as? Int == 0 }, "all reused client sessions revoked")
            } else { try await Task.sleep(nanoseconds: 300_000_000) }
        }
        if ProcessInfo.processInfo.environment["TOOPLAY_HTTP_TEST"] == "1" {
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            defer { try? FileManager.default.removeItem(at: directory) }
            let payload = Data((0..<262144).map { UInt8($0 % 251) })
            let file = directory.appendingPathComponent("movie.mp4")
            try payload.write(to: file)
            let server = LocalMediaServer()
            async let firstStart = server.start()
            async let duplicateStart = server.start()
            let (firstBase, duplicateBase) = try await (firstStart, duplicateStart)
            check(firstBase == duplicateBase, "concurrent HTTP server starts share one listener")
            defer { server.stop() }
            let url = try await server.register(file, named: "movie.mp4", mime: "video/mp4")
            var request = URLRequest(url: url)
            request.setValue("bytes=65530-65550", forHTTPHeaderField: "Range")
            let (body, response) = try await networkSession.data(for: request)
            check((response as? HTTPURLResponse)?.statusCode == 206 && body == payload[65530...65550], "live HTTP range byte accuracy")
            var head = URLRequest(url: url); head.httpMethod = "HEAD"
            let (headData, headResponse) = try await networkSession.data(for: head)
            check(headData.isEmpty && (headResponse as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Length") == "262144", "live HTTP HEAD without body")
            let missing = url.deletingLastPathComponent().appendingPathComponent("unregistered.mp4")
            let (_, missingResponse) = try await networkSession.data(from: missing)
            check((missingResponse as? HTTPURLResponse)?.statusCode == 404, "live HTTP unregistered files denied")
            request.setValue("bytes=999999-", forHTTPHeaderField: "Range")
            let (_, rangeResponse) = try await networkSession.data(for: request)
            check((rangeResponse as? HTTPURLResponse)?.statusCode == 416, "live HTTP invalid range")
            let (fullData, fullResponse) = try await networkSession.data(from: url)
            check((fullResponse as? HTTPURLResponse)?.statusCode == 200 && fullData == payload, "live HTTP full stream chunks")
            server.stop()
            do { _ = try await server.register(file, named: "after-stop.mp4", mime: "video/mp4"); check(false, "stopped server rejects registration") }
            catch { check(true, "stopped server rejects registration") }
            _ = try await server.start()
            let restartedURL = try await server.register(file, named: "movie.mp4", mime: "video/mp4")
            check(restartedURL.path != url.path, "HTTP restart rotates capability token")
            let (restartedData, restartedResponse) = try await networkSession.data(from: restartedURL)
            check((restartedResponse as? HTTPURLResponse)?.statusCode == 200 && restartedData == payload, "HTTP server restarts with a working file stream")
            var obsolete = URLComponents(url: restartedURL, resolvingAgainstBaseURL: false)!
            obsolete.path = url.path
            let (_, obsoleteResponse) = try await networkSession.data(from: obsolete.url!)
            check((obsoleteResponse as? HTTPURLResponse)?.statusCode == 404, "old capability path cannot read restarted server")

            weak var releasedServer: LocalMediaServer?
            do {
                let temporaryServer = LocalMediaServer(); releasedServer = temporaryServer
                _ = try await temporaryServer.start(); temporaryServer.stop()
            }
            check(try await waitUntil { releasedServer == nil }, "stopped HTTP server is released without listener retain cycle")

            let cancelledServer = LocalMediaServer()
            var startSettled = false
            let pendingStart = Task {
                _ = try? await cancelledServer.start(); startSettled = true
            }
            await Task.yield(); cancelledServer.stop()
            check(try await waitUntil { startSettled }, "start racing with stop always settles")
            pendingStart.cancel(); cancelledServer.stop()
        }
        print("\(count) checks passed")
    }
}
