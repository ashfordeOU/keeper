# Changelog

All notable changes to Keeper are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] — 2026-10-31

First release of **Keeper by Ashforde®**, for macOS, Windows and Linux.

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

### Places, tabs-free browsing and themes
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
- Updates from GitHub: automatic, ask, or only when you check; choose when an update installs (now, on quit, tonight, a time) with a countdown; Keeper reopens where you left off.
- Install with the dmg, the Windows installer or portable exe, AppImage, deb, rpm or tar.gz, or with one-line scripts; Homebrew, npm, winget, Scoop, Chocolatey, AUR, Snap, Flathub, apt and dnf channels switch on as their publishing keys are added. Every release carries build attestations and a Sigstore signature of its checksums.

