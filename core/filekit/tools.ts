// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The file kit's tools: what each is called, what it takes, and the options
// it shows. The interface draws options from `fields`, so a new tool needs
// only an entry here and a case in the service.

export type FieldKind = 'text' | 'textarea' | 'number' | 'select' | 'bool' | 'file' | 'password';

export interface KitField {
  key: string;
  label: string;
  kind: FieldKind;
  default?: string | number | boolean;
  options?: [string, string][];
  hint?: string;
  min?: number;
  max?: number;
  step?: number;
  /** for file pickers */
  extensions?: string[];
  /** shown only when another option has this value */
  when?: { key: string; is: (string | number | boolean)[] };
}

export type KitCategory = 'pdf' | 'convert' | 'image' | 'file';

export interface KitInfo {
  category: KitCategory;
  label: string;
  description: string;
  /** file families it works on: pdf, image, video, audio, document, code, or * */
  accepts: string[];
  multi?: boolean;
  fields?: KitField[];
  /** an outside program it needs (shown when missing) */
  engine?: string;
}

const PAGES: KitField = { key: 'pages', label: 'Pages', kind: 'text', default: '', hint: 'Empty for all, or e.g. 1-3, 5, odd, even, 2-last' };
const SPOT_OPTIONS: [string, string][] = [['top-left', 'Top left'], ['top-center', 'Top centre'], ['top-right', 'Top right'], ['center', 'Centre'], ['bottom-left', 'Bottom left'], ['bottom-center', 'Bottom centre'], ['bottom-right', 'Bottom right']];
const PAPER_OPTIONS: [string, string][] = [['a4', 'A4'], ['letter', 'Letter'], ['a3', 'A3'], ['a5', 'A5'], ['legal', 'Legal'], ['tabloid', 'Tabloid']];

export const KIT_INFO = {
  // ------------------------------------------------------------ PDF: arrange
  'pdf.reverse': { category: 'pdf', label: 'Reverse pages', description: 'Last page first: fixes scans fed the wrong way round.', accepts: ['pdf'] },
  'pdf.alternate': { category: 'pdf', label: 'Mix or collate', description: 'Take pages from several PDFs in turn. Duplex collate: odd-side and even-side scans into one.', accepts: ['pdf'], multi: true, fields: [{ key: 'reverseSecond', label: 'Second file is reversed (back sides scanned last page first)', kind: 'bool', default: false }] },
  'pdf.divide': { category: 'pdf', label: 'Divide', description: 'Into parts of N pages, into N equal parts, or at the pages you list.', accepts: ['pdf'], fields: [
    { key: 'mode', label: 'Divide', kind: 'select', default: 'every', options: [['every', 'Every N pages'], ['parts', 'Into N parts'], ['at', 'Before these pages']] },
    { key: 'n', label: 'N', kind: 'number', default: 2, min: 1, when: { key: 'mode', is: ['every', 'parts'] } },
    { key: 'at', label: 'New part starts at page', kind: 'text', default: '', hint: 'e.g. 5, 12', when: { key: 'mode', is: ['at'] } },
  ] },
  'pdf.blank': { category: 'pdf', label: 'Remove blank pages', description: 'Finds empty pages (also nearly empty scans) and leaves them out.', accepts: ['pdf'], fields: [{ key: 'tolerance', label: 'Allow specks covering up to (%)', kind: 'number', default: 0.3, min: 0, max: 5, step: 0.1, hint: 'For scans: dust and paper texture under this amount still count as blank' }] },
  'pdf.rotateAny': { category: 'pdf', label: 'Rotate by any angle', description: 'Turn pages by any number of degrees; the page grows so nothing is cut off.', accepts: ['pdf'], fields: [{ key: 'angle', label: 'Degrees (counter-clockwise)', kind: 'number', default: 15, min: -360, max: 360 }, PAGES] },
  'pdf.nup': { category: 'pdf', label: 'Pages per sheet', description: '2, 4, 6, 8, 9 or 16 pages on each sheet, to print less paper.', accepts: ['pdf'], fields: [
    { key: 'per', label: 'Pages per sheet', kind: 'select', default: '4', options: [['2', '2'], ['4', '4'], ['6', '6'], ['8', '8'], ['9', '9'], ['16', '16']] },
    { key: 'paper', label: 'Paper', kind: 'select', default: 'a4', options: PAPER_OPTIONS },
    { key: 'border', label: 'Thin border around each page', kind: 'bool', default: true },
  ] },
  'pdf.booklet': { category: 'pdf', label: 'Booklet', description: 'Print double-sided, fold in the middle, and the pages read in order.', accepts: ['pdf'], fields: [{ key: 'paper', label: 'Paper', kind: 'select', default: 'a4', options: PAPER_OPTIONS }] },
  'pdf.single': { category: 'pdf', label: 'One long page', description: 'Every page stacked into one continuous page, for reading on screens.', accepts: ['pdf'] },
  'pdf.overlay': { category: 'pdf', label: 'Overlay or underlay', description: 'Lay another PDF over or under every page: letterheads, backgrounds, form overlays.', accepts: ['pdf'], fields: [
    { key: 'layer', label: 'PDF to lay on the pages', kind: 'file', extensions: ['pdf'] },
    { key: 'under', label: 'Put it under the page (letterhead, background)', kind: 'bool', default: false },
    { key: 'repeat', label: 'Repeat its pages when it is shorter', kind: 'bool', default: true },
  ] },
  'pdf.poster': { category: 'pdf', label: 'Poster', description: 'Cut each page into tiles that print on ordinary paper and tape into a poster.', accepts: ['pdf'], fields: [
    { key: 'across', label: 'Sheets across', kind: 'number', default: 2, min: 1, max: 10 },
    { key: 'down', label: 'Sheets down', kind: 'number', default: 2, min: 1, max: 10 },
    { key: 'overlap', label: 'Overlap (points)', kind: 'number', default: 14, min: 0, max: 72 },
  ] },
  'pdf.crop': { category: 'pdf', label: 'Crop margins', description: 'Trim white margins automatically, or by the amounts you choose.', accepts: ['pdf'], fields: [
    { key: 'mode', label: 'Crop', kind: 'select', default: 'auto', options: [['auto', 'Find the margins'], ['manual', 'By these amounts']] },
    { key: 'top', label: 'Top (mm)', kind: 'number', default: 10, min: 0, when: { key: 'mode', is: ['manual'] } },
    { key: 'right', label: 'Right (mm)', kind: 'number', default: 10, min: 0, when: { key: 'mode', is: ['manual'] } },
    { key: 'bottom', label: 'Bottom (mm)', kind: 'number', default: 10, min: 0, when: { key: 'mode', is: ['manual'] } },
    { key: 'left', label: 'Left (mm)', kind: 'number', default: 10, min: 0, when: { key: 'mode', is: ['manual'] } },
  ] },
  'pdf.paper': { category: 'pdf', label: 'Fix page size', description: 'Every page on the same paper (A4, Letter…), scaled to fit and centred.', accepts: ['pdf'], fields: [
    { key: 'paper', label: 'Paper', kind: 'select', default: 'a4', options: PAPER_OPTIONS },
    { key: 'orientation', label: 'Orientation', kind: 'select', default: 'auto', options: [['auto', 'Follow each page'], ['portrait', 'Portrait'], ['landscape', 'Landscape']] },
  ] },
  'pdf.dimensions': { category: 'pdf', label: 'Page sizes', description: 'Each page’s size in points and millimetres, its paper name and rotation.', accepts: ['pdf'] },
  'pdf.compare': { category: 'pdf', label: 'Compare', description: 'What changed between two PDFs: words added and removed, and pages that look different.', accepts: ['pdf'], multi: true, fields: [{ key: 'visual', label: 'Also compare how the pages look', kind: 'bool', default: true }] },
  // ------------------------------------------------------------ PDF: mark up
  'pdf.headerFooter': { category: 'pdf', label: 'Header and footer', description: 'Text at the top and bottom of pages: {page}, {pages}, {date} and {file} fill themselves in.', accepts: ['pdf'], fields: [
    { key: 'headerLeft', label: 'Header left', kind: 'text', default: '' },
    { key: 'headerCenter', label: 'Header centre', kind: 'text', default: '{file}' },
    { key: 'headerRight', label: 'Header right', kind: 'text', default: '{date}' },
    { key: 'footerLeft', label: 'Footer left', kind: 'text', default: '' },
    { key: 'footerCenter', label: 'Footer centre', kind: 'text', default: 'Page {page} of {pages}' },
    { key: 'footerRight', label: 'Footer right', kind: 'text', default: '' },
    { key: 'size', label: 'Text size', kind: 'number', default: 9, min: 5, max: 24 },
    PAGES,
  ] },
  'pdf.bates': { category: 'pdf', label: 'Bates numbers', description: 'Numbers every page of a set of documents in sequence (ABC000001…), continuing across files.', accepts: ['pdf'], multi: true, fields: [
    { key: 'prefix', label: 'Before the number', kind: 'text', default: 'DOC' },
    { key: 'start', label: 'First number', kind: 'number', default: 1, min: 0 },
    { key: 'digits', label: 'Digits', kind: 'number', default: 6, min: 1, max: 12 },
    { key: 'suffix', label: 'After the number', kind: 'text', default: '' },
    { key: 'spot', label: 'Where', kind: 'select', default: 'bottom-right', options: SPOT_OPTIONS },
  ] },
  'pdf.stamp': { category: 'pdf', label: 'Stamp', description: 'A rubber stamp: Approved, Paid, Draft, Confidential or your own words.', accepts: ['pdf'], fields: [
    { key: 'text', label: 'Stamp', kind: 'select', default: 'APPROVED', options: [['APPROVED', 'Approved'], ['PAID', 'Paid'], ['DRAFT', 'Draft'], ['CONFIDENTIAL', 'Confidential'], ['FINAL', 'Final'], ['RECEIVED', 'Received'], ['FOR REVIEW', 'For review'], ['REJECTED', 'Rejected'], ['VOID', 'Void'], ['COPY', 'Copy'], ['custom', 'My own words…']] },
    { key: 'custom', label: 'Words', kind: 'text', default: '', when: { key: 'text', is: ['custom'] } },
    { key: 'spot', label: 'Where', kind: 'select', default: 'top-right', options: SPOT_OPTIONS },
    { key: 'date', label: 'Add today’s date', kind: 'bool', default: true },
    { ...PAGES, default: '1' },
  ] },
  'pdf.markText': { category: 'pdf', label: 'Watermark (more options)', description: 'Text at any angle, size and see-through amount, once or tiled, on chosen pages.', accepts: ['pdf'], fields: [
    { key: 'text', label: 'Text', kind: 'text', default: 'CONFIDENTIAL' },
    { key: 'angle', label: 'Angle', kind: 'number', default: 45, min: -90, max: 90 },
    { key: 'opacity', label: 'Strength (%)', kind: 'number', default: 18, min: 3, max: 100 },
    { key: 'tile', label: 'Repeat across the page', kind: 'bool', default: false },
    { key: 'color', label: 'Colour', kind: 'select', default: 'grey', options: [['grey', 'Grey'], ['red', 'Red'], ['blue', 'Blue'], ['black', 'Black']] },
    PAGES,
  ] },
  'pdf.markImage': { category: 'pdf', label: 'Picture watermark or logo', description: 'Put a PNG or JPEG (a logo, a seal) on pages, see-through if you like.', accepts: ['pdf'], fields: [
    { key: 'image', label: 'Picture', kind: 'file', extensions: ['png', 'jpg', 'jpeg'] },
    { key: 'spot', label: 'Where', kind: 'select', default: 'center', options: SPOT_OPTIONS },
    { key: 'scale', label: 'Width (% of the page)', kind: 'number', default: 30, min: 3, max: 100 },
    { key: 'opacity', label: 'Strength (%)', kind: 'number', default: 30, min: 3, max: 100 },
    PAGES,
  ] },
  'pdf.replaceText': { category: 'pdf', label: 'Edit text', description: 'Change words on the page: each match is covered and the new words set in its place, sized to fit the line.', accepts: ['pdf'], fields: [
    { key: 'find', label: 'Find', kind: 'text', default: '' },
    { key: 'replace', label: 'Replace with', kind: 'text', default: '' },
    { key: 'caseSensitive', label: 'Match capital letters exactly', kind: 'bool', default: false },
  ] },
  'pdf.colors': { category: 'pdf', label: 'Colours and scanner look', description: 'Invert for night reading, greyscale, black and white, higher contrast, sepia, or look like a scan.', accepts: ['pdf'], fields: [
    { key: 'mode', label: 'Look', kind: 'select', default: 'grey', options: [['grey', 'Greyscale'], ['invert', 'Inverted (dark)'], ['bw', 'Black and white'], ['contrast', 'More contrast'], ['sepia', 'Sepia'], ['scan', 'Looks scanned']] },
    { key: 'dpi', label: 'Sharpness (dpi)', kind: 'number', default: 150, min: 72, max: 400, hint: 'Pages are redrawn as pictures at this resolution (text stays searchable when the original had text only through the "Make searchable" tool)' },
  ] },
  'pdf.rasterize': { category: 'pdf', label: 'Flatten to pictures', description: 'Every page as a picture: nothing can be selected or edited, and hidden content is gone.', accepts: ['pdf'], fields: [{ key: 'dpi', label: 'Sharpness (dpi)', kind: 'number', default: 150, min: 72, max: 600 }] },
  'pdf.deskew': { category: 'pdf', label: 'Straighten scans', description: 'Finds the tilt of scanned pages, turns them straight, and can add searchable text.', accepts: ['pdf'], fields: [{ key: 'ocr', label: 'Also make the text searchable', kind: 'bool', default: true }, { key: 'dpi', label: 'Sharpness (dpi)', kind: 'number', default: 200, min: 100, max: 400 }] },
  'pdf.annotsRemove': { category: 'pdf', label: 'Remove comments', description: 'Takes out comments, highlights, drawings and other annotations.', accepts: ['pdf'], fields: [{ key: 'keepLinks', label: 'Keep links', kind: 'bool', default: true }, { key: 'keepForms', label: 'Keep form fields', kind: 'bool', default: true }] },
  // ------------------------------------------------------------ PDF: structure
  'pdf.bookmarks': { category: 'pdf', label: 'Edit bookmarks', description: 'The bookmarks pane: read it, or write it as an indented list of “Title | page”.', accepts: ['pdf'], fields: [
    { key: 'mode', label: 'Do', kind: 'select', default: 'read', options: [['read', 'Show the bookmarks'], ['set', 'Replace with my list'], ['auto', 'Make them from headings']] },
    { key: 'text', label: 'Bookmarks', kind: 'textarea', default: 'Introduction | 1\n  Background | 2\nResults | 4', hint: 'Two spaces per level', when: { key: 'mode', is: ['set'] } },
  ] },
  'pdf.toc': { category: 'pdf', label: 'Contents page', description: 'A clickable contents page at the front, from the bookmarks (or the headings).', accepts: ['pdf'], fields: [{ key: 'title', label: 'Title', kind: 'text', default: 'Contents' }] },
  'pdf.labels': { category: 'pdf', label: 'Page labels', description: 'Page numbers viewers show: i, ii, iii for the front matter, then 1, 2, 3…', accepts: ['pdf'], fields: [{ key: 'spec', label: 'Labels', kind: 'textarea', default: '1: roman\n5: decimal', hint: 'One per line: “first page: style [from N]”. Styles: decimal, roman, ROMAN, alpha, ALPHA, none; add a prefix in quotes: 20: "A-" decimal' }] },
  'pdf.meta': { category: 'pdf', label: 'Details (metadata)', description: 'See, change or remove the title, author, subject, keywords and the software that made it.', accepts: ['pdf'], fields: [
    { key: 'mode', label: 'Do', kind: 'select', default: 'view', options: [['view', 'Show'], ['edit', 'Change'], ['strip', 'Remove all']] },
    { key: 'title', label: 'Title', kind: 'text', default: '', when: { key: 'mode', is: ['edit'] } },
    { key: 'author', label: 'Author', kind: 'text', default: '', when: { key: 'mode', is: ['edit'] } },
    { key: 'subject', label: 'Subject', kind: 'text', default: '', when: { key: 'mode', is: ['edit'] } },
    { key: 'keywords', label: 'Keywords', kind: 'text', default: '', when: { key: 'mode', is: ['edit'] } },
  ] },
  'pdf.attachments': { category: 'pdf', label: 'Attachments', description: 'Files inside a PDF: take them out, or attach more.', accepts: ['pdf'], fields: [
    { key: 'mode', label: 'Do', kind: 'select', default: 'extract', options: [['extract', 'Take out the attached files'], ['add', 'Attach a file']] },
    { key: 'file', label: 'File to attach', kind: 'file', when: { key: 'mode', is: ['add'] } },
  ] },
  'pdf.layers': { category: 'pdf', label: 'Layers', description: 'Optional content layers (drawings, translations, print marks): see them, show or hide them by default.', accepts: ['pdf'], fields: [
    { key: 'hide', label: 'Hide these layers', kind: 'text', default: '', hint: 'Names separated by commas; empty just lists them' },
  ] },
  'pdf.fields': { category: 'pdf', label: 'Make a fillable form', description: 'Add text boxes, tick boxes, lists and choices so others can fill it in.', accepts: ['pdf'], fields: [
    { key: 'mode', label: 'Do', kind: 'select', default: 'auto', options: [['auto', 'Find blanks (lines like ____ and boxes like [ ])'], ['spec', 'From my list']] },
    { key: 'spec', label: 'Fields', kind: 'textarea', default: 'text name 1 72 700 220 20\ncheckbox agree 1 72 660 14 14\ndropdown country 1 72 620 160 20 Estonia, Germany, UK', hint: 'type name page x y width height [choices]; points from the bottom-left', when: { key: 'mode', is: ['spec'] } },
  ] },
  'pdf.flatten': { category: 'pdf', label: 'Flatten forms', description: 'Fix form answers into the page so they can no longer be changed.', accepts: ['pdf'] },
  // ------------------------------------------------------------ PDF: protect and repair
  'pdf.sanitize': { category: 'pdf', label: 'Sanitize', description: 'Removes what can hide in a PDF: JavaScript, automatic actions, attached files, details, outside links.', accepts: ['pdf'], fields: [
    { key: 'scripts', label: 'JavaScript and automatic actions', kind: 'bool', default: true },
    { key: 'attachments', label: 'Attached files', kind: 'bool', default: true },
    { key: 'metadata', label: 'Author, software and other details', kind: 'bool', default: true },
    { key: 'links', label: 'Links to websites and other files', kind: 'bool', default: true },
    { key: 'annotations', label: 'Comments', kind: 'bool', default: false },
    { key: 'layers', label: 'Layers', kind: 'bool', default: false },
    { key: 'forms', label: 'Form fields', kind: 'bool', default: false },
  ] },
  'pdf.unlock': { category: 'pdf', label: 'Remove restrictions', description: 'A copy you can print, copy from and edit, when the PDF opens without a password but limits what you can do. Only for PDFs you own or may change.', accepts: ['pdf'], engine: 'qpdf', fields: [{ key: 'owner', label: 'I own this document or have permission to change it', kind: 'bool', default: false }] },
  'pdf.linearize': { category: 'pdf', label: 'Fast web view', description: 'Rearranged so the first page shows while the rest is still downloading.', accepts: ['pdf'], engine: 'qpdf' },
  'pdf.repair': { category: 'pdf', label: 'Repair', description: 'Rebuilds a damaged PDF that will not open or shows errors.', accepts: ['pdf'] },
  'pdf.shrink': { category: 'pdf', label: 'Compress (more engines)', description: 'Smaller PDFs with Ghostscript (fonts and pictures) or qpdf (lossless), whichever is installed.', accepts: ['pdf'], fields: [
    { key: 'engine', label: 'Engine', kind: 'select', default: 'auto', options: [['auto', 'Best available'], ['gs', 'Ghostscript'], ['qpdf', 'qpdf (lossless)'], ['keeper', 'Built in (pictures only)']] },
    { key: 'level', label: 'Quality', kind: 'select', default: 'ebook', options: [['screen', 'Smallest (72 dpi)'], ['ebook', 'Balanced (150 dpi)'], ['printer', 'Print (300 dpi)'], ['prepress', 'Best']] },
  ] },
  'pdf.pdfa': { category: 'pdf', label: 'PDF/A (archive)', description: 'Convert to PDF/A for long-term archiving, or check a file claims it and follows the basic rules.', accepts: ['pdf'], fields: [
    { key: 'mode', label: 'Do', kind: 'select', default: 'convert', options: [['convert', 'Convert'], ['check', 'Check']] },
    { key: 'level', label: 'Level', kind: 'select', default: '2', options: [['1', 'PDF/A-1b'], ['2', 'PDF/A-2b'], ['3', 'PDF/A-3b']], when: { key: 'mode', is: ['convert'] } },
  ] },
  'pdf.outlines': { category: 'pdf', label: 'Fonts to outlines', description: 'Turns text into shapes, so it prints the same everywhere without its fonts (text is no longer selectable).', accepts: ['pdf'], engine: 'ghostscript' },
  'pdf.certSign': { category: 'pdf', label: 'Digital signature (certificate)', description: 'Signs with an X.509 certificate so readers can check who signed and that nothing changed since; optional trusted timestamp.', accepts: ['pdf'], fields: [
    { key: 'cert', label: 'Certificate (.p12/.pfx, or PEM with its key)', kind: 'file', extensions: ['p12', 'pfx', 'pem', 'crt'] },
    { key: 'password', label: 'Certificate password', kind: 'password', default: '' },
    { key: 'reason', label: 'Reason', kind: 'text', default: 'I approve this document' },
    { key: 'location', label: 'Place', kind: 'text', default: '' },
    { key: 'tsa', label: 'Timestamp server (RFC 3161)', kind: 'text', default: '', hint: 'Optional, e.g. http://timestamp.digicert.com — the document’s fingerprint is sent, never the document' },
    { key: 'selfSigned', label: 'No certificate? Make a personal one (name below)', kind: 'bool', default: false },
    { key: 'name', label: 'Your name', kind: 'text', default: '', when: { key: 'selfSigned', is: [true] } },
  ] },
  'pdf.certVerify': { category: 'pdf', label: 'Check signatures', description: 'Who signed, when, whether the document changed since, and the timestamp.', accepts: ['pdf'] },
  // ------------------------------------------------------------ PDF: out
  'pdf.toText': { category: 'pdf', label: 'PDF to text', description: 'Plain text, Markdown with headings and lists, HTML or JSON with the text of every page.', accepts: ['pdf'], fields: [{ key: 'format', label: 'As', kind: 'select', default: 'md', options: [['txt', 'Text'], ['md', 'Markdown'], ['html', 'Web page'], ['json', 'JSON (pages and lines)']] }] },
  'pdf.tables': { category: 'pdf', label: 'Tables out of PDFs', description: 'Finds tables on the pages and saves them as a spreadsheet, CSV, JSON or Markdown.', accepts: ['pdf'], fields: [{ key: 'format', label: 'As', kind: 'select', default: 'xlsx', options: [['xlsx', 'Excel (one sheet per table)'], ['csv', 'CSV (one file per table)'], ['json', 'JSON'], ['md', 'Markdown']] }] },
  'pdf.forAi': { category: 'pdf', label: 'Prepare for AI', description: 'Text in chunks an AI can read (JSON with pages and sections), and optionally into Keeper’s brain.', accepts: ['pdf', 'document', 'code'], fields: [
    { key: 'words', label: 'Words per chunk', kind: 'number', default: 350, min: 80, max: 2000 },
    { key: 'overlap', label: 'Overlap (words)', kind: 'number', default: 40, min: 0, max: 200 },
    { key: 'brain', label: 'Also add to Keeper’s brain', kind: 'bool', default: false },
  ] },
  'pdf.images': { category: 'pdf', label: 'Extract pictures', description: 'Saves the pictures inside a PDF as they are (photos stay untouched JPEGs).', accepts: ['pdf'], fields: [{ key: 'min', label: 'Skip pictures smaller than (pixels)', kind: 'number', default: 32, min: 0 }] },
  'pdf.toSvg': { category: 'pdf', label: 'PDF to SVG', description: 'Each page as a scalable vector drawing.', accepts: ['pdf'], engine: 'poppler' },
  'pdf.toCbz': { category: 'pdf', label: 'PDF to comic book', description: 'Pages as pictures in a .cbz for comic and e-book readers.', accepts: ['pdf'], fields: [{ key: 'dpi', label: 'Sharpness (dpi)', kind: 'number', default: 150, min: 72, max: 300 }] },
  // ------------------------------------------------------------ any format
  'convert.to': { category: 'convert', label: 'Convert to…', description: 'Any file to another format: pictures, documents, e-books, spreadsheets and data, subtitles, fonts, 3D, drawings, e-mail, contacts, calendars and notebooks.', accepts: ['*'], fields: [{ key: 'format', label: 'To', kind: 'select', default: '' }] },
  'convert.subShift': { category: 'convert', label: 'Shift subtitles', description: 'Move subtitles earlier or later, or stretch them for a different frame rate.', accepts: ['*'], fields: [{ key: 'seconds', label: 'Seconds (negative is earlier)', kind: 'number', default: 1, step: 0.1 }, { key: 'factor', label: 'Stretch', kind: 'number', default: 1, step: 0.001, hint: '25→23.976 fps: 1.0427' }] },
  'convert.vcard': { category: 'convert', label: 'Contacts from a table', description: 'A CSV or spreadsheet of names, e-mails and phones as contact cards (.vcf) for any address book.', accepts: ['*'] },
  'convert.mbox': { category: 'convert', label: 'Split a mailbox', description: 'An .mbox archive as separate messages (.eml) and an index you can open in a spreadsheet.', accepts: ['*'] },
  'image.qrRead': { category: 'image', label: 'Read QR and barcodes', description: 'Finds QR codes and barcodes in pictures and shows what they say.', accepts: ['image'] },
  'file.qrMake': { category: 'file', label: 'Make a QR code', description: 'A QR code for a link or text (from a text file, or typed here), as PNG and SVG.', accepts: ['*'], fields: [{ key: 'text', label: 'Text or link', kind: 'textarea', default: '', hint: 'Empty: use the text inside each chosen file' }, { key: 'size', label: 'Size (pixels)', kind: 'number', default: 1024, min: 128, max: 4096 }] },
} as const satisfies Record<string, KitInfo>;

export type KitTool = keyof typeof KIT_INFO;
export type KitArgs = Record<string, string | number | boolean | undefined>;
export interface KitOp { tool: KitTool; args?: KitArgs }

export const isKitTool = (t: string): t is KitTool => t in KIT_INFO;

export function kitDefaults(tool: KitTool): KitOp {
  const args: KitArgs = {};
  for (const f of (KIT_INFO[tool] as KitInfo).fields ?? []) if (f.default !== undefined) args[f.key] = f.default;
  return { tool, args };
}

/** The tool's options, merged from its defaults, `args` and options given at the top level (the command line). */
export function kitArgs(op: { tool: string; args?: KitArgs } & Record<string, unknown>): KitArgs {
  const a: KitArgs = {};
  for (const f of (KIT_INFO[op.tool as KitTool] as KitInfo | undefined)?.fields ?? []) if (f.default !== undefined) a[f.key] = f.default;
  for (const [k, v] of Object.entries(op)) if (k !== 'tool' && k !== 'args' && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) a[k] = v;
  return { ...a, ...(op.args ?? {}) };
}

/** Options that must be filled in before running, as a sentence; null when ready. */
export function kitBlocked(op: KitOp, files: string[]): string | null {
  const a = kitArgs(op as never);
  if (!files.length) return 'Choose files';
  if (op.tool === 'pdf.alternate' && files.length < 2) return 'Choose at least two PDFs';
  if (op.tool === 'pdf.compare' && files.length !== 2) return 'Choose exactly two PDFs to compare';
  if (op.tool === 'pdf.overlay' && !a.layer) return 'Choose the PDF to lay on the pages';
  if (op.tool === 'pdf.markImage' && !a.image) return 'Choose the picture';
  if (op.tool === 'pdf.replaceText' && !String(a.find ?? '').trim()) return 'Type the words to find';
  if (op.tool === 'pdf.unlock' && !a.owner) return 'Confirm that you own the document or may change it';
  if (op.tool === 'pdf.attachments' && a.mode === 'add' && !a.file) return 'Choose the file to attach';
  if (op.tool === 'pdf.certSign' && !a.cert && !a.selfSigned) return 'Choose your certificate, or make a personal one';
  if (op.tool === 'pdf.certSign' && a.selfSigned && !String(a.name ?? '').trim()) return 'Type your name for the certificate';
  if (op.tool === 'convert.to' && !a.format) return 'Choose the format to convert to';
  if (op.tool === 'pdf.stamp' && a.text === 'custom' && !String(a.custom ?? '').trim()) return 'Type the words for the stamp';
  return null;
}
