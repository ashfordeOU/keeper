# PDF Reader

A calm place to read PDFs and mark them up: thumbnails, find, zoom and dark pages; highlight,
underline, notes, freehand drawing, text boxes and signatures; filling in forms; turning,
removing, reordering and adding pages. **Save** writes everything into the PDF itself, so any
PDF reader shows it. Everything happens on this computer.

- Page: **PDF Reader** in the sidebar's Notes section (feature `pdfReader`; off in Recommended,
  costs nothing while no PDF is open). In Files: right-click a PDF → **Open in PDF Reader**.
  Dropping a PDF on the page opens it.
- Settings → Files & search → PDF Reader: *Dark pages for reading* (also the moon button);
  under More settings, *Keep the version before saving* (on).
- Code: `core/pdf-annotate.ts` (writing the edits with pdf-lib; pure, unit-tested in
  `test/pdf-annotate.test.ts`), `electron/services/pdf-reader.ts` (reading, saving, the version
  before), `src/screens/PdfReader.tsx` (pdf.js for showing pages, text selection and form
  fields), `test/e2e/pdf-reader.cjs`. Only pdf.js (Apache-2.0) and pdf-lib (MIT), already in
  Keeper, are used.

## Reading

One floating capsule holds everything: **Pages** (the thumbnails panel, closed by default),
**Find** (Enter finds the pages with the words, Enter again goes to the next; words are marked
on the page), the tools, zoom (−, Fit, +), dark pages, **More** (⋯) and **Save**. Dark pages turn
the page light-on-dark on screen only; the file is not changed.

Keys: V Read, H Highlight, U Underline, N Note, D Draw, T Text, S Sign; + and − zoom;
Ctrl F find; Ctrl Z undo; Ctrl S save, Ctrl Shift S save a copy; Delete removes the chosen
mark; Esc goes back to Read. (⌘ on a Mac.)

## Marking up

| Tool | How | Saved as |
|---|---|---|
| Highlight, Underline | Select text; on a scan, drag a box | `Highlight` / `Underline` annotation with quad points, the selected words in its contents |
| Note | Click, write, Done | `Text` (sticky note) annotation |
| Draw | Draw with the mouse or a pen | `Ink` annotation |
| Text | Click, type | `FreeText` annotation (Helvetica; letters it cannot show become "?") |
| Sign | Draw or type a signature, then click where it goes | drawn onto the page as a picture (not kept by Keeper) |
| Form fields | Type into the PDF's own fields, tick its boxes, pick its options | the fields' values, with their appearances updated |

Every annotation carries its own appearance stream, so readers that do not draw annotations
themselves show it the same. Marks can be chosen in Read and removed (Remove, or Delete);
Undo steps back through every change, pages included. Five colours are offered.

## Pages

In the Pages panel: **Turn** and **Remove** on each page, drag to reorder, **Add** pages from
other PDFs (merging). Marks follow their page when it moves; removing a page removes its marks.
More (⋯) also turns or removes the page in view.

## Saving

**Save** writes into the same file: the PDF is written beside it first and then moved into
place, so a failed save never leaves half a file. Before that, with *Keep the version before
saving* on, the file as it was is copied into Keeper's data folder (`pdf-reader/previous`), and
More → **Restore the last version** puts it back. **Save a copy…** asks where. After saving, the
PDF opens again with the marks now drawn by the PDF itself.

## Per system

The reader is the same on macOS, Windows and Linux (it runs inside Keeper). Tested on Linux;
pen pressure is not used, and drawing with a pen or a touch screen needs checking on a real
Mac or Windows tablet. Encrypted PDFs that need a password to open are not opened yet (use
Convert → PDF → Passwords first). Editing the existing text in place is in Convert → PDF →
Edit text (docs/FILEKIT.md).
