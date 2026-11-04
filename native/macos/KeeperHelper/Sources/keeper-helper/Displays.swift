// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Displays → screen modes on macOS: the connected screens, all through public
// APIs (CoreGraphics for the list, AppKit for each screen's own name). Their
// modes come from stage.modes and a change from stage.setMode (Stage.swift).
//
//   displays.list   [{ id, name, main, builtIn }]

@preconcurrency import Foundation
import AppKit
import CoreGraphics

func displaysList() async -> [String: Any] {
    var count: UInt32 = 0
    guard CGGetActiveDisplayList(0, nil, &count) == .success, count > 0 else { return ["displays": []] }
    var ids = [CGDirectDisplayID](repeating: 0, count: Int(count))
    guard CGGetActiveDisplayList(count, &ids, &count) == .success else { return ["displays": []] }
    // Screen names ("Studio Display", "Built-in Retina Display") come from AppKit, on the main thread.
    let names: [CGDirectDisplayID: String] = await MainActor.run {
        var out: [CGDirectDisplayID: String] = [:]
        for s in NSScreen.screens {
            if let n = s.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber {
                out[CGDirectDisplayID(n.uint32Value)] = s.localizedName
            }
        }
        return out
    }
    let list: [[String: Any]] = ids.prefix(Int(count)).map { d in
        let builtIn = CGDisplayIsBuiltin(d) != 0
        return [
            "id": Int(d),
            "name": names[d] ?? (builtIn ? "Built-in screen" : "Screen \(d)"),
            "main": CGDisplayIsMain(d) != 0,
            "builtIn": builtIn,
        ]
    }
    return ["displays": list]
}
