// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// More of macOS's own abilities for Keeper's tools:
//   speech.transcribe  on-device speech recognition of a sound or video file, with times
//   ddc.get / ddc.set  brightness, contrast and volume of external displays (DDC/CI over
//                      IOAVService on Apple silicon)
//   translate          on-device translation (macOS 26 and later)
// Each answers with a clear error when this Mac cannot do it, and Keeper uses its own way.

import Foundation
import Speech
import IOKit
#if canImport(Translation)
import Translation
#endif

private func fail(_ code: Int, _ message: String) -> NSError {
    NSError(domain: "keeper", code: code, userInfo: [NSLocalizedDescriptionKey: message])
}

// MARK: - speech

/// Words grouped into phrases at pauses longer than 0.6 s (or every 12 seconds), with times.
func speechTranscribe(path: String, language: String?) async throws -> [[String: Any]] {
    let status: SFSpeechRecognizerAuthorizationStatus = await withCheckedContinuation { c in
        SFSpeechRecognizer.requestAuthorization { c.resume(returning: $0) }
    }
    guard status == .authorized else {
        throw fail(20, "Speech recognition is turned off for Keeper (System Settings → Privacy & Security → Speech Recognition)")
    }
    let locale = (language == nil || language == "auto" || language == "") ? Locale.current : Locale(identifier: language!)
    guard let recognizer = SFSpeechRecognizer(locale: locale), recognizer.isAvailable else {
        throw fail(21, "macOS cannot recognize speech in this language on this Mac")
    }
    let request = SFSpeechURLRecognitionRequest(url: URL(fileURLWithPath: path))
    request.shouldReportPartialResults = false
    request.addsPunctuation = true
    if recognizer.supportsOnDeviceRecognition { request.requiresOnDeviceRecognition = true }
    final class Once: @unchecked Sendable { var done = false }
    let once = Once()
    let result: SFSpeechRecognitionResult = try await withCheckedThrowingContinuation { c in
        _ = recognizer.recognitionTask(with: request) { r, e in
            if once.done { return }
            if let e = e { once.done = true; c.resume(throwing: e); return }
            if let r = r, r.isFinal { once.done = true; c.resume(returning: r) }
        }
    }
    var out: [[String: Any]] = []
    var words: [String] = []
    var start = 0.0
    var end = 0.0
    for seg in result.bestTranscription.segments {
        let gap = seg.timestamp - end
        if !words.isEmpty && (gap > 0.6 || seg.timestamp - start > 12) {
            out.append(["start": start, "end": end, "text": words.joined(separator: " ")])
            words = []
        }
        if words.isEmpty { start = seg.timestamp }
        words.append(seg.substring)
        end = seg.timestamp + seg.duration
    }
    if !words.isEmpty { out.append(["start": start, "end": end, "text": words.joined(separator: " ")]) }
    return out
}

// MARK: - external displays (DDC/CI)

private typealias AVCreate = @convention(c) (CFAllocator?, io_service_t) -> Unmanaged<CFTypeRef>?
private typealias AVWrite = @convention(c) (CFTypeRef, UInt32, UInt32, UnsafeMutableRawPointer, UInt32) -> IOReturn
private typealias AVRead = @convention(c) (CFTypeRef, UInt32, UInt32, UnsafeMutableRawPointer, UInt32) -> IOReturn

private struct AV {
    let create: AVCreate
    let write: AVWrite
    let read: AVRead
}

private func avFunctions() -> AV? {
    guard let h = dlopen("/System/Library/Frameworks/IOKit.framework/IOKit", RTLD_NOW),
          let c = dlsym(h, "IOAVServiceCreateWithService"),
          let w = dlsym(h, "IOAVServiceWriteI2C"),
          let r = dlsym(h, "IOAVServiceReadI2C") else { return nil }
    return AV(create: unsafeBitCast(c, to: AVCreate.self), write: unsafeBitCast(w, to: AVWrite.self), read: unsafeBitCast(r, to: AVRead.self))
}

/// The AV services of external displays, in the order macOS lists them.
private func externalDisplays(_ av: AV) -> [CFTypeRef] {
    var iter: io_iterator_t = 0
    guard IOServiceGetMatchingServices(kIOMainPortDefault, IOServiceMatching("DCPAVServiceProxy"), &iter) == KERN_SUCCESS else { return [] }
    defer { IOObjectRelease(iter) }
    var out: [CFTypeRef] = []
    while case let service = IOIteratorNext(iter), service != 0 {
        defer { IOObjectRelease(service) }
        let location = IORegistryEntryCreateCFProperty(service, "Location" as CFString, kCFAllocatorDefault, 0)?.takeRetainedValue() as? String
        guard location == "External", let ref = av.create(kCFAllocatorDefault, service)?.takeRetainedValue() else { continue }
        out.append(ref)
    }
    return out
}

private let ddcCodes: [String: UInt8] = ["brightness": 0x10, "contrast": 0x12, "volume": 0x62, "mute": 0x8D, "input": 0x60]

private func ddcTarget(_ p: [String: Any]) throws -> (AV, CFTypeRef, UInt8) {
    guard let av = avFunctions() else { throw fail(30, "This Mac cannot talk to displays over DDC (Apple silicon only)") }
    let displays = externalDisplays(av)
    let index = (p["display"] as? Int) ?? 0
    guard index >= 0, index < displays.count else { throw fail(31, "No external display that accepts DDC was found") }
    guard let code = ddcCodes[(p["control"] as? String) ?? ""] else { throw fail(32, "Unknown display control") }
    return (av, displays[index], code)
}

func ddcSet(_ p: [String: Any]) throws -> [String: Any] {
    let (av, display, code) = try ddcTarget(p)
    let value = max(0, min(65535, (p["value"] as? Int) ?? 0))
    var data: [UInt8] = [0x84, 0x03, code, UInt8(value >> 8), UInt8(value & 0xFF), 0]
    data[5] = 0x6E ^ 0x51 ^ data[0] ^ data[1] ^ data[2] ^ data[3] ^ data[4]
    var ok = false
    for _ in 0..<2 {
        usleep(10_000)
        if data.withUnsafeMutableBytes({ av.write(display, 0x37, 0x51, $0.baseAddress!, 6) }) == KERN_SUCCESS { ok = true }
    }
    if !ok { throw fail(33, "The display did not accept the change") }
    return ["ok": true]
}

func ddcGet(_ p: [String: Any]) throws -> [String: Any] {
    let (av, display, code) = try ddcTarget(p)
    var ask: [UInt8] = [0x82, 0x01, code, 0]
    ask[3] = 0x6E ^ 0x51 ^ ask[0] ^ ask[1] ^ ask[2]
    var reply = [UInt8](repeating: 0, count: 12)
    for _ in 0..<3 {
        usleep(10_000)
        guard ask.withUnsafeMutableBytes({ av.write(display, 0x37, 0x51, $0.baseAddress!, 4) }) == KERN_SUCCESS else { continue }
        usleep(50_000)
        if reply.withUnsafeMutableBytes({ av.read(display, 0x37, 0x51, $0.baseAddress!, 12) }) == KERN_SUCCESS, reply[2] == 0x02 || reply[3] == 0x02 { break }
    }
    let max = Int(reply[6]) << 8 | Int(reply[7])
    let current = Int(reply[8]) << 8 | Int(reply[9])
    if max == 0 { throw fail(34, "The display did not answer") }
    return ["value": current, "max": max]
}

func ddcList() -> [String: Any] {
    guard let av = avFunctions() else { return ["displays": 0] }
    return ["displays": externalDisplays(av).count]
}

// MARK: - translation

func translateTexts(_ p: [String: Any]) async throws -> [String: Any] {
    #if canImport(Translation) && compiler(>=6.2)
    if #available(macOS 26.0, *) {
        let texts = p["texts"] as? [String] ?? []
        guard let to = p["to"] as? String else { throw fail(40, "No target language") }
        let from = (p["from"] as? String).flatMap { $0 == "auto" || $0.isEmpty ? nil : Locale.Language(identifier: $0) }
        guard let source = from ?? dominantLanguage(texts.joined(separator: "\n")).map({ Locale.Language(identifier: $0) }) else {
            throw fail(41, "Could not tell which language the text is in")
        }
        let session = TranslationSession(installedSource: source, target: Locale.Language(identifier: to))
        var out: [String] = []
        for t in texts {
            if t.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { out.append(t); continue }
            out.append(try await session.translate(t).targetText)
        }
        return ["texts": out]
    }
    #endif
    throw fail(42, "On-device translation needs macOS 26 or later")
}
