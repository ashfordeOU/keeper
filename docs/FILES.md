# Files: the sidebar, Home and "By type"

One obvious place for your files. The sidebar lists **real places only**,
laid out like the system's own file manager. **Types** (Documents, Pictures,
Videos…) are **chips on the file list**, in any folder or Everywhere. **Home**
is the front door.

Code: `core/sidebar-places.ts` (the sidebar's places per system),
`core/file-types.ts` (the chips, their queries and counts, the move of the old
routes), `src/components/PlacesSidebar.tsx`, `src/components/TypeChips.tsx`,
`src/screens/Library.tsx` (Everywhere), `src/screens/Browse.tsx` (a folder),
`src/screens/Home.tsx`. Tests: `test/sidebar-places.test.ts`,
`test/file-types.test.ts`, `test/home-layout.test.ts`, `test/e2e/filesnav.cjs`.

## The sidebar, per system

Keeper's **Home** is always first. The rest follows the system's file manager
in its order, with Keeper's look.

| | Under Home | Sections |
|---|---|---|
| **macOS** (Finder) | Recents, Shared (with iCloud Drive) | **Favorites**: Applications, Downloads, Movies, Music, Pictures, Desktop, Documents, Trash, then folders you pinned. **Locations**: iCloud Drive, other cloud drives from `~/Library/CloudStorage` (Proton Drive, Dropbox, Google Drive, OneDrive…), your home folder by its name, this Mac by its computer name (free space of the system disk), other disks, AirDrop, connected servers, Network. **Tags**: Finder's tags with Finder's colours. |
| **Windows** (File Explorer) | Gallery (every picture), OneDrive, other cloud drives | **Quick access**: Desktop, Downloads, Documents, Pictures, Music, Videos, then pinned folders. **This PC**: the computer, every drive with its free space, network drives, Network, Recycle Bin. |
| **Linux, GNOME** (Files) | Recent, Starred, Home Folder, Documents, Downloads, Music, Pictures, Videos, Trash, your GTK bookmarks (`~/.config/gtk-3.0/bookmarks`), pinned folders | **Other Locations**: cloud folders, the computer, drives, network mounts (GVfs included), Network. |
| **Linux, KDE** (Dolphin) | Recent Files | **Places**: Home Folder, Desktop, Documents, Downloads, Music, Pictures, Videos, Trash, your own places from `~/.local/share/user-places.xbel`, pinned folders. **Remote**: Network, cloud folders, network mounts. **Devices**: the computer and drives. |

KDE is chosen when `XDG_CURRENT_DESKTOP` or `DESKTOP_SESSION` names KDE or
Plasma; any other desktop gets the GNOME layout. Starred shows the files you
tagged "Starred".

Keeper's own cloud and server connections (Settings → Cloud & Servers) sit at
the end of Locations (Remote on KDE) with their status: ready, connecting,
connected, sign in again, can't reach it.

### Disks, servers and devices

- Disks and servers appear and disappear as they connect: Keeper watches
  `/Volumes` on a Mac, the drive letters on Windows and the mount table and
  GVfs mounts on Linux, and reads the list again only when they change.
- A disk's free space shows as quiet text when you point at its row (and in
  the tooltip). No bar sits under the name, so nothing looks like a spelling
  mark; a disk with less than a tenth free keeps a small amber dot in view
  (never red). Removable disks and servers have **Eject**; after it,
  Keeper says "It is safe to unplug."
- Home is always called **Home**, and the computer **This Computer** (This PC
  on Windows; on a Mac its own name, such as "Ana's MacBook Air", or This Mac).
  The real user or network name is in the tooltip.
- A folder's toolbar has one filled button (**New Folder**), the sort and view
  controls, and **More** (⋯) with Show Hidden Files, Tidy This Folder, Add to
  Sidebar and Show in Finder or the file manager. While hidden files are shown,
  a pill says so and hides them again.
- A server that drops without being ejected stays in the list, dimmed, marked
  **Offline**. A click connects again (Connect to Server opens with its
  address); right-click → **Forget** removes it. Keeper remembers up to eight
  servers, in this window's storage only.
- Paired phones and computers are in the **Devices** section (drop files on
  one to send them).
- Folders dropped on the folder lists are pinned there. Right-click a place
  for Open, Show in Finder / File Manager, Get Info, Eject or Remove from
  Sidebar.

## Types are chips, not places

Every file list has one bar over it:

- **Where to look**: this folder (and the folders in it) or **Everywhere**
  (every folder Keeper reads). The folder button on Everywhere goes back to
  the last folder you looked at.
- **By type**: All · Documents · Pictures · Videos · Music · Archives ·
  Installers · Apps · Screenshots · From the web, each with its count. Types
  with nothing in them are left out. Click a chip to show only that type;
  click it again for everything. ← and → move along the chips.
- **From the web** is every file a browser or app recorded a source for (it
  replaces Download Sources). Everywhere, the sites and apps they came from
  show as smaller chips under it.

In a folder, a type lists the matching files in that folder and the folders
inside it, grouped by folder (Group by folder turns that off), sorted like the
folder. A folder Keeper does not read is filtered from what is in it.
Everything the old Library views did still works: sorting, Group by folder,
the views (icons, list, gallery; each type remembers its own), the folder and
source columns, and Copy text for Screenshots.

The old pages land on Everywhere + a chip, so old links, tabs, the command
palette and `keeper://` links still work:

| Old | Now |
|---|---|
| All Documents (`library:document`) and the other "All …" pages | Everywhere + that chip |
| All Screenshots (`screenshots`) | Everywhere + Screenshots |
| Download Sources (`downloads`, ⌘⇧J / Ctrl+Shift+J) | Everywhere + From the web |
| A download source (`source:<id>`) | Everywhere + From the web + that source |
| Browse | Home Folder (palette), or a folder in the sidebar |

A type in a folder is the folder's route with the chip as its `q`
(`{ name: 'browse', arg: '/Users/ana/Downloads', q: 'image' }`).

## Home, the front door

1. **Your folders**: Desktop, Documents and Downloads as big tiles, with how
   many files are in each and how much space they take.
2. A suggestion line, only when something is worth doing.
3. **Jump back in**: recent files under the folder or project they belong to.
4. **Find a file**: a search box (typing carries on in the top bar's search)
   with the types under it ("Or by type"), each opening Everywhere + that chip.
5. Today, on the right on a wide window.

Edit Home still shows, hides and orders every section; **By type** (the
old Library tiles) is there, off by default. Settings from before are moved
on once: Your folders goes first, Find a file after Jump back in, the type
tiles step back; everything else stays as you left it.

## Tabs and Side by Side

**Tabs.** Every Keeper window has tabs (Settings → General → Open pages in
tabs). In Files, ⌘T / Ctrl+T opens the folder you are in again in a new tab,
right-click a folder → **Open in New Tab** opens that one (in Files and on a
connection). Tabs keep their folder, Back and Forward and come back after a
restart.

**Side by Side** (Settings → Features → Files, on in the Pro mode; it costs
nothing until the page is open) shows two folders next to each other. Each
side picks its place on its own: Home and its folders, folders you pinned, or
any Cloud & Servers connection (shared folders that the system mounts are
already folders here).

- Open it from a folder's **More** (⋯) → Side by Side (this folder on the
  left, the one above it on the right), right-click a folder → **Open Side by
  Side**, right-click a folder on a connection (Home on the left, the
  connection on the right), or the palette. Both sides live in the page's
  route (`{ name: 'panes', arg: <left>, q: <right> }`, a connection as
  `@<id>:<path>`), so a tab keeps them.
- **Files**: the side you last clicked has an accent border. Choose with a
  click, ⌘/Ctrl-click, Shift-click, the arrow keys and Space; Enter opens a
  folder, Backspace goes up, ⌘⌥← / → (Ctrl+Alt+← / → elsewhere) switches
  sides. **Copy →** (F5) and **Move** (F6) send what is chosen to the other
  side. Two folders on this computer use the usual copy and move, with Replace,
  Keep Both or Skip and Undo. With a connection on either side, a name already
  there is kept beside it with a number, a folder already there is filled in,
  and a move removes the original only after its copy is done (to the Trash
  here, to the service's own trash where it has one).
- **Differences** lists only what is not the same: only on the left, only on
  the right, newer on one side, or the same date with another size. A folder
  on one side only is one row. Folders inside are compared too (Settings →
  Files & search → Compare the folders inside too), up to 20,000 items a
  side; dates within two seconds count as the same. Untick a row to leave it
  out, pick **left → right**, **Both ways** (the newer copy wins) or **left ←
  right**, and **Sync…** shows what will happen before anything does.
- A sync never deletes. One way it copies what is missing or older on the
  other side and leaves newer ones alone; a file with the same date and
  another size is never replaced by guessing. A replaced file on this computer
  goes to the Trash first. Copies made here keep the original's date; for a
  connection, Keeper remembers what both sides looked like right after the
  sync, so the copy's new date on the server is not taken for a change.
- Progress shows in the Island (Syncing, Uploading, Downloading).

Code: `core/panes.ts` (sides, compare, plan, walking a side; tested in
`test/panes.test.ts`), `electron/services/panes.ts` (compare, copy and sync
through the same stores as Sync & Backup), `src/screens/Panes.tsx`.
End to end: `test/e2e/panes.cjs`.

## Settings → Sidebar

- **Find by type in the sidebar** (More settings): a folded "Find by type"
  section with the same types and counts. Off by default; nothing is counted
  while it is off.
- **Sections in the sidebar**: show, hide and order sections; sections only
  one system has (Favorites, Quick access, Remote) are listed only there.
- The old Library and Cloud & Servers sections are dropped from a saved order
  and hidden list. Pinned folders, places you removed, saved searches and tags
  are kept as they were.

## What needs a real Mac or Windows PC to check

Built and tested on Linux (unit tests with Mac, Windows and Linux fixtures;
the end-to-end run on GNOME's layout). To check on the real systems:

- **Mac**: Finder's order next to Keeper's; iCloud Drive and CloudStorage
  names; the computer name and the system disk's free space; AirDrop opening;
  ejecting a USB stick and an SMB server; a server dropping (Wi-Fi off) and
  showing Offline; Finder tag colours for tags with custom names (Keeper knows
  the standard colours by name: Red, Orange, Yellow, Green, Blue, Purple,
  Gray; other tags are grey).
- **Windows**: Gallery, OneDrive and other cloud drives at the top; drive
  letters and free space under This PC; mapped network drives with Eject;
  the Recycle Bin.
- **KDE**: Dolphin's places file being read.

Not done yet: per-file sync status for cloud drives (synced, syncing, error)
— the systems do not offer it to other apps in a simple way; Keeper's own
connections show their status. Finder's own sidebar list (`sfltool`) is
private to macOS, so Keeper follows Finder's default order plus what it can
read.
