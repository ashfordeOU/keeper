# Keep Awake

Keep Awake stops the computer from sleeping while you need it. When the session is over, the computer sleeps normally again. Open it from **System → Keep Awake**, the Island, the tray, the command palette, the global shortcut, `keeper awake`, `keeper://awake` links, or Siri and Shortcuts on macOS.

Settings → Features → **Keep awake** turns the whole feature on or off. When it is off:

- any running session ends;
- every hold is released;
- the regular check stops;
- the page, the Island controls, the tray entry, the menu-bar icon and the palette commands all go away.

## What is where

| Part | File |
|---|---|
| Rules: sessions, "while" conditions, triggers, per-OS commands, closed-lid safety, statistics, durations | `core/awake-engine.ts` (pure, unit-tested in `test/awake.test.ts`) |
| Service: facts, holds, closed-lid mode, Focus, sounds, pointer nudge, triggers, statistics file, restore after a crash | `electron/services/awake/index.ts` |
| IPC, CLI method `keeper/awake`, `keeper://awake` links, the separate menu-bar icon | `electron/ipc/awake.ts` |
| Page | `src/screens/KeepAwake.tsx` (demo data in `src/mock-awake.ts`) |
| Island: time left, +15 min / +1 h, stop | `src/island/Island.tsx`, `src/island/Activities.tsx` |
| Siri and Shortcuts (macOS) | `native/macos/KeeperIntents/Sources/Intents.swift` |
| End-to-end check (real app, Linux) | `test/e2e/awake.cjs` |

## How the computer is held awake

| System | What Keeper holds | Shows up in |
|---|---|---|
| All | Electron `powerSaveBlocker`: `prevent-display-sleep` keeps the screen on; `prevent-app-suspension` lets the screen sleep | the system's own list |
| macOS | also `caffeinate -i [-d] -m -w <Keeper's pid>`. It ends the moment Keeper's process ends. | `pmset -g assertions` |
| Windows | also a hidden PowerShell holding `SetThreadExecutionState(ES_CONTINUOUS \| ES_SYSTEM_REQUIRED [\| ES_DISPLAY_REQUIRED])`. It exits when Keeper's process ends. | `powercfg /requests` (administrators) |
| Linux | also `systemd-inhibit --what=sleep[:idle][:handle-lid-switch] --who=Keeper --mode=block` | `systemd-inhibit --list` |

If the extra hold cannot run, the Electron hold still keeps the computer awake. That happens when there is no systemd, no system bus, or the hold is refused. The status shows which holds are in place.

**What keeps this computer awake** lists every app's holds, not only Keeper's. Where the system will not list other apps, the page says so and shows Keeper's own hold. That is the case on Windows without administrator rights, and on Linux without a system bus.

## Closed-lid mode

| System | How | Put back by |
|---|---|---|
| macOS | `pmset -a disablesleep 1`. One administrator prompt adds `/etc/sudoers.d/keeper-awake`, which allows only `pmset -a disablesleep 0` and `pmset -a disablesleep 1` for you, without a password. The file is checked with `visudo -cf` first. | the end of the session; a watchdog shell that runs `disablesleep 0` as soon as Keeper's process is gone; and on the next start, from the restore record |
| Windows | `powercfg /setacvalueindex` and `/setdcvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0`. The values from before are read first with `powercfg /q`. | the end of the session; a hidden PowerShell watchdog; and on the next start, from the restore record |
| Linux | `systemd-inhibit --what=…:handle-lid-switch` while the session runs | the inhibitor ends with the session, so there is nothing to restore |

Closed-lid mode ends by itself, while the session goes on:

- below the closed-lid battery level (20% by default), or below the session's own battery limit if that is higher;
- in Low Power Mode;
- when the thermal state is serious or critical.

The restore record is `awake-restore.json` in Keeper's data folder.

## Resources

- **Idle**: nothing runs while no session is on and no trigger is enabled. There is no timer, no child process, no file watcher and no polling. The end-to-end test checks this through the governor's list of checks.
- **During a session**: one check every 15 seconds, or every 5 seconds in the last 90 seconds. There is also one small hold process.
- **With triggers enabled**: one check every 30 seconds, and less often while you are away. Each check gathers only the facts its conditions need. For example, it does not list running apps unless a condition names an app.
- **Events instead of polling**: power source changes, sleep, thermal state changes and displays being connected or removed all trigger a check straight away.

Each feature in Settings → Features shows what it has running now, for example "Keep awake: check every 15 s".

## Parity with dedicated keep-awake utilities

The comparison below lists the features of a full-featured dedicated keep-awake menu-bar utility, reviewed menu by menu, and says where Keeper stands on each one.

What each status means:

- **Built** means the code is in Keeper.
- **Verified** means it is checked by the unit tests (`test/awake.test.ts`), the real-app end-to-end test on Linux (`test/e2e/awake.cjs`), or both.
- **Not verified on hardware** means the code is there but has not been run on that system here.

### Sessions

| Capability | Keeper | Status |
|---|---|---|
| Start and stop with one click | The owl on the page, the Island button, the tray, the menu-bar icon (left click), the shortcut, the palette | Built; verified with E2E on Linux |
| Indefinitely | "Until you turn it off" | Built; verified |
| For a set time | An editable list of quick durations, plus typed durations (`30m`, `1h30m`, `2 hours`, `90`) | Built; verified (unit tests; E2E covers a timed session) |
| Until a time of day | `18:30`, `6:30 pm`, `until 9:00 am` (rolls over to tomorrow) | Built; verified (unit tests) |
| Extend a running session | +15 / +30 / +60 min on the page, +15 min / +1 h in the Island, "Add…" in the menu, `keeper awake extend --for 30m` | Built; unit-tested (`extend`) |
| While an app is running | `app` | Built; verified with E2E (a stand-in app) |
| While an app is in front | `appFront` | Built; unit-tested |
| While a file downloads | `file`: a partial-download file exists, or the file is still growing | Built; unit-tested |
| While a folder keeps changing | `folder`: the folder and the entries one level down | Built; unit-tested |
| While the processor, or one process, is busy | `cpu`, with a threshold; per process on macOS and Linux | Built; unit-tested. Windows uses the total only |
| While sound is playing | `audio`, from the Island's now-playing | Built; unit-tested |
| While the network is busy | `network`, with a bytes-per-second threshold (Linux `/proc/net/dev`, macOS `netstat -ib`, Windows `Get-NetAdapterStatistics`) | Built; unit-tested |
| While an external display, drive, USB device or Bluetooth device is connected | `display`, `drive`, `usb`, `bluetooth` | Built; unit-tested |
| While on power, on a Wi-Fi network, or connected to a VPN | `power`, `wifi`, `vpn` | Built; unit-tested |
| While a terminal or AI agent works | `agent` | Built; unit-tested. Counts the coding assistants the Island watches; terminal sessions are not counted yet |
| While Keeper is busy (sync, backup, download) | `job` | Built; unit-tested |
| Grace period before a "while" session ends | 30 seconds | Built; unit-tested |
| Session started by a link, the CLI or Siri | `keeper://awake?for=30m&app=Zoom`, `keeper awake on --for 2h --while-app Zoom`, Shortcuts actions "Keep the Mac Awake", "Let the Mac Sleep Again" and "Turn Keep Awake On or Off" | Built. The CLI and link mapping are unit-tested. Siri intents are not verified on hardware |

### What a session allows

| Capability | Keeper | Status |
|---|---|---|
| Let the display sleep while the computer stays awake | "Let the screen sleep" (`prevent-app-suspension`) | Built; verified with E2E (the trigger's option switches the hold type) |
| Allow the screen saver after N idle minutes | The display hold is released after N minutes without input; the system's own screen saver and lock then apply | Built; unit-tested (`evaluate` → `screenSaverNow`) |
| Closed-lid mode, with or without an external display | See above | Built. The safety rules are unit-tested. Not verified on hardware: macOS, Windows, and Linux with a system bus |
| End below a battery level | 0–50% | Built; unit-tested |
| End in Low Power Mode or when hot | `endOnLowPowerOrHeat` | Built; unit-tested. Thermal state is reported on macOS. Low power comes from the governor wherever the system reports it |
| End when you put the computer to sleep | `powerMonitor` `suspend` | Built; not exercised in E2E (the test machine cannot sleep) |
| Only while plugged in | `onlyOnPower` | Built; unit-tested |
| Keep drives from spinning down | Writes a tiny hidden file on each chosen drive every N seconds | Built |
| Move the pointer now and then | One point and back, through the remote-control injector: xdotool, SendInput, or the helper's CGEvent | Built; not verified on hardware. Needs Accessibility on macOS. Not possible on Wayland without X11 |
| Do Not Disturb / Focus during a session | macOS runs two Shortcuts you name. GNOME turns notification banners off and puts them back after the session, or on the next start after a crash | Built for macOS and GNOME. **Not built** for Windows Focus Assist (no public API) or KDE |
| Notifications at start, end and before the end | Island alert; reminder N minutes before the end | Built |
| Sounds at start and end | System sounds: `afplay` on macOS, `canberra-gtk-play` on Linux, the system beep on Windows | Built |
| Lock the screen when a session ends | `pmset displaysleepnow` on macOS; `LockWorkStation` on Windows; `loginctl lock-session`, then `xdg-screensaver lock`, on Linux | Built; not verified on hardware |
| Defaults for new sessions | "What every session does" | Built |

### Triggers

| Capability | Keeper | Status |
|---|---|---|
| Start and end sessions automatically | Triggers. A trigger's session ends when it stops matching | Built; verified with E2E (an app trigger starts and ends a session) |
| Several conditions, all or any, and negation | `match: all \| any`, and `not` on each condition | Built; unit-tested |
| Priority between triggers | Order in the list (↑). The highest matching trigger's options apply | Built; unit-tested |
| Don't restart right after a manual stop | "After I turn its session off, wait N minutes"; 0 = until its conditions change | Built |
| Test a trigger | "Would it match now?", with each condition marked ✓ or ✗ | Built; verified with E2E |
| Enable or disable each trigger | A switch on each trigger, on the page and in the menu-bar menu | Built; verified with E2E |
| Schedule (days and times, across midnight) | `schedule` | Built; unit-tested |
| Battery level, charging, power source | `battery`, `power` | Built; unit-tested |
| App running or in front, process CPU | `app`, `appFront`, `cpu` | Built; unit-tested |
| Wi-Fi, IP address (CIDR, wildcard), DNS server, VPN | `wifi`, `ip`, `dns`, `vpn` | Built; unit-tested |
| External display, display mirroring | `display`, `mirroring` | Built; unit-tested |
| USB device, Bluetooth device, drive | `usb`, `bluetooth`, `drive` | Built; unit-tested |
| Idle time | `idle` | Built; unit-tested |
| Sound playing, sound output (for example headphones) | `audio`, `audioOutput` | Built; unit-tested. Sound output is read on macOS and Linux only |
| Calendar event in progress | `calendar`, from Keeper's calendars | Built; unit-tested |
| Download in progress, Keeper job, AI agent or terminal | `downloads`, `job`, `agent` | Built; unit-tested |
| Older Island keep-awake rules | Carried over once into triggers | Built; unit-tested |

### Seeing and controlling it

| Capability | Keeper | Status |
|---|---|---|
| Menu-bar icon with on and off states | Optional separate icon in five styles, drawn at run time (`core/awake-icons.ts`). The default is Keeper's owl, the app icon's keyhole owl: eyes open while awake, closed while the computer may sleep; a template image on macOS (with @2x), Keeper's gradient on Linux and Windows. Cup, eye, bolt and moon remain to choose from; an older default cup moves to the owl once. Keeper's own menu-bar icon shows the time left (or "Awake") as plain text beside it. Left click toggles; right click opens the menu | Built. The E2E switches it on and off without errors; the tray is not visible under Xvfb. Icon drawing checked by rendering the five styles |
| Time left in the menu bar | Next to the icon on macOS, updated every 30 seconds while a timed session runs | Built; not verified on hardware |
| Menu: durations, "while…", triggers, display sleep, settings | The right-click menu of the separate icon; the Keep Awake submenu of Keeper's tray menu | Built |
| Global shortcut | The Island's keep-awake shortcut (default ⌘⇧A / Ctrl+Shift+A) | Built |
| Live activity with time left | The Island's "Staying awake · 0:42 left", the Home tile and the activity card (+15 min, +1 h, Stop) | Built; verified with E2E |
| Who else keeps the computer awake | `pmset -g assertions`, `powercfg /requests`, `systemd-inhibit --list` | Built. Parsers unit-tested; Linux E2E (no system bus here, so it shows Keeper's own hold with the reason) |
| Statistics | Sessions, total, longest, average, the last 7 days, why each session ended, battery used on battery; reset; switch off | Built; verified with unit tests and E2E (records "Time is up") |
| Scripting | `keeper awake …` (JSON with `--json`), `keeper://awake…`, Shortcuts / Siri | Built. An AppleScript dictionary is **not built**; Shortcuts and links cover the same actions |
| Start at login | Keeper's own "Start at login" | Built (shared with Keeper) |

## Command line

```bash
keeper awake on
```

```bash
keeper awake on --for 2h
```

```bash
keeper awake on --until 18:30 --allow-display-sleep
```

```bash
keeper awake on --while-app "Final Cut Pro" --closed-lid
```

```bash
keeper awake on --while-file ~/Downloads/big.iso
```

```bash
keeper awake extend --for 30m
```

```bash
keeper awake off
```

```bash
keeper awake status --json
```

```bash
keeper awake blockers
```

## Links

| Link | Effect |
|---|---|
| `keeper://awake` | Keep awake until you turn it off |
| `keeper://awake?for=45m` | For 45 minutes |
| `keeper://awake?until=18:30` | Until 18:30 |
| `keeper://awake?app=Zoom` | While Zoom runs |
| `keeper://awake?minutes=60` | For 60 minutes (the older link form; still works) |
| `keeper://awake/off` or `?do=off` | Stop |
| `keeper://awake/toggle` | Start or stop |
| `keeper://awake/extend?for=15m` | Add 15 minutes |
