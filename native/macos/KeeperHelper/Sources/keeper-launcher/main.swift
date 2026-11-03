// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// keeper-launcher: the program inside "Keeper Mail.app", "Keeper Notes.app",
// "Keeper Files.app" and the other app icons (core/launchers.ts,
// build/mac-launchers.cjs). It does one thing and quits:
//
//   • Keeper is running (Keeper itself, or a light app): it asks it to open its
//     page in a window of its own (keeper://open/<page>, KeeperPage in Info.plist).
//   • Keeper is not running: it starts Keeper as a light app that runs only this
//     part (--keeper-solo=<app>, KeeperApp in Info.plist; core/solo.ts). The light
//     app shows this app's icon in the Dock.
//
// The same program serves all of them; only the bundle around it (name, icon,
// app, page) differs.

import AppKit
import Foundation

let keeperID = "io.github.ashfordeou.keeper"
let clean: (String) -> String = { $0.lowercased().filter { $0.isLetter || $0 == "-" } }
let page = clean(Bundle.main.object(forInfoDictionaryKey: "KeeperPage") as? String ?? "")
let soloApp = clean(Bundle.main.object(forInfoDictionaryKey: "KeeperApp") as? String ?? page)
let name = Bundle.main.object(forInfoDictionaryKey: "CFBundleName") as? String ?? "This app"

/// Keeper.app: the one this launcher ships inside (Contents/Library/Launchers), or the one macOS knows.
func keeperApp() -> URL? {
  var u = Bundle.main.bundleURL
  for _ in 0..<4 { u.deleteLastPathComponent() }
  if let b = Bundle(url: u), b.bundleIdentifier == keeperID { return u }
  return NSWorkspace.shared.urlForApplication(withBundleIdentifier: keeperID)
}

func fail(_ text: String) -> Never {
  let app = NSApplication.shared
  app.setActivationPolicy(.accessory)
  app.activate(ignoringOtherApps: true)
  let alert = NSAlert()
  alert.messageText = "\(name) needs Keeper"
  alert.informativeText = text
  alert.addButton(withTitle: "OK")
  alert.runModal()
  exit(1)
}

guard !page.isEmpty, !soloApp.isEmpty, let link = URL(string: "keeper://open/\(page)") else { fail("This copy is damaged. Add it again from Keeper's Settings → Features.") }
guard let keeper = keeperApp() else { fail("Install Keeper from keeper.ashforde.org, then open \(name) again.") }

let done: (Error?) -> Void = { error in
  if let error = error {
    DispatchQueue.main.async { fail("Keeper could not be opened: \(error.localizedDescription)") }
    return
  }
  exit(0)
}

let cfg = NSWorkspace.OpenConfiguration()
cfg.activates = true
if NSRunningApplication.runningApplications(withBundleIdentifier: keeperID).isEmpty {
  // Not running: start it as a light app with only this part. Keeper decides what runs (light
  // apps switched off in Settings start all of Keeper, showing only this page's window).
  cfg.arguments = ["--keeper-solo=\(soloApp)"]
  NSWorkspace.shared.openApplication(at: keeper, configuration: cfg) { _, error in done(error) }
} else {
  NSWorkspace.shared.open([link], withApplicationAt: keeper, configuration: cfg) { _, error in done(error) }
}
// Waits for macOS to start Keeper or hand the link over (a few hundred milliseconds), then quits.
DispatchQueue.main.asyncAfter(deadline: .now() + 30) { exit(0) }
RunLoop.main.run()
