<p align="center">
  <img src="build/icon.png" width="112" alt="Keeper icon">
</p>

<h1 align="center">Keeper</h1>

<p align="center">
  <strong>A home for your files.</strong><br>
  Browse everything as big, clear thumbnails. Find any file by describing it. Read the text inside screenshots.<br>
  See where downloads came from. Clear duplicates and clutter safely. Keep a live Island at the top of your screen.<br>
  Free, open source, private — on <b>Windows, macOS and Linux</b>.
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: AGPL v3 or later" src="https://img.shields.io/badge/license-AGPL--3.0--or--later-6d6dff"></a>
  <img alt="Platforms" src="https://img.shields.io/badge/platforms-Windows%20%C2%B7%20macOS%20%C2%B7%20Linux-a35cf0">
  <img alt="Price" src="https://img.shields.io/badge/price-free%20forever-ff6fa3">
  <a href="https://github.com/ashfordeOU/keeper/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/ashfordeOU/keeper/actions/workflows/ci.yml/badge.svg"></a>
</p>

<p align="center">
  <img src="docs/screenshots/home.png" alt="Keeper home: disk usage, library shelves, weather and recent downloads" width="900">
</p>

Keeper brings together a visual file library, plain-English search, a safe disk cleaner, a duplicate finder,
a live Island panel, a clipboard history, a screen-text grabber, a keep-awake switch, a developer toolbox and an
optional AI assistant — in one small app that never uploads your files.

- **No account. No subscription. No ads. No tracking.** Everything runs on your computer.
- **Nothing is ever lost.** Your files only go to the Trash, every change is in History, and moves and renames can be undone.
- **Works where you work.** One app for Windows, macOS and Linux, plus a `keeper` command for terminals and servers.

---

## Contents

- [Highlights](#highlights)
- [Everything Keeper does](#everything-keeper-does)
  - [Library and browsing](#library-and-browsing) · [Plain-English search](#plain-english-search) · [Text in images](#text-in-images-and-on-screen) · [Downloaded From](#downloaded-from)
  - [Duplicates](#duplicates) · [Clean Up](#clean-up) · [Space Map](#space-map) · [Automations](#automations) · [History and undo](#history-and-undo)
  - [The Island](#the-island) · [Quick Search, tray and deep links](#quick-search-tray-and-deep-links) · [Toolbox](#toolbox) · [System](#system) · [Assistant](#assistant)
  - [Command line](#command-line)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Keeper compared with your system file manager](#keeper-compared-with-your-system-file-manager)
- [Privacy](#privacy) · [Safety model](#safety-model)
- [Install](#install) · [Build from source](#build-from-source) · [Project layout](#project-layout)
- [Platform support](#platform-support) · [Roadmap](#roadmap) · [Contributing](#contributing) · [License](#license)

---

## Highlights

| | |
|---|---|
| <img src="docs/screenshots/search.png" alt="Searching for screenshots with a wifi password"> | **Describe it, find it.** “screenshots with wifi password”, “pdfs from gmail last week over 5 MB”, “videos from my iphone in august”. Keeper turns your words into filters you can see and edit, and matches the text *inside* files and images. |
| <img src="docs/screenshots/cleanup.png" alt="Clean Up after a Smart Scan"> | **Free up space without fear.** One scan finds browser and app caches, logs, old installers, unpacked archives, unfinished downloads, forgotten downloads, old screenshots, big old videos, old project build folders, AI model caches and unused apps — each labelled *Safe*, *Review* or *Permanent*. |
| <img src="docs/screenshots/duplicates.png" alt="Duplicate groups with the copy to keep highlighted"> | **Duplicates, done properly.** Byte-identical copies (SHA-256), look-alike photos (bursts, edits, resized copies) and the same photo saved twice (HEIC + JPEG, RAW + JPEG). Keeper picks the copy to keep and tells you why. |
| <img src="docs/screenshots/island.png" alt="The Island expanded: now playing with lyrics, weather, next event, battery"> | **The Island.** A live panel at the top of the screen: now playing with synced lyrics, a drag-and-drop shelf, clipboard history, focus timer, keep-awake, weather, your next meeting, coding-agent status and dictation. |
| <img src="docs/screenshots/space-map-dark.png" alt="Space Map treemap in dark mode"> | **See where your space went.** The Space Map draws every folder at its true size, marks folders Keeper can clean, and lets you drill in. |
| <img src="docs/screenshots/quick-search.png" alt="Quick Search panel"> | **Search from anywhere.** <kbd>Ctrl/⌘</kbd><kbd>Shift</kbd><kbd>Space</kbd> opens Quick Search over any app, with the same plain-English understanding. |

---

## Everything Keeper does

### Library and browsing

- **Shelves** for Images, Videos, Music, Documents, Archives, Installers, Apps and Screenshots, plus Recents, Tags, Saved searches and pinned folders in the sidebar.
- **Home dashboard** with disk usage by kind, totals per shelf, recent photos, videos, music and documents, recent downloads with their source, the weather and a one-click cleanup.
- **Browse** any folder with breadcrumbs, grid or list view, hidden-file toggle, new folders and “pin to sidebar”.
- **Grid or list** (<kbd>Ctrl/⌘ 1</kbd> / <kbd>Ctrl/⌘ 2</kbd>), adjustable card size (<kbd>Ctrl/⌘ +</kbd> / <kbd>−</kbd>), sort by name, date, size or kind, arrow-key navigation, <kbd>Shift</kbd>/<kbd>Ctrl/⌘</kbd> multi-select, select all.
- **Inspector** (<kbd>Ctrl/⌘ I</kbd>): large preview, dimensions, duration, camera, created/modified/opened dates, location, download source with the original link, text found in the image, and tags.
- **Right-click menu**: Open, Open With, Quick Look, Show in folder, Copy, Copy Path, Copy Text in Image, Add to Shelf, Pin to Sidebar, Rename, Compress to ZIP, Move to Trash.
- **Batch rename** with a live preview and conflict check: find & replace (plain or regex), name templates with counters and dates (`Trip {n:3}`, `{date} {name}`), add prefix/suffix, change case, clean up “ (1)” and “copy” leftovers. Undoable.
- **Tags** on any file, searchable with `#tag`.
- **Drag files out** into any app — one or many at a time.
- **Built-in music player**: double-click a song to play it in the toolbar.
- **Two looks**: *Playful* (colourful) and *Minimal* (black, white and grey), each in light and dark, following the system or set by hand (<kbd>Ctrl/⌘ Shift T</kbd>).

### Plain-English search

Type what you remember; Keeper shows how it understood you as chips you can remove, and you can save any search to the sidebar where it stays live.

| You type | Keeper reads |
|---|---|
| `pdfs from last week over 5 MB` | PDFs · in the last 7 days · larger than 5 MB |
| `videos from my iphone in august` | Videos · shot on iPhone · August |
| `screenshots with wifi password` | Screenshots · “wifi” and “password” in the text inside |
| `zips bigger than 1gb older than 6 months` | ZIP · larger than 1 GB · older than 6 months |
| `invoice from march 2025` | “invoice” · March 2025 |
| `photos taken yesterday` | Images · created yesterday |
| `top 10 biggest files in downloads` | In Downloads · biggest first · top 10 |
| `"tax return" pdf -draft #work` | exact phrase · PDF · without “draft” · tagged work |
| `spreadsheets between 1 and 5 mb` | Excel, Numbers, CSV… · 1 MB – 5 MB |
| `slack attachments since monday` | Downloaded from Slack · since Monday |
| `duplicate photos` | Images that have duplicates |

It understands kinds and extensions (`heic`, `.docx`, `slides`, `ebooks`, `raw photos`…), dates (`today`, `this week`, `last month`, `in 2024`, `since 2026-01-05`, `between march and may`, `3 days ago`, `on friday`), sizes (`over`, `under`, `about`, `between`, `big`, `huge`, `tiny`, `empty`), sources (`from gmail`, `via whatsapp`, `downloaded from example.com`), cameras (`iphone`, `android`, `gopro`, `drone`), folders (`on my desktop`, `in the taxes folder`), sorting (`newest`, `oldest`, `biggest`, `a-z`), quoted phrases, `-exclusions`, `#tags` and explicit filters (`ext:pdf`, `kind:video`, `from:slack`, `in:downloads`, `tag:work`). Accents, punctuation (“wifi” finds “Wi-Fi”) and one-letter typos are forgiven.

### Text in images and on screen

- **Reads the text in screenshots, photos and scans on your computer** (Tesseract, no upload) and makes it searchable. Screenshots are read first.
- **Copy text from one image or many** at once (<kbd>Ctrl/⌘ Shift C</kbd>), from the hover button on a thumbnail, or from the Inspector.
- **Copy text from anywhere on screen** (<kbd>Ctrl/⌘ Shift 2</kbd>): drag over any area — a video, a locked PDF, an error dialog — and the text lands on your clipboard. **QR codes** in the area are decoded too.
- Plain-text files (notes, Markdown, CSV, subtitles, HTML…) are indexed as well.
- Choose recognition languages in Settings (e.g. `eng+deu+fra`).

### Downloaded From

Every download is grouped by where it came from — Gmail, Google Drive, ChatGPT, Claude, Gemini, Canva, Figma, Notion, X, Slack, WhatsApp, Telegram, Discord, Teams, Outlook, OneDrive, Dropbox, WeTransfer, iCloud, GitHub, GitLab, YouTube, Reddit, LinkedIn, browser extensions, or any other website — using what your browser and OS recorded (macOS *Where From*, Windows *Zone.Identifier*, Linux `user.xdg.origin.url`). Open a source to see its files; the Inspector shows the exact link and page.

### Duplicates

- **Identical copies** found by content, not name: grouped by size, then a quick partial hash, then a full SHA-256 — fast even on big libraries, and remembered between scans.
- **Look-alike photos** (bursts, edits, resized and re-saved copies) via perceptual fingerprints, with flat/blank images kept out.
- **Same photo, two formats**: HEIC + JPEG and RAW + JPEG pairs; Keeper keeps the original.
- **Keeps the right copy**: the original name over “(1)” and “copy”, a real folder over Downloads/temp, the oldest copy, or the sharpest photo — with the reason shown. Click any file to keep it instead.
- Shows the space you will free; files go to the Trash. Cloud-only placeholders are skipped so nothing downloads.

### Clean Up

A Smart Scan measures everything at once, then you choose:

| Group | What it is | How it is removed |
|---|---|---|
| Browser caches | Chrome, Edge, Safari, Firefox, Brave, Arc, Vivaldi, Opera — every profile | Deleted (rebuilds); logins, history and tabs stay |
| App caches | Slack, Discord, Teams, VS Code, Cursor, Notion, Figma, Spotify, Zoom, Steam, Adobe | Deleted (rebuilds) |
| User caches, logs, crash reports, temp files, thumbnail cache | System and app leftovers; files touched in the last day are kept | Deleted (rebuilds) |
| Developer caches · Xcode leftovers | npm, Yarn, pnpm, pip, Homebrew, CocoaPods, NuGet, Gradle, Cargo, Go, JetBrains; DerivedData, device support | Deleted (re-downloads) — *Review* |
| AI tools | Desktop AI app caches, local model stores (Ollama, LM Studio, Hugging Face) | Deleted (re-downloads) — *Review* |
| Old project build folders | `node_modules`, `target`, `.venv`, `.next`, `.gradle`… in projects untouched for 30+ days | Deleted (reinstall brings them back) — *Review* |
| Windows Update downloads | Installers Windows already used | Deleted, needs admin rights |
| Old installers · unpacked archives · unfinished downloads | `.dmg/.pkg/.exe/.msi/.deb…`, zips with an unpacked folder next to them, `.crdownload/.part` | **Trash** |
| Forgotten downloads · old screenshots · big old videos · empty files | Your files, reviewed one by one | **Trash** |
| Unused apps | Not opened in 6+ months | Trash (macOS, with leftovers) or the app's own uninstaller |
| Trash / Recycle Bin | Already-deleted files | Emptied — *Permanent* |

Every group is labelled *Safe* (pre-selected), *Review* or *Permanent*, can be expanded to pick individual files, and the result lands in History.

### Space Map

A treemap of any folder or drive, sized by real usage, coloured per folder, with **Cleanable** badges on folders Keeper knows how to clean. Click to drill in, use the breadcrumb to go back, switch between drives and your home folder, and see a ranked list alongside. **Large Files** lists everything over 100 MB / 500 MB / 1 GB / 5 GB.

### Automations

Rules that keep folders tidy on their own — **all off until you turn them on**, previewable as a dry run, and only ever moving files or sending them to the Trash:

- Send old installers in Downloads to the Trash.
- File screenshots into monthly folders (`Pictures/Screenshots/2026-10`).
- Sort downloads into folders by where they came from.
- Clear downloads that never finished.
- Build your own: conditions on kind, extension, screenshot, age, size, folder, source, name pattern or any plain-English search; actions to trash, tag, or move with `{yyyy} {MM} {dd} {kind} {ext} {source}` placeholders.

### History and undo

Everything Keeper changes is recorded with what moved where and how much space was freed. Moves and renames are undone in place; items in the Trash are one click from being put back.

### The Island

A small live panel at the top of your screen (or the left or right edge), hidden until something happens. Hover or click to expand.

- **Shelf** — drop files in, drag them all out later; new downloads and screenshots land here automatically.
- **Clipboard history** — text, links, colours (with swatches) and images; search, pin, delete. Passwords and API keys are never remembered. Optionally **strips tracking** (`utm_…`, `fbclid`…) and unwraps redirect links as you copy them.
- **Alerts** when a download finishes or a screenshot is saved, with Open / Show / Shelf buttons.
- **Now playing** from Music, Spotify and any MPRIS or Windows media app: artwork, scrubber, play/pause/skip, and **synced lyrics** line by line.
- **Focus timer** with focus and break rounds, pause/resume and a countdown; **break reminders** every N minutes of activity.
- **Keep awake** — indefinitely, for a while, until a time, while an app is running, until a download finishes, only on power, let the screen sleep, stop on low battery. **Presentation mode** keeps the computer awake and hides desktop icons.
- **Coding agents** — Claude Code and Codex sessions on this computer: working, waiting for permission, done or stuck, with a soft sound when one needs you; click to jump to its folder in a terminal.
- **Weather** — current conditions, “rain starting in about 20 minutes”, air quality and UV.
- **Today** — your next events from any calendar link (`.ics` / `webcal://`).
- **Battery** and charging state, and which app is using the microphone (Windows, Linux).
- **Dictation** — press the shortcut, speak, and the text is typed at the cursor in any app, using a speech-to-text service you choose (bring your own key, or a local server).
- A small **buddy** face that reflects what is going on.

### Quick Search, tray and deep links

- **Quick Search** (<kbd>Ctrl/⌘ Shift Space</kbd>, changeable): recent files when empty, live plain-English results; <kbd>↩</kbd> opens, <kbd>Ctrl/⌘ ↩</kbd> shows in Keeper, <kbd>Alt ↩</kbd> shows in the folder.
- **Command palette** (<kbd>Ctrl/⌘ K</kbd>) for every page and action.
- **Tray / menu bar**: the newest downloads (drag or click), Quick Search, copy text from screen, keep awake, Clean Up. Keeper keeps running in the tray so shortcuts, the Island and rules keep working.
- **`keeper://` links** for scripts, launchers and shortcuts: `keeper://search?q=…`, `keeper://open?path=…`, `keeper://capture`, `keeper://quick`, `keeper://clean`, `keeper://awake?minutes=60`.

### Toolbox

Small tools, all offline: copy text from screen (with QR), colour picker, dead-pixel test, keyboard-cleaning lock, link cleaner, **hide personal info before pasting into AI tools**, case converter, word counter, hidden-character inspector, password and passphrase generator, JSON formatter (with exact error position), Base64, SHA hashes, UUID v4/v7, JWT decoder, timestamp converter, regex tester, Wi-Fi sharing code, saved Wi-Fi passwords, and eject all drives.

### System

- **Health**: CPU, memory, uptime and load; battery level, health and cycle count; the busiest processes (with Quit); **what is keeping the computer awake**; and **local servers listening on a port** (open in the browser or stop).
- **Startup Items**: apps that start with the computer, with a rough impact rating; switch them off with the same setting the OS uses (reversible; system-wide items ask for permission).
- **Applications**: every installed app with size, version and last use; filter unused or large ones; uninstall via the app's own uninstaller (Windows), the Trash plus leftover support files (macOS) or Flatpak/Snap (Linux).
- **Protection**: a score for the security already built into your system — Gatekeeper, XProtect, SIP, FileVault, firewall and updates on macOS; Defender, real-time protection, definitions, firewall, UAC, SmartScreen, device encryption and Windows Update on Windows; firewall, disk encryption, Secure Boot, AppArmor/SELinux and automatic updates on Linux — with how to fix what is off. Keeper is not an antivirus.

### Assistant

Ask *“what can I safely delete?”* or *“why is my disk full?”*. The assistant sees **only file names, folders, sizes, dates and kinds — never contents** — and can only suggest: you pick what goes to the Trash. Use **Claude** or **OpenAI** with your own key (stored in your system keychain), or a **local model through Ollama** so nothing leaves your computer at all. Suggested paths are checked against what Keeper actually showed the model.

### Command line

The same engine runs in a terminal — handy for servers, scripts and Linux machines without a desktop. Read-only unless you pass `--yes`.

```bash
npm run build:cli
node dist-cli/keeper.cjs search "pdfs from gmail over 5 MB"
```

```text
keeper search <words>      Plain-English search
keeper scan                What can be freed: caches, installers, forgotten downloads, big files
keeper clean [group…]      Clear rebuildable caches (preview unless --yes)
keeper dupes               Exact duplicates and HEIC/JPEG pairs (--trash --yes to remove extras)
keeper stats               Files per shelf and where downloads came from (--sources)
keeper rules               Preview the automatic tidy-up rules
keeper agents              Status of Claude Code / Codex sessions on this computer

--in <folders>  --json  --limit <n>  --hidden  --yes
```

---

## Keyboard shortcuts

<kbd>Ctrl</kbd> on Windows and Linux is <kbd>⌘</kbd> on macOS.

| Find | | View | | Tidy and play | |
|---|---|---|---|---|---|
| Quick Search (any app) | <kbd>Ctrl Shift Space</kbd> | Grid / List | <kbd>Ctrl 1</kbd> / <kbd>Ctrl 2</kbd> | Duplicates | <kbd>Ctrl Shift D</kbd> |
| Search | <kbd>Ctrl F</kbd> | Bigger / smaller cards | <kbd>Ctrl +</kbd> / <kbd>Ctrl −</kbd> | Clean Up | <kbd>Ctrl Shift K</kbd> |
| Command palette | <kbd>Ctrl K</kbd> | Inspector | <kbd>Ctrl I</kbd> | Play / pause | <kbd>Ctrl Space</kbd> |
| Downloaded From | <kbd>Ctrl Shift J</kbd> | Preview | <kbd>Space</kbd> | Move to Trash | <kbd>Ctrl ⌫</kbd> / <kbd>Delete</kbd> |
| Copy text in selected images | <kbd>Ctrl Shift C</kbd> | Switch look | <kbd>Ctrl Shift T</kbd> | Back | <kbd>Ctrl [</kbd> |
| Copy text from screen (any app) | <kbd>Ctrl Shift 2</kbd> | Settings | <kbd>Ctrl ,</kbd> | Dictation (any app) | <kbd>Ctrl Shift ;</kbd> |

Global shortcuts can be changed in Settings and Island settings.

---

## Keeper compared with your system file manager

Keeper works **alongside** Finder, File Explorer, Files or Dolphin — “Show in folder” is always one click away.

| | Finder / Explorer / Files | Keeper |
|---|:---:|:---:|
| Files grouped by kind as big thumbnails | partly | ✅ |
| Search by describing a file in plain English, with editable filters | — | ✅ |
| Search the text inside screenshots and photos | macOS only, limited | ✅ every OS |
| Copy text from any area of the screen, read QR codes | — | ✅ |
| See which site or app every download came from | — | ✅ |
| Duplicate and look-alike photo finder | — | ✅ |
| Safe cleanup of caches, installers, build folders and old downloads | — | ✅ |
| Space Map of what uses your disk | — | ✅ |
| Rules that tidy folders automatically, with undo history | — | ✅ |
| Batch rename with preview and undo | partly | ✅ |
| Tags on any OS | macOS only | ✅ |
| Recent downloads in the tray, Quick Search over any app | — | ✅ |
| Clipboard history, shelf, focus timer, keep-awake | — | ✅ |
| Startup items, installed apps, security check, system health | separate tools | ✅ |
| Same app on Windows, macOS and Linux, plus a CLI | — | ✅ |

---

## Privacy

- **Your files never leave your computer.** Indexing, search, text recognition, duplicate detection and cleanup all run locally.
- **No account, no analytics, no telemetry.**
- Network requests Keeper makes, and only when the feature is on:
  - **Text-recognition language data** — downloaded once per language from the Tesseract data mirror, then cached. Images are never sent.
  - **Weather** — your chosen place's coordinates to [Open-Meteo](https://open-meteo.com) (no key, no account).
  - **Lyrics** — the song title, artist and length to [LRCLIB](https://lrclib.net).
  - **Calendar** — the `.ics` link you entered.
  - **Assistant** — file names, folders, sizes and dates (never contents) to the provider you chose; nothing at all with a local model.
  - **Dictation** — your recorded audio to the speech-to-text address you configured.
  - **Update check** — once a day, the latest release number from GitHub (can be turned off).
- API keys are encrypted with the operating system's keychain (Electron `safeStorage`). On Linux without a keyring, Keeper refuses to store keys rather than store them weakly.
- Passwords and secret keys you copy are not kept in clipboard history.

## Safety model

Cleaning tools should never cost you a file. Keeper's rules:

1. **Your files go to the Trash; caches are deleted.** Anything you made or downloaded — duplicates, old downloads, screenshots, installers, apps — goes to the system Trash/Recycle Bin. Caches, logs and temporary files rebuild themselves, so moving them to the Trash would free nothing; they are deleted.
2. **Only known places.** What to clean is derived from a known category, never from a path the interface sends; paths are resolved to their real form and checked again right before anything is touched. Cleanup only accepts files Keeper itself listed in the latest scan.
3. **System folders are off limits.** Drive roots, your home folder, Desktop/Documents/Downloads themselves, system folders, network paths, symbolic links and junctions, Windows 8.3 short names and trailing-dot tricks are refused; so is anything in a folder you excluded.
4. **Files in use are skipped.** Temp files touched in the last day and locked files are left alone and reported.
5. **Everything is reversible where possible.** Startup items are switched off the way the OS does it; rules are off until you enable them and can be previewed; History lists every change, and moves and renames can be undone.
6. **iCloud and OneDrive placeholders are skipped**, so a scan never triggers downloads.

---

## Install

Download the latest build from **[Releases](https://github.com/ashfordeOU/keeper/releases/latest)**:

| Platform | File |
|---|---|
| Windows 10/11 (x64, Arm64) | `Keeper-setup-x64.exe` / `Keeper-setup-arm64.exe`, or `Keeper-portable.exe` |
| macOS 12+ (Apple silicon / Intel) | `Keeper-mac-arm64.dmg` / `Keeper-mac-x64.dmg` |
| Linux (x64, arm64) | `.AppImage`, `.deb`, `.rpm` or `.tar.gz` |

### First launch

Builds are not yet signed with paid Apple / Microsoft certificates:

- **Windows** — if SmartScreen appears, choose **More info → Run anyway**.
- **macOS** — drag Keeper to Applications, then run once: `xattr -cr /Applications/Keeper.app`.
- **Linux** — `chmod +x Keeper-*.AppImage`. For now playing, dictation and download sources install `playerctl`, `xdotool` (or `wtype` on Wayland) and `attr`.

### Permissions Keeper may ask for

| Permission | Why |
|---|---|
| Desktop, Documents, Downloads (macOS) | To show and search your files |
| Screen Recording (macOS) | Only for *Copy text from screen* |
| Accessibility / Automation (macOS) | To paste dictated text and read what Music or Spotify is playing |
| Microphone | Only while dictating |
| Administrator | Only when you switch a system-wide startup item or clean files that need it |

---

## Build from source

Requires **Node.js 22+**.

```bash
npm install          # dependencies and the Electron binary
npm run dev          # the app with hot reload
npm run demo         # the interface alone in a browser at http://localhost:5180, with sample data (your disk is not touched)
npm test             # unit tests for the search parser, duplicates, cleanup, rules, Island logic and more
npm run typecheck
npm run build        # interface + main process + CLI into dist/, dist-electron/, dist-cli/
npm run dist:win     # Windows installers (also :mac on a Mac, :linux on Linux)
```

Builds land in `release/`. Pushing a tag like `v0.2.0` runs the **Release** workflow, which builds every platform and attaches the installers to a GitHub Release.

## Project layout

```text
core/                 the engine — plain TypeScript, no Electron, shared by the app and the CLI
  query/              plain-English search: parser → chips → matching and ranking
  cleanup/            what can be cleaned on each OS, measuring and cleaning safely
  indexer.ts          the file library index (saved to disk, incremental)
  duplicates.ts       SHA-256 duplicates, perceptual look-alikes, format pairs, which copy to keep
  safety.ts           the rules every destructive action passes through
  rules.ts            automations; journal.ts history and undo; rename.ts batch rename
  island.ts           calendar (.ics), lyrics (.lrc), agent status, clipboard history, focus timer
  sources.ts          download-source detection; textools.ts toolbox helpers; weather.ts forecasts
  ai.ts               the metadata-only assistant (Claude, OpenAI, Ollama)
  api.ts              the typed contract between the interface and the main process
electron/             main process: windows, tray, shortcuts, IPC
  services/           files, OCR, screen capture, island, media, system, startup, apps, protection
cli/keeper.ts         the `keeper` command
src/                  React interface (screens, components, the Island window, Quick Search)
  mock.ts             sample data for `npm run demo`
test/                 Vitest unit tests
docs/                 screenshots and longer documentation
```

More detail in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Platform support

| Feature | Windows | macOS | Linux |
|---|:---:|:---:|:---:|
| Library, search, text in images, duplicates, cleanup, Space Map, rules, history | ✅ | ✅ | ✅ |
| Download sources | ✅ | ✅ | ✅ (browsers that write `user.xdg.origin.url`) |
| OS thumbnails (HEIC, PDF, video) | ✅ | ✅ | images |
| Copy text from screen | ✅ | ✅ | ✅ (X11; Wayland via portal) |
| Startup items | Registry + Startup folder | Launch agents, login items | XDG autostart |
| App uninstall | App's uninstaller | Trash + leftovers | Flatpak / Snap |
| Protection check | ✅ | ✅ | ✅ |
| Now playing + lyrics | System media session | Music, Spotify | MPRIS (`playerctl`) |
| Microphone-in-use | ✅ | — | ✅ |
| Dictation typing | ✅ | ✅ | X11 `xdotool` / Wayland `wtype` |
| Battery health & cycles | level | ✅ | ✅ |
| Tags | Keeper tags | Keeper tags | Keeper tags |

## Roadmap

Planned, roughly in order:

- Media and document converters in the file browser: compress a video to a target size, convert/resize/strip metadata from images, merge/split/compress PDFs, background removal — each output to a new folder, never overwriting.
- Multiple named shelves, instant drop actions and shareable upload links to your own storage.
- Weather tile charts (hourly rain, UV, wind) and trip forecasts from calendar events.
- Reading and writing macOS Finder tags; PDF text indexing.
- Screen recording and screenshot annotation.
- Signed and notarized builds; automatic updates; translations.
- Mirroring other apps' notifications, replacing volume/brightness overlays and controlling external monitor brightness (needs native helpers per OS).

Ideas and pull requests are welcome — see below.

## Contributing

Contributions of every size are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) — in short: keep the core free of Electron, add tests for engine changes, follow the safety model, and keep the interface copy plain and friendly. Security issues: see [SECURITY.md](SECURITY.md). Changes are listed in [CHANGELOG.md](CHANGELOG.md).

## License

Keeper is free software: you can redistribute it and/or modify it under the terms of the **GNU Affero General Public License** as published by the Free Software Foundation, either **version 3** of the License, or (at your option) any later version. See [LICENSE](LICENSE).

Copyright © 2026 Keeper contributors.

Keeper uses [Electron](https://www.electronjs.org), [React](https://react.dev), [Tesseract.js](https://tesseract.projectnaptha.com) (Apache-2.0), [jsQR](https://github.com/cozmo/jsQR) (Apache-2.0) and the [Anthropic TypeScript SDK](https://github.com/anthropics/anthropic-sdk-typescript) (MIT); forecasts by [Open-Meteo](https://open-meteo.com) (CC BY 4.0) and lyrics by [LRCLIB](https://lrclib.net).
