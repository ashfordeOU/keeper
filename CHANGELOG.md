# Changelog

All notable changes to Keeper are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0-beta.6] - 2026-11-02

0.1.0-beta.5 was not published; everything listed under it is in this release.

### Fixed
- Windows: the DNS filter picks another port when Windows reserves the one it was given (Hyper-V port ranges).

### Fixed — memory
- Keeper no longer runs out of memory while it first reads a big library's text (the crash after about ten minutes on a Mac). The library index and the search brain are saved piece by piece instead of as one huge string, extracted text no longer keeps its whole file in memory, and the brain's word index takes about half the room.
- Linux: the tray menu no longer piles up a copy of itself every few seconds while the library is read.
- Crash breadcrumbs record the main process's memory once a minute (the last six hours), and a big-library memory check runs in CI.

## [0.1.0-beta.5] - 2026-11-02

### Added and changed
- Security review fixes, accessibility fixes across the app (screen readers, keyboard, contrast), and known gaps closed.
- AI usage tracker for Claude Code, Codex, APIs and subscriptions, with several accounts and your own names; it shows as a card in the owl's glance (one Keeper icon in the menu bar).
- Lighter: the main process starts as an ES module and idles at about 400 MB; npm audit reports nothing.

## [0.1.0-beta.4] - 2026-11-01

### Changed
- Check for Updates opens a small Software Update window (from the menu-bar owl, the app menu and the command palette) instead of the whole Keeper window: it checks at once and shows "newest version", a new version with its release notes and Install and Relaunch / Later / Skip this version, the download's progress, Relaunch Now, or an error with Try Again. "Ask before installing" opens it when an automatic check finds something, and About Keeper is a small window of its own on every platform.

## [0.1.0-beta.3] - 2026-11-01

Everything listed under 0.1.0-beta.2 (which was not published), plus:

### Fixed
- macOS: no second Keeper icon bouncing in the Dock (keeper-helper now runs as a background helper).
- The sidebar is full width again, with every section folded until you open it.

## [0.1.0-beta.2] - 2026-11-01

### Fixed
- Installing with the one-line script and updating a Mac copy no longer stop at the disk image: it opens without a licence window, and the installer and updater answer one where an older image still has it.
- A Force Quit leaves Keeper closed (the watchdog restarts it only after a real crash), and the menu bar shows only the owl from the first moment.
- The sidebar stays compact (icons only) until you open it.
- Releases for every platform build cleanly; Intel Macs are told that background removal and the built-in speech model are not available there.

### Added — Open with
- Places, forecasts, Find My devices, calendar events, email addresses, phone numbers and contact addresses open in your own apps: Apple Maps, Weather, Find My, Calendar, Mail, Messages and FaceTime on a Mac; Windows Maps, MSN Weather, Outlook and Phone Link on Windows; GNOME Maps (geo: links), GNOME Weather and GNOME Calendar on Linux. Google Maps is used when it is installed as an app, and Settings → Open with chooses per kind (Automatic, each app found, or the web). Anything that does not answer falls back to its web page. See docs/NATIVE-APPS.md.

### Added — Planner
- One task list for the Reminders page, the new Planner page and the Island. Tasks gain a planned day, repeats, steps, a project, your own order and the focus time spent on them. All of these sync as VTODO with CalDAV task lists. The Island's old to-dos move onto the list once, by themselves.
- Planner page (Mail & Calendar): Today, with unfinished tasks from earlier days carried forward; the Week with the Inbox, with drag and drop between days; Inbox; Upcoming; Overdue with *Reschedule all to today/tomorrow*; projects; Insights; and a detail pane for notes, steps, project, repeat, planned day, due time and importance.
- Repeating tasks roll on to their next date when checked off, never stacking up missed days.
- Tasks in plain words: `!`, `!!`, `!!!` for priority, `#project`, `every day/weekday/Mon and Thu/2 weeks/month`, dates and times, with a preview as you type and a dictation button. Works in the Island, the Planner and Reminders.
- Island: a Tasks tab (Today, Inbox, Overdue, All), a Week tab and an Insights tab. A due reminder becomes a live activity with Snooze 5 min and Done, and chimes once. A *New task* shortcut (Ctrl+Alt+N / ⌘⌥N, changeable in Settings → Island) opens Tasks ready to type.
- Focus: a stopwatch mode, +5 min, sessions for a task (logged on the task), and pausing while the computer sleeps or is locked.
- Insights: tasks done and focus minutes today and this week, the last seven days and your busiest hours, from a small log kept on this computer.
- Island Notes: a daily Today pad, and ⌘/Ctrl+Enter turns the line under the cursor into a task.
- Drag tasks to reorder them. Delete with the ×, the Delete key or a swipe, with Undo.
- AI agents and MCP clients: `tasks_list`, `task_add`, `task_update`, `task_complete`, `task_delete`, `island_notes_read`, `island_notes_append` and `insights_get`, and `focus_timer` with stopwatch, extend and a task, under the usual permissions.
- Settings → Tasks and notes → Export saves every task and Island note as JSON.
- An *Update ready* live activity in the Island, with Restart and update, or When I quit.
- *Report a problem* in Settings → About and in the tray's More menu.
- The welcome tour has a step about the Island.
- A *Black and white* option for the Island.
- New feature switches: Planner, Insights, Week in the Island, Insights in the Island. See docs/PLANNER.md.

### Fixed
- Quick-add no longer reads "month" or words such as "monster" as Monday.
- The Island's task list and the Mac's Reminders section no longer ask again every minute while open; they update when something changes.

## [0.1.0-beta.1] - 2026-11-01

The first beta of Keeper by Ashforde®. Install it with the one-line installer in the README; it then updates itself from GitHub Releases (betas follow betas).

### Changed — Monorail
- Keeper finds, opens, quits and updates Monorail under its new identifier (`org.ashforde.monorail`) as well as today's (`org.ashforde.macslider`), so nothing breaks when Monorail switches. It also recognises Monorail's Mac App Store edition and leaves its updates to the App Store.

### Added — Island+ and Cues
- Cues: notes, checklists, links and files tied to an app, a site, a page, a window title (project) or a time. They pop up beside the app or page they belong to, or ring when due. Create them from the Island, the palette, Ctrl/⌘ Alt K, the tray, the dashboard, the browser extension's button and right-click menu, `keeper cues` or AI abilities. Snooze ("next time I'm here" included), repeats, reusable checklists with skipped steps, a dashboard with Due today / Upcoming / Recently deleted, Tab phrase suggestions, and plain Markdown files that sync with Keeper Sync and show up in Quick Search.
- Island: other apps' notifications on macOS (Accessibility, opt-in, can close the banner) and Windows (notification listener or the Action Centre history). Calls with a timer and mute (system microphone or the app's own shortcut). Volume and brightness levels shown beside the system pop-up from system events. Cursor-like agents through a status hook Keeper can set up, plus Gemini CLI, Qwen Code and OpenCode. Usage meters for Gemini CLI, Qwen Code and OpenCode, and an optional usage ring beside the pill.
- Also new in the Island: long breaks and a 3-hour focus ruler, shuffle and repeat, an artwork glow, corner and shadow settings, lyrics off per player, Alt/Option-click to hide for a minute, a low-disk warning, and a tool launcher button.
- Text capture: choice of reader (the system's Windows.Media.Ocr / macOS Vision, or the built-in one), a layout hint, picture clean-up and a handwriting mode. See docs/ISLAND-CUES.md.

### Added — Voice (dictation anywhere, meeting recorder)
- Dictation runs on this computer by default (the shared Whisper model, now with live text while you speak), from a hold-to-talk key (macOS event tap, Windows keyboard hook, Linux input device or X11; opt-in), the shortcut, the tray, the palette, `keeper://dictation/…` and `keeper dictation`. A floating pill and the Island show what is heard.
- Finished text, not a raw transcript: fillers and false starts removed, “scratch that” and “no wait” corrections, numbers, times, money, dates, emails and links formatted, about 70 spoken commands, case commands, emoji by name, paragraphs, per-app tone (exact mode for shells), personal dictionary (fed to the model, learned from corrections with your yes), snippets, review step, password-field guard and app exclusions, copy-only mode, translation to English, an optional large-v3-turbo model.
- Edit selected text in any app by voice with your AI (asks first for online AIs). Searchable history and local statistics.
- Meetings: microphone plus the computer’s sound (ScreenCaptureKit, WASAPI loopback, PipeWire/PulseAudio monitor), live transcript, you vs others with on-device voice grouping (labelled as estimates), notes by a local AI or plain rules into Keeper Notes or a folder, action items to Reminders, calendar linking, Markdown/SRT/VTT/TXT export, call detection with a consent reminder, Island and tray controls, and abilities so AIs can read the live transcript when allowed. See docs/VOICE.md.

### Added — Wallpaper & Vibes
- Live wallpaper behind the desktop icons: 14 scenes drawn in code, your own video, picture, folder of pictures or web page, per display; WorkerW on Windows, desktop windows on macOS and X11, a still frame on Wayland. Paused when locked, asleep, under full-screen apps and (by choice) on battery or in low power mode, through the governor.
- Vibes: wallpaper, theme, ambient sound, widgets and a focus session switched together from the tray, the Island, the palette, shortcuts, the CLI (`keeper ambience`) or AI; scheduled by time, sunrise/sunset, battery or focus.
- Ambient sound made on the computer (rain, café, waves, stream, wind, fire, night, three noises) in a floating mixer with a sleep timer.
- Widgets: Day, Year progress, Season, World clock and Quote; shapes, S/M/L sizes, tinted backgrounds and arrange mode with snapping. Custom folder icons on macOS, Windows and Linux with restore. See docs/AMBIENCE.md.

### Added — Places & Tracks
- A private timeline (day, week, month, year) of stays and moves, trips built automatically with a day-by-day itinerary, activities with stats, charts, personal records, a heatmap and compare, live positions, places (home, work, merge) and search ("when was I last in Tallinn").
- Imports: GPX, KML/KMZ, GeoJSON, TCX, FIT, Google Timeline (on-device export, Semantic Location History, Records.json), Apple Health export.zip, photo EXIF GPS and booking mails (schema.org JSON-LD).
- Sources, each off until switched on: watched folders, photos, Find My cache on macOS up to 14.3, OwnTracks over HTTP and MQTT, the OsmAnd/Traccar protocol, a Traccar server, Strava, Polar AccessLink and Fitbit with your own credentials, calendar events and booking mails.
- Map with OpenStreetMap-compatible tiles (cached, Keeper User-Agent, your own server) or an offline outline; tracks coloured by speed, height or heart rate; clustering; light and dark.
- Encrypted at rest (AES-256-GCM, key in the keychain), privacy zones for exports, one switch to delete everything; GPX/KML/GeoJSON/CSV export and a printable trip summary.
- In the command palette, the file browser's right-click menu ("Show on Map"), the tray, the Island ("Arriving…", "Workout running") and the sidebar, each optional. `keeper tracks import|list|export|where`.

### Added — System monitor
- Live readings in the menu bar / tray (one item per reading or all in one, number and sparkline, red under strain) with a pop-over of details; readings run only while shown.
- A year of health history in a compact file (5-minute, hourly and daily rollups), zoomable charts, peaks, busiest apps per hour and CSV export.
- Process inspector: code signature (macOS codesign, Windows Authenticode, Linux package owner), parent chain, listening ports and an environment hidden by default.
- Dev servers grouped by project with open, stop, restart and stop-project; about 45 coding agents, editors and local model servers detected from one table (`core/agents-detect.ts`).
- Graphics use, fans, temperatures and power draw through public interfaces only (nvidia-smi, sysfs, hwmon, RAPL, ioreg, WMI).
- `keeper ps`, `top`, `kill`, `process`, `ports`, `dev`, `agents --running`, `sensors`, `history`; AI abilities to read all of it and, with approval and a stated reason, to quit, pause or stop processes (never in protected folders).
- A global tool launcher that opens any tool in a small window of its own, and one standard “Results go to” setting. See docs/MONITOR.md.

### Added — Stage mode
- A clean screen for recording, presenting and screenshots: hide desktop icons, the Dock/taskbar, other apps, the menu bar and chosen apps; Do Not Disturb, muted alert sounds, paused music; a backdrop, normal pointer size, pointer spotlight, click ripples and keystrokes; keep awake, a recording resolution, a clean clipboard view, the Island's private items hidden, and Keeper kept out of recordings. Every switch is its own toggle; presets Recording, Presenting, Screenshot and your own.
- Started from a global shortcut, the Island, the tray, the palette, `keeper stage`, `keeper://stage` links and AI abilities; optionally by itself when the screen is captured (PipeWire on Linux; recorder apps elsewhere, a best guess).
- A write-ahead journal: changes are put back newest first on stop, on the next start after a crash, and by a watchdog; settings you changed yourself are left alone.
- Presentation mode now runs through Stage with its old behaviour, and hides desktop icons on Windows and Linux too.
- External monitors: input-source switching (DDC/CI VCP 0x60) and display keys for brightness and volume; `keeper display`.

## [0.1.0] — 2026-10-31

First release of **Keeper by Ashforde®**, for macOS, Windows and Linux.

### Licence
- Keeper is now source-available under the [PolyForm Shield License 1.0.0](LICENSE.md) instead of the GNU AGPL v3 or later: still free to use for everyone, at home and at work, with the code public; selling it or offering a competing product or service needs permission from Ashforde OÜ (see [COMMERCIAL.md](COMMERCIAL.md) and [TRADEMARKS.md](TRADEMARKS.md)).

### Library and search
- Visual library with shelves per kind, Home dashboard, Recents, Screenshots, tags, saved searches and pinned folders.
- Folder browser with breadcrumbs, grid and list views, multi-select, drag out, right-click menu, batch rename with preview, compress to ZIP.
- Plain-English search with editable chips: kinds, extensions, dates, sizes, download sources, cameras, folders, tags, phrases, exclusions, sorting and limits.
- On-device text recognition for screenshots and photos; plain-text files indexed; copy text from images; snippets in results.
- Download sources from macOS *Where From*, Windows *Zone.Identifier* and Linux xattrs, grouped in *Downloaded From*.
- Inspector with preview, details, camera, download link, text in image and tags. Built-in music player.

### Tidy
- Duplicates: SHA-256 identical copies, perceptual look-alike photos, HEIC/RAW + JPEG pairs, with a suggested copy to keep.
- Clean Up: browser, app, user, developer, Xcode and AI-tool caches; logs, crash reports, temp files; old installers, unpacked archives, unfinished and forgotten downloads, old screenshots, big old videos, empty files, old project build folders, unused apps, Trash/Recycle Bin.
- Space Map treemap with cleanable badges; Large Files.
- Automations (off by default, previewable) and a History with undo for moves and renames.

### Island and everyday tools
- Island panel: shelf, clipboard history with link cleaning, download and screenshot alerts, now playing with synced lyrics, focus timer, break reminders, keep awake with conditions, presentation mode, coding-agent status, weather, calendar, battery, microphone in use, dictation.
- Quick Search over any app, command palette, tray menu with recent downloads, `keeper://` links.
- Copy text (and QR codes) from any area of the screen.
- Toolbox: link cleaner, personal-info redaction, case converter, word counter, hidden-character inspector, password generator, JSON, Base64, hashes, UUIDs, JWT, timestamps, regex, Wi-Fi sharing, colour picker, dead-pixel test, keyboard-cleaning lock, eject drives.

### System
- Health (CPU, memory, battery, busiest processes, what keeps the computer awake, listening servers), Startup Items, Applications with uninstall, Protection score.
- Optional assistant using Claude, OpenAI or a local model, seeing only file metadata.
- `keeper` command-line tool: search, scan, clean, dupes, stats, rules, agents.

### Places, themes and locked folders
- Finder-style sidebar: Favorites, cloud drives, this computer, disks with free space and eject, network servers, Network and Trash pages (put back, delete, empty); sections open and close and keep their colours.
- 18 themes in a live gallery, each checked for readable contrast; accent, font, density and corners on top.
- Locked folders: real encryption (AES-256-GCM, names included) unlocked with Touch ID, Windows Hello or the account password, a password of your own, or a recovery key. Hidden files button and shortcut.

### Keeper's brain and AI
- One local index of what is inside your files (words, and meaning with an on-device multilingual model), used by every AI: Claude, OpenAI-format services, local models, Apple's on-device model.
- Assistant with citations and suggested actions; secrets blanked before anything reaches a cloud AI.
- MCP server (`keeper mcp`), a local OpenAI/Anthropic-compatible gateway, agent-to-agent and editor protocols, one-click connect for Claude Code, Codex, Cursor, VS Code and more.
- Agents act only with permission (Off / Ask / Allow), logged and undoable; skills; knowledge graph; private usage learning (off by default).
- Platform features: Spotlight, Live Text and Apple Intelligence on macOS; Windows OCR, Explorer menu and Jump List; GNOME and KDE search.

### Island
- Fits every screen: grows out of a Mac's notch without covering menus or menu-bar icons, sits under the camera on laptops and tablets, below GNOME and KDE bars.
- Live activities with priorities, a second activity as a bubble, live cards with controls; camera and microphone dots on Windows and Linux.

### Terminal
- Tabs, split panes, workspaces; sessions that keep running when the window closes and come back after a crash; profiles with separate sign-ins; sister and mirrored sessions; typing into every pane; shell integration; SFTP/FTP panel; notebooks and web tools in a tab.

### Across your devices and the network
- Cloud & Servers: about 70 cloud services through rclone, plus SFTP, FTP, WebDAV and SMB, home servers, NAS boxes and other computers, browsed like local folders.
- Keeper Link: pair devices with a confirmed code; end-to-end encrypted over the local network, your own relay or a self-restarting Cloudflare tunnel; send files, shared folders, port forwarding, shared clipboard, a phone page that needs no app.
- Remote desktop with consent, phone mirroring (Android control, iPhone view), Send to Device.
- Sync & Backup: folder sync between devices with versions and safe conflicts; encrypted, deduplicated backups to any connected storage; cloud mirrors.
- Network Activity and VPN: every connection by app and route, leak checks, VPN connect and import.

### Mail, calendar and clock
- Mail (IMAP with instant updates, SMTP, threads, safe HTML, Undo Send, send later), Calendar (CalDAV, .ics, Microsoft 365, repeating events, invitations, alerts in the Island), Reminders, alarms, timers, stopwatch and world clocks.

### System, updates and installing
- Task manager: every process and service, with Quit, Force Quit, Suspend/Resume, Restart, priority and Inspect.
- Light on the computer: a governor paces background work; every feature can be switched off for real (Settings → Features); idle use about 0.5–0.9% of one core.
- Anonymous usage stats, once a day, on by default and off with one switch (Settings → Privacy, the welcome tour, `KEEPER_TELEMETRY=0`, `DO_NOT_TRACK=1` or a policy file), with a viewer that shows exactly what is sent ([docs/PRIVACY-USAGE-STATS.md](docs/PRIVACY-USAGE-STATS.md)).
- Updates from GitHub: automatic, ask, or only when you check; choose when an update installs (now, on quit, tonight, a time) with a countdown; Keeper reopens where you left off.
- Install with the dmg, the Windows installer or portable exe, AppImage, deb, rpm or tar.gz, or with one-line scripts; Homebrew, npm, winget, Scoop, Chocolatey, AUR, Snap, Flathub, apt and dnf channels switch on as their publishing keys are added. Every release carries build attestations and a Sigstore signature of its checksums.

