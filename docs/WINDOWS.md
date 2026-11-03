# Pages in windows of their own

Every page of Keeper (Mail, Calendar, Notes, Clean Up, Privacy & Security, Settings…) is a
page of the main window. Any of them can also open in a window of its own.

## Open in New Window

- **Where:** the window button at the right of the top bar, right-click a page in the
  sidebar → **Open in New Window**, the command palette (*Open Mail in New Window*, or type
  a page's name and *in New Window*), **Window → New Window for This Page**, or
  <kbd>⌥⌘N</kbd> (<kbd>Ctrl Alt N</kbd> on Windows and Linux).
- **What it shows:** just the page, with its name in the top bar; no sidebar and no tabs.
  Links inside it (a message, a day) stay in that window. The frame is the main window's:
  traffic lights on a Mac, the system's buttons elsewhere. It is named after its page
  ("Mail — Keeper") in the Dock's and the Window menu's lists, the taskbar and window switchers.
- **One per page:** asking for a page that already has a window brings that window to the
  front (and shows the message or day asked for in it).
- **Size and place** are kept per page in settings (`pageWindows`, never exported with
  Settings → Export) and used the next time the page opens: moved back onto a screen and made
  to fit when the screen it was on is gone or smaller.
- **Closing one never quits Keeper**, even with the menu-bar or tray icon off. On a Mac the
  Dock icon stays while a page window is open.
- **What only the main window shows:** alarms ringing, prompts from other devices, approvals,
  guided fixes, the tour and What's new appear once, in the main window.
- **Shortcut clash:** <kbd>⌥⌘N</kbd> / <kbd>Ctrl Alt N</kbd> is also the Island's **New task**
  shortcut, which works from anywhere. While a Keeper window is in front, Keeper keeps the keys
  for New Window for This Page; everywhere else they still open New task. Change either one in
  Settings → Island → Shortcuts.

- **From outside Keeper:** `--keeper-open=<page>` on Keeper's command line, or the link
  `keeper://open/<page>`, opens that page's window in the running Keeper (the single-instance
  lock hands it over); a Keeper started this way shows only that page's window. Any page in
  `core/nav.ts` works (`keeper://open/mail`, `--keeper-open=cleanup`); anything else is ignored.

### How it works

- `core/page-window.ts`: which page a request names (only Keeper's own pages from
  `core/nav.ts`), the window's name, and where it opens (`placePageWindow`, fitted to the
  displays connected now). Tested in `test/page-window.test.ts`.
- `electron/services/page-windows.ts`: makes the windows (`windows.openPage`, `windows.list`),
  one per page. They load the same interface and preload script as the main window with
  `view=page&page=<page>&route=<route>`, so every call works in them, and `broadcast()` in
  `electron/main.ts` reaches them like every other window.
- `src/App.tsx` with `src/page-window.ts`: the page alone, without the sidebar, tabs or the
  main window's prompts. A page window does not change where the main window opens next.
- Each page window keeps its own session (`page:<page>` in `electron/resilience.ts`):
  whatever was typed in it (a mail being written) is kept apart from the main window's tabs,
  comes back if Keeper stops unexpectedly, and is forgotten when the person closes the window.
  Mail's drafts are also saved to the account's Drafts folder, so two windows on Mail see the
  same drafts once they are saved there (a few seconds after typing stops).

## Checking it

- `npx vitest run test/page-window.test.ts`
- `KEEPER_SKIP_TOUR=1 xvfb-run -a -s "-screen 0 1440x900x24" node test/e2e/page-windows.cjs /tmp/kp-pw /tmp/kp-pw-shots`
  (Linux): Mail in a window of its own from the sidebar, no sidebar in it, a second request
  bringing it forward, `--keeper-open=calendar` and `keeper://open/notes` from a second start,
  the kept size, closing without quitting, and a Keeper started with `--keeper-open` showing
  only that page.
