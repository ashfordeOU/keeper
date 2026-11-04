# Guided fixes and the To do list

Whenever Keeper finds something worth doing about **space, storage, security, privacy, speed, the network, backups or updates**, it says so in plain words, says why it matters, and offers a fix that is one of:

| Kind of fix | What happens |
| --- | --- |
| **Keeper does it** | You see exactly what will change first (the files, the apps), confirm, and it is done. Changes that can be undone show **Undo**; ones that cannot (emptying the Trash) say so before you press anything. |
| **Open it for me** | Keeper opens the exact settings page (macOS System Settings, Windows Settings, GNOME Settings or KDE System Settings) and walks you through it step by step, with a simple drawing of what to look for. **Keep this on top** shows the steps in a small window that stays above System Settings while you work. |
| **Steps** | Numbered steps when there is nothing to open (for example a terminal command on Linux). |
| **A Keeper page** | Keeper opens the right page (Clean Up, Backups, VPN…) with what to do next. |

After you do it, **I did it — check** re-checks that one thing; Keeper also re-checks fixes you started when you come back to its window. A fix that did not hold comes back to the list.

## Where it shows

- **To do** (sidebar, under System) — everything open, most important first, filtered by area, with a count in the sidebar. Snooze for a week, ignore, or bring back later.
- **On Keeper's own pages** — Clean Up, Space Map, Large Files and Duplicates show space findings above the page; Privacy & Security, Health, Startup Items, Backups, VPN and Network Activity show theirs.
- **The Island** — a new urgent or important finding is mentioned once.
- **How do I…?** — in the command palette (⌘K / Ctrl+K) and on the To do page: *free up space, stop apps using my camera or microphone, see who can record my screen, encrypt my disk, turn on the firewall, back up my photos, block trackers, stop apps opening at start-up, let the system clear space by itself, lock a private folder, keep the system up to date.*
- **A first-run tour** (four short cards) and **one-time tips** on complex pages (Clean Up advanced mode, device pairing, backups, agents in the terminal, the VPN verdict).
- **Explain / Walk me through it** — optional help from the AI you chose in Keeper, given the finding, your system and the steps. Never required.

The guide's own words are in all ten of Keeper's languages; the names of system settings ("Privacy & Security", "Storage Sense"…) are given the way your system says them in your language where known, otherwise in English.

## What Keeper checks today

| Area | Check | Fix |
| --- | --- | --- |
| Space | Disk almost full | Clean Up |
| Space | A Trash / Recycle Bin over 1 GB | Keeper empties it (after showing what) |
| Storage | Old iPhone/iPad backups over 2 GB | Opens Storage (macOS) / steps |
| Storage | Big videos not opened for six months | Large Files, filtered |
| Storage | Windows Storage Sense off | Opens Storage Sense |
| Security | Each system protection that is off or partly on (FileVault, BitLocker, firewall, Gatekeeper, Defender, SmartScreen, updates…) | Opens the exact page, with steps per system |
| Speed | Two or more heavy apps starting at sign-in | Keeper stops them starting (undoable) |
| Backups | No backup; 3-2-1 not met; no test-restore for a while | Backups page with steps |
| Network / privacy | IPv6 or DNS going around the VPN | VPN page with steps |
| Privacy | Locked folders open for over an hour | Keeper locks them again |
| Updates | A new Keeper version | Updates page |

Other parts of Keeper add their own findings through `registerFindings(source, producer)` and automatic fixes through `registerAutoFix(action, { preview, apply, undo? })` (`electron/services/guide.ts`).

## One attention list

Keeper has one list of things worth doing: the Fix-it List. Other pages show the top of the same list, in the same words, and link to it for the rest. Nothing has its own alarms.

| Where | What it shows |
| --- | --- |
| **Fix-it List** | Everything open, most worth doing first. The header says "2 things worth fixing · 3 good to know". |
| **Home** | At most one line: the one thing most worth doing, with **See all** when there are more. Low space on the main disk is the Fix-it List's own "space is low" item, said once. |
| **Privacy & Security** | "3 things worth fixing" and those rows first; the score is a small detail under it, and engine names are under **How Keeper checks**. |
| **Protection** | What is off first ("1 thing worth fixing"), the score small beside it. |

Three calm levels replace the five severities on screen (`core/attention.ts`): **Worth fixing** (critical and high), **When you have time** (medium) and **Good to know** (low and information). Only "Worth fixing" is tinted, in a soft amber; nothing is red. Scores use calm words: *Well protected*, *A few things to look at*, *Some things to look at*, never "at risk".

## The Fix-it List: details, Trust, Snooze

Each row opens (click it, its arrow, or Enter on the arrow) to show what exactly was found. Keeper gathers this only when a row is opened, never when the page loads. Every row has one clear action, **Fix**, and **More** (⋯) with **Trust**, **Snooze for** 1 day, 1 week or 1 month, **Ignore**, and Show in Finder or Explorer or the browser's own page for an extension. Several rows can be selected and trusted or snoozed together. Three or more alike are shown together under one row that opens.

**Trust** means "this is mine and fine". Keeper remembers the exact item by a fingerprint and hides it, across restarts, until it changes; then it comes back marked *Changed since you trusted it*. Trusted, snoozed and ignored items are listed under *Snoozed, ignored and trusted*, with **Stop trusting** or **Undo**. Trust on Home's suggestion line is the same Trust.

### Login items

Something set to start at login or with the computer (a macOS launch agent or daemon, a Linux autostart entry or systemd user service, a Windows Startup-folder entry, run key or scheduled task). The details show the file, its label, the program and its arguments, whether it starts at login (RunAtLoad) and is kept running (KeepAlive), the file's contents, who signed the program (on macOS the Developer ID name, team and whether Apple notarized it; on Windows the Authenticode publisher; on Linux the package that installed it) and its SHA-256.

Common tools are recognised from a table (`core/security/known-tools.ts`): a GitHub Actions self-hosted runner (named with its repository, read from the runner's `.runner` file), Docker, Homebrew services, Tailscale, 1Password, Google and Microsoft updaters, Zoom, Dropbox, JetBrains Toolbox and others. One signed by its maker, or by any identified developer, is **Low**; one that only borrows a well-known name is not trusted for it. What was already there when Keeper first looked is not listed as new.

The fingerprint is the file's path, what it runs and the file's hash, plus the signing team (or publisher) when the program is signed, or the program's own hash when it is not: an update from the same developer stays trusted; another signer or a new unsigned program asks again. **Turn it off** stops it (`launchctl bootout`, `systemctl --user disable --now`) and moves the file to the Trash (deleted with your password for files in `/Library`), keeping a copy in Keeper's data folder (`fixit-backups`) that **Undo** puts back and starts again.

### Extensions

A browser extension that can read and change every website (or many). The details show the real name (from the extension's `_locales` when the manifest says `__MSG_…__`), version, ID, browser and profile, store page and each permission in plain words. The fingerprint is the ID, version and permissions: a new version or new permission asks again. Browsers only let you remove an extension yourself, so **Fix** opens the browser at that extension's page (`chrome://extensions/?id=…`, or `about:addons` in Firefox) and Keeper checks again when you come back.

### Certificates

A certificate someone added to the system's trusted list (the System keychain on macOS, Trusted Root Certification Authorities on Windows, `/usr/local/share/ca-certificates` on Linux). Workplaces, VPNs and developer tools such as mkcert or a debugging proxy add them on purpose. The details show the subject, issuer, validity, SHA-256 and SHA-1 fingerprints and where it is kept. The fingerprint is the certificate's own. **Remove it** keeps a copy first and needs your password; **Undo** adds it back as trusted.

## Settings links

`core/guide/links.ts` lists every page Keeper can open, per system, each with a fallback ending at the settings app:

- **Windows** — `ms-settings:` URIs from Microsoft's *Launch Windows Settings* reference, and `windowsdefender:` for Windows Security.
- **macOS 13+** — `x-apple.systempreferences:` pane identifiers from the published Ventura/Sonoma pane list. The Firewall anchor under Network is not in that list and falls back to Network.
- **Linux** — `gnome-control-center <panel>` and `systemsettings <module>`; these vary between versions, so each falls back to its parent page and then to the settings app.

Only links from this list are ever opened.

## What is verified

- Unit tests: the link list (no duplicates, every fallback exists, every topic resolves on every system and desktop, every link a fix uses exists), sorting, snooze/ignore/done, the check afterwards, the step-by-step state, all guide labels in ten languages, findings from every checker, "How do I…?" matching.
- The real app on Linux (`test/e2e/guide.cjs`): the tour; To do lists a Trash finding; the preview names the files and says it cannot be undone; the Trash is really emptied and the badge goes down; "How do I free up space" from the palette starts the guide and steps move; the camera guide asks for `gnome-control-center camera` (stubbed) and the small always-on-top window shows the steps; a one-time tip shows and goes away; no page errors.
- The Fix-it List on Linux (`test/e2e/fixit.cjs`): extensions grouped and named from `_locales`; a GitHub Actions runner service recognised; details on opening, by mouse and keyboard; Trust saved, listed and back as changed when the service changes; Snooze and Undo; Trust and Snooze for several rows; Turn it off and Undo of an autostart entry.
- **Not verified here:** codesign/spctl/notarization output, `launchctl bootout`/`bootstrap`, removing and re-adding a System keychain certificate, opening `chrome://extensions` in each browser, and Authenticode on Windows; the macOS and Windows links (written from the sources above, never opened on a real Mac or PC), GNOME panel names on every GNOME version, KDE module names, Windows Storage Sense detection, phone-backup sizes on a real Mac or PC, and the AI help with a real AI.
