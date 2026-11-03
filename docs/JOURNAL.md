# Journal

Journal mode for Notes: a few lines a day, with your mood, photos and — if you
switch them on — the weather and where you were. Each day is one ordinary
Markdown note in a notes vault, so Notes, other Markdown apps, Sync and Locked
folders all work with it as they are.

- Page: **Journal** in the sidebar's Notes section.
- Feature (Settings → Features → Notes): `journal`, **off**; it needs Notes.
- Settings → Privacy & permissions → Journal: weather in journal entries (off), places in journal entries (off), suggest photos from that day (on). Which vault and folder is remembered in `journal` in the settings.

## Where entries live

**Start in Documents › Journal** makes (or reuses) the folder `Documents/Journal` and adds it as a notes vault; entries go at its top. Choosing one of your existing vaults instead puts them in a `Journal` folder inside it.

```
<vault>/[Journal/]2026/2026-11-03.md
```

```markdown
---
journal: 2026-11-03
mood: good
weather: Partly cloudy
temperature: 12 °C
place: Tallinn
---
# Tuesday, November 3, 2026

![[Harbour at dusk.jpg]]

Walked along the harbour after work.
```

Other properties in the file (tags, anything another app added) are kept when Keeper saves. A file written elsewhere without the heading or properties opens with all its text. Photos are copied into the vault's attachment folder (Notes' own setting) and embedded, so they travel with the vault.

## The page

- **Calendar**: the month, a dot on each day with an entry, today marked; future days cannot be chosen.
- **Streak**: days in a row up to today (yesterday still counts until today ends), the longest run, and how many entries.
- **On this day**: entries from the same day in earlier years (29 February shows on 28 February in other years), with the first photo, the mood and the first words; click one to open it.
- **The entry**: five moods (Great, Good, Okay, Low, Rough); the text, saved as you type (and when you leave the day); **Add photos** (a picker); **From this day**: photos in your library made that day, added only when you click one; **Add the weather** for today (from Weather's current place) and **Add where I was** (the places Places & Tracks has for that day), each only when switched on in Settings; each can be removed.
- **Open in Notes** opens the vault in Keeper's Notes.

Nothing goes over the network for the journal itself: the weather comes from Keeper's Weather (which only asks for the places you added), and places from Places & Tracks on this computer.

## Files and code

- `core/notes/journal.ts` — paths, writing and reading an entry (keeping other properties), streaks, On this day, excerpts, settings. Tested in `test/journal-mode.test.ts`.
- `electron/ipc/journal.ts` — making the Journal vault in Documents, copying photos into a vault; everything else uses Notes' own calls.
- `src/screens/Journal.tsx`, `src/styles/journal.css`.
- End to end: `test/e2e/journal.cjs` — off until switched on; Start makes the vault; last year's entry under On this day; the streak; a mood and words saved as a Markdown note with properties; a photo from the library suggested, copied and shown; an entry written elsewhere opens; light and dark.

## Not yet

- An "On this day" card on Home and in the Island.
- Steps and calendar events in the entry; importing other journal apps' exports.
- Locking the journal is done with Locked folders on the vault's folder, as for any folder; there is no separate journal lock.
