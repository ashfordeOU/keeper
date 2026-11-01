# Notes Everywhere

Notes Everywhere keeps one copy of all your notes, from every notes app you
use, in a folder you own. You can search them together, see where each note
lives, move notes between apps, and keep dated backups. Nothing leaves your
computer unless you connect an online service yourself.

Find it in the sidebar under **Sync & Backup → Notes Everywhere**.

## How it works

- **The hub.** Every note is copied into Keeper's notes folder (by default
  `Documents/Keeper Notes`, changeable) as a Markdown file with properties
  on top: `keeper-id`, `source`, `source-id`, the version and text hash from
  the last sync, `tags`, `created` and `modified`. Each app gets its own
  subfolder (`Apple Notes/…`, `Joplin/…`). Attachments are stored once, named
  by the hash of their bytes, under `attachments/`. The folder works as a
  normal Markdown vault, so you can point a notes editor at it.
- **Connections start read-only.** Keeper copies notes in. It only writes back
  to an app after you switch on **Write back** for that connection.
- **A dry run comes first.** Before the first sync of any connection you see
  what would happen ("Would add 412, update 3, conflicts 0"), and nothing is
  changed until you press **Looks right — sync**.
- **Merging, not overwriting.** Keeper remembers each note's text at the last
  sync. A change on one side is copied to the other. Changes on both sides to
  different lines are merged. Changes to the same lines are a **conflict**:
  both versions are kept (the app's text as a conflict copy) and you choose in
  **Review**, with the two texts side by side. Nothing is overwritten silently.
- **Deletes are careful.** A note deleted in an app goes to Keeper's **notes
  trash** (restorable). A note you delete in Keeper is only deleted in an app
  after you tick "Yes, delete" for it in a dry run.
- **Duplicates.** Notes that look the same in two apps are found (by title and
  text, ignoring formatting) and you can link them into one note, merge their
  text, or say they are different.
- **Locked notes stay locked.** Locked or encrypted notes are listed so you
  know they exist, but their text is never copied.

## What each connection can do

| App | How Keeper reaches it | Ability | Works on |
| --- | --- | --- | --- |
| Markdown or text folder | Reads and writes `.md` and `.txt` files | Two-way | Everywhere |
| Joplin | Its Web Clipper service on `localhost:41184`, with your token | Two-way | Everywhere |
| Joplin sync folder | Reads a file-system/WebDAV sync folder or a `.jex` export | Import only | Everywhere |
| Standard Notes | A backup file (decrypted, or encrypted and opened on this computer) | Import only (for now) | Everywhere |
| Notesnook | Markdown/HTML exports or an unencrypted backup | Import only | Everywhere |
| OneNote | Microsoft Graph, with an access token you give | Two-way | Everywhere |
| Notion | The official API, with an integration token | Two-way | Everywhere |
| Simplenote | Its sync service, with your sign-in | Two-way | Everywhere |
| Evernote | `.enex` exports in; `.enex` files out to import back | Import + limited write-back | Everywhere |
| Apple Notes | The Notes app's own scripting | Two-way | Mac only |
| Bear | Reads its database; writes through `bear://` links | Two-way | Mac only |
| Sticky Notes | Reads its database; writes only while it is closed | Import + limited write-back (off by default) | Windows only |
| Google Keep | A Google Takeout export | Import only | Everywhere |
| Samsung Notes | Notes exported as text, HTML or Markdown | Import only | Everywhere |
| Keeper quick notes | The notes you jot in the Island | Two-way | Everywhere |

### Honest limits

- **Apple Notes needs a Mac** for two-way sync. On an iPhone without a Mac,
  **Apps → iPhone only** shows the steps for a Shortcut that saves your notes
  as files into a folder Keeper then reads (one way). Formatting is converted
  to Markdown and may be simplified; drawings and scans are not copied.
- **Google Keep and Samsung Notes are import only.** There is no public way to
  write to them. Re-importing a newer export updates notes and never deletes.
- **Standard Notes:** signing in to the sync server (including a self-hosted
  one) is not built yet; use **Preferences → Backups → Download backup**.
  Encrypted backups (protocol 004) are opened on this computer with your
  password (Argon2id key derivation, XChaCha20-Poly1305); the password and
  keys never leave this computer; the password is stored only in the system
  keychain.
- **Notesnook:** there is no documented way to write notes back, so it is
  import only. Encrypted backups cannot be opened; export as Markdown instead.
- **Evernote:** writing back through Evernote's own service needs keys that
  are no longer handed out, so "copy to Evernote" saves an `.enex` file you
  import with **File → Import Notes**.
- **OneNote:** edits replace the first block of a page; ink and drawings are
  not copied. Pages are read only when they changed since the last sync.
- **Notion:** only pages shared with your integration are seen; databases,
  embeds and columns are simplified.
- **Bear:** writing opens Bear briefly; encrypted notes are skipped.
- **Sticky Notes:** Keeper writes only while the app is closed, and only after
  you turn on write-back.

## Moving notes between apps

Open a note, then **Copy or move to another app**. Copy keeps the original;
Move copies first, then deletes the original after you confirm. **Apps → Move
everything from one app to another** copies all notes of one app into another
(nothing is deleted from the first).

## Your other devices and phones

- **Copy to my other devices** (Backups tab) adds the notes folder to Sync &
  Backup as a two-way synced folder with your paired devices. Keeper's own
  bookkeeping (`.keeper-notes/`) stays on each device.
- Phones: the web companion's secure channel answers `notes.search`,
  `notes.read`, `notes.save` and `notes.capture` (search, read, edit, jot a
  quick note). A notes screen in the companion page itself is not built yet.

## Backups and history

- **Snapshots** of the whole notes folder are taken before every sync and
  whenever you press **Snapshot now**. Unchanged notes are stored once; old
  snapshots are thinned out like Keeper's backups. **Restore** puts notes back
  as they were (after taking a snapshot of the current state).
- **Exports** to put notes back into an app: Markdown (`.zip`), Evernote
  (`.enex`), Joplin (`.jex`) and a Standard Notes backup (`.json`).
- **History** on each note shows what changed, when, and in which app.
- For an encrypted copy on a drive or a cloud service, add the notes folder to
  a backup in **Sync & Backup → Backups**.

## Light by default

**Settings → Features**:

- *Notes Everywhere* (on): the page and the hub. Nothing runs until you
  connect an app and press Sync.
- *Notes Everywhere: sync in the background* (off): each connection syncs on
  its own every so often (30 minutes by default), through Keeper's governor —
  slower while you are away, never while the screen is locked.

## For developers

- `core/notes-sync/` — pure logic: `engine.ts` (plans and three-way merge),
  `diff3.ts`, `hub.ts` (file format), `markdown.ts` (HTML/ENML ↔ Markdown),
  `crypto.ts` (XChaCha20-Poly1305), `archive.ts` (tar/zip), `backup.ts`
  (snapshots), and `connectors/*` (each app's format and API mapping; network
  connectors take a `fetch` function so tests use recorded answers).
- `electron/services/notes-sync/` — disk, network and scripts; the service.
- `core/api-notesync.ts` — the window's API (`window.keeper.notesync`).
- Tests: `test/notes-sync-*.test.ts`; end to end: `test/e2e/notes-hub.cjs`.
