// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, promises as fsp, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildDocx, docxToHtml, htmlBlocks, htmlToMarkdown, markdownBlocks } from '../core/docx';
import { allFormats, bearing, distanceKm, fromGeohash, geohash, parseCoordinates, plusCode, toDms, toUtm } from '../core/geotools';
import {
  aspectCrop, canJoinWithoutReencode, cleanAudioFilter, concatFilter, concatList, cropFilter, detectorInput, facesFromDetector, nonMaxSuppression, parseMediaInfo,
  resizeFilter, splitForSubtitles, subtitlesFilter, toPlain, toSrt, toTimestamped, toWebVtt, ttsCommand,
} from '../core/media-ops';
import { base64Options, inspectUuid, md5, timestampIn, verifyJwtHmac } from '../core/textools';
import { crc32, safeEntryPath, untar, unzip, zip } from '../core/zipwrite';
import { downloadArgs, parseDownloadLine, YTDLP } from '../electron/services/video-download';

const FFMPEG_I = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'clip.mp4':
  Metadata:
    major_brand     : isom
    creation_time   : 2026-10-12T09:41:00.000000Z
    title           : Launch
  Duration: 00:06:52.04, start: 0.000000, bitrate: 8120 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 1920x1080 [SAR 1:1 DAR 16:9], 7860 kb/s, 29.97 fps, 29.97 tbr, 30k tbn (default)
      Metadata:
        handler_name    : VideoHandler
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 256 kb/s (default)
  Stream #0:2[0x3](eng): Subtitle: mov_text (tx3g / 0x67337874), 0 kb/s
At least one output file must be specified`;

describe('media: what is inside', () => {
  it('reads container, length, streams and tags from ffmpeg’s report', () => {
    const i = parseMediaInfo(FFMPEG_I);
    expect(i.duration).toBeCloseTo(412.04, 2);
    expect(i.bitrateKbps).toBe(8120);
    expect(i.video).toMatchObject({ codec: 'h264', width: 1920, height: 1080, fps: 29.97, pixelFormat: 'yuv420p', bitrateKbps: 7860 });
    expect(i.audio).toMatchObject({ codec: 'aac', sampleRate: 48000, channels: 'stereo', bitrateKbps: 256 });
    expect(i.subtitles).toBe(1);
    expect(i.metadata.title).toBe('Launch');
    expect(i.metadata.handler_name).toBeUndefined();
  });
});

describe('media: joining, cropping, sizing, subtitles, sound', () => {
  const a = { videoCodec: 'h264', audioCodec: 'aac', width: 1920, height: 1080, fps: 30, sampleRate: 48000 };
  it('joins without re-encoding only when the clips match', () => {
    expect(canJoinWithoutReencode([a, { ...a }])).toBe(true);
    expect(canJoinWithoutReencode([a, { ...a, width: 1280 }])).toBe(false);
    expect(canJoinWithoutReencode([a, { ...a, audioCodec: 'opus' }])).toBe(false);
  });
  it('escapes quotes in the concat list and uses forward slashes', () => {
    expect(concatList(["C:\\Videos\\it's.mp4", '/a/b.mp4'])).toBe("file 'C:/Videos/it'\\''s.mp4'\nfile '/a/b.mp4'\n");
  });
  it('gives clips without sound a silent track when re-encoding', () => {
    const f = concatFilter(2, 1280, 720, [true, false]);
    expect(f).toContain('[0:a]aresample');
    expect(f).toContain('anullsrc');
    expect(concatFilter(1, 2, 2, [false], [3.5])).toContain('anullsrc=r=48000:cl=stereo:d=3.500');
    expect(f).toContain('concat=n=2:v=1:a=1[v][a]');
  });
  it('crops to a centred aspect ratio with even sizes', () => {
    expect(aspectCrop(1920, 1080, '1:1')).toEqual({ width: 1080, height: 1080, x: 420, y: 0 });
    expect(aspectCrop(1920, 1080, '9:16')).toEqual({ width: 608, height: 1080, x: 656, y: 0 });
    expect(cropFilter({ width: 607, height: 1081, x: 3.4, y: -2 })).toBe('crop=608:1082:3:0');
    expect(() => aspectCrop(10, 10, 'wide')).toThrow();
  });
  it('fits, fills or stretches to a size', () => {
    expect(resizeFilter(1280, 720, 'fit')).toContain('force_original_aspect_ratio=decrease,pad=1280:720');
    expect(resizeFilter(1280, 720, 'fill')).toContain('increase,crop=1280:720');
    expect(resizeFilter(1281, 719, 'exact')).toBe('scale=1282:720,setsar=1');
  });
  it('escapes subtitle paths for the filter graph (drive colons, quotes, brackets)', () => {
    expect(subtitlesFilter("C:\\Subs\\it's [1].srt")).toBe("subtitles='C\\:/Subs/it\\'s \\[1\\].srt'");
  });
  it('cleans with a high-pass, hum notches and a denoiser', () => {
    const f = cleanAudioFilter('strong', 50);
    expect(f).toContain('bandreject=f=50');
    expect(f).toContain('bandreject=f=100');
    expect(f).toContain('afftdn');
    expect(cleanAudioFilter('light', 0)).not.toContain('bandreject');
  });
});

describe('transcripts', () => {
  const segs = [{ start: 0, end: 2.5, text: ' Hello there.' }, { start: 2.5, end: 3661.25, text: 'General Kenobi.' }];
  it('writes SRT, WebVTT, timestamped and plain text', () => {
    expect(toSrt(segs)).toBe('1\n00:00:00,000 --> 00:00:02,500\nHello there.\n\n2\n00:00:02,500 --> 01:01:01,250\nGeneral Kenobi.\n');
    expect(toWebVtt(segs).startsWith('WEBVTT\n\n00:00:00.000 --> 00:00:02.500\n')).toBe(true);
    expect(toTimestamped(segs)).toBe('[00:00:00] Hello there.\n[00:00:02] General Kenobi.');
    expect(toPlain(segs)).toBe('Hello there. General Kenobi.');
  });
  it('splits long speech into readable cues', () => {
    const long = [{ start: 0, end: 20, text: Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ') }];
    const cues = splitForSubtitles(long);
    expect(cues.length).toBeGreaterThan(3);
    expect(cues.every((c) => c.text.length <= 84 && c.end - c.start <= 6.01)).toBe(true);
    expect(cues.map((c) => c.text).join(' ')).toBe(long[0].text);
  });
});

describe('faces', () => {
  it('keeps the best of overlapping boxes', () => {
    const k = nonMaxSuppression([{ x1: 0, y1: 0, x2: 10, y2: 10, score: 0.9 }, { x1: 1, y1: 1, x2: 11, y2: 11, score: 0.8 }, { x1: 50, y1: 50, x2: 60, y2: 60, score: 0.7 }]);
    expect(k.map((b) => b.score)).toEqual([0.9, 0.7]);
  });
  it('turns detector output into padded pixel boxes', () => {
    const scores = new Float32Array([0.9, 0.1, 0.05, 0.95]);
    const boxes = new Float32Array([0, 0, 0.1, 0.1, 0.4, 0.4, 0.6, 0.6]);
    const f = facesFromDetector(scores, boxes, 1000, 500);
    expect(f).toHaveLength(1);
    expect(f[0].x1).toBe(370);
    expect(f[0].x2).toBe(630);
    expect(f[0].y1).toBe(185);
  });
  it('prepares a planar, centred input', () => {
    const t = detectorInput(new Uint8Array([127, 255, 0, 127, 255, 0]), 2, 1);
    expect([...t]).toEqual([0, 0, 1, 1, -127 / 128, -127 / 128]);
  });
});

describe('ZIP and TAR', () => {
  it('computes CRC-32', () => {
    expect(crc32(Buffer.from('123456789')).toString(16)).toBe('cbf43926');
  });
  it('round-trips files and folders, with and without a password', () => {
    const files = [{ name: 'a/' }, { name: 'a/hello.txt', data: Buffer.from('hello '.repeat(200)) }, { name: 'b.bin', data: Buffer.from([1, 2, 3]) }];
    const plain = unzip(zip(files));
    expect(plain.find((e) => e.name === 'a/hello.txt')!.data!.toString()).toBe('hello '.repeat(200));
    const locked = zip(files, { password: 'pässword' });
    expect(() => unzip(locked)).toThrow(/password/);
    expect(() => unzip(locked, 'wrong')).toThrow(/Wrong password|damaged/);
    expect(unzip(locked, 'pässword').find((e) => e.name === 'b.bin')!.data).toEqual(Buffer.from([1, 2, 3]));
  });
  it('makes ZIPs the system’s unzip opens, including with a password', () => {
    let unzipBin = '';
    try { unzipBin = execFileSync('which', ['unzip']).toString().trim(); } catch { /* not installed */ }
    if (!unzipBin) return;
    const dir = mkdtempSync(path.join(os.tmpdir(), 'kz-'));
    writeFileSync(path.join(dir, 'p.zip'), zip([{ name: 'note.txt', data: Buffer.from('secret note '.repeat(50)) }], { password: 'pw' }));
    execFileSync(unzipBin, ['-q', '-P', 'pw', path.join(dir, 'p.zip'), '-d', path.join(dir, 'out')]);
    expect(require('node:fs').readFileSync(path.join(dir, 'out', 'note.txt'), 'utf8')).toBe('secret note '.repeat(50));
  });
  it('reads plain and gzipped TAR, including long names', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'kt-'));
    const long = 'x'.repeat(120);
    require('node:fs').mkdirSync(path.join(dir, 'src', long), { recursive: true });
    writeFileSync(path.join(dir, 'src', long, 'f.txt'), 'inside');
    try {
      execFileSync('tar', ['-czf', path.join(dir, 'a.tgz'), '-C', path.join(dir, 'src'), '.']);
    } catch {
      return;
    }
    const entries = untar(require('node:fs').readFileSync(path.join(dir, 'a.tgz')));
    const f = entries.find((e) => e.name.endsWith(`${long}/f.txt`));
    expect(f?.data?.toString()).toBe('inside');
  });
  it('refuses names that would escape the destination', () => {
    expect(safeEntryPath('../etc/passwd')).toBeUndefined();
    expect(safeEntryPath('/abs/file')).toBeUndefined();
    expect(safeEntryPath('C:/Windows/x')).toBeUndefined();
    expect(safeEntryPath('a/./b/c.txt')).toBe('a/b/c.txt');
  });
});

describe('Word documents', () => {
  it('writes a .docx from Markdown and reads it back as HTML and Markdown', () => {
    const blocks = markdownBlocks('# Plan\n\nSome **bold** and *italic* text.\n\n- one\n- two\n\n1. first\n\n```\ncode here\n```');
    const doc = buildDocx(blocks, 'Plan');
    const html = docxToHtml(doc);
    expect(html).toContain('<h1>Plan</h1>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
    expect(html).toMatch(/<ul>\s*<li>one<\/li>\s*<li>two<\/li>\s*<\/ul>/);
    expect(htmlToMarkdown(html)).toContain('# Plan');
  });
  it('opens in LibreOffice when it is installed', () => {
    let soffice = '';
    try { soffice = execFileSync('which', ['soffice']).toString().trim(); } catch { /* not installed */ }
    if (!soffice) return;
    const dir = mkdtempSync(path.join(os.tmpdir(), 'kd-'));
    writeFileSync(path.join(dir, 'x.docx'), buildDocx(markdownBlocks('# Hello\n\nWorld of documents.')));
    execFileSync(soffice, [`-env:UserInstallation=file://${dir}/p`, '--headless', '--convert-to', 'txt:Text', '--outdir', dir, path.join(dir, 'x.docx')], { timeout: 120_000 });
    expect(require('node:fs').readFileSync(path.join(dir, 'x.txt'), 'utf8')).toContain('World of documents.');
  }, 150_000);
  it('turns simple HTML into blocks', () => {
    const b = htmlBlocks('<h2>T</h2><p>a <b>b</b></p><ul><li>x</li></ul>');
    expect(b[0]).toEqual({ type: 'heading', level: 2, text: 'T' });
    expect(b.some((x) => x.type === 'bullet' && x.text === 'x')).toBe(true);
  });
});

describe('coordinates', () => {
  it('reads decimal, DMS, hemispheres and map links', () => {
    expect(parseCoordinates('52.52, 13.405')).toEqual({ lat: 52.52, lon: 13.405 });
    const dms = parseCoordinates(`52°31'12"N 13°24'18"E`)!;
    expect(dms.lat).toBeCloseTo(52.52, 4);
    expect(dms.lon).toBeCloseTo(13.405, 4);
    expect(parseCoordinates('33.86S 151.21E')).toEqual({ lat: -33.86, lon: 151.21 });
    expect(parseCoordinates('https://www.google.com/maps/@48.8584,2.2945,17z')).toEqual({ lat: 48.8584, lon: 2.2945 });
    expect(parseCoordinates('geo:59.437,24.7536')).toEqual({ lat: 59.437, lon: 24.7536 });
    expect(parseCoordinates('200, 10')).toBeUndefined();
  });
  it('writes DMS, UTM, geohash and plus codes', () => {
    expect(toDms({ lat: 52.52, lon: 13.405 })).toBe('52°31′12.0″N 13°24′18.0″E');
    const u = toUtm({ lat: 48.8584, lon: 2.2945 });
    expect(u.zone).toBe(31);
    expect(u.band).toBe('U');
    expect(Math.abs(u.easting - 448252)).toBeLessThan(3);
    expect(Math.abs(u.northing - 5411955)).toBeLessThan(3);
    expect(geohash({ lat: 57.64911, lon: 10.40744 }, 11)).toBe('u4pruydqqvj');
    const back = fromGeohash('u4pruydqqvj')!;
    expect(back.lat).toBeCloseTo(57.64911, 4);
    expect(plusCode({ lat: 47.0000625, lon: 8.0000625 })).toBe('8FVC2222+22');
    expect(allFormats({ lat: 1, lon: 2 })).toHaveLength(8);
  });
  it('measures distances and bearings', () => {
    const berlin = { lat: 52.52, lon: 13.405 };
    const paris = { lat: 48.8566, lon: 2.3522 };
    expect(distanceKm(berlin, paris)).toBeGreaterThan(875);
    expect(distanceKm(berlin, paris)).toBeLessThan(880);
    expect(bearing(berlin, paris)).toBeCloseTo(246.7, 0);
  });
});

describe('developer helpers', () => {
  it('computes MD5', () => {
    expect(md5('')).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(md5('The quick brown fox jumps over the lazy dog')).toBe('9e107d9d372bb6826bd81d3542a419d6');
    expect(md5('a'.repeat(1000))).toBe('cabe45dcc9ae5b66ba86600cca6b8ba8');
  });
  it('checks HS256 signatures', async () => {
    const t = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    expect((await verifyJwtHmac(t, 'your-256-bit-secret')).ok).toBe(true);
    expect((await verifyJwtHmac(t, 'nope')).ok).toBe(false);
  });
  it('base64 options, UUID inspection and timestamp units', () => {
    expect(base64Options('ab+/cd==', { urlSafe: true })).toBe('ab-_cd');
    expect(base64Options('x'.repeat(10), { wrap: 4 })).toBe('xxxx\nxxxx\nxx');
    const v7 = inspectUuid('01934a5e-7b2c-7def-8abc-0123456789ab')!;
    expect(v7.version).toBe(7);
    expect(v7.time).toBe(0x01934a5e7b2c);
    expect(inspectUuid('c232ab00-9414-11ec-b3c8-9f6bdeced846')!.time).toBe(Date.UTC(2022, 1, 22, 19, 22, 22));
    expect(timestampIn('1730000000')!.unit).toBe('s');
    expect(timestampIn('1730000000000')!.unit).toBe('ms');
    expect(timestampIn('1730000000000000')!.ms).toBe(1730000000000);
    expect(timestampIn('1730000000', 'Asia/Tokyo')!.zoned).toMatch(/2024/);
  });
});

describe('downloads and speech', () => {
  it('builds downloader arguments for each quality', () => {
    const a = downloadArgs({ url: 'https://example.com/v', quality: '720', folder: '/d' }, '/ff');
    expect(a).toContain('bv*[height<=720]+ba/b[height<=720]/b');
    expect(a).toContain('--no-playlist');
    expect(a.slice(-2)).toEqual(['--', 'https://example.com/v']);
    expect(downloadArgs({ url: 'u', quality: 'audio', folder: '/d', playlist: true, cookiesFrom: 'firefox' }, null)).toEqual(expect.arrayContaining(['-x', '--yes-playlist', '--cookies-from-browser', 'firefox']));
  });
  it('reads progress lines', () => {
    expect(parseDownloadLine('[download]  42.3% of ~ 12.34MiB at  2.10MiB/s ETA 00:05')).toEqual({ percent: 42.3, speed: '2.10MiB/s', eta: '00:05' });
    expect(parseDownloadLine('[download] Downloading item 3 of 12')).toEqual({ item: '3 of 12' });
  });
  it('pins every downloader build', () => {
    for (const f of Object.values(YTDLP.files)) expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
  it('builds the speech command for each system, quoting text files safely', () => {
    expect(ttsCommand('darwin', '/t.txt', '/o.aiff', 'Samantha', 1.2)).toEqual({ cmd: '/usr/bin/say', args: ['-v', 'Samantha', '-r', '210', '-f', '/t.txt', '-o', '/o.aiff'], ext: 'aiff' });
    const w = ttsCommand('win32', "C:\\it's.txt", 'C:\\o.wav')!;
    expect(w.args.at(-1)).toContain("'C:\\it''s.txt'");
    expect(ttsCommand('linux', '/t', '/o.wav')!.args).toEqual(['-f', '/t', '-w', '/o.wav']);
  });
});

describe('a real ffmpeg is bundled', () => {
  it('has the filters the new tools use', () => {
    const ff = require('ffmpeg-static') as string;
    if (!existsSync(ff)) return;
    const filters = execFileSync(ff, ['-hide_banner', '-filters']).toString();
    for (const f of ['subtitles', 'afftdn', 'bandreject', 'palettegen', 'amix', 'anullsrc', 'concat']) expect(filters).toContain(` ${f} `);
  });
});

void fsp;

describe('beautify shapes', () => {
  it('widens or heightens the canvas to a shape, keeping the picture centred', async () => {
    const { beautifyLayout } = await import('../core/capture');
    const wide = beautifyLayout(800, 600, { padding: 40, radius: 0, shadow: 0, frame: false, background: '#ff0000', aspect: '16:9' });
    expect(wide.width / wide.height).toBeCloseTo(16 / 9, 2);
    expect(wide.image.x).toBe(Math.round((wide.width - 800) / 2));
    const tall = beautifyLayout(800, 600, { padding: 40, radius: 0, shadow: 0, frame: true, background: 'dusk', aspect: '4:5' });
    expect(tall.width / tall.height).toBeCloseTo(4 / 5, 2);
    expect(tall.image.y - tall.window.y).toBe(34);
  });
});

describe('finding words to redact', () => {
  it('finds phrases split across runs, letters and lines', async () => {
    const { boxesForWords } = await import('../electron/services/pdf-tools');
    const sizes = [{ width: 600, height: 800 }];
    const items = [
      { page: 1, str: 'Booked', x: 50, y: 700, width: 60, height: 12 },
      { page: 1, str: 'for', x: 115, y: 700, width: 25, height: 12 },
      { page: 1, str: 'three', x: 145, y: 700, width: 40, height: 12 },
      { page: 1, str: 'nights', x: 190, y: 700.4, width: 45, height: 12 },
      { page: 1, str: 'three', x: 50, y: 600, width: 40, height: 12 },
    ];
    const b = boxesForWords(items, sizes, ['three nights']);
    expect(b).toHaveLength(1);
    expect(b[0].x * 600).toBeLessThan(145);
    expect((b[0].x + b[0].w) * 600).toBeGreaterThan(235);
    expect(boxesForWords(items, sizes, ['Three'], true)).toHaveLength(0);
    expect(boxesForWords(items, sizes, ['three'])).toHaveLength(2);
  });
});

describe('placeholder text and side-by-side diff', () => {
  it('formats placeholder text as HTML and Markdown', async () => {
    const { loremAs } = await import('../core/textools');
    const t = 'Lorem ipsum dolor sit. Amet two. Three four.\n\nSecond para here.\n\nThird.';
    expect(loremAs(t, 'html')).toBe('<p>Lorem ipsum dolor sit. Amet two. Three four.</p>\n<p>Second para here.</p>\n<p>Third.</p>');
    const md = loremAs(t, 'markdown');
    expect(md.startsWith('## Lorem ipsum dolor')).toBe(true);
    expect(md).toContain('- Second para here.');
    expect(md).toContain('Third.');
    expect(loremAs(t, 'text')).toBe(t);
  });
  it('pairs removed and added lines into change rows', async () => {
    const { sideBySide } = await import('../core/textools');
    const { diffLines } = await import('../core/devtools');
    const rows = sideBySide(diffLines('a\nb\nc\nd', 'a\nB\nc\nd\ne'));
    expect(rows).toEqual([
      { left: 'a', right: 'a', type: 'same' },
      { left: 'b', right: 'B', type: 'change' },
      { left: 'c', right: 'c', type: 'same' },
      { left: 'd', right: 'd', type: 'same' },
      { left: null, right: 'e', type: 'add' },
    ]);
  });
});
