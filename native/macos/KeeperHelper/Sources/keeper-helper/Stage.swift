// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Stage mode's native parts on macOS, all through public APIs:
//
//   stage.modes      the main (or a given) display's modes (CoreGraphics)
//   stage.setMode    switch a display to a mode for this login session
//   stage.windows    on-screen windows' owners and levels (no titles, so no
//                    Screen Recording permission is needed); Stage looks for
//                    the system's capture controls here
//   stage.events     streams key presses and clicks for the keystroke and
//                    click overlays (a listen-only event tap; needs Input
//                    Monitoring). Secure input fields never reach it.
//   stage.cursorSize the pointer size from Accessibility settings, if readable
//
// Dispatch: one `case` in main.swift sends every "stage.*" method here.

@preconcurrency import Foundation
import CoreGraphics
import ApplicationServices

func stageCall(id: Int, method: String, params: [String: Any]) async throws -> [String: Any] {
    switch method {
    case "stage.modes": return stageModes(params)
    case "stage.setMode": return try stageSetMode(params)
    case "stage.windows": return ["windows": stageWindows()]
    case "stage.events": return try await stageEvents(id: id)
    case "stage.cursorSize":
        let v = UserDefaults(suiteName: "com.apple.universalaccess")?.object(forKey: "mouseDriverCursorSize") as? Double
        return ["size": v.map { $0 as Any } ?? NSNull()]
    default: throw NSError(domain: "keeper", code: 60, userInfo: [NSLocalizedDescriptionKey: "Unknown method \(method)"])
    }
}

private func displayFrom(_ p: [String: Any]) -> CGDirectDisplayID {
    if let n = p["display"] as? Int, n > 0 { return CGDirectDisplayID(n) }
    return CGMainDisplayID()
}

private func allModes(_ d: CGDirectDisplayID) -> [CGDisplayMode] {
    let opts = [kCGDisplayShowDuplicateLowResolutionModes: kCFBooleanTrue] as CFDictionary
    return (CGDisplayCopyAllDisplayModes(d, opts) as? [CGDisplayMode]) ?? []
}

func stageModes(_ p: [String: Any]) -> [String: Any] {
    let d = displayFrom(p)
    let cur = CGDisplayCopyDisplayMode(d)
    let list: [[String: Any]] = allModes(d).filter { $0.isUsableForDesktopGUI() }.map { m in
        [
            "id": Int(m.ioDisplayModeID),
            "width": m.width, "height": m.height,
            "refresh": m.refreshRate,
            "hidpi": m.pixelWidth > m.width,
            "current": cur.map { $0.ioDisplayModeID == m.ioDisplayModeID && $0.pixelWidth == m.pixelWidth && $0.width == m.width } ?? false,
        ]
    }
    return ["display": Int(d), "modes": list]
}

func stageSetMode(_ p: [String: Any]) throws -> [String: Any] {
    let d = displayFrom(p)
    guard let want = p["modeId"] as? Int else { throw NSError(domain: "keeper", code: 61, userInfo: [NSLocalizedDescriptionKey: "No mode"]) }
    let w = p["width"] as? Int
    let hidpi = p["hidpi"] as? Bool
    let modes = allModes(d).filter { Int($0.ioDisplayModeID) == want && (w == nil || $0.width == w!) && (hidpi == nil || ($0.pixelWidth > $0.width) == hidpi!) }
    guard let mode = modes.first else { throw NSError(domain: "keeper", code: 62, userInfo: [NSLocalizedDescriptionKey: "That mode is not available on this display"]) }
    var config: CGDisplayConfigRef?
    guard CGBeginDisplayConfiguration(&config) == .success, let c = config else { throw NSError(domain: "keeper", code: 63, userInfo: [NSLocalizedDescriptionKey: "Could not change the display"]) }
    CGConfigureDisplayWithDisplayMode(c, d, mode, nil)
    let r = CGCompleteDisplayConfiguration(c, .forSession)
    if r != .success { throw NSError(domain: "keeper", code: 64, userInfo: [NSLocalizedDescriptionKey: "The display did not accept the change"]) }
    return ["ok": true]
}

func stageWindows() -> [[String: Any]] {
    guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else { return [] }
    return list.map { w in
        ["owner": w[kCGWindowOwnerName as String] as? String ?? "", "pid": w[kCGWindowOwnerPID as String] as? Int ?? 0, "layer": w[kCGWindowLayer as String] as? Int ?? 0]
    }
}

// MARK: - key and click events

private let specialKeys: [Int64: String] = [
    36: "Return", 48: "Tab", 49: "Space", 51: "Backspace", 53: "Escape", 117: "Delete", 115: "Home", 119: "End", 116: "PageUp", 121: "PageDown",
    123: "Left", 124: "Right", 125: "Down", 126: "Up",
    122: "F1", 120: "F2", 99: "F3", 118: "F4", 96: "F5", 97: "F6", 98: "F7", 100: "F8", 101: "F9", 109: "F10", 103: "F11", 111: "F12",
]

private final class TapBox: @unchecked Sendable {
    let id: Int
    var loop: CFRunLoop?
    init(id: Int) { self.id = id }
}

private func mods(_ f: CGEventFlags) -> [String] {
    var m: [String] = []
    if f.contains(.maskControl) { m.append("ctrl") }
    if f.contains(.maskAlternate) { m.append("alt") }
    if f.contains(.maskShift) { m.append("shift") }
    if f.contains(.maskCommand) { m.append("cmd") }
    return m
}

private func send(_ box: TapBox, _ obj: [String: Any]) {
    guard let d = try? JSONSerialization.data(withJSONObject: obj), let s = String(data: d, encoding: .utf8) else { return }
    Wire.shared.delta(box.id, s)
}

/// Streams events as `delta` lines until Keeper cancels the request.
func stageEvents(id: Int) async throws -> [String: Any] {
    let box = TapBox(id: id)
    let mask = (1 << CGEventType.keyDown.rawValue) | (1 << CGEventType.leftMouseDown.rawValue) | (1 << CGEventType.rightMouseDown.rawValue)
    let callback: CGEventTapCallBack = { _, type, event, refcon in
        guard let refcon else { return Unmanaged.passUnretained(event) }
        let box = Unmanaged<TapBox>.fromOpaque(refcon).takeUnretainedValue()
        if type == .keyDown {
            let code = event.getIntegerValueField(.keyboardEventKeycode)
            var key = specialKeys[code] ?? ""
            if key.isEmpty {
                var len = 0
                var chars = [UniChar](repeating: 0, count: 4)
                event.keyboardGetUnicodeString(maxStringLength: 4, actualStringLength: &len, unicodeString: &chars)
                key = String(utf16CodeUnits: chars, count: len)
            }
            if !key.isEmpty { send(box, ["t": "key", "key": key, "mods": mods(event.flags)]) }
        } else if type == .leftMouseDown || type == .rightMouseDown {
            let p = event.location
            send(box, ["t": "click", "x": p.x, "y": p.y, "right": type == .rightMouseDown])
        }
        return Unmanaged.passUnretained(event)
    }
    let ref = Unmanaged.passRetained(box).toOpaque()
    guard let tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .tailAppendEventTap, options: .listenOnly, eventsOfInterest: CGEventMask(mask), callback: callback, userInfo: ref) else {
        Unmanaged<TapBox>.fromOpaque(ref).release()
        throw NSError(domain: "keeper", code: 65, userInfo: [NSLocalizedDescriptionKey: "Allow Keeper in Privacy & Security → Input Monitoring to show keystrokes and clicks"])
    }
    let thread = Thread {
        box.loop = CFRunLoopGetCurrent()
        let src = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
        CFRunLoopAddSource(CFRunLoopGetCurrent(), src, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
        CFRunLoopRun()
    }
    thread.start()
    send(box, ["t": "ready"])
    while !Task.isCancelled {
        try? await Task.sleep(nanoseconds: 400_000_000)
    }
    CGEvent.tapEnable(tap: tap, enable: false)
    if let l = box.loop { CFRunLoopStop(l) }
    Unmanaged<TapBox>.fromOpaque(ref).release()
    return ["ok": true]
}
