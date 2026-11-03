# The Island's colours

The Island is no longer only black. It wears the active theme: its open panel and (where there is no notch) its
closed pill take a gradient from the theme's own colours, its text, accent, cards and buttons follow, and what is
going on tints it. Light themes get a light Island. The palette is built in `core/island-look.ts`; the Island
(`src/island/Island.tsx`) writes it on `.isl-root` as `--isl-*` variables and `src/styles/island.css` reads them.

## Settings → Island → Look

| Row | Choices | Default |
|---|---|---|
| Colours | **Match theme**, **Dark**, **Colourful** | Match theme |
| Gradient (Colourful only) | Coral, Lagoon, Berry, Fern, Starlight, Ember | Coral |
| Strength (not for Dark) | Subtle, Bold | Bold |
| Accent | the theme's own, seven colours, or any colour | the theme's own |

A preview at the top of the section shows the closed pill and the open Island in the chosen colours, and can show
them while music plays, a meeting is next, a timer runs or the computer charges. The same rows are in the Settings
search (`island.look`, `island.lookIntensity`, `island.lookPreset`, `island.lookAccent` in
`core/settings-schema.ts`). **Black and white** (Settings → Island → Placement) still turns every colour to grey.

- **Match theme**: on a dark mode, the theme's Island background mixed with its accent and a neighbouring colour
  from its own palette (its shelf colours), as a diagonal gradient with a soft light in the top-left corner. On a
  light mode, the theme's panel colour tinted the same way, with the theme's own text: a light Island.
- **Dark**: one deep colour (the theme's Island background, near black), the old look, with the theme's accent.
- **Colourful**: one of six vivid gradients, deep enough for white text. Subtle mixes them with the dark.
- **Accent**: buttons, the scrubber, highlights, the glow and the notch's edge. Keeper's own custom accent
  (Settings → Appearance) is used when the Island has none.

## Live colour

The main activity tints the gradient: the music's artwork (the colour already sampled for the waveform, see
`glowColor` in `core/island-plus.ts`), a meeting's calendar colour, the timer's orange, green while charging, red
when the battery is low, and so on. Greys (the plain battery, files on the shelf) and things that only flash by
(Copied, volume, a notice) never tint it, and Dark is never tinted (only its glow and edge take the colour). The
three gradient stops are registered colour properties (`@property --isl-s0…2`), so the Island glides to a new
colour over 0.6 s; with less motion (Settings → Accessibility, or the system's setting) it changes at once.

## On a notch

On a Mac whose Island grows out of the notch, the closed pill and its bubble stay the notch's own black so they
blend with it. They get a thin edge in the live colour (or the accent) along the bottom that glows softly up into
the black, and coloured glyphs. When the Island opens, the black of the notch fades into the colours just below it,
so the top of the panel still meets the notch. The idle notch (nothing going on) shows no edge.

## Contrast

Every text colour is checked against every part of the background it can sit on: the three stops, points between
them (a gradient can dip below both ends), the corner light, and the strongest card or hover fill over each.

| Pair | Minimum |
|---|---|
| text, secondary text and captions | 4.5 : 1 |
| status text (green, yellow, red, blue) | 4.5 : 1 |
| text on the accent | 4.5 : 1 |
| the accent as a shape | 3 : 1 |
| the notch's edge on black | 3 : 1 |

When a colour does not pass it is moved toward white (or black) only as far as needed (`readableTint`); when even
white (or black) would not pass with room to spare, the background itself is darkened (or lightened) a little.
Activity colours drawn as text or glyphs are made readable the same way where they sit: on the Island's colours, or
on the notch's black. `test/island-look.test.ts` checks all 38 themes in each of their modes, every look, strength,
gradient and a range of live colours and custom accents (several thousand palettes).

## Less transparency, less motion

- *Reduce transparency* (the system's setting): the corner light is dropped; everything else is already opaque.
- *Reduce motion*: no colour transitions.

## Systems

Pure CSS and data, the same on macOS, Windows and Linux. The notch's black pill and edge apply only where the Island
grows out of a notch (Macs with one); everywhere else (no notch, below a top bar, on a side edge) the pill is in the
colours too. Checked on Linux (Xvfb, `test/e2e/island.cjs`: the open Island follows two themes, light themes give a
light Island, text keeps AA, Settings recolours it). The notch's edge needs a Mac with a notch to see.
