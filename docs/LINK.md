# Keeper Link

Keeper Link joins your own devices (computers, and phones or tablets through a web page) into a small private network. Remote screen viewing, remote control, folder sync and backups between devices build on it.

There is no Keeper account and no Keeper server. Devices trust each other only because you paired them, and every connection is encrypted between the two devices.

## Pairing

On the device being added to, choose **Pair a Device**. It shows:

- a **six-digit code**, which works for 10 minutes; five wrong tries end it;
- a **QR code / `keeper://pair?…` link** carrying a 128-bit secret, the device's key fingerprint and its addresses.

On the other device, choose **Enter a Code**. Devices waiting to pair on the same network appear by themselves through mDNS (`_keeper._tcp`). Otherwise, type an address or paste the link.

Protocol (`core/link/pair.ts`):

```
P1  J → H   commitment = SHA-256(eJ ‖ nJ)
P2  H → J   eH, nH
P3  J → H   eJ, nJ                         (H checks the commitment)
    k = HKDF(X25519(eH, eJ), T)            T = transcript
P4  J → H   AES-GCM_k(J's Ed25519 key, name, signature over T, HMAC(code or secret, T))
P5  H → J   AES-GCM_k(H's Ed25519 key, name, signature over T and J's key)
    both show six digits = SHA-256("keeper-sas" ‖ T ‖ keys) mod 10⁶
P6  each    AES-GCM_k(confirmed)
```

- **The HMAC** shows the joiner saw the host's screen.
- **The six-digit comparison** stops an active attacker in the middle. The joiner committed to its key before seeing the host's, so an attacker gets one guess (1 in 10⁶) at making the digits match. This is the numeric-comparison design used by Bluetooth and ZRTP.
- **QR pairing** carries a 128-bit secret and pins the host's key, so the joiner does not have to compare digits. The host still asks before it lets the device in.
- **The pairing secret** (HKDF of T) is kept by both devices. It is used only to find each other over the internet (see Mailbox below).

## The encrypted channel

Every later connection runs `core/link/channel.ts`: a SIGMA-I handshake (the sign-and-MAC pattern of IKEv2 and TLS 1.3) with ephemeral X25519 keys and the devices' Ed25519 identity keys.

- **Hidden identities:** both identity keys travel encrypted, so a watcher cannot tell which devices are talking.
- **Pinned keys:** the caller only accepts the key it paired with. The answering device only accepts keys on its trusted list.
- **Per-message encryption:** messages are AES-256-GCM with an implicit 64-bit counter per direction. A replayed, dropped, reordered or changed message fails, and the channel closes.

Many streams share one channel (`core/link/mux.ts`): requests, file transfers and forwarded ports, each with its own 512 KB flow-control window.

Every request is checked against the permissions you set for that device (`core/link/perms.ts`). Unknown requests are refused.

## Carriers

| Carrier | When | Notes |
| --- | --- | --- |
| Local network | always tried first | WebSocket to the other device's Link port (47821 by default). Found through mDNS or its last known addresses. |
| Cloudflare tunnel | "From anywhere", the other device runs a tunnel | `wss://<hostname>/link`. Works through any router or firewall. Cloudflare sees only ciphertext. |
| Keeper Relay | "From anywhere", a relay URL is set | A blind relay: it joins two WebSocket calls and passes frames along. It sees which device ids talk, when, and how much. |
| Direct (UDP) | "From anywhere", the connection runs through a relay or tunnel | Every kind of Link traffic: files, ports, the SOCKS proxy, sync, requests, terminals. See *Direct connections* below. |
| Direct peer-to-peer (WebRTC) | remote screens | Screen pictures use their own WebRTC connection, signalled and certificate-checked over the Link channel; see [REMOTE.md](REMOTE.md). |

The device page shows which carrier a connection uses ("Local network", "Direct", "Tunnel", "Relay"), its round-trip time, and under *Connection* every carrier under it with the bytes moved on each.

**Never leaves my network** turns off everything except the local network, even in "From anywhere" mode.

## Direct connections

When a paired device is reached through a relay or a tunnel, the device that dialled looks for a direct path (`core/link/udp.ts`, `core/link/direct.ts`, `electron/services/link/direct.ts`). It is pure Node (`dgram`): no hidden browser window is needed.

1. **Offer.** Inside the existing encrypted connection it sends a fresh 32-byte path key, a connection id and its candidate addresses: its network cards, and (for "From anywhere") the address a STUN server from the STUN setting reports.
2. **Punch.** Both sides send small probes to all of the other's candidates at once, which opens each router's mapping; the first address that answers is nominated.
3. **Bind to the device.** Every UDP packet carries an HMAC with the path key, so nobody else can inject anything. The normal Link handshake then runs on the path with the pinned device keys — the same idea as checking DTLS fingerprints for screens, but with the identity keys themselves.
4. **Move.** The connection runs on a *resumable* carrier (`core/link/resume.ts`): each side numbers what it sends and keeps it until the other confirms it. When the direct path is ready, traffic moves onto it and anything in flight is sent again there; open streams (a file half sent, a forwarded port, a terminal) carry on. The relay or tunnel stays as a quiet standby.
5. **Fall back.** If the direct path stops answering (30 seconds), traffic moves back to the standby path, again without dropping streams. If every path is gone, the calling side dials again and continues the same connection (within 20 seconds). A failed search is tried again after 1, 2, 4 … 30 minutes while the device stays connected.

The UDP path is reliable and ordered: sequence numbers, selective acknowledgements, retransmission on a timeout or after three later packets, and a congestion window that halves on loss.

**Scope.** "This network only" and "Never leaves my network" never look for a direct path over the internet (no STUN; private addresses only). The feature can be switched off (*Direct connections between your devices* in Settings → Features). Nothing runs while no device is connected through a relay or tunnel; one UDP socket per direct path, closed with it.

## Your devices as a fleet

- **Groups, tags and notes** per device (kept on this device only), a **search box** (`tag:office`, `group:home`, `online`, `offline`), online state with *last seen*.
- **Remote actions:** lock, sleep, restart (need *Control this computer* there), print a file on its default printer, a **system snapshot** (system, processor, memory, disks, battery, uptime).
- **Run commands** — a new permission, off by default. The first time a device asks to run a given command, its owner sees the exact command and allows or refuses it; the same command later runs without asking. Saved commands sit on the device page.
- **Terminal on this device** — the existing terminal permission now opens a real terminal over Link (`term` streams; node-pty in the app, `script` otherwise). Phones can get a Terminal tab too, per phone, under *Phones and tablets*.
- **Share my location** — off by default. With it, the other device may read this one's last position (`loc.get`; latitude, longitude, accuracy, time, battery). Places & Tracks supplies the position and reads others' with `devicePosition()` / `pairedPositions()` from `electron/services/link/location.ts` (it sets this device's own position with `setOwnPositionSource()`). Each read is logged.
- **Audit log** of screen and help sessions, transfers (with the carrier used), commands (also refused ones), terminals, ports opened from the command line, restarts and location reads, in and out, on every device; filter and export as CSV or JSON (Devices → Remote Access, and per device).

## Help mode

One-time support with someone who is **not paired**: see [REMOTE.md](REMOTE.md#help-mode). The protocol is in `core/link/help.ts`.

## Unattended access

An opt-in system service keeps Link listening while Keeper is not running; see [REMOTE.md](REMOTE.md#unattended-access).

## Where it shows up

Remote access is not only on the Devices page. Devices → Remote Access → *Where it shows up* chooses, per part, between:

| | Menu bar / tray | Island | Command palette | Right-click menu |
| --- | --- | --- | --- | --- |
| Get help, Help someone | ✓ | ✓ (Controls tab) | ✓ | |
| Your devices (Send Files, View, Control) | ✓ | | ✓ | |
| Sessions in progress, with Stop | ✓ | ✓ (as an activity) | | |
| Send to a device | | | ✓ | ✓ |

`keeper://help?code=…&pw=…` links ("Ask for help") open Help someone with the code filled in.

## Finding each other over the internet (Mailbox)

Paired devices leave each other short notes on a topic of an ntfy-compatible push service: `ntfy.sh` by default, your own server, or empty to turn this off.

- **What a note says:** "reach me at these addresses / this tunnel / this relay".
- **Topic:** `keeper-` plus 128 bits derived from the pairing secret, so nobody else can guess it.
- **Note:** AES-256-GCM with a key derived from the same secret, signed with the sender's identity key, and valid for six hours.
- **When notes are written:** only when the address changes.
- **When notes are read:** only when a direct attempt failed.

Trade-offs: the push service sees that someone posts to a random-looking topic, when, and from which IP address. It can delete or hold back notes; then devices fall back to what they knew last. It cannot read or forge them.

## Cloudflare tunnel

`electron/services/link/cloudflared.ts`, with pinned files and checksums in `core/link/cloudflared.ts`.

**The binary**
- `cloudflared` 2026.10.7 is downloaded on first use from Cloudflare's GitHub releases.
- Its SHA-256 is checked against the value pinned in Keeper before it ever runs.
- On macOS the `.tgz` is unpacked; Windows on ARM uses the x64 build.

**Two modes**
- **Quick tunnel:** no account. You get a random `https://….trycloudflare.com` address that changes on each start. Paired devices learn the new one through the Mailbox.
- **Your own hostname:** create a tunnel in the Cloudflare dashboard (Zero Trust → Networks → Tunnels) and point a hostname at `http://localhost:47821`. Paste the token into Keeper. The token is stored in the system keychain and passed to `cloudflared` in its environment, never on the command line.

**Staying up**
- **After a crash:** a restart with exponential back-off (1, 2, 4 … 120 s, with jitter), reset after a good connection.
- **After sleep:** a restart when the computer wakes up.
- **When disconnected:** a restart when `cloudflared`'s own metrics report no connections for two minutes.
- **As a system service:** *Keep the tunnel running when Keeper is closed* installs it with `cloudflared service install`. This uses the system's administrator prompt: pkexec on Linux, the administrator dialog on macOS, and "Run as administrator" on Windows.

**What it exposes.** Through the tunnel, the Link endpoint serves only:
- the device carrier (`/link`), which does nothing without a paired key;
- the phone page (`/c/`), which does nothing without a QR secret or a phone's own key.

For an extra lock, put Cloudflare Access in front of your hostname. Allow the `/c/` path for your phone, and use a service token for your devices if you want.

## Keeper Relay

The code is in `core/link/relay.ts` and `relay/`.

```
GET /v1/listen?id=<device id>   a device waits for calls (signs a challenge to prove the id)
GET /v1/dial?to=<device id>     another device calls it
GET /v1/accept?tag=<tag>        the called device picks up; then bytes are piped both ways
GET /v1/online?ids=a,b          which ids are listening
```

Run it yourself:

```bash
node relay/build.mjs                        # → relay/dist/keeper-relay.mjs (one file, no dependencies)
PORT=8080 node relay/dist/keeper-relay.mjs  # put it behind HTTPS
docker build -t keeper-relay relay          # or as a container
cd relay/cloudflare && npx wrangler deploy  # or as a Cloudflare Worker with Durable Objects
```

Settings for the Node relay: `PORT`, `HOST`, `BYTES_PER_SECOND` (a limit per call) and `MAX_DEVICES`.

## Phone and tablet companion

*Devices → Phone* shows a QR code with `http://<computer>:47821/c/#k=<secret>&d=<device>`, or the tunnel's https address.

- **The key in the QR code** sits after `#`, which browsers never send. The page removes it from the address bar at once.
- **The channel:** the page and the app agree session keys from that secret and fresh nonces, then seal every message with ChaCha20-Poly1305 and a per-direction counter (`core/link/companion-proto.ts`).
- **Why a pure-JS implementation** (`core/link/jscrypto.ts`, checked against Node's): browsers do not offer WebCrypto to plain-http pages on the local network.
- **Approval:** the computer asks *Allow this phone?*. Once allowed, the phone gets its own long-term key, kept in the page's storage, and comes back without the QR code. Remove it under *Phones and tablets*.
- **What the phone can do:** send files to Downloads/Keeper, browse and download from shared folders, and read or set the clipboard.
- **Room to grow:** the request format leaves room for screen viewing and control on the same channel.

## Shared folders, ports and the clipboard

- **Shared folders:** only folders listed under *Shared folders* are reachable.
  - Paths are resolved inside the share, and symbolic links are not followed out of it.
  - A drive root or your whole home folder cannot be shared.
- **Ports:** a forward listens on `127.0.0.1:<port>` here and connects to `<host>:<port>` on the other device.
  - The other device allows only itself (`localhost`), unless its owner turns on *Ports may reach this device's network*. Even then, only private addresses are allowed, never the public internet.
  - The SOCKS5 proxy (`CONNECT` only, no authentication, bound to 127.0.0.1) follows the same rule.
- **Clipboard:** only text. It is sent when you choose *Send Clipboard*, and read by the phone when you tap *Get*.

## Command line

`keeper link status | devices | invite | pair <address> <code> | pair <keeper://…> | send <file> <device> | check <device> | forward <device> <port>[:<remote port>] | forward <device> socks:<port>`

`keeper remote list | connect <device> [--view] | help | help --code C --password P | exec <device> -- <command> | ssh-proxy <device> [--port 22] | wake <device> | send <device> <file…> | forward <device> <port> | screenshot <device> [--out F] | info <device> | lock|sleep|restart <device> | log [device]`

SSH over Link, with no port open on the other device's router:

```
ssh -o ProxyCommand="keeper remote ssh-proxy %h" you@studio-mac
```

The other device must allow *Reach ports on this computer*. `ssh-proxy` is a byte pipe through the app's loopback control port (`/local/pipe`, same token rule as the other commands).

The command talks to the running app over `127.0.0.1`, using a token in `<Keeper data>/link/control.json` that only your account can read.

## IP-level mesh

Keeper Link itself is an app-level network: devices reach each other's files, ports and services through Keeper.

**Keeper Mesh** builds an IP-level network on top of it, with WireGuard. See [MESH.md](MESH.md).
- It is off by default (Settings → Features → *Keeper Mesh*).
- Every app can then reach your devices by address or by name (`laptop.keeper`).
- Link carries its control plane: a `mesh.ctl` stream through Link's `registerStream` hook, carrying signed WireGuard keys, candidates and invitations.
- The Keeper Relay gained a blind packet path (`/v1/pkt`) for devices that cannot reach each other directly.

If some other WireGuard interface is already up on the computer, the Devices page shows it, and Keeper Link works over it like over any other network.

## What was tested, and how

- **Unit tests:** `test/link.test.ts` and `test/link-node.test.ts`.
  - **Crypto:** the pure-JS crypto against Node and an RFC 8439 vector.
  - **The channel:** the handshake, refusing the wrong device or an untrusted caller, and closing on a replayed message.
  - **Pairing:** right code, wrong code, five wrong codes, not confirmed, a QR code with the wrong host.
  - **Streams:** independent streams with flow control, requests and permission checks.
  - **File transfer:** resume from a partial file, a damaged part caught by the hash, safe names.
  - **Networking pieces:** mDNS packets including compressed names, the relay (joining, refusing a bad proof, a device that is not there), Mailbox notes against a local ntfy-style server, port forwarding and SOCKS5 (including a refused target).
  - **The tunnel supervisor:** run against a stand-in `cloudflared` that crashes (address read, growing waits, stop), a missing token, and a download with the wrong checksum.
  - **Two real nodes:** pairing, files, shared folders with link and `..` escapes, clipboard, forwarding, forget, the relay as the only path, local-only mode, and a phone pairing, uploading, listing, reading and being forgotten.
- **End to end:** `test/e2e/link.cjs` runs two real Keeper apps on one Linux machine under xvfb, plus an emulated iPhone browser. All 27 checks pass:
  - **Pairing through the windows:** mDNS discovery, the same six digits on both screens, then paired.
  - **Files:** sent both ways with the accept prompt.
  - **Shared folders:** closed until allowed, then browsed and copied from.
  - **Ports and clipboard:** a forwarded port answers, and the clipboard arrives.
  - **Relay:** both apps hold a relay connection.
  - **The phone:** asked to allow, connected, a 1.1 MB upload intact, shared folders listed, the clipboard read, and a reconnect without the QR code.

- **Keeper-to-Keeper remote access** (`test/k2k.test.ts`, `test/k2k-node.test.ts`, `test/e2e/remote-advanced.cjs`; details in [REMOTE.md](REMOTE.md#what-was-tested-and-how)):
  - **Verified:** the UDP path's packet authentication, punching, ordering, recovery from 15% loss; moving a live 3 MB stream from relay to direct and back without losing a byte; two nodes moving from the relay to a direct path by themselves and sending a 2 MB file over it, then falling back to the relay; "Never leaves my network" not trying; three real apps under Xvfb with a local relay: a 4 MB file went over the direct path and the device page said "Direct".
  - **Not verified:** a direct path across real routers (NAT); STUN against a public server (this machine blocks outbound UDP to the internet); symmetric NATs (where punching cannot work, the relay or tunnel simply stays).

**Not verified here:**
- **Cloudflare tunnel:** a real quick tunnel got its trycloudflare address (and Keeper reads that line correctly). The connection to Cloudflare's edge was blocked by this test machine's DNS, so a working tunnel end to end is untested.
- **The tunnel as a system service:** not tried (it needs an administrator prompt).
- **The Cloudflare Worker relay:** syntax-checked, and its device ids match the app's. It was not run on Workers.
- **macOS and Windows:** the keychain, mDNS on those systems, and the service install commands.
- **Real phones:** the companion page was tested in Chromium's iPhone emulation, not Safari or Chrome on a real device.
- **WebRTC peer-to-peer and the direct UDP carrier:** tested on one machine, not across real NATs.
