# Keeper's firewall

Keeper by Ashforde® includes a per-app network firewall, free: rules for which
app may connect where, alerts for new connections, profiles that follow the
network you are on, rule groups you can subscribe to, a DNS filter with
blocklists and encrypted DNS, a live map of where your computer talks to, a
year of traffic history, and warnings about unusual transfers.

This page says exactly what each operating system lets Keeper enforce, what was
tested, and where the design came from.

## What it does

| | |
| --- | --- |
| **Rules** | By app (path, and code signature so a rule survives the app being moved or renamed), by group of apps (system processes, developer tools, browsers), or any app; outgoing, incoming or both; a host (with or without its subdomains), an address or range, a port or port range, a protocol; allow or deny; high priority; temporary (until Keeper quits, or an hour). |
| **Which rule wins** | The most specific matching rule. Compared in this order: priority → who (exact app > app by signature or path > group > any) → where (exact host > longer domain > narrower address range > anywhere) → port (single > narrower range > any) → protocol. A tie between allow and deny: deny wins. No rule: the mode decides (ask, quietly allow and remember, quietly deny). Implemented in `core/fw/rules.ts` and mirrored in the macOS filter. |
| **Rule groups** | Your own, or subscribed from an https address and refreshed daily. `#sha256=…` after the address pins one exact version; `#key=…` (an Ed25519 public key) requires a matching signature at `<address>.sig` for every update. A subscription can only bring rules, never change modes or profiles. |
| **Profiles** | Each profile turns rule groups off and can have its own mode; Keeper can switch profile by Wi-Fi name or router address. |
| **Alerts** | “App X wants to connect to host:port” with country, network, known service, reverse name, code signature and path; answer allow or deny, always / until Keeper quits / for an hour / once, for this host or its whole domain, this port or any. **Explain** asks the AI you set up what the connection is. Alerts also show in the Island and as a small card on any Keeper page. |
| **Quiet modes** | Allow and remember (decide later), or deny everything without a rule — per profile, e.g. on public Wi-Fi. |
| **Tidy up** | Finds broken rules, expired ones, exact duplicates, rules a broader rule already covers (unless a more specific exception sits between them), rules unused for six months, and single-port rules that could be one range. |
| **DNS filter** | A small resolver on this computer: blocklists (hosts, plain domains, ad-blocker domain rules, address lists), your own block/allow domains, deny-host rules for all apps; it also blocks a harmless name that is only an alias (CNAME) for a blocked one. Upstream: DNS over HTTPS or TLS (Quad9, Cloudflare, Mullvad, or your own), or the network's DNS. A query log with one-click block/allow. |
| **Focus blocking** | While Focus Blocking blocks sites (docs/FOCUS-BLOCKING.md), the DNS filter refuses them before any list or rule, and the query log names Focus blocking. |
| **Monitoring** | Live connections grouped by app, host or country, searched with tokens (`app:` `host:` `country:` `port:` `proto:` `rule:` `ip:` `path:`, quotes and `-` to exclude); a world map with arcs from this computer, coloured direct / through the VPN / blocked; traffic history (minutes for a day, hours for 90 days, days for a year); unusual-transfer warnings once Keeper has learned each app's normal. |
| **Sounds** | A sound for chosen rules, optionally higher for more data. |
| **Command line** | `keeper fw status`, `rules`, `alerts`, `log [n]`, `profile [id]`, `silent allow|deny|off`, `allow|deny <host or address> [port] [--app path]`. |
| **Import and export** | JSON, every rule checked on the way in (bad ones are skipped with a reason). |

Everything is free. Nothing leaves the computer unless you turn on blocklist
downloads, rule subscriptions or an encrypted DNS upstream (and then only those
requests). The country table is on-device (see Network Activity).

## What each operating system allows

| | Windows | Linux | macOS (this build) | macOS (with the network filter) |
| --- | --- | --- | --- | --- |
| Block per app | ✅ Windows Defender Firewall rules per program | ✅ with OpenSnitch; otherwise addresses and ports for all apps (nftables) | — | ✅ |
| Hold a connection until you answer | — (alerts come after the first attempt is refused) | ✅ with OpenSnitch's own prompt | — (alerts: “seen, not held”) | ✅ (flows are paused) |
| Host rules | ✅ by the host's current addresses (refreshed) and the DNS filter | DNS filter (OpenSnitch: by host) | DNS filter | ✅ |
| Address / port rules for all apps | ✅ | ✅ nftables table `keeper` | ✅ pf anchor `com.apple/250.KeeperFirewall` | ✅ |
| Block what no rule allows | ✅ (Windows' essentials stay allowed) | ✅ | — | ✅ |
| DNS filter, encrypted DNS, blocklists | ✅ | ✅ | ✅ | ✅ |
| Keeps working while Keeper is closed | ✅ (rules live in Windows Firewall) | ✅ (nftables/OpenSnitch) | ✅ pf rules | ✅ |

Every change that touches the system asks for the administrator through the
system's own prompt (UAC, pkexec, the macOS password dialog), once per change.
Keeper deliberately does **not** install a privileged task that runs a script
it can rewrite later: any program running as you could then act as
administrator through it.

### Windows

Rules become Windows Defender Firewall rules (`New-NetFirewallRule -Program …
-RemoteAddress … -RemotePort …`, group "Keeper"), all text quoted so app paths
and host names can never run as commands. Windows rules match addresses, not
names: Keeper resolves each host and refreshes its addresses as they change.
“Block what no rule allows” sets the outbound default to block after allowing
the Windows essentials (svchost, lsass, Windows Update, SmartScreen, Defender).
Blocked attempts are logged to `%ProgramData%\Keeper\firewall.log`, which your
account may read, so Keeper raises alerts without running as administrator; it
also turns on the “Filtering Platform Connection” failure audit (event 5157),
which carries the program path. **Uninstall** removes every Keeper rule and
restores outbound “allow”.

### Linux

Address, port and protocol rules go into one nftables table, `inet keeper`,
replaced atomically; denied attempts are logged with the prefix `keeper-…`
(read back through `journalctl -k` where your account may read the journal).
nftables cannot tell programs apart by path; it can by cgroup (`socket
cgroupv2`, Linux 5.13+), which only works for apps started in their own
cgroup. When **OpenSnitch** is installed, Keeper writes its rules as OpenSnitch
rule files (`/etc/opensnitchd/rules/keeper-*.json`), and OpenSnitch's daemon
enforces them per app with its own pop-up; Keeper does not yet speak
OpenSnitch's gRPC UI protocol.

### macOS

Per-app filtering on macOS requires a **Network Extension content filter**
(`NEFilterDataProvider`) shipped as a **system extension**. Apple only allows
it in apps signed with a Developer ID whose provisioning profile carries the
`com.apple.developer.networking.networkextension` entitlement with the value
`content-filter-provider-systemextension`, which Apple grants on request; the
person then approves the extension in System Settings. The filter's source is
in `native/macos/KeeperFilter/` (same rule order as the rest of Keeper; unknown
flows are paused while Keeper asks). It is **not built** in Keeper's CI and
has **never run**: it needs that signing identity and profile.

Without it, this build enforces address and port rules for all apps through
the system packet filter (pf), loaded into `com.apple/250.KeeperFirewall` (an
anchor macOS's own pf.conf already includes, so no system file is edited),
blocks hosts through the DNS filter, and shows connection alerts as “seen, not
held”.

**To enable per-app filtering in your own build**: enrol in the Apple Developer
Program, request the Network Extension entitlement, create a Developer ID
provisioning profile for the app and the extension with
`content-filter-provider-systemextension`, add the extension target from
`native/macos/KeeperFilter`, and sign with that identity.

### DNS over QUIC

DNS over QUIC (RFC 9250) is listed but unavailable: this version of Keeper's
runtime has no QUIC stack. DNS over HTTPS (RFC 8484) and DNS over TLS (RFC
7858) are fully encrypted alternatives.

## What was tested

- **Unit tests** (`test/fw.test.ts`, 29): rule matching for hosts, addresses (v4, v6, v4-mapped), app identities and groups, ports, protocols and directions; a table of which rule wins; expiry and "until quit"; quiet modes and per-profile modes; profile switching; rules from alerts; tidy-up (covered, duplicate, invalid, expired, and an exception that must not count as redundant); merge suggestions; import/export with bad rules refused; blocklist formats and lookups; DNS message parsing and building, CNAME targets, malformed messages refused; Windows script quoting against injection, event 5157 XML and firewall-log parsing; nftables generation (deny before allow, injection attempts refused); OpenSnitch rule files; pf rules; capabilities; history tiers and chart thinning; unusual-transfer detection; search tokens; map projection, great circles and the date line.
- **DNS against real local servers** (`test/fw-dns.test.ts`, 6): plain UDP; DNS over HTTPS with certificate checking (an untrusted certificate is refused); DNS over TLS with several questions on one connection and a timeout; the filter answering through DoH, blocking listed names and a name that is only an alias for a blocked one, caching, logging, DNS over TCP; SERVFAIL when the upstream is unreachable; DoQ reported unavailable.
- **The real app on Linux** (`test/e2e/fw.cjs`, 17 checks, with a test enforcement backend so nothing on the machine changes): the DNS filter on a high port answers through a local upstream and blocks a domain (and its subdomains) added in the interface; the query log shows it; an injected blocked attempt raises an alert naming app and host; Deny creates the rule and the rules are applied; an address rule from the editor reaches the nftables table; tidy-up, the connections map, the history chart and Network Activity's Map tab render; `keeper fw status` reads the running app; no page errors. Real alerts from other programs on the test machine also appeared.

**Not tested**: enforcement on a real Windows, macOS or Linux system (UAC, the
macOS password prompt, pkexec, Windows Firewall, pf, nftables, OpenSnitch were
never changed on a real machine); reading the Windows firewall log; the macOS
network filter (never compiled); real blocklist downloads and rule
subscriptions over the internet; DNS over HTTPS/TLS to public resolvers.

## Sources

- Apple Developer Forums, [Exporting a Developer ID Network Extension](https://developer.apple.com/forums/thread/737894) — `content-filter-provider-systemextension` for Developer ID, system-extension packaging.
- Apple Developer Forums, [sysextd "no policy" with NEFilterDataProvider on macOS 26](https://developer.apple.com/forums/thread/820254) — activation problems reported on recent macOS.
- Microsoft, [Event 5157: The Windows Filtering Platform has blocked a connection](https://learn.microsoft.com/sv-se/windows/security/threat-protection/auditing/event-5157) and [Audit Filtering Platform Connection](https://learn.microsoft.com/ru-ru/windows/security/threat-protection/auditing/audit-filtering-platform-connection); [Filter origin documentation](https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/windows-firewall/filter-origin-documentation).
- [nftables and systemd cgroup v2 per-application control](https://blog.fraggod.net/2021/08/31/easy-control-over-applications-network-access-using-nftables-and-systemd-cgroup-v2-tree.html); kernel [nft_socket cgroupv2 matching](https://android-kvm.googlesource.com/linux/+/05ae2fba821c4d122ab4ba3e52144e21586c4010).
- OpenSnitch [rules format](https://git.grimmauld.de/mirrors/opensnitch/src/commit/955ed45f2c780026d82b28176f49f35643f6017e/wiki/Rules.md) (operands `process.path`, `dest.host`, `dest.port`, list operators; deny precedence).
- [RFC 8484](https://www.rfc-editor.org/rfc/rfc8484) (DNS over HTTPS), [RFC 7858](https://www.rfc-editor.org/rfc/rfc7858) (DNS over TLS), [RFC 9250](https://rfc-editor.org/rfc/rfc9250.html) (DNS over QUIC).
- Open-source macOS firewall LuLu (Objective-See) — reference for the system-extension approach.
- World outlines: [Natural Earth](https://www.naturalearthdata.com/) (public domain) via [world-atlas](https://github.com/topojson/world-atlas) (ISC), simplified into `core/fw/world.json`.
- Curated blocklists (downloaded only when switched on): StevenBlack hosts (MIT), HaGeZi DNS blocklists (GPL-3.0), FireHOL level 1.
