import Foundation
import CoreFoundation

struct AppFailure: LocalizedError {
    let message: String
    var errorDescription: String? { message }
    init(_ message: String) { self.message = message }
}

struct SubtitleCue: Equatable {
    let start: Double
    let end: Double
    let text: String
}

enum SubtitleParser {
    static func decode(_ data: Data) throws -> String {
        let korean = String.Encoding(rawValue: CFStringConvertEncodingToNSStringEncoding(CFStringEncoding(CFStringEncodings.EUC_KR.rawValue)))
        let prefix = Array(data.prefix(2))
        if prefix == [0xff, 0xfe] || prefix == [0xfe, 0xff] {
            if let value = String(data: data, encoding: .utf16) { return value }
        }
        if let value = String(data: data, encoding: .utf8) { return value }
        if let value = String(data: data, encoding: korean) { return value }
        throw AppFailure("자막 인코딩을 읽을 수 없습니다. UTF-8 SRT 또는 VTT로 저장해 주세요.")
    }
    static func timestamp(_ text: String) -> Double? {
        let parts = text.replacingOccurrences(of: ",", with: ".").split(separator: ":")
        guard parts.count == 2 || parts.count == 3 else { return nil }
        let values = parts.compactMap { Double($0) }
        guard values.count == parts.count, values.allSatisfy({ $0.isFinite && $0 >= 0 }),
              values.last! < 60, values[values.count - 2] < 60 else { return nil }
        let seconds = values.count == 3 ? values[0] * 3600 + values[1] * 60 + values[2] : values[0] * 60 + values[1]
        return seconds.isFinite && seconds <= 604800 ? seconds : nil
    }
    static func parse(_ text: String) -> [SubtitleCue] {
        let normalized = text.replacingOccurrences(of: "\u{feff}", with: "")
            .replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
        let lines = normalized.components(separatedBy: "\n")
        var result: [SubtitleCue] = [], index = 0
        while index < lines.count {
            let timing = lines[index].components(separatedBy: "-->")
            guard timing.count == 2,
                  let start = timestamp(timing[0].trimmingCharacters(in: .whitespaces)),
                  let endText = timing[1].split(whereSeparator: { $0.isWhitespace }).first,
                  let end = timestamp(String(endText)), end > start else { index += 1; continue }
            index += 1
            var words: [String] = []
            while index < lines.count, !lines[index].trimmingCharacters(in: .whitespaces).isEmpty {
                words.append(lines[index]); index += 1
            }
            let body = words.joined(separator: "\n")
                .replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression)
                .replacingOccurrences(of: "&amp;", with: "&").replacingOccurrences(of: "&lt;", with: "<")
                .replacingOccurrences(of: "&gt;", with: ">").replacingOccurrences(of: "&nbsp;", with: " ")
            if !body.isEmpty { result.append(SubtitleCue(start: start, end: end, text: body)) }
        }
        return result.sorted { $0.start < $1.start }
    }
    static func visible(_ cues: [SubtitleCue], at time: Double) -> String {
        cues.filter { $0.start <= time && time < $0.end }.map(\.text).joined(separator: "\n")
    }
    static func vtt(_ cues: [SubtitleCue]) -> String {
        func stamp(_ value: Double) -> String {
            let bounded = value.isFinite ? min(max(0, value), 604800) : 0
            let ms = Int((bounded * 1000).rounded())
            return String(format: "%02d:%02d:%02d.%03d", ms / 3600000, ms / 60000 % 60, ms / 1000 % 60, ms % 1000)
        }
        func escape(_ text: String) -> String {
            text.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;").replacingOccurrences(of: ">", with: "&gt;")
        }
        return "WEBVTT\n\n" + cues.enumerated().map { index, cue in
            "\(index + 1)\n\(stamp(cue.start)) --> \(stamp(cue.end))\n\(escape(cue.text))\n"
        }.joined(separator: "\n")
    }
}

struct ByteRange: Equatable {
    let start: UInt64
    let end: UInt64
    var length: UInt64 { end - start + 1 }
    static func parse(_ header: String?, size: UInt64) throws -> ByteRange {
        guard size > 0 else { throw AppFailure("Empty file") }
        guard let header else { return ByteRange(start: 0, end: size - 1) }
        guard header.hasPrefix("bytes="), !header.contains(",") else { throw AppFailure("Invalid range") }
        let pair = header.dropFirst(6).split(separator: "-", omittingEmptySubsequences: false)
        guard pair.count == 2, pair.allSatisfy({ $0.utf8.allSatisfy({ (48...57).contains($0) }) }) else { throw AppFailure("Invalid range") }
        if pair[0].isEmpty {
            guard let suffix = UInt64(pair[1]), suffix > 0 else { throw AppFailure("Invalid suffix") }
            return ByteRange(start: size - min(size, suffix), end: size - 1)
        }
        guard let start = UInt64(pair[0]), start < size else { throw AppFailure("Invalid start") }
        let end: UInt64
        if pair[1].isEmpty { end = size - 1 }
        else {
            guard let requested = UInt64(pair[1]), requested >= start else { throw AppFailure("Invalid end") }
            end = min(requested, size - 1)
        }
        return ByteRange(start: start, end: end)
    }
}

enum LANAddress {
    static func isPrivate(_ ip: String) -> Bool {
        let p = ip.split(separator: ".", omittingEmptySubsequences: false)
        guard p.count == 4, p.allSatisfy({ !$0.isEmpty && $0.allSatisfy(\.isNumber) && ($0.count == 1 || !$0.hasPrefix("0")) }),
              let a = UInt8(p[0]), let b = UInt8(p[1]), UInt8(p[2]) != nil, UInt8(p[3]) != nil else { return false }
        return a == 10 || (a == 172 && (16...31).contains(b)) || (a == 192 && b == 168)
    }
    static func baseURL(_ input: String) throws -> URL {
        let value = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let c = URLComponents(string: value.contains("://") ? value : "http://" + value),
              c.scheme == "http", c.user == nil, c.password == nil, c.query == nil, c.fragment == nil,
              c.path.isEmpty || c.path == "/", let host = c.host, isPrivate(host),
              let port = c.port, (1...65535).contains(port),
              let url = URL(string: "http://\(host):\(port)") else {
            throw AppFailure("컴퓨터에 표시된 Wi-Fi 주소와 포트를 입력하세요. 예: 192.168.1.5:54321")
        }
        return url
    }
}

func clockText(_ seconds: Double) -> String {
    guard seconds.isFinite && seconds >= 0 && seconds < Double(Int.max) else { return "0:00" }
    let value = Int(seconds)
    return value >= 3600 ? String(format: "%d:%02d:%02d", value / 3600, value / 60 % 60, value % 60) : String(format: "%d:%02d", value / 60, value % 60)
}
