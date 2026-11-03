# Photo editor

A light editor for any picture (feature `photoEditor`, on by default, costs nothing until a picture
opens). Open it from a picture's right-click menu (*Edit Photo…*), from Capture (*Edit* on a
screenshot or web page capture, and after capturing a web page), from Settings → Files & search, or
from the palette (*Photo Editor*, which offers *Open a picture* and recent captures).

## What it does

| Tab | Controls |
|---|---|
| **Adjust** | Light (exposure, about ±1.5 stops), Contrast, Colour (saturation; *Black and white*), Warmth (temperature); *Reset*. Double-click a slider to reset it. |
| **Crop** | Free, Square, 4:3, 3:2, 16:9 (a shape centres the largest crop); drag on the picture to choose what to keep; **Straighten** up to ±45°, cropping the empty corners away. |
| **Hide** | Drag over an area to **Blur**, **Pixelate** or **Cover** it (cover is the safest: nothing can be read back). Each area is listed and can be shown again. |
| **Export** | Longest side (as it is, 3840, 2048, 1600, 1080, 640), format (same, JPEG, PNG, WebP), **Remove the background**, and *Arrows, text and shapes…*, which opens the screenshot editor (Annotate) with the picture. |

The floating toolbar under the picture: Undo, Redo, Turn left, Turn right, Flip, and *Original*
(hold to compare). ⌘Z / Ctrl+Z undo, ⇧⌘Z redo, ⌘S save, ⇧⌘S save a copy.

## Non-destructive, with Revert

An edit is a small recipe (`PhotoRecipe` in `core/photo-edit.ts`) applied to the untouched original:

- **Save** writes the result over the picture, but first keeps the original once in
  `<userData>/photo-originals/` with the recipe beside it (`index.json`). Opening the picture
  again starts from that original with the same sliders, so edits never stack up.
- **Revert** puts the original back, byte for byte, and forgets the recipe.
- **Save a copy** writes `<name> (edited).<ext>` beside the original. A new format (or a HEIC
  original, which is written as JPEG) is always saved as a copy.
- If the picture is changed by something else after a save, Keeper treats the new file as the
  original (the kept copy is not used for it).

## How it renders

`electron/services/photo-edit.ts` runs the recipe with **sharp** through Convert's converter
(`getConverter()` in `electron/ipc/convert.ts`), which also opens HEIC and other formats the way
Convert does. Order: quarter turns and flip → straighten (rotate, then the largest upright rectangle
of the same shape, `straightenBox`) → crop → light and colour on the colour channels (`modulate`,
`linear`, `recomb`; a see-through channel is kept as it is) → hidden areas (sizes follow the
picture, so the preview matches the file) → background removal → size → format. Previews render the
same recipe on a copy at most 1,600 pixels on the long side.

**Background removal** reuses Convert's on-device cut-out: the U²-Net-p model (`u2netp.onnx`,
Apache-2.0), downloaded once from its published release and checked against a pinned SHA-256, run
with ONNX Runtime, which is a downloadable component (docs/COMPONENTS.md). Nothing is uploaded. The
result is a PNG with a see-through background.

## Where it may write

Only pictures in Keeper's library folders, Pictures, Downloads, Desktop and the screenshot folder;
anything else is refused ("Keeper edits pictures in your library's folders, Pictures and
Downloads"). Writes go to a temporary file first and are renamed into place.

## Platforms

sharp and ONNX Runtime work the same on macOS, Windows and Linux (ONNX Runtime has no build for
Intel Macs, so background removal is not offered there). HEIC opens through the system on macOS and
Windows (with the HEIF extension), and libheif elsewhere. Verified on Linux.

## Code

`core/photo-edit.ts` (tests: `test/photo-edit.test.ts`), `core/api-photo.ts`,
`electron/services/photo-edit.ts`, `electron/ipc/photo.ts`, `src/screens/PhotoEditor.tsx`,
`src/styles/photo.css`; end to end: `test/e2e/photo-editor.cjs`.
