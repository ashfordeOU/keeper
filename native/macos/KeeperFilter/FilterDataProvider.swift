// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper's network filter for macOS: a Network Extension content filter
// (NEFilterDataProvider) packaged as a system extension. It sees every new
// flow, decides it from the rules Keeper writes to the shared container, and
// pauses unknown flows while Keeper asks the person (allow/deny), the way a
// per-app firewall must on macOS.
//
// It only runs when the app is signed with a Developer ID whose provisioning
// profile carries com.apple.developer.networking.networkextension =
// content-filter-provider-systemextension (granted by Apple), and after the
// person approves the extension in System Settings. See docs/FIREWALL.md.
// Not compiled in Keeper's CI: it needs that profile to build for distribution.

import Foundation
import NetworkExtension
import os.log

/// Rules exported by Keeper (core/fw/rules.ts → JSON) into the app group container.
struct Rule: Decodable {
    struct App: Decodable { let path: String?; let signer: String?; let group: String? }
    let id: String
    let app: App?          // nil = any app
    let direction: String  // out | in | both
    let host: String?
    let ip: String?
    let port: String?
    let proto: String?
    let verdict: String    // allow | deny
    let priority: String?
    let enabled: Bool
    let until: Double?
}

struct RuleFile: Decodable { let rules: [Rule]; let mode: String }

final class FilterDataProvider: NEFilterDataProvider {
    private let log = OSLog(subsystem: "org.ashforde.keeper.filter", category: "filter")
    private var rules: [Rule] = []
    private var mode = "alert"
    private let groupId = "group.org.ashforde.keeper"

    override func startFilter(completionHandler: @escaping (Error?) -> Void) {
        reload()
        // Look at every outbound and inbound TCP/UDP flow.
        let all = NENetworkRule(remoteNetwork: nil, remotePrefix: 0, localNetwork: nil, localPrefix: 0, protocol: .any, direction: .any)
        let settings = NEFilterSettings(rules: [NEFilterRule(networkRule: all, action: .filterData)], defaultAction: .allow)
        apply(settings) { error in
            if let error = error { os_log("apply failed: %{public}@", log: self.log, type: .error, error.localizedDescription) }
            completionHandler(error)
        }
    }

    override func stopFilter(with reason: NEProviderStopReason, completionHandler: @escaping () -> Void) {
        completionHandler()
    }

    private func reload() {
        guard let dir = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: groupId) else { return }
        let url = dir.appendingPathComponent("fw-rules.json")
        if let data = try? Data(contentsOf: url), let file = try? JSONDecoder().decode(RuleFile.self, from: data) {
            rules = file.rules.filter { $0.enabled }
            mode = file.mode
        }
    }

    override func handleNewFlow(_ flow: NEFilterFlow) -> NEFilterNewFlowVerdict {
        guard let socket = flow as? NEFilterSocketFlow,
              let remote = socket.remoteEndpoint as? NWHostEndpoint else { return .allow() }
        let path = flow.sourceAppAuditToken.flatMap(Self.path(for:)) ?? ""
        let host = socket.remoteHostname ?? remote.hostname
        let port = Int(remote.port) ?? 0
        let outbound = socket.direction == .outbound
        switch decide(path: path, host: host, ip: remote.hostname, port: port, outbound: outbound) {
        case "allow": return .allow()
        case "deny": return .drop()
        default:
            // Unknown: hold the flow while Keeper asks (it answers through the shared container), or follow quiet mode.
            if mode == "silent-allow" { return .allow() }
            if mode == "silent-deny" { return .drop() }
            return .pause()
        }
    }

    /// Same order as core/fw/rules.ts: the most specific matching rule wins; deny wins a tie.
    private func decide(path: String, host: String, ip: String, port: Int, outbound: Bool) -> String {
        var best: (Rule, [Int])?
        let now = Date().timeIntervalSince1970 * 1000
        for r in rules {
            if let until = r.until, until <= now { continue }
            if r.direction != "both" && (r.direction == "out") != outbound { continue }
            if let a = r.app, a.group == nil, let p = a.path, p.lowercased() != path.lowercased() { continue }
            if let h = r.host, h != "any" {
                let pattern = h.hasPrefix("=") ? String(h.dropFirst()) : h
                let ok = h.hasPrefix("=") ? host == pattern : (host == pattern || host.hasSuffix("." + pattern))
                if !ok { continue }
            }
            if let ipRule = r.ip, !ipRule.contains("/"), ipRule != ip { continue }
            if let ps = r.port, let range = Self.ports(ps), !(range.contains(port)) { continue }
            let spec = [r.priority == "high" ? 1 : 0, r.app == nil ? 0 : (r.app?.group != nil ? 1 : 2), r.host != nil ? 2 : (r.ip != nil ? 1 : 0), r.port != nil ? 1 : 0]
            if let b = best {
                if spec.lexicographicallyPrecedes(b.1) { continue }
                if spec == b.1 && !(r.verdict == "deny" && b.0.verdict == "allow") { continue }
            }
            best = (r, spec)
        }
        return best?.0.verdict ?? "ask"
    }

    private static func ports(_ s: String) -> ClosedRange<Int>? {
        let parts = s.split(separator: "-").compactMap { Int($0) }
        if parts.count == 1 { return parts[0]...parts[0] }
        if parts.count == 2, parts[0] <= parts[1] { return parts[0]...parts[1] }
        return nil
    }

    private static func path(for token: Data) -> String? {
        // The audit token identifies the process; its executable path is enough to match path rules.
        var t = audit_token_t()
        guard token.count == MemoryLayout<audit_token_t>.size else { return nil }
        _ = withUnsafeMutableBytes(of: &t) { token.copyBytes(to: $0) }
        let pid = audit_token_to_pid(t)
        var buf = [CChar](repeating: 0, count: 4096)
        return proc_pidpath(pid, &buf, UInt32(buf.count)) > 0 ? String(cString: buf) : nil
    }
}
