# Releasing Keeper

Keeper is never built on a person's computer. Every release is built, signed, checked and
published by GitHub Actions from `main`. A release is started by changing `"version"` in
`package.json`; which systems it covers comes from [`.github/release.json`](.github/release.json).

- [The workflows](#the-workflows)
- [One-time setup](#one-time-setup)
- [Releasing a version](#releasing-a-version)
- [macOS only, or all three](#macos-only-or-all-three)
- [Checking a release](#checking-a-release)
- [Moving to the Developer ID](#moving-to-the-developer-id)
- [Keeper 1.0.0](#keeper-100)
- [When something goes wrong](#when-something-goes-wrong)

## The workflows

| Workflow | Started by | What it does |
|---|---|---|
| [`sign-and-land.yml`](.github/workflows/sign-and-land.yml) | a push to `incoming`, or another workflow | Signs each new commit as ashfordeOU with `COMMIT_SIGNING_KEY`, moves `main` to them, starts CI, starts the release when the version changed, and the website when its sources changed |
| [`release-check.yml`](.github/workflows/release-check.yml) | you, by hand | The gate: CI in full (type checks, unit tests, builds, performance budgets, native e2e on macOS and Windows), the release build for the systems to release without publishing (`KEEPER_REQUIRE_ALL`), and a check that every commit on `main` since the last tag is Verified and by ashfordeOU |
| [`release.yml`](.github/workflows/release.yml) | a version change landing on `main`, a `v*` tag, or by hand | Builds, publishes the GitHub Release, then the channels (Homebrew, Scoop, winget, Chocolatey, AUR, Snap, npm, apt/dnf) for a stable release |
| [`ci.yml`](.github/workflows/ci.yml) | every push and pull request | Tests and builds; native e2e on pushes to `main` |
| [`resign-history.yml`](.github/workflows/resign-history.yml) | you, by hand | *Verify only* checks every branch and tag is Verified |
| [`remove-old-releases.yml`](.github/workflows/remove-old-releases.yml) | you, by hand | Deletes old pre-releases (and, with *delete_tags*, their tags) once a stable release 1.0.0 or later is out |
| [`site.yml`](.github/workflows/site.yml) | a change to `site/`, the README, the changelog or `docs/` landing on `main` (sign-and-land starts it), a published release, or by hand | Builds the website (`node site/build.mjs`) and publishes it to the root of `gh-pages`, signed as ashfordeOU, next to the dnf repository. Settings → Pages → Source must be *Deploy from a branch*, `gh-pages`, `/ (root)`, with the custom domain `keeper.ashforde.org` (the build writes `CNAME`; Cloudflare: CNAME `keeper` → `ashfordeou.github.io`, DNS only): https://keeper.ashforde.org/ |

A version with a hyphen (`1.1.0-beta.1`) is a pre-release: GitHub only, no channels, and only
copies with betas on (or beta copies) take it. See [docs/BETA.md](docs/BETA.md).

## One-time setup

Repository → Settings → Secrets and variables → Actions. Only `COMMIT_SIGNING_KEY` and the Mac
certificate matter for a normal release; every other row is a channel that is **skipped with a
notice** on the run's summary when its secret is missing. A missing secret never fails a release.

| Secret / variable | Used by | Without it |
|---|---|---|
| `COMMIT_SIGNING_KEY` (secret): private SSH key whose public half is a Signing Key on the ashfordeOU account | `sign-and-land.yml`; the `manifests` job (Casks/keeper.rb, bucket/keeper.json via `incoming`); the `pages` job (gh-pages, signed in the job); `site.yml` (the website on gh-pages, signed the same way); signs the Homebrew tap commit | Nothing lands on `main` at all; the cask/bucket and gh-pages updates are skipped, and the website is built but not published |
| `KEEPER_SIGNING_CERT`, `KEEPER_SIGNING_PASSWORD` (secrets): the "Keeper Self-Signed" certificate from `scripts/make-signing-cert.sh` (made once, never again) | macOS builds (`build/after-sign.cjs`) | Ad-hoc signed: people grant permissions again after every update and the updater cannot check the signer. **Required for 1.0.0.** |
| `HOMEBREW_TAP_TOKEN` (secret): fine-grained token, *Contents: write* on `ashfordeOU/homebrew-keeper` (create that repository first) | `homebrew` job (`brew install --cask ashfordeou/keeper/keeper`, `keeper-cli` formula) | Skipped; `brew tap ashfordeOU/keeper https://github.com/ashfordeOU/keeper` (the cask in this repository) still works |
| `NPM_TOKEN` (secret): npm automation token for the owner of `keeper-cli` | `npm` job (publishes with provenance) | Skipped |
| `WINGET_TOKEN` (secret): classic token with `public_repo`, owner has a fork of `microsoft/winget-pkgs`; submit the first version by hand ([docs/INSTALL.md](docs/INSTALL.md#maintainers-channels-secrets-and-signing)) | `winget` job (Windows in the release) | Skipped |
| `CHOCO_API_KEY` (secret): community.chocolatey.org API key; the first version waits for moderation | `chocolatey` job (Windows in the release) | Skipped |
| `AUR_SSH_KEY` (secret): private key of the AUR account; the first push creates `keeper-bin` | `aur` job (Linux in the release), commits as ashfordeOU | Skipped |
| `SNAPCRAFT_STORE_CREDENTIALS` (secret): `snapcraft export-login -` after `snapcraft register keeper` and classic confinement approval | `snap` job (Linux in the release) | Skipped |
| `KEEPER_GPG_PRIVATE_KEY`, optional `KEEPER_GPG_PASSPHRASE` (secrets): the key in `KEYS/keeper-release.asc` | GPG signatures, apt and dnf repositories (Linux in the release); `pages` then publishes the dnf repository (needs GitHub Pages on `gh-pages`) | No `.asc` files, no apt/dnf repositories |
| `MSSTORE_IDENTITY_NAME`, `MSSTORE_PUBLISHER` (variables) from Partner Center | `msstore` job (Windows in the release): the `.msix` workflow artifact, uploaded by hand | The `.msix` has placeholder identity (a warning); Partner Center refuses it |
| `KEEPER_DEVELOPER_ID_CERT` (base64 .p12 of the "Developer ID Application" certificate), `KEEPER_DEVELOPER_ID_PASSWORD`, `APPLE_ID`, `APPLE_TEAM_ID` (`D69G45342Y`), `APPLE_APP_PASSWORD` (app-specific password) | Developer ID signing, notarization and stapling (`packaging/electron-builder.signed.cjs`), only when `"macSigning"` in `.github/release.json` is `"developer-id"` | Not read while `"macSigning"` is `"self-signed"`. With `"developer-id"`, a missing one **fails** the build (never a quiet self-signed release). A raw `CSC_LINK` / `CSC_KEY_PASSWORD` / `APPLE_APP_SPECIFIC_PASSWORD` works in their place, and is likewise ignored while self-signed. See [Moving to the Developer ID](#moving-to-the-developer-id) |
| `KEEPER_INSTALLER_CERT` (base64 .p12 of "Developer ID Installer: Ashforde OU (D69G45342Y)"), `KEEPER_INSTALLER_PASSWORD` | Reserved for a future signed `.pkg` installer; nothing reads them yet | Nothing changes (no `.pkg` is built) |
| `WIN_CSC_LINK`/`WIN_CSC_KEY_PASSWORD`, or `AZURE_*` secrets and variables | Windows code signing | Unsigned; SmartScreen asks on first launch |

Also: Settings → Actions → General → *Workflow permissions*: **Read and write**. Nothing may
push to `main` except `sign-and-land.yml`; if `main` is protected, allow GitHub Actions to push
to it (and to `incoming`).

## Releasing a version

1. **Changelog.** Rename `## [Unreleased]` in `CHANGELOG.md` to `## [x.y.z] - YYYY-MM-DD`. It
   becomes the release notes. For a release that deserves a summary instead (1.0.0), write
   `.github/release-notes/x.y.z.md`; it is used as written. Long changelog sections fold on
   GitHub; the workflow adds the platforms line, the install commands and the first-launch notes.
2. **Systems.** Set `"platforms"` in `.github/release.json` (see below).
3. **Gate.** Commit 1 and 2, push them to `incoming` (`git push origin HEAD:incoming`), wait for
   them to land on `main`, then run **Actions → Release check → Run workflow** on `main` (leave
   *platforms* empty to check what `.github/release.json` says). Every job must be green:
   *CI* (with native e2e on macOS and Windows and the performance budgets), *Release build* (one
   job per system and processor, plus the Store package with Windows) and *Commits since the
   last release are Verified*.
4. **Bump.** Set `"version"` to `x.y.z` in `package.json` and in the two `"version"` fields at
   the top of `package-lock.json` (or `npm version x.y.z --no-git-tag-version`, which installs
   nothing). Commit as ashfordeOU and push to `incoming`:

   ```bash
   git fetch origin && git rebase origin/main
   git commit -am "Keeper x.y.z"
   git push origin HEAD:incoming
   ```

   `sign-and-land.yml` signs the commit, moves `main`, and starts CI and **Release**.
5. **Check** the release (below).

**By hand instead:** once the version is on `main`, **Actions → Release → Run workflow** on
`main` publishes it; *platforms* (`mac`, `windows`, `linux`, comma-separated, or `all`)
overrides `.github/release.json` for that run, and *Build only* publishes nothing.

## macOS only, or all three

`.github/release.json`:

```text
{ "platforms": ["mac", "windows", "linux"] }    all three
{ "platforms": ["mac"] }                        macOS first
```

| | All three | macOS only |
|---|---|---|
| Built | macOS arm64 and x64, Windows x64, Linux x64 and ARM64, Store `.msix` | macOS arm64 and x64 |
| Release files | everything, with every `latest*.yml` | dmg, zip, `latest-mac-*.yml`, the npm package, `SHA256SUMS.txt` (also the components and full installer for macOS) |
| Windows and Linux copies | update | see no update: their installer and `latest.yml` / `latest-linux*.yml` are not in it |
| Install scripts | newest release | `install.sh` on a Mac takes it; on Linux, and `install.ps1`, take the newest release that has their file |
| Channels | all (with their secrets) | Homebrew cask and tap, npm. winget, Scoop, Chocolatey, AUR, Snap, apt/dnf and the Store package are skipped with a notice |
| GitHub's "latest" | yes | only when there is no stable release yet; afterwards the last full release stays "latest", so the README's links, the apt source and Flathub keep working |

The systems left out follow in the next version (`x.y.z+1` with all three). Don't add files to
a published release; release a new version.

## Checking a release

- The run's summary: every job green or skipped; read the notices (which channel was skipped and
  why, which systems the release covers).
- The release page: the notes read well, the files are there for the systems released, and
  `SHA256SUMS.txt` with `SHA256SUMS.txt.sigstore.json`.
- `gh attestation verify Keeper-mac-arm64.dmg --repo ashfordeOU/keeper` on a downloaded file.
- A Mac with the previous version: **Check for Updates…** offers it, installs it and relaunches;
  the keychain question appears once (**Always Allow**); permissions are kept (the move to the
  Developer ID asks once more, see [Moving to the Developer ID](#moving-to-the-developer-id)).
- For a macOS-only release: a Windows or Linux copy says it is up to date, and
  `curl -fsSL https://raw.githubusercontent.com/ashfordeOU/keeper/main/scripts/install.sh | sh`
  on Linux still installs the previous version.
- `main` has the *Homebrew: Keeper x.y.z* commit (and *Scoop* with Windows), Verified. Run
  **Re-sign history** with *Verify only* (type `re-sign main`) to check every branch and tag.

## Moving to the Developer ID

`"macSigning"` in [`.github/release.json`](.github/release.json) says who signs the Mac build:
`"self-signed"` (default, the "Keeper Self-Signed" certificate) or `"developer-id"`
(Ashforde OÜ's Apple Developer ID, team `D69G45342Y`, hardened runtime, notarized and stapled,
core and full editions). Only this setting switches it; adding a secret never does. A manual
run of **Release** can override it with *mac_signing*.

The signer change has to reach copies in two steps, **bridge first, then flip**:

1. **The bridge release (self-signed).** Installed copies only accept an update that meets their
   own designated requirement, which for a self-signed copy names the "Keeper Self-Signed"
   certificate. The updater (and the components check) also accepts Keeper signed with
   Ashforde's Developer ID (`DEVELOPER_ID_APP_REQUIREMENT` in
   [`core/update-verify.ts`](core/update-verify.ts), where the Team ID is written once). Ship a
   release with that code while `"macSigning"` is still `"self-signed"`, and give copies time
   to take it (they check every six hours; a week or two is kind). Copies older than the bridge
   refuse the Developer ID build ("not signed by the same developer") and need the install
   script once.
2. **Secrets.** Add `KEEPER_DEVELOPER_ID_CERT`, `KEEPER_DEVELOPER_ID_PASSWORD`, `APPLE_ID`,
   `APPLE_TEAM_ID` and `APPLE_APP_PASSWORD` (table above). The release maps them to what
   electron-builder reads: `KEEPER_DEVELOPER_ID_CERT` → `CSC_LINK`,
   `KEEPER_DEVELOPER_ID_PASSWORD` → `CSC_KEY_PASSWORD`, `APPLE_APP_PASSWORD` →
   `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_ID` and `APPLE_TEAM_ID` as they are.
3. **Try it without publishing.** **Actions → Release → Run workflow** on `main` with *Build only*
   and *mac_signing* `developer-id`. The Mac jobs sign, notarize (a few minutes per edition and
   processor), staple, and run [`scripts/check-mac-signing.mjs`](scripts/check-mac-signing.mjs)
   on every dmg: Developer ID of team `D69G45342Y` on the app, keeper-helper, Keeper Intents.app
   and agent-desktop, hardened runtime, a stapled ticket, Gatekeeper's "Notarized Developer ID",
   and the requirement self-signed copies accept. A missing secret fails here, by name.
4. **Flip.** Set `"macSigning": "developer-id"`, add a changelog line, and release the next
   version as usual. Its notes start with a hidden marker
   (`<!-- keeper:mac-signing=developer-id -->`) and drop the **Open Anyway** step; a self-signed
   copy's Software Update window shows one line instead of the usual keychain note: *"This
   update is signed with Ashforde's Apple Developer ID. macOS will ask once more for your login
   password (choose Always Allow) and may ask you to allow Keeper again in Privacy & Security.
   After this, updates won't ask."*
5. **Check** on a Mac with the bridge release: **Check for Updates…** shows that line, installs and
   relaunches; the keychain asks once (**Always Allow**); Settings → Permissions shows what to
   allow again. `codesign -dv --verbose=2 /Applications/Keeper.app` shows
   `Authority=Developer ID Application: Ashforde OU (D69G45342Y)`, and
   `spctl -a -vv /Applications/Keeper.app` says `source=Notarized Developer ID`. The next update
   asks nothing.

Never flip back: a Developer ID copy pins the Developer ID (its own requirement) and refuses a
self-signed build. Keep `KEEPER_SIGNING_CERT` until no self-signed release is being made.

## Keeper 1.0.0

The first stable release. Until now only `0.1.0-beta.N` pre-releases shipped.

1. **First, 0.1.0-beta.8 for all three systems.** Copies on beta.7 and older offer a
   macOS-only 1.0.0 on Windows and Linux too ("no installer for this computer yet"), because
   their updater does not yet skip releases without their build. beta.8 carries the updater that
   does. Release it with all three systems, and give beta copies a day to update (they check every
   six hours) before 1.0.0.
2. Make sure `KEEPER_SIGNING_CERT` and `KEEPER_SIGNING_PASSWORD` are set (the self-signed
   certificate the betas were signed with; never make a new one) and `COMMIT_SIGNING_KEY`.
3. `CHANGELOG.md`: `## [Unreleased]` becomes `## [1.0.0] - date`. Read
   [`.github/release-notes/1.0.0.md`](.github/release-notes/1.0.0.md) against it and adjust; the
   release uses that file.
4. Run **Release check** with all three systems.
   - All green: keep `"platforms": ["mac", "windows", "linux"]`.
   - Windows or Linux not clean: set `"platforms": ["mac"]`, run **Release check** again for
     macOS, and ship Windows and Linux as 1.0.1 once their checks pass.
5. Bump to `1.0.0` through `incoming` as above, and check the release.

What people get: beta copies update to 1.0.0 by themselves and then follow stable releases
(unless they turned **Include beta versions** on, then they keep getting betas); a stable copy
never gets a beta. While Mac builds are self-signed, the first launch on a Mac needs **Open
Anyway** after a download, and macOS asks once per update to use the keychain item; both go away
with the Developer ID build ([Moving to the Developer ID](#moving-to-the-developer-id)).

## Branches and old releases

The repository keeps three branches and nothing else:

| Branch | What it is | Who writes to it |
|---|---|---|
| `main` | What every release and install comes from. Every commit signed and by ashfordeOU | `sign-and-land.yml` only |
| `incoming` | The landing lane: push here and `sign-and-land.yml` signs and moves `main` | You, with `git push origin HEAD:incoming` |
| `gh-pages` | The website and the dnf repository | Deploy jobs only (the release's `pages` job) |

- Work happens in local branches or worktrees. Rebase onto `origin/incoming` before pushing, and
  never push a work branch to GitHub: if one is needed as a backup, delete it once its commits
  are on `main` (same subjects; `sign-and-land.yml` gives them new hashes).
- Check now and then: `git ls-remote --heads origin` should list only the three above.
- Under Settings → General, turn on *Automatically delete head branches* so a merged pull
  request's branch goes by itself.

Old pre-releases: once a stable release is out, run **Remove old releases** with the versions
(`0.1.0-beta.1,0.1.0-beta.3`), `delete` and, to remove their tags as well, *delete_tags*. Only
pre-releases are accepted, nothing happens until a stable release 1.0.0 or later exists, and
every version is checked before anything is deleted. The commits stay on `main`. Copies still
on a deleted beta keep working and update to the newest release as usual.

## When something goes wrong

- **A build fails:** nothing is published (the release job needs every build). Fix it, then
  re-run the failed jobs, or push the fix and run **Release** by hand.
- **A channel fails after publishing:** the GitHub Release is out and updates work; re-run that
  job, or update the channel by hand ([docs/INSTALL.md](docs/INSTALL.md#maintainers-channels-secrets-and-signing)).
- **A bad release:** mark it as a draft on GitHub (the updater and the install scripts skip
  drafts) and release the fix as the next version. Never reuse a version or a tag.
- **The cask/bucket commit did not land:** `sign-and-land.yml` failed (usually a missing
  `COMMIT_SIGNING_KEY`, or `incoming` not building on `main`); fix it and run it by hand on `incoming`.
