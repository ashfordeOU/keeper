# Notes

Keeper's Notes page opens any folder of Markdown files as a **vault**. It is built to be compatible with Markdown vaults made by other popular notes apps (including their `.obsidian` settings folder), so the same folder can be used with both:

- notes stay plain `.md` files;
- the vault's `.obsidian` settings folder is read, and written only for the files the two apps share (`bookmarks.json`);
- canvases are standard JSON Canvas `.canvas` files;
- bases are `.base` YAML files;
- properties are YAML frontmatter.

Keeper's own state lives in its data folder (`<userData>/notes/`), never inside the vault:

- the vault list;
- recovery snapshots;
- settings;
- saved workspaces;
- Keeper plugins.

Keeper is not affiliated with any other notes app. Folder names are mentioned only to describe file compatibility.

## Where things live

| What | Where |
| --- | --- |
| Vault files | the folder you opened, unchanged |
| List of vaults | `<userData>/notes/vaults.json` (`id`, `name`, `path`); `window.keeper.notes.vaults()` / `vaultPath(id)` in the app, `keeper/notes {cmd:"vaults"}` over MCP |
| Notes settings | `<userData>/notes/settings.json` (AI opt-in, agents may edit, snapshot interval, vim, spellcheck, workspaces, plugin grants) |
| File recovery | `<userData>/notes/recovery/<vault id>/<sha1 of path>/<time>[-agent-name].md` |
| Keeper plugins | `<userData>/notes/plugins/<id>/manifest.json` + `main.js` |
| Open tabs and panes | the window's local storage, per vault |

## The page

- **Three panels**, separated by one equal gap: the notes list, the open note, and links and outline. Only the first two are always there.
- **The notes list** has one header: the vault (its menu switches vault and opens settings), a search box (Ctrl+Shift+F; Esc goes back), **New**, and **More** (new folder, canvas or base, sort by name or last change, close all folders, random note, all commands). Below it: Files, Tags, Bookmarks and Recent. **Today** and **Graph** sit at the bottom.
- **The open note** has one row on top: the tabs, Live / Source / Read, **More for this note** (record audio, slides, earlier versions, publish, open to the right, rename, bookmark, delete) and the button for links and outline. The note's name shows once, in its tab; a note inside a folder shows the folder path above its properties.
- **The text column** is about 70 characters wide and centred; the properties sit in an aligned grid in the same column. The vault's "readable line length" setting off makes it full width.
- **Links and outline** are closed at first on windows narrower than about 1360 pixels. Wide and narrow windows remember the choice separately. Below 1180 pixels the panel floats over the note (Esc closes it).
- Spacing comes from one scale (`--nt-s1` … `--nt-s7` in `src/styles/notes.css`); text sizes and corners come from Keeper's tokens.

## Mind maps

**Map** (next to Live, Source and Read) shows a note as a mind map: the `# Title` (or the file name) in the centre, headings and list items as branches. Notes with the property `view: mindmap` open as a map; **More → New mind map** makes one.

| Key | Does |
| --- | --- |
| Tab | add a branch under the selected one |
| Enter | add a branch beside it (Shift+Enter while typing: just save) |
| F2, double click, or typing | rename |
| Delete / Backspace | remove the branch and what is under it |
| Space | fold or unfold |
| Arrow keys, Home | move around; Alt+↑/↓ reorders |
| Ctrl+Z / Ctrl+Shift+Z | undo / redo |
| Ctrl + / − / 0 | zoom in, out, fit |

- Drag a branch onto another to put it under it, or onto the top or bottom edge of one to place it before or after.
- Every change is written into the Markdown. A heading moved under a list item becomes a list item; new branches under headings become headings. Paragraphs, tables and code blocks stay attached to the branch above them, and a note read and written back without changes is byte for byte the same (unit-tested).
- **Both sides** or **Right** layouts; **PNG** and **SVG** save the map in the colours on screen.
- Code: `core/notes/mindmap.ts` (reading, writing, edits, layout; `test/notes-mindmap.test.ts`), `src/notes/MindMap.tsx`; end to end: `test/e2e/notes-mindmap.cjs` (a 500-branch map shows in well under a second).

## Import and export

**Import notes** is in the vault menu (and on an empty page). Pick the app, follow its steps, check what will come in, then import. Each import goes into a folder of its own (`From Evernote`, then `From Evernote 2`…, or a name you type); nothing in the vault is ever overwritten.

| App | What you choose | Notes |
| --- | --- | --- |
| Markdown folder or vault | the folder | copied exactly as it is (notes, pictures, sub-folders), so its links keep working; `.obsidian` and `.trash` stay behind |
| Evernote | an `.enex` file or a folder of them | each file is a notebook (folder); checklists, tables, pictures and files; links between notes when the link text is a note's title |
| Joplin export | a `.jex` file or a sync folder | notebooks, tags, pictures (`resources/`), `:/id` links become [[links]]; encrypted notes are skipped |
| Joplin (running) | the Web Clipper token | through Joplin's own service on this computer |
| Standard Notes backup | the backup file | an encrypted backup is opened here with its password (never sent) |
| Notesnook | a Markdown or HTML export, or an unencrypted backup | |
| Google Keep | the Takeout Keep folder or `.zip` | checklists, labels, pictures, links; archived notes go in `Archive`; trashed ones are skipped |
| Simplenote | the export `.zip` or `notes.json` | the first line is the title; pinned notes keep `pinned: true` |
| Bear export | the folder of Markdown or TextBundle notes | `#tags`, `#nested/tags`, `#multi word tags#`, `::highlights::` |
| Apple Notes export, Samsung Notes | a folder of `.md`, `.txt` or `.html` notes | pictures next to the notes come along |
| Notion, OneNote | a token | read through their official services |
| Apple Notes, Bear (Mac) | nothing | read from the apps on this Mac |

- Each note becomes `<folder>/<notebook>/<title>.md` with properties on top: `tags`, `created`, `modified`, `source`, and `aliases` when the title has characters a file name cannot hold. The file's date is the note's last change.
- Pictures and files go in `<folder>/attachments/` (the same file is stored once) and are embedded with `![[name]]`.
- Locked and trashed notes are left out and listed with the reason.
- **Undo** (at the end, or later from **Import notes → Earlier imports**) removes exactly the files that import wrote, except notes changed since, and the folders it leaves empty. The list lives in `<userData>/notes/imports/<vault>/`.
- Large imports write in batches of 32 files; the vault watcher pauses while writing and the vault is read once at the end (5,000 notes take about two seconds on a laptop).
- Tokens typed for an import are used once and never stored.

**Export** (vault menu, or More for this note): a Markdown folder (optionally with plain Markdown links instead of [[links]]), the whole vault as a `.zip` (with its `.obsidian` settings), an Evernote `.enex`, or one note as a self-contained web page or a PDF.

Code: `core/notes/import-sources.ts` (the apps and their steps), `core/notes/importer.ts` (readers and the plan), `core/notes/exporter.ts`, `electron/services/notes-io.ts` (disk, dialogs, jobs, Undo), `src/notes/ImportExport.tsx`. Tests: `test/notes-import.test.ts` on made-up exports from `test/fixtures/notes-import/make.mjs`, and `test/e2e/notes-import.cjs`.

What still needs a real account or a Mac to check: Notion, OneNote and Joplin's running service are tested against recorded answers only; Apple Notes and Bear direct reading need a Mac.

## Code map

- `core/notes/*` holds pure logic with no Electron or DOM, tested in `test/notes.test.ts`:

  | File | What it does |
  | --- | --- |
  | `yaml.ts` | properties YAML reader and writer |
  | `parse.ts` | links, embeds, headings, blocks, tags, tasks, footnotes, callouts, word count, sections and blocks for embeds |
  | `vault.ts` | the index: link resolution, backlinks, unresolved links, unlinked mentions, tags, rename edits, graph, link suggestions |
  | `search.ts` | the search operators, plus ranking for the AI |
  | `templates.ts` | date tokens, templates, periodic note paths |
  | `config.ts` | reading `.obsidian/*.json`, attachment and new-note rules, bookmarks |
  | `canvas.ts` | JSON Canvas read, validate, write and edit |
  | `bases.ts` | `.base` parser, expression language and view engine |
  | `render.ts` | Markdown to HTML for the reading view, publishing and slides |
  | `publish.ts` | static site, merge and extract |
  | `plugins.ts` | the plugin manifest and permission model |

- `electron/services/notes.ts` reads and writes the disk, follows the vault while the page is open, and handles trash, renames with link updates, recovery snapshots, rendering (KaTeX on this side), AI and publishing.
- `electron/ipc/notes.ts` exposes the IPC and the `keeper/notes` MCP method. The API types are in `core/api-notes.ts`.
- `src/notes/*` is the page:
  - `NotesApp.tsx`: layout, tabs and panes, pickers, commands, settings;
  - `NoteView.tsx`: properties editor, editor and reading view;
  - `cm.ts`: CodeMirror 6, loaded on first use;
  - `Reading.tsx`: Mermaid, highlight.js and PDF embeds, loaded on first use;
  - `CanvasView.tsx`, `BaseView.tsx`, `VaultGraph.tsx` (reuses `core/graph/layout.ts`), `Panels.tsx`;
  - `plugin-host.ts`: the sandboxed plugin worker.
- `src/mock-notes.ts` provides the same features in the browser demo with a sample vault.
- `test/e2e/notes.cjs` drives the real app under xvfb.

## Feature parity

Status values:

- ✅ **Built and tested**: unit tests, the real-app e2e, or both.
- 🟡 **Built, partly tested or simpler**: see the note on that row.
- ❌ **Not built**.

### Files and vaults

| Feature | Status | Notes |
| --- | --- | --- |
| Open any folder as a vault, several vaults | ✅ | e2e opens a vault that has an `.obsidian` folder |
| File explorer, sort by name or by last change, folders | ✅ | virtualised list |
| Drag and drop to move (links updated); drop files in from the computer | 🟡 | built; not covered by e2e |
| Rename or move with automatic link updates (wiki and Markdown links, `#heading`, `#^block`, `\|alias`, embeds, relative links inside a moved note, folders, canvases) | ✅ | unit tests and e2e |
| Link format setting (`shortest` / `relative` / `absolute`), `alwaysUpdateLinks` | ✅ | |
| Attachment folder rules (`/`, `./`, `./sub`, a folder) | ✅ | |
| New note location (`root` / `current` / `folder`) | ✅ | |
| Trash setting (`system` / `local .trash` / `none`) | ✅ | e2e uses `local` |
| Ignored files (`userIgnoreFilters`), hidden files | ✅ | |
| Changes made by other apps show up while the page is open | ✅ | e2e |
| Bookmarks (`bookmarks.json`: files, headings, blocks, searches, groups, URLs) | 🟡 | read, add and remove; reordering and groups are not editable in Keeper yet |

### Editor

| Feature | Status | Notes |
| --- | --- | --- |
| CodeMirror 6 editor, loaded on first use | ✅ | |
| Live preview, source mode, reading view (Ctrl+E) | ✅ | live preview hides Markdown marks away from the cursor, draws checkboxes and bullets, and tucks away the properties block |
| Heading folding | ✅ | |
| Checklists (click in live preview or reading view, Ctrl+L / Ctrl+Enter) | ✅ | |
| Tables: insert, Tab / Shift-Tab to move and realign | 🟡 | no visual grid editor |
| Footnotes (`[^1]`, inline `^[…]`) | ✅ | |
| Callouts, with fold `+` / `-` | ✅ | |
| `==Highlights==` and `%%comments%%` | ✅ | |
| KaTeX math (inline and block) | ✅ | e2e |
| Mermaid diagrams | ✅ | e2e |
| Code highlighting (highlight.js) | ✅ | |
| Embeds: `![[note]]`, `![[note#heading]]`, `![[note#^block]]`, `![[image\|300]]`, `![[file.pdf#page=3]]`, audio, video | ✅ | rendered in the reading view; embeds can nest four deep |
| Block references `^id`, with link completion for blocks and headings | ✅ | |
| `[[` completion with aliases; `#` tag completion | ✅ | e2e |
| Unresolved links (dimmed; clicking one creates the note) | ✅ | |
| Hover previews (Ctrl/Cmd-hover in the reading view; hover in the editor) | ✅ | |
| Properties editor with types (text, list, number, checkbox, date, date and time, tags, aliases; `types.json`) | ✅ | |
| Nested tags | ✅ | |
| Slash commands | ✅ | |
| Common shortcuts (bold, italic, highlight, strikethrough, code, link, task, search and replace) | ✅ | |
| Vim mode | 🟡 | `@replit/codemirror-vim`, loaded on demand; not covered by e2e |
| Spellcheck | ✅ | the system spellchecker |
| Paste or drop pictures (into the attachment folder) | 🟡 | built; not covered by e2e |
| Live preview of embeds, math and tables inside the editor | ❌ | these are drawn in the reading view and in hover previews only |

### Navigation and search

| Feature | Status | Notes |
| --- | --- | --- |
| Backlinks, linked mentions | ✅ | e2e |
| Unlinked mentions, with one-click link | ✅ | |
| Outgoing links | ✅ | |
| Outline | ✅ | |
| Tags pane (nested, with counts) | ✅ | |
| Bookmarks and recent files | ✅ | |
| Quick switcher (Ctrl+O; recent files first; create on Shift+Enter) | ✅ | |
| Command palette for notes (Ctrl+P) | ✅ | |
| Search operators: `path:`, `file:`, `tag:`, `content:`, `line:( )`, `block:( )`, `section:( )`, `task:`, `task-todo:`, `task-done:`, `match-case:`, `ignore-case:`, `[prop]`, `[prop:value]`, `"phrase"`, `OR`, `-`, `( )`, `/regex/` | ✅ | unit tests and e2e |
| Random note | ✅ | |
| Tabs, split panes (two), saved workspaces | 🟡 | two panes side by side; no stacked or popped-out panes |
| Global and local graph (depth, missing notes, attachments, tag filter) | ✅ | reuses Keeper's force layout; no colour groups yet |

### Productivity

| Feature | Status | Notes |
| --- | --- | --- |
| Daily notes (folder, format, template from `daily-notes.json`) | ✅ | e2e |
| Weekly, monthly, quarterly and yearly notes (periodic-notes plugin `data.json`) | 🟡 | commands exist for week and month; quarter and year are in the core only |
| Templates (`{{title}}`, `{{date}}`, `{{time}}`, `{{date:FORMAT}}`, `{{yesterday}}`, `{{tomorrow}}`, `{{date+1d:…}}`) | ✅ | |
| Note composer: merge notes, extract selection (link, embed or nothing) | ✅ | |
| Slides (split on `---`) | ✅ | |
| Canvas: text, file, link and group cards; arrows; colours; move and resize; JSON Canvas round trip that keeps unknown fields | ✅ | e2e checks the saved file |
| Bases: `.base` filters (`and` / `or` / `not`), formulas, property display names, views (table, cards), `order`, `sort`, `groupBy`, `limit`, ```` ```base ```` blocks inside notes | ✅ | e2e; the expression language covers the common functions (see `core/notes/bases.ts`) |
| Bases: editing cells, map and list views, summaries | ❌ | |
| Word and character count | ✅ | |
| File recovery snapshots (interval and how long to keep are settable) | ✅ | |
| Audio recorder (into the attachment folder, embedded in the note) | 🟡 | built; not covered by e2e (needs a microphone) |
| Publish chosen notes as a static HTML site (no scripts; links between published notes kept) | ✅ | unit test |

### Keeper-only extras

| Feature | Status | Notes |
| --- | --- | --- |
| Ask the vault (cites notes), summarize, continue writing, suggest links, suggest tags | ✅ | opt-in; e2e with a stand-in AI. Uses the brain's meaning search when the vault is one of the brain's folders, otherwise words |
| Agents editing notes with permission and history | 🟡 | `keeper/notes {cmd:"write"}` is refused unless allowed; the previous version is kept with the agent's name. Not covered by e2e |
| Keeper Sync | 🟡 | a vault is an ordinary folder, so a synced folder works; there is no Notes-specific sync screen |
| Mail and calendar links | ❌ | |
| Island quick capture to today's note | 🟡 | `notes.capture()` and `keeper/notes {cmd:"capture"}` exist; no Island button yet |
| Encrypted notes via locked folders | 🟡 | a vault inside a locked folder opens while it is unlocked; a missing folder is reported. There is no lock button on the Notes page |

### Plugins

| Feature | Status | Notes |
| --- | --- | --- |
| Keeper plugin model: manifest, permissions (`read`, `write`, `commands`, `ui`), sandboxed worker | 🟡 | unit-tested permission checks. The worker has no Node, DOM or network access. Plugins are installed by hand into `<userData>/notes/plugins/` |
| Community plugins written for other notes apps | ❌ by design | listed under Notes → Settings, never run. They are Node and Electron code with full access to the computer and to the app's internals. Running them would let any plugin read every file, reach the network and act as Keeper. |

## Performance

- The main process indexes a vault the first time it is opened in a session. After that, only changed files are read again: the comparison uses modification time and size.
- In the unit test on this machine, a vault of 10,000 notes with about 30,000 links and 10,000 tags:
  - indexes in about 0.6 s;
  - answers a `tag:` + phrase search in under 0.1 s;
  - computes backlinks and rename edits in about 15 ms.
- Lists are virtualised.
- CodeMirror, vim, Mermaid and highlight.js load only when first needed. KaTeX runs in the main process.
- While the Notes page is closed, nothing runs. When the page closes, the vault watcher stops after a minute. The index is kept in memory until Keeper quits.
- The vault index is separate from Keeper's brain. Meaning search for the AI comes from the brain when the vault is one of its folders.

## Testing

- Unit tests: `npx vitest run test/notes.test.ts`. They cover parsing, YAML, link resolution, rename correctness, search operators, templates and dates, periodic notes, vault settings, the canvas round trip, the bases engine, rendering, publishing, the composer, plugins and the 10,000-note benchmark.
- End to end: run this command after `npm run build` (on Linux, under xvfb):

  ```bash
  xvfb-run -a node test/e2e/notes.cjs /tmp/kn /tmp/kn-shots
  ```

  The test drives the real app:
  1. Opens a vault that has an `.obsidian` folder.
  2. Creates a note with a `[[link]]` and checks the backlink.
  3. Renames a note and checks that links follow.
  4. Creates today's daily note from the template.
  5. Creates a canvas card and validates the saved `.canvas` file.
  6. Checks a base view filter and two search operators.
  7. Asks a stand-in AI and checks that the answer cites the note.
  8. Checks that KaTeX and Mermaid render.
  9. Takes screenshots in light and dark.
