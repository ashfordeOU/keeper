<!-- SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0 -->
# Capture: screenshots and their extras

Capture (Screen → Capture, part **Screenshots and recording**) copies text from the screen, reads codes, takes screenshots, records the screen and picks colours. This page covers the screenshot extras; text capture is in [TOOLS.md](TOOLS.md#screen-text-capture).

| Extra | Where | Default |
|---|---|---|
| **Preview after each screenshot** | a card in the bottom-right corner | on, goes after 8 seconds |
| **Scrolling capture** | Capture → Take a screenshot → **Scrolling** | — |
| **Pin on screen** | the preview's **Pin**, or the pin button on a screenshot in Capture | — |
| **Self-timer** | Capture → Take a screenshot → **Timer** (3, 5 or 10 seconds) | off |
| **Window with shadow** | Capture → Options → "Shadow around windows" | on |
| **Upload and copy link** | the preview's **Upload**, or the link button on a screenshot | needs a storage, see [SHARE-LINKS.md](SHARE-LINKS.md) |

Nothing here runs until it is used: no window, timer or shortcut exists before the first screenshot, and the code loads the first time one of them is used.

## Preview after each screenshot

After a screenshot (button, shortcut, tray, link), a card with the picture appears in the bottom-right corner of the screen with the pointer. Several screenshots stack (four show; "2 more" counts the rest).

- **Drag** the picture into any app (a chat, a mail, a folder): the file itself is dragged.
- **Annotate** opens it in the editor (also a double-click, or Enter on the focused card).
- **Copy** puts the picture on the clipboard (⌘C / Ctrl+C on the focused card).
- **Save** saves a copy where you choose (the screenshot is already in Pictures › Screenshots).
- **Upload** uploads it to your own storage and copies the link.
- **Pin** pins it on screen.
- **✕** or Esc closes the card.

A card goes away after the time set in Options (5, 8 or 15 seconds, or when closed); pointing at it or focusing it keeps it. With "Open screenshots in the editor" on, the editor opens instead.

## Scrolling capture

Drag over the part of a window that scrolls (a web page, a chat, a document). Keeper then scrolls it a few steps at a time, takes a frame after each step and joins the frames where they overlap, into one tall picture. A bar under (or above) the part shows how many screens it has and **Stop**; Esc stops too. It ends by itself when the page stops moving (twice in a row), after 60 frames or at 30,000 pixels.

How the frames are joined (`core/capture-extras.ts`): each row becomes a short brightness profile; rows that stayed put at the top and bottom are a fixed header and footer and are left out of the match; the shift with the smallest difference over the detailed rows is how far the page moved. The header stays once at the top, the footer once at the bottom. If a step moved more than a screen, Keeper scrolls back and takes smaller steps.

Keeper scrolls with the same pointer and wheel events that remote control uses (`electron/services/screen/injector.ts`), at the centre of the chosen part:

| | Scrolls with | Notes |
|---|---|---|
| macOS | Keeper's helper (CGEvent) | needs Accessibility permission; Keeper says so if it is missing |
| Windows | `SendInput` through the PowerShell host | |
| Linux X11 | `xdotool` | needs xdotool (`sudo apt install xdotool`) |
| Linux Wayland | the RemoteDesktop portal, when Settings → Features → "Control on Wayland" is on | the system may ask to share the screen for each frame; otherwise Keeper says it cannot scroll here |

Pages that load more content as you scroll, or that animate, can give a seam; take the capture again with the area a little smaller.

## Pin on screen

A pinned picture floats over every app (and full-screen apps on macOS) until closed.

- Drag it anywhere; resize it from its edges (it keeps its shape), or ⌘/Ctrl + scroll, + and −.
- **Opacity**: − and + in its bar, or the keys 1–9 (10–90 %) and 0 (100 %). Never under 20 %.
- **Click-through**: clicks go to the app under it, and a dashed outline shows it is see-through. The shortcut **⌘⌥⇧P / Ctrl+Alt+Shift+P** (Capture → Options) makes every see-through pin clickable again; it is only taken while a pin is see-through. Capture's page also lists the pins with "Make clickable" and "Close all".
- **Copy**: ⌘C / Ctrl+C.
- **Close**: Esc, ⌘W / Ctrl+W, or ✕.

Opacity is the window's own on macOS and Windows. Linux has no window opacity, so the picture itself fades (with a compositor the desktop shows through; without one, it fades to black).

## Self-timer

With a timer chosen, a 3-2-1 countdown (Stage's overlay) shows on every screen, and goes before the picture is taken. For an area or a window, you choose it first; the picture is taken when the countdown ends, so a menu or a hover state can be opened meanwhile.

## Window with shadow

A window screenshot gets a soft shadow on a see-through background (PNG with transparency), sized for the screen's scale. On macOS and Windows the corners are rounded as those systems draw windows; on Linux they stay square. Turn it off in Capture → Options for the plain window.

## Platforms

All three, with the notes above. Verified on Linux (Xvfb with openbox): the preview stack and its Upload and Pin, pin opacity and click-through, Esc, the self-timer, the window shadow and a scrolling capture with xdotool (`test/e2e/capture-extras.cjs`). Not verified here: macOS (the helper's wheel events, panel windows taking clicks without focus, drag-out to Finder) and Windows (`SendInput` wheel, layered-window opacity).

## Files

| Part | File |
|---|---|
| Overlap matching, stitching, shadow, pin and preview sizes, options | `core/capture-extras.ts`, `core/capture.ts` (`test/capture-extras.test.ts`) |
| Screenshot modes, self-timer, window shadow | `electron/services/capture.ts` |
| Scrolling capture, pins, previews | `electron/services/capture-more.ts` |
| Messages from these small windows | `electron/services/floats.ts`, `electron/capture-preload.ts` (`keeperFloat`) |
| IPC and shortcuts | `electron/ipc/capture.ts` |
| Page | `src/screens/Capture.tsx`, `src/styles/capture.css` |
