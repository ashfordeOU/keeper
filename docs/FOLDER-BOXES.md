# Folder boxes

Boxes on the desktop that show a folder's files, and a way to tidy a crowded
desktop into them that you can undo.

- Where: **Widgets** (Desktop section of the sidebar). *Folder box* appears under Add a widget, and **Tidy the desktop into boxes** sits at the top of the page.
- Feature (Settings → Features → Desktop): `folderBoxes`, **off** until you turn it on. It needs Desktop widgets. While it is off no box is on the desktop and nothing reads any folder.
- Settings → General → Folder boxes links to the Widgets page.

## A box

| Part | What it does |
|---|---|
| Title bar | the box's name (its folder's name unless you give it one) and how many items it shows |
| Roll up (–) | folds the box to its title bar; the same button unrolls it to its height before |
| Icons | folders first, then files, each with an icon for its kind and its name cut in the middle so the type stays readable |
| Double-click or Enter | opens the file with its app; right-click shows it in its folder |
| Options (Edit on the Widgets page) | Folder, Name, Order (Name, Kind, Newest, Largest), Show (everything or one kind), New desktop files here, and every widget's own look, size and lock |

A box reads its folder when it opens, when it is clicked and every half minute,
and only folders that a box shows (and the desktop) can be read or opened from
a box. Hidden files (`.` names, `desktop.ini`, `Thumbs.db`) are left out.

## New desktop files here

Choosing a kind (Pictures, Documents…) adds an ordinary Automation: "Pictures on
the desktop go to the “Pictures” box", which moves new files of that kind from
the desktop into the box's folder. It is listed in Automations with the others
and can be changed or switched off there; choosing None removes it. Automations
must be on for it to run (the box says so with a link when they are off).

## Tidy my desktop into boxes

1. **Tidy my desktop…** looks first: how many files move, into which folders, and which folders are already there. Nothing has moved yet.
2. **Tidy into N boxes** moves each loose file into a folder for its kind inside the desktop (Pictures, Documents, Videos, Music, Archives, Installers, Apps and links, Code, Other), reusing a folder of that name, and adds a box for each folder that has none yet, in rows from the top left of the main screen.
3. Folders and hidden files stay where they are. A file whose name is already taken in its folder gets a number ("Plans 2.pdf"); nothing is ever replaced.
4. It is one step in **History**: Undo (in the note that follows, or in History) moves every file back and removes the folders it made, if they are empty again. Boxes stay on the desktop until you remove them.

## Works with your computer

| System | How boxes sit |
|---|---|
| macOS, Windows | on the desktop layer like the other widgets, under ordinary windows |
| Linux, X11 | a desktop-type window, under ordinary windows on most window managers |
| Linux, Wayland | Wayland has no desktop layer for other apps: boxes are ordinary windows and may sit over other apps. The Widgets page says so. |

Tidying works the same on all three: files are moved with the same safe move
Keeper uses everywhere (rename, or copy then delete across drives), and
recorded in History.

## What was checked, and how

- `core/folder-boxes.ts` (what a box shows and in which order, kinds and links, the tidy plan with names already taken and Windows paths, box positions, the Automation and finding it again) has unit tests in `test/folder-boxes.test.ts`.
- `test/e2e/desk.cjs` drives the real app on Linux: the part off and on, the plan before anything moves, a real tidy of a sample desktop into five folders with five boxes, one History step, a box window listing its files, rolling up and down, Undo putting every file back and removing the empty folders, a box's Automation, and the boxes leaving the desktop when the part is switched off.
- On macOS and Windows the boxes use the same widget windows as every other widget; how they sit on each system's desktop layer has not been checked by an automated test there.
