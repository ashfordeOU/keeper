# Island+ and Cues

Two additions to the Island and the desktop. **Island+** covers other apps' notifications, calls, volume and brightness levels, more coding agents and AI usage, text capture engines, and a few small extras. **Cues** are notes, checklists, links and files tied to an app, a website, a page, a window title (a project), a file or a time. Each cue pops up beside the place it belongs to.

Every part is a switch in Settings → Features: `notifyMirror` (off by default), `islandCalls`, `islandHud` (off by default), `islandUsage`, `agents` and `cues`. A part that is switched off costs nothing.

## Where things appear

| Feature | Island | Beside the app | Tray | Shortcut | Palette | Page | CLI | AI abilities | Browser |
|---|---|---|---|---|---|---|---|---|---|
| Cues | Cues tool; pill activity "a cue for here"; due and hint banners with Done / Later | Popup window next to the front window (doesn't take the keyboard) | New Cue Here…, cues due today | Ctrl/⌘ Alt K (composer beside the front app, attached to it) | New Cue for What's in Front…, Go to Cues | Cues (More section): dashboard, Checklists, Settings | `keeper cues …` | `cues_search`, `cues_create`, `cues_update` | Toolbar button, Alt+Shift+K, right-click "for this page / site"; reports the page in front |
| Calls | Live activity: timer, Mute/Unmute | – | – | – | – | Settings → Island | – | `call_mute` | Meet, Teams and other web calls found from tab titles |
| Volume / brightness | Short level activity beside the system pop-up | – | – | – | – | Settings → Island | – | – | – |
| Notifications | Banner with the app's name | – | – | – | – | Settings → Island (per-system explanation, block list, test) | – | – | – |
| Agents | Agents tab, pill states, sound | – | – | – | – | Settings → Island (hooks set-up) | `keeper agents` | `island_agents` | – |
| Usage ring | Small ring beside the pill (opt-in) | – | – | – | – | Settings → Island | – | – | – |
| Tool launcher | Grid button in the Island's tab bar | – | (MONITOR's) | (MONITOR's) | – | – | – | – | – |

Deep links: `keeper://cue?text=…&attach=page,app` and `keeper://cues`.

### The Island stays in the bar unless you open it

On a notched Mac the Island lives in the notch. Cue banners, due cues, call and level changes, other apps' notifications, voice and agent states all show inside the menu bar's height: an icon and a short title in the notch's wings, or in the small hanging tab when the wings have no room. On Windows and Linux they show in the pill.

The Island drops down over windows only when you hover over it, click it, use a shortcut, use the tray or drag a file onto it. *Settings → Island → Alerts* offers "in the notch" (the default) or "as a banner below it".

Low-priority alerts never pop up by default; they wait on To do and in the tray. These include guide findings, general information and the low-disk warning.

`core/island-expand.ts` holds the rule. `test/island-expand.test.ts` tests it, together with the open panel being centred on a simulated 220 × 38 pt notch. `test/e2e/cues.cjs` checks that a download alert leaves the Island window's height unchanged.

## Feature table

Legend: **built** = works like the original; **better** = does more than the original; **partial** = works with limits (stated); **not possible** = blocked by the OS, explained.

| Item | macOS | Windows | Linux | Notes |
|---|---|---|---|---|
| Other apps' notifications in the Island | partial (fragile) | partial | built | macOS: keeper-helper (`Notifications.swift`) reads Notification Centre banners through Accessibility. It's opt-in and needs the Accessibility permission. It can close the banner afterwards ("Close the system banner"). A macOS update can break it. Windows: UserNotificationListener is tried first. It needs package identity and consent, so an unpackaged build gets "denied", and Keeper then reads a copy of the Action Centre's history (`wpndatabase.db`) when it changes. Linux: the desktop bus, read-only. On every system: a block list, an allow list, de-duplication, and Keeper's own notifications are left out. |
| Suppressing the original | partial (macOS) | not possible | not possible | Only the macOS banner can be closed (Accessibility "Close"). Windows and Linux don't let one app hide another's notification. |
| Volume / brightness feedback | partial | built | built | Keeper shows its level **beside** the system pop-up. It doesn't replace it: on macOS that needs private APIs, and Windows/Linux desktops own their pop-ups. Change detection uses only system events, never a steady poll. macOS: Core Audio listeners. Brightness keys come through a listen-only event tap (Input Monitoring). The brightness level is read through IOKit on Intel Macs and estimated on Apple silicon (private there). Windows: the Core Audio volume callback and the WMI brightness event, in one PowerShell process. Linux: `pactl subscribe` and `udevadm monitor` for the backlight. |
| Calls: app, timer, mute | built | built | built | Finds a call app (Zoom, Teams, FaceTime, Slack huddle, Discord, Webex, Skype, WhatsApp, Signal, Telegram, Jitsi, Whereby…) or a browser call holding the microphone. Browser calls are recognised from the front window or tab titles. macOS 14.2+ knows which app per process (Core Audio, `Calls.swift`); older versions only know that some app is using it. Mute uses the system microphone (Core Audio, Core Audio COM, PulseAudio/PipeWire) or the app's own shortcut, which brings the app forward for a moment. Accept/Decline banners are not possible: no public API exposes another app's incoming call. |
| Coding agents beyond Claude Code / Codex | better | better | better | Cursor-like editors, and any agent that can run a hook, write `~/.keeper/agents/*.json` through Keeper's status script. Settings → Island sets up Cursor's `hooks.json` next to the person's own hooks, with a backup. Gemini CLI and Qwen Code are read from their session files, OpenCode from its message files. Names come from the shared agent table `core/agents-detect.ts`. |
| AI usage for more services | better | better | better | Through the existing usage code, plus Gemini CLI and Qwen Code (replies and tokens today, measured against the free daily allowance) and OpenCode (tokens and cost per 5 hours and per week). Grok keeps no local counts and has no read-only personal usage endpoint; the meter says so. |
| Usage ring beside the pill | built | built | built | Opt-in. The allowance closest to its limit, refreshed every 5 minutes only while it's on. |
| Text capture: Windows.Media.Ocr engine | – | built | – | Capture options → Reader: Automatic / the system's recognizer / the built-in reader. It runs from PowerShell WinRT with no packaging needed, and reads neat handwriting. |
| Text capture: better Tesseract on Linux | – | built | better | The picture is cleaned first: grey, contrast stretched, light-on-dark turned around, then black and white at Otsu's threshold, or soft greys for handwriting. A layout hint sets the page segmentation mode (block, column, line, word, scattered). Language detection still picks the reader. |
| Handwriting | built (Vision) | built (system OCR) | partial | Linux has no system recognizer. The built-in reader with grey clean-up and the block layout does better than before, but stays rough. |
| Long break, focus ruler | built | built | built | A long break every N rounds, and a 3-hour drag ruler. |
| Shuffle / repeat | built | built | built | Music/Spotify AppleScript, Windows media session, MPRIS (`playerctl`). |
| Artwork glow, corners, shadow | built | built | built | The glow reads the artwork's colour when the image allows; otherwise it uses a soft default. |
| Lyrics per player | built | built | built | "No lyrics for" list. |
| Alt/Option-click hides for a minute | built | built | built | The time can be changed. |
| Low-disk warning | built | built | built | Warns once below the threshold (default 10 GB) and again only after space recovers. Clean Up is one click. It is a low-priority alert, so it shows in the Island only with *Also show tips and findings* on. |
| Island entry to the tool launcher | built | built | built | The grid button calls MONITOR's launcher. It's hidden while the `toolLauncher` feature is off. |
| Cues: types, places, times | better | better | partial | Note, checklist, link and file cues. Places: an app (name, bundle id, exe or WM_CLASS), a site, a page, a window title (project awareness from editor and design-tool titles, or `/regex/`) and a file. Times are typed in plain words ("tomorrow 9am", "every weekday"). The front window comes from fg-watch: the macOS JXA loop, the Windows PowerShell loop, or X11 `xprop -spy`. Pages come from the browser extension. On **Wayland** no app can see which window is in front, so app and title cues show only in the Island. Page and site cues still work through the extension. |
| Cues: popup beside the app | built | built | built (X11) | It sits next to the front window's bounds (reported on macOS/Windows; `xwininfo` on X11), otherwise top-right of that screen. Shown without focus. Cool-down and "show once" options. |
| Cues: capture | better | better | better | From the Island (a copied link becomes a link cue), the palette, the shortcut, the tray, the dashboard, the extension's button/menu/shortcut, the CLI and AI abilities. A "capture hint" can ask after time on a page (opt-in). |
| Cues: checklists | better | better | better | Reusable checklists stored as Markdown. Steps can be skipped per run. Pasting several lines makes steps. "Save as checklist" works on any checklist cue. **Start from an example** offers six ready-made ones (Before a video call, Weekly review, Before a release, Leaving for the day, Packing for a trip, Before presenting), added as your own with one click. |
| Cues: snooze, due, repeat | better | better | better | 10 min to next week, or "next time I'm here". A due cue rings once (Island, notification, popup). Repeats come back with the steps unticked. One timer runs to the next due time; nothing polls. |
| Cues: dashboard | better | better | better | Filters (All, Waiting, Later, Overdue, Done, by type, Recently deleted 30 days), search, sort, Due today / Upcoming, Here now, card text size 9–28 pt. |
| Cues: sync, search, AI | better | better | better | Each cue is a plain Markdown file in `Documents/Keeper Cues`, with templates in `Checklists/`. Edits made elsewhere are read back. "Sync this folder" adds it to Keeper Sync. Quick Search lists matching cues. AI abilities can search, create, tick and snooze (permission-gated). Markdown export is available. |
| Cues: typing suggestions | built | built | built | Tab completes phrases learnt from your own cues, on this computer only. |
| Lock-screen music card | not possible | – | – | On the "do not build" list (private SPI). |

## Verified and not verified

Verified on Linux (Electron under xvfb, `test/e2e/cues.cjs`, 18 checks):
- Cues: the sidebar entry, composer, Markdown file, tick written to the file, outside edits read back, the popup beside a reported page, the Island activity and Cues tool, a timed cue ringing once, reusable checklists with a skipped step.
- Island+: a hooked Cursor agent showing as "waiting", another app's notification from the desktop bus, the status report, the settings sections, no sideways scrolling at small sizes.
- Screenshots (light and dark) are in the e2e output folder.
- The browser demo (`npx vite`) loads the app, Island, cue popup and Quick Search with no console errors.

Unit tests: `test/cues.test.ts` and `test/island-gaps.test.ts` cover the parsers, rules and Markdown round trips.

Not verified (no hardware here):
- the macOS helper code (`Notifications.swift`, `Calls.swift`; compiled only on a Mac);
- the macOS and Windows front-window reporting;
- Windows' notification listener and history fallback;
- the Windows and macOS level listeners;
- Windows/macOS microphone muting;
- muting through an app's own shortcut;
- Windows.Media.Ocr through the new engine choice (the script itself was already in use).

The Linux call detection was unit-tested on `pactl` output only. No real call was made.
