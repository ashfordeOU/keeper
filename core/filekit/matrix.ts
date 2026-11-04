// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Which formats a file can become, and through what. The "Convert to…" menu,
// the Convert page and `keeper convert --to` all read this one table.

export type Family =
  | 'image' | 'vector' | 'pdf' | 'document' | 'ebook' | 'sheet' | 'data' | 'subtitle' | 'calendar' | 'contacts'
  | 'notebook' | 'mail' | 'mailbox' | 'font' | 'model' | 'cad' | 'archive' | 'audio' | 'video' | 'diagram' | 'icon';

const FAMILY: Record<string, Family> = {};
const add = (f: Family, exts: string) => { for (const e of exts.split(' ')) FAMILY[e] = f; };
add('image', 'jpg jpeg jpe jfif png webp avif tif tiff gif heic heif hif bmp dib tga psd psb jxl dng cr2 cr3 crw nef nrw arw srf sr2 orf rw2 raf pef srw x3f 3fr erf kdc mrw mos iiq rwl');
add('icon', 'ico cur icns');
add('vector', 'svg svgz eps ai');
add('pdf', 'pdf');
add('document', 'docx doc odt rtf html htm md markdown txt rst org tex textile adoc asciidoc pages wpd docm dotx');
add('ebook', 'epub mobi azw azw3 fb2 lit pdb cbz cbr');
add('sheet', 'xlsx xls xlsm xlsb ods numbers');
add('data', 'csv tsv json jsonl ndjson yaml yml toml xml sqlite sqlite3 db parquet');
add('subtitle', 'srt vtt ass ssa lrc sbv');
add('calendar', 'ics ical');
add('contacts', 'vcf vcard');
add('notebook', 'ipynb');
add('mail', 'eml msg');
add('mailbox', 'mbox');
add('font', 'ttf otf woff woff2');
add('model', 'obj stl ply gltf glb fbx 3mf dae');
add('cad', 'dxf');
add('archive', 'zip tar tgz gz bz2 xz 7z rar iso dmg cab');
add('audio', 'mp3 m4a aac wav flac ogg oga opus aiff aif wma alac amr');
add('video', 'mp4 m4v mov mkv webm avi wmv flv mpg mpeg 3gp mts m2ts ts ogv');
add('diagram', 'dot gv mmd mermaid puml');
// Presentations open in office suites and become PDFs or pictures.
add('document', 'pptx ppt odp key');

export function familyOf(ext: string): Family | undefined {
  return FAMILY[ext.toLowerCase().replace(/^\./, '')];
}

export interface Target {
  format: string;
  label: string;
  /** an outside program this route needs; the interface marks it */
  engine?: 'office' | 'pandoc' | 'calibre' | 'ghostscript' | 'poppler' | 'graphviz' | 'duckdb' | 'ffmpeg' | 'fonttools';
  /** a short note shown beside the choice */
  note?: string;
}

const T = (format: string, label: string, extra: Partial<Target> = {}): Target => ({ format, label, ...extra });

const IMAGE_OUT = [T('jpg', 'JPEG'), T('png', 'PNG'), T('webp', 'WebP'), T('avif', 'AVIF'), T('tiff', 'TIFF'), T('gif', 'GIF'), T('bmp', 'BMP'), T('heic', 'HEIC', { note: 'on a Mac' }), T('ico', 'Windows icon (.ico)'), T('icns', 'Mac icon (.icns)'), T('pdf', 'PDF'), T('svg', 'SVG (picture inside)')];
const DOC_OUT = [T('pdf', 'PDF'), T('docx', 'Word (.docx)'), T('html', 'Web page'), T('md', 'Markdown'), T('txt', 'Plain text'), T('odt', 'OpenDocument text', { engine: 'office' }), T('rtf', 'Rich text', { engine: 'office' }), T('epub', 'E-book (EPUB)', { engine: 'pandoc' }), T('tex', 'LaTeX', { engine: 'pandoc' }), T('rst', 'reStructuredText', { engine: 'pandoc' })];
const DATA_OUT = [T('csv', 'CSV'), T('tsv', 'TSV'), T('xlsx', 'Excel (.xlsx)'), T('ods', 'OpenDocument spreadsheet'), T('json', 'JSON'), T('yaml', 'YAML'), T('toml', 'TOML'), T('xml', 'XML'), T('html', 'Web page (table)'), T('md', 'Markdown table'), T('sqlite', 'SQLite database'), T('parquet', 'Parquet', { engine: 'duckdb' })];

/** Formats this file can be converted to, best first. */
export function targetsFor(ext: string): Target[] {
  const e = ext.toLowerCase().replace(/^\./, '');
  const fam = familyOf(e);
  const not = (list: Target[]) => list.filter((t) => t.format !== e && !(e === 'jpeg' && t.format === 'jpg') && !(e === 'tif' && t.format === 'tiff') && !(e === 'yml' && t.format === 'yaml') && !(e === 'htm' && t.format === 'html') && !(e === 'markdown' && t.format === 'md'));
  switch (fam) {
    case 'image': case 'icon': return not(IMAGE_OUT);
    case 'vector': return e === 'svg' || e === 'svgz' ? [T('png', 'PNG'), T('jpg', 'JPEG'), T('webp', 'WebP'), T('pdf', 'PDF'), T('ico', 'Windows icon (.ico)'), T('icns', 'Mac icon (.icns)')] : [T('pdf', 'PDF', { engine: e === 'eps' ? 'ghostscript' : undefined }), T('png', 'PNG', { engine: e === 'eps' ? 'ghostscript' : undefined }), T('svg', 'SVG', { engine: 'poppler' })];
    case 'pdf': return [T('docx', 'Word (.docx)'), T('png', 'PNG pictures'), T('jpg', 'JPEG pictures'), T('svg', 'SVG drawings', { engine: 'poppler' }), T('cbz', 'Comic book (.cbz)'), T('txt', 'Plain text'), T('md', 'Markdown'), T('html', 'Web page'), T('json', 'JSON (text by page)'), T('csv', 'CSV (tables)'), T('xlsx', 'Excel (tables)'), T('epub', 'E-book (EPUB)', { engine: 'pandoc' })];
    case 'document': {
      if (['pptx', 'ppt', 'odp', 'key'].includes(e)) return [T('pdf', 'PDF', { engine: 'office' }), T('png', 'Pictures of each slide', { engine: 'office' }), T('pptx', 'PowerPoint', { engine: 'office' }), T('odp', 'OpenDocument presentation', { engine: 'office' })].filter((t) => t.format !== e);
      return not(DOC_OUT);
    }
    case 'ebook': return e === 'cbz' || e === 'cbr' ? [T('pdf', 'PDF'), T('zip', 'Pictures (ZIP)')] : not([T('pdf', 'PDF'), T('html', 'Web page'), T('md', 'Markdown'), T('txt', 'Plain text'), T('docx', 'Word (.docx)'), T('epub', 'EPUB', { engine: 'calibre' }), T('mobi', 'Kindle (MOBI)', { engine: 'calibre' }), T('azw3', 'Kindle (AZW3)', { engine: 'calibre' }), T('fb2', 'FictionBook', { engine: 'calibre' })]);
    case 'sheet': return [...not(DATA_OUT), T('pdf', 'PDF', { engine: 'office' })];
    case 'data': return [...not(DATA_OUT), T('pdf', 'PDF (table)')];
    case 'subtitle': return not([T('srt', 'SubRip (.srt)'), T('vtt', 'WebVTT (.vtt)'), T('ass', 'Advanced SubStation (.ass)'), T('lrc', 'Lyrics (.lrc)'), T('sbv', 'YouTube (.sbv)'), T('txt', 'Plain text'), T('json', 'JSON')]);
    case 'calendar': return [T('csv', 'CSV'), T('json', 'JSON'), T('xlsx', 'Excel (.xlsx)'), T('html', 'Web page')];
    case 'contacts': return [T('csv', 'CSV'), T('json', 'JSON'), T('xlsx', 'Excel (.xlsx)'), T('html', 'Web page')];
    case 'notebook': return [T('html', 'Web page'), T('md', 'Markdown'), T('py', 'Script'), T('pdf', 'PDF')];
    case 'mail': return [T('pdf', 'PDF'), T('html', 'Web page'), T('md', 'Markdown'), T('txt', 'Plain text'), ...(e === 'msg' ? [T('eml', 'Standard e-mail (.eml)')] : [])];
    case 'mailbox': return [T('eml', 'Separate messages (.eml)'), T('csv', 'Index (CSV)')];
    case 'font': return not([T('ttf', 'TrueType'), T('otf', 'OpenType'), T('woff', 'WOFF'), T('woff2', 'WOFF2')]).filter((t) => !((e === 'ttf' && t.format === 'otf') || (e === 'otf' && t.format === 'ttf')));
    case 'model': return not([T('glb', 'glTF binary (.glb)'), T('gltf', 'glTF'), T('stl', 'STL'), T('obj', 'OBJ'), T('ply', 'PLY')]);
    case 'cad': return [T('svg', 'SVG'), T('png', 'PNG'), T('pdf', 'PDF')];
    case 'archive': return not([T('zip', 'ZIP'), T('tar', 'TAR'), T('tgz', 'Compressed TAR (.tgz)')]);
    case 'audio': return not([T('mp3', 'MP3'), T('m4a', 'M4A'), T('wav', 'WAV'), T('flac', 'FLAC'), T('ogg', 'Ogg'), T('aiff', 'AIFF'), T('opus', 'Opus')]);
    case 'video': return not([T('mp4', 'MP4'), T('webm', 'WebM'), T('mov', 'MOV'), T('mkv', 'MKV'), T('gif', 'Animated GIF'), T('mp3', 'Sound only (MP3)'), T('m4a', 'Sound only (M4A)')]);
    case 'diagram': return e === 'dot' || e === 'gv' ? [T('svg', 'SVG', { engine: 'graphviz' }), T('png', 'PNG', { engine: 'graphviz' }), T('pdf', 'PDF', { engine: 'graphviz' })] : [];
    default: return [];
  }
}

/** Every pair the converter knows, for the format table in the docs and the smoke test. */
export function allRoutes(): { from: string; to: string; engine?: string }[] {
  const out: { from: string; to: string; engine?: string }[] = [];
  for (const ext of Object.keys(FAMILY)) for (const t of targetsFor(ext)) out.push({ from: ext, to: t.format, engine: t.engine });
  return out;
}
