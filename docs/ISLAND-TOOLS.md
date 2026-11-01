# Island tools

The Island's expanded panel holds up to twenty tools as tabs. This page says
what each does, where its data comes from, what it costs while idle, and what
has and has not been checked on each system.

## Opening, choosing and ordering

- **Open**: rest the pointer on the Island (after *Hover delay*, 0–1 s, default 250 ms), click it, or press the *Open the Island* shortcut (default <kbd>Ctrl/⌘ Alt I</kbd>, Settings → Island → Shortcuts).
- **Choose and order**: Settings → Island → Tools lists every tool; drag to reorder, use the arrows, or switch one off. In the Island, right-click a tab for *Move left*, *Move right*, *Hide this tool* and a list of hidden tools to bring back. The order is saved in `island.toolOrder` / `island.toolsOff`.
- **Sizing and placement** follow the Island's own settings (compact, normal, large; per screen).
- **It only drops down when you ask.** Hovering, clicking, a shortcut, a tray item, a touch gesture or dragging a file opens it. Nothing that happens by itself does: alerts, voice, agents and live activities grow sideways inside the menu bar's height. On a notched Mac that means the notch's wings, or the small tab below the notch when the wings have no room. Elsewhere it means the pill. The opened panel drops from the notch, centred on it (`cutout.center`), and closes as soon as the pointer leaves. The rule lives in `core/island-expand.ts`.
- **Alerts** show for about five seconds as an icon and a few words in the notch or pill. Hover or click for the full alert with its buttons. *Settings → Island → Alerts* can switch to "as a banner below it". Only time-sensitive alerts appear: downloads, screenshots, calls, timers, agents that need you, recordings, battery, due cues and mirrored notifications. Tips and findings such as "Nothing is backed up" wait on the To do page and in the tray, unless *Also show tips and findings* is on.
- The panel opens and closes with a spring morph (`clip-path` on `.isl-shape`, the `--spring` curve). Only `transform`/`clip-path` animate.
- Tools that belong to a Keeper feature (Settings → Features → Island) disappear when that feature is off: `islandAsk`, `islandUsage`, `islandSales`, `islandStocks`, `islandNotes`, `islandTodos`, `islandPrompter`.

## Idle cost

Nothing in this page runs while the Island is closed, with two exceptions, both through the governor:

| Job | When | Rule |
| --- | --- | --- |
| `islandTools.sales` | only when *Note each new sale* is on | every 10 min; ×3 slower when you are away; paused while locked |
| `islandTools.shelfPrune` | always (cheap: one folder listing) | once a day |

Every other tool loads when its tab is shown and refreshes only while it stays visible (`useWhileVisible`).

## The tools

| Tool | What it does | Data |
| --- | --- | --- |
| **Ask** | Any connected AI; the computer's own model first (Apple's on-device model on a Mac with it, offered even without a connection set up), then a local one. Quick actions: Rewrite, Shorter, Summarize, Extract, Brainstorm, Fix grammar; on typed text, the clipboard or a dropped file. | Settings → AI & Brain connections; *Use only AIs on this computer* is respected. |
| **AI Usage** | Claude Code (tokens in the current 5-hour block, today, the most-used model), Codex (session and weekly limit %, resets), Copilot (premium requests left), Cursor (requests this month). Warns at 80 % and 98 %. | Files those tools keep: `~/.claude/projects/**/*.jsonl`, `~/.codex/sessions/**/rollout-*.jsonl`, `~/.config/github-copilot/*.json`, Cursor's `state.vscdb` (read with `sqlite3`). *Exact limits* (off by default) asks the provider with the tool's own sign-in. Gemini and Grok keep no local counts; the tool says so. |
| **Sales** | Today / week / month, counts, a 30-day chart, per-provider totals, converted to one currency, and an optional notification for each new sale. Refunded, failed and test payments are left out; zero- and three-decimal currencies handled. | Stripe, Shopify, Lemon Squeezy, Gumroad, Paddle, Polar, Dodo Payments with a read-only key you paste (kept in the system keychain). Exchange rates from the ECB via frankfurter.app, only when *Convert* is on. |
| **Stocks** | Watchlist of shares, ETFs and crypto with price, change and a sparkline; click for a chart. | Stooq (no key) for shares, CoinGecko (no key) for crypto; a Twelve Data key is optional. |
| **Calendar** | Today's and tomorrow's agenda (all-day first, a countdown on each coming event, *Join* for video meetings: Zoom, Google Meet, Teams, Webex, Jitsi, Whereby), a month with dots (click a day for its events), and a quick-add field in plain English (“lunch with Sam tomorrow 1pm”) with a choice of calendar. Clicking an event opens it where it lives (macOS Calendar, the provider's page) or in Keeper's calendar. Drop an `.ics` file on the tab or on the shelf to import it. While the tab is open, calendars are checked every minute. | Every calendar in Keeper (Settings → Mail & Calendar → Calendar): this computer's own calendars, connected accounts, subscribed links, imported files, holidays and birthdays, each with “Island” on or off. The same meeting from two calendars shows once. |
| **To-Dos** | Quick to-dos (star, check, delete) plus your reminders, checked off in place. | Keeper's reminders; on a Mac also the Reminders app through EventKit. |
| **Notes** | Quick notes that save as you type; search, pin, copy. | `userData/island-tools.json` |
| **Focus** | The focus timer plus focus sounds (white, pink, brown noise, rain; made on the spot, no files) with a volume, and the Clock's timers (start, cancel). | Clock in Keeper |
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

## Files

- `core/island-tools/*`: pure logic (units, emoji, sales, usage, stocks, teleprompter, clipboard formats, tool order, notes), tested in `test/island-tools.test.ts`.
- `electron/services/island-tools.ts`, `electron/ipc/island-tools.ts`, `electron/services/clip-formats.ts`: main process.
- `src/island/tools/*`: the tools' interface.
- `native/macos/KeeperHelper`: `eventkit.events`, `eventkit.reminders`, `eventkit.setReminder`.
- `test/e2e/island-tools.cjs`: drives the real app (every tool, converter, emoji copy, usage from fixture files, sales from a stand-in payment service, notes and order kept after a restart).

## What has been checked

Checked on Linux in the real app (Electron under Xvfb): every tool opens and shows content; conversions; emoji copy; Claude Code and Codex usage from their files; sales totals from a stand-in Stripe service; the teleprompter scrolls; reordering; notes and order survive a restart. The logic in `core/island-tools` has unit tests.

Not checked yet:

- The macOS EventKit code (`calendar.*` in keeper-helper's Calendar.swift, and the older `eventkit.*` methods) has not been compiled or run here; the Calendar and Reminders privacy prompts need a signed build. The Mac test kit's Calendar area checks it on a real Mac.
- Clipboard markers on macOS and Windows were written to their documented formats but not tried with a real password manager.
- The provider sign-in usage endpoints (*Exact limits*), Copilot and Cursor are unofficial and may change; they were not called with real accounts.
- Real Shopify, Lemon Squeezy, Gumroad, Paddle, Polar and Dodo Payments responses were not tried with real accounts. Their parsers are tested against the documented shapes.
- Stooq, CoinGecko and Twelve Data were not called from the test machine.
- Media keys and the Mac's `shortcuts` command were not tried on real hardware.
