<!-- SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0 -->
# Wallpaper & Vibes

Keeper's desktop mood: a **live wallpaper** behind the desktop icons, **vibes**
that switch wallpaper, theme, ambient sound and widgets together (by hand or on
a schedule), **ambient sound** made on the computer, more **desktop widgets**,
and **custom folder icons**. Everything is cross-platform where the system
allows it, and nothing draws when nobody can see it.

## Where it lives

| Surface | What it does |
|---|---|
| Desktop layer | The wallpaper windows (one per display, behind the icons) and the widgets |
| Menu bar / tray | **Vibe: …** submenu: every vibe (ticked when active), pause/resume, Surprise me, scenes, play/stop sound, Sound mixer…, sleep timer, Arrange widgets, the page |
| Island | **Vibes** tool: vibe tiles, wallpaper on/off and Surprise, sound play/stop and the mixer |
| Floating panel | **Ambient sound** mixer: ten sliders, master volume, sleep timer; Esc or ✕ hides it, the sound keeps playing |
| Global shortcuts | Next / previous vibe, Surprise me, pause wallpaper, mixer (off by default; ⌃⌥⌘→ / ← / R / P / M, editable) |
| Command palette | Wallpaper & Vibes, Next vibe, `Vibe: …` per vibe, `Wallpaper: …` per scene, live wallpaper on/off, Surprise me, mixer, play/stop sound, Arrange desktop widgets, Custom folder icons |
| Main window | **Wallpaper & Vibes** (sidebar → More): Vibes, Wallpaper (library and per-display), Schedule, Sound, Folder icons, Options (where it appears, performance, desktop picture, measured cost) |
| AI abilities | `list_vibes` (allowed), `set_vibe`, `set_wallpaper`, `ambient_sound` (ask first) |
| Command line | `keeper ambience status|vibes|vibe <name>|next|prev|surprise|scenes|scene <id> [palette]|pause|play|sound rain=0.6 cafe=0.3|stop|sleep <min>|still|restore` |

Settings → Features has four switches: **Live wallpaper** (off by default),
**Vibes**, **Ambient sound** and **Custom folder icons** (on; they cost nothing
until used). Options → *Where it appears* chooses tray, Island (kept in step
with Settings → Island → Tools), shortcuts and palette.

## How the wallpaper reaches the desktop

| System | How | Notes |
|---|---|---|
| macOS | A borderless window per display with Electron's `type: 'desktop'` (desktop window level), click-through, on every Space, never focusable | Pauses under full-screen apps; Chromium's occlusion tracking hides a covered window, which stops drawing |
| Windows | The **WorkerW** technique: send `0x052C` to `Progman` so Explorer creates a `WorkerW` between the wallpaper and the icons, then `SetParent` the window into it (Windows 11 24H2: the `WorkerW` child of `Progman`) | Undocumented by Microsoft but used by long-standing live-wallpaper apps since Windows 7. If any step fails Keeper says so in the Island and sets a **still frame** instead |
| Linux X11 | `_NET_WM_WINDOW_TYPE_DESKTOP` windows (Electron `type: 'desktop'`) | Verified under Xvfb with `xprop` |
| Linux Wayland | No desktop layer exists for apps (GNOME needs a shell extension, KDE a wallpaper plugin), so Keeper sets a **still frame**: first through the desktop portal (`org.freedesktop.portal.Wallpaper.SetWallpaperURI`), then the desktop's own setting (GNOME `picture-uri` and `picture-uri-dark`, Cinnamon, MATE, KDE `plasma-apply-wallpaperimage`, XFCE `xfconf-query`) | Refreshed every 30 minutes for scenes, at the folder's interval for folders, through the governor |

A still frame is drawn off screen (an offscreen window, the same renderer) and
saved as a PNG; pictures are used as they are. **Options → Also set the desktop
picture** does this on every system so the lock screen matches where it follows
the desktop (macOS 14+, GNOME and KDE blur it). The picture from before Keeper
first changed it is remembered, and **Restore previous picture** puts it back.

## Sources

- **14 scenes** in six categories (Atmosphere, Fluid, Geometry, Weather, Light,
  Life): Aurora, Nebula, Gradient mesh, Lava lamp, Silk, Contours, Hex field,
  Rain, Snowfall, Ocean, Dunes, Light rays, Fireflies, Koi pond. Each is a small
  GLSL ES 1.0 fragment program (`core/scenes/shaders.ts`), all colour from a
  four-colour palette, at most four octaves of value noise per pixel. No
  pictures, recordings or code from anyone else.
- Controls: speed, intensity, scale, grain, vignette, **Shuffle** (a new seed).
- **16 palettes**, plus palettes made **from a photo** (k-means on its pixels,
  `core/scenes/palette.ts`). Widgets set to *Tinted* follow the wallpaper's palette.
- **Your own**: a video (muted, looped), a picture (still, drifting or
  breathing), a folder of pictures (cross-fading every 1–60 minutes, shuffled),
  or a web page (its own in-memory session with no Keeper cookies, no
  permissions, muted, no pop-ups, navigation kept to its own site).
- **Per display**: every display the same, its own choice, or left alone.

## Light by design

The main process decides with the governor (`core/scenes/policy.ts`,
`renderPolicy`) and tells each wallpaper window; the window also stops on
`visibilitychange`, and `requestAnimationFrame` does not fire while hidden.

| Condition | Effect |
|---|---|
| Live wallpaper off (default) | No windows, no timers, no checks |
| Screen locked, asleep, very hot | Stopped |
| An app in full screen | Stopped (setting, on by default); one check every 2.5 s only while a wallpaper window is open (slower while away) |
| Window covered or hidden | Stopped (Chromium occlusion on macOS/Windows; Linux relies on the full-screen check) |
| Low power mode | Stopped (setting, on), or saving energy |
| On battery | Saving energy: half the frame rate (max 30) at half resolution; or stopped (setting) |
| Minimal resource mode | 15 fps at half resolution |
| Away for 5 minutes | 15 fps |
| Keeper's processes → Stop all work | Stopped |

Frame rate 15/24/30/60 (30 default); quality Efficient (50% of the pixels in
each direction), Balanced (75%, default), Full. The canvas is scaled up by the
compositor. Scene switches cross-fade through black in under a second; pictures
cross-fade too. Sound fades over the vibe's fade time.

### Measured cost

Measured by `test/e2e/ambience.cjs` on Linux under Xvfb, one 1440×900 display,
**software rendering** (SwiftShader, no GPU), Aurora at 30 fps. The numbers are
CPU % of one core for the wallpaper's renderer process and for Chromium's
graphics process (which here does the shading on the CPU). Options → *What it
costs* measures the same on any computer.

| Case (1440×900, Aurora) | Drawn fps | Renderer CPU | Graphics process CPU |
|---|---|---|---|
| Off (default) | 0 | no window | — |
| Playing, Balanced (75%), 30 fps target | 1.7–1.9 | 0.2–0.5% | 24–26% |
| Playing, Efficient (50%) | 3.5 | 0.5% | 22% |
| Playing, Full (100%) | 1.2 | 0.2% | 15% |
| On battery, saving energy (15 fps cap, 50%) | 2.0 | 0.2% | 12% |
| Screen locked (paused) | 0 | 0% | 0% |
| Idle Keeper with wallpaper off (perf budget) | — | 0.32% for all of Keeper (budget 0.6%) | — |

Software rendering cannot reach the 30 fps target (one CPU core shades every
pixel), so these numbers are a worst case for the graphics process and show
the pauses working: locked and paused cost nothing, and battery saving halves
the cost. The renderer's own work per frame (JavaScript plus one draw call)
measured 0.1–2.4 ms.

On a real GPU the shading moves to the graphics card: the renderer's share
stays about the same (it only issues one draw call per frame), and the graphics
process's CPU share drops to a few percent. GPU time per frame was not measured
here (WebGL 1 timer queries are disabled in Chromium); the shaders are written
for well under 2 ms per frame on integrated graphics at 75% of 1440p — not
verified on real hardware.

## Vibes

A vibe bundles any of: wallpaper (and per-display wallpapers), theme, light or
dark, ambient sound mix and volume, the widget layout, and a focus session to
start. Anything a vibe does not set is left alone. Eight starter vibes come
with Keeper (Morning, Deep work, Café, Rainy day, Seaside, Evening, Night sky,
Battery saver); **Save vibe** captures what is on screen and playing now;
**Restore starters** brings back the originals.

### Schedule

Rules in priority order, the first that applies wins:

- **Time**: from–to (overnight works) on chosen weekdays.
- **Sun**: from sunrise or sunset ± up to 4 hours, until the other one. Worked
  out on the computer from the Weather/Island place, or from manual times when
  no place is set; midnight sun and polar night handled.
- **Battery**: unplugged, optionally below a level.
- **Focus**: while a Keeper focus session runs.

Presets: *Day & night*, *Work week*, *On battery*. A fallback vibe can apply
when nothing matches. A vibe picked by hand holds until the next rule boundary.
The schedule is one governor check a minute (slower while away), only while it
is on and has rules. System Focus modes are not readable by apps on macOS or
Windows without special entitlements, so Focus means Keeper's focus timer.

## Ambient sound

Ten sounds made with Web Audio from seeded noise, filters and slow oscillators
(`src/lib/ambient-audio.ts`): Rain, Café, Waves, Stream, Wind, Fire, Night,
White, Pink and Brown noise. No recordings, no downloads. Any mix, master
volume, a perceptual level curve, fades, and a sleep timer (15 min – 2 h) that
fades over its last minute. The sound plays in the mixer's own window, which
exists only while something plays or the panel is open; nothing starts making
sound at login on its own.

## Widgets

Moved out of `electron/ipc/island.ts` into `electron/ipc/widgets.ts` with the
same windows, settings and IPC. New kinds: **Day** (big weekday), **Year
progress** (year, month, day), **Season** (astronomical, by hemisphere, days to
the next), **World clock** (up to six places with day/night), **Quote** (a line
a day, or your own). 18 kinds in all. New styling: shapes (card, circle, pill,
none), S/M/L sizes, a *Tinted* background from the wallpaper's palette or the
theme's accent. **Arrange on desktop** (page, tray, palette): every widget can
be dragged, even locked ones, and snaps to screen edges, centre lines and its
neighbours (12 px gaps).

## Folder icons

Make an icon from 8 patterns × 10 colour pairs (or any colour), a symbol (emoji
or two letters) or your own picture, then choose folders. Keeper keeps the
icon picture in its own folder, and a **restore list** with what was there
before (desktop.ini text, .directory text, the GIO attribute), restored one at
a time or all at once.

| System | How |
|---|---|
| macOS | `NSWorkspace.setIcon(_:forFile:)` in KeeperHelper (`Desktop.swift`); restoring passes nil |
| Windows | `desktop.ini` `[.ShellClassInfo] IconResource=…,0` (other lines kept), the file hidden+system, the folder marked System; a PNG-in-ICO with 256/48/32/16 px |
| Linux | GNOME Files, Nemo, Caja, Thunar: `gio set <folder> metadata::custom-icon file://…`; KDE Dolphin: `Icon=` in `.directory` (other lines kept) |

## Feature table

| # | Feature | macOS | Windows | Linux | Status |
|---|---|---|---|---|---|
| 1 | Live scenes on the desktop | desktop-level window | WorkerW | X11 desktop window; Wayland still frame | Built |
| 2 | Parallax "living stills" | drift/breathe | drift/breathe | drift/breathe | Partial: depth-map parallax needs an ML depth model and pointer input that a click-through desktop window does not get |
| 3 | Scene controls, shuffle | ✓ | ✓ | ✓ | Built |
| 4 | Palettes, palette from photo | ✓ | ✓ | ✓ | Built (16 + from photos; no hand-picked palette editor) |
| 5 | Surprise me | ✓ | ✓ | ✓ | Built (tray, Island, palette, shortcut, CLI, AI) |
| 6 | Vibes: wallpaper + theme + sound + widgets | ✓ | ✓ | ✓ | Better (also light/dark, per-display, focus session) |
| 7 | Starter vibes, unlimited own | ✓ | ✓ | ✓ | Built (8 starters) |
| 8 | Widget kinds | ✓ | ✓ | ✓ | Better (18 kinds) |
| 9 | Widget styling: tinted, shapes, S/M/L | ✓ | ✓ | ✓ | Built |
| 10 | Arrange mode with snapping, any display | ✓ | ✓ | ✓ | Built |
| 11 | Folder icons: patterns, symbols, pictures | NSWorkspace | desktop.ini | GIO / .directory | Built (fewer preset patterns, any colour) |
| 12 | Restore original folder icons | ✓ | ✓ | ✓ | Built |
| 13 | Schedule by time | ✓ | ✓ | ✓ | Built |
| 14 | Schedule by sunrise/sunset | ✓ | ✓ | ✓ | Built (place or manual times) |
| 15 | Battery vibe | ✓ | ✓ | ✓ | Better (optional level) |
| 16 | Presets, manual switch holds | ✓ | ✓ | ✓ | Built |
| 17 | Ambient sounds per vibe | ✓ | ✓ | ✓ | Built (10, procedural, sleep timer, floating mixer) |
| 18 | Per-display wallpaper | ✓ | ✓ | X11 ✓, Wayland one picture | Built |
| 19 | Desktop picture + lock screen, restore | ✓ (lock follows) | desktop ✓; lock screen not possible* | ✓ (GNOME/KDE lock follows) | Built / *not possible |
| 20 | Own photo/video/folder/web page | ✓ | ✓ | ✓ | Better (web page, folders) |
| 21 | Pause under full screen | ✓ | ✓ | X11 ✓ | Built |
| 22 | fps and quality | ✓ | ✓ | ✓ | Built (15–60 fps, 3 qualities) |
| 23 | Battery saving, low power | ✓ | ✓ | ✓ | Built |
| 24 | Stop when covered or hidden | ✓ | ✓ | full screen only | Built (Linux partial) |
| 25 | Menu-bar vibes menu | ✓ | ✓ | ✓ | Built |
| 26 | Shortcuts | ✓ | ✓ | ✓ | Built (off by default) |
| 27 | Privacy | ✓ | ✓ | ✓ | Built: sun times computed locally; nothing leaves the computer |

\* Windows lets apps set the lock screen picture only through administrator
policy (PersonalizationCSP) or as a packaged Store app
(`LockScreen.SetImageFileAsync`); Keeper does neither.

## Verified and not verified

Verified on Linux (Xvfb, X11) by `test/e2e/ambience.cjs`: desktop-type
wallpaper windows (checked with `xprop`), all 14 scenes compiling and drawing,
pause on lock and resume, battery energy saving, measured cost, vibes
switching wallpaper + theme + focus, capture a vibe, the schedule switching by
itself and holding a manual choice, the tray submenu, the Island tool, the
palette, `keeper ambience`, still-frame capture and the gsettings commands
(dry run), restore, the floating mixer, mix changes and the sleep timer, folder
icons through GIO (dry run) and KDE `.directory` (real files) with exact
restore, the moved widgets with new kinds, shapes and arrange-mode snapping,
light and dark screenshots. Unit tests: `test/ambience.test.ts`.

Not verified (no hardware here): macOS desktop-level window placement (Electron's
`desktop` window type sits at the desktop window level; if a macOS version
draws its own picture above that level the live window would not be seen, and
**Options → Always use a still picture** is the fallback) and
NSWorkspace calls in KeeperHelper (`Desktop.swift`, compiled only on macOS);
Windows WorkerW attachment and its still-frame fallback, desktop.ini icons and
`SystemParametersInfo`; Wayland portal behaviour (some portals ask the person
once); GPU timings on real graphics hardware; actual audio output (Xvfb has no
sound device).
