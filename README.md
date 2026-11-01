<p align="center">
  <img src="build/icon.png" width="112" alt="Keeper icon">
</p>

<h1 align="center">Keeper <sub><sup>by Ashforde®</sup></sub></h1>

<p align="center">
  <strong>A home for your files.</strong><br>
  Browse everything as big, clear thumbnails. Find any file by describing it. Read the text inside screenshots.<br>
  See where downloads came from. Clear duplicates and clutter safely. Keep a live Island at the top of your screen.<br>
  Free to use, source available, private — on <b>Windows, macOS and Linux</b>.
</p>

<p align="center">
  <a href="LICENSE.md"><img alt="License: PolyForm Shield 1.0.0" src="https://img.shields.io/badge/license-PolyForm%20Shield%201.0.0-6d6dff"></a>
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

- **No account. No subscription. No ads.** Everything runs on your computer; your files are never uploaded. Keeper sends anonymous usage stats once a day, which you can switch off ([what is sent](docs/PRIVACY-USAGE-STATS.md)).
- **Nothing is ever lost.** Your files only go to the Trash, every change is in History, and moves and renames can be undone.
- **Works where you work.** One app for Windows, macOS and Linux, plus a `keeper` command for terminals and servers.

---

## Contents

- [Highlights](#highlights)
- [Everything Keeper does](#everything-keeper-does)
  - [Library and browsing](#library-and-browsing) · [Previews for every file](#previews-for-every-file) · [Plain-English search](#plain-english-search) · [Text in images](#text-in-images-and-on-screen) · [Downloaded From](#downloaded-from)
  - [Duplicates](#duplicates) · [Clean Up](#clean-up) · [Space Map](#space-map) · [Automations](#automations) · [History and undo](#history-and-undo)
  - [Mail, calendar and clock](#mail-calendar-and-clock) · [Cloud & servers](#cloud--servers) · [Devices & remote access](#devices--remote-access) · [Remote screens and phones](#remote-screens-and-phones) · [The Island](#the-island) · [Locked folders](#locked-folders) · [Themes](#themes) · [Quick Search, tray and deep links](#quick-search-tray-and-deep-links) · [Works with your computer](#works-with-your-computer) · [Ashforde apps: Monorail](#ashforde-apps-monorail) · [Toolbox](#toolbox) · [Terminal](#terminal) · [System](#system) · [Keep Awake](#keep-awake) · [Stage](#stage) · [Network Activity and VPN](#network-activity-and-vpn) · [Notes](#notes) · [Keeper's brain](#keepers-brain) · [Agents and the knowledge graph](#agents-and-the-knowledge-graph) · [Abilities for every AI](#abilities-for-every-ai) · [Assistant](#assistant)
  - [Command line](#command-line)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Keeper compared with your system file manager](#keeper-compared-with-your-system-file-manager)
- [Light on your computer](#light-on-your-computer) · [Privacy](#privacy) · [Usage stats](#usage-stats) · [Safety model](#safety-model)
- [Install](#install) · [Build from source](#build-from-source) · [Project layout](#project-layout)
- [Platform support](#platform-support) · [Roadmap](#roadmap) · [Contributing](#contributing) · [License](#license)

---


### Sync & Backup

Keep folders the same on your devices, back them up anywhere, and mirror them to cloud services — without a separate sync or backup app. Details in [docs/SYNC.md](docs/SYNC.md).

- **Synced folders**: straight between your Keeper devices (no cloud in between), two-way, send-only or receive-only. Only changed pieces move, renames move nothing, interrupted copies resume. Replaced and deleted files are kept as older versions; when two devices change the same file, both are kept and you choose.
- **Backups**: to a drive, a NAS, any folder or any connected cloud service (Google Drive, OneDrive, Dropbox, iCloud Drive folders, Nextcloud, S3, SFTP…). Encrypted on this computer with your password and a recovery key, deduplicated (a repeat backup of unchanged files uploads almost nothing), kept by hour, day, week, month and year, on a schedule or when the drive is plugged in. Restore all, a folder or one file; check a backup any time; a 3-2-1 card says how well protected you are.
- **Cloud mirrors**: ordinary files, one way or both ways, so they also show in the cloud's own app.
- **Phones** send their camera roll to a folder you choose. `keeper backup restore --from <folder>` restores without the app.

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
- **Browse** any folder with breadcrumbs, grid or list view, new folders and “pin to sidebar”.
- **Hidden files** on or off with one button in the toolbar (an eye), <kbd>Ctrl/⌘ Shift .</kbd> or the command palette. Hidden items show dimmed. Keeper counts a file as hidden when its name starts with a dot, when Windows marks it hidden, when macOS sets its hidden flag, or when a Linux folder's `.hidden` file lists it.
- **Locked folders**: right-click a folder → *Lock Folder…*. See [Locked folders](#locked-folders).
- **Places in the sidebar**, like a file manager's: *Favorites* (Applications, Desktop, Documents, Downloads, Pictures, Movies/Videos, Music, your home folder and any folder you drag in) and *Locations* (Shared, iCloud Drive, OneDrive, Google Drive, Dropbox, Proton Drive, Box, pCloud, MEGA, Nextcloud and other cloud drives; this computer; every internal, USB, SD-card, disc and disk-image volume with its free space and an eject button; AirDrop on a Mac; connected network shares; Network; Trash). Right-click any place for Open, Show in folder, Get Info (total size) or Remove from Sidebar.
- **Network and Connect to Server**: servers on the local network announce themselves (NAS boxes, Macs with file sharing, Samba with Avahi, Windows computers), and any `smb://`, `afp://`, `nfs://`, `sftp://`, `ftp://`, `webdav(s)://` address or `\\server\share` path connects and opens — typed in Connect to Server or straight into the Browse path bar (double-click the breadcrumbs). Recent servers are remembered; passwords never are.
- **Trash / Recycle Bin**: every deleted item with where it came from and when, *Put Back*, *Delete Immediately* and *Empty Trash* — including the per-disk trash folders on USB drives.
- **Share…** from the right-click menu: the system share sheet with AirDrop, Mail and Messages on macOS, KDE Connect devices or an email attachment on Linux, an email on Windows.
- **Cloud and network folders stay out of the library walk** by default, so a NAS or an on-demand cloud drive is never crawled or downloaded (Settings → *Include network drives and cloud folders in the library*). Files kept only in the cloud are marked in Browse.
- **Grid or list** (<kbd>Ctrl/⌘ 1</kbd> / <kbd>Ctrl/⌘ 2</kbd>), adjustable card size (<kbd>Ctrl/⌘ +</kbd> / <kbd>−</kbd>), sort by name, date, size or kind, arrow-key navigation, <kbd>Shift</kbd>/<kbd>Ctrl/⌘</kbd> multi-select, select all.
- **Inspector** (<kbd>Ctrl/⌘ I</kbd>): large preview, dimensions, duration, camera, created/modified/opened dates, location, download source with the original link, text found in the image, and tags.
- **Right-click menu**: Open, Open With, Quick Look, Show in folder, Copy, Copy Path, Copy Text in Image, Add to Shelf, Pin to Sidebar, Rename, Compress to ZIP, Move to Trash.
- **Batch rename** with a live preview and conflict check: find & replace (plain or regex), name templates with counters and dates (`Trip {n:3}`, `{date} {name}`), add prefix/suffix, change case, clean up “ (1)” and “copy” leftovers. Undoable.
- **Tags** on any file, searchable with `#tag`.
- **Drag files out** into any app — one or many at a time.
- **Built-in music player**: double-click a song to play it in the toolbar.
- **18 themes** in light and dark, from *Playful* and *Minimal* to Blossom, Steel, Terminal and Retro 95 (see [Themes](#themes)); <kbd>Ctrl/⌘ Shift T</kbd> flips between the last two you used.

### Previews for every file

Press <kbd>Space</kbd> on anything for **Quick Look**: a full-window viewer with <kbd>←</kbd>/<kbd>→</kbd> (or <kbd>[</kbd>/<kbd>]</kbd>) through the list, a filmstrip, side-by-side compare, slideshow, full screen, a details panel, and Open / Show / Copy text / Trash. The Inspector shows the same live preview, and resting the pointer on a shelf item in the Island peeks inside it. Everything is decoded on your computer, nothing is uploaded, and documents can never run code or load anything from the internet.

| Kind | What you get |
|---|---|
| Images | JPEG, PNG, GIF and WebP (animated), AVIF, BMP, ICO, **SVG** (shown safely, with its source), **HEIC/HEIF on every OS** (built-in decoder), **camera RAW** (CR2, CR3, NEF, ARW, DNG, ORF, RW2, RAF and more, via the full-size preview inside), **TIFF** (every page), **Photoshop** (flattened picture + layer list), **JPEG XL**, ICNS, TGA, EXR, DDS, JPEG 2000. Zoom to 3200%, pan, 1:1, rotate, flip, a colour picker under the pointer, histogram, and camera details (lens, exposure, ISO, focal length) with a map link for GPS. |
| Video | Everything plays: MP4, MOV, WebM, MKV directly; **AVI, WMV, FLV, MPEG-2, 3GP, MTS, VOB and other formats Chromium can't play are converted on the fly**. Frame strip to scrub, sidecar `.srt`/`.vtt` subtitles, speed, loop, frame-by-frame, picture-in-picture. |
| Audio | MP3, AAC/M4A, FLAC, Opus, Ogg, WAV play directly; AIFF, WMA, APE, AMR and others are converted. Cover art, tags and a clickable waveform. |
| PDF | Every page with thumbnails, find in document, selectable text, zoom. |
| Office & documents | **Word** (`.docx`), **Excel** (`.xlsx`, `.xls`, `.ods`, CSV/TSV, with sheet tabs and a grid that handles huge tables), **PowerPoint** (slides laid out as designed, plus speaker notes), **OpenDocument**, **RTF**, **Pages/Keynote/Numbers**, legacy `.doc`/`.ppt` (their text). |
| Text & code | Syntax highlighting for about 190 languages with line numbers and wrap; **Markdown** rendered; **JSON** as a collapsible tree (JSON Lines too); **HTML** rendered with scripts and network off; **Jupyter notebooks** with outputs and charts; **logs** coloured by level with filters; subtitles as a timeline; encoding detection (UTF-8, UTF-16, Windows-1252). |
| Archives | ZIP, JAR, APK, IPA, tar.gz and more listed **without unpacking**; 7z, RAR, ISO, CAB through the system's archive tools. Double-click any file inside to preview it in place. |
| E-books | EPUB reader with chapters and adjustable text size. |
| Fonts | TTF, OTF, WOFF, WOFF2: your own sample text, a size waterfall and a glyph grid. |
| 3D | glTF/GLB, OBJ, STL, PLY, FBX, 3MF, Collada with orbit controls, turntable and wireframe. |
| Mail, contacts, calendars | `.eml` messages (remote images and trackers blocked), contact cards, calendar files as an agenda. |
| Databases | SQLite: tables with row counts and a read-only query box. |
| Apps & folders | App details and icons (macOS apps, Windows programs, Linux packages); folders with size, file count, kinds and a photo mosaic. |
| Anything else | A hex view with readable strings and file-type detection from the bytes. |

Thumbnails cover the same ground — video frames, cover art, PDF first pages, document and code pages, spreadsheets, fonts, RAW and HEIC — and are cached on disk so the library stays fast.

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
- **QR codes and barcodes** (EAN, UPC, Code 128/39/93, ITF, Codabar, Data Matrix, Aztec, PDF417) are read from screen areas, the clipboard and image files; web links can be opened after you confirm.
- **Captures** keeps the last 100 texts, links, codes, screenshots, recordings and colours, with tabs, search and one-click copy. Options: keep or join line breaks, careful or fast recognition.

### Screenshots, recording and the editor

- **Screenshots** of the whole screen, a chosen window or a dragged area (<kbd>Ctrl/⌘ Alt S</kbd>), saved to *Pictures › Screenshots* (or a folder you pick) and put on the shelf.
- **Screen recording** of the screen, a window or an area (<kbd>Ctrl/⌘ Alt R</kbd>) with a countdown, optional microphone and system sound (Windows, Linux), a live timer and Stop button in the Island and tray; saved as MP4 (or WebM).
- **Annotate & beautify** any image: arrows, rectangles, ellipses, lines, pen, highlighter, text, numbered steps, pixelate to hide details, crop, colours and sizes, undo/redo and one-key tool shortcuts — then padding, gradient or solid backgrounds, rounded corners, shadow and a window frame. Saves a copy next to the original (“name (edited).png”) or copies it to the clipboard.
- **Colour picker** for anything on screen (<kbd>Ctrl/⌘ Alt C</kbd>) with a magnifier; copies hex and shows RGB and HSL, remembering the last 20 colours.
- `keeper://screenshot?mode=area`, `keeper://record`, `keeper://color` for launchers and scripts.

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

### Mail, calendar and clock

Your mail, calendars, to-dos, alarms and timers, in Keeper. Each part can be switched off in Settings → Features; when it is off nothing connects or waits.

- **Mail** from any IMAP provider, Gmail, Outlook and Microsoft 365, iCloud, Fastmail, Yahoo and Proton (through its Bridge): every inbox together or one folder at a time, conversations, search, flags, archive, snooze, unsubscribe, filters, and keyboard shortcuts. New mail arrives the moment the server has it (IMAP IDLE), with no checking every few minutes.
- **Safe to read**: scripts and forms are removed, links show where they really go, the message is drawn in a sandboxed frame, **pictures from the internet are held back** until you allow them, and **tracking pixels are removed**.
- **Write** with Markdown, attachments (drop files, even from Browse), several identities and signatures; **send later** and **undo send**. Meeting invitations get *Accept / Maybe / Decline*.
- **AI help** when you ask (with the AI you chose): summarize a conversation, draft a reply, find dates and add them to your calendar. Secrets are blanked first.
- **Calendar**: day, week, month, agenda and year views across iCloud, Google, Microsoft 365, Fastmail, Nextcloud and any CalDAV server or calendar link; **quick add in plain English** (“Lunch with Ana Friday 1pm at Café Sol”); drag to move or resize; repeating events with one-occurrence changes; time zones that keep 9:00 at 9:00; *Join* buttons for video meetings; your next meeting in the Island.
- **Reminders** with due dates and priorities, synced with your CalDAV task lists.
- **Clock**: alarms, several timers (shown in the Island), a stopwatch and world clocks. A computer that was asleep rings a missed alarm late, once, when it wakes; a Mac can be asked to wake for an alarm.
- Passwords and sign-in tokens are kept in the system keychain. Google and Microsoft sign-in need app IDs registered by whoever builds Keeper; without them, an app password works. Details, and exactly what was tested: [docs/PIM.md](docs/PIM.md).

### Places & Tracks
A private timeline of where your things, people and activities have been, on this computer and encrypted. Import GPX, KML/KMZ, GeoJSON, TCX and FIT files, your Google Timeline export (on-device or Takeout), an Apple Health export and photos with GPS; watch a folder for new watch files; connect Strava, Polar or Fitbit with your own app keys; receive live positions from OwnTracks (HTTP or MQTT), GPS trackers and your own Traccar server. Day, week, month and year views with stays and moves, trips built by themselves (day by day, map, distances, countries, bookings from mail and calendar), activities with charts, records, a heatmap and compare, and a map with online tiles or an offline outline. Privacy zones keep home and work out of exports; one switch deletes everything. Also in the palette ("Where is my laptop?"), the tray, the Island ("Arriving…") and "Show on Map" in the file browser. See [docs/TRACKS.md](docs/TRACKS.md).

### Cloud & servers

Your cloud storage, servers, home servers, NAS boxes and the other computers in the house, browsed like the folders on your own disk. Everything lives in the **Cloud & Servers** sidebar section.

- **Cloud storage, signed in through your browser**: Google Drive, OneDrive, Dropbox, Box, pCloud, MEGA, Proton Drive, iCloud Drive (beta), Google Photos, Amazon S3 and S3-compatible stores (Cloudflare R2, Backblaze B2, Wasabi, MinIO…), Azure, Google Cloud Storage and the rest of the roughly seventy services [rclone](https://rclone.org) supports. Keeper builds the sign-in form for each from rclone's own description of it, so new services appear when rclone adds them. Services that sign in through the browser never show Keeper your password; for the few that need one (MEGA, iCloud Drive) it is kept like the sign-in tokens: in rclone's settings file, encrypted with a key held in your system keychain.
- **Servers, built in and fast**: SFTP (password, key file or your SSH agent; the server's key is remembered and checked every time), FTP and FTPS, WebDAV (Nextcloud, ownCloud and others, self-signed certificates allowed only when you say so), and SMB shares opened by your system.
- **On this network**: Keeper looks for home servers (umbrelOS, CasaOS/ZimaOS, StartOS, YunoHost, Home Assistant, Raspberry Pi…), NAS boxes (Synology, QNAP, TrueNAS, Unraid, openmediavault, WD My Cloud, ASUSTOR, TerraMaster, UGREEN…), Macs, Windows PCs and Linux machines, says what each one is, suggests the best way in and lists the folders it shares — external drives plugged into it show up as their own shared folders, marked *External drive*. Step-by-step notes explain how to turn sharing on for a Mac, a Windows PC, a Linux box or a home server.
- **Browsing a connection** works like Browse: folders, pictures with thumbnails fetched only as they scroll into view (three at a time), Quick Look, New Folder, Rename, Delete (services with a trash keep it there), Download to your Downloads folder, Upload or drop files from your computer, drag a file out to another app, and transfers with progress and Cancel.
- **Open with its app, save back**: opening a file fetches it once into a cache (2 GB, oldest first out); saving it in its app sends the change back to the server. If the file changed on the server meanwhile, your edit is kept as a separate copy instead of overwriting.
- **Keep offline**: right-click a folder → *Keep Offline* to keep a copy in *Keeper Offline* in your home folder, refreshed when the computer is idle.
- **Stays working**: a green, amber or red dot shows each connection's state with its free space. Keeper checks only the connections you are using, slows down when you are away, pauses while the screen is locked, reconnects after sleep, and says plainly when a service needs you to sign in again (one click fixes it).
- **Library search** across a connection is off by default; turn on *Include in library search* to have its names, sizes and dates found by search.

More detail, including what was tested and what needs a real account to try: [docs/CONNECT.md](docs/CONNECT.md).

### Devices & remote access

**Keeper Link** joins your own computers and phones into one private network, with no account and no company server in the middle. The **Devices** sidebar section lists them; drop files on one to send them.

- **Pair once**: choose *Pair a Device* on one computer and type its six-digit code on the other (devices on the same network show up by themselves), or scan its QR code. Both screens then show the same six digits to compare, so nobody in between can slip in. Each device has its own key, kept in your system keychain.
- **End to end encrypted, whatever the path**: every connection is checked against the key of the device you paired with and encrypted between the two devices. Keeper connects over the local network when it can, otherwise through a tunnel or a relay — those only ever carry scrambled bytes.
- **Permissions per device**, all off by default except offering files: see shared folders, change them, shared clipboard, reach ports, and (for features built on Link) screen, control, terminal and sync.
- **Send files** both ways, asked first unless you choose *Always accept*; large files resume after a dropped connection and are checked with SHA-256 before they get their name. **Shared folders** open on the other device and on your phone; nothing else on the computer is reachable.
- **Ports**: reach a service on another device as if it were here (`localhost:3000` → its port 3000), or use it as a SOCKS5 proxy — only to that device itself unless you allow its local network too.
- **Your phone, no app**: *Devices → Phone* shows a QR code; the phone's camera opens a small Keeper page that sends photos and files to the computer, opens shared folders and reads or sets the clipboard. The key is only in the QR code (never sent to the computer or stored in the address bar), and the computer asks before letting a phone in.
- **From anywhere**: *Remote Access* has three levels — off, this network only, or from anywhere — and a *Never leaves my network* switch. From anywhere uses:
  - **a Cloudflare tunnel** (`cloudflared`, downloaded on demand from Cloudflare's releases and checked against pinned SHA-256 sums): a quick tunnel with no account, or your own hostname with a token from your Cloudflare dashboard. Keeper restarts it if it stops, waiting a little longer each time, after sleep and when its metrics show no connection; it can also be installed as a system service so it keeps running when Keeper is closed.
  - **an optional Keeper Relay** you run yourself (a small Node program, Docker image or Cloudflare Worker in [relay/](relay/)) for when neither side can reach the other.
  - **encrypted notes** on a public push service (ntfy-compatible, `ntfy.sh` by default, or your own) so paired devices learn each other's current address without any Keeper server.
- **Command line**: `keeper link status | devices | invite | pair | send | check | forward`.

How it works, the security design, how to run a relay, and what was and was not tested: [docs/LINK.md](docs/LINK.md).

### Keeper Mesh

A private IP network between your paired devices, built on WireGuard®. It is off by default (Settings → Features).

- **Every app** can reach your devices by address or by name (`laptop.keeper`), not just Keeper.
- **No Keeper server:** keys are exchanged and signed over Keeper Link.
- **Paths:** paths are found by hole punching, with the Keeper Relay as a blind fallback. Each device shows *Direct (LAN)*, *Direct (internet)* or *Relayed*.
- **Exit node, shared subnets and access rules:** an exit node has a kill switch. You can share a subnet (a NAS network). Guests get only the ports you allow. There can be more than one network (Home, Work).
- **Where the controls appear:** on the tray, the Island, the command palette and the Mesh page; you choose which, in Settings. There is also `keeper mesh …` on the command line.

See [docs/MESH.md](docs/MESH.md) for the design, what each system asks for, and what was tested. “WireGuard” is a registered trademark of Jason A. Donenfeld.

### Remote screens and phones

On top of Keeper Link, your devices can see and use each other's screens — no separate remote-desktop service, account or server.

- **View or control another computer**: *View Screen* or *Control* on a device's page (or right-click it in the sidebar). The other computer must allow *See this screen* (and *Control this computer*) for you, and its owner is asked each time — *Allow Control*, *Allow Viewing Only* or *Don't Allow* — unless they chose *Let it in without asking* for their own devices.
- **Always visible**: while anyone watches, a red banner sits at the top of the shared screen and the Island shows who it is, each with one-click **Stop sharing**. Sessions end after 15 minutes with no activity, and every session is listed under *Remote Access → Screen sessions*.
- **Direct when it can be, encrypted either way**: the picture goes peer to peer over WebRTC; the offer and answer travel inside the paired Link channel, and both sides check that the certificate WebRTC really used is the one stated there. If no direct connection can be made (strict networks, tunnel or relay only), the picture comes as frames through Keeper Link instead. *This network only* keeps WebRTC to local addresses.
- **The viewer**: fit or actual size, full screen, auto / fastest / balanced / sharpest quality (the host adapts bitrate, size and frame rate to the network), which screen to show, frames per second, data rate and delay, view-only, keys your own computer would catch (Ctrl+Alt+Del, Alt+Tab, ⌘Tab, Start, lock, screenshot), clipboard both ways, drop files on the picture to send them, chat, and recording the session to Videos/Keeper.
- **Control on each system**: Linux uses XTest (`xdotool`) on X11 — on Wayland the screen can be watched but not controlled; Windows uses SendInput; macOS uses the Keeper helper (CGEvent) and needs Accessibility and Screen Recording permission.
- **Wake-on-LAN**: Keeper learns each paired computer's network card while it is awake; *Wake* sends the magic packet from here and through every other awake device.
- **Your phone as a viewer and remote**: the phone page (*Devices → Phone*) has a **Screen** tab: watch the computer, tap where you want to click or use it as a touchpad (two fingers scroll, a long press right-clicks), arrow keys for presentations, media and volume keys, and typing. The computer asks first, and shows the same banner.
- **Direct between your devices**: when two devices meet through a relay or tunnel, Keeper punches a direct path and moves files, ports, terminals and screens onto it without dropping anything, and back again if it stops. The device page says *Direct*.
- **Help mode** (off until you switch it on): someone who is not paired reads you a 9-digit code and a password; you see their screen, they choose whether you may use it, and nothing is kept afterwards. A helper can also use a web browser.
- **Your devices at a glance**: groups, tags, notes, search, last seen, lock / sleep / restart, a system snapshot, a terminal on another device, saved commands (with the *Run commands* permission, off by default; the owner sees each new command once), printing there, and an exportable log of everything remote.
- **More in a session**: all screens or one window, follow the pointer, sound, voice chat, drawing on their screen, darkening it, a file panel, a second viewer, switching sides, restart and reconnect, codec choice and sharp text, and several screens in Keeper tabs.
- **Unattended access** (opt-in): a small system service keeps your own computers reachable after a restart and before login.
- **Everywhere, not just this page**: Get help, Help someone, your devices and live sessions (with Stop) in the tray, on the Island and in the palette; *Send to Device* in the right-click menu. Choose the places under *Devices → Remote Access*.
- **From the command line**: `keeper remote list | connect | help | exec <device> -- <cmd> | ssh-proxy | wake | send | forward | screenshot`, including `ssh -o ProxyCommand="keeper remote ssh-proxy %h" you@device`.
- **Android on this screen**: show and use an Android phone or tablet in its own window over USB or Wi-Fi (wireless debugging pairing built in), with view-only, screen-off and recording options; drop files on it (apps are installed, the rest goes to Download). Uses [scrcpy](https://github.com/Genymobile/scrcpy) (Apache-2.0), downloaded once and checked against its published SHA-256.
- **iPhone and iPad on this screen**: iOS allows showing its screen through AirPlay but never being controlled. On a Mac, Keeper opens the built-in AirPlay Receiver setting; on Linux it starts [UxPlay](https://github.com/FDH2/UxPlay) (GPL-3.0, a separate program from your package manager); on Windows UxPlay has to be installed by hand first.
- **Send to Device…** in every file's right-click menu sends to a paired computer or a connected Android phone; transfers show their progress in the Island.

Details, the security design and what was tested on which system: [docs/REMOTE.md](docs/REMOTE.md).

### Remote Desktops

Your other computers by any protocol, from one list (**Remote Desktops** in the sidebar), a quick-connect box (`Ctrl/⌘+Alt+R` from anywhere), the command palette, the tray menu, `.rdp`/`.vnc` files in the file manager, or `keeper rdc` in any terminal.

- **VNC drawn by Keeper** in a tab (or a window of its own): fit or 100 %, view only, clipboard, Ctrl+Alt+Del and other special keys. **Web consoles** (iDRAC, IPMI, Proxmox) open in a tab too, with a per-console certificate pin.
- **SSH, Mosh, Telnet, serial and PowerShell remoting** open in terminal tabs: jump hosts, X11 and agent forwarding, saved port forwards, and a fingerprint check on first connect. **Remote Desktop (RDP), SPICE and X2Go** open in the system's own client or FreeRDP, with the options mapped for you.
- **Reach them any way**: directly, through an SSH tunnel, an HTTP or SOCKS proxy, the mesh, or **through Keeper Link** without opening ports to the internet. Folders, tags, colours, favourites, status dots, Wake-on-LAN, and import/export of .rdp, .vnc, `~/.ssh/config` and JSON. Passwords stay in the system keychain, or are asked every time.
- **This computer**: switch on its own Remote Desktop or VNC server, let a paired device reach it through Keeper Link, and follow a short safety checklist.

Details and what was tested: [docs/REMOTE-DESKTOPS.md](docs/REMOTE-DESKTOPS.md).

### The Island

A small live panel at the top of your screen (or the left or right edge), hidden until something happens. Hover or click to expand.

**It fits every screen.** Keeper looks at each screen and places the Island around what is there:

| Screen | Where the Island goes |
| --- | --- |
| Mac with a notch (14″/16″ MacBook Pro, 13″/15″ MacBook Air) | It grows out of the notch in the same black, with what is going on to either side of it. Keeper finds the notch from the Mac's model and the screen's safe area, so it also lines up at "more space" resolutions. |
| Mac without a notch | Inside the menu bar when its middle is free of menus and icons, otherwise just below it. |
| GNOME, KDE and other Linux desktops | Just below a top bar (GNOME's clock stays visible), or flush with the top edge. |
| Windows laptops, other Linux laptops | Flush with the top edge under the camera, whichever side the taskbar is on. |
| Tablets and 2-in-1s | It follows the camera: turn the screen on its side and the Island moves to that edge. |
| External screens | Its own Island on each screen you choose: the main one, all of them, the laptop's own, or the one with the pointer. |

Size (compact, normal, large), a nudge, the camera's edge and a small camera dot are in Settings → Island, with a picture of each screen showing what Keeper found. When the Island is closed its window is exactly the size of the pill, so it never covers menu-bar icons, tabs or title bars around it.

**Live activities.** Whatever is going on gets a slot by importance: the most important takes the pill (an icon on one side of the notch, a countdown, waveform or progress ring on the other), the next one becomes a small bubble beside it, and the rest are counted. Click, tap or rest the pointer on it for a **Live Activity card** with controls; *More* opens everything. On touch screens tap to open, swipe down for everything, swipe up to close, press and hold for the card. Activities: dictation, screen recording, a coding agent waiting or stuck, plugging in the charger, a meeting starting soon, low battery, the focus timer, long jobs (converting, cleaning up, finding duplicates, locking a folder), music, something copied, headphones connecting, rain soon, unlocked folders and keep-awake. Each kind can be turned off. Green and orange dots show while an app uses the camera or microphone (Windows and Linux; macOS shows its own lights).

Limits: Linux on Wayland does not let apps keep a small window on top in a set place, so with the Island on Keeper runs through XWayland (switch it off in Settings if you prefer). Apps cannot change the Mac's own notch or the system's volume and brightness pop-ups, so the Island works alongside them.

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
- **Dictation** — hold a key (or press the shortcut) in any app, speak, and finished text is typed at the cursor: recognised on this computer by default, live as you speak, with spoken commands, formatting, a personal dictionary, snippets and per-app tone. **Meetings** records your microphone and the computer’s sound, transcribes and tells speakers apart on this computer, and writes notes. See [docs/VOICE.md](docs/VOICE.md).
- A small **buddy** face that reflects what is going on.

**Island tools.** Twenty tools in tabs; choose which appear and in what order (drag them in Settings → Island → Tools, or right-click a tab). The Island opens on hover after a delay you set, on click, or with <kbd>Ctrl/⌘ Alt I</kbd>:

- **Ask** — any AI you connected, local model first; quick actions (rewrite, shorter, summarize, extract, brainstorm, fix grammar) on the clipboard or a dropped file. Local-only mode is respected.
- **AI Usage** — Claude Code, Codex, Copilot and Cursor use and limits, read from files those tools keep on this computer; exact limits from the provider only if you tick *Exact limits*.
- **Sales** — today, this week and this month from Stripe, Shopify, Lemon Squeezy, Gumroad, Paddle, Polar and Dodo Payments, converted to one currency, with a 30-day chart and an optional note for each new sale. Keys stay in the system keychain; refunds, failed and test payments are left out.
- **Stocks** — a watchlist of shares and crypto with sparklines (no key needed; a Twelve Data key is optional).
- **Calendar** — a month view and the day's events from every calendar Keeper knows (and the Mac's own calendars), with *Join* buttons.
- **To-Dos** — quick starred to-dos plus your reminders (and the Mac's Reminders app), checked off in place.
- **Notes** — quick notes that save as you type, searchable and pinnable.
- **Teleprompter** — your script scrolls just under the camera at your reading speed, or only while you speak; countdown, mirror flip, size and speed, keyboard control; import text, Markdown or Word files.
- **Mirror** — a camera preview with flip, framing guides, a lighting hint and a microphone level.
- **Focus** sounds (white, pink, brown noise, rain) and the Clock's timers; **Weather** for seven days; **System** (CPU, memory, disks, network); **Convert** units and currencies as you type (`5 ft in cm`, `€20 in usd`); **Emoji** search with skin tones and recents; **Shortcuts** (Mac Shortcuts, your rules and scripts).
- The **Shelf** can share files and keep copies of what you drop (kept for the days you choose); **Clipboard** skips copies password managers mark secret or temporary, and Alt-click deletes one; media keys can control Now playing.

Every tool that reaches the internet is off until you turn it on, and nothing runs while the Island is closed except the new-sale note you asked for. Details: [docs/ISLAND-TOOLS.md](docs/ISLAND-TOOLS.md).

### Locked folders

Right-click a folder in Browse and choose **Lock Folder…**. Keeper encrypts everything inside into one file next to it, `Taxes.keeperlock`, reads the whole thing back to check every file, and only then removes the unencrypted folder. In Keeper a locked folder shows with a lock; double-click it to unlock.

- **How it opens**: *Your account* (Touch ID or your Mac password; Windows Hello with face, fingerprint or PIN, or your Windows password; on Linux your password, or fingerprint where it is set up for polkit). The key lives in the system keychain, so this only works on the computer that locked it. Or *a password* of its own, which works on any computer with Keeper and is never stored.
- **A recovery key** is always made (eight groups of four characters) and must be saved before locking. It opens the folder when the password is forgotten or the computer changes.
- **Lock again automatically** when Keeper quits, when the screen locks or the computer sleeps, or after some minutes; or right-click → *Lock Again Now*. Settings → *Locked folders* lists every one.
- **Encryption**: AES-256-GCM with a random key per folder, in 1 MB chunks that cannot be reordered, cut off or swapped. Names, sizes and dates are encrypted too. Passwords and recovery keys are stretched with scrypt. After a few wrong tries Keeper waits longer and longer between them.
- **Safe to interrupt**: until the locked copy is checked, the original is untouched; unlocking writes to a temporary folder first. A crash leaves at worst both copies.

Good to know:

- Only Keeper can open a `.keeperlock` file. Keep Keeper (or a copy of it) if you keep locked folders.
- Lose the password *and* the recovery key, and the files are gone for good. Nobody can recover them, Keeper included.
- Removing the original deletes it permanently instead of moving it to the Trash, where it would still be readable. On SSDs and some file systems, deleted blocks can stay on the disk until they are reused; for files that were never meant to be unencrypted, lock the folder before putting them in, or use full-disk encryption (FileVault, BitLocker, LUKS) as well.
- The locked file's own name (the folder's name) is not hidden.
- Macs have Touch ID, not Face ID, and apps cannot use an Apple ID to unlock things. Without Touch ID, the Mac asks for an administrator's password.

### Themes

Settings → Appearance shows all 38 themes as live previews, on shelves you can filter (All, Main, Seasonal, Unique, Dark, Light) or search, plus **Surprise me**. Click one (or move with the arrow keys) and every window, the Island and widgets switch at once. Each also appears in the command palette as “Theme: …”.

**Main collection**

| Theme | Feel | Modes |
|---|---|---|
| Playful | Keeper’s own warm, bright colours | light, dark |
| Minimal | black, white and grey | light, dark |
| Blossom | petal pink and lavender, soft round corners | light, dark |
| Steel | gunmetal and safety orange, square | light, dark |
| Terminal | phosphor green, all monospace | dark |
| Midnight Code | navy with violet and teal | light, dark |
| Ocean | sea glass and deep water | light, dark |
| Forest | moss, fern and bark | light, dark |
| Sunset | coral, amber and plum | light, dark |
| Paper | sepia and serif, like an e-reader | light, dark |
| Academia | oak, ink and brass | light, dark |
| Neon Nights | synthwave magenta and cyan | dark |
| Candy | bubblegum brights for kids | light |
| Luxe | black lacquer and gold | light, dark |
| Zen | stone, rice paper and matcha | light, dark |
| Retro 95 | grey bevels on a teal desktop | light |
| High Contrast | maximum legibility | light, dark |
| Cozy Coffee | espresso, oat milk and caramel | light, dark |
| Fjord | slate, mist and cold clear water | light, dark |
| Terracotta | sun-baked clay and linen | light, dark |
| Sage | soft botanical greens, rounded | light, dark |
| Deep Sea | teal light falling into dark water | light, dark |
| Dusk | lavender sky with a line of peach | light, dark |
| Dune | wind-carved sand and warm light | light, dark |
| Editorial | black ink on white with one bold red, serif | light, dark |
| Solarpunk | leaf green and solar gold | light, dark |
| Circuit | graphite with an electric blue current | light, dark |
| Champagne | rosé and pearl, serif | light, dark |

**Seasonal** — turn on **Follow the seasons** and Keeper switches by itself on the right day, for your half of the world (from your weather place, your time zone, or your choice). Choosing any theme by hand turns it off.

| Theme | When | Modes |
|---|---|---|
| Frost | winter: snow light and ice blue | light, dark |
| Spring Meadow | spring: fresh grass and blossom | light, dark |
| Summer Haze | summer: sun, sand and a turquoise sea | light, dark |
| Autumn Ember | autumn: maple, pumpkin and amber | light, dark |
| Festive Lights | 15 December – 6 January everywhere: evergreen, gold and a string of lights | light, dark |

**Unique showpieces**

| Theme | Feel | Modes |
|---|---|---|
| Blueprint | technical drawing: grid paper and drafting blue, monospace | light (whiteprint), dark (blueprint) |
| Aurora | green, blue and violet light over a polar night | dark |
| Frosted Glass | translucent, blurred panels over soft colour (solid where the system cannot blur) | light, dark |
| Ink Wash | brush ink on rice paper with a red seal, serif | light, dark |
| Amber CRT | a warm amber monitor with scanlines, monospace | dark |

Decorations are drawn once and never animate, so themes cost nothing while Keeper sits idle; Minimal resource mode drops the decorative backgrounds altogether.

On top of any theme you can pick your own accent colour, a font (system, rounded, serif or mono, all from fonts already on your computer), compact density and sharp corners. Every theme’s text and buttons meet WCAG AA contrast, checked by the tests in `test/themes.test.ts`.

<p><img src="docs/screenshots/themes-gallery.png" width="49%" alt="The theme gallery in Settings"> <img src="docs/screenshots/themes-terminal-dark.png" width="49%" alt="Keeper in the Terminal theme"></p>
<p><img src="docs/screenshots/themes-blossom-light.png" width="49%" alt="Keeper in the Blossom theme"> <img src="docs/screenshots/themes-steel-dark.png" width="49%" alt="Keeper in the Steel theme"></p>

### Quick Search, tray and deep links

- **Quick Search** (<kbd>Ctrl/⌘ Shift Space</kbd>, changeable): recent files when empty, live plain-English results; <kbd>↩</kbd> opens, <kbd>Ctrl/⌘ ↩</kbd> shows in Keeper, <kbd>Alt ↩</kbd> shows in the folder.
- **Command palette** (<kbd>Ctrl/⌘ K</kbd>) for every page and action.
- **Tray / menu bar**: the newest downloads (drag or click), Quick Search, copy text from screen, keep awake, Clean Up. Keeper keeps running in the tray so shortcuts, the Island and rules keep working.
- **`keeper://` links** for scripts, launchers and shortcuts: `keeper://search?q=…`, `keeper://ask?q=…`, `keeper://open?path=…`, `keeper://reveal?path=…`, `keeper://capture`, `keeper://quick`, `keeper://clean`, `keeper://awake?minutes=60`.

### Works with your computer

Keeper uses what your operating system already offers, each part switchable in **Settings → Works with your computer** ([details](docs/PLATFORM.md)):

- **Any AI app** that speaks MCP (Model Context Protocol) can search and read your library, with Keeper's safety rules. **Copy setup** gives a ready-made entry.
- **Ask Keeper from anywhere**: <kbd>Ctrl/⌘ Shift K</kbd> opens Quick Search ready for a question; `keeper://ask?q=…` does the same from scripts and shortcuts.
- **macOS**: **Apple Intelligence** as the assistant's model (on-device, no key; macOS 26 on Apple silicon), **Live Text** for text in images, Keeper's knowledge in **Spotlight**, and step-by-step **Shortcuts / Siri** and Services setups.
- **Windows**: Windows' own **text recognition**, **“Search with Keeper”** in File Explorer, a taskbar menu, and registration with the **on-device agent registry** where Windows has it.
- **Linux**: Keeper's results in **GNOME's Activities search** and **KDE's KRunner**, and launcher actions.

Honest limits: Siri phrases and Shortcuts actions of their own need an Xcode-built app (Keeper offers links and the `keeper` command instead); Windows' local AI model is only offered to Store-packaged apps.

### Ashforde apps: Monorail

Keeper works hand in hand with **[Monorail](https://github.com/ashfordeOU/monorail)**, Ashforde's free scrolling window manager for macOS. Switch it on in **Settings → Ashforde apps** (off by default; macOS 13 or later — coming to Windows and Linux when Monorail supports them). Details: [docs/ASHFORDE-APPS.md](docs/ASHFORDE-APPS.md).

- **Install, update, uninstall** from Keeper: the latest GitHub release is downloaded, its **SHA-256 checksum** and **code signature** are checked (and the certificate is pinned, so later updates must come from the same signer) before it goes into Applications. Accessibility access is one click away.
- **Connect** turns on Monorail's local API (this computer only, with a private key) and its state file, after keeping a copy of its settings.
- **Together**: the Island tells you which workspace and slide you slid to; Monorail's actions and workspaces are in Keeper's command palette; Focus sessions and presentation mode switch Monorail's too; Keeper's small windows float above the strip; the Island stays clear of the slider bar; Monorail can follow Keeper's theme; and Keeper warns when both apps want the same shortcut (also on the To do list).
- **AI apps** connected to Keeper's MCP server get Monorail's tools (`monorail_list_windows`, `monorail_pair_windows`, `monorail_apply_layout`…): looking is allowed, anything that moves a window asks you first (Off / Ask / Allow).
- **Light**: while on, one file watch on Monorail's folder and an update check a day; off, nothing at all.

### Toolbox

Small tools, all offline: copy text from screen (with QR), colour picker, dead-pixel test, keyboard-cleaning lock, link cleaner, **hide personal info before pasting into AI tools**, case converter, word counter, hidden-character inspector, password and passphrase generator, JSON formatter (with exact error position), Base64, SHA hashes, UUID v4/v7, JWT decoder, timestamp converter, regex tester, Wi-Fi sharing code, saved Wi-Fi passwords, and eject all drives.

### Terminal

A full terminal inside Keeper — on the **Terminal** page, in its own window (tray → *Terminal*, or ⌘⌥T / Ctrl+Alt+T), or dropping down from the top of the screen (Ctrl+`).

- **Tabs and split panes** in any arrangement; drag the dividers, zoom one pane, move between panes with the keyboard, save a layout as a workspace and open it again later.
- **Every shell on the computer**: zsh, bash, fish, Nushell and the rest on macOS and Linux; PowerShell 7, Windows PowerShell, Command Prompt, every WSL distribution and Git Bash on Windows. Plus your SSH hosts from `~/.ssh/config`, using your own keys and agent.
- **Terminals keep running** when the window closes, and — if you choose — even after Keeper quits. Open them again from *Sessions*. When they do stop, their scrollback is saved and can be read after a restart.
- **Profiles**: shell, starting folder, variables, start-up command, colours (12 schemes, or follow Keeper's theme), font, cursor, and the language programs use. A profile can **keep its sign-ins separate** — its own config folders — so the same command-line tool can be signed in to a different account in each profile, side by side.
- **Working together**: a sister terminal (same folder), the same terminal shown in two panes, typing into every pane at once (with a confirmation), and groups whose terminals share notes and a folder (`$KEEPER_SHARED_DIR`) that programs inside can read.
- **Knows what ran**: with shell integration each command gets a green or red mark, its exit code and how long it took; jump between commands; find in scrollback. Triggers watch for patterns (for example a program waiting for your answer) and tell you in the Island.
- **Files on the other end**: an SFTP or FTP/FTPS panel beside the terminal — browse, download, upload by dragging, rename, delete. Passwords live only in the system keychain.
- **Web tools in a tab**: start a notebook server or a code editor's web server for a folder and use it inside Keeper; any page served by this computer (`localhost`) opens in a pane. Desktop development apps can't run inside another app's window, so *Open folder in…* opens them beside Keeper instead.
- Every shortcut can be changed; pasting several lines asks first; dropping files types their quoted paths.

More in [docs/TERMINAL.md](docs/TERMINAL.md).

**Agent terminals and the agent hub.** AI agents get the same terminals people use, through MCP tools (`term_*`, `hub_*`), `keeper term …` / `keeper hub …` and the **Agents** view:

- **Terminals built for agents**: exact start, end and exit code for every command in any shell; clean, bounded output (errors kept, the full log saved, secrets blanked); no hangs on pagers; a program waiting for an answer is reported instead of timing out. Agents can open **sub-workers** that run in parallel, end with their parent and have time limits and quotas.
- **Mixed agents working together**: Claude Code, Codex, Gemini, Grok, Cursor, aider, opencode and others, even signed in to different accounts, see each other, message each other in rooms and directly, share a **task board** (post, claim, hand off with context), locks and notes. Agents without MCP are reached through the **bridge**, which types the message in when the agent is idle and passes its answer back.
- **You stay in charge**: agents need your permission to use terminals; risky commands wait for a yes; allow and deny lists and folders agents must stay in; transcripts; take over any terminal and hand it back; **Stop all** at once. Ready-made teams: plan-build-review, fan-out, compare answers, consensus.

Research and design notes: [docs/TERMINAL-RESEARCH.md](docs/TERMINAL-RESEARCH.md).

### To do and guided fixes

One **To do** list (sidebar → System, with a count) for everything worth doing about space, storage, security, privacy, speed, the network, backups and updates — most important first, each with why it matters and a **Fix**:

- **Keeper does it** after showing exactly what will change (emptying the Trash, stopping heavy apps from starting at sign-in, locking folders again), with **Undo** where possible.
- **Open it for me**: the exact page of macOS System Settings, Windows Settings, GNOME Settings or KDE System Settings, then numbered steps with a simple drawing of what to press. The steps can stay on top in a small window while you work in System Settings, and **I did it — check** confirms it worked.
- **How do I…?** in the command palette and on the To do page: free up space, stop apps using my camera or microphone, encrypt my disk, turn on the firewall, back up my photos, block trackers, and more.
- Findings also show on the pages they belong to (Clean Up, Space Map, Backups, VPN…), important new ones are mentioned once in the Island, and there is a short first-run tour plus one-time tips on complex pages. The guide speaks Keeper's ten languages. Details: [docs/GUIDE.md](docs/GUIDE.md).

### System

- **Health**: CPU, memory, uptime and load; battery level, health and cycle count; the busiest processes (with Quit); **what is keeping the computer awake**; and **local servers listening on a port** (open in the browser or stop).
- **System monitor**: live readings in the menu bar / tray with a pop-over (off by default; runs only while shown), a year of history with zoomable charts and CSV, Dev & agents (dev servers by project with open/stop/restart; running coding agents and model servers with Quit session), Sensors (GPU, temperatures, fans, power draw — public interfaces only), process signatures and a hidden-by-default environment, `keeper ps/top/kill/ports/dev/sensors`, and a global **tool launcher** that opens any tool in its own small window. See [docs/MONITOR.md](docs/MONITOR.md).
- **Processes and Services** (Health → Processes): a full task manager. Every running process with CPU, memory, threads, energy, disk and network, sorted by any column, as a flat list, a parent–child tree or grouped by app, with live graphs per core and for memory, swap, disk and network. Quit, Force Quit, End Process Tree, Suspend and Resume, Restart, change priority, and Inspect (open files, connections, memory breakdown, children). Other users' and system processes ask for an administrator first, and processes the system needs to stay up are refused with a reason. **Force Quit Applications** opens with ⌥⌘Esc (Ctrl+Alt+Esc elsewhere). The Services tab starts, stops, restarts and enables system and user services (systemd, launchd, Windows services). It reads the system only while the page is open: about 1% of one core at one update a second on Linux.
- **Startup Items**: apps that start with the computer, with a rough impact rating; switch them off with the same setting the OS uses (reversible; system-wide items ask for permission).
- **Applications**: every installed app with size, version and last use; filter unused or large ones; uninstall via the app's own uninstaller (Windows), the Trash plus leftover support files (macOS) or Flatpak/Snap (Linux).
- **Privacy & Security**: see [below](#privacy--security) — the old Protection score is now part of it.

### Keep Awake

Stop the computer sleeping when you need it, and let it sleep again on its own (System → **Keep Awake**). Details and the full feature list: [docs/KEEP-AWAKE.md](docs/KEEP-AWAKE.md).

- **Sessions**: until you turn it off, for a while (your own list of quick durations, or type `1h30m`), until a time (`18:30`), or **while** something is true — an app runs or is in front, a file downloads, a folder keeps changing, a process or the computer is busy, sound plays, the network is busy, an external display / drive / USB / Bluetooth device is connected, on a Wi-Fi network, a VPN is up, an AI agent works, or Keeper has a job running. A timed session can be extended (+15 min, +1 h) and reminds you before it ends.
- **What a session allows**: keep the screen on or let it sleep; allow the screen saver after N idle minutes; **keep running with the lid closed** (macOS after a one-time administrator step, Windows by setting the lid action and putting it back, Linux through systemd-inhibit) — it ends itself on low battery, Low Power Mode or heat, and a watchdog puts the setting back if Keeper quits or crashes; end below a battery level, in Low Power Mode or when you put the computer to sleep; only while plugged in; keep external drives spinning; nudge the pointer for apps that mark you away; Do Not Disturb (macOS through your Shortcuts, GNOME); notifications and sounds; lock the screen at the end.
- **Triggers**: start and end sessions by themselves — days and times, apps, Wi-Fi, IP address or DNS server, VPN, battery and power, displays and mirroring, USB and Bluetooth devices, drives, idle time, sound output, processor use, calendar events, terminals and AI agents, downloads. Combine conditions with all/any and "not", order them by priority, test "would it match now?", and choose how long a trigger waits after you end its session by hand.
- **From anywhere**: the page, the Island (with the time left), the tray menu, an optional separate menu-bar icon (five icon styles, time left next to it on macOS), the global shortcut, the command palette, `keeper awake on --for 2h`, `keeper://awake?for=30m` links, and Siri / Shortcuts on macOS.
- **What keeps this computer awake**: every app's holds, from `pmset -g assertions`, `powercfg /requests` or `systemd-inhibit --list`. **Statistics**: sessions, time awake per day, longest, why each ended, battery used.
- **Costs nothing when idle**: with no session and no trigger on there is no timer, no helper process and no polling at all; a session checks every 15 seconds, triggers every 30 seconds (slower while you are away).

### Stage

A clean screen for recording, presenting and screenshots (System → **Stage**). Details, the per-system table and what is a best guess: [docs/STAGE.md](docs/STAGE.md).

- **Every switch on its own**: hide desktop icons, the Dock or taskbar, other apps, the menu bar, or apps you choose (hide or quit, and reopen); Do Not Disturb (through Keep Awake), mute alert sounds, pause music; a clean backdrop (colour, gradient or blurred wallpaper), normal pointer size, a pointer spotlight or ring, click ripples, keystrokes (shortcuts only, or every key); keep awake, a recording resolution, a clean clipboard history, private things hidden in the Island, and Keeper's own windows kept out of recordings.
- **Presets**: Recording (with a 3-2-1 countdown), Presenting and Screenshot, plus your own. Each can have a time limit and its own shortcut.
- **From anywhere**: a global shortcut, the Island (a button, a Controls tile, and a red dot with the time while on), the tray, the command palette, `keeper stage on --preset Recording`, `keeper://stage/toggle` and AI abilities. It can also **start by itself when the screen is captured**: reliably on Linux (PipeWire) and for Keeper's recorder, by known recorder apps elsewhere.
- **Crash-safe**: every change is written to a journal before it is made and put back newest first when Stage ends, on the next start after a crash, or by a watchdog if Keeper's process disappears. Settings you changed yourself while it was on are left alone.
- **External monitors**: switch a monitor's input source (HDMI, DisplayPort, USB-C) over DDC/CI, and brightness and volume shortcuts with a level display.

### Privacy & Security

**Privacy & Security** (System → Privacy & Security) puts in one place who can watch you, where your data goes, how well the computer is protected, and checks for malware. It opens on a **score out of 100**, the **three things most worth doing**, and plain-English findings. Each finding has **Why**, a **Fix** (one click when Keeper can do it safely, otherwise the right settings page or step-by-step help) and **Ignore**. They also appear on the To do list.

- **Who can watch**: which apps may use the camera, microphone, screen, location, contacts, files and accessibility. On macOS this comes from the privacy database, on Windows from its consent store, and on Linux from Flatpak and portal permissions plus PipeWire. It shows what is in use right now and recent camera and microphone use, and you can **revoke** access or open the system page.
- **Connections**: for each app, how many trackers it talks to, in which countries, unencrypted traffic and how much data it sends (built on Network Activity). An optional **Keeper browser extension** ([browser-extension/](browser-extension/)) adds the same for each website. It only observes and reports to Keeper on this computer through native messaging, and it needs access to all sites to see them.
- **Browsers**: each Chromium-family browser and Firefox profile, with:
  - extensions and their risk (broad access, sensitive permissions, not from the store, known-bad ids);
  - whether passwords are saved (the files are never opened);
  - sync and Secure DNS.

  There is also a **password check** using Have I Been Pwned's k-anonymity range (only the first 5 characters of a SHA-1 leave the computer).
- **Security checks**:
  - updates, firewall and disk encryption;
  - SIP, Gatekeeper and XProtect on macOS, or Microsoft Defender on Windows;
  - screen lock, automatic login and use of an administrator account;
  - sharing services, open listening ports and Wi-Fi security;
  - added root certificates and kernel extensions;
  - diagnostics and telemetry.
- **Malware**: protection in layers, using:
  - Keeper's own heuristics;
  - YARA rules (built-in plus your own);
  - hash lists;
  - **ClamAV** (installed and updated in one click, signatures kept in Keeper's folder);
  - optional hash-only lookups at MalwareBazaar;
  - Defender on Windows.

  Keeper also offers:
  - **real-time** checks of Downloads, Desktop and Documents;
  - quick, full, custom and scheduled scans with progress and **Stop**;
  - an **encrypted quarantine** (AES-256-GCM) with Put back and Delete.
- **Startup items and behaviour**: alerts when something new sets itself up to start automatically (launch agents, systemd units, Run keys, scheduled tasks, cron), and when a coin miner or a program running from a temp folder appears.
- **Timeline** of everything above, important events in the Island, and **Save report**.

**No security tool detects everything, and Keeper doesn't either.** Detection depends on signatures and rules that are always behind the newest threats. Keeper adds layers to the protection already built into your system; it doesn't replace that protection. What each system supports, and what has been tested where, is in [docs/SECURITY-CENTER.md](docs/SECURITY-CENTER.md).

### Network Activity and VPN

**Network Activity** (System → Network Activity) shows which app talks to whom, how much, and which way the traffic leaves the computer:

- **Apps**: every program with a connection, how many places it talks to, download and upload rates and totals, the countries involved, and whether its traffic goes **through the VPN**, **direct** (straight out through your router), stays on the **local network**, or never leaves **this computer**. Open an app to see each destination with its host name, the service behind it (Google, Apple, Cloudflare…), the network that owns the address and what the port is for.
- **Destinations**: the same from the other side — each server or device, which apps talk to it, how much.
- **Connections**: every socket with local and remote ends, state and interface; **Export** saves them as a spreadsheet.
- **Health**: latency and lost answers to your router and to an internet host, every interface with its addresses and traffic, the DNS servers in use (and whether they are inside the VPN), and Wi-Fi details.
- Download and upload graphs split traffic **through the VPN** from traffic **outside it**.
- Optional: a note in the Island when an app goes online for the first time; **countries and networks** from a table kept on this computer (downloaded once, ~12 MB, from [DB-IP Lite](https://db-ip.com), CC BY 4.0 — no address is ever looked up online).

**VPN** (System → VPN) lists the VPN connections the system knows (NetworkManager, wg-quick and WireGuard on Linux; the VPNs in System Settings on macOS; built-in VPNs and WireGuard tunnels on Windows) with Connect and Disconnect, and answers *is everything really going through it?*: IPv4 and IPv6 routes, DNS servers outside the tunnel (a DNS leak), and **what the internet sees** — your public address, and the address outside the VPN for comparison (only when you press the button). Connections can **reconnect automatically** if they drop (not after you disconnect them yourself). **Import a VPN file** reads a WireGuard `.conf` or OpenVPN `.ovpn`, checks it (bad keys, missing IPv6 or DNS, weak ciphers), shows it with every key hidden, and hands it to the system's VPN manager — Keeper never keeps the keys in a plain file; it can keep an encrypted copy in the system keychain if you ask. Kill-switch advice for your system is one click away.

What each system allows, in [docs/NETWORK.md](docs/NETWORK.md): per-connection amounts on macOS (nettop) and Linux (with `ss` from iproute2); on Windows, connections and owners without administrator rights but traffic amounts only for the whole computer. Reading happens only while the page is open: about 1% of one core every 2 seconds on Linux.

**The map.** Network Activity's **Map** tab draws every connection as an arc from this computer to its server's country, coloured by whether it goes through the VPN, straight out, or is blocked; pick an app to see only its connections, click a place to see who talks to it. Each app's details have a small map too. The world outline (Natural Earth, public domain) ships with Keeper; nothing is looked up online.

### Firewall

A per-app network firewall, free. **Rules** say which app may connect where — by the app's path and code signature (so a rule survives the app moving), or for groups of apps (system processes, developer tools, browsers) — to a host, a domain with its subdomains, an address range, a port or range, a protocol, outgoing or incoming; the most specific rule wins, a tie goes to deny, and temporary rules last until Keeper quits or for an hour.

- **Alerts** for new connections: who, where (country, network, known service, reverse name), code signature, path — allow or deny always, until quit, for an hour or once, for that host or its whole domain. **Explain** asks your AI what the connection is. Alerts also appear in the Island and as a small card on any page.
- **Quiet modes**: allow and remember (decide later), or deny everything without a rule — per **profile**, and profiles switch by Wi-Fi name or router.
- **Rule groups** of your own or **subscribed** from an address, refreshed daily, with a pinned checksum or a signing key if you want; **tidy-up** finds broken, expired, duplicate and redundant rules; import, export, and `keeper fw` on the command line.
- **DNS filter** for every app: curated **blocklists** by topic (ads, trackers, malware, telemetry, gambling, attack addresses — off until you pick them, updated daily), your own blocked and allowed domains, trackers hidden behind an innocent alias caught too, a query log, and **encrypted DNS** over HTTPS or TLS (Quad9, Cloudflare, Mullvad or your own).
- **Monitoring**: live connections by app, host or country with search tokens (`app:firefox host:google -country:us port:443`), the world map, **a year of traffic history** per app, warnings when an app sends far more than usual, optional sounds per rule.

What is enforced depends on the system, and Keeper says so on the page: on **Windows** rules become Windows Defender Firewall rules per program (and can block whatever no rule allows); on **Linux** address and port rules go into nftables and per-app rules through OpenSnitch when it is installed; on **macOS** this build blocks addresses and ports with the system packet filter and hosts through the DNS filter — per-app blocking needs Apple's network-filter permission on the signing certificate (the filter's source is included). Details, sources and what was tested: [docs/FIREWALL.md](docs/FIREWALL.md).

### Quick Controls

Network, firewall, privacy and security settings in one place. The page lives in the System section; there are also tiles in the Island, a tray / menu-bar submenu and command-palette entries.

| Group | Controls |
|---|---|
| Network | Wi-Fi, Bluetooth, airplane mode, VPN, encrypted DNS for the whole system, IPv6, hotspot, treating the network as public, AirDrop and Wake on LAN |
| Firewall | the system firewall, stealth mode, block all incoming, Keeper's firewall mode, rules and DNS filter, and blocklists |
| Privacy | camera, microphone and location (for all apps or one app at a time), advertising ID, diagnostics, clipboard history and sync, activity history, lock after sleep, Bluetooth discovery and Find My |
| Security | Keeper's real-time protection and quarantine, Gatekeeper, Defender real-time protection, SmartScreen and automatic updates |

Each control says honestly how it works on your computer:

- **Direct:** Keeper switches it.
- **Needs password:** the system asks for the administrator password, once for a whole batch.
- **Opens Settings:** the system does not let apps change it, so Keeper opens the exact page.
- **Not on this system.**

Turning something to its less protective value always asks first and says why. Every change goes into a change list with **Undo**. Settings are read only when you look at them.

The presets are **Public Wi-Fi**, **Home**, **Presenting / private** and **Lockdown**. Each shows its plan before it runs. A preset can follow a firewall profile, but it then applies only safe, password-free changes by itself. Each group can be switched off in Settings → Features.

What each system allows, the exact commands, sources and what was tested: [docs/QUICK-CONTROLS.md](docs/QUICK-CONTROLS.md).

### Notes

Open **any folder of Markdown files as a vault** and write in it — the files stay plain `.md` files in that folder, so a vault you already keep with another notes app opens as it is and keeps working there too ([details and the full feature table](docs/NOTES.md)).

- **Your vault, as it is**: `[[links]]` with `#headings`, `#^blocks` and `|aliases`, `![[embeds]]` of notes, sections, blocks, pictures, PDFs and audio, properties (frontmatter) with types, nested `#tags`, callouts, footnotes, `==highlights==`, `%%comments%%`, KaTeX math and Mermaid diagrams. The vault's own settings folder is read: where attachments and new notes go, how links are written, trash, daily notes, templates, bookmarks and property types.
- **Editor**: live preview, source mode and reading view; `[[` suggests notes and aliases, `#` suggests tags, `/` inserts headings, tasks, callouts, tables, code, math and diagrams; tables line up on Tab; headings fold; Ctrl/Cmd-hover previews a link; optional vim keys and spellcheck; paste or drop pictures, or record audio, into the note.
- **Find your way**: backlinks with linked and **unlinked mentions** (one click links them), outgoing links, outline, tags, bookmarks, recent files, a quick switcher (Ctrl+O), commands (Ctrl+P), random note, tabs and split panes, saved workspaces, and a **graph** of the vault or of the notes around one.
- **Search with operators**: `path:` `file:` `tag:` `content:` `line:( )` `block:( )` `section:( )` `task:` `task-todo:` `task-done:` `[property:value]` `"phrases"` `OR` `-not` `( )` `/regex/` and `match-case:`.
- **Renames keep links working**: renaming or moving a note or folder rewrites every link to it across the vault (wiki and Markdown links, headings and aliases kept), and canvases that show it.
- **Daily, weekly and monthly notes** from templates (`{{title}}`, `{{date:dddd}}`, `{{time}}`, `{{yesterday}}`, `{{date+7d:YYYY-MM-DD}}`…), **canvas** boards saved as standard `.canvas` files, **bases** (`.base` table and card views with filters, formulas, sorting and grouping), the **note composer** (merge notes, extract a selection), **slides**, word count, **file recovery** snapshots, and **publishing** chosen notes as a plain static website.
- **Keeper's own extras** (all opt-in): ask the vault and get answers that cite notes, summarize, continue writing, suggest links and tags (with the AI you chose for Keeper's brain); AI agents may edit notes only when you allow it, and the version before every change is kept; `keeper/notes` for agents and the command line (search, read, today's note, capture).
- **Plugins**: a small sandboxed plugin model (a worker with no file, network or system access; only the calls you allow). Community plugins written for other notes apps are listed but not run — they expect full access to your computer.
- **Light**: nothing runs while the Notes page is closed; a 10,000-note vault is indexed in about a second, and the editor, math, diagrams and code colouring load only when first needed.

### Keeper's brain

Keeper reads the text inside your files once, on your computer, and keeps it ready, so **any AI you use finds things instantly instead of crawling your disk** ([details](docs/BRAIN.md)).

- **Everything indexed**: names, folders, dates and download sources, plus the text inside Word, PowerPoint, Excel, OpenDocument and EPUB files, PDFs, e-mails (`.eml`), Markdown, web pages, notebooks, subtitles, source code, and screenshots (on-device text recognition). Long files are split into passages, so answers point at the part that matters.
- **Search by words and by meaning**: a word index (BM25) plus, when you turn it on, a small multilingual model that runs on your computer (multilingual-e5-small, 8-bit, 129 MB download, checked against a pinned SHA-256). *“Money back when I move out”* finds the deposit clause in your lease. Both mix with the search bar's filters (*“pdfs from gmail last month”*). Vectors are built in the background, off the main thread, paused on battery.
- **Any AI, the same results**: the Assistant works with **Claude**, **OpenAI**, any service that speaks the OpenAI format (OpenRouter, Groq, Mistral, DeepSeek, Gemini, xAI, Azure), models on your computer (**Ollama**, **LM Studio**, **llama.cpp**, **Jan**), and **Apple Intelligence** on Macs that have it. Models that can use tools search and read as they go; smaller ones get the best matches handed to them first. Answers cite the files they used, and changes (move, rename, tag, Trash, open) come back as **buttons — nothing happens until you press one**.
- **Other AI apps can use it too**: Keeper is an **MCP server**. **Connect** adds it to the Claude desktop app, VS Code, Cursor, Windsurf, LM Studio or Zed (Keeper asks first, keeps the rest of the file, and saves a backup); a copyable entry works with any other MCP app, and `claude mcp add` with Claude Code. An optional **local API** on 127.0.0.1 (with a token) serves search, read and ask over HTTP.
- **You decide what AIs see**: names only, matching passages, or whole files. **Passwords, API keys, private keys, card and bank numbers are blanked** before anything goes to an AI on the internet or to a connected app. *Only use AIs on this computer* keeps everything local. Excluded folders are never read.

Honest limits: the meaning model is small, so it is good at topics and paraphrases but can miss across languages in short notes; images are understood through their text and names, not by what they show.

### Agents and the knowledge graph

Any AI can work with Keeper — and do things in it, only as you allow.

- **Every AI service**: Anthropic, OpenAI (chat and Responses), Google Gemini, xAI Grok, Mistral, DeepSeek, Cohere, Moonshot, Qwen, Perplexity; OpenRouter, Together, Groq, Fireworks, Cerebras, Hugging Face, NVIDIA NIM; Azure OpenAI, Amazon Bedrock, Vertex AI; Ollama, LM Studio, llama.cpp, vLLM, Jan; any OpenAI- or Anthropic-compatible address. Live model lists, tokens and cost per connection, a **fallback** chain when one fails, and **private folders** that keep a conversation on a local AI.
- **Agents act, with your permission**: agents connected over MCP can move, rename, tag, create folders, send to the Trash, open files, run automations, read the clipboard, look at running programs, explain why the computer is slow, pause or quit programs. Each action is Off, Ask or Allow; *Ask* shows who wants to do what, and nothing happens until you say yes. Everything is in History under the agent's name and can be undone.
- **One click to connect** the Claude desktop app, Claude Code, Codex CLI, Gemini CLI, Cursor, VS Code, Windsurf, Zed, LM Studio, OpenClaw and Hermes Agent; **start agents** in a folder in Keeper's Terminal, with **profiles** so two accounts of the same agent stay signed in side by side.
- **Skills** in the open SKILL.md format, shared with your other agents; the assistant reads one only when it needs it. *Save as skill* turns a good answer into one.
- **Model gateway** for other tools (OpenAI- and Anthropic-compatible, on 127.0.0.1 with a token; `keeper/brain` answers from your files), **agent-to-agent** (A2A) and **`keeper acp`** for editors.
- **Knowledge graph**: files, notes, tags, people, organisations and sources, linked by Markdown and `[[wiki]]` links and their backlinks, shared names, tags and similar meaning — existing Markdown vaults work as they are. Smooth with thousands of nodes; agents can explore it too.
- **Learns your habits, privately** (off by default): repeated moves, opens and searches become suggested automations, pins and saved searches. Forget everything with one button.
- **Siri and Alexa**: a Shortcut with `keeper ask --plain`, and an [Alexa skill template](integrations/alexa) that reaches your Keeper through your own tunnel.

Details, safety and exactly what was tested: [docs/AGENTS.md](docs/AGENTS.md).

### Abilities for every AI

Whichever AI you use — Claude, OpenAI, Gemini, Grok, a model on this computer — and whichever agent (Claude Code, Codex, Cursor or any MCP client), it gets the same abilities through Keeper: in the Assistant, over MCP, through the gateway (ask for `model+abilities`, or turn it on for every model) and from other agents. Agents → **Abilities** sets each one to Off, Ask or Allow; **Stay on this computer** switches off everything that reaches the internet.

- **Search the web** with numbered sources: SearXNG (yours), Brave, Tavily, Exa, Kagi, Google Programmable Search or xAI — or, with no key, encyclopedia and instant answers. **Read a page** (public addresses only, never your home network) and **research a question**: plan searches, read the best pages, write a cited report saved in your library, within step, page and time limits.
- **Search posts**: X (with an xAI key), Hacker News, Mastodon hashtags, Bluesky (app password) and Reddit (your app id).
- **Pictures**: make and edit with OpenAI, Gemini, xAI, Stability AI, or the Stable Diffusion web UI / ComfyUI on this computer; saved to *Pictures/Keeper AI*. **Look at a picture**: any AI that sees images gets it, plus the text read from it on this computer.
- **Run code** — JavaScript or Python in a sealed workspace: no internet, your files hidden, a time limit (Linux: namespaces; macOS: the system sandbox; Windows: JavaScript only, in Node's permission model).
- **Memory** you control: every memory listed, editable and deletable; shared, per persona or per project; memories go to cloud AIs only if you allow it.
- **Schedules**: “every weekday at 8:30 summarise my calendar and mail”, “in 2 hours remind me…”, or a cron line — answered by your AI with its abilities, delivered to the Island, a notification or a file.
- **Personas and projects**: how an assistant talks (never claiming to be a real person), and a set of folders, instructions and memories it keeps to.
- **Voice**: talk to the Assistant (speech to text with any OpenAI-compatible service, including one on this computer) and hear answers in your computer's voices; hands-free if you like.
- **Teams**: several AIs on one request — side by side, writer and reviewer, a panel with a chair, a planner with workers, or “best for the job” (private requests stay on this computer). Members are your AI services and agent sessions in Keeper's Terminal.

Text from the web is passed to the AI marked as data, never as instructions. Web search, posts and cloud pictures need the service's key; [docs/ABILITIES.md](docs/ABILITIES.md) says what was tested and what needs a real account.

### System Settings+, App controls and Browser tabs

**System Settings+** (System section, or type a setting's name in the command palette) is a searchable catalogue of 397 settings that usually need a terminal command or a buried switch: 137 on macOS (`defaults`, `pmset`, Spotlight, Gatekeeper), 133 on Windows (registry, power, services, optional features such as WSL, Hyper-V and SMB 1.0) and 127 on Linux (GNOME `gsettings`, kernel `sysctl`, systemd services, the clock). Each entry says what it does, which versions it applies to, whether it needs the administrator password, what has to restart, how risky it is, and where it is documented. Keeper only runs catalogue operations: you see the exact command first, it saves a backup of the area before the first change each day, every change goes into a log with **Undo**, and backups restore in one click. Favourites, an AI **Explain** button, and **setup profiles** (export what you changed, preview and apply on another computer) are built in. Files Keeper should not edit for you (GRUB, fstab, hosts) are explained with steps. Full list: [docs/SETTINGS-CATALOG.md](docs/SETTINGS-CATALOG.md).

**App controls** (and “App settings” on Applications, Processes and Network Activity) set things per app: network allow/block (a firewall rule), an upload limit (Windows QoS; Linux cgroup + nftables + tc; macOS by port only), routing through or around the VPN (Linux), CPU priority, a CPU limit (Windows job object, Linux cgroup v2; macOS background mode only), a memory limit (Windows, Linux), pause and resume, pause in the background (macOS), start at login, notifications (Windows, GNOME), always-light appearance and app language (macOS), app volume (Windows, PipeWire/PulseAudio), graphics card (Windows), default app for a file type (macOS, Linux) and keeping the computer awake while the app runs. Each control says what your system cannot do instead of pretending.

**Browser tabs** shows every open tab across linked browsers (Chrome, Edge, Brave, Vivaldi, Opera and Firefox, through Keeper's extension) with mute, sleep, show and close, data used and the other sites each page talks to, per-site camera / microphone / location / notifications / JavaScript / cookies (Chromium browsers), tracker blocking from Keeper's blocklists, clearing a site's data and sending chosen sites through a proxy. Safari is not linked yet (Safari extensions can only talk to an app they ship inside).

AI agents can use all three through abilities with permissions (search settings: allowed; change a setting, see or control tabs, tune an app: asks first). Each is a feature in Settings → Features and costs nothing in the background.

### An AI that uses your computer, and the system's assistants

- **Use this computer** (off until you turn it on): the Assistant — with Claude, OpenAI, Grok, Gemini, a local model or any other AI you set up — and agents connected over MCP (Claude Code, Codex, Cursor…) can see the screen, click, type, open apps and press buttons by name through accessibility. With Claude 5.5 and later Keeper uses Claude's own computer-use toolset; every other AI gets the same abilities as one tool. Keeper asks first, the Island shows it while it works with **Stop**, and **⌃⌥⌘.** / **Ctrl+Alt+Shift+.** stops every AI at once. Password managers, keychains, terminals and banking windows are off limits, passwords are never typed, and every action is logged with a small picture of what the AI saw.
- **Keeper Browser and private desktops**: the AI can also work in a browser of its own, reading pages as numbered elements and clicking, typing, uploading and downloading. On Linux it can work in a private desktop that leaves your screen alone. It keeps a plan, checks that each step worked, notices when it is stuck and stays within step and time budgets. It always asks before buying, paying, sending, posting or deleting. Saved sign-ins (keychain, 1Password or Bitwarden) are filled by Keeper, so the AI never sees them. Web pages are treated as untrusted, so text hidden in a page can't take over. Take over a tab and hand it back, or record a job once and replay it with new values, on a schedule, when Keeper starts or when the computer wakes. On your own screen the AI clicks numbered controls (from accessibility, or text read off the screen on this computer). GPT and Gemini models use their own built-in computer tools, under the same rules. Your phone (Keeper Link) shows what the AI is doing and can answer its questions. More in [docs/COMPUTER-USE.md](docs/COMPUTER-USE.md).
- **Siri, Spotlight and Shortcuts** (macOS): *“Ask Keeper”*, *“Search files with Keeper”*, *“Open Health in Keeper”*, *“Start focus with Keeper”*, *“Lock my folders with Keeper”*, plus Shortcuts actions that return answers and files — from a small App Intents helper inside Keeper.app.
- **Writing Help** in every Keeper text field (right-click): proofread, rewrite, friendlier, more professional, shorter, summarize — with your AI, including Apple's on-device model.
- **Copilot and Windows agents** through the Windows agent registry (MCP), and **Linux desktop assistants** through D-Bus (`org.ashfordeou.Keeper.Actions`: ask, search, open a page, focus, lock folders, run an automation).

What works on each system and with each assistant — and what Apple and Microsoft do not allow third-party apps to do: [docs/AI-SYSTEM.md](docs/AI-SYSTEM.md).

### Assistant

Ask anything about your files — *“what's the Wi-Fi password in my screenshots?”*, *“how much do I owe on open invoices?”*, *“what can I safely delete?”*. It searches and reads through Keeper's brain with the AI you chose (keys stored in your system keychain), shows which files it looked at, cites them, and offers its suggestions as buttons.

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
keeper ask <question>      Ask about your files with the AI chosen in Keeper (cites files)
keeper search --semantic   Search Keeper's brain by meaning (--brain: words inside files too)
keeper brain               What Keeper's brain has read
keeper mcp                 Keeper as an MCP server for AI apps (stdio)
keeper acp                 Keeper as an agent for editors (Agent Client Protocol, stdio)
keeper ask --plain "…"     Just the answer, as text (for Siri Shortcuts and scripts)
keeper link …              Keeper Link: devices, invite, pair, send <file> <device>, check, forward
keeper awake [on|off|toggle|status|extend|blockers|stats]  Keep the computer awake (--for 2h, --until 18:30, --while-app Zoom, --allow-display-sleep, --closed-lid)

--in <folders>  --json  --limit <n>  --hidden  --yes
```

---

## Everyday tools, checked one by one

Keeper's Convert page, Toolbox, Capture and Annotate have about a hundred everyday tools:

- **Video:** download, merge, burn in subtitles, crop, resize, replace the sound, media info.
- **Audio:** clean up, and transcribe on this computer with a built-in speech model (every OS, no upload).
- **Images:** hide faces, remove background, scan to PDF (finds and straightens the page, also from a phone's camera).
- **PDFs:** a drag-and-drop page organizer, true redaction, fill and sign forms, make scans searchable, PDF to Word, and passwords with print and copy limits.
- **Documents:** Word, presentations, spreadsheets, web pages and Markdown to PDF, plus translation of whole documents and subtitles that keeps their layout and timings.
- **Files:** password ZIPs.
- **Developer tools.**
- **System:** external display brightness, contrast and volume, iPhone and iPad backups in the storage view, and tweaks for macOS, Windows and Linux.

Every Convert tool also runs from the command line: `keeper tool list` lists them, and `keeper tool <name> <files> --json` runs one.

[docs/TOOLS.md](docs/TOOLS.md) checks each tool against a standard 94-tool list and a screen-text-capture feature list. It says where each one lives, whether Keeper matches it or does more, and how each was tested.

---

## Keyboard shortcuts

<kbd>Ctrl</kbd> on Windows and Linux is <kbd>⌘</kbd> on macOS.

| Find | | View | | Tidy and play | |
|---|---|---|---|---|---|
| Quick Search (any app) | <kbd>Ctrl Shift Space</kbd> | Grid / List | <kbd>Ctrl 1</kbd> / <kbd>Ctrl 2</kbd> | Duplicates | <kbd>Ctrl Shift D</kbd> |
| Search | <kbd>Ctrl F</kbd> | Bigger / smaller cards | <kbd>Ctrl +</kbd> / <kbd>Ctrl −</kbd> | Clean Up | <kbd>Ctrl Shift K</kbd> |
| Command palette | <kbd>Ctrl K</kbd> | Inspector | <kbd>Ctrl I</kbd> | Play / pause | <kbd>Ctrl Space</kbd> |
| Downloaded From | <kbd>Ctrl Shift J</kbd> | Preview | <kbd>Space</kbd> | Move to Trash | <kbd>Ctrl ⌫</kbd> / <kbd>Delete</kbd> |
| Copy text in selected images | <kbd>Ctrl Shift C</kbd> | Switch theme | <kbd>Ctrl Shift L</kbd> | Back | <kbd>Ctrl [</kbd> |
| Copy text from screen (any app) | <kbd>Ctrl Shift 2</kbd> | Settings | <kbd>Ctrl ,</kbd> | Dictation (any app) | <kbd>Ctrl Shift ;</kbd> |
| | | Show / hide hidden files | <kbd>Ctrl Shift .</kbd> | | |
| New tab / close tab | <kbd>Ctrl T</kbd> / <kbd>Ctrl W</kbd> | Reopen closed tab | <kbd>Ctrl Shift T</kbd> | Next / previous tab | <kbd>Ctrl Tab</kbd> / <kbd>Ctrl Shift Tab</kbd> |
| Open in a new tab | middle-click or <kbd>Ctrl</kbd>-click | Tab 1–9 | <kbd>Alt 1–9</kbd> (<kbd>⌃1–9</kbd> on macOS) | | |

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
| Favorites, cloud drives, disks with eject, network servers and Trash with Put Back in one sidebar | ✅ | ✅ same on every OS |
| Google Drive, OneDrive, Dropbox, S3 and ~70 cloud services, SFTP/FTP/WebDAV servers and home servers browsed inside the app | — | ✅ |
| Recent downloads in the tray, Quick Search over any app | — | ✅ |
| Clipboard history, shelf, focus timer, keep-awake | — | ✅ |
| Startup items, installed apps, security check, system health | separate tools | ✅ |
| Same app on Windows, macOS and Linux, plus a CLI | — | ✅ |

---

## Tabs, and never losing your place

- **Tabs** in every window: middle-click or ⌘/Ctrl-click anything to open it in a new tab, or right-click a sidebar entry → *Open in New Tab*. ⌘T / Ctrl+T new tab, ⌘W / Ctrl+W close, ⌘⇧T / Ctrl+Shift+T reopen the last closed one; pin, duplicate, drag to reorder, or move a tab into its own window. Each tab keeps its own page, Back/Forward, scroll and drafts. Tabs in the back use almost no memory. (Switch theme is now ⌘⇧L / Ctrl+Shift+L.)
- **Crash-proof.** Every window, tab, scroll position and unsent draft is saved within a second. A window that crashes reopens at once with its tabs; if Keeper itself is killed, a tiny watchdog starts it again with everything where it was, and after repeated crashes it starts in safe mode (only the library on) instead of looping.
- **Parts run on their own.** Network Activity's sampling runs in its own process (stopped when not used); terminals live in their own session host and keep running when windows close.
- **System → Keeper's processes** shows every Keeper process with CPU, memory, restarts and the last problem — Stop, Restart, Disable, *Stop all background work*, *Restart in safe mode*, *Copy report*. Crash reports stay on this computer.

More in [docs/RESILIENCE.md](docs/RESILIENCE.md).

## Light on your computer

Keeper does a lot, but it keeps out of the way. One part of it, the governor, decides when background work may run and how often anything looks at the computer:

- **It fits around you.** Reading text in documents and pictures, and building meaning search, slow down while you work, wait while the computer is hot, short of memory or on battery, and catch up when you are away or the screen is locked.
- **Checks slow down when nobody looks.** The clipboard, now playing, disks and the rest look less often after a minute without input, pause while the screen is locked, and speed up the moment you are back.
- **No programs started over and over.** Full-screen detection, now playing and the microphone check use one long-running helper or a tiny system tool instead of a new process every few seconds. Download sources are read for hundreds of files at once.
- **Memory is let go.** Text recognition unloads a minute after the last picture; the main window's page is released after 15 minutes closed to the tray (2 in Minimal mode) and reopens where you were.
- **Your choice.** Settings → Keeper's own usage shows Keeper's processor and memory use right now, what runs in the background and why it waits, with three modes: **Minimal**, **Balanced** (default) and **Performance**.
- **Switch off what you do not use.** Settings → Features lists every part of Keeper with what it costs. Turning one off stops it completely: no window, no timers, no watchers, and its pages and menu items leave the sidebar. Presets: Everything, Balanced, Minimal and Files only — plus **your own saved sets** (for example "Travel"), and a set to switch to by itself **on battery** and another **on power**. Each feature shows what it has running right now ("check every 15 s", or nothing). A test fails the build if a page, sidebar entry or command-palette entry has no feature that owns it.

Measured on Linux with a 14,400-file library (Xvfb, one minute per state, all of Keeper's processes together; memory is PSS, which shares common pages fairly):

| | Before | Now (default features) | Only the library on |
|---|---|---|---|
| First scan | 165 s, 99 s of processor | 2.3 s, 2.3 s of processor | — |
| Reading text in 6,700 documents | 277 s, 71 s of processor | 154 s, 25 s of processor | — |
| Idle, window open | 2.3 % of one core | 0.9 % | 0.1 % |
| Idle, closed to the tray | 2.4 % | 0.5 % | 0.3 % |
| Wake-ups per second (main process) | 105 | 25–35 | 3 |
| Programs started per minute | 99 | 6–13 | 2–8 |
| Memory | 440–580 MB | 340–490 MB | 270–310 MB |

Meaning search, when you turn it on, builds its index at about 30 % of one core while you work and at full speed while you are away. A check in CI starts the built app and fails if Keeper idles above 1 % of a core or 550 MB.

---

## Privacy

- **Your files never leave your computer.** Indexing, search, text recognition, duplicate detection and cleanup all run locally.
- **No account, no ads.** Keeper sends anonymous usage stats once a day (see [Usage stats](#usage-stats)); switch them off any time.
- Network requests Keeper makes, and only when the feature is on:
  - **Text-recognition language data** — downloaded once per language from the Tesseract data mirror, then cached. Images are never sent.
  - **Weather** — your chosen place's coordinates to [Open-Meteo](https://open-meteo.com) (no key, no account).
  - **Lyrics** — the song title, artist and length to [LRCLIB](https://lrclib.net).
  - **Calendar** — the `.ics` link you entered.
  - **Assistant and connected AI apps** — what you allowed in *What AIs may see* (names only, matching passages, or files it opens), with secrets blanked, to the AI you chose; nothing at all with an AI on this computer.
  - **Meaning-search model** — downloaded once from Hugging Face when you turn meaning search on, checked against a pinned SHA-256. Your text is never sent anywhere to build it.
  - **Dictation** — your recorded audio to the speech-to-text address you configured.
  - **Cloud & servers** — only to the services and servers you connect, directly from your computer. Signing in to a cloud service opens its own page in your browser.
  - **Firewall** — nothing unless you turn something on: blocklist downloads (from the lists you pick, daily), rule subscriptions (from the addresses you add, daily), and DNS questions to the encrypted resolver you choose when the DNS filter is on.
  - **Network Activity** — host names for addresses through your normal DNS server (can be turned off); the country table from DB-IP once, if you turn countries on; latency checks to your router and one internet host while the Health tab is open; and *What the internet sees* asks api.ipify.org for your public address only when you press it.
  - **Update check** — once a day, the latest release number from GitHub (can be turned off).
  - **Usage stats** — once a day, a small anonymous report to `telemetry.ashforde.org` (on by default; off with one switch). Listed in Keeper's firewall like any other app's connection, and blockable there.
- API keys are encrypted with the operating system's keychain (Electron `safeStorage`). On Linux without a keyring, Keeper refuses to store keys rather than store them weakly.
- Passwords and secret keys you copy are not kept in clipboard history.

## Usage stats

Keeper sends anonymous usage stats once a day to help us improve it. You can switch this off at any time, and here is exactly what is sent.

- **What:** a random install ID made on your computer (resettable), Keeper's version and whether it is an official build, the operating system and its version, processor family and core count, memory rounded to 4/8/16/32/64+ GB, graphics maker, laptop or desktop, number of screens, the system's language and region setting, which features are on, which pages were opened (rough counts), how many AI services and devices are connected (numbers only), crash and restart counts, and Keeper's own memory, processor use and start-up time as ranges.
- **Never:** file names, paths or contents, searches, AI prompts, account names, e-mail addresses, user or computer names, your internet address or location from it, serial numbers, MAC addresses, Wi-Fi names, or which apps you have.
- **See it:** Settings → Privacy → *See exactly what's sent* shows the last report and the next one, field by field and as the exact text.
- **Switch it off** in any of four ways: the switch in Settings → Privacy (or in the welcome tour), `KEEPER_TELEMETRY=0`, `DO_NOT_TRACK=1`, or an administrator's policy file (`{ "usageStats": false }` in `/etc/keeper/policy.json`, `/Library/Application Support/Keeper/policy.json` or `%ProgramData%\Keeper\policy.json`). Once off, nothing more is sent, not even a goodbye.
- **How:** at most once a day, when the computer is idle and online; days that could not be sent wait, at most a week. Stored for 13 months, then only totals are kept.

The full list with examples, the legal basis and how to ask about your data: [docs/PRIVACY-USAGE-STATS.md](docs/PRIVACY-USAGE-STATS.md). The server is in [server/telemetry](server/telemetry).

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

```bash
# macOS and Linux
curl -fsSL https://raw.githubusercontent.com/ashfordeOU/keeper/main/scripts/install.sh | sh
```

```powershell
# Windows (PowerShell)
irm https://raw.githubusercontent.com/ashfordeOU/keeper/main/scripts/install.ps1 | iex
```

The scripts check every download against the release checksums and add the `keeper` command. Homebrew, winget, Scoop, Chocolatey, the AUR, Flatpak, Snap, apt and dnf repositories, npm (`keeper-cli`), uninstalling and verifying downloads are all covered in **[docs/INSTALL.md](docs/INSTALL.md)**.

Or download the latest build from **[Releases](https://github.com/ashfordeOU/keeper/releases/latest)**. The file names never change, so these links always give you the newest version:

| System | Download | Notes |
|---|---|---|
| **macOS 12+** — Apple silicon (M1–M4) | [Keeper-mac-arm64.dmg](https://github.com/ashfordeOU/keeper/releases/latest/download/Keeper-mac-arm64.dmg) | Open, drag Keeper into Applications |
| **macOS 12+** — Intel | [Keeper-mac-x64.dmg](https://github.com/ashfordeOU/keeper/releases/latest/download/Keeper-mac-x64.dmg) | |
| **Windows 10/11** (also runs on Windows on ARM) | [Keeper-setup-x64.exe](https://github.com/ashfordeOU/keeper/releases/latest/download/Keeper-setup-x64.exe) | Installer, per user, no admin needed |
| Windows, no install | [Keeper-portable.exe](https://github.com/ashfordeOU/keeper/releases/latest/download/Keeper-portable.exe) | Runs from anywhere, e.g. a USB stick |
| **Linux** x64 — any distribution | [Keeper-linux-x86_64.AppImage](https://github.com/ashfordeOU/keeper/releases/latest/download/Keeper-linux-x86_64.AppImage) | `chmod +x` and run |
| Linux ARM64 | [Keeper-linux-arm64.AppImage](https://github.com/ashfordeOU/keeper/releases/latest/download/Keeper-linux-arm64.AppImage) | |
| Debian, Ubuntu, Mint, Pop!_OS | `Keeper-linux-amd64.deb` / `-arm64.deb` | `sudo apt install ./Keeper-linux-amd64.deb` |
| Fedora, RHEL, openSUSE | `Keeper-linux-x86_64.rpm` / `-aarch64.rpm` | `sudo dnf install ./Keeper-linux-x86_64.rpm` |
| Other Linux | `Keeper-linux-x64.tar.gz` | Unpack anywhere and run `keeper` |

Every release also lists `SHA256SUMS.txt`, a Sigstore signature of it and GitHub build attestations; see [Verifying a download](docs/INSTALL.md#verifying-a-download).

### Updates

Keeper keeps itself up to date from these releases. In **Settings → Updates** you choose:

- **Install updates automatically** (default) — new versions download in the background and install the next time Keeper quits; a banner offers “Restart and update” sooner.
- **Ask before installing** — Keeper tells you a new version is out (banner, notification and tray menu), shows what changed, and waits for you.
- **Only when I check** — Keeper never looks on its own; press **Check now** whenever you like.

You can also opt in to **beta versions**. After an update, **What’s new** shows the release notes once.

| How Keeper was installed | How it updates |
|---|---|
| Windows installer, Linux AppImage | Replaces itself in place |
| macOS dmg | Downloads the new version, swaps the app in Applications and reopens (the old copy goes to the Trash) |
| Linux .deb / .rpm | Downloads the new package and installs it with your system’s password prompt |
| Windows portable, .tar.gz | Tells you and opens the download |

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
| Privacy & Security (posture, permissions, browsers, malware layers) | ✅ | ✅ | ✅ |
| Now playing + lyrics | System media session | Music, Spotify | MPRIS (`playerctl`) |
| Microphone-in-use | ✅ | — | ✅ |
| Dictation typing | ✅ | ✅ | X11 `xdotool` / Wayland `wtype` |
| Battery health & cycles | level | ✅ | ✅ |
| Tags | Keeper tags | Keeper tags | Keeper tags |
| System text recognition | Windows.Media.Ocr | Live Text (Vision) | built-in reader |
| On-device AI model | — (Store apps only) | Apple Intelligence (macOS 26) | local model via Ollama |
| Desktop search | Explorer “Search with Keeper” | Spotlight | GNOME search, KRunner |
| AI agents (MCP) | ✅ + agent registry | ✅ | ✅ |

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

Before your first pull request, read the contributor terms in [CONTRIBUTING.md](CONTRIBUTING.md#contributor-terms): you keep the copyright in your work and give Ashforde OÜ a licence to use it, including in commercial versions of Keeper. Tick "I agree to CONTRIBUTING.md" in the pull request to confirm.

## License

Keeper is **free to use**, for everyone, at home and at work. Its source code is public so you can read it, check what it does with your files, build it yourself and change it for your own use.

Keeper is **source-available**, not open source. It is licensed under the [PolyForm Shield License 1.0.0](LICENSE.md):

- ✅ Use Keeper for any purpose, personal or professional, in any organisation.
- ✅ Read, build and change the code for yourself or your organisation; fork it on GitHub to send changes.
- ✅ Build tools, scripts and integrations that work with Keeper.
- ❌ Do not sell, resell, rent or offer Keeper (or a modified Keeper) as a product or service that competes with it, paid or free, without written permission from Ashforde OÜ.

"Keeper by Ashforde®", "Ashforde®" and the Keeper logo are trademarks of Ashforde OÜ. The licence grants no trademark rights: modified builds must use a different name and logo. Official builds are the signed ones from the official website and [GitHub Releases](https://github.com/ashfordeOU/keeper/releases). See [TRADEMARKS.md](TRADEMARKS.md).

Want to do something the licence does not allow, or need a commercial licence? See [COMMERCIAL.md](COMMERCIAL.md) or write to **contact@ashforde.org**.

Copyright © 2026 Ashforde OÜ.

Keeper includes third-party components under their own licences, listed in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md). Among them: [Electron](https://www.electronjs.org) (MIT), [React](https://react.dev) (MIT), [Tesseract.js](https://tesseract.projectnaptha.com) (Apache-2.0), [jsQR](https://github.com/cozmo/jsQR) (Apache-2.0), [sharp](https://sharp.pixelplumbing.com) (Apache-2.0) with libvips (LGPL-3.0-or-later, dynamically linked), [libheif](https://github.com/strukturag/libheif) (LGPL-3.0) and the [Anthropic TypeScript SDK](https://github.com/anthropics/anthropic-sdk-typescript) (Apache-2.0). Video features use [FFmpeg](https://ffmpeg.org) (GPL-3.0-or-later), shipped as a separate program; its licence and source are listed in THIRD-PARTY-NOTICES.md. Forecasts by [Open-Meteo](https://open-meteo.com) (CC BY 4.0) and lyrics by [LRCLIB](https://lrclib.net). [IP Geolocation by DB-IP](https://db-ip.com) (CC BY 4.0) when countries are turned on in Network Activity. World map outlines from [Natural Earth](https://www.naturalearthdata.com) (public domain) via [world-atlas](https://github.com/topojson/world-atlas) (ISC).

---

<p align="center"><sub><b>Keeper by Ashforde®</b> · © 2026 Ashforde OÜ · Ashforde® is a registered trademark of Ashforde OÜ.<br>Source-available under the PolyForm Shield License 1.0.0; free to use. The Keeper and Ashforde names and logos identify official builds.</sub></p>
