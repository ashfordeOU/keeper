<!-- SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0 -->
# Stores

Where Keeper can be listed besides GitHub and the package managers
([INSTALL.md → Maintainers](INSTALL.md)), what is ready, and what the owner still has to do.

| Store | State | Built by | Updates |
| --- | --- | --- | --- |
| Microsoft Store | Package ready; listing not made | `msstore` job in the release workflow (an `.msix` workflow artifact) | The Store |
| Flathub | Manifest ready; not submitted | Flathub's own build servers, from `packaging/flatpak` | Flathub (`flatpak update`) |
| Snap Store | Running (when `SNAPCRAFT_STORE_CREDENTIALS` exists) | `snap` job | Snap |
| Mac App Store | Plan only | Not built | The App Store |

The Mac App Store needs a sandboxed edition. See [MAS-EDITION.md](MAS-EDITION.md).

**Decisions for the owner** are marked ⚑ below. In short:

- the store name (the plain "Keeper" clashes, see below);
- the Partner Center account type and publisher;
- where the privacy policy lives;
- the age-rating answers;
- whether the administrator features stay in the Store build.

---

## Microsoft Store

### What's in the repository

- **`electron-builder.yml` → `appx`.** The MSIX target with these settings:
  - the identity (`identityName`, `publisher`, `publisherDisplayName: Ashforde OÜ`);
  - the display name "Keeper by Ashforde";
  - the capabilities `runFullTrust` and `internetClient`;
  - Windows 10 1809 (`10.0.17763.0`) as the minimum and Windows 11 24H2 as tested;
  - the file name `Keeper-store-x64.msix`.

  The `keeper://` protocol and the `.rdp` and `.vnc` file associations from the top of the file
  are declared in the package too.
- **`build/appx/`.** All 77 tiles and logos: Square44x44 (each scale, plus each target size
  plated, unplated and light-unplated), Square150x150, Wide310x150, Small and Large tiles,
  StoreLogo and SplashScreen, each at scales 100, 125, 150, 200 and 400. They are made from
  `build/icon.svg` by `node scripts/store-assets.mjs`. Run it again after the icon changes. CI
  runs `node scripts/store-assets.mjs --check`, which fails on a missing or wrongly sized file.
- **The release workflow's `msstore` job.** It builds on `windows-latest` for every tag and
  uploads the `.msix` as the artifact **`msstore-x64`**. The artifact is not attached to the
  GitHub release and not submitted. It is unsigned, because the Store signs what it publishes.
- **Updates.** The Store build's own updater is off. Keeper sees it's running from
  `Program Files\WindowsApps` (or `process.windowsStore`), which `core/install-source.ts` reports
  as `msstore`. `electron/services/updater.ts` then never checks GitHub and never downloads.
  Settings → Updates says "The Microsoft Store keeps Keeper up to date."

### Partner Center: one-time setup

1. **Register a developer account** at <https://partner.microsoft.com/dashboard/registration>.
   ⚑ Choose a **company** account for Ashforde OÜ, so the publisher shown in the Store is the
   company rather than a person. Microsoft verifies the company (the business register,
   sometimes a phone call), which can take several days. Check the current registration fee on
   that page.
2. **Reserve the name.** Apps and games → New product → MSIX or PWA app → reserve a name.
   - ⚠ **Don't reserve plain "Keeper".** Another publisher's well-known app already uses that
     name in the Store. The reservation would fail or invite a trademark complaint, and
     searches for "Keeper" would mostly find the other app.
   - ⚑ Reserve **Keeper by Ashforde**. It matches `appx.displayName` and the brand line in
     [TRADEMARKS.md](../TRADEMARKS.md). You can reserve more than one name (for example
     "Keeper by Ashforde: File Library") and release the extras later.
   - The Store doesn't need the ® in the name. Keep it in the description.
3. **Copy the package identity.** Product → Product management → **Product identity** shows
   three values:

   | Partner Center | Where it goes |
   | --- | --- |
   | Package/Identity/Name (like `12345AshfordeOU.KeeperbyAshforde`) | repository variable **`MSSTORE_IDENTITY_NAME`** |
   | Package/Identity/Publisher (like `CN=1A2B3C4D-…`) | repository variable **`MSSTORE_PUBLISHER`** |
   | Package/Properties/PublisherDisplayName | must be exactly `Ashforde OÜ`; if it differs, change `appx.publisherDisplayName` |

   Set the variables in GitHub → Settings → Secrets and variables → Actions → **Variables**.
   They aren't secret. Until they are set, the `msstore` job builds with placeholder values and
   warns that Partner Center will refuse the package. You can also put the real values straight
   into `electron-builder.yml`.

### Each submission

1. Push a tag. When the release workflow finishes, download **`msstore-x64`** from the
   workflow run's Artifacts and unzip `Keeper-store-x64.msix`. Use stable tags only, or a Store
   *package flight* for betas.
2. Partner Center → the product → **Start your submission**.
3. **Pricing and availability:** free, all markets (or as decided). Visibility: public.
4. **Properties:**
   - Category: *Utilities & tools* (or *Productivity*).
   - Privacy policy URL: required, see [below](#privacy-policy-url).
   - Support: <https://github.com/ashfordeOU/keeper/issues>.
   - Tick the system requirements that apply (keyboard and mouse).
5. **Age ratings:** the IARC questionnaire, see [below](#age-rating).
6. **Packages:** upload the `.msix`. Partner Center checks the identity against the reserved
   name.
7. **Store listings (English):**
   - Description: the first paragraph of the README.
   - What's new: from `CHANGELOG.md`.
   - Screenshots: at least one, 1366×768 or larger. The four PNGs in `docs/screenshots`
     (1440×900) fit: `home.png`, `search.png`, `duplicates.png`, `space.png`.
   - Store logo (300×300): use `build/appx/Square150x150Logo.scale-200.png`.
   - Short title "Keeper by Ashforde", keywords "files, search, duplicates, cleanup, disk space".
8. **Submission options → Notes for certification.** Paste this and adapt it:

   > Keeper is a desktop file library (Electron, packaged with full trust). It needs
   > runFullTrust to index the files in the user's folders, read text in pictures on the device,
   > and show a small always-on-top bar (the Island). No sign-in is needed: open the app and
   > follow the welcome tour. Optional features ask for an administrator once, only when the
   > person switches them on (unattended remote access, the firewall and Keeper Mesh). They are
   > off by default. Anonymous usage stats are on by default, shown in the tour with a switch,
   > and documented at the privacy URL. The app never updates itself in the Store build.

9. **Restricted capability `runFullTrust`.** Partner Center asks why it's needed. Say: "Desktop
   app (Win32/Electron) packaged as MSIX; full trust is required to run the app."
10. Submit. Certification usually takes one to three working days.

### Privacy policy URL

The Store requires one, because Keeper uses the internet and sends anonymous usage stats.

- [PRIVACY-USAGE-STATS.md](PRIVACY-USAGE-STATS.md) covers only the usage stats. A Store privacy
  policy should also cover:
  - AI providers, which get what you send them, with your own key;
  - mail and calendar accounts, which stay on the device;
  - Keeper Link and the relay;
  - weather, maps and model downloads;
  - crash dumps, which stay local and are never uploaded.
- ⚑ **Where to host it.** Either:
  - **(a)** a page on Ashforde's site (for example `https://ashforde.org/keeper/privacy`), which
    is best for the Store and the App Store; or
  - **(b)** a `PRIVACY.md` in this repository, linked as
    `https://github.com/ashfordeOU/keeper/blob/main/PRIVACY.md`. It works, but certification
    sometimes questions GitHub links.

  Until then, the usage-stats page can be linked:
  `https://github.com/ashfordeOU/keeper/blob/main/docs/PRIVACY-USAGE-STATS.md`.

### Age rating

Partner Center uses the IARC questionnaire. ⚑ Suggested answers, to keep the rating honest:

- **Users can interact or exchange content:** yes. Help mode and remote screens have text and
  voice chat with another person, and Link shares files between devices.
- **Shares the user's location:** yes. Places & Tracks can share this computer's location with
  your own paired devices. It's off until you turn it on.
- **Unrestricted internet access:** yes. Web search and research in AI abilities, and video
  downloads.
- **Digital purchases:** no. Violence, sexual content, language, gambling: none.

Expect a low age rating with notices such as "Users Interact" and "Shares Location". The same
answers are in the Flathub metainfo's OARS block.

### How the Store build differs

| Area | Direct download (NSIS) | Store (MSIX) |
| --- | --- | --- |
| Updates | Keeper's updater (GitHub) | The Store; Keeper's updater is off |
| Signing | Ashforde's code-signing certificate, when set up | Signed by the Store |
| Install location | `%LOCALAPPDATA%\Programs\Keeper` | `C:\Program Files\WindowsApps\<package>` (read-only) |
| Data folder | `%APPDATA%\Keeper` | Windows redirects it to `%LOCALAPPDATA%\Packages\<package family>\LocalCache\Roaming\Keeper`, so the two installs don't share settings or the library index |
| `keeper://` links, `.rdp` and `.vnc` | Registry entries | Declared in the package manifest |
| Registry writes to HKCU | Real | Private to the package (Windows virtualizes them) |
| Explorer "Search with Keeper" | Works (a registry verb) | **Doesn't show**: Explorer doesn't see the package's private registry. It needs a `desktop4:FileExplorerContextMenus` extension (`appx.customExtensionsPath`), not built yet |
| Start at login | `app.setLoginItemSettings` | **Needs** a `windows.startupTask` extension. electron-builder's `addAutoLaunchExtension` uses a fixed task name, so a custom extension is the way. Not built yet |
| Copilot and the Windows agent registry | Needs "Reduce prompts" ([AI-SYSTEM.md](AI-SYSTEM.md)) | Package identity makes automatic registration possible later |
| Uninstall | Leaves `%APPDATA%\Keeper` | Removes everything, including data |
| Administrator features (unattended access, firewall, Mesh, Remote Desktop hosting) | UAC prompt, as usual | Elevating still works from a full-trust package, but installing services from a Store app may fail certification. ⚑ Test them, and if certification objects, switch these features off in the Store build (they are already separate entries in `core/features.ts`) |

### Testing the `.msix` before submitting

The package is unsigned. To install it on a test PC, sign it with a throwaway certificate whose
subject is the same as `appx.publisher`. Run this in PowerShell as administrator:

```powershell
$pub = "CN=00000000-0000-0000-0000-000000000000"   # the publisher in the package
$cert = New-SelfSignedCertificate -Type Custom -Subject $pub -KeyUsage DigitalSignature `
  -FriendlyName "Keeper test" -CertStoreLocation Cert:\CurrentUser\My `
  -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3", "2.5.29.19={text}")
Export-Certificate -Cert $cert -FilePath keeper-test.cer
Import-Certificate -FilePath keeper-test.cer -CertStoreLocation Cert:\LocalMachine\TrustedPeople
& "C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64\signtool.exe" sign /fd SHA256 /sha1 $cert.Thumbprint Keeper-store-x64.msix
Add-AppxPackage .\Keeper-store-x64.msix
```

Then check:

- Start shows Keeper's tiles;
- `keeper://quick` opens Quick Search;
- a `.rdp` file offers Keeper;
- Settings → Updates says the Store keeps it up to date;
- uninstalling removes it cleanly.

The Windows App Certification Kit (`appcert.exe`, in the Windows SDK) runs the same basic checks
as the Store.

---

## Flathub

### What's in the repository

These files live in `packaging/flatpak`, and `node scripts/render-packaging.mjs --only flatpak`
fills in the version and checksums:

- **`io.github.ashfordeou.keeper.yml.tmpl`.** The manifest. It repackages the official Linux
  `tar.gz` for x86_64 and aarch64 on `org.freedesktop.Platform` 26.08 with Electron's base app
  (`org.electronjs.Electron2.BaseApp`, which brings zypak for Chromium's sandbox). Each
  permission in `finish-args` has a comment saying why. Wayland comes first, with X11 as the
  fallback (`--socket=fallback-x11`), as Flathub asks. `x-checker-data` follows
  `releases/latest` on GitHub, which never returns a pre-release, so Flathub's bot opens update
  pull requests for stable versions only.
- **`io.github.ashfordeou.keeper.metainfo.xml.tmpl`.** The AppStream metainfo. It has:
  - the summary, kept to Flathub's 35 characters;
  - the developer, launchable, URLs and brand colours;
  - the OARS rating (see [Age rating](#age-rating));
  - keywords and a release entry;
  - four screenshots: the PNGs in `docs/screenshots` at the release's tag (`home.png`,
    `search.png`, `duplicates.png`, `space.png`, 1440×900).
- **`io.github.ashfordeou.keeper.desktop`** and the 512×512 icon.

The licence is `LicenseRef-proprietary=…/LICENSE.md` (PolyForm Shield is source-available, not
open source). **Flathub will show Keeper as proprietary.** That's expected. It doesn't stop a
listing, and the licence link goes to `LICENSE.md`. PolyForm Shield lets Flathub redistribute
the build, so no `extra-data` download is needed.

### What was checked

- `appstreamcli validate --pedantic --no-net` on the rendered metainfo passes. That is what
  Flathub's linter runs.
- `desktop-file-validate` on the desktop file passes.
- The manifest was compared by hand against `flatpak-builder-lint`'s manifest rules, with no
  findings:
  - the app id (four parts, `io.github.`);
  - fallback-x11 together with wayland, and ipc;
  - no `home` together with `host`;
  - `/run/media` itself, not a subfolder;
  - no portal, wildcard or `org.freedesktop.Flatpak` bus names;
  - the secret service name in lower case;
  - archive sources with sha256;
  - `command` that isn't a path;
  - no `branch`.
- **Not checked here:** a real `flatpak-builder` build and `flatpak-builder-lint` itself, since
  neither was available on this machine. Run both before submitting (below), and check that the
  screenshot URLs work once the tag exists (`appstreamcli validate` without `--no-net`).

### Submitting to Flathub (one time)

1. Render the files for the release you want to list:

   ```sh
   node scripts/render-packaging.mjs --version 0.1.0 --sums SHA256SUMS.txt --only flatpak --out flathub-out
   ```

2. Build and lint locally, on any Linux machine with Flatpak:

   ```sh
   flatpak install -y flathub org.flatpak.Builder org.freedesktop.Sdk//26.08 org.electronjs.Electron2.BaseApp//26.08
   cd flathub-out/flatpak
   flatpak run org.flatpak.Builder --user --install --force-clean build-dir io.github.ashfordeou.keeper.yml
   flatpak run --command=flatpak-builder-lint org.flatpak.Builder manifest io.github.ashfordeou.keeper.yml
   flatpak run --command=flatpak-builder-lint org.flatpak.Builder repo repo
   flatpak run io.github.ashfordeou.keeper
   ```

3. Fork <https://github.com/flathub/flathub> and branch from **`new-pr`**. Add the four files
   from `flathub-out/flatpak` at the top level, then open a pull request against `new-pr` titled
   "Add io.github.ashfordeou.keeper".
4. Answer the reviewers. Expect questions about:
   - `--filesystem=home`: a file library needs it, and the file chooser portal isn't enough;
   - repackaging a binary: Keeper isn't open source, so Flathub can't build it from source;
   - the tray and MPRIS names.
5. Once it's merged, Flathub makes `github.com/flathub/io.github.ashfordeou.keeper` and adds
   the maintainers. From then on, Flathub's bot opens a pull request there for each stable
   release, and a maintainer merges it.
6. **Verification.** Sign in to flathub.org with a GitHub account that is an owner of the
   `ashfordeOU` organisation and verify the app. Because the id is
   `io.github.ashfordeou.keeper`, verification goes through GitHub, so no website token is
   needed.

### How the Flatpak differs

Inside the sandbox, Keeper can't run the system's own tools (`xdotool`, `playerctl`, `xprop`,
`pkexec`, `gsettings` for other apps, `nmcli`), and isn't given `flatpak-spawn --host`. So:

- Quick Controls, System Settings+, Stage's desktop changes, the firewall, Mesh, unattended
  access and app controls are limited or unavailable.
- Keep Awake works through the portal's inhibit. Closed-lid mode doesn't work.
- The session-bus actions (`org.ashfordeou.Keeper.Actions`) and the GNOME and KDE search
  providers don't register, because a Flatpak may only own names under its own id.
- Updates come from Flathub. Keeper sees `FLATPAK_ID` and shows `flatpak update
  io.github.ashfordeou.keeper` instead of downloading.

The direct downloads (`.deb`, `.rpm`, AppImage) remain the full edition on Linux.

---

## Mac App Store

Not built. The plan is in [MAS-EDITION.md](MAS-EDITION.md): it covers the sandboxed edition's
build flag, which features stay, shrink or go, the entitlements, security-scoped bookmarks, and
review notes for Apple.
