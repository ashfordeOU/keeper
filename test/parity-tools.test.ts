// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The newer Convert tools, run for real: the bundled ffmpeg, pdf-lib and
// pdf.js, and (when installed) poppler and LibreOffice.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';
import { extractPdfText } from '../core/convert';
import { docxToHtml } from '../core/docx';
import { Converter, ffmpegPath } from '../electron/services/convert';
import { formFields } from '../electron/services/pdf-tools';

const root = mkdtempSync(path.join(os.tmpdir(), 'keeper-parity-'));
const ff = ffmpegPath();
const has = (cmd: string) => { try { execFileSync('which', [cmd]); return true; } catch { return false; } };
const poppler = has('pdftoppm');
const soffice = has('soffice');

const conv = new Converter({
  modelsDir: path.join(root, 'models'),
  hooks: {
    // Stand-ins for the app's own speech-to-text and text reader.
    transcribe: async () => [{ start: 0, end: 1.2, text: 'Hello from the test.' }, { start: 1.2, end: 2, text: 'Second line.' }],
    ocrWords: async () => [{ text: 'SCANNED', x0: 100, y0: 100, x1: 400, y1: 160 }, { text: 'invoice', x0: 420, y0: 100, x1: 700, y1: 160 }],
  },
});

async function clip(name: string, opts: { size?: string; seconds?: number; audio?: boolean; color?: string } = {}): Promise<string> {
  const p = path.join(root, name);
  const args = ['-hide_banner', '-y', '-f', 'lavfi', '-i', `testsrc=size=${opts.size ?? '320x240'}:rate=25:duration=${opts.seconds ?? 1}`];
  if (opts.audio !== false) args.push('-f', 'lavfi', '-i', `sine=frequency=440:duration=${opts.seconds ?? 1}`);
  args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', ...(opts.audio !== false ? ['-c:a', 'aac'] : []), '-shortest', p);
  execFileSync(ff!, args, { stdio: 'ignore' });
  return p;
}

async function textPdf(name: string, lines: string[], pages = 1): Promise<string> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let p = 0; p < pages; p++) {
    const page = doc.addPage([595, 842]);
    lines.forEach((l, i) => page.drawText(l, { x: 60, y: 760 - i * 30, size: 16, font }));
  }
  doc.setAuthor('Jane Doe');
  doc.setTitle('Private file');
  const p = path.join(root, name);
  await fsp.writeFile(p, await doc.save());
  return p;
}

const out = (r: { outputs: string[] }) => r.outputs[0];

describe.skipIf(!ff)('video and audio tools', () => {
  let a: string;
  let b: string;
  let odd: string;
  beforeAll(async () => {
    a = await clip('a.mp4');
    b = await clip('b.mp4');
    odd = await clip('odd.mp4', { size: '640x360', audio: false });
  }, 60_000);

  it('joins matching clips without re-encoding, and mixed clips by re-encoding', async () => {
    const same = out(await conv.run({ op: { tool: 'video.merge' }, inputs: [a, b] }));
    const info = await conv.extra.info(same);
    expect(info.duration).toBeGreaterThan(1.8);
    const mixed = out(await conv.run({ op: { tool: 'video.merge' }, inputs: [a, odd] }));
    const mi = await conv.extra.info(mixed);
    expect(mi.video?.width).toBe(320);
    expect(mi.audio).toBeTruthy();
    expect(mi.duration).toBeGreaterThan(1.8);
  }, 120_000);

  it('crops to a square, flips, resizes and reports what is inside', async () => {
    const sq = await conv.extra.info(out(await conv.run({ op: { tool: 'video.crop', ratio: '1:1' }, inputs: [a] })));
    expect([sq.video?.width, sq.video?.height]).toEqual([240, 240]);
    expect(existsSync(out(await conv.run({ op: { tool: 'video.flip', axis: 'h' }, inputs: [a] })))).toBe(true);
    const r = await conv.extra.info(out(await conv.run({ op: { tool: 'video.resize', width: 640, height: 640, mode: 'fit' }, inputs: [a] })));
    expect([r.video?.width, r.video?.height]).toEqual([640, 640]);
    const info = await conv.run({ op: { tool: 'video.info' }, inputs: [a] });
    expect(info.details).toMatch(/Video: h264 320×240/);
    expect(info.outputs).toEqual([]);
  }, 120_000);

  it('burns in subtitles from an .srt next to the video, and from a transcript', async () => {
    await fsp.writeFile(path.join(root, 'a.srt'), '1\n00:00:00,000 --> 00:00:01,000\nHello [world]\n');
    const r = await conv.run({ op: { tool: 'video.subtitles', fontSize: 22 }, inputs: [a] });
    expect((await conv.extra.info(out(r))).duration).toBeGreaterThan(0.8);
    const auto = await conv.run({ op: { tool: 'video.subtitles', auto: true, fontSize: 22, engine: 'service' }, inputs: [b] });
    expect(existsSync(out(auto))).toBe(true);
  }, 120_000);

  it('replaces and mixes the sound, cleans it up and transcribes it', async () => {
    const tone = path.join(root, 'tone.m4a');
    execFileSync(ff!, ['-hide_banner', '-y', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=1', tone], { stdio: 'ignore' });
    expect((await conv.extra.info(out(await conv.run({ op: { tool: 'video.replaceAudio', audio: tone, mode: 'replace', volume: 1 }, inputs: [odd] })))).audio).toBeTruthy();
    expect(existsSync(out(await conv.run({ op: { tool: 'video.replaceAudio', audio: tone, mode: 'mix', volume: 0.5 }, inputs: [a] })))).toBe(true);
    expect(existsSync(out(await conv.run({ op: { tool: 'audio.clean', strength: 'strong', hum: 50 }, inputs: [tone] })))).toBe(true);
    const srt = await conv.run({ op: { tool: 'audio.transcribe', format: 'srt', engine: 'service' }, inputs: [a] });
    expect(readFileSync(out(srt), 'utf8')).toContain('00:00:00,000 --> 00:00:01,200\nHello from the test.');
    expect(srt.details).toBe('Hello from the test. Second line.');
  }, 120_000);
});

describe('pictures', () => {
  it('flips a picture', async () => {
    const sharp = (await import('sharp')).default;
    const p = path.join(root, 'p.png');
    // Four pixels wide: white on the left, black elsewhere.
    const raw = Buffer.alloc(4 * 2 * 3);
    for (const y of [0, 1]) raw.fill(255, y * 12, y * 12 + 3);
    await sharp(raw, { raw: { width: 4, height: 2, channels: 3 } }).png().toFile(p);
    const o = out(await conv.run({ op: { tool: 'image.flip', axis: 'h' }, inputs: [p] }));
    const { data } = await sharp(o).raw().toBuffer({ resolveWithObject: true });
    expect(data[0]).toBe(0);
    expect(data[9]).toBe(255);
  });
});

describe('PDF tools', () => {
  it.skipIf(!poppler)('redacts words for good: the text is gone and the details are stripped', async () => {
    const p = await textPdf('secret.pdf', ['Name: Jane Doe', 'IBAN DE89 3704 0044 0532 0130 00', 'Nothing else here.'], 2);
    const r = await conv.run({ op: { tool: 'pdf.redact', words: 'Jane Doe, DE89 3704', caseSensitive: false }, inputs: [p] });
    const text = (await extractPdfText(out(r))).text;
    expect(text).not.toMatch(/Jane|Doe|DE89/);
    expect(r.message).toMatch(/Removed 4 matches on 2 pages/);
    const doc = await PDFDocument.load(await fsp.readFile(out(r)));
    expect(doc.getAuthor() ?? '').toBe('');
    expect(doc.getTitle() ?? '').toBe('');
  }, 60_000);

  it('fills a form, adds text anywhere and flattens', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([595, 842]);
    const form = doc.getForm();
    form.createTextField('Full name').addToPage(page, { x: 60, y: 700, width: 300, height: 24 });
    form.createCheckBox('I agree').addToPage(page, { x: 60, y: 650, width: 16, height: 16 });
    const p = path.join(root, 'form.pdf');
    await fsp.writeFile(p, await doc.save());
    expect((await formFields(p)).map((f) => f.name)).toEqual(['Full name', 'I agree']);
    const r = await conv.run({ op: { tool: 'pdf.fill', values: { 'Full name': 'Ana Silva', 'I agree': 'yes' }, flatten: true, stamps: [{ page: 1, x: 0.1, y: 0.5, text: 'Signed in Tallinn' }] }, inputs: [p] });
    const filled = await PDFDocument.load(await fsp.readFile(out(r)));
    expect(filled.getForm().getFields()).toHaveLength(0);
    const text = (await extractPdfText(out(r))).text;
    expect(text).toContain('Ana Silva');
    expect(text).toContain('Signed in Tallinn');
  });

  it('signs the last page', async () => {
    const p = await textPdf('contract.pdf', ['Contract'], 3);
    const sharp = (await import('sharp')).default;
    const png = await sharp({ create: { width: 300, height: 100, channels: 4, background: { r: 0, g: 0, b: 80, alpha: 1 } } }).png().toBuffer();
    const r = await conv.run({ op: { tool: 'pdf.sign', signature: `data:image/png;base64,${png.toString('base64')}`, page: 'last', corner: 'bottom-right', width: 0.3, date: true }, inputs: [p] });
    const raw = await fsp.readFile(out(r));
    expect(raw.length).toBeGreaterThan((await fsp.readFile(p)).length);
    const doc = await PDFDocument.load(raw);
    expect(doc.getPageCount()).toBe(3);
  });

  it.skipIf(!poppler)('makes a scanned page searchable without changing how it looks', async () => {
    const sharp = (await import('sharp')).default;
    const scan = await sharp({ create: { width: 1190, height: 1684, channels: 3, background: '#fff' } }).jpeg().toBuffer();
    const doc = await PDFDocument.create();
    const img = await doc.embedJpg(scan);
    doc.addPage([595, 842]).drawImage(img, { x: 0, y: 0, width: 595, height: 842 });
    const p = path.join(root, 'scan.pdf');
    await fsp.writeFile(p, await doc.save());
    expect((await extractPdfText(p)).text).toBe('');
    const r = await conv.run({ op: { tool: 'pdf.searchable' }, inputs: [p] });
    expect((await extractPdfText(out(r))).text).toMatch(/SCANNED\s+invoice/);
  }, 60_000);

  it('turns a PDF into an editable Word document', async () => {
    const p = await textPdf('report.pdf', ['Quarterly report', 'Revenue went up this quarter.'], 2);
    const r = await conv.run({ op: { tool: 'pdf.toWord' }, inputs: [p] });
    expect(out(r)).toMatch(/\.docx$/);
    const html = docxToHtml(await fsp.readFile(out(r)));
    expect(html).toContain('Revenue went up this quarter.');
  }, 60_000);
});

describe('documents', () => {
  it('converts Markdown to Word and back, and text to HTML', async () => {
    const md = path.join(root, 'notes.md');
    await fsp.writeFile(md, '# Notes\n\n- buy milk\n- **call** Ana\n');
    const docx = out(await conv.run({ op: { tool: 'doc.convert', format: 'docx' }, inputs: [md] }));
    expect(docxToHtml(await fsp.readFile(docx))).toContain('<h1>Notes</h1>');
    const back = out(await conv.run({ op: { tool: 'doc.convert', format: 'md' }, inputs: [docx] }));
    expect(await fsp.readFile(back, 'utf8')).toMatch(/# Notes[\s\S]*- buy milk/);
  });
  it.skipIf(!soffice)('turns a Word document into a PDF with LibreOffice', async () => {
    const md = path.join(root, 'letter.md');
    await fsp.writeFile(md, '# Letter\n\nDear Ana, thank you for the documents.');
    const docx = out(await conv.run({ op: { tool: 'doc.convert', format: 'docx' }, inputs: [md] }));
    const pdf = out(await conv.run({ op: { tool: 'doc.toPdf', pageSize: 'a4', onePage: false }, inputs: [docx] }));
    expect((await extractPdfText(pdf)).text).toContain('thank you for the documents');
  }, 180_000);
  it.skipIf(!ff || !has('espeak-ng'))('reads text aloud into an MP3', async () => {
    const t = path.join(root, 'speech.txt');
    await fsp.writeFile(t, 'Keeper can read this sentence aloud.');
    const mp3 = out(await conv.run({ op: { tool: 'doc.speak', rate: 1, format: 'mp3' }, inputs: [t] }));
    expect((await conv.extra.info(mp3)).audio?.codec).toBe('mp3');
  }, 60_000);
});

describe('archives', () => {
  it('compresses files and folders to a ZIP with a password and unpacks it again', async () => {
    const dir = path.join(root, 'stuff');
    await fsp.mkdir(path.join(dir, 'sub'), { recursive: true });
    await fsp.writeFile(path.join(dir, 'sub', 'a.txt'), 'alpha');
    await fsp.writeFile(path.join(root, 'b.txt'), 'beta');
    const z = await conv.run({ op: { tool: 'file.zip', password: 'pw' }, inputs: [dir, path.join(root, 'b.txt')] });
    expect(out(z)).toMatch(/\.zip$/);
    await expect(conv.run({ op: { tool: 'file.unzip', password: 'nope' }, inputs: [out(z)] })).rejects.toThrow(/Wrong password/);
    const u = await conv.run({ op: { tool: 'file.unzip', password: 'pw' }, inputs: [out(z)] });
    expect(readFileSync(path.join(out(u), 'stuff', 'sub', 'a.txt'), 'utf8')).toBe('alpha');
    expect(readFileSync(path.join(out(u), 'b.txt'), 'utf8')).toBe('beta');
  });
  it('turns a file into Base64', async () => {
    await fsp.writeFile(path.join(root, 'bytes.bin'), Buffer.from([251, 255, 0]));
    const r = await conv.run({ op: { tool: 'file.base64', urlSafe: true }, inputs: [path.join(root, 'bytes.bin')] });
    expect(r.details).toBe('-_8A');
  });
});

describe('more video, audio and picture options', () => {
  it.skipIf(!ff)('trims without re-encoding and saves AIFF', async () => {
    const long = await clip('long.mp4', { seconds: 4 });
    const t = out(await conv.run({ op: { tool: 'video.trim', start: 1, end: 3, lossless: true }, inputs: [long] }));
    const ti = await conv.extra.info(t);
    expect(ti.duration).toBeGreaterThan(1.5);
    expect(ti.duration).toBeLessThan(3.2);
    const aiff = out(await conv.run({ op: { tool: 'audio.convert', format: 'aiff' }, inputs: [long] }));
    expect((await conv.extra.info(aiff)).audio?.codec).toMatch(/pcm_s16be/);
  }, 120_000);
  it('resizes to an exact size and scans photos of pages into one clean PDF', async () => {
    const sharp = (await import('sharp')).default;
    const page = path.join(root, 'page.jpg');
    // A grey "table" around a lighter "page" with dark text-like bars.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1300"><rect width="1000" height="1300" fill="#555"/><rect x="100" y="100" width="800" height="1100" fill="#ddd"/>${Array.from({ length: 12 }, (_, i) => `<rect x="160" y="${200 + i * 70}" width="600" height="18" fill="#222"/>`).join('')}</svg>`;
    await sharp(Buffer.from(svg)).jpeg().toFile(page);
    const exact = out(await conv.run({ op: { tool: 'image.resize', width: 300, height: 200 }, inputs: [page] }));
    expect(await sharp(exact).metadata()).toMatchObject({ width: 300, height: 200 });
    const pdf = out(await conv.run({ op: { tool: 'image.scan', mode: 'bw', pageSize: 'a4' }, inputs: [page, page] }));
    const doc = await PDFDocument.load(await fsp.readFile(pdf));
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getPage(0).getSize()).toEqual({ width: 595, height: 842 });
  });
});
