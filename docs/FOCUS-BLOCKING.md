# Focus Blocking

Keeps the sites and apps that pull you away out of reach while you focus, on a
schedule, or for a while you choose. Instead of an error, a blocked site shows
a calm page, and a blocked app gets a small Keeper window over it. A short,
deliberate way back in ("Let me in for 5 minutes") is there unless you turn on
strict mode.

- Page: **Focus Blocking** in the sidebar's Computer section. Tabs: Lists, Schedules, Settings.
- Feature (Settings → Features → Computer): `focusBlock`, **off** until you turn it on. While it is off nothing runs.
- Settings → General → Focus blocking: block during Focus sessions, strict mode; under More settings the length of a short visit, the pause before one, and closing blocked apps.
- Command palette: **Block Distractions for an Hour** (the Focus list, or the first list).

## When a block is on

| Reason | Starts | Ends |
|---|---|---|
| A Focus session (Island, palette, Planner, Vibes) | when the session starts, if *Block during Focus sessions* is on and a list is chosen for Focus | when the session ends; a paused session keeps blocking |
| A schedule | at its start time on its days | at its end time (an end before the start runs past midnight) |
| By hand | the page's **30 min / 1 hour / 2 hours** (optionally **Strict**), or the palette | at its time |

Several reasons can be on together; their lists are joined. The page shows each reason, the lists, how many sites and apps, when it ends, and how many times something was stopped today.

**Stop blocking** ends a block early: the block started by hand stops, the running schedule is skipped until it would have ended, and the running Focus session no longer blocks (the next one does again).

## Where blocking reaches

| | macOS | Windows | Linux |
|---|---|---|---|
| Sites in browsers with Keeper's extension (Chrome, Edge, Brave, Vivaldi, Opera, Arc, Firefox) | ✅ calm block page | ✅ | ✅ |
| Sites in every app, through the firewall's DNS filter (when it is on and the system asks it) | ✅ | ✅ | ✅ |
| Apps (a Keeper window over a blocked app in front, or closing it) | ✅ | ✅ | ✅ on X11; ❌ on Wayland, which does not tell apps which window is in front |

- **Browser extension** (`browser-extension/`, version 0.4.0): Keeper sends the sites to every linked browser that reports the `focus` ability. The extension turns them into redirect rules (declarativeNetRequest, rule ids from 990001, apart from tracker blocking's) to its own `blocked.html`, and moves tabs already open on a blocked site to that page. The block is kept in the extension's storage and ends at its time even if Keeper is not running then. Without the extension, browsers fall back to the DNS filter, which can only make the site fail to load.
- **DNS filter** (`docs/FIREWALL.md`): sites on a Focus block come before every list and rule, and the query log says "Focus blocking (site)". It only reaches apps if the DNS filter is on and the system's DNS points at it; the page says which of these is the case and links to the firewall.
- **Apps**: while a block with apps is on, Keeper keeps the front-window helper running (`electron/services/fg-watch.ts`, the same one Cues use) and compares the app in front with the list by name, macOS bundle id, Windows program name or Linux window class. The window offers **Close the app** (a normal Quit, so the app can ask to save), **Let me in**, and **Not now**. With *Close blocked apps* on, Keeper quits a blocked app as soon as it comes to the front and says so in the Island.

## A short visit

"Let me in" waits a few seconds first (10 by default; *Pause before a short visit*), then asks once more, then opens the one site (and its subdomains) or the one app for 5 minutes (*Length of a short visit*). In the browser the block page asks Keeper through the extension and the native messaging host (`keeper/focus.pass`); Keeper decides. When the visit ends the site is blocked again.

## Strict mode

On in Settings, or for one block with **Strict** on the page. While a strict block runs:

- no short visits, in the browser or over an app;
- **Stop blocking** is disabled, and stopping the Focus session that started it is refused with a note in the Island;
- the lists and schedules in use cannot be removed.

Strict mode removes the ways out *inside Keeper*. It does not lock the computer: quitting Keeper ends app blocking, and an administrator on this computer can still change anything (the DNS filter, the extension, Keeper itself). The page and Settings say so.

## Files and code

- Lists, schedules, passes and today's count: `focus-block.json` in Keeper's data folder (mode 600). How strict it is: `focusBlock` in the settings.
- `core/focus-block.ts` — the pure logic: which block is on and why, schedules (with past-midnight ranges), passes, stopping early, the next moment anything changes, cleaning stored data. Tested in `test/focus-block.test.ts`.
- `electron/services/focus-block.ts` — applies the block (DNS filter, browsers, apps), the window over a blocked app, and one timer for the next change (none while nothing is scheduled). `electron/ipc/focus-block.ts` — IPC and `keeper/focus.pass`.
- `core/browser-tabs.ts` (`setFocusBlock`, `focusPass`), `cli/browser-host.ts`, `browser-extension/background.js`, `blocked.html`, `blocked.js` — the browser side. Tested in `test/browser-tabs.test.ts`.
- `src/screens/FocusBlock.tsx` — the page and the window over an app.
- End to end: `test/e2e/focus-block.cjs` (the page, a site added and saved, a block by hand reaching the DNS filter and its query log, a short visit, stopping, a strict Focus session refusing a visit and Stop, the window over a blocked app through a test hook, the extension's block page and its pause; light and dark).

## Not yet

- Safari (Keeper's extension does not run there yet); sites in Safari are blocked only through the DNS filter.
- Hiding or pausing a blocked app instead of covering or closing it.
- Strict mode that survives quitting Keeper (it would need a system-level block that only an administrator can lift).
