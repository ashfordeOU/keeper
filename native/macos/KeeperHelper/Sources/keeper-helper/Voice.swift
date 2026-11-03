// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Voice's native parts on macOS, all through public APIs:
//
//   voice.keys         streams presses and releases of one talk key, and Esc
//                      (a listen-only event tap; needs Input Monitoring). Right
//                      modifiers are told apart by their device flag bits; fn by
//                      the secondary-fn flag. Lines: "ready", "key <code> down|up", "key esc down".
//   voice.systemAudio  streams the computer's sound as base64 16 kHz mono
//                      float32 (ScreenCaptureKit audio, macOS 13+; needs Screen &
//                      System Audio Recording). Keeper's own sound is left out.
//   voice.typed        streams what is typed in any app, for typed snippets and
//                      the paste queue (a listen-only event tap; Input Monitoring).
//                      Characters come from the keyboard layout in use. Lines:
//                      "ready", "t <json string>", "k back", "k reset", "k paste".
//                      Nothing arrives while a password field has Secure Input on.
//   voice.focus        is the focused field a password field? (Accessibility:
//                      the secure text field subrole, or secure keyboard entry on)
//   voice.micState     is the default microphone in use by any app, and which apps run
//
// Dispatch: one `case` in main.swift sends every "voice.*" method here.

@preconcurrency import Foundation
import CoreGraphics
import ApplicationServices
import CoreAudio
import CoreMedia
import AppKit
import Carbon.HIToolbox
import ScreenCaptureKit

func voiceCall(id: Int, method: String, params: [String: Any]) async throws -> [String: Any] {
    switch method {
    case "voice.keys": return try await voiceKeys(id: id, params)
    case "voice.typed": return try await voiceTyped(id: id)
    case "voice.systemAudio":
        if #available(macOS 13.0, *) { return try await voiceSystemAudio(id: id) }
        throw NSError(domain: "keeper", code: 71, userInfo: [NSLocalizedDescriptionKey: "Recording the computer's sound needs macOS 13 or later"])
    case "voice.focus": return voiceFocus()
    case "voice.micState": return voiceMicState()
    default: throw NSError(domain: "keeper", code: 70, userInfo: [NSLocalizedDescriptionKey: "Unknown method \(method)"])
    }
}

// MARK: - the talk key

final class VoiceTap: @unchecked Sendable {
    let id: Int
    let code: Int64
    let esc: Int64
    let fn: Bool
    var isDown = false
    var tap: CFMachPort?
    var loop: CFRunLoop?

    init(id: Int, code: Int64, esc: Int64, fn: Bool) { self.id = id; self.code = code; self.esc = esc; self.fn = fn }

    /// NX_DEVICE*KEYMASK bits: which side's modifier is down.
    private func deviceBit() -> UInt64? {
        switch code {
        case 61: return 0x40      // right option
        case 62: return 0x2000    // right control
        case 54: return 0x10      // right command
        case 60: return 0x04      // right shift
        default: return nil
        }
    }

    func handle(_ type: CGEventType, _ e: CGEvent) {
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            if let t = tap { CGEvent.tapEnable(tap: t, enable: true) }
            return
        }
        let kc = e.getIntegerValueField(.keyboardEventKeycode)
        if type == .flagsChanged {
            guard kc == code else { return }
            if fn { emit(e.flags.contains(.maskSecondaryFn)); return }
            if code == 57 { emit(true); emit(false); return } // caps lock reports a toggle, so it works as a tap
            if let bit = deviceBit() { emit(e.flags.rawValue & bit != 0); return }
            emit(!isDown)
        } else if kc == code {
            if type == .keyDown && e.getIntegerValueField(.keyboardEventAutorepeat) != 0 { return }
            emit(type == .keyDown)
        } else if kc == esc && type == .keyDown {
            Wire.shared.delta(id, "key esc down")
        }
    }

    func emit(_ down: Bool) {
        if down == isDown { return }
        isDown = down
        Wire.shared.delta(id, "key \(code) \(down ? "down" : "up")")
    }
}

func voiceKeys(id: Int, _ p: [String: Any]) async throws -> [String: Any] {
    let code = Int64((p["code"] as? Int) ?? 61)
    let box = VoiceTap(id: id, code: code, esc: Int64((p["esc"] as? Int) ?? 53), fn: (p["fn"] as? Bool) ?? false)
    if !CGPreflightListenEventAccess() { _ = CGRequestListenEventAccess() }
    let mask = (1 << CGEventType.keyDown.rawValue) | (1 << CGEventType.keyUp.rawValue) | (1 << CGEventType.flagsChanged.rawValue)
    let callback: CGEventTapCallBack = { _, type, event, refcon in
        guard let refcon else { return Unmanaged.passUnretained(event) }
        Unmanaged<VoiceTap>.fromOpaque(refcon).takeUnretainedValue().handle(type, event)
        return Unmanaged.passUnretained(event)
    }
    let ref = Unmanaged.passRetained(box).toOpaque()
    guard let tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .listenOnly, eventsOfInterest: CGEventMask(mask), callback: callback, userInfo: ref) else {
        Unmanaged<VoiceTap>.fromOpaque(ref).release()
        throw NSError(domain: "keeper", code: 72, userInfo: [NSLocalizedDescriptionKey: "Input Monitoring permission is needed: allow Keeper in System Settings → Privacy & Security → Input Monitoring"])
    }
    box.tap = tap
    let thread = Thread {
        box.loop = CFRunLoopGetCurrent()
        let src = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
        CFRunLoopAddSource(CFRunLoopGetCurrent(), src, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
        CFRunLoopRun()
    }
    thread.start()
    Wire.shared.delta(id, "ready")
    while !Task.isCancelled {
        try? await Task.sleep(nanoseconds: 400_000_000)
    }
    CGEvent.tapEnable(tap: tap, enable: false)
    CFMachPortInvalidate(tap)
    if let l = box.loop { CFRunLoopStop(l) }
    Unmanaged<VoiceTap>.fromOpaque(ref).release()
    return ["ok": true]
}

// MARK: - what is typed (typed snippets, the paste queue)

final class TypedTap: @unchecked Sendable {
    let id: Int
    var tap: CFMachPort?
    var loop: CFRunLoop?

    init(id: Int) { self.id = id }

    /// Return, Tab, Esc, the arrows, Home, End, Page Up/Down, forward delete: start again.
    static let resetCodes: Set<Int64> = [36, 76, 48, 53, 123, 124, 125, 126, 115, 119, 116, 121, 117]

    func characters(_ e: CGEvent) -> String {
        var len = 0
        var chars = [UniChar](repeating: 0, count: 8)
        e.keyboardGetUnicodeString(maxStringLength: 8, actualStringLength: &len, unicodeString: &chars)
        return len > 0 ? String(utf16CodeUnits: chars, count: min(len, 8)) : ""
    }

    func handle(_ type: CGEventType, _ e: CGEvent) {
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            if let t = tap { CGEvent.tapEnable(tap: t, enable: true) }
            return
        }
        if type == .leftMouseDown || type == .rightMouseDown { Wire.shared.delta(id, "k reset"); return }
        guard type == .keyDown else { return }
        let kc = e.getIntegerValueField(.keyboardEventKeycode)
        let flags = e.flags
        if flags.contains(.maskCommand) {
            // ⌘V on any layout: the key that types "v".
            Wire.shared.delta(id, characters(e).lowercased() == "v" ? "k paste" : "k reset")
            return
        }
        if flags.contains(.maskControl) { Wire.shared.delta(id, "k reset"); return }
        if kc == 51 { Wire.shared.delta(id, "k back"); return }
        if TypedTap.resetCodes.contains(kc) { Wire.shared.delta(id, "k reset"); return }
        let s = characters(e)
        // A dead key (´ waiting for a letter) types nothing yet.
        if s.isEmpty { return }
        if s.unicodeScalars.contains(where: { $0.value < 0x20 || $0.value == 0x7f || ($0.value >= 0xF700 && $0.value <= 0xF8FF) }) { Wire.shared.delta(id, "k reset"); return }
        guard let data = try? JSONSerialization.data(withJSONObject: [s]), let json = String(data: data, encoding: .utf8), json.count > 2 else { return }
        Wire.shared.delta(id, "t " + String(json.dropFirst().dropLast()))
    }
}

func voiceTyped(id: Int) async throws -> [String: Any] {
    let box = TypedTap(id: id)
    if !CGPreflightListenEventAccess() { _ = CGRequestListenEventAccess() }
    let mask = (1 << CGEventType.keyDown.rawValue) | (1 << CGEventType.leftMouseDown.rawValue) | (1 << CGEventType.rightMouseDown.rawValue)
    let callback: CGEventTapCallBack = { _, type, event, refcon in
        guard let refcon else { return Unmanaged.passUnretained(event) }
        Unmanaged<TypedTap>.fromOpaque(refcon).takeUnretainedValue().handle(type, event)
        return Unmanaged.passUnretained(event)
    }
    let ref = Unmanaged.passRetained(box).toOpaque()
    guard let tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .listenOnly, eventsOfInterest: CGEventMask(mask), callback: callback, userInfo: ref) else {
        Unmanaged<TypedTap>.fromOpaque(ref).release()
        throw NSError(domain: "keeper", code: 74, userInfo: [NSLocalizedDescriptionKey: "Input Monitoring permission is needed: allow Keeper in System Settings → Privacy & Security → Input Monitoring"])
    }
    box.tap = tap
    let thread = Thread {
        box.loop = CFRunLoopGetCurrent()
        let src = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
        CFRunLoopAddSource(CFRunLoopGetCurrent(), src, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
        CFRunLoopRun()
    }
    thread.start()
    Wire.shared.delta(id, "ready")
    while !Task.isCancelled {
        try? await Task.sleep(nanoseconds: 400_000_000)
    }
    CGEvent.tapEnable(tap: tap, enable: false)
    CFMachPortInvalidate(tap)
    if let l = box.loop { CFRunLoopStop(l) }
    Unmanaged<TypedTap>.fromOpaque(ref).release()
    return ["ok": true]
}

// MARK: - the computer's sound

@available(macOS 13.0, *)
final class VoiceAudio: NSObject, SCStreamOutput, SCStreamDelegate, @unchecked Sendable {
    let id: Int
    var stream: SCStream?
    var failed: Error?
    init(id: Int) { self.id = id }

    func start() async throws {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        guard let display = content.displays.first else { throw NSError(domain: "keeper", code: 73, userInfo: [NSLocalizedDescriptionKey: "No display to record from"]) }
        let mine = content.applications.filter { $0.processID == ProcessInfo.processInfo.processIdentifier || $0.bundleIdentifier.hasPrefix("org.ashforde.keeper") }
        let filter = SCContentFilter(display: display, excludingApplications: mine, exceptingWindows: [])
        let cfg = SCStreamConfiguration()
        cfg.capturesAudio = true
        cfg.excludesCurrentProcessAudio = true
        cfg.sampleRate = 16000
        cfg.channelCount = 1
        // the picture is required but unused: keep it tiny and rare
        cfg.width = 2
        cfg.height = 2
        cfg.minimumFrameInterval = CMTime(value: 1, timescale: 1)
        cfg.queueDepth = 3
        let s = SCStream(filter: filter, configuration: cfg, delegate: self)
        try s.addStreamOutput(self, type: .audio, sampleHandlerQueue: DispatchQueue(label: "keeper.voice.audio"))
        try await s.startCapture()
        stream = s
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sb: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio, sb.isValid else { return }
        var size = 0
        CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(sb, bufferListSizeNeededOut: &size, bufferListOut: nil, bufferListSize: 0, blockBufferAllocator: nil, blockBufferMemoryAllocator: nil, flags: 0, blockBufferOut: nil)
        let raw = UnsafeMutableRawPointer.allocate(byteCount: max(size, MemoryLayout<AudioBufferList>.size), alignment: MemoryLayout<AudioBufferList>.alignment)
        defer { raw.deallocate() }
        let abl = raw.bindMemory(to: AudioBufferList.self, capacity: 1)
        var block: CMBlockBuffer?
        guard CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(sb, bufferListSizeNeededOut: nil, bufferListOut: abl, bufferListSize: size, blockBufferAllocator: nil, blockBufferMemoryAllocator: nil, flags: 0, blockBufferOut: &block) == noErr else { return }
        // mono float32: the first buffer is the channel
        let list = UnsafeMutableAudioBufferListPointer(abl)
        guard let first = list.first, let data = first.mData else { return }
        Wire.shared.delta(id, Data(bytes: data, count: Int(first.mDataByteSize)).base64EncodedString())
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) { failed = error }
}

@available(macOS 13.0, *)
func voiceSystemAudio(id: Int) async throws -> [String: Any] {
    let a = VoiceAudio(id: id)
    try await a.start()
    Wire.shared.delta(id, "ready")
    while !Task.isCancelled && a.failed == nil {
        try? await Task.sleep(nanoseconds: 300_000_000)
    }
    try? await a.stream?.stopCapture()
    if let e = a.failed { throw e }
    return ["ok": true]
}

// MARK: - password fields and the microphone

func voiceFocus() -> [String: Any] {
    // Secure keyboard entry is on while a password field (or a terminal's secure mode) has focus.
    if IsSecureEventInputEnabled() { return ["secure": true, "why": "secure input"] }
    guard AXIsProcessTrusted() else { return ["secure": NSNull()] }
    let sys = AXUIElementCreateSystemWide()
    var focused: CFTypeRef?
    guard AXUIElementCopyAttributeValue(sys, kAXFocusedUIElementAttribute as CFString, &focused) == .success, let f = focused, CFGetTypeID(f) == AXUIElementGetTypeID() else { return ["secure": NSNull()] }
    let el = f as! AXUIElement
    var sub: CFTypeRef?
    var role: CFTypeRef?
    AXUIElementCopyAttributeValue(el, kAXSubroleAttribute as CFString, &sub)
    AXUIElementCopyAttributeValue(el, kAXRoleAttribute as CFString, &role)
    return ["secure": (sub as? String) == (kAXSecureTextFieldSubrole as String), "role": (role as? String) ?? ""]
}

func voiceMicState() -> [String: Any] {
    var dev = AudioObjectID(0)
    var size = UInt32(MemoryLayout<AudioObjectID>.size)
    var addr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDefaultInputDevice, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &dev) == noErr, dev != 0 else { return ["inUse": false, "apps": [String]()] }
    var running: UInt32 = 0
    size = UInt32(MemoryLayout<UInt32>.size)
    addr.mSelector = kAudioDevicePropertyDeviceIsRunningSomewhere
    AudioObjectGetPropertyData(dev, &addr, 0, nil, &size, &running)
    let apps = running != 0 ? NSWorkspace.shared.runningApplications.filter { $0.activationPolicy == .regular }.compactMap { $0.localizedName } : []
    return ["inUse": running != 0, "apps": apps]
}
