// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The PDF reader's edits, written into a real PDF: highlights, underlines,
// notes, freehand ink and text boxes as standard PDF annotations (each with
// its own appearance, so every PDF reader shows them the same), signatures
// drawn onto the page, form fields filled in, and pages reordered, turned,
// removed or added from other PDFs. Pure (pdf-lib, no files, no windows).

import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString, PDFHexString, PDFCheckBox, PDFDropdown, PDFOptionList, PDFRadioGroup, PDFTextField, StandardFonts, degrees, type PDFFont, type PDFPage, type PDFRef } from 'pdf-lib';

/** A rectangle in PDF points on the page as stored (unturned): x, y from the bottom left, width, height. */
export type Rect = [x: number, y: number, w: number, h: number];

/** One page of the result: which PDF it comes from (0 = the open one, 1… = added ones), its page there, and a turn on top of its own. */
export interface PageRef { src: number; index: number; rotate: number }

export type Annot =
  | { id: string; page: number; kind: 'highlight' | 'underline'; rects: Rect[]; color: string; text?: string }
  | { id: string; page: number; kind: 'note'; at: [number, number]; text: string; color: string }
  | { id: string; page: number; kind: 'ink'; paths: [number, number][][]; color: string; width: number }
  | { id: string; page: number; kind: 'text'; rect: Rect; text: string; size: number; color: string }
  | { id: string; page: number; kind: 'signature'; rect: Rect; png: string };

export interface PdfEdits {
  /** the pages of the result, in order (`page` in each annotation is a position in this list) */
  pages: PageRef[];
  annots: Annot[];
  /** form fields by name: text, a ticked box, or the chosen option */
  fields?: Record<string, string | boolean>;
}

/** The colours offered for marking up (names stay the same across themes). */
export const MARK_COLOURS: { id: string; label: string; hex: string }[] = [
  { id: 'yellow', label: 'Yellow', hex: '#ffd43b' },
  { id: 'green', label: 'Green', hex: '#69db7c' },
  { id: 'blue', label: 'Blue', hex: '#4dabf7' },
  { id: 'pink', label: 'Pink', hex: '#f783ac' },
  { id: 'red', label: 'Red', hex: '#e03131' },
  { id: 'black', label: 'Black', hex: '#212529' },
];

export function rgb(hex: string): [number, number, number] {
  const m = hex.replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  return m ? [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255] : [1, 0.83, 0.23];
}

const n = (v: number) => (Math.round(v * 1000) / 1000).toString();
const col = (hex: string) => rgb(hex).map(n).join(' ');

/** The four corners a highlight or underline covers, in the order PDF readers expect (top left, top right, bottom left, bottom right). */
export function quadPoints(rects: Rect[]): number[] {
  return rects.flatMap(([x, y, w, h]) => [x, y + h, x + w, y + h, x, y, x + w, y]);
}

/** The rectangle around a set of rectangles or points, with some room. */
export function bounds(rects: Rect[], pad = 0): Rect {
  const xs = rects.flatMap(([x, , w]) => [x, x + w]);
  const ys = rects.flatMap(([, y, , h]) => [y, y + h]);
  const x0 = Math.min(...xs) - pad;
  const y0 = Math.min(...ys) - pad;
  return [x0, y0, Math.max(...xs) + pad - x0, Math.max(...ys) + pad - y0];
}

/** Lines of text for a text box, wrapped to its width (a rough width per letter for Helvetica). */
export function wrapText(text: string, width: number, size: number, measure: (s: string) => number = (s) => s.length * size * 0.5): string[] {
  const out: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (line && measure(next) > width) { out.push(line); line = word; } else line = next;
    }
    out.push(line);
  }
  return out;
}

/** Only what the standard Helvetica font can show; other letters become "?". */
export function winAnsiSafe(s: string): string {
  return s.replace(/[‘’]/g, '\'').replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...').replace(/[^\x20-\x7e\xa0-\xff\n]/g, '?');
}

function moveOrder(pages: PageRef[]): string {
  return pages.map((p) => `${p.src}:${p.index}:${p.rotate}`).join(',');
}

/** True when the pages are the open PDF's own, all of them, in order and unturned (nothing to rebuild). */
export function pagesUnchanged(pages: PageRef[], count: number): boolean {
  return pages.length === count && moveOrder(pages) === moveOrder(Array.from({ length: count }, (_, i) => ({ src: 0, index: i, rotate: 0 })));
}

/** Writes every edit into the PDF and returns the new file's bytes. */
export async function applyEdits(main: Uint8Array, added: Uint8Array[], e: PdfEdits): Promise<Uint8Array> {
  const doc = await PDFDocument.load(main, { updateMetadata: false });
  // Form fields first, while they still point at their pages.
  if (e.fields && Object.keys(e.fields).length) fillFields(doc, e.fields);
  const own = doc.getPages();
  if (!pagesUnchanged(e.pages, own.length)) {
    const extras = await Promise.all(added.map((b) => PDFDocument.load(b, { updateMetadata: false })));
    const copied = new Map<string, PDFPage>();
    for (const [i, x] of extras.entries()) {
      const want = e.pages.filter((p) => p.src === i + 1).map((p) => p.index);
      if (!want.length) continue;
      const pages = await doc.copyPages(x, [...new Set(want)]);
      [...new Set(want)].forEach((idx, k) => copied.set(`${i + 1}:${idx}`, pages[k]));
    }
    const final = e.pages.map((p) => {
      const page = p.src === 0 ? own[p.index] : copied.get(`${p.src}:${p.index}`);
      if (!page) throw new Error('A page is missing from its PDF');
      return { page, rotate: p.rotate };
    });
    // The same page twice needs its own copy.
    const used = new Set<PDFPage>();
    for (const f of final) {
      if (used.has(f.page)) f.page = (await doc.copyPages(doc, [own.indexOf(f.page)]))[0];
      used.add(f.page);
    }
    for (let i = doc.getPageCount() - 1; i >= 0; i--) doc.removePage(i);
    for (const f of final) {
      doc.addPage(f.page);
      if (f.rotate) f.page.setRotation(degrees((f.page.getRotation().angle + f.rotate) % 360));
    }
  }
  const pages = doc.getPages();
  const font = e.annots.some((a) => a.kind === 'text') ? await doc.embedFont(StandardFonts.Helvetica) : undefined;
  for (const a of e.annots) {
    const page = pages[a.page];
    if (!page) continue;
    if (a.kind === 'signature') { await drawSignature(doc, page, a); continue; }
    addAnnot(doc, page, a, font);
  }
  return doc.save();
}

function fillFields(doc: PDFDocument, fields: Record<string, string | boolean>) {
  const form = doc.getForm();
  for (const f of form.getFields()) {
    const name = f.getName();
    if (!(name in fields)) continue;
    const v = fields[name];
    try {
      if (f instanceof PDFTextField) f.setText(String(v ?? ''));
      else if (f instanceof PDFCheckBox) { if (v === true || v === 'Yes' || v === 'On') f.check(); else f.uncheck(); }
      else if (f instanceof PDFDropdown || f instanceof PDFOptionList) { if (typeof v === 'string' && v) f.select(v); }
      else if (f instanceof PDFRadioGroup) { if (typeof v === 'string' && v) f.select(v); }
    } catch { /* a value the field does not accept is left as it was */ }
  }
}

async function drawSignature(doc: PDFDocument, page: PDFPage, a: Extract<Annot, { kind: 'signature' }>) {
  const b64 = a.png.replace(/^data:image\/png;base64,/, '');
  const img = await doc.embedPng(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
  const [x, y, w, h] = a.rect;
  page.drawImage(img, { x, y, width: w, height: h });
}

function annotsOf(doc: PDFDocument, page: PDFPage): PDFArray {
  const existing = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  if (existing) return existing;
  const arr = doc.context.obj([]);
  page.node.set(PDFName.of('Annots'), arr);
  return arr;
}

function appearance(doc: PDFDocument, bbox: Rect, ops: string, resources?: Record<string, unknown>): PDFRef {
  const stream = doc.context.stream(ops, {
    Type: 'XObject', Subtype: 'Form', BBox: [bbox[0], bbox[1], bbox[0] + bbox[2], bbox[1] + bbox[3]], ...(resources ? { Resources: resources } : {}),
  } as never);
  return doc.context.register(stream);
}

function addAnnot(doc: PDFDocument, page: PDFPage, a: Exclude<Annot, { kind: 'signature' }>, font?: PDFFont) {
  const ctx = doc.context;
  const base: Record<string, unknown> = { Type: 'Annot', F: 4, M: PDFString.fromDate(new Date()), NM: PDFString.of(a.id), T: PDFHexString.fromText('Keeper') };
  let dict: Record<string, unknown>;
  if (a.kind === 'highlight' || a.kind === 'underline') {
    const r = bounds(a.rects, 1);
    const gs = ctx.obj({ Type: 'ExtGState', CA: 1, ca: a.kind === 'highlight' ? 0.4 : 1, BM: a.kind === 'highlight' ? 'Multiply' : 'Normal' });
    const ops = a.kind === 'highlight'
      ? `/GS0 gs ${col(a.color)} rg ${a.rects.map(([x, y, w, h]) => `${n(x)} ${n(y)} ${n(w)} ${n(h)} re`).join(' ')} f`
      : `${col(a.color)} RG 1 w ${a.rects.map(([x, y, w]) => `${n(x)} ${n(y + 1)} m ${n(x + w)} ${n(y + 1)} l`).join(' ')} S`;
    dict = {
      ...base, Subtype: a.kind === 'highlight' ? 'Highlight' : 'Underline', Rect: [r[0], r[1], r[0] + r[2], r[1] + r[3]], QuadPoints: quadPoints(a.rects), C: rgb(a.color),
      ...(a.kind === 'highlight' ? { CA: 0.4 } : {}), ...(a.text ? { Contents: PDFHexString.fromText(a.text) } : {}),
      AP: { N: appearance(doc, r, ops, a.kind === 'highlight' ? { ExtGState: { GS0: gs } } : undefined) },
    };
  } else if (a.kind === 'note') {
    const [x, y] = a.at;
    const r: Rect = [x, y - 20, 20, 20];
    const ops = `${col(a.color)} rg 0.2 0.2 0.2 RG 0.6 w ${n(x + 1)} ${n(y - 15)} 18 14 re B ${n(x + 4)} ${n(y - 15)} m ${n(x + 4)} ${n(y - 19)} l ${n(x + 8)} ${n(y - 15)} l f 0.2 0.2 0.2 rg ${n(x + 4)} ${n(y - 6)} 12 1 re f ${n(x + 4)} ${n(y - 9)} 12 1 re f ${n(x + 4)} ${n(y - 12)} 8 1 re f`;
    dict = { ...base, Subtype: 'Text', Name: 'Comment', Open: false, Rect: [r[0], r[1], r[0] + r[2], r[1] + r[3]], Contents: PDFHexString.fromText(a.text), C: rgb(a.color), AP: { N: appearance(doc, r, ops) } };
  } else if (a.kind === 'ink') {
    const pts = a.paths.flat();
    if (!pts.length) return;
    const r = bounds(pts.map(([x, y]) => [x, y, 0, 0] as Rect), a.width + 1);
    const ops = `${col(a.color)} RG ${n(a.width)} w 1 J 1 j ${a.paths.filter((p) => p.length).map((p) => `${n(p[0][0])} ${n(p[0][1])} m ${p.slice(1).map(([x, y]) => `${n(x)} ${n(y)} l`).join(' ')}${p.length === 1 ? ` ${n(p[0][0] + 0.1)} ${n(p[0][1])} l` : ''}`).join(' ')} S`;
    dict = { ...base, Subtype: 'Ink', Rect: [r[0], r[1], r[0] + r[2], r[1] + r[3]], InkList: a.paths.map((p) => p.flat()), C: rgb(a.color), BS: { W: a.width, S: 'S' }, AP: { N: appearance(doc, r, ops) } };
  } else if (a.kind === 'text') {
    const [x, y, w, h] = a.rect;
    const text = winAnsiSafe(a.text);
    const lines = font ? wrapText(text, w - 4, a.size, (s) => font.widthOfTextAtSize(s, a.size)) : [text];
    const lead = a.size * 1.2;
    const body = lines.map((l, i) => `1 0 0 1 ${n(x + 2)} ${n(y + h - 2 - a.size - i * lead)} Tm ${font ? font.encodeText(l).toString() : `(${l})`} Tj`).join(' ');
    const ops = `BT /F1 ${n(a.size)} Tf ${col(a.color)} rg ${body} ET`;
    dict = {
      ...base, Subtype: 'FreeText', Rect: [x, y, x + w, y + h], Contents: PDFHexString.fromText(a.text), DA: PDFString.of(`/Helv ${n(a.size)} Tf ${col(a.color)} rg`), BS: { W: 0 },
      AP: { N: appearance(doc, a.rect, ops, font ? { Font: { F1: font.ref } } : undefined) },
    };
  } else return;
  const ref = ctx.register(ctx.obj(dict as never));
  (ctx.lookup(ref) as PDFDict).set(PDFName.of('P'), page.ref);
  annotsOf(doc, page).push(ref);
}

/** What a saved PDF holds, for tests and the "saved" check: pages, their turns, and annotation kinds per page. */
export async function describePdf(bytes: Uint8Array): Promise<{ pages: number; rotations: number[]; annots: string[][]; fields: Record<string, string | boolean> }> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const pages = doc.getPages();
  const fields: Record<string, string | boolean> = {};
  try {
    for (const f of doc.getForm().getFields()) {
      if (f instanceof PDFTextField) fields[f.getName()] = f.getText() ?? '';
      else if (f instanceof PDFCheckBox) fields[f.getName()] = f.isChecked();
      else if (f instanceof PDFDropdown) fields[f.getName()] = f.getSelected()[0] ?? '';
    }
  } catch { /* no form */ }
  return {
    pages: pages.length,
    rotations: pages.map((p) => p.getRotation().angle),
    annots: pages.map((p) => {
      const arr = p.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
      if (!arr) return [];
      return arr.asArray().map((r) => {
        const d = doc.context.lookup(r) as PDFDict | undefined;
        const st = d?.lookupMaybe(PDFName.of('Subtype'), PDFName);
        return st ? st.decodeText() : '?';
      });
    }),
    fields,
  };
}


/** The PDF reader's calls (electron/services/pdf-reader.ts). */
export interface PdfReaderApi {
  /** the file's bytes, to show it */
  read(path: string): Promise<Uint8Array>;
  pick(): Promise<string | null>;
  /** PDFs to add pages from */
  pickMore(): Promise<string[]>;
  /** writes the edits into the file (or a copy, chosen in a save window); null when the save window was closed */
  save(path: string, edits: PdfEdits, added: string[], copy?: boolean): Promise<{ path: string } | null>;
  /** whether the version before the last save is kept, and putting it back */
  hasBackup(path: string): Promise<boolean>;
  restore(path: string): Promise<boolean>;
}
