# Time Tracking

Records which app, document (window title) and website you use, and for how
long, **only on this computer**. A day's timeline, a week, projects sorted by
your own rules, and CSV for timesheets and invoices.

- Page: **Time Tracking** in the sidebar's Computer section. Tabs: Day, Week, Projects, Settings. Pause (for an hour, or until Resume) at the top.
- Feature (Settings → Features → Computer): `timeTracking`, **off**, and only your own switch turns it on (presets and saved sets leave it alone). While off nothing is watched or recorded.
- Settings → Privacy & permissions → Time tracking: keep window titles, keep websites; under More settings, when to stop counting (away for 2–30 minutes) and how long to keep days (a week to ten years). The page's Settings tab also has **Never record** (apps and sites left out entirely; password managers are listed from the start) and **Delete everything**.

## What is recorded

| | How | macOS | Windows | Linux |
|---|---|---|---|---|
| The app in front and its window title | the front-window helper Keeper already uses for Cues and the Island (`electron/services/fg-watch.ts`): it reports only changes | ✅ (window titles need Accessibility for some apps) | ✅ | ✅ on X11; ❌ on Wayland, which does not tell other apps which window is in front (the page says so) |
| The website in a browser | Keeper's browser extension reports the tab in front (as for Cues) | ✅ | ✅ | ✅ |
| Away | the governor's idle time, the locked screen and sleep end the current stretch; idle time is taken off where it started | ✅ | ✅ | ✅ |

A stretch is one span: start, end, app, and (when kept) title and site. A stretch shorter than two seconds is dropped; the same app and window picked up again within five seconds continue the span; a span over midnight is split between the two days.

## Projects

A rule says *project* when *anything / the app / the window title / the site* contains some words (a site rule also matches subdomains). The first rule that matches wins; the rest is "No project". Rules apply to every day, recorded before or after the rule was made.

## Views and export

- **Day**: the timeline across the hours with something in them (at least eight), coloured by project, with each stretch named for screen readers; totals by project, app, site and document; Export CSV; delete the day.
- **Week**: seven days from Monday as stacked bars by project; projects for the week; Export CSV.
- **CSV**: `Date, Start, End, Minutes, App, Title, Site, Project`, one row per span; cells that would run as a spreadsheet formula are prefixed with `'`.

## Privacy and storage

- Everything is kept in `<data folder>/time/`: `state.json` (rules and pause) and one file per day (`YYYY-MM-DD.bin`), gzipped and encrypted with AES-256-GCM under a random key held by the system keychain — the same sealing as Places & Tracks (`core/tracks/vault.ts`). Without a usable keychain (some Linux desktops) the days are only gzipped, and the page says so.
- Nothing leaves the computer: no network, no AI, no sync. Days older than the chosen limit are deleted. **Delete everything** removes every day and the key.
- Cost while on: no polling of windows (changes are reported), and one look every 15 seconds at whether someone is at the computer (slower when idle). Today's spans are written every two minutes and when Keeper quits.

## Files and code

- `core/time-track.ts` — spans from front-window changes, exclusions, splitting at midnight, rules → projects, day and week summaries, CSV. Tested in `test/time-track.test.ts`.
- `electron/services/time-track.ts` — the recorder and storage; `electron/ipc/time-track.ts`; the extension's page in front arrives through `keeper/cues.active` (`electron/ipc/cues.ts`).
- `src/screens/TimeTracking.tsx`, `src/styles/time.css`.
- End to end: `test/e2e/time-track.cjs` — off records nothing; apps, titles and sites become spans (through a test hook, since a virtual display has no window manager); excluded apps, titles off and pauses; a rule makes a project; the Day view of a day read from its file, the Week and Projects views; CSV; the file on disk is not plain text; Delete everything; light and dark.

## Not yet

- Links from spans to Planner tasks and Focus sessions, a weekly report in the Island, and goals.
- Paths of open documents (only window titles are known).
- Wayland: a GNOME extension or portal that reports the window in front.
