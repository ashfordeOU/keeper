<!-- SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0 -->
# Accessibility in Keeper

Keeper should work for everyone: with a keyboard alone, with a screen reader, with large text, with less motion and with the system's high-contrast colours. This page lists what is supported, the keyboard shortcuts, and what we know is still limited.

On a Mac, ⌘ is Command. On Windows and Linux, read ⌘ as Ctrl.

## Settings → Accessibility

| Setting | What it does |
| --- | --- |
| **Reduce motion**: Follow system / On / Off | Cuts animations and transitions short everywhere: the Island's changes of shape, toasts, menus, page and panel transitions, and moving wallpapers. Wallpaper scenes show one still frame, and video and picture wallpapers hold still. "Follow system" uses the computer's own setting (macOS: Reduce motion; Windows: Animation effects; GNOME: Reduce animation). |
| **Text size**: Normal, 110%, 125%, 150%, 175%, 200% | Makes text and controls larger in the main window, the terminal window, dialogs, the command palette and Quick Look. The Island, the dictation pill and other small floating windows keep their size. |
| **Always show focus outlines** | Draws the focus ring after a click too, not only after using the keyboard. |

### Reading comfort (Settings → Accessibility → Reading and read aloud)

| Setting | What it does |
| --- | --- |
| **Wrap larger text** | With a larger text size, text grows and wraps to the window instead of the whole window zooming, so nothing needs scrolling sideways. |
| **Reading font**: Theme's own, Atkinson Hyperlegible, OpenDyslexic | Fonts made for reading, under the SIL Open Font License. Chosen once, the font downloads (17 to 120 KB per weight, Latin letters) from a pinned package on a public mirror, is checked against its fingerprint and kept in Keeper's folder; a file that does not match is not used. Code and terminals keep their fixed-width font. |
| **Line spacing**: Theme, 1.4, 1.6, 1.8 · **Letter spacing**: Normal, Wider, Widest | More room on pages, in notes, mail, articles, dialogs and help. |
| **Larger buttons** | Buttons, switches, tabs and fields at least 44 pixels tall (icon buttons as wide). |
| **Read aloud** (part *Read aloud*, off until switched on) | **Read Aloud** in the command palette reads the selected text, or the page; **Read aloud** in Notes' menu reads the open note; **Stop Reading Aloud** stops. It uses the computer's own voice: `say` on a Mac, the Windows speech voices, speech-dispatcher (`spd-say`) or eSpeak NG on Linux. Markdown marks and link addresses are left out. The words go to the voice on its standard input (or as one argument to `spd-say`), never inside a script. |

The add-ons in [Modes](MODES.md) use these: Easier reading turns on Read aloud with line spacing 1.6 and wider letters, Steady hands turns on Larger buttons, Screen reader turns on Read aloud.

### Tables

Up and Down move between the rows of a table (processes, connections, Keeper itself and the others): focus goes to the same button in the next row, or to the row.

Keeper also follows two system settings on its own:

- **More contrast** (macOS: Increase contrast; GNOME: High contrast): muted text and outlines become stronger and buttons gain borders.
- **Forced colours** (Windows: Contrast themes): Keeper uses the system's colours. Switches, tick boxes, the selected item and the focus ring stay visible with the system's highlight colour.

## Seeing where you are

- Every focusable control shows a 2px focus ring in the theme's accent colour (in the Minimal theme, the text colour; on the Island and pills, the Island's accent). It appears after keyboard use, or always with **Always show focus outlines**.
- All 38 themes, in light and dark, meet WCAG AA contrast for body text, secondary text and muted text (4.5:1) on the window, cards, sunk panels and hovered rows, and 3:1 for the accent and status colours used on controls. Badges and chips pull their status colour a third of the way toward the text colour so they read at 4.5:1 on their tinted background. `test/a11y-contrast.test.ts` checks every theme.

## Screen readers

- **Landmarks**: the sidebar is a navigation landmark, the page is the main landmark, and the inspector is a complementary landmark. The sidebar marks the page you are on (`aria-current`).
- **Skip to content**: the first Tab in the window shows a "Skip to content" button that moves focus straight to the page.
- **Names**: icon-only buttons have an `aria-label` (as well as a tooltip). Switches, tick boxes, sliders and form fields have names; ones that sit in a settings row take the row's title.
- **Roles**: switches (`role=switch` with `aria-checked`), tick boxes, radio groups and segmented choices, tabs, the notes tree (`tree`/`treeitem` with levels and expanded state), the file grid (`listbox`/`option`, multi-select), the file list (a table with sortable column buttons and `aria-sort`), menus (`menu`/`menuitem`), the command palette, Quick Search and the tool launcher (`combobox` with a `listbox`), dialogs (`dialog`, `aria-modal`) and progress bars (`progressbar` with a value).
- **Announcements**: toasts are read politely as they appear; Island alerts (downloads, notifications, timers) are read as they arrive; long jobs (convert, clean up, duplicates and others) are announced when they start and when they finish; loading states are status messages.
- **Images**: file thumbnails are decorative (the file's name, size and date are on the card); icons inside buttons are hidden from screen readers; wallpaper windows are hidden from screen readers.

## Keyboard

### Everywhere

| Keys | Action |
| --- | --- |
| Tab / Shift+Tab | Move between controls |
| Enter or Space | Press the focused button, switch or sidebar section |
| Esc | Close the menu, dialog, palette or Quick Look in front |
| ⌘K | Command palette: every page and action |
| ⌘F | Search |
| ⌘, | Settings |
| ⌘[ | Back |
| ⌘⇧L | Switch between your last two themes |
| ⌘⇧. | Show or hide hidden files |
| ⌘⇧D / ⌘⇧K / ⌘⇧J | Duplicates / Clean Up / Downloads |
| ⌘I | Show or hide the inspector |
| ⌘T, ⌘W, ⌘⇧T | New tab, close tab, reopen the last closed tab (when tabs are on) |
| Ctrl+Tab / Ctrl+Shift+Tab | Next / previous tab |
| ⌃1–9 (Mac) or Alt+1–9 | Go to a tab by its place |

### Menus, tabs and choices

- **Menus and right-click menus**: focus starts on the first item. Up/Down move, Home/End jump to the first or last item, a letter jumps to the next item starting with it, Enter runs it, Esc or Tab closes the menu and focus goes back where it was.
- **Opening a right-click menu from the keyboard**: Shift+F10 or the Menu key on a file.
- **Tabs, radio groups and segmented choices**: Left/Right (or Up/Down) move and choose, Home/End go to the ends.
- **Command palette, Quick Search and the tool launcher**: type to filter, Up/Down move, Enter runs, Esc closes. In the palette, Page Up/Page Down move faster.
- **Dialogs**: focus moves into the dialog, Tab stays inside it, Esc closes it, and focus returns to what opened it.

### Files

| Keys | Action |
| --- | --- |
| Arrow keys | Move between files (focus and selection move together) |
| Home / End | First / last file |
| Letters | Type the start of a name to jump to it |
| Enter | Open |
| Space | Quick Look |
| ⌘A | Select all |
| ⌘C | Copy the selected files |
| ⌘⇧C | Copy the text in the selected images or documents |
| Delete or ⌘⌫ | Move to the Trash (with Undo) |
| ⌘1 / ⌘2 | Grid / list |
| ⌘+ / ⌘− | Larger / smaller cards |

In the list view, the column headings are buttons that sort by that column.

### Quick Look

| Keys | Action |
| --- | --- |
| ← → (or [ and ]) | Previous / next file |
| I | Details panel |
| F | Full screen |
| ⌘⇧C | Copy the text |
| ⌘Enter | Open in its app |
| ⌘⌫ | Move to the Trash |
| Esc or Space | Close |

### Sidebar, notes and the Island

- **Sidebar sections**: each section title is a button; Enter or Space opens or closes it.
- **Notes**: the file tree is one Tab stop. Up/Down move, Right opens a folder, Left closes it, Enter opens the note.
- **Space map**: each block is a button; Enter opens it.
- **The Island**: closed, it is one button (Enter or Space opens it); open, Esc closes it. Its tools are toggle buttons with names.

## Checking it

- `test/a11y-contrast.test.ts` (part of `npm test`): text, muted text, controls and status badges in all 38 themes, light and dark.
- `test/e2e/a11y.cjs`: opens the real app under a virtual display and checks every page, the Island (closed and open), the command palette, Quick Look, the file grid, list and menu, the rename dialog and every settings section, in light and dark. It fails on any serious or critical problem: missing names, broken roles or ARIA references, unreadable text, controls you can click but not reach with the keyboard, and images without text. It also drives the keyboard: Skip to content, focus rings, the palette, the file grid, menus, dialogs, sidebar sections, tabs and the Accessibility settings.

  ```
  KEEPER_SKIP_TOUR=1 xvfb-run -a -s "-screen 0 1440x900x24" node test/e2e/a11y.cjs /tmp/ka11y /tmp/ka11y-shots
  ```

## Known limits

- **The checker is Keeper's own**, not a full WCAG audit tool. It covers the problems that come up most (names, roles, ARIA references, contrast of plain-coloured text, keyboard reach, images) but cannot judge text over pictures and gradients, reading order, or whether a name is helpful. Testing by hand with screen readers (VoiceOver, NVDA, Narrator, Orca) is still needed; the automated checks do not replace it.
- **Names from context**: form fields and switches that were given no name of their own take one from the settings row or line they sit in. That is right almost always, but a few names may be shorter or vaguer than they should be.
- **Text size** scales the whole main window unless **Wrap larger text** is on. Wrapping grows the type scale; a few older stylesheets still size some text in pixels, which stays as it is. The Island and pills do not grow.
- **Charts, the space map's bubbles, the world map, the knowledge graph and wallpaper scenes** are drawn pictures. Their numbers are in text beside them where it matters (the space map's list, the health page's readings), but the pictures themselves cannot be explored with a screen reader.
- **The terminal** follows the terminal component's own screen reader support, which reads output line by line but not in full-screen programs.
- **Remote desktops and screen sharing** show another computer's screen as a picture; what is on it is not available to a screen reader.
- **Placeholder-only fields**: a few search and filter fields are named only by their placeholder text, which screen readers read but which disappears once you type.
- **Island alerts in the background**: some screen readers only read live announcements from the window in front, so an Island alert may not be spoken while you work in another app.
