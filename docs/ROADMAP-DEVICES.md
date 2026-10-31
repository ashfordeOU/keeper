# Keeper across your devices — roadmap

Keeper by Ashforde® aims to make every computer and phone you own feel like one
place: reach any of them, see any screen, move any file, keep folders in step
and back everything up — on your own network or across the internet — without
a separate remote-desktop service, mesh VPN or sync app.

Status: ✅ built · 🚧 being built · 🧭 planned. Each item ships only after it is
tested on the operating systems it claims.

## Foundations — Keeper Link 🚧

- Device identity: one key pair per device, kept in the system keychain.
- Pairing by QR code or a short code, confirmed by matching words on both screens.
- Per-device permissions: files, send, clipboard, screen view, screen control, terminal, sync, port forwarding.
- Revoke a device instantly; see when each device was last seen and how it is connected.
- End-to-end encryption on every path, pinned to device identities.
- Paths chosen automatically: same network → direct internet (peer-to-peer) → your relay → your Cloudflare tunnel.
- "Never leaves my network" switch (LAN-only mode), per device and globally.
- Finding devices across the internet without a Keeper server: your own relay, your tunnel hostname, an encrypted mailbox on a public push-topic service, or a pasted/QR offer.
- Self-hostable Keeper Relay (Node server or Cloudflare Worker) for networks that block peer-to-peer.
- cloudflared tunnels: quick (temporary) or named (your domain); supervised with automatic restart, health checks, restart on wake or network change; optionally installed as a system service so the tunnel stays up when Keeper is closed.
- Publish any local service through the tunnel (with Cloudflare Access advice).
- Stable device names (`laptop.keeper`) and a Devices section in the sidebar.
- Port forwarding between devices and a SOCKS proxy into another device's network.
- Browse another device's shared folders in Keeper.
- Send files to a device: drag onto it, accept prompt, resumable and checked.
- Shared clipboard between devices (opt-in).
- Phones and tablets with nothing installed: a web companion opened from a QR code, end-to-end encrypted.

## Remote desktop and mirroring 🧭 (on top of Link)

- View and control another computer's screen (attended, with a consent prompt; unattended for your own devices).
- Multi-monitor, scaling, adaptive quality, low-latency mode, view-only mode.
- Clipboard, file drag-and-drop and chat inside a session; session recording (opt-in).
- Wake-on-LAN for sleeping machines on the same network, or through another awake device.
- Android: mirror and control over USB or Wi-Fi (scrcpy), drag files and APKs in, copy/paste both ways, record.
- iPhone and iPad: show the screen on a Mac with Apple's own screen mirroring, on Windows and Linux through a built-in AirPlay receiver (view only — iOS does not allow control).
- Phone as a remote: touchpad, keyboard, media keys, presentation clicker, through the web companion.
- Phone camera as a webcam or document scanner for the computer.
- Second screen: use a tablet or another computer as an extra display.
- "Continue on…": open the file or page you are looking at on another device.

## Sync and backup 🧭

- Folder sync between two or more Keeper devices, peer-to-peer, no cloud in between; send-only, receive-only or two-way.
- Versioning: keep old versions and deleted files for a set time; conflict copies you can compare side by side.
- Selective sync and ignore patterns; pause on battery or metered networks.
- Photo backup from phones through the web companion.
- Backups to any of the ~70 cloud and storage services Keeper connects to (Google Drive, OneDrive, Dropbox, iCloud Drive, Nextcloud, S3-compatible, NAS…), encrypted before upload, deduplicated, scheduled, with restore and test-restore.
- 3-2-1 backup assistant: it checks you have three copies, on two kinds of storage, one off-site.
- Disk-image and system-settings snapshots where the system allows.

## Network and VPN 🧭

- Import and manage WireGuard and OpenVPN profiles; show system VPNs.
- Per-app traffic view: which app talks to which server, through which interface (VPN, Wi-Fi, Ethernet), how much.
- DNS view, leak test, IPv6 leak test, kill switch advice.
- Network health: latency, packet loss and speed over time; router and ISP outages.
- LAN map: every device on the network with names and kinds; new-device alerts.

## More ideas under consideration 🧭

- Find my devices: where each device was last seen (opt-in, end-to-end encrypted).
- Remote lock, remote wipe of Keeper data, remote "lock folders now".
- Run a command or a Terminal session on another device (permission-gated).
- Shared Island: a timer, a download or an AI agent on one device shows on the others.
- Notifications from one device mirrored to another (opt-in per app).
- Battery and health of all devices in one place.
- Print to a printer attached to another device.
- Audio: play this computer's sound on another device.
- Family mode: help someone else's computer with their permission and a one-time code.
- Team mode: a small group of people sharing a relay and a device list, with roles.
- Audit log of every remote session and file transfer, kept on each device.
