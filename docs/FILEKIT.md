# File kit: PDF tools and "Convert to…"

Keeper's Convert page (and `keeper tool` / `keeper convert` on the command line) holds every
file tool: the PDF toolkit, a universal "Convert to…" for every file family, and saved
**workflows** that chain tools together. Everything runs on this computer. Results always go
to a new folder; originals are never changed.

This page is the audit: every PDF tool and every file-format family, and what Keeper does
with each today.

**Status words.** **Built** = works, covered by tests. **Better** = works and does more than
the usual version of the tool. **Engine** = works when that free program is installed (Keeper
finds it and says what to install when it is missing). **Partial** = works with the limits
given. **Missing** = not built yet.

Code: `core/filekit/` (pure, tested: `pdfkit.ts`, `textlayout.ts`, `data.ts`, `formats.ts`,
`dxf.ts`, `binfmt.ts`, `matrix.ts`, `tools.ts`, `workflow.ts`), `electron/services/filekit*.ts`
(the service, "Convert to…" router, certificate signing), `electron/services/workflows.ts`,
`src/screens/KitOptions.tsx`, `src/screens/WorkflowsPanel.tsx`, `src/preview/viewers/cad.tsx`.
Tests: `test/filekit.test.ts` (167 tests), `test/e2e/filekit.cjs` (the real app under xvfb).

## PDF toolkit

### Organize and arrange

| Tool | Keeper | Status |
|---|---|---|
| Merge | PDF → Merge | Built |
| Split (every page, by ranges) | PDF → Split | Built |
| Divide (every N pages, into N parts, before chosen pages) | PDF → Divide | Built |
| Extract / delete / reorder pages | PDF → Extract, Delete, Reorder | Built |
| Visual page organizer (drag, turn, remove, add from other PDFs) | PDF → Organize pages | Built |
| Reverse | PDF → Reverse pages | Built |
| Alternate / mix several PDFs | PDF → Mix or collate | Built |
| Duplex collate (fronts + backs scanned last-first) | PDF → Mix or collate, "second file is reversed" | Built |
| Remove blank pages | PDF → Remove blank pages | Better: truly empty pages by their drawing commands, scans by how much ink they have (tolerance option) |
| Rotate 90/180/270 | PDF → Rotate pages | Built |
| Rotate by any angle | PDF → Rotate by any angle (page grows, nothing cut) | Built |
| N-up (2, 4, 6, 8, 9, 16 per sheet) | PDF → Pages per sheet | Built |
| Booklet (saddle stitch) | PDF → Booklet | Built |
| Single continuous page | PDF → One long page | Built |
| Poster (tile onto sheets with overlap) | PDF → Poster | Built |
| Crop margins (automatic or by amounts) | PDF → Crop margins | Built (automatic needs the page renderer: the app, or poppler on the command line) |
| Fix page size (scale everything to A4/Letter/…) | PDF → Fix page size | Built |
| Page dimensions | PDF → Page sizes | Built |
| Overlay / underlay another PDF | PDF → Overlay or underlay | Built |
| Compare two PDFs (text and visual) | PDF → Compare | Better: word-level report, both PDFs marked (removed in red, added in green), and a picture of each page that looks different |
| Multi-tool (several tools in a row) | Workflows | Built (see below) |

### Edit and mark up

| Tool | Keeper | Status |
|---|---|---|
| Page numbers | PDF → Number pages | Built |
| Header and footer with {page} {pages} {date} {file} | PDF → Header and footer | Built |
| Bates numbering across documents | PDF → Bates numbers | Built (continues across files, reports ranges and the next number) |
| Text watermark | PDF → Add a watermark; Watermark (more options): angle, size, colour, tiled, chosen pages | Built |
| Image watermark / logo | PDF → Picture watermark or logo | Built |
| Stamps (Approved, Paid, Draft…, custom, dated) | PDF → Stamp | Built |
| Annotate / draw / sign by hand | PDF Reader (highlight, underline, notes, ink, text boxes, signatures, forms, saved as standard annotations; docs/PDF-READER.md); PDF → Sign (drawn or typed), Fill in a form (type anywhere) | Better |
| Edit text | PDF → Edit text | Partial: finds the words and sets new ones in their place, sized to fit; the old words are covered, not reflowed (run Redact to remove them for good). Paragraph reflow is missing |
| Redact (true removal) | PDF → Redact | Built (pages with matches are rebuilt) |
| Remove annotations | PDF → Remove comments (keep links / forms optional) | Built |
| Invert colours, greyscale, black and white, contrast, sepia | PDF → Colours and scanner look | Built (pages are redrawn as pictures) |
| Scanner effect | PDF → Colours and scanner look → Looks scanned | Built |
| Change text colour / background colour only | — | Missing (whole-page recolouring is built) |

### Structure

| Tool | Keeper | Status |
|---|---|---|
| Bookmarks: read, write, make from headings | PDF → Edit bookmarks | Built |
| Table of contents page | PDF → Contents page (clickable, from bookmarks or headings) | Built |
| Page labels (i, ii, iii, 1, 2…) | PDF → Page labels | Built |
| Metadata view / edit / remove | PDF → Details (metadata) | Built |
| Attachments: take out / attach | PDF → Attachments | Built |
| Layers (optional content) | PDF → Layers: list, show/hide by default | Built |
| Create fillable forms | PDF → Make a fillable form: finds ____ lines and [ ] boxes, or from a field list (text, multi-line, tick box, list, choice, signature box) | Built |
| Fill forms | PDF → Fill in a form | Built |
| Flatten forms | PDF → Flatten forms | Built |
| XFA forms | Sanitize removes XFA scripts; filling XFA-only forms | Missing (XFA is deprecated; AcroForm fields work) |

### Security and signatures

| Tool | Keeper | Status |
|---|---|---|
| Add a password with permissions | PDF → Add a password (print / copy / edit limits) | Built |
| Remove a password | PDF → Remove a password | Built |
| Remove restrictions (owner password only) | PDF → Remove restrictions — asks you to confirm you own the document | Built (qpdf, or Keeper's own decryption when qpdf is missing) |
| Sanitize (JavaScript, actions, attachments, details, links, comments, layers, forms) | PDF → Sanitize | Built |
| X.509 digital signature (PAdES-style detached CMS, SHA-256) | PDF → Digital signature (certificate): .p12/.pfx (through OpenSSL) or PEM; or make a personal certificate on the spot | Built — verified independently with poppler's `pdfsig` ("Signature is Valid") |
| RFC 3161 trusted timestamp | Same tool, "Timestamp server"; only the fingerprint is sent | Built (not exercised in CI: needs the network) |
| Validate signatures | PDF → Check signatures: intact or broken, signer, time, timestamp, whether the document changed after signing | Built (tampering is detected in tests). Certificate chain trust is left to you |
| Several signatures on one PDF | — | Partial: Keeper refuses to sign an already-signed PDF rather than break the first signature (incremental updates are missing) |

### Optimize and repair

| Tool | Keeper | Status |
|---|---|---|
| Compress (built in: re-saves pictures) | PDF → Compress | Built |
| Compress with other engines | PDF → Compress (more engines): Ghostscript (/screen /ebook /printer /prepress), qpdf (lossless), then Keeper's picture squeeze; never makes a file larger | Engine |
| Linearize (fast web view) | PDF → Fast web view | Engine (qpdf) |
| Repair | PDF → Repair: qpdf, then Ghostscript, then Keeper's own rebuild | Built |
| PDF/A convert | PDF → PDF/A (archive): 1b/2b/3b with an sRGB output intent | Engine (Ghostscript) |
| PDF/A validate | Same tool → Check: the basic rules (claims PDF/A, output intent, no encryption, no JavaScript, no launches, XMP, fonts embedded) | Partial: not a full validator |
| Flatten to pictures (rasterize) | PDF → Flatten to pictures | Built |
| Fonts to outlines | PDF → Fonts to outlines | Engine (Ghostscript) |
| OCR (make searchable) | PDF → Make searchable | Built |
| Deskew scans | PDF → Straighten scans (finds the tilt, straightens, can OCR) | Built |

### PDF out

| Tool | Keeper | Status |
|---|---|---|
| PDF → PNG / JPEG | PDF → PDF to pictures; Convert to… | Built |
| PDF → SVG | PDF → PDF to SVG | Engine (poppler `pdftocairo`) |
| PDF → CBZ | PDF → PDF to comic book | Built |
| PDF → Word | PDF → PDF to Word | Built |
| PDF → text / Markdown / HTML / JSON | PDF → PDF to text (headings and lists kept in Markdown) | Built |
| Tables → CSV / XLSX / JSON / Markdown | PDF → Tables out of PDFs | Built (text PDFs; scans need Make searchable first) |
| Greyscale | PDF → Colours → Greyscale | Built |
| Extract images | PDF → Extract pictures (JPEGs saved byte for byte) | Partial: JPEG, JPEG 2000 and 8-bit Flate pictures; other encodings point you to PDF to pictures |
| Prepare for AI (chunked JSON) and into Keeper's brain | PDF → Prepare for AI: chunks by section and page with overlap, token estimate, JSON + Markdown; "Also add to Keeper's brain" | Built (the brain reads it when the output folder is in your library) |
| PDFs to ZIP | Any file → Compress to ZIP | Built |
| PDF → EPUB | Convert to… → EPUB | Engine (Pandoc) |

## Workflows

Convert → **Workflows**. Steps are drawn as a chain of nodes (Files → step → step → Results);
click a node to choose its tool and options, move it earlier or later, remove it, or add one.
Each step's results are the next step's files; tools that combine files (merge, mix, Bates,
ZIP, pictures to PDF) take them all at once. Saved workflows:

- run on the files at the top of the page, or **on a folder** (matching files inside, optional
  name pattern such as `*.pdf` or `*.{jpg,png}`);
- **watch a folder**: new files run through the workflow once they stop growing;
- run **on a schedule** (`daily 08:30`, `weekdays 18:00`, `weekly mon 09:00`, `hourly`,
  `every 30m`), waiting for the governor's go-ahead so it never competes with what you are doing.

Cost when idle: nothing unless a workflow watches a folder (one watcher each) or has a
schedule (one timer for the soonest run). The **Workflows** feature switch turns both off.
Linear chains only: branching graphs are missing.

## Every file family

"Convert to…" is in every file's right-click menu, on the Convert page (drop files, the
formats they can become appear as buttons), in the command palette, and on the command line:
`keeper convert <files> --to <format>` (without `--to` it lists what the file can become).
The table lives in `core/filekit/matrix.ts`: **1,168 routes from 153 extensions, 1,003 of
them with nothing to install.**

| Family | Formats in | Becomes | Preview | Status |
|---|---|---|---|---|
| Pictures | JPEG, PNG, WebP, AVIF, TIFF, GIF, BMP, HEIC/HEIF, PSD, JXL, TGA, camera RAW (DNG, CR2, CR3, NEF, ARW, ORF, RW2, RAF, PEF, SRW) | JPEG, PNG, WebP, AVIF, TIFF, GIF, ICO, ICNS, PDF, SVG (picture inside), HEIC (on a Mac) | Built | Built (RAW uses the camera's full-size preview; PSD needs "maximize compatibility") |
| Icons | ICO, ICNS | every picture format, and each other | Built | Built (Keeper writes multi-size .ico and .icns itself) |
| Vector | SVG, AI (PDF-compatible), EPS | SVG → PNG/JPEG/WebP/ICO/ICNS and PDF (kept as vectors in the app); AI → PDF/PNG/SVG; EPS → PDF/PNG/SVG | Built | Built; EPS is Engine (Ghostscript). Raster → true vector tracing is missing |
| PDF | PDF | see above | Built | Built |
| Documents | DOCX, DOC, ODT, RTF, HTML, Markdown, TXT, RST, Org, LaTeX, AsciiDoc, Pages, WPD, PPTX/PPT/ODP/Key | PDF, DOCX, HTML, Markdown, text built in; ODT/RTF via LibreOffice; EPUB/LaTeX/RST via Pandoc; slides to PDF and pictures | Built | Built + Engine |
| E-books | EPUB, MOBI, AZW/AZW3, FB2, LIT, PDB, CBZ, CBR | EPUB → PDF/HTML/Markdown/text/Word built in; MOBI/AZW3/FB2/EPUB via Calibre; other e-books → PDF etc. through Calibre then Keeper; CBZ/CBR → PDF or ZIP | Built (EPUB, CBZ) | Built + Engine |
| Spreadsheets | XLSX, XLS, XLSM, XLSB, ODS, Numbers (partly) | CSV, TSV, XLSX, ODS, JSON, YAML, TOML, XML, HTML, Markdown, SQLite, Parquet, PDF | Built | Built; Parquet is Engine (DuckDB); spreadsheet PDF via LibreOffice |
| Data | CSV, TSV, JSON, JSONL, YAML, TOML, XML, SQLite, Parquet | each other (structure kept between JSON/YAML/TOML/XML; tables otherwise, nested keys as `a.b` columns), plus PDF table | Built | Built (TOML and XML readers/writers are Keeper's own) |
| Subtitles | SRT, VTT, ASS/SSA, LRC, SBV | each other, text, JSON; shift and stretch timings | Built | Built |
| Calendars | ICS | CSV, JSON, XLSX, HTML | Built | Built |
| Contacts | VCF | CSV, JSON, XLSX, HTML; CSV/spreadsheet → VCF (Contacts from a table) | Built | Built |
| Notebooks | IPYNB | HTML, Markdown, script (.py and others), PDF | Built | Built (outputs and plots included) |
| E-mail | EML, MSG | PDF, HTML, Markdown, text; MSG → EML | Built | Built (MSG read from its compound file: subject, people, body) |
| Mailboxes | MBOX | separate .eml files plus a CSV index | — | Built |
| Fonts | TTF, OTF, WOFF, WOFF2 | each other | Built | Built: WOFF both ways; WOFF2 written by Keeper (Brotli, untransformed tables) and read back when untransformed. Reading WOFF2 with transformed outlines (most web fonts) is Partial (needs fontTools). TTF ↔ OTF outline conversion is Missing |
| 3D | OBJ, STL, PLY, glTF, GLB, FBX, 3MF, DAE | GLB, glTF, STL, OBJ, PLY | Built | Built (geometry; textures are not carried over) |
| CAD | DXF | SVG, PNG, PDF | **New**: layers, zoom | Built (lines, polylines, circles, arcs, ellipses, splines approximated, text, blocks). DWG is Missing |
| Archives | ZIP, TAR, TGZ, GZ, BZ2, XZ, 7z, RAR, ISO, DMG, CAB | ZIP, TAR, TGZ (repacked) | Built | Built; 7z/RAR/ISO/DMG read with the system's archive tool |
| Audio | MP3, M4A, AAC, WAV, FLAC, OGG, Opus, AIFF, WMA, ALAC, AMR | MP3, M4A, WAV, FLAC, OGG, AIFF, Opus | Built | Built (bundled ffmpeg) |
| Video | MP4, MOV, MKV, WebM, AVI, WMV, FLV, MPEG, 3GP, TS… | MP4, WebM, MOV, MKV (re-wrapped when possible), GIF, MP3, M4A | Built | Built |
| Diagrams | DOT/GV | SVG, PNG, PDF | Text | Engine (Graphviz). Mermaid/PlantUML are Missing |
| QR and barcodes | pictures; text | read QR, EAN/UPC, Code 128/39/93, ITF, Codabar, Data Matrix, Aztec, PDF417; make QR as PNG + SVG | — | Built |

### Outside engines

Keeper uses these only when they are installed, never downloads them silently, and tells you
what to install when a route needs one (Convert to… → "Programs Keeper can use" lists
which are installed, with links). Copyleft engines stay separate programs.

| Engine | Used for | Licence |
|---|---|---|
| qpdf | remove restrictions, fast web view, repair, lossless compression | Apache-2.0 |
| poppler (pdftoppm, pdftocairo, pdffonts, pdfsig) | pages from the command line, PDF → SVG, font checks | GPL-2.0 |
| Ghostscript | compression, PDF/A, fonts to outlines, EPS | AGPL-3.0 |
| LibreOffice | office documents, slides and spreadsheets | MPL-2.0 |
| Pandoc | EPUB, LaTeX, reStructuredText output | GPL-2.0 |
| Calibre | MOBI, AZW3, FB2 and other e-books | GPL-3.0 |
| Graphviz | diagrams | EPL-1.0 |
| DuckDB | Parquet | MIT |
| OpenSSL | reading .p12/.pfx certificates | Apache-2.0 |

Bundled with Keeper (permissive or already part of it): pdf-lib, pdf.js, sharp/libvips,
ffmpeg, three.js, SheetJS, sql.js, js-yaml, JSZip, pkijs/asn1js, qrcode, jsQR/ZXing, ag-psd,
mailparser, tesseract.js.

Not done yet: downloading the copyleft engines on demand with pinned SHA-256 checksums (as
Keeper does for rclone and cloudflared). Today Keeper detects them and links to their official
downloads.

## Verified

- `test/filekit.test.ts`: 167 tests pass — every pure PDF operation, the text layout, data,
  subtitle, calendar, contact, notebook, DXF, font and icon code, the conversion table, every
  built-in route of the matrix on real sample files, round trips (CSV → XLSX → ODS → JSON →
  YAML → XML → SQLite → TSV → CSV; fonts byte-for-byte through WOFF and WOFF2; OBJ → GLB → STL;
  subtitles through every format), and real runs through qpdf, poppler, Ghostscript, Graphviz,
  LibreOffice, Pandoc and Calibre (each skipped where it is not installed).
- `test/e2e/filekit.cjs` in the real app under xvfb: a saved workflow (merge → page numbers →
  watermark → compress), Compare with the app drawing the pages, EPUB → PDF with the app's
  printer, CSV → XLSX → JSON, DXF → PDF, STL → glTF, "Convert to…" from the file menu, the
  workflow editor, and Quick Look previews of a 3D model and a DXF drawing, in light and dark.
