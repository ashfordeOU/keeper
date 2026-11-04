<!-- SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0 -->
# Moving and backing up Keeper itself

Your files have [Sync & Backup](SYNC.md). This page is about Keeper's own settings and lists: your rules, snippets, cues, themes, Inbox, focus lists, automations, notes folders, mail accounts (without passwords), Studio presets and the rest. They live in Keeper's folder, and these tools carry them to a new computer or back in time.

All of it is in **Settings → General → Move or back up Keeper**.

## Back up to a file

**Back up…** asks for a password (8 characters or more, typed twice) and saves one `.keeperbackup` file. Open it on the new computer with **Restore…**, or from setup's first screen (**Moving from another computer? Restore a Keeper backup**).

- **Sealed**: everything after a short header is encrypted with AES-256-GCM, with a key made from your password (scrypt). The header says only which Keeper made it, when, and on which computer, so Restore can show it before asking for the password. Changing any byte, the header included, makes it refuse to open.
- **Without the password nobody can open it**, including Ashforde. Keeper cannot get a lost password back.
- **A newer Keeper's backup** is refused with "Update Keeper first".

## What it leaves out

| Left out | Why |
| --- | --- |
| Passwords, keys and tokens (`secrets.json`, the locked folders' key, cloud service passwords, the licence) | Enter them again, or they come back with the system's keychain where it syncs (iCloud Keychain on a Mac). |
| This computer's own pairing and identity (Keeper Link, Keeper Mesh, unattended access, the anonymous usage id) | A new computer pairs as itself. |
| The library's index, the AI's memory of your files, thumbnails, downloaded parts and models | Rebuilt on the new computer by itself. |
| The system's own storage inside Keeper's folder (caches, cookies, the key Chromium seals its data with) | It only works on this computer. |
| One file over 25 MB | Downloaded or rebuilt again. |

**What a copy leaves out** at the foot of the panel lists the same, for this computer.

## Send to another computer

With [Keeper Link](LINK.md) on and a computer paired, **Send to another computer** seals a backup with your password and sends it over your own end-to-end encrypted link. Accept it there, then **Restore…** with the same password.

## A copy each night

**A copy each night** (off until you turn it on; it is the part *A copy of Keeper each night* in Settings → Features) keeps a copy of the same files in Keeper's folder once a day, the last 14. **Put Keeper back to** lists them as Today, Yesterday, Tuesday… and **Restore** puts one back.

While it is on, Keeper looks two minutes after it starts and then every six hours whether today's copy is made. Off, nothing runs.

## How a restore happens

1. The backup is opened and checked, and its files are placed in Keeper's folder under `restore-pending`.
2. Keeper restarts. Before anything reads its files, each one the restore replaces is kept as a copy named `before-restore-…` (it appears in **Put Keeper back to**, so a restore can be undone the same way), and the restored files go in place.
3. Passwords and pairing are entered again where needed.

## For developers

- What a copy holds (`leftOutWhy`, `backupPlan`), the file format (`packBackup`, `unpackBackup`, `backupMeta`, format version 1), names and keeping 14 copies: `core/keeper-backup.ts`. Tests: `test/keeper-backup.test.ts` (including a wrong password, a changed byte, a newer format and paths outside Keeper's folder).
- Reading Keeper's folder, the nightly timer, staging and putting a restore in place at start (`applyPendingRestore`, first thing in `app.whenReady`): `electron/services/keeper-backup.ts`. IPC `keeperBackup.*`.
- The panel and the restore sheet (also in setup): `src/components/KeeperBackup.tsx`.
- End to end: `test/e2e/reach.cjs backup` backs up, empties the Inbox, restores, restarts and finds it back, and checks setup's link. `KEEPER_TEST_NO_RELAUNCH=1` lets the test start Keeper again itself.
