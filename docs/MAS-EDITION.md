<!-- SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0 -->
# Mac App Store edition (plan)

This is a plan for a sandboxed **Keeper for the Mac App Store**, built from the same code as
the direct download. Nothing here is built yet. The only code so far is an optional `edition`
field on feature entries in `core/features.ts`. Nothing reads it yet, and no entry sets it.

The direct download (Developer ID, notarized) stays the full edition. The App Store edition is a
smaller Keeper for people who only install from the App Store. It keeps the library, search,
the Island, AI and connections, and leaves out what needs administrator rights, other apps'
private data or private APIs.

Of Keeper's 117 features, **47 stay available**, **51 are reduced** and **18 are unavailable**
in the sandbox. One (Control on Wayland) is Linux only. The [full matrix](#feature-matrix) gives
the reason for each.

## 1. The edition flag

There is one build-time switch, read in one place.

- **Setting it.** `KEEPER_EDITION=mas` in the environment of `npm run build`. Missing or
  `direct` gives the normal build.
- **Main process.** `scripts/build-main.mjs` adds
  `__KEEPER_EDITION__: JSON.stringify(process.env.KEEPER_EDITION || 'direct')` to its `define`
  list, next to `__KEEPER_OFFICIAL__`.
- **Renderer.** `vite.config.ts` defines the same constant.
- **Reading it.** One small module, `core/edition.ts`, is the only reader:

  ```ts
  declare const __KEEPER_EDITION__: string | undefined;
  export type Edition = 'direct' | KeeperEdition;            // KeeperEdition from core/features.ts
  export const EDITION: Edition = typeof __KEEPER_EDITION__ === 'string' && __KEEPER_EDITION__ === 'mas' ? 'mas' : 'direct';
  export const editionSupport = (f: FeatureDef) => (EDITION === 'direct' ? 'available' : f.edition?.[EDITION] ?? 'available');
  ```

- **Gating.** Unavailable features are gated exactly like `platforms`. In
  `electron/services/features.ts` and `src/features.tsx`, a feature whose
  `editionSupport(f) === 'unavailable'` is treated as not on this system: its switch, routes,
  palette commands and tray entries disappear, and presets skip it (they already skip features
  a system cannot run). `featureOn()` returns false, so no service starts.
- **Dropping code.** Because `EDITION` is a compile-time constant, esbuild removes branches like
  `if (EDITION !== 'mas') await import('./services/mesh')`. Services for unavailable features
  should be imported behind such a check, so the App Store binary carries no administrator
  scripts, LaunchDaemon plists or downloader code. App Review looks at what is in the bundle,
  not only at what runs.
- **Reduced features.** These stay switchable. Settings → Features shows a small "Smaller in the
  App Store edition" note with the reason from the matrix below. The reason text moves into the
  feature entry when this is built: `edition: { mas: 'reduced' }` plus an `editionNote`.
- **Filling in the entries.** Add `edition: { mas: 'reduced' | 'unavailable' }` to each entry,
  from the matrix. Entries without the field are available. A unit test checks that no
  available feature `requires` an unavailable one.
- **Native code.** Swift reads the same switch as a compile flag: `swift build -Xswiftc
  -DMAS_EDITION`. `#if !MAS_EDITION` removes the private `IOAVService` lookup (DDC in
  `Extras.swift`), which App Review would reject even unused.
- **Packaging.** A new `packaging/electron-builder.mas.cjs` (like `electron-builder.signed.cjs`)
  takes `electron-builder.yml` and switches to the `mas` target. It uses Electron's Mac App Store
  build, the entitlements below and the provisioning profile, with no `publish` section. It
  signs `keeper-helper` and `Keeper Intents.app` as helpers of the main bundle.

Not built until the owner decides to go ahead. Order of work: the flag and gating, then
bookmarks, then the entitlements and packaging, then review.

## 2. Feature matrix

**Available** works as in the direct download, within the folders the person has granted.
**Reduced** works with the limits given. **Unavailable** is hidden in this edition.

### Library

| Feature | id | Sandbox | Why |
| --- | --- | --- | --- |
| Library and search | `library` | **reduced** | Only folders the person grants (security-scoped bookmarks). Downloads, Pictures, Music and Movies come with entitlements; Desktop, Documents and other folders are added once through an open panel. No whole-disk index. |
| Where downloads came from | `sources` | available | Reads the `kMDItemWhereFroms` attribute of files Keeper can already see; Downloads is covered by an entitlement. |
| Text inside documents | `docText` | available | Same scope as the library. |
| Text in pictures | `ocr` | available | On-device (tesseract, Vision through the helper); same scope as the library. |
| Disks, cloud drives and servers | `places` | **reduced** | Volumes are listed and ejected through NSWorkspace; their files need a grant like any folder. |
| Network browsing | `network` | **reduced** | Bonjour browsing works (network client); mounting a share is handed to Finder (`smb://` opened with NSWorkspace) instead of `mount_smbfs`. |
| Locked folders | `lock` | available | Keeper's own encryption (core/vault) on granted folders; the key stays in the app's keychain. |
| Notes | `notes` | available | A vault is a folder the person opens, which is exactly what the sandbox expects. |

### Tidy

| Feature | id | Sandbox | Why |
| --- | --- | --- | --- |
| Clean Up | `cleanup` | **reduced** | Caches and leftovers in ~/Library belong to other apps and are outside the container; only Downloads (old installers), granted folders and the Trash through Finder remain. |
| Duplicates and look-alike photos | `duplicates` | available | Same scope as the library. |
| Space Map and Large Files | `space` | **reduced** | Free and used space per volume works (statfs); the map only covers granted folders. |
| Convert | `convert` | available | Bundled ffmpeg and sharp, signed with the inherited sandbox; output goes next to the input (granted) or to a chosen folder. |
| Automations | `rules` | available | On granted folders; bookmarks keep them across launches. |
| History and undo | `history` | available | Undo works for files Keeper moved inside granted folders. |
| Convert to any format | `fileKit` | **reduced** | The built-in converters work. Converters that run other installed programs (office suites, e-book or drawing tools) cannot be launched. |
| Workflows | `workflows` | available | On granted folders, with the built-in tools. |
| Hide faces | `faces` | available | The model is data, downloaded into the container. |
| Speech to text on this computer | `speechModel` | available | The model is data, downloaded into the container. |

### Island

| Feature | id | Sandbox | Why |
| --- | --- | --- | --- |
| Island | `island` | available | A borderless always-on-top window; nothing in it needs more than the app's own windows. |
| Clipboard history | `clipboard` | available | NSPasteboard polling is allowed; macOS's own paste-privacy prompt applies to every app alike. |
| Now playing | `media` | **reduced** | Reading another app's playback needs Apple Events: a `scripting-targets` / temporary-exception entitlement for Music and Spotify only, with a reason for review. The private MediaRemote framework is not allowed. |
| Coding assistants | `agents` | **reduced** | Assistants' session files live in hidden folders of the home folder; the person grants each folder once. |
| Focus timer and breaks | `focus` | available | A timer and Keeper's own notifications. |
| Keep awake | `keepAwake` | **reduced** | Power assertions (IOPMAssertion) work. Closed-lid mode (`pmset disablesleep`, needs an administrator) and locking the screen through `pmset` are not possible; nudging the pointer needs Accessibility. |
| Weather in the Island | `islandWeather` | available | Network client. |
| Ask in the Island | `islandAsk` | available | Network client, or Apple's on-device model through the helper. |
| AI usage in the Island | `islandUsage` | **reduced** | Reads other tools' files in the home folder: only after the person grants those folders. |
| Sales in the Island | `islandSales` | available | Network client with the person's read-only keys. |
| Stocks in the Island | `islandStocks` | available | Network client. |
| Notes in the Island | `islandNotes` | available | Keeper's own data. |
| To-dos in the Island | `islandTodos` | available | EventKit reminders with the `personal-information.calendars` entitlement. |
| Teleprompter | `islandPrompter` | available | Its own window; following the voice needs the microphone entitlement. |
| Next meeting | `calendar` | available | EventKit or a calendar link (network client). |
| Microphone and camera in use | `micIndicator` | **reduced** | Core Audio says whether the microphone is in use somewhere, but not which app. |
| Notifications in the Island | `notifyMirror` | **unavailable** | Other apps' notifications are only readable from the system's notification database, which the sandbox (and Full Disk Access rules) keeps out of reach. |
| Hide in full screen | `hideInFullscreen` | available | Window bounds from CGWindowList are readable without extra rights. |
| Calls in the Island | `islandCalls` | **reduced** | A call is noticed from the microphone being in use and the front app; muting is through Core Audio. Muting with an app's own shortcut needs Accessibility. |
| Volume and brightness in the Island | `islandHud` | **reduced** | Volume levels work through Core Audio. Brightness has no public API (DisplayServices is private), so only volume shows. |

### Desktop

| Feature | id | Sandbox | Why |
| --- | --- | --- | --- |
| Cues | `cues` | **reduced** | The front app is known (NSWorkspace). The browser's page needs Apple Events to each browser, which means a temporary-exception entitlement per browser; without it, cues tied to websites do not fire. |
| Tool launcher | `toolLauncher` | available | Global shortcuts (RegisterEventHotKey) are allowed. |
| Quick Search | `quickSearch` | available | Global shortcut and a window; same scope as the library. |
| Desktop widgets | `widgets` | available | Desktop-level windows. |
| Live wallpaper | `wallpaper` | available | Desktop-level windows; the still picture is set with NSWorkspace's public API through the helper. |
| Vibes | `vibes` | **reduced** | Wallpaper, sound and widgets switch; switching the system's light or dark mode needs Apple Events to System Events (a temporary exception App Review may refuse). |
| Ambient sound | `ambientSound` | available | Sound made on the device. |
| Custom folder icons | `folderIcons` | **reduced** | NSWorkspace.setIcon works on granted folders only. |
| Weather | `weather` | available | Network client; location with the `personal-information.location` entitlement. |
| Places & Tracks | `tracks` | available | Imports come through the open panel; data stays in the container. |
| Places & Tracks: live sharing | `tracksLive` | **reduced** | OwnTracks, trackers and Traccar work (network server). Find My's cache is protected by the system and cannot be read. |
| Places & Tracks: sports services | `tracksServices` | available | OAuth in the browser and a loopback redirect (network server). |
| Screenshots and recording | `capture` | available | ScreenCaptureKit with the person's Screen Recording permission; Live Text through the helper. |
| Stage mode | `stage` | **reduced** | The backdrop, pointer spotlight and click ripples work. Hiding desktop icons, the Dock and other apps, and changing alert volume or display modes need `defaults write` for other apps or Apple Events, which the sandbox blocks. |
| Stage: start when the screen is captured | `stageAuto` | **reduced** | Keeper's own recordings start it. Noticing other recorders relies on their process names and window list, which the sandbox only partly shows. |
| Display keys | `displayKeys` | **unavailable** | DDC/CI on Apple silicon uses IOAVService, a private API App Review rejects; media-key interception needs an event tap that changes keys. |
| Dictation | `dictation` | **reduced** | Recognition on the device works; the text goes to the clipboard. Typing into other apps needs Accessibility (allowed by review only with a clear reason) to paste with a synthetic Cmd-V. |
| Hold a key to talk | `dictationHold` | **reduced** | A listen-only event tap with Input Monitoring permission is allowed; it must stay listen-only. |
| Meeting recorder | `meetings` | available | Microphone entitlement, and the computer's sound through ScreenCaptureKit audio. |
| Notice calls | `meetingDetect` | **reduced** | Knows that the microphone is in use and which app is in front, not which app uses it. |
| Menu bar / tray icon | `tray` | available | Menu-bar item. |
| Start at login | `login` | available | SMAppService.mainApp, the sandbox-friendly way. |
| Terminal | `terminal` | **reduced** | SSH and remote files work. A local shell runs inside Keeper's sandbox: it only sees the container and granted folders, and commands installed outside the system folders may not run. |
| Agent terminals and hub | `agentHub` | **reduced** | Same limits as the terminal: agent tools run sandboxed and only see granted project folders. |
| Alarms, timers and world clocks | `alarms` | available | Keeper's own notifications and sounds. |
| Monorail | `monorail` | **reduced** | Talking to Monorail works through its URL scheme or an app group. Installing it from Keeper does not; the person gets it from the App Store. |

### AI

| Feature | id | Sandbox | Why |
| --- | --- | --- | --- |
| Writing help | `writingHelp` | available | Works in Keeper's own text fields. |
| Keeper’s brain | `brain` | available | Same scope as the library. |
| Search by meaning | `semantic` | available | The on-device model is data, downloaded into the container (allowed; it is not executable code). |
| Assistant | `assistant` | available | Network client. |
| AI abilities | `abilities` | **reduced** | Web search, research, posts and memory work. Code in a sealed workspace cannot start containers or other runtimes from inside the sandbox, and computer use (pointer and keys in other apps) needs Accessibility that review is unlikely to accept for an AI. |
| AI agents | `aiAgents` | available | Agents work on granted folders and ask first, as now. |
| Works with your computer | `platform` | available | App Intents, Shortcuts, Core Spotlight and Live Text are all sandbox-friendly. |

### Connections

| Feature | id | Sandbox | Why |
| --- | --- | --- | --- |
| Cloud and servers | `remote` | **reduced** | The bundled rclone (signed, inherits the sandbox) reaches cloud storage and servers. Mounting a drive needs FUSE or `mount`, which is not possible. |
| Keeper on your other devices | `link` | **reduced** | Pairing, relay and Bonjour work (network client and server). Files shared to other devices are limited to granted folders. |
| Remote screens | `remoteScreen` | **reduced** | Seeing and controlling other computers works. Being seen works through ScreenCaptureKit; being controlled needs synthetic events in other apps, which the sandbox does not allow. |
| Keeper Mesh | `keeperMesh` | **unavailable** | Needs a utun interface or WireGuard as root (a LaunchDaemon). Possible later only as a Network Extension packet tunnel, with Apple's entitlement. |
| Remote Desktops | `remoteDesktops` | **reduced** | VNC in Keeper, SSH and web consoles work. `.rdp` files open in Microsoft's app through NSWorkspace; launching FreeRDP or other installed programs is not possible. |
| Let others reach this computer | `rdcHosting` | **unavailable** | Switching on Screen Sharing (`kickstart`) needs an administrator and system changes. |
| Direct connections between your devices | `linkDirect` | available | UDP sockets with the network client and server entitlements. |
| Your devices at a glance | `remoteFleet` | **reduced** | Groups, notes and details work. Locking, sleeping and restarting this Mac need Apple Events to the system or `pmset`. |
| Terminals on your other devices | `remoteTerminal` | **reduced** | Opening a terminal on another device works; a terminal served from this Mac is sandboxed (see Terminal). |
| Run commands on your devices | `remoteCommands` | **reduced** | Sending commands works; commands run here are sandboxed. |
| Help mode | `remoteHelp` | **reduced** | Being helped (showing the screen, chat, voice) works; letting the helper control this Mac does not. |
| Remote screen extras | `screenExtras` | **reduced** | Sound, several screens, drawing, voice chat, file panel (granted folders) and printing work; anything that controls this Mac does not. |
| Unattended access | `unattendedAccess` | **unavailable** | Needs a LaunchDaemon running as root; not possible from the App Store. |
| Control on Wayland | `waylandControl` | n/a | Linux only. |
| Phones on this screen | `mirroring` | **unavailable** | Downloads and runs scrcpy and adb, and receives AirPlay with UxPlay: running downloaded programs is against App Review Guideline 2.5.2. |
| Sync and backup | `sync` | **reduced** | Between granted folders; bookmarks keep them across launches. |
| Notes Everywhere | `notesHub` | **reduced** | Notes apps that keep plain files work once their folder is granted; apps with private databases in their own containers cannot be read. |
| Notes Everywhere: sync in the background | `notesSync` | **reduced** | As Notes Everywhere. |
| Network activity and VPN | `netwatch` | **unavailable** | Which app uses the network comes from `nettop` and `lsof`, which the sandbox blocks; other VPNs are not visible through NEVPNManager. |
| Firewall | `firewall` | **unavailable** | The current filter is a Network Extension *system* extension (Developer ID only). Possible later as a content-filter *app* extension inside the App Store app, with Apple's entitlement. |
| Mail | `mail` | available | Network client; passwords in the app's keychain. |
| Calendar and reminders | `calendars` | available | EventKit with the calendars entitlement, and CalDAV over the network. |

### System

| Feature | id | Sandbox | Why |
| --- | --- | --- | --- |
| Health and alerts | `health` | **reduced** | System-wide processor, memory and battery work. Per-app numbers for other apps are partly hidden from a sandboxed app. |
| Processes | `processes` | **reduced** | Running apps are listed (NSWorkspace) and can be asked to quit. Other processes cannot be ended or restarted. |
| Long-term health history | `monitorHistory` | **reduced** | As Health: system totals in full, per-app history partly. |
| Live readings in the menu bar | `monitorTray` | **reduced** | Processor, memory, network, disk and battery work; temperatures and fans come from the SMC, which is not reachable. |
| Dev servers and coding agents | `devServers` | **unavailable** | Listening ports and their folders come from `lsof`, blocked by the sandbox. |
| Containers | `containers` | **unavailable** | Docker's and Podman's sockets are outside the container; reaching them needs a temporary exception App Review will not accept for this. |
| Graphics, fans and power | `monitorSensors` | **reduced** | GPU use is readable through IOKit statistics; fans and temperatures (SMC) are not. |
| Startup items and apps | `startupItems` | **reduced** | Apps you no longer use (from /Applications) work. Login items and launch agents of other apps can be neither listed reliably nor removed. |
| To do and guides | `guide` | **reduced** | Every guide and System Settings link works. Fixes Keeper carries out itself shrink to those inside the sandbox (for example emptying the Trash through Finder); the rest become step-by-step guides. |
| Privacy & Security | `protection` | **reduced** | Camera, microphone and screen use, and checks with public APIs (FileVault, Gatekeeper, firewall status) work. Reading privacy permissions (the TCC database) and other browsers' extensions does not. |
| Malware protection | `security` | **reduced** | Scanning granted folders and Downloads with the bundled engines works. Real-time checks of the whole disk need Endpoint Security, which is not available in the App Store. |
| Video downloads | `videoDownload` | **unavailable** | Fetches and runs a downloader program on first use (Guideline 2.5.2); downloading from video sites also raises Guideline 5.2. |
| External display controls | `displayControl` | **unavailable** | DDC/CI needs IOAVService, a private API. |
| Quick Controls | `quickControls` | **reduced** | Becomes a set of shortcuts into System Settings; Keeper cannot change system settings itself. |
| Quick Controls: network | `quickControlsNetwork` | **unavailable** | Wi-Fi, Bluetooth, VPN and sharing switches need administrator rights or private frameworks. |
| Quick Controls: firewall | `quickControlsFirewall` | **unavailable** | The system firewall needs an administrator; Keeper's own firewall is unavailable (see Firewall). |
| Quick Controls: privacy | `quickControlsPrivacy` | **unavailable** | Privacy switches live in TCC, which no app may change (`tccutil` resets need Terminal). |
| Quick Controls: security | `quickControlsSecurity` | **unavailable** | Gatekeeper and automatic updates need an administrator. |
| System Settings+ | `settingsCatalog` | **reduced** | The catalogue, search and the exact commands stay, to copy into Terminal. Keeper cannot apply them (`defaults write` for other apps, `sysctl` and services are blocked). |
| App controls | `appControls` | **unavailable** | Per-app network, CPU limits, priority and pausing act on other processes, which the sandbox does not allow. |
| Browser tab controls | `browserTabs` | **reduced** | Safari works through a Safari Web Extension shipped inside the app (scripts/build-safari-extension.sh). Other browsers need a native-messaging host installed into their folders, outside the container. |
| Toolbox | `tools` | **reduced** | Utilities that work on files and text stay; system tweaks that run commands go. |
| Automatic update checks | `updates` | **unavailable** | The App Store updates the app; Keeper's own updater must not be present (Guideline 2.4.5). |
| Anonymous usage stats | `usageStats` | available | Network client; declared in App Store Connect's privacy answers (usage data, not linked to the person). |

## 3. Entitlements

**Keeper.app** (`build/entitlements.mas.plist`). Every key is used by an available or reduced
feature:

| Entitlement | For |
| --- | --- |
| `com.apple.security.app-sandbox` | Required |
| `com.apple.security.application-groups` = `$(TeamIdentifierPrefix)io.github.ashfordeou.keeper` | Shared container with keeper-helper, Keeper Intents and the Safari extension |
| `com.apple.security.network.client` | Weather, maps, mail, calendars, AI, Link, cloud storage, model downloads, usage stats |
| `com.apple.security.network.server` | Link (devices reach this Mac), OwnTracks and tracker receivers, OAuth loopback, the MCP and A2A gateway on 127.0.0.1 |
| `com.apple.security.files.user-selected.read-write` | Folders and files the person chooses (open panel, drag and drop) |
| `com.apple.security.files.bookmarks.app-scope` | Keeping those grants across launches (see below) |
| `com.apple.security.files.downloads.read-write` | Downloads, download sources, cleanup of old installers |
| `com.apple.security.assets.pictures.read-write` | Pictures: screenshots, photos, duplicates |
| `com.apple.security.assets.music.read-write` | Music |
| `com.apple.security.assets.movies.read-write` | Movies: recordings, conversions |
| `com.apple.security.device.audio-input` | Dictation, meetings, teleprompter following your voice, voice chat |
| `com.apple.security.device.camera` | The Island's mirror |
| `com.apple.security.personal-information.calendars` | Calendar, reminders, the Island's next meeting and to-dos |
| `com.apple.security.personal-information.location` | Weather for here, Places & Tracks' own position |
| `com.apple.security.print` | Printing (remote screen extras, PDFs) |
| `com.apple.security.cs.allow-jit` | Electron's JavaScript engine (as in Electron's own Mac App Store guide) |
| `com.apple.security.scripting-targets` / `com.apple.security.temporary-exception.apple-events` for `com.apple.Music` and `com.spotify.client` only | Now playing. ⚑ Optional: drop it if review objects, and Now playing becomes unavailable |

These are **not** requested: Accessibility (it isn't an entitlement; the person grants it, and
review must accept the reason, see below), Input Monitoring (the same), `disable-library-validation`,
and any temporary exception for files outside the container.

**Child processes** (`build/entitlements.mas.inherit.plist`, applied to ffmpeg, rclone, the
native `.node` modules, node-pty's spawn helper and Electron's helpers):
`com.apple.security.app-sandbox` and `com.apple.security.inherit`. That's all, as Apple requires.

**keeper-helper** (a command-line tool in `Contents/MacOS`) uses the inherit file. It is
started by Keeper, so it shares Keeper's sandbox and grants.

**Keeper Intents.app** (`Contents/Library/Helpers`) has its own sandbox: `app-sandbox`, the same
application group (to reach Keeper over the group's socket), and `network.client`.

**Info.plist**: the usage strings already in `electron-builder.yml` (`mac.extendInfo`) are kept,
except `NSAppleEventsUsageDescription`, which stays only if Now playing keeps its exception.
Desktop and Documents strings are removed, because the sandbox never asks for them. Also add
`ElectronTeamID` and `LSApplicationCategoryType = public.app-category.productivity`.

**Provisioning profile**: a Mac App Store distribution profile for `io.github.ashfordeou.keeper`
with the application group, put at `build/embedded.provisionprofile` by CI from a secret.

## 4. Security-scoped bookmarks

In the sandbox, a folder the person picked stays reachable after a restart only through an
app-scoped bookmark. The plan:

- **Where grants come from.** Every place Keeper asks for a folder already uses
  `dialog.showOpenDialog`: library folders, rules' watched folders, vaults, sync pairs, locked
  folders, convert output, notes vaults, the agents' folders. In the App Store edition, these
  calls pass `securityScopedBookmarks: true` (Electron supports this on MAS builds). Drag and
  drop onto Keeper grants the dropped items for the session only; Keeper offers "Keep access to
  this folder" to turn that into a picked folder.
- **Storing them.** A new store, `bookmarks.json` in the container, maps each granted path to its
  bookmark data (base64), with the date and the feature that asked. Settings keep paths as they
  do now, so nothing else changes shape.
- **At start.** For each bookmark, `app.startAccessingSecurityScopedResource(data)` is called
  once, and its stop function is kept. A stale bookmark (moved or renamed folder) is renewed with
  the new data. A broken one is listed in To do as "Keeper lost access to <folder>: choose it
  again", with a button that opens the picker at that path.
- **Scope.** Grants are per folder, recursive. The file index, watchers, OCR, duplicates and
  rules only walk granted roots, and their path checks run through one helper,
  `isGranted(path)`, so a stray path (an old index entry, a link pointing outside) is skipped
  quietly instead of failing.
- **First run.** The welcome tour gets a "Choose your folders" step that suggests Desktop and
  Documents. Downloads, Pictures, Music and Movies are already reachable through their
  entitlements. The step says plainly that the App Store version can only see folders you
  choose.
- **Removing.** Removing a folder from the library stops access and deletes the bookmark.
- **Helpers.** keeper-helper inherits the grants because it is Keeper's child. Keeper Intents
  asks Keeper over the group socket instead of reading files itself.
- **Tests.** Unit tests cover the bookmark store (renewal and loss). An e2e test runs on a MAS
  build on a Mac only.

## 5. Review notes for Apple

Paste these into App Store Connect → App Review Information → Notes, and adapt them:

> Keeper is a file library: it shows, searches and tidies the files in folders you choose.
>
> **No account is needed.** Open Keeper and follow the short welcome tour. Choose a folder with
> some documents and pictures (or use Downloads and Pictures, which it can already read).
> Then try Search ("screenshots from this week"), Duplicates and the Island (the small bar at
> the top of the screen).
>
> **Files:** Keeper only reads folders you pick (security-scoped bookmarks) and Downloads,
> Pictures, Music and Movies (asset entitlements). Text recognition and search run on the Mac.
> No file content leaves the Mac unless you ask the assistant about a file, using the AI
> provider and key you set up yourself.
>
> **Microphone:** dictation and meeting notes, only while you record. **Camera:** the Island's
> mirror, only while it's open. **Calendars and reminders:** the Island's next meeting and
> to-dos. **Location:** the weather for where you are. **Screen Recording** (asked by macOS):
> screenshots, screen recordings and the computer's sound in meeting notes.
>
> **Accessibility** (optional, off until you turn on a feature that needs it): typing dictated
> text where your cursor is, and muting a call with the call app's own shortcut. Keeper never
> reads other apps' content with it. **Input Monitoring** (optional): the "hold a key to talk"
> dictation key. It listens to that one key and Esc only.
>
> **Network:** Keeper Link lets your own paired devices reach this Mac (network server). It is
> off until you pair a device. Anonymous usage stats are sent once a day: they are shown in the
> welcome tour with a switch, and listed field by field in Settings → Privacy.
>
> **Apple Events:** only to Music and Spotify, to show what is playing.
>
> **Downloaded data:** speech and search models are data files, checked by hash. No code is
> downloaded or run.
>
> Keeper has no in-app purchases. Updates come only from the App Store.

## Paying for Keeper Pro in this edition

Keeper Pro is switched off ([PRO.md](PRO.md)). If it is switched on, Guideline 3.1.1 requires
Apple's in-app purchase here: this edition never shows a web checkout, a license field that
leads to one, or a link to buying elsewhere.

- `core/pro/payments.ts` defines `StoreKitBridge` (products, purchase, restore) and
  `VerifiedReceipt`; `noStoreKit` is the stand-in until the native side exists.
  `providerFor('mas', …)` always returns the StoreKit provider.
- `core/entitlements.ts` accepts an App Store purchase as a source (`receiptSource`), next to
  licenses, so the plan comes out the same way.
- Native work, later: StoreKit 2 in keeper-helper (Swift), `Transaction.currentEntitlements`
  and `Transaction.updates`, products `io.github.ashfordeou.keeper.pro.month`/`.year`,
  Restore Purchases in Settings → Account & Pro.
- What is free stays free here too: the same `freeThrough` rule applies.

## 6. Open questions for the owner ⚑

- **The name.** "Keeper" is taken on the App Store by another publisher's well-known app. Use
  **Keeper by Ashforde**, the same as in the Microsoft Store ([STORES.md](STORES.md)).
- **Bundle id.** There are two choices:
  - Keep `io.github.ashfordeou.keeper`, the id the direct download and Flathub use. The two Mac
    copies then replace each other, and can't be installed side by side.
  - Use `io.github.ashfordeou.keeper.mas`. Both copies can be installed, which is easier for
    testers. Their data is separate either way, because the sandbox keeps its own container.
- **Price and edition naming.** Is the App Store edition free like the download? Does the
  listing say it's smaller, and link to the full download? Guideline 3.1.1 forbids pointing to
  other purchase routes, but a free download is fine to mention in the description, not in the
  app.
- **Privacy policy URL**, and the App Privacy answers: usage data that isn't linked to the
  person, and crash data (local only, so not collected). Same decision as for the Microsoft
  Store.
- **Now playing.** Ask for the Apple Events exception or drop the feature.
- **Firewall.** A content-filter app extension needs Apple's Network Extension entitlement
  request. Worth it later, not for a first version.
