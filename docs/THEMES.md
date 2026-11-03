# Themes

Keeper by Ashforde® ships 38 themes: 28 in the main collection, 5 seasonal and 5 unique showpieces. They are all data in `core/themes.ts`; the window, Quick Search, the Island and widgets all read the same CSS variables, written by `src/theme.ts`.

## How a theme is made

Each theme has a name, a one-line tagline, tags (used by gallery search), a font (`system`, `rounded`, `serif` or `mono`, always fonts already on the computer), a corner style, an optional `category` (`main`, `seasonal`, `unique`) and, for seasonal themes, a `season`. Its light and/or dark modes are built from a short spec by `tokens()`:

- surfaces: `bg`, `elev` (cards and panels), `sunk` (sidebar), and `ink`, the colour hovers, lines and shadows are mixed from;
- text in three strengths, the accent, danger, ok and warn;
- nine shelf colours (images, videos, music, documents, archives, installers, apps, code, other), which the Space Map and charts use too;
- the owl's three colours and the Island's background, text and accent;
- optional corner radii, shadow tint and `appBg`, a CSS background for the whole window (gradient or pattern).

A theme without a `light` or `dark` mode shows its only mode whatever the appearance setting is ("Dark only" / "Light only" in the gallery).

## Contrast

`test/themes.test.ts` checks every mode of every theme against WCAG AA:

| Pair | Minimum |
|---|---|
| text on the window and on panels | 4.5 : 1 |
| secondary text on the window and on panels | 4.5 : 1 |
| faint text on panels | 3 : 1 |
| button text on the accent | 4.5 : 1 |
| the accent on panels | 3 : 1 |
| Island text, and text on the Island's accent | 4.5 : 1 |

The Island builds its own palette from these tokens (Settings → Island → Look: Match theme, Dark or Colourful), with its own, stricter checks in `test/island-look.test.ts`: see [ISLAND-LOOK.md](ISLAND-LOOK.md).

It also checks that every token is set and every colour parses. A custom accent chosen in Settings gets a warning when it is hard to see on the theme's panels.

## Terminal colours

A terminal set to **Follow Keeper’s theme** takes its colours from the theme. The twenty newer themes (the ten newer main themes, the five seasonal and the five unique ones) each have a terminal palette of their own in `core/terminal/themePalettes.ts`: background, foreground, cursor, selection and the 16 ANSI colours, in light and dark where the theme has both. The other themes use the theme's background, text and accent over the Night or Day colours. `test/terminal.test.ts` checks every palette: the foreground at least 4.5 : 1 on the background, and the ANSI colours at least 3 : 1 (except black on dark and white on light, which are meant as fills). Open terminals change colour as soon as the theme or the appearance changes.

## Following the seasons

With **Settings → Appearance → Follow the seasons** on, the theme on screen is the seasonal one:

- 15 December – 6 January, anywhere: **Festive Lights**;
- otherwise meteorological seasons (winter is December–February in the north), flipped south of the equator: **Frost**, **Spring Meadow**, **Summer Haze**, **Autumn Ember**.

The hemisphere is chosen in Settings, or found automatically: from the weather place's latitude when one is set, else from the time zone (`hemisphereFor` in `core/themes.ts`). The change happens just after midnight; Keeper sets one timer a day for it, no polling. Choosing a theme by hand, from the gallery, the command palette or ⌘⇧L, turns following the seasons off.

## Staying light

Theme decorations (gradients, grids, scanlines, the festive string of lights) are static backgrounds: nothing animates and nothing repaints on its own. Frosted Glass blurs only the sidebar, top bar, menus, dialogs and inspector (not every card in a scrolling list), and falls back to solid panels where the system cannot blur. In Minimal resource mode the decorative window backgrounds are dropped.

## Adding a theme

1. Add an entry to `THEMES` in `core/themes.ts` with an id, name, tagline, tags, font, corners, category and `tokens('light', …)` / `tokens('dark', …)`.
2. Run `npx vitest run test/themes.test.ts`; fix any contrast pair it reports.
3. Optional: a signature in `src/styles/themes.css` under `html[data-theme-id='<id>']` (keep it static), and section colours (`--sec-*`) if the theme uses few colours.
