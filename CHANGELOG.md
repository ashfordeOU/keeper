# Changelog

All notable changes to Keeper are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added — Clock: focus presets with their breaks
- Clock → Timers has **Focus** presets that start the Island's focus timer with a break that suits it: 25 and 5 minutes, 50 and 10, or 90 and 15.

### Added — Today: today's note one click away
- Today's More menu has **Today's note**, which opens the day's note in Notes, made from your daily note template the first time.

### Added — Quick Search: Do again
- With nothing typed, Quick Search lists the last three things you ran from it (actions and saved links) under **Do again**, so Enter repeats the last command.

### Added — Convert: presets for the usual jobs
- Three presets above the tools: **Email-friendly** (small enough to send), **For the web** (light pictures and videos) and **One archive** (everything in one ZIP). Each picks the tool and settings for the files you dropped and shows them before anything runs.

### Added — Cues: ready-made checklists
- Cues → Checklists offers six to start from (Before a video call, Weekly review, Before a release, Leaving for the day, Packing for a trip, Before presenting). One click adds one as your own, to change as you like.

### Added — Tasks: energy, and a Low energy view
- Give a task an energy: Low for a tired moment, High for deep work, in the task or by typing `~low` or "deep work" when you add it. It travels with the task to calendar accounts.
- Tasks → Plan has a **Low energy** view: the easy open tasks, today's and overdue first.

### Added — Today: quieter cards that speak only when needed
- **Follow-ups**: how many messages you sent still wait for an answer past your follow-up days, opening Mail's Waiting list.
- **Backups**: shown only when a backup went wrong or is late for its schedule ("Last backup 3 days ago"), with Fix.
- **Your week**: tasks done, focus time and your streak, where the separate Insights used to be.
- **On this day**: a few pictures made on this day in earlier years.
- A day with nothing on the calendar shows a small designed card, *A clear day*, with Add an event, instead of a bare line.

### Added — AI: where AI is used, in one table
- Settings → AI → **Where AI is used** lists every part that uses your AI (Assistant, Ask in the Island, selected text, writing help, Mail, Meetings, Agents and search) with a switch for each part that is only AI and a Settings button for Mail and Meetings, so you can see at a glance which AI does what.

### Changed — Modes: presets folded in, calmer switching
- Settings → Features names the mode you are in, with Change mode…, instead of the old presets. Your saved sets of parts are **My modes**, saved with **Save as my mode** and still usable on battery or on power.
- Switching modes quickly shows one toast that changes with each switch, not three stacked.
- Outside Standard, Weather leaves the sidebar (it stays in the Island and widgets), Places & Tracks and a year of health history are off; Pro turns on the advanced readings (health history, live readings in the menu bar, monitor brightness keys).

### Changed — Sidebar: Connect for other people's machines
- Remote Desktops and Terminal have their own **Connect** section, apart from **Devices** (your own phones and computers, and Phone Alerts). If you had hidden Devices, Connect starts hidden too; show it again any time with Customise sidebar.

### Changed — Agents: four tabs, and one door to the Knowledge Graph
- Agents has four tabs instead of eleven: **Apps**, **Permissions**, **Memory** and **Automation**, each with a small switch between its views. Abilities and Skills were two words for one idea: the built-in skills now sit under your own on one Skills view. Old links open the right view.
- The **Knowledge Graph** moved to the Notes section, beside the notes it links, and the Agents page no longer has its own button for it.

### Changed — Look & Feel: theme, wallpaper, sound and vibes in one place
- Wallpaper & Vibes is now **Look & Feel**, and opens on a **Theme** tab with the same picker as Settings → Appearance, then Wallpaper, Sound and Vibes (your saved combinations), Schedule, Folder icons and Options. Old links still open it.

### Changed — Tasks: one home for things to do
- Reminders and the Planner are one **Tasks** page in Mail & Calendar, with the tasks due today counted beside it. **Plan** holds the days (Today, Week, Inbox, Upcoming, Overdue, projects) and **Lists** holds your reminder lists, Important and each account's lists. The view you are on is named under the title.
- Old links, page windows and the Keeper Planner and Keeper Reminders app icons still open the right tab.

### Changed — Voice: Dictation, Meetings and Snippets on one page
- One **Voice** page in the AI section with three tabs: Dictation, Meetings and Snippets. They share one engine and one list of snippets you type or say, so they now live together. Old links and page windows still open the right tab.
- Typed Snippets is now simply **Snippets**, and lists the clipboard picker's sets under your snippets, each with Paste one by one and Open.
- A meeting's header is calmer: one **Export** menu (notes, transcript, subtitles) and Delete under More. Times are written the way your computer writes them (16:07 or 4:07 pm), never "04:07 AM".

### Changed — Screen: one page for capturing, recording and presenting
- Capture, Studio and Stage are one **Screen** page with three tabs: Capture, Record and Present. Old links, page windows and the Keeper Studio app icon still open the right tab.
- The Toolbox has left the sidebar. Every tool in it is a command in Quick Search (type "JSON formatter" or "hashes"), and the Toolbox page is still in the palette.

### Changed — Archives and Snap Windows: plain words
- Archives' What works here says "Opens with your system's tools" instead of naming the program underneath; only 7-Zip is named, where it needs installing.
- Snap Windows on Linux says "Works with apps on this desktop".

### Added — Send to…: the same eight choices for everything
- Right-click a file, a mail or a note (or use Send to… in the Inspector, or Send Selection to… in the command palette) and send it to a Note, a Task, an Event, a Mail, another Device, the AI, the Shelf or a Cue. Keys 1 to 8 choose.
- Every copy keeps a line back to where it came from ("from mail: Invoice October"), with a link that opens it, and most can be undone from the message that follows.
- A choice that cannot be used now says why ("Notes is switched off", "Only files can go there") instead of disappearing.

### Added — Buttons & Shortcuts (experimental): mouse buttons with a job, and shortcuts changed in one app
- Give the back, forward and middle buttons of a mouse a job: go back or forward, copy, paste, undo, close or open a tab, show all windows, or any keys you press. In every app, or only in one (that app's own job wins).
- Change what a shortcut does in one app: "in Notes, Ctrl D sends Ctrl Shift D". Keeper takes the keys only while that app is in front, so every other app keeps them.
- On Windows and macOS you can also stop a button's own action (More settings); on Linux Keeper can listen to a button but not take it over, and the page says so.
- Works on macOS (Input Monitoring and Accessibility), Windows and Linux on X11 (xinput or the "input" group for the mouse, xdotool for keys). Wayland does not let apps send keys to other apps, and the page says that too. Off until you turn it on in Settings → Features → Desktop (Advanced).

### Added — Menu bar icons: other apps' icons out of sight on a Mac
- Keeper adds a small divider to the menu bar. Icons left of it stay out of sight until you click it, and hide again after 15 seconds (or when you choose). Right-click the divider for a list of the hidden ones and open any of them from there.
- Settings → Menu bar lists the icons in view and the hidden ones, with Hide and Keep in view for each (Keeper moves the icon across the divider for you, the way ⌘-drag does), and Open for hidden ones. The clock and Control Centre stay where macOS puts them.
- Optionally, a hidden icon that changes (a new badge, a timer) shows them all for a moment, and the divider gets a dot.
- On macOS 26 the page also points to the system's own Menu Bar settings. Windows keeps extra icons in the taskbar's own overflow, so there Keeper opens those settings instead; Linux trays differ, and the page says plainly that Keeper cannot hide them there. Off until you turn it on.

### Added — Folder boxes: a folder's files on the desktop
- A new widget, Folder box, shows any folder's files as icons on the desktop: folders first, then by kind, name, newest or largest, or only one kind. Double-click (or Enter) opens a file; right-click shows it in its folder. The button in its corner rolls it up to its title.
- Tidy my desktop (on the Widgets page) shows first what would move, then puts loose desktop files into one folder per kind (Pictures, Documents, Music…) inside the desktop, with a box for each. Folders and hidden files stay. It is one step in History, and Undo puts everything back.
- New desktop files here: a box can send new pictures (or documents, or any kind) from the desktop into its folder, as an ordinary Automation you can see and change.
- On all three systems. On Wayland the boxes are ordinary windows and may sit over other apps, and the Widgets page says so. Off until you turn it on in Settings → Features → Desktop.

### Added — Snap Windows: halves, thirds and quarters with one shortcut
- Put the window in front into the left or right half, the top or bottom half, a third, two thirds, a quarter, the whole screen, the middle or the next screen. Halves, Fill, Middle and Next screen have keys from the start (Ctrl Alt Shift with the arrows, Enter, C and N; ⌘⌥⇧ on a Mac); thirds and quarters are yours to choose.
- Save this layout keeps where your windows sit on this set of screens, named Laptop or Docked; Restore puts them back. Optionally, plugging in a screen brings back its layout by itself.
- Works on macOS (with Accessibility), Windows and Linux on X11. Wayland does not let apps move other apps' windows, and the page says so. On a Mac with Monorail running, Monorail arranges the windows and Keeper's snap keys stay free.
- Off until you turn it on in Settings → Features → Desktop.

### Added — Sound for each app
- Health → Sound & tabs on a Mac: the apps playing sound, and the Output menu switches speakers and headphones (through a public part of macOS after all).
- On Linux each app can play to its own output: music to the headphones, a call to the speakers.
- Sound for each app (off until switched on, also from the page): the volume, mute and output you give an app are kept and set again the next time it plays. Forget lets an app go. Windows keeps each app's volume itself.
- Volume for each app on a Mac, as an experiment (macOS 14.2 and later, off by default): the app's own sound is muted and played again at your level, through the system's audio capture, with no driver to install.

### Added — Displays: screen sizes, presets and matched brightness
- Computer → Displays shows every connected screen with its size and refresh rate (and sharp text on a Mac). Pick another and it switches at once; a small Keep this? bar counts down and switches back by itself if you do not press Keep, even when the new mode shows nothing.
- Save how your screens are set as a preset ("Desk") and use it in one click, or let it apply by itself when that set of screens is plugged in.
- Matched brightness: plugged-in monitors follow your laptop's own brightness, each a little brighter or dimmer if you like, or a day and evening level. A monitor is told only when its level should really change.
- Works on macOS, Windows and Linux (X11, KDE and wlroots desktops); GNOME on Wayland keeps sizes in its own settings, and the page says so. Off until you switch it on (Settings → Features → Computer).

### Added — Battery Care: stop charging at 80%
- Computer → Battery Care stops charging at 60, 70, 80 or 90%, so a laptop that is plugged in most of the day keeps its battery healthy for longer. On Linux Keeper sets it itself (ThinkPad, ASUS, Framework, Dell, Huawei, LG, MSI, Samsung, System76 and others) under one password prompt, and it stays set after a restart.
- Full charge for a trip: 100% until tomorrow morning, then back to your limit by itself. Pause when warm: charging waits while the battery is 40°C or warmer.
- On Windows it opens your laptop maker's own app, which sets the limit; a Mac manages charging itself, and Battery Care says so and opens Battery settings.
- Off until you switch it on (Settings → Features → Computer).

### Added — App updates: newer versions of your apps, updated safely
- Applications → Updates lists apps with a newer version: from each Mac app's own update feed, Homebrew, winget, Flatpak and Snap, with system packages counted and how many are for security. Security updates come first.
- One button per app: Update runs its package manager; Download fetches the maker's own file, checks it against the key inside the installed app, then opens it; apps with nothing to check open the maker's page. Update all does everything a package manager can do by itself.
- One calm row on the Fix-it List ("3 apps have security updates"), Check now, and Check App Updates in the palette.
- Off until you switch it on (Settings → Features → Computer); then one look a day, never while the screen is locked. Keeper never keeps a copy of anyone's app.

### Added — Cloud & Servers: open a connection as a drive
- Open as a Drive shows a cloud service or a WebDAV server in Finder, File Explorer or the file manager, so every app can open and save files there. Opened files are kept on this computer, and changes go out a few seconds after you close a file.
- The connection's page says how the drive is doing: up to date, sending changes, or can't reach it with changes waiting; the Island shows a ring while changes go out. Close Drive sends what waits first. Drives open again when Keeper starts.
- Keeper says plainly what your computer needs and never installs it: nothing extra on most Macs, WinFsp on Windows, FUSE 3 on Linux. SFTP, FTP and shared folders say why they are not drives. Off until you turn it on (Settings → Features).

### Added — Files: Side by Side, and tabs that keep your folder
- Side by Side shows two folders next to each other, each on this computer or on a cloud or server connection. Pick a place on either side, choose files, and Copy or Move them across (F5 and F6 work too); two folders here use the usual copy with its questions and Undo, and a move from a server only removes the original once the copy is done.
- Differences shows only what is not the same on both sides, folders inside included: only on one side, newer on one side, or the same date with another size. Untick what to leave out, pick a direction (or both ways, newer wins), see what will happen, then Sync. Nothing is ever deleted, and a replaced file on this computer goes to the Trash first.
- Open it from a folder's More menu, right-click a folder → Open Side by Side (in Files or on a connection), or the palette. Both sides belong to the tab, so they come back after a restart.
- ⌘T / Ctrl+T on a folder opens the same folder in a new tab, and right-click a folder → Open in New Tab.

### Added — Modes: one choice that shapes Keeper
- Pick a mode: Standard (as Keeper comes), Simple, Focus, Pro, Researcher, Creator, Writer or Family. Each sets which parts are on, text size, spacing, motion, how notices arrive, how much help you see and which sidebar sections show. Your files, notes, mail and accounts are never touched.
- Add to any mode: Low vision, Steady hands, Easier reading, Screen reader and Privacy-max. They stack: "Writer + Easier reading + Privacy-max".
- Every switch shows a preview first: what turns on and off, how it looks, how many sidebar sections stay. Then Switch or Cancel.
- You always win: what you change in a mode is kept for that mode and comes back when you return. Changed and Reset in Settings compare against the mode you are in, with Reset to Focus (or whichever mode) in one click.
- Switch from setup (a row of modes before the goal cards, which add to it), Settings → General → Mode, the palette ("Mode: Focus"), the tray's Mode menu or the small badge at the foot of the sidebar.
- Focus for a while: 25, 50 or 90 minutes over any mode. The focus timer runs, notices wait, the sidebar narrows and the badge counts down; it ends by itself and changes nothing saved.
- Big buttons on Today (Simple and Family's own part, there for anyone): find a file, free up space, write a mail, calendar, pictures and help.
- Offline check (Privacy-max's own part, there for anyone): every way Keeper could reach the internet, a switch for each, and Turn all off.
- Recommended is a shorter list: AI limits, AI usage and agents in the terminal are for Pro, and parts that follow another (Draw on screen with Stage) stay off until it is on.

### Added — PDF Reader: read, mark up, fill in and sign
- A calm PDF Reader (Notes section, or right-click a PDF → Open in PDF Reader): page thumbnails, find, zoom and dark pages for reading, with every tool in one floating bar.
- Highlight or underline selected text, add notes, draw freehand, type text boxes and sign (drawn or typed); fill in the PDF's own form fields; turn, remove, reorder and add pages from other PDFs. Undo steps back through all of it.
- Save writes it into the PDF as standard annotations any reader shows; the version from before is kept so More → Restore the last version can put it back. Save a copy asks where.

### Added — Archives: look inside, take out what you need, pack with a password
- A new Archives page (Tidy) opens zip, 7z, RAR, tar.gz, tar.xz, tar.zst, ISO and more without unpacking them: walk around by folder, find a name, Quick Look any file, then take out only what you tick, or everything, into a folder beside the archive.
- Make an archive packs files and folders into a ZIP or 7z; a password uses AES-256. Keeper opens password-protected ZIPs itself; protected 7z and RAR files need the free 7-Zip program, and Keeper says so.
- What works here lists, for your computer, how each kind opens and is made. Right-click an archive in Files → Open in Archives, or any files → Compress with a Password.

### Added — Meetings: your own notes, tidied with the transcript
- While a meeting is recorded, a notes pad sits beside the live transcript. Type a few words per point; headings start sections, “- [ ]” or @name makes an action item. It is saved as you type and kept with the meeting.
- Tidy my notes keeps every point in your words, adds when in the call it came up, fills short points out with what was said, and fills the sections you left empty (decisions, blockers, action items) from the transcript, each marked “from the call”. With an AI on this computer it writes them; otherwise plain rules do, and nothing leaves the computer.
- Templates for 1:1s, standups and interviews, picked from the calendar event’s title, plus your own (Meetings → Settings). Add to Reminders makes one reminder per action item, saying which meeting and event it came from, and never twice.

### Added — Today: one place that answers "what now?"
- Hello now opens on Today: what is on now and next (with Join for calls and the time left), your top three tasks to tick off, how many messages wait for your reply, what is in the Inbox, one thing to fix and a Focus button. Your folders and files follow under it.
- Light and Files only show a calm three cards, Recommended five, Everything all six. Edit Home → Today's cards picks your own; More (…) hides Today.
- Once you have seen Today, Mail's Today strip is one quiet line for the rest of the day, with a way back to Today and no second greeting.

### Added — Inbox: catch anything with one shortcut, sort it later
- Ctrl Alt J (⌘⌥J on a Mac) opens a small card over any app: type or dictate a thought, paste a link, take a screenshot of an area or drop a file, then Enter. It waits in the Inbox with the time. Also in the tray menu, the command palette and keeper://inbox.
- The Inbox page shows one thing at a time with five big choices on the keys 1 to 5: Task, Note (today's daily note), Event, Snippet or Delete, each with Undo.
- Kept on this computer only. Change the shortcut in Settings → General → Shortcuts.

### Added — Plan my day and Wrap up the day
- Plan my day: pick up to three tasks, say about how long each takes, and Keeper puts them into the free time between your events. Move a block 15 minutes either way, then Add to calendar.
- Each block is an ordinary event that links back to its task: tick it on Today and the task is done; the Island counts it down like any event.
- Wrap up the day moves what is left to tomorrow and, with the Journal on, adds one line to today's entry. The working day (9:00 to 17:30) is in Settings → General → Today.

### Fixed — Island: opened by a shortcut, it stays open
- The Island opened by a shortcut, the tray or another window (for example straight to its Calendar tab) no longer closes by itself after two seconds when the pointer is elsewhere; it closes when you move the pointer over it and away, or with Escape.

### Added — Design: a visual budget every page keeps to
- Every page now keeps to a calm budget: at most six tabs in view (the rest under More), at most five icon-only buttons in a toolbar, one filled button, no label or placeholder cut in the middle of a word and no raw folder paths. A test checks every page, every tab and every Settings section at two window sizes, in every build.
- Agents, Health, Privacy & Security's checks and Places & Tracks show six tabs and a More menu instead of a long row.
- Pages with a list of Connect or Fix buttons (Agents, Remote Desktops, the Fix-it List, Privacy & Security, permissions) keep them quiet, so the page's own main action stands out.
- Folders are named the way you name them ("Documents › Work", "Home") in Notes from Other Apps, Automations, Settings and security findings; startup items say which program they run. The full path is in the tooltip.

### Changed — Sidebar and top bar: calmer and clearer
- Disks no longer have a thin red bar under their name that looked like a spelling mistake. Point at a disk to see its free space; a disk that is nearly full keeps a small amber dot.
- Your home folder is always called Home, and the computer This Computer (This PC on Windows, its own name on a Mac). The real name is in the tooltip.
- "Connect a cloud or server…" no longer gets cut off: it is "Add cloud or server…".
- The top bar's bare icons are now two labelled buttons: Info (the Inspector) and View, with Open in New Window, Commands and the theme.
- The search box says "Search everything"; two example searches appear under it when you click into it.
- A folder's toolbar has New Folder, sort, view and More (Show Hidden Files, Tidy This Folder, Add to Sidebar, Show in Finder), instead of seven buttons.

### Changed — Empty pages that help
- Today's Top three card, when nothing is planned, shows a small Plan your day picture with Pick three tasks; Join on a meeting is an accent outline, so Plan my day stays the one filled button.
- Every empty list has the same designed look: a small picture in the theme's colours, a short title, one line, the one useful button and a tip. Backups, synced folders, mirrors, Remote Desktops, Cues, Mail accounts, AI Usage, the Inspector and a page that ran into a problem use it now.
- Settings no longer points to "Settings → Performance"; it is Battery and speed. The help under "Run parts in processes of their own" is one line, with the details under More.

### Fixed — Tests that failed on a busy computer
- The search speed test compares against a plain scan timed at the same moment, so a busy computer no longer fails it while a real slowdown still does.
- The usage stats test follows today's setup, and the accessibility test measures the light Island against its own light background.

### Changed — Setup: it starts with what you want Keeper for
- The second screen asks "What do you want Keeper for?" with eight picture cards: Find my files, Clean my computer, Mail & calendar, Notes, Record my screen, Stay focused, Keep it private and Help a family member. Pick up to three; their parts join the essentials picked for your computer. **Choose each part yourself** is still there.
- The last screen teaches one shortcut only: search from anywhere.
- For your first week, Home shows one short tip a day, starting with the goals you picked. Put a tip away with ×, or stop them all with **No more tips**.

### Added — About: Check Keeper and a problem report with nothing private in it
- Settings → About → **Check Keeper** shows a green or amber row for saving, disk space, the library, permissions, Keeper's helpers, downloaded parts, passwords and unexpected stops. Each amber row has a Fix.
- **Make a report…** saves a zip of Keeper's own notes, its settings and what the check found. Your home folder, names, e-mail addresses, keys and tokens are taken out, and you see every file before it is saved. Nothing is sent: attach it to an e-mail or an issue.

### Added — Fix-it List: a lighter Keeper over time
- A part you haven't opened for 30 days gets a gentle row on the Fix-it List: "You haven't opened Weather in 40 days", with what it does in the background and **Turn it off**. Undo turns it on again.
- Keeper counts which pages you open on this computer only; nothing is sent. Settings → Features → **Suggest turning off unused parts** stops the suggestions.

### Added — Help: a "?" on every page
- The **?** in the top bar (or F1) opens a sheet about the page you are on: what it is in one line, three things you can do there, and the page's own guide.
- The guides come with Keeper, so help works offline. Links to other guides open in the same sheet.
- Settings → General → **Show the Help button** hides the **?**; F1 still works.

### Added — Notifications: one calm place for every notice
- A bell in the top bar lists every notice from Keeper, grouped by part: Mail, reminders, Sites and servers, the Fix-it List, Privacy & Security, Health, updates and more. Click one to go to it; **Mark all done** and **Snooze all 1 h** are one click away.
- Settings → General → Notifications: each part tells you **Now**, **Batched** (one summary at 9, 13 and 17, or every hour) or **Silent** (only in the bell). Mail and monitors come now; the Fix-it List and updates are batched, out of the box.
- Quiet hours, and notices held while Keeper's focus timer runs. On GNOME, Keeper also follows Do Not Disturb. Alarms and a restart about to happen always come through.
- When the Island is off, notices show as the system's own notifications instead of being missed.

### Changed — Fix-it List: one calm list of things worth doing
- Home, Privacy & Security, Protection and the Fix-it List now share one list, in the same calm words: **Worth fixing**, **When you have time** and **Good to know**. Nothing is red any more.
- Privacy & Security starts with "3 things worth fixing" and those rows. The score is a small detail under it ("A few things to look at · Score 72 of 100"), and the engines, quarantine and last scan are under **How Keeper checks**.
- Each finding has one clear button (Fix, or Show me how) and a ⋯ menu for the rest. IDs and details are one click away under Details.
- Fix-it List rows show Fix and ⋯: Trust, Snooze for a day, a week or a month, and Ignore are in the menu.
- Home's line says "Free up space on Macintosh HD" instead of "nearly full", counts it once with the Fix-it List, and offers **See all**.

### Changed — Screenshots: today's Keeper everywhere
- Every picture in the README, the docs and the website is new, taken from today's Keeper in light and dark: Hello, Files with its sidebar and type chips, Everywhere, Network & firewall with the Ask prompt, the menu bar, Capture's preview, pins, scrolling captures and Draw on screen, a share link's page, Quick Search, clipboard sets, Typed Snippets, the selection bar, Focus blocking, Time tracking, Journal, Reader, Mail Today, page windows, light apps and app icons, Monitors, Phone Alerts, the photo editor, web page capture, the weather and the Island in several themes.
- They show sample files and names only, never a real computer's.

### Added — Website: try the Island on a little desktop
- Below the Island is a calm desktop: Keeper's wallpaper drifting, a clock that ticks, the weather and the week, a few files and a Dock of Keeper's app icons.
- Now and then a notice drops out of the Island: a download that then lands on the desktop, a message, a meeting. Music plays with a moving waveform.
- Pick Playful, Ocean, Sunset, Berry or Dark and the Island recolours, as in Settings. The hint is a small pill that fades once you've tried it.
- With less motion asked for, it stays still.

### Added — Website: what's new, and download links on Keeper's own address
- New sections for Hello, Files, Network & firewall, Capture & share, Focus & time, the launcher and typing, Journal and Reader, light apps, page windows, the Island in your colours, Monitors, Phone Alerts and the photo editor. The Features page shows every group with fresh pictures, and the theme switcher has twelve themes.
- Download buttons show keeper.ashforde.org/download/… and go straight to the file, then say what to do next. Each address also works on its own.
- The website is in British English.

### Added — Remote Desktops: Remote Desktop in a Keeper tab
- Remote Desktop (RDP) connections now open in a Keeper tab, like VNC, with nothing to install. The first time, Keeper downloads its small Remote Desktop engine (about 2 MB) from its own release and checks it before use; the tab shows the progress.
- The first connection to a computer shows its certificate (name, SHA-1 and SHA-256) to compare and trust. Keeper then trusts only that one for this connection, and asks again if it ever changes.
- In the tab: fit or real size, full screen, the remote desktop resizes with the tab, the clipboard works both ways, special keys (Ctrl+Alt+Del, the Windows key, Windows+L and more), the mouse, wheel and touchpad, Reconnect, and sign in again when a password is refused. Keys follow the remote computer's keyboard layout, or send the letters typed here.
- Network Level Authentication, user names with a domain (WORK\name), saved passwords from the keychain, and every way Keeper reaches a computer (SSH tunnel, proxy, Keeper Link, mesh) work in the tab.
- Each connection can still open in the outside app (Remote Desktop Connection, FreeRDP or the Mac's Remote Desktop app). A Remote Desktop Gateway, the admin session, all monitors and sharing your home folder open there by themselves, with the reason. If the engine cannot be downloaded, the outside app opens instead.
- Where it appears → **Remote Desktop in a Keeper tab** switches it off for all connections.

### Added — Knowledge Graph: everything you have, and how it connects
- The Knowledge Graph now holds your mail, the people in it, organisations, calendar events, tasks and projects, recorded meetings, places and saved pages, next to your files and notes. Every link says why it is there: “Lena Fischer was invited to “Lease viewing””, “lease.pdf came with “Lease renewal””.
- One person, however they are written: all the addresses on their card, “Fischer, Lena”, “L. Fischer”. Your own addresses never clutter it.
- Search a person or a topic and the graph focuses on them; the side panel shows what to do (open, email, show in folder, add to today's note), everything linked grouped by reason, and **Explain a connection** shows the chain of links between any two things.
- A timeline view, filters by kind and time, and a start card with the people and projects that link most. Big graphs stay smooth: the best-linked things are drawn and the rest are summed up.
- **Related** panels in Notes, Mail (the sender), the file inspector and the event editor show what the graph links to what you are looking at.
- Built and kept on this computer and nothing is sent anywhere. **What it includes** lets you switch off mail, events, tasks, contacts, meetings, places or saved pages, or leave out an account or a folder; parts that are off add nothing.
- The Assistant can answer “what do I have about Lena?” across mail, notes, files and the calendar, and cites each email or event so you can open it. Agents' graph tools cover every kind.

### Added — Search by meaning: mail, events, tasks, contacts and notes
- Search by meaning now also understands your mail, calendar events, tasks, contacts and notes outside your library, on this computer, in the same quiet background batches as your files. One search ranks every kind together.
- It follows the graph's choices: leave mail or an account out and it leaves the search too.

### Added — Mail: POP3 accounts and Exchange servers
- POP3 accounts: mail is downloaded to this computer, with a copy kept on the server unless you untick it; nothing is downloaded twice.
- An organisation's own Exchange server is found by itself, and its mail works when it offers IMAP. When it doesn't, Keeper says plainly what to ask your IT team instead of failing.

### Fixed — Mail: big mailboxes
- A mailbox of 50,000 messages opens in about a second and scrolls smoothly: the list draws a page at a time and fetches older mail from the server by itself when you reach the bottom.
- Mail you scrolled back to no longer disappears at the next check, and scrolling past the first few thousand messages no longer stops.
- Unread numbers are right for big inboxes and for the folder you have open.
- Searching the server with several words finds mail again, including older mail than what is kept on this computer.

### Added — Mail: signatures and how each account writes
- Rich signatures with your logo, links, fonts and colours, written in place. Several per address, with your choice for new mail, replies and forwards, and a picker in the compose window.
- Bring in the signature you already have from Gmail, Apple Mail, Outlook on Windows or Thunderbird.
- Logos go out attached to the message, so they show without "load pictures"; signatures are cleaned of anything unsafe.
- Per account: font, size and colour, rich or plain text, your answer above or below the quote, Reply answering everyone, and forwards keeping their attachments.
- An alias can send through its own outgoing server, with its password in your keychain.

### Changed — Mail: safer connections
- Mail only connects without encryption to a server on this computer. A server with a certificate problem is refused with a plain explanation of what is wrong instead of a cryptic error; the "self-signed" box stays off unless you tick it.

### Added — Calendar: events open their links and files
- An event shows Join for its meeting, Open in Maps and Directions for its place, and its links and attached files, each opening in your own browser or app. Attachments in .ics files now come along on import and export.
- "On this computer" can be chosen again as an event's calendar.

### Added — Mail, Calendar, Reminders and Contacts: import and export
- One Import in Mail, Calendar, Reminders and Settings → Mail & Calendar, the same four steps everywhere: choose where from, read the short steps, watch it come in (with Stop), then a one-line summary with Undo.
- Mail from .mbox files (also a web mail's whole download, sorted into Inbox, Sent and your labels), .eml files and folders, Apple Mail on a Mac, Thunderbird profiles (found by themselves) and Outlook for Mac archives (.olm), with folders, read and flagged marks and attachments. It lands in a new "On this computer" account you can search, read, file and reply from.
- Calendars from .ics files into a calendar of their own, with repeats, moved occurrences, time zones, all-day events, alerts and guests.
- Tasks from Apple Reminders, Google Tasks, Microsoft To Do, Todoist (a file or your token, used once), any spreadsheet and .ics; lists become tags and sub-tasks become steps.
- Contacts from .vcf cards (old and new) and spreadsheets.
- Export a mail folder or a whole account as .mbox or .eml files (right-click it), a calendar as .ics, tasks as .csv or .ics and contacts as .vcf or .csv.
- Anything already there is skipped, and every import can be taken back later from Past imports.

### Changed — Mail, Calendar and Reminders: first screens
- With nothing set up yet, Mail, Calendar and Reminders open on a calm, drawn screen with one clear way in. Mail has a button for Gmail, Outlook, iCloud, Yahoo, Fastmail and Other that starts that provider's own setup, and "Import mail from another app".

### Added — Mail: combined mailboxes
- Combine any accounts' inboxes or folders into one list of your own (for example your two work inboxes), with its unread number, next to All inboxes.

### Added — Island: colours that follow your theme
- The Island is no longer only black. Open, it shows a soft gradient made from your theme's colours, with matching text, buttons and cards. Light themes get a light Island; every theme gets its own.
- What is going on tints it: the colours of the album art while music plays, the calendar's colour before a meeting, orange for a timer, green while charging. It glides to the new colour (at once with less motion).
- On a Mac with a notch, the closed Island stays the notch's black so it blends in, with a thin glowing edge and coloured icons; it opens into the colours. Elsewhere the closed pill is in the colours too.
- Settings → Island → Look: Match theme (the default), Dark, or Colourful with six bright gradients; Subtle or Bold; and an accent colour. A preview shows how it looks, also while music plays, a meeting is next, a timer runs or it charges.
- Text stays easy to read in every theme and look: Keeper checks it on every part of the Island's background.

### Added — Notes: mind maps
- **Map** (next to Live, Source and Read) shows any note as a mind map: its title in the centre, its headings and lists as branches.
- Tab adds a branch under, Enter one beside, F2 or just typing renames, Delete removes, Space folds, arrow keys move around, and Ctrl+Z undoes. Drag a branch onto another to move it there, or just above or below one to reorder.
- Every change is written into the note's Markdown. Paragraphs, tables and code stay with the branch they belong to.
- Branches on both sides, or all to the right like an outline. Save the map as PNG or SVG.
- **New mind map** (under More) starts a note that opens as a map. Smooth with hundreds of branches.

### Added — Notes: import from other apps, and export
- **Import notes** (in the vault menu, and on an empty page): pick the app, follow two or three plain steps, see how many notes will come in, then watch the progress. At the end you see what came in and what was left out, and why. **Undo** takes it back, and leaves alone any note you changed since.
- Reads Evernote (.enex), Joplin (.jex, a sync folder, or Joplin while it runs), Standard Notes backups (encrypted ones are opened on this computer), Notesnook, Google Keep (Takeout folder or .zip), Simplenote, Bear exports, Apple Notes saved as files, Samsung Notes, Notion, OneNote, Markdown vaults from other notes apps, and on a Mac, Apple Notes and Bear directly.
- Notebooks become folders. Tags, dates, checklists, tables, pictures and files come along, and links between the imported notes become [[links]]. Nothing is ever overwritten; each import gets its own folder.
- Thousands of notes import in seconds with a progress bar and Cancel, and the page keeps working meanwhile.
- **Export**: the notes as a Markdown folder with their pictures (with plain links for apps that need them), the whole vault as a .zip, an Evernote .enex, or one note as a web page or a PDF.
- Fixed: checklists in Evernote notes came in as plain lines; they are checklists again.

### Changed — Notes: a calmer page
- Notes is now three rounded panels with the same gap between them: your notes, the open note, and links and outline.
- The notes list has one header: the vault, a search box, New, and More for folders, canvases, bases and sorting. The separate strip of icons is gone. Files, Tags, Bookmarks and Recent are labelled.
- Each note shows its name once, in its tab. Live, Source and Read sit in the same row, with More for slides, earlier versions, publishing and recording.
- The text sits in a centred column of comfortable width, with its properties lined up above it in a neat grid.
- Links and outline open from a button in the note's header. Sections have headings with counts. The panel is closed at first on smaller windows, floats over the note there instead of squeezing it, and remembers what you chose.
- A designed first page, an empty page with the one next step, and helpful notes when a list is empty. Light and dark, every button named for screen readers.

### Changed — Hello
- Keeper's start page is called **Hello** (it was Home), so it is never mixed up with your home folder, which is now simply Home again on Linux.

### Added — App icons: Keeper Mail, Keeper Notes and the others run as light apps
- Open Keeper Mail, Keeper Calendar or Keeper Notes while Keeper is closed and only that part starts: no library, Island, widgets, menu bar icon, monitor, sync or AI. Keeper Mail and Keeper Notes use about a third of Keeper's memory, and almost no processor while idle.
- Six more app icons: Keeper Reminders, Keeper Planner, Keeper Files, Keeper Studio, Keeper Terminal and Keeper Remote Desktops. Add any of them in Settings → Features → App icons with one switch each.
- Each has its own name and icon in the Dock or taskbar (on Windows and Linux its windows group under its own icon).
- Open a second app icon and it joins the same light app. Open Keeper itself and it takes over the same windows; nothing runs twice.
- With Keeper already open, an app icon just opens its page in a window of Keeper's.
- Open Keeper is one click away in each light app's top bar. Prefer all of Keeper? Switch off "Start only what they need".
- Same settings, accounts, passwords and updates as Keeper; one installer.

### Changed — Typed Snippets: a calmer page where your snippets come first
- The page opens on your snippets: each shows its short code, the start of its text and how often you used it. Find one with the search, sort by most used or A to Z.
- New snippet is one button. It opens a side panel with a live preview and chips that add the date, the time, the clipboard or where the cursor lands.
- A small pill in the corner says Listening, or Not listening with the steps to fix it.
- Import, Export to CSV and the apps left out are under More.
- With no snippets yet, the page shows three ready ones you can add in one click.
- Remove a snippet and Undo brings it back. Keys: N for new, / to search, Delete to remove.

### Added — Network & firewall: every app's connections live, and a network part in the menu bar
- Privacy & Security → Network & firewall opens on Live: every app with the places it is talking to right now, grouped by app and then by site, with the site's name, its country flag (when the country table is downloaded), the port, how fast it is receiving and sending, and a small line of the last minute.
- Search by app, site, country or port (press /), and show All, Active, Blocked or New today, each with a count.
- Pick an app to see it on the right: what it receives and sends, and what it may do: Follow rules, Allow, Ask or Block, for an hour, until Keeper quits or always, on every network or only at Home, Work or on Public Wi-Fi. Each site it reaches has its own Allow and Block. Follow rules undoes an answer.
- New profiles: Home, Work and Public Wi-Fi, and "Use the network I'm on" ties one to your Wi-Fi so it switches by itself.
- A calm prompt when an app connects somewhere new: one per app with every place it wants to reach, who signed it and why it may be connecting, with Deny, Allow once and Allow, and how long and how widely to remember. It waits a moment to gather prompts, waits while you type, and opens in a small window in the corner without taking the keyboard. Later puts it away; it waits on the page.
- History shows a day, a week or a month per app: data used, received and sent, the apps and the top places, and saves as CSV.
- Where data goes: how many places your data went to today, in 7 or 30 days, and for each app its top sites and how often it reached them. No map, just the facts.
- On a Mac, Keeper watches every app without asking for anything; blocking single apps waits for Apple's approval of Keeper's network filter, and the page says so instead of showing buttons that would do nothing. The DNS filter can still block a site for every app.
- The menu bar's summary has a Network part: "3 apps online" with the speeds and a small chart, the three busiest apps with a quick Block (and Allow to undo), "2 waiting" when prompts wait, and Open Network. Settings → Menu bar → Show network turns it off. On a short screen the summary folds the downloads, then the app list, so it still never scrolls.

### Added — Privacy: crash reports, if you want to help
- Settings → Privacy → Send crash reports: when something goes wrong in Keeper, an anonymous report helps Ashforde fix it. Off until you switch it on.
- A report says which Keeper and which kind of computer, the kind of error and where in Keeper's code it happened. Never the error's message, your folders, files, names or an ID.
- Reports wait and go together, at most every 30 minutes. See what's sent shows exactly what waits and what went, and switching off deletes what was waiting.

### Added — Photo editor
- Right-click any picture → Edit Photo (or Edit in Capture): crop to a shape, straighten, turn and flip, and set light, contrast, colour and warmth.
- Drag over a face, a name or a number to blur, pixelate or cover it.
- Resize and change the format, remove the background on this computer, or open the screenshot editor to add arrows and text.
- Your original is kept: reopen a picture and the sliders are where you left them, and Revert brings the original back. Save a copy puts the edit beside it.

### Added — Capture: a whole web page
- Capture → Capture a web page: paste an address and get the whole page, top to bottom, as one picture or a PDF, without opening your browser.
- See it as a desktop or a phone shows it, or make a 1200 × 630 social image for link previews.
- Keeper closes simple cookie banners for you (choosing "only necessary" where it can) and scrolls through first so pictures that load late are there.
- It opens in a private window that keeps nothing; the file goes to your Screenshots folder and Capture's history.

### Added — Monitors: your sites and servers
- A Monitors page in the Computer section (switch it on in Settings → Features) checks your websites, ports, servers (ping) and DNS names on a schedule you choose for each.
- For websites it can also look for a word on the page and warn you before the certificate expires.
- See each one's uptime for today, the week and the month, its response times over the last day and its last checks.
- When one goes down (two failed checks in a row) or comes back, the Island tells you, and Phone Alerts can tell your phone.
- Add them one by one or import a plain list; copy your list back out the same way. Nothing runs until you add one.

### Added — Phone Alerts
- A Phone Alerts page in the Devices section (switch it on in Settings → Features) sends Keeper's alerts to your phone: through the free ntfy app, your own Telegram bot, an e-mail from one of your Mail accounts, or a web address of yours.
- Choose for each one what it gets: site and server checks, backups, automations, focus and time, the Fix-it List. Send a test from its card and see when the last alert arrived.
- Alerts that come close together arrive as one message, problems first. Tokens stay in your computer's keychain, never in Keeper's settings.

### Changed — Weather: forecasts from MET Norway
- Forecasts now come from MET Norway (the Norwegian Meteorological Institute), which is free for everyone to use. The Weather page credits them under every forecast.
- Everything on the Weather page, in the Island, the widget and the menu bar works as before: hours, ten days, rain soon, sunrise and sunset, UV and wind.
- Prefer Open-Meteo? Choose it in Settings → General → Weather → Forecasts from (under More settings).
- Keeper asks for a forecast only when the last one has expired, as MET asks, so it uses the network less.

### Changed — Menu bar: a calmer, smaller summary under the owl
- The summary under the owl in the menu bar (the tray on Windows and Linux) is cleaner and never scrolls: its window is as tall as what it shows and fits its width exactly.
- At the top: Keeper and one line that says "All good", or the one thing that needs you (a nearly full disk, no internet, a low battery, an AI limit running out). Click it to go there.
- Weather, disk, this computer and the network are four tiles of the same size with short values that never wrap ("96 GB free", "↓34 ↑2 KB/s") and one thin bar where there is an amount.
- Keep Awake is a switch you can flip without leaving the summary.
- Four quick actions of the same size; the others are under More. Edit picks the four in Settings.
- Recent downloads: three files with an icon, the size, and long names cut in the middle so the start and the type stay readable. "See all" is easy to see.
- Open Keeper is the main button at the bottom, with Settings and Quit lined up beside it.
- Settings → Menu bar can hide the readings, the quick actions or the downloads. The tip is now off unless you turn it on.
- Works by keyboard (arrows, Enter, Escape folds More, then closes), in light and dark, and stands still for people who ask for less motion.

### Added — Website: devices that move, and one calm layout everywhere
- The laptop on the home page opens as the page loads: the lid lifts, the screen lights up, Keeper fades in and the Island drops from the notch. It leans a little towards your pointer.
- In the lid demo the little Mac's lid really closes and opens, its screen shows who is in charge, and a soft glow shows who keeps it awake.
- The theme picker and Build your Keeper play as slideshows in a monitor, with a Pause button.
- The Island breathes softly while closed and settles in as it opens; its battery fills. Small touches: steam over the Keep Awake cup, Wi-Fi and Bluetooth in the menu bar.
- A floating top bar with one Download button, bigger headlines with one marked phrase, a short statement that lights up as you scroll, and Build your Keeper as an app with three panels.
- Every page shares one width, one spacing scale, one set of corners, and evenly balanced rows of cards, checked at four screen widths in light and dark.
- None of it moves for people who ask for less motion.

### Added — Keeper Pro: built in and switched off
- Nothing changes for anyone: Keeper stays free, with no new page, badge, upgrade message or connection.
- Everything Keeper has, and everything added up to the version in which Pro is ever switched on, stays free for everyone, forever.

### Added — Website: a new home page, features page and Keeper + Monorail page
- The home page tells Keeper's story in pictures: Keeper in a laptop with the Island dropping from the notch, then short sections with real screenshots in light and dark.
- Build your Keeper: switch parts on and off and see a preview, the rough download size and what keeps running.
- Try the Island: a working Island under a notch, with music, a focus timer, the next meeting and the battery. Hover, click or tap it.
- A search demo with ready-made searches, a light and dark slider, a theme picker and a price comparison by kind of app ("Keeper: free").
- The features page shows every group of parts as in Settings, with screenshots and a side menu that follows you down the page.
- The Keeper + Monorail page shows what each app does, a diagram of how they talk on your Mac, a lid demo you can play and three steps to set them up.
- The download page picks the file for your computer at the top; each system has its own card.
- Every page has its own preview picture for links shared in chats and social apps.
- Everything works by keyboard and touch, reads well without scripts, and stands still for people who ask for less motion.

### Changed — Website
- Shorter words everywhere, no version badges, and only finished versions in the changelog and the download links.

### Added — Files: one obvious place for your files
- The sidebar lists real places only, laid out like your system's file manager: Finder's Favorites, Locations and Tags on a Mac; Home, Gallery, OneDrive, Quick access and This PC on Windows; GNOME Files' or Dolphin's lists on Linux, with your bookmarks. Keeper's Home stays first.
- "Documents" in the sidebar is the folder, nothing else. The Library section (All Documents, All Images…), Browse and Download Sources have left the sidebar.
- Every file list has "By type" chips with counts: Documents, Pictures, Videos, Music, Archives, Installers, Apps, Screenshots and From the web. They work in any folder (and the folders inside it) and Everywhere. All Documents is now Everywhere + Documents, with the same sorting, grouping by folder and views.
- From the web replaces Download Sources; the sites and apps files came from are chips under it.
- Home is the front door: Desktop, Documents and Downloads as big tiles with how much is in each, then your recent files, then a search box with the types under it.
- Disks and servers come and go as they connect, with how full they are and Eject. A server that drops stays listed as Offline until it is back; a click connects again, Forget removes it. Keeper's cloud and server connections sit in Locations with their status.
- Settings → Sidebar → More settings → Find by type in the sidebar adds a folded section with the types, for those who want them there.
- Old links, tabs, the command palette and keeper:// links to the old pages still open the right view. Pinned folders, places you removed, saved searches and tags are kept.
- Sorting by name in a type list now goes A to Z (it went Z to A).

### Added — Any page in a window of its own
- Every page can open in a window of its own: the window button in the top bar, right-click a page in the sidebar → Open in New Window, the command palette (Open Mail in New Window, or a page's name and "in New Window"), Window → New Window for This Page, or ⌥⌘N (Ctrl+Alt+N on Windows and Linux).
- The window shows just that page, with its name in the top bar and in its title ("Mail — Keeper"), and no sidebar or tabs. It has the same frame as the main window.
- Asking for a page that already has a window brings that window to the front instead of opening another.
- Each page's window opens where it was last time, moved back onto a screen when that screen is gone.
- Closing a page window never quits Keeper. On a Mac, page windows are listed in the Dock's menu and the Window menu.
- While a Keeper window is in front, ⌥⌘N opens the page in a window of its own; everywhere else it is still the Island's New task.
- In Notes, Ctrl+Alt+N no longer also makes a new note.
- Keeper opens a page in its own window when started with `--keeper-open=mail` or given the link `keeper://open/mail` (any of Keeper's pages; anything else is ignored). Started this way, Keeper shows only that page's window.

### Added — App icons for Mail, Calendar and Notes
- Settings → Features → App icons adds Keeper Mail, Keeper Calendar and Keeper Notes to Applications on a Mac, the Start menu on Windows or the app menu on Linux, each with its own icon. Remove takes away only what Keeper added.
- Opening one shows just its page in a window of its own. When Keeper is not running it starts without the main window. They use Keeper's settings, accounts and updates.
- Uninstalling Keeper on Windows removes the Start menu icons it added.

### Added — Quick Search: open apps, do sums and run commands
- Quick Search opens apps: those in Applications on a Mac, the Start menu (and Store apps) on Windows, and installed apps on Linux. Enter opens one; ⌘ or Ctrl+Enter shows it in its folder. What you open often and lately comes first.
- Type a sum (12*(3+4), 2^10, 15% of 80, 120 + 15%) or a conversion (5 ft in cm, 72f to c) and the answer is the first row; Enter copies it. Currencies convert with the European Central Bank's daily rates once you turn that on in Settings → General → Quick Search; until then nothing is downloaded.
- Saved links: a word and an address, so “map berlin” opens the map with Berlin filled in. A few come ready; change them in Settings → General → Quick Search.
- Your own commands: give a command line a name and a word, and run it from Quick Search. Keeper shows exactly what will run and asks first (unless you tell it not to for that command); what it prints can be shown or copied.
- Keeper's own actions are commands too: screenshots, recording, keep awake, Stage, dictation, focus, locking folders, Wi-Fi and Bluetooth, the clipboard picker.
- Quick Search's window is made again after it closes, so its shortcut keeps working after Esc.

### Added — Clipboard: sets and pasting one by one
- Sets in the clipboard picker: chips above the list for your named lists (Addresses, Replies…). ⌘S / Ctrl+S or right-click files a clip in a set or starts a new one.
- Paste one by one: line clips up with Space, paste a whole set, or collect what you copy next. Each paste takes the next one, the Island shows “3 left” with Paste next and Stop, and ⌘⌥V / Ctrl+Alt+V pastes the next one while a queue runs.
- Paste as plain text: from Quick Search, or with a shortcut you choose in Settings → Island; the formatting comes back for the next paste.
- Never keep copies from an app: a list in Settings → Island → Clipboard, and on any clip in the picker (which also forgets what was kept from it).

### Added — Typed snippets
- Type a short abbreviation such as ;addr in any app and it becomes your saved text. Placeholders fill in today's date (or one a week from now), the time, the weekday and what you copied, and put the cursor where you want it.
- One list with Dictation's spoken snippets: a snippet can be typed, said, or both. Import from a CSV file. Password fields and apps you list (password managers by default) are left alone.
- A new page, Desktop → Typed Snippets, says plainly whether Keeper can listen to the keyboard on this computer and what to do if not (Input Monitoring on a Mac; the “input” group on Linux Wayland). Off until you turn it on; with no typed snippets nothing runs.

### Added — Actions for selected text
- Select text in any app and press ⌘⇧1 / Ctrl+Shift+1: a small bar beside the pointer offers Copy, Search, Translate, Rewrite, Define, Open link and Write to. Translate, Rewrite and Define use the AI you chose in Keeper (which can run on this computer) and only when you press them; results come with Copy and Replace.
- Choose the buttons, the language to translate into and the search address in Settings → AI → Actions for selected text. Off until you turn it on.

### Added — Reader
- A Reader page in the Notes section (switch it on in Settings → Features): follow a site by pasting its address (Keeper finds its feed; RSS, Atom and JSON Feed), see unread counts per feed and folder, star articles, and mark all read.
- Articles open in a calm, clean view; when a feed gives only a summary, Keeper reads the article's page and keeps just the article, without menus, sidebars or comments.
- Save any web page for later, from the Reader or from your browser's right-click menu with Keeper's extension; saved and opened articles read offline.
- Import and export your feeds as OPML, with their folders.
- Only the feeds and pages you add are fetched, every hour by default (slower when you are away, never while the screen is locked), and Keeper's firewall rules apply to them.

### Added — Notes: Journal
- A Journal page in the Notes section (switch it on in Settings → Features) keeps one entry a day as an ordinary Markdown note: Start makes a Journal vault in Documents, or you choose one of your vaults.
- Each entry has a mood, your words (saved as you type), photos you add or pick from the ones you took that day, and, if you switch them on, the weather and where you were from Weather and Places & Tracks.
- A month calendar marks the days you wrote, a streak counts the days in a row, and On this day shows what you wrote on the same day in earlier years.

### Added — Time Tracking
- A new Time Tracking page (Computer section; off until you switch it on yourself) records which app, document and website you use and for how long, only on this computer and encrypted with a key in the system keychain.
- Day view: a timeline coloured by project and totals by project, app, site and document; Week view: each day as bars by project. Go back day by day or week by week.
- Projects come from your own rules ("the site contains client.example", "the window title contains proposal"), and apply to days already recorded.
- Export any day or week as CSV for a timesheet or an invoice.
- Pause for an hour or until you resume; time stops counting when nobody is at the computer or the screen is locked; password managers and anything you add are never recorded; window titles and websites can be left out; old days are deleted after the time you choose; Delete everything removes it all.

### Added — Focus Blocking
- A new Focus Blocking page (Computer section; switch it on in Settings → Features) keeps chosen sites and apps out of reach while a Focus session runs, on a schedule (days and hours, also past midnight), or for 30 minutes, an hour or two by hand. Starter lists for social sites, news, and video and games can be changed or replaced.
- In browsers with Keeper's extension a blocked site shows a calm page instead, with the time the block ends; pages already open move to it. With the firewall's DNS filter on, the same sites are blocked for every other app too, and the query log says Focus blocking stopped them.
- A blocked app that comes to the front gets a small Keeper window over it with Close, Let me in and Not now; or Keeper closes it for you if you choose.
- "Let me in for 5 minutes" waits a few seconds and asks once more before it opens one site or app; the length and the pause are in Settings.
- Strict mode (in Settings, or for one block) takes away short visits and Stop until the block ends; it says plainly that quitting Keeper or an administrator can still end it.
- The page shows why something is blocked, until when, and how many times today a site or app was stopped; the Island says when blocking starts and ends. The palette has Block Distractions for an Hour.

### Added — Studio: Upload and copy link
- Export has a second destination, **Upload and copy link**: the video is saved as always, then uploaded to your own storage (the WebDAV server or storage bucket set in Island settings → Upload & share) with a small page to watch it, and the page's link is copied. Nothing goes to a Keeper or Ashforde server.
- The page has the player, the project's chapters and captions, a transcript that jumps to each moment, and a Download button; it follows light and dark and loads nothing from elsewhere.
- Choose how long the link works: 1, 3 or 7 days on a storage bucket (the links stop working), or no end, 1, 7 or 30 days on WebDAV (the page then says the link has ended).
- The Island shows "Uploading" with progress, then "Link copied". A finished export can be uploaded later with **Upload and copy link**.

### Added — Capture: scrolling capture, pinned pictures, a preview after each screenshot
- **Scrolling**: drag over the part of a window that scrolls; Keeper scrolls it step by step and joins the frames where they overlap into one tall picture. A Stop bar (or Esc) ends it early. Needs Accessibility on a Mac and xdotool on Linux X11.
- **Preview after each screenshot**: a card in the corner to drag into any app, or Annotate, Copy, Save, Upload (copies a link to your own storage) and Pin. Several stack; it goes after 8 seconds unless you point at it (Capture → Options).
- **Pin on screen**: a picture floating over every app; drag and resize it, set its opacity (− +, or keys 1–0), let clicks go through it (⌘⌥⇧P / Ctrl+Alt+Shift+P makes it clickable again), copy it, and close it with Esc.
- **Self-timer**: 3, 5 or 10 seconds, with a countdown on screen; an area or window is chosen first.
- **Window with shadow**: window screenshots get a soft shadow on a see-through background (Capture → Options → Shadow around windows).

### Added — Stage: Draw on screen
- ⌘⌥⇧D / Ctrl+Alt+Shift+D lays a see-through sheet over every screen: pen, highlighter, arrow, box and a spotlight, six colours (keys 1–6), three line widths, Undo, Clear, a white or black board, and ink that fades by itself.
- Esc, Done or the shortcut again ends it and clears the ink. Its settings are on the Stage page; it is also in the tray's Stage menu and the command palette, and screen recordings pick the ink up.

### Added — Mail: Today at the top of the inbox
- The inbox opens with a greeting for the time of day and your first name (from the name you send mail as; with none, no name), today's date, and today's events as cards from every calendar Keeper reads: time, title, the calendar's colour, "Now · until 6:45 PM" on the one going on, "Next" on the one after, and Join for Zoom, Google Meet, Teams, Webex, FaceTime, Jitsi and Whereby links. Join opens the meeting in your default app. The cards scroll sideways and can be reached with the keyboard; with no events the row is hidden, and a narrow window shows one "Now: …" or "Next: …" line.
- While Mail is open, the bar at the top of the window shows the meeting going on, or the next one within 15 minutes, with Join.
- Filter chips under the search box: Inbox with its unread number, Primary, and icon chips for Updates, Promotions, Security, To Reply, Flagged and Attachments, each with its name and a tooltip. The chosen chip is marked.
- A column of accounts beside the folders: All inboxes, each account's picture or initials (a colour that stays the same for its address) with its unread number, and + to add an account.
- Labels in the folder list, each with its own colour and count; a label shows its mail from every folder.
- The message list is grouped under Today, Yesterday, Past week and Older, with "12 min" and "3 h" for the last day, then clock times, then dates.
- In lists that mix accounts, a row's account is a short bar in its colour on the right edge, named for screen readers and shown only when you have more than one account, so it is not mistaken for the unread dot on the left.
- "Updated 2 minutes ago" at the foot of the list, from when mail was last checked; click it to check now.
- New message shows its key: ⌘N on a Mac, Ctrl+N elsewhere (now in every shortcut set), or your own.
- Settings → Mail & Calendar → Show today at the top of the inbox turns the greeting, the events and the meeting chip off.

### Fixed — Mail
- With Appearance set to Dark on a computer in light mode (or the other way round), plain-text mail was drawn in the wrong colour and could not be read; it now follows Keeper's own choice.

### Changed — Release: each Mac app is sent to Apple for notarization once
- A Developer ID build sends each app to Apple once and keeps the submission ID. A dropped connection while waiting is retried without sending the app again, and packaging is no longer repeated when the network drops (that sent another copy to Apple each time).
- A re-run of a Mac job, after Apple took longer than the job may wait, waits on the same submission with the app that was sent, instead of sending a new one. The IDs are in each job's log and summary, kept in the actions cache and attached to the run.
- The Mac jobs wait up to 300 minutes for Apple by default (*notary_budget_minutes*, at most 330) and stop at 350. An app Apple finds Invalid fails the job with Apple's log and is never sent again.
- The offline installer gets its own single submission, or reuses the standard one when its app is byte for byte the same.
- RELEASING.md → Notarization explains how the IDs are kept, what a re-run does, and how to look them up with `xcrun notarytool history` and `info`.

## [1.0.0] - 2026-11-03

The first release of Keeper by Ashforde®. Signed and notarized by Apple, so it opens like any other Mac app.

### Changed — Fix-it List: details, Trust and fewer false alarms
- Each row opens (click it, its arrow, or Enter) to show exactly what was found, gathered only then: for things that start at login the file, its label, the program and arguments, RunAtLoad/KeepAlive, the file's contents, who signed the program (Developer ID name, team, notarized; Authenticode publisher on Windows; owning package on Linux), its hash and when it appeared; for extensions the name, version, ID, profile, store link and each permission in plain words; for certificates the subject, issuer, validity, fingerprints and keychain or store. Each says why it is listed, how sure Keeper is, and links to more.
- Every row has Trust, Snooze (1 day, 1 week, 1 month), More (Ignore, Show in Finder/Explorer, open the browser's page for an extension) and Fix. Trust remembers the exact item by a fingerprint (path, what it runs and its signer or hash; extension ID, version and permissions; certificate fingerprint): it stays hidden across restarts and comes back, marked "changed", when the item changes. Home's Trust is the same Trust.
- "Snoozed, ignored and trusted" lists trusted items too, with Stop trusting and Undo. Select several rows to Trust or Snooze them together. Similar findings are shown together ("4 browser extensions with broad access", "3 certificates were added…").
- Fix says exactly what it will do and can be undone: Turn it off stops a login item and moves its file to the Trash, keeping a copy that Undo puts back; Remove it deletes an added certificate after keeping a copy; for extensions Keeper opens the browser at the extension, where you press Remove.
- Things that start at login are recognised from a table of common tools (a GitHub Actions runner such as "GitHub Actions runner for ashfordeOU/arksa", Docker, Homebrew services, Tailscale, 1Password, Google and Microsoft updaters and more). Ones signed by their maker, or by any developer, are Low and say who made them; unknown ones read "Something new runs at login", never "malware".
- Severity badges say Low, Worth a look or Important (same colours).

### Fixed — Fix-it List
- Extensions named through `__MSG_…__` showed their ID; their real name is now read from the extension's `_locales`.
- Everything already set to start at login when Keeper first looked was listed as new for a week; only what appears or changes afterwards is.
- Undo after a fix that made its finding go away said "This has no automatic fix".
- Each added certificate is its own row (with its SHA-1/SHA-256), so one can be trusted or removed without the others.

### Changed — The Island: power, and opening while something shows
- Power: one battery glyph with its percentage in tabular figures, filled to the charge: green while charging, yellow in Low Power Mode, red when low. Plugging in or unplugging shows "Charging 84%" or "On battery 100%" for 3 seconds, then the Island goes back to what it showed. On battery by itself shows nothing, unless you turn on Settings → Island → "Always show battery", or the battery is at 20% or less.
- Words beside the notch are shown whole or not at all: a label that does not fit leaves the icon and the number (before, "On battery" was cut to "On b…" and stayed).
- Opening the Island (hover, click, tap, swipe, Enter, the bubble) always shows the whole Island with its deck and More. What is going on (Keep Awake, a recording, a call, a reminder, a meeting, a notification or mail, a plug-in notice) shows as a banner at the top with its buttons; click it for the full view. Before, a small card with no way to the rest opened instead.
- New setting "Open into": the live activity's own view (default: a timer opens Timer, music Home, an agent Agents; anything else Home), Home, or the view used last (Home after 10 minutes).
- A notice that drops down by itself (Alerts: as a banner) is still the small card; a click on it opens the whole Island.
- The closed Island: real album art beside the notch and a waveform in the artwork's colour, flat while paused; paused music leaves after 2 minutes; a timer's last 10 seconds pulse; files on the shelf show as a small count when nothing else is going on.

### Fixed
- The Island: an alert could stay in the wings for good when Keeper's state changed while it showed (a battery or music check reset its timer).

## [0.1.0-beta.8] - 2026-11-03

The release candidate for 1.0: Keeper as a suite (the Island, widgets and Mail in their own processes), a new first run with fewer parts on, a redesigned Island, Home, sidebar and two-pane Settings, Studio, Mail on a par with the best Mac mail apps, copy and move in the file manager, one search for everything, smaller downloads with parts fetched when switched on, and the bridge to the Developer ID: this version also accepts updates signed with Ashforde's Apple Developer ID (team D69G45342Y), which 1.0.0 will be.

### Added — Mail
- Narrow windows: below 900 px a clicked message takes the list's place, with Back (before, nothing showed).
- Inbox tabs All, Primary, Updates and Promos with unread counts; Unread toggle; To Reply; smart mailboxes (saved searches).
- ⌘1–⌘9 switch accounts; each account has a colour, a picture, its unread count, Classic or Chat reading, and a notch switch.
- Send-from addresses with their own signature and Reply-To; signatures optional on replies and removable per message.
- Setup guides for Gmail, Outlook, iCloud, Yahoo, AOL, Fastmail, Zoho and any IMAP provider, with the app-password pages.
- Rules on sender, recipients, subject, text, attachments and mailing list (all or any) that move, archive, mark read, flag, label or delete as mail arrives; also written to the server as Sieve (ManageSieve) or Gmail filters.
- ⌘K search with from: to: subject: has:attachment is:unread in: label: before: after:, this computer first, then the servers; Save as a smart mailbox.
- Remind me if no reply (a day, three days, a week, a date); mute a conversation; block a sender; Report spam.
- Invitation cards add Add to Calendar.
- Phishing warnings (look-alike domains, a contact's or a company's name on a stranger's address, replies elsewhere, links that lie, failed DMARC) with Report spam and Block.
- Tracking parameters taken off links; Load images (⇧⌘I); the connections Mail makes listed in Settings; read receipts never sent.
- Sign-in codes get Copy code and magic links Open link, in notifications and the Island; the Island counts down Undo send.
- Quick Look for attachments, Print, Save as PDF; sender pictures from contacts; designed mail on a light card in dark mode (or darkened); text size ⌘+ / ⌘−; list density.
- Rich-text compose (bold, italic, lists, sizes, links), templates, drafts saved to the server's Drafts, ⌘J tones and your own instruction streamed in, an editable list of what the AI remembers, Ask answers citing their messages.
- ⌘Z undoes archive, delete and move; snooze shared with your other computers (IMAP keyword or a hidden folder); catch-up after sleep or a network change; Dock badge (all, Important, none).
- Unread, Inbox and Mail accounts widgets; Email button on the Island's shelf for files dropped on the notch.
- AI apps: Add to Claude desktop, Claude Code, Cursor or Codex from Mail settings; tidy (archive, label, move) with your approval per batch; prepared messages open in Keeper and go only when you press Send.

### Changed — Ready for Apple Developer ID builds on macOS
- Updates on a Mac accept a new version signed like the installed copy or, the one bridge, signed with Ashforde's Apple Developer ID (team D69G45342Y). Downloaded components are checked the same way. Nothing else is accepted, and a copy on the Developer ID accepts only the Developer ID. This release is still self-signed; it prepares copies to move to the notarized Developer ID build on their own.
- When the next version is the first one signed with the Developer ID, the Software Update window says so in one line: macOS asks once more for your login password (choose Always Allow) and may ask you to allow Keeper again in Privacy & Security; after that, updates don't ask.
- Releases: `"macSigning"` in `.github/release.json` (`self-signed` by default, or `developer-id`) decides who signs the Mac build; adding a secret never changes it. A Developer ID build uses the hardened runtime on the app, keeper-helper, Keeper Intents and agent-desktop, is notarized and stapled for both the standard and the offline installer, is checked before upload, and fails rather than falling back when a secret is missing. RELEASING.md → Moving to the Developer ID has the steps.

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

