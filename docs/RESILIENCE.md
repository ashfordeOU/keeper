# Staying up, and coming back where you were

Keeper by Ashforde® is meant to be left running for weeks. This document is how it
copes when something goes wrong — a crashed window, a part that stops, the whole
app killed by the system — and how it keeps tabs, pages and drafts across all of
it, without costing anything at idle.

## What the person sees

- **Tabs.** Any page opens in a new tab with a middle-click or ⌘/Ctrl-click, or
  "Open in New Tab" on a sidebar entry; ⌘T / Ctrl+T opens one, ⌘W / Ctrl+W closes
  it, ⌘⇧T / Ctrl+Shift+T reopens the last closed one, Ctrl+Tab moves between them
  and ⌃1–9 (macOS) / Alt+1–9 picks one by place. Tabs can be pinned, duplicated,
  dragged into order, or dragged out into a window of their own ("Move to New
  Window"). Each tab keeps its own page, Back and Forward, scroll position and
  unsent drafts. With one tab the strip stays hidden, so Keeper looks as before.
  Settings → Updates → "Open pages in tabs" turns it off. (Switching theme moved
  from ⌘⇧T to ⌘⇧L, since ⌘⇧T reopens tabs everywhere else.)
- **Nothing is lost.** Every window's tabs, pages, scroll positions and drafts
  (the assistant's question box, a mail being written) are saved within a second
  of a change, and again when a window hides or Keeper quits. After an update, a
  restart or a crash, every window and tab opens where it was.
- **A window that crashes** is reopened at once with its tabs, and says so. If it
  crashes again within a minute, Keeper asks whether to reload or close it. A
  window that freezes for eight seconds offers Wait or Reload.
- **If Keeper itself stops** without being quit — a crash, the system killing it —
  a small watchdog starts it again, and a banner says the tabs are back. After
  three such stops in five minutes it starts in **safe mode** (only the library on,
  for this run only, nothing changed) with a "Start normally" button.
- **Keeper keeps itself small.** It has its own ceilings and steps back when it
  reaches them (see "Staying light" below); System → Keeper's processes shows the
  ceilings and everything Keeper did to stay inside them.
- **Parts that can fail run on their own.** Network Activity's sampling runs in a
  separate service process: if it stops, the rest of Keeper carries on, it starts
  again on the next request, and a quiet note says so. The terminal's sessions
  have always lived in their own process and keep running when windows close.
- **System → Keeper's processes** lists every process (main, each window, graphics,
  services, the terminal host) with CPU, memory, uptime, restarts and the last
  problem, with Stop, Restart / Reload and Disable (switch the feature off), plus
  **Stop all background work** (an hour, or until Resume), **Restart in safe mode**,
  **Copy report** and the local crash reports. Nothing is ever uploaded.

## How it works

| Piece | Where | Notes |
|---|---|---|
| Tab logic (open, close, reopen, pin, move, duplicate, detach, Back/Forward, sleeping) | `core/session.ts` | Pure, tested. A damaged saved window is sanitised, never blocks opening. |
| Checkpoint format | `core/checkpoint.ts` | Two generations (`session-0.json`, `session-1.json`), each `{gen, sha256, body}`; written by `write → fsync → rename`; the newest intact generation wins, so a file cut short by a crash or power loss falls back to the one before. |
| Per-window state in the interface | `src/state.tsx` (`tabs`, `forward`, `draft`/`setDraft`, `boot`) | The window reads its saved state synchronously at start (`session.initial`), so the first frame is already right. Background tabs are not mounted at all: a tab is its route, history, scroll and drafts, so "sleeping" costs nothing. |
| Saving | `electron/resilience.ts` | Debounced 500 ms in the window, 700 ms in the main process; flushed on hide, quit and before reloading a crashed window. |
| Crash and freeze handling | `electron/resilience.ts` (`render-process-gone`, `unresponsive`) | Follows the pattern in Electron's crash-reporting guide: ignore `clean-exit`, reload a limited number of times. |
| Unclean-exit marker | `session/running.json` | Holds the running pid; cleared on `will-quit`. On start, a pid that is no longer alive means the last run ended badly. |
| Watchdog | `electron/watchdog.ts` → `dist-electron/watchdog.cjs` | Plain Node (`ELECTRON_RUN_AS_NODE`), checks the pid every 3 s, ~0 CPU. Relaunches unless Keeper quit normally or another Keeper took over; safe mode after repeated crashes. An AppImage restarts from its own file (`$APPIMAGE`), not its temporary mount. Installed copies always have it; development runs only with `KEEPER_WATCHDOG=1`. |
| Leftover helpers | `electron/helpers-registry.ts` | Every helper started through the governor's `lowerPriority` (watchers, ffmpeg, the cloud daemon, PowerShell hosts, downloads) is listed in `session/helpers.json`; after a crash the watchdog stops those that are still the same programs. |
| One Keeper per person | `electron/instance.ts` | Electron's own lock is per data folder, so an installed Keeper, a development build and a downloaded copy could run together. A second lock in one fixed place per person (keyed on Keeper's identity, not the data folder) makes a later start hand its links and files to the running Keeper over a local socket and quit before it does anything else. Mac test runs (`KEEPER_MACTEST_HOME`) have a lock of their own and are named "Keeper (test)" with a "test" badge. The watchdog checks the same lock and never starts a second Keeper when one is already running. Helper programs run as plain Node (`ELECTRON_RUN_AS_NODE`), so they never show as apps; `test/instance.test.ts` checks every such start. |
| Crash breadcrumbs | `electron/breadcrumbs.ts` | A native abort in the main process (macOS: EXC_BREAKPOINT on CrBrowserMain) leaves no JavaScript trace. The last 200 log lines, memory, the regular checks (and which is running), open handles and sleep/wake are kept in `session/breadcrumbs.json` (written once a minute when changed, at once on sleep, wake, warnings and errors); after a crash the next start keeps it as `breadcrumbs-<time>.json` (the last five) beside Crashpad's local minidump, which is never uploaded. The Mac test kit collects both. |
| Inherited sockets | `electron/watchdog.ts` | Chromium's sockets are not close-on-exec, so a child process inherits them; the watchdog closes every inherited socket at start, otherwise it would hold ports (such as the debugging port) a restarted Keeper needs. Found in testing: a leftover `xprop` watcher and the watchdog itself were holding Keeper's socket after a crash. |
| Service hosts | `electron/svc/host.ts`, `electron/svc/runtime.ts` | An Electron utility process per service, plain request/response messages, started on first call, stopped after a quiet while, restarted with growing waits after a crash (the call in flight is retried once), given up on after 30 s without an answer; five crashes in ten minutes and it waits for the next call. Service processes exit if the main process disappears (they watch its pid). |
| Network Activity sampling | `electron/services/net/sampler.ts` in `dist-electron/svc-net.cjs` | No Electron in it. The main process keeps settings, VPN control and the country-table download; if a service process cannot start at all, the same code runs in the main process. |
| "Stop all background work" | `electron/services/governor.ts` (`holdAllWork`, `resumeAllWork`) | All background work already asks the governor (`canWork`, `whenIdle`, `pace`, `poll`), so holding it there stops indexing, reading text, meaning search, sync, backups and regular checks at once; service processes are stopped too. |
| Processes list | `electron/svc/index.ts` | `app.getAppMetrics()` for Electron's processes, the hosts' own state, and the terminal host's memory read only while the page is open. |
| Safe mode | `--safe-mode`; `electron/services/features.ts`, `src/features.tsx` | Applies the "Files only" preset to this run only, in both processes. |
| Crash reports | `crashReporter.start({ uploadToServer: false })` | Started first thing in the main process; dumps stay under the app's crash-dumps folder. |

## Staying light: Keeper next to file managers

The question was whether Keeper restarts and recovers like the system file
manager, and whether it stays within what a file manager costs. Recovery: the
system restarts Finder and Windows File Explorer when they stop; Keeper's
watchdog does the same for Keeper, and goes further in bringing back every
window, tab, scroll position and draft (above). Cost: below.

### What file managers use at idle

Measured on the same Linux machine, same method (proportional set size from
`/proc/<pid>/smaps_rollup`, processor over 60 s of doing nothing):

| | Idle processor | Memory (PSS) | Memory (resident) |
|---|---|---|---|
| Dolphin (KDE) | 0.01 % | 68 MB | 118 MB |
| GNOME Files (Nautilus) | 0.08 % | 228 MB | 299 MB |
| **Keeper, before** (old CI budget's own notes, larger library) | 0.4–1.0 % | about 455 MB | — |
| **Keeper, before** (our reading, empty library, settled 3 min) | 0.16 % | 409 MB | 823 MB |
| **Keeper, now, default** (2,000-file library, after it settles) | 0.47–0.52 % | 317–475 MB | — |
| **Keeper, now, Minimal mode** | 0.37–0.40 % | 315–480 MB | — |

Readings vary a lot from run to run (memory ranged from 317 to 480 MB over
seven runs, nearly all of it the main process's heap), so ranges are given.

Published figures for the others (not measured here): Finder about 93 MB in
Activity Monitor on a recent Mac, with its thumbnail cache able to grow to
gigabytes over time (eclecticlight.co); Windows File Explorer around 25–60 MB for
a plain window and 200–300 MB once previews, the navigation pane and shell
extensions load (elevenforum, OpenText community); Nautilus about 15–25 MB in
2009 (LWN), against roughly 380 MB for a whole KDE or GNOME app group today
(Arch forums).

**Honest summary.** Keeper's idle processor use is at the 0.5 % target by
default and below it in Minimal mode — higher than Dolphin or Nautilus, because
Keeper does things they do not (clipboard history, the Island's clock, mounts,
microphone and fullscreen checks, the library index). Its memory is in the
range of GNOME Files plus a browser tab, not of Dolphin: Keeper is an Electron
app, and a browser process, a graphics process, a network process and one
renderer per window are its floor (about 250 MB before any Keeper code runs).
Minimal mode slows every regular check down, which saves processor time, not
memory.

Where the idle processor time goes (default mode, profiled over 60 s): almost
all of the main process's ~0.2 % is starting small programs for regular checks —
the Island's microphone check (every 30 s) and the disk list for Places (every
16 s while away) — plus clipboard history reading the clipboard every 2.8 s
while away. Each is small; together they are the floor. They belong to those
features and are listed in Settings → Keeper's own usage; switching a feature
off removes its check.

### Self-limits (`core/limits.ts`, `electron/svc/limits.ts`)

Checked every 15 s from Electron's own process list (no extra programs, no disk):

| Limit | Default | Minimal | What happens |
|---|---|---|---|
| Processor, all of Keeper | 25 % of a core for 2 min | 15 % for 1 min | Background work is held for 15 min, service processes stop, the Island says what was paused; Resume on Keeper's processes. Never while the person is using a Keeper window. |
| A service process | 256 MB | 160 MB | Restarted; it is given its settings again on start and callers do not notice. |
| A hidden window | 600 MB | 400 MB | Reloaded; its tabs come back from the checkpoint. A visible window is never touched. |
| A helper program (ffmpeg, a scanner…) | 1.5 GB | 1.5 GB | Stopped. |
| Helper programs at once | 4 | 4 | New background work waits (watchers and daemons do not count). |

Performance mode allows 60 % for 5 minutes. All of it is listed, with what
Keeper did, on System → Keeper's processes.

### Memory: what was done and what was not

- **Graphics in the main process (`--in-process-gpu`) was tried and dropped.**
  With an empty library it measured 135 MB less, but with a real library the
  main process absorbed the graphics memory (main + graphics: about 245 MB
  separate against about 210–270 MB together, within the run-to-run spread),
  while a graphics driver crash would take all of Keeper down instead of only
  redrawing. Not worth it. Running the network service in-process saved about
  15 MB in a first test, but the switch did not take effect from inside the app.
- **Background tabs are not mounted** (a sleeping tab costs nothing) and the
  Network Activity process stops 60 s after its last request (was 3 min).
- **Caches drop under memory pressure** (`onMemoryPressure` in the governor).
- **Not done, and why.** A shared renderer for small windows and destroying
  hidden windows sooner would change how the Island and Quick Search open (they
  must appear instantly); V8 heap limits cap memory by crashing, which the
  window ceiling above does more gently; `--js-flags=--optimize-for-size` saved
  1 MB. Lazy loading per feature needs the main bundle split (esbuild cannot
  split CommonJS); it is the largest remaining saving in the main process.

### Phase B: one "connections" process — measured, not done

Sync, Link, Cloud & Servers and Mail/Calendar were looked at for one shared
service process. Measured: with no accounts or folders set up they cost nothing
at idle in the main process (each is a governor check every 10–60 minutes that
returns at once; Link listens on a socket). Moving them out would add a process
of 35–60 MB (PSS) whenever any of them is in use, to save a few MB of their state
in the main process — more memory, not less. They also lean on main-process-only
APIs (the keychain, notifications, power events, dialogs, windows) that a
service process cannot call, so every one would need a proxy. The design stays
ready (`electron/svc/host.ts`: lazy start, idle stop, crash restart, settings
handed over on start), and is worth it when one of them is shown to crash or to
hold real memory. The same holds for a "media" process for the meaning-search
worker and text recognition: the meaning-search worker is already a worker
thread, and text recognition runs as helper programs below normal priority.

## Choices and trade-offs

- **Why not run everything in its own process?** A utility process is a full
  Node.js + Chromium service process. Measured here, Network Activity's process
  uses about 100–110 MB resident while sampling (much of it shared code). One
  process per feature would multiply that. So only what is heavy, failure-prone
  and used now and then goes into a service process, and it stops a minute
  after its last request. Grouping the connection services into one shared
  process was measured and not done (see Phase B above).
- **utilityProcess vs child_process vs worker_threads.** `utilityProcess.fork` is
  Electron's equivalent of `child_process.fork`, launched through Chromium's
  services API with message ports; it only exists after `app` is ready and cannot
  use main-process-only APIs (power events, the keychain, notifications), so those
  stay in the main process and are passed in. Worker threads share the main
  process, so a crash in native code takes everything down; they are used for CPU
  work only (the meaning-search worker). Plain child processes are used for
  helpers that are not Keeper code (ffmpeg, rclone, the terminal host).
- **Restore like browsers and editors.** Browsers reopen windows and tabs after a
  crash; code editors back up unsaved buffers so crash recovery works even with
  their "hot exit" setting off; terminal multiplexers save sessions, windows,
  panes and working folders and restore them on start. Keeper does all three:
  windows and tabs, drafts, and terminals that never stopped in the first place.

## Verified (Linux, under Xvfb)

`test/e2e/resilience.cjs` drives the real app — 34 of 34 checks pass:

- tabs from a middle-click and from "Open in New Tab";
- a crashed window reopens at once with all three tabs and says so;
- `kill -9` of the main process → the watchdog starts Keeper again (~2–3 s), with
  every tab, the tab in front, the scroll position (900 px) and the half-typed
  question; the crash banner shows;
- the Network Activity process is killed → it starts again, Keeper keeps
  running, the page keeps answering;
- the Processes page lists it; Stop all background work holds and Resume resumes;
- nothing of a crashed Keeper is left running;
- after three crashes in five minutes Keeper starts in safe mode (library only,
  tabs kept); "Start normally" restarts cleanly;
- a normal quit is recorded as clean and the watchdog does not restart Keeper;
- no page errors.

Unit tests: `test/session.test.ts` (tab operations, damaged files, checkpoint
generations, crash counting).

Not verified: macOS and Windows (watchdog relaunch, `ps`-based helper checks,
`.app`/installer relaunch paths), real hardware crashes (GPU, out of memory), and
dragging a tab out of the window with a real pointer (the menu item was used).

Also verified: `test/e2e/limits.cjs` (9 of 9: the processor ceiling holds work
and tells the Island what paused; a service past its memory ceiling is
restarted and still answers; the Processes page lists it; Resume lifts the
hold), `test/e2e/drafts.cjs` (6 of 6, browser demo: typing in the assistant and
in a mail shows every letter and the draft is kept), `test/limits.test.ts`, and
`test/e2e/perf-budget.cjs` in both modes (default: 0.6 % / 520 MB budget, target
0.5 %; Minimal: 0.5 % / 520 MB). CI runs both.

## Sources

- Electron utility process API: https://www.electronjs.org/docs/latest/api/utility-process and parent port: https://az.electronjs.org/docs/latest/api/parent-port
- Electron crash reporter and crash reporting guide (local dumps with `uploadToServer: false`, `render-process-gone` handling): https://www.electronjs.org/docs/latest/api/crash-reporter, https://electronjs.org/docs/latest/tutorial/crash-reporting
- VS Code hot exit (backups restored after a crash, `files.hotExit`): https://code.visualstudio.com/updates/v1_8
- tmux-resurrect (sessions, windows, panes, working folders restored): https://github.com/tmux-plugins/tmux-resurrect
- Finder memory and its thumbnail cache: https://eclecticlight.co (Finder and QuickLook thumbnail cache articles)
- Windows File Explorer memory: https://www.elevenforum.com and https://community.opentext.com (Explorer memory threads)
- Nautilus memory in 2009: https://lwn.net/Articles/361205/
- KDE and GNOME app memory today: https://bbs.archlinux.org (desktop memory comparison threads)
