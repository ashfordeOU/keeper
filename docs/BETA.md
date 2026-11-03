<!-- SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0 -->
# Betas

A beta is a normal release with a hyphen in its version, like `0.1.0-beta.1`. It goes to
GitHub as a pre-release and nowhere else. Testers install it by hand, and copies that opted in
get the next beta through Keeper's own updater. Package managers and stores only ever see
stable versions.

For testers: [how to install](#for-testers-installing-a-beta), then the
[beta checklist](BETA-CHECKLIST.md).

## Cutting a beta

1. Set the version in `package.json` (and `package-lock.json`) to the beta version:

   ```sh
   npm version 0.1.0-beta.1 --no-git-tag-version
   ```

2. Optional: add a `## [0.1.0-beta.1]` section to `CHANGELOG.md`. The release notes are taken
   from it; without one they say "Keeper 0.1.0-beta.1" plus GitHub's list of changes.
3. Commit and push to main. A push that changes the version in `package.json` publishes that
   version, and the release creates the tag `v0.1.0-beta.1` (pushing that tag yourself works
   too):

   ```sh
   git commit -am "Keeper 0.1.0-beta.1"
   git push origin main
   ```

4. The release workflow ([`.github/workflows/release.yml`](../.github/workflows/release.yml))
   does the rest. Once the release appears, run the [smoke test](BETA-CHECKLIST.md#15-minute-smoke-test)
   on at least one Mac and one PC.

The next beta is `-beta.2`, and so on. The final release drops the suffix (`v0.1.0`). Versions
compare as semver, so `0.1.0-beta.2` < `0.1.0-beta.10` < `0.1.0`.

### What the workflow does with a beta

| Step | Stable `0.1.0` | Beta `0.1.0-beta.1` |
| --- | --- | --- |
| Builds for macOS, Windows and Linux, tests, checksums, Sigstore and GPG signatures, attestations | yes | yes |
| GitHub release | normal, marked latest | **pre-release**, not marked latest |
| Update information (`latest*.yml`) attached | yes | yes (so beta testers' copies can update) |
| Homebrew tap, winget, Chocolatey, Scoop bucket | yes, if the secret exists | **no** |
| Snap Store, AUR | yes, if the secret exists | **no** |
| npm (`keeper-cli`) | yes, tag `latest` | **no** |
| apt and dnf repositories (keeper.ashforde.org) | yes, with the GPG key | **no** |
| Flathub | its bot follows `releases/latest`, which skips pre-releases | **no** |
| Microsoft Store package (`.msix`) | built as a workflow artifact | built as a workflow artifact (never submitted automatically) |

A version counts as a beta when it contains a hyphen. The `tag` job decides this once
(`prerelease=true`), and every channel job checks `needs.release.outputs.prerelease ==
'false'`. `test/release-workflow.test.ts` fails if a new publishing job forgets that check.

`electron-builder.yml` sets `detectUpdateChannel: false`. Without it, a beta build would write
`beta*.yml` instead of `latest*.yml`, and the workflow (which uploads `latest*.yml`) would leave
the beta without update information.

### Pulling a bad beta

Delete the pre-release on GitHub, or mark it as a draft. Keeper's updater skips drafts, so
nobody new gets it. Copies that already installed it move on with the next beta. Don't reuse a
tag: cut `-beta.N+1`.

## For testers: installing a beta

1. Open the release page, <https://github.com/ashfordeOU/keeper/releases>, and find the newest
   entry marked **Pre-release**.
2. Download the file for your computer:

   | Computer | File |
   | --- | --- |
   | Mac with Apple silicon (M1 and later) | `Keeper-mac-arm64.dmg` |
   | Mac with an Intel processor | `Keeper-mac-x64.dmg` |
   | Windows 10 or 11 (also on ARM) | `Keeper-setup-x64.exe` |
   | Linux | `Keeper-linux-x86_64.AppImage` (or `.deb`, `.rpm`) |

   The `releases/latest/download/…` links in [INSTALL.md](INSTALL.md) always point at the newest
   *stable* version, never a beta.
3. Install it as usual. A beta installs over a stable copy and keeps your settings and library.
   What macOS and Windows may ask on first launch: [INSTALL.md → macOS](INSTALL.md#macos) and
   [Windows](INSTALL.md#windows).
4. In Keeper: Settings → Updates → check that **Include beta versions** is on. A beta copy
   follows betas by itself unless you switched this off by hand before. Without it, a beta
   copy only updates to the next *stable* version.

Copies installed with a package manager (Homebrew, winget, Scoop, Chocolatey, Snap, Flatpak, the
AUR or the apt/dnf repositories) and Store copies never see betas. To test one, install the
download from GitHub instead. On macOS, uninstall the Homebrew cask first so the two don't fight
over `/Applications/Keeper.app`.

## Update channels: stable and beta

There are two channels, and one switch chooses between them: Settings → Updates → **Include
beta versions**.

- **Stable** (switch off, the default for stable builds): Keeper offers the newest non-pre-release version that is
  newer than the one running.
- **Beta** (switch on): Keeper offers the newest version of any kind, beta or stable, that is
  newer than the one running. When `0.2.0` is out, a beta tester on `0.2.0-beta.3` gets `0.2.0`,
  and then the `0.3.0` betas once they start.
- **A beta build nobody switched** (the switch shows on, but the person never touched it) follows
  betas until a stable version newer than it is out, then takes that stable version and follows
  stable from there. This is how the 0.1.0 betas move to 1.0.0 and stay on stable releases.

Only releases with a build for this computer count: a macOS-only release is never offered on
Windows or Linux (`releaseFits` in `core/updates.ts`).

The choice is made by `pickUpdate` in [`core/updates.ts`](../core/updates.ts), from the GitHub
releases list. Drafts are always skipped. The Windows installer and the AppImage then download
through electron-updater, which reads the `latest*.yml` of exactly the release chosen (not GitHub's
latest release). Macs download the `.dmg` themselves, and `.deb`/`.rpm`
copies download the package and ask for the system password.

**Going back to stable** from a beta: switch **Include beta versions** off. Keeper never
downgrades, so you stay on the beta until a stable version newer than it comes out. To go back
right away, install the stable download over it.

Ideas for later (not built):

- A separate `beta` channel file for each platform, if betas ever need different update
  information from stable versions.
