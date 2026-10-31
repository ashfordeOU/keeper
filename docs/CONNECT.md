# Cloud & servers

Keeper connects to storage that is not on your computer: cloud services, servers, home servers, NAS boxes and other computers on your network. This page explains how it works, what stays private and what has been tested.

## Kinds of connection

| Kind | Used for | How Keeper talks to it |
|---|---|---|
| Cloud storage | Google Drive, OneDrive, Dropbox, Box, pCloud, MEGA, Proton Drive, iCloud Drive (beta), Google Photos, S3 and S3-compatible stores, Azure, Google Cloud Storage and about seventy more | [rclone](https://rclone.org) (MIT licence), bundled with Keeper |
| SFTP | Linux machines, Macs with Remote Login, most NAS boxes and home servers | built in (`ssh2`) |
| FTP / FTPS | older file servers and web hosts | built in (`basic-ftp`) |
| WebDAV | Nextcloud, ownCloud and other web file servers | built in |
| SMB | Windows and Mac file sharing, NAS boxes, home servers | mounted by your operating system, then browsed like a disk |

## Signing in and secrets

- **Cloud services** sign in through their own page in your browser (`rclone authorize`), so Keeper never sees the password. The few services that need a password or key typed in (MEGA, iCloud Drive, S3 access keys) keep it in rclone's settings file, obscured and encrypted. The token rclone gets back is stored in rclone's settings file inside Keeper's data folder; that file is encrypted with a random key kept in your system keychain (`rclone config encryption`).
- **Server passwords and key passphrases** go to the system keychain. On a computer without a keychain (for example Linux without GNOME Keyring or KWallet), Keeper keeps the password only until it quits and says so, rather than storing it weakly.
- **SFTP host keys** are remembered the first time and checked every time after. A changed key stops the connection with an explanation.
- **Self-signed certificates** (common on home servers) are accepted only for connections where you turned that on.
- The connections file holds names, addresses, user names and options — never passwords or tokens.

## Running rclone

rclone starts only when a cloud connection is used, answers only on `127.0.0.1` with a password made fresh each time, runs at lower priority, and stops after ten minutes without use (never in the middle of a transfer). Copies to and from cloud services go through rclone's own transfer engine, which resumes and chunks large files.

The release build downloads rclone for each platform with `scripts/fetch-rclone.mjs` (run by `scripts/prepare-arch.mjs`) and checks it against a pinned SHA-256 before shipping it in the app's resources. For development run `npm run fetch:rclone`, or set `KEEPER_RCLONE` to an rclone you already have; an rclone on your `PATH` is used as a last resort. Without rclone, every server kind still works; only cloud services ask for it.

## Files from a connection

- Thumbnails are made only for pictures, videos and PDFs that scroll into view, three at a time, and never for files over 40 MB.
- Opening a file fetches it into a cache in Keeper's data folder (2 GB, least recently used out first; open files are never removed). Saving it in its app sends the change back. If the file changed on the server since you opened it, your edit is uploaded as a separate copy named “… (edited <date>)”.
- *Keep Offline* copies a folder into `~/Keeper Offline/<connection>/…` and refreshes it when the computer is idle. Files are added and updated, never deleted locally.
- *Include in library search* lists a connection's names, sizes and dates (up to 100,000 items, gently paced) so library search finds them. It is off by default.

## Home servers, NAS boxes and other computers

*On this network* (in the Add a connection dialog, or *Save a Connection…* on the Network page) listens for mDNS announcements for SMB, AFP, SFTP/SSH, WebDAV, NFS, FTP and HTTP, plus the device-information records Macs publish. Keeper recognises home-server systems (umbrelOS, CasaOS/ZimaOS, StartOS, YunoHost, Home Assistant, Runtipi, Nextcloud boxes, Raspberry Pi), NAS boxes (Synology, QNAP, TrueNAS, Unraid, openmediavault, WD My Cloud, ASUSTOR, TerraMaster, ReadyNAS, UGREEN, Time Capsule), Macs, Windows PCs and Linux machines, and suggests the best way in.

For SMB, Keeper lists a machine's shared folders with the system's own tools (`smbutil` on macOS, `net view` on Windows, `smbclient` on Linux; passwords go through the environment, never the command line). External drives plugged into a home server or NAS are shared as folders of their own and are marked as such when their name or description says so. Hidden administrative shares (`C$`, `IPC$`) are never offered.

## What has been tested

- **Unit tests** (`test/remote.test.ts`): the provider list and the sign-in forms built from a fixture of rclone's provider descriptions (including S3 fields that depend on the chosen provider), paths that can never climb above a connection's top, the cache's clean-up order, WebDAV answers from Nextcloud- and Apache-style servers, quota, device recognition, the `smbclient`/`smbutil`/`net view` parsers, mDNS grouping, FTP listing dates, and the built-in SFTP, FTP and WebDAV clients against real servers started by the tests (listing, reading byte ranges, uploading, renaming, deleting, wrong passwords, a changed SFTP host key). The rclone client is tested against a stand-in rc server.
- **The real app on Linux** (`test/e2e/remote.cjs`, under xvfb): adding an SFTP server through the dialog (Test, then Add), browsing it, a picture's thumbnail and Quick Look, Download, Upload, New Folder, the password never written to disk, a Nextcloud-style WebDAV connection with its free space, the network tab finishing with nobody answering, and the cloud tab explaining that rclone is missing.

## Not yet tested

- **Cloud services end to end.** The rclone program could not be downloaded and run in the build environment, so signing in, listing and transfers through rclone, and the settings-file encryption step, have only been tested against a stand-in. Each OAuth provider also needs a real account to try.
- **SMB mounting** and share listing on real Macs, Windows PCs and NAS boxes; the share parsers are tested on sample output.
- **Discovery** of real home servers and NAS boxes (no other machines answer in the test environment).
- **Mounting cloud storage as a drive** (`rclone mount`) is not offered yet: it needs macFUSE, WinFsp or FUSE 3 on the computer. Connections are browsed inside Keeper instead.
