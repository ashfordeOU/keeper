// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The desktop for Keeper's wallpaper and folder icons, with public AppKit only:
//   desktop.setImage       NSWorkspace.setDesktopImageURL on every screen (or one, by index)
//   desktop.getImage       the main screen's desktop picture, to restore later
//   desktop.setFolderIcon  NSWorkspace.setIcon(_:forFile:); image null removes it (the original comes back)
// The main thread reads requests, so these run on the task's thread; NSWorkspace
// is documented as safe to use from any thread.

import Foundation
import AppKit

private func desktopFail(_ code: Int, _ message: String) -> NSError {
    NSError(domain: "keeper", code: code, userInfo: [NSLocalizedDescriptionKey: message])
}

func desktopSetImage(_ p: [String: Any]) throws -> [String: Any] {
    guard let path = p["path"] as? String, FileManager.default.fileExists(atPath: path) else { throw desktopFail(40, "No picture") }
    let url = URL(fileURLWithPath: path)
    let screens = NSScreen.screens
    var targets = screens
    if let i = p["screen"] as? Int, i >= 0, i < screens.count { targets = [screens[i]] }
    // Fill the screen, like the system's own "Fill Screen" choice.
    let options: [NSWorkspace.DesktopImageOptionKey: Any] = [.imageScaling: NSImageScaling.scaleProportionallyUpOrDown.rawValue, .allowClipping: true]
    var set = 0
    for s in targets {
        try NSWorkspace.shared.setDesktopImageURL(url, for: s, options: options)
        set += 1
    }
    return ["ok": true, "screens": set]
}

func desktopGetImage() -> [String: Any] {
    guard let s = NSScreen.main ?? NSScreen.screens.first, let url = NSWorkspace.shared.desktopImageURL(for: s) else { return ["path": NSNull()] }
    return ["path": url.path]
}

func desktopSetFolderIcon(_ p: [String: Any]) throws -> [String: Any] {
    guard let folder = p["path"] as? String else { throw desktopFail(41, "No folder") }
    var isDir: ObjCBool = false
    guard FileManager.default.fileExists(atPath: folder, isDirectory: &isDir), isDir.boolValue else { throw desktopFail(42, "Not a folder") }
    var image: NSImage? = nil
    if let imagePath = p["image"] as? String {
        guard let img = NSImage(contentsOfFile: imagePath) else { throw desktopFail(43, "The icon picture could not be read") }
        image = img
    }
    guard NSWorkspace.shared.setIcon(image, forFile: folder, options: []) else {
        throw desktopFail(44, "macOS did not allow a new icon for this folder (it may be read-only or protected)")
    }
    return ["ok": true]
}
