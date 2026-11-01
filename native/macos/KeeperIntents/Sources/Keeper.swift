// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// How the helper reaches Keeper: keeper:// links for things that open or
// start something, and the keeper command (run by Keeper's own executable as
// Node) for things that return an answer.

import AppKit
import Foundation

enum Keeper {
    /// Keeper.app, three folders up from Keeper.app/Contents/Library/Helpers/Keeper Intents.app.
    static var appURL: URL {
        Bundle.main.bundleURL
            .deletingLastPathComponent() // Helpers
            .deletingLastPathComponent() // Library
            .deletingLastPathComponent() // Contents
            .deletingLastPathComponent() // Keeper.app
    }

    static var executable: URL { appURL.appendingPathComponent("Contents/MacOS/Keeper") }
    static var cliScript: URL { appURL.appendingPathComponent("Contents/Resources/app.asar/dist-cli/keeper.cjs") }

    enum Failure: Error, CustomLocalizedStringResourceConvertible {
        case notInstalled
        case failed(String)
        var localizedStringResource: LocalizedStringResource {
            switch self {
            case .notInstalled: return "Keeper could not be found. Reinstall Keeper."
            case .failed(let m): return "\(m)"
            }
        }
    }

    /// Opens a keeper:// link (Keeper starts if it is not running).
    static func open(_ action: String, _ query: [String: String] = [:]) throws {
        var c = URLComponents()
        c.scheme = "keeper"
        c.host = action
        if !query.isEmpty { c.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) } }
        guard let url = c.url else { throw Failure.failed("Bad link") }
        NSWorkspace.shared.open(url)
    }

    /// Runs `keeper <args>` and returns what it printed.
    static func cli(_ args: [String], timeout: TimeInterval = 180) async throws -> String {
        guard FileManager.default.isExecutableFile(atPath: executable.path) else { throw Failure.notInstalled }
        return try await withCheckedThrowingContinuation { cont in
            let p = Process()
            p.executableURL = executable
            p.arguments = [cliScript.path] + args
            var env = ProcessInfo.processInfo.environment
            env["ELECTRON_RUN_AS_NODE"] = "1"
            p.environment = env
            let out = Pipe()
            let err = Pipe()
            p.standardOutput = out
            p.standardError = err
            let timer = DispatchWorkItem { if p.isRunning { p.terminate() } }
            p.terminationHandler = { proc in
                timer.cancel()
                let text = String(data: out.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
                if proc.terminationStatus == 0 {
                    cont.resume(returning: text.trimmingCharacters(in: .whitespacesAndNewlines))
                } else {
                    let e = String(data: err.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
                    cont.resume(throwing: Failure.failed(e.isEmpty ? "Keeper did not answer" : e.trimmingCharacters(in: .whitespacesAndNewlines)))
                }
            }
            do {
                try p.run()
                DispatchQueue.global().asyncAfter(deadline: .now() + timeout, execute: timer)
            } catch {
                cont.resume(throwing: Failure.failed(error.localizedDescription))
            }
        }
    }
}
