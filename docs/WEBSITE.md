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
  big tight headlines with one marked phrase, small muted labels with a coloured dash, short
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
  Keeper's Island saying Awake, or sleep; the Stay Awake glow is the holder's colour (`scene` in
  `site/lib/lid.mjs`).
- Slideshows in a monitor (Build your Keeper, themes): a new picture every 4.2 seconds while on
  screen, held while pointed at or used, with a Pause button (`nextSlide`, `nextPart`).
- Try the Island: a small desktop under the notch, drawn in CSS (no screenshot). Keeper's ambient
  wallpaper drifts, the clock widget ticks, the weather and week widgets sit on the left, files on
  the right and a Dock of Keeper's app icons (Keeper, Mail, Notes, Calendar, Files, Studio,
  Terminal) along the bottom. Every few seconds a notice drops out of the closed Island: a
  download (which then lands on the desktop), a message or a meeting (`deskEvent`). The colour
  chip recolours the Island (Playful, Ocean, Sunset, Berry, Dark, as in Settings → Island → Look:
  closed it stays black with a glowing edge on the notch; open it is a gradient). The hint is a
  small pill that fades after the first hover, tap or focus. With less motion: no drift, no
  notices, no second hand; the file is already on the desktop.
- Keep Awake steam; Wi-Fi and Bluetooth in the stage's menu bar.

## Download addresses

Download buttons show Keeper's own address while the files stay on GitHub Releases. One list,
`TARGETS` in `site/lib/downloads.mjs`, gives each address its file as the release names it:

| Address | File |
|---|---|
| `/download/mac-arm64/` | `Keeper-mac-arm64.dmg` |
| `/download/mac-intel/` | `Keeper-mac-x64.dmg` |
| `/download/mac-arm64-full/`, `/download/mac-intel-full/` | the `-full` offline disk images |
| `/download/windows/`, `/download/windows-full/` | `Keeper-setup-x64.exe`, `Keeper-setup-x64-full.exe` |
| `/download/linux-x64/`, `/download/linux-arm64/` | the AppImages |
| `/download/deb/`, `/download/rpm/` | `Keeper-linux-amd64.deb`, `Keeper-linux-x86_64.rpm` |

`site/build.mjs` writes a small page at each (noindex, left out of the sitemap) that says "Your
download is starting" and sends the browser on at once to
`https://github.com/ashfordeOU/keeper/releases/latest/download/<file>`, with a link in case it does
not. `/download/` stays the page for people.

The home page's button, the bar's Download button and the Download page's file links point at
these addresses (so hovering shows keeper.ashforde.org/download/…). A plain left click goes
straight to the file and shows three next steps under the button; Cmd, Ctrl or Shift-click opens
the address as it is. Until a full release exists (GitHub's "latest" skips pre-releases) the
script uses the newest release that has the file instead (`fileUrl`).

## Words and settings

- British English on every page (colour, licence, organise, centre); code and addresses stay as
  they are. `test/site.test.ts` checks the pages.
- The light or dark choice is kept in the browser as `keeper-theme` (the old `keeper-site-theme`
  is read once and moved). The footer says: This site has no tracking and no cookies.

## Screenshots

Every picture in `docs/screenshots` (and the theme pictures in `site/assets/themes`) comes from
`scripts/screenshots.cjs`, from the real app on a sample home folder (Quick Look, Notes, the
Terminal) or from the browser demo's sample data (everything else, so no real computer, person or
folder shows). Windows of their own (Quick Search, the clipboard, the Ask prompt, the menu bar,
page windows, light apps) are drawn on a wallpaper at their real size; the capture preview, a pin,
the scrolling bar, Draw on screen and a share page are drawn from the app's own HTML. Other
companies' apps and devices in the sample data become plain names before a picture is taken, and a
picture that would show a coding agent's name is not saved.

    npx vite build && node scripts/build-main.mjs
    xvfb-run -a -s "-screen 0 1920x1200x24" node scripts/screenshots.cjs [--only a,b] [--skip-app]
