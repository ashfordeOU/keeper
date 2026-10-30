# How Keeper is built

Keeper is an Electron app with a React interface, but most of what it does lives in a plain TypeScript engine (`core/`) that has no idea Electron exists. The same engine powers the `keeper` command-line tool and is covered by unit tests that run in plain Node.

```text
┌────────────────────────── interface (src/) ──────────────────────────┐
│ React screens · Island window · Quick Search · command palette        │
│            talks only to window.keeper (core/api.ts)                  │
└───────────────▲──────────────────────────────────────────────────────┘
                │ IPC (named invoke calls + events)
┌───────────────┴────────────── main process (electron/) ──────────────┐
│ windows · tray · global shortcuts · keeper:// links · keeper-file://  │
│ services/: files · vision (OCR, fingerprints) · capture · island      │
│            media · system · startup · apps · protection · clip        │
└───────────────▲──────────────────────────────────────────────────────┘
                │ plain function calls
┌───────────────┴──────────────── engine (core/) ──────────────────────┐
│ indexer · query/parse + match · duplicates · cleanup/targets+engine  │
│ safety · rules · journal · rename · treemap · island · sources        │
│ weather · textools · exif · ai · platform (Node-only OS helpers)      │
└──────────────────────────────────────────────────────────────────────┘
                ▲
                └── cli/keeper.ts uses the same engine
```

## The index

`core/indexer.ts` walks the folders chosen in Settings (Desktop, Documents, Downloads, Pictures, Movies/Videos and Music by default) with `core/walk.ts`, which never follows links, skips dependency folders and app bundles, and honours excluded folders. Each file becomes a `FileEntry` with its kind, dates, size, screenshot flag and a cloud-only flag for iCloud/OneDrive placeholders.

Slow facts are kept per path *and* modification time in `extras`, so a rescan only redoes what changed:

- **download source** — `core/platform.ts` reads the OS metadata; `core/sources.ts` turns URLs into a named source;
- **text** — `electron/services/vision.ts` runs Tesseract on images (screenshots first) and reads plain-text files;
- **fingerprint** — a 64-bit difference hash used for look-alike photos;
- **media details** — size in pixels and camera (from EXIF, `core/exif.ts`).

Everything is saved to one JSON file in the app's data folder.

## Search

`core/query/parse.ts` turns text into a `Query` in three passes: quoted phrases and explicit syntax (`#tag`, `-word`, `ext:`, `from:`, `in:`), then phrase extractors (sources, cameras, folders, sizes, dates, sorting), then single words (kinds, extensions, stop words, and finally free terms). It also produces the chips and the one-line explanation shown above results, and can turn an edited query back into text.

`core/query/match.ts` applies the filters, then scores free words against the name, tags, text inside, download source and folder, forgiving accents, punctuation and one-letter typos, and returns an excerpt around text matches.

## Cleanup

`core/cleanup/targets.ts` lists rebuildable locations per OS (with `*` for browser and app profiles). `core/cleanup/engine.ts` measures and cleans them: only the *contents* of each root, never the root itself; excluded names stay; fresh files can be kept; every entry passes `core/safety.ts` and must resolve inside its root. User files (old installers, forgotten downloads…) come from `core/cleanup/files.ts` and always go to the Trash through `electron/services/files.ts`. The main process accepts clean requests only for files listed in its own latest scan.

## History

`core/journal.ts` records every change (moves, renames, trash, deletes) with sizes. Moves and renames are undone by moving back; trash entries point the user to the system Trash.

## The Island

`electron/services/island.ts` owns the live state: it polls the clipboard, now playing, coding-agent transcripts, battery and microphone; watches Downloads, Desktop and the screenshot folder; runs the focus timer and keep-awake conditions; and fetches the calendar and weather. Pure parts — `.ics` parsing with recurrence, `.lrc` lyrics, agent status from JSON Lines transcripts, clipboard history, the focus timer — live in `core/island.ts` with tests. The Island window (`src/island/Island.tsx`) is a frameless, transparent, always-on-top window that resizes when it expands.

## Security boundaries

- The renderer runs sandboxed with context isolation; the preload exposes only the named calls in `core/api.ts`.
- Navigation away from the app is blocked; links open in the browser.
- `keeper-file://` serves files only from the indexed folders (for the music player).
- API keys are encrypted with the OS keychain via `safeStorage`.
- The assistant only receives metadata, and its suggested paths are filtered against what it was shown.

## Building

`scripts/build-main.mjs` bundles the main process, preload scripts and CLI with esbuild (only `tesseract.js` stays external, because it spawns worker threads). Vite builds the interface. `electron-builder.yml` packages installers for each OS, and `.github/workflows/release.yml` builds them on tag push.
