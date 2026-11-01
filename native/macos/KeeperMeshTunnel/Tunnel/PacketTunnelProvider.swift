// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper Mesh on macOS without the helper or a password prompt: a packet
// tunnel provider (NEPacketTunnelProvider), packaged as a system extension,
// running WireGuard inside itself through WireGuardKit (wireguard-apple, MIT;
// it embeds wireguard-go, MIT). Keeper sends it a wg-quick style
// configuration (the same text core/mesh/wgconfig.ts quickConf makes) and
// small JSON messages: read the counters, replace the configuration, or move
// one peer's endpoint (the direct handoff, core/mesh/handoff.ts).
//
// NEEDS A DEVELOPER ID WITH THE NETWORK EXTENSION ENTITLEMENT. It only runs
// when Keeper is signed with a Developer ID whose provisioning profile carries
// com.apple.developer.networking.networkextension = packet-tunnel-provider-
// systemextension (granted by Apple), is notarised, and the person approved
// the extension in System Settings. It cannot be signed in Keeper's CI, and
// it was written without a Swift toolchain: it has NOT been compiled yet.

import Foundation
import NetworkExtension
import os.log
import WireGuardKit

enum TunnelError: LocalizedError {
    case noConfiguration
    case badConfiguration(String)
    case adapter(String)

    var errorDescription: String? {
        switch self {
        case .noConfiguration: return "Keeper did not pass a mesh configuration."
        case .badConfiguration(let why): return "The mesh configuration could not be read: \(why)"
        case .adapter(let why): return "WireGuard could not start: \(why)"
        }
    }
}

/// Reads the wg-quick text Keeper writes: [Interface] PrivateKey, Address, ListenPort, DNS, MTU;
/// [Peer] PublicKey, AllowedIPs, Endpoint, PersistentKeepalive. Anything else is refused.
enum MeshConfig {
    static func parse(_ text: String, name: String?) throws -> TunnelConfiguration {
        var iface: InterfaceConfiguration?
        var peers: [PeerConfiguration] = []
        var section = ""
        var peer: PeerConfiguration?
        func endPeer() { if let p = peer { peers.append(p) }; peer = nil }
        for raw in text.split(whereSeparator: \.isNewline) {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.isEmpty || line.hasPrefix("#") { continue }
            if line == "[Interface]" { endPeer(); section = "interface"; continue }
            if line == "[Peer]" { endPeer(); section = "peer"; continue }
            guard let eq = line.firstIndex(of: "=") else { throw TunnelError.badConfiguration("“\(line)”") }
            let key = line[..<eq].trimmingCharacters(in: .whitespaces).lowercased()
            let value = line[line.index(after: eq)...].trimmingCharacters(in: .whitespaces)
            let list = value.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
            if section == "interface" {
                if key == "privatekey" {
                    guard let k = PrivateKey(base64Key: value) else { throw TunnelError.badConfiguration("private key") }
                    iface = InterfaceConfiguration(privateKey: k)
                    continue
                }
                guard iface != nil else { throw TunnelError.badConfiguration("PrivateKey must come first") }
                switch key {
                case "address": iface!.addresses = try list.map { try range($0) }
                case "listenport": iface!.listenPort = UInt16(value)
                case "mtu": iface!.mtu = UInt16(value)
                case "dns": iface!.dns = list.compactMap { DNSServer(from: $0) }
                case "table": continue // routes come from AllowedIPs inside the extension
                default: throw TunnelError.badConfiguration("unknown setting \(key)")
                }
            } else if section == "peer" {
                if key == "publickey" {
                    endPeer()
                    guard let k = PublicKey(base64Key: value) else { throw TunnelError.badConfiguration("public key") }
                    peer = PeerConfiguration(publicKey: k)
                    continue
                }
                guard peer != nil else { throw TunnelError.badConfiguration("PublicKey must come first") }
                switch key {
                case "allowedips": peer!.allowedIPs = try list.map { try range($0) }
                case "endpoint":
                    guard let e = Endpoint(from: value) else { throw TunnelError.badConfiguration("endpoint \(value)") }
                    peer!.endpoint = e
                case "persistentkeepalive": peer!.persistentKeepAlive = UInt16(value).flatMap { $0 == 0 ? nil : $0 }
                default: throw TunnelError.badConfiguration("unknown setting \(key)")
                }
            }
        }
        endPeer()
        guard let i = iface else { throw TunnelError.badConfiguration("no [Interface]") }
        return TunnelConfiguration(name: name, interface: i, peers: peers)
    }

    private static func range(_ s: String) throws -> IPAddressRange {
        guard let r = IPAddressRange(from: s) else { throw TunnelError.badConfiguration("address \(s)") }
        return r
    }
}

final class PacketTunnelProvider: NEPacketTunnelProvider {
    private let log = OSLog(subsystem: "org.ashforde.keeper.mesh-tunnel", category: "tunnel")
    private var current: TunnelConfiguration?

    private lazy var adapter: WireGuardAdapter = {
        WireGuardAdapter(with: self) { [weak self] level, message in
            guard let self = self else { return }
            os_log("%{public}@", log: self.log, type: level == .error ? .error : .debug, message)
        }
    }()

    override func startTunnel(options: [String: NSObject]?, completionHandler: @escaping (Error?) -> Void) {
        guard let proto = protocolConfiguration as? NETunnelProviderProtocol,
              let text = proto.providerConfiguration?["wgQuickConfig"] as? String else {
            completionHandler(TunnelError.noConfiguration)
            return
        }
        do {
            let config = try MeshConfig.parse(text, name: proto.providerConfiguration?["name"] as? String)
            current = config
            adapter.start(tunnelConfiguration: config) { error in
                completionHandler(error.map { TunnelError.adapter("\($0)") })
            }
        } catch {
            completionHandler(error)
        }
    }

    override func stopTunnel(with reason: NEProviderStopReason, completionHandler: @escaping () -> Void) {
        adapter.stop { _ in completionHandler() }
    }

    private func reply(_ ok: Bool, _ extra: [String: Any] = [:]) -> Data? {
        var o = extra
        o["ok"] = ok
        return try? JSONSerialization.data(withJSONObject: o)
    }

    /// From Keeper, through the manager tool: {"op": "config" | "update" | "endpoint", …}
    override func handleAppMessage(_ messageData: Data, completionHandler: ((Data?) -> Void)?) {
        guard let msg = (try? JSONSerialization.jsonObject(with: messageData)) as? [String: Any],
              let op = msg["op"] as? String else {
            completionHandler?(reply(false, ["message": "bad message"]))
            return
        }
        switch op {
        case "config":
            // WireGuard's own counters as UAPI "get" text, read by Keeper like wireguard-go's
            adapter.getRuntimeConfiguration { text in completionHandler?(self.reply(text != nil, ["uapi": text ?? ""])) }
        case "update":
            guard let text = msg["wgQuickConfig"] as? String, let config = try? MeshConfig.parse(text, name: current?.name) else {
                completionHandler?(reply(false, ["message": "bad configuration"]))
                return
            }
            current = config
            adapter.update(tunnelConfiguration: config) { error in completionHandler?(self.reply(error == nil, ["message": error.map { "\($0)" } ?? ""])) }
        case "endpoint":
            // the direct handoff: move one peer (WireGuard keeps its session)
            guard let cfg = current, let key = msg["publicKey"] as? String, let ep = (msg["endpoint"] as? String).flatMap({ Endpoint(from: $0) }),
                  let pub = PublicKey(base64Key: key), cfg.peers.contains(where: { $0.publicKey.rawValue == pub.rawValue }) else {
                completionHandler?(reply(false, ["message": "unknown peer or endpoint"]))
                return
            }
            let peers = cfg.peers.map { p -> PeerConfiguration in
                guard p.publicKey.rawValue == pub.rawValue else { return p }
                var q = p
                q.endpoint = ep
                return q
            }
            let next = TunnelConfiguration(name: cfg.name, interface: cfg.interface, peers: peers)
            current = next
            adapter.update(tunnelConfiguration: next) { error in completionHandler?(self.reply(error == nil, ["message": error.map { "\($0)" } ?? ""])) }
        default:
            completionHandler?(reply(false, ["message": "unknown request \(op)"]))
        }
    }
}
