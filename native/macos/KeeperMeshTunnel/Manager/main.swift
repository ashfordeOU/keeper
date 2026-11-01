// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// keeper-mesh-ne: the app side of Keeper Mesh's Network Extension variant.
// Keeper's main process (electron/services/mesh/netext.ts) runs it with one
// JSON request on standard input and reads one JSON line back:
//
//   {"cmd":"activate"}                                   install / approve the system extension
//   {"cmd":"up","name":"Home","wgQuickConfig":"…"}       save the VPN configuration and start the tunnel
//   {"cmd":"sync","wgQuickConfig":"…"}                    replace peers and settings in the running tunnel
//   {"cmd":"endpoint","publicKey":"…","endpoint":"…"}     move one peer (the direct handoff)
//   {"cmd":"stats"}                                      WireGuard's counters (UAPI "get" text)
//   {"cmd":"down"} / {"cmd":"status"}
//
// It lives in Keeper.app/Contents/MacOS, so Bundle.main is Keeper.app and the
// system extension request finds Contents/Library/SystemExtensions.
//
// NEEDS A DEVELOPER ID WITH THE NETWORK EXTENSION ENTITLEMENT (see
// Manager.entitlements). Written without a Swift toolchain: NOT compiled yet.

import Foundation
import NetworkExtension
import SystemExtensions

let extensionId = "org.ashforde.keeper.mesh-tunnel"

func say(_ o: [String: Any]) -> Never {
    let data = (try? JSONSerialization.data(withJSONObject: o)) ?? Data("{\"ok\":false}".utf8)
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
    exit(o["ok"] as? Bool == true ? 0 : 1)
}

func fail(_ message: String, _ extra: [String: Any] = [:]) -> Never {
    var o = extra
    o["ok"] = false
    o["message"] = message
    say(o)
}

final class ActivationDelegate: NSObject, OSSystemExtensionRequestDelegate {
    func request(_ request: OSSystemExtensionRequest, actionForReplacingExtension existing: OSSystemExtensionProperties, withExtension ext: OSSystemExtensionProperties) -> OSSystemExtensionRequest.ReplacementAction {
        .replace
    }
    func requestNeedsUserApproval(_ request: OSSystemExtensionRequest) {
        say(["ok": false, "needsApproval": true, "message": "Allow Keeper’s network extension in System Settings → General → Login Items & Extensions → Network Extensions, then turn the mesh on again."])
    }
    func request(_ request: OSSystemExtensionRequest, didFinishWithResult result: OSSystemExtensionRequest.Result) {
        say(["ok": true, "status": result == .willCompleteAfterReboot ? "after-restart" : "active"])
    }
    func request(_ request: OSSystemExtensionRequest, didFailWithError error: Error) {
        fail("The network extension could not be installed: \(error.localizedDescription)")
    }
}

func manager() async throws -> NETunnelProviderManager {
    let all = try await NETunnelProviderManager.loadAllFromPreferences()
    if let m = all.first(where: { ($0.protocolConfiguration as? NETunnelProviderProtocol)?.providerBundleIdentifier == extensionId }) { return m }
    return NETunnelProviderManager()
}

func message(_ m: NETunnelProviderManager, _ body: [String: Any]) async throws -> [String: Any] {
    guard let session = m.connection as? NETunnelProviderSession, m.connection.status == .connected else {
        throw NSError(domain: "keeper", code: 1, userInfo: [NSLocalizedDescriptionKey: "The mesh tunnel is not running"])
    }
    let data = try JSONSerialization.data(withJSONObject: body)
    return try await withCheckedThrowingContinuation { cont in
        do {
            try session.sendProviderMessage(data) { reply in
                let o = reply.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? ["ok": false, "message": "no answer"]
                cont.resume(returning: o)
            }
        } catch {
            cont.resume(throwing: error)
        }
    }
}

func waitFor(_ m: NETunnelProviderManager, _ want: NEVPNStatus, seconds: Double) async -> Bool {
    let end = Date().addingTimeInterval(seconds)
    while Date() < end {
        if m.connection.status == want { return true }
        try? await Task.sleep(nanoseconds: 200_000_000)
    }
    return m.connection.status == want
}

func statusName(_ s: NEVPNStatus) -> String {
    switch s {
    case .connected: return "connected"
    case .connecting: return "connecting"
    case .disconnecting: return "disconnecting"
    case .disconnected: return "disconnected"
    case .reasserting: return "reasserting"
    case .invalid: return "invalid"
    @unknown default: return "unknown"
    }
}

let input = FileHandle.standardInput.readDataToEndOfFile()
guard let req = (try? JSONSerialization.jsonObject(with: input)) as? [String: Any], let cmd = req["cmd"] as? String else { fail("bad request") }

let delegate = ActivationDelegate()
if cmd == "activate" {
    let r = OSSystemExtensionRequest.activationRequest(forExtensionWithIdentifier: extensionId, queue: .main)
    r.delegate = delegate
    OSSystemExtensionManager.shared.submitRequest(r)
    DispatchQueue.main.asyncAfter(deadline: .now() + 120) { fail("No answer about the network extension in time") }
    dispatchMain()
}

Task {
    do {
        let m = try await manager()
        switch cmd {
        case "up":
            guard let conf = req["wgQuickConfig"] as? String else { fail("no configuration") }
            let proto = NETunnelProviderProtocol()
            proto.providerBundleIdentifier = extensionId
            proto.serverAddress = "Keeper Mesh"
            proto.providerConfiguration = ["wgQuickConfig": conf, "name": req["name"] as? String ?? "Keeper Mesh"]
            m.protocolConfiguration = proto
            m.localizedDescription = "Keeper Mesh"
            m.isEnabled = true
            try await m.saveToPreferences()
            try await m.loadFromPreferences()
            try m.connection.startVPNTunnel()
            say(await waitFor(m, .connected, seconds: 20) ? ["ok": true, "status": "connected"] : ["ok": false, "status": statusName(m.connection.status), "message": "The mesh tunnel did not start"])
        case "sync":
            guard let conf = req["wgQuickConfig"] as? String else { fail("no configuration") }
            if let proto = m.protocolConfiguration as? NETunnelProviderProtocol {
                proto.providerConfiguration?["wgQuickConfig"] = conf
                try await m.saveToPreferences()
            }
            say(try await message(m, ["op": "update", "wgQuickConfig": conf]))
        case "endpoint":
            say(try await message(m, ["op": "endpoint", "publicKey": req["publicKey"] ?? "", "endpoint": req["endpoint"] ?? ""]))
        case "stats":
            say(try await message(m, ["op": "config"]))
        case "down":
            m.connection.stopVPNTunnel()
            say(["ok": await waitFor(m, .disconnected, seconds: 10), "status": statusName(m.connection.status)])
        case "status":
            say(["ok": true, "status": statusName(m.connection.status), "installed": m.protocolConfiguration != nil])
        default:
            fail("unknown command \(cmd)")
        }
    } catch {
        fail(error.localizedDescription)
    }
}
dispatchMain()
