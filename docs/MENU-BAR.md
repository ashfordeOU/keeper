# The owl's summary (menu bar and tray)

Keeper has one icon in the menu bar (macOS) or the system tray (Windows, Linux): the owl. A left click opens a small summary under it; on macOS resting the pointer on the owl opens it too (Settings → Menu bar → *Open the summary when I point at the owl*, on by default there). A right-click (or Option-click on macOS) gives the classic menu. In code it is called the glance.

## What it shows

From top to bottom, each part one click away from its page:

| Part | What it shows | Click |
|---|---|---|
| **Header** | Keeper and one line of status: **All good**, or the one thing that most needs attention (no internet connection, the disk almost full or getting full, memory running out, a low battery, an AI limit used up or running low; problems before warnings) | the page for that thing |
| **Readings** | Four tiles of the same size: weather, the main disk, this computer and the network. Each has a small label, one short value that never wraps (`7°C`, `96 GB free`, `CPU 12%`, `↓34 ↑2 KB/s`), one short line under it, and one thin bar where there is an amount (disk used, memory used). The whole reading is in the tooltip. Amber and red follow the same limits as the status line. | Weather, Space, Health, Network activity |
| **Keep Awake** | A switch row: off ("the computer can sleep"), or how long is left and why. The switch turns it on or off without closing the summary. | — |
| **Rows** | AI usage (when accounts are tracked or a coding tool reports limits), the next event in the next while, and a tip (off by default) | Usage, the meeting link, Home |
| **Quick actions** | Four buttons of the same size, icon and a short name, and **More**, which unfolds the other actions under them. **Edit** opens Settings → Menu bar. Keep Awake is not repeated under More while its switch shows. | runs the action |
| **Recent downloads** | The three newest files in Downloads, each with an icon for its kind, the name cut in the middle (start and type stay readable) and its size. Right-click shows the file in its folder. **See all** opens Downloads. With none yet, a short note says new files show up here. | opens the file |
| **Footer** | **Open Keeper** (the main button), then Settings and Quit on the right | — |

## Size and layout

- The window is 360 points wide and exactly as tall as what it shows, never taller than the screen: the page measures itself and the main process resizes and re-places the window (`glance.fit`). Unfolding More makes it taller; folding it makes it shorter again. Nothing scrolls across or down.
- Every line is one line. Values are made short in `core/glance.ts` (`shortBytes`, `shortRates`, `shortTemp`, `middleTruncate`), and anything longer than its space ends with an ellipsis, with the full text in the tooltip.
- One spacing scale (4, 8, 12, 16), a 12 point gutter on every edge, text sizes and corners from the design tokens, one accent colour, light and dark from the app theme.
- Under the owl when the system says where the owl is (macOS, Windows); under the pointer otherwise (many Linux trays). Near the bottom of the screen (a Windows taskbar) it opens upwards.

## Keyboard and access

- Arrow keys move through everything that can be pressed, Enter or Space presses, Escape folds More and then closes the summary.
- The tiles, rows and buttons have names for screen readers (the tile's label, value and line under it); the Keep Awake switch is a switch.
- Hover colours change in a moment; with reduced motion nothing moves at all.

## Settings (Settings → Menu bar)

| Setting | Default |
|---|---|
| Keeper in the menu bar (tray) | on |
| Open the summary when I point at the owl (macOS) | on |
| Show readings | on |
| Show quick actions | on |
| Show recent downloads | on |
| What the summary shows: Weather, Storage, This computer, Network, Keep Awake, AI usage, Next event, Did you know | all but Did you know |
| Quick action buttons (pick 4, in order; the rest are under More) | Quick Search, Screenshot, Copy Text, Clipboard |

Older settings with more than four buttons keep the first four; the others move under More.

## Cost

The readings are taken only while the summary is open: every 2 seconds through the governor, paused while the computer is locked, and stopped when it closes. On Windows and Linux the owl's tooltip uses only readings that cost nothing.

## Platforms

- **macOS**: hover to open, a translucent pop-over under the menu-bar owl.
- **Windows**: a click opens it above the tray, at the bottom of the screen; the tooltip carries the readings.
- **Linux**: trays that report clicks open it under the pointer; others have *Glance…* in the owl's menu.

## Code

- `core/glance.ts`: settings, tiles, the status line, the short formats and the view (`glanceLayout`); unit tests in `test/glance.test.ts`.
- `electron/services/glance.ts`: the window, its place and height, hover and the live readings; `electron/ipc/glance.ts` gathers the readings.
- `src/glance/Glance.tsx` and `src/styles/glance.css`: the summary itself; Settings → Menu bar is `GlancePanel` in `src/screens/settings/panels.tsx`.
- `test/e2e/glance.cjs`: opens it and checks the parts, equal sizes, no overflow, the switch, More, the keyboard, Settings, light, dark and reduced motion.
