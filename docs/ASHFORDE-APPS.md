# Ashforde apps in Keeper

Keeper by Ashforde® can install, update and work with its sister apps by
Ashforde. Each app is **off until you switch it on**, is offered only on the
systems it runs on, and when it is off Keeper runs nothing for it.

The first one is **[Monorail](https://github.com/ashfordeOU/monorail)**, a free
(AGPL-3.0) scrolling window manager for macOS 13 and later.

| | macOS | Windows | Linux |
|---|---|---|---|
| Monorail | ✅ Settings → Ashforde apps | Coming when Monorail supports it | Coming when Monorail supports it |

## Where it lives

- **Settings → Ashforde apps**: one card per app, with its switch, install and
  update buttons, its status and the "working together" choices.
- **Settings → Features → Desktop → Monorail** (macOS only): the same switch,
  with what it costs while on.
- **Command palette**: "Monorail: …" actions (its palette, focus mode,
  presentation mode, workspaces 1–5, its settings) and "Ashforde Apps".
- **To do**: an available Monorail update, a shortcut both apps want, and a
  signature problem with the installed copy.

## Monorail, phase 1 (built)

### Install, update, uninstall

1. Keeper asks GitHub for the newest finished release of `ashfordeOU/monorail`
   that has both `Monorail-x.y.z.zip` and `SHA256SUMS`.
2. It downloads the zip and checks its **SHA-256** against `SHA256SUMS`.
3. It unpacks it with `ditto` and checks the **code signature**:
   `codesign --verify --deep --strict`, the identifier `org.ashforde.macslider`,
   and the signing certificate's name (Monorail's releases are signed with
   Ashforde's own self-signed certificate).
4. **Pinning**: the SHA-256 of the signing certificate is remembered on the
   first install (or the first time Keeper sees an installed copy). Every
   later update must be signed with the very same certificate — the same rule
   Monorail's own updater follows.
5. The running copy is quit, the old one goes to the Trash, the new one goes to
   `/Applications` (or `~/Applications` when that is not writable), the
   quarantine flag is removed, and Monorail is opened in the background.

Uninstall quits Monorail and moves it to the Trash; its settings in
`~/Library/Application Support/Monorail` stay unless you choose to remove them
too. An update check runs once a day while the switch is on (you can turn it
off); updates install only when you click **Update**.

Monorail moves other apps' windows, which macOS allows only with
**Accessibility** access. The card has a button that opens Privacy & Security →
Accessibility; macOS also asks on Monorail's first start.

### Connect

**Connect** changes two settings in Monorail's `settings.json` — `localAPI` and
`publishState` — after keeping a copy as `settings.json.before-keeper`. Monorail
reloads its settings by itself. Its local API listens on `127.0.0.1` only and
needs the private key in `api-token`; nothing is reachable from the network.

### Working together

| What | How | Choice |
|---|---|---|
| Workspace and slide in the Island | `state.json` (watched; one folder watch, no polling) → a short "Writing · slide 1 of 3" note when you slide | Workspace in the Island |
| Monorail's actions in Keeper's palette | `monorail://` links, opened in the background | always (when on) |
| Focus sessions | Keeper's Focus session start/end → `monorail://focus-mode/on|off` | Focus sessions switch Monorail's focus mode |
| Presentation mode | Keeper's presentation mode → `monorail://presentation-mode/on|off` | Presentation mode together |
| Keeper's small windows float | title rules for Quick Search, Quick Terminal and Capture added to Monorail's `appRules` (removed again when switched off) | Keeper's small windows float |
| The Island and the slider bar | when Monorail's slider bar is at the **top**, an Island below the menu bar moves below the slider, and a panel that opens apart from the pill starts below it; a pill in the menu bar or notch never moves. Nothing changes when the slider is at the bottom (its default). | always |
| Theme | Keeper's theme → the closest of Monorail's themes (`fjord` → Nord, `terminal` → Phosphor…), "Seasons" when Keeper follows the seasons | Match Keeper's theme (off by default) |
| Shortcut clashes | every `…Shortcut` in Keeper's settings, plus the computer-use stop key, compared with Monorail's keymap (its `settings.json`, or its defaults) | always; shown on the card and on To do |

The Island never takes over Monorail's slider or its menu-bar item; both apps
keep their own places.

### AI tools

Keeper's MCP server (Settings → AI & Brain) offers Monorail's tools to every
connected AI app, prefixed `monorail_`: `get_state`, `list_windows`,
`list_workspaces`, `get_history`, `get_insights`, `focus_window`, `move_window`,
`pair_windows`, `switch_workspace`, `perform_action`, `apply_layout`,
`open_app_pair`, `run_template`, `undo`, `redo`, `name_slide`,
`set_slide_layout`, `close_window`, `note_window` and `notify`.

They are the same tools `Monorail --mcp` offers, called through Monorail's
local API. **Off / Ask / Allow**: with Ask (the default), reading is allowed and
anything that changes windows shows Keeper's approval prompt ("Always" switches
to Allow). Tools appear only when Monorail is installed, connected and the
switch is on.

### What it costs

Off: nothing — no watch, no timer, no tools. On: one file-system watch on
Monorail's folder (events only when `state.json` or `settings.json` change), an
update check once a day (the first one ten minutes after start), and a
signature check of the installed copy once when the switch goes on.

### Verified, and what needs a Mac

- **Tested here** (Linux, `test/ashforde.test.ts`, `test/e2e/ashforde.cjs`):
  release and checksum parsing, signature rules and pinning, `state.json`
  parsing, the connect patch, float rules, Monorail's default keymap and
  clash detection (Keeper's defaults do not clash), the slider/Island
  geometry, theme mapping, `monorail://` links, the tool list, the feature
  switch (off by default, macOS only), the Island note, and in the real app
  that everything stays off and hidden on Linux. The Settings card is
  exercised end to end in the demo (install → connect → live state).
- **Needs a Mac to verify**: the real download/`ditto`/`codesign` path, the
  Accessibility hand-off, the local API calls, the `state.json` watch with a
  running Monorail, and `monorail://` links. Each step reports its own error
  on the card instead of failing silently.

## Phase 2 (proposed)

- **One menu-bar presence**: Monorail's workspace indicator shown in Keeper's
  Island instead of its own menu-bar item (needs a Monorail setting to hide
  its item while Keeper shows it).
- **Monorail inside Keeper**: a "Windows" page listing windows, workspaces and
  slides (from `list_windows` / `list_workspaces`) with drag to pair, layouts
  and saved templates.
- **Shared Focus**: Monorail's focus minutes and goals in Keeper's Focus
  statistics, and Monorail's pomodoro driving Keeper's timer (needs an event
  from Monorail — its `org.ashforde.monorail.changed` notification already
  fires; Keeper needs the helper to listen for distributed notifications).
- **Per-workspace Keeper**: Keeper's shelf, sidebar set or feature set switching
  with Monorail's workspace or profile.
- **Shortcut resolver**: offer a free key and change it in either app with one
  click.
- **Signed by a Developer ID**: when Monorail ships notarised builds, pin the
  team identifier instead of the certificate.
- **Windows and Linux**: when Monorail is ported, the same card with each
  system's install path (winget / Flatpak) and its own tools.
- **More Ashforde apps**: the catalogue in `core/ashforde/apps.ts` is ready for
  more entries; each brings its own `core/ashforde/<app>.ts` and service.

## Code

- `core/ashforde/apps.ts` — the catalogue.
- `core/ashforde/monorail.ts` — pure: releases, checksums, signatures, state,
  settings patches, keymap and clashes, slider geometry, themes, tools, links.
- `core/api-ashforde.ts` — the interface between window and main process.
- `electron/services/ashforde/monorail.ts` — finding, installing, following and
  driving Monorail.
- `electron/ipc/ashforde.ts` — IPC, the feature switch, To do, AI tools and the
  Island placement hook.
- `src/components/AshfordeApps.tsx` — the Settings card; `src/mock-ashforde.ts`
  — the demo.
