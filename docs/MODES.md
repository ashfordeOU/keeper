# Modes

One choice that shapes the whole of Keeper. A mode decides which parts are on, how roomy and calm the screens are, how notices arrive, how much help you see and which sidebar sections show. It never touches your files, notes, mail or accounts.

| Mode | For | Its own part |
|---|---|---|
| **Standard** | Most people. Keeper as it comes | – |
| **Simple** | People who want a calm file manager with mail | Big buttons on Today |
| **Focus** | People who lose time to distractions | One thing now on Today, and Focus for a while |
| **Pro** | Developers, IT and power users | Quick Search runs anything |
| **Researcher** | Students, academics and analysts | Linked sources (knowledge graph) |
| **Creator** | Video makers, teachers and designers | Record and share with Studio |
| **Writer** | Writers, bloggers and journalists | Distraction blocking while you write |
| **Family** | New or older computer users | Help mode for a trusted relative |

**Add to any mode** (they stack): **Low vision**, **Steady hands**, **Easier reading**, **Screen reader** and **Privacy-max**. "Writer + Easier reading + Privacy-max" is one mode.

## Choosing and switching

- **In setup**: the second screen starts with *Who is it for?*, a row of modes (Standard is picked). The goal cards under it (*What do you want Keeper for?*) add their parts on top of the mode. Picking a goal such as *Record my screen* suggests a mode ("Creator suits these goals"), without switching to it; nothing changes until **Continue**.
- **Anytime**: Settings → General → **Mode** (cards with a picture), the palette (*Mode: Focus*, *Add: Privacy-max*), the tray's **Mode** menu, or the small coloured badge at the foot of the sidebar.
- **Preview first**: every switch shows a sheet before anything changes: the parts it turns on and off, how it looks (text size, spacing, motion), how many sidebar sections stay, and *Your files, notes, mail and accounts are not touched*. Then **Switch** or **Cancel**.

## You always win

A mode sets values; anything you change afterwards is kept as **yours, for that mode**. Switch away and your changes wait; come back and they return. Settings → **Changed** and **Reset** compare against the mode you are in, not against how Keeper came, and Settings → General → Mode shows *2 changes of yours* with **Reset to Focus**.

Nothing a mode sets is special: every value is an ordinary setting or part switch, and each mode's own part (Big buttons, Offline check…) is an ordinary part anyone can turn on in Settings → Features.

A mode never switches the choices that are only ever yours: anonymous usage stats, crash reports, opening at login, Help mode, live location sharing and reaching this computer before login.

## Focus for a while

Focus also works as a session over any mode: **Focus for 25, 50 or 90 minutes** (Settings → General → Mode, the palette, the tray, the sidebar badge). While it runs, the Island's focus timer counts down, notices wait (with *Hold notices while focusing* on), the sidebar shows only Files, Mail & Calendar and Notes, and the badge reads *Focus · 42 min*. It ends by itself, changes nothing that is saved, and **End now** stops it early. It holds one timer while it runs and none otherwise.

## Offline check (Privacy-max's own part)

Settings → Privacy → **Offline check** lists every way Keeper could reach the internet (update checks, forecasts, mail, feeds, your other devices, currency rates, lyrics…), each with its own switch, and **Turn all off**. It reads your settings; to watch real connections from every app, use Network & firewall.

## What each mode changes

This part is made from the modes' data (`core/modes.ts`); a test keeps it in step.

<!-- modes:start -->
### What Standard changes

Keeper as it comes: the essentials for this computer. For: most people.

- **Sidebar:** every section
- Nothing: Keeper as it comes, with the essentials for this computer.

### What Simple changes

A calm file manager with mail. Big text, few rows. For: people who want it calm.

- **Turns on:** Files and search, Quick Search, Clean up, Undo history, Mail, Calendar and reminders, The Island, Big buttons on Today
- **Turns off:** Terminal, AI agents in the terminal, AI agents, Coding assistants, AI limits in the Island, AI usage and limits, Local servers and ports, Containers, Network & firewall, Private network for your devices, Toolbox, Studio (screen recording), Stage (clean screen), Desktop widgets, Places and tracks, Hidden system settings, Running apps, Startup items and apps, Automations, Let AI search your files, Writing help, Ask AI in the Island, Quick switches
- **Settings:** Text size: 110% · Spacing: Comfortable · Today spacing: Spacious · Cards on Today: 2 · All settings shown: No · Rows per sidebar section: 5 · Help button: Shown · A tip a day: On · Batched notices: Every hour · Health notices: Silent · Fix-it List notices: Silent · Privacy notices: Silent
- **Sidebar:** Files, Mail & Calendar
- **Its own part:** Big buttons: Six large buttons on Today: find a file, free up space, write mail and more.

### What Focus changes

One thing at a time. Notices wait; distractions stay out. For: people who lose time to distractions.

- **Turns on:** Inbox for quick thoughts, Planner, Plan my day, Focus timer and breaks, Block distractions while you focus, Journal, The Island, Tasks in the Island
- **Turns off:** Desktop widgets, Vibes, Live wallpaper, Weather in the Island, Stocks in the Island, Sales in the Island, Other apps' notifications in the Island, Insights in the Island
- **Settings:** Motion: Reduced · Spacing: Comfortable · Cards on Today: 3 · Batched notices: At 9, 13 and 17 · Hold notices while focusing: Yes · Mail notices: Batched · Sites and servers notices: Batched · Network notices: Batched · Reader notices: Silent
- **Sidebar:** Files, Mail & Calendar, Notes
- **Its own part:** One thing now: Today shows what is on now, your top three and one focus timer.

### What Pro changes

Everything in reach, tight and fast, for keyboard people. For: developers, it and power users.

- **Turns on:** Two folders side by side, Terminal, AI agents in the terminal, AI agents, Coding assistants, AI limits in the Island, AI usage and limits, Local servers and ports, Containers, Network & firewall, Hidden system settings, Remote Desktop, VNC and SSH, Private network for your devices, Toolbox, Running apps, Apps and commands in Quick Search, Quick switches, Graphics, fans and power
- **Turns off:** Ambient sound, Vibes
- **Settings:** Spacing: Compact · All settings shown: Yes · Rows per sidebar section: All · Help button: Hidden · A tip a day: Off · Sites and servers notices: Now · Network notices: Now · AI usage notices: Now
- **Sidebar:** every section
- **Its own part:** Run anything: Quick Search runs any Keeper action, your commands and saved links.

### What Researcher changes

Notes, sources and search by meaning, side by side. For: students, academics and analysts.

- **Turns on:** Notes, Let AI search your files, Knowledge graph of everything, Search by meaning, Words inside documents, Words in pictures and scans, Convert, Dictation, Meeting notes, Planner, Calendar and reminders, Feeds and read later
- **Turns off:** Network & firewall, Private network for your devices, Stocks in the Island, A year of health history
- **Settings:** Calendar notices: Now · Mail notices: Batched · Health notices: Batched
- **Sidebar:** Files, Mail & Calendar, Notes, AI
- **Its own part:** Linked sources: Every note shows the files, mail and notes it is linked to.

### What Creator changes

Record, edit and share your screen in one flow. For: video makers, teachers and designers.

- **Turns on:** Screenshots and copy text from screen, Studio (screen recording), Stage (clean screen), Draw on screen, Edit photos, Convert, Hide faces in pictures, Teleprompter, Transcribe recordings
- **Turns off:** Coding assistants, AI agents, AI limits in the Island
- **Settings:** Health notices: Silent · Fix-it List notices: Silent · Mail notices: Batched
- **Sidebar:** Files, Mail & Calendar, Screen
- **Its own part:** Record and share: Studio records, adds captions and copies a link to share.

### What Writer changes

A quiet page to write on, with words that flow. For: writers, bloggers and journalists.

- **Turns on:** Notes, Journal, Typed snippets, Dictation, Actions for selected text, Writing help, Block distractions while you focus, Feeds and read later
- **Turns off:** Computer health, Network & firewall, Toolbox, Studio (screen recording)
- **Settings:** Text style: Serif · Text size: 110% · Motion: Reduced · Today spacing: Spacious · Mail notices: Batched · Reader notices: Silent
- **Sidebar:** Files, Mail & Calendar, Notes
- **Its own part:** Distraction blocking: Block the sites and apps that pull you away while you write.

### What Family changes

Large and plain, with a helper one click away. For: new or older computer users.

- **Turns on:** Files and search, Mail, Calendar and reminders, Alarms, timers and clocks, Clean up, Keeper on your other devices, See and control your devices, The Island, Big buttons on Today
- **Turns off:** Terminal, AI agents in the terminal, AI agents, Coding assistants, AI limits in the Island, AI usage and limits, Local servers and ports, Containers, Network & firewall, Hidden system settings, Startup items and apps, More formats for Convert, Studio (screen recording), Stage (clean screen), Toolbox, Automations, Workflows, Private network for your devices, Let AI search your files, Writing help, Ask AI in the Island, More AI skills, Running apps, Quick switches, Desktop widgets
- **Settings:** Text size: 125% · Motion: Reduced · Focus outlines: Always · Spacing: Comfortable · Today spacing: Spacious · Cards on Today: 2 · All settings shown: No · Rows per sidebar section: 5 · Help button: Shown · A tip a day: On · Batched notices: Every hour · Health notices: Silent · Fix-it List notices: Silent · Network notices: Silent · Updates notices: Silent
- **Sidebar:** Files, Mail & Calendar
- **Its own part:** Help mode: One click lets a trusted relative see your screen, with a big Stop.

### What Low vision changes (add-on)

Larger text, clear focus outlines and less motion.

- **Turns off:** Live wallpaper, Vibes
- **Settings:** Text size: 150% · Focus outlines: Always · Motion: Reduced · Spacing: Comfortable

### What Steady hands changes (add-on)

Roomy spacing, focus outlines and keyboard first.

- **Turns on:** Dictation
- **Settings:** Focus outlines: Always · Motion: Reduced · Spacing: Comfortable · Text size: 110%

### What Easier reading changes (add-on)

A rounded font, a little larger, and calm pages.

- **Turns on:** Dictation
- **Settings:** Text style: Rounded · Text size: 110% · Motion: Reduced

### What Screen reader changes (add-on)

No moving backgrounds; focus outlines always on.

- **Turns off:** Live wallpaper, Vibes, Desktop widgets
- **Settings:** Focus outlines: Always · Motion: Reduced

### What Privacy-max changes (add-on)

Nothing leaves this computer unless you ask.

- **Turns on:** Network & firewall, Network activity and VPN, Locked folders, Privacy and security check, Offline check
- **Turns off:** Weather, Weather in the Island, Stocks in the Island, Sales in the Island, Check for updates automatically, Save videos from web pages, Monorail, Faster connections between your devices
- **Settings:** AI: On this computer only · Currency rates: Off · Lyrics: Off · Link titles in clipboard: Off · Pictures in articles: Off · Whole articles: Off
- **Its own part:** Offline check: Every way Keeper could reach the internet, with one switch each.
<!-- modes:end -->

## For developers

- `core/modes.ts`: the modes and add-ons as data, `switchPatch()` (keeps the person's changes for the mode they leave, brings back the ones for the mode they enter), `previewSwitch()`, `modeBaseline()` (what Changed and Reset compare against), the Focus session and `suggestMode()` for setup goals. Unit tests in `test/modes.test.ts`.
- `core/offline.ts`: the Offline check list. Tests in `test/offline.test.ts`.
- `electron/services/modes.ts`: switching with this computer's context, Reset and the session timer. IPC `modes.*`.
- `src/components/Modes.tsx`: the cards, the preview sheet, the sidebar badge, the palette entries and the Offline check panel. `src/today/BigButtons.tsx`: Big buttons.
- The settings live in `settings.mode = { base, addons, overrides, since }` and `settings.modeSession`.
- End to end: `test/e2e/modes.cjs` switches through every mode, checks the preview, the badge, overrides coming back and a Focus session.
