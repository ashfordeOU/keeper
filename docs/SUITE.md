# Keeper as a suite

Keeper is one install, one updater, one version and one Settings, but not one
process. Parts that people see on their desktop all day (the Island, desktop
widgets) and Mail and calendars run in processes of their own, so a crash in
one never takes the others with it: if Keeper's main window stops, the Island
and the widgets stay on screen and mail keeps arriving and going out (Send
later, snoozes, alarms and event alerts), and if the Island or Mail stops, it
comes back without the main window noticing. Each part has its own switch in Settings → Features, and a part that
is off has no process at all.

## Process map

| Process | Started as | Owns | Restarted by |
|---|---|---|---|
| **Keeper** (the app) | `Keeper` (at login: `Keeper --hidden`) | main window, Quick Search, the tray / menu-bar owl and its glance, the library, every IPC handler and service behind the windows (index, Island state, mail and calendars, Keep Awake, brain, sync, Link…), the updater, the suite supervisor and channel | the watchdog |
| **Island** | `Keeper --keeper-role=island` | the Island's windows (one per display), the clipboard picker | the supervisor in Keeper |
| **Desktop widgets** | `Keeper --keeper-role=widgets` | one window per widget | the supervisor in Keeper |
| **Mail and calendars** | `Keeper --keeper-role=mail` | no windows: mail accounts (IMAP IDLE, SMTP), the outbox and Send later, snoozes, calendars and their sync, reminders, alarms, timers and their alerts (electron/services/pim) | the supervisor in Keeper |
| Watchdog | Keeper's runtime as plain Node (`watchdog.cjs`) | nothing; checks every 3 s that Keeper is alive | Keeper, at each start |
| Services | Electron utility processes (`svc-*.cjs`, electron/svc/host.ts), started on first use, stopped a minute after the last | Network Activity sampling (`svc-net`), the process manager's sampling and actions (`svc-procs`: reading every process on the computer, and the PowerShell host that does it on Windows) | Keeper's ServiceHost, with growing waits; the call in flight is tried once more |
| Terminal host | Keeper's runtime as plain Node (`term-host.cjs`) | terminal sessions | Keeper, on demand |
| Light app (instead of Keeper) | `Keeper --keeper-solo=<app>` (an app icon, while Keeper is closed) | that app icon's windows and services only ([SOLO.md](SOLO.md)) | the watchdog |

Each Keeper process is the same signed program, so permissions the system gives
Keeper (screen recording, accessibility, calendars, notifications) apply to all
of them. The parts take nothing of their own from the system.

### Who decides what

- `electron/boot.ts` is the program's entry. Without `--keeper-role` it loads the
  app (`electron/main.ts`); with it, only the part (`electron/suite/part.ts`), which
  loads a small fraction of Keeper's code.
- `core/suite.ts`: the list of parts, the supervisor's state machine and the message framing (no Electron; unit-tested in `test/suite.test.ts`).
- `electron/suite/channel.ts`: sockets, the role locks, the file a part reads to reach the app.
- `electron/suite/hub.ts` (in the app): accepts parts, runs their windows' calls through the app's own IPC handlers, sends them the app's events.
- `electron/suite/supervisor.ts` (in the app): starts, stops, restarts and adopts parts; `suite.parts` / `suite.restart` for the suite page.
- `electron/suite/remote.ts` (in the app): what the app used to do to the Island's and widgets' windows (`islandWindows.openOn`, `syncWidgets`…) is sent to their processes instead.
- `electron/suite/mail.ts` (in the app) and `electron/services/pim/route.ts`: the app's callers (the `pim.*` IPC handlers, the `keeper` command's and agents' mail and calendar tools, MCP mail, Voice's meeting list, the Island's focus log) call `pimCalls` / `pimToolCalls`, which go to the Mail part when it runs, and are answered in the app when Keeper is one process. What the Mail part reports (new Important mail and other alerts for the Island, its next meeting, timers and due reminders, `pim-changed` for the windows, "show the calendar") comes back as `note` messages and goes where it always went.
- `electron/ipc/island.ts`, `electron/ipc/widgets.ts`: the window code, shared by both placements (in the app, or in the part).

## Windows of the app

Every page is a page of the main window, and any page can also open in a window of its own
(Open in New Window, ⌥⌘N / Ctrl+Alt+N). Those windows belong to the app process, like the
main window: they load the same interface and preload, so every IPC handler answers them and
`broadcast()` reaches them. Mail, Calendar and Notes can also have app icons of their own
(Keeper Mail, Keeper Notes, Keeper Files…) that open just their page's window in a running
Keeper, through the single-instance lock. They are not parts: no process of their own, and nothing
to restart. See [Pages in windows of their own](WINDOWS.md).

## Light apps

Started while Keeper is closed, an app icon runs as a **light app** (`Keeper --keeper-solo=mail`,
`electron/solo/main.ts`): one process with only that part's services (Mail and calendars in it,
not in a part of their own), no main window, library, Island, widgets, tray, supervisor or
channel. It holds the same single-instance lock as Keeper, so the two never run side by side:
Keeper started later takes over (the light app stops its services and lets go of its locks
first), and an app icon used while Keeper runs just opens its page there. A part still running
from an earlier Keeper (the Island or Mail outliving a crash) makes an app icon start Keeper
itself, which adopts it. See [Light apps](SOLO.md).

## The channel

- The app listens on a Unix socket (a named pipe on Windows) in `<userData>/suite/`
  (folder mode 700, socket mode 600; on Windows the pipe is the user's own). Paths
  too long for a Unix socket go to the temporary folder under a hashed name.
- Each start of the app makes a new random 256-bit token and writes `{pid, socket,
  token, version}` to `<userData>/suite/core.json` (mode 600). A part reads it, connects,
  and its first message must be `hello` with that token (compared in constant time)
  within five seconds, or the connection is closed.
- Messages are a 4-byte length and a v8-serialized body (Buffers, typed arrays,
  Maps and Dates arrive as they were sent), 64 MB at most.
- After `welcome` (the current settings and the list of IPC channels the app
  answers), a part registers every one of those channels in its own process and
  forwards its windows' calls to the app. The app runs the very handler the main
  window would (every `ipcMain.handle` is noted as it is registered, in `hub.ts`),
  with a stand-in `event.sender` whose `send` reaches the calling window. A few
  calls are answered in the part itself because they are about its own windows
  (`island.layout`, `island.setSize`, `island.setExpanded`, `island.prepare` (the
  window grown to the open size while the pointer rests on the pill),
  `island.takeFocus`, `widgets.current`, `files.startDrag`…). `island.haptic` (the
  trackpad tap as the Island opens) goes to the app, which runs the macOS helper.
- The app's events for windows (`broadcast()` in main.ts: `island-changed`,
  `settings-changed`, `progress`…) go to every part's windows too. A part keeps a
  copy of the settings and follows `settings-changed`; a part that changes a
  setting (a widget dragged) asks the app, which owns `settings.json`.
- The app sends commands the other way: `quit`, `metrics`, `ensure`, `openOn`,
  `openClips`, `sync`, `state`; to Mail: `pim` (a method of the mail and calendar
  API with its arguments, checked against the API's own methods), `tool`,
  `threadOf`, `logFocus`, `adoptIslandCalendarUrl`.
- A part tells the app things with `note` (no answer), and asks it with a `call`
  on a `suite:` channel, which only parts reach (never a window), each allowed for
  named parts only: Mail asks for open and save pickers over the window the person
  is using (`suite:dialog.open`, `suite:dialog.save`).
- Mail has no windows, so it gets none of the windows' channels or events, only
  `settings-changed`; its calls for window handlers are refused.
- Where the computer has no keychain (Linux without a keyring), passwords live
  only in memory. Mail's are mirrored to the app's memory over the channel and
  handed back when Mail starts again, so a crash of Mail does not ask for them
  again; they are never written to disk.
- Where the keychain refuses (Deny on a Mac, a locked keyring), Mail tells the app
  which of its saved sign-ins it could not read (`keychain` note), so the app's
  keychain banner covers Mail too, and goes when Mail reads them again.
- macOS may hand a `keeper://` link (Monorail's Keep Awake hand-over, Shortcuts) to
  any running copy of Keeper's bundle. A part passes it to the app (`open-url`
  note); with the app away it starts Keeper with the link. Keep Awake stays in the
  app, so its closed-lid hand-over and Keeper's hello to Monorail are unchanged.
- Only the app writes `settings.json`; a part never does, even the first time a new
  version reads an upgrader's settings (the app writes the kept choices down).

## Starting, stopping, restarting

The app starts the parts when everything else is registered (the end of
`whenReady` in main.ts), in this order: the channel listens and `core.json` is
written, then each part that is wanted is started (or adopted).

A part is **wanted** when its feature is on (`island`, `widgets` in core/features.ts;
Mail and calendars: any of `mail`, `calendars`, `alarms`, and its switch on the
suite page turns all three), it has something to show (widgets: at least one
widget), Keeper is not in safe mode, and parts run separately (below).

The state machine (`step()` in core/suite.ts):

```
 off ──wanted──▶ starting ──hello──▶ running
  ▲                 │ exited / no hello in 30 s   │ exited (crash)
  │                 ▼                              ▼
  └──not wanted── waiting ◀────────────────────────┘   wait 0.5, 2, 5, 15, 30 s…
                    │ more than 5 crashes in 10 minutes
                    ▼
                  failed ── Restart (suite page) or switched off and on ──▶ starting
```

- A part that ran two minutes without stopping starts the waits from the beginning again.
- Each part holds a lock of its own: it listens on `<userData>/suite/part-<role>.sock`.
  A second copy finds the first answering there and exits with code 3; a socket
  file nobody answers on (left by a crash) is taken over.
- Before starting a part, the app checks that lock: a part still running (it
  outlived a crash of the app) is **adopted**, not started again. It finds the new
  app's `core.json` within two seconds and says hello.
- Stopping: the app sends `quit`; a part that is still there after three seconds is killed.
- On a normal quit of Keeper (and before an update installs) every part is told to quit.
- Crashes are written to Keeper's problem log (`part-stopped`) and shown on the
  suite page and the Processes page.

### When the app stops

- The parts keep running and keep their windows. The Island shows what it showed;
  calls its windows make wait up to 15 seconds for the app to be back, then fail
  with "Keeper is starting again". Mail keeps its connections, sends what Send
  later scheduled, brings snoozed mail back and rings alarms and event alerts (as
  system notifications; the Island hears of them when the app is back).
- The watchdog starts the app again (a few seconds; on a Mac only after a crash
  report, so a Force Quit is not undone). The new app adopts the running parts,
  and Mail tells it again what the Island should show.
- After a Force Quit on a Mac the app stays stopped, and the parts stay: the
  Island and widgets on screen, Mail sending. When a person clicks or types in the
  Island or a widget again, the part starts Keeper (with the command the app left
  in `core.json`), and that Keeper adopts the parts. The calls the parts' pages
  make on their own timers never start it.
- A part only closes by itself when Keeper's program changed or went away while
  the app was not there (an update or an uninstall), or when the app never
  welcomed it (started by hand, or the app went before answering: 90 seconds).
  A normal quit of Keeper closes every part.

## Updates

One updater, in the app. Installing quits the app normally, which tells every
part to quit first, so the installer replaces one program that nothing is
running; the updated app starts the parts again. No part checks for updates.

## Placement: separate or shared

Settings → Features → "Run parts in processes of their own" (`suiteSeparate`;
unset: on, except with Save battery in Settings → Performance, `resourceMode: 'minimal'`) applies at the next start. Off, the Island and widgets
run in the app's process as they did before the suite: the lightest choice,
but they stop with the app. `KEEPER_SUITE=shared|separate` overrides the
setting for one run (diagnostics and tests).

## Memory

Measured with `test/e2e/perf-budget.cjs` (2,000 files, idle after settling, Linux,
one busy machine, the same build, the Island and Mail on, no widgets):

| | proportional (PSS) | private | anonymous |
|---|---|---|---|
| one process (`KEEPER_SUITE=shared`) | 327 MB | 205 MB | 208 MB |
| parts in processes of their own (the default) | 456–466 MB | 283–308 MB | 331–333 MB |

Per process with parts separate: the app's main process about 77–104 MB private,
its page 64 MB, graphics 21 MB, network 12 MB; the Island's main process 33 MB, its
page 33 MB, its zygotes 11 MB; Mail's main process 30 MB.

What a part costs: its main process (about 30 MB private; it loads only its own
code), and for the Island and widgets their page process (about 33 MB; one
process with the app shares the Island's page with the main window's) and
Chromium's two small zygote processes (about 11 MB private, but about 10 MB
anonymous each, counted again for every copy). Mail starts with `--no-zygote` on
Linux: it opens no pages, so it needs no zygote (and so no sandbox, which only
holds pages). No part has a graphics process of its own (they draw in software:
small windows that change little) or a network process (the network service
runs inside its main process).

A part that is off costs nothing: no process. Widgets with no widget on the
desktop do not run. Save battery (the Minimal resource mode) keeps everything in one process
unless the person chose otherwise (`separateByDefault` in core/suite.ts), and
its budgets are those of one process; the default budgets in perf-budget.cjs
rose by what the parts cost, with these measurements beside them.

## Platform notes

- macOS: only the app has a Dock icon and an entry in the app switcher; parts
  call `app.setActivationPolicy('accessory')` before they are ready and hide the
  Dock icon again when ready. Force Quit lists only the app. The parts share the
  app's bundle, so its permissions (TCC) cover them.
- Windows: parts are started detached, with no console; the pipe name is per user
  and per data folder. The NSIS installer finds no part running, since quitting
  for the update quits them.
- Linux: an AppImage starts its parts from the AppImage file (not from its
  temporary mount, which goes when the app quits).
- Each part keeps Chromium's own storage (local storage, caches) apart from the
  app's (`<userData>/Parts/<role>`): two processes must not share one profile.

## Not (yet) separate

- The tray, the updater and the suite's supervisor live in the app, not in a small
  process of their own: the watchdog is what brings the app back, and the app
  adopts the parts. A separate supervisor process would keep the tray during the
  few seconds the app is away, at the cost of one more Electron process (about
  35 MB) and a macOS Dock and activation question (the process the system starts
  from the bundle is the one with the Dock icon, the one TCC prompts name, and the
  one that receives open-file and reopen events); that is why the app stays the
  process the system starts.
- The Island's *state* (shelves, clipboard history, focus timer, media, alerts)
  lives in the app's process: while the app is away, the Island is on screen but
  its contents do not change. Moving `IslandService` into the Island's process is
  the next step.
- Keep Awake, the brain and indexer, Studio's export and sync run in the app's
  process. Background services move into utility processes through `ServiceHost`
  (electron/svc/host.ts) one at a time (Network Activity and process sampling so
  far). A utility process ends with the app that started it, so this protects the
  app from a service, not a service from the app; a service that must outlive the
  app belongs in a part, as Mail does (it needs Electron's notifications, the
  keychain, power events and pickers, which only a main process has). Keep Awake
  needs Electron's power-save blocker, which only a main process has, so it would
  move into a part too rather than a utility process.
- The tray lives in the app; while the app is away the owl is gone for a few seconds.
