// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Sound for each app on macOS, with public Core Audio only:
//
//   audio.outputs     output devices { id, uid, name, default }
//   audio.setOutput   make one the default output { uid } (the public, settable
//                     kAudioHardwarePropertyDefaultOutputDevice property)
//   audio.processes   apps sending sound out now (macOS 14.2+: the process object
//                     list), with the volume Keeper set for each, if any
//   audio.appVolume   the experiment (Settings → Features → Computer → Volume for
//                     each app on a Mac): { pid, volume 0–1.5, muted }. A process
//                     tap (macOS 14.2+) silences the app while tapped and hands its
//                     sound to a private aggregate device on the current output,
//                     where it is played again at that level. Volume 1 and not
//                     muted removes the tap, and the app plays as before. Needs the
//                     system's audio recording permission; no driver is installed.
//
// Written against the public headers (AudioHardware.h, CATapDescription.h); it
// has not been compiled or heard on a real Mac here (docs/MONITOR.md).

@preconcurrency import Foundation
import CoreAudio
import AudioToolbox
import AppKit

private func prop(_ sel: AudioObjectPropertySelector, _ scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress(mSelector: sel, mScope: scope, mElement: kAudioObjectPropertyElementMain)
}

private func ids(_ obj: AudioObjectID, _ sel: AudioObjectPropertySelector) -> [AudioObjectID] {
    var addr = prop(sel)
    var size = UInt32(0)
    guard AudioObjectGetPropertyDataSize(obj, &addr, 0, nil, &size) == noErr, size > 0 else { return [] }
    var list = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
    return AudioObjectGetPropertyData(obj, &addr, 0, nil, &size, &list) == noErr ? list : []
}

private func string(_ obj: AudioObjectID, _ sel: AudioObjectPropertySelector) -> String? {
    var addr = prop(sel)
    var value: CFString = "" as CFString
    var size = UInt32(MemoryLayout<CFString>.size)
    let r = withUnsafeMutablePointer(to: &value) { AudioObjectGetPropertyData(obj, &addr, 0, nil, &size, $0) }
    return r == noErr ? value as String : nil
}

private func uint32(_ obj: AudioObjectID, _ sel: AudioObjectPropertySelector) -> UInt32? {
    var addr = prop(sel)
    var v = UInt32(0)
    var size = UInt32(MemoryLayout<UInt32>.size)
    return AudioObjectGetPropertyData(obj, &addr, 0, nil, &size, &v) == noErr ? v : nil
}

private func defaultOutput() -> AudioObjectID? {
    var addr = prop(kAudioHardwarePropertyDefaultOutputDevice)
    var id = AudioObjectID(0)
    var size = UInt32(MemoryLayout<AudioObjectID>.size)
    return AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &id) == noErr && id != 0 ? id : nil
}

/// Whether a device has output channels (speakers, headphones, displays), so microphones are left out.
private func hasOutput(_ dev: AudioObjectID) -> Bool {
    var addr = prop(kAudioDevicePropertyStreamConfiguration, kAudioDevicePropertyScopeOutput)
    var size = UInt32(0)
    guard AudioObjectGetPropertyDataSize(dev, &addr, 0, nil, &size) == noErr, size > 0 else { return false }
    let raw = UnsafeMutableRawPointer.allocate(byteCount: Int(size), alignment: MemoryLayout<AudioBufferList>.alignment)
    defer { raw.deallocate() }
    guard AudioObjectGetPropertyData(dev, &addr, 0, nil, &size, raw) == noErr else { return false }
    let list = UnsafeMutableAudioBufferListPointer(raw.assumingMemoryBound(to: AudioBufferList.self))
    return list.contains { $0.mNumberChannels > 0 }
}

func audioOutputs() -> [String: Any] {
    let def = defaultOutput()
    let list: [[String: Any]] = ids(AudioObjectID(kAudioObjectSystemObject), kAudioHardwarePropertyDevices).filter { dev in
        // Keeper's own private aggregate devices never show.
        hasOutput(dev) && !(string(dev, kAudioDevicePropertyDeviceUID) ?? "").hasPrefix("org.ashforde.keeper.")
    }.map { dev in
        ["id": Int(dev), "uid": string(dev, kAudioDevicePropertyDeviceUID) ?? "", "name": string(dev, kAudioObjectPropertyName) ?? "Output \(dev)", "default": dev == def]
    }
    return ["outputs": list]
}

func audioSetOutput(_ p: [String: Any]) throws -> [String: Any] {
    guard let uid = p["uid"] as? String, !uid.isEmpty else { throw NSError(domain: "keeper", code: 80, userInfo: [NSLocalizedDescriptionKey: "No output"]) }
    guard let dev = ids(AudioObjectID(kAudioObjectSystemObject), kAudioHardwarePropertyDevices).first(where: { string($0, kAudioDevicePropertyDeviceUID) == uid }) else {
        throw NSError(domain: "keeper", code: 81, userInfo: [NSLocalizedDescriptionKey: "That output is not connected"])
    }
    var addr = prop(kAudioHardwarePropertyDefaultOutputDevice)
    var id = dev
    let r = AudioObjectSetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, UInt32(MemoryLayout<AudioObjectID>.size), &id)
    if r != noErr { throw NSError(domain: "keeper", code: 82, userInfo: [NSLocalizedDescriptionKey: "macOS did not switch the output (\(r))"]) }
    // Moving the output moves any per-app volume too: its aggregate device sits on the old output.
    if #available(macOS 14.2, *) { AppVolumes.shared.rebuildAll() }
    return ["ok": true]
}

func audioProcesses() -> [String: Any] {
    guard #available(macOS 14.2, *) else { return ["processes": [], "note": "Needs macOS 14.2 or later"] }
    var out: [[String: Any]] = []
    for p in ids(AudioObjectID(kAudioObjectSystemObject), kAudioHardwarePropertyProcessObjectList) where (uint32(p, kAudioProcessPropertyIsRunningOutput) ?? 0) != 0 {
        var addr = prop(kAudioProcessPropertyPID)
        var pid = pid_t(0)
        var size = UInt32(MemoryLayout<pid_t>.size)
        guard AudioObjectGetPropertyData(p, &addr, 0, nil, &size, &pid) == noErr, pid > 0, pid != getpid() else { continue }
        let bundle = string(p, kAudioProcessPropertyBundleID) ?? ""
        let app = NSRunningApplication(processIdentifier: pid)
        let level = AppVolumes.shared.level(pid)
        out.append(["pid": Int(pid), "bundleId": bundle, "name": app?.localizedName ?? bundle, "volume": level?.volume ?? 1, "muted": level?.muted ?? false])
    }
    return ["processes": out]
}

func audioAppVolume(_ p: [String: Any]) throws -> [String: Any] {
    guard #available(macOS 14.2, *) else { throw NSError(domain: "keeper", code: 83, userInfo: [NSLocalizedDescriptionKey: "Volume for each app needs macOS 14.2 or later"]) }
    guard let pid = p["pid"] as? Int, pid > 0 else { throw NSError(domain: "keeper", code: 84, userInfo: [NSLocalizedDescriptionKey: "No app"]) }
    let volume = Float(max(0, min(1.5, (p["volume"] as? Double) ?? 1)))
    let muted = (p["muted"] as? Bool) ?? false
    try AppVolumes.shared.set(pid_t(pid), volume: volume, muted: muted)
    return ["ok": true]
}

/// One tapped app: its tap, the private aggregate device that plays it again, and the level.
private final class Tapped: @unchecked Sendable {
    let pid: pid_t
    var tap = AudioObjectID(0)
    var aggregate = AudioObjectID(0)
    var proc: AudioDeviceIOProcID?
    /// read on the audio thread; a plain Float store is good enough for a gain
    var gain: Float = 1
    var volume: Float = 1
    var muted = false
    init(pid: pid_t) { self.pid = pid }
}

@available(macOS 14.2, *)
final class AppVolumes: @unchecked Sendable {
    static let shared = AppVolumes()
    private var taps: [pid_t: Tapped] = [:]
    private let lock = NSLock()
    private let queue = DispatchQueue(label: "org.ashforde.keeper.appvolume", qos: .userInteractive)

    func level(_ pid: pid_t) -> (volume: Float, muted: Bool)? {
        lock.lock(); defer { lock.unlock() }
        return taps[pid].map { ($0.volume, $0.muted) }
    }

    func set(_ pid: pid_t, volume: Float, muted: Bool) throws {
        lock.lock(); defer { lock.unlock() }
        if abs(volume - 1) < 0.005 && !muted {
            if let t = taps.removeValue(forKey: pid) { teardown(t) }
            return
        }
        if let t = taps[pid] {
            t.volume = volume; t.muted = muted; t.gain = muted ? 0 : volume
            return
        }
        let t = Tapped(pid: pid)
        t.volume = volume; t.muted = muted; t.gain = muted ? 0 : volume
        try build(t)
        taps[pid] = t
    }

    func rebuildAll() {
        lock.lock(); defer { lock.unlock() }
        for t in taps.values { teardown(t); try? build(t) }
    }

    private func processObject(_ pid: pid_t) -> AudioObjectID? {
        var addr = prop(kAudioHardwarePropertyTranslatePIDToProcessObject)
        var qualifier = pid
        var obj = AudioObjectID(0)
        var size = UInt32(MemoryLayout<AudioObjectID>.size)
        let r = AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, UInt32(MemoryLayout<pid_t>.size), &qualifier, &size, &obj)
        return r == noErr && obj != 0 ? obj : nil
    }

    private func build(_ t: Tapped) throws {
        func fail(_ code: Int, _ msg: String) -> NSError { NSError(domain: "keeper", code: code, userInfo: [NSLocalizedDescriptionKey: msg]) }
        guard let obj = processObject(t.pid) else { throw fail(85, "That app is not playing sound") }
        guard let out = defaultOutput(), let outUID = string(out, kAudioDevicePropertyDeviceUID) else { throw fail(86, "No output device") }
        // The app is silenced while tapped; Keeper plays the tapped sound again at the chosen level.
        let desc = CATapDescription(stereoMixdownOfProcesses: [obj])
        desc.muteBehavior = .mutedWhenTapped
        desc.isPrivate = true
        desc.name = "Keeper volume \(t.pid)"
        var tap = AudioObjectID(0)
        var r = AudioHardwareCreateProcessTap(desc, &tap)
        if r != noErr { throw fail(87, "macOS did not allow it (\(r)). Allow Keeper in Privacy & Security → Screen & System Audio Recording.") }
        t.tap = tap
        let uid = "org.ashforde.keeper.appvolume.\(t.pid).\(UUID().uuidString)"
        let agg: [String: Any] = [
            kAudioAggregateDeviceNameKey: "Keeper volume",
            kAudioAggregateDeviceUIDKey: uid,
            kAudioAggregateDeviceMainSubDeviceKey: outUID,
            kAudioAggregateDeviceIsPrivateKey: true,
            kAudioAggregateDeviceIsStackedKey: false,
            kAudioAggregateDeviceTapAutoStartKey: true,
            kAudioAggregateDeviceSubDeviceListKey: [[kAudioSubDeviceUIDKey: outUID]],
            kAudioAggregateDeviceTapListKey: [[kAudioSubTapDriftCompensationKey: true, kAudioSubTapUIDKey: desc.uuid.uuidString]],
        ]
        var aggID = AudioObjectID(0)
        r = AudioHardwareCreateAggregateDevice(agg as CFDictionary, &aggID)
        if r != noErr { AudioHardwareDestroyProcessTap(tap); t.tap = 0; throw fail(88, "Could not make the playback device (\(r))") }
        t.aggregate = aggID
        var proc: AudioDeviceIOProcID?
        r = AudioDeviceCreateIOProcIDWithBlock(&proc, aggID, queue) { [t] _, input, _, output, _ in
            let ins = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: input))
            let outs = UnsafeMutableAudioBufferListPointer(output)
            let g = t.gain
            for (i, ob) in outs.enumerated() {
                guard let dst = ob.mData?.assumingMemoryBound(to: Float.self) else { continue }
                let n = Int(ob.mDataByteSize) / MemoryLayout<Float>.size
                if i < ins.count, let src = ins[i].mData?.assumingMemoryBound(to: Float.self) {
                    let m = min(n, Int(ins[i].mDataByteSize) / MemoryLayout<Float>.size)
                    for k in 0..<m { dst[k] = src[k] * g }
                    if m < n { for k in m..<n { dst[k] = 0 } }
                } else {
                    for k in 0..<n { dst[k] = 0 }
                }
            }
        }
        if r != noErr || proc == nil { teardown(t); throw fail(89, "Could not start playing it again (\(r))") }
        t.proc = proc
        r = AudioDeviceStart(aggID, proc)
        if r != noErr { teardown(t); throw fail(90, "Could not start playing it again (\(r))") }
    }

    private func teardown(_ t: Tapped) {
        if let p = t.proc { AudioDeviceStop(t.aggregate, p); AudioDeviceDestroyIOProcID(t.aggregate, p); t.proc = nil }
        if t.aggregate != 0 { AudioHardwareDestroyAggregateDevice(t.aggregate); t.aggregate = 0 }
        if t.tap != 0 { AudioHardwareDestroyProcessTap(t.tap); t.tap = 0 }
    }
}

func audioCall(method: String, params: [String: Any]) throws -> [String: Any] {
    switch method {
    case "audio.outputs": return audioOutputs()
    case "audio.setOutput": return try audioSetOutput(params)
    case "audio.processes": return audioProcesses()
    case "audio.appVolume": return try audioAppVolume(params)
    default: throw NSError(domain: "keeper", code: 91, userInfo: [NSLocalizedDescriptionKey: "Unknown method \(method)"])
    }
}
