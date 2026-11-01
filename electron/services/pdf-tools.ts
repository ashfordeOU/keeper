// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// PDF tools beyond pages: real redaction (the words are gone, not covered),
// filling and flattening forms, typing onto pages, signing, making scans
// searchable and turning a PDF into a Word document. No Electron here: drawing
// pages and reading text in pictures are passed in, so the CLI and tests use
// the same code.

import { promises as fsp } from 'node:fs';
import { createRequire } from 'node:module';
import { PDFCheckBox, PDFDocument, PDFDropdown, PDFName, PDFOptionList, PDFRadioGroup, PDFTextField, rgb, StandardFonts, type PDFFont } from 'pdf-lib';
import { loadPdfJs } from '../../core/convert';
import { buildDocx, type Block } from '../../core/docx';
import { checkOrganize, describeOrganize, type OrganizePage } from '../../core/pdf-organize';

const req = createRequire(__filename);
type Sharp = typeof import('sharp').default;
let sharpMod: Sharp | null = null;
const sharp = (): Sharp => (sharpMod ??= req('sharp') as Sharp);

/** Draws all pages to PNG at a scale (1 = 72 dpi). */
export type RenderPages = (file: string, scale: number) => Promise<Buffer[]>;
/** Words found in a picture, in its pixels. */
export type OcrWords = (png: Buffer) => Promise<{ text: string; x0: number; y0: number; x1: number; y1: number }[]>;

// ---------------------------------------------------------------- where the words are

export interface TextItem {
  page: number;
  str: string;
  /** PDF user space: origin bottom-left, points */
  x: number;
  y: number;
  width: number;
  height: number;
}

type Doc = { numPages: number; getPage(n: number): Promise<PdfPage>; destroy(): Promise<void> };
type PdfPage = { getViewport(o: { scale: number }): { width: number; height: number }; getTextContent(): Promise<{ items: { str?: string; transform?: number[]; width?: number; height?: number }[] }> };

async function openDoc(file: string): Promise<Doc> {
  const lib = (await loadPdfJs()) as unknown as { getDocument(src: object): { promise: Promise<Doc> } };
  const data = new Uint8Array(await fsp.readFile(file));
  return lib.getDocument({ data, isEvalSupported: false, disableFontFace: true, verbosity: 0 }).promise;
}

export async function textItems(file: string): Promise<{ items: TextItem[]; sizes: { width: number; height: number }[] }> {
  const doc = await openDoc(file);
  try {
    const items: TextItem[] = [];
    const sizes: { width: number; height: number }[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      sizes.push({ width: vp.width, height: vp.height });
      for (const it of (await page.getTextContent()).items) {
        if (!it.str || !it.transform) continue;
        const [a, b, , d, e, f] = it.transform;
        const h = it.height || Math.hypot(b, d) || Math.abs(a);
        items.push({ page: p, str: it.str, x: e, y: f, width: it.width ?? it.str.length * h * 0.5, height: h });
      }
    }
    return { items, sizes };
  } finally {
    await doc.destroy();
  }
}

/** A box on a page, in fractions of the page from its top-left corner (what the interface draws). */
export interface PageBox {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Boxes around every occurrence of the words. Text runs on the same line are
 * joined first (PDF writers often store each word, or each letter, as its own
 * run), so phrases are found too. Positions inside a run are estimated from
 * character counts, then widened a little so nothing peeks out.
 */
export function boxesForWords(items: TextItem[], sizes: { width: number; height: number }[], words: string[], caseSensitive = false): PageBox[] {
  const out: PageBox[] = [];
  const norm = (s: string) => (caseSensitive ? s : s.toLowerCase()).replace(/\s+/g, ' ');
  // Lines: runs on a page whose baselines are within a third of a line of each other, left to right.
  const lines: { page: number; text: string; map: { it: TextItem; i: number }[] }[] = [];
  const byPage = new Map<number, TextItem[]>();
  for (const it of items) (byPage.get(it.page) ?? byPage.set(it.page, []).get(it.page)!).push(it);
  for (const [page, its] of byPage) {
    const sorted = [...its].sort((a, b) => b.y - a.y || a.x - b.x);
    const groups: TextItem[][] = [];
    for (const it of sorted) {
      const g = groups.find((x) => Math.abs(x[0].y - it.y) < Math.max(1, x[0].height) * 0.35);
      if (g) g.push(it);
      else groups.push([it]);
    }
    for (const g of groups) {
      g.sort((a, b) => a.x - b.x);
      let text = '';
      const map: { it: TextItem; i: number }[] = [];
      let prev: TextItem | undefined;
      for (const it of g) {
        // A gap wider than a fifth of the text height reads as a space.
        if (prev && !/\s$/.test(text) && !/^\s/.test(it.str) && it.x - (prev.x + prev.width) > it.height * 0.2) {
          text += ' ';
          map.push({ it: prev, i: prev.str.length });
        }
        for (let i = 0; i < it.str.length; i++) {
          text += it.str[i];
          map.push({ it, i });
        }
        prev = it;
      }
      lines.push({ page, text, map });
    }
  }
  const xAt = (m: { it: TextItem; i: number }) => m.it.x + (m.it.width / Math.max(1, m.it.str.length)) * m.i;
  for (const w of words.map((x) => x.trim()).filter(Boolean)) {
    const needle = norm(w);
    for (const line of lines) {
      const hay = norm(line.text);
      let i = hay.indexOf(needle);
      while (i >= 0) {
        const size = sizes[line.page - 1];
        const first = line.map[i];
        const last = line.map[Math.min(line.map.length - 1, i + needle.length - 1)];
        const per = last.it.width / Math.max(1, last.it.str.length);
        const h = Math.max(first.it.height, last.it.height);
        const x0 = xAt(first) - 1.5;
        const x1 = xAt(last) + per + 1.5;
        const y0 = Math.min(first.it.y, last.it.y) - h * 0.25;
        const y1 = Math.max(first.it.y, last.it.y) + h * 1.05;
        out.push({ page: line.page, x: x0 / size.width, y: 1 - y1 / size.height, w: (x1 - x0) / size.width, h: (y1 - y0) / size.height });
        i = hay.indexOf(needle, i + needle.length);
      }
    }
  }
  return out;
}

function stripMetadata(doc: PDFDocument) {
  doc.setTitle('');
  doc.setAuthor('');
  doc.setSubject('');
  doc.setKeywords([]);
  doc.setCreator('Keeper');
  doc.setProducer('Keeper');
  doc.catalog.delete(PDFName.of('Metadata'));
}

/**
 * Redacts boxes and words. Every page with a redaction is rebuilt as a
 * picture with black boxes burnt in, so no text, font or hidden layer under the
 * boxes survives; other pages keep their text. Document details are removed.
 */
export async function redactPdf(input: string, output: string, o: { words?: string[]; boxes?: PageBox[]; caseSensitive?: boolean; dpi?: number }, render: RenderPages): Promise<{ redactions: number; pages: number[] }> {
  const { items, sizes } = await textItems(input);
  const boxes = [...(o.boxes ?? []), ...boxesForWords(items, sizes, o.words ?? [], o.caseSensitive)];
  if (!boxes.length) throw new Error(o.words?.length ? 'None of those words are in the PDF' : 'Mark something to redact');
  const pages = [...new Set(boxes.map((b) => b.page))].sort((a, b) => a - b);
  const scale = (o.dpi ?? 200) / 72;
  const pngs = await render(input, scale);
  const src = await PDFDocument.load(await fsp.readFile(input), { ignoreEncryption: false });
  const out = await PDFDocument.create();
  for (let i = 0; i < src.getPageCount(); i++) {
    const pageNo = i + 1;
    if (!pages.includes(pageNo)) {
      const [p] = await out.copyPages(src, [i]);
      out.addPage(p);
      continue;
    }
    const png = pngs[i];
    const meta = await sharp()(png).metadata();
    const W = meta.width ?? 1;
    const H = meta.height ?? 1;
    const rects = boxes.filter((b) => b.page === pageNo).map((b) => `<rect x="${Math.max(0, b.x * W)}" y="${Math.max(0, b.y * H)}" width="${b.w * W}" height="${b.h * H}" fill="#000"/>`).join('');
    const burnt = await sharp()(png).composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${rects}</svg>`), top: 0, left: 0 }]).flatten({ background: '#ffffff' }).jpeg({ quality: 88 }).toBuffer();
    const img = await out.embedJpg(burnt);
    const size = sizes[i];
    const page = out.addPage([size.width, size.height]);
    page.drawImage(img, { x: 0, y: 0, width: size.width, height: size.height });
  }
  stripMetadata(out);
  await fsp.writeFile(output, await out.save());
  return { redactions: boxes.length, pages };
}

// ---------------------------------------------------------------- forms

export interface FormField {
  name: string;
  type: 'text' | 'checkbox' | 'radio' | 'dropdown' | 'list' | 'other';
  value: string;
  options?: string[];
}

export async function formFields(input: string): Promise<FormField[]> {
  const doc = await PDFDocument.load(await fsp.readFile(input), { ignoreEncryption: true });
  return doc.getForm().getFields().map((f): FormField => {
    const name = f.getName();
    if (f instanceof PDFTextField) return { name, type: 'text', value: f.getText() ?? '' };
    if (f instanceof PDFCheckBox) return { name, type: 'checkbox', value: f.isChecked() ? 'yes' : '' };
    if (f instanceof PDFRadioGroup) return { name, type: 'radio', value: f.getSelected() ?? '', options: f.getOptions() };
    if (f instanceof PDFDropdown) return { name, type: 'dropdown', value: f.getSelected()[0] ?? '', options: f.getOptions() };
    if (f instanceof PDFOptionList) return { name, type: 'list', value: f.getSelected()[0] ?? '', options: f.getOptions() };
    return { name, type: 'other', value: '' };
  });
}

export interface TextStamp {
  page: number;
  /** fractions of the page from its top-left corner */
  x: number;
  y: number;
  text: string;
  size?: number;
}

/** Fills form fields, types text anywhere (for forms without fields) and optionally flattens. */
export async function fillPdf(input: string, output: string, o: { values?: Record<string, string>; stamps?: TextStamp[]; flatten?: boolean }): Promise<{ filled: number }> {
  const doc = await PDFDocument.load(await fsp.readFile(input));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const form = doc.getForm();
  let filled = 0;
  for (const [name, value] of Object.entries(o.values ?? {})) {
    const f = form.getFieldMaybe(name);
    if (!f) continue;
    if (f instanceof PDFTextField) f.setText(value);
    else if (f instanceof PDFCheckBox) (value && !/^(no|false|0|off)$/i.test(value) ? f.check() : f.uncheck());
    else if (f instanceof PDFRadioGroup && value) f.select(value);
    else if (f instanceof PDFDropdown && value) f.select(value);
    else if (f instanceof PDFOptionList && value) f.select(value);
    else continue;
    filled++;
  }
  if (form.getFields().length) form.updateFieldAppearances(font);
  for (const s of o.stamps ?? []) {
    const page = doc.getPage(Math.min(doc.getPageCount(), Math.max(1, s.page)) - 1);
    const { width, height } = page.getSize();
    const size = s.size ?? 11;
    const lines = s.text.split('\n');
    lines.forEach((line, i) => page.drawText(safeText(line, font), { x: s.x * width, y: height - s.y * height - size * (i + 1), size, font, color: rgb(0, 0, 0) }));
    filled++;
  }
  if (o.flatten) form.flatten();
  await fsp.writeFile(output, await doc.save());
  return { filled };
}

/** Standard PDF fonts only know Western characters; anything else becomes a close match or is left out. */
function safeText(s: string, font: PDFFont): string {
  let out = '';
  for (const ch of s.normalize('NFC')) {
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      const plain = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
      try {
        font.encodeText(plain);
        out += plain;
      } catch {
        out += ' ';
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- signing

export interface Placement {
  /** 'last' or a page number */
  page: number | 'last';
  /** fractions of the page, from its top-left corner, for the signature's top-left corner */
  x?: number;
  y?: number;
  /** or a corner of the page (with a margin) */
  corner?: 'center' | 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | 'bottom-center';
  /** fraction of the page width */
  width: number;
}

export async function signPdf(input: string, output: string, png: Buffer, at: Placement, opts: { date?: boolean } = {}): Promise<void> {
  const doc = await PDFDocument.load(await fsp.readFile(input));
  const img = await doc.embedPng(png);
  const n = at.page === 'last' ? doc.getPageCount() : Math.min(doc.getPageCount(), Math.max(1, at.page));
  const page = doc.getPage(n - 1);
  const { width, height } = page.getSize();
  const w = Math.min(0.9, Math.max(0.05, at.width)) * width;
  const h = (img.height / img.width) * w;
  const m = Math.min(width, height) * 0.07;
  let x = (at.x ?? 0) * width;
  let y = height - (at.y ?? 0) * height - h;
  if (at.corner) {
    x = at.corner.endsWith('left') ? m : at.corner.endsWith('right') ? width - m - w : (width - w) / 2;
    y = at.corner.startsWith('top') ? height - m - h : at.corner === 'center' ? (height - h) / 2 : m + (opts.date ? 14 : 0);
  }
  page.drawImage(img, { x, y, width: w, height: h });
  if (opts.date) {
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText(new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }), { x, y: y - 12, size: 9, font, color: rgb(0.25, 0.25, 0.25) });
  }
  await fsp.writeFile(output, await doc.save());
}

// ---------------------------------------------------------------- searchable

/**
 * Adds an invisible text layer to pages that have no text (scans), from the
 * words recognised in each page's picture. The pages look exactly the same;
 * the text can now be searched, selected and copied.
 */
export async function makeSearchable(input: string, output: string, render: RenderPages, ocr: OcrWords, onPage?: (i: number, n: number) => void): Promise<{ pages: number; words: number }> {
  const { items, sizes } = await textItems(input);
  const hasText = new Set(items.filter((i) => i.str.trim()).map((i) => i.page));
  const scale = 2;
  const pngs = await render(input, scale);
  const doc = await PDFDocument.load(await fsp.readFile(input));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  let pages = 0;
  let words = 0;
  for (let i = 0; i < doc.getPageCount(); i++) {
    onPage?.(i, doc.getPageCount());
    if (hasText.has(i + 1)) continue;
    const found = await ocr(pngs[i]);
    if (!found.length) continue;
    pages++;
    const page = doc.getPage(i);
    const { width, height } = sizes[i];
    for (const w of found) {
      const text = safeText(w.text, font).trim();
      if (!text) continue;
      const x = w.x0 / scale;
      const boxW = (w.x1 - w.x0) / scale;
      const boxH = (w.y1 - w.y0) / scale;
      const y = height - w.y1 / scale + boxH * 0.15;
      let size = Math.max(4, boxH * 0.9);
      const tw = font.widthOfTextAtSize(text, size);
      if (tw > 0) size = Math.max(3, Math.min(size * 1.6, size * (boxW / tw)));
      page.drawText(text, { x, y, size, font, opacity: 0 });
      words++;
    }
    void width;
  }
  await fsp.writeFile(output, await doc.save());
  return { pages, words };
}

// ---------------------------------------------------------------- to Word

/**
 * A Word document with the PDF's text as paragraphs, page by page. Pages with
 * little text (scans, drawings) are included as pictures so nothing is lost.
 */
export async function pdfToDocx(input: string, output: string, render?: RenderPages): Promise<{ pages: number }> {
  const { items, sizes } = await textItems(input);
  const pngs = render ? await render(input, 1.6).catch(() => [] as Buffer[]) : [];
  const blocks: Block[] = [];
  for (let p = 1; p <= sizes.length; p++) {
    const its = items.filter((i) => i.page === p && i.str.trim());
    if (p > 1) blocks.push({ type: 'pageBreak' });
    const chars = its.reduce((n, i) => n + i.str.length, 0);
    if (chars < 40 && pngs[p - 1]) {
      const meta = await sharp()(pngs[p - 1]).metadata();
      blocks.push({ type: 'image', png: pngs[p - 1], width: meta.width ?? 800, height: meta.height ?? 1000 });
      continue;
    }
    // Lines by position, top to bottom; a gap bigger than a line starts a new paragraph.
    const lines: { y: number; h: number; text: string }[] = [];
    for (const it of [...its].sort((a, b) => b.y - a.y || a.x - b.x)) {
      const last = lines[lines.length - 1];
      if (last && Math.abs(last.y - it.y) < it.height * 0.5) last.text += (last.text.endsWith(' ') || it.str.startsWith(' ') ? '' : ' ') + it.str;
      else lines.push({ y: it.y, h: it.height, text: it.str });
    }
    const typical = lines.map((l) => l.h).sort((a, b) => a - b)[Math.floor(lines.length / 2)] ?? 11;
    let para: string[] = [];
    let prevY: number | undefined;
    const flush = () => {
      if (para.length) blocks.push({ type: 'para', runs: [{ text: para.join(' ').replace(/\s+/g, ' ').trim() }] });
      para = [];
    };
    for (const l of lines) {
      if (prevY !== undefined && prevY - l.y > typical * 1.9) flush();
      if (l.h > typical * 1.35 && l.text.trim().length < 120) {
        flush();
        blocks.push({ type: 'heading', level: l.h > typical * 1.8 ? 1 : 2, text: l.text.trim() });
      } else para.push(l.text);
      prevY = l.y;
    }
    flush();
  }
  await fsp.writeFile(output, buildDocx(blocks));
  return { pages: sizes.length };
}

/** A new PDF from pages of one or more PDFs, in the given order, each turned as asked. */
export async function organizePdf(pages: OrganizePage[], out: string): Promise<{ pages: number; summary: string }> {
  const { degrees } = await import('pdf-lib');
  const docs = new Map<string, Awaited<ReturnType<typeof PDFDocument.load>>>();
  for (const p of new Set(pages.map((x) => x.file))) docs.set(p, await PDFDocument.load(await fsp.readFile(p), { ignoreEncryption: true }));
  const counts = Object.fromEntries([...docs].map(([f, d]) => [f, d.getPageCount()]));
  const plan = checkOrganize(pages, counts);
  const doc = await PDFDocument.create();
  for (const p of plan) {
    const [copy] = await doc.copyPages(docs.get(p.file)!, [p.page]);
    if (p.rotate) copy.setRotation(degrees((copy.getRotation().angle + p.rotate) % 360));
    doc.addPage(copy);
  }
  await fsp.writeFile(out, await doc.save());
  return { pages: plan.length, summary: describeOrganize(plan, counts[plan[0].file] ?? plan.length) };
}
