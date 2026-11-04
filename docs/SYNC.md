# Sync & Backup

Keeper by Ashforde® keeps copies of your files in three ways. All three are in
**Sync & Backup** in the sidebar.

| | What it is for | Where the copy lives | Readable there? |
| --- | --- | --- | --- |
| **Synced folders** | The same folder on two or more of your devices | Your other Keeper devices, directly | Yes: ordinary files |
| **Backups** | Getting back yesterday's, last month's or last year's files | A drive, a NAS, a server or a cloud service | No: encrypted |
| **Cloud mirrors** | Seeing a folder in your cloud's own app or web page | A folder on a cloud service (or iCloud Drive, Dropbox… folders) | Yes: ordinary files |

Keeper's own settings and lists move and are backed up separately: see [Moving and backing up Keeper itself](KEEPER-BACKUP.md).

## Synced folders

- **Between your devices, nothing in between.** Devices talk over Keeper Link
  (end-to-end encrypted, on your network or across the internet). No cloud
  service holds a copy.
- **Two-way, send-only or receive-only.** A send-only device sends its changes
  and ignores others'; a receive-only device takes changes and keeps its own
  edits to itself.
- **Only what changed moves.** Files are cut into pieces by their content, so
  editing a big file sends only the pieces around the edit, and a renamed or
  moved file sends nothing at all (the pieces are already there).
- **Interrupted copies resume** where they stopped.
- **Nothing is lost:**
  - Every file Keeper replaces or deletes is moved to the folder's
    `.keeper-versions` folder first. Keep versions by the hour, then the day,
    then the week; for a number of days; or the last few.
  - When two devices change the same file before they can talk, both are kept:
    the other one is saved beside it as
    `Name (conflict, Device, 2026-10-31 14.05).ext`, and Sync & Backup offers
    "keep the first / the second / both".
  - A file changed on one device and deleted on another is kept.
  - Every piece is checked against its fingerprint, written to a temporary
    file and only then moved into place.
- **Leave things out** with a `.keeperignore` file in the folder (same rules as
  `.gitignore`) or in the folder's settings. Keeper's own files, half-written
  downloads and system clutter (`.DS_Store`, `Thumbs.db`…) are always left out.
- **Never into a locked folder.** If a folder inside is locked, sync waits.
- **Light on your computer.** It watches for changes instead of re-reading,
  looks again every few minutes as a safety net, pauses on battery (Options),
  and can be limited to a speed.
- **Sharing a folder:** add it on one device and choose the other devices; they
  see "*Device* wants to sync *Folder*" and choose where it goes.

## Backups

- **To anything:** an external drive, a NAS share, any folder (including
  iCloud Drive, Dropbox or OneDrive folders), or any of the cloud services and
  servers Keeper connects to (Google Drive, OneDrive, Dropbox, Box, Nextcloud,
  S3-compatible storage, SFTP, WebDAV and ~70 more through rclone).
- **Encrypted before it leaves.** Each piece is compressed and encrypted
  (AES-256-GCM) with a key that is itself locked by your password and by a
  recovery key shown once. File names, folders and sizes are encrypted too; the
  destination only ever sees `packs/…`, `index/…` and `snapshots/…` files.
  Without the password or the recovery key nobody, Keeper included, can open it.
- **Deduplicated.** A piece is stored once however many files or backups use
  it. A second backup of unchanged files uploads a few kilobytes; identical
  photos in two folders are stored once.
- **Kept smartly.** By default: the last 3 backups, one a day for a week, one a
  week for a month, one a month for a year, one a year for 3 years. Space that no
  remaining backup uses is freed.
- **Scheduled:** every hour, every day, once a day when the computer is idle, or
  when the backup drive is plugged in — or only when you press Back up now.
- **Restore** a whole backup, a folder or single files, to where they were or
  anywhere else. Existing files are never overwritten.
- **Checked.** "Check the backup" reads pieces back and verifies them; every 90
  days Keeper reminds you to test a restore. Damage or tampering is detected.
- **3-2-1 check.** The card at the top counts your copies: three copies, on two
  kinds of storage, one away from home.
- **Several computers can share one destination** (same password): each
  computer's backups are kept apart, and shared pieces are stored once.
- **Without the app:** on any computer with the keeper command,
  `keeper backup list|restore|verify --from <backup folder>` opens a backup on a
  drive or a synced cloud folder (password from the prompt or
  `KEEPER_BACKUP_PASSWORD`).

## Cloud mirrors

Plain files, 1:1, between a folder here and a folder on a cloud service, so they
also appear in the service's own app and web page. One way (copy there, or copy
here) or both ways. Keeper remembers what both sides looked like after each run,
so it can tell an edit from a deletion; a file changed on both sides is kept
twice. Files that only exist on the other side are left alone in one-way mode.
Runs every hour, as soon as something changes, or when you press Run now.

## Phones

Phones paired through Keeper Link's web companion can send their camera roll to
a folder you choose (Options → Photos and videos from phones), sorted by phone
and month, resumable, skipping files already there.

## Command line

```
keeper sync status|pause|resume
keeper backup list|run|restore [name] [--snapshot S] [--to DIR] [--include a,b]
keeper backup list|restore|verify --from <folder>
```

## What has been tested, and what has not

- **Tested:**
  - Unit tests:
    - content-defined chunking (an inserted byte only changes the pieces around it);
    - ignore rules, version vectors, conflict and version names;
    - version thinning;
    - sync between 2 and 3 devices over an in-memory network (create, edit,
      rename without moving bytes, delete to versions, conflicts, send/receive-only,
      locked folders, an interrupted copy resuming, offers);
    - encrypted backups (round trip, dedup, partial restore, wrong password,
      tampering, retention and freeing space, on memory and folder storage);
    - mirrors (one way and both ways, conflicts, deletions).
  - Real app (`test/e2e/sync.cjs`, Linux):
    - **Pairing and sync over Keeper Link:** two Keeper apps with separate home
      folders pair through their windows (code and six-digit check) and allow
      each other to sync. One shares a folder, the other accepts the offer, and
      the folder syncs over Link both ways: ignored files stay behind, an edit
      comes back, and replaced and deleted files are kept as older versions.
    - **Backup and restore:** the folder is backed up to a folder (nothing
      readable on it), restored from the app, and restored again with
      `keeper backup restore --from` without the app.
    - **Command line:** `keeper sync status` reads the running app, and a wrong
      password is refused.
  - Cloud backups: a backup round trip through the connection adapter with a
    stand-in connection.
- **Not tested yet:**
  - Backups and mirrors to real cloud accounts. They go through Keeper's
    connections and rclone, and need real accounts to try.
  - Sync between devices over the internet (relay or tunnel) rather than the
    same network.
  - The macOS and Windows file watchers and paths.
  - Phone uploads from the companion page. The receiving side is written
    (`phoneUploadBegin/Part/Finish` in `electron/services/sync`), but the page
    does not call it yet.
