# Changelog

All notable changes to Keeper are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed — Navigation and Settings
- The sidebar has the same sections as Settings → Features: Library, Favorites, Locations, Cloud & Servers and Tags, then Mail & Calendar, Notes, Tidy, Sync & Backup, Computer, Privacy & Security, Devices, AI, Screen and Desktop. Settings stays at the foot. A section whose parts are all off disappears; the everyday ones start open and the rest show only their titles. The top block is Home, Recents and Browse; Weather and Places & Tracks moved to Desktop. Library kinds with nothing in them stay out.
- One page each, with tabs: System Controls (Quick switches, Hidden system settings, Per app), Privacy & Security (Overview, Protection, Firewall, Network activity, VPN) and Startup & Apps (Startup items, Installed apps). Keeper's processes is Health → Keeper itself; Browser tabs is part of Health → Apps & tabs; Keeper Mesh is Devices → Private network. Every old link still works.
- Renamed so a page has one name in the sidebar, its title and the palette: Download Sources (was Downloaded From), Undo History, Fix-it List (was To do), AI Usage, Devices (was Devices & Remote; its Remote Access tab is Access from anywhere), Notes from Other Apps, Synced Folders, Cloud Mirrors, Older Versions. Sync & Backup's title names the part you are in.
- Settings has two panes: sections and search on the left, one section on the right. Each section shows its everyday settings, then More settings (n); General → Always show all settings opens them all. Search understands what people call things (dark mode, hotkey, telemetry, notch), shows where each result lives, and scrolls to it and flashes it; results for a part that is off offer Turn on.
- Changed (n) lists every setting that differs from how Keeper came, old → new, each with Reset. A changed setting has a mark on its left and a reset button (also on right-click), with Undo; each section can be reset, and General can reset everything (after an export, if you like). Accounts, folders, locked folders and keys are never reset.
- Export and import settings (General): never passwords, keys, tokens, private calendar links or device ids, and folders only when you ask. An import shows what it changes before it does.
- One Privacy & permissions section; About keeps a one-line privacy note and one License row. Settings → Performance is Battery and speed (Save battery, Balanced, Fastest).
- Search everywhere also finds Keeper's own settings.
- Plainer words across Settings (Folders to search, Folders to skip, Find text in pictures and scans, Search everything again, Keeper in the menu bar, Details panel…), US spelling, and a check that fails the build on technical words in everyday settings.
- The palette lists pages under the same names, shows each kind of result once (Recent, Go to, Actions), and opens on the pages you were just on.

### Fixed — Navigation and Settings
- Studio and Copy text from screen both used ⌘⇧2 / Ctrl+Shift+2, so one of them never worked. Studio now records with ⌘⇧9 / Ctrl+Shift+9 and pauses with ⌘⇧0 / Ctrl+Shift+0 (it took the Mac's own ⌘⇧3 before); Remote Desktops quick connect moves to ⌘⌥E / Ctrl+Alt+E, off Record the screen's keys. Settings → General → Shortcuts from any app lists every shortcut and says "Taken by …" when one doesn't work, instead of failing without a word. Quick Search's shortcut is recorded by pressing the keys.
- Links into Settings (from the sidebar, the palette, a feature that needs a permission) land on the right row even while the parts above it are still loading.
- Cloud & Servers with no connection chosen shows every connection (state, space, Browse, Remove) and Add…, instead of a lone icon.
- Hint cards show under the page title instead of above it; a page whose part is off keeps its title.
- One tab bar everywhere: tabs that do not fit go under More instead of wrapping to a second row (Agents, Health, Firewall…). Selects and fields without their own style look like Keeper's; Vibes' Active badge reads in light mode; text sizes and corners come from one set of values.

### Added — Keep Awake with the lid closed, with Monorail
- Monorail can hand a closed-lid session to Keeper (`keeper://awake?for=2h&closedLid=1&handoff=<id>&from=monorail`, or `until=<epoch ms>`). Keeper keeps the Mac awake with the lid closed and answers in its hello (`state.awakeHandoff`, kept for 60 seconds); if it cannot (setup missing, permission refused, anything else) it starts nothing and says why, and Monorail keeps the Mac awake itself. Keeper's hello now says whether it can do this without a password prompt (`caps.closedLid`, `caps.closedLidReady`).
- New setting "Closed-lid mode only while plugged in" (on by default; existing settings get it too). When you unplug, only the lid part turns off and Keep Awake goes on, with a notification. With it off, closed-lid mode runs on battery down to the battery floor (20% by default). Heat, the battery floor and Low Power Mode also turn off only the lid part.
- Keep Awake's settings show "Set up closed-lid mode (asks for your password once)" on a Mac whenever the permission it needs is missing.

### Fixed — Keeper Link
- Link keeps its port when it opens to the network (pairing, a paired device, being findable, Get help). It now adds listeners on this computer's network addresses beside the loopback one instead of closing and reopening, so the keeper command and invite links or QR codes made a moment earlier keep working; new or gone network addresses are followed while it is open.

### Fixed — Keep Awake
- Keeper never switches off "sleep disabled" that it did not switch on itself; it uses it as it is. On Linux, ending closed-lid mode during a session now really releases the lid switch.

### Changed — Home
- Jump back in: recent files under the project or folder they belong to (a code repository's root, a top-level folder in Documents, Desktop or Developer, Downloads as one, or the folder they share), each with its newest files, small pictures or type icons, and Open folder. When there is no clear grouping it is one plain list. The arrow keys move through the files; Enter opens one.
- Today, on by default: today's events (visible calendars, the same meeting once), tasks due with a box to tick off, important unread mail, and running timers, focus, Keep Awake and recordings. Each row opens its event, task or message. A column on the right of a wide window, in line on a narrow one, with its own Hide button; it follows calendar, task and mail changes rather than checking again on a timer.
- Library tiles named and coloured as in the sidebar (All Images, All Videos, All Documents…), with counts and sizes, opening the same views; chips remain a choice in Edit Home.
- The Attention block is now one line of suggestion: the title, how many more are on To do, the fix, and Trust (for a security or privacy finding: it stops being suggested) or Not now (asks again in a week).
- The reading-your-folders line and Speed up now stay in the header, quieter.
- Edit Home lists the new sections; settings from the earlier Home move on by themselves (Attention → Suggestions, Recent → Jump back in, Calendar today → Today, shown), keeping the person's order, spacing and hidden sections.
- Planner opens a given task when asked (planner `task:<id>`), as Home's Today does.

### Fixed — Connections and reliability
- Browser tabs: the set-up page opens again in the installed app (it showed "This page ran into a problem"). A new check makes sure every method the interface calls is exposed to it and handled by the main process.
- Settings → Features → Sync and backup now really stops sync, scheduled backups, mirrors and version clean-up: their checks pause, folders are no longer watched and a running backup or mirror is cancelled. Switching it back on picks up where it left off.
- Long jobs are now Keeper's work while they run: Studio recordings and exports, meeting recordings, video downloads, cloud uploads and downloads, backups, mirrors and files sent or received over Keeper Link. They are listed in Settings → Performance and Keep Awake's "while Keeper has work running" trigger holds the computer awake for them. Studio and meeting recordings also keep the computer from going to sleep (the display may still turn off) until they are saved.

### Added — Copy and move files
- Copy, Cut and Paste in folders (⌘C / ⌘X / ⌘V, Ctrl+C / Ctrl+X / Ctrl+V, and the right-click menu) in the icon, list, columns and gallery views. Files copied in Keeper also land on the system clipboard, and files copied in the system file manager paste into a Keeper folder. A Paste button shows in the folder's toolbar while something is waiting to be pasted, and cut files show dimmed.
- Move to… and Copy to… in the right-click menus: a recent folder, your home folder, a Favorite or any folder you choose.
- Drag files onto a folder, a path-bar crumb, a column, a sidebar Favorite or disk, or the open folder to move them there (hold ⌥ on a Mac or Ctrl elsewhere to copy); drop them on the Trash to throw them away.
- When a name is already there, Keeper asks: Replace (the one already there goes to the Trash), Keep Both (the new one gets a number) or Skip. A folder can't be put inside itself, moving into the folder something is already in does nothing, and moves to another disk copy and then remove. Errors say why in plain words (no permission, read-only, not enough space, in use).
- Long copies and moves show their progress; every move can be undone from the toast or from History.

### Added — One search box for everything
- Search (the toolbar box and its page) and Quick Search now also find mail on this computer, calendar events, tasks, contacts, notes in your Notes vaults, Keeper's own features and pages, and system settings (System Settings+). Files come first, then each kind under its own heading; ↑ ↓ move through all of them in Quick Search and Enter opens the message, event, task, note, page or setting where it lives (a contact opens the mail from them). Each source answers within a moment or is left out, sources whose feature is off are not searched, and nothing is sent anywhere.

### Added — Mail and Tasks
- Add to Tasks on a message (the reader's toolbar, the right-click menu and the bar for several selected messages): one task per message, titled with its subject, with who it is from in its notes and a link back to the email. The task shows Open the email.
- Dates from mail added to the calendar ("Find dates" → Add to calendar) keep a link back to the email too, and the event shows Open the email. keeper://mail/<id> links open the message.
- The Island's new-mail alert says so when Archive or Mark read fails, instead of failing silently.

### Changed — Weather trips from your bookings
- Weather → Trips now also shows flights, stays, events and other bookings that Places & Tracks found in your mail, next to calendar events with a place: a stay where it is, a flight, train or bus where it arrives, each with that day's forecast and what to pack, marked Booking. A booking and an event at the same place on the same day show once. With no calendar connected, bookings still show.
- Removed an unused second trip finder in the main process (`forecast.trips`).

### Changed — Notes vaults everywhere
- Vaults opened or made in Keeper's Notes now join Notes Everywhere by themselves, read only, as "<vault> (Keeper Notes)": their notes are copied into the hub straight away, found by its search and listed in the Island's Notes under the vault's name. Keeper never writes into a vault from the hub. Removing a vault from Notes removes its connection (the hub keeps its copies); a connection you remove is not added again.

### Changed — Downloaded From knows Keeper's own downloads
- Files Keeper saves now record where they came from, the way browsers do (on a Mac kMDItemWhereFroms, so Finder's Get Info shows it, plus the usual download quarantine; on Windows the Zone.Identifier note; on Linux user.xdg.origin.url): saved mail attachments (Downloaded From → Mail), video downloads (the site, such as YouTube), cloud and server downloads (the connection's name), files received over Keeper Link (Keeper Link · the device's name) and downloads in Keeper's browser tabs (the site and the page).

### Added — Pause and edit backups and mirrors
- Sync → Backups: each backup has Pause / Resume (its schedule stops; Back up now still works) and Edit (name, folders and schedule). Where it is stored and its password stay, so editing never starts a new backup or asks for the password again.
- Sync → Mirrors: Pause / Resume and Edit (name, direction and schedule). The two folders stay; a different pair is a new mirror.

### Fixed — Feature switches that did nothing
- Hide faces, Remote screen extras and Control on Wayland now do what their switches say. With Hide faces off, the tool is refused; with Remote screen extras off, sound, several screens at once, following the pointer, drawing, voice chat, printing on the other computer and second viewers are refused; with Control on Wayland off, Keeper never asks the desktop's remote-control portal and the screen can only be watched.
- Convert, Convert to any format, Speech to text on this computer and Video downloads are now checked by the main process, so workflows, agents and the command line follow them as the page does.
- Meetings read calendars only while Calendar and reminders is on, and turn action items into tasks only while Planner is on (they checked a switch that does not exist, which always read as on).
- A test now fails when a switch is read by nothing, and reading a switch that does not exist is an error during development.

### Fixed — Permissions say what uses them
- Settings → Permissions and docs/PERMISSIONS.md: the camera is used by the Island's mirror and by Studio recordings with the camera on (it said "only the Island's mirror"); Studio is listed under Screen Recording, Microphone and Camera on every system, so a missing permission points to it too.

### Fixed — Studio and Stage
- A Studio recording no longer ends your own Stage session: when it stops, Stage goes back to the preset you had on (or off, if it was off). If you changed Stage yourself during the recording, it is left as you set it.

### Fixed — Failures are no longer silent
- A failure nobody handled, in any window or in the background, is now written to the session log (Settings → Keeper's processes) and shown once as a quiet toast with Details (in the Island, as its one-line message). The same message shows at most once every few seconds; cancelled work is not reported.
- Mail and calendar accounts record when they were last checked and the last thing that went wrong. Settings → Mail & Calendar shows "Checked 4 min ago", or "Couldn't check it: <reason>" with Retry, and the Mail sidebar marks an account with a problem instead of it just looking quiet.

### Fixed — Smaller things
- Accepting an invitation from an account without an outgoing mail server now says the reply was not sent (the organiser does not know), instead of just "Accepted". Accepting no longer adds a second copy when the event is already in one of your calendars: that copy shows your answer.
- A page that does not exist (a stale keeper:// link or a typo) says so and offers Home, instead of "This page ran into a problem".
- Subscribed calendar links in the Island give up after 15 seconds, so a server that never answers no longer holds up the calendar check.
- macOS: Keep Awake's time left shows once in the menu bar. When Keep Awake has its own menu-bar item, Keeper's icon no longer shows the same countdown beside it.

### Fixed — Setup and permissions
- A feature that needs a permission while no Keeper window is open now says so in the Island (or a notification that opens Permissions when the Island is off), and the menu-bar pop-over shows a line with Open. The microphone in voice chat offers Open Permissions instead of plain directions.
- Messages that named Settings sections that do not exist now name the right place (AI & Brain instead of Assistant; Agents → Abilities; Places & Tracks → Settings), and every message that names a place in Keeper gets an Open button. A test keeps it that way.
- "See docs/…" in Permissions, Notes and Devices are now Learn more links that open the guide.
- Cloud connections have a Test button that tries the settings once before saving, and problems show as warnings instead of notes.
- AI keys: "Get a key" links to the provider's page, and Save tests the key at once. Without a keychain (Linux with no keyring) the message says how to fix it.
- macOS: the Automation question now explains Music or Spotify, Notes, Finder and System Events, and Keeper says why it wants plugged-in and network disks.
- First run is now a short setup instead of an eight-step tour: Welcome (what Keeper is) → Recommended or Choose what you want → A few approvals → Connect your accounts → You're set. Recommended is one click and says what it found on this computer (developer tools, a notes vault, an AI built in), each with ✕ to leave it off; three visible boxes cover opening at login, automatic updates and anonymous usage stats (unticked). Choose shows every group with its parts, sizes to download and approvals, with a running total. Approvals list only what the chosen parts need now (at most Screen Recording and Full Disk Access with Recommended on a Mac, nothing on Windows), with the one-click questions left for first use; Full Disk Access is offered as one switch instead of a question for each folder. Connect offers Mail, an AI on this computer (Use it), pairing and cloud. Downloads for the chosen parts start in the background.
- Try it says why copying text from the screen did not work: Needs Screen Recording (with Allow), Restart Keeper to try it, or the error itself.
- Help → Set Up Keeper Again… and the command palette's "Set Up Keeper Again…" open setup with your current choices. Help also links to the user guide, install notes and permissions.
- With an AI built into the Mac or Ollama running, Recommended uses it when the AI chosen before has no key.
- The command palette opens with what you ran last, then common pages and actions.
- New installs start lighter: Recommended turns on about 44 parts on a typical laptop instead of 106, picked for this computer (coding tools, Docker or Podman, an Obsidian vault, an AI on this computer, memory, Windows or Mac). Parts that need an account, a key or a second device (Mail, Keeper on your other devices, Cloud and servers, Places and tracks) are offered, not on. Malware scanning of downloads is off on Windows, where Microsoft Defender already does it. Anonymous usage stats are off until you tick the box in setup.
- Every part now says whether it is Recommended, Offered or Advanced, which part it follows, its group in setup and a plain name (core/feature-tiers.ts).
- Presets are Recommended, Light, Files only and Everything, and Custom shows when your own mix matches none (Balanced and Minimal still work where they were saved, for example for battery and power). Recommended in Settings → Features is for this computer, like in setup. The speed modes are called Save battery, Balanced and Fastest (saved settings read the same).
- Until the first-run setup is finished or skipped, the library reads only Downloads, so macOS does not ask about Desktop and Documents before you have seen anything.
- Permissions lists the Keychain (Credential storage on Windows, the keyring on Linux, with a Test that says to install gnome-keyring or KWallet when there is none), Files and folders and Administrator password on macOS, and Open at login on Windows and Linux. Open at login now works on Linux too (an autostart entry).
- "Restart Keeper to finish" for Screen Recording and Input Monitoring is judged against the state when Keeper started, not when Permissions was first opened.
- Error messages from Keeper's background part no longer start with "Error invoking remote method …".
- Upgrading never switches a part off: the first time this version starts, Keeper writes down what is on and off for you now, so new defaults apply only to new installs (and to Recommended when you pick it).
- macOS: Allow for Accessibility, Screen Recording and Input Monitoring works every time. macOS shows those questions only once per app, so Keeper now remembers that it asked, opens the exact System Settings page when the answer is still not yes a moment later, and labels the button (and "Ask again" in Allow all) "Open System Settings" from then on. A row that stays off after that suggests removing Keeper with − and adding it again (macOS can hold an older copy's approval).
- The macOS keychain question after an update ("Keeper Safe Storage") is explained in the Software Update window before it restarts, and in docs/PERMISSIONS.md. Until a Developer ID build, that line asks you to type your login password and choose Always Allow.
- When the keychain refuses (Deny, or a locked keyring on Linux), Keeper now tells that apart from "nothing saved". A banner in the main window and the menu-bar pop-over says "Keeper can't read its saved passwords and keys" and offers Try again (and Restart Keeper if macOS does not ask again). Mail accounts are no longer flagged "Sign in again" and AI no longer says "add your key": both say that the keychain was locked or denied. Keeper Link never makes a new device key while the keychain is closed, so paired devices keep trusting this computer: it waits and picks the saved key up after Try again. Keeper Mesh does the same for its WireGuard key.
- Keeper Link stays on this computer until it is needed. Nothing listens on the network and nothing is announced over mDNS until you pair a device, show a pairing code, look for devices, connect a phone, or switch on "Let devices on this network find this computer" (new, on the Devices page). So the Windows Firewall and macOS Local Network questions no longer appear at first launch.

### Changed — Smaller download, parts on demand
- The standard installer leaves out three heavy optional parts: the video and audio engine (ffmpeg), on-device AI models (ONNX Runtime) and the cloud storage connector (rclone). Without them the Linux tar.gz goes from 248 MB to about 180 MB, and the Mac disk image from 252 MB to about 190 MB. Keeper downloads a part when a feature that needs it is switched on: Settings → Features shows "Download … (size)" with progress, and the Studio, Meetings, Dictation and Convert pages ask on first use. Each part is about 13 to 31 MB. Parts come from the same release as Keeper, must match its signed SHA256SUMS.txt and their own list of files, and on a Mac must be signed like Keeper. They are used only with the exact version they were made for.
- Settings → Features → Downloadable parts: each part's state and size on disk, Download everything for offline use, and Free up space. When you are offline Keeper says so, and it tries again once the network is back.
- Offline installers: `Keeper-mac-<arch>-full.dmg`, `Keeper-setup-x64-full.exe`, `Keeper-linux-<arch>-full.AppImage` and `Keeper-linux-x64-full.tar.gz` have everything inside. `install.sh --full` installs one. Updates always use the standard installer.
- After an update, Keeper downloads the parts used by the features you have on, in the background, with a notice. This includes copies updated from a beta that had everything inside. Nothing is downloaded while Keeper starts.
- Add-on apps: Monorail is listed next to the parts on a Mac, with Install, Update, Open and Uninstall. Switching it on yourself installs it, and presets never do. People who follow betas get Monorail's newest pre-release, and a stable release now always beats its own betas.
- Packaging: `KEEPER_EDITION=core|full`, `scripts/components.mjs stage|pack`, and component assets plus `components-<platform>-<arch>.json` in every release (docs/COMPONENTS.md).

### Added — Keeper as a suite
- The Island, desktop widgets, and Mail and calendars run in processes of their own (Keeper's own program started as `--keeper-role=island`, `--keeper-role=widgets` and `--keeper-role=mail`), still one install, one version, one updater and one Settings. If Keeper's main window or main process stops, the Island and widgets stay on screen, mail keeps arriving, Send later still sends, snoozed mail comes back and alarms and event alerts still ring; everything reconnects when Keeper is back (the watchdog starts it again). If one of the parts stops, it starts again on its own after a short wait (0.5 s, then longer each time, stopping after five crashes in ten minutes) and Keeper carries on. A part already running when Keeper starts is picked up, never started twice. After a Force Quit on a Mac, Keeper stays stopped while the Island, widgets and Mail carry on; clicking the Island or a widget starts Keeper again.
- Settings → Features → Keeper suite: Keeper, the Island, desktop widgets, Mail and calendars and the background services, each with its switch (Mail and calendars' switch turns Mail, Calendar and reminders, and Alarms together), whether it runs, its memory and processor use, restarts and last crash, and Restart. Switching a part off ends its process; widgets with nothing on the desktop do not run at all. Where a feature still has a component to download, the page shows it and its progress. "Run parts in processes of their own" (on by default, off with Save battery) puts everything back in one process from the next start; the parts cost about 80–100 MB more than one process (measured, docs/SUITE.md), and the idle memory budgets checked on every change rose by that much. The Processes page lists the parts too.
- The parts talk to Keeper over a local socket (a named pipe on Windows) that only you can open, with a key that changes each time Keeper starts (docs/SUITE.md). Only Keeper has a Dock icon; the parts have no graphics or network process of their own.

### Changed — Computer use
- Reading and pressing the controls in other apps now goes through agent-desktop (Apache-2.0, by Vercel Labs), a small program that comes with Keeper: one call reads the whole front window, hidden fields' contents stay hidden, and each control is found again by what it is (role, label, place) before it is pressed, so a press never lands on a different control after the app changed. A stale control is looked up once in a fresh reading; a press that may already have happened is reported, never repeated. Presses stay accessibility calls: the pointer only moves when Keeper clicks a control's centre itself, as before. When agent-desktop is missing, fails or is too slow, Keeper uses its own system scripts (System Events, UI Automation, AT-SPI) as before.
- Use this computer → Accessibility engine: Automatic (agent-desktop first) or Built-in (only the system scripts).
- The computer tools gain `set_value`: put text into a field from `ui_tree` without typing it key by key (passwords and keys are refused, as with `type`).
- Packaging: `scripts/fetch-agent-desktop.mjs` downloads agent-desktop v1.0.2 for the target, checks it against pinned SHA-256 fingerprints and keeps its LICENSE and a NOTICE beside it; `prepare-arch` and `npm run dist`/`dist:mac` run it, release builds require it, and on a Mac it is signed like Keeper so Keeper's Accessibility permission covers it.

### Added — Studio
- Studio (More → Studio, the command palette, ⌘⇧2 / Ctrl+Shift+2, the tray): record the screen, one window or an area, then edit it into a finished video. The recording keeps its parts apart: the picture without the pointer (ScreenCaptureKit at up to 60 fps and full Retina resolution on a Mac; the bundled ffmpeg on Windows and Linux X11), a log of where the pointer was (about 60 times a second), clicks, keys and the app in front, and the microphone, the camera and the computer's sound (Mac, Windows) as tracks of their own, all written to disk as they come. Countdown, pause and resume (⌘⇧3 / Ctrl+Shift+3; paused parts are left out of the video), stop from the page, the Island, the tray or the shortcut, and an option to clean the screen with Stage first. On Wayland, and wherever the pointer cannot be left out, Studio says so and works with the pointer in the picture.
- The editor: automatic zooms made from where you clicked and typed (eased in and out, following the pointer while zoomed), each one movable, resizable and adjustable on the timeline, or added by hand; a smooth pointer drawn from the log (larger sizes, a dot look, click ripples, hidden while still, motion blur on fast moves and pans); backgrounds drawn from numbers (colour fields, waves, gradients, plain colours), padding, rounded corners, shadow and a window edge; 16:9, 9:16, 1:1 and 4:5 frames that follow the pointer in tall and square shapes; split, cut, trim and speed up, with idle stretches and silences cut or sped through in one click; a camera bubble (circle, rounded, square) that moves out of the pointer's way; even loudness and gentle noise reduction. Undo and redo, keyboard shortcuts, saving as you go, and a list of recent recordings.
- Extras: captions made on this computer from the microphone (shown in the video or written as .srt), chapters from the apps used (inside MP4 and WebM files), keyboard-shortcut badges from the key log, and privacy blur: email addresses, keys and tokens found by reading the picture on this computer, plus blur boxes you draw.
- Export to MP4 (H.264), HEVC, WebM and GIF at 480p to 4K and 15 to 60 fps, with presets (Standard, Crisp 4K, Quick share, Vertical, Square, Small HEVC, Web, GIF), progress and Cancel, then Show in Folder or Copy. Every frame is drawn by the same code as the preview, so the export matches what you saw.

### Added — Desktop widgets
- New widgets: Week (seven days of calendar events and planned tasks in calendar colours, today highlighted, earlier and later weeks, × to finish a task and "+ add" in each day: words with a time such as "Lunch 1pm" add an event, anything else a task), Timer (a countdown ring with Start, Pause, Reset, +1 min and 5 / 10 / 15 / 25 minutes; it runs as one of Keeper's own timers, so it rings in the Island even if the widget closes) and 7-day forecast (each day's sky, highs and lows in °C and °F, chance of rain, and rain in the night, morning, afternoon and evening, from the weather Keeper already has).
- World clock: each city's working hours (9:00–18:00 unless set otherwise on the Widgets page) as a 24-hour strip on your own day, quarter-hour exact for places such as India and Nepal and following clock changes; an Overlap row with the hours when everyone works; a line at now and a slider to look at any hour (every time follows it; Now goes back); type a city or zone (Tokyo, Dubai, Europe/Paris) to add it, × to remove. Narrow world clocks keep the simple list.
- Widgets with dark text on a light card draw their colours in darker shades. Widgets that do not show Island data no longer read it every 30 seconds, and the new ones wake once a minute (the timer once a second only while it runs).

### Added — Island
- Sizes for the open Island: Compact, Regular, Large and Extra large, chosen per tab. Calendar, Week, Notes and Mail open Large; the others at the default from Settings → Island → Open Island size. Drag the grip on the panel's bottom edge (it snaps to the sizes), use the size button beside the tabs, or pick a tab's size in Settings → Island → Tools. Never bigger than the screen's work area, and the window is still exactly the size of the panel.
- The Calendar tab uses the room: a bigger month and a wider list at Large, and the week beside the month at Extra large.
- Choose which calendars the Island shows: a Calendars button in the Calendar tab and Settings → Island → Calendars in the Island list every calendar under its account, with its colour, a tick, and Show all / Hide all. It is the calendar's own Island switch (also in Mail & Calendar), so the Calendar and Week tabs and the countdown to the next event follow it.
- Settings → Island → Advanced (macOS): Window type, Standard (default) or Panel, the floating panel Keeper used before. The Island is made again when it changes.

### Changed — Island deck
- The open Island has a deck instead of a row of every tool: up to four pinned views (Home, Shelf, Week and Timer to start with) and More, a grid of every other tool with recent ones first, a filter (just start typing), and the tool launcher at the bottom. The bar never scrolls or runs off the edge; only the open view shows its name, and when room is short a live view gives up its place first, then the names.
- Pin, unpin and reorder in More (a pin on each tool, drag onto the deck's four places; pinning a fifth asks which one to replace), from a deck icon's right-click menu (Move left, Move right, Unpin), or in Settings → Island → Deck and tools. Settings from before keep the person's first four tools in their order; anyone who never changed them gets the new deck.
- While music plays, an agent works, a timer runs or something records and its view is not pinned, it borrows a place before More until it ends.
- Calendar is called Week on the deck and the planner's week of tasks is called Planner. Keep awake and Stage moved from the tab bar to Home's status line.

### Changed — Island motion
- Opening and closing use real springs (src/island/spring.ts) instead of one CSS curve: a slightly bouncy open, a close that never bounces, its own spring for switching views, the wings and cards, and a new target keeps the speed it has, so a hover that turns into an open (or a close called off) is one motion. Nothing runs on animation frames once the shape is still.
- The pointer arriving makes the closed Island grow a little at once; it opens after 140 ms (was 250 ms; a delay you chose is kept), and a pointer sweeping along the menu bar only passes by. The window grows to the open size during that wait, still letting clicks through outside the shape, so opening is only the shape's motion.
- Closing: 220 ms after the pointer leaves (not while a menu is open, a field has the keyboard, something is dragged or a button is held), the content fades out first and then the shape closes; the window shrinks once it has come to rest. With Reduce motion the sizes change at once.
- When the open Island changes size (opening a smaller or larger tool from More, another view) and so ends up away from the pointer, it waits 1.5 s for the pointer to come back instead of closing after 220 ms.
- macOS: a light trackpad tap as the Island opens, never when the pointer only passes over it (Settings → Island → Haptic feedback; needs keeper-helper, nothing happens without it).

### Changed — Island look
- On a notch the Island is pure black with no shadow, glow or stroke, so the open Island reads as the notch growing. Floating (no notch, or below the menu bar) it is near-black with a hairline edge and a soft shadow when open.
- Bottom corners of the open Island are 28 (was 26); colour and type tokens (primary 14, secondary 12, captions 11, big numerals 44, tabular figures for times). Home drops its grey tiles: content sits on the black, two columns with a hairline between.

### Fixed — Island
- macOS: the Island is a plain borderless window instead of a panel, so macOS 26 no longer draws a grey rounded backdrop behind the open Island. Its scroll bars are dark and thin, with no light square in the corner.
- Opening the Island no longer takes the keyboard, so it never brings Keeper or its main window to the front; it takes the keyboard when you click a field in it (or the New task shortcut opens it). The closed pill never takes focus.

### Added — Mail
- Important and Other: inboxes sort themselves into people you write to, replies to your mail and mail written to you (Important) and newsletters, receipts and automatic mail (Other), with unread counts on each. Sign-in alerts, one-time codes and password resets are always Important and marked Security. Right-click a message to keep a sender in Important or Other.
- Waiting for reply: sent mail nobody has answered (across accounts, Sent and Archive), how long it has waited, and Follow up, which writes the follow-up to the same people in the same conversation. Done takes one off the list; Settings sets when a message counts as waiting a while.
- Subscriptions: every newsletter and list by sender with how many arrived and how many you opened, the ones you never open first. Unsubscribe (one click where the sender offers it), archive everything from a sender, or both; their later mail goes to Other.
- Unified All sent and Snoozed views beside All inboxes. Snoozed mail comes back unread at the top of the inbox at its time (later today, this evening, tomorrow, this weekend, next week), with a note in the Island. Send later has more times, a time of your own and a Scheduled list to edit or cancel. Undo send still holds a message for a few seconds.
- Search looks through every account and folder kept on this computer first, then asks the servers for older mail, shown apart. End a search with a question mark (or press Ask) to have it answered from your mail, with the messages it used.
- New Important mail drops down from the Island with Open, Archive and Mark read (Settings: Important only, all mail, or never).
- AI: three reply ideas written the way you write (from your own sent mail), summaries of long threads, translation into your language, and Rewrite in the compose window (shorter, friendlier, more formal, proofread, translate, with Undo). It uses the AI chosen in Settings → AI & Brain, on this computer if that is what you chose; security mail is never sent to it.
- A wide layout (one line per message, bulk actions for the selection: read, unread, snooze, archive, delete) beside the split one, and keyboard-shortcut sets: web mail single letters, desktop mail with ⌘ / Ctrl, and fast triage (E done, H snooze), each key changeable in Settings.
- Offline: the newest inbox messages are kept on this computer to read without a connection, and changes made offline (read, flag, archive, delete, move) go to the server when it is back. Sent and Archive are kept in step too.
- Coding assistants: accounts you choose can be searched and read over Keeper's MCP server, and drafts written into their Drafts folder. Sending, deleting and moving are not offered; Spam, Trash and security mail are never shown; secrets and codes are blanked.
- Signatures can be written in Settings → Mail & Calendar and show under the message while you write; nested folders are indented; labels (Gmail's too) show on messages and work in search as label:. AOL and Zoho are set up from the address alone.

## [0.1.0-beta.7] - 2026-11-02

### Fixed
- Memory in use now reads as the system's own monitor counts it. On a Mac that is Activity Monitor's Memory Used (App Memory + Wired + Compressed), not total minus free, which counted the file cache as used (a 36 GB Mac showed 35.6 GB instead of about 32). The memory bar is coloured by memory pressure, and a line under it shows the cached, swap and compressed memory. On Linux, used is total minus MemAvailable. This applies to the System view, the Island's System tool, the glance, the menu-bar readings, Monitor, the AI summary and Link device stats. Background work holds back under memory pressure on a Mac.
- Island: the open Island is one black shape again, with no thick grey frame around it (seen under a Mac's notch on macOS 26). Its window is now only as big as the card or panel it shows, and has no corners or edge of its own.

### Added — AI usage
- Usage → Accounts → Add account: sign in to Claude (claude.ai: Pro, Max, Team) or ChatGPT (Plus, Pro, Team, with the Codex limits) inside Keeper, one window and one isolated sign-in per account, so several Claude accounts sit side by side. Keeper never sees the password; removing the account wipes its sign-in. Reading the usage is unofficial (the sites' own pages) and opt-in per account; signed-out accounts show "Sign in again".
- The Island's AI Usage tab now shows the tracker's accounts by name, with bars, the share left and reset countdowns, most urgent first, and "+ Add account". The glance, the Island's ring and the warnings name each account, and two accounts of one service get letters of their own.

### Fixed — AI usage
- Claude Code token counts also read the newer `~/.config/claude` folder and folders that only had files appended to, skip the tool's own zero-token notices, and say what was actually read instead of "Counted from 1 session file".

### Added — Calendar and Notes in the Island
- Calendar events in the week: the Island's Week tab and the Planner's week show each day's events beside its tasks (time, title and calendar colour; a click opens Calendar), from every calendar Keeper reads: the Mac's own through EventKit (iCloud, Google, Exchange and others added in Calendar) and Google, Outlook and CalDAV accounts connected in Keeper. When Keeper cannot see the computer's calendars, the Week, the Island's Calendar tab and the Planner say so with Allow, Open Privacy Settings or Connect Google / Outlook calendar, instead of showing nothing. macOS: calendar access given on the Permissions screen (or in System Settings) now reaches Keeper's already-running helper, which could keep answering "not decided" and read no calendars until Keeper restarted.
- Apple Notes in the Island: the Notes tab lists the notes of Notes Everywhere's connected apps (Apple Notes first on a Mac) under Keeper's own, searchable with the same box and readable in place, with Open in Notes. On a Mac it offers to show Apple Notes (macOS asks once whether Keeper may control Notes, and Keeper shows what it would copy first), and says how to allow it in Privacy & Security → Automation when it was refused.
- For other pages: the calendar service answers `pim.upcomingEvents(from, to)` (events from every source, with place and join link) and `pim.calendarStatus()` (each source, connected and allowed, and the Mac's EventKit state).

### Changed — Browser tabs and Places
- Browser tabs: Keeper registers itself with every browser it finds by itself (Chrome, Chromium, Edge, Brave, Vivaldi, Opera, Arc, Firefox), with no button to press. Until a browser connects, the page is a one-screen setup with a big “Add to Chrome” (Edge, Brave, Firefox…) for each browser found: it opens the store page once the extension is published there, or opens the browser’s extensions page, shows the extension’s folder, copies its path and walks through the three steps with pictures. The page switches to your tabs by itself once the extension connects. “Re-link browsers” moved to the ⋯ menu.
- Browser tabs: the extension now sits in Keeper’s own data folder (on a Mac ~/Library/Application Support/Keeper/browser-extension), refreshed on every update, so it is easy to choose in the browser’s file dialog.
- Browser tabs: “What each browser allows” is short and plain, under Details; Safari says “Safari support is coming”.
- Places & Tracks → Sources: on macOS 14.4 and later (where Apple encrypts the Find My cache) Find My shows as “Not available on this version of macOS” with no switch and one line on why, and offers Open Find My and “Share your phone’s location with Keeper” instead.
- Places & Tracks → Sources: a source that needs live sharing or sports services has a one-click Turn on in its row instead of “Waiting: turn on … in Features”.

### Fixed — toasts and Places
- The same message shown several times in a row (such as pressing a button again) no longer stacks identical toasts; it shows once, with ×2, ×3.
- Places & Tracks → Sources: Find My no longer says “Off” next to a switch that is on.

### Changed — Weather
- Weather is redesigned: a sky-tinted summary of now with a one-line outlook ("Clear until this evening, then cloudy"), an hour-by-hour strip with sunrise and sunset, a 10-day list whose bars share one scale (and open into that day's hours), tiles for air quality, UV, wind, humidity, feels like, sun, precipitation, pressure and visibility and the moon, place cards with their temperature and local time, and one set of drawn condition icons for every weather code (no more missing emoji). The radar fills its card, pans and zooms by drag, wheel or pinch, uses a dark map in dark mode, preloads its frames and pauses while the window is hidden. Trips from your calendar now read every calendar Keeper reads (`pim.upcomingEvents`: this computer's, Google, Outlook, CalDAV and links), skip video meetings and rooms, and add a packing hint; when no calendar can be read they show the same "Keeper can't see your calendars yet" row as the Week and the Planner.

### Changed — Folders and sidebar
- Folders work like Finder and File Explorer everywhere: a folder shows its subfolders first, then its files, as icons, a list with disclosure triangles, columns or a gallery (⌘1–⌘4), with a path bar, Back/Forward (⌘[ ⌘], Alt+← →) and the enclosing folder (⌘↑, Alt+↑). The Library's kinds are now "All Documents", "All Archives" and so on, with filled tiles instead of folder icons, a line that says what they are, grouped by folder (with "Show in folder") and opened as a list for text-heavy kinds; text files show a clean type icon. The sidebar no longer spills past its edge: long names end in an ellipsis with the full name in the tooltip, highlights, disk bars and focus rings stay inside, counts line up on the right.

### Changed — a light background citizen while it reads a big library
- On battery, Keeper keeps the library right (new, moved and deleted files) and leaves everything else (reading text in documents and pictures, fingerprints, meaning search) until the charger is in, unless you chose Performance or press "Speed up now" on Home. While you work, background reading takes about a fifth of one core (a tenth for heavy work), and all of it shares that one allowance instead of each kind taking its own; when you are away, about half.
- The library index is no longer rewritten whole every 15 seconds while text is read: changes go to a small journal beside it (index.json.log) and the index is rewritten only after big changes or when the journal has grown large. A rescan that finds nothing new writes nothing (it used to rewrite the whole index every half hour), and the brain is saved at most every few minutes for a big library. A first start on 200,000 files wrote 1.8 GB in 20 minutes; now about 300 MB.
- The brain catches up on just the files that changed instead of looking at the whole library every few seconds, no longer reads each text document twice, and waits on battery like the rest. With the index's journal and calmer refreshes, a first start on 200,000 files takes less than half the processor time (222 s to 102 s in the first 20 minutes) and peaks at about 800 MB instead of 1.2 GB.
- Listing the folders takes a tenth of the processor time it did (each file's details are read with a direct call instead of through the thread pool): 200,000 files in about 20 seconds, and a rescan that finds nothing new costs about 5 seconds of processor time and writes nothing.
- Download sources are looked up after the folders are read (so Home stops saying "Reading your folders…" sooner), 500 files per helper, and helpers run in the background class on a Mac (taskpolicy -b) and at low priority elsewhere; the meaning model's threads run at low priority on Linux. Pictures are no longer decoded at full size when the Mac's own text recognition reads the file.
- Windows refresh library counts at most every second and a half, and every thirty seconds while text arrives in the background (it was every five seconds for hours); reading progress reaches them at most twice a second.
- Home shows real progress: "Reading your folders · 120,000 of ~270,000" (or "so far" the first time), then "Paused on battery" or "Waiting until you're idle" while details wait, with "Speed up now".
- CI: the big-library check also budgets the main process's average processor use and its disk writes while reading, and a new battery check makes sure nothing but the listing runs on battery.

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

