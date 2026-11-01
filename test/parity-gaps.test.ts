// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The last gaps of the everyday-tools list, closed and checked: on-device
// transcription, page straightening for scans, the visual PDF organizer,
// document translation that keeps layout, display controls, phone backups,
// text-language detection and PDF permission limits.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  applyTimestampRules, argmax, decodeTokens, isLooping, langToken, logMel, melFilters, segmentsFromTokens, tidySegments, TOK, WHISPER_LANGS, WHISPER_MODELS,
} from '../core/whisper';
import { guessLatinLanguage, languagesForScript } from '../core/ocr-lang';
import { adaptiveThreshold, applyH, findPage, homography, otsu, phoneScanFiles, quadSize, warpPerspective, type Quad } from '../core/scan';
import { checkOrganize, describeOrganize, moveItem, normRotate } from '../core/pdf-organize';
import { batches, docKind, docxXmlPieces, htmlPieces, markdownPieces, piecesPrompt, readPieces, subtitlePieces, textPieces, translatedName } from '../core/translate-doc';
import { fromPercent, parseDdcutilBrief, parseDdcutilDetect, toPercent, VCP } from '../core/display-control';
import { backupFolders, describeBackup, deviceFamily, plistValues } from '../core/phone-backups';
import { encryptPdf, permissionBits, readPermissions } from '../core/pdfcrypt';
import { buildDocx, docxToHtml } from '../core/docx';
import { Converter } from '../electron/services/convert';
import { organizePdf } from '../electron/services/pdf-tools';
import { phoneBackups } from '../electron/services/phone-backups';
import { LocalWhisper } from '../electron/services/whisper';

const root = mkdtempSync(path.join(os.tmpdir(), 'keeper-gaps-'));
const has = (cmd: string) => { try { execFileSync('which', [cmd]); return true; } catch { return false; } };

// ---------------------------------------------------------------- on-device transcription

describe('on-device speech to text', () => {
  it('pins every model file with a SHA-256 and a revision', () => {
    for (const m of Object.values(WHISPER_MODELS)) {
      expect(m.revision).toMatch(/^[0-9a-f]{40}$/);
      for (const f of Object.values(m.files)) expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('builds the mel filter bank and log-mel input the model expects', () => {
    const f = melFilters(80);
    expect(f.length).toBe(80 * 201);
    for (let m = 0; m < 80; m++) {
      let s = 0;
      for (let k = 0; k < 201; k++) s += f[m * 201 + k];
      expect(s).toBeGreaterThan(0);
    }
    const silent = logMel(new Float32Array(16000), 80, f);
    expect(silent.length).toBe(80 * 3000);
    expect(silent[0]).toBeCloseTo(-1.5, 5);
    // A 1 kHz tone lights up the band around 1 kHz, not the lowest one.
    const tone = new Float32Array(16000 * 2).map((_, i) => Math.sin((2 * Math.PI * 1000 * i) / 16000) * 0.5);
    const mel = logMel(tone, 80, f);
    const col = (m: number) => mel[m * 3000 + 50];
    let best = 0;
    for (let m = 1; m < 80; m++) if (col(m) > col(best)) best = m;
    expect(best).toBeGreaterThan(25);
    expect(best).toBeLessThan(45);
  });

  it('follows the timestamp rules', () => {
    const logits = new Float32Array(51865).fill(0);
    logits[500] = 10;
    applyTimestampRules(logits, []);
    expect(argmax(logits)).toBeGreaterThanOrEqual(TOK.tsBegin);
    expect(argmax(logits)).toBeLessThanOrEqual(TOK.tsBegin + 50);
    // After text and a time, the next time may not go backwards.
    const l2 = new Float32Array(51865).fill(0);
    l2[TOK.tsBegin + 5] = 20;
    l2[TOK.tsBegin + 40] = 19;
    applyTimestampRules(l2, [TOK.tsBegin + 10, 400, 401]);
    expect(argmax(l2)).not.toBe(TOK.tsBegin + 5);
  });

  it('splits tokens into timed segments and knows where to continue', () => {
    const ts = (s: number) => TOK.tsBegin + Math.round(s / 0.02);
    const r = segmentsFromTokens([ts(0), 100, 101, ts(2.5), ts(2.5), 102, ts(5)], 30);
    expect(r.segments.map((s) => [s.start, s.end, s.tokens])).toEqual([[0, 2.5, [100, 101]], [2.5, 5, [102]]]);
    expect(r.consumed).toBe(30);
    const cut = segmentsFromTokens([ts(0), 100, ts(3), ts(3), 101], 30);
    expect(cut.segments).toHaveLength(1);
    expect(cut.consumed).toBeCloseTo(3);
  });

  it('decodes byte-level tokens, finds languages, and stops loops', () => {
    const vocab: string[] = [];
    vocab[10] = 'Hello';
    vocab[11] = 'Ġw';
    vocab[12] = 'Ã¶rld';
    expect(decodeTokens([10, 11, 12, TOK.eot], vocab)).toBe('Hello wörld');
    expect(langToken('de')).toBe(TOK.firstLang + WHISPER_LANGS.indexOf('de'));
    expect(langToken('pt-BR')).toBe(TOK.firstLang + WHISPER_LANGS.indexOf('pt'));
    expect(isLooping([1, 2, 3, 1, 2, 3, 1, 2, 3, 1, 2, 3])).toBe(true);
    expect(isLooping([1, 2, 3, 1, 2, 3])).toBe(false);
    expect(isLooping([1, 2, 3, 4, 5, 6, 7, 8])).toBe(false);
    expect(tidySegments([{ text: 'a' }, { text: 'b' }, { text: 'b' }, { text: 'b' }, { text: 'c' }]).map((s) => s.text)).toEqual(['a', 'b', 'b', 'c']);
  });

  // Runs the real model when it is on this computer (KEEPER_WHISPER_DIR holds
  // whisper-tiny/…) with a speech sample (KEEPER_SPEECH_SAMPLE).
  const dir = process.env.KEEPER_WHISPER_DIR;
  const sample = process.env.KEEPER_SPEECH_SAMPLE;
  it.runIf(!!dir && !!sample)('transcribes real speech on this computer, with times', async () => {
    const w = new LocalWhisper(dir!, () => require('ffmpeg-static'));
    const r = await w.transcribe(sample!, { size: 'tiny', language: 'auto' });
    await w.unload();
    const text = r.segments.map((s) => s.text).join(' ').toLowerCase();
    expect(r.language).toBe('en');
    expect(text).toContain('ask not what your country can do for you');
    expect(r.segments[0].start).toBeLessThan(1);
    expect(r.segments[r.segments.length - 1].end).toBeGreaterThan(8);
  }, 120_000);
});

// ---------------------------------------------------------------- text language

describe('working out the language of text', () => {
  it('tells Latin-script languages apart by their common words', () => {
    expect(guessLatinLanguage('Der Vertrag ist nicht gültig und die Frist ist zu kurz für uns')).toBe('deu');
    expect(guessLatinLanguage('Le contrat est signé et les documents sont dans la boîte pour vous')).toBe('fra');
    expect(guessLatinLanguage('The invoice is due and the payment is late for this month')).toBe('eng');
    expect(guessLatinLanguage('Hi')).toBeNull();
  });
  it('picks readers for a writing system, preferring the person’s own', () => {
    expect(languagesForScript('Cyrillic', ['eng'])).toEqual(['rus']);
    expect(languagesForScript('Cyrillic', ['eng', 'ukr'])).toEqual(['ukr']);
    expect(languagesForScript('Han', [])).toEqual(['chi_sim']);
    expect(languagesForScript(null, ['deu'])).toEqual(['deu']);
  });
});

// ---------------------------------------------------------------- scans

async function pagePhoto(file: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900"><rect width="100%" height="100%" fill="#3a3a40"/><polygon points="260,120 980,180 900,820 180,760" fill="#f4f1ea"/><text x="330" y="300" font-size="40" font-family="DejaVu Sans" fill="#222">Invoice 2041</text></svg>`;
  await sharp(Buffer.from(svg)).jpeg().toFile(file);
}

describe('scanning pages from photos', () => {
  it('finds the page and its corners', async () => {
    const f = path.join(root, 'photo.jpg');
    await pagePhoto(f);
    const small = await sharp(f).resize({ width: 400 }).grayscale().raw().toBuffer({ resolveWithObject: true });
    const q = findPage(new Uint8Array(small.data), small.info.width, small.info.height)!;
    expect(q).not.toBeNull();
    const want = [[86.7, 40], [326.7, 60], [300, 273.3], [60, 253.3]];
    q.forEach((p, i) => { expect(Math.abs(p.x - want[i][0])).toBeLessThan(5); expect(Math.abs(p.y - want[i][1])).toBeLessThan(5); });
    // A photo that is already only the page has nothing to find.
    expect(findPage(new Uint8Array(400 * 300).fill(240), 400, 300)).toBeNull();
  });

  it('maps corners exactly and pulls the page straight', () => {
    const quad: Quad = [{ x: 10, y: 5 }, { x: 90, y: 15 }, { x: 80, y: 95 }, { x: 5, y: 85 }];
    const H = homography([{ x: 0, y: 0 }, { x: 99, y: 0 }, { x: 99, y: 99 }, { x: 0, y: 99 }], quad);
    const p = applyH(H, 99, 99);
    expect(p.x).toBeCloseTo(80, 6);
    expect(p.y).toBeCloseTo(95, 6);
    // A grey picture where the quad is white: the straightened result is white all over.
    const w = 100, h = 100;
    const src = new Uint8Array(w * h).fill(0);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const inside = [0, 1, 2, 3].every((i) => { const a = quad[i], b = quad[(i + 1) % 4]; return (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x) >= -1; });
      if (inside) src[y * w + x] = 255;
    }
    const [ow, oh] = quadSize(quad);
    const out = warpPerspective(src, w, h, 1, quad, ow, oh);
    const inner = [...out].filter((_, i) => { const x = i % ow, y = Math.floor(i / ow); return x > 2 && y > 2 && x < ow - 3 && y < oh - 3; });
    expect(Math.min(...inner)).toBeGreaterThan(200);
  });

  it('makes clean black and white under a shadow', () => {
    const w = 200, h = 50;
    const g = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g[y * w + x] = 120 + Math.round((x / w) * 120) - ((x % 40 < 4 && y > 10 && y < 40) ? 90 : 0);
    const bw = adaptiveThreshold(g, w, h, 10, 12);
    expect(bw[25 * w + 1]).toBe(0); // ink in the dark part
    expect(bw[25 * w + 20]).toBe(255); // paper in the dark part
    expect(bw[25 * w + 161]).toBe(0); // ink in the light part
    expect(otsu(Uint8Array.from([10, 10, 10, 200, 200, 200]))).toBeGreaterThanOrEqual(10);
  });

  it('accepts only plain picture names from a phone', () => {
    expect(phoneScanFiles(['scan-1.jpg', '../x.jpg', 'a/b.png', 'notes.txt', 'p.HEIC', 7])).toEqual(['scan-1.jpg', 'p.HEIC']);
    expect(phoneScanFiles('x')).toEqual([]);
  });

  it('straightens a photographed page into the PDF', async () => {
    const f = path.join(root, 'page-photo.jpg');
    await pagePhoto(f);
    const conv = new Converter({ modelsDir: path.join(root, 'models') });
    const r = await conv.run({ op: { tool: 'image.scan', mode: 'bw', pageSize: 'fit' }, inputs: [f], outDir: root });
    expect(r.message ?? '').toMatch(/Straightened 1 of 1/);
    const pdf = await PDFDocument.load(await fsp.readFile(r.outputs[0]));
    const { width, height } = pdf.getPage(0).getSize();
    // The page was about 720 × 640 px in the photo; the scan keeps that shape, not the photo's.
    expect(width / height).toBeGreaterThan(1.05);
    expect(width / height).toBeLessThan(1.25);
  });
});

// ---------------------------------------------------------------- organizing PDFs

async function numbered(name: string, n: number, label: string) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < n; i++) doc.addPage([300, 400]).drawText(`${label}${i + 1}`, { x: 40, y: 200, size: 30, font });
  const p = path.join(root, name);
  await fsp.writeFile(p, await doc.save());
  return p;
}

describe('the visual PDF organizer', () => {
  it('checks plans and moves pages', () => {
    expect(normRotate(-90)).toBe(270);
    expect(normRotate(450)).toBe(90);
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(() => checkOrganize([{ file: 'x.pdf', page: 3, rotate: 0 }], { 'x.pdf': 2 })).toThrow(/does not exist/);
    expect(() => checkOrganize([], {})).toThrow(/at least one/);
    expect(describeOrganize([{ file: 'a', page: 0, rotate: 90 }, { file: 'b', page: 0, rotate: 0 }], 3)).toBe('2 pages, 1 removed, 1 turned, from 2 files');
  });

  it('reorders, turns, removes and inserts pages from another PDF', async () => {
    const a = await numbered('a.pdf', 3, 'A');
    const b = await numbered('b.pdf', 2, 'B');
    const out = path.join(root, 'organized.pdf');
    const r = await organizePdf([{ file: a, page: 2, rotate: 0 }, { file: b, page: 1, rotate: 90 }, { file: a, page: 0, rotate: 270 }], out);
    expect(r.pages).toBe(3);
    const doc = await PDFDocument.load(await fsp.readFile(out));
    expect(doc.getPageCount()).toBe(3);
    expect(doc.getPages().map((p) => p.getRotation().angle)).toEqual([0, 90, 270]);
    if (has('pdftotext')) {
      const text = execFileSync('pdftotext', [out, '-']).toString().replace(/\s+/g, ' ');
      expect(text.indexOf('A3')).toBeLessThan(text.indexOf('B2'));
      expect(text.indexOf('B2')).toBeLessThan(text.indexOf('A1'));
    }
  });

  it('runs as a Convert tool', async () => {
    const a = await numbered('c.pdf', 2, 'C');
    const conv = new Converter({ modelsDir: path.join(root, 'models') });
    const r = await conv.run({ op: { tool: 'pdf.organize', pages: [{ file: a, page: 1, rotate: 0 }] }, inputs: [a], outDir: root });
    expect((await PDFDocument.load(await fsp.readFile(r.outputs[0]))).getPageCount()).toBe(1);
  });
});

// ---------------------------------------------------------------- translation that keeps layout

const upper = (texts: string[]) => texts.map((t) => t.toUpperCase());

describe('translating documents', () => {
  it('keeps Markdown marks, code and tables', () => {
    const md = '# Title here\n\n- first item\n- [x] done thing\n\n```js\nconst keep = 1;\n```\n\n| Name | Note |\n| --- | --- |\n| apple | red fruit |\n\n> quoted words\n';
    const p = markdownPieces(md);
    expect(p.pieces).toEqual(['Title here', 'first item', 'done thing', 'Name', 'Note', 'apple', 'red fruit', 'quoted words']);
    const out = p.rebuild(upper(p.pieces));
    expect(out).toBe('# TITLE HERE\n\n- FIRST ITEM\n- [x] DONE THING\n\n```js\nconst keep = 1;\n```\n\n| NAME | NOTE |\n| --- | --- |\n| APPLE | RED FRUIT |\n\n> QUOTED WORDS\n');
  });

  it('keeps HTML tags and leaves scripts alone', () => {
    const html = '<p class="x">Hello <b>world</b></p><script>var s = "no";</script><code>keep</code>';
    const p = htmlPieces(html);
    expect(p.pieces).toEqual(['Hello ', 'world']);
    expect(p.rebuild(upper(p.pieces))).toBe('<p class="x">HELLO <b>WORLD</b></p><script>var s = "no";</script><code>keep</code>');
  });

  it('keeps Word paragraphs, styles and escapes', () => {
    const xml = '<w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>Big </w:t></w:r><w:r><w:t>&amp; bold</w:t></w:r></w:p><w:p><w:r><w:t>12</w:t></w:r></w:p></w:body>';
    const p = docxXmlPieces(xml);
    expect(p.pieces).toEqual(['Big & bold']);
    const out = p.rebuild(['Grand & gras']);
    expect(out).toContain('<w:pStyle w:val="Heading1"/>');
    expect(out).toContain('<w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Grand &amp; gras</w:t>');
    expect(out).toContain('<w:t>12</w:t>');
  });

  it('keeps subtitle numbers and timings exactly', () => {
    const srt = '1\n00:00:01,000 --> 00:00:02,500\nHello there\n\n2\n00:00:03,000 --> 00:00:04,000\nSecond\nline\n';
    const p = subtitlePieces(srt, false);
    const out = p.rebuild(upper(p.pieces));
    expect(out).toBe('1\n00:00:01,000 --> 00:00:02,500\nHELLO THERE\n\n2\n00:00:03,000 --> 00:00:04,000\nSECOND\nLINE\n');
  });

  it('asks in numbered pieces and reads the answer back', () => {
    const { prompt } = piecesPrompt('German', ['One', 'Two\nlines'], 'txt');
    expect(prompt).toBe('1: One\n2: Two ¶ lines');
    expect(readPieces([' One ', 'Two\nlines', 'Three'], '1: Eins\n2: Zwei ¶ Zeilen')).toEqual([' Eins ', 'Zwei\nZeilen', 'Three']);
    expect(batches(['a'.repeat(4000), 'b'.repeat(4000), 'c'], 6000)).toEqual([[0], [1, 2]]);
    expect(textPieces('Para one.\n\n\nPara two.').pieces).toEqual(['Para one.', 'Para two.']);
    expect(translatedName('/x/Report.final.docx', 'de')).toBe('/x/Report.final.de.docx');
    expect(docKind('a.SRT')).toBe('srt');
    expect(docKind('a.pdf')).toBeNull();
  });

  it('translates a Word file into a new Word file that still opens', async () => {
    const src = path.join(root, 'Letter.docx');
    await fsp.writeFile(src, buildDocx([{ type: 'heading', level: 1, text: 'Dear reader' }, { type: 'para', runs: [{ text: 'Thank you for the letter.' }] }], 'Letter'));
    const conv = new Converter({ modelsDir: path.join(root, 'models'), hooks: { translate: async (t) => upper(t) } });
    const r = await conv.run({ op: { tool: 'doc.translate', language: 'de' }, inputs: [src], outDir: root });
    expect(path.basename(r.outputs[0])).toBe('Letter.de.docx');
    const html = await docxToHtml(await fsp.readFile(r.outputs[0]));
    expect(html).toContain('DEAR READER');
    expect(html).toContain('THANK YOU FOR THE LETTER.');
    expect(html).toMatch(/<h1[^>]*>DEAR READER/);
  });
});

// ---------------------------------------------------------------- displays

describe('external display controls', () => {
  it('reads ddcutil answers and scales values', () => {
    expect(parseDdcutilBrief('VCP 12 C 40 80')).toEqual({ cur: 40, max: 80 });
    expect(parseDdcutilBrief('nothing')).toBeNull();
    expect(parseDdcutilDetect('Display 1\n   I2C bus:  /dev/i2c-4\n   Monitor:             DEL:DELL U2720Q:ABC\n\nDisplay 2\n   Monitor: GSM:LG HDR 4K:XYZ\n')).toEqual([{ n: '1', name: 'DELL U2720Q ABC' }, { n: '2', name: 'LG HDR 4K XYZ' }]);
    expect(toPercent(40, 80)).toBe(50);
    expect(fromPercent(50, 80)).toBe(40);
    expect(VCP).toEqual({ brightness: 0x10, contrast: 0x12, volume: 0x62 });
  });
});

// ---------------------------------------------------------------- phone backups

const INFO = `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>
<key>Device Name</key><string>Ana&apos;s iPhone</string><key>Product Type</key><string>iPhone16,1</string>
<key>Product Version</key><string>19.1</string><key>Last Backup Date</key><date>2026-10-20T08:15:00Z</date>
<key>Installed Applications</key><array><string>com.example</string></array><key>iTunes Files</key><dict></dict></dict></plist>`;

describe('phone backups', () => {
  it('reads what a backup is', () => {
    const v = plistValues(INFO);
    expect(v['Device Name']).toBe("Ana's iPhone");
    const b = describeBackup('0001', '/b/0001', INFO, 1234, '<?xml version="1.0"?><plist><dict><key>IsEncrypted</key><true/></dict></plist>');
    expect(b).toMatchObject({ deviceName: "Ana's iPhone", model: 'iPhone', iosVersion: '19.1', lastBackup: Date.parse('2026-10-20T08:15:00Z'), size: 1234, encrypted: true });
    expect(deviceFamily('iPad13,4')).toBe('iPad');
  });
  it('knows where each OS keeps them', () => {
    expect(backupFolders('darwin', '/Users/me', {})).toEqual(['/Users/me/Library/Application Support/MobileSync/Backup']);
    expect(backupFolders('win32', 'C:\\Users\\me', { APPDATA: 'C:\\Users\\me\\AppData\\Roaming', USERPROFILE: 'C:\\Users\\me' })).toContain('C:\\Users\\me\\Apple\\MobileSync\\Backup');
  });
  it('lists backups with sizes, newest first', async () => {
    const dir = path.join(root, 'MobileSync');
    for (const [id, date] of [['old', '2025-01-01T00:00:00Z'], ['new', '2026-10-30T00:00:00Z']]) {
      await fsp.mkdir(path.join(dir, id, 'ab'), { recursive: true });
      await fsp.writeFile(path.join(dir, id, 'Info.plist'), INFO.replace('2026-10-20T08:15:00Z', date));
      await fsp.writeFile(path.join(dir, id, 'ab', 'blob'), Buffer.alloc(5000));
    }
    const r = await phoneBackups([dir]);
    expect(r.backups.map((b) => b.id)).toEqual(['new', 'old']);
    expect(r.backups[0].size).toBeGreaterThan(5000);
  });
});

// ---------------------------------------------------------------- PDF limits

describe('PDF password limits', () => {
  it('sets the permission bits', () => {
    expect(permissionBits()).toBe(-4);
    expect(readPermissions(permissionBits({ print: false }))).toEqual({ print: false, copy: true, edit: true });
    expect(readPermissions(permissionBits({ copy: false, edit: false }))).toEqual({ print: true, copy: false, edit: false });
  });

  it.runIf(has('qpdf'))('are what PDF tools see', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]).drawText('Limits', { x: 20, y: 100 });
    const locked = await encryptPdf(await doc.save(), 'open', 'owner-secret', { print: false, copy: false, edit: false });
    const f = path.join(root, 'limited.pdf');
    await fsp.writeFile(f, locked);
    const show = execFileSync('qpdf', ['--password=open', '--show-encryption', f]).toString();
    expect(show).toMatch(/print low resolution: not allowed/);
    expect(show).toMatch(/extract for any purpose: not allowed/);
    expect(show).toMatch(/modify other: not allowed/);
    expect(show).toMatch(/extract for accessibility: allowed/);
    // The owner password lifts the limits.
    const owner = execFileSync('qpdf', ['--password=owner-secret', '--show-encryption', f]).toString();
    expect(owner).toMatch(/Supplied password is owner password/);
    expect(show).not.toMatch(/Supplied password is owner password/);
    if (has('pdfinfo')) expect(execFileSync('pdfinfo', ['-upw', 'open', f]).toString()).toMatch(/print:no copy:no change:no/);
    // Without limits everything stays allowed.
    const open = await encryptPdf(await doc.save(), 'open');
    await fsp.writeFile(f, open);
    expect(execFileSync('qpdf', ['--password=open', '--show-encryption', f]).toString()).toMatch(/print high resolution: allowed/);
  });

  it.runIf(has('qpdf'))('Convert makes up an owner password so limits hold', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    const src = path.join(root, 'to-lock.pdf');
    await fsp.writeFile(src, await doc.save());
    const conv = new Converter({ modelsDir: path.join(root, 'models') });
    const r = await conv.run({ op: { tool: 'pdf.encrypt', password: 'open', allowPrint: false }, inputs: [src], outDir: root });
    const show = execFileSync('qpdf', ['--password=open', '--show-encryption', r.outputs[0]]).toString();
    expect(show).toMatch(/print low resolution: not allowed/);
    expect(show).toMatch(/extract for any purpose: allowed/);
    expect(existsSync(r.outputs[0])).toBe(true);
  });
});
