# Island tools

The Island's expanded panel holds up to twenty-two tools as tabs. This page says
what each does, where its data comes from, what it costs while idle, and what
has and has not been checked on each system.

## Opening, choosing and ordering

- **Open**: rest the pointer on the Island (after *Hover delay*, 0–1 s, default 250 ms), click it, or press the *Open the Island* shortcut (default <kbd>Ctrl/⌘ Alt I</kbd>, Settings → Island → Shortcuts).
- **Choose and order**: Settings → Island → Tools lists every tool; drag to reorder, use the arrows, or switch one off. In the Island, right-click a tab for *Move left*, *Move right*, *Hide this tool* and a list of hidden tools to bring back. The order is saved in `island.toolOrder` / `island.toolsOff`.
- **Sizing and placement** follow the Island's own settings (compact, normal, large; per screen).
- **It only drops down when you ask.** Hovering, clicking, a shortcut, a tray item, a touch gesture or dragging a file opens it. Nothing that happens by itself does: alerts, voice, agents and live activities grow sideways inside the menu bar's height. On a notched Mac that means the notch's wings, or the small tab below the notch when the wings have no room. Elsewhere it means the pill. The opened panel drops from the notch, centred on it (`cutout.center`), and closes as soon as the pointer leaves. The rule lives in `core/island-expand.ts`.
- **Alerts** show for about five seconds as an icon and a few words in the notch or pill. Hover or click for the full alert with its buttons. *Settings → Island → Alerts* can switch to "as a banner below it". Only time-sensitive alerts appear: downloads, screenshots, calls, timers, agents that need you, recordings, battery, due cues, due reminders, a downloaded update and mirrored notifications. Tips and findings such as "Nothing is backed up" wait on the To do page and in the tray, unless *Also show tips and findings* is on.
- The panel opens and closes with a spring morph (`clip-path` on `.isl-shape`, the `--spring` curve). Only `transform`/`clip-path` animate.
- Tools that belong to a Keeper feature (Settings → Features → Island) disappear when that feature is off: `islandAsk`, `islandUsage`, `islandSales`, `islandStocks`, `islandNotes`, `islandTodos`, `islandPlanner`, `islandInsights`, `islandPrompter`.
- **New task** (default <kbd>Ctrl Alt N</kbd>, <kbd>⌘⌥N</kbd> on a Mac) opens the Tasks tab with the new-task field focused, from anywhere.
- **Black and white** (Settings → Island) shows the whole Island in greys.

## Idle cost

Nothing in this page runs while the Island is closed, with two exceptions, both through the governor:

| Job | When | Rule |
| --- | --- | --- |
| `islandTools.sales` | only when *Note each new sale* is on | every 10 min; ×3 slower when you are away; paused while locked |
| `islandTools.shelfPrune` | always (cheap: one folder listing) | once a day |

Every other tool loads when its tab is shown and refreshes only while it stays visible (`useWhileVisible`). Tasks, Week and Insights do not refresh on a timer at all: they reload when the main process says the task list changed.

## The tools

| Tool | What it does | Data |
| --- | --- | --- |
| **Ask** | Any connected AI; the computer's own model first (Apple's on-device model on a Mac with it, offered even without a connection set up), then a local one. Quick actions: Rewrite, Shorter, Summarize, Extract, Brainstorm, Fix grammar; on typed text, the clipboard or a dropped file. | Settings → AI & Brain connections; *Use only AIs on this computer* is respected. |
| **AI Usage** | Claude Code (tokens in the current 5-hour block, today, the most-used model), Codex (session and weekly limit %, resets), Copilot (premium requests left), Cursor (requests this month). Warns at 80 % and 98 %. | Files those tools keep: `~/.claude/projects/**/*.jsonl`, `~/.codex/sessions/**/rollout-*.jsonl`, `~/.config/github-copilot/*.json`, Cursor's `state.vscdb` (read with `sqlite3`). *Exact limits* (off by default) asks the provider with the tool's own sign-in. Gemini and Grok keep no local counts; the tool says so. |
| **Sales** | Today / week / month, counts, a 30-day chart, per-provider totals, converted to one currency, and an optional notification for each new sale. Refunded, failed and test payments are left out; zero- and three-decimal currencies handled. | Stripe, Shopify, Lemon Squeezy, Gumroad, Paddle, Polar, Dodo Payments with a read-only key you paste (kept in the system keychain). Exchange rates from the ECB via frankfurter.app, only when *Convert* is on. |
| **Stocks** | Watchlist of shares, ETFs and crypto with price, change and a sparkline; click for a chart. | Stooq (no key) for shares, CoinGecko (no key) for crypto; a Twelve Data key is optional. |
| **Calendar** | Today's and tomorrow's agenda (all-day first, a countdown on each coming event, *Join* for video meetings: Zoom, Google Meet, Teams, Webex, Jitsi, Whereby), a month with dots (click a day for its events), and a quick-add field in plain English (“lunch with Sam tomorrow 1pm”) with a choice of calendar. Clicking an event opens it where it lives (macOS Calendar, the provider's page) or in Keeper's calendar. Drop an `.ics` file on the tab or on the shelf to import it. While the tab is open, calendars are checked every minute. | Every calendar in Keeper (Settings → Mail & Calendar → Calendar): this computer's own calendars, connected accounts, subscribed links, imported files, holidays and birthdays, each with “Island” on or off. The same meeting from two calendars shows once. |
| **Tasks** | Today (with unfinished tasks from earlier days carried forward), Inbox, Overdue (*All to today*, *To tomorrow*) and All. Add tasks in plain words (`call Ana tomorrow 3pm !! #work every Monday`) with a preview and a dictation button. Check, drag to reorder, swipe left or press Delete to remove (with Undo), and open a task for notes, steps, project, repeat, day, due time and importance. A due reminder takes the pill as a live activity with **Snooze 5 min** and **Done**, and chimes once. See [PLANNER.md](PLANNER.md). | Keeper's one task list (the same as the Reminders and Planner pages); on a Mac also the Reminders app through EventKit, asked when the tab opens. |
| **Week** | The seven days of the week and the Inbox side by side, with *+ Add* under each day; drag tasks between days. Previous and next week. | Keeper's task list |
| **Insights** | Done today and this week, focus minutes, the last seven days, and the hours you get most done. | A small log on this computer of tasks checked off and focus sessions |
| **Notes** | Quick notes that save as you type; search, pin, copy. **Today** opens one pad per day. <kbd>⌘/Ctrl Enter</kbd> turns the line under the cursor into a task for today. | `userData/island-tools.json` |
| **Focus** | The focus timer (25, 50, any length on the ruler, or a **stopwatch** that counts up), **+5 min**, and a session **for one of today's tasks** (its minutes are logged on the task and in Insights). Sleep or locking the screen pauses it, and waking carries on. Focus sounds (white, pink, brown noise, rain; made on the spot, no files) with a volume, and the Clock's timers (start, cancel). | Clock in Keeper |
| **Weather** | Now and seven days. | Keeper's weather source |
| **System** | CPU, memory, disks, battery, network speed. | Keeper's system service |
| **Convert** | Units (length, mass, temperature, volume, speed, area, data, time) and currencies as you type: `5 ft in cm`, `€20 in usd`, `1,200 sq ft to m2`. Click to copy. | Rates as for Sales, only for currency questions |
| **Emoji** | Search by name and keyword, groups, six skin tones, recents. Click copies. | Bundled emoji data, loaded the first time the tab opens |
| **Teleprompter** | Scripts scroll under the camera at a reading speed (60–300 words a minute) or only while you speak (microphone loudness, nothing recorded); 3-2-1 countdown, flip for a mirror rig, size, a reading line. Keys: Space play/pause, ↑/↓ speed, R restart, M flip, Esc stop. Import `.txt`, `.md`, `.docx`, `.odt`, `.rtf`. | `userData/island-tools.json` |
| **Mirror** | Camera preview with flip, framing guides (thirds and an eye line), a lighting hint (dark / good / very bright) and a microphone level. The camera is on only while the tab is showing. | Camera and microphone, on this computer |
| **Shortcuts** | Run Mac Shortcuts, Keeper rules, and your scripts. | `shortcuts list` on a Mac; Keeper's rules |
| **Shelf** (extended) | *Share…* to the system share targets; optionally keep a copy of everything dropped in a folder you choose, removed after a day, a week, a month, or kept until you remove them. | Settings → Island → Shelf |
| **Clipboard** (extended) | Copies marked concealed or temporary by the app that made them are never stored (macOS `org.nspasteboard.ConcealedType`/`TransientType`/`AutoGeneratedType`, 1Password's marker; Windows `ExcludeClipboardContentFromMonitorProcessing` and the history/cloud flags set to 0; KDE's password-manager hint). Alt-click deletes an entry. | Checked only when the clipboard changes |
| **Now playing** (extended) | Optional media keys (Play/Pause, Next, Previous) control what Keeper shows. | Settings → Island → Shortcuts → *Media keys* |

## Clipboard sets and pasting one by one

Part of Clipboard history (`clipboard`); nothing new runs until you use it.

- **Sets**: named lists such as "Addresses" or "Replies", shown as chips above the clipboard picker's list (Everything, then each set, then *+ New set*). ⌘S / Ctrl+S (or right-click) on a clip files it in a set, makes a new one, pins it, or stops keeping copies from its app. Clips in a set are kept like pinned ones. The Island's Clipboard tab shows the same sets as "lists".
- **Paste one by one** (`core/paste-queue.ts`): in the picker, Space (or ⌘L / Ctrl+L) lines clips up in the order chosen, and *Paste one by one* (or Enter) starts; a set's bar offers *Paste this set one by one*; *Collect to paste one by one* (the picker's foot, Settings → Island → Clipboard, the palette and Quick Search) starts empty and every copy made next joins, with the first one kept ready on the clipboard. The next one to paste is always on the clipboard, so an ordinary paste takes it. Each paste then moves on:
  - while a queue runs, ⌘⌥V / Ctrl+Alt+V (Settings → Island → Shortcuts → *Paste the next one*; taken only while the queue runs) pastes the next one and moves on;
  - with *Each paste takes the next one* on (the default), your usual ⌘V / Ctrl+V moves the queue on too: the key listener of [LAUNCHER.md](LAUNCHER.md#the-key-listener-electronservicestypingts) runs only while the queue does, and only notices the paste keys (macOS needs Input Monitoring; on Linux Wayland without the "input" group only the shortcut works).
  - The Island shows **"3 left"** (activity `paste-queue`) with *Paste next* and *Stop*; when the last one is pasted the queue ends with a short note. Turning Clipboard history off ends it too.
- **Paste as plain text**: Quick Search's *Paste as plain text*, and a shortcut you choose in Settings → Island → Clipboard (none by default, so no app's shortcut is taken). It pastes the clipboard's text without fonts and colours and puts the formatted version back for the next paste. Clips pasted from history are plain text already.
- **Never keep copies from**: Settings → Island → Clipboard (and The Island in Settings) lists the apps whose copies are never kept (password managers by default); *Never keep copies from …* on a clip adds its app and forgets what was kept from it (pinned clips and clips in a set stay). Copies apps mark as secret are never kept anyway (above).

## Files

- `core/island-tools/*`: pure logic (units, emoji, sales, usage, stocks, teleprompter, clipboard formats, tool order, notes and the Today pad), tested in `test/island-tools.test.ts` and `test/tasks.test.ts`.
- Tasks, Week and Insights: `core/pim/tasks.ts`, `core/pim/insights.ts`, `src/island/tools/IslandPlanner.tsx`, `src/pim/tasks-ui.tsx`, `src/pim/planner-views.tsx` (see [PLANNER.md](PLANNER.md)).
- `electron/services/island-tools.ts`, `electron/ipc/island-tools.ts`, `electron/services/clip-formats.ts`: main process.
- `src/island/tools/*`: the tools' interface.
- `native/macos/KeeperHelper`: `eventkit.events`, `eventkit.reminders`, `eventkit.setReminder`.
- `test/e2e/island-tools.cjs`: drives the real app (every tool, converter, emoji copy, usage from fixture files, sales from a stand-in payment service, notes and order kept after a restart).

## What has been checked

Checked on Linux in the real app (Electron under Xvfb): every tool opens and shows content; conversions; emoji copy; Claude Code and Codex usage from their files; sales totals from a stand-in Stripe service; the teleprompter scrolls; reordering; notes and order survive a restart. The logic in `core/island-tools` has unit tests.

Not checked yet:

- The Tasks, Week and Insights tabs, the due-reminder activity, the New task shortcut and focus pausing on sleep or lock have unit tests for their logic and a successful build, but were not driven in the real app or on a real Mac. The tasks' new VTODO fields were not tried against a real CalDAV server.

- The macOS EventKit code (`calendar.*` in keeper-helper's Calendar.swift, and the older `eventkit.*` methods) has not been compiled or run here; the Calendar and Reminders privacy prompts need a signed build. The Mac test kit's Calendar area checks it on a real Mac.
- Clipboard markers on macOS and Windows were written to their documented formats but not tried with a real password manager.
- The provider sign-in usage endpoints (*Exact limits*), Copilot and Cursor are unofficial and may change; they were not called with real accounts.
- Real Shopify, Lemon Squeezy, Gumroad, Paddle, Polar and Dodo Payments responses were not tried with real accounts. Their parsers are tested against the documented shapes.
- Stooq, CoinGecko and Twelve Data were not called from the test machine.
- Media keys and the Mac's `shortcuts` command were not tried on real hardware.
