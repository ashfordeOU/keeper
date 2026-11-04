// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The PDF reader's edits written into real PDFs: annotations with their own
// appearances, signatures, filled forms, and pages reordered, turned, removed
// and added; then read back.

import { PDFDocument, PDFName, PDFDict, PDFArray, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { applyEdits, bounds, describePdf, pagesUnchanged, quadPoints, rgb, winAnsiSafe, wrapText, type Annot, type PageRef } from '../core/pdf-annotate';

// A 1×1 transparent PNG.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

async function sample(pages = 3, form = true): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const p = doc.addPage([612, 792]);
    p.drawText(`Page ${i + 1}: the quarterly report`, { x: 72, y: 700, size: 14, font });
  }
  if (form) {
    const f = doc.getForm();
    const name = f.createTextField('name');
    name.addToPage(doc.getPage(0), { x: 72, y: 600, width: 200, height: 20 });
    const ok = f.createCheckBox('agree');
    ok.addToPage(doc.getPage(0), { x: 72, y: 560, width: 14, height: 14 });
  }
  return doc.save();
}
const same = (n: number): PageRef[] => Array.from({ length: n }, (_, i) => ({ src: 0, index: i, rotate: 0 }));

describe('helpers', () => {
  it('quad points go top left, top right, bottom left, bottom right', () => {
    expect(quadPoints([[10, 20, 30, 5]])).toEqual([10, 25, 40, 25, 10, 20, 40, 20]);
  });
  it('bounds, colours, wrapping and safe letters', () => {
    expect(bounds([[0, 0, 10, 10], [20, 5, 5, 20]], 1)).toEqual([-1, -1, 27, 27]);
    expect(rgb('#ff0000')).toEqual([1, 0, 0]);
    expect(wrapText('one two three four', 40, 10)).toEqual(['one two', 'three', 'four']);
    expect(wrapText('a\nb', 100, 10)).toEqual(['a', 'b']);
    expect(winAnsiSafe('“Hi” — café ✓')).toBe('"Hi" - café ?');
    expect(pagesUnchanged(same(3), 3)).toBe(true);
    expect(pagesUnchanged([{ src: 0, index: 1, rotate: 0 }, { src: 0, index: 0, rotate: 0 }], 2)).toBe(false);
    expect(pagesUnchanged([{ src: 0, index: 0, rotate: 90 }], 1)).toBe(false);
  });
});

describe('writing edits into the PDF', () => {
  it('adds each kind of annotation as a standard one, with its own appearance', async () => {
    const annots: Annot[] = [
      { id: 'h', page: 0, kind: 'highlight', rects: [[72, 698, 200, 16]], color: '#ffd43b', text: 'quarterly report' },
      { id: 'u', page: 0, kind: 'underline', rects: [[72, 698, 200, 16]], color: '#e03131' },
      { id: 'n', page: 1, kind: 'note', at: [500, 750], text: 'Check these numbers', color: '#ffd43b' },
      { id: 'i', page: 1, kind: 'ink', paths: [[[100, 100], [150, 140], [200, 100]]], color: '#4dabf7', width: 2 },
      { id: 't', page: 2, kind: 'text', rect: [72, 400, 200, 40], text: 'Approved — see notes', size: 12, color: '#212529' },
    ];
    const out = await applyEdits(await sample(3, false), [], { pages: same(3), annots });
    const d = await describePdf(out);
    expect(d.annots).toEqual([['Highlight', 'Underline'], ['Text', 'Ink'], ['FreeText']]);
    const doc = await PDFDocument.load(out);
    const arr = doc.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray);
    const h = doc.context.lookup(arr.get(0)) as PDFDict;
    expect(h.lookup(PDFName.of('QuadPoints'), PDFArray).size()).toBe(8);
    expect(h.lookup(PDFName.of('AP'), PDFDict).has(PDFName.of('N'))).toBe(true);
    expect(h.get(PDFName.of('P'))).toBeDefined();
  });
  it('draws a signature onto the page', async () => {
    const before = await sample(1, false);
    const out = await applyEdits(before, [], { pages: same(1), annots: [{ id: 's', page: 0, kind: 'signature', rect: [300, 100, 150, 50], png: PNG }] });
    const doc = await PDFDocument.load(out);
    const xobj = doc.getPage(0).node.Resources()?.lookup(PDFName.of('XObject'), PDFDict);
    expect(xobj?.keys().length).toBe(1);
    expect((await describePdf(out)).annots[0]).toEqual([]);
  });
  it('fills form fields', async () => {
    const out = await applyEdits(await sample(1), [], { pages: same(1), annots: [], fields: { name: 'Ada Lovelace', agree: true, missing: 'x' } });
    expect((await describePdf(out)).fields).toEqual({ name: 'Ada Lovelace', agree: true });
  });
  it('reorders, turns and removes pages', async () => {
    const out = await applyEdits(await sample(3, false), [], { pages: [{ src: 0, index: 2, rotate: 90 }, { src: 0, index: 0, rotate: 0 }], annots: [{ id: 'n', page: 0, kind: 'note', at: [10, 700], text: 'was page 3', color: '#ffd43b' }] });
    const d = await describePdf(out);
    expect(d.pages).toBe(2);
    expect(d.rotations).toEqual([90, 0]);
    expect(d.annots).toEqual([['Text'], []]);
  });
  it('adds pages from another PDF, and the same page twice', async () => {
    const other = await sample(2, false);
    const out = await applyEdits(await sample(1, false), [other], { pages: [{ src: 0, index: 0, rotate: 0 }, { src: 1, index: 1, rotate: 180 }, { src: 0, index: 0, rotate: 0 }], annots: [] });
    const d = await describePdf(out);
    expect(d.pages).toBe(3);
    expect(d.rotations).toEqual([0, 180, 0]);
  });
  it('the result opens again and keeps the original text', async () => {
    const out = await applyEdits(await sample(2), [], { pages: same(2), annots: [{ id: 'h', page: 1, kind: 'highlight', rects: [[72, 698, 100, 16]], color: '#69db7c' }], fields: { name: 'B' } });
    const again = await applyEdits(out, [], { pages: same(2), annots: [{ id: 'h2', page: 1, kind: 'underline', rects: [[72, 698, 100, 16]], color: '#69db7c' }] });
    const d = await describePdf(again);
    expect(d.annots[1]).toEqual(['Highlight', 'Underline']);
    expect(d.fields.name).toBe('B');
  });
});
