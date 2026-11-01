// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// keeper-helper: one JSON message per line on stdin and stdout.
//
//   host → helper   {"id": 1, "method": "hello"}
//   helper → host   {"id": 1, "result": {...}}  |  {"id": 1, "error": "..."}
//                   {"id": 1, "delta": "text"}   (streamed model output)
//                   {"id": 1, "tool": {"call": "c1", "name": "search_files", "arguments": {...}}}
//   host → helper   {"id": 1, "method": "toolResult", "params": {"call": "c1", "result": ...}}
//
// Methods: hello, chat, ocr, language, spotlight.index, spotlight.remove,
// spotlight.removeAll, cancel, and for remote control of this Mac:
// input.status, input.request, input.move, input.button, input.wheel,
// input.key, input.text. Permissions.swift adds permissions.status and
// permissions.request (the Permissions screen). Extras.swift adds speech.transcribe, ddc.list,
// ddc.get, ddc.set and translate; Calendar.swift the calendar.* methods; Front.swift
// front.watch, front.now, place.measure and apps.running.

import Foundation
import Vision
import CoreSpotlight
import NaturalLanguage
import ImageIO
import UniformTypeIdentifiers
import CoreGraphics
import ApplicationServices
import EventKit
#if canImport(FoundationModels)
import FoundationModels
#endif

// MARK: - output

final class Wire: @unchecked Sendable {
    static let shared = Wire()
    private let lock = NSLock()

    func send(_ obj: [String: Any]) {
        guard JSONSerialization.isValidJSONObject(obj),
              let data = try? JSONSerialization.data(withJSONObject: obj, options: []) else { return }
        lock.lock()
        defer { lock.unlock() }
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data([0x0A]))
    }

    func result(_ id: Int, _ value: Any) { send(["id": id, "result": value]) }
    func error(_ id: Int, _ message: String) { send(["id": id, "error": message]) }
    func delta(_ id: Int, _ text: String) { send(["id": id, "delta": text]) }
}

// MARK: - waiting for tool results and cancellations

actor Bridge {
    static let shared = Bridge()
    private var waiting: [String: CheckedContinuation<JSONBox, Never>] = [:]
    private var tasks: [Int: Task<Void, Never>] = [:]
    private var seq = 0

    func nextCall() -> String {
        seq += 1
        return "c\(seq)"
    }

    func wait(_ call: String) async -> JSONBox {
        await withCheckedContinuation { (c: CheckedContinuation<JSONBox, Never>) in
            waiting[call] = c
        }
    }

    func answer(_ call: String, _ value: JSONBox) {
        waiting.removeValue(forKey: call)?.resume(returning: value)
    }

    func track(_ id: Int, _ task: Task<Void, Never>) { tasks[id] = task }
    func done(_ id: Int) { tasks.removeValue(forKey: id) }
    func cancel(_ id: Int) { tasks.removeValue(forKey: id)?.cancel() }
}

/// Wraps a non-Sendable JSON value so it can cross into tasks.
struct JSONBox: @unchecked Sendable {
    let value: Any
}

// MARK: - hello

func macVersion() -> Int { ProcessInfo.processInfo.operatingSystemVersion.majorVersion }

func isArm() -> Bool {
    #if arch(arm64)
    return true
    #else
    return false
    #endif
}

func appleModelState() -> String {
    #if canImport(FoundationModels)
    if #available(macOS 26.0, *) {
        switch SystemLanguageModel.default.availability {
        case .available:
            return "available"
        case .unavailable(let reason):
            switch reason {
            case .deviceNotEligible: return "deviceNotEligible"
            case .appleIntelligenceNotEnabled: return "appleIntelligenceNotEnabled"
            case .modelNotReady: return "modelNotReady"
            @unknown default: return "unsupported"
            }
        }
    }
    #endif
    return "unsupported"
}

func hello() -> [String: Any] {
    [
        "version": "1",
        "macos": macVersion(),
        "arm": isArm(),
        "appleModel": appleModelState(),
        "ocr": true,
        "spotlight": CSSearchableIndex.isIndexingAvailable(),
    ]
}

// MARK: - text recognition (Live Text)

func recognizeText(path: String, languages: [String]) throws -> [String: Any] {
    let url = URL(fileURLWithPath: path)
    guard let src = CGImageSourceCreateWithURL(url as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(src, 0, nil) else {
        throw NSError(domain: "keeper", code: 1, userInfo: [NSLocalizedDescriptionKey: "Could not read the image"])
    }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    if !languages.isEmpty {
        request.recognitionLanguages = languages
    } else {
        request.automaticallyDetectsLanguage = true
    }
    let handler = VNImageRequestHandler(cgImage: image, options: [:])
    try handler.perform([request])
    let observations = request.results ?? []
    let lines = observations.compactMap { $0.topCandidates(1).first?.string }
    return ["text": lines.joined(separator: "\n"), "lines": lines.count]
}

// MARK: - language

func dominantLanguage(_ text: String) -> String? {
    NLLanguageRecognizer.dominantLanguage(for: text)?.rawValue
}

// MARK: - Spotlight

func spotlightIndex(_ items: [[String: Any]]) async throws -> Int {
    var out: [CSSearchableItem] = []
    for item in items {
        guard let id = item["id"] as? String, let path = item["path"] as? String else { continue }
        let url = URL(fileURLWithPath: path)
        let type = UTType(filenameExtension: url.pathExtension) ?? .item
        let attrs = CSSearchableItemAttributeSet(contentType: type)
        attrs.title = item["title"] as? String ?? url.lastPathComponent
        attrs.displayName = attrs.title
        attrs.contentDescription = item["description"] as? String
        attrs.keywords = item["keywords"] as? [String]
        attrs.contentURL = url
        if let ms = item["mtime"] as? Double {
            attrs.contentModificationDate = Date(timeIntervalSince1970: ms / 1000)
        }
        let s = CSSearchableItem(uniqueIdentifier: id, domainIdentifier: "files", attributeSet: attrs)
        s.expirationDate = Date.distantFuture
        out.append(s)
    }
    if out.isEmpty { return 0 }
    try await CSSearchableIndex.default().indexSearchableItems(out)
    return out.count
}

func spotlightRemove(_ ids: [String]) async throws {
    if ids.isEmpty { return }
    try await CSSearchableIndex.default().deleteSearchableItems(withIdentifiers: ids)
}

func spotlightRemoveAll() async throws {
    try await CSSearchableIndex.default().deleteSearchableItems(withDomainIdentifiers: ["files"])
}

// MARK: - the on-device model

func toText(_ value: Any) -> String {
    if let s = value as? String { return s }
    if JSONSerialization.isValidJSONObject(value),
       let d = try? JSONSerialization.data(withJSONObject: value, options: []),
       let s = String(data: d, encoding: .utf8) {
        return s
    }
    return String(describing: value)
}

#if canImport(FoundationModels)
@available(macOS 26.0, *)
struct KeeperTool: Tool {
    typealias Arguments = GeneratedContent
    typealias Output = String

    let name: String
    let description: String
    let parameters: GenerationSchema
    let requestId: Int

    func call(arguments: GeneratedContent) async throws -> String {
        let call = await Bridge.shared.nextCall()
        let argsData = arguments.jsonString.data(using: .utf8) ?? Data("{}".utf8)
        let args = (try? JSONSerialization.jsonObject(with: argsData, options: [])) ?? [String: Any]()
        Wire.shared.send(["id": requestId, "tool": ["call": call, "name": name, "arguments": args]])
        let result = await Bridge.shared.wait(call)
        return toText(result.value)
    }
}

/// Keeper describes tool inputs with a small JSON schema (object of string,
/// number, integer, boolean and string-array properties); this turns it into
/// a schema the on-device model can fill in.
@available(macOS 26.0, *)
func makeSchema(name: String, json: [String: Any]) throws -> GenerationSchema {
    let props = json["properties"] as? [String: Any] ?? [:]
    let required = Set(json["required"] as? [String] ?? [])
    var properties: [DynamicGenerationSchema.Property] = []
    for (key, raw) in props.sorted(by: { $0.key < $1.key }) {
        let p = raw as? [String: Any] ?? [:]
        let desc = p["description"] as? String
        let schema: DynamicGenerationSchema
        switch p["type"] as? String ?? "string" {
        case "integer": schema = DynamicGenerationSchema(type: Int.self)
        case "number": schema = DynamicGenerationSchema(type: Double.self)
        case "boolean": schema = DynamicGenerationSchema(type: Bool.self)
        case "array": schema = DynamicGenerationSchema(arrayOf: DynamicGenerationSchema(type: String.self))
        default:
            if let options = p["enum"] as? [String], !options.isEmpty {
                schema = DynamicGenerationSchema(name: "\(name)_\(key)", anyOf: options)
            } else {
                schema = DynamicGenerationSchema(type: String.self)
            }
        }
        properties.append(DynamicGenerationSchema.Property(name: key, description: desc, schema: schema, isOptional: !required.contains(key)))
    }
    let root = DynamicGenerationSchema(name: name, description: json["description"] as? String, properties: properties)
    return try GenerationSchema(root: root, dependencies: [])
}

@available(macOS 26.0, *)
func chat(id: Int, params: [String: Any]) async throws -> [String: Any] {
    let model = SystemLanguageModel.default
    guard case .available = model.availability else {
        throw NSError(domain: "keeper", code: 2, userInfo: [NSLocalizedDescriptionKey: "Apple Intelligence is not available: \(appleModelState())"])
    }
    let messages = params["messages"] as? [[String: Any]] ?? []
    guard let last = messages.last, (last["role"] as? String) == "user", let prompt = last["content"] as? String else {
        throw NSError(domain: "keeper", code: 3, userInfo: [NSLocalizedDescriptionKey: "The last message must be from the user"])
    }
    // Earlier turns go into the instructions; the session itself starts fresh each time.
    var instructions = params["system"] as? String ?? "You are Keeper's assistant. Answer briefly and cite file paths you used."
    let history = messages.dropLast().compactMap { m -> String? in
        guard let role = m["role"] as? String, let content = m["content"] as? String else { return nil }
        return "\(role == "assistant" ? "Assistant" : "User"): \(content)"
    }
    if !history.isEmpty {
        instructions += "\n\nConversation so far:\n" + history.joined(separator: "\n")
    }
    var tools: [any Tool] = []
    for t in params["tools"] as? [[String: Any]] ?? [] {
        guard let name = t["name"] as? String else { continue }
        let schema = try makeSchema(name: name, json: t["parameters"] as? [String: Any] ?? [:])
        tools.append(KeeperTool(name: name, description: t["description"] as? String ?? name, parameters: schema, requestId: id))
    }
    let session = LanguageModelSession(tools: tools, instructions: instructions)
    var options = GenerationOptions()
    if let t = params["temperature"] as? Double { options.temperature = t }
    var sent = ""
    for try await snapshot in session.streamResponse(to: prompt, options: options) {
        try Task.checkCancellation()
        let text = snapshot.content
        if text.hasPrefix(sent) {
            let more = String(text.dropFirst(sent.count))
            if !more.isEmpty { Wire.shared.delta(id, more) }
        } else {
            Wire.shared.delta(id, text)
        }
        sent = text
    }
    return ["text": sent]
}
#endif

// MARK: - remote control (another Keeper device using this Mac's mouse and keyboard)

/// Which mouse buttons are held, so moves become drags. Touched from tasks, so behind a lock.
final class InputState: @unchecked Sendable {
    static let shared = InputState()
    private let lock = NSLock()
    private var held = Set<Int>()
    func set(_ button: Int, _ down: Bool) {
        lock.lock(); defer { lock.unlock() }
        if down { held.insert(button) } else { held.remove(button) }
    }
    func has(_ button: Int) -> Bool {
        lock.lock(); defer { lock.unlock() }
        return held.contains(button)
    }
}

/// Posting events needs Accessibility; seeing the screen needs Screen Recording.
func inputStatus(prompt: Bool) -> [String: Any] {
    let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
    let trusted = AXIsProcessTrustedWithOptions([key: prompt] as CFDictionary)
    var capture = true
    if #available(macOS 10.15, *) {
        capture = CGPreflightScreenCaptureAccess()
        if prompt && !capture { capture = CGRequestScreenCaptureAccess() }
    }
    return ["accessibility": trusted, "screenRecording": capture]
}

func number(_ v: Any?) -> Double {
    if let d = v as? Double { return d }
    if let i = v as? Int { return Double(i) }
    if let n = v as? NSNumber { return n.doubleValue }
    return 0
}

func eventFlags(_ mods: [String]) -> CGEventFlags {
    var f = CGEventFlags()
    for m in mods {
        switch m {
        case "ctrl", "control": f.insert(.maskControl)
        case "alt", "option": f.insert(.maskAlternate)
        case "shift": f.insert(.maskShift)
        case "meta", "cmd", "command": f.insert(.maskCommand)
        default: break
        }
    }
    return f
}

func post(_ e: CGEvent?) throws {
    guard let e = e else { throw NSError(domain: "keeper", code: 7, userInfo: [NSLocalizedDescriptionKey: "Could not make the input event"]) }
    e.post(tap: .cghidEventTap)
}

func inputMove(_ p: [String: Any]) throws {
    let at = CGPoint(x: number(p["x"]), y: number(p["y"]))
    let st = InputState.shared
    let type: CGEventType = st.has(0) ? .leftMouseDragged : st.has(2) ? .rightMouseDragged : st.has(1) ? .otherMouseDragged : .mouseMoved
    let button: CGMouseButton = st.has(2) ? .right : st.has(1) ? .center : .left
    try post(CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: at, mouseButton: button))
}

func inputButton(_ p: [String: Any]) throws {
    let at = CGPoint(x: number(p["x"]), y: number(p["y"]))
    let b = Int(number(p["button"]))
    let down = (p["down"] as? Bool) ?? false
    let type: CGEventType
    let button: CGMouseButton
    switch b {
    case 2: type = down ? .rightMouseDown : .rightMouseUp; button = .right
    case 1: type = down ? .otherMouseDown : .otherMouseUp; button = .center
    default: type = down ? .leftMouseDown : .leftMouseUp; button = .left
    }
    InputState.shared.set(b, down)
    try post(CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: at, mouseButton: button))
}

func inputWheel(_ p: [String: Any]) throws {
    let dy = Int32(max(-20, min(20, number(p["dy"]))))
    let dx = Int32(max(-20, min(20, number(p["dx"]))))
    try post(CGEvent(scrollWheelEvent2Source: nil, units: .line, wheelCount: 2, wheel1: dy, wheel2: dx, wheel3: 0))
}

func inputKey(_ p: [String: Any]) throws {
    let code = CGKeyCode(max(0, min(127, Int(number(p["code"])))))
    let down = (p["down"] as? Bool) ?? false
    guard let e = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: down) else { throw NSError(domain: "keeper", code: 7, userInfo: [NSLocalizedDescriptionKey: "Could not make the key event"]) }
    let mods = p["mods"] as? [String] ?? []
    if !mods.isEmpty { e.flags = eventFlags(mods) }
    e.post(tap: .cghidEventTap)
}

/// Types text as Unicode, a few characters per event (what macOS accepts per event).
func inputText(_ p: [String: Any]) throws {
    let text = String((p["text"] as? String ?? "").prefix(2000))
    let units = Array(text.utf16)
    var i = 0
    while i < units.count {
        let part = Array(units[i..<min(units.count, i + 16)])
        for down in [true, false] {
            guard let e = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: down) else { continue }
            part.withUnsafeBufferPointer { buf in
                e.keyboardSetUnicodeString(stringLength: buf.count, unicodeString: buf.baseAddress)
            }
            e.post(tap: .cghidEventTap)
        }
        i += 16
    }
}

// MARK: - Calendar and Reminders (EventKit), for the Island

let eventStore = EKEventStore()

func ekAccess(_ type: EKEntityType) async throws -> Bool {
    if #available(macOS 14.0, *) {
        return type == .event ? try await eventStore.requestFullAccessToEvents() : try await eventStore.requestFullAccessToReminders()
    }
    return try await withCheckedThrowingContinuation { (c: CheckedContinuation<Bool, Error>) in
        eventStore.requestAccess(to: type) { ok, err in
            if let err = err { c.resume(throwing: err) } else { c.resume(returning: ok) }
        }
    }
}

func ekDenied(_ what: String) -> NSError {
    NSError(domain: "keeper", code: 10, userInfo: [NSLocalizedDescriptionKey: "\(what) access was not allowed (System Settings → Privacy & Security)"])
}

/** Events between two times (ms since 1970) from every calendar on this Mac. */
func ekEvents(_ p: [String: Any]) async throws -> [[String: Any]] {
    guard try await ekAccess(.event) else { throw ekDenied("Calendar") }
    let now = Date().timeIntervalSince1970 * 1000
    let from = Date(timeIntervalSince1970: ((p["from"] as? Double) ?? now) / 1000)
    let to = Date(timeIntervalSince1970: ((p["to"] as? Double) ?? (now + 86_400_000 * 31)) / 1000)
    let pred = eventStore.predicateForEvents(withStart: from, end: to, calendars: nil)
    return eventStore.events(matching: pred).prefix(600).map { e in
        var o: [String: Any] = [
            "id": e.eventIdentifier ?? UUID().uuidString,
            "title": e.title ?? "",
            "start": e.startDate.timeIntervalSince1970 * 1000,
            "end": e.endDate.timeIntervalSince1970 * 1000,
            "allDay": e.isAllDay,
            "calendar": e.calendar?.title ?? "",
        ]
        if let l = e.location { o["location"] = l }
        if let u = e.url?.absoluteString { o["url"] = u }
        if let n = e.notes { o["notes"] = String(n.prefix(2000)) }
        return o
    }
}

/** Open reminders from every list on this Mac. */
func ekReminders() async throws -> [[String: Any]] {
    guard try await ekAccess(.reminder) else { throw ekDenied("Reminders") }
    let pred = eventStore.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: nil)
    return await withCheckedContinuation { (c: CheckedContinuation<[[String: Any]], Never>) in
        eventStore.fetchReminders(matching: pred) { rs in
            let list: [[String: Any]] = (rs ?? []).prefix(300).map { r in
                var o: [String: Any] = ["id": r.calendarItemIdentifier, "title": r.title ?? "", "done": r.isCompleted, "list": r.calendar?.title ?? ""]
                if let dc = r.dueDateComponents, let d = Calendar.current.date(from: dc) { o["due"] = d.timeIntervalSince1970 * 1000 }
                return o
            }
            c.resume(returning: list)
        }
    }
}

func ekSetReminder(_ p: [String: Any]) async throws {
    guard try await ekAccess(.reminder) else { throw ekDenied("Reminders") }
    guard let id = p["id"] as? String, let r = eventStore.calendarItem(withIdentifier: id) as? EKReminder else {
        throw NSError(domain: "keeper", code: 11, userInfo: [NSLocalizedDescriptionKey: "That reminder is gone"])
    }
    r.isCompleted = (p["done"] as? Bool) ?? true
    try eventStore.save(r, commit: true)
}

// MARK: - dispatch

func handle(id: Int, method: String, params: [String: Any]) async {
    do {
        switch method {
        case "hello":
            Wire.shared.result(id, hello())
        case "ocr":
            guard let path = params["path"] as? String else { throw NSError(domain: "keeper", code: 4, userInfo: [NSLocalizedDescriptionKey: "No path"]) }
            Wire.shared.result(id, try recognizeText(path: path, languages: params["languages"] as? [String] ?? []))
        case "language":
            let lang: Any = dominantLanguage(params["text"] as? String ?? "").map { $0 as Any } ?? NSNull()
            Wire.shared.result(id, ["lang": lang])
        case "speech.transcribe":
            guard let path = params["path"] as? String else { throw NSError(domain: "keeper", code: 4, userInfo: [NSLocalizedDescriptionKey: "No path"]) }
            Wire.shared.result(id, ["segments": try await speechTranscribe(path: path, language: params["language"] as? String)])
        case "ddc.list":
            Wire.shared.result(id, ddcList())
        case "ddc.get":
            Wire.shared.result(id, try ddcGet(params))
        case "ddc.set":
            Wire.shared.result(id, try ddcSet(params))
        case let m where m.hasPrefix("stage."): Wire.shared.result(id, try await stageCall(id: id, method: m, params: params))
        case let m where m.hasPrefix("voice."): Wire.shared.result(id, try await voiceCall(id: id, method: m, params: params))
        case "translate":
            Wire.shared.result(id, try await translateTexts(params))
        case "eventkit.events":
            Wire.shared.result(id, try await ekEvents(params))
        case "eventkit.reminders":
            Wire.shared.result(id, try await ekReminders())
        case "eventkit.setReminder":
            try await ekSetReminder(params)
            Wire.shared.result(id, ["ok": true])
        case let m where m.hasPrefix("calendar."): Wire.shared.result(id, try await calendarCall(id: id, method: m, params: params))
        case "spotlight.index":
            let n = try await spotlightIndex(params["items"] as? [[String: Any]] ?? [])
            Wire.shared.result(id, ["count": n])
        case "spotlight.remove":
            try await spotlightRemove(params["ids"] as? [String] ?? [])
            Wire.shared.result(id, ["ok": true])
        case "spotlight.removeAll":
            try await spotlightRemoveAll()
            Wire.shared.result(id, ["ok": true])
        case "permissions.status":
            Wire.shared.result(id, await permissionsStatus())
        case "permissions.request":
            Wire.shared.result(id, try await permissionsRequest(params))
        case "input.status":
            Wire.shared.result(id, inputStatus(prompt: false))
        case "input.request":
            Wire.shared.result(id, inputStatus(prompt: true))
        case "input.move":
            try inputMove(params); Wire.shared.result(id, ["ok": true])
        case "input.button":
            try inputButton(params); Wire.shared.result(id, ["ok": true])
        case "input.wheel":
            try inputWheel(params); Wire.shared.result(id, ["ok": true])
        case "input.key":
            try inputKey(params); Wire.shared.result(id, ["ok": true])
        case "input.text":
            try inputText(params); Wire.shared.result(id, ["ok": true])
        case "notifications.status": Wire.shared.result(id, notificationsStatus())
        case "notifications.watch": try await notificationsWatch(id: id, params: params); Wire.shared.result(id, ["ended": true])
        case "calls.micApps": Wire.shared.result(id, callsMicApps())
        case "calls.muted": Wire.shared.result(id, callsMuted())
        case "calls.mute": Wire.shared.result(id, try callsMute(params))
        case "hud.levels": Wire.shared.result(id, hudLevels())
        case "hud.watch": try await hudWatch(id: id, params: params); Wire.shared.result(id, ["ended": true])
        case "front.watch": try await frontWatch(id: id, params: params); Wire.shared.result(id, ["ended": true])
        case "front.now": Wire.shared.result(id, frontNow() ?? [:])
        case "place.measure": Wire.shared.result(id, placeMeasure())
        case "apps.running": Wire.shared.result(id, appsRunning(params))
        case "desktop.setImage": Wire.shared.result(id, try desktopSetImage(params))
        case "desktop.getImage": Wire.shared.result(id, desktopGetImage())
        case "desktop.setFolderIcon": Wire.shared.result(id, try desktopSetFolderIcon(params))
        case "chat":
            #if canImport(FoundationModels)
            if #available(macOS 26.0, *) {
                Wire.shared.result(id, try await chat(id: id, params: params))
                return
            }
            #endif
            throw NSError(domain: "keeper", code: 5, userInfo: [NSLocalizedDescriptionKey: "Apple Intelligence needs macOS 26 or later"])
        default:
            throw NSError(domain: "keeper", code: 6, userInfo: [NSLocalizedDescriptionKey: "Unknown method \(method)"])
        }
    } catch is CancellationError {
        Wire.shared.error(id, "Stopped")
    } catch {
        Wire.shared.error(id, error.localizedDescription)
    }
}

/// Requests still being answered; at the end of input the helper waits for them before it exits.
let inFlight = DispatchGroup()

func dispatch(_ line: String) {
    guard let data = line.data(using: .utf8),
          let obj = try? JSONSerialization.jsonObject(with: data, options: []) as? [String: Any],
          let id = obj["id"] as? Int,
          let method = obj["method"] as? String else { return }
    let params = JSONBox(value: obj["params"] as? [String: Any] ?? [String: Any]())
    switch method {
    case "toolResult":
        let p = params.value as? [String: Any] ?? [:]
        guard let call = p["call"] as? String else { return }
        let result = JSONBox(value: p["result"] ?? NSNull())
        Task { await Bridge.shared.answer(call, result) }
    case "cancel":
        Task { await Bridge.shared.cancel(id) }
    default:
        inFlight.enter()
        let task = Task {
            await handle(id: id, method: method, params: params.value as? [String: Any] ?? [:])
            await Bridge.shared.done(id)
            inFlight.leave()
        }
        Task { await Bridge.shared.track(id, task) }
    }
}

// Reads requests on a thread of its own; the work itself runs in tasks. The
// main thread serves the main queue, where some system frameworks deliver
// their notifications (EventKit's "the calendar changed"). When Keeper closes
// stdin it is done with the helper.
Thread.detachNewThread {
    while let line = readLine(strippingNewline: true) {
        dispatch(line)
    }
    // Input closed: finish what was asked (answers are written from other threads), then leave.
    _ = inFlight.wait(timeout: .now() + 30)
    exit(0)
}
dispatchMain()
