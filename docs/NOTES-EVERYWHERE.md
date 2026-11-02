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
| Standard Notes | Your account on its sync server (the official one or self-hosted), end-to-end encrypted on this computer | Two-way | Everywhere |
| Standard Notes backup | A backup file (decrypted, or encrypted and opened on this computer) | Import only | Everywhere |
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
- **Standard Notes** signs in to your sync server (the official
  `api.standardnotes.com` or your own) the way its own apps do. Your password
  is turned into your keys on this computer (Argon2id, protocol 004); only the
  derived sign-in half is sent, never the password. Every note is opened and
  sealed on this computer (XChaCha20-Poly1305): the server only ever sees
  encrypted items. Each note is checked to belong to the item it came with, so
  a server cannot swap one note's text into another.
  - Two-step sign-in: when asked, type the current code from your
    authenticator app in the connection's settings and sync; the code is used
    once and forgotten. Accounts that sign in with a security key cannot be
    used.
  - Keeper keeps the session (and the derived key, so Argon2 runs once per
    sign-in) in the system keychain. A changed password, email or server
    signs in afresh. Without a keychain (Linux without a keyring) the password
    cannot be stored, so the account cannot be connected.
  - Protected notes and notes in shared vaults are listed but not opened.
    Deleting moves a note to Standard Notes' trash. A note changed there while
    Keeper was sending it is refused by the server and merged on the next sync,
    never overwritten.
  - Backups (protocol 004) are still read as before with **Standard Notes
    backup**, opened on this computer with your password.
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

## In the Island

The Island's **Notes** tab lists the hub's notes under Keeper's own quick
notes, grouped by app (Apple Notes first on a Mac), searchable with the same
box. They open read only in the Island, with **Open in Notes** for Apple
Notes. The tab reads the notes folder when it opens and when the hub reports
a change; it does not sync on its own (the ↻ beside an app reads it again).
On a Mac without Apple Notes connected it offers **Allow**: macOS asks once
whether Keeper may control Notes (Privacy & Security → Automation), then you
see what would be copied before anything is.

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
- Standard Notes' sync (`connectors/standardnotes.ts`, `StandardNotesApi`):
  `POST /v2/login-params` with a PKCE challenge (and `mfa_code` when asked),
  `POST /v2/login` with the derived server password and the PKCE verifier,
  `POST /v1/items` (pages via `cursor_token`, `sync_token`, conflicts as
  `sync_conflict` with the server's item), `POST /v1/sessions/refresh` after a
  498. Argon2id comes from Node when its crypto has it; Electron's (BoringSSL)
  does not, so a pure JavaScript Argon2id (`@noble/hashes`, in small steps so
  the window keeps responding) is used.
- Tests: `test/notes-sync-*.test.ts`; end to end: `test/e2e/notes-hub.cjs`.

## Verified, and not verified

**Verified here:**
- Standard Notes' own published vectors: Argon2id with the 004 settings
  ("argon2 generated salt" and the libsodium vector), XChaCha20-Poly1305
  ("xchacha predefined string"), and a real items key from Standard Notes'
  test suite opened with its password (`test/notes-sync-standardnotes.test.ts`).
- The whole service against a local stand-in sync server answering from a
  recorded account (`test/fixtures/notes-sync/sn-standin.cjs`,
  `sn-account.json`, ciphertext only): PKCE, the two-step code (asked, wrong,
  right, then forgotten), pages, an expired session refreshed, a revoked one
  signed in again, the dry run and sync through the engine, write-back sealed
  on this computer and opened as another device would, tags, a conflict kept
  for review, a change refused by the server mid-send, delete to the trash,
  and every request body checked for plain text (none).
- In the real app (`test/e2e/notes-hub.cjs`): the two-way Standard Notes card
  and its form; Argon2id in Electron's own runtime (where Node's crypto has
  none) matching the published vector; sign-in, sync and write-back against
  the stand-in server from Electron's runtime.

**Not verified:**
- Against the real `api.standardnotes.com` or a real self-hosted server (no
  account here); the stand-in follows the API as Standard Notes' apps call it.
- Sign-in through the window under Xvfb: there is no keyring there, so the
  password cannot be stored and the sync was driven from Electron's runtime
  directly instead.
