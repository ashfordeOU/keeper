// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Calls and levels for the Island, with public Core Audio only:
//   calls.micApps     which apps are using a microphone (macOS 14.2+: per app;
//                     older: only whether any app is)
//   calls.mute        mute or unmute the default microphone { muted }
//   calls.muted       is the default microphone muted
//   hud.levels        output volume and mute; built-in display brightness where
//                     the public IOKit call still answers (Intel Macs)
//   hud.watch         a long call: one delta per change of the output volume or
//                     mute (Core Audio listeners, no polling); with { keys: true }
//                     also the brightness keys (a listen-only event tap; needs
//                     Input Monitoring). Keeper shows its level beside macOS's own
//                     pop-up; replacing that pop-up would need private APIs.

import Foundation
import CoreAudio
import AudioToolbox
import AppKit
import IOKit
import IOKit.graphics

private func defaultDevice(_ selector: AudioObjectPropertySelector) -> AudioObjectID? {
    var id = AudioObjectID(0)
    var size = UInt32(MemoryLayout<AudioObjectID>.size)
    var addr = AudioObjectPropertyAddress(mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    return AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &id) == noErr && id != 0 ? id : nil
}

private func readUInt32(_ obj: AudioObjectID, _ sel: AudioObjectPropertySelector, _ scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal) -> UInt32? {
    var v = UInt32(0)
    var size = UInt32(MemoryLayout<UInt32>.size)
    var addr = AudioObjectPropertyAddress(mSelector: sel, mScope: scope, mElement: kAudioObjectPropertyElementMain)
    return AudioObjectGetPropertyData(obj, &addr, 0, nil, &size, &v) == noErr ? v : nil
}

private func readFloat(_ obj: AudioObjectID, _ sel: AudioObjectPropertySelector, _ scope: AudioObjectPropertyScope, _ element: UInt32 = kAudioObjectPropertyElementMain) -> Float32? {
    var v = Float32(0)
    var size = UInt32(MemoryLayout<Float32>.size)
    var addr = AudioObjectPropertyAddress(mSelector: sel, mScope: scope, mElement: element)
    guard AudioObjectHasProperty(obj, &addr) else { return nil }
    return AudioObjectGetPropertyData(obj, &addr, 0, nil, &size, &v) == noErr ? v : nil
}

/// Output volume 0–100 (the main element, or the average of the first two channels).
private func outputVolume() -> (volume: Int, muted: Bool)? {
    guard let dev = defaultDevice(kAudioHardwarePropertyDefaultOutputDevice) else { return nil }
    let scope = kAudioDevicePropertyScopeOutput
    var v = readFloat(dev, kAudioDevicePropertyVolumeScalar, scope)
    if v == nil {
        let l = readFloat(dev, kAudioDevicePropertyVolumeScalar, scope, 1)
        let r = readFloat(dev, kAudioDevicePropertyVolumeScalar, scope, 2)
        if let l = l { v = r.map { (l + $0) / 2 } ?? l }
    }
    guard let vol = v else { return nil }
    let muted = (readUInt32(dev, kAudioDevicePropertyMute, scope) ?? 0) != 0
    return (Int((vol * 100).rounded()), muted)
}

/// Apps using a microphone right now.
func callsMicApps() -> [String: Any] {
    if #available(macOS 14.2, *) {
        var addr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyProcessObjectList, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var size = UInt32(0)
        if AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size) == noErr, size > 0 {
            var ids = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
            if AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &ids) == noErr {
                var apps: [[String: Any]] = []
                for p in ids where (readUInt32(p, kAudioProcessPropertyIsRunningInput) ?? 0) != 0 {
                    var pid = pid_t(0)
                    var psize = UInt32(MemoryLayout<pid_t>.size)
                    var paddr = AudioObjectPropertyAddress(mSelector: kAudioProcessPropertyPID, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
                    _ = AudioObjectGetPropertyData(p, &paddr, 0, nil, &psize, &pid)
                    var bundle: CFString = "" as CFString
                    var bsize = UInt32(MemoryLayout<CFString>.size)
                    var baddr = AudioObjectPropertyAddress(mSelector: kAudioProcessPropertyBundleID, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
                    _ = withUnsafeMutablePointer(to: &bundle) { AudioObjectGetPropertyData(p, &baddr, 0, nil, &bsize, $0) }
                    let running = NSRunningApplication(processIdentifier: pid)
                    // Helpers (WebKit, Chrome Helper) belong to the app that opened them.
                    let name = running?.localizedName ?? (bundle as String)
                    apps.append(["pid": Int(pid), "bundle": bundle as String, "name": name])
                }
                return ["perApp": true, "apps": apps]
            }
        }
    }
    // Older macOS: only whether some app has the default microphone open.
    if let dev = defaultDevice(kAudioHardwarePropertyDefaultInputDevice),
       (readUInt32(dev, kAudioDevicePropertyDeviceIsRunningSomewhere) ?? 0) != 0 {
        return ["perApp": false, "apps": [["name": "An app", "bundle": "", "pid": 0]]]
    }
    return ["perApp": false, "apps": []]
}

func callsMuted() -> [String: Any] {
    guard let dev = defaultDevice(kAudioHardwarePropertyDefaultInputDevice) else { return ["muted": false, "available": false] }
    let m = readUInt32(dev, kAudioDevicePropertyMute, kAudioDevicePropertyScopeInput)
    if let m = m { return ["muted": m != 0, "available": true] }
    let v = readFloat(dev, kAudioDevicePropertyVolumeScalar, kAudioDevicePropertyScopeInput) ?? 1
    return ["muted": v == 0, "available": true]
}

private var savedInputVolume: Float32 = 0.75

/// Mutes the default microphone (its mute switch, or its volume to 0 for devices without one).
func callsMute(_ p: [String: Any]) throws -> [String: Any] {
    let muted = (p["muted"] as? Bool) ?? true
    guard let dev = defaultDevice(kAudioHardwarePropertyDefaultInputDevice) else {
        throw NSError(domain: "keeper", code: 41, userInfo: [NSLocalizedDescriptionKey: "There is no microphone"])
    }
    var addr = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyMute, mScope: kAudioDevicePropertyScopeInput, mElement: kAudioObjectPropertyElementMain)
    var settable = DarwinBoolean(false)
    if AudioObjectHasProperty(dev, &addr), AudioObjectIsPropertySettable(dev, &addr, &settable) == noErr, settable.boolValue {
        var v = UInt32(muted ? 1 : 0)
        let st = AudioObjectSetPropertyData(dev, &addr, 0, nil, UInt32(MemoryLayout<UInt32>.size), &v)
        if st == noErr { return ["muted": muted, "how": "mute"] }
    }
    var vaddr = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyVolumeScalar, mScope: kAudioDevicePropertyScopeInput, mElement: kAudioObjectPropertyElementMain)
    if muted, let cur = readFloat(dev, kAudioDevicePropertyVolumeScalar, kAudioDevicePropertyScopeInput), cur > 0 { savedInputVolume = cur }
    var v: Float32 = muted ? 0 : savedInputVolume
    let st = AudioObjectSetPropertyData(dev, &vaddr, 0, nil, UInt32(MemoryLayout<Float32>.size), &v)
    if st != noErr { throw NSError(domain: "keeper", code: 42, userInfo: [NSLocalizedDescriptionKey: "This microphone cannot be muted from here"]) }
    return ["muted": muted, "how": "volume"]
}

/// Built-in display brightness through IOKit (answers on Intel Macs; Apple silicon keeps it private).
private func builtInBrightness() -> Int? {
    var iter: io_iterator_t = 0
    guard IOServiceGetMatchingServices(kIOMainPortDefault, IOServiceMatching("IODisplayConnect"), &iter) == KERN_SUCCESS else { return nil }
    defer { IOObjectRelease(iter) }
    var service = IOIteratorNext(iter)
    while service != 0 {
        var v: Float = 0
        let r = IODisplayGetFloatParameter(service, 0, kIODisplayBrightnessKey as CFString, &v)
        IOObjectRelease(service)
        if r == kIOReturnSuccess { return Int((v * 100).rounded()) }
        service = IOIteratorNext(iter)
    }
    return nil
}

func hudLevels() -> [String: Any] {
    var o: [String: Any] = [:]
    if let v = outputVolume() { o["volume"] = v.volume; o["muted"] = v.muted }
    if let b = builtInBrightness() { o["brightness"] = b }
    return o
}

private func emit(_ id: Int, _ o: [String: Any]) {
    if let d = try? JSONSerialization.data(withJSONObject: o), let s = String(data: d, encoding: .utf8) { Wire.shared.delta(id, s) }
}

/// The brightness keys arrive as system-defined events (NX_KEYTYPE_BRIGHTNESS_UP = 2, DOWN = 3).
private final class KeyTap: @unchecked Sendable {
    var tap: CFMachPort?
    var loop: CFRunLoop?
    let onKey: (Int) -> Void
    init(onKey: @escaping (Int) -> Void) { self.onKey = onKey }
    func start() -> Bool {
        let mask = CGEventMask(1 << 14) // NSEvent.EventType.systemDefined
        let me = Unmanaged.passUnretained(self).toOpaque()
        guard let t = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .listenOnly, eventsOfInterest: mask, callback: { _, _, ev, refcon in
            if let refcon = refcon, let ns = NSEvent(cgEvent: ev), ns.subtype.rawValue == 8 {
                let code = (ns.data1 & 0xFFFF0000) >> 16
                let down = ((ns.data1 & 0xFF00) >> 8) == 0xA
                if down && (code == 2 || code == 3) { Unmanaged<KeyTap>.fromOpaque(refcon).takeUnretainedValue().onKey(code == 2 ? 1 : -1) }
            }
            return Unmanaged.passUnretained(ev)
        }, userInfo: me) else { return false }
        tap = t
        let thread = Thread { [weak self] in
            guard let self = self, let t = self.tap else { return }
            let src = CFMachPortCreateRunLoopSource(nil, t, 0)
            self.loop = CFRunLoopGetCurrent()
            CFRunLoopAddSource(self.loop, src, .commonModes)
            CGEvent.tapEnable(tap: t, enable: true)
            CFRunLoopRun()
        }
        thread.start()
        return true
    }
    func stop() {
        if let t = tap { CGEvent.tapEnable(tap: t, enable: false) }
        if let l = loop { CFRunLoopStop(l) }
    }
}

func hudWatch(id: Int, params: [String: Any]) async throws {
    let queue = DispatchQueue(label: "keeper.hud")
    var listeners: [(AudioObjectID, AudioObjectPropertyAddress, AudioObjectPropertyListenerBlock)] = []
    let send: @Sendable () -> Void = { if let v = outputVolume() { emit(id, ["kind": "volume", "value": v.volume, "muted": v.muted]) } }
    func listen(_ dev: AudioObjectID, _ sel: AudioObjectPropertySelector, _ el: UInt32) {
        var addr = AudioObjectPropertyAddress(mSelector: sel, mScope: kAudioDevicePropertyScopeOutput, mElement: el)
        guard AudioObjectHasProperty(dev, &addr) else { return }
        let block: AudioObjectPropertyListenerBlock = { _, _ in send() }
        if AudioObjectAddPropertyListenerBlock(dev, &addr, queue, block) == noErr { listeners.append((dev, addr, block)) }
    }
    if let dev = defaultDevice(kAudioHardwarePropertyDefaultOutputDevice) {
        for el: UInt32 in [kAudioObjectPropertyElementMain, 1, 2] { listen(dev, kAudioDevicePropertyVolumeScalar, el) }
        listen(dev, kAudioDevicePropertyMute, kAudioObjectPropertyElementMain)
    }
    var tap: KeyTap?
    if (params["keys"] as? Bool) == true {
        let t = KeyTap { dir in
            // The display changes a moment after the key; read it then.
            queue.asyncAfter(deadline: .now() + 0.12) {
                var o: [String: Any] = ["kind": "brightness", "direction": dir]
                if let b = builtInBrightness() { o["value"] = b }
                emit(id, o)
            }
        }
        if t.start() { tap = t } else { emit(id, ["kind": "error", "message": "Brightness keys need the Input Monitoring permission"]) }
    }
    defer {
        for (dev, addr, block) in listeners { var a = addr; AudioObjectRemovePropertyListenerBlock(dev, &a, queue, block) }
        tap?.stop()
    }
    send()
    while !Task.isCancelled { try await Task.sleep(nanoseconds: 3_600_000_000_000) }
}
