# Remote screens and phones

Keeper's remote screens build on [Keeper Link](LINK.md): only paired devices can ask, every request is checked against that device's permissions, and the owner of the shared screen decides.

## How a session works

```
viewer (laptop)                              host (desk)
───────────────                              ───────────
viewer window ─ main ── Link stream 'screen.ctl' ──▶ main ─ banner window (captures the screen)
                     ◀──────── Link stream 'screen.frames' (fallback picture)
              ◀═════════════ WebRTC video (direct, when it connects) ═════════════
```

1. **Request.** The viewer opens a `screen.ctl` stream inside the encrypted Link channel and says what it wants (view, or view and control).
2. **Decision** (`core/screen/consent.ts`):
   - The device needs *See this screen* (and *Control this computer* for the mouse and keyboard) in the host's Link permissions. Otherwise it is refused, with the reason.
   - The host's owner is asked every time — *Allow Control*, *Allow Viewing Only*, *Don't Allow* — unless they turned on *Let it in without asking* for that device. That switch is only honoured when both permissions are on, and is meant for your own computers.
   - Phones are always asked.
3. **Capture.** A small always-on-top banner opens on the host ("Laptop is controlling this screen · Stop sharing"). It captures the chosen display with Electron's desktop capture.
4. **Picture.**
   - **Direct:** the host offers a WebRTC video track. Offer and answer (non-trickle; candidates included) travel on the control stream, each with the DTLS certificate fingerprint of its description. Each side refuses a description whose fingerprint differs from the one stated, and after DTLS completes checks with `getStats()` that the certificate the peer really used is that one (`core/screen/sdp.ts`). A TURN or relay server in between sees only DTLS.
   - **Fallback:** if no direct connection is made within 9 seconds (or the viewer asks for it), the host sends JPEG frames on a `screen.frames` Link stream. At most two are unacknowledged at a time, so a slow link gets fewer, fresher frames instead of a backlog (`core/screen/frames.ts`).
   - **Scope:** with Link set to *This network only* or *Never leaves my network*, no STUN servers are used and only local (host) candidates are kept.
   - **Quality:** *Auto* adapts bitrate, size and frame rate once a second from WebRTC's statistics (loss, round trip, available bandwidth, CPU limits): it backs off fast and climbs back slowly (`core/screen/abr.ts`). *Fastest*, *Balanced* and *Sharpest* are fixed.
5. **Input.** The viewer turns pointer, wheel and keys into 0..1 positions and DOM key codes and sends them every 16 ms on the control stream. The host sanitises every event (`core/screen/input.ts`), maps it to its own display, units and key codes, and injects it (`core/screen/inject.ts`):

| Host | How | Needs |
| --- | --- | --- |
| Linux (X11) | XTest through `xdotool`, one call per batch | `xdotool` installed |
| Linux (Wayland) | the xdg-desktop-portal RemoteDesktop portal (with ScreenCast) over D-Bus (`electron/services/screen/portal.ts`). The system asks once; Keeper keeps the restore token, so later sessions do not ask again. Without the portal, or if the person declines, the session is view-only with a clear message. | a desktop with the RemoteDesktop portal (GNOME 41+, KDE Plasma 5.27+) |
| Windows | a long-lived PowerShell that loads a few lines of C# for `SendInput` / `SetCursorPos` (per-monitor DPI aware), fed one JSON event per line. Ctrl+Alt+Del is reserved by Windows; the special-keys menu opens Task Manager instead. | — |
| macOS | the Keeper helper (`native/macos/KeeperHelper`, methods `input.*`) posting CGEvents | Accessibility (to control) and Screen Recording (to be seen) in System Settings → Privacy & Security; *Open macOS permissions* on the device page asks for both |

6. **Ending.** *Stop sharing* on the banner, *End* in the viewer, the Island's *Stop sharing*, the phone's *Stop watching*, 15 minutes without activity, Keeper quitting, or turning off *Remote screens* in Settings → Features. Both sides are told why. Each session is recorded locally ("Laptop controlled this screen for 12 min") under *Remote Access → Screen sessions*.

## In the viewer

Fit or actual size, full screen, quality, which screen (when the host has several), frames per second, data rate and delay, and view-only.

It also has:
- the keys your own computer would catch (Ctrl+Alt+Del, Alt+Tab or ⌘Tab, Start/Activities, Spotlight, show desktop, lock, screenshot);
- clipboard both ways (only when you may control);
- files dropped on the picture are sent through Link (the host accepts as usual);
- chat, which shows on the host's banner and in its Island;
- recording to a WebM file in Videos/Keeper on the viewer's computer.

## Session extras

All in the viewer's **More** menu and toolbar (feature *Remote screen extras*):

- **Displays:** one display, **all displays** (drawn side by side as arranged; clicks go to the display they land on), or **follow the pointer** (switches when the pointer stays on another display for 0.4 s); or **one window** only.
- **Sound** from the host: Windows loopback, a Linux PipeWire/PulseAudio monitor source, macOS 13+ through desktop capture (tried; may need Screen Recording). Others: off, with the reason shown.
- **Privacy:** *Darken their screen* — a black window that is excluded from capture (Windows 10 2004+, macOS); not possible on Linux, which says so. *Block their keyboard and mouse* — Windows `BlockInput`, which works only when Keeper runs elevated (or with the unattended service); macOS and Linux cannot, and say so.
- **Remote cursor:** the host's pointer is drawn on the picture while you are not controlling.
- **Drawing on the host screen** for teaching: strokes appear in a click-through overlay there; *Clear drawings* removes them.
- **Voice chat:** either side asks; the other turns it on from its banner (*Talk*). Audio goes over the same WebRTC connection.
- **Files:** a two-pane panel — their shared folders (copy here) and sending from here. **Print a file there** on their default printer (`lp` / `Start-Process -Verb Print`).
- **Invite another viewer** (view only): the host makes a one-time token, the first viewer passes it to a device paired with both; it watches until the session ends.
- **Switch sides** (the host starts viewing the viewer, under the viewer's own rules) and **Restart and reconnect** (with unattended access it comes back before login).
- **Picture:** codec preference (H.264, VP9, AV1), *Sharp text* (full resolution, content hint "text", high bitrate cap), and the graphics card's encoder where Chromium can use it.
- **Keys:** choose whether app switching, the Windows/Command key and F1–F12 go to the remote computer.
- **Tabs:** *In a Tab* on the device page (or *Open in a Keeper tab* for help) opens the screen as a Keeper tab, so several remote screens sit side by side in the main window's tabs.

The host's banner always shows who is watching, *Allow Control* / *Take Back Control*, and *Stop*. Active sessions and a waiting help code also show on the Island and in the tray, each with Stop.

## Help mode

For someone who is **not paired** (feature *Help mode*, off by default):

1. They press **Get help** (Devices → Remote Access, the tray, the Island, or the palette). Keeper shows a **9-digit session code** and a **6-character one-time password**, valid for **10 minutes** and **one helper**. Reachable on the same network (mDNS carries a short tag of the code), and over the internet through the relay (a one-time identity) and the tunnel; a sealed note on the Mailbox topic of the code says where, readable only with the code *and* the password.
2. The helper types both under **Help someone** (or opens a `keeper://help?code=…` "Ask for help" link, or uses a **web browser**: the *Helper Uses a Browser* address opens the phone/web page in help mode).
3. The session is **view-only**. The person being helped presses **Allow Control** on their banner, and **Take Back Control** at any time. **Stop** ends everything.
4. The helper gets the screen and chat only: no files, terminal, commands or ports, and no pairing. When it ends, the connection is closed and nothing is kept except the audit log line.

Handshake (`core/link/help.ts`): ephemeral X25519, the helper proves knowledge of code+password first with an HMAC over the transcript, then the host; traffic keys come from the X25519 secret and the code+password key; five wrong passwords end the code. About 60 bits of secret; someone in the middle who impersonates the host to the helper gets one HMAC they could attack offline, which at 60 bits and 10 minutes is out of reach in practice. The **browser** helper uses the companion channel with a key derived from code+password (no X25519 in the page's pure-JS crypto): over plain http on the local network a recorded session could be attacked offline; over the tunnel (https) it cannot.

## Unattended access

For your own devices (feature *Unattended access*, off by default). Devices → Remote Access → *Unattended access* installs a small system service through the administrator prompt. It needs one of your devices to already have *Control this computer* and *Let it in without asking* here. The service runs `dist-electron/linkd.cjs` (Keeper Link without the app); when Keeper starts, the service steps aside, and listens again after Keeper quits.

| System | What is installed | What works before login |
| --- | --- | --- |
| Linux | systemd system unit `keeper-link.service`, running as you | files, terminals, commands already allowed once, system details, restarts. Not the login screen (it belongs to the display manager). |
| macOS | LaunchDaemon `com.ashforde.keeper.link` running the daemon as you, plus the helper | the same. Showing the login window needs the helper as root and Screen Recording; macOS may block typing there. |
| Windows | service `KeeperLink` (LocalSystem), compiled on the PC from generated C# with the .NET Framework compiler that ships with Windows | the same, and the service follows session changes and starts Keeper's agent in the active session with `CreateProcessAsUser` — as the signed-in person, or as SYSTEM on the Winlogon desktop for the sign-in screen and UAC prompts. |

The daemon's key is kept in a file only your account can read (the system keychain is locked before login). New commands are refused while nobody is there to see them.

## Wake-on-LAN

When you connect to a device, Keeper asks it for its wired and Wi-Fi network cards (address and broadcast). *Wake* on its page then sends the magic packet (`core/screen/wol.ts`): from this computer, and through every other paired device that is awake, in case they share a network with the sleeping one. The sleeping computer must have Wake-on-LAN turned on in its firmware or network settings.

## Phones

- **A phone watching and using the computer.** The companion page (no app) has a *Screen* tab:
  - It asks the computer (which shows the same prompt and banner), then pulls JPEG frames over the companion's encrypted channel.
  - **Touch** clicks where you tap and drags where you drag. **Touchpad** moves the pointer by sliding, taps to click and scrolls with two fingers.
  - A long press is a right click.
  - There are buttons for the arrow keys (presentations), Esc, Enter, Backspace, play/pause and volume, and a box to type into.
- **Android on the computer.**
  - [scrcpy](https://github.com/Genymobile/scrcpy) 5.0.1 (Apache-2.0, with its own `adb`) is downloaded on first use.
    - Its SHA-256 is checked against the value pinned in `core/screen/mirror.ts` before it ever runs.
    - Those values were copied from the GitHub release's published asset digests; the download itself was not tried here.
    - There is no official build for Linux on ARM; install it from your package manager instead.
  - USB, or Wi-Fi with Android 11+ wireless debugging (pairing code and connect built in).
  - Options: view only, turn the phone's own screen off, record to MP4.
  - Dropping files on a phone installs `.apk` / `.apks` and pushes everything else to Download.
- **iPhone and iPad on the computer.** iOS allows other devices to show its screen through AirPlay, never to control it.
  - **macOS 12+:** the built-in AirPlay Receiver; Keeper opens its setting.
  - **Linux:** [UxPlay](https://github.com/FDH2/UxPlay) (GPL-3.0) from the package manager, started by Keeper as a separate program.
  - **Windows:** UxPlay (with Bonjour) has to be installed by hand first.

## Settings → Features

- **Remote screens** (needs *Keeper on your other devices*). Off: no session can start, and any running one ends at once.
- **Phones on this screen.** Off: phone windows close and the AirPlay receiver stops.

## What was tested, and how

- **Unit tests** (`test/screen.test.ts`):
  - the SDP fingerprint binding, including the certificate from `getStats`, and candidate filtering;
  - TURN and STUN entries;
  - the quality controller;
  - pointer mapping across displays, scales and letterboxing;
  - key codes for every OS;
  - the special combinations;
  - event sanitising and coalescing;
  - the exact `xdotool`, SendInput and CGEvent commands;
  - the consent rules and idle timeout;
  - frame encoding, splitting at any chunk boundary, and flow control;
  - magic packets and broadcast addresses;
  - scrcpy, adb and UxPlay arguments and pins.
- **End to end** (`test/e2e/remote-screen.cjs`): two real Keeper apps on one Linux machine under Xvfb, plus an emulated iPhone browser. All 23 checks pass:
  - **Refusals and consent:**
    - without permission the request is refused with the reason;
    - with it, the desk asks;
    - the banner names the viewer.
  - **The picture:**
    - it arrives over **direct WebRTC** (1600×900);
    - it changes when the desk's screen changes;
    - the laptop's pointer moves the desk's pointer to the right spot;
    - a click from the viewer opens a page on the desk.
  - **Ending:**
    - *Stop sharing* ends it on both sides, and it is logged;
    - *Let it in without asking* skips the prompt.
  - **The fallback:** frames through Keeper Link arrive at about 11 fps.
  - **The phone:** asked, it sees the desk's screen, and its tap moves the desk's pointer there.
  - No page errors.
- **A note on clicks in the test:** both apps share one X display there. A press inside the viewer window itself makes Chromium grab that display's pointer, so the test sends its click through the viewer's own input path. As with a real mouse, the first click on an inactive window only brings it forward.

### Keeper-to-Keeper remote access (this round)

- **Unit tests** (`test/k2k.test.ts`, 50 tests; `test/k2k-node.test.ts`, 10 tests with two real Link nodes): STUN, the UDP path, resuming across carriers, candidates and scope, help codes / links / notes / handshake (right and wrong password), the browser's help key matching the app's, permissions, audit log and CSV export, fleet search, power / print / shell commands, the systemd unit, LaunchDaemon, Windows service source and their exact install and removal commands, the Wayland portal's requests and key codes, session extras (displays, codecs, encoding, sound, privacy, strokes, invites, shortcuts), tray / Island placement, and location; with two nodes: relay → direct → file → fallback, run-commands refused / shown once / allowed, a terminal over Link, the ssh-proxy pipe, help over a relay and mailbox with only the screen reachable, location only with its permission.
- **End to end** (`test/e2e/remote-advanced.cjs`): three real Keeper apps (desk, laptop, tablet) on one Linux machine under Xvfb, with a local relay and Link told not to use the local network. All 41 checks pass:
  - the relay is replaced by a direct UDP path; a 4 MB file goes over it; the device page says "Direct";
  - help mode: 9-digit code and password, a wrong password refused, view-only, *Allow Control* gives control, *Take Back Control* removes it, *Stop* ends it on both sides, no pairing made;
  - a web browser helps with the code and password and gets control when given;
  - a second viewer (the tablet) joins the laptop's session view-only and gets the picture; it ends with the first;
  - a terminal on the desk from the laptop (refused first without permission);
  - `keeper remote exec` refused without *Run commands*, then shown to the owner, run, and the next time run without asking;
  - `keeper remote ssh-proxy` pipes bytes; `keeper remote list`;
  - the audit log on both sides (help, screen, file, command — also the refused one — terminal, port);
  - *Get Help* in the palette. Screenshots in light and dark.
- `test/e2e/remote-screen.cjs` (23) and `test/e2e/link.cjs` (27) still pass; `test/e2e/perf-budget.cjs` idle budget passes.

**Not verified here (this round):**
- direct UDP across real routers and with public STUN; symmetric NATs;
- the Wayland portal (no portal in this test machine);
- sound capture, darkening and input blocking (Windows/macOS-only parts), voice chat with real microphones, AV1/H.264 hardware encoders, "all displays" and "follow the pointer" with real multiple monitors, window-only capture;
- printing (no printer here), lock / sleep / restart and restart-and-reconnect (they would end the test machine's session);
- installing the unattended service (needs an administrator: only the generated files and commands are tested), the Windows service compile and CreateProcessAsUser, the macOS LaunchDaemon and helper as root;
- the Island and tray entries were checked by unit tests and screenshots of the pages; the native tray menu itself cannot be captured;
- the phone's Terminal tab and location sharing were not run in a browser (location needs https or localhost and Places & Tracks' phone source switched on);
- Mac and Windows overall.

**Not verified here:**
- macOS and Windows input injection, and the macOS helper's `input.*` methods (Swift, not compiled here).
- Screen Recording and Accessibility prompts.
- Multi-monitor hosts.
- WebRTC across real NATs with STUN or TURN.
- Wake-on-LAN on real hardware.
- The scrcpy download and a real Android phone.
- UxPlay and a real iPhone.
- Real phone browsers (only Chromium's iPhone emulation).
