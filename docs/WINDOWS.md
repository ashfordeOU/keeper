# Pages in windows of their own, and app icons

Every page of Keeper (Mail, Calendar, Notes, Clean Up, Privacy & Security, Settings…) is a
page of the main window. Any of them can also open in a window of its own, and Mail,
Calendar, Notes, Reminders, Planner, Files, Studio, Terminal and Remote Desktops can have icons
of their own in the Dock, the Start menu or the app menu, which start them as light apps
([Light apps](SOLO.md)).

## Open in New Window

- **Where:** **View** at the right of the top bar → **Open in New Window**, right-click a page in the
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

## App icons: Keeper Mail, Keeper Notes, Keeper Files…

Settings → Features → **App icons** adds each one to Applications (Mac), the Start menu
(Windows) or the app menu (Linux), and removes it again (a switch per icon; only the parts that
are on are offered). Launching one while Keeper is closed starts a **light app** that runs only
that part ([Light apps](SOLO.md)); with Keeper open, it opens just its page in a window of
Keeper's. They need Keeper installed and share its settings, accounts and updates. Keeper only
removes what it made: something else at the same place is left alone.

| App icon | Opens | Runs on its own |
|---|---|---|
| Keeper Mail, Keeper Calendar, Keeper Reminders, Keeper Planner | Mail, Calendar, Reminders, Planner | mail and calendars |
| Keeper Notes | Notes | the notes vaults |
| Keeper Files | Home Folder (and the rest of the library) | the library |
| Keeper Studio, Keeper Terminal, Keeper Remote Desktops | their page | their own service |

On Windows and Linux they start Keeper with `--keeper-solo=<app>`; Keeper's single-instance
lock passes that to a Keeper that is running, which opens the app icon's page. On a Mac the
small launcher app starts Keeper with `--keeper-solo=<app>` when it is not running, and opens
`keeper://open/<page>` in it when it is. Any page in `core/nav.ts` still opens from outside with
`--keeper-open=<page>` or `keeper://open/<page>`; anything else is ignored.

| System | What is made | Where |
|---|---|---|
| macOS | a small app, "Keeper Mail.app", copied from inside Keeper.app (`Contents/Library/Launchers`) | `/Applications` when Keeper is there and it can be written, otherwise `~/Applications` |
| Windows | a shortcut, "Keeper Mail", to Keeper with `--keeper-solo=mail`, its own icon and its own app ID (`io.github.ashfordeou.keeper.mail`) | the Start menu (`%APPDATA%\Microsoft\Windows\Start Menu\Programs`) |
| Linux | `keeper-mail.desktop` with `Exec=<Keeper> --keeper-solo=mail`, its own icon and `StartupWMClass=keeper-mail` | `~/.local/share/applications` (or `$XDG_DATA_HOME/applications`) |

Shortcuts and desktop entries made by an earlier Keeper (`--keeper-open=<page>`) are recognised
as Keeper's and rewritten to the light-app form a little after Keeper starts.

- **Icons:** `scripts/launcher-icons.mjs` makes them from `build/icon.svg` (Keeper's owl with
  a round badge in the part's colour and its sidebar symbol) into `build/launchers/` as `.png`,
  `.ico` and `.icns`. The files are kept in the repository; run the script again after changing
  the icon. On Windows and Linux Keeper copies the icon into its data folder (`launchers/`) when
  it adds the shortcut, so a shortcut never points inside the app's archive.
- **macOS apps:** `keeper-launcher` (`native/macos/KeeperHelper/Sources/keeper-launcher`) is a
  small Swift program built with keeper-helper by the same `swift build` (the release
  workflow's "macOS helper" step, `scripts/build-mac-native.mjs` locally). It finds Keeper (the
  Keeper.app it ships in, or by its bundle identifier). With Keeper not running it starts it
  with `--keeper-solo=<app>` (`KeeperApp` in Info.plist); otherwise it opens
  `keeper://open/<page>` (`KeeperPage`) with it. Then it quits; it has no Dock icon of its own,
  and the light app it started shows its icon in the Dock. `build/after-pack.cjs` makes the
  bundles (`build/mac-launchers.cjs`: Info.plist with `KeeperApp` and `KeeperPage`, the program, the icon) inside
  Keeper.app before it is signed. They are signed like the rest of the app: by electron-builder
  for a Developer ID build (hardened runtime; `build/after-sign.cjs` stops the build if one is not
  Developer ID signed, and they are notarized with the app), or with the self-signed
  certificate by `build/after-sign.cjs` (each launcher, then the app). Copies in Applications
  are copied with `ditto`, so their signature stays whole, and are replaced when Keeper updates.
  `scripts/verify-package.cjs` lists them as missing when they were not built (required for
  releases).
- **Uninstalling:** the Windows uninstaller removes the Start menu shortcuts and their
  icons (not when updating). On a Mac and Linux they stay until removed in Settings (a Mac
  launcher whose Keeper is gone says so and offers nothing else).

## Checking it

- `npx vitest run test/page-window.test.ts test/launchers.test.ts`
- `KEEPER_SKIP_TOUR=1 xvfb-run -a -s "-screen 0 1440x900x24" node test/e2e/page-windows.cjs /tmp/kp-pw /tmp/kp-pw-shots`
  (Linux): Mail in a window of its own from the sidebar, no sidebar in it, a second request
  bringing it forward, `--keeper-open=calendar` and `keeper://open/notes` from a second start,
  the kept size, closing without quitting, Keeper Mail in the app menu and removed again, and a
  Keeper started with `--keeper-open` showing only that page.
- On a Mac and on Windows, by hand: add Keeper Mail in Settings → Features → App icons, pin it,
  quit Keeper, open Keeper Mail (only the Mail window appears), open it again (the same window
  comes forward), then remove it.
