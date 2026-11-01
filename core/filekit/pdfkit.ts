// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Page tools for PDFs that need nothing but the PDF itself: arranging,
// imposing, stamping, outlines, labels, metadata, attachments and cleaning.
// Bytes in, bytes out, so the app, the command line and the tests share them.

import {
  degrees, PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFPage, PDFRef, PDFString, rgb, StandardFonts,
  type PDFEmbeddedPage, type PDFFont,
} from 'pdf-lib';
import { inflateRawSync, inflateSync } from 'node:zlib';
import { parsePageRanges } from '../convert';

export const PAPER: Record<string, [number, number]> = {
  a3: [841.89, 1190.55], a4: [595.28, 841.89], a5: [419.53, 595.28], letter: [612, 792], legal: [612, 1008], tabloid: [792, 1224],
};

export async function load(bytes: Uint8Array): Promise<PDFDocument> {
  return PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
}

async function save(doc: PDFDocument): Promise<Uint8Array> {
  return doc.save({ useObjectStreams: true });
}

/** Visible page size (crop box, turned by the page's rotation). */
export function visibleSize(page: PDFPage): { width: number; height: number } {
  const { width, height } = page.getSize();
  const r = ((page.getRotation().angle % 360) + 360) % 360;
  return r === 90 || r === 270 ? { width: height, height: width } : { width, height };
}

/** Draws a page upright into a box on another page, scaled to fit and centred. */
function drawFitted(target: PDFPage, src: PDFEmbeddedPage, srcRotation: number, box: { x: number; y: number; w: number; h: number }, angle = 0) {
  const r = (((srcRotation + angle) % 360) + 360) % 360;
  const turned = r === 90 || r === 270;
  const w = turned ? src.height : src.width;
  const h = turned ? src.width : src.height;
  const s = Math.min(box.w / w, box.h / h);
  const dw = w * s;
  const dh = h * s;
  const ox = box.x + (box.w - dw) / 2;
  const oy = box.y + (box.h - dh) / 2;
  // pdf-lib rotates around the drawing origin; shift so the turned page lands in the box.
  const at = r === 90 ? { x: ox + dw, y: oy } : r === 180 ? { x: ox + dw, y: oy + dh } : r === 270 ? { x: ox, y: oy + dh } : { x: ox, y: oy };
  target.drawPage(src, { x: at.x, y: at.y, xScale: s, yScale: s, rotate: degrees(r) });
}

/** Pages with no content stream (blank pages) get an empty one, so they can be drawn elsewhere. */
function fillEmpty(doc: PDFDocument, pages: PDFPage[]) {
  for (const p of pages) if (!p.node.Contents()) p.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream('')));
}

async function embedAll(out: PDFDocument, src: PDFDocument, indices?: number[]): Promise<{ page: PDFEmbeddedPage; rotation: number }[]> {
  const idx = indices ?? src.getPageIndices();
  const pages = idx.map((i) => src.getPage(i));
  fillEmpty(src, pages);
  const embedded = await out.embedPages(pages);
  return embedded.map((page, i) => ({ page, rotation: pages[i].getRotation().angle }));
}

// ---------------------------------------------------------------- arranging

export async function reverse(bytes: Uint8Array): Promise<Uint8Array> {
  const src = await load(bytes);
  const out = await PDFDocument.create();
  const order = src.getPageIndices().reverse();
  for (const p of await out.copyPages(src, order)) out.addPage(p);
  return save(out);
}

/**
 * Pages from several PDFs taken in turn: A1 B1 A2 B2 … Duplex collate is the
 * same with the second file reversed (the back sides scanned last-page-first).
 */
export async function alternate(files: Uint8Array[], o: { reverseSecond?: boolean } = {}): Promise<Uint8Array> {
  if (files.length < 2) throw new Error('Choose at least two PDFs to mix');
  const docs = await Promise.all(files.map(load));
  const out = await PDFDocument.create();
  const lists = docs.map((d, i) => {
    const idx = d.getPageIndices();
    return i === 1 && o.reverseSecond ? idx.reverse() : idx;
  });
  const longest = Math.max(...lists.map((l) => l.length));
  for (let n = 0; n < longest; n++) {
    for (let f = 0; f < docs.length; f++) {
      if (n >= lists[f].length) continue;
      const [p] = await out.copyPages(docs[f], [lists[f][n]]);
      out.addPage(p);
    }
  }
  return save(out);
}

/** Groups of pages for dividing a PDF: every N pages, into N equal parts, or at chosen pages. */
export function divideGroups(count: number, o: { every?: number; parts?: number; at?: string }): number[][] {
  const all = Array.from({ length: count }, (_, i) => i);
  if (o.at?.trim()) {
    const cuts = [...new Set(parsePageRanges(o.at, count))].filter((i) => i > 0).sort((a, b) => a - b);
    const groups: number[][] = [];
    let start = 0;
    for (const c of cuts) { groups.push(all.slice(start, c)); start = c; }
    groups.push(all.slice(start));
    return groups.filter((g) => g.length);
  }
  const every = o.parts ? Math.ceil(count / Math.max(1, o.parts)) : Math.max(1, o.every ?? 1);
  const groups: number[][] = [];
  for (let i = 0; i < count; i += every) groups.push(all.slice(i, i + every));
  return groups;
}

export async function pickPages(bytes: Uint8Array, indices: number[]): Promise<Uint8Array> {
  const src = await load(bytes);
  const out = await PDFDocument.create();
  for (const p of await out.copyPages(src, indices)) out.addPage(p);
  return save(out);
}

export async function pageCount(bytes: Uint8Array): Promise<number> {
  return (await load(bytes)).getPageCount();
}

/** Turns pages by any angle: the page grows so nothing is cut off. */
export async function rotateAny(bytes: Uint8Array, angle: number, pages = ''): Promise<Uint8Array> {
  const a = ((angle % 360) + 360) % 360;
  const src = await load(bytes);
  const chosen = new Set(parsePageRanges(pages, src.getPageCount()));
  if (a % 90 === 0) {
    for (const i of chosen) { const p = src.getPage(i); p.setRotation(degrees((p.getRotation().angle + a) % 360)); }
    return save(src);
  }
  const out = await PDFDocument.create();
  fillEmpty(src, src.getPages());
  const rad = (a * Math.PI) / 180;
  for (const i of src.getPageIndices()) {
    if (!chosen.has(i)) { const [p] = await out.copyPages(src, [i]); out.addPage(p); continue; }
    const page = src.getPage(i);
    const [e] = await out.embedPages([page]);
    const { width: w, height: h } = e;
    const W = Math.abs(w * Math.cos(rad)) + Math.abs(h * Math.sin(rad));
    const H = Math.abs(w * Math.sin(rad)) + Math.abs(h * Math.cos(rad));
    const np = out.addPage([W, H]);
    // Counter-clockwise by `a` about the page centre.
    const cx = W / 2 - (w / 2) * Math.cos(rad) + (h / 2) * Math.sin(rad);
    const cy = H / 2 - (w / 2) * Math.sin(rad) - (h / 2) * Math.cos(rad);
    np.drawPage(e, { x: cx, y: cy, rotate: degrees(a) });
  }
  return save(out);
}

/** Several pages on one sheet (2, 4, 6, 8, 9 or 16), in reading order. */
export async function nUp(bytes: Uint8Array, per: number, o: { paper?: string; landscape?: boolean; margin?: number; border?: boolean } = {}): Promise<Uint8Array> {
  const grid: Record<number, [number, number]> = { 2: [2, 1], 4: [2, 2], 6: [3, 2], 8: [4, 2], 9: [3, 3], 16: [4, 4] };
  const g = grid[per];
  if (!g) throw new Error('Choose 2, 4, 6, 8, 9 or 16 pages per sheet');
  const src = await load(bytes);
  const out = await PDFDocument.create();
  const pages = await embedAll(out, src);
  const [pw, ph] = PAPER[o.paper ?? 'a4'] ?? PAPER.a4;
  // Two and six/eight per sheet read best on a landscape sheet.
  const land = o.landscape ?? (per === 2 || per === 6 || per === 8);
  const [W, H] = land ? [ph, pw] : [pw, ph];
  let [cols, rows] = g;
  if (!land && cols > rows) [cols, rows] = [rows, cols];
  const m = o.margin ?? 18;
  const cw = (W - 2 * m) / cols;
  const ch = (H - 2 * m) / rows;
  for (let i = 0; i < pages.length; i += per) {
    const sheet = out.addPage([W, H]);
    for (let k = 0; k < per && i + k < pages.length; k++) {
      const c = k % cols;
      const r = Math.floor(k / cols);
      const box = { x: m + c * cw + 4, y: H - m - (r + 1) * ch + 4, w: cw - 8, h: ch - 8 };
      drawFitted(sheet, pages[i + k].page, pages[i + k].rotation, box);
      if (o.border) sheet.drawRectangle({ x: box.x, y: box.y, width: box.w, height: box.h, borderColor: rgb(0.7, 0.7, 0.7), borderWidth: 0.5 });
    }
  }
  return save(out);
}

/** Order of pages for a saddle-stitched booklet: each sheet side holds two pages. */
export function bookletOrder(count: number): [number, number][] {
  const n = Math.ceil(count / 4) * 4;
  const sides: [number, number][] = [];
  for (let i = 0; i < n / 2; i += 2) {
    sides.push([n - 1 - i, i]); // front: last, first
    sides.push([i + 1, n - 2 - i]); // back: second, second-to-last
  }
  return sides.map(([a, b]) => [a < count ? a : -1, b < count ? b : -1]);
}

export async function booklet(bytes: Uint8Array, o: { paper?: string } = {}): Promise<Uint8Array> {
  const src = await load(bytes);
  const out = await PDFDocument.create();
  const pages = await embedAll(out, src);
  const [pw, ph] = PAPER[o.paper ?? 'a4'] ?? PAPER.a4;
  const [W, H] = [ph, pw];
  for (const [l, r] of bookletOrder(pages.length)) {
    const sheet = out.addPage([W, H]);
    if (l >= 0) drawFitted(sheet, pages[l].page, pages[l].rotation, { x: 0, y: 0, w: W / 2, h: H });
    if (r >= 0) drawFitted(sheet, pages[r].page, pages[r].rotation, { x: W / 2, y: 0, w: W / 2, h: H });
  }
  return save(out);
}

/** Every page stacked into one tall page (for reading on screens, or web captures). */
export async function singlePage(bytes: Uint8Array): Promise<Uint8Array> {
  const src = await load(bytes);
  const out = await PDFDocument.create();
  const pages = await embedAll(out, src);
  const sizes = pages.map((p) => { const t = p.rotation % 180 !== 0; return { w: t ? p.page.height : p.page.width, h: t ? p.page.width : p.page.height }; });
  const W = Math.max(...sizes.map((s) => s.w));
  const H = sizes.reduce((n, s) => n + s.h, 0);
  if (H > 14_400) throw new Error('Too tall for one page: PDF pages can be at most 200 inches (about 25 ordinary pages)');
  const sheet = out.addPage([W, H]);
  let y = H;
  pages.forEach((p, i) => {
    y -= sizes[i].h;
    drawFitted(sheet, p.page, p.rotation, { x: (W - sizes[i].w) / 2, y, w: sizes[i].w, h: sizes[i].h });
  });
  return save(out);
}

/** Lays another PDF over (or under) every page: letterheads, forms, backgrounds. */
export async function overlay(bytes: Uint8Array, layer: Uint8Array, o: { under?: boolean; repeat?: boolean } = {}): Promise<Uint8Array> {
  const doc = await load(bytes);
  const lay = await load(layer);
  fillEmpty(lay, lay.getPages());
  const embedded = await doc.embedPages(lay.getPages());
  doc.getPages().forEach((page, i) => {
    const e = o.repeat === false ? embedded[i] : embedded[i % embedded.length];
    if (!e) return;
    const { width, height } = page.getSize();
    if (!o.under) { page.drawPage(e, { x: 0, y: 0, width, height }); return; }
    // Underlay: put the layer first in the page's content.
    page.drawPage(e, { x: 0, y: 0, width, height });
    const contents = page.node.Contents();
    if (contents instanceof PDFArray && contents.size() > 1) {
      const last = contents.get(contents.size() - 1);
      contents.remove(contents.size() - 1);
      contents.insert(0, last);
    }
  });
  return save(doc);
}

/** Cuts each page into tiles that print on ordinary paper and tape together into a poster. */
export async function poster(bytes: Uint8Array, o: { across: number; down: number; overlap?: number }): Promise<Uint8Array> {
  const src = await load(bytes);
  const out = await PDFDocument.create();
  const pages = await embedAll(out, src);
  const ov = o.overlap ?? 0;
  for (const { page } of pages) {
    const tw = page.width / o.across;
    const th = page.height / o.down;
    for (let r = 0; r < o.down; r++) {
      for (let c = 0; c < o.across; c++) {
        const [pw, ph] = PAPER.a4;
        const land = tw > th;
        const [W, H] = land ? [ph, pw] : [pw, ph];
        const s = Math.min(W / (tw + 2 * ov), H / (th + 2 * ov));
        const sheet = out.addPage([W, H]);
        const x0 = c * tw - ov;
        const y0 = page.height - (r + 1) * th - ov;
        sheet.drawPage(page, { x: -x0 * s + (W - (tw + 2 * ov) * s) / 2, y: -y0 * s + (H - (th + 2 * ov) * s) / 2, xScale: s, yScale: s });
        sheet.drawText(`${r + 1}/${c + 1}`, { x: 6, y: 6, size: 7, color: rgb(0.5, 0.5, 0.5) });
      }
    }
  }
  return save(out);
}

/** Crop boxes: trims the same margin from every page, or sets exact boxes found by looking at the pages. */
export async function crop(bytes: Uint8Array, o: { margins?: { top: number; right: number; bottom: number; left: number }; boxes?: ({ x: number; y: number; w: number; h: number } | null)[] }): Promise<Uint8Array> {
  const doc = await load(bytes);
  doc.getPages().forEach((p, i) => {
    const mb = p.getMediaBox();
    const box = o.boxes?.[i];
    if (box) {
      // Fractions of the page from its top-left corner, padded a little.
      const pad = 6;
      const x = mb.x + box.x * mb.width - pad;
      const y = mb.y + (1 - box.y - box.h) * mb.height - pad;
      p.setCropBox(Math.max(mb.x, x), Math.max(mb.y, y), Math.min(mb.width, box.w * mb.width + 2 * pad), Math.min(mb.height, box.h * mb.height + 2 * pad));
    } else if (o.margins) {
      const m = o.margins;
      if (m.left + m.right >= mb.width || m.top + m.bottom >= mb.height) throw new Error('The margins are bigger than the page');
      p.setCropBox(mb.x + m.left, mb.y + m.bottom, mb.width - m.left - m.right, mb.height - m.top - m.bottom);
    }
  });
  return save(doc);
}

/** Every page on the same paper size, scaled to fit and centred. */
export async function fitPaper(bytes: Uint8Array, paper: string, o: { orientation?: 'auto' | 'portrait' | 'landscape' } = {}): Promise<Uint8Array> {
  const size = PAPER[paper];
  if (!size) throw new Error(`Unknown paper size ${paper}`);
  const src = await load(bytes);
  const out = await PDFDocument.create();
  const pages = await embedAll(out, src);
  for (const p of pages) {
    const turned = p.rotation % 180 !== 0;
    const wide = (turned ? p.page.height : p.page.width) > (turned ? p.page.width : p.page.height);
    const land = o.orientation === 'landscape' || (o.orientation !== 'portrait' && wide);
    const [W, H] = land ? [size[1], size[0]] : size;
    drawFitted(out.addPage([W, H]), p.page, p.rotation, { x: 0, y: 0, w: W, h: H });
  }
  return save(out);
}

export interface PageFacts { page: number; width: number; height: number; rotation: number; paper?: string; widthMm: number; heightMm: number }

export async function dimensions(bytes: Uint8Array): Promise<PageFacts[]> {
  const doc = await load(bytes);
  return doc.getPages().map((p, i) => {
    const { width, height } = visibleSize(p);
    const paper = Object.entries(PAPER).find(([, [w, h]]) => (Math.abs(w - width) < 3 && Math.abs(h - height) < 3) || (Math.abs(h - width) < 3 && Math.abs(w - height) < 3))?.[0];
    return { page: i + 1, width: Math.round(width * 100) / 100, height: Math.round(height * 100) / 100, rotation: p.getRotation().angle, paper, widthMm: Math.round((width / 72) * 254) / 10, heightMm: Math.round((height / 72) * 254) / 10 };
  });
}

// ---------------------------------------------------------------- text on pages

export type Spot = 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right' | 'center';

function placeText(page: PDFPage, text: string, font: PDFFont, size: number, spot: Spot, margin = 24) {
  const { width, height } = page.getSize();
  const { x: bx, y: by } = page.getCropBox();
  const w = font.widthOfTextAtSize(text, size);
  const x = spot.endsWith('left') ? bx + margin : spot.endsWith('right') ? bx + width - margin - w : bx + (width - w) / 2;
  const y = spot.startsWith('top') ? by + height - margin - size : spot === 'center' ? by + height / 2 : by + margin;
  return { x, y };
}

/** Fills {page}, {pages}, {date}, {file}, {n} (Bates number) in header and footer text. */
export function fillTokens(t: string, v: { page: number; pages: number; file?: string; date?: string; bates?: string }): string {
  return t
    .replace(/\{page\}/g, String(v.page))
    .replace(/\{pages\}/g, String(v.pages))
    .replace(/\{date\}/g, v.date ?? new Date().toISOString().slice(0, 10))
    .replace(/\{file\}/g, v.file ?? '')
    .replace(/\{n\}/g, v.bates ?? '');
}

/** Latin-1 only for the standard fonts: anything else becomes "?" rather than failing. */
export function winAnsi(s: string): string {
  return s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, '-').replace(/…/g, '...').replace(/[^\x20-\x7e\xa0-\xff]/g, '?');
}

export interface HeaderFooter { left?: string; center?: string; right?: string; size?: number; margin?: number; color?: [number, number, number]; pages?: string }

/** Text in the header and footer of every page, with page numbers, dates and the file name. */
export async function headerFooter(bytes: Uint8Array, o: { header?: HeaderFooter; footer?: HeaderFooter; file?: string; firstNumber?: number }): Promise<Uint8Array> {
  const doc = await load(bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  for (const [where, hf] of [['top', o.header], ['bottom', o.footer]] as const) {
    if (!hf) continue;
    const on = new Set(parsePageRanges(hf.pages ?? '', pages.length));
    pages.forEach((p, i) => {
      if (!on.has(i)) return;
      for (const side of ['left', 'center', 'right'] as const) {
        const raw = hf[side];
        if (!raw) continue;
        const text = winAnsi(fillTokens(raw, { page: i + (o.firstNumber ?? 1), pages: pages.length, file: o.file }));
        const size = hf.size ?? 9;
        const at = placeText(p, text, font, size, `${where}-${side}` as Spot, hf.margin ?? 24);
        const c = hf.color ?? [0.2, 0.2, 0.2];
        p.drawText(text, { ...at, size, font, color: rgb(c[0], c[1], c[2]) });
      }
    });
  }
  return save(doc);
}

/** Bates number text: prefix + zero-padded number + suffix. */
export function batesLabel(n: number, o: { prefix?: string; suffix?: string; digits?: number }): string {
  return `${o.prefix ?? ''}${String(n).padStart(o.digits ?? 6, '0')}${o.suffix ?? ''}`;
}

/** Bates numbers across a set of PDFs, continuing from one file to the next. Returns the next free number. */
export async function bates(files: Uint8Array[], o: { prefix?: string; suffix?: string; digits?: number; start?: number; spot?: Spot; size?: number }): Promise<{ files: Uint8Array[]; next: number; ranges: [string, string][] }> {
  let n = o.start ?? 1;
  const out: Uint8Array[] = [];
  const ranges: [string, string][] = [];
  for (const bytes of files) {
    const doc = await load(bytes);
    const font = await doc.embedFont(StandardFonts.HelveticaBold);
    const first = n;
    for (const p of doc.getPages()) {
      const text = winAnsi(batesLabel(n++, o));
      const size = o.size ?? 9;
      p.drawText(text, { ...placeText(p, text, font, size, o.spot ?? 'bottom-right', 18), size, font, color: rgb(0, 0, 0) });
    }
    ranges.push([batesLabel(first, o), batesLabel(n - 1, o)]);
    out.push(await save(doc));
  }
  return { files: out, next: n, ranges };
}

export const STAMPS: Record<string, [number, number, number]> = {
  APPROVED: [0.1, 0.55, 0.2], DRAFT: [0.45, 0.45, 0.45], CONFIDENTIAL: [0.75, 0.1, 0.1], PAID: [0.1, 0.45, 0.75], COPY: [0.4, 0.4, 0.4],
  FINAL: [0.1, 0.4, 0.6], REJECTED: [0.75, 0.1, 0.1], RECEIVED: [0.2, 0.35, 0.7], VOID: [0.75, 0.1, 0.1], 'FOR REVIEW': [0.85, 0.5, 0.05],
};

/** A rubber stamp: bold text in a rounded border, slightly turned. */
export async function stamp(bytes: Uint8Array, o: { text: string; spot?: Spot; pages?: string; color?: [number, number, number]; size?: number; angle?: number; date?: boolean }): Promise<Uint8Array> {
  const doc = await load(bytes);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const small = await doc.embedFont(StandardFonts.Helvetica);
  const label = winAnsi(o.text.toUpperCase());
  const c = o.color ?? STAMPS[label] ?? [0.75, 0.1, 0.1];
  const color = rgb(c[0], c[1], c[2]);
  const size = o.size ?? 22;
  const on = new Set(parsePageRanges(o.pages ?? '', doc.getPageCount()));
  doc.getPages().forEach((p, i) => {
    if (!on.has(i)) return;
    const tw = font.widthOfTextAtSize(label, size);
    const bw = tw + 24;
    const bh = size + (o.date ? 22 : 14);
    const { width, height } = p.getSize();
    const spot = o.spot ?? 'top-right';
    const x = spot.endsWith('left') ? 36 : spot.endsWith('right') ? width - 36 - bw : (width - bw) / 2;
    const y = spot.startsWith('top') ? height - 36 - bh : spot === 'center' ? (height - bh) / 2 : 36;
    const rot = degrees(o.angle ?? -8);
    p.drawRectangle({ x, y, width: bw, height: bh, borderColor: color, borderWidth: 2.5, rotate: rot, opacity: 0, borderOpacity: 0.85 });
    const rad = ((o.angle ?? -8) * Math.PI) / 180;
    const along = (dx: number, dy: number) => ({ x: x + dx * Math.cos(rad) - dy * Math.sin(rad), y: y + dx * Math.sin(rad) + dy * Math.cos(rad) });
    p.drawText(label, { ...along(12, bh - size - 5), size, font, color, rotate: rot, opacity: 0.85 });
    if (o.date) p.drawText(new Date().toISOString().slice(0, 10), { ...along(12, 6), size: 9, font: small, color, rotate: rot, opacity: 0.85 });
  });
  return save(doc);
}

/** Text watermark with a chosen angle, size, colour and place, on chosen pages. */
export async function textWatermark(bytes: Uint8Array, o: { text: string; size?: number; opacity?: number; angle?: number; color?: [number, number, number]; pages?: string; tile?: boolean }): Promise<Uint8Array> {
  const doc = await load(bytes);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const text = winAnsi(o.text);
  const on = new Set(parsePageRanges(o.pages ?? '', doc.getPageCount()));
  const c = o.color ?? [0.5, 0.5, 0.5];
  doc.getPages().forEach((p, i) => {
    if (!on.has(i)) return;
    const { width, height } = p.getSize();
    const size = o.size ?? (o.tile ? 26 : Math.min(width, height) / Math.max(4, text.length * 0.55));
    const w = font.widthOfTextAtSize(text, size);
    const a = o.angle ?? 45;
    const rad = (a * Math.PI) / 180;
    const spots = o.tile ? tiles(width, height, w + 60, size * 4) : [{ x: width / 2, y: height / 2 }];
    for (const s of spots) {
      p.drawText(text, { x: s.x - (w / 2) * Math.cos(rad) + (size / 3) * Math.sin(rad), y: s.y - (w / 2) * Math.sin(rad) - (size / 3) * Math.cos(rad), size, font, color: rgb(c[0], c[1], c[2]), opacity: o.opacity ?? 0.2, rotate: degrees(a) });
    }
  });
  return save(doc);
}

function tiles(w: number, h: number, dx: number, dy: number) {
  const out: { x: number; y: number }[] = [];
  for (let y = dy / 2; y < h; y += dy) for (let x = dx / 2 + ((y / dy) % 2 ? dx / 2 : 0); x < w + dx / 2; x += dx) out.push({ x, y });
  return out;
}

/** A picture (PNG or JPEG) as a watermark or logo on chosen pages. */
export async function imageWatermark(bytes: Uint8Array, image: Uint8Array, o: { spot?: Spot; scale?: number; opacity?: number; pages?: string; angle?: number }): Promise<Uint8Array> {
  const doc = await load(bytes);
  const isPng = image[0] === 0x89 && image[1] === 0x50;
  const img = isPng ? await doc.embedPng(image) : await doc.embedJpg(image);
  const on = new Set(parsePageRanges(o.pages ?? '', doc.getPageCount()));
  doc.getPages().forEach((p, i) => {
    if (!on.has(i)) return;
    const { width, height } = p.getSize();
    const w = width * (o.scale ?? 0.3);
    const h = (img.height / img.width) * w;
    const spot = o.spot ?? 'center';
    const m = 24;
    const x = spot.endsWith('left') ? m : spot.endsWith('right') ? width - m - w : (width - w) / 2;
    const y = spot.startsWith('top') ? height - m - h : spot === 'center' ? (height - h) / 2 : m;
    p.drawImage(img, { x, y, width: w, height: h, opacity: o.opacity ?? 0.3, rotate: degrees(o.angle ?? 0) });
  });
  return save(doc);
}

// ---------------------------------------------------------------- outline, labels, contents

export interface Bookmark { title: string; page: number; children?: Bookmark[] }

/**
 * Bookmarks from plain text, one per line, indented by two spaces (or a tab)
 * per level: "Introduction | 1". The page is 1-based.
 */
export function parseBookmarks(text: string): Bookmark[] {
  const root: Bookmark[] = [];
  const stack: { level: number; list: Bookmark[] }[] = [{ level: -1, list: root }];
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const indent = raw.match(/^[\t ]*/)![0].replace(/\t/g, '  ').length;
    const level = Math.floor(indent / 2);
    const m = raw.trim().match(/^(.*?)\s*(?:\||\.{2,}|\t)\s*(\d+)\s*$/) ?? raw.trim().match(/^(.*?)\s+(\d+)$/);
    if (!m) throw new Error(`“${raw.trim()}” needs a page number, like “Chapter 1 | 3”`);
    const b: Bookmark = { title: m[1].trim(), page: Number(m[2]) };
    while (stack.length > 1 && stack[stack.length - 1].level >= level) stack.pop();
    stack[stack.length - 1].list.push(b);
    b.children = [];
    stack.push({ level, list: b.children });
  }
  const clean = (l: Bookmark[]): Bookmark[] => l.map((b) => (b.children?.length ? { ...b, children: clean(b.children) } : { title: b.title, page: b.page }));
  return clean(root);
}

export function formatBookmarks(list: Bookmark[], level = 0): string {
  return list.map((b) => `${'  '.repeat(level)}${b.title} | ${b.page}${b.children?.length ? `\n${formatBookmarks(b.children, level + 1)}` : ''}`).join('\n');
}

function pdfText(s: string) {
  return /^[\x20-\x7e]*$/.test(s) ? PDFString.of(s) : PDFHexString.fromText(s);
}

/** Replaces the document outline (the bookmarks pane) with these bookmarks. */
export async function setBookmarks(bytes: Uint8Array, list: Bookmark[]): Promise<Uint8Array> {
  const doc = await load(bytes);
  writeOutline(doc, list);
  return save(doc);
}

function writeOutline(doc: PDFDocument, list: Bookmark[]) {
  const ctx = doc.context;
  const pages = doc.getPages();
  const outlines = ctx.obj({ Type: 'Outlines' }) as PDFDict;
  const outlinesRef = ctx.register(outlines);
  const build = (items: Bookmark[], parent: PDFRef): { first?: PDFRef; last?: PDFRef; count: number } => {
    const refs = items.map(() => ctx.nextRef());
    let count = 0;
    items.forEach((b, i) => {
      const page = pages[Math.min(Math.max(1, b.page), pages.length) - 1];
      const d = ctx.obj({}) as PDFDict;
      d.set(PDFName.of('Title'), pdfText(b.title));
      d.set(PDFName.of('Parent'), parent);
      d.set(PDFName.of('Dest'), ctx.obj([page.ref, PDFName.of('XYZ'), null, null, null]));
      if (i > 0) d.set(PDFName.of('Prev'), refs[i - 1]);
      if (i < items.length - 1) d.set(PDFName.of('Next'), refs[i + 1]);
      if (b.children?.length) {
        const sub = build(b.children, refs[i]);
        d.set(PDFName.of('First'), sub.first!);
        d.set(PDFName.of('Last'), sub.last!);
        d.set(PDFName.of('Count'), PDFNumber.of(sub.count));
        count += sub.count;
      }
      ctx.assign(refs[i], d);
      count++;
    });
    return { first: refs[0], last: refs[refs.length - 1], count };
  };
  if (list.length) {
    const top = build(list, outlinesRef);
    outlines.set(PDFName.of('First'), top.first!);
    outlines.set(PDFName.of('Last'), top.last!);
    outlines.set(PDFName.of('Count'), PDFNumber.of(top.count));
    doc.catalog.set(PDFName.of('Outlines'), outlinesRef);
    doc.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'));
  } else {
    doc.catalog.delete(PDFName.of('Outlines'));
  }
}

/** Reads the outline back (titles and 1-based pages). */
export async function readBookmarks(bytes: Uint8Array): Promise<Bookmark[]> {
  const doc = await load(bytes);
  const ctx = doc.context;
  const pageIndex = new Map(doc.getPages().map((p, i) => [p.ref.toString(), i + 1]));
  const outlines = doc.catalog.lookupMaybe(PDFName.of('Outlines'), PDFDict);
  const text = (v: unknown) => (v instanceof PDFString || v instanceof PDFHexString ? v.decodeText() : '');
  const destPage = (d: PDFDict): number => {
    let dest = d.lookup(PDFName.of('Dest'));
    const action = d.lookupMaybe(PDFName.of('A'), PDFDict);
    if (!dest && action) dest = action.lookup(PDFName.of('D'));
    if (dest instanceof PDFArray) {
      const first = dest.get(0);
      if (first instanceof PDFRef) return pageIndex.get(first.toString()) ?? 1;
      if (first instanceof PDFNumber) return first.asNumber() + 1;
    }
    return 1;
  };
  const walk = (first: unknown, depth: number): Bookmark[] => {
    const out: Bookmark[] = [];
    let ref = first;
    let guard = 0;
    while (ref instanceof PDFRef && guard++ < 5000 && depth < 32) {
      const d = ctx.lookup(ref, PDFDict);
      const b: Bookmark = { title: text(d.lookup(PDFName.of('Title'))), page: destPage(d) };
      const kids = walk(d.get(PDFName.of('First')), depth + 1);
      if (kids.length) b.children = kids;
      out.push(b);
      ref = d.get(PDFName.of('Next'));
    }
    return out;
  };
  return outlines ? walk(outlines.get(PDFName.of('First')), 0) : [];
}

export interface LabelRange { from: number; style: 'decimal' | 'roman' | 'ROMAN' | 'alpha' | 'ALPHA' | 'none'; prefix?: string; start?: number }

/** Page labels ("i, ii, iii, 1, 2…") that viewers show instead of plain numbers. */
export async function setPageLabels(bytes: Uint8Array, ranges: LabelRange[]): Promise<Uint8Array> {
  const doc = await load(bytes);
  const style: Record<string, string | undefined> = { decimal: 'D', roman: 'r', ROMAN: 'R', alpha: 'a', ALPHA: 'A', none: undefined };
  const nums: unknown[] = [];
  for (const r of [...ranges].sort((a, b) => a.from - b.from)) {
    const d: Record<string, unknown> = { Type: 'PageLabel' };
    if (style[r.style]) d.S = PDFName.of(style[r.style]!);
    if (r.prefix) d.P = pdfText(r.prefix);
    if (r.start && r.start !== 1) d.St = r.start;
    nums.push(r.from - 1, doc.context.obj(d as never));
  }
  doc.catalog.set(PDFName.of('PageLabels'), doc.context.obj({ Nums: nums as never }));
  return save(doc);
}

/** "1-4: roman; 5: decimal; 20: A- decimal" -> label ranges. */
export function parseLabelSpec(spec: string): LabelRange[] {
  return spec.split(/[;\n]+/).map((s) => s.trim()).filter(Boolean).map((s) => {
    const m = s.match(/^(\d+)(?:-\d+)?\s*:\s*(?:"([^"]*)"|(\S+-))?\s*(decimal|roman|ROMAN|alpha|ALPHA|none|1|i|I|a|A)?\s*(?:from\s+(\d+))?$/);
    if (!m) throw new Error(`“${s}” should look like “1: roman” or “5: decimal from 1”`);
    const alias: Record<string, LabelRange['style']> = { '1': 'decimal', i: 'roman', I: 'ROMAN', a: 'alpha', A: 'ALPHA' };
    const st = (m[4] ? alias[m[4]] ?? m[4] : 'decimal') as LabelRange['style'];
    return { from: Number(m[1]), style: st, prefix: m[2] ?? m[3], start: m[5] ? Number(m[5]) : undefined };
  });
}

/** Label of a page under these ranges (what a viewer would show). */
export function labelFor(page: number, ranges: LabelRange[]): string {
  const r = [...ranges].sort((a, b) => b.from - a.from).find((x) => x.from <= page);
  if (!r) return String(page);
  const n = (r.start ?? 1) + page - r.from;
  const roman = (v: number) => {
    const t: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
    let s = '';
    for (const [k, l] of t) while (v >= k) { s += l; v -= k; }
    return s;
  };
  const alpha = (v: number) => String.fromCharCode(97 + ((v - 1) % 26)).repeat(Math.floor((v - 1) / 26) + 1);
  const body = r.style === 'decimal' ? String(n) : r.style === 'roman' ? roman(n) : r.style === 'ROMAN' ? roman(n).toUpperCase() : r.style === 'alpha' ? alpha(n) : r.style === 'ALPHA' ? alpha(n).toUpperCase() : '';
  return (r.prefix ?? '') + body;
}

/** A contents page at the front, made from the bookmarks, each line a link to its page. */
export async function tableOfContents(bytes: Uint8Array, list: Bookmark[], o: { title?: string } = {}): Promise<Uint8Array> {
  if (!list.length) throw new Error('This PDF has no bookmarks to make contents from; add some with Edit bookmarks first');
  const doc = await load(bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const flat: { title: string; page: number; level: number }[] = [];
  const walk = (l: Bookmark[], level: number) => l.forEach((b) => { flat.push({ title: b.title, page: b.page, level }); if (b.children) walk(b.children, level + 1); });
  walk(list, 0);
  const first = doc.getPage(0);
  const { width: W, height: H } = first.getSize();
  const perPage = Math.floor((H - 160) / 18);
  const tocPages = Math.ceil(flat.length / perPage);
  const targets = doc.getPages();
  for (let t = 0; t < tocPages; t++) {
    const page = doc.insertPage(t, [W, H]);
    if (t === 0) page.drawText(winAnsi(o.title ?? 'Contents'), { x: 60, y: H - 90, size: 22, font: bold });
    const annots: PDFRef[] = [];
    flat.slice(t * perPage, (t + 1) * perPage).forEach((e, i) => {
      const y = H - 130 - i * 18;
      const x = 60 + e.level * 16;
      const label = winAnsi(e.title);
      const num = String(e.page + tocPages);
      const size = e.level ? 10 : 11;
      const f = e.level ? font : bold;
      page.drawText(label, { x, y, size, font: f });
      const nw = font.widthOfTextAtSize(num, size);
      const lw = f.widthOfTextAtSize(label, size);
      const dots = '.'.repeat(Math.max(0, Math.floor((W - 60 - nw - x - lw - 16) / font.widthOfTextAtSize('.', size))));
      page.drawText(dots, { x: x + lw + 8, y, size, font, color: rgb(0.6, 0.6, 0.6) });
      page.drawText(num, { x: W - 60 - nw, y, size, font });
      const target = targets[Math.min(Math.max(1, e.page), targets.length) - 1];
      annots.push(doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [x, y - 3, W - 60, y + size], Border: [0, 0, 0], Dest: [target.ref, 'Fit'] } as never)));
    });
    page.node.set(PDFName.of('Annots'), doc.context.obj(annots));
  }
  // Bookmarks now point one or more pages later.
  const shift = (l: Bookmark[]): Bookmark[] => l.map((b) => ({ ...b, page: b.page + tocPages, children: b.children ? shift(b.children) : undefined }));
  writeOutline(doc, [{ title: o.title ?? 'Contents', page: 1 }, ...shift(list)]);
  return save(doc);
}

// ---------------------------------------------------------------- annotations, forms, attachments

/** Removes comments, highlights and other annotations; links and form fields can be kept. */
export async function removeAnnotations(bytes: Uint8Array, o: { keepLinks?: boolean; keepForms?: boolean } = {}): Promise<{ bytes: Uint8Array; removed: number }> {
  const doc = await load(bytes);
  let removed = 0;
  for (const p of doc.getPages()) {
    const annots = p.node.Annots();
    if (!annots) continue;
    const keep: unknown[] = [];
    for (let i = 0; i < annots.size(); i++) {
      const raw = annots.get(i);
      const d = doc.context.lookup(raw);
      const sub = d instanceof PDFDict ? d.lookup(PDFName.of('Subtype'))?.toString() : '';
      if ((o.keepLinks && sub === '/Link') || (o.keepForms !== false && sub === '/Widget')) keep.push(raw);
      else removed++;
    }
    if (keep.length) p.node.set(PDFName.of('Annots'), doc.context.obj(keep as never));
    else p.node.delete(PDFName.of('Annots'));
  }
  return { bytes: await save(doc), removed };
}

/** Fixes form answers into the page so they can no longer be changed. */
export async function flatten(bytes: Uint8Array): Promise<{ bytes: Uint8Array; fields: number }> {
  const doc = await load(bytes);
  const form = doc.getForm();
  const fields = form.getFields().length;
  form.flatten();
  return { bytes: await save(doc), fields };
}

export interface NewField { type: 'text' | 'multiline' | 'checkbox' | 'dropdown' | 'radio' | 'signature'; name: string; page: number; x: number; y: number; w: number; h: number; options?: string[]; value?: string }

/** "text name 1 72 700 200 20" lines -> fields; coordinates in points from the page's bottom-left. */
export function parseFieldSpec(spec: string): NewField[] {
  return spec.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => {
    const m = l.match(/^(text|multiline|checkbox|dropdown|radio|signature)\s+(\S+)\s+(\d+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s+(.*))?$/);
    if (!m) throw new Error(`“${l}” should look like “text name page x y width height [options]”`);
    return { type: m[1] as NewField['type'], name: m[2], page: Number(m[3]), x: Number(m[4]), y: Number(m[5]), w: Number(m[6]), h: Number(m[7]), options: m[8]?.split(',').map((s) => s.trim()).filter(Boolean) };
  });
}

/** Adds fillable fields (text, multi-line, tick boxes, lists, choices, signature boxes). */
export async function addFields(bytes: Uint8Array, fields: NewField[]): Promise<Uint8Array> {
  const doc = await load(bytes);
  const form = doc.getForm();
  const pages = doc.getPages();
  for (const f of fields) {
    const page = pages[f.page - 1];
    if (!page) throw new Error(`Page ${f.page} does not exist`);
    const at = { x: f.x, y: f.y, width: f.w, height: f.h, borderWidth: 1, borderColor: rgb(0.55, 0.6, 0.7) };
    switch (f.type) {
      case 'text': case 'multiline': case 'signature': {
        const t = form.createTextField(f.name);
        if (f.type === 'multiline') t.enableMultiline();
        if (f.value) t.setText(f.value);
        t.addToPage(page, at);
        break;
      }
      case 'checkbox': {
        const c = form.createCheckBox(f.name);
        c.addToPage(page, at);
        if (f.value === 'true' || f.value === 'yes') c.check();
        break;
      }
      case 'dropdown': {
        const d = form.createDropdown(f.name);
        d.addOptions(f.options ?? []);
        d.addToPage(page, at);
        break;
      }
      case 'radio': {
        const r = form.createRadioGroup(f.name);
        (f.options?.length ? f.options : ['yes']).forEach((opt, i) => r.addOptionToPage(opt, page, { ...at, y: at.y - i * (f.h + 6) }));
        break;
      }
    }
  }
  return save(doc);
}

/** Files inside the PDF (attachments), by name. */
export async function listAttachments(bytes: Uint8Array): Promise<{ name: string; size: number; data: Uint8Array }[]> {
  const doc = await load(bytes);
  const names = doc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict)?.lookupMaybe(PDFName.of('EmbeddedFiles'), PDFDict);
  const out: { name: string; size: number; data: Uint8Array }[] = [];
  const visit = (node: PDFDict | undefined, depth = 0) => {
    if (!node || depth > 16) return;
    const arr = node.lookupMaybe(PDFName.of('Names'), PDFArray);
    if (arr) {
      for (let i = 0; i + 1 < arr.size(); i += 2) {
        const nameObj = arr.lookup(i);
        const spec = arr.lookup(i + 1);
        if (!(spec instanceof PDFDict)) continue;
        const fname = spec.lookup(PDFName.of('UF')) ?? spec.lookup(PDFName.of('F')) ?? nameObj;
        const ef = spec.lookupMaybe(PDFName.of('EF'), PDFDict);
        const stream = ef?.lookup(PDFName.of('F'));
        const decoded = stream ? decodeStream(stream) : undefined;
        if (!decoded) continue;
        const name = fname instanceof PDFString || fname instanceof PDFHexString ? fname.decodeText() : `attachment ${out.length + 1}`;
        out.push({ name, size: decoded.length, data: decoded });
      }
    }
    const kids = node.lookupMaybe(PDFName.of('Kids'), PDFArray);
    if (kids) for (let i = 0; i < kids.size(); i++) visit(kids.lookup(i) as PDFDict, depth + 1);
  };
  visit(names);
  return out;
}

/** Raw stream contents, inflated when Flate-compressed (other filters are returned as they are). */
export function decodeStream(stream: unknown): Uint8Array | undefined {
  const s = stream as { getContents?: () => Uint8Array; dict?: PDFDict };
  if (!s?.getContents) return undefined;
  const raw = s.getContents();
  const filter = s.dict?.lookup(PDFName.of('Filter'));
  const f = filter instanceof PDFArray ? filter.get(0)?.toString() : filter?.toString();
  if (f === '/FlateDecode') {
    try { return new Uint8Array(inflateSync(raw)); } catch { return new Uint8Array(inflateRawSync(raw.subarray(2))); }
  }
  return raw;
}

export async function attach(bytes: Uint8Array, files: { name: string; data: Uint8Array; mime?: string }[]): Promise<Uint8Array> {
  const doc = await load(bytes);
  for (const f of files) await doc.attach(f.data, f.name, { mimeType: f.mime ?? 'application/octet-stream', creationDate: new Date(), modificationDate: new Date() });
  return save(doc);
}

// ---------------------------------------------------------------- details and cleaning

export interface PdfMeta { title?: string; author?: string; subject?: string; keywords?: string; creator?: string; producer?: string; created?: string; modified?: string; pages: number; xmp: boolean; encrypted: boolean; version: string }

export async function readMeta(bytes: Uint8Array): Promise<PdfMeta> {
  const doc = await load(bytes);
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 16)).match(/%PDF-(\d\.\d)/)?.[1] ?? '?';
  return {
    title: doc.getTitle(), author: doc.getAuthor(), subject: doc.getSubject(), keywords: doc.getKeywords(), creator: doc.getCreator(), producer: doc.getProducer(),
    created: doc.getCreationDate()?.toISOString(), modified: doc.getModificationDate()?.toISOString(), pages: doc.getPageCount(),
    xmp: !!doc.catalog.get(PDFName.of('Metadata')), encrypted: doc.isEncrypted, version: head,
  };
}

export async function writeMeta(bytes: Uint8Array, m: { title?: string; author?: string; subject?: string; keywords?: string; creator?: string; producer?: string }): Promise<Uint8Array> {
  const doc = await load(bytes);
  if (m.title !== undefined) doc.setTitle(m.title);
  if (m.author !== undefined) doc.setAuthor(m.author);
  if (m.subject !== undefined) doc.setSubject(m.subject);
  if (m.keywords !== undefined) doc.setKeywords(m.keywords.split(/[,;]\s*/).filter(Boolean));
  if (m.creator !== undefined) doc.setCreator(m.creator);
  if (m.producer !== undefined) doc.setProducer(m.producer);
  doc.setModificationDate(new Date());
  // The XMP copy would otherwise contradict the new values in some viewers.
  doc.catalog.delete(PDFName.of('Metadata'));
  return save(doc);
}

export interface SanitizeOptions { scripts?: boolean; attachments?: boolean; metadata?: boolean; links?: boolean; annotations?: boolean; forms?: boolean; layers?: boolean; thumbnails?: boolean }

/**
 * Removes what can hide in a PDF: JavaScript and automatic actions, embedded
 * files, details about the author and software, outside links, comments, XFA
 * forms, hidden layers and page thumbnails. Returns what it found.
 */
export async function sanitize(bytes: Uint8Array, o: SanitizeOptions = { scripts: true, attachments: true, metadata: true, links: true, thumbnails: true }): Promise<{ bytes: Uint8Array; removed: string[] }> {
  const doc = await load(bytes);
  const cat = doc.catalog;
  const removed = new Set<string>();
  const del = (d: PDFDict, key: string, label: string) => { if (d.has(PDFName.of(key))) { d.delete(PDFName.of(key)); removed.add(label); } };
  const names = cat.lookupMaybe(PDFName.of('Names'), PDFDict);
  if (o.scripts) {
    del(cat, 'OpenAction', 'automatic actions');
    del(cat, 'AA', 'automatic actions');
    if (names) del(names, 'JavaScript', 'JavaScript');
    const acro = cat.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
    if (acro) del(acro, 'XFA', 'XFA form scripts');
  }
  if (o.attachments && names) del(names, 'EmbeddedFiles', 'attached files');
  if (o.metadata) {
    del(cat, 'Metadata', 'XMP details');
    const info = doc.context.trailerInfo.Info;
    if (info) { doc.context.trailerInfo.Info = undefined; removed.add('document details'); }
    doc.setProducer(''); doc.setCreator('');
  }
  if (o.layers) del(cat, 'OCProperties', 'layers');
  if (o.forms) del(cat, 'AcroForm', 'form fields');
  for (const p of doc.getPages()) {
    if (o.scripts) del(p.node, 'AA', 'automatic actions');
    if (o.thumbnails) del(p.node, 'Thumb', 'thumbnails');
    const annots = p.node.Annots();
    if (!annots) continue;
    const keep: unknown[] = [];
    for (let i = 0; i < annots.size(); i++) {
      const ref = annots.get(i);
      const a = doc.context.lookup(ref);
      if (!(a instanceof PDFDict)) continue;
      const sub = a.lookup(PDFName.of('Subtype'))?.toString();
      const action = a.lookupMaybe(PDFName.of('A'), PDFDict);
      const kind = action?.lookup(PDFName.of('S'))?.toString();
      if (o.scripts) { del(a, 'AA', 'automatic actions'); if (kind === '/JavaScript' || kind === '/Launch') { a.delete(PDFName.of('A')); removed.add(kind === '/Launch' ? 'program launches' : 'JavaScript'); } }
      if (o.links && sub === '/Link' && (kind === '/URI' || kind === '/GoToR' || kind === '/Launch')) { removed.add('outside links'); continue; }
      if (o.annotations && sub !== '/Link' && sub !== '/Widget') { removed.add('comments'); continue; }
      if (o.attachments && sub === '/FileAttachment') { removed.add('attached files'); continue; }
      keep.push(ref);
    }
    if (keep.length) p.node.set(PDFName.of('Annots'), doc.context.obj(keep as never));
    else p.node.delete(PDFName.of('Annots'));
  }
  return { bytes: await save(doc), removed: [...removed] };
}

function ocgName(g: PDFDict, i: number): string {
  const n = g.lookup(PDFName.of('Name'));
  return n instanceof PDFString || n instanceof PDFHexString ? n.decodeText() : n instanceof PDFName ? n.decodeText() : `Layer ${i + 1}`;
}

/** Optional content groups (layers) and whether each shows by default. */
export async function listLayers(bytes: Uint8Array): Promise<{ name: string; visible: boolean }[]> {
  const doc = await load(bytes);
  const oc = doc.catalog.lookupMaybe(PDFName.of('OCProperties'), PDFDict);
  if (!oc) return [];
  const groups = oc.lookupMaybe(PDFName.of('OCGs'), PDFArray);
  const d = oc.lookupMaybe(PDFName.of('D'), PDFDict);
  const off = new Set<string>();
  const offArr = d?.lookupMaybe(PDFName.of('OFF'), PDFArray);
  if (offArr) for (let i = 0; i < offArr.size(); i++) off.add(String(offArr.get(i)));
  const out: { name: string; visible: boolean }[] = [];
  if (groups) for (let i = 0; i < groups.size(); i++) {
    const g = groups.lookup(i);
    if (!(g instanceof PDFDict)) continue;
    out.push({ name: ocgName(g, i), visible: !off.has(String(groups.get(i))) });
  }
  return out;
}

/** Shows or hides layers by default (by name). */
export async function setLayers(bytes: Uint8Array, visible: Record<string, boolean>): Promise<Uint8Array> {
  const doc = await load(bytes);
  const oc = doc.catalog.lookupMaybe(PDFName.of('OCProperties'), PDFDict);
  const groups = oc?.lookupMaybe(PDFName.of('OCGs'), PDFArray);
  if (!oc || !groups) throw new Error('This PDF has no layers');
  const on: unknown[] = [];
  const offs: unknown[] = [];
  for (let i = 0; i < groups.size(); i++) {
    const name = ocgName(groups.lookup(i) as PDFDict, i);
    (visible[name] === false ? offs : on).push(groups.get(i));
  }
  const d = oc.lookupMaybe(PDFName.of('D'), PDFDict) ?? (doc.context.obj({}) as PDFDict);
  d.set(PDFName.of('ON'), doc.context.obj(on as never));
  d.set(PDFName.of('OFF'), doc.context.obj(offs as never));
  oc.set(PDFName.of('D'), d);
  return save(doc);
}

/** What an image XObject is, for extracting pictures without re-encoding JPEGs. */
export interface PdfImage { page: number; name: string; width: number; height: number; filter: string; colorSpace: string; bpc: number; data: Uint8Array }

export async function listImages(bytes: Uint8Array): Promise<PdfImage[]> {
  const doc = await load(bytes);
  const out: PdfImage[] = [];
  const seen = new Set<string>();
  doc.getPages().forEach((p, i) => {
    const xo = p.node.Resources()?.lookupMaybe(PDFName.of('XObject'), PDFDict);
    if (!xo) return;
    for (const [key, ref] of xo.entries()) {
      const id = String(ref);
      if (seen.has(id)) continue;
      const obj = doc.context.lookup(ref) as { dict?: PDFDict; getContents?: () => Uint8Array };
      const d = obj?.dict;
      if (!d || d.lookup(PDFName.of('Subtype'))?.toString() !== '/Image') continue;
      seen.add(id);
      const filterObj = d.lookup(PDFName.of('Filter'));
      const filter = filterObj instanceof PDFArray ? filterObj.get(filterObj.size() - 1)?.toString() ?? '' : filterObj?.toString() ?? '';
      const cs = d.lookup(PDFName.of('ColorSpace'));
      const csName = cs instanceof PDFArray ? cs.get(0)?.toString() ?? '' : cs?.toString() ?? '';
      const num = (k: string) => (d.lookup(PDFName.of(k)) as PDFNumber | undefined)?.asNumber?.() ?? 0;
      out.push({
        page: i + 1, name: key.toString().slice(1), width: num('Width'), height: num('Height'), filter, colorSpace: csName, bpc: num('BitsPerComponent') || 8,
        data: filter === '/FlateDecode' ? decodeStream(obj)! : obj.getContents!(),
      });
    }
  });
  return out;
}
