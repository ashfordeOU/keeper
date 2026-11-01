// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// mactest-probe: small, read-only questions about this Mac for the test run,
// answered as one JSON object on stdout. Built with swiftc at the start of a run.
//
//   screens            every screen: frame, menu bar, safe area, and the notch's
//                      real position from auxiliaryTopLeftArea/auxiliaryTopRightArea
//   tcc                which privacy permissions this terminal has (never asks)
//   request <kind>     asks for one: screen | accessibility | microphone | input
//   mic-level <sec>    the default microphone's loudest and average level (dBFS)
//   desktop-get        every screen's desktop picture, to put back later
//   desktop-set <i> <path>  sets screen i's desktop picture (only to restore)
import AppKit
import AVFoundation
import ApplicationServices
import CoreGraphics
import Foundation

func emit(_ o: Any) {
    if let d = try? JSONSerialization.data(withJSONObject: o, options: [.sortedKeys]), let s = String(data: d, encoding: .utf8) { print(s) }
    exit(0)
}
func rect(_ r: NSRect) -> [String: Double] { ["x": Double(r.minX), "y": Double(r.minY), "width": Double(r.width), "height": Double(r.height)] }
func displayId(_ s: NSScreen) -> UInt32 { (s.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value ?? 0 }

func screens() -> [String: Any] {
    let all = NSScreen.screens
    // Electron's coordinates: top-left origin at the primary (first) screen.
    let primaryTop = all.first.map { $0.frame.maxY } ?? 0
    var list: [[String: Any]] = []
    for (i, s) in all.enumerated() {
        let f = s.frame
        let id = displayId(s)
        var o: [String: Any] = [
            "index": i, "id": Int(id), "name": s.localizedName, "main": s == NSScreen.main,
            "builtIn": CGDisplayIsBuiltin(id) != 0, "scale": Double(s.backingScaleFactor),
            "frame": rect(f), "visibleFrame": rect(s.visibleFrame),
            "boundsTopLeft": ["x": Double(f.minX), "y": Double(primaryTop - f.maxY), "width": Double(f.width), "height": Double(f.height)],
            "menuBarHeight": Double(f.maxY - s.visibleFrame.maxY),
        ]
        if #available(macOS 12.0, *) {
            let ins = s.safeAreaInsets
            o["safeAreaTop"] = Double(ins.top)
            if let l = s.auxiliaryTopLeftArea, let r = s.auxiliaryTopRightArea {
                o["auxLeft"] = rect(l)
                o["auxRight"] = rect(r)
                // The areas are in the screen's own coordinates on current macOS; older releases gave global ones.
                let lx = l.maxX > f.width ? l.maxX - f.minX : l.maxX
                let rx = r.minX > f.width ? r.minX - f.minX : r.minX
                let width = Double(rx - lx)
                if width > 0 {
                    o["notch"] = [
                        "localX": Double(lx), "width": width, "height": Double(ins.top),
                        "centerX": Double(f.minX) + Double(lx) + width / 2,
                        "topY": Double(primaryTop - f.maxY),
                    ]
                }
            }
        }
        list.append(o)
    }
    return ["screens": list]
}

func automation(_ bundle: String) -> Int {
    let target = NSAppleEventDescriptor(bundleIdentifier: bundle)
    guard let desc = target.aeDesc else { return -1 }
    return Int(AEDeterminePermissionToAutomateTarget(desc, AEEventClass(typeWildCard), AEEventID(typeWildCard), false))
}

func tcc() -> [String: Any] {
    let mic: String
    switch AVCaptureDevice.authorizationStatus(for: .audio) {
    case .authorized: mic = "granted"
    case .denied: mic = "denied"
    case .restricted: mic = "restricted"
    default: mic = "not-asked"
    }
    let tccDb = NSHomeDirectory() + "/Library/Application Support/com.apple.TCC/TCC.db"
    let fda = FileManager.default.isReadableFile(atPath: tccDb) && (FileHandle(forReadingAtPath: tccDb) != nil)
    return [
        "screenRecording": CGPreflightScreenCaptureAccess(),
        "accessibility": AXIsProcessTrusted(),
        "inputMonitoring": CGPreflightListenEventAccess(),
        "postEvents": CGPreflightPostEventAccess(),
        "microphone": mic,
        "fullDiskAccess": fda,
        // 0 allowed, -1743 not allowed, -1744 would ask, -600 app not running
        "automationNotes": automation("com.apple.Notes"),
        "automationSystemEvents": automation("com.apple.systemevents"),
    ]
}

func request(_ kind: String) -> [String: Any] {
    switch kind {
    case "screen": return ["granted": CGRequestScreenCaptureAccess()]
    case "accessibility":
        let opts = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        return ["granted": AXIsProcessTrustedWithOptions(opts)]
    case "input": return ["granted": CGRequestListenEventAccess()]
    case "microphone":
        let sem = DispatchSemaphore(value: 0)
        var ok = false
        AVCaptureDevice.requestAccess(for: .audio) { g in ok = g; sem.signal() }
        _ = sem.wait(timeout: .now() + 120)
        return ["granted": ok]
    default: return ["error": "unknown kind \(kind)"]
    }
}

func micLevel(_ seconds: Double) -> [String: Any] {
    let engine = AVAudioEngine()
    let input = engine.inputNode
    let format = input.outputFormat(forBus: 0)
    if format.channelCount == 0 { return ["error": "no microphone input"] }
    var peak: Float = 0
    var sumSq: Double = 0
    var count = 0
    let lock = NSLock()
    input.installTap(onBus: 0, bufferSize: 1024, format: format) { buf, _ in
        guard let ch = buf.floatChannelData?[0] else { return }
        lock.lock()
        for i in 0..<Int(buf.frameLength) { let v = abs(ch[i]); if v > peak { peak = v }; sumSq += Double(v * v) }
        count += Int(buf.frameLength)
        lock.unlock()
    }
    do { try engine.start() } catch { return ["error": "the microphone did not start: \(error.localizedDescription)"] }
    Thread.sleep(forTimeInterval: seconds)
    engine.stop()
    input.removeTap(onBus: 0)
    let db = { (x: Double) -> Double in x > 0 ? 20 * log10(x) : -160 }
    let rms = count > 0 ? (sumSq / Double(count)).squareRoot() : 0
    return ["peakDb": db(Double(peak)), "rmsDb": db(rms), "samples": count, "sampleRate": format.sampleRate, "device": AVCaptureDevice.default(for: .audio)?.localizedName ?? ""]
}

func desktopGet() -> [String: Any] {
    var list: [[String: Any]] = []
    for (i, s) in NSScreen.screens.enumerated() {
        var o: [String: Any] = ["index": i, "id": Int(displayId(s))]
        if let u = NSWorkspace.shared.desktopImageURL(for: s) { o["path"] = u.path }
        list.append(o)
    }
    return ["screens": list]
}

func desktopSet(_ index: Int, _ path: String) -> [String: Any] {
    let all = NSScreen.screens
    guard index >= 0, index < all.count else { return ["error": "no screen \(index)"] }
    do {
        try NSWorkspace.shared.setDesktopImageURL(URL(fileURLWithPath: path), for: all[index], options: NSWorkspace.shared.desktopImageOptions(for: all[index]) ?? [:])
        return ["ok": true]
    } catch { return ["error": error.localizedDescription] }
}

let args = CommandLine.arguments
switch args.count > 1 ? args[1] : "" {
case "screens": emit(screens())
case "tcc": emit(tcc())
case "request": emit(request(args.count > 2 ? args[2] : ""))
case "mic-level": emit(micLevel(Double(args.count > 2 ? args[2] : "3") ?? 3))
case "desktop-get": emit(desktopGet())
case "desktop-set": emit(desktopSet(Int(args.count > 2 ? args[2] : "-1") ?? -1, args.count > 3 ? args[3] : ""))
default:
    FileHandle.standardError.write("usage: mactest-probe screens|tcc|request <kind>|mic-level <sec>|desktop-get|desktop-set <i> <path>\n".data(using: .utf8)!)
    exit(2)
}
