# Archives

Look inside zip, 7z, RAR, tar (.gz, .xz, .zst, .bz2), ISO and CAB files without unpacking
them, take out only what you choose, and pack files into a ZIP or 7z with a password.
Everything happens on this computer.

- Page: **Archives** in the sidebar's Tidy section (feature `archives`, on; costs nothing until
  you open or pack an archive). Also from Files: right-click an archive → **Open in Archives**,
  or any selection → **Compress with a Password…**. Dropping an archive on the page opens it;
  dropping other files starts **Make an archive** with them.
- Settings → Files & search → Archives: *Take files out to* (a new folder beside the archive,
  default, or ask each time); under More settings, *Show the files afterwards*.
- Code: `core/archives.ts` (kinds, engines, browsing, commands, what works here; pure),
  `core/zipwrite.ts` (ZIP reading and writing, now with AES-256), `electron/services/archives.ts`,
  `src/screens/Archives.tsx`. Tests: `test/archives.test.ts`, `test/e2e/archives.cjs`.

## How it works

- **Looking inside** reads only the archive's list of contents. A ZIP's central directory and a
  tar's headers are read by Keeper itself; other kinds are listed by the system's tar or 7-Zip.
  Folders are walked one at a time with a breadcrumb; *Find in archive* searches every name.
- **Quick Look** on a file inside copies just that file into Keeper's preview folder, never next
  to the archive.
- **Taking out** goes to a new folder beside the archive named after it ("Photos.tar.gz" →
  "Photos", "Photos 2" when that exists; Downloads when the archive's folder can't be written).
  Choosing a folder takes everything under it. Names that would land outside the folder (`..`,
  absolute paths, drive letters) are never written and are counted as skipped.
- **Passwords:** an encrypted ZIP (classic or AES-256) is opened by Keeper itself; encrypted 7z
  and RAR need 7-Zip (libarchive cannot decrypt them). Archives whose names are hidden ask for
  the password before anything is shown. Keeper never stores a password.
- **Making:** ZIP is written by Keeper (up to 1 GB of files; bigger with 7-Zip), with a password
  as AES-256 (WinZip's AE-2 layout: PBKDF2-HMAC-SHA1 keys, AES-CTR, an HMAC-SHA1 check). These
  open in Keeper, 7-Zip, libarchive and most archive apps, but not in Finder's or Explorer's own
  zip opener. 7z is made by 7-Zip (with a password: AES-256 with the names hidden), or without a
  password by the system's tar. RAR is never made: it is a closed format; Keeper only opens it.

## Engines, in the order they are tried

| Kind | Opened by | Made by |
|---|---|---|
| ZIP, TAR, TAR.GZ, GZ | Keeper (files up to 1 GB in memory), then the system's tar or 7-Zip | ZIP: Keeper |
| 7z, RAR, TAR.XZ, TAR.ZST, TAR.BZ2, XZ, ZST, BZ2, ISO, CAB | libarchive's tar, then 7-Zip, then GNU tar (tar kinds), then unrar (RAR) | 7z: 7-Zip, or the system's tar without a password |
| Encrypted 7z and RAR | 7-Zip (unrar for RAR) | 7-Zip |

Keeper looks for `tar` (and on Linux `bsdtar`), 7-Zip as `7zz`, `7z` or `7za` (plus
`C:\Program Files\7-Zip\7z.exe` on Windows and Homebrew's folders on a Mac) and `unrar`, again
each minute, so installing 7-Zip is noticed without a restart. *What works here* on the page
lists, for this computer, how each kind opens and is made.

## Per system

| | macOS | Windows 10 and 11 | Linux |
|---|---|---|---|
| Look inside and take out ZIP, TAR, TAR.GZ (with ZIP passwords) | ✅ Keeper | ✅ Keeper | ✅ Keeper |
| 7z, RAR, TAR.XZ, TAR.ZST, TAR.BZ2, ISO, CAB | ✅ built-in `tar` (libarchive) | 🟡 built-in `tar.exe` (libarchive) reads ZIP and tar kinds; 7z and RAR depend on the Windows version's build, so install 7-Zip when *What works here* says so | 🟡 with `bsdtar` (package libarchive-tools) or 7-Zip; GNU tar alone opens only the tar kinds |
| Encrypted 7z and RAR | 7-Zip (`brew install sevenzip`) | 7-Zip | 7-Zip (`7zip` package) |
| Make ZIP with AES-256 | ✅ | ✅ | ✅ |
| Make 7z | ✅ without a password (`tar`); with a password needs 7-Zip | 7-Zip | 7-Zip, or `bsdtar` without a password |

Tested on Linux (Keeper's own ZIP and TAR, AES-256 ZIPs read back by libarchive, 7z and tar.xz
through bsdtar). Windows' `tar.exe` and macOS's `tar` need checking on real machines, as does
7-Zip itself (it was not run here).

## Not built

- A bundled 7-Zip as a downloadable component (`docs/COMPONENTS.md`): 7-Zip 25.01's release
  files can be pinned like rclone, but the Windows build that reads RAR comes only inside its
  installer, so it needs a packing step tested on each system first.
- Split volumes (`.001`, `.z01`) are opened when the system's tool reads them, but not made.
