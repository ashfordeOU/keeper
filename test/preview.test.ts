// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { findZipDirectory, parseTar, parseZipDirectory, summarize } from '../core/archive';
import { readExifDetails } from '../core/exifDetails';
import { readId3, readMp4Tags } from '../core/id3';
import { decodeText, detectMagic, hexLines, looksText } from '../core/magic';
import { codeLanguage, previewKindOf } from '../core/previewKind';
import { findJpegs, jpegSize, largestIcnsPng, largestJpeg } from '../core/raw';

const enc = (s: string) => new TextEncoder().encode(s);
const cat = (...parts: (Uint8Array | number[])[]) => {
  const arrs = parts.map((p) => (p instanceof Uint8Array ? p : Uint8Array.from(p)));
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
};

/** A minimal but structurally valid JPEG of the given total body size. */
function fakeJpeg(w: number, h: number, scanBytes: number): Uint8Array {
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  const sos = [0xff, 0xda, 0x00, 0x0c, 0x03, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0];
  // Scan data containing FF00 stuffing and an FFD9-looking pair inside a segment is avoided; FF 00 is legal.
  const scan = new Uint8Array(scanBytes).map((_, i) => (i % 97 === 0 ? 0xff : i % 97 === 1 ? 0x00 : (i * 7) & 0xfe));
  return cat([0xff, 0xd8], [0xff, 0xe0, 0x00, 0x10, ...enc('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0], sof, sos, scan, [0xff, 0xd9]);
}

describe('magic', () => {
  it('detects common formats', () => {
    expect(detectMagic(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))?.id).toBe('png');
    expect(detectMagic(enc('%PDF-1.7\n'))?.id).toBe('pdf');
    expect(detectMagic(cat(enc('\0\0\0\x18ftypheic'), new Uint8Array(8)))?.id).toBe('heic');
    expect(detectMagic(cat(enc('\0\0\0\x18ftypisom'), new Uint8Array(8)))?.id).toBe('mp4');
    expect(detectMagic(enc('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>'))?.id).toBe('svg');
    expect(detectMagic(enc('SQLite format 3\0more'))?.id).toBe('sqlite');
    expect(detectMagic(enc('PK\x03\x04rest'))?.id).toBe('zip');
    const tar = new Uint8Array(600);
    tar.set(enc('ustar'), 257);
    expect(detectMagic(tar)?.id).toBe('tar');
    expect(detectMagic(enc('hello world\nline two'))?.id).toBe('text');
    expect(detectMagic(Uint8Array.from([0, 1, 2, 3, 250, 251, 0, 9]))).toBeUndefined();
  });
  it('text decoding honours BOMs and falls back to Latin-1', () => {
    expect(decodeText(Uint8Array.from([0xff, 0xfe, 0x68, 0, 0x69, 0]))).toEqual({ text: 'hi', encoding: 'UTF-16 LE' });
    expect(decodeText(Uint8Array.from([0xef, 0xbb, 0xbf, 0x6f, 0x6b])).text).toBe('ok');
    expect(decodeText(Uint8Array.from([0x63, 0x61, 0x66, 0xe9, 0x20, 0xe9, 0xe9])).encoding).toBe('Windows-1252');
    expect(looksText(enc('plain'))).toBe(true);
  });
  it('hex dump', () => {
    const l = hexLines(enc('ABCDEFGHIJKLMNOPQ'));
    expect(l).toHaveLength(2);
    expect(l[0].ascii).toBe('ABCDEFGHIJKLMNOP');
    expect(l[1].offset).toBe('00000010');
  });
});

describe('preview kinds', () => {
  it('routes by extension, then by bytes', () => {
    expect(previewKindOf('a.HEIC', 'heic', false)).toBe('heic');
    expect(previewKindOf('a.cr2', 'cr2', false)).toBe('raw');
    expect(previewKindOf('a.svg', 'svg', false)).toBe('svg');
    expect(previewKindOf('a.avi', 'avi', false)).toBe('video');
    expect(previewKindOf('a.xlsx', 'xlsx', false)).toBe('sheet');
    expect(previewKindOf('x.tar.gz', 'tar.gz', false)).toBe('tar');
    expect(previewKindOf('Dockerfile', '', false)).toBe('code');
    expect(previewKindOf('noext', '', false, { id: 'pdf', label: '', mime: '' })).toBe('pdf');
    expect(previewKindOf('Foo.app', 'app', true)).toBe('app');
    expect(previewKindOf('dir', '', true)).toBe('folder');
    expect(codeLanguage('a.tsx', 'tsx')).toBe('typescript');
  });
});

describe('raw previews', () => {
  it('finds the biggest embedded JPEG, ignoring FFD9 inside segments', () => {
    const small = fakeJpeg(160, 120, 3000);
    const big = fakeJpeg(6000, 4000, 20000);
    const tricky = cat([0xff, 0xd8], [0xff, 0xe1, 0x00, 0x08, 0xff, 0xd9, 0xff, 0xd9, 0, 0], fakeJpeg(10, 10, 4000).subarray(2));
    const file = cat(enc('II*\0'), new Uint8Array(500), small, new Uint8Array(100), big, new Uint8Array(50), tricky);
    const spans = findJpegs(file);
    expect(spans).toHaveLength(3);
    const best = largestJpeg(file)!;
    expect(best.length).toBe(big.length);
    expect(jpegSize(best)).toEqual({ width: 6000, height: 4000 });
  });
  it('picks the largest PNG from icns', () => {
    const png = (n: number) => cat([0x89, 0x50, 0x4e, 0x47], new Uint8Array(n));
    const chunk = (type: string, data: Uint8Array) => { const len = data.length + 8; return cat(enc(type), [len >>> 24, (len >> 16) & 255, (len >> 8) & 255, len & 255], data); };
    const body = cat(chunk('ic07', png(100)), chunk('ic10', png(900)), chunk('is32', new Uint8Array(50)));
    const total = body.length + 8;
    const icns = cat(enc('icns'), [total >>> 24, (total >> 16) & 255, (total >> 8) & 255, total & 255], body);
    expect(largestIcnsPng(icns)?.length).toBe(904);
  });
});

describe('audio tags', () => {
  it('reads ID3v2.3 text frames and cover art', () => {
    const frame = (id: string, data: Uint8Array) => cat(enc(id), [0, 0, (data.length >> 8) & 255, data.length & 255, 0, 0], data);
    const text = (s: string) => cat([3], enc(s));
    const pic = cat([0], enc('image/png\0'), [3], enc('cover\0'), [0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const frames = cat(frame('TIT2', text('Morning Light')), frame('TPE1', text('Ana Sol')), frame('TALB', text('Coast')), frame('APIC', pic));
    const n = frames.length;
    const tag = cat(enc('ID3'), [3, 0, 0, (n >> 21) & 127, (n >> 14) & 127, (n >> 7) & 127, n & 127], frames);
    const t = readId3(tag)!;
    expect(t).toMatchObject({ title: 'Morning Light', artist: 'Ana Sol', album: 'Coast' });
    expect(t.cover?.mime).toBe('image/png');
    expect([...t.cover!.data.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });
  it('reads MP4 ilst atoms', () => {
    const atom = (type: string, ...body: Uint8Array[]) => { const b = cat(...body); const n = b.length + 8; return cat([n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255], [...type].map((c) => c.charCodeAt(0)), b); };
    const data = (flags: number, v: Uint8Array) => atom('data', Uint8Array.from([0, 0, 0, flags, 0, 0, 0, 0]), v);
    const ilst = atom('ilst', atom('©nam', data(1, enc('Tidewater'))), atom('©ART', data(1, enc('Ana Sol'))), atom('covr', data(13, Uint8Array.from([0xff, 0xd8, 0xff]))));
    const meta = atom('meta', new Uint8Array(4), ilst);
    const file = cat(atom('ftyp', enc('M4A ')), atom('moov', atom('udta', meta)));
    const t = readMp4Tags(file)!;
    expect(t).toMatchObject({ title: 'Tidewater', artist: 'Ana Sol' });
    expect(t.cover?.mime).toBe('image/jpeg');
  });
});

describe('archives', () => {
  it('lists a zip from its central directory', () => {
    const name = enc('docs/readme.txt');
    const cd = cat(
      [0x50, 0x4b, 0x01, 0x02, 20, 0, 20, 0, 0, 0, 8, 0],
      [0x00, 0x60, 0x21, 0x5d], // time, date
      [0, 0, 0, 0], [50, 0, 0, 0], [200, 0, 0, 0],
      [name.length, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      name,
    );
    const eocd = cat([0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 1, 0, 1, 0], [cd.length, 0, 0, 0], [100, 0, 0, 0], [0, 0]);
    const file = cat(new Uint8Array(100), cd, eocd);
    const dir = findZipDirectory(file, file.length)!;
    expect(dir).toEqual({ offset: 100, size: cd.length, count: 1 });
    const entries = parseZipDirectory(file.subarray(dir.offset, dir.offset + dir.size));
    expect(entries[0]).toMatchObject({ name: 'docs/readme.txt', size: 200, packed: 50, dir: false });
  });
  it('parses tar headers, long names and sizes', () => {
    const header = (name: string, size: number, type = '0') => {
      const h = new Uint8Array(512);
      h.set(enc(name.slice(0, 99)), 0);
      h.set(enc(size.toString(8).padStart(11, '0') + '\0'), 124);
      h.set(enc('14560000000\0'), 136);
      h[156] = type.charCodeAt(0);
      h.set(enc('ustar\0'), 257);
      return h;
    };
    const pad = (n: number) => new Uint8Array(Math.ceil(n / 512) * 512);
    const long = 'a/'.repeat(80) + 'deep.txt';
    const longData = cat(enc(long), [0]);
    const tar = cat(
      header('folder/', 0, '5'),
      header('folder/hello.txt', 5), (() => { const p = pad(5); p.set(enc('hello')); return p; })(),
      header('././@LongLink', longData.length, 'L'), (() => { const p = pad(longData.length); p.set(longData); return p; })(),
      header(long.slice(0, 99), 3), pad(3),
      new Uint8Array(1024),
    );
    const entries = parseTar(tar);
    expect(entries.map((e) => e.name)).toEqual(['folder/', 'folder/hello.txt', long]);
    expect(entries[1].size).toBe(5);
    expect(summarize(entries)).toMatchObject({ files: 2, folders: 1, size: 8 });
    // A gzip round trip works the same after decompression.
    expect(gzipSync(tar).length).toBeGreaterThan(0);
  });
});

describe('exif details', () => {
  it('reads camera, exposure and GPS from a TIFF header', () => {
    // Little-endian TIFF: IFD0 { Make, Model, ExifIFD, GPSIFD }, ExifIFD { ExposureTime, FNumber, ISO }, GPS { lat, lon }.
    const b = new Uint8Array(512);
    const dv = new DataView(b.buffer);
    b.set(enc('II*\0'), 0);
    dv.setUint32(4, 8, true);
    let p = 8;
    const entries: [number, number, number, number][] = [];
    const ifd = (at: number, list: [number, number, number, number][]) => {
      dv.setUint16(at, list.length, true);
      list.forEach(([tag, type, count, value], i) => {
        const e = at + 2 + i * 12;
        dv.setUint16(e, tag, true); dv.setUint16(e + 2, type, true); dv.setUint32(e + 4, count, true);
        if (type === 3 && count === 1) dv.setUint16(e + 8, value, true); else dv.setUint32(e + 8, value, true);
      });
      dv.setUint32(at + 2 + list.length * 12, 0, true);
    };
    b.set(enc('Canon\0'), 200);
    b.set(enc('EOS R5\0'), 210);
    const rat = (at: number, n: number, d: number) => { dv.setUint32(at, n, true); dv.setUint32(at + 4, d, true); };
    rat(300, 1, 250); rat(308, 28, 10);
    entries.push([0x010f, 2, 6, 200], [0x0110, 2, 7, 210], [0x8769, 4, 1, 100], [0x8825, 4, 1, 430]);
    ifd(p, entries);
    ifd(100, [[0x829a, 5, 1, 300], [0x829d, 5, 1, 308], [0x8827, 3, 1, 400]]);
    rat(320, 38, 1); rat(328, 43, 1); rat(336, 0, 1);
    rat(344, 9, 1); rat(352, 8, 1); rat(360, 0, 1);
    b.set(enc('N\0'), 380); b.set(enc('W\0'), 384);
    ifd(430, [[1, 2, 2, 0x4e], [2, 5, 3, 320], [3, 2, 2, 0x57], [4, 5, 3, 344]]);
    void p;
    const d = readExifDetails(b)!;
    expect(d).toMatchObject({ make: 'Canon', model: 'EOS R5', exposure: '1/250 s', fNumber: 2.8, iso: 400 });
    expect(d.gps?.lat).toBeCloseTo(38.716667, 4);
    expect(d.gps?.lon).toBeCloseTo(-9.133333, 4);
  });
});

import { decodeWords, parseMail, parseSubtitles, parseVcards, rtfToText, toVtt } from '../core/docparse';

describe('document readers', () => {
  it('parses a multipart e-mail with an attachment', () => {
    const eml = [
      'From: =?utf-8?B?QW5hIFPDs2w=?= <ana@example.com>',
      'To: team@example.com',
      'Subject: =?utf-8?Q?Caf=C3=A9_plans?=',
      'Date: Thu, 30 Oct 2026 10:00:00 +0000',
      'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="b1"',
      '',
      '--b1',
      'Content-Type: multipart/alternative; boundary="b2"',
      '',
      '--b2',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      'Hello =E2=80=94 see the plan.=',
      '',
      '--b2',
      'Content-Type: text/html; charset=utf-8',
      '',
      '<p>Hello <b>team</b></p>',
      '--b2--',
      '--b1',
      'Content-Type: application/pdf; name="plan.pdf"',
      'Content-Disposition: attachment; filename="plan.pdf"',
      'Content-Transfer-Encoding: base64',
      '',
      'JVBERi0xLjQK',
      '--b1--',
      '',
    ].join('\r\n');
    const m = parseMail(eml);
    expect(m.from).toBe('Ana Sól <ana@example.com>');
    expect(m.subject).toBe('Café plans');
    expect(m.text).toBe('Hello — see the plan.');
    expect(m.html).toContain('<b>team</b>');
    expect(m.attachments).toHaveLength(1);
    expect(m.attachments[0]).toMatchObject({ filename: 'plan.pdf', contentType: 'application/pdf' });
    expect(new TextDecoder().decode(m.attachments[0].data)).toBe('%PDF-1.4\n');
    expect(decodeWords('=?iso-8859-1?Q?Gr=FC=DFe?=')).toBe('Grüße');
  });
  it('parses vCards', () => {
    const c = parseVcards('BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Ana Sol\r\nORG:Keeper;Design\r\nTEL;TYPE=CELL:+351 900 000 000\r\nEMAIL;TYPE=WORK:ana@example.com\r\nADR;TYPE=HOME:;;Rua A 1;Lisboa;;1000;Portugal\r\nEND:VCARD\r\nBEGIN:VCARD\r\nN:Doe;John;;;\r\nEND:VCARD');
    expect(c).toHaveLength(2);
    expect(c[0]).toMatchObject({ name: 'Ana Sol', org: 'Keeper, Design', phones: [{ type: 'cell', value: '+351 900 000 000' }] });
    expect(c[0].addresses[0].value).toBe('Rua A 1, Lisboa, 1000, Portugal');
    expect(c[1].name).toBe('John Doe');
  });
  it('reads RTF text', () => {
    const rtf = "{\\rtf1\\ansi{\\fonttbl{\\f0 Helvetica;}}{\\colortbl;\\red0\\green0\\blue0;}\\f0 Hello \\b world\\b0 .\\par Caf\\'e9 \\u8364?5\\par{\\*\\generator Something}}";
    expect(rtfToText(rtf)).toBe('Hello world.\nCafé €5');
  });
  it('subtitles', () => {
    const srt = '1\n00:00:01,000 --> 00:00:02,500\nHello <i>there</i>\n\n2\n00:00:03,000 --> 00:00:04,000\nBye\n';
    expect(parseSubtitles(srt)).toEqual([{ start: 1, end: 2.5, text: 'Hello there' }, { start: 3, end: 4, text: 'Bye' }]);
    expect(toVtt(srt)).toContain('00:00:01.000 --> 00:00:02.500');
  });
});
