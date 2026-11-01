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

## Settings links

`core/guide/links.ts` lists every page Keeper can open, per system, each with a fallback ending at the settings app:

- **Windows** — `ms-settings:` URIs from Microsoft's *Launch Windows Settings* reference, and `windowsdefender:` for Windows Security.
- **macOS 13+** — `x-apple.systempreferences:` pane identifiers from the published Ventura/Sonoma pane list. The Firewall anchor under Network is not in that list and falls back to Network.
- **Linux** — `gnome-control-center <panel>` and `systemsettings <module>`; these vary between versions, so each falls back to its parent page and then to the settings app.

Only links from this list are ever opened.

## What is verified

- Unit tests: the link list (no duplicates, every fallback exists, every topic resolves on every system and desktop, every link a fix uses exists), sorting, snooze/ignore/done, the check afterwards, the step-by-step state, all guide labels in ten languages, findings from every checker, "How do I…?" matching.
- The real app on Linux (`test/e2e/guide.cjs`): the tour; To do lists a Trash finding; the preview names the files and says it cannot be undone; the Trash is really emptied and the badge goes down; "How do I free up space" from the palette starts the guide and steps move; the camera guide asks for `gnome-control-center camera` (stubbed) and the small always-on-top window shows the steps; a one-time tip shows and goes away; no page errors.
- **Not verified here:** the macOS and Windows links (written from the sources above, never opened on a real Mac or PC), GNOME panel names on every GNOME version, KDE module names, Windows Storage Sense detection, phone-backup sizes on a real Mac or PC, and the AI help with a real AI.
