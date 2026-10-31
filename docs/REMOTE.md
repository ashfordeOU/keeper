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
| Linux (Wayland) | not possible: Wayland lets apps inject input only through the RemoteDesktop portal's own dialog, which Keeper cannot show yet. The screen can be watched. | — |
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

**Not verified here:**
- macOS and Windows input injection, and the macOS helper's `input.*` methods (Swift, not compiled here).
- Screen Recording and Accessibility prompts.
- Multi-monitor hosts.
- WebRTC across real NATs with STUN or TURN.
- Wake-on-LAN on real hardware.
- The scrcpy download and a real Android phone.
- UxPlay and a real iPhone.
- Real phone browsers (only Chromium's iPhone emulation).
