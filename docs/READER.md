# Reader

Follow sites through their feeds and save any web page for later, read in a
calm, clean view that works offline. Keeper only ever fetches the feeds and
pages you add.

- Page: **Reader** in the sidebar's Notes section. Sources on the left (Unread, All articles, Starred, Read later, then feeds by folder with unread counts), the list in the middle, the article on the right. Refresh, Import and Export (OPML) at the top.
- Feature (Settings → Features → Notes): `reader`, **off**. While off nothing is fetched and no timer runs.
- Settings → General → Reader: how often to look for new articles (30 minutes to once a day; default every hour), fetch whole articles; under More settings, show pictures in articles and how long read articles stay (starred and saved ones always stay).
- Browser extension: right-click a page or a link → **Save for later in Keeper**.

## Feeds

| | |
|---|---|
| Formats | RSS 2.0 (with `content:encoded`, `dc:creator`, enclosures and media pictures), RSS 1.0 (RDF), Atom (including `type="xhtml"` content), JSON Feed 1.0/1.1 |
| Adding | Paste a feed's address, or any page of a site: Keeper reads the page's `<link rel="alternate">` feeds, then tries the usual addresses (`/feed`, `/rss`, `/feed.xml`, `/atom.xml`, `/index.xml`, `/feed.json`…) |
| Looking for new articles | On the governor's schedule (`poll('reader.refresh')`): every hour by default, slower when nobody is at the computer, never while the screen is locked; a first look 20 seconds after start when the last one is older than the interval. Conditional requests (`ETag`, `Last-Modified`), three feeds at a time, 20-second timeout, 8 MB at most |
| Folders | Kept from OPML; feeds can be renamed and moved (`editFeed`) |
| Errors | Shown on the feed in plain words ("The site did not answer in time", "The address was not found") |

## The clean article view

When an article is opened and its feed gave only a summary (under 150 words) and *Fetch whole articles* is on, Keeper reads the article's page and keeps only the article: the part of the page whose paragraphs hold the most plain text (with a bonus for `article`/`main` and article-like class names, less for blocks full of links), without menus, headers, footers, sidebars, comments, share buttons, forms or scripts. The original code is in `core/reader.ts` (`extractArticle`). The title, author, site name, date and picture come from the page's own information.

Every article — from a feed or from a page — is then cleaned with an allowlist (`sanitize-html`): reading tags only, no scripts, styles, frames, forms or event handlers; links made absolute; tracking pixels removed; pictures removed when *Show pictures* is off. It is kept in `<data folder>/reader/articles/<key>.html`, so everything you opened or saved reads offline. (Pictures themselves are not stored; they load from the article's site when shown.)

## Read later

Paste an address under **Read later**, use **Read later** on any article, or the extension's menu. Keeper fetches the page itself, keeps the clean article and lists it under Read later with its site's name. Removing it from Read later deletes it unless it also belongs to a feed.

## OPML

**Import** reads an OPML file (folders kept; feeds already followed are skipped); the feeds are looked at in the background. **Export** writes every feed, in its folder, as OPML 2.0 for any other reader.

## Privacy

- Requests go only to the feeds you follow, the articles' pages when you open a summary-only article or save a page, and (with pictures on) the articles' pictures. No accounts, no sync service, no AI.
- Keeper's own firewall rules apply: a site blocked for Keeper is not fetched, and the reader says so.
- The list of feeds and articles is in `<data folder>/reader/state.json` (mode 600); articles beside it.

## Platforms

The same on macOS, Windows and Linux (plain HTTPS from Keeper's main process).

## Files and code

- `core/reader.ts` — feed parsing (four formats), finding feeds, OPML in and out, the clean article view, settings. Tested in `test/reader.test.ts`.
- `electron/services/reader.ts` — fetching, storing, cleaning, the schedule; `electron/ipc/reader.ts` — IPC and `keeper/reader.save` for the extension.
- `src/screens/Reader.tsx`, `src/styles/reader.css`.
- End to end: `test/e2e/reader.cjs` against a small web server on the test machine — following a site finds its feed; unread counts; a summary-only article opens whole from its page, without the page's menus and sidebar; saving a page for later; OPML export and import with folders; Atom; reading offline with the server gone; only the added addresses are requested; light and dark.

## Not yet

- Articles in the AI's file search (the brain), an Island card for new articles, and saving from the Shelf.
- Keeping pictures for offline reading.
- Feeds that need a sign-in.
