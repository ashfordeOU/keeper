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
- Every download is checked against the release's `SHA256SUMS.txt`. Nothing is installed if the checksum doesn't match, or if the release has no checksums.
- If the [GitHub CLI](https://cli.github.com) is installed and signed in, the script also checks the file's build attestation.
- Each script puts a `keeper` command on your PATH: in `~/.local/bin` on macOS and Linux, and in `%LOCALAPPDATA%\Keeper\bin` on Windows. Run `keeper` with no arguments to open the app, or `keeper --help` for the command line.

Options:

| macOS / Linux (`sh -s -- …`) | Windows | |
|---|---|---|
| `--version 0.2.0` | `-Version 0.2.0` | A specific version instead of the latest |
| `--beta` | | The newest release, betas included (a beta copy then keeps updating to betas) |
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

> **First launch.** Until releases are signed with an Apple Developer ID and notarized, macOS doesn't recognise the developer. Gatekeeper accepts only Apple-issued certificates, and no self-signed certificate can satisfy it. The install script removes the quarantine flag for you. If you used Homebrew or the dmg on macOS 15 or later, open Keeper once, then open **System Settings → Privacy & Security** and click **Open Anyway** (on older versions, Control-click Keeper and choose **Open**). Or run:
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
sudo curl -fsSL -o /etc/yum.repos.d/keeper.repo https://ashfordeou.github.io/keeper/rpm/keeper.repo
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
- On macOS the new app's code signature must be valid (`codesign --verify --deep --strict`). When the running Keeper is signed with a certificate (the project's self-signed one, or a Developer ID), the new app must also meet the running app's designated requirement, so only a build signed the same way can replace it. An ad-hoc signed copy (one built locally) only checks that the signature is valid.

A beta (a version with a hyphen, like `0.3.0-beta.1`) updates to the next beta, and to the next stable release, unless you turn off **Include beta versions** in Settings → Updates.

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

1. Bump `"version"` in `package.json` on `main` (and add a `## [x.y.z]` section to `CHANGELOG.md`; it becomes the release notes).
2. GitHub Actions ([`.github/workflows/release.yml`](../.github/workflows/release.yml)) sees the change, builds every platform and processor, creates the tag `vx.y.z` on that commit and publishes the GitHub Release with `SHA256SUMS.txt`. A push whose version already has a release builds nothing; a running release is never cancelled by a later push.
3. Installed copies find the new release and update themselves. After a stable release the workflow also commits the new version and checksums to [`Casks/keeper.rb`](../Casks/keeper.rb) and the Scoop bucket.

Versions with a hyphen (`0.3.0-beta.1`) are published as pre-releases: only betas, and copies with **Include beta versions** on, pick them up, and package-manager channels skip them (npm publishes them under `next`). Pushing a tag `vx.y.z` that matches `package.json` still works, and **Run workflow** with *Build only* builds everything without publishing.

**One-time step: the Mac signing certificate.** macOS ties Accessibility, Screen Recording and other permissions to an app's signature. Ad-hoc signatures change with every build, so without a stable certificate people must grant them again after each update (the workflow warns about this). On your own Mac, run once:

```bash
scripts/make-signing-cert.sh
```

It creates a self-signed code-signing certificate named "Keeper Self-Signed" and stores it as the repository secrets `KEEPER_SIGNING_CERT` and `KEEPER_SIGNING_PASSWORD` (with the GitHub CLI if it is signed in; otherwise it copies each value to the clipboard and opens the secrets page; `--out DIR` only writes the two files). Every release after that is signed with it: [`scripts/ci-import-signing-cert.sh`](../scripts/ci-import-signing-cert.sh) imports it on the runner and [`build/after-sign.cjs`](../build/after-sign.cjs) re-signs the app before the dmg and zip are made. Don't run it again: a new certificate means everyone grants the permissions once more, and copies signed with the old one won't accept updates signed with the new one, so they need the install script once. A self-signed certificate doesn't satisfy Gatekeeper; a Developer ID (`CSC_LINK`, below) replaces it when there is one.

## Maintainers: channels, secrets and signing

A release is a version bump in `package.json` on `main`, or a pushed tag such as `v0.2.0` (see [How releases work](#how-releases-work)). With no secrets at all, it still builds every installer, publishes the GitHub Release, writes `SHA256SUMS.txt`, signs that file with Sigstore, attests every file, and updates the Scoop bucket and the Homebrew cask in this repository. Every other channel switches on when its secret exists. Package-manager channels publish stable releases only. npm publishes pre-releases under the `next` tag.

| Channel | Status | Needs |
|---|---|---|
| GitHub Releases, install scripts | Works now | — |
| Build attestations, Sigstore signature | Works now | — |
| Scoop (this repository is the bucket) | Works now: the workflow commits `bucket/keeper.json` | An unprotected default branch, or update it by hand |
| Homebrew cask in this repository | Works now: the workflow commits `Casks/keeper.rb` | An unprotected default branch, or update it by hand |
| Stable Mac signature (keeps permissions across updates) | Needs a one-time step | `KEEPER_SIGNING_CERT` and `KEEPER_SIGNING_PASSWORD`, made by `scripts/make-signing-cert.sh` (see [How releases work](#how-releases-work)) |
| npm `keeper-cli` | Needs a secret | `NPM_TOKEN`: an npm automation token for an account that owns `keeper-cli` |
| Homebrew tap | Needs a secret and a one-time step | Create `ashfordeOU/homebrew-keeper`. `HOMEBREW_TAP_TOKEN` is a fine-grained token with *Contents: write* on that repository. |
| winget | Needs a one-time manual submission, then a secret | Submit the first version yourself (below). After that, `WINGET_TOKEN` is a classic token with `public_repo`, whose owner has a fork of `microsoft/winget-pkgs`. |
| Chocolatey `keeper-files` | Needs a secret, then moderation | `CHOCO_API_KEY` from community.chocolatey.org. The first version waits for human moderation. |
| AUR `keeper-bin` | Needs a one-time step and a secret | Create the AUR account and add its SSH key. `AUR_SSH_KEY` is the private key. The first push creates the package. |
| Snap Store | Needs a one-time step and a secret | `snapcraft register keeper`, then request classic confinement on the forum. `SNAPCRAFT_STORE_CREDENTIALS` comes from `snapcraft export-login -`. |
| Flathub | One-time manual submission | Open a pull request to `flathub/flathub` with the files from `packaging/flatpak` (rendered: `node scripts/render-packaging.mjs --only flatpak`). Flathub's bot proposes updates after that. |
| GPG signatures, apt and dnf repositories | Needs a secret and a one-time step | `KEEPER_GPG_PRIVATE_KEY` (plus `KEEPER_GPG_PASSPHRASE` if the key has one); see [KEYS/keeper-release.asc](../KEYS/keeper-release.asc). Enable GitHub Pages from the `gh-pages` branch for the dnf repository. |
| macOS Developer ID and notarization | Optional, paid | `CSC_LINK` (base64 .p12 Developer ID Application certificate), `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` |
| Windows code signing | Optional | A certificate: `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`. Or Azure Trusted Signing: secrets `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` and variables `AZURE_TRUSTED_SIGNING_ENDPOINT`, `AZURE_TRUSTED_SIGNING_ACCOUNT`, `AZURE_TRUSTED_SIGNING_PROFILE` |

**Signing, honestly.**

- **Free.** Attestations, Sigstore and GPG are free and prove a file came from this repository's workflow.
- **macOS.** Gatekeeper accepts only an Apple Developer ID certificate ($99 a year) plus notarization. Without one, builds are signed with the free self-signed certificate (`KEEPER_SIGNING_CERT`), or ad-hoc when that is missing; either is enough for Apple silicon to run them once the user allows it, and only the self-signed certificate keeps permissions across updates.
  - When `CSC_LINK` is set, the workflow builds with [`packaging/electron-builder.signed.cjs`](../packaging/electron-builder.signed.cjs). That turns on the hardened runtime with [`build/entitlements.mac.plist`](../build/entitlements.mac.plist), and notarizes when the Apple ID secrets are present too.
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
