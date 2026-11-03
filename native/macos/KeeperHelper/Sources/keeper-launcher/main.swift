// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// keeper-launcher: the program inside "Keeper Mail.app", "Keeper Calendar.app"
// and "Keeper Notes.app" (core/launchers.ts, build/mac-launchers.cjs). It does
// one thing: asks Keeper to open its page in a window of its own
// (keeper://open/<page>, the page named by KeeperPage in its Info.plist), and
// quits. Keeper starts hidden if it was not running. The same program serves
// all three; only the bundle around it (name, icon, page) differs.

import AppKit
import Foundation

let keeperID = "io.github.ashfordeou.keeper"
let page = (Bundle.main.object(forInfoDictionaryKey: "KeeperPage") as? String ?? "")
  .lowercased().filter { $0.isLetter || $0 == "-" }
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

guard !page.isEmpty, let link = URL(string: "keeper://open/\(page)") else { fail("This copy is damaged. Add it again from Keeper's Settings → Features.") }
guard let keeper = keeperApp() else { fail("Install Keeper from keeper.ashforde.org, then open \(name) again.") }

let cfg = NSWorkspace.OpenConfiguration()
cfg.activates = true
NSWorkspace.shared.open([link], withApplicationAt: keeper, configuration: cfg) { _, error in
  if let error = error {
    DispatchQueue.main.async { fail("Keeper could not be opened: \(error.localizedDescription)") }
    return
  }
  exit(0)
}
// Waits for macOS to hand the link over (a few hundred milliseconds), then quits.
DispatchQueue.main.asyncAfter(deadline: .now() + 30) { exit(0) }
RunLoop.main.run()
