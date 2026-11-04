# Downloadable components

From 1.0.0 the standard Keeper download is the **core installer**. It leaves out the three
heavy parts that only some features use. Keeper downloads each one when a feature that needs
it is switched on. The **offline installer** (`…-full`) has everything inside, for computers
without a network or for people who would rather download once.

## What is in the core, and what is a component

Measured on the v0.1.0-beta.7 release (Linux x64 tar.gz and macOS arm64 zip, unpacked). The
component sizes are the real archives that `scripts/components.mjs pack` made from that Linux build.

| Part | Used by | Unpacked | Download | Where |
|---|---|---|---|---|
| Electron, the app (`app.asar`, 83 MB), Chromium libraries | everything | ~440 MB | — | core |
| sharp + libvips (`@img`) | thumbnails, Convert for pictures, everything with images | 19 MB | — | core |
| tesseract.js-core (text in pictures) | `ocr` (on by default) | 44 MB | — | core |
| libheif-js (HEIC, LGPL: kept swappable) | pictures | 9 MB | — | core |
| node-pty | `terminal` | 0.2 MB | — | core |
| agent-desktop | computer use | 2–3 MB | — | core (small; signed with the app for Accessibility) |
| **ffmpeg** (`ffmpeg-static`) | `studio`, `meetings`, `speechModel`, `videoDownload`; parts of `capture` (screen recording), `dictation` (sound files), `convert` (video and audio) | 80 MB Linux, 44 MB Mac | **29.9 MB** Linux x64, ~19 MB Mac arm64 | component `ffmpeg` |
| **ONNX Runtime** (`onnxruntime-node` + `onnxruntime-common`) | `speechModel`, `semantic`, `faces`; parts of `convert` (background removal), `dictation` and `meetings` (built-in speech model) | 49 MB Linux, 45 MB Mac | **18.8 MB** Linux x64, ~13 MB Mac arm64 | component `onnxruntime` (none for Intel Macs) |
| **rclone** | cloud services in `remote`, cloud mirrors in `sync` (servers work without it) | 89 MB | **30.5 MB** | component `rclone` |
| **IronRDP** (`@devolutions/iron-remote-desktop-rdp` 0.7.0: one JavaScript file with WebAssembly inside, the same on every system) | Remote Desktop in a Keeper tab (`remoteDesktops`) | 6.1 MB | **2.2 MB** (2,229,041 bytes measured) | component `ironrdp`, fetched on first use |

**Fetched on first use** (`onDemand` in `core/components.ts`): the Remote Desktop engine is not
downloaded when a preset or a feature switch asks, nor after an update unless an older copy is
already here. The first Remote Desktop tab (or switching *Remote Desktop in a Keeper tab* on in
Remote Desktops → Where it appears) downloads it, and the tab shows the progress. Its release
archive is made like the others: `scripts/fetch-ironrdp.mjs` (run by `prepare-arch.mjs`) puts the
pinned npm package's script in `vendor/ironrdp/current` after checking the package's and the
script's SHA-256; electron-builder copies it to `resources/ironrdp`; the core edition moves it into
the staging folder. Development uses `vendor/ironrdp/current` directly. The tab loads it from
`keeper-engine://ironrdp/iron-remote-desktop-rdp.js`, a scheme that serves only that one file.

Models (Whisper, the cut-out model, the face finder, the meaning model, OCR languages) were
already downloaded on first use and stay so (`electron/services/whisper.ts` and friends).

Installer sizes (estimate = today's installer minus the compressed components):

| Installer | Today (beta.7) | Core | Offline (`-full`) |
|---|---|---|---|
| Linux x64 tar.gz | 248 MB | **180 MB** (measured: beta.7 repacked without the components) | ~248 MB |
| macOS arm64 dmg | 252 MB | ~190 MB | ~252 MB |
| Windows x64 setup | 230 MB | ~150–160 MB | ~230 MB |
| Linux x64 AppImage | 262 MB | ~185 MB | ~262 MB |

## Release assets

Built in `.github/workflows/release.yml`, in each build job (so they follow the released systems):

1. **Package** runs electron-builder with `KEEPER_EDITION=core`. `build/after-pack.cjs` copies
   each component's files out of the packaged app into `release/components-staging/<platform>-<arch>`
   and removes them from the app. `scripts/verify-package.cjs` checks that they are staged and
   are no longer in the app.
2. On macOS, `build/after-sign.cjs` signs every Mach-O file in the staging folder with the identity
   the app was just signed with (`KEEPER_SIGN_IDENTITY`, the Developer ID, or ad hoc). A Developer ID
   build first checks the app's own pieces carry the team's Developer ID with the hardened runtime,
   and signs the components with the hardened runtime and a secure timestamp too. This happens
   before anything is packed. On download, Keeper accepts a component signed like itself or with
   Ashforde's Developer ID (the bridge in `core/update-verify.ts`), nothing else.
3. **Downloadable components** runs `node scripts/components.mjs pack`. It writes
   `keeper-component-<name>-<platform>-<arch>.tar.gz` (plain ustar, fixed times and owners) and
   `components-<platform>-<arch>.json`.
4. **Offline installer** runs electron-builder again with `KEEPER_EDITION=full` into `release-full/`
   and renames the results `Keeper-mac-<arch>-full.dmg`, `Keeper-setup-x64-full.exe`,
   `Keeper-linux-<arch>-full.AppImage` and `Keeper-linux-x64-full.tar.gz`. Its `latest*.yml` is thrown away.
5. The release job's `SHA256SUMS.txt` lists every file, components included, and the Sigstore
   signature and build attestations cover them.

Manifest (`components-linux-x64.json`):

```json
{ "schema": 1, "version": "1.0.0", "platform": "linux", "arch": "x64",
  "components": [{ "name": "ffmpeg", "version": "1.0.0", "file": "keeper-component-ffmpeg-linux-x64.tar.gz",
    "sha256": "…", "size": 29916431, "unpackedSize": 79826272, "features": ["studio", "…"],
    "files": [{ "path": "ffmpeg", "size": 79826272, "sha256": "…", "mode": 493 }] }] }
```

The layout of each component (which files it holds, and where they sit in a packaged app) is in
`core/component-layout.json`. The app and the packing script both read it.

## In the app

- **Where:** `<userData>/components/<name>/<version>/`, with a `component.json` marker.
  A downloaded copy is only used by exactly the Keeper version it was made for.
- **Finding a part** (`core/component-paths.ts`): every feature asks `ffmpegBinary()`,
  `rcloneBinary()` or `onnxRuntime()`. The lookup order is: inside the app (offline installer,
  or a copy from before components), then downloaded, then a development copy (`node_modules`,
  `vendor/`; `KEEPER_COMPONENTS_DEV=0` switches that off).
- **Downloading** (`electron/services/component-installer.ts`), from
  `https://github.com/ashfordeOU/keeper/releases/download/v<this version>/`:
  1. Fetch the manifest and `SHA256SUMS.txt`. The manifest must be listed there and must match.
  2. Fetch the archive. A cut-off download resumes with a Range request; failures are retried 3 times.
  3. The archive's SHA-256 must equal both the manifest's value and `SHA256SUMS.txt`'s value.
  4. Unpack into a hidden folder. Every file must be listed, with its size, SHA-256 and mode, and
     links must not leave the folder.
  5. On macOS: remove `com.apple.quarantine`, then check each program with `codesign --verify`.
     When the app is signed with a certificate, the program must also meet the app's designated
     requirement without its `identifier` clause (`componentRequirement`).
  6. Move it into place with a rename, and delete older versions.
- **Progress, cancel and errors:** the event `components-changed` carries state and progress.
  Downloads can be cancelled. When Keeper is offline it says so, and it tries again once
  `net.isOnline()` is true again.
- **Never at startup:** nothing is fetched while Keeper starts. Thirty seconds later, and only
  after an update (the new version needs its own copy), Keeper downloads in the background the
  components of the features that are on, with a notice. A copy updated from a beta that had
  everything inside gets its parts back this way. A fresh install downloads nothing by itself.
- **Free up space:** "Free up space" removes a downloaded component, or all of them. The feature
  stays on and offers the download again.
- `KEEPER_COMPONENTS_FEED=<url>` reads `<url>/v<version>/<asset>` instead of GitHub (https, or
  http on this computer only; used by tests and mirrors).

## Interface

- **Settings → Features:** a switched-on feature that misses a part shows
  "Download Video and audio engine (ffmpeg) (30 MB)" inline, with progress and Cancel.
  Switching a feature on yourself starts its download. Below the features, "Downloadable parts"
  lists each part with its state and size on disk, "Download everything for offline use" and
  "Free up space". "Add-on apps" sits underneath.
- **Feature pages** (Studio, Meetings, Dictation, Convert) show `<ComponentPrompt>` while a part
  is missing.
- **Add-on apps:** Monorail is listed next to the components on a Mac, with its description,
  size, installed and latest version, and Install / Update / Open / Uninstall. It reuses
  `electron/services/ashforde/monorail.ts`. Monorail follows Keeper's beta setting: people who
  follow betas get the newest pre-release, and a stable release always beats its own betas.
  Switching Monorail on yourself installs it. A preset never installs it. On other systems the
  row is hidden, with a short note instead.

### For the welcome tour and other screens

```ts
// main process
import { ensureComponentsFor } from './ipc/components';
await ensureComponentsFor(featureIds, { partly: false });

// interface
const { ensure, pending, offerAddons, busy, progress, error } = useEnsureComponents(); // src/components/ComponentsPanel.tsx
pending(featureIds);               // parts still missing, with sizes (exact once api.components.sizes() ran)
await ensure(featureIds, { partly: false });
offerAddons(featureIds, platform); // ['monorail'] on a Mac when the set has it: offer an Install button, never install silently
```

`partly: false` skips parts a feature needs for only one of its tools. Use it for
**Recommended**, **Light** and **Files only**: Convert works on pictures without ffmpeg, so those
presets download nothing until first use, as the setup spec (§2.6) asks. **Everything** and the
**Custom** choices pass the switched-on features without `partly`, so every part they can use is
downloaded. Sizes come from the manifest (`api.components.sizes()`); before it is read, they are
estimates marked "about".

## Install script

`scripts/install.sh --full` installs the offline installer: the dmg on macOS, the AppImage on Linux.

## Needs a real Mac or Windows

- macOS: that after-sign signs the staged programs, that a downloaded component passes the
  app's requirement, and that ONNX Runtime's dylib loads from `~/Library/Application Support/Keeper/components`.
- Windows: the components are not Authenticode-signed separately. ffmpeg.exe and rclone.exe
  are run from `%APPDATA%\Keeper\components`.
