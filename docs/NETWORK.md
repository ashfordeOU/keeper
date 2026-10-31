# Network Activity and VPN

Keeper by Ashforde® shows which app talks to whom, how much, and which way the
traffic leaves the computer; lists the system's VPN connections; and checks
whether traffic really goes through them. This page says exactly what each
operating system lets an app see, and what has been verified.

## Where the numbers come from

| | Linux | macOS | Windows |
| --- | --- | --- | --- |
| Connections and their owner | `ss -tunapiOH` (iproute2); without it, `/proc/net/{tcp,udp}{,6}` and `/proc/<pid>/fd` | `nettop -L 1 -x -n` (all processes, no administrator); `lsof` as a fallback (your own apps only) | `netstat -ano`, names from `tasklist` |
| Bytes per connection | yes, with `ss` (TCP); UDP and no-`ss` show interface totals | yes (nettop, per connection and per process) | no — Windows counts per app only with administrator access (ETW); Keeper shows totals for the whole computer |
| Which interface a connection uses | `ip route get` per destination (honours policy routing, as wg-quick sets it up), else `/proc/net/route` and `ipv6_route` | nettop names the interface; the routing table (`netstat -rn`) otherwise | `route print` (IPv4 and IPv6 tables, with interface descriptions) |
| Bytes per interface | `/proc/net/dev` | `netstat -ibn` | `netstat -e` (whole computer) |
| VPN connections | NetworkManager (`nmcli`), `wg show` (needs administrator for details), interfaces named `wg*` | `scutil --nc list` (the VPNs in System Settings, including WireGuard app tunnels) | `Get-VpnConnection` and WireGuard tunnel services |
| Connect / Disconnect | `nmcli connection up/down` (a polkit prompt if needed); `wg-quick` through `pkexec` | `scutil --nc start/stop` (some VPNs ask for a password in their own app) | `rasdial`; WireGuard services with an administrator prompt |
| DNS servers | `resolvectl dns` (systemd-resolved) or `/etc/resolv.conf` | `scutil --dns` | `Get-DnsClientServerAddress` |
| Wi-Fi | `nmcli device wifi`, or `/proc/net/wireless` | `system_profiler SPAirPortDataType` | `netsh wlan show interfaces` |

Other users' and system processes: Linux only names your own processes'
sockets (the rest show as "System or another user"); macOS nettop shows all;
Windows shows all owners.

## Through the VPN or not

Each connection is labelled:

- **VPN** — the route to its address goes through a VPN or tunnel interface.
- **Direct** — it goes to the internet through Wi-Fi, Ethernet or mobile data, not through a VPN.
- **Local network** — private, link-local or multicast addresses on your network.
- **This computer** — loopback, or one of the computer's own addresses.

The VPN page's verdict follows real public addresses through the routing
table, so VPNs that add two half-routes (`0.0.0.0/1` + `128.0.0.0/1`) instead
of replacing the default route are recognised. It reports:

- IPv4 through the VPN or not;
- **IPv6 leak**: IPv4 goes through the VPN but an IPv6 route to the internet still uses the physical interface;
- **DNS leak**: DNS servers (other than split-DNS servers for one domain) reached outside the tunnel while it is up;
- *What the internet sees* (only when pressed): your public IPv4 and IPv6 address from api.ipify.org, and the address seen when the request is forced out of the physical interface. When both are the same while the VPN is up, either the VPN isn't hiding your address or the system routes everything through it regardless of source address (policy routing) — Keeper says both possibilities.

On macOS, `utun` interfaces are also used by system services; Keeper only
calls a `utun` a VPN when a VPN is connected through it or it carries the
internet route.

## Importing VPN files

- **WireGuard `.conf`**: checks the keys (32-byte base64), addresses, AllowedIPs and Endpoint; warns when IPv4 is fully tunnelled but IPv6 is not, and when no DNS server is set.
- **OpenVPN `.ovpn`**: checks for `remote`, `dev`, a CA; warns about old ciphers (BF, DES…), MD5/SHA1, compression, IPv4-only redirection; notes when a login is needed.
- The preview never contains private keys, pre-shared keys or inline `<key>`/`<tls-auth>`/`<tls-crypt>` blocks; the full text stays in the main process memory until you add it or after 10 minutes.
- Adding it: Linux with NetworkManager runs `nmcli connection import` from a temporary file readable only by you, deleted right after (OpenVPN needs the `network-manager-openvpn` plugin). macOS hands WireGuard files to the WireGuard app. Windows opens the WireGuard app (choose *Import tunnel(s) from file*) or copies OpenVPN profiles into `%USERPROFILE%\OpenVPN\config`, where the OpenVPN app keeps them as plain files — the dialog says so.
- *Keep an encrypted copy* stores the file in the system keychain (Electron safeStorage), never as a plain file.

## Countries and networks

Off by default. When turned on, Keeper downloads the free DB-IP Lite country
and ASN files once (about 12 MB, CC BY 4.0, from db-ip.com), builds compact
tables (about 10 MB each) and looks addresses up on the computer (about a
microsecond each). No address is ever sent anywhere. The data is monthly;
*Remove* deletes it. Attribution: [IP Geolocation by DB-IP](https://db-ip.com).

## Cost

Nothing runs in the background unless you turn on *new app* alerts (one look
every two minutes, slower when you're away, paused while the screen is locked)
or VPN auto-reconnect (one look a minute; three on Windows). Readings happen
while Network Activity or VPN is open and the window is visible.

Measured in the real app on Linux (4 cores, software drawing, ~200 sockets):
about 1% of one core in the main process to read every 2 seconds, about 2–3%
of one core for the whole app including drawing the page.

## Verified, and not yet

Verified on Linux in the real app (`test/e2e/net.cjs`, 24 checks): Keeper's
own internet connection attributed to Keeper and to the right interface; another
program's connection attributed to it; listening sockets; per-connection
amounts with `ss`, and the `/proc` path without it; interface rates; CSV export;
the route verdict; a WireGuard file read with its key hidden; the country and
network download and table build from the real DB-IP files; the pages; and the
cost above. All parsers are unit-tested against output from each system
(`test/net.test.ts`).

Not run on real machines yet: everything specific to macOS and Windows
(nettop, scutil, route print, rasdial, Get-VpnConnection, WireGuard services),
NetworkManager (not present in the test container), switching a real VPN on
and off, the IPv6 and DNS leak checks against a real VPN, and the import into
NetworkManager, the WireGuard app and the OpenVPN app.
