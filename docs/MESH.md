# Keeper Mesh

Keeper Mesh is a private IP network between your paired devices. Every app on them, not just Keeper, can reach the others by address (`100.94.105.130`, `fd47:c0e5:456d::…`) or by name (`laptop.keeper`).

- **Data plane:** WireGuard.
- **Control plane:** Keeper Link. There is no Keeper server.
- **Off by default:** Settings → Features → Connections → *Keeper Mesh*. It needs Keeper Link.

## Using it

- **The Mesh page:**
  - Turn it on and make a network (*Home*, *Work*; one device can be in several).
  - Invite paired devices as *My device* or *Someone else's* (a guest).
  - Each device shows its address, name, path, latency, last handshake and transfer.
  - Also: the exit node, shared subnets, access rules, names, the WireGuard settings (private key left out), and a troubleshooting panel (ping, path test, MTU probe).
- **Elsewhere on the system:** you choose where each control appears, under Settings → *Keeper Mesh: where its controls appear*, or on the Mesh page.

  | Control | Tray / menu bar | Island | Command palette |
  | --- | --- | --- | --- |
  | Mesh on and off | ✓ | — | ✓ |
  | Exit node | picker | "Internet through Laptop" while in use | "Send All Traffic Through Laptop", "Stop Using the Exit Node" |
  | Device addresses | *Copy Mesh Address* submenu | — | "Copy Laptop's Mesh Address", "Copy Laptop's Mesh Name" |

- **Network views:** Network Activity and the Firewall put a **mesh** label (with the device's name) on mesh addresses and on the mesh interface.
- **Command line:** `keeper mesh up | down | status | peers | ip [device] | ping <device> | path <device> | exit-node <device|off> | routes advertise <cidr,…> | rules [list | allow <from> <ports> [tcp|udp|any] | remove <id>] | config`.

## Design

```
 Keeper (as you)                                          helper (administrator)
 ───────────────                                          ─────────────────────
 engine.ts ── mesh.ctl over Link ──▶ other device         helper.ts  runs only plan-guard'ed steps:
   │  signed records, invites, punch                        ip / wg / wireguard-go / nft / pf /
   │                                                        resolvectl / sysctl / /etc/resolver
   ├─ datapath.ts: mesh UDP socket + one loopback shim per peer
   │     WireGuard ⇄ 127.0.0.1:<shim> ⇄ direct UDP (hole-punched) or Keeper Relay
   ├─ dns.ts: name server on this device's mesh address
   └─ os-plan.ts: the exact commands per OS ──▶ driver.ts ──▶ helper / UAC
```

### Addresses (`core/mesh/address.ts`)

- **IPv6:** each network gets a ULA /48 (`fd` + 40 bits of SHA-256 of the network id), so two people's networks practically never collide, and never collide with a router's own range. Each device's address is that /48, subnet 0, plus 64 bits of SHA-256(network id, device id). It is the same on every peer, with nobody handing addresses out.
- **IPv4 (optional, on by default):**
  - one /16 inside 100.64.0.0/10, starting at a place picked by the network id;
  - any /16 that overlaps a local route or address is skipped;
  - a device that finds the network's /16 already used locally (a carrier-grade-NAT address, say) stays IPv6-only in that network, and the page says so.
  - Host addresses come from a hash, stepping on deterministically if another member already has one.
- **IPv6-less kernels:** where the kernel has no IPv6 (some containers), the plan is IPv4-only.

### Keys and the key exchange (`core/mesh/keys.ts`)

- **The key pair:** one WireGuard key pair per device, made on first use and kept in the system keychain. Without a keychain it goes in a file only you can read, as Link does.
- **Mesh records:** a device sends each peer a *mesh record*: WireGuard public key, addresses, candidates, port, exit-node and subnet offers, a sequence number and a time.
  - It is **signed with the device's Link identity** (Ed25519) and addressed to that one peer.
  - The peer accepts it only if it verifies against the identity key it **pinned at pairing**, is for this network, is newer than the last one, and the addresses are the ones the device id gives.
  - So a WireGuard key nobody paired with never becomes a peer.
- **Path key:** the record also carries half of a *path key*, which authenticates hole-punching probes. It is secret and travels only inside the Link channel.

### Control plane: `mesh.ctl` over Link (`electron/services/mesh/engine.ts`)

One request per stream of kind `mesh.ctl`, JSON both ways, registered through Link's existing `registerStream` hook. Link itself is not changed.

| Request | Meaning |
| --- | --- |
| `invite` | "Join my network?" The person on that device answers in the window. |
| `joined` | The inviter introduces the new device to its other *own* devices that are paired with it. |
| `introduce` | Only accepted from your own devices. |
| `hello` | Swap signed records. Both sides then probe at once. |
| `punch` | Try direct paths again now. |
| `leave` | Leave the network, or decline an invitation. |

Guests reach only the devices they are paired with: a guest is never introduced onward.

### Paths, NAT traversal and the relay (`core/mesh/paths.ts`, `datapath.ts`, `packet-relay.ts`)

- **Candidates:** local addresses, plus the public address that STUN reports for the mesh socket itself, so it is the mapping peers must use. STUN uses Link's STUN setting.
- **Probing:**
  - Both sides send HMAC-authenticated probes to every candidate at the same time (simultaneous open), every 200 ms for 5 s.
  - The local network wins over the internet, then the faster path.
  - An authenticated probe from a new address moves the path at once (roaming).
- **Shims:** WireGuard always sees each peer at `127.0.0.1:<shim port>`. Keeper moves the packets underneath: direct UDP, or the relay. So no `wg set endpoint` is needed when the path changes. The cost is that packets pass through Keeper's process (see *Not built yet*).
- **Relay fallback:**
  - Packets are wrapped as `[16-byte device id][packet]` over one WebSocket to the Keeper Relay (`/v1/pkt`).
  - The relay passes a packet only between two devices that both listed each other.
  - It sees only WireGuard ciphertext: which ids exchange packets, when, and how much.
  - Direct paths are retried every minute while relayed.
- **The path shown:** *Direct (LAN)*, *Direct (internet)* or *Relayed*.
- **Keepalive:** 25 s only while a peer is in use (traffic in the last ~50 s); idle peers send nothing.
- **Endpoint refresh:** STUN again, and new records if anything changed. It goes through the governor (`poll('mesh.refresh')`): every minute while you are there, slower when you are away, paused while the screen is locked.

### Names (`core/mesh/dns.ts`)

- **The name server:** a small DNS server on this device's mesh address (port 53; 5053 where 53 is not allowed) answers `<device>.keeper` with A and AAAA records.
  - Other names under the ending get "no such name"; everything else is refused.
  - For a peer using this device as its exit node, it passes other questions on to this computer's DNS.
- **Split DNS:**
  - Linux: `resolvectl dns <if> …` and `resolvectl domain <if> ~keeper`.
  - macOS: `/etc/resolver/keeper`.
  - Windows: an NRPT rule (`Add-DnsClientNrptRule -Namespace .keeper`).
- **Other settings:** the ending can be changed. A hosts-file block (off by default) is there for apps that skip the system's resolver.

### Exit node and subnets

- **Offering an exit node** (asks first):
  - Linux: IP forwarding plus an nftables masquerade table `keeper_mesh_nat`.
  - macOS: `pf` NAT in the anchor `com.apple/250.KeeperMesh/nat`.
  - Windows: `New-NetNat` and forwarding on the tunnel adapter (IPv4).
- **Using one:**
  - **Linux/macOS:** the two halves of the address space (0/1, 128/1, ::/1, 8000::/1) go into the tunnel, so the old default route stays for the way back. Host routes keep Keeper's own encrypted packets (to the exit node and the relay) outside it.
  - **DNS through the exit node:** resolvectl `~.` on Linux, `networksetup` per network service on macOS.
  - **The kill switch:** nftables `keeper_mesh_kill` on Linux, pf `com.apple/251.KeeperMeshKill` on macOS. It allows only the tunnel, loopback, Keeper's bypass addresses, DHCP/ND, and optionally the LAN.
  - **Windows:** `AllowedIPs = 0.0.0.0/0, ::/0` and `DNS =` in the tunnel file. WireGuard for Windows then routes everything and blocks untunnelled traffic itself.
- **Sharing a subnet** (asks first, on the advertising device): only private ranges, and never one that is the mesh itself. Receivers choose per device *use 192.168.50.0/24*. A range that overlaps a network the receiver is on is refused.

### Access rules (`core/mesh/rules.ts`)

- **Who gets what:** your own devices reach everything. Guests reach nothing but ping and mesh names, until you allow ports (`22, 445, 8000-8100`, TCP/UDP/both).
- **Where they are enforced:** in the OS firewall on the receiving device, **scoped to the mesh interface**:
  - Linux: nftables table `keeper_mesh_acl`;
  - macOS: pf anchor `…/acl`;
  - Windows: Windows Firewall group *Keeper Mesh*, with explicit block rules for a guest's other ports, because Windows lets block rules win.
- **Why not the Keeper firewall:** its rules (electron/services/fw) are per-app outbound rules; it has no inbound or per-interface API, so the mesh keeps its own tables.

### Turning it off, crashes and the watchdog

- **Recorded before it runs:** everything put into the system is first written down (`applied` in `mesh.json`), then run. A crash in between still leaves a complete cleanup plan.
- **Cleanup order:** newest first. The kill switch and exit routes go first, so the internet works again; then DNS, the hosts block, routes, NAT, the firewall rules, and last the interfaces. Every step may fail harmlessly, so the plan can run twice.
- **When Keeper dies:**
  - The helper keeps the current cleanup plan on disk and watches Keeper's process. If Keeper dies (crash, kill, a power cut before the next start), the helper puts DNS, routes and the kill switch back. This is the same pattern as Keep Awake's closed-lid watchdog.
  - On Windows, an elevated watchdog started with the first tunnel removes Keeper's tunnels, NRPT rules, firewall group and NAT, by their fixed names.
- **Next start:** whatever a crash left behind is cleaned up before anything else.

## The privileged helper and what each system asks for

`electron/services/mesh/helper.ts` (bundled as `dist-electron/mesh-helper.cjs`) is the only part that runs as the administrator.

- **What it runs:** only steps that `core/mesh/plan-guard.ts` allows. That means Keeper's own interfaces (`km-xxxx`, `utunN`), its own nft tables and pf anchors, `/etc/resolver/<ending>` and `/etc/hosts`, the four forwarding switches, and host routes for its own packets. `sh`, other interfaces, other tables, `flush ruleset`, other files, other sysctls and `LD_PRELOAD`-style environment variables are refused (see `test/mesh.test.ts`).
- **Who can talk to it:** it listens on a Unix socket owned by you with mode 0600.
- **wireguard-go:** the helper copies it, after checking its SHA-256, into a root-owned directory, and runs that copy.
- **nftables:** the ruleset goes to `nft -f <private temp file>`, because some nft builds refuse `-f -` from a pipe ("Not a regular file: /dev/stdin"). This was found by the namespace test.

| System | WireGuard | Administrator prompt |
| --- | --- | --- |
| Linux | The kernel module with the system's `wg` tool. Without the module: wireguard-go. | **pkexec**, once per session, to start the helper (none when Keeper runs as root). |
| macOS | wireguard-go on a `utun` interface. | The administrator dialog **once**, to install the LaunchDaemon (`native/macos/mesh-helper.plist`, label `org.ashforde.keeper.meshd`). Keeper refuses unless its own runtime is owned by root (installed in /Applications by an administrator), so nothing writable by you is run as root. |
| Windows | WireGuard for Windows' tunnel service (WireGuardNT). | **UAC** for each change: install (first use), tunnel up/down, firewall, NRPT, NAT. The tunnel file is written to `%ProgramData%\Keeper\mesh` with SYSTEM/Administrators-only ACLs. |

**macOS Network Extension seam.** `MacDataPlane` in `driver.ts` names the two ways a utun can be made: wireguard-go through the helper (today), or a packet-tunnel Network Extension (`NETWORK_EXTENSION`, reports unavailable). The extension would need Apple's `com.apple.developer.networking.networkextension` entitlement and a Developer ID-signed, notarised build with a system extension. It would remove the helper and the password prompt on macOS.

## Binaries, checksums and licences

All downloads are pinned in `core/mesh/binaries.ts` and checked against SHA-256 before use, exactly as for cloudflared. A file that does not match is deleted and never run.

| What | Where from | SHA-256 |
| --- | --- | --- |
| WireGuard for Windows 1.1.1 MSI (x64 / arm64 / x86) | download.wireguard.com/windows-client/ | `7bfed60a…75242` / `8336335c…1bd4` / `e3ec714f…e8724` |
| wireguard-go 0.0.20250522 source snapshot | git.zx2c4.com | `c7eeffb1…695c9c` |
| WireGuardNT 1.1 (pinned for a later embedded variant, not used yet) | download.wireguard.com/wireguard-nt/ | `dceb30a9…8dace` |
| Wintun 0.14.1 (same) | wintun.net | `07c25618…4ef51` |

- **wireguard-go has no official binaries.** Keeper's release workflow is meant to build it from the pinned source snapshot and pin the results in `WIREGUARD_GO_BUILDS`. Until then no wireguard-go is downloaded. A root-owned system copy (a distribution or Homebrew package) is used if there is one; otherwise the page says WireGuard is missing and the mesh runs keys, addresses, names and paths only ("Keys and paths only").

### Licence notes (for THIRD-PARTY-NOTICES; also `MESH_NOTICES` in code)

- **wireguard-go:**
  - MIT, Copyright (C) 2017-2025 WireGuard LLC.
  - Redistribution is allowed with the copyright and permission notice; include the full MIT text with the binaries Keeper ships.
- **WireGuard for Windows:**
  - MIT (the app).
  - Keeper does **not** redistribute it. It is downloaded from the official server on your computer, hash-checked, and installed by Windows Installer.
- **WireGuardNT (wireguard.dll) and Wintun (wintun.dll):**
  - Covered by WireGuard LLC's *Prebuilt Binaries License*.
  - They may be redistributed only alongside software that uses them solely through their published headers (`wireguard.h` / `wintun.h`).
  - No reverse engineering or modification; notices must be kept; the WireGuard name may not be used to endorse.
  - Keeper does not ship them today (WireGuardNT comes with WireGuard for Windows). An embedded variant would have to follow these terms.
- **Trademark:** "WireGuard" and the "WireGuard" logo are registered trademarks of Jason A. Donenfeld. Keeper says it uses WireGuard, does not use the logo, and does not suggest endorsement.

## Threat model

- **Who can join:**
  - Only devices you paired with Keeper Link and then invited, and that said yes, become WireGuard peers.
  - A peer's WireGuard key is trusted only through a record signed by the identity pinned at pairing.
  - A record is bound to the network, to the recipient and to a sequence number: no forging, swapping or replaying (tests: `test/mesh.test.ts`, `test/mesh-net.test.ts`).
- **What the relay sees:** WireGuard ciphertext, device ids, timing and sizes. It cannot read or change traffic, and it cannot push packets at a device that did not list the sender.
- **Path probes:** they are HMAC'd with a key only the two devices have. Nobody else can move a path or fake a latency. WireGuard still authenticates every data packet; the shim forwards only from WireGuard's own port.
- **The helper:** a program running as you can talk to the helper, but only to make mesh-shaped changes. It can turn the mesh's own interfaces, tables and DNS entries on or off; it cannot run anything else as root. On macOS the helper and runtime must be root-owned.
- **Guests:** firewall rules on the mesh interface limit what they reach. They are never introduced to your other devices. Ping and mesh names stay open for troubleshooting.
- **The exit node:** it sees your traffic as your ISP would. The kill switch stops leaks if the tunnel goes down; the namespace test proves this on Linux.
- **Out of scope:** a compromised paired device; the OS firewall being disabled by someone else; denial of service by the relay or STUN server.

## What was verified, and how

- **Unit tests:** `test/mesh.test.ts` (27) and `test/mesh-net.test.ts` (18).
  - **Addresses:** derivation and conflict avoidance.
  - **Keys:** the WireGuard key format, including the RFC 7748 vector, and signed records: accept, forged, tampered, misdirected, replayed, out of range.
  - **WireGuard config:** setconf, UAPI and wg-quick output, and reading counters.
  - **Access rules.**
  - **Per-OS commands:** interface, routes, split DNS, hosts, exit serve/use, kill switch and firewall, for Linux, macOS and Windows; and the IPv4-only plans.
  - **The guard:** it allows every generated step and refuses 16 hostile ones.
  - **Cleanup plans.**
  - **Hole punching**, with fake sockets and simulated cone and symmetric NATs: LAN, simultaneous punch, one-sided failure, relay fallback with retry, roaming, keepalive only while active.
  - **The relay's packet path** over real WebSockets: mutual allow, blind passing, a bad proof refused.
  - **The DNS responder** over real UDP on localhost, including forwarding.
  - **STUN.**
  - **Two real Link nodes:** pairing, invitation, signed key exchange, matching configs, a LAN path, packets through the shims, through the relay, cleanup on off and after a crash.
- **On a real Linux kernel, in network namespaces:** `test/e2e/mesh-netns.cjs`, run as root, 30 of 30 checks pass.
  - **The setup:** two devices behind two separate NAT routers (nftables masquerade, with the usual "drop unsolicited WAN input"), plus an "internet" namespace with STUN and a web server.
  - **NAT traversal:** STUN through the NATs, and Keeper's own data path hole-punching through both NATs to *Direct (internet)*. A WireGuard-shaped packet then went WireGuard port → shim → punched path → the other WireGuard port, intact.
  - **Keeper's generated commands, run through the helper's own `runSteps` and guard against the real kernel:**
    - addresses and MTU on the mesh interface;
    - ping between mesh addresses both ways;
    - the DNS responder on a mesh address, and pinging the address a name resolved to;
    - nftables access rules: a guest reaches 8080 and is dropped on 22, while ping and names still work; an own device reaches everything;
    - the exit node: forwarding plus NAT on one device and split routes on the other. The web server saw the exit node's address;
    - the kill switch: the LAN blocked when "keep the local network" is off, and no leak when the tunnel went down;
    - cleanup: normal internet back, LAN back, no Keeper tables left, interface gone, forwarding restored, no split routes. It runs twice without harm.
  - **What stood in for WireGuard:** this kernel has no WireGuard module (`ip link add … type wireguard` → "Unknown device type"), and building or downloading wireguard-go was not allowed on this machine. So the mesh interface was a veth pair with the same name, with ARP off (point-to-point, like WireGuard's layer-3 link). The kernel also has no IPv6, so the IPv6 parts ran as IPv4-only plans. `ping` was a few lines of Python (no ping program here).
- **End to end:** `test/e2e/mesh.cjs`, two real Keeper apps under xvfb, 25 checks pass.
  - **Pairing and setup:** pairing over Link; the feature off by default; turned on; a network made; the invitation shown and joined through the laptop's window.
  - **Keys and configs:** the signed key exchange both ways; addresses and names on screen; the two generated configs match (each has the other's key, and AllowedIPs equal the other's own addresses); the private key not shown.
  - **Packets and names:** the path shown as *Relayed*; a WireGuard packet passed through the shim and a real Keeper Relay (built from `relay/`); `laptop.keeper` resolved by the name server.
  - **Placement:** the tray, the Island ("Internet through Laptop"), the palette ("Copy Laptop's Mesh Address"), the Settings placement grid moving controls out of the tray and the palette, and off removing it. Screenshots are light and dark.
  - **The network card:** this container has no WireGuard, so it was **not** brought up and no ping over WireGuard was done; the test reports this.
  - **A workaround in the test:** in this build the window did not pick up a feature switch made from outside the window until it reloaded (the main process's `settings-changed` broadcast did not arrive), so the test reloads the windows after switching the feature.

**Not verified here:**
- **The WireGuard data plane itself:** the kernel module, wireguard-go, WireGuard for Windows, and handshakes between real WireGuard interfaces.
- **The OS integrations:** split DNS through systemd-resolved, macOS `/etc/resolver`, Windows NRPT, pf, Windows Firewall rules, `New-NetNat`, `networksetup`.
- **Privilege paths:** the pkexec start, the macOS LaunchDaemon install, and Windows UAC.
- **Real networks:** IPv6 on the mesh interface (this kernel has none); real NATs on the internet (only Linux masquerade in namespaces).
- **Relay deployments:** the Cloudflare Worker relay does not carry the packet path (Node relay only).

## Not built yet

- **Direct handoff for speed:** when a path is direct and stable, giving WireGuard the endpoint directly (`wg set … endpoint`, with WireGuard's own listen port punched) would take Keeper's process out of the packet path.
- **The embedded WireGuardNT/Wintun variant on Windows:** the binaries are pinned, but the code is not there.
- **The macOS Network Extension variant.**
- **wireguard-go builds pinned in Keeper's release.**
- **The packet path on the Cloudflare Worker relay.**
- **Guests reaching your other devices:** they would need introductions countersigned by you.
