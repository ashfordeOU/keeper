// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The helper has no window and no Dock icon. Keeper starts it once with
// --register so macOS reads its phrases; the system starts it again whenever
// Siri, Spotlight or Shortcuts runs one of Keeper's actions.

import AppIntents
import AppKit

@main
enum KeeperIntentsApp {
    static func main() {
        let app = NSApplication.shared
        app.setActivationPolicy(.prohibited)
        KeeperShortcuts.updateAppShortcutParameters()
        // Started only to register: leave soon. Started for an action: stay long enough to finish it.
        let registerOnly = CommandLine.arguments.contains("--register")
        DispatchQueue.main.asyncAfter(deadline: .now() + (registerOnly ? 5 : 300)) { NSApp.terminate(nil) }
        app.run()
    }
}
