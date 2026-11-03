<!-- SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0 -->
# Stage mode

Stage gives you a clean screen for recording, presenting and screenshots. It hides desktop icons, the Dock or taskbar and other apps. It turns on Do Not Disturb, mutes alert sounds and pauses music. It can show a clean backdrop, a pointer spotlight, click ripples and keystrokes, keep the computer awake, switch the screen to a recording resolution, and keep private things out of the Island. Every switch is its own toggle. Presets group them: **Recording**, **Presenting**, **Screenshot**, and your own.

When Stage ends, everything is put back, newest change first. That includes after a crash. If you changed a setting yourself while Stage was on, it is left the way you set it.

## Where it lives

Stage works across the whole system. The page in the main window holds the presets and settings.

| Surface | What it does |
|---|---|
| **Global shortcut** (default ⌘⌥⇧R / Ctrl+Alt+Shift+R) | Starts or stops the preset marked "Shortcut". Each preset can also have its own shortcut. |
| **Island** | A Stage button in the top row, and a Stage tile in Controls with the other presets. While Stage is on, the live activity shows a red dot, the preset, the elapsed time and **Stop**. A countdown shows "Stage in 3…". |
| **Tray / menu bar** | A Stage submenu with every preset. While Stage is on, it shows "● Stage: Recording · 4 min" with **Stop Stage** and **Add 15 minutes**. |
| **Overlays** | The countdown, spotlight, click ripples, keystrokes and the display-key level. These are transparent, click-through windows, one per screen. |
| **Backdrop** | One window per screen at the desktop level, under every app. |
| **Command palette** | Stage: Recording / Presenting / Screenshot, Stop Stage, and the Stage page. |
| **Command line** | `keeper stage on|off|toggle|status|extend|presets|journal|detect|support [--preset Recording] [--now]` and `keeper display list|set|inputs|input|up|down`. |
| **Links** | `keeper://stage/on?preset=recording`, `keeper://stage/off`, `keeper://stage/toggle`. |
| **AI abilities** | `stage_status` (allowed), `stage_start` (asks first), `stage_stop`, and `display_input` (asks first). |
| **Page** (System → Stage) | Presets and every switch, how each switch works on this system, starting options, auto-start, "What does Keeper see now?", stays-on-screen apps, and external monitors. |

On the Stage page you choose which surfaces Stage appears on: tray, Island and shortcut.

**Features.** Each feature has a switch under Settings → Features:

- **Stage mode** is on by default. Nothing runs until you start it.
- **Stage: start when the screen is captured** is off by default.
- **Display keys** is off by default.
- **Draw on screen** is on whenever Stage mode is (it has only a shortcut until you press it).

## Switches, per system

✅ built · 🟡 works with limits · ↗ Keeper shows you where to change it · ❌ not possible

| Switch | macOS | Windows | Linux |
|---|---|---|---|
| Hide desktop icons | ✅ `CreateDesktop` (Finder restarts once) | ✅ the desktop's own "Show desktop icons" toggle (`SHELLDLL_DefView` 0x7402) | 🟡 GNOME desktop-icons extension (`ding`, `gtk4-ding`) and Xfce; KDE keeps its desktop |
| Hide the Dock or taskbar | ✅ System Events `autohide of dock preferences` | ✅ `SHAppBarMessage(ABM_SETSTATE, ABS_AUTOHIDE)` | 🟡 GNOME and Ubuntu docks (`dock-fixed`, `autohide`), KDE panels (Plasma script), Xfce panel |
| Hide other apps | ✅ System Events `visible` (like ⌥⌘H). Restored afterwards, front app kept in front | ✅ minimises other apps' windows (`ShowWindow`), restores without stealing focus | 🟡 X11 with `wmctrl` + `xdotool`. Wayland does not let apps do this |
| Hide menu bar / tray icons | 🟡 auto-hides the whole menu bar (`autohide menu bar of dock preferences`). Hiding single icons needs macOS 26's own Menu Bar settings | 🟡 tray icons hide with the taskbar. Windows decides which icons overflow | ❌ GNOME and KDE have no public switch |
| Hide or quit chosen apps | ✅ hide, or quit (and reopen afterwards) | ✅ minimise, or `CloseMainWindow` (and reopen) | 🟡 hide needs X11. Quit (SIGTERM) and reopen work everywhere |
| Do Not Disturb | 🟡 through Keep Awake's Focus Shortcuts (no public Focus API) | 🟡 notification banners off (`PushNotifications\ToastEnabled`). Some builds apply this only to new banners | 🟡 GNOME banners through Keep Awake |
| Mute alert sounds | ✅ `set volume alert volume 0` | ✅ notification sounds of the current scheme (`AppEvents\Schemes`) | 🟡 GNOME `event-sounds` |
| Pause music | ✅ Music and Spotify | ✅ the current media session | ✅ MPRIS (`playerctl`) |
| Clean backdrop (colour, gradient, blurred wallpaper) | ✅ desktop-level window | ✅ window sent to the bottom (`SetWindowPos HWND_BOTTOM`) | 🟡 `_NET_WM_WINDOW_TYPE_DESKTOP`, which most window managers keep at the bottom |
| Normal pointer size | ↗ macOS does not let apps change it. Stage tells you when the pointer is enlarged | ✅ `CursorBaseSize` + `SPI_SETCURSORS` | 🟡 GNOME `cursor-size` |
| Pointer spotlight or ring | ✅ | ✅ | 🟡 X11, and XWayland on Wayland |
| Show clicks | ✅ listen-only event tap in the helper (Input Monitoring) | ✅ low-level mouse hook | 🟡 X11 (`xinput`). Not on Wayland |
| Show keystrokes (shortcuts only, or every key) | ✅ as above; secure fields never reach it | ✅ low-level keyboard hook | 🟡 X11 (`xinput` + `xmodmap`). Not on Wayland |
| Keep awake | ✅ a Keep Awake session | ✅ | ✅ |
| Recording resolution | ✅ `CGConfigureDisplayWithDisplayMode` (for the session) in the helper | ✅ `ChangeDisplaySettingsEx` (not saved). Scaling needs a sign-out on Windows | 🟡 `xrandr` (X11), `wlr-randr` (wlroots). GNOME and KDE on Wayland keep their own |
| Clean clipboard history | ✅ the Island and clipboard picker show nothing; nothing is deleted | ✅ | ✅ |
| Hide private things in the Island | ✅ shelf, meeting titles, notifications, download alerts, agent messages | ✅ | ✅ |
| Keep Keeper out of the picture | ✅ `setContentProtection` on Keeper's windows (overlays stay visible) | ✅ Windows 10 2004+ | ❌ Linux has no way for an app to hide from capture |

**Beyond the original.** Stage runs on Windows and Linux too. It shows keystrokes and clicks and keeps Keeper out of the picture. It hides the Island's private items. It uses the presets and Keep Awake you already have. Each step reports how it went, and settings you changed yourself are left alone.

**Not built.** Night Shift and True Tone are left out because apps can switch them only through private parts of macOS (CoreBrightness).

## The journal: crash-safe undo

Stage keeps a journal at `userData/stage-journal.json`. It is a write-ahead log: every change is written there before it is made.

1. Stage reads the current value of each setting. If it cannot read a setting, it does not change it, so nothing is changed that cannot be put back. If the setting already has the wanted value, it is skipped.
2. The entry is written as `pending` with the old value (`prior`) and the new value (`applied`). The journal file is replaced atomically with temp + rename.
3. Stage makes the change, reads the setting again, and marks the entry `applied`.

**Putting things back** goes newest first. For each setting, Stage reads the value now:

- If it still holds what Stage set, the old value goes back.
- If it already holds the old value, nothing happens. This covers a watchdog that already ran, or a crash before the change.
- If it holds a third value, you changed it while Stage was on, and it is left alone.

Apps that were hidden come back. Apps that were quit are reopened if you asked. Music resumes only if it is still paused. The screen size goes back. The keep-awake session ends only if it is still Stage's own. Do Not Disturb goes off.

**When the journal is used:**

- **When Stage stops:** Stop, the time limit, the end of capture, or Quit Keeper. Quitting waits until everything is back.
- **On the next start after a crash:** Keeper finds the journal, puts everything back and tells you, in the Island and on the page.
- **By the watchdog,** while Keeper is gone. It works like Keep Awake's closed-lid watchdog. A small detached shell (`/bin/sh` on macOS and Linux, hidden PowerShell on Windows) checks every 2 seconds whether Keeper's process still exists. If it is gone and the journal is still there, the watchdog runs `stage-restore.sh` / `stage-restore.ps1`. Keeper rewrites that script next to the journal after every change, and it uses the same commands as the app (`core/stage/targets.ts`). Settings are compared before they are restored. On macOS, apps Stage hid come back through the same System Events script Stop uses, found by bundle id first and by name otherwise, all in one call (and one call per app if that fails). Then the watchdog removes both files. On a normal stop, Keeper removes the journal first and then stops the watchdog.

Overlays, the backdrop, content protection and the Island view live inside Keeper's process, so they end with it. The keep-awake holds die with the process too (see KEEP-AWAKE.md).

## Starting by itself when the screen is captured

| Signal | Systems | Reliability |
|---|---|---|
| Keeper's own screen recorder | all | **Reliable** |
| PipeWire screen-cast streams (`pw-dump --monitor`): a running `Video/Source` node from the portal or compositor. Cameras are excluded | Linux | **Reliable.** Every portal capture (Wayland, and most X11 desktops) goes through one. Event-driven, with no polling |
| The system's screen-recording controls in the menu bar (`screencaptureui` windows at status-bar level, read from `CGWindowListCopyWindowInfo` without titles, so no Screen Recording permission is needed) and `screencaptureui` running | macOS | **Heuristic.** macOS has no public "the screen is being captured" signal. The purple indicator is drawn by Control Centre and cannot be read. Recording with ⇧⌘5 is caught; a meeting app sharing the screen is not |
| Known recorder apps in front (OBS, Loom, Screen Studio, CleanShot X, Kap, ScreenFlow, Camtasia, QuickTime Player…), or ones that only run while recording (wf-recorder, gpu-screen-recorder, wl-screenrec…) | all | **Heuristic.** A recorder in front is usually, but not always, recording |
| ffmpeg or gstreamer with a screen grabber (`x11grab`, `kmsgrab`, `pipewiresrc`…) on its command line | Linux | **Heuristic** |
| Apps you add to the list | all | Counted while running |

A reliable signal starts Stage straight away. A heuristic one needs two looks in a row. Capture counts as ended after three empty looks in a row, which is about 15 seconds. Stage then ends, but only if it started by itself and "End when capture stops" is on. **What does Keeper see now?** on the page shows each signal and marks it *reliable* or *a guess*. Auto-started Stage skips the countdown.

**Cost.** On Linux there is one `pw-dump --monitor` process while the feature is on. Everywhere, one look runs every 5 seconds through the governor. It slows to every 10 seconds while you are away and pauses while the screen is locked. There is nothing when the feature is off.

## External monitors (DDC/CI)

This extends `display-control`.

- **Input source** (VCP 0x60): the Stage page, the Toolbox's Display control, `keeper display inputs ID` / `keeper display input ID 0x11`, and the `display_input` ability. Inputs come from the monitor's capabilities string. On Windows that is `CapabilitiesRequestAndCapabilitiesReply`; on Linux, `ddcutil capabilities`. When a monitor does not list them, and always on macOS, the common ones are offered (DisplayPort 1/2, HDMI 1/2, USB-C, DVI, VGA). Switching asks first, because the monitor goes dark if nothing is connected to that input.
- **Display keys:** global shortcuts for brightness and volume up and down (default Control+Option/Alt+F1/F2 and F11/F12). They go to all external monitors, or one you choose, with a small level HUD on the screen with the pointer. Fast presses are combined, because DDC is slow. You can also let the keyboard's own volume keys go to the monitor (Electron's `VolumeUp`/`VolumeDown` accelerators; on macOS this needs Accessibility). Apps cannot register the brightness keys themselves, so brightness always uses your shortcuts.

| | macOS | Windows | Linux |
|---|---|---|---|
| Brightness, contrast, volume | ✅ helper (Apple silicon), m1ddc/ddcctl | ✅ dxva2 | ✅ ddcutil |
| Input list from the monitor | 🟡 common list | ✅ | ✅ |
| Switch input | ✅ | ✅ | ✅ |
| Display keys | ✅ | ✅ | ✅ (X11 shortcuts; Wayland depends on the desktop's global-shortcut support) |

## Presentation mode

Presentation mode used to live in the Island service. Stage owns it now and keeps its behaviour exactly: keep awake (Keep Awake reason "Presentation mode") and hide desktop icons. The macOS-only icon hiding now also works on Windows and GNOME/Xfce. `island.presentation(on)`, the palette's Presentation Mode commands and Monorail's follow-presentation hook all still work. Monorail follows when the legacy mode or the Presenting preset starts or stops.

## Draw on screen

Press **⌘⌥⇧D / Ctrl+Alt+Shift+D** (Stage page → Draw on screen; also the tray's Stage menu and the command palette) to lay a see-through sheet over every screen and draw on it, over any app, with or without Stage on. The screen with the pointer gets the tool bar; the others take ink too.

| Tool | Key | |
|---|---|---|
| Pen | P | smooth lines |
| Highlighter | H | wide, see-through, flat ends |
| Arrow | A | drag from the tail to the point |
| Box | B | drag from corner to corner |
| Spotlight | S | dims everything but a circle around the pointer |
| Colours | 1–6 | six pen colours, chosen on the Stage page |
| Line width | tool bar | thin, medium, thick |
| Fade | F | each line disappears by itself a few seconds after it is drawn (2, 3, 5 or 10 s) |
| Board | W | see-through → white board → black board |
| Undo | ⌘Z / Ctrl+Z | |
| Clear | C, Backspace | |
| Finish | Esc, Done, or the shortcut again | the ink is cleared |

The tool, colour, width and Fade are remembered for next time. A screen recording (Studio or any other recorder) records the ink like anything else on screen.

| | macOS | Windows | Linux |
|---|---|---|---|
| Drawing over apps | ✅ a panel above full-screen apps | ✅ | ✅ X11; 🟡 Wayland (the desktop decides whether a window may cover the others) |
| Keys while drawing | ✅ the sheet takes the keys | ✅ | ✅ |
| See-through sheet | ✅ | ✅ | 🟡 needs a compositor; without one the sheet is dark (use a board) |

Nothing exists until the shortcut is pressed; when drawing ends the sheets are closed. Turning **Draw on screen** off in Settings → Features gives the shortcut back.

## Files

| Part | File |
|---|---|
| Types, presets, plan and support table, setting commands and watchdog script, journal, capture heuristics, overlays, key parsing, screen sizes, Island redaction | `core/stage/*.ts` (pure, `test/stage.test.ts`) |
| Service: start/stop, journal, watchdog, Keep Awake bridge, previews, auto-start | `electron/services/stage/index.ts` |
| Running changes, hiding and quitting apps, screen sizes, wallpaper | `electron/services/stage/exec.ts` |
| Overlay and backdrop windows | `electron/services/stage/overlay.ts` |
| Draw on screen: settings, drawing helpers, the sheet's page | `core/stage/draw.ts` (`test/stage-draw.test.ts`) |
| Draw on screen: the sheets | `electron/services/stage/draw.ts` |
| Key and click events | `electron/services/stage/events.ts` |
| Capture detection | `electron/services/stage/detect.ts` |
| Display keys | `electron/services/stage/display-keys.ts` |
| Input sources | `core/display-control.ts`, `electron/services/display-control.ts` |
| IPC, tray, shortcuts, links, CLI methods, abilities | `electron/ipc/stage.ts` |
| macOS helper: display modes, window list, event tap, pointer size | `native/macos/KeeperHelper/Sources/keeper-helper/Stage.swift` |
| Page, Island tile, monitor controls | `src/screens/Stage.tsx`, `src/stage/StageTile.tsx`, `src/stage/DisplayExtras.tsx`, `src/styles/stage.css` |
| Browser demo | `src/mock-stage.ts` |
| CLI | `cli/stage.ts` |
| End-to-end (real app, Linux) | `test/e2e/stage.cjs`; Draw on screen in `test/e2e/capture-extras.cjs` |

## Verified and not verified

**Verified on Linux** (Xvfb, a private D-Bus session, GNOME schemas, `test/e2e/stage.cjs`):

- Idle cost is zero: no overlay, watchdog, journal or capture check.
- The countdown shows in the Island and on screen.
- Real `gsettings` changes: event sounds and pointer size. GNOME banners go off through Keep Awake.
- The journal holds each old value before the change. The restore script and the watchdog exist.
- The Keep Awake session runs. The backdrop and overlay windows are up.
- The Island hides private items and shows the live activity. The tray shows Stage.
- Stop puts things back but leaves the pointer size you changed.
- Previews work: click ripples, keystrokes and spotlight.
- Legacy Presentation mode does exactly what it did before.
- Auto-start from a pretend recorder app, and auto-stop when it quits.
- After `SIGKILL`, the watchdog restores settings.
- After `SIGKILL` of both Keeper and the watchdog, the next start restores and says so.
- Switching the feature off hides the page and the tray entry.

All the pure logic has unit tests.

**Not verified here** (no Mac or Windows machine in this run; the code paths use public APIs and are written to be checked there):

- macOS: Finder/Dock/menu-bar AppleScript, alert volume, hiding apps with System Events, the Swift helper (display modes, event tap, window list; not compiled in this run), content protection, and capture heuristics against real recorders.
- Windows: desktop-icon toggle, taskbar auto-hide, toast and sound registry keys, `CursorBaseSize`, window minimising and restoring, the low-level hook, `ChangeDisplaySettingsEx`, and DDC capabilities.
- Linux: real GNOME Shell docks and extensions, KDE panels, xinput-based keystrokes (xinput is not installed here; the parser is unit-tested), PipeWire screen casts (no PipeWire daemon here; the stream parser is unit-tested), and real DDC monitors.
