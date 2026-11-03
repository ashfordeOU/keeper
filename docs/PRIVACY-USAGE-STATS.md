# Anonymous usage stats

Keeper sends anonymous usage stats once a day to help us improve it. You can
switch this off at any time, and this page lists exactly what is sent.

Ashforde OÜ wants to know how many copies of Keeper are in use, on what kinds of
computers, and which features people use, so the next versions get better. The
report is small, anonymous by design, and contains nothing about your files.

## How it works

- **At most once a day**, when your computer is idle and online, Keeper sends one
  report over HTTPS to `https://telemetry.ashforde.org/v1/ping`.
- **Offline?** The day's report waits. At most a week of reports wait; older ones
  are dropped. When Keeper is back online they go together in one request.
- **On by default, off with one switch.** The welcome tour has a screen that says
  what is sent, with the switch right there. Settings → Privacy has the same switch.
- **See it yourself.** Settings → Privacy → *See exactly what's sent* shows the last
  report sent and the next one, field by field and as the exact text.
- **Reset it.** *Reset my anonymous ID* makes a new random ID. Reports that had not
  been sent yet are dropped, so nothing links the old ID to the new one.
- **Your firewall decides.** Keeper's own firewall lists this connection (Firewall →
  Overview → *Keeper's own connections*) like any other app's, and *Block* stops it.
  Keeper also checks your firewall rules and DNS filter before sending.
- The report is built by one function, `buildPayload` in `core/telemetry.ts`, and
  checked against a strict schema before it leaves; the server checks it against the
  same schema and refuses anything else. A test fails if any field outside this list
  appears, or if a value looks like a path, e-mail address, internet address or host
  name.

## What is sent

One report describes one day. Every field, with an example:

| Field | Example | What it is |
| --- | --- | --- |
| `v` | `1` | Format of the report |
| `id` | `3f6c1a9e-7b2d-4c1e-9a8f-2d4b6e8c0a17` | A random install ID (UUID v4) made on your computer. Never based on your hardware, name or account. Resettable. |
| `day` | `2026-10-31` | The day these numbers are for (UTC) |
| **build** | | |
| `version` | `0.1.0` | Keeper's version |
| `channel` | `stable` | Stable release or test release (`prerelease`) |
| `official` | `true` | Built and signed by Ashforde's release workflow (`false` for builds made by anyone else from the source) |
| `via` | `brew` | How Keeper was installed: `direct`, `brew`, `winget`, `scoop`, `choco`, `msstore` (the Microsoft Store), `flatpak`, `snap`, `aur`, `apt-repo` or `dnf-repo` |
| **system** | | |
| `os` | `macos` | `macos`, `windows`, `linux` or `other` |
| `osVersion` | `15.1` | Main version only (`11` for Windows 11, the kernel's `6.8` on Linux) |
| `arch` | `arm64` | Processor type: `x64`, `arm64`, `ia32`, `arm` or `other` |
| `cpuVendor` | `apple` | `apple`, `intel`, `amd`, `qualcomm` or `other` |
| `cpu` | `Apple M3` | Processor family, not the exact model, e.g. `Intel Core i7 12th gen`, `AMD Ryzen 7` |
| `cores` | `8` | Number of processor cores |
| `ramGB` | `16` | Memory rounded to 4, 8, 16, 32 or 64 (64 or more) GB |
| `gpu` | `apple` | Who made the graphics chip: `apple`, `nvidia`, `amd`, `intel`, `qualcomm`, `other` or `unknown` |
| `form` | `laptop` | `laptop`, `desktop`, `tablet` or `unknown` (from whether there is a battery, or the Windows chassis type) |
| `displays` | `2` | Number of screens (up to 8) |
| `notch` | `true` | The screen has a camera notch |
| `lang` | `en` | Language from your system settings |
| `region` | `EE` | Region from your system settings, **not** from your internet address (`ZZ` when not set) |
| **usage** | | |
| `active` | `true` | Keeper was opened that day |
| `days7` | `5` | Days Keeper was opened in the last 7 |
| `features` | `["island", "library", "ocr"]` | Which features are switched on, by their ID from Settings → Features |
| `pages` | `{"home": "5-19", "search": "1-4"}` | Which main pages were opened, by name, with a rough count: `1-4`, `5-19`, `20-99` or `100+` |
| `aiProviders` | `1` | How many AI services you connected with a key (a number; no names, no keys) |
| `devices` | `0` | How many devices are paired with Keeper Link (a number) |
| **health** | | |
| `crashes` | `0` | Times Keeper or one of its windows crashed that day (no details, no stack traces; detailed crash reports are a separate choice, off by default: docs/CRASH-REPORTS.md) |
| `restarts` | `0` | Times one of Keeper's background services had to restart |
| `memory` | `250-500MB` | Keeper's own average memory use: `<250MB`, `250-500MB`, `500MB-1GB` or `1GB+` |
| `cpu` | `<1%` | Keeper's own average processor use: `<1%`, `1-5%`, `5-20%` or `20%+` |
| `startup` | `<2s` | How long Keeper took to open: `<2s`, `2-5s`, `5-10s`, `10s+` or `unknown` |

**Only in versions with Keeper Pro switched on** ([PRO.md](PRO.md)). Keeper 1.0.0 has no Pro and
never sends or shows this field:

| Field | Example | What it is |
| --- | --- | --- |
| **usage** | | |
| `plan` | `free` | Your Keeper plan: `free`, `pro` or `team`. Nothing else about a license (no id, no address, no dates) |

A whole request looks like this:

```json
{
  "pings": [
    {
      "v": 1,
      "id": "3f6c1a9e-7b2d-4c1e-9a8f-2d4b6e8c0a17",
      "day": "2026-10-31",
      "build": { "version": "0.1.0", "channel": "stable", "official": true, "via": "brew" },
      "system": {
        "os": "macos", "osVersion": "15.1", "arch": "arm64", "cpuVendor": "apple", "cpu": "Apple M3", "cores": 8,
        "ramGB": 16, "gpu": "apple", "form": "laptop", "displays": 2, "notch": true, "lang": "en", "region": "GB"
      },
      "usage": {
        "active": true, "days7": 5, "features": ["clipboard", "island", "library", "usageStats"],
        "pages": { "home": "5-19", "search": "5-19", "library": "5-19", "cleanup": "1-4" }, "aiProviders": 1, "devices": 1
      },
      "health": { "crashes": 0, "restarts": 1, "memory": "250-500MB", "cpu": "<1%", "startup": "<2s" }
    }
  ]
}
```

## What is never sent

- File names, paths or file contents
- What you search for
- What you ask an AI, or its answers
- Account names, e-mail addresses, user names or the computer's name (host name)
- Your internet address, or a location worked out from it
- Serial numbers, hardware IDs or network card (MAC) addresses
- Wi-Fi names
- Which apps you have installed

The server never stores your internet address: its code never reads it, its tables
have no place for it, and Cloudflare's request logging is switched off for it
(`server/telemetry/README.md`).

## How to switch it off

Any one of these is enough. Once off, nothing more is sent, ever; not even a final
"switched off" message. What was collected and not yet sent is deleted.

1. **The switch:** Settings → Privacy → *Share anonymous usage stats*, or the switch on
   the usage stats screen of the welcome tour. It is also listed in Settings → Features
   (System → *Anonymous usage stats*). Feature presets and saved feature sets never
   turn it back on.
2. **`KEEPER_TELEMETRY=0`** in the environment Keeper starts with (`false`, `off` and
   `no` work too).
3. **`DO_NOT_TRACK=1`** in the environment (any value except `0`).
4. **A policy file** for every account on the computer, written by an administrator:

   | System | File |
   | --- | --- |
   | Linux | `/etc/keeper/policy.json` |
   | macOS | `/Library/Application Support/Keeper/policy.json` |
   | Windows | `%ProgramData%\Keeper\policy.json` (usually `C:\ProgramData\Keeper\policy.json`) |

   ```json
   { "usageStats": false }
   ```

   (`"telemetry": false` works too.) Settings → Privacy then shows that your
   organisation switched it off, and the switch cannot turn it back on.

You can also block `telemetry.ashforde.org` in Keeper's firewall (Firewall → Overview →
*Keeper's own connections* → *Block*) or in any other firewall or DNS filter.

## Retention

| What | Kept |
| --- | --- |
| Reports (one row per install per day) | 13 months, then deleted automatically |
| Rate-limit counters (install ID, time, count) | 2 days |
| Daily totals and percentages (no install IDs) | Kept |
| On your computer: unsent reports | At most 7 days; deleted when you switch stats off |

## Legal basis

Legitimate interest (GDPR Art. 6(1)(f)): knowing how many copies are in use, on what
kinds of computers, and which features matter, to improve Keeper. The data is
anonymous by design: a random ID that is not linked to you, coarse ranges instead of
exact values, nothing about your files, and no internet address stored. It is off
with one switch, and you can see exactly what is sent before it is.

## Contact

Ashforde OÜ, contact@ashforde.org. To have the reports for your install ID deleted,
send the ID shown in Settings → Privacy (then reset it).
