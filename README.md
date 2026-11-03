<p align="center">
  <img src="docs/screenshots/hero.webp" width="100%" alt="Keeper by Ashforde®: the app window with the Island open above it">
</p>

<h1 align="center">Keeper <sub><sup>by Ashforde®</sup></sub></h1>

<p align="center">
  <strong>One install, a whole suite for your computer, and your files stay on it.</strong><br>
  Files, Mail & Calendar, Notes, the Island, widgets, Studio and more, for <b>macOS, Windows and Linux</b>. Switch on only the parts you want.
</p>

<p align="center">
  <a href="LICENSE.md"><img alt="License: PolyForm Shield 1.0.0" src="https://img.shields.io/badge/licence-PolyForm%20Shield%201.0.0-6d6dff"></a>
  <a href="https://github.com/ashfordeOU/keeper/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/ashfordeOU/keeper/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="Platforms: Windows, macOS, Linux" src="https://img.shields.io/badge/platforms-Windows%20%C2%B7%20macOS%20%C2%B7%20Linux-a35cf0">
  <img alt="Price: free to use" src="https://img.shields.io/badge/price-free%20to%20use-ff6fa3">
</p>

<p align="center">
  <a href="#install">Install</a> ·
  <a href="#what-keeper-is">What Keeper is</a> ·
  <a href="#highlights">Highlights</a> ·
  <a href="#privacy">Privacy</a> ·
  <a href="#updating">Updating</a> ·
  <a href="#documentation">Docs</a> ·
  <a href="#license">License</a>
</p>

---

## What Keeper is

Keeper is one app you install once, made of parts you switch on and off in **Settings → Features**:

| Part | What it does |
|---|---|
| **Files** | A file manager and library: folders, search, Quick Look, copy and move, duplicates, the Space Map |
| **Mail & Calendar** | Every mail account and calendar in one place, with tasks, reminders and the Planner |
| **Notes** | Plain Markdown notes in folders you own, plus your notes from other apps in one search |
| **The Island** | A live panel at the top of the screen: music, timers, the next meeting, new mail, a drop shelf |
| **Widgets** | Desktop widgets: Week, Timer, World clock, Unread mail and more |
| **Studio** | Record the screen and edit it into a finished video |
| **Tidy** | Clean up space, old downloads and duplicates, with your files going to the Trash |
| **Sync & Backup** | Backups, synced folders and cloud mirrors, each with Pause and Edit |
| **Privacy & Security** | A score, the findings worth fixing, a firewall and network activity |
| **Devices** | Your computers and phones paired with a code: send files, share the clipboard, see another screen |
| **AI** | Any AI you choose, or one on this computer, with what it may see and do set by you |
| **Screen** | Dictation, copy text from the screen, screenshots, Stage for clean recordings |
| **Desktop** | Live wallpaper, Vibes, Weather, Places & Tracks |
| **Keep Awake** | Keep the computer awake for a while, while work runs, or with the lid closed |

**The parts run in their own processes.** The Island, the widgets and Mail keep working if the main window stops, and a part that is off has no process at all ([docs/SUITE.md](docs/SUITE.md)).

**The installer stays small.** Heavy pieces that only some parts use (video tools, on-device AI, cloud connections) are downloaded when you switch those parts on. The offline installer has everything inside ([docs/COMPONENTS.md](docs/COMPONENTS.md)).

## Highlights

- **Your files stay here.** Search, text in pictures, duplicates, cleanup, notes and dictation run on this computer. No account, no ads.
- **Nothing is lost.** Files go to the Trash, every change is in History, and moves and renames can be undone.
- **Mail that keeps up.** Important and Other inboxes, Send later, snooze, Follow up, one-click unsubscribe, rules and warnings about fake senders.
- **One search for everything.** Files, mail, events, tasks, contacts, notes, settings and Keeper's own pages from one box.
- **Folders like Finder and File Explorer.** Icons, list, columns or gallery; copy, cut, paste and drag, with Replace, Keep Both or Skip.
- **Studio.** Automatic zooms from your clicks, captions made on this computer, and export to MP4, WebM or GIF up to 4K.
- **The Island.** Sizes from Compact to Extra large, your calendars, and new important mail with Archive and Mark read.
- **Plain settings.** Two panes, search that understands everyday words, and every changed setting marked with a Reset.
- **The same everywhere.** macOS, Windows and Linux, plus the `keeper` command for terminals. Where a system can't do something, Keeper says so.

<p>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/home-dark.webp">
    <img src="docs/screenshots/home-light.webp" width="49%" alt="Keeper's Home: the library by kind, disk use, recent downloads and the inspector">
  </picture>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/island-expanded-dark.webp">
    <img src="docs/screenshots/island-expanded-light.webp" width="49%" alt="The Island open: now playing with lyrics, weather, the next meeting and battery">
  </picture>
</p>
<p>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/notes-dark.webp">
    <img src="docs/screenshots/notes-light.webp" width="49%" alt="Notes: a Markdown vault with a note in reading view, backlinks and outgoing links">
  </picture>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/privacy-dark.webp">
    <img src="docs/screenshots/privacy-light.webp" width="49%" alt="Privacy and Security: a score out of 100 and the findings most worth fixing">
  </picture>
</p>
<p>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/devices-dark.webp">
    <img src="docs/screenshots/devices-light.webp" width="49%" alt="Devices: paired computers grouped by place, with what each allows">
  </picture>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/awake-dark.webp">
    <img src="docs/screenshots/awake-light.webp" width="49%" alt="Keep Awake: start a session for a while, until a time or while something is going on">
  </picture>
</p>

Everything in 1.0 is listed in the [changelog](CHANGELOG.md).

---

## Install

Every download is on the **[Releases](https://github.com/ashfordeOU/keeper/releases)** page. A version can come out for macOS first, so pick the newest release that lists your system's file. The install scripts do this for you.

### macOS

```bash
curl -fsSL https://raw.githubusercontent.com/ashfordeOU/keeper/main/scripts/install.sh | bash
```

The script picks the right disk image for your Mac (Apple silicon or Intel), checks it against the release's `SHA256SUMS.txt`, puts Keeper in Applications and opens it. Or:

- **The disk image**: `Keeper-mac-arm64.dmg` (Apple silicon) or `Keeper-mac-x64.dmg` (Intel) from [Releases](https://github.com/ashfordeOU/keeper/releases); drag Keeper into Applications.
- **The offline installer**: `Keeper-mac-arm64-full.dmg` or `Keeper-mac-x64-full.dmg`, with every part inside, for computers without a network. With the script, add `-s -- --full` after `bash`.
- **Homebrew**:

  ```bash
  brew tap ashfordeOU/keeper https://github.com/ashfordeOU/keeper
  brew install --cask keeper
  ```

From 1.0.0, Keeper for macOS is **signed with Ashforde's Apple Developer ID and notarized by Apple**. It opens like any other app: no **Open Anyway** step, and no keychain question after every update. A copy moving up from a beta may ask once more for your login password (choose **Always Allow**); after that, updates don't ask.

Keeper asks for system permissions only for the parts that need them, and they carry over updates. [docs/PERMISSIONS.md](docs/PERMISSIONS.md) says what each one is for.

### Windows

```powershell
irm https://raw.githubusercontent.com/ashfordeOU/keeper/main/scripts/install.ps1 | iex
```

Or `winget install Ashforde.Keeper`, or `Keeper-setup-x64.exe` from [Releases](https://github.com/ashfordeOU/keeper/releases) (for your user only, no administrator needed; `Keeper-setup-x64-full.exe` is the offline installer). If SmartScreen appears, choose **More info → Run anyway**.

### Linux

```bash
curl -fsSL https://raw.githubusercontent.com/ashfordeOU/keeper/main/scripts/install.sh | bash
```

The script installs the `.deb` (Debian, Ubuntu), the `.rpm` (Fedora, openSUSE) or the AppImage elsewhere, on x64 and ARM64. The files are on [Releases](https://github.com/ashfordeOU/keeper/releases).

### Everything else

Scoop, Chocolatey, the AUR, Flatpak, Snap, the apt and dnf repositories, the `keeper` command on its own, uninstalling and verifying a download are in **[docs/INSTALL.md](docs/INSTALL.md)**.

## Requirements

- **macOS** 12 or later, Apple silicon or Intel
- **Windows** 10 or 11 (on ARM through x64 emulation)
- **Linux**, 64-bit (x64 or ARM64). Now playing, dictation and download sources use `playerctl`, `xdotool` (or `wtype` on Wayland) and `attr`.

## Privacy

- **Local first.** Your files are never uploaded. Search, text in pictures, duplicates, cleanup, notes and dictation run on this computer.
- **Nothing leaves this computer unless you turn it on.** Settings → Privacy & permissions shows what does: weather, lyrics, the mail, calendars and cloud services you connect, the update check, and the AI you chose, which sees only what you allow, with passwords, keys and card numbers blanked first. *Only use AIs on this computer* keeps everything here.
- **Anonymous usage stats** go once a day, with no file names, searches or account names. *See exactly what's sent* shows each report, and one switch turns them off. Details: [docs/PRIVACY-USAGE-STATS.md](docs/PRIVACY-USAGE-STATS.md).
- Passwords and keys are kept in the system keychain.

## Updating

Keeper updates itself; choose how in **Settings → Updates** (automatically, ask first, or only when you check). **Check for Updates** shows the release notes with **Install and Relaunch**, **Later** and **Skip this version**.

Every update is checked before it is installed: it must match the release's `SHA256SUMS.txt`, and on a Mac it must be signed with Ashforde's Developer ID. Parts downloaded when you switch them on are checked the same way.

## Beta channel

Betas come out on [Releases](https://github.com/ashfordeOU/keeper/releases) as pre-releases before a version is final. To get them, turn on **Settings → Updates → Include beta versions**, or install the newest beta with the script:

```bash
curl -fsSL https://raw.githubusercontent.com/ashfordeOU/keeper/main/scripts/install.sh | bash -s -- --beta
```

Package managers only ever get stable versions. For testers: [docs/BETA.md](docs/BETA.md).

---

## Building from source

Requires **Node.js 22+**.

```bash
npm install          # dependencies and the Electron binary
npm run dev          # the app with hot reload
npm test             # unit tests
npm run dist:mac     # installers (dist:win and dist:linux on those systems)
```

The project layout is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md); how a release is made, in [RELEASING.md](RELEASING.md).

## Documentation

| Area | Documents |
|---|---|
| Getting started | [Install](docs/INSTALL.md) · [Permissions](docs/PERMISSIONS.md) · [Guided fixes](docs/GUIDE.md) · [Themes](docs/THEMES.md) |
| The suite | [Keeper as a suite](docs/SUITE.md) · [Parts downloaded when switched on](docs/COMPONENTS.md) |
| Files | [PDF tools and Convert](docs/FILEKIT.md) · [Cloud and servers](docs/CONNECT.md) · [Sync and backup](docs/SYNC.md) |
| Mail and notes | [Mail, calendars and reminders](docs/PIM.md) · [Notes](docs/NOTES.md) · [Notes Everywhere](docs/NOTES-EVERYWHERE.md) |
| Island and desktop | [Island tools](docs/ISLAND-TOOLS.md) · [Island+ and Cues](docs/ISLAND-CUES.md) · [Wallpaper and Vibes](docs/AMBIENCE.md) · [Stage](docs/STAGE.md) · [Keep Awake](docs/KEEP-AWAKE.md) · [Voice](docs/VOICE.md) |
| AI | [AI agents](docs/AGENTS.md) · [Computer use](docs/COMPUTER-USE.md) · [Terminal](docs/TERMINAL.md) |
| Devices | [Keeper Link](docs/LINK.md) · [Remote screens](docs/REMOTE.md) · [Remote Desktops](docs/REMOTE-DESKTOPS.md) · [Keeper Mesh](docs/MESH.md) |
| Security and system | [Privacy and Security](docs/SECURITY-CENTER.md) · [Firewall](docs/FIREWALL.md) · [Network Activity](docs/NETWORK.md) · [System monitor](docs/MONITOR.md) |
| Project | [Changelog](CHANGELOG.md) · [Contributing](CONTRIBUTING.md) · [Security policy](SECURITY.md) · [Releasing](RELEASING.md) |

## Security

Please report a vulnerability privately, as described in [SECURITY.md](SECURITY.md), not in a public issue. Every release lists `SHA256SUMS.txt`, a Sigstore signature of it and GitHub build attestations ([Verifying a download](docs/INSTALL.md#verifying-a-download)).

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) and its [contributor terms](CONTRIBUTING.md#contributor-terms) before your first pull request.

## License

Keeper is **free to use**, for everyone, at home and at work. It is **source-available**, not open source, under the [PolyForm Shield License 1.0.0](LICENSE.md):

- ✅ Use Keeper for any purpose, personal or professional.
- ✅ Read, build and change the code for yourself or your organization.
- ✅ Build tools, scripts and integrations that work with Keeper.
- ❌ Don't sell or offer Keeper (or a changed Keeper) as a product or service that competes with it without written permission from Ashforde OÜ.

“Keeper by Ashforde®”, “Ashforde®” and the Keeper logo are trademarks of Ashforde OÜ; changed builds must use a different name and logo ([TRADEMARKS.md](TRADEMARKS.md)). Commercial licenses: [COMMERCIAL.md](COMMERCIAL.md) or **contact@ashforde.org**. Third-party components and their licenses: [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

---

<p align="center">
  <img src="build/icon.svg" width="40" alt=""><br>
  <sub><b>Keeper by Ashforde®</b> · © 2026 Ashforde OÜ · Ashforde® is a registered trademark of Ashforde OÜ.<br>Source-available under the PolyForm Shield License 1.0.0; free to use.</sub>
</p>
