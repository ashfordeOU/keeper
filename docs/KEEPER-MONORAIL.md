<!-- SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0 -->
# Keeper and Monorail on the same Mac

Keeper by Ashforde® and Monorail (Ashforde's scrolling window manager) are
two products that must work together without effort: someone who uses both
should never have to think about it. This page lists every place the two
meet, what each one does there, where they could get in each other's way, and
how that is settled. Keeper's side is built (unless a row says otherwise);
Monorail's side is a proposal for the Monorail repository.

How Monorail decides what it manages (from its source): it tiles a window
when its role is `AXWindow` with the subrole `AXStandardWindow`, it is not
minimised or full screen, its position can be set, it is at least 80 × 60, its
app is a regular (Dock) app that is not hidden, it is not a system prompt
service, and it does not look like a dialog (modal, or no minimise and no
full-screen button). Its float rules (`appRules`, by bundle and title) then
float some of those. Windows above the modal-panel level, and small title-less
panels against the menu bar, are never moved, not even to keep them on screen.

## The table

| Area | Keeper | Monorail | Where they could clash | Settled by |
|---|---|---|---|---|
| **Which windows Monorail tiles** | Main window, tool windows (`… — Keeper`), Terminal, Keeper Browser, the remote-screen viewer: ordinary resizable windows | Tiles every standard window | Keeper's main window had a minimum of 760 × 520: larger than Monorail's default half-width column (708 points on a 1440-point screen) and a two-high slide (about 420 points on a 900-point screen), so macOS refused the size and Monorail kept putting it back | The main window's minimum is now **480 × 360** (`TILE_MIN`, core/ashforde/coexist.ts; a test checks it fits a half column and half a slide on 1280 × 800 and 1440 × 900). Below 860 points the sidebar folds to icons. Tool windows (360 × 300), Terminal (480 × 280) and the viewer (480 × 320) already fit. No Keeper window has a fixed size. |
| **Which windows Monorail must leave alone** | The Island, clipboard picker, Glance pop-over, voice pill, cues, launcher, Stage overlay and backdrop, widgets, wallpaper, Quick Connect, the guide, the sharing bar | Leaves panels and high-level windows alone; floats what its rules say | The Island was tiled as a column (it was a standard window) | Built by the overlay work (electron/services/unmanaged.ts): every overlay is a panel (not `AXStandardWindow`), hidden from Mission Control, with a fixed title, and `keeper-overlay-*` float rules go into Monorail's settings whenever it is installed. Quick Search, Quick Terminal and Capture float by Keeper's own rules. **Monorail side (proposal):** a built-in "never manage" rule for Keeper's bundle and those titles, so nothing depends on the settings file. |
| **Global shortcuts** | ⌘⇧ and ⌘⌥ shortcuts (Quick Search, capture, dictation, paste, shelf, Keep Awake, vibes…), the computer-use stop key ⌃⌥⌘. | ⌃⌥, ⌃⌥⇧ and ⌃⌥⌘ (snap) keys | macOS gives a key to whoever registered it first; the other app's shortcut silently does nothing | Keeper compares **every** shortcut in its settings (now including grouped ones such as the vibes' keys) and its fixed ones with Monorail's real keymap (or its defaults). Each clash gets a **suggested free key** (same letter, never ⌃⌥, not taken by either app or by macOS) and a one-click **Use ⇧⌘H in Keeper** on the Ashforde card; To do names the free key too. Keeper's defaults clash with nothing (tested). Monorail's keymap is never changed by Keeper. |
| **Stage: hide other apps** | Hides every visible app except the front one, Keeper, recorders and meeting apps; shows them again after | Forgets the windows of a hidden app and lays out the rest; puts them back from memory when the app shows again | The strip collapses while Stage is on (expected) and windows could come back on another workspace or slide; Stage also hid Monorail itself (an accessory app), hiding its overlays | Monorail is never hidden (its presentation mode hides its overlays instead). Before hiding, Keeper reads Monorail's window list (`GET /windows`); after showing the apps, it waits for Monorail to take them back (a few looks over about four seconds, never more), moves any window that came back on another workspace (`POST /move`) and asks for one re-tile. What happened is on Stage's "put back" list and in `ashforde.coexist`. |
| **Stage: Dock, menu bar, resolution** | Hides the Dock and the menu bar, may change the resolution, all put back from a journal | Re-lays out on every screen change | The usable area changes twice | Nothing to settle: Monorail re-tiles to the new area each time, and Keeper's journal puts the Dock and menu bar back. The Mac test kit checks the layout is identical afterwards. |
| **Stage and Monorail's overlays** | Clean screen for recording and presenting | Slider bar, borders, notices on screen | Monorail's notices and borders showed up in recordings | Every Stage (not only the presentation preset) switches Monorail's presentation mode on, and off when it ends (with "Presentation mode together"). |
| **Focus** | Focus sessions (the Island's timer) | Focus mode (dims all but the current slide, its own timer) | Two separate modes; echo loops if each follows the other naively | **Both ways**, one owner at a time (`keeperModeChanged` / `monorailModeChanged`): Keeper's session switches Monorail's mode; Monorail's mode (read from `state.json`) starts or ends Keeper's session. Whoever started it ends it: Monorail's own timer ending a session Keeper started does not end Keeper's, and nothing is re-sent. The first state after start-up is only noted, so Keeper never starts a session just because Monorail was already in one. |
| **Presentation** | Presentation mode (Stage's presentation preset) | Presentation mode (overlays and notices hidden) | Same as Focus | Keeper → Monorail now; Monorail → Keeper as soon as Monorail publishes `presenting` in `state.json` (Keeper already reads it; proposal). Same owner rules. |
| **Keep Awake** | Keep Awake sessions and triggers (caffeinate plus a power hold; battery, heat and closed-lid rules) | Stay Awake sessions and triggers (power assertions, cursor nudge, closed lid) | Two holds: switching one off leaves the Mac awake, and nobody knows why | **One owner.** When Keeper starts a session and Monorail's Stay Awake has a session you started by hand, Keeper takes it over (`POST /awake off`) and says so; a session from a Monorail trigger cannot be ended from outside and is mentioned instead. When Keeper's session ends and Monorail still holds the Mac awake, Keeper says so. **Monorail side (proposal):** while Keeper is there and owns staying awake, Monorail's Stay Awake forwards to `keeper://awake` instead of holding its own. |
| **The Island and the top edge** | The Island sits in the notch or the menu bar; the sharing bar at the top of the screen | Slider bar (bottom by default, or top), notices (top by default) | Overlap at the top | The Island already moves below a top slider bar; the **sharing bar** now does too. Monorail's notices are brief (1.8 s) and pass under an open Island; nothing to settle (proposal: notices can go to the Island once the handshake exists). |
| **Themes and accent** | Themes (accent comes with the theme) | Themes | Keeper rewriting a theme picked in Monorail | "Match Keeper's theme" (off by default) writes Monorail's closest theme only when **Keeper's** theme changes or the switch is turned on; a theme picked in Monorail afterwards is left alone (`shouldPushTheme`). Monorail has no separate accent. |
| **Desktop picture** | Live wallpaper (a desktop-level window) or a still picture | Per-workspace desktop pictures; a drifting wallpaper window just above the desktop | Monorail replaces Keeper's picture on every workspace switch, or covers the live wallpaper | Keeper detects either setting and says to choose one for the desktop (`desktopOverlap`, shown in `ashforde.coexist`). |
| **AI and computer use** | Agents click, type and "bring a window forward"; Monorail's tools through Keeper's MCP server | Moves windows itself; its MCP tools | Raising a tiled window does not scroll the strip, so it can stay parked at the edge; an agent's drag on a title bar swaps tiles | When Monorail runs, `focus_window` goes through Monorail (`POST /focus`, which scrolls the strip to it), and `list_windows` says where each window sits ("Monorail workspace 2, slide 3") and to bring windows forward rather than drag them. Moving or pairing windows is done with the `monorail_*` tools (approval as set). |
| **Notifications** | The Island's alerts, system notifications | Its own notices (an overlay), its alerts | Duplicate announcements; Monorail's notices during a recording | Following a mode is silent on Keeper's side (no alert when Keeper follows Monorail's focus mode); during any Stage Monorail is in presentation mode, which mutes its notices. Proposal: a `quiet` flag on links sent by Keeper. |
| **Updates** | Installs and updates Monorail (checksum, signature, pinned certificate) | Updates itself (same checks; a relaunch script swaps the app) | Both offer the same update; both swap the app at the same time | **One updater.** Keeper's daily check and its To do item run only when Monorail's own check is off (`updatesBy`); the card says Monorail updates itself. Keeper refuses to update while Monorail's updater is swapping the app (its `monorail-update` script or `Monorail.app.previous`), and checks again just before it quits Monorail. |
| **Performance** | One folder watch on Monorail's folder (only while the switch is on) | Writes `state.json` (coalesced, at most four times a second) | A Monorail writing in a loop keeps Keeper reading | `state.json` is read at most 40 times in 10 seconds; beyond that Keeper waits 30 seconds and reads once (`TugGuard`). Keeper's own put-back loops: the Island's snap-back gives up after 12 moves in 10 s and falls back to its stable place; Monorail's snap-back gives up after 4 in 10 s; Keeper's windows no longer refuse Monorail's sizes, so neither side keeps correcting the other. `TugGuard` is shared for any future put-back. |
| **Handshake** | Keeper's own channel answers `keeper/hello` (who it is, what it owns, its overlays, its links) | Local API on 127.0.0.1 with a private key | Neither app knew the other was there | Keeper sends `POST /peer` and asks `GET /hello` when the switch goes on (ignored by today's Monorail). **Monorail side (proposal):** those two routes, and `presenting`, `awake`, `paused` in `state.json`. |
| **System prompts** | Panels at floating or screen-saver level | Brings macOS permission prompts to the front when other windows cover them | Keeper's overlays covering a prompt | Keeper's overlays are small and placed away from the centre, or ignore the mouse (Stage); the spotlight and the voice pill sit above screen-saver level, which Monorail's check leaves out. Nothing to settle. |

## Checking it

- **Linux and CI**: `test/ashforde-coexist.test.ts` (window kinds and sizes,
  shortcut suggestions, Focus and presentation in both directions without
  loops, the awake hand-over, Stage layout repair, the loop guard, the update
  owner, theme rules, the handshake), `test/ashforde.test.ts`, and the
  `ashforde`, `stage`, `awake` and `cu-native` end-to-end tests.
- **A Mac with Monorail** (`scripts/mac-test`, area `monorail`, skipped when
  Monorail is not installed): Monorail tiles Keeper's main window; none of
  Keeper's overlays is in Monorail's window list; no shortcut clash with
  Monorail's real keymap; Stage on and off leaves every tiled window on its
  workspace and slide; Focus follows both ways. The last two ask first, point
  the test Keeper at the real Monorail folder (`KEEPER_MONORAIL_DIR`) and put
  Monorail's settings back afterwards.

## Code

- `core/ashforde/coexist.ts` — the rules (pure).
- `electron/services/ashforde/coexist.ts` — Focus and presentation, Keep
  Awake, Stage, computer use, the handshake.
- `electron/services/ashforde/monorail.ts` — the update owner, the theme rule,
  the read guard, clash suggestions, the sharing bar's place.
- `electron/ipc/ashforde.ts` — `ashforde.coexist`, `ashforde.useShortcut`,
  `keeper/hello`, the Keep Awake hand-over.
