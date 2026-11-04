# Photo editor

A full photo editor for any picture (feature `photoEditor`, on by default, costs nothing until a
picture opens). Open it from a picture's right-click menu in Files (*Edit Photo…*, on every type it
opens: camera RAW, HEIC, Photoshop, icons and drawings too), by dropping a picture on it, from its
start page (*Open a picture*, or one of the *Recent pictures*), from Capture (*Edit* on a screenshot
or web page capture), from Settings → Files & search, or from the palette (*Edit a Photo…* and
*Edit <recent picture>*).

## The screen

The picture sits in a calm canvas with one floating toolbar under it (Undo, Redo, Turn left, Turn
right, Flip, **Compare**). On the right, a tool rail with five tools (Adjust, Crop, Background,
Retouch, Add) and **More** (Hide, Canvas, History), and the inspector of the chosen tool. The page
head has one filled button, **Save**, plus *Save a copy…* and *Revert*. Sections that are rarely
needed (Detail, Effects, Colour mix, Tone curve, Perspective, Each side) are folded until opened, or
open by themselves when they already hold a change.

| Tool | What it does |
|---|---|
| **Adjust** | *Auto* (light, contrast, white balance and colour from the picture's own statistics), *White balance* (click something white or grey), **Looks** (eight of Keeper's own, plus *Save as a look…* for your own), **Light** (light, contrast, highlights, shadows, whites, blacks), **Colour** (warmth, tint, colour, vibrance), *Detail* (clarity, sharpen, less noise), *Effects* (vignette, grain), *Colour mix* (hue, saturation and lightness for reds, oranges, yellows, greens, aquas, blues, purples, magentas), *Tone curve* (dark, middle and light tones). Double-click a slider to reset it. |
| **Crop** | Free, Square, 4:5, 4:3, 3:2, 16:9 (drag on the picture to choose what to keep); **Straighten** up to ±45°, cropping the empty corners away; *Perspective* (up and down, side to side) so leaning buildings stand straight. |
| **Background** | **Remove the background** on this computer, *Quick* or *Best* (see below); **New background**: see-through, a colour, a gradient (two colours and a direction), the original background blurred, or any picture (filling the frame without stretching); **Shadow** under the subject; **Edge**: soften, shrink or grow, and a refine brush (*Keep* paints parts of the subject back, *Remove* takes leftovers away); **Before and after**. |
| **Retouch** | **Heal** (click a spot, a speck of dust or a small object: the best-matching patch nearby is blended in, its colour matched at the edge), **Clone** (Alt-click, or Option-click on a Mac, where to copy from, then click where to copy to), **Red eye**. Each spot is listed and can be undone on its own. |
| **Add** | Text (four fonts, bold, colour, size), shapes (box, oval, line, arrow; outline or filled), stickers (emoji), a watermark (a corner, the middle or all over, with strength), a frame (plain, double, print). Drag on the picture to move what you chose. *Arrows, pen and numbered steps…* opens Annotate with the picture. |
| **Hide** | Drag over an area to **Blur**, **Pixelate** or **Cover** it (cover is the safest: nothing can be read back). |
| **Canvas** | Width and height with the shape kept (the lock) or free, quick longest sides, and **More canvas** all round or on each side, in a colour or see-through. |
| **History** | Every change in a few words, oldest first ("Light +20", "Cropped", "Background: gradient, shadow"). Choosing a step goes back to it; nudging one slider with the arrow keys is one step, not twenty. |

**Compare** shows the picture before and after, side by side with a divider to drag (keyboard: the
arrow keys). *Before* is the same framing without the edits, so the two line up.

⌘Z / Ctrl+Z undo, ⇧⌘Z redo, ⌘S save, ⇧⌘S save a copy.

## Non-destructive, with Revert

An edit is a small recipe (`PhotoRecipe` in `core/photo-edit.ts`) applied to the untouched original;
nothing is ever baked in while you work.

- **Save** writes the result over the picture, but first keeps the original once in
  `<userData>/photo-originals/` with the recipe beside it (`index.json`). Opening the picture
  again starts from that original with the same sliders, the same looks, cut-out, background,
  retouched spots and added text, so edits never stack up.
- **Revert** puts the original back, byte for byte, and forgets the recipe.
- **Save a copy…** writes `<name> (edited).<ext>` beside the original. A new format (or an original
  this computer cannot write, such as HEIC off a Mac) is always saved as a copy.
- If the picture is changed by something else after a save, Keeper treats the new file as the
  original. A drive that rounds file times (memory cards, shared folders) is recognised by the
  saved file's SHA-256, so edits do not stack up there either.

## Opening any picture

`electron/services/photo-open.ts` opens a picture as upright 8-bit colour, and Convert uses the same
code, so the two always open the same pictures.

| Format | macOS | Windows | Linux |
|---|---|---|---|
| JPEG, PNG, WebP, AVIF, TIFF, GIF | sharp | sharp | sharp |
| GIF and WebP that move | every frame (edits apply to each) | same | same |
| HEIC, HEIF | the system (sips) | the system with the HEIF extension, else Keeper's own reader | Keeper's own reader (libheif in WebAssembly) |
| Camera RAW (CR2, CR3, NEF, ARW, RAF, ORF, RW2, DNG and more) | the system's RAW decoder (sips), full quality | the system (Raw Image Extension), else the preview | the full-size preview the camera saved inside the file |
| Photoshop (PSD, PSB) | the flattened picture saved in the file (layers merged) | same | same |
| BMP | Keeper's own reader (1 to 32 bits, run-length 8-bit) | same | same |
| ICO, ICNS | the largest picture inside | same | same |
| SVG | drawn about 2,400 pixels across | same | same |
| JPEG XL | Keeper's own reader | same | same |

When the editor shows a RAW file through its embedded preview, or a Photoshop file flattened, a
line under the title says so plainly ("Showing the full-size preview the camera saved inside this
RAW file, not the RAW data itself."). The orientation the camera recorded is applied either way.

## Saving in any format

*Save a copy…* chooses the format, its quality, the colours and the photo's details:

| Format | Notes |
|---|---|
| JPEG, PNG, WebP, AVIF, TIFF | quality where it applies; see-through kept in PNG, WebP, AVIF and TIFF |
| HEIC | on a Mac (through sips). Windows and Linux can open HEIC but have no HEIC writer; the choice is shown but greyed, with that reason |
| GIF | 256 colours; a moving picture stays moving (also as WebP) |
| BMP | 24-bit, or 32-bit with see-through (Keeper's own writer) |
| Icon (.ico) | every size from 16 to 256 in one file |
| PDF | one page the size of the picture |

- **Colours:** *Keep the picture's colour profile* (a wide-colour photo stays wide-colour) or
  *Standard colours (sRGB)*, for the web.
- **Details (date, camera, place):** *Keep them*, *Keep, without where it was taken* (the GPS block
  is blanked in the bytes, not just unlinked) or *Remove them all*. The turn is baked into the
  pixels, so the saved orientation is always upright. The details travel inside a PNG carrier, so
  sharp writes them to every format that can hold them.
- A see-through result saved as JPEG becomes PNG instead, so nothing turns black.
- **Convert many pictures…** picks pictures and opens Convert's *Convert to…* with them; the
  right-click *Convert to…* in Files does the same. There is one converter: Convert's.

## Removing and replacing the background

Both models run on this computer with ONNX Runtime (a downloadable component, docs/COMPONENTS.md);
nothing is uploaded. Each is downloaded once from its published release and checked against a
pinned SHA-256 before it is used (`core/cutout-models.ts`).

| Model | File | Size | Licence | Use |
|---|---|---|---|---|
| **Quick** | U²-Net (small), `u2netp.onnx` | 4.6 MB | Apache-2.0 | the default; downloaded on first use |
| **Best** | IS-Net general use (Dichotomous Image Segmentation), `isnet-general-use.onnx` | 179 MB | Apache-2.0 | downloaded when asked (*Download (179 MB)* in the Background tab, with progress); *Remove the download* frees the space |

*Best* is used when chosen and downloaded; otherwise *Quick* runs. Both are openly licensed for
any use, commercial included. On the demo vase picture the end-to-end test scores the outline
against the drawing's true shape: about 87% overlap for *Quick*, 90% for *Best*.

The model's mask is worked out once per picture (on the preview-sized copy, so slider changes do
not run the model again), then fitted to the picture's own edges with a guided filter, scaled to
the full size and turned and cropped with the picture. The refine brush, grow or shrink and soften
work on that mask. The new background goes behind the subject; the blurred background leaves the
subject out of the blur, so no halo appears; a picture fills the frame (cut to fit, never
stretched); the shadow is the subject's own outline, moved down a little and softened.

Convert's own *Remove background* uses the same mask (and the *Best* model when it is downloaded).

## How it renders

`electron/services/photo-edit.ts` runs the recipe with **sharp** and Keeper's own pixel code
(`core/photo-pixels.ts`), in this order: the cut-out's mask → quarter turns and flip → perspective
→ straighten → crop → light and colour (`modulate`, `linear`, `recomb`), tones, vibrance and colour
mix (one pass with a 256-value table), clarity, less noise, sharpen, vignette, grain → retouched
spots → hidden areas → the cut-out's edge and the new background with its shadow → size → more
canvas → what was added on top → format. Sizes follow the picture, so the 1,600-pixel preview
matches the saved file.

What is added on top is drawn by one function (`core/photo-overlay.ts`): live over the preview in
the window, and at full size in a hidden window when saving, so system fonts and colour emoji look
the same on screen and in the file.

## Where it may write

Only pictures in Keeper's library folders, Pictures, Downloads, Desktop and the screenshot folder;
anything else is refused ("Keeper edits pictures in your library's folders, Pictures and
Downloads"). Writes go to a temporary file first and are renamed into place. Own looks are kept in
`<userData>/photo-looks.json`, recent pictures in `<userData>/photo-recent.json`.

## Platforms

sharp, Keeper's pixel code and ONNX Runtime work the same on macOS, Windows and Linux (ONNX Runtime
has no build for Intel Macs, so background removal is not offered there). Verified on Linux:
every format in the tables, a real HEIC photo (through the built-in reader), a 24-megapixel JPEG
(saved with seven adjustments in about 8 seconds, previewed in about 0.2 seconds).

Needs a real Mac or Windows PC to verify: HEIC and RAW through sips, saving HEIC through sips,
RAW and HEIC through the Windows codecs (with and without the HEIF and Raw Image extensions), and
that colour emoji in stickers match the system's emoji font.

## Code

`core/photo-edit.ts`, `core/photo-pixels.ts`, `core/photo-formats.ts`, `core/photo-presets.ts`,
`core/photo-overlay.ts`, `core/cutout-models.ts`, `core/api-photo.ts`;
`electron/services/photo-edit.ts`, `electron/services/photo-open.ts`,
`electron/services/heif-decode.ts`, `electron/ipc/photo.ts`; `src/screens/PhotoEditor.tsx`,
`src/screens/photo/`, `src/styles/photo.css`. Tests: `test/photo-edit.test.ts`,
`test/photo-pixels.test.ts`, `test/photo-formats.test.ts`; end to end: `test/e2e/photo-editor.cjs`
(the screen) and `test/e2e/photo-formats.cjs` (every format and the background, checked pixel by
pixel), with demo pictures from `test/e2e/photo-samples.cjs`.
