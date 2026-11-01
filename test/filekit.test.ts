// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The file kit: every pure PDF operation, the format readers and writers,
// the conversion table, workflows, and real runs through the converter
// (with qpdf, poppler, Ghostscript, Graphviz and LibreOffice when installed).

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import * as K from '../core/filekit/pdfkit';
import { blocksToMarkdown, chunkForAi, diffSummary, diffWords, findTables, toBlocks, toLines, type Piece } from '../core/filekit/textlayout';
import { csvToTable, markdownTable, parseCsv, parseToml, parseXml, tableToCsv, tableToValue, valueToTable, valueToXml, writeToml, xmlDocToValue } from '../core/filekit/data';
import { contactsToVcf, parseIcs, parseSubtitles, parseVcf, notebookToScript, shiftCues, writeSubtitles } from '../core/filekit/formats';
import { dxfToSvg, parseDxf, writeDxf } from '../core/filekit/dxf';
import { fontNames, readIcns, readIco, readSfnt, sfntToWoff, sfntToWoff2, woff2ToSfnt, woffToSfnt, writeIcns, writeIco } from '../core/filekit/binfmt';
import { allRoutes, familyOf, targetsFor } from '../core/filekit/matrix';
import { checkWorkflow, matches, nextRun } from '../core/filekit/workflow';
import { isKitTool, KIT_INFO, kitArgs, kitBlocked, kitDefaults, type KitTool } from '../core/filekit/tools';
import { TOOL_INFO } from '../core/convert-types';
import { Converter } from '../electron/services/convert';
import { runSteps } from '../electron/services/workflows';

const dir = mkdtempSync(path.join(tmpdir(), 'keeper-filekit-'));
const has = (bin: string) => { try { execFileSync('which', [bin], { stdio: 'ignore' }); return true; } catch { return false; } };

async function makePdf(pages: (string[] | null)[], size: [number, number] = [595, 842]): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  for (const lines of pages) {
    const p = d.addPage(size);
    if (lines) lines.forEach((l, i) => p.drawText(l, { x: 72, y: 760 - i * 18, size: i === 0 ? 22 : 11, font: f }));
  }
  return d.save();
}
const count = async (b: Uint8Array) => (await PDFDocument.load(b)).getPageCount();
const write = (name: string, data: Uint8Array | string) => { const p = path.join(dir, name); writeFileSync(p, data); return p; };

describe('PDF page operations', () => {
  it('reverses, mixes and collates', async () => {
    const a = await makePdf([['A1'], ['A2'], ['A3']]);
    const b = await makePdf([['B1'], ['B2']]);
    expect(await count(await K.reverse(a))).toBe(3);
    const mixed = await PDFDocument.load(await K.alternate([a, b]));
    expect(mixed.getPageCount()).toBe(5);
    // Duplex: fronts 1,3 and backs scanned last-first (4,2) give 1,2,3,4.
    const fronts = await makePdf([['p1'], ['p3']]);
    const backs = await makePdf([['p4'], ['p2']]);
    const c = await K.alternate([fronts, backs], { reverseSecond: true });
    const { extractPdfText } = await import('../core/convert');
    const f = write('collated.pdf', c);
    expect((await extractPdfText(f)).text.replace(/\s+/g, ' ')).toBe('p1 p2 p3 p4');
  });

  it('divides into groups', () => {
    expect(K.divideGroups(7, { every: 3 })).toEqual([[0, 1, 2], [3, 4, 5], [6]]);
    expect(K.divideGroups(7, { parts: 2 })).toEqual([[0, 1, 2, 3], [4, 5, 6]]);
    expect(K.divideGroups(7, { at: '3, 6' })).toEqual([[0, 1], [2, 3, 4], [5, 6]]);
  });

  it('imposes: n-up, booklet order, one long page, poster, paper size', async () => {
    const src = await makePdf([['1'], ['2'], ['3'], ['4'], ['5']]);
    expect(await count(await K.nUp(src, 4))).toBe(2);
    expect(await count(await K.nUp(src, 2))).toBe(3);
    await expect(K.nUp(src, 3)).rejects.toThrow(/Choose 2, 4/);
    expect(K.bookletOrder(4)).toEqual([[3, 0], [1, 2]]);
    expect(K.bookletOrder(5)).toEqual([[-1, 0], [1, -1], [5, 2], [3, 4]].map(([a, b]) => [a > 4 ? -1 : a, b > 4 ? -1 : b]) as [number, number][]);
    expect(await count(await K.booklet(src))).toBe(4);
    const tall = await PDFDocument.load(await K.singlePage(src));
    expect(tall.getPageCount()).toBe(1);
    expect(Math.round(tall.getPage(0).getHeight())).toBe(842 * 5);
    expect(await count(await K.poster(await makePdf([['big']]), { across: 2, down: 3 }))).toBe(6);
    const letter = await PDFDocument.load(await K.fitPaper(src, 'letter'));
    expect(letter.getPage(0).getSize()).toEqual({ width: 612, height: 792 });
  });

  it('rotates by any angle, growing the page', async () => {
    const src = await makePdf([['x']], [200, 100]);
    const r = await PDFDocument.load(await K.rotateAny(src, 90));
    expect(r.getPage(0).getRotation().angle).toBe(90);
    const r30 = await PDFDocument.load(await K.rotateAny(src, 30));
    const { width, height } = r30.getPage(0).getSize();
    expect(width).toBeCloseTo(200 * Math.cos(Math.PI / 6) + 100 * Math.sin(Math.PI / 6), 1);
    expect(height).toBeCloseTo(200 * Math.sin(Math.PI / 6) + 100 * Math.cos(Math.PI / 6), 1);
  });

  it('copes with blank pages that have no content', async () => {
    const src = await makePdf([['a'], null, ['c']]);
    expect(await count(await K.nUp(src, 2))).toBe(2);
    expect(await count(await K.rotateAny(src, 10))).toBe(3);
  });

  it('crops by margins and boxes, and reports sizes', async () => {
    const src = await makePdf([['x']]);
    const c = await PDFDocument.load(await K.crop(src, { margins: { top: 10, right: 20, bottom: 30, left: 40 } }));
    const box = c.getPage(0).getCropBox();
    expect([box.x, box.y, box.width, box.height]).toEqual([40, 30, 595 - 60, 842 - 40]);
    await expect(K.crop(src, { margins: { top: 500, right: 0, bottom: 500, left: 0 } })).rejects.toThrow(/bigger than the page/);
    const facts = await K.dimensions(src);
    expect(facts[0]).toMatchObject({ page: 1, paper: 'a4', widthMm: 209.9 });
  });

  it('overlays and underlays', async () => {
    const page = await makePdf([['body'], ['body 2']]);
    const head = await makePdf([['LETTERHEAD']]);
    const o = await PDFDocument.load(await K.overlay(page, head, { under: true }));
    expect(o.getPageCount()).toBe(2);
    const f = write('underlay.pdf', await o.save());
    const { extractPdfText } = await import('../core/convert');
    expect((await extractPdfText(f)).text).toMatch(/LETTERHEAD[\s\S]*body/);
  });

  it('header, footer, Bates, stamps and watermarks put their text on the pages', async () => {
    const { extractPdfText } = await import('../core/convert');
    const src = await makePdf([['one'], ['two']]);
    const hf = write('hf.pdf', await K.headerFooter(src, { footer: { center: 'Page {page} of {pages}' }, header: { left: '{file}' }, file: 'report.pdf' }));
    const t = (await extractPdfText(hf)).text;
    expect(t).toContain('Page 1 of 2');
    expect(t).toContain('Page 2 of 2');
    expect(t).toContain('report.pdf');
    expect(K.fillTokens('{page}/{pages} {n}', { page: 3, pages: 9, bates: 'X1' })).toBe('3/9 X1');
    const b = await K.bates([src, src], { prefix: 'ABC', digits: 4, start: 7 });
    expect(b.ranges).toEqual([['ABC0007', 'ABC0008'], ['ABC0009', 'ABC0010']]);
    expect(b.next).toBe(11);
    expect((await extractPdfText(write('bates.pdf', b.files[1]))).text).toContain('ABC0010');
    expect((await extractPdfText(write('stamp.pdf', await K.stamp(src, { text: 'Approved', pages: '1' })))).text).toContain('APPROVED');
    expect((await extractPdfText(write('wm.pdf', await K.textWatermark(src, { text: 'SECRET', tile: true })))).text).toContain('SECRET');
    expect(K.winAnsi('“smart” – quotes…  ✓')).toBe('"smart" - quotes...  ?');
  });

  it('puts a picture on pages', async () => {
    const sharp = (await import('sharp')).default;
    const png = await sharp({ create: { width: 20, height: 10, channels: 4, background: '#f00' } }).png().toBuffer();
    const out = await PDFDocument.load(await K.imageWatermark(await makePdf([['x']]), png, { spot: 'bottom-right' }));
    expect(out.getPageCount()).toBe(1);
  });

  it('writes and reads bookmarks, a contents page and page labels', async () => {
    const list = K.parseBookmarks('Intro | 1\n  Background | 2\n    Detail | 2\nResults | 3');
    expect(list).toEqual([{ title: 'Intro', page: 1, children: [{ title: 'Background', page: 2, children: [{ title: 'Detail', page: 2 }] }] }, { title: 'Results', page: 3 }]);
    expect(K.parseBookmarks(K.formatBookmarks(list))).toEqual(list);
    expect(() => K.parseBookmarks('No page here')).toThrow(/page number/);
    const src = await makePdf([['a'], ['b'], ['c']]);
    const marked = await K.setBookmarks(src, list);
    expect(await K.readBookmarks(marked)).toEqual(list);
    const toc = await K.tableOfContents(marked, list);
    expect(await count(toc)).toBe(4);
    const back = await K.readBookmarks(toc);
    expect(back[0]).toEqual({ title: 'Contents', page: 1 });
    expect(back[2]).toEqual({ title: 'Results', page: 4 });
    const ranges = K.parseLabelSpec('1: roman\n3: "A-" decimal from 5');
    expect([1, 2, 3, 4].map((p) => K.labelFor(p, ranges))).toEqual(['i', 'ii', 'A-5', 'A-6']);
    const labelled = await PDFDocument.load(await K.setPageLabels(src, ranges));
    expect(labelled.catalog.get(PDFName.of('PageLabels'))).toBeTruthy();
    expect(() => K.parseLabelSpec('nonsense')).toThrow();
  });

  it('removes annotations, flattens and makes form fields', async () => {
    const src = await makePdf([['Form']]);
    const fields = K.parseFieldSpec('text name 1 72 700 200 20\ncheckbox ok 1 72 650 14 14\ndropdown country 1 72 600 120 20 Estonia, UK\nradio pick 1 300 600 14 14 a, b');
    const withFields = await K.addFields(src, fields);
    const form = (await PDFDocument.load(withFields)).getForm();
    expect(form.getFields().map((f) => f.getName()).sort()).toEqual(['country', 'name', 'ok', 'pick']);
    expect(form.getDropdown('country').getOptions()).toEqual(['Estonia', 'UK']);
    const flat = await K.flatten(withFields);
    expect(flat.fields).toBe(4);
    expect((await PDFDocument.load(flat.bytes)).getForm().getFields()).toHaveLength(0);
    const r = await K.removeAnnotations(withFields, { keepForms: false });
    expect(r.removed).toBeGreaterThanOrEqual(4);
    expect(() => K.parseFieldSpec('text only')).toThrow();
  });

  it('attaches and takes out files', async () => {
    const src = await makePdf([['x']]);
    const withFile = await K.attach(src, [{ name: 'notes.txt', data: new TextEncoder().encode('hello attachment') }]);
    const list = await K.listAttachments(withFile);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('notes.txt');
    expect(new TextDecoder().decode(list[0].data)).toBe('hello attachment');
  });

  it('edits, strips and reads details; sanitizes risky content', async () => {
    const src = await makePdf([['x']]);
    const m = await K.writeMeta(src, { title: 'Quarterly', author: 'Ada', keywords: 'a, b' });
    expect(await K.readMeta(m)).toMatchObject({ title: 'Quarterly', author: 'Ada', pages: 1 });
    // A PDF with JavaScript, an open action, an attachment and a web link.
    const d = await PDFDocument.load(await K.attach(m, [{ name: 'x.bin', data: new Uint8Array([1, 2]) }]));
    const js = d.context.obj({ S: 'JavaScript', JS: 'app.alert(1)' } as never);
    d.catalog.set(PDFName.of('OpenAction'), js);
    const link = d.context.register(d.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 10, 10], A: { S: 'URI', URI: 'https://example.com' } } as never));
    d.getPage(0).node.set(PDFName.of('Annots'), d.context.obj([link]));
    const r = await K.sanitize(await d.save());
    expect(r.removed).toEqual(expect.arrayContaining(['automatic actions', 'attached files', 'outside links', 'document details']));
    const clean = await PDFDocument.load(r.bytes, { updateMetadata: false });
    expect(clean.catalog.get(PDFName.of('OpenAction'))).toBeUndefined();
    expect(await K.listAttachments(r.bytes)).toHaveLength(0);
    expect((await K.readMeta(r.bytes)).author).toBeUndefined();
  });

  it('lists and sets layers', async () => {
    const d = await PDFDocument.load(await makePdf([['x']]));
    const ocg = (name: string) => d.context.register(d.context.obj({ Type: 'OCG', Name: name } as never));
    const a = ocg('Notes');
    const b = ocg('Print marks');
    d.catalog.set(PDFName.of('OCProperties'), d.context.obj({ OCGs: [a, b], D: { OFF: [b] } } as never));
    const bytes = await d.save();
    expect(await K.listLayers(bytes)).toEqual([{ name: 'Notes', visible: true }, { name: 'Print marks', visible: false }]);
    const flipped = await K.setLayers(bytes, { Notes: false, 'Print marks': true });
    expect(await K.listLayers(flipped)).toEqual([{ name: 'Notes', visible: false }, { name: 'Print marks', visible: true }]);
  });

  it('finds the pictures inside', async () => {
    const sharp = (await import('sharp')).default;
    const d = await PDFDocument.create();
    const jpg = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#0a0' } }).jpeg().toBuffer();
    const png = await sharp({ create: { width: 50, height: 20, channels: 3, background: '#00a' } }).png().toBuffer();
    const p = d.addPage();
    p.drawImage(await d.embedJpg(jpg), { x: 0, y: 0, width: 40, height: 30 });
    p.drawImage(await d.embedPng(png), { x: 50, y: 0, width: 50, height: 20 });
    const imgs = await K.listImages(await d.save());
    expect(imgs.map((i) => [i.filter, i.width, i.height])).toEqual(expect.arrayContaining([['/DCTDecode', 40, 30], ['/FlateDecode', 50, 20]]));
    expect(Buffer.from(imgs.find((i) => i.filter === '/DCTDecode')!.data).equals(jpg)).toBe(true);
  });
});

describe('text layout', () => {
  const piece = (page: number, str: string, x: number, y: number, h = 11): Piece => ({ page, str, x, y, width: str.length * h * 0.5, height: h });
  it('builds lines, headings and paragraphs', () => {
    const lines = toLines([piece(1, 'Title', 72, 760, 24), piece(1, 'First line of a', 72, 720), piece(1, 'paragraph.', 72, 706), piece(1, '• a point', 72, 680)]);
    expect(lines.map((l) => l.text)).toEqual(['Title', 'First line of a', 'paragraph.', '• a point']);
    const md = blocksToMarkdown(toBlocks(lines));
    expect(md).toBe('# Title\n\nFirst line of a paragraph.\n- a point\n');
  });
  it('finds tables by aligned columns', () => {
    const rows = [['Item', 'Qty', 'Price'], ['Apple', '3', '1.20'], ['Pear', '5', '0.80']];
    const items = rows.flatMap((r, k) => r.map((c, j) => piece(2, c, 72 + j * 120, 600 - k * 18)));
    const t = findTables(toLines(items));
    expect(t).toEqual([{ page: 2, rows }]);
  });
  it('chunks for AI with headings, pages and overlap', () => {
    const blocks = toBlocks(toLines([piece(1, 'Intro', 72, 760, 24), ...Array.from({ length: 30 }, (_, i) => piece(1, `Sentence number ${i} is here.`, 72, 700 - i * 30)), piece(2, 'Next', 72, 760, 24), piece(2, 'Short one.', 72, 700)]));
    const chunks = chunkForAi(blocks, { target: 40, overlap: 10, source: 'x.pdf' });
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks[0]).toMatchObject({ id: 'x.pdf#1', heading: 'Intro', page: 1 });
    expect(chunks[chunks.length - 1]).toMatchObject({ heading: 'Next', page: 2 });
    expect(chunks.every((c) => c.tokens > 0)).toBe(true);
  });
  it('diffs words', () => {
    const ops = diffWords('the quick brown fox'.split(' '), 'the quick red fox jumps'.split(' '));
    expect(ops).toEqual([{ kind: 'same', words: ['the', 'quick'] }, { kind: 'removed', words: ['brown'] }, { kind: 'added', words: ['red'] }, { kind: 'same', words: ['fox'] }, { kind: 'added', words: ['jumps'] }]);
    expect(diffSummary(ops)).toEqual({ added: 2, removed: 1, same: 3 });
  });
});

describe('data formats', () => {
  it('reads and writes CSV with quotes and line breaks', () => {
    const rows = parseCsv('a,b\n"x, y","line\nbreak"\n"q""uote",2\n');
    expect(rows).toEqual([['a', 'b'], ['x, y', 'line\nbreak'], ['q"uote', '2']]);
    const t = csvToTable('a;b\n1;two\n');
    expect(t).toEqual({ columns: ['a', 'b'], rows: [[1, 'two']] });
    expect(parseCsv(tableToCsv({ columns: ['a', 'b'], rows: [['x, y', 'q"']] }))).toEqual([['a', 'b'], ['x, y', 'q"']]);
  });
  it('turns records into tables and back, nested keys included', () => {
    const v = [{ name: 'A', meta: { color: 'red' } }, { name: 'B', extra: 1 }];
    const t = valueToTable(v as never);
    expect(t.columns).toEqual(['name', 'meta.color', 'extra']);
    expect(tableToValue(t)).toEqual([{ name: 'A', meta: { color: 'red' }, extra: null }, { name: 'B', meta: { color: null }, extra: 1 }]);
    expect(valueToTable({ data: [{ a: 1 }] }).rows).toEqual([[1]]);
  });
  it('round-trips TOML', () => {
    const src = 'title = "Demo"\n# comment\n[owner]\nname = "Ada" # inline\nborn = 1815-12-10\nhex = 0xff\n[[items]]\nid = 1\ntags = ["a", "b"]\npoint = { x = 1, y = 2 }\n[[items]]\nid = 2\nlong = """\nmulti\nline"""\n';
    const v = parseToml(src);
    expect(v).toEqual({ title: 'Demo', owner: { name: 'Ada', born: '1815-12-10', hex: 255 }, items: [{ id: 1, tags: ['a', 'b'], point: { x: 1, y: 2 } }, { id: 2, long: 'multi\nline' }] });
    expect(parseToml(writeToml(v))).toEqual(v);
    expect(() => parseToml('a = ')).toThrow(/TOML line 1/);
  });
  it('reads and writes XML', () => {
    const x = '<?xml version="1.0"?><!-- c --><lib name="City"><book id="1"><title>A &amp; B</title></book><book id="2"><title><![CDATA[<raw>]]></title></book></lib>';
    expect(parseXml(x).children).toHaveLength(1);
    const v = xmlDocToValue(x);
    expect(v).toEqual({ lib: { '@name': 'City', book: [{ '@id': 1, title: 'A & B' }, { '@id': 2, title: '<raw>' }] } });
    expect(xmlDocToValue(valueToXml(v))).toEqual(v);
  });
  it('reads Markdown tables', () => {
    expect(markdownTable('x\n\n| a | b |\n|---|:-:|\n| 1 | two \\| 2 |\n')).toEqual({ columns: ['a', 'b'], rows: [[1, 'two | 2']] });
  });
});

describe('subtitles, calendars, contacts, notebooks', () => {
  const srt = '1\n00:00:01,000 --> 00:00:03,500\nHello <i>there</i>\n\n2\n00:01:04,250 --> 00:01:06,000\nTwo\nlines\n';
  it('converts subtitles between every format and back', () => {
    const cues = parseSubtitles(srt, 'srt');
    expect(cues).toEqual([{ start: 1, end: 3.5, text: 'Hello there' }, { start: 64.25, end: 66, text: 'Two\nlines' }]);
    for (const f of ['srt', 'vtt', 'ass', 'sbv', 'json'] as const) {
      const back = parseSubtitles(writeSubtitles(cues, f), f);
      expect(back.map((c) => [Math.round(c.start * 10), Math.round(c.end * 10), c.text])).toEqual(cues.map((c) => [Math.round(c.start * 10), Math.round(c.end * 10), c.text]));
    }
    const lrc = parseSubtitles(writeSubtitles(cues, 'lrc'), 'lrc');
    expect(lrc.map((c) => c.start)).toEqual([1, 64.25]);
    expect(shiftCues(cues, -2)[0]).toMatchObject({ start: 0, end: 1.5 });
  });
  it('reads calendars and contacts', () => {
    const ics = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:Stand\r\n up\r\nDTSTART;TZID=Europe/Tallinn:20261031T090000\r\nDTEND;VALUE=DATE:20261101\r\nDESCRIPTION:a\\, b\\nc\r\nBEGIN:VALARM\r\nDESCRIPTION:alarm\r\nEND:VALARM\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
    expect(parseIcs(ics)).toEqual([expect.objectContaining({ summary: 'Standup', start: '2026-10-31 09:00 Europe/Tallinn', end: '2026-11-01', description: 'a, b\nc' })]);
    const vcf = 'BEGIN:VCARD\r\nVERSION:3.0\r\nN:Lovelace;Ada;;;\r\nitem1.EMAIL;TYPE=INTERNET:ada@example.com\r\nTEL;TYPE=CELL:+44 1\r\nORG:Engines;R&D\r\nEND:VCARD\r\n';
    const people = parseVcf(vcf);
    expect(people[0]).toMatchObject({ name: 'Ada Lovelace', emails: ['ada@example.com'], phones: ['+44 1'], org: 'Engines, R&D' });
    const again = parseVcf(contactsToVcf([{ Name: 'Ada Lovelace', 'E-mail 1': 'ada@example.com', 'Phone 1': '+44 1' }]));
    expect(again[0]).toMatchObject({ name: 'Ada Lovelace', emails: ['ada@example.com'], phones: ['+44 1'] });
  });
  it('turns notebooks into scripts', () => {
    const nb = JSON.stringify({ cells: [{ cell_type: 'markdown', source: ['# T'] }, { cell_type: 'code', source: ['x = 1'] }], metadata: { language_info: { name: 'python' } } });
    expect(notebookToScript(nb)).toEqual({ ext: 'py', text: '# %% [markdown]\n# # T\n\n# %%\nx = 1\n' });
  });
});

describe('drawings, fonts and icons', () => {
  it('reads DXF and draws it', () => {
    const dxf = writeDxf([
      { type: 'line', layer: 'walls', x1: 0, y1: 0, x2: 100, y2: 0 },
      { type: 'circle', layer: '0', cx: 50, cy: 50, r: 20 },
      { type: 'arc', layer: '0', cx: 50, cy: 50, r: 30, a1: 0, a2: 90 },
      { type: 'poly', layer: 'walls', points: [[0, 0], [100, 0], [100, 100]], closed: true },
      { type: 'text', layer: 'notes', x: 10, y: 90, h: 5, text: 'Plan <A>', rot: 0 },
    ]);
    const d = parseDxf(dxf);
    expect(d.shapes.map((s) => s.type)).toEqual(['line', 'circle', 'arc', 'poly', 'text']);
    expect(d.bounds).toMatchObject({ minX: 0, minY: 0, maxX: 100 });
    const svg = dxfToSvg(d, { hidden: ['notes'] });
    expect(svg).toContain('<circle');
    expect(svg).toContain('<path');
    expect(svg).not.toContain('Plan');
    expect(dxfToSvg(d)).toContain('Plan &lt;A>');
  });

  const fontFile = ['/usr/share/fonts/truetype/crosextra/Carlito-Regular.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/System/Library/Fonts/Geneva.ttf', 'C:/Windows/Fonts/arial.ttf'].find(existsSync);
  it.skipIf(!fontFile)('converts fonts to WOFF and WOFF2 and back without losing a byte of any table', () => {
    const ttf = readFileSync(fontFile!);
    const tables = (b: Buffer) => readSfnt(b).tables.map((t) => [t.tag, t.data.toString('hex')]).sort();
    const woff = sfntToWoff(ttf);
    expect(woff.subarray(0, 4).toString()).toBe('wOFF');
    expect(woff.length).toBeLessThan(ttf.length);
    expect(tables(woffToSfnt(woff))).toEqual(tables(ttf));
    const woff2 = sfntToWoff2(ttf);
    expect(woff2.subarray(0, 4).toString()).toBe('wOF2');
    expect(woff2.length).toBeLessThan(woff.length);
    expect(tables(woff2ToSfnt(woff2))).toEqual(tables(ttf));
    expect(fontNames(ttf).family).toBeTruthy();
  });

  it('makes and reads icons', async () => {
    const sharp = (await import('sharp')).default;
    const png = (s: number) => sharp({ create: { width: s, height: s, channels: 4, background: '#08f' } }).png().toBuffer();
    const ico = writeIco([{ size: 16, png: await png(16) }, { size: 256, png: await png(256) }]);
    expect(ico.readUInt16LE(4)).toBe(2);
    const back = readIco(ico);
    expect((await sharp(back.png!).metadata()).width).toBe(256);
    const icns = writeIcns([{ size: 32, png: await png(32) }, { size: 512, png: await png(512) }]);
    expect(icns.subarray(0, 4).toString()).toBe('icns');
    expect(icns.readUInt32BE(4)).toBe(icns.length);
    expect((await sharp(readIcns(icns)).metadata()).width).toBe(512);
  });
});

describe('the conversion table and tools', () => {
  it('knows the families and what each can become', () => {
    expect(familyOf('EPUB')).toBe('ebook');
    expect(targetsFor('csv').map((t) => t.format)).toEqual(expect.arrayContaining(['xlsx', 'json', 'yaml', 'toml', 'xml', 'sqlite', 'md', 'html']));
    expect(targetsFor('csv').some((t) => t.format === 'csv')).toBe(false);
    expect(targetsFor('jpeg').some((t) => t.format === 'jpg')).toBe(false);
    expect(targetsFor('ttf').map((t) => t.format)).toEqual(['woff', 'woff2']);
    expect(targetsFor('dxf').map((t) => t.format)).toEqual(['svg', 'png', 'pdf']);
    expect(targetsFor('unknownext')).toEqual([]);
    const routes = allRoutes();
    expect(routes.length).toBeGreaterThan(400);
    expect(routes.every((r) => r.from !== r.to)).toBe(true);
  });
  it('every kit tool has defaults, a known category and sensible blocking', () => {
    for (const t of Object.keys(KIT_INFO) as KitTool[]) {
      expect(isKitTool(t)).toBe(true);
      expect(TOOL_INFO[t]).toBeTruthy();
      expect(kitDefaults(t).tool).toBe(t);
    }
    expect(kitArgs({ tool: 'pdf.nup', per: 9 } as never).per).toBe(9);
    expect(kitArgs({ tool: 'pdf.nup', args: { per: '2' } } as never).per).toBe('2');
    expect(kitBlocked(kitDefaults('pdf.compare'), ['a.pdf'])).toMatch(/two/);
    expect(kitBlocked(kitDefaults('pdf.unlock'), ['a.pdf'])).toMatch(/own/);
    expect(kitBlocked({ tool: 'pdf.unlock', args: { owner: true } }, ['a.pdf'])).toBeNull();
  });
  it('workflows: checks, schedules and file patterns', () => {
    expect(checkWorkflow({ name: '', steps: [] })).toHaveLength(2);
    expect(checkWorkflow({ name: 'x', steps: [{ id: '1', op: { tool: 'file.checksum', algo: 'sha256' } }, { id: '2', op: { tool: 'pdf.merge' } }] })[0]).toMatch(/last step/);
    const from = new Date(2026, 9, 31, 10, 0); // a Saturday
    expect(nextRun('daily 08:30', from)).toEqual(new Date(2026, 10, 1, 8, 30));
    expect(nextRun('weekdays 08:30', from)).toEqual(new Date(2026, 10, 2, 8, 30));
    expect(nextRun('weekly sat 11:00', from)).toEqual(new Date(2026, 9, 31, 11, 0));
    expect(nextRun('hourly', from)).toEqual(new Date(2026, 9, 31, 11, 0));
    expect(nextRun('every 15m', from)!.getTime() - from.getTime()).toBe(15 * 60_000);
    expect(nextRun('sometimes', from)).toBeUndefined();
    expect(matches('Invoice 12.PDF', '*.pdf')).toBe(true);
    expect(matches('a.png', '*.{jpg,png}')).toBe(true);
    expect(matches('a.txt', '*.pdf, *.jpg')).toBe(false);
  });
});

// ---------------------------------------------------------------- real runs through the converter

const conv = new Converter({ modelsDir: path.join(dir, 'models') });
const run = (tool: string, inputs: string[], args: Record<string, unknown> = {}) => conv.run({ op: { tool, args } as never, inputs, outDir: path.join(dir, 'out') });

describe('the converter', () => {
  it('runs PDF tools end to end', async () => {
    const a = write('report.pdf', await makePdf([['Introduction', 'The quick brown fox jumps over the lazy dog.'], null, ['Results', 'All good.']]));
    const b = write('report v2.pdf', await makePdf([['Introduction', 'The quick red fox jumps over the lazy dog.'], ['Results', 'All good.']]));
    const blank = await run('pdf.blank', [a]);
    expect(blank.message).toMatch(/Removed 1 blank page \(2\)/);
    expect(await count(readFileSync(blank.outputs[0]))).toBe(2);
    const bm = await run('pdf.bookmarks', [a], { mode: 'auto' });
    expect(bm.details).toBe('Introduction | 1\nResults | 3');
    const md = await run('pdf.toText', [a], { format: 'md' });
    expect(readFileSync(md.outputs[0], 'utf8')).toMatch(/^# Introduction\n\nThe quick brown fox/);
    const cmp = await run('pdf.compare', [a, b], { visual: false });
    expect(cmp.message).toBe('1 words added, 1 removed');
    expect(readFileSync(cmp.outputs[0], 'utf8')).toContain('<del>brown</del> <ins>red</ins>');
    const same = await run('pdf.compare', [a, a], { visual: false });
    expect(same.verified).toBe(true);
    const ai = await run('pdf.forAi', [a]);
    const chunks = JSON.parse(readFileSync(ai.outputs[0], 'utf8')).chunks;
    expect(chunks[0]).toMatchObject({ heading: 'Introduction', page: 1 });
    const edited = await run('pdf.replaceText', [a], { find: 'brown', replace: 'green' });
    expect(edited.message).toMatch(/Changed 1 place/);
    const { extractPdfText } = await import('../core/convert');
    expect((await extractPdfText(edited.outputs[0])).text).toContain('green');
    await expect(run('pdf.unlock', [a], { owner: false })).rejects.toThrow(/own/);
  });

  it.skipIf(!has('pdftoppm'))('draws pages: crop, recolour, deskew, compare looks', async () => {
    const a = write('look.pdf', await makePdf([['Hello world', 'Some text to look at']]));
    const crop = await run('pdf.crop', [a], { mode: 'auto' });
    const box = (await PDFDocument.load(readFileSync(crop.outputs[0]))).getPage(0).getCropBox();
    expect(box.width).toBeLessThan(400);
    const grey = await run('pdf.colors', [a], { mode: 'invert', dpi: 72 });
    expect(await count(readFileSync(grey.outputs[0]))).toBe(1);
    // A page tilted by 3 degrees comes back straight.
    const sharp = (await import('sharp')).default;
    const { FileKit } = await import('../electron/services/filekit');
    const kit = new FileKit({ extra: conv.extra, sharp: () => sharp, ffmpeg: null, hooks: {}, runOp: (op, i, o) => conv.run({ op, inputs: i, outDir: o }) });
    const lines = Array.from({ length: 20 }, (_, i) => `<text x="40" y="${60 + i * 30}" font-size="18">Line ${i} of a scanned page with plenty of words</text>`).join('');
    const page = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="700" height="700"><rect width="700" height="700" fill="#fff"/>${lines}</svg>`)).png().toBuffer();
    const tilted = await sharp(page).rotate(3, { background: '#fff' }).png().toBuffer();
    const angle = await kit.skewOf(tilted);
    expect(Math.abs(angle + 3)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(await kit.skewOf(page))).toBeLessThan(0.4);
    const b = write('look2.pdf', await makePdf([['Hello world', 'Some other text']]));
    const cmp = await run('pdf.compare', [a, b], { visual: true });
    expect(cmp.outputs.some((o) => /page 1 differences\.png$/.test(o))).toBe(true);
  });

  it.skipIf(!has('qpdf'))('qpdf routes: fast web view, repair, lossless shrink', async () => {
    const a = write('q.pdf', await makePdf([['x']]));
    const lin = await run('pdf.linearize', [a]);
    expect(readFileSync(lin.outputs[0]).toString('latin1')).toMatch(/\/Linearized/);
    const rep = await run('pdf.repair', [a]);
    expect(await count(readFileSync(rep.outputs[0]))).toBe(1);
    const s = await run('pdf.shrink', [a], { engine: 'qpdf' });
    expect(s.outputs).toHaveLength(1);
  });

  it.skipIf(!has('gs'))('Ghostscript routes: PDF/A with a colour profile, outlines', async () => {
    const a = write('g.pdf', await makePdf([['Archive me']]));
    const r = await run('pdf.pdfa', [a], { mode: 'convert', level: '2' });
    expect(r.details).toContain('✓ Says it is PDF/A-2b');
    expect(r.details).toContain('✓ Has a colour profile');
    const o = await run('pdf.outlines', [a]);
    const { extractPdfText } = await import('../core/convert');
    expect((await extractPdfText(o.outputs[0])).text.trim()).toBe('');
  });

  it('signs with a certificate, verifies, and notices tampering', async () => {
    const a = write('contract.pdf', await makePdf([['Contract', 'Terms.']]));
    const r = await run('pdf.certSign', [a], { selfSigned: true, name: 'Test Signer', reason: 'Approved' });
    expect(r.message).toBe('Signed by Test Signer');
    const signed = r.outputs[0];
    const v = await run('pdf.certVerify', [signed]);
    expect(v.details).toMatch(/Signature 1: ✓ intact/);
    expect(v.details).toContain('Signed by: Test Signer');
    // Change one byte inside the signed part.
    const bytes = readFileSync(signed);
    // A byte in the file's header comment: signed, but harmless to the PDF itself.
    bytes[12] ^= 1;
    const bad = write('tampered.pdf', bytes);
    expect((await run('pdf.certVerify', [bad])).details).toMatch(/Signature 1: ✕ broken/);
    // A signed PDF is not re-saved (that would break its signature).
    await expect(run('pdf.certSign', [signed], { cert: r.outputs[1] })).rejects.toThrow(/already signed/);
    // The saved personal certificate signs other documents.
    const other = write('other.pdf', await makePdf([['Other']]));
    const again = await run('pdf.certSign', [other], { cert: r.outputs[1] });
    expect((await run('pdf.certVerify', [again.outputs[0]])).details).toMatch(/Signature 1: ✓ intact\n  Signed by: Test Signer/);
    if (has('pdfsig')) expect(execFileSync('pdfsig', [signed]).toString()).toMatch(/Signature is Valid/);
    if (has('pdfsig')) expect(execFileSync('pdfsig', [bad]).toString()).not.toMatch(/Signature is Valid/);
  });
});

describe('Convert to… (converter matrix smoke test)', () => {
  const sample: Record<string, () => Promise<string>> = {
    csv: async () => write('d.csv', 'name,qty,meta.color\nApple,3,red\n"Pear, green",5,green\n'),
    json: async () => write('d.json', JSON.stringify([{ a: 1, b: { c: 'x' } }, { a: 2 }])),
    yaml: async () => write('d.yaml', '- a: 1\n  b: x\n- a: 2\n'),
    toml: async () => write('d.toml', 'title = "x"\n[[rows]]\na = 1\n'),
    xml: async () => write('d.xml', '<rows><row id="1"><a>1</a></row><row id="2"><a>2</a></row></rows>'),
    srt: async () => write('s.srt', '1\n00:00:01,000 --> 00:00:02,000\nHi\n'),
    vtt: async () => write('s2.vtt', 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi\n'),
    ics: async () => write('e.ics', 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:X\r\nDTSTART:20261031T090000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n'),
    vcf: async () => write('p.vcf', 'BEGIN:VCARD\r\nFN:Ada\r\nEMAIL:a@b.c\r\nEND:VCARD\r\n'),
    ipynb: async () => write('n.ipynb', JSON.stringify({ cells: [{ cell_type: 'code', source: 'print(1)', outputs: [] }], metadata: {} })),
    eml: async () => write('m.eml', 'From: a@b.c\r\nTo: d@e.f\r\nSubject: Hi\r\n\r\nBody\r\n'),
    dxf: async () => write('p.dxf', writeDxf([{ type: 'line', layer: '0', x1: 0, y1: 0, x2: 10, y2: 10 }])),
    obj: async () => write('t.obj', 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n'),
    svg: async () => write('i.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="red"/></svg>'),
    png: async () => { const s = (await import('sharp')).default; const p = path.join(dir, 'x.png'); await s({ create: { width: 48, height: 48, channels: 4, background: '#0f0' } }).png().toFile(p); return p; },
    pdf: async () => write('doc.pdf', await makePdf([['Heading', 'Body text']])),
    md: async () => write('doc.md', '# Title\n\nSome *text*.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n'),
  };
  // Routes that need nothing outside Keeper (office, pandoc, calibre, ghostscript, poppler, duckdb… are tested where installed).
  const builtIn = Object.keys(sample).flatMap((e) => targetsFor(e).filter((t) => !t.engine && !(e === 'pdf' && ['png', 'jpg', 'cbz'].includes(t.format) && !has('pdftoppm')) && !['heic'].includes(t.format) && !(t.format === 'pdf' && !['png', 'svg', 'dxf', 'pdf'].includes(e) && !has('soffice'))).map((t) => [e, t.format] as const));
  it.each(builtIn)('%s → %s', async (from, to) => {
    const input = await sample[from]();
    const r = await conv.run({ op: { tool: 'convert.to', args: { format: to } }, inputs: [input], outDir: path.join(dir, 'matrix', `${from}-${to}`) });
    if (from === 'pdf' && (to === 'csv' || to === 'xlsx')) expect(r.message).toMatch(/No tables/);
    else expect(r.outputs.length).toBeGreaterThan(0);
    for (const o of r.outputs) expect(readFileSync(o).length).toBeGreaterThan(0);
  });

  it('round-trips data through every table format', async () => {
    const src = await sample.csv();
    let file = src;
    for (const fmt of ['xlsx', 'ods', 'json', 'yaml', 'xml', 'sqlite', 'tsv', 'csv']) {
      const r = await conv.run({ op: { tool: 'convert.to', args: { format: fmt } }, inputs: [file], outDir: path.join(dir, 'rt', fmt) });
      file = r.outputs[0];
    }
    const t = csvToTable(readFileSync(file, 'utf8'));
    expect(t.rows.map((r) => r.slice(0, 2))).toEqual([['Apple', 3], ['Pear, green', 5]]);
  });

  it('CSV → XLSX → JSON keeps the rows', async () => {
    const x = await conv.run({ op: { tool: 'convert.to', args: { format: 'xlsx' } }, inputs: [await sample.csv()], outDir: path.join(dir, 'cxj') });
    const j = await conv.run({ op: { tool: 'convert.to', args: { format: 'json' } }, inputs: [x.outputs[0]], outDir: path.join(dir, 'cxj') });
    expect(JSON.parse(readFileSync(j.outputs[0], 'utf8'))).toEqual([{ name: 'Apple', qty: 3, meta: { color: 'red' } }, { name: 'Pear, green', qty: 5, meta: { color: 'green' } }]);
  });

  it('3D models survive OBJ → GLB → STL', async () => {
    const glb = await conv.run({ op: { tool: 'convert.to', args: { format: 'glb' } }, inputs: [await sample.obj()], outDir: path.join(dir, 'm3') });
    expect(readFileSync(glb.outputs[0]).subarray(0, 4).toString()).toBe('glTF');
    const stl = await conv.run({ op: { tool: 'convert.to', args: { format: 'stl' } }, inputs: [glb.outputs[0]], outDir: path.join(dir, 'm3') });
    // Binary STL: 80-byte header, then the triangle count.
    expect(readFileSync(stl.outputs[0]).readUInt32LE(80)).toBe(1);
  });

  it.skipIf(!has('dot'))('Graphviz diagrams', async () => {
    const r = await conv.run({ op: { tool: 'convert.to', args: { format: 'svg' } }, inputs: [write('g.dot', 'digraph { a -> b }')], outDir: path.join(dir, 'dot') });
    expect(readFileSync(r.outputs[0], 'utf8')).toContain('<svg');
  });

  it('mailboxes, contact tables and subtitle shifts', async () => {
    const box = write('box.mbox', 'From a@b Sat Oct 31 10:00:00 2026\nSubject: One\n\nBody\n>From the start\n\nFrom c@d Sat Oct 31 11:00:00 2026\nSubject: Two\n\nBody 2\n');
    const r = await conv.run({ op: { tool: 'convert.mbox' }, inputs: [box], outDir: path.join(dir, 'mbox') });
    expect(r.message).toBe('2 messages');
    expect(readFileSync(r.outputs[1], 'utf8')).toContain('From the start');
    const v = await conv.run({ op: { tool: 'convert.vcard' }, inputs: [write('people.csv', 'Name,E-mail,Phone\nAda,a@b.c,+1\nBob,b@c.d,+2\n')], outDir: path.join(dir, 'vc') });
    expect(parseVcf(readFileSync(v.outputs[0], 'utf8')).map((c) => c.name)).toEqual(['Ada', 'Bob']);
    const s = await conv.run({ op: { tool: 'convert.subShift', args: { seconds: 2.5 } }, inputs: [await sample.srt()], outDir: path.join(dir, 'sub') });
    expect(readFileSync(s.outputs[0], 'utf8')).toContain('00:00:03,500 --> 00:00:04,500');
  });

  it('makes and reads QR codes', async () => {
    const r = await conv.run({ op: { tool: 'file.qrMake', args: { text: 'https://keeper.example/qr' } }, inputs: [await sample.md()], outDir: path.join(dir, 'qr') });
    const back = await conv.run({ op: { tool: 'image.qrRead' }, inputs: [r.outputs[0]], outDir: path.join(dir, 'qr') });
    expect(back.details).toBe('QR CODE: https://keeper.example/qr');
  });
});

describe('outside engines (when installed)', () => {
  const md = () => write('engine.md', '# Engine test\n\nHello *world* from Keeper.\n');
  const to = (input: string, format: string, sub: string) => conv.run({ op: { tool: 'convert.to', args: { format } }, inputs: [input], outDir: path.join(dir, 'eng', sub) });
  it.skipIf(!has('pandoc'))('Pandoc: Markdown → EPUB and LaTeX', async () => {
    const e = await to(md(), 'epub', 'pandoc');
    expect(readFileSync(e.outputs[0]).subarray(0, 2).toString()).toBe('PK');
    expect(readFileSync((await to(md(), 'tex', 'pandoc')).outputs[0], 'utf8')).toContain('\\section{Engine test}');
  });
  it.skipIf(!has('soffice'))('LibreOffice: Markdown → ODT, and a spreadsheet → PDF', async () => {
    const odt = await to(md(), 'odt', 'office');
    expect(readFileSync(odt.outputs[0]).subarray(0, 2).toString()).toBe('PK');
    const x = await to(write('sheet.csv', 'a,b\n1,2\n'), 'xlsx', 'office');
    const pdf = await to(x.outputs[0], 'pdf', 'office');
    expect(readFileSync(pdf.outputs[0]).subarray(0, 5).toString()).toBe('%PDF-');
  }, 120_000);
  it.skipIf(!has('ebook-convert'))('Calibre: EPUB → MOBI, and MOBI → PDF through EPUB', async () => {
    const epub = await to(md(), 'epub', 'cal').catch(() => undefined);
    if (!epub) return;
    const mobi = await to(epub.outputs[0], 'mobi', 'cal');
    expect(readFileSync(mobi.outputs[0]).subarray(60, 68).toString()).toBe('BOOKMOBI');
    if (has('soffice')) {
      const pdf = await to(mobi.outputs[0], 'pdf', 'cal');
      const { extractPdfText } = await import('../core/convert');
      expect((await extractPdfText(pdf.outputs[0])).text).toContain('Hello');
    }
  }, 240_000);
});

describe('workflows', () => {
  it('merge → page numbers → watermark → compress', async () => {
    const a = write('w1.pdf', await makePdf([['one']]));
    const b = write('w2.pdf', await makePdf([['two'], ['three']]));
    const r = await runSteps(conv, {
      name: 'Pack', outDir: path.join(dir, 'flow'), steps: [
        { id: '1', op: { tool: 'pdf.merge' } },
        { id: '2', op: { tool: 'pdf.number', position: 'bottom-center', start: 1 } },
        { id: '3', op: { tool: 'pdf.watermark', text: 'DRAFT', opacity: 0.2 } },
        { id: '4', op: { tool: 'pdf.compress', quality: 60, maxSide: 1600 } },
      ],
    }, [a, b]);
    expect(r.outputs).toHaveLength(1);
    const { extractPdfText } = await import('../core/convert');
    const t = await extractPdfText(r.outputs[0]);
    expect(t.pages).toBe(3);
    expect(t.text).toMatch(/DRAFT/);
    expect(t.text).toMatch(/3/);
  });
});
