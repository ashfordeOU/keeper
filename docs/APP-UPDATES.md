# App updates

Applications → **Updates** lists the apps on this computer that have a newer version, and updates them. The part is called *App updates* (`appUpdates`, Settings → Features → Computer). It is off until you switch it on, because it asks the internet: each app's own update feed and your package managers.

## Where updates come from

| | macOS | Windows | Linux |
|---|---|---|---|
| The app's own update feed | ✅ Sparkle feeds (`SUFeedURL` in the app's Info.plist), https only | — | — |
| Package managers | ✅ Homebrew (formulae and casks) | ✅ winget | ✅ Flatpak, Snap; Homebrew when installed |
| System packages | Software Update (link) | Windows Update (link) | ✅ apt or dnf, counted (with how many are for security), installed by your system's updater |
| Store apps | App Store (link): they update only there | Microsoft Store (link) | — |

Keeper itself and the other Ashforde apps (Monorail) are left out: they have their own updates (Settings → Updates, Settings → Features → Ashforde apps).

Apps that check for updates over a plain `http` connection are named in a note and left to update themselves: an answer over plain http could be changed on the way.

## How an app is updated

Each row has one button:

- **Update**: the package manager does it (`brew upgrade`, `winget upgrade --id … --exact`, `flatpak update`, `snap refresh`). The package manager checks the maker's signature or checksum. Snap asks for your administrator password (one prompt).
- **Download**: the maker's own download from its feed. Keeper saves it to Downloads, checks it against the signing key inside the installed app (Sparkle's Ed25519 `SUPublicEDKey`; the download must match the size and signature the feed lists), and only then opens it. A download that does not match is not opened.
- **Get it**: the app's feed has no signature Keeper can check, so Keeper opens the maker's page in the browser instead.

**Update all** runs every update a package manager can do on its own, one after another. Downloads always wait for you.

Keeper never repackages, mirrors or keeps a copy of anyone's app.

## When it looks

- Once a day while switched on (Settings → General → App updates: every 6 hours, once a day or once a week, or only when you press **Check now**). The look waits while you are away and never runs while the screen is locked.
- The first time you open the Updates tab after switching it on.
- The palette's **Check App Updates**.

The last answer is kept in `<userData>/app-updates.json`, so the page and the Fix-it List show it straight away after a restart.

## Fix-it List

One calm row: "3 apps have security updates" when the maker marks an update as critical (Sparkle's `criticalUpdate`) or system packages come from a security source; else "5 apps have updates". It opens Applications → Updates.

## Settings

| Setting | Level | Default |
|---|---|---|
| Apps with updates (opens the tab) | Basic | — |
| Look for app updates by itself | Basic | on |
| Look for app updates (every 6 hours / once a day / once a week) | Advanced | once a day |
| Include apps that update themselves (Homebrew's `--greedy`) | Advanced | off |

## Files

| Part | File |
|---|---|
| Feeds, package-manager output, versions, the Fix-it row | `core/app-updates.ts` |
| Checking a maker's download (Ed25519) | `core/app-updates-verify.ts` |
| Looking, updating, the schedule | `electron/services/app-updates.ts` |
| The tab | `src/screens/AppUpdates.tsx` (inside `src/screens/Apps.tsx`) |
| Tests | `test/app-updates.test.ts` (17), `test/e2e/app-updates.cjs` (18 checks) |

## Verified

- **Linux, real app** (`test/e2e/app-updates.cjs` under xvfb, with stand-in `flatpak`, `snap` and `apt` programs): off until switched on with nothing stored and no package manager asked; the first look when the tab opens; a Flatpak and a Snap update listed with their versions; system packages counted (2 for security); the Fix-it row and its page; Update running `flatpak update` for that one app and the row going away; Check now looking again; the tab gone when switched off; light, dark and 1024×768.
- **Unit tests:** Sparkle appcasts (channels, minimum system, critical, enclosure attributes), version order, Ed25519 checks against a real key pair, Homebrew JSON, winget's table (cut names, unknown versions, the second table), Flatpak, Snap, apt and dnf output.

## Needs a real Mac or Windows PC

- macOS: real Sparkle feeds of installed apps, `brew outdated --json=v2`, opening a checked `.dmg` or `.zip`, the App Store link.
- Windows: `winget upgrade` output in other languages (columns are found from the header, then read from the right if a wide name shifts them), the Microsoft Store link.
