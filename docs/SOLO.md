# Light apps: one part of Keeper on its own

Someone who only wants their mail (or notes, or files) should not pay for all of Keeper. The
app icons in Settings → Features → **App icons** (Keeper Mail, Keeper Calendar, Keeper Notes,
Keeper Reminders, Keeper Planner, Keeper Files, Keeper Studio, Keeper Terminal, Keeper Remote
Desktops; see [Pages in windows of their own](WINDOWS.md)) start a **light app** when Keeper is
closed: the same program, settings, accounts, passwords and updates, running only that part.

## What a light app runs

| App icon | Its window | What runs |
|---|---|---|
| Keeper Mail, Calendar, Reminders, Planner | Mail, Calendar, Reminders, Planner | mail accounts, the outbox and Send later, snoozes, calendars and their sync, reminders, alarms and alerts (in the light app's own process) |
| Keeper Notes | Notes (and Journal) | the notes vaults, read while the window is open |
| Keeper Files | Home Folder and the rest of the library | the library Keeper saved (`index.json`), read again once when it is older than half an hour; no text reading, download sources or brain |
| Keeper Studio | Studio | recording and editing (it keeps the graphics card) |
| Keeper Terminal | Terminal | the terminal host |
| Keeper Remote Desktops | Remote Desktops | saved connections and sessions |

Every light app also answers settings, features, permissions, previews and its own windows.

**What stays off:** the library index (except in Keeper Files), the Island, desktop widgets,
the menu bar or tray icon, the system monitor, sync and backups, Keeper Link and remote screens,
the AI brain and agents, automations and Quick Search, global shortcuts, the suite's parts and
the updater. None of their code is even loaded: the light app is its own entry
(`electron/solo/main.ts`), and it loads each part's code only when that part starts.

It draws without a graphics process and has no network process of its own. Keeper Studio started
first keeps the graphics card for recording and exporting (this is decided when the light app
starts; Studio joining a light app that started without it draws in software too).

## Memory and processor

Measured on Linux with `test/e2e/perf-budget.cjs` (the same small home folder, a minute to
settle, then a minute doing nothing; one run each, the same build and machine). PSS divides
shared pages between the processes that map them; private memory is what quitting would give
back; anonymous memory is what Keeper allocates itself.

| Started | Processes | PSS | Private | Anonymous | Processor (idle) |
|---|---|---|---|---|---|
| Keeper itself (main window, Island, Mail part) | 12 | 469 MB | 299 MB | 319 MB | 0.30 % |
| Keeper Mail | 4 | 174 MB (37 %) | 89 MB (30 %) | 105 MB (33 %) | 0.05 % |
| Keeper Notes | 4 | 173 MB (37 %) | 89 MB (30 %) | 101 MB (32 %) | 0.05 % |
| Keeper Reminders | 4 | 168 MB (36 %) | 89 MB (30 %) | 105 MB (33 %) | 0.05 % |
| Keeper Calendar | 4 | 271 MB (58 %) | 164 MB (55 %) | 110 MB (34 %) | 0.05 % |

Calendar's own page costs more to draw than Mail's empty inbox (its week grid: about 45 MB more
in the light app's main process and 30 MB in its page, the same in two runs; what it allocates
itself, the anonymous memory, is nearly the same as Mail's). Giving it a graphics process made it
larger, not smaller (326 MB PSS). The light app's own code at start is about 0.4 MB of script
against about 6 MB for Keeper's.

`KEEPER_PERF_MODE=solo KEEPER_PERF_SOLO=<app>` holds a light app to half of Keeper's default
budgets (290 MB PSS, 200 MB private, 172 MB anonymous).

## Starting, joining, handing over

`--keeper-solo=<app>` on Keeper's command line (Windows shortcuts and Linux desktop entries pass
it; the Mac launcher apps pass it when Keeper is not running). `core/solo.ts` decides
(`soloStart`):

- **Keeper is running** (or a light app is): the request goes to it through the
  one-per-person lock (`electron/instance.ts`), and the start quits. Keeper opens the page in a
  window of its own; a light app adds that app icon (below).
- **Light apps are switched off** ("Start only what they need" under App icons, feature
  `soloApps`), the part is off, Keeper is in safe mode, or a part of an earlier Keeper is still
  running (the Island or Mail outliving a crash): Keeper itself starts, showing only that page's
  window, and adopts the part.
- Otherwise it starts as a light app and takes the same locks Keeper takes.

While a light app runs:

- **Another app icon** (`--keeper-solo=notes`, `--keeper-open=calendar`, `keeper://open/mail`)
  joins the same process: its services start (once: Mail and Calendar share theirs) and its
  window opens.
- **Anything else** (Keeper itself, a `keeper://` link, a file, another page, Open Keeper in
  the top bar or the app menu): Keeper takes over. The light app saves its windows' places,
  stops its services (Mail saves what it was doing), lets go of the lock and starts Keeper with
  the request and `--keeper-reopen=<pages>`; Keeper opens those windows again. Never two
  processes with the same services or locks.
- A window keeps its own part (Keeper Files goes anywhere in the library); a page of another app
  icon opens in that app's window, and any other page is handed to Keeper.
- Alerts (new Important mail, reminders, alarms) are system notifications: there is no Island.
  A click opens the page they are about.
- Closing its last window quits it on Windows and Linux; on a Mac it stays in the Dock until
  quit, like any app. Send later, snoozes and alarms run while it (or Keeper) runs.

## Its own place in the Dock and the taskbar

| System | How |
|---|---|
| macOS | the launcher app in Applications has the app icon's name and icon; the light app sets the same icon on its Dock tile (the Dock still names it Keeper, since it is Keeper's program) |
| Windows | the light app uses the app icon's own app ID (`io.github.ashfordeou.keeper.mail`), and its Start menu shortcut carries the same, so its windows group under that icon on the taskbar, apart from Keeper's |
| Linux | the light app runs as `keeper-mail.desktop` (its window class and Wayland app ID are `keeper-mail`), matching `StartupWMClass` in its desktop entry |

Its windows are named after it ("Keeper Mail") and carry its icon.

## Checking it

- `npx vitest run test/solo.test.ts test/launchers.test.ts test/page-window.test.ts`
- `KEEPER_SKIP_TOUR=1 xvfb-run -a -s "-screen 0 1440x900x24" node test/e2e/solo-apps.cjs /tmp/kp-solo /tmp/kp-solo-shots`
  (Linux): Keeper Mail alone (its window, class and lock; no main window, parts, library or
  Island), Notes, Files, Terminal, Remote Desktops and Studio joining it, Keeper taking over
  (one process, its parts start, the windows come back), and an app icon opening its page in a
  running Keeper.
- `KEEPER_PERF_MODE=solo KEEPER_PERF_SOLO=mail xvfb-run -a node test/e2e/perf-budget.cjs`
- On a Mac and Windows, by hand (needs a packaged build): add Keeper Mail, quit Keeper, open
  Keeper Mail (its icon in the Dock or its own taskbar group, only the Mail window), open
  Keeper Notes (joins), open Keeper (takes over with both windows), quit Keeper, open Keeper Mail
  again.
