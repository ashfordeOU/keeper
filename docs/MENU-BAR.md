# The owl's summary (menu bar and tray)

Keeper has one icon in the menu bar (macOS) or the system tray (Windows, Linux): the owl. A left click opens a small summary under it; on macOS resting the pointer on the owl opens it too (Settings → Menu bar → *Open the summary when I point at the owl*, on by default there). A right-click (or Option-click on macOS) gives the classic menu. In code it is called the glance.

## What it shows

From top to bottom, each part one click away from its page:

| Part | What it shows | Click |
|---|---|---|
| **Header** | Keeper and one line of status: **All good**, or the one thing that most needs attention (no internet connection, the disk almost full or getting full, memory running out, a low battery, an AI limit used up or running low; problems before warnings) | the page for that thing |
| **Readings** | Four tiles of the same size: weather, the main disk, this computer and the network. Each has a small label, one short value that never wraps (`7°C`, `96 GB free`, `CPU 12%`, `↓34 ↑2 KB/s`), one short line under it, and one thin bar where there is an amount (disk used, memory used). The whole reading is in the tooltip. Amber and red follow the same limits as the status line. | Weather, Space, Health, Network activity |
| **Keep Awake** | A switch row: off ("the computer can sleep"), or how long is left and why. The switch turns it on or off without closing the summary. | — |
| **Network** | One line: how many apps are online (talking to the internet, not only to this computer or the local network) and how fast it all goes, with a small chart of the last readings; the three busiest apps with their speed and a **Block** button (**Allow** undoes it) where this computer can block single apps; **2 waiting** when new connections wait for an answer (opens the prompt); **Open Network** | Privacy & Security → Network & firewall |
| **Rows** | AI usage (when accounts are tracked or a coding tool reports limits), the next event in the next while, and a tip (off by default) | Usage, the meeting link, Home |
| **Quick actions** | Four buttons of the same size, icon and a short name, and **More**, which unfolds the other actions under them. **Edit** opens Settings → Menu bar. Keep Awake is not repeated under More while its switch shows. | runs the action |
| **Recent downloads** | The three newest files in Downloads, each with an icon for its kind, the name cut in the middle (start and type stay readable) and its size. Right-click shows the file in its folder. **See all** opens Downloads. With none yet, a short note says new files show up here. | opens the file |
| **Footer** | **Open Keeper** (the main button), then Settings and Quit on the right | — |

## Size and layout

- The window is 360 points wide and exactly as tall as what it shows, never taller than the screen: the page measures itself and the main process resizes and re-places the window (`glance.fit`). Unfolding More makes it taller; folding it makes it shorter again. Nothing scrolls across or down.
- Every line is one line. Values are made short in `core/glance.ts` (`shortBytes`, `shortRates`, `shortTemp`, `middleTruncate`), and anything longer than its space ends with an ellipsis, with the full text in the tooltip.
- On a short screen it still never scrolls: when it would be taller than the screen, Recent downloads fold to their heading (See all stays), and then the Network part to its one line.
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
| Show network | on (the part needs Network & firewall on) |
| Show quick actions | on |
| Show recent downloads | on |
| What the summary shows: Weather, Storage, This computer, Network, Keep Awake, AI usage, Next event, Did you know | all but Did you know |
| Quick action buttons (pick 4, in order; the rest are under More) | Quick Search, Screenshot, Copy Text, Clipboard |

Older settings with more than four buttons keep the first four; the others move under More.

## Cost

The Network part reads the connections (the same reading as the firewall's live view) only while the summary is open, every 2 s; nothing runs for it otherwise. The readings are taken only while the summary is open: every 2 seconds through the governor, paused while the computer is locked, and stopped when it closes. On Windows and Linux the owl's tooltip uses only readings that cost nothing.

## Platforms

- **macOS**: hover to open, a translucent pop-over under the menu-bar owl.
- **Windows**: a click opens it above the tray, at the bottom of the screen; the tooltip carries the readings.
- **Linux**: trays that report clicks open it under the pointer; others have *Glance…* in the owl's menu.

## Code

- `core/glance.ts`: settings, tiles, the status line, the short formats and the view (`glanceLayout`); unit tests in `test/glance.test.ts`.
- `electron/services/glance.ts`: the window, its place and height, hover and the live readings; `electron/ipc/glance.ts` gathers the readings.
- `src/glance/Glance.tsx` and `src/styles/glance.css`: the summary itself; Settings → Menu bar is `GlancePanel` in `src/screens/settings/panels.tsx`.
- The Network part: `glanceNetwork()` in `electron/services/fw/index.ts` (read only while the summary is open), `glanceNetView()` in `core/glance.ts`, `NetPart` in `src/glance/Glance.tsx`; `test/e2e/netmon.cjs` checks it.
- `test/e2e/glance.cjs`: opens it and checks the parts, equal sizes, no overflow, the switch, More, the keyboard, Settings, light, dark and reduced motion.

## Other apps' icons (Mac)

A separate part, **Menu bar icons** (`menuBarItems`, Settings → Features → Desktop, **off** until you turn it on), keeps other apps' icons out of sight on a Mac.

- **The divider.** Keeper adds a second, small item to the menu bar: a short bar with a notch. Icons left of it are hidden: while hiding, the divider's title grows as wide as the screen, so everything left of it is pushed past the left edge (the same thing a very wide icon does). A click shows them; they hide again after 15 seconds (5, 30, 60 or never, under More settings). A right-click lists the hidden icons; choosing one shows them and opens that icon's menu. Hidden icons are still running and still work.
- **Choosing which.** Settings → Menu bar → Other apps' icons lists the icons *In view* and *Hidden*. **Hide** and **Keep in view** move an icon across the divider with a ⌘-drag, exactly as you would by hand, then put the pointer back where it was. **Open** opens a hidden icon's menu. The clock and Control Centre are marked *Stays put*.
- **When one changes.** With *Show a hidden icon that changes* on (More settings, off by default), Keeper looks at the hidden icons every 5 seconds while they are hidden; when one changes width (a badge, a timer, a status) it shows them for a moment and puts a dot on the divider.
- The palette has **Show Hidden Menu Bar Icons**.

| What | How (all public) | Needs |
|---|---|---|
| Which icons there are, and where | `CGWindowListCopyWindowInfo`: status windows (level 25) with their owner and place, through JavaScript for Automation's ObjC bridge | nothing |
| Hiding | an ordinary status item of Keeper's own (Electron's `Tray`) whose title is a run of wide spaces | nothing |
| Moving an icon | synthetic mouse events with ⌘ held (`CGEventCreateMouseEvent`, `CGEventPost`) | Accessibility |
| Opening a hidden icon | System Events: the app's second menu bar, `AXPress` on the nearest item | Accessibility |

On **macOS 26** the system has its own Menu Bar settings for hiding icons; the panel says so, and both can be used together.

**Windows** already keeps extra icons in the taskbar's overflow (the ^ by the clock): the panel says so and **Open taskbar settings** opens Settings → Personalisation → Taskbar, where you choose them. **Linux** trays differ on each desktop (and GNOME has none by default), so the panel says plainly that Keeper cannot hide or move other apps' icons there, with no button. Nothing of this part runs on Windows or Linux.

What was checked: the pure parts (reading the status windows, which side of the divider, the divider's width and dot, the ⌘-drag's path, what changed, settings, what each system allows, the divider's template picture) have unit tests in `test/menubar-items.test.ts`; `test/e2e/desk.cjs` checks the Linux panel and that no divider is made there. The divider, the list, ⌘-drag moves and opening an icon have **not** run on a Mac yet: they need checking on a real Mac with Accessibility granted (macOS 13 to 15 and macOS 26, a notch MacBook, and with Monorail's menu bar item present).
