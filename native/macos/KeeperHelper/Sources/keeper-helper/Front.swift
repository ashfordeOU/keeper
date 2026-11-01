// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The app in front, the menu bar and running apps, answered inside the helper
// that is already running instead of by a new osascript each time (starting
// osascript and talking to System Events costs far more than the answer):
//
//   front.watch    a long call: one delta (JSON) whenever the app or window in
//                  front changes: { app, appId, pid, title, bounds, fullscreen }.
//                  Looks once a second in this process (a window-list read and,
//                  with the Accessibility permission, three attribute reads).
//   place.measure  (also menubar.layout) what the Island fits around: each screen's notch (safe area
//                  and the areas beside it), the menu-bar status items' frames
//                  (window layer 25) and where the front app's menus end
//                  (Accessibility; left out without it)
//   apps.running   which of the given bundle ids are running
//   camera.inUse   whether any camera is on (CoreMediaIO), for the Island's green dot
//   pasteboard.changeCount  the clipboard's change counter (dispatched in main.swift), so
//                  clipboard history reads the clipboard only after it changed
//
// The main thread is busy reading requests, so nothing here relies on a run
// loop: NSWorkspace's front-app notifications would never arrive. The window
// list (front to back) and Accessibility's focused application answer directly.

import Foundation
import AppKit
import CoreGraphics
import ApplicationServices
import CoreMediaIO

private func axAttr(_ el: AXUIElement, _ name: String) -> CFTypeRef? {
    var v: CFTypeRef?
    return AXUIElementCopyAttributeValue(el, name as CFString, &v) == .success ? v : nil
}

private func axElement(_ v: CFTypeRef?) -> AXUIElement? {
    guard let v = v, CFGetTypeID(v) == AXUIElementGetTypeID() else { return nil }
    return (v as! AXUIElement)
}

private func axFrame(_ el: AXUIElement) -> CGRect? {
    guard let p = axAttr(el, kAXPositionAttribute as String), CFGetTypeID(p) == AXValueGetTypeID(),
          let s = axAttr(el, kAXSizeAttribute as String), CFGetTypeID(s) == AXValueGetTypeID() else { return nil }
    var pt = CGPoint.zero
    var sz = CGSize.zero
    guard AXValueGetValue(p as! AXValue, .cgPoint, &pt), AXValueGetValue(s as! AXValue, .cgSize, &sz) else { return nil }
    return CGRect(origin: pt, size: sz)
}

private func displayBounds() -> [CGRect] {
    var count: UInt32 = 0
    guard CGGetActiveDisplayList(0, nil, &count) == .success, count > 0 else { return [] }
    var ids = [CGDirectDisplayID](repeating: 0, count: Int(count))
    guard CGGetActiveDisplayList(count, &ids, &count) == .success else { return [] }
    return ids.prefix(Int(count)).map { CGDisplayBounds($0) }
}

private func onScreenWindows() -> [[String: Any]] {
    (CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]]) ?? []
}

private func windowBounds(_ w: [String: Any]) -> CGRect? {
    guard let d = w[kCGWindowBounds as String] as? NSDictionary else { return nil }
    return CGRect(dictionaryRepresentation: d as CFDictionary)
}

/// The app and window in front right now.
func frontNow() -> [String: Any]? {
    var pid: pid_t = 0
    var win: AXUIElement?
    if AXIsProcessTrusted(), let app = axElement(axAttr(AXUIElementCreateSystemWide(), kAXFocusedApplicationAttribute as String)) {
        AXUIElementGetPid(app, &pid)
        win = axElement(axAttr(app, kAXFocusedWindowAttribute as String))
    }
    let normal = onScreenWindows().filter { ($0[kCGWindowLayer as String] as? Int) == 0 }
    // Without Accessibility: the owner of the frontmost ordinary window.
    if pid == 0, let top = normal.first, let p = top[kCGWindowOwnerPID as String] as? Int { pid = pid_t(p) }
    if pid == 0 { return nil }
    let running = NSRunningApplication(processIdentifier: pid)
    var o: [String: Any] = ["pid": Int(pid), "app": running?.localizedName ?? "", "appId": running?.bundleIdentifier ?? ""]
    var title = ""
    var frame: CGRect?
    var full: Bool?
    if let w = win {
        title = (axAttr(w, kAXTitleAttribute as String) as? String) ?? ""
        frame = axFrame(w)
        if let f = axAttr(w, "AXFullScreen") as? Bool { full = f }
    }
    if frame == nil, let w = normal.first(where: { ($0[kCGWindowOwnerPID as String] as? Int) == Int(pid) }) {
        frame = windowBounds(w)
        if title.isEmpty { title = (w[kCGWindowName as String] as? String) ?? "" }
    }
    if full == nil {
        // A window exactly the size of a whole display is full screen.
        if let f = frame { full = displayBounds().contains { $0.equalTo(f) } } else { full = false }
    }
    o["title"] = title
    o["fullscreen"] = full ?? false
    if let f = frame, f.width > 0 {
        o["bounds"] = ["x": Double(f.origin.x), "y": Double(f.origin.y), "width": Double(f.size.width), "height": Double(f.size.height)]
    }
    return o
}

func frontWatch(id: Int, params: [String: Any]) async throws {
    let every = max(0.5, (params["interval"] as? Double) ?? 1.0)
    var last = ""
    while !Task.isCancelled {
        if let o = frontNow(),
           let data = try? JSONSerialization.data(withJSONObject: o, options: [.sortedKeys]),
           let s = String(data: data, encoding: .utf8), s != last {
            last = s
            Wire.shared.delta(id, s)
        }
        try await Task.sleep(nanoseconds: UInt64(every * 1_000_000_000))
    }
}

/// Screens with their notch, menu-bar status items and the end of the front app's menus.
func placeMeasure() -> [String: Any] {
    var screens: [[String: Any]] = []
    for s in NSScreen.screens {
        let f = s.frame
        let num = (s.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.intValue ?? 0
        var o: [String: Any] = ["id": num, "x": Double(f.origin.x), "width": Double(f.size.width), "notch": NSNull()]
        let top = s.safeAreaInsets.top
        if top > 0, let l = s.auxiliaryTopLeftArea, let r = s.auxiliaryTopRightArea, l.size.width > 0 {
            let x = l.origin.x + l.size.width
            o["notch"] = ["x": Double(x), "width": Double(r.origin.x - x), "height": Double(top)]
        }
        screens.append(o)
    }
    var items: [[String: Any]] = []
    for w in onScreenWindows() where (w[kCGWindowLayer as String] as? Int) == 25 {
        if let b = windowBounds(w) {
            items.append(["X": Double(b.origin.x), "Y": Double(b.origin.y), "Width": Double(b.size.width), "Height": Double(b.size.height)])
        }
    }
    var out: [String: Any] = ["screens": screens, "items": items]
    if AXIsProcessTrusted(), let app = axElement(axAttr(AXUIElementCreateSystemWide(), kAXFocusedApplicationAttribute as String)),
       let bar = axElement(axAttr(app, kAXMenuBarAttribute as String)),
       let kids = axAttr(bar, kAXChildrenAttribute as String) as? [AXUIElement], let last = kids.last, let f = axFrame(last) {
        out["menuRight"] = Double(f.origin.x + f.size.width)
    }
    return out
}

/// Which of the given bundle ids have a running app.
func appsRunning(_ params: [String: Any]) -> [String: Any] {
    let ids = (params["bundles"] as? [String]) ?? []
    return ["running": ids.filter { !NSRunningApplication.runningApplications(withBundleIdentifier: $0).isEmpty }]
}

// MARK: - camera in use

/// Is any camera in use by some app (the system's green light)? CoreMediaIO's
/// "running somewhere" flag on each video device; it does not say which app.
func cameraInUse() -> [String: Any] {
    var addr = CMIOObjectPropertyAddress(
        mSelector: CMIOObjectPropertySelector(kCMIOHardwarePropertyDevices),
        mScope: CMIOObjectPropertyScope(kCMIOObjectPropertyScopeGlobal),
        mElement: CMIOObjectPropertyElement(kCMIOObjectPropertyElementMain))
    var size: UInt32 = 0
    let system = CMIOObjectID(kCMIOObjectSystemObject)
    guard CMIOObjectGetPropertyDataSize(system, &addr, 0, nil, &size) == noErr, size > 0 else { return ["inUse": false, "devices": 0] }
    var ids = [CMIOObjectID](repeating: 0, count: Int(size) / MemoryLayout<CMIOObjectID>.size)
    var used: UInt32 = 0
    guard CMIOObjectGetPropertyData(system, &addr, 0, nil, size, &used, &ids) == noErr else { return ["inUse": false, "devices": 0] }
    var running = 0
    for dev in ids {
        var a = CMIOObjectPropertyAddress(
            mSelector: CMIOObjectPropertySelector(kCMIODevicePropertyDeviceIsRunningSomewhere),
            mScope: CMIOObjectPropertyScope(kCMIOObjectPropertyScopeWildcard),
            mElement: CMIOObjectPropertyElement(kCMIOObjectPropertyElementWildcard))
        var on: UInt32 = 0
        var got: UInt32 = 0
        if CMIOObjectGetPropertyData(dev, &a, 0, nil, UInt32(MemoryLayout<UInt32>.size), &got, &on) == noErr, on != 0 { running += 1 }
    }
    return ["inUse": running > 0, "devices": ids.count, "running": running]
}
