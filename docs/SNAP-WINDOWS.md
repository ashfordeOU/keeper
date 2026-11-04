# Snap Windows

Puts the window in front into a half, a third, a quarter, the whole screen, the
middle or the next screen with one shortcut, and keeps how your windows sit on
a set of screens ("Docked", "Laptop") so one click brings them back.

- Page: **Snap Windows** in the sidebar's Desktop section: whether this computer lets Keeper move windows, a tile per place on screen with its shortcut (Halves first; Whole screen, Thirds and Quarters are tabs), and Saved layouts.
- Feature (Settings → Features → Desktop): `snapWindows`, **off** until you turn it on. While it is off no shortcut is registered and nothing watches the screens.
- Settings → General → Snap windows: the page, *Restore layout when screens change*; under More settings the space around snapped windows.
- Command palette: **Snap Window to the Left Half**, **…Right Half**, **Make Window Fill the Screen** (the window in front, which is Keeper's own from its palette).

## Shortcuts

Keeper's own defaults, chosen so none is one of Monorail's keys:

| Place | Mac | Windows and Linux |
|---|---|---|
| Left, right, top, bottom half | ⌘⌥⇧ ← → ↑ ↓ | Ctrl+Alt+Shift+arrows |
| Fill the screen | ⌘⌥⇧ Return | Ctrl+Alt+Shift+Enter |
| Middle (keeps its size) | ⌘⌥⇧ C | Ctrl+Alt+Shift+C |
| Next screen (same place, relative) | ⌘⌥⇧ N | Ctrl+Alt+Shift+N |
| Thirds, two thirds, quarters | none until you choose | none until you choose |

Click a shortcut on the page and press new keys; Backspace clears it. A key that
another app holds says "Taken by …" on its tile and in Settings → Shortcuts.
Dragging a window to a screen edge is left to the system's own snapping
(Windows, macOS 15 and later, GNOME, KDE), so the two never fight.

## Saved layouts

**Save this layout** keeps each window's app, title, screen and place (as a
share of the screen, so a different resolution still fits). It is named after
the screens: one screen is *Laptop*, two are *Docked*. **Restore** moves each
saved window to its place: an open window of the same app with the same title
first, then any window of that app; apps that are not open are listed in the
note and left alone. With *Restore layout when screens change* on, plugging in
or removing a screen brings back the newest layout saved for that set of
screens, after a short pause while the system settles. Layouts are kept in
Keeper's settings on this computer.

## Works with your computer

| System | How | What it needs |
|---|---|---|
| macOS | System Events (JavaScript for Automation) sets the window's position and size, as the computer-use tools read them | Accessibility for Keeper (the page has **Open Accessibility**) |
| macOS with Monorail | Keeper hands over: while Monorail runs and Keeper works with it, no snap shortcut is registered and the page says so ([ASHFORDE-APPS.md](ASHFORDE-APPS.md)); saved layouts still work | — |
| Windows | `user32` through PowerShell: `GetWindowRect` and `SetWindowPos` (a maximised window is restored first), with Electron's points turned into physical pixels for high-DPI screens | nothing |
| Linux, X11 | `wmctrl` (or `xdotool`); the window manager's frame (`_NET_FRAME_EXTENTS`) is taken into account so the title bar stays on screen | `wmctrl` or `xdotool` installed; the page says which is missing |
| Linux, Wayland | not possible: Wayland does not let one app move another's windows. The page says so and points to the desktop's own keys (Super with the arrows on GNOME, Meta with the arrows and Quick Tile on KDE) | — |

## What was checked, and how

- `core/snap.ts` (where each action puts a window, gaps, next screen, screen sets, saving and matching layouts, frames, what each system allows) has unit tests in `test/snap.test.ts`, including that the default keys are in Keeper's shortcut list for the Monorail clash check and clash with none of Monorail's.
- `test/e2e/desk.cjs` drives the real app on an X11 desktop (Xvfb and openbox): the page, a real `xterm` snapped through the API and through the global shortcut, a shortcut recorded on the page and used straight away, a layout saved, the window moved away and restored, a layout deleted, and the shortcuts given back when the part is switched off.
- The macOS and Windows window calls have not run in automated tests; they need a real Mac (Accessibility granted) and a real Windows PC, including a high-DPI screen on Windows.
