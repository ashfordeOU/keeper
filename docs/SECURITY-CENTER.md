# Privacy & Security

Privacy & Security is under System → Privacy & Security. It replaces the old Protection page, which is now its **Security checks** tab. This document covers:

- what the page does;
- how each layer works;
- what each operating system allows;
- what has been tested, and where.

## No tool detects everything

No security tool detects every threat, and Keeper is no exception:

- Signatures and rules always lag behind the newest malware.
- Heuristics can miss things, and they can flag harmless files.
- A clean scan means none of Keeper's layers recognised anything. It doesn't prove the computer is clean.

Keeper adds layers on top of the protection built into your system (Defender, XProtect and Gatekeeper, your distribution's updates). Keep that protection switched on. The page, the saved report and this document all say this.

## The overview

- **Score:** 100 minus a cost for each open finding:

  | Severity | Cost |
  |---|---|
  | Critical | 30 |
  | High | 14 |
  | Medium | 6 |
  | Low | 2 |

  Findings you ignore don't count. The score has four labels: *Well protected*, *A few things to look at*, *Needs attention* and *At risk*.
- **Most worth doing:** the three most severe open findings.
- **Each finding** has a title, *why it matters*, a detail line and a **Fix**. A Fix is one of:
  - an action Keeper does itself, such as turning on real-time checks, installing ClamAV, updating signatures, scanning or quarantining;
  - a link to the right settings page, from Keeper's catalogue of deep links;
  - a Keeper page;
  - written steps.

  **Show me how** opens the guided fix. **Ignore** hides the finding and takes it out of the score.
- **To do list:** findings are registered with the guide layer (`registerFindings('security', …)` and the `security.*` automatic fixes in `electron/services/security/guide-bridge.ts`). Their ids are `security:<id>`. The basic protection checks such as the firewall and disk encryption are not registered from here, because the guide already registers them as `protection:<id>`.
- **Save report** writes a plain-text report, including the line about detection limits above.

## 1. Who can watch

| | Where it comes from | Revoke |
|---|---|---|
| macOS | The privacy (TCC) databases: the user's database, plus the system database when Keeper can read it | `tccutil reset <service> <bundle id>` for that app; otherwise opens the matching Privacy & Security pane |
| Windows | `HKCU\…\CapabilityAccessManager\ConsentStore`, including last-used times for camera and microphone | Opens the matching `ms-settings:privacy-*` page |
| Linux | `flatpak permissions` (portal store), `flatpak info --show-permissions` (static rights such as devices=all or filesystems=home), and `pw-dump` for what is using the camera or microphone right now | `flatpak permission-set … no` for portal rights; `flatpak override --user --no…` for static rights |

Snaps and apps installed outside Flatpak have no per-app permission store on Linux, so the page says so instead of showing nothing.

## 2. Connections

The Connections tab builds on Network Activity's flows. For each app it shows:

- tracker domains, matched by domain suffix against Keeper's built-in list plus the optional Disconnect lists (set the source under Malware → Sources);
- countries (from Network Activity's local table);
- traffic on unencrypted ports;
- how much data the app sends;
- services listening on all network interfaces.

**Browser extension (optional).** It lives in `browser-extension/` and works as follows:

- **Browsers:** Chromium-family browsers (MV3) and Firefox.
- **Data:** it observes requests with `webRequest.onCompleted`, without blocking or changing anything, and counts first and third parties for each tab.
- **Delivery:** it sends the counts to Keeper through **native messaging**: a 4-byte length followed by JSON, at most 1 MB per message. The host is `org.ashforde.keeper`, which runs `keeper browser-host` and forwards to the running app over its local socket.
- **Install:** **Connect browsers** writes the host manifests (registry keys on Windows).
- **Permissions:** it needs access to all sites, because it can't report on sites it can't see.
- **Safari:** not supported.

## Browsers

- **Browsers covered:** Chrome, Chromium, Edge, Brave, Vivaldi, Opera and Arc (from `Local State` and each profile's `Preferences`), and Firefox (`profiles.ini`, `extensions.json`).
- **Safari:** only noted as present.
- **Extension risk:**
  - access to all sites adds 35;
  - sensitive permissions are weighted (cookies, webRequest, history, debugger, nativeMessaging, and so on);
  - not being from the store adds 15;
  - a known-bad id is 100.

  Built-in component extensions are skipped. Lists of bad ids can be added under Sources.
- **Saved passwords:** Keeper checks only whether the password file exists and how big it is. **It never opens or reads it.**
- **Also shown:** sync, and Secure DNS (Chromium `dns_over_https`, Firefox `network.trr.mode`).
- **Password check:** Keeper sends Have I Been Pwned only the first five characters of the password's SHA-1, with padding turned on, and compares the rest on this computer. The password isn't stored.

## 3. Security checks

| Check | macOS | Windows | Linux |
|---|---|---|---|
| Updates, firewall, disk encryption | ✅ | ✅ | ✅ |
| SIP / Gatekeeper / XProtect | ✅ | — | — |
| Defender (real-time, definitions), UAC, SmartScreen | — | ✅ | — |
| Secure Boot, AppArmor/SELinux (from the existing protection checks) | — | ✅ (Secure Boot) | ✅ |
| Screen lock, automatic login | ✅ | ✅ | ✅ (GNOME settings, display manager configs) |
| Using an administrator account | — | ✅ | — |
| Sharing services | ✅ (screen, file, remote login…) | ✅ (SMB shares, RDP) | ✅ (ssh, samba, vnc units) |
| Listening ports open to the network | ✅ | ✅ | ✅ |
| Wi-Fi security (open/WEP/WPA) | ✅ | ✅ | ✅ (nmcli) |
| Root certificates added by users or tools | ✅ | ✅ | ✅ (`/usr/local/share/ca-certificates`) |
| Third-party kernel extensions | ✅ | — | — |
| Diagnostics / telemetry | ✅ | ✅ | ✅ (where the desktop has a switch) |

## 4. Malware protection

### Layers

| Engine | What it does | Where it runs |
|---|---|---|
| Keeper's built-in checks | Detects the EICAR test file. Flags files disguised by a double extension, Office macros that auto-run, scripts that download and run code, set themselves up to start automatically or hide what they do, and executables in risky places. | A worker thread (`dist-electron/security-worker.cjs`) that stops after one minute idle |
| YARA rules | Five built-in Keeper rules plus `.yar` files you add. Keeper's matcher is a subset written in JavaScript; see below. | Worker thread |
| Hash lists | SHA-256 lists you add (one hash per line, or CSV) | Worker thread |
| ClamAV | `clamscan`, or `clamdscan` when the daemon is running. It also looks inside archives. Signatures are updated by `freshclam` into Keeper's own folder every 12 hours. | Child process at low priority |
| MalwareBazaar | Optional and off by default. Sends only the SHA-256 of risky file types, never the file. An Auth-Key can be kept in the keychain. | Network |
| Microsoft Defender | `MpCmdRun -Scan -ScanType 3` for files the other layers aren't certain about | Windows only |
| XProtect | Keeper doesn't call it. It checks that XProtect is on and up to date. | macOS |

**YARA subset.** Keeper's matcher supports:

- text strings with `nocase`, `wide`, `ascii` and `fullword`;
- hex strings with wildcards and jumps;
- regular expressions;
- `any of`, `all of` and `N of`;
- `#count`, `at` and `filesize`;
- `uint8/16/32`;
- references to other rules.

Rules that use modules (`pe`, `math`, …) or `for` loops are skipped, and the Sources editor shows each skipped rule and the reason.

**Installing ClamAV.** One click installs it with Homebrew on macOS, `winget install Cisco.ClamAV` on Windows, or `pkexec apt-get/dnf/pacman` on Linux, then downloads signatures. ClamAV's database is about 300 MB.

### Real-time checks

- **Folders watched:**
  - Downloads, recursively on macOS and Windows (Linux has no recursive watch, so subfolders are checked by scheduled scans);
  - Desktop and Documents, top level only.
- **When a file is checked:** after it stops changing. Partial downloads (`.crdownload`, `.part`, …) are skipped.
- **Engines:** each new file goes through the built-in, YARA and hash layers, through `clamdscan` when the ClamAV daemon is running, and through the optional hash lookup.
- **Automatic quarantine:** certain detections, including the test file, are quarantined automatically. A *likely* detection is quarantined automatically only when it is critical. Everything else becomes a finding with a *Quarantine it* button.

### Scans

- **Quick scan:** Downloads, Desktop, Documents, temp folders and startup locations.
- **Full scan:** the home folder plus `/Applications`, `/opt` or `/usr/local`.
- **Custom scan:** folders you pick.
- **Scheduled scan:** a daily or weekly quick scan, checked every 6 hours; like every scan, it is paced by the governor.
- **Reading files:** quick and custom scans read risky file types and every file under 2 MB; a full scan reads everything. Each file is read up to its first 24 MB and its whole content is fingerprinted.
- **Progress and Stop:** progress is shown live and **Stop** ends a scan straight away.
- **Background work:** scanning runs through the governor, so it paces itself and gives way when you're busy.

### Quarantine

- **Encryption:** each file is encrypted with AES-256-GCM in the format `KQ1\n` + IV + tag + ciphertext, under `security/quarantine/`.
- **Removing the original:** the original is removed only after the encrypted copy has been written.
- **Key:** stored in the system keychain. Where there is no keychain (some Linux desktops), it's kept in a file only you can read: `security/quarantine.key`, mode 0600. That is weaker, and the page says so.
- **Put back:** restores the file byte for byte to where it was, or to a folder you choose.
- **Delete:** removes it for good.

### Startup items and behaviour

- **New startup items:** Keeper checks every 30 minutes, and right away when a watched folder changes. It looks at:
  - launch agents and daemons (macOS);
  - systemd user units, autostart entries and crontab (Linux);
  - Run keys and scheduled tasks (Windows).

  The first check only records what is already there. After that, each new item raises an alert with what it runs and whether it is signed (codesign on macOS, Authenticode on Windows).
- **Behaviour:** every 10 minutes Keeper looks for coin miners (by name and arguments) and for programs running from temp folders.

## 5. Timeline and alerts

- **Timeline:** every detection, quarantine, restore, startup alert, scan and setting change is written to `security/events.jsonl` and shown in the Timeline tab.
- **Island:** shows high and critical events.

## Background work and cost

Everything runs through Keeper's governor under the **security** feature:

| Task | How often |
|---|---|
| Startup items | Every 30 minutes |
| Behaviour | Every 10 minutes |
| Signature updates | Every 12 hours |
| Scheduled-scan check | Every 6 hours |

- **Turning it off:** switching off the feature stops every watcher, poll and scan.
- **Scanning:** happens in a worker thread or a low-priority child process.
- **Idle cost:** when nothing is scanning, the cost is a few file watches.

## What has been tested, and where

**Tested (Linux under xvfb, real Electron app, `test/e2e/security.cjs`):**

- the overview with a score and findings, where every finding has a fix kind and a verify probe;
- Flatpak permissions, from a stand-in `flatpak` command;
- a Chromium profile with a risky and a harmless extension, and Secure DNS off;
- the EICAR test file saved into Downloads:
  - detected in real time;
  - quarantined (the encrypted copy contains no EICAR text);
  - put back byte for byte with the **Put back** button;
- a new systemd user unit, which raises a startup alert that shows what the unit runs;
- a custom scan of 4 files:
  - the built-in checks flag a download-and-run script;
  - ClamAV 1.5.4 (signatures 28170, downloaded by Keeper's own `freshclam` config) finds EICAR **inside a zip**;
- ignoring a finding, which stops it counting;
- no page errors;
- light and dark screenshots.

**Unit tests** (`test/security.test.ts`):

- the parsers (TCC, ConsentStore, Flatpak, PipeWire, Chromium, Firefox);
- extension scoring, tracker matching and the YARA subset;
- heuristics and the built-in rules;
- ClamAV arguments and output;
- the HIBP range check;
- quarantine encryption round trip and tamper detection;
- native-messaging framing and manifests;
- the posture parsers;
- score, report and the mapping to guided fixes.

**Not tested on real systems yet (written from documentation, with parsers unit-tested on sample output):**

- the macOS and Windows collectors and their revoke paths;
- Defender scanning and the XProtect check;
- the browser extension in real browsers;
- the HIBP and MalwareBazaar calls made from inside the app.
