# Testing Keeper on a Mac

Much of Keeper's macOS code has never run on a real Mac. This includes the
notch Island, closed-lid Keep Awake, Stage's setting changes, keeper-helper,
Voice's event tap and system sound, Find My, Apple Notes and the pf firewall
(see the "not verified" sections in the other docs). One command tests all of
it on a Mac and packs the results into a single file to send back.

```
git clone https://github.com/ashfordeOU/keeper && cd keeper && ./scripts/mac-test/run.sh
```

For a 15-minute smoke test, add `--quick`.

## What you need

- A Mac with macOS 13 or later. Apple silicon or Intel both work. A MacBook with a notch tests the most.
- **Xcode Command Line Tools.** If they are missing, the script tells you to run `xcode-select --install` and stops.
- **Node.js 22 or later.** If it is missing, the script stops and names the two ways to get it: the macOS installer from nodejs.org, or `brew install node@22 && brew link --overwrite --force node@22`.
- 6 GB of free disk space and an internet connection. The run downloads Keeper's packages and, in a full run, the small speech model (about 75 MB).
- Ideally, the power adapter and about an hour.

## How long it takes

| | Setup (first time) | Tests | Total |
|---|---|---|---|
| `--quick` | 5–8 min (npm ci, build, Swift builds) | about 8 min | **about 15 min** |
| full | 5–8 min | 45–55 min, including the steps you do | **about 60 min** |

Each question waits a few minutes and then moves on, so the run finishes even if you walk away.

## Options

| Option | What it does |
|---|---|
| `--quick` | The smoke subset: Island, Keep Awake, Stage (Dock and alert volume, plus the crash test), keeper-helper, Voice (no model download), monitor, usage payload and a short idle measurement |
| `--only island,stage` | Only these areas. `--list` shows them all |
| `--only permscreen` | Keeper's own Permissions screen: Keeper opens Settings → Permissions, you press **Allow all** and answer macOS's questions, and the run records which permissions became allowed, which need a restart and which were left (see [PERMISSIONS.md](PERMISSIONS.md)) |
| `--skip notes,firewall` | Every area except these |
| `--record` | Also records the screen to a video, with ffmpeg if installed or `screencapture -v` otherwise. Off by default; it stops at the end |
| `--no-guided` | Automatic checks only, with no questions |
| `--no-screen` | No whole-screen pictures. Pictures of Keeper's own windows are still taken |
| `--out <folder>` | Where the .zip goes. The default is your Desktop |
| `--skip-build` | Reuses `node_modules` and the existing build |
| `--keep-temp` | Keeps the throwaway home folder afterwards, for debugging |
| `--dry-run` | Proves the flow without a Mac. macOS commands answer from `scripts/mac-test/fixtures`. Add `--real-app` on Linux, under xvfb, to also drive the real Keeper |

## What it tests

**Setup** (recorded as checks): the prerequisites, `npm ci`, Playwright (`playwright-core`, installed with `--no-save` the way CI installs it), `npm run build`, keeper-helper (`swift build -c release`), Keeper Intents and the test's own probe.

Keeper Intents is an Xcode project, not a Swift package, so `swift build` cannot build it. With full Xcode and XcodeGen already installed, the script runs its `build.sh`. Otherwise it only type-checks the sources with `swiftc` and says so.

**Automatic checks.** Keeper is driven with Playwright's Electron support, with `KEEPER_SKIP_TOUR=1`:

- **The Mac:** macOS version, model, chip, memory, displays, battery, and the real notch position from `NSScreen.auxiliaryTopLeftArea` and `auxiliaryTopRightArea`. Also two safety checks: every Electron folder is inside the throwaway home, and a test of whether `defaults` follows `$HOME`.
- **Island:** placement on each screen. The notch geometry is compared with macOS's own numbers (within 2 pt), along with menu-bar avoidance and pictures of the Island collapsed and open.
- **Keep Awake:** the caffeinate hold in `pmset -g assertions` and its release, the statistics and blockers, and the menu-bar area pictured.
- **Stage:** each switch on and off: Dock, menu bar, desktop icons, alert volume, hiding other apps, pointer size, keep awake, backdrop, spotlight, clicks, keystrokes, clipboard, private items and keep-out-of-recordings. Every value is read with `defaults` and `osascript` before, during and after. A crash test kills Keeper while Stage is on, and the watchdog must restore everything. Then the next start is checked, and finally the resolution switch through keeper-helper, which is asked first.
- **keeper-helper:** `hello` (version), `input.status`, `notifications.status`, `calls.micApps` and `calls.muted`, `hud.levels`, `desktop.getImage`, `voice.micState` and `voice.focus`, `stage.modes`, `stage.windows` and `stage.cursorSize`, `ddc.list`, `language`, and `input.move` (one point and back, with Accessibility).
- **Calendar:** `calendar.access` (no prompt), then `calendar.events` for two weeks: how many calendars, accounts, colours and events (all-day, repeating, with a meeting link). Only counts are kept: no titles, places or people. Keeper's own list must then hold the Mac's calendars.
- **Voice:** the talk-key event tap starts, and ScreenCaptureKit captures sound while a system sound plays. In a full run, Keeper also downloads the tiny Whisper model and checks it against its pinned hash, then transcribes a sentence spoken by macOS's `say`.
- **Monitor:** Keeper's live readings, energy per app, sensors, codesign and lsof process details, and the menu-bar readings. The raw output of `top`, `ioreg`, `pmset`, `vm_stat`, `netstat` and `nettop` is saved for the parsers. App Nap is only read.
- **Remote desktops:** the clients found and the command an .rdp connection runs (macOS has no mstsc). If Screen Sharing is on, the Mac's own VNC greeting is read. Also a .vnc import.
- **Places & Tracks:** detection of the Find My cache: the macOS version and whether the files are readable or encrypted. Only counts are kept, and nothing is ever decrypted.
- **Notes:** Bear's database, if installed (a private copy, read for counts only).
- **Keeper Link and the mesh:** Link starts on the local network and `dns-sd -B _keeper._tcp` must see it. The mesh plan for macOS is built and every program it names must exist. The mesh state is read.
- **Firewall:** Keeper's pf rules for a sample rule set are parsed with `pfctl -n`. Nothing is loaded or blocked.
- **Ambience:** the live wallpaper window at the desktop level, pictured, and a folder icon set on a throwaway folder and restored.
- **Settings catalogue:** every macOS entry is read, and the ones whose command fails on this macOS version are listed.
- **Security center, quick controls and app controls:** read-only probes.
- **Usage stats:** the payload as this Mac would send it (form factor, GPU, notch), shown and never sent. Keeper's endpoint is a stand-in server on this computer for the whole run.
- **Performance:** start-up time, then idle processor and memory of all Keeper processes after a settle period (2 min plus 1 min measured; 30 s plus 20 s with `--quick`).

**Guided steps.** Each can be skipped, and macOS's `say` cues you only when it is time to speak:

- **Permissions:** Screen & System Audio Recording, Accessibility, Input Monitoring, Microphone and Full Disk Access. The right System Settings page opens for each. Automation for Notes is asked when the Notes test runs.
- **Visual checks:** does the Island sit around the notch without covering anything? With an app with long menus, does it hang below the notch instead? With an external display, if you have one, is there an Island on it too? Is the live wallpaper behind your windows?
- **Keep Awake:** do you see the owl and the time left in the menu bar? With your yes, closed-lid mode: its one-time setup (password), closing the lid for 20 seconds, and the watchdog after Keeper is killed.
- **keeper-helper:** a notification from another app, a call or recording using the microphone, and a few key presses.
- **Calendar:** allowing calendar access when macOS asks; changing any event in the Calendar app while the helper listens for the change notice; and, with your yes, one test event added tomorrow at 06:00 and removed again.
- **Voice:** reading a sentence aloud for a level reading (through Keeper's window and through the probe), and holding the talk key to dictate it.
- **Remote desktops:** optionally, opening the test .rdp file in your Remote Desktop app.
- **Notes:** Apple Notes listed through Keeper's own reader. Only the number of notes is kept.
- **Mesh:** installing the mesh helper is optional. From a source checkout, Keeper is expected to refuse, because it must be in /Applications.
- **Ambience:** optionally, the still picture written to the system desktop and restored.

## What it changes, and how it is put back

Nothing changes without a yes. Before each change, the run shows exactly what will change and how it will be put back. The undo command is written to a list before the change is made.

| Change | When | Put back by |
|---|---|---|
| Dock and menu-bar auto-hide, desktop icons (Finder restarts), alert volume, pointer size, hidden apps | Stage, after your yes | Stage itself; then each value is written back as read before, and checked |
| Screen resolution, for about 5 seconds | Stage, after a second yes | Stage itself, or keeper-helper `stage.setMode` back to the original mode |
| `/etc/sudoers.d/keeper-awake` (allows only `pmset -a disablesleep 0/1`) and sleep turned off | Closed-lid test, after your yes and password | `pmset -a disablesleep 0` and `sudo rm` of the file (password asked in the terminal); checked with `pmset -g` |
| Mesh helper LaunchDaemon `org.ashforde.keeper.meshd` | Only after your yes; normally refused from a checkout | `launchctl bootout`, then its plist and helper are removed |
| Desktop picture on each screen | Ambience still picture, after your yes | Keeper's restore, then each screen is set back to the picture read before. A dynamic or aerial wallpaper may come back as its still picture |
| Custom icon on a throwaway folder | Ambience | Keeper's restore; the folder is deleted with the throwaway home |
| `keeper://` handled by the test copy of Electron | Every start of Keeper (it registers itself) | Removed when Keeper closes, and `lsregister -u` on the test copy |
| Permissions given to your terminal app | Your choice at each step | Not undone automatically. Remove them in System Settings → Privacy & Security if you like |

Afterwards, the cleanup checks each item and lists it in the report: Keeper and keeper-helper closed, no caffeinate or Stage watchdog left, sleep setting, sudoers file, LaunchDaemon, Stage values, desktop pictures, and your own Keeper data untouched (compared with a fingerprint taken at the start).

If the run is stopped with Ctrl-C, it skips the remaining checks, closes Keeper, puts everything back and packs what it has. If the driver itself dies, the `run.sh` trap runs whatever is left on the undo list, newest first, and packs a `-partial.zip`. A second Ctrl-C leaves the packing to `run.sh`.

## Your data stays yours

- Keeper runs with a **throwaway home folder**. `HOME` points into a temporary folder. `sandbox-paths.cjs` is loaded with `NODE_OPTIONS=--import` before Keeper's code and moves every Electron path into it (home, app data, Documents, Downloads, logs, crash dumps), because macOS ignores `$HOME` for those paths. `--user-data-dir` is passed as well.
- **Before Keeper starts,** a tiny app with Keeper's name is started the same way and reports every folder. If any is outside the throwaway home, Keeper is not started. Each real launch checks again and stops Keeper at once if a path is wrong.
- Apple Notes, Bear and Find My are **read only**. Only counts are recorded, never titles, text or positions. The Notes script's output is never logged.
- Usage stats go to a **local stand-in server**. Nothing is sent.

## What is in the file you send back

`~/Desktop/keeper-mac-test-<date>-<time>.zip`, or `…-partial.zip` after an interrupted run:

| | |
|---|---|
| `report.md` | Pass, fail or skip for every check, by area; the failures in full; what was changed and whether it was put back |
| `results.json`, `results.schema.json` | The same, for machines, with its JSON Schema (`scripts/mac-test/src/schema.ts`) |
| `system/` | `sw_vers`, `system_profiler` (displays, hardware, power), `pmset` |
| `shots/` | Pictures of Keeper's own windows |
| `screen/` | Whole-screen and menu-bar pictures (`screencapture -x`), if you allow them |
| `video/` | The screen recording, only with `--record` |
| `data/` | Raw output per check |
| `logs/` | Every command the run ran, the driver's log, Keeper's output and logs, keeper-helper's errors, the setup logs, and macOS crash reports for Keeper, Electron or keeper-helper from this run |

Before packing, every text file is **scrubbed**. Your user name, full name and home folder (shown as `~`), computer names, serial numbers (Mac and battery), hardware UUID and UDID, MAC addresses and email addresses are replaced. File names are cleaned too.

Pictures, video and crash dumps cannot be scrubbed. The run shows what is inside and asks whether to include the screen pictures, the video and the crash dumps (dumps are left out unless you say yes).

**Sending it back:** attach the .zip in our chat. If it is too large, upload it to a draft release on GitHub (Releases → Draft a new release → attach), or encode it as text for a secret gist: `base64 -i file.zip -o keeper-mac-test.b64 && gh gist create keeper-mac-test.b64`.

## Troubleshooting

- **"Please install Apple's command line tools" or "Node.js 22 or later":** install what it names, open a new Terminal window, and run the command again.
- **Screen pictures show only the wallpaper:** Screen Recording was allowed but macOS applies it only after the terminal app restarts. Quit Terminal (⌘Q), open it, and run with `--skip-build`.
- **macOS asks to "find devices on your local network":** allow it, for the Link and mDNS check.
- **A permission prompt names "Terminal" (or iTerm), not Keeper:** that is expected. From a source checkout, macOS gives the permissions to the app that started it.
- **`npm ci` or the build fails:** see `logs/npm-ci.log` and `logs/build.log` in the zip. The run continues with the checks that do not need Keeper.
- **The keeper-helper or probe build fails:** the checks that need them are skipped, with the reason. `logs/helper-build.log` and `logs/probe-build.log` say why.
- **Something was not put back:** the end of the run and `report.md` say what. Every change is also listed in `logs/undo.tsv`; each line ends with its restore command in base64. Run it with `/bin/sh -c "$(echo <base64> | base64 --decode)"`.
- **Stopped it by accident:** run it again. Use `--skip-build` to save the setup time, and `--only` for the areas still missing.

## For developers

- Entry: `scripts/mac-test/run.sh`. It is written for macOS's bash 3.2 and passes `shellcheck`. It does the prerequisites and builds, bundles `scripts/mac-test/src/main.ts` with esbuild, and runs it in the background with the terminal as its input. It owns the trap.
- Driver: `src/main.ts` (flow, cleanup, packing), `src/areas/*.ts` (one file per area), `src/context.ts` (recorder and undo journal), `src/app.ts` (Playwright), `src/helper.ts` (keeper-helper JSON lines), `src/scrub.ts`, `src/report.ts`, `src/schema.ts`, `src/pack.ts`.
- `probe.swift` (screens and notch, TCC state, permission requests, microphone level, desktop pictures) is built with `swiftc` at the start of a run.
- Check: `npx tsc --noEmit -p scripts/mac-test`, `npx vitest run test/mac-harness.test.ts`, `shellcheck scripts/mac-test/run.sh`, and on Linux `./scripts/mac-test/run.sh --dry-run --quick --out /tmp/x` (add `--real-app` under `xvfb-run` to drive the real app).
- In a dry run the macOS answers are fixed, so checks that need a state change, such as the Stage values, fail. That is expected: the dry run proves the flow, the report, the undo and the zip.
