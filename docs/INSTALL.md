# Installing Keeper

Keeper runs on macOS 12+, Windows 10/11 and 64-bit Linux (x64 and ARM64). Every way of installing it below gets the same build from the project's [GitHub Releases](https://github.com/ashfordeOU/keeper/releases). Each install also gives you the `keeper` command for terminals and scripts.

- [Quick install](#quick-install)
- [macOS](#macos) · [Windows](#windows) · [Linux](#linux) · [Only the command](#only-the-keeper-command)
- [Updates](#updates)
- [Verifying a download](#verifying-a-download)
- [Uninstalling](#uninstalling)
- [How releases work](#how-releases-work)
- [Maintainers: channels, secrets and signing](#maintainers-channels-secrets-and-signing)

## Quick install

**macOS and Linux**

```bash
curl -fsSL https://raw.githubusercontent.com/ashfordeOU/keeper/main/scripts/install.sh | sh
```

**Windows** (PowerShell)

```powershell
irm https://raw.githubusercontent.com/ashfordeOU/keeper/main/scripts/install.ps1 | iex
```

What the scripts do:

- On macOS, the script downloads the right `.dmg` for your processor (`Keeper-mac-arm64.dmg` or `Keeper-mac-x64.dmg`), quits a running Keeper, replaces Keeper in `/Applications` (or `~/Applications` if that folder isn't writable), removes the quarantine flag and opens it.
- On Linux, it installs the `.deb` (Debian, Ubuntu and similar), the `.rpm` (Fedora, openSUSE and similar), or the AppImage on any other distribution.
- On Windows, it runs the per-user installer silently, so no administrator prompt appears.
- Without `--version`, the scripts take the newest stable release that has the file for this computer, not simply GitHub's latest release: a version can come out for macOS first and for Windows and Linux in a following release.
- Every download is checked against the release's `SHA256SUMS.txt`. Nothing is installed if the checksum doesn't match, or if the release has no checksums.
- If the [GitHub CLI](https://cli.github.com) is installed and signed in, the script also checks the file's build attestation.
- Each script puts a `keeper` command on your PATH: in `~/.local/bin` on macOS and Linux, and in `%LOCALAPPDATA%\Keeper\bin` on Windows. Run `keeper` with no arguments to open the app, or `keeper --help` for the command line.

Options:

| macOS / Linux (`sh -s -- …`) | Windows | |
|---|---|---|
| `--version 0.2.0` | `-Version 0.2.0` | A specific version instead of the newest one with a build for this computer |
| `--beta` | | The newest release, betas included (a beta copy follows betas until a newer stable version is out) |
| `--appimage` | | Linux: use the AppImage even where a .deb or .rpm would fit |
| | `-Portable` | The portable `Keeper.exe` instead of the installer |
| `--cli-only` | | Only the `keeper` command, from npm (needs Node.js 22+) |
| `--uninstall` | `-Uninstall` | Remove Keeper |
| | `-DownloadOnly` | Download and verify the installer, then stop |
| `--yes` | | Don't ask before using `sudo` |

Here's how to pass options:

```bash
curl -fsSL https://raw.githubusercontent.com/ashfordeOU/keeper/main/scripts/install.sh | sh -s -- --appimage
```

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/ashfordeOU/keeper/main/scripts/install.ps1))) -Portable
```

You can also read the scripts before running them: [install.sh](../scripts/install.sh), [install.ps1](../scripts/install.ps1).

## macOS

| Method | Command or file | Updates |
|---|---|---|
| Script | `curl -fsSL https://raw.githubusercontent.com/ashfordeOU/keeper/main/scripts/install.sh \| sh` | Keeper itself |
| Disk image | [Keeper-mac-arm64.dmg](https://github.com/ashfordeOU/keeper/releases/latest/download/Keeper-mac-arm64.dmg) (Apple silicon), [Keeper-mac-x64.dmg](https://github.com/ashfordeOU/keeper/releases/latest/download/Keeper-mac-x64.dmg) (Intel) | Keeper itself |
| Homebrew | `brew tap ashfordeOU/keeper https://github.com/ashfordeOU/keeper` then `brew install --cask keeper` | Keeper itself, or `brew upgrade --cask keeper` |

The Homebrew cask is [`Casks/keeper.rb`](../Casks/keeper.rb) in this repository; every stable release updates it. Once the separate `ashfordeOU/homebrew-keeper` tap is live, `brew install --cask ashfordeou/keeper/keeper` installs the same cask. The cask also links the `keeper` command.

Releases are signed with the same certificate every time (once the maintainers have set it up, see [How releases work](#how-releases-work)), so macOS keeps Accessibility, Screen Recording and the other permissions across updates.

> **First launch.** A release signed with Ashforde's Apple Developer ID and notarized (its release notes say so) opens straight away: Gatekeeper recognises it, and there is no **Open Anyway** step. A release signed with the self-signed certificate is not recognised: Gatekeeper accepts only Apple-issued certificates. The install script removes the quarantine flag for you. If you used Homebrew or the dmg on macOS 15 or later, open Keeper once, then open **System Settings → Privacy & Security** and click **Open Anyway** (on older versions, Control-click Keeper and choose **Open**). Or run:
>
> ```bash
> xattr -dr com.apple.quarantine /Applications/Keeper.app
> ```

## Windows

| Method | Command or file | Updates |
|---|---|---|
| winget | `winget install Ashforde.Keeper` | Keeper itself, or `winget upgrade Ashforde.Keeper` |
| Scoop | `scoop bucket add keeper https://github.com/ashfordeOU/keeper` then `scoop install keeper/keeper` | `scoop update keeper` |
| Chocolatey | `choco install keeper-files` | `choco upgrade keeper-files` |
| Installer | [Keeper-setup-x64.exe](https://github.com/ashfordeOU/keeper/releases/latest/download/Keeper-setup-x64.exe) | Keeper itself |
| Portable | [Keeper-portable.exe](https://github.com/ashfordeOU/keeper/releases/latest/download/Keeper-portable.exe) | Keeper tells you, you download |
| Script | `irm …/install.ps1 \| iex` | Keeper itself |

Notes:

- The installer, winget and the script install Keeper for your user only, so no administrator prompt appears. Chocolatey installs Keeper for all users in Program Files.
- Keeper runs on Windows on ARM through x64 emulation.
- The Chocolatey package is called `keeper-files` because the name `keeper` belongs to an unrelated product there.

> **SmartScreen.** Until releases carry a code-signing certificate that Windows trusts, SmartScreen may say *Windows protected your PC*. Choose **More info → Run anyway**. Windows trusts only certificates from recognised authorities, so a self-signed certificate wouldn't remove the warning. Even a trusted certificate still needs some reputation before the warning goes away.

## Linux

| Method | Command | Updates |
|---|---|---|
| apt repository (Debian, Ubuntu, Mint, Pop!_OS) | see below | `sudo apt upgrade` |
| dnf repository (Fedora, RHEL, openSUSE) | see below | `sudo dnf upgrade` |
| Arch Linux (AUR) | `yay -S keeper-bin` (or any AUR helper) | your AUR helper |
| Flatpak | `flatpak install flathub io.github.ashfordeou.keeper` | `flatpak update` |
| Snap | `sudo snap install keeper --classic` | automatic |
| .deb | `sudo apt install ./Keeper-linux-amd64.deb` (or `-arm64.deb`) | Keeper downloads the new package and asks for your password |
| .rpm | `sudo dnf install ./Keeper-linux-x86_64.rpm` (or `-aarch64.rpm`) | the same |
| AppImage | `chmod +x Keeper-linux-x86_64.AppImage` and run it | Keeper itself |
| .tar.gz | unpack anywhere and run `keeper` | Keeper tells you, you download |
| Script | `curl -fsSL …/install.sh \| sh` | as for the .deb, .rpm or AppImage it chose |

**apt repository**

```bash
curl -fsSL https://raw.githubusercontent.com/ashfordeOU/keeper/main/KEYS/keeper-release.asc | sudo gpg --dearmor -o /usr/share/keyrings/keeper.gpg
```

```bash
echo "deb [signed-by=/usr/share/keyrings/keeper.gpg] https://github.com/ashfordeOU/keeper/releases/latest/download /" | sudo tee /etc/apt/sources.list.d/keeper.list
```

```bash
sudo apt update && sudo apt install keeper
```

The repository is a signed flat repository attached to each release, so packages come straight from GitHub Releases.

**dnf repository**

```bash
sudo curl -fsSL -o /etc/yum.repos.d/keeper.repo https://keeper.ashforde.org/rpm/keeper.repo
```

```bash
sudo dnf install keeper
```

On openSUSE, save the same file as `/etc/zypp/repos.d/keeper.repo` and run `sudo zypper install keeper`. The repository metadata is signed with the release key, and packages are downloaded from GitHub Releases.

> The apt and dnf repositories, Flathub, the AUR and the Snap Store are switched on by the maintainers one channel at a time. The [Maintainers](#maintainers-channels-secrets-and-signing) table shows the state of each. Until a channel is live, use the script or a file from the release.

AppImages need FUSE 2, for example `sudo apt install libfuse2`. Without it, run the AppImage with `--appimage-extract-and-run`. Optional helpers for now playing, dictation and download sources: `playerctl`, `xdotool` (or `wtype` on Wayland), and `attr`.

## Only the `keeper` command

The desktop app already includes the `keeper` command. On servers, or anywhere you don't want the app:

```bash
npm install -g keeper-cli
```

```bash
brew install ashfordeou/keeper/keeper-cli
```

Both need Node.js 22 or newer. The npm package is published with [provenance](https://docs.npmjs.com/generating-provenance-statements). Check it with `npm audit signatures`.

## Updates

Copies installed from a GitHub download (the dmg, the Windows installer, the AppImage, a .deb or .rpm file, or the script) update themselves. So do Homebrew and winget installs: the cask is marked `auto_updates`, and winget reads the new version back from Windows. Choose how in **Settings → Updates**: automatically, ask first, or only when you check.

**Check for Updates…** (in the menu-bar owl's menu, the Keeper menu on a Mac, the Help menu where a window shows one, and the command palette) opens a small **Software Update** window that checks at once. It says when Keeper is the newest version (with the channel, Beta or Stable, and when it last looked); when a newer one is out it shows the release notes with **Install and Relaunch**, **Later** and **Skip this version**; then the download's progress and **Relaunch Now**; and, if something fails, what went wrong with **Try Again** and a link to the releases page. Its **Install updates automatically** box is the same setting as in Settings → Updates, and **Settings…** opens that page. In "Ask before installing" mode an automatic check that finds a new version opens this window by itself; a version you skipped is not mentioned again until you check by hand. **About Keeper** (the owl's menu and the Keeper menu) opens a small window with the version, channel and licence.

To try the window against a fake release, serve a folder with a `releases.json` (the GitHub releases list format) and start Keeper with `KEEPER_UPDATE_FEED=http://127.0.0.1:PORT`; `test/e2e/update-window.cjs` does this.

Before an update goes in, Keeper checks it:

- The downloaded dmg, .deb or .rpm must match the release's `SHA256SUMS.txt`; otherwise it is deleted and nothing is installed. (The Windows installer and the AppImage are checked by electron-updater against the sha512 in the release's `latest*.yml`.)
- On macOS the new app's code signature must be valid (`codesign --verify --deep --strict`). When the running Keeper is signed with a certificate (the project's self-signed one, or a Developer ID), the new app must also meet the running app's designated requirement, so only a build signed the same way can replace it, with one exception: Keeper signed with Ashforde's Developer ID (`anchor apple generic`, a Developer ID Application certificate of team `D69G45342Y`, identifier `io.github.ashfordeou.keeper`). That bridge lets self-signed copies move to the Developer ID build on their own; once moved, a copy pins the Developer ID (its own requirement). Downloaded components are checked the same way. An ad-hoc signed copy (one built locally) only checks that the signature is valid.

On macOS, while Keeper is signed with the self-signed certificate, macOS may ask once after an update whether Keeper may use **Keeper Safe Storage** in your keychain. Type your login password and choose **Always Allow**. The update that moves Keeper to the Developer ID asks once more, and macOS may ask you to allow Keeper again in **Privacy & Security** (the permissions belong to the signature); after that, updates don't ask. The Software Update window says so before it restarts. [PERMISSIONS.md](PERMISSIONS.md#the-keychain-question-after-an-update-keeper-safe-storage) explains what happens if you choose Deny.

A beta (a version with a hyphen, like `0.3.0-beta.1`) updates to the next beta until a stable version newer than it is out; then it updates to that stable version and follows stable releases from there. Turn on **Include beta versions** in Settings → Updates to keep getting betas; a stable copy never gets a beta otherwise.

A release can be made for some systems only (macOS first, say). On the others it is invisible: Keeper only offers a version whose release has the installer for this computer (and, for the Windows installer and the AppImage, its `latest*.yml`), so those copies stay put until a release with their build comes out.

When any other package manager installed Keeper, let that package manager update it so its records stay right. Keeper detects these installs (`core/install-source.ts`):

| Installed with | Detected by | Update with |
|---|---|---|
| Homebrew | `Caskroom/keeper` under the Homebrew prefix | Keeper itself, or `brew upgrade --cask keeper` |
| Scoop | the app runs from `scoop\apps\` | `scoop update keeper` |
| Chocolatey | the `keeper-files` package under `chocolatey\lib` | `choco upgrade keeper-files` |
| Flatpak | the `FLATPAK_ID` variable | `flatpak update` |
| Snap | the `SNAP` variable | automatic (`snap refresh`) |
| AUR | `/usr/share/licenses/keeper-bin` | your AUR helper |
| apt repository | `/etc/apt/sources.list.d/keeper.list` | `sudo apt upgrade` |
| dnf repository | `/etc/yum.repos.d/keeper.repo` | `sudo dnf upgrade` |
| winget | can't be told apart from the plain installer | Keeper itself; winget sees the new version |

## Verifying a download

Every release carries several independent proofs that a file is the one GitHub Actions built from this repository.

1. **Checksums.** Download `SHA256SUMS.txt` next to your file, then run:

   ```bash
   sha256sum --check --ignore-missing SHA256SUMS.txt
   ```

   On macOS, use `shasum -a 256 --check --ignore-missing SHA256SUMS.txt`. On Windows, compare the checksum yourself with `Get-FileHash .\Keeper-setup-x64.exe`.

2. **Build attestation.** GitHub records which workflow run built each file. Check it with the [GitHub CLI](https://cli.github.com):

   ```bash
   gh attestation verify Keeper-linux-x86_64.AppImage --repo ashfordeOU/keeper
   ```

3. **Sigstore signature of the checksums.** `SHA256SUMS.txt` is signed without a long-lived key. The signature binds it to this repository's release workflow and is recorded in the public Rekor transparency log. To check it, download `SHA256SUMS.txt.sigstore.json` and run:

   ```bash
   cosign verify-blob SHA256SUMS.txt --bundle SHA256SUMS.txt.sigstore.json \
     --certificate-oidc-issuer https://token.actions.githubusercontent.com \
     --certificate-identity-regexp '^https://github.com/ashfordeOU/keeper/\.github/workflows/release\.yml@refs/(heads/main|tags/v)'
   ```

4. **GPG signatures**, once the release key is published in [KEYS/keeper-release.asc](../KEYS/keeper-release.asc). From then on, `SHA256SUMS.txt.asc` and an `.asc` for each AppImage come with every release. To check them:

   ```bash
   gpg --import KEYS/keeper-release.asc
   ```

   ```bash
   gpg --verify SHA256SUMS.txt.asc SHA256SUMS.txt
   ```

These prove where a file came from. They don't replace Apple's or Microsoft's own trust systems, which accept only certificates those companies issue or recognise. See [First launch](#macos) above.

## Uninstalling

Your files are never touched. Settings stay in `~/Library/Application Support/Keeper` (macOS), `%APPDATA%\Keeper` (Windows) or `~/.config/Keeper` (Linux) until you delete them.

| Installed with | Remove with |
|---|---|
| Script (macOS, Linux) | `curl -fsSL …/install.sh \| sh -s -- --uninstall` |
| Script (Windows) | `$env:KEEPER_UNINSTALL=1; irm …/install.ps1 \| iex` |
| Homebrew | `brew uninstall --cask keeper` (`--zap` also removes settings) |
| dmg | Drag Keeper from Applications to the Trash |
| Windows installer, winget | **Settings → Apps → Keeper → Uninstall**, or `winget uninstall Ashforde.Keeper` |
| Scoop | `scoop uninstall keeper` |
| Chocolatey | `choco uninstall keeper-files` |
| Portable | Delete `Keeper-portable.exe` |
| .deb / apt repository | `sudo apt remove keeper`, then delete `/etc/apt/sources.list.d/keeper.list` and `/usr/share/keyrings/keeper.gpg` |
| .rpm / dnf repository | `sudo dnf remove keeper`, then delete `/etc/yum.repos.d/keeper.repo` |
| AUR | `sudo pacman -Rns keeper-bin` |
| Flatpak | `flatpak uninstall io.github.ashfordeou.keeper` |
| Snap | `sudo snap remove keeper` |
| AppImage | Delete the file (the script's copy is `~/.local/bin/keeper.AppImage`) |
| npm | `npm uninstall -g keeper-cli` |

## How releases work

Nobody builds Keeper by hand. To release:

The exact steps are in [RELEASING.md](../RELEASING.md). In short:

1. Run **Release check** on `main` and wait for it to be green.
2. Bump `"version"` in `package.json` (and add a `## [x.y.z]` section to `CHANGELOG.md`; it becomes the release notes, unless `.github/release-notes/x.y.z.md` exists), push it to the `incoming` branch, and `sign-and-land.yml` signs it, moves `main` and starts the release.
3. GitHub Actions ([`.github/workflows/release.yml`](../.github/workflows/release.yml)) builds the systems listed in [`.github/release.json`](../.github/release.json) (all three, or macOS only, say), creates the tag `vx.y.z` on that commit and publishes the GitHub Release with `SHA256SUMS.txt`. A push whose version already has a release builds nothing; a running release is never cancelled by a later push.
4. Installed copies find the new release and update themselves. After a stable release the workflow also commits the new version and checksums to [`Casks/keeper.rb`](../Casks/keeper.rb) and the Scoop bucket through `incoming`, so those commits are signed too.

Versions with a hyphen (`0.3.0-beta.1`) are published as pre-releases: only betas, and copies with **Include beta versions** on, pick them up, and every package-manager channel and npm skip them. Pushing a tag `vx.y.z` that matches `package.json` still works, and **Run workflow** with *Build only* builds everything without publishing.

**One-time step: the Mac signing certificate.** macOS ties Accessibility, Screen Recording and other permissions to an app's signature. Ad-hoc signatures change with every build, so without a stable certificate people must grant them again after each update (the workflow warns about this). On your own Mac, run once:

```bash
scripts/make-signing-cert.sh
```

It creates a self-signed code-signing certificate named "Keeper Self-Signed" and stores it as the repository secrets `KEEPER_SIGNING_CERT` and `KEEPER_SIGNING_PASSWORD` (with the GitHub CLI if it is signed in; otherwise it copies each value to the clipboard and opens the secrets page; `--out DIR` only writes the two files). Every release after that is signed with it: [`scripts/ci-import-signing-cert.sh`](../scripts/ci-import-signing-cert.sh) imports it on the runner and [`build/after-sign.cjs`](../build/after-sign.cjs) re-signs the app before the dmg and zip are made. Don't run it again: a new certificate means everyone grants the permissions once more, and copies signed with the old one won't accept updates signed with the new one, so they need the install script once. A self-signed certificate doesn't satisfy Gatekeeper; the Developer ID (below) replaces it once `"macSigning"` in `.github/release.json` says `"developer-id"`.

## Maintainers: channels, secrets and signing

A release is a version bump in `package.json` on `main`, or a pushed tag such as `v0.2.0` (see [How releases work](#how-releases-work)). With no secrets at all, it still builds every installer, publishes the GitHub Release, writes `SHA256SUMS.txt`, signs that file with Sigstore and attests every file. Every other channel switches on when its secret exists; a channel whose secret is missing is skipped with a notice on the run's summary and never fails the release. Channels publish stable releases only, and only for the systems in the release.

| Channel | Status | Needs |
|---|---|---|
| GitHub Releases, install scripts | Works now | — |
| Build attestations, Sigstore signature | Works now | — |
| Scoop (this repository is the bucket) | The workflow commits `bucket/keeper.json` to `incoming`; `sign-and-land.yml` signs and lands it | `COMMIT_SIGNING_KEY` (the key `sign-and-land.yml` already uses); Windows in the release |
| Homebrew cask in this repository | The workflow commits `Casks/keeper.rb` the same way | `COMMIT_SIGNING_KEY`; macOS in the release |
| Stable Mac signature (keeps permissions across updates) | Needs a one-time step | `KEEPER_SIGNING_CERT` and `KEEPER_SIGNING_PASSWORD`, made by `scripts/make-signing-cert.sh` (see [How releases work](#how-releases-work)) |
| npm `keeper-cli` | Needs a secret | `NPM_TOKEN`: an npm automation token for an account that owns `keeper-cli` |
| Homebrew tap | Needs a secret and a one-time step | Create `ashfordeOU/homebrew-keeper`. `HOMEBREW_TAP_TOKEN` is a fine-grained token with *Contents: write* on that repository. |
| winget | Needs a one-time manual submission, then a secret | Submit the first version yourself (below). After that, `WINGET_TOKEN` is a classic token with `public_repo`, whose owner has a fork of `microsoft/winget-pkgs`. |
| Chocolatey `keeper-files` | Needs a secret, then moderation | `CHOCO_API_KEY` from community.chocolatey.org. The first version waits for human moderation. |
| AUR `keeper-bin` | Needs a one-time step and a secret | Create the AUR account and add its SSH key. `AUR_SSH_KEY` is the private key. The first push creates the package. |
| Snap Store | Needs a one-time step and a secret | `snapcraft register keeper`, then request classic confinement on the forum. `SNAPCRAFT_STORE_CREDENTIALS` comes from `snapcraft export-login -`. |
| Flathub | One-time manual submission | Open a pull request to `flathub/flathub` with the files from `packaging/flatpak` (rendered: `node scripts/render-packaging.mjs --only flatpak`). Flathub's bot proposes updates after that. Steps: [STORES.md → Flathub](STORES.md#flathub). |
| Microsoft Store | One-time Partner Center setup, then a manual upload per version | The `msstore` job builds the `.msix` as a workflow artifact. Variables `MSSTORE_IDENTITY_NAME` and `MSSTORE_PUBLISHER` come from Partner Center. Steps: [STORES.md](STORES.md#microsoft-store). |
| GPG signatures, apt and dnf repositories | Needs a secret and a one-time step | `KEEPER_GPG_PRIVATE_KEY` (plus `KEEPER_GPG_PASSPHRASE` if the key has one); see [KEYS/keeper-release.asc](../KEYS/keeper-release.asc). GitHub Pages (Source: GitHub Actions) serves the dnf repository with the website. |
| Sign in with Google / Microsoft (mail, calendars) | Needs a one-time step and secrets | Create a Google Cloud OAuth client of type *Desktop app* (Gmail and Calendar scopes; the consent screen must be verified for public use), and a Microsoft Entra app registration (public client, redirect `http://localhost`, IMAP/SMTP and Graph Calendars delegated permissions). Secrets: `KEEPER_GOOGLE_CLIENT_ID`, `KEEPER_GOOGLE_CLIENT_SECRET`, `KEEPER_MS_CLIENT_ID`. They are compiled into the build. Without them the sign-in buttons stay hidden and people use app passwords. |
| macOS Developer ID and notarization | Paid; switched on by `"macSigning": "developer-id"` in `.github/release.json`, never by a secret alone | `KEEPER_DEVELOPER_ID_CERT` (base64 .p12 Developer ID Application certificate), `KEEPER_DEVELOPER_ID_PASSWORD`, `APPLE_ID`, `APPLE_TEAM_ID` (`D69G45342Y`), `APPLE_APP_PASSWORD` (app-specific password). All required once switched on. See [RELEASING.md → Moving to the Developer ID](../RELEASING.md#moving-to-the-developer-id) |
| Windows code signing | Optional | A certificate: `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`. Or Azure Trusted Signing: secrets `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` and variables `AZURE_TRUSTED_SIGNING_ENDPOINT`, `AZURE_TRUSTED_SIGNING_ACCOUNT`, `AZURE_TRUSTED_SIGNING_PROFILE` |

Pre-release tags (`v0.2.0-beta.1`) go to GitHub only and skip every channel above. See [BETA.md](BETA.md).

**Signing, honestly.**

- **Free.** Attestations, Sigstore and GPG are free and prove a file came from this repository's workflow.
- **macOS.** Gatekeeper accepts only an Apple Developer ID certificate ($99 a year) plus notarization. Without one, builds are signed with the free self-signed certificate (`KEEPER_SIGNING_CERT`), or ad-hoc when that is missing; either is enough for Apple silicon to run them once the user allows it, and only the self-signed certificate keeps permissions across updates.
  - With `"macSigning": "developer-id"`, the workflow builds with [`packaging/electron-builder.signed.cjs`](../packaging/electron-builder.signed.cjs): the Developer ID signature with the hardened runtime and [`build/entitlements.mac.plist`](../build/entitlements.mac.plist) on the app and everything inside it (keeper-helper, Keeper Intents.app, agent-desktop), notarization and stapling for both the core and the full edition, and [`scripts/check-mac-signing.mjs`](../scripts/check-mac-signing.mjs) checks every dmg before upload. A missing secret fails the build; it never falls back to the self-signed certificate. With `"self-signed"` the Developer ID secrets (and any `CSC_LINK`) are not passed to the build at all.
- **Windows.** SmartScreen trusts only certificates from recognised authorities. Three options:
  - [SignPath](https://signpath.io) on a paid plan. Its free foundation programme is only for projects under an OSI-approved licence, which Keeper no longer has.
  - Azure Trusted Signing costs a few dollars a month but needs an organisation with three years of history.
  - A standard OV certificate also works.

  Each one is wired in through the variables above.

**First winget submission.** Run:

```bash
node scripts/render-packaging.mjs --only winget --assets <folder with the release files>
```

Then copy `dist-packaging/winget/*.yaml` to `manifests/a/Ashforde/Keeper/<version>/` in a fork of `microsoft/winget-pkgs`, check them with `winget validate`, and open the pull request.

**Rendering manifests by hand.** Run:

```bash
node scripts/render-packaging.mjs --version 0.2.0 --assets release --cli dist-cli/keeper.cjs
```

This fills every template in `packaging/` with that version and the checksums from `release/SHA256SUMS.txt`. If that file doesn't exist, the checksums come from the files themselves. The output goes to `dist-packaging/`.
