# Keeper's firewall

Keeper by Ashforde® includes a per-app network firewall, free: rules for which
app may connect where, alerts for new connections, profiles that follow the
network you are on, rule groups you can subscribe to, a DNS filter with
blocklists and encrypted DNS, a live map of where your computer talks to, a
year of traffic history, and warnings about unusual transfers.

It lives in Privacy & Security → **Network & firewall** (tabs: Live, Rules,
History, Where data goes, Settings), with a small Network part in the menu
bar's summary (docs/MENU-BAR.md).

This page says exactly what each operating system lets Keeper enforce, what was
tested, and where the design came from.

## The live view

- **Every app, then every place**: connections grouped by app (the program's path, so two programs with one name stay apart) and then by host; several connections to one host are one row with all its ports. Each row: the host name (from DNS answers the filter saw, or the system's own), a country flag when the on-device country table is downloaded (Network Activity → Countries; no lookup ever leaves the computer, and nothing is shown without it), protocol and ports, received and sent per second, a sparkline of the last minute (one reading every 2 s while the page is visible), and whether it is allowed, blocked or has no rule.
- **Search and filters**: words match the app, its path, host, address, country, service or port (`/` focuses the search). Filters: All, Active (more than 64 B/s), Blocked, New today (an app reaching a host for the first time today; it needs Keeper to have watched since before today, otherwise it says it is still learning). Each shows its count.
- **Inspector**: the selected app's rates, a larger sparkline, and what it may do — *Follow rules* (no answer of its own), *Allow*, *Ask*, *Block* — for an hour, until Keeper quits or always, on every network or only in one profile. Each host it reaches has its own Allow and Block. These are ordinary rules in “My rules” with a stable id per app and host (`core/fw/rules.ts`, `ruleForApp`, `appRuleId`), so a new answer replaces the old one and *Follow rules* removes it.
- **Where blocking single apps is not possible** (a Mac without the network filter, Linux without OpenSnitch) the inspector offers only Follow rules and Ask, says why in one sentence, and offers *Block site* (the DNS filter, for every app) when the DNS filter runs. With per-app blocking possible but *Enforce rules* off, it says answers take effect once rules are enforced and offers to turn that on.
- **Keyboard**: arrows move between apps, → / ← open and close one, Enter or Space selects it.

## The Ask prompt

- An **Ask** rule (new beside allow and deny) holds or flags a connection and asks, even in a quiet mode. Equally specific rules that disagree: deny, then ask, then allow. Ask rules never reach Windows Firewall, nftables, OpenSnitch or pf (`enforceableGroups`, and each generator refuses them).
- Waiting connections are **batched**: one prompt per app (by path), oldest app first, listing every place it wants to reach (`batchAlerts` in `core/fw/live.ts`). Programs Keeper cannot name by path and the computer's own addresses never prompt.
- Each prompt: the app, who signed it (macOS team id, Windows publisher, Linux package), the places, **why it may be connecting** in a short guess (updates, usage or crash reports, a certificate check, the clock, notifications, syncing, code packages, a code host, remote login, name lookups, mail; else by the kind of app or port; `whyConnecting`), and *Deny*, *Allow once*, *Allow*, remembered for an hour, until Keeper quits or always, for these places, their whole sites or everywhere. One answer for several places is applied to the system once.
- **The small window** (on by default, Settings → Switches → *Ask in a small window*) sits in the top right corner. It waits 3 s to gather prompts, then waits while you type (the system's idle time under 2 s, for up to 45 s), and opens with `showInactive()`, so it never takes the keyboard (`askTiming`, `electron/services/fw/ask-window.ts`). Escape or *Later* puts it away for 10 minutes; the prompts stay on the page (“2 waiting”) and in the menu bar. With the window off, the Island tells once per batch, at most every 30 s.

## History and where data goes

- **Watch in the background** (off until you turn it on, or turn on rules, asking or the DNS filter) keeps the traffic history, learns what is new, and counts each app's hosts per day for 35 days (`tally`; bytes from the rates times the real time between looks).
- **History**: a day (minutes), a week or a month (hours), every app or one: data used, received and sent, a chart, the apps by data and the top destinations with how many connections; **Export CSV** saves the series, the apps and the destinations (cells that look like formulas are made harmless).
- **Where data goes**: today, 7 or 30 days — how many places your data went to, then each app with its top sites (hosts folded into their domain) and how often it reached them. No map.


## What it does

| | |
| --- | --- |
| **Rules** | By app (path, and code signature so a rule survives the app being moved or renamed), by group of apps (system processes, developer tools, browsers), or any app; outgoing, incoming or both; a host (with or without its subdomains), an address or range, a port or port range, a protocol; allow, deny or ask; high priority; temporary (until Keeper quits, or an hour); only in some profiles. |
| **Which rule wins** | The most specific matching rule. Compared in this order: priority → who (exact app > app by signature or path > group > any) → where (exact host > longer domain > narrower address range > anywhere) → port (single > narrower range > any) → protocol. A tie: deny, then ask, then allow. Rules limited to other profiles are ignored. No rule: the mode decides (ask, quietly allow and remember, quietly deny). Implemented in `core/fw/rules.ts` and mirrored in the macOS filter. |
| **Rule groups** | Your own, or subscribed from an https address and refreshed daily. `#sha256=…` after the address pins one exact version; `#key=…` (an Ed25519 public key) requires a matching signature at `<address>.sig` for every update. A subscription can only bring rules, never change modes or profiles. |
| **Profiles** | Home, Work and Public Wi-Fi to start with. Each profile turns rule groups off and can have its own mode; a rule can be limited to some profiles; Keeper can switch profile by Wi-Fi name or router address (*Use the network I'm on* fills them in). |
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
- **Network monitor unit tests** (`test/netmon.test.ts`, 22): rules for one app, for a host of an app, for an hour and until quit, only in one profile; Ask rules (in a quiet mode, ties, kept away from the system, export and import); quick per-app rules found and replaced; rate and amount formats; sparkline buffers; grouping by app then host, ports merged, filters and counts, “new today”; top destinations, where your data goes, old days dropped; CSV with formula cells made harmless; prompt batching, reasons and timing (gathering, typing, the 45 s limit, Later); the menu bar's network part and its switch.
- **DNS against real local servers** (`test/fw-dns.test.ts`, 6): plain UDP; DNS over HTTPS with certificate checking (an untrusted certificate is refused); DNS over TLS with several questions on one connection and a timeout; the filter answering through DoH, blocking listed names and a name that is only an alias for a blocked one, caching, logging, DNS over TCP; SERVFAIL when the upstream is unreachable; DoQ reported unavailable.
- **The real app on Linux** (`test/e2e/fw.cjs`, 17 checks, with a test enforcement backend so nothing on the machine changes): the DNS filter on a high port answers through a local upstream and blocks a domain (and its subdomains) added in the interface; the query log shows it; an injected blocked attempt raises an alert naming app and host; Deny creates the rule and the rules are applied; an address rule from the editor reaches the nftables table; tidy-up, the connections map, the history chart and Network Activity's Map tab render; `keeper fw status` reads the running app; no page errors. Real alerts from other programs on the test machine also appeared.

- **The network monitor in the real app on Linux** (`test/e2e/netmon.cjs`, 38 checks, as root for a test network): a server in its own network namespace at 198.51.100.10 sends to a test client; the live view lists the client by name with that host, `TCP 8443`, its received rate and a moving sparkline; the inspector; search (no match shows the designed empty state; by port) and the Active and Blocked filters; Block makes a deny rule for the app that is applied and the connection shows as blocked, and Follow rules undoes it; two injected connections of one app raise one prompt in the small window, shown without taking the keyboard, with both places and a reason; the page's “1 waiting” opens the same prompt; Deny makes one rule per place, applied once, and the window moves on; Where data goes and History render; the menu bar's Network part shows “N apps online” and at most three apps with Block, does not scroll and fits the screen; Block and Allow there make and remove the same rule; Show network off hides it and Settings → Menu bar has the switch; light and dark, 1024×768; no page errors.

**Not tested**: real per-app blocking (the e2e uses the test backend: OpenSnitch is not installed in the test container, and nftables cannot tell apps apart without their own cgroup); the Ask window on a real Mac or Windows desktop (placement under the menu bar, the system idle time while typing); enforcement on a real Windows, macOS or Linux system (UAC, the
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
