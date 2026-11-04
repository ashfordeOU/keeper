<!-- SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0 -->
# Translating Keeper

Keeper's words live in two places today: a small dictionary of keys (`src/i18n-strings.ts`, about 240 keys in ten languages, used through `useT()`), and words written straight into the screens. On 4 November 2026 the second kind is about **8,000 strings**; about 60 places use keys. So a language other than English covers roughly 1% of the interface.

A half-translated interface looks broken, so:

- **Only complete languages are offered by default** (English, or the system's language when it is English). The other nine appear with **More settings** shown, marked *partly translated*, and Settings says that the rest stays in English. Anyone who chose one before keeps it.
- **Docs and the website are English first.** When Help sheets are translated, they come first.

## Tools

- `node scripts/i18n-extract.mjs` counts the strings that are not translatable yet, by area. `--write strings.en.json` writes every one with where it is (a catalogue for translators, keyed by file and words). It reads JSX text and the words in `title`, `aria-label`, `placeholder`, `alt` and `label`, and skips code-looking words.
- `node scripts/i18n-extract.mjs --rtl` counts CSS written for left to right only (`margin-left`, `padding-right`, `left:`, `text-align: left`…): 634 in 85 stylesheets today. Arabic and Hebrew need these as logical properties (`margin-inline-start`…) first.
- **The pseudo language** (*Pseudo (longer words, for testing)*, with More settings shown): every word on screen is shown accented, about a third longer and in brackets, including words that are not translatable yet. Untranslatable words, and words that get cut off (they lose their closing bracket), stand out. It changes the page only; what you type is left alone.
- `test/i18n.test.ts` keeps both counts from growing: a new screen uses keys, or the build fails. Lower the numbers as screens move to keys.

## Plan

1. Move the most-seen screens (sidebar, Today, Settings, Files) to keys, area by area, lowering the counts in the test.
2. Translate 100% for Spanish, German, French and Portuguese (Brazil), then offer them without More settings.
3. Turn the CSS to logical properties before adding a right-to-left language.
