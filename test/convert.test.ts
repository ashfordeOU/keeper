import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  algoForLength, atempoChain, checksum, decryptFile, encryptFile, extractPdfText, findParts, freeName, isEncryptedFile, joinParts,
  outputFolder, parseDuration, parseFfmpegTime, parsePageRanges, parseSplitGroups, parseTime, sameChecksum, splitFile, videoBitrate,
} from '../core/convert';

const dir = () => mkdtempSync(path.join(tmpdir(), 'keeper-conv-'));

describe('video maths', () => {
  it('bitrate fits the target with room for audio', () => {
    // 10 MB over 60 s = 1398 kbit/s total; minus overhead and 128 audio
    const v = videoBitrate(10 * 1024 * 1024, 60, 128);
    expect(v).toBeGreaterThan(1100);
    expect(v).toBeLessThan(1300);
    expect(((v + 128) * 60 * 1000) / 8).toBeLessThan(10 * 1024 * 1024);
    expect(videoBitrate(1000, 600)).toBe(50);
    expect(() => videoBitrate(1000, 0)).toThrow();
  });
  it('parses ffmpeg output and times', () => {
    expect(parseDuration('  Duration: 00:01:02.50, start: 0')).toBe(62.5);
    expect(parseFfmpegTime('frame=10 time=00:00:01.25 bitrate=')).toBe(1.25);
    expect(parseFfmpegTime('out_time_us=2500000')).toBe(2.5);
    expect(parseTime('1:02.5')).toBe(62.5);
    expect(parseTime('83')).toBe(83);
    expect(atempoChain(4)).toBe('atempo=2,atempo=2');
    expect(atempoChain(0.25)).toBe('atempo=0.5,atempo=0.5');
    expect(atempoChain(1.5)).toBe('atempo=1.5');
  });
});

describe('page ranges', () => {
  it('reads lists, ranges and words', () => {
    expect(parsePageRanges('1-3,5', 10)).toEqual([0, 1, 2, 4]);
    expect(parsePageRanges('8-', 10)).toEqual([7, 8, 9]);
    expect(parsePageRanges('2-last', 4)).toEqual([1, 2, 3]);
    expect(parsePageRanges('3-1', 4)).toEqual([2, 1, 0]);
    expect(parsePageRanges('odd', 5)).toEqual([0, 2, 4]);
    expect(parsePageRanges('', 3)).toEqual([0, 1, 2]);
    expect(() => parsePageRanges('12', 10)).toThrow(/10 pages/);
    expect(parseSplitGroups('1-2, 3-4', 4)).toEqual([[0, 1], [2, 3]]);
    expect(parseSplitGroups('', 3)).toEqual([[0], [1], [2]]);
  });
});

describe('naming', () => {
  it('puts results in a new folder and never reuses a name', () => {
    // Paths are built for the system the tests run on (\\ on Windows, / elsewhere).
    const r = (...p: string[]) => path.join(path.sep, ...p);
    expect(outputFolder([r('a', 'b', 'movie.mov')])).toBe(r('a', 'b', 'movie (Keeper)'));
    expect(outputFolder([r('a', 'x.pdf'), r('a', 'y.pdf')])).toBe(r('a', 'x and 1 more (Keeper)'));
    expect(outputFolder([r('a', 'x.pdf')], r('out'))).toBe(r('out'));
    const taken = new Set([r('o', 'p.jpg'), r('o', 'p 2.jpg')]);
    expect(freeName(r('o'), 'p', 'jpg', (p) => taken.has(p))).toBe(r('o', 'p 3.jpg'));
  });
});

describe('files', () => {
  it('encrypts and decrypts, refusing a wrong password', async () => {
    const d = dir();
    const src = path.join(d, 'secret.txt');
    writeFileSync(src, 'top secret '.repeat(5000));
    await encryptFile(src, src + '.keeper-enc', 'correct horse');
    expect(await isEncryptedFile(src + '.keeper-enc')).toBe(true);
    expect(readFileSync(src + '.keeper-enc').includes(Buffer.from('top secret'))).toBe(false);
    await expect(decryptFile(src + '.keeper-enc', path.join(d, 'bad.txt'), 'wrong')).rejects.toThrow(/Wrong password/);
    await decryptFile(src + '.keeper-enc', path.join(d, 'back.txt'), 'correct horse');
    expect(readFileSync(path.join(d, 'back.txt'), 'utf8')).toBe(readFileSync(src, 'utf8'));
  });

  it('checksums', async () => {
    const d = dir();
    const f = path.join(d, 'a.txt');
    writeFileSync(f, 'abc');
    expect(await checksum(f, 'sha256')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(await checksum(f, 'md5')).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(sameChecksum('SHA256: BA7816BF 8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')).toBe(true);
    expect(algoForLength('900150983cd24fb0d6963f7d28e17f72')).toBe('md5');
  });

  it('splits and joins', async () => {
    const d = dir();
    const f = path.join(d, 'big.bin');
    const data = Buffer.from(Array.from({ length: 5000 }, (_, i) => i % 251));
    writeFileSync(f, data);
    const parts = await splitFile(f, d, 2048);
    expect(parts.map((p) => path.basename(p))).toEqual(['big.bin.001', 'big.bin.002', 'big.bin.003']);
    const found = await findParts(parts[1]);
    expect(found.original).toBe('big.bin');
    await joinParts(found.parts, path.join(d, 'joined.bin'));
    expect(readFileSync(path.join(d, 'joined.bin')).equals(data)).toBe(true);
  });
});

describe('PDF text', () => {
  it('extracts text and counts pages', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.addPage().drawText('Invoice number 4471', { x: 50, y: 700, font, size: 18 });
    doc.addPage().drawText('Second page total 42', { x: 50, y: 700, font, size: 18 });
    const f = path.join(dir(), 'doc.pdf');
    writeFileSync(f, await doc.save());
    const r = await extractPdfText(f);
    expect(r.pages).toBe(2);
    expect(r.text).toContain('Invoice number 4471');
    expect(r.text).toContain('Second page total 42');
  });
});

describe('PDF passwords', () => {
  const sample = async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.addPage().drawText('Confidential salary report', { x: 50, y: 700, font, size: 18 });
    doc.setTitle('Secret title');
    return doc.save();
  };
  const open = async (bytes: Uint8Array, password?: string) => {
    const { loadPdfJs } = await import('../core/convert');
    const lib = (await loadPdfJs()) as unknown as { getDocument(o: object): { promise: Promise<{ numPages: number; getPage(n: number): Promise<{ getTextContent(): Promise<{ items: { str: string }[] }> }> }> } };
    const doc = await lib.getDocument({ data: new Uint8Array(bytes), password, isEvalSupported: false, verbosity: 0 }).promise;
    const page = await doc.getPage(1);
    return (await page.getTextContent()).items.map((i) => i.str).join(' ');
  };

  it('locks with AES-256 that a standard reader opens only with the password', async () => {
    const { encryptPdf } = await import('../core/pdfcrypt');
    const locked = await encryptPdf(await sample(), 'open sesame');
    expect(Buffer.from(locked).includes(Buffer.from('salary'))).toBe(false);
    await expect(open(locked)).rejects.toThrow(/password/i);
    await expect(open(locked, 'wrong')).rejects.toThrow(/password/i);
    expect(await open(locked, 'open sesame')).toContain('Confidential salary report');
  });

  it('unlocks AES-256, AES-128 and RC4 files', async () => {
    const { encryptPdf, decryptPdf, encryptPdfLegacyForTests } = await import('../core/pdfcrypt');
    const src = await sample();
    for (const locked of [await encryptPdf(src, 'pw'), await encryptPdfLegacyForTests(src, 'pw', 'aes128'), await encryptPdfLegacyForTests(src, 'pw', 'rc4')]) {
      expect(await open(locked, 'pw')).toContain('Confidential');
      await expect(decryptPdf(locked, 'nope')).rejects.toThrow('Wrong password');
      const plain = await decryptPdf(locked, 'pw');
      expect(await open(plain)).toContain('Confidential salary report');
    }
  });
});
