# Displays

**Displays** (Computer → Displays) shows every connected screen with its size and refresh rate (and sharp text on a Mac), switches one in a click, keeps presets for each set of screens, and lets plugged-in monitors follow the built-in screen's brightness or the time of day. Two parts, both off until switched on (Settings → Features → Computer):

- *Screen modes* (`displayModes`): the page, modes and presets. Nothing runs in the background; the system says when a screen is plugged in or out.
- *Matched brightness* (`brightnessSync`): needs *Monitor controls* (`displayControl`, the existing DDC/CI path in Toolbox → Display control). The page's **Turn on** switches both.

## Works with your computer

| | macOS | Windows | Linux |
|---|---|---|---|
| Every screen's sizes and refresh rates | ✅ CoreGraphics through Keeper's helper (`displays.list`, `stage.modes`, `stage.setMode`) | ✅ `ChangeDisplaySettingsEx` per screen (`\\.\DISPLAYn`) | ✅ X11 (`xrandr`), KDE (`kscreen-doctor`), wlroots (`wlr-randr`) |
| Sharp text (HiDPI) | ✅ where a size has both | — (Windows scales separately) | — (scaling is the desktop's own) |
| Presets per set of screens, used by themselves | ✅ | ✅ | ✅ |
| Follow the built-in screen's brightness | Intel Macs (IOKit); Apple silicon keeps it private, so monitors follow the time of day | ✅ laptops (`WmiMonitorBrightness`) | ✅ `/sys/class/backlight` |
| Day and evening levels | ✅ | ✅ | ✅ |

GNOME on Wayland keeps screen sizes in its own Displays settings and offers no tool other apps may use; the page says so.

**Not offered:** virtual screens and extra (XDR) brightness. Both need private interfaces that break with system updates (paid-tools research §4).

## Changing a mode

- Pick a size or refresh rate on a screen's card. It switches at once, and a small **Keep this?** bar counts down from 15 seconds (Settings → General → Displays → Switch back after: 10, 15 or 30). Without **Keep** it switches back by itself.
- The way back runs in Keeper's main process, not in the window, so it works even when the new mode shows nothing at all. The palette has **Keep This Screen Mode** too.

## Presets

- **Save as preset** keeps how the connected screens are set now, under a name ("Desk"). A preset belongs to its set of screens: the page lists the ones for the screens connected now.
- **Use** applies it (with Keep, as always). **When these screens connect** applies it by itself a few seconds after that set is plugged in.

## Matched brightness

- **Built-in screen**: each monitor follows the laptop's own brightness, with its own offset (up to 30 brighter or dimmer).
- **Time of day**: a day level and an evening level, and when evening starts and ends (it may run past midnight).
- Keeper looks at the built-in level every 4 seconds (10 on Windows), slower while you are away and not while the screen is locked, and tells a monitor only when its level should move by 3% or more: DDC/CI is slow and some monitors flicker on every change.

## Files

| Part | File |
|---|---|
| Sizes, picking a mode, kscreen-doctor, presets, schedule, sync | `core/display-modes.ts` |
| Listing, switching and switching back, presets, the sync loop | `electron/services/displays.ts` |
| macOS screen list | `native/macos/KeeperHelper/Sources/keeper-helper/Displays.swift` |
| The page | `src/screens/Displays.tsx` |
| Tests | `test/display-modes.test.ts` (10), `test/e2e/displays.cjs` |

## Verified

- **Linux, real app** (`test/e2e/displays.cjs` under xvfb, with stand-in `xrandr` and `ddcutil` and a stand-in backlight in `KEEPER_BACKLIGHT_DIR`): off until switched on and nothing asked; both screens listed with their modes; a new size switching back by itself without Keep and staying with it; a preset saved and used again; a monitor following the built-in screen's 60%, then 10 dimmer, then the built-in going to 90%; no write while the level stays the same; nothing after switching off; light, dark and 1024×768.
- **Unit tests:** sizes and rates, picking modes (sharp or not), kscreen-doctor output, safe commands, presets per set of screens, the schedule past midnight, the 3% step and offsets, the backlight.

## Needs a real Mac or Windows PC

- macOS: `displays.list` in keeper-helper is new Swift, written against public CoreGraphics and AppKit calls but not compiled here; switching sharp text on a real screen; built-in brightness on an Intel Mac.
- Windows: listing screens through `System.Windows.Forms.Screen` and each one's modes; a laptop's built-in brightness.
- Linux: KDE's `kscreen-doctor` and wlroots' `wlr-randr` on real desktops.
