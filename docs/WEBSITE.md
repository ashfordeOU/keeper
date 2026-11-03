# The website

keeper.ashforde.org is plain HTML and CSS with one small script, built with no dependencies:

    node site/build.mjs --out <dir>

Pages are `site/pages/*.html` inside `site/templates/layout.html`; styles are `site/assets/site.css`,
the script is `site/assets/site.js`, and the logic it uses is in `site/lib/*.mjs` (tested in
`test/site.test.ts`). Nothing is loaded from other sites.

## Layout

- One container (`.wrap`: 1120px wide, 22px sides, 16px under 480px wide).
- One spacing scale in `:root`: `--section` between sections, `--head-gap` between a section's
  head and its content, `--gap` between cards, `--cols-gap` between two columns.
- One set of corners: `--r-sm` 12px (controls, small rows), `--r-md` 16px (windows, questions,
  tables), `--radius` 20px (cards, panels), `--r-xl` 28px (stages, bands, shells), 999px capsules.
- Section heads are centered when a symmetric block follows (a row of cards, a stage, a diagram,
  the questions) and left-aligned above two columns. Spotlights alternate sides and mirror exactly.
- Grids never leave one card alone on a last row: three cards are a row or a column, six become
  two by three, four parts make two rows of two.
- Design language: a calm light-grey canvas, a floating top bar with one filled button (Download),
  big tight headlines with one marked phrase, small muted labels with a colored dash, short
  dot-separated facts, and app mockups as soft panels inside a rounded shell.

`test/e2e/site-layout.cjs` measures all of this in Chromium at 1440, 1024, 768 and 390 wide, light
and dark (builds the site when no folder is given):

    NODE_PATH=/opt/node22/lib/node_modules node test/e2e/site-layout.cjs [siteDir] [shotsDir]

## Motion

Everything that moves is inside `@media (prefers-reduced-motion: no-preference)`; what the rules
outside it draw is the still version. Endless loops run only while their part is on screen
(`[data-live]` gets `.live`).

- Hero laptop: opens on load (lid, screen, Keeper, then the Island), leans up to 3 degrees towards
  the pointer and back as you scroll (`tilt` in `site/lib/motion.mjs`).
- Statement: lights up word by word as it scrolls up (`wordsLit`).
- Lid demo (Keeper + Monorail page): the lid turns in 3D; the screen shows Monorail's strip,
  Keeper's Island saying Awake, or sleep; the Stay Awake glow is the holder's color (`scene` in
  `site/lib/lid.mjs`).
- Slideshows in a monitor (Build your Keeper, themes): a new picture every 4.2 seconds while on
  screen, held while pointed at or used, with a Pause button (`nextSlide`, `nextPart`).
- Island: breathes while closed, settles in as it opens, battery fills; Keep Awake steam; Wi-Fi
  and Bluetooth in the stage's menu bar.
