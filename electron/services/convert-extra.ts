// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The newer Convert tools: joining clips, subtitles, cropping, flipping and
// resizing video, new soundtracks, what is inside a file, cleaning up and
// transcribing audio, hiding faces, HEIC output, PDF redaction, forms,
// signatures, searchable scans and Word, document conversion and PDF, reading
// aloud to a file, and ZIP/TAR archives. No Electron here; the app passes in
// what needs it (drawing PDF pages, printing HTML, speech-to-text, OCR).

import { spawn } from 'node:child_process';
import { existsSync, promises as fsp } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { extractPdfText, freeName, parseFfmpegTime, stemOf } from '../../core/convert';
import type { ConvertOp, Corner } from '../../core/convert-types';
import { buildDocx, docxToHtml, htmlBlocks, htmlPage, htmlToMarkdown, markdownBlocks } from '../../core/docx';
import { markdownToHtml } from '../../core/devtools';
import { officeText } from '../../core/brain/extract';
import {
  aspectCrop, canJoinWithoutReencode, cleanAudioFilter, concatFilter, concatList, cropFilter, describeMediaInfo, detectorInput, facesFromDetector, flipFilter,
  parseMediaInfo, replaceAudioArgs, resizeFilter, splitForSubtitles, subtitlesFilter, toPlain, toSrt, toTimestamped, toWebVtt, ttsCommand, type Segment, type StreamFacts,
} from '../../core/media-ops';
import { collectFiles, untar, unzip, writeEntries, zip } from '../../core/zipwrite';
import { lowerPriority } from './governor';
import { sharedWhisper, type LocalWhisper } from './whisper';
import { docKind, docxXmlPieces, htmlPieces, markdownPieces, subtitlePieces, textPieces, translatedName, type DocKind } from '../../core/translate-doc';
import { adaptiveThreshold, findPage, quadSize, scaleQuad, warpPerspective, type Quad } from '../../core/scan';
import type { SpeechOptions } from '../../core/convert-types';
import { fillPdf, makeSearchable, organizePdf, pdfToDocx, redactPdf, signPdf, type OcrWords, type RenderPages } from './pdf-tools';

const req = createRequire(__filename);
type Sharp = typeof import('sharp').default;

export interface ExtraHooks {
  renderPdf?: RenderPages;
  /** prints a page of HTML (or a web address) to PDF; `onePage` makes one long page */
  printToPdf?: (source: { html?: string; url?: string }, o: { pageSize: 'a4' | 'letter'; onePage: boolean }) => Promise<Buffer>;
  /** speech to text for one audio file (mono, 16 kHz MP3), with times */
  transcribe?: (file: string) => Promise<Segment[]>;
  /** the system's own on-device recognizer (macOS); undefined when it is not available */
  systemTranscribe?: (file: string, language?: string) => Promise<Segment[] | undefined>;
  ocrWords?: OcrWords;
  /** translates pieces of text into a language (code like "de"), with the chosen AI or the system's translator */
  translate?: (texts: string[], language: string, engine: 'ai' | 'system', kind: DocKind) => Promise<string[]>;
}

export interface ExtraContext {
  ffmpeg: string | null;
  modelsDir: string;
  sharp: () => Sharp;
  hooks: ExtraHooks;
}

type Progress = (f: number, phase: string) => void;
export interface ExtraResult {
  outputs: string[];
  details?: string;
  message?: string;
}

const VIDEO_EXT = /\.(mp4|mov|m4v|mkv|avi|webm|wmv|flv|mpg|mpeg|3gp|mts|m2ts|ts|ogv)$/i;
const extOf = (p: string) => path.extname(p).slice(1).toLowerCase();

export function exec(cmd: string, args: string[], onLine?: (l: string) => void, opts: { cwd?: string; input?: string } = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { windowsHide: true, cwd: opts.cwd });
    } catch (e) {
      resolve({ code: 127, stdout: '', stderr: String(e) });
      return;
    }
    lowerPriority(child);
    let stdout = '';
    let stderr = '';
    let buf = '';
    const feed = (d: Buffer) => {
      buf += d.toString();
      const lines = buf.split(/\r|\n/);
      buf = lines.pop() ?? '';
      for (const l of lines) onLine?.(l);
    };
    child.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); if (stdout.length > 4_000_000) stdout = stdout.slice(-2_000_000); feed(d); });
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); if (stderr.length > 400_000) stderr = stderr.slice(-200_000); feed(d); });
    if (opts.input !== undefined) child.stdin?.end(opts.input);
    child.on('error', (e) => resolve({ code: 127, stdout, stderr: stderr + String(e) }));
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

export async function findTool(names: string[]): Promise<string | null> {
  const finder = process.platform === 'win32' ? 'where' : 'which';
  for (const n of names) {
    if (path.isAbsolute(n)) {
      if (existsSync(n)) return n;
      continue;
    }
    const r = await exec(finder, [n]);
    if (r.code === 0) {
      const first = r.stdout.split(/\r?\n/)[0].trim();
      if (first) return first;
    }
  }
  return null;
}

/** LibreOffice, where it usually lives on each system. */
export function officeCandidates(): string[] {
  if (process.platform === 'darwin') return ['/Applications/LibreOffice.app/Contents/MacOS/soffice', 'soffice'];
  if (process.platform === 'win32') return [path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'LibreOffice', 'program', 'soffice.exe'), path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'LibreOffice', 'program', 'soffice.exe'), 'soffice'];
  return ['soffice', 'libreoffice'];
}

export class Extra {
  constructor(private ctx: ExtraContext) {}

  private ff(): string {
    if (!this.ctx.ffmpeg) throw new Error('The video engine is missing from this copy of Keeper');
    return this.ctx.ffmpeg;
  }

  async info(file: string): Promise<ReturnType<typeof parseMediaInfo>> {
    return parseMediaInfo((await exec(this.ff(), ['-hide_banner', '-i', file])).stderr);
  }

  /** Runs ffmpeg with full arguments into a temporary file, renamed on success. */
  private async runFf(args: string[], output: string, progress: Progress, duration: number, phase: string): Promise<void> {
    const ext = path.extname(output);
    const tmp = output.slice(0, output.length - ext.length) + `.partial${ext}`;
    const r = await exec(this.ff(), ['-hide_banner', '-y', '-nostdin', ...args, '-progress', 'pipe:1', '-nostats', tmp], (line) => {
      const t = parseFfmpegTime(line);
      if (t !== undefined && duration > 0) progress(Math.min(1, t / duration), phase);
    });
    if (r.code !== 0) {
      await fsp.rm(tmp, { force: true });
      const last = r.stderr.trim().split('\n').reverse().find((l) => /error|invalid|no such|unable|could not|failed|not found/i.test(l));
      throw new Error(last?.trim() ?? 'The video engine could not process this file');
    }
    await fsp.rename(tmp, output);
  }

  private facts(i: ReturnType<typeof parseMediaInfo>): StreamFacts {
    return { videoCodec: i.video?.codec, audioCodec: i.audio?.codec, width: i.video?.width, height: i.video?.height, fps: i.video?.fps, sampleRate: i.audio?.sampleRate };
  }

  // ---------------------------------------------------------------- tools that take every input at once

  async many(op: ConvertOp, inputs: string[], outDir: string, progress: Progress): Promise<ExtraResult | undefined> {
    if (op.tool === 'video.merge') return { outputs: [await this.merge(inputs, outDir, progress)] };
    if (op.tool === 'pdf.organize') {
      progress(0.1, 'Arranging pages');
      for (const f of new Set(op.pages.map((p) => p.file))) if (!/\.pdf$/i.test(f) || !existsSync(f)) throw new Error(`${path.basename(f)} is not available`);
      const o = freeName(outDir, `${stemOf(inputs[0])} organized`, 'pdf');
      const r = await organizePdf(op.pages, o);
      return { outputs: [o], message: r.summary };
    }
    if (op.tool === 'image.scan') {
      const o = await this.scan(inputs, outDir, op.mode, op.pageSize, progress, op.straighten !== false);
      return { outputs: [o], message: op.straighten !== false ? `Straightened ${this.lastScanFound} of ${inputs.length} page${inputs.length === 1 ? '' : 's'}` : undefined };
    }
    if (op.tool === 'file.zip') {
      progress(0.1, 'Collecting');
      const files = await collectFiles(inputs);
      const entries = [];
      for (let i = 0; i < files.length; i++) {
        progress(0.1 + (0.7 * i) / files.length, 'Compressing');
        const f = files[i];
        if (f.name.endsWith('/')) entries.push({ name: f.name });
        else {
          const st = await fsp.stat(f.abs);
          if (st.size > 1.5 * 1024 ** 3) throw new Error(`${path.basename(f.abs)} is too big for a ZIP made here (over 1.5 GB); use Split a large file first`);
          entries.push({ name: f.name, data: await fsp.readFile(f.abs), mtime: st.mtime });
        }
      }
      const name = inputs.length === 1 ? stemOf(inputs[0]) || path.basename(inputs[0]) : `${path.basename(path.dirname(inputs[0]))} ${inputs.length} items`;
      const o = freeName(outDir, name, 'zip');
      await fsp.writeFile(o, zip(entries, { password: op.password || undefined }));
      return { outputs: [o], message: op.password ? 'Saved with a password. Anyone with the password can open it in any unzip tool; for strong protection use Lock with a password.' : `Compressed ${files.filter((f) => !f.name.endsWith('/')).length} files` };
    }
    return undefined;
  }

  private async merge(inputs: string[], outDir: string, progress: Progress): Promise<string> {
    if (inputs.length < 2) throw new Error('Add at least two clips to join');
    const infos = await Promise.all(inputs.map((i) => this.info(i)));
    const total = infos.reduce((n, i) => n + (i.duration ?? 0), 0);
    const first = infos[0];
    const ext = extOf(inputs[0]) || 'mp4';
    if (canJoinWithoutReencode(infos.map((i) => this.facts(i)))) {
      const list = path.join(os.tmpdir(), `keeper-join-${process.pid}-${Date.now()}.txt`);
      await fsp.writeFile(list, concatList(inputs));
      const o = freeName(outDir, `${stemOf(inputs[0])} joined`, ext);
      try {
        await this.runFf(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', ...(ext === 'mp4' || ext === 'mov' ? ['-movflags', '+faststart'] : [])], o, progress, total, 'Joining');
      } finally {
        await fsp.rm(list, { force: true });
      }
      return o;
    }
    const w = first.video?.width ?? 1280;
    const h = first.video?.height ?? 720;
    const o = freeName(outDir, `${stemOf(inputs[0])} joined`, 'mp4');
    await this.runFf([...inputs.flatMap((i) => ['-i', i]), '-filter_complex', concatFilter(inputs.length, w, h, infos.map((i) => !!i.audio), infos.map((i) => i.duration ?? 0)), '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart'], o, progress, total, 'Joining (re-encoding mixed clips)');
    return o;
  }

  // ---------------------------------------------------------------- one input at a time

  async one(op: ConvertOp, input: string, outDir: string, progress: Progress): Promise<ExtraResult | undefined> {
    const stem = stemOf(input);
    const out = (ext: string, suffix = '') => freeName(outDir, stem + suffix, ext);
    const isVideo = VIDEO_EXT.test(input);
    const h264 = ['-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-pix_fmt', 'yuv420p'];
    switch (op.tool) {
      case 'video.info': {
        const i = await this.info(input);
        return { outputs: [], details: describeMediaInfo(path.basename(input), i) };
      }
      case 'video.crop': {
        const i = await this.info(input);
        if (!i.video?.width || !i.video.height) throw new Error('Keeper could not read the picture size');
        const box = op.box ?? aspectCrop(i.video.width, i.video.height, op.ratio);
        const o = out('mp4', ' cropped');
        await this.runFf(['-i', input, '-vf', cropFilter(box), ...h264, '-c:a', 'copy', '-movflags', '+faststart'], o, progress, i.duration ?? 0, 'Cropping');
        return { outputs: [o] };
      }
      case 'video.flip': {
        const i = await this.info(input);
        const o = out('mp4', ' flipped');
        await this.runFf(['-i', input, '-vf', flipFilter(op.axis), ...h264, '-c:a', 'copy', '-movflags', '+faststart'], o, progress, i.duration ?? 0, 'Flipping');
        return { outputs: [o] };
      }
      case 'video.resize': {
        if (!(op.width >= 16 && op.height >= 16)) throw new Error('Type a width and height');
        const i = await this.info(input);
        const o = out('mp4', ` ${op.width}x${op.height}`);
        await this.runFf(['-i', input, '-vf', resizeFilter(op.width, op.height, op.mode), ...h264, '-c:a', 'copy', '-movflags', '+faststart'], o, progress, i.duration ?? 0, 'Resizing');
        return { outputs: [o] };
      }
      case 'video.replaceAudio': {
        if (!op.audio || !existsSync(op.audio)) throw new Error('Choose the new sound file');
        const i = await this.info(input);
        if (op.mode === 'mix' && !i.audio) throw new Error('This video has no sound to mix with; choose Replace');
        const o = out('mp4', op.mode === 'mix' ? ' mixed' : ' new sound');
        await this.runFf(['-i', input, '-i', op.audio, ...replaceAudioArgs(op.mode, op.volume), '-movflags', '+faststart'], o, progress, i.duration ?? 0, op.mode === 'mix' ? 'Mixing' : 'Replacing the sound');
        return { outputs: [o] };
      }
      case 'video.subtitles': {
        const i = await this.info(input);
        let subs = op.file;
        let tmp: string | undefined;
        if (!subs) {
          const sib = ['srt', 'vtt', 'ass'].map((e) => path.join(path.dirname(input), `${stem}.${e}`)).find((p) => existsSync(p));
          if (sib) subs = sib;
        }
        if (!subs) {
          if (!op.auto) throw new Error('Choose a subtitle file (.srt or .vtt), or turn on automatic subtitles');
          const segs = await this.transcribeFile(input, (f, p) => progress(f * 0.5, p), op);
          tmp = path.join(os.tmpdir(), `keeper-subs-${process.pid}-${Date.now()}.srt`);
          await fsp.writeFile(tmp, toSrt(splitForSubtitles(segs)));
          subs = tmp;
        }
        const o = out('mp4', ' subtitled');
        try {
          await this.runFf(['-i', input, '-vf', subtitlesFilter(subs, { fontSize: op.fontSize }), ...h264, '-c:a', 'copy', '-movflags', '+faststart'], o, (f, p) => progress(tmp ? 0.5 + f * 0.5 : f, p), i.duration ?? 0, 'Drawing subtitles');
        } finally {
          if (tmp) await fsp.rm(tmp, { force: true });
        }
        return { outputs: [o] };
      }
      case 'audio.clean': {
        const i = await this.info(input);
        if (!i.audio) throw new Error('This file has no sound');
        const ext = isVideo ? 'mp4' : extOf(input) === 'wav' || extOf(input) === 'flac' ? extOf(input) : 'm4a';
        const o = out(ext, ' clean');
        const codec = ext === 'wav' ? ['-c:a', 'pcm_s16le'] : ext === 'flac' ? ['-c:a', 'flac'] : ['-c:a', 'aac', '-b:a', '192k'];
        await this.runFf(['-i', input, '-af', cleanAudioFilter(op.strength, op.hum), ...(isVideo ? ['-c:v', 'copy'] : ['-vn']), ...codec], o, progress, i.duration ?? 0, 'Cleaning up the sound');
        return { outputs: [o] };
      }
      case 'doc.translate': {
        const kind = docKind(input);
        if (!kind) throw new Error(`${path.basename(input)}: translation works on .docx, .md, .html, .txt, .srt and .vtt files`);
        if (!this.ctx.hooks.translate) throw new Error('Translation is not available here');
        const o = freeName(outDir, path.basename(translatedName(input, op.language)).replace(/\.[^.]+$/, ''), extOf(input));
        const run = async (p: { pieces: string[]; rebuild: (t: string[]) => string }) => {
          progress(0.1, `Translating ${p.pieces.length} piece${p.pieces.length === 1 ? '' : 's'}`);
          const t = p.pieces.length ? await this.ctx.hooks.translate!(p.pieces, op.language, op.engine ?? 'ai', kind) : [];
          return { text: p.rebuild(t), count: p.pieces.length };
        };
        let count = 0;
        if (kind === 'docx') {
          const out = [];
          for (const e of unzip(await fsp.readFile(input))) {
            let data = e.data;
            if (data && /^word\/(document|footnotes|endnotes|header\d*|footer\d*)\.xml$/.test(e.name)) {
              const r = await run(docxXmlPieces(data.toString('utf8')));
              count += r.count;
              data = Buffer.from(r.text, 'utf8');
            }
            out.push({ name: e.dir ? `${e.name.replace(/\/$/, '')}/` : e.name, data, mtime: e.mtime });
          }
          await fsp.writeFile(o, zip(out));
        } else {
          const src = await fsp.readFile(input, 'utf8');
          const p = kind === 'md' ? markdownPieces(src) : kind === 'html' ? htmlPieces(src) : kind === 'srt' || kind === 'vtt' ? subtitlePieces(src, kind === 'vtt') : textPieces(src);
          const r = await run(p);
          count = r.count;
          await fsp.writeFile(o, r.text);
        }
        return { outputs: [o], message: `Translated ${count} piece${count === 1 ? '' : 's'}; layout${kind === 'srt' || kind === 'vtt' ? ' and timings' : ''} kept` };
      }
      case 'audio.transcribe': {
        const segs = await this.transcribeFile(input, progress, op);
        const ext = op.format === 'srt' ? 'srt' : op.format === 'vtt' ? 'vtt' : 'txt';
        const o = out(ext, op.format === 'timestamps' ? ' transcript (times)' : ' transcript');
        const text = op.format === 'srt' ? toSrt(splitForSubtitles(segs)) : op.format === 'vtt' ? toWebVtt(splitForSubtitles(segs)) : op.format === 'timestamps' ? toTimestamped(segs) : toPlain(segs);
        await fsp.writeFile(o, text);
        return { outputs: [o], details: toPlain(segs).slice(0, 20_000) };
      }
      case 'image.flip': {
        const sharp = this.ctx.sharp();
        const o = out(this.keepImageExt(input), ' flipped');
        const img = sharp(input).rotate();
        await (op.axis === 'h' ? img.flop() : img.flip()).toFile(o);
        return { outputs: [o] };
      }
      case 'image.faces': {
        const { file, faces } = await this.hideFaces(input, out(this.keepImageExt(input), ' faces hidden'), op.style, progress);
        return { outputs: [file], message: faces ? `Hid ${faces} face${faces === 1 ? '' : 's'}` : 'No faces were found; the copy is unchanged' };
      }
      case 'pdf.redact': {
        const words = op.words.split(/[\n,;]+/).map((w) => w.trim()).filter(Boolean);
        const o = out('pdf', ' redacted');
        progress(0.1, 'Finding the words');
        const r = await redactPdf(input, o, { words, boxes: op.boxes, caseSensitive: op.caseSensitive }, this.renderer());
        return { outputs: [o], message: `Removed ${r.redactions} match${r.redactions === 1 ? '' : 'es'} on ${r.pages.length} page${r.pages.length === 1 ? '' : 's'}; document details were stripped too` };
      }
      case 'pdf.fill': {
        const o = out('pdf', op.flatten ? ' filled (final)' : ' filled');
        const r = await fillPdf(input, o, { values: op.values, stamps: op.stamps, flatten: op.flatten });
        return { outputs: [o], message: `Filled ${r.filled} field${r.filled === 1 ? '' : 's'}${op.flatten ? ' and flattened them' : ''}` };
      }
      case 'pdf.sign': {
        const png = dataUrlPng(op.signature);
        const o = out('pdf', ' signed');
        await signPdf(input, o, png, { page: op.page, corner: op.corner, width: op.width }, { date: op.date });
        return { outputs: [o] };
      }
      case 'pdf.searchable': {
        if (!this.ctx.hooks.ocrWords) throw new Error('Text recognition is not available here');
        const o = out('pdf', ' searchable');
        const r = await makeSearchable(input, o, this.renderer(), this.ctx.hooks.ocrWords, (i, n) => progress(0.1 + (0.9 * i) / n, 'Reading the pages'));
        return { outputs: [o], message: r.pages ? `Added text to ${r.pages} scanned page${r.pages === 1 ? '' : 's'} (${r.words} words)` : 'Every page already had text; the copy is the same' };
      }
      case 'pdf.toWord': {
        const o = out('docx');
        progress(0.2, 'Reading the pages');
        await pdfToDocx(input, o, this.ctx.hooks.renderPdf ?? (await this.popplerRenderer()));
        return { outputs: [o] };
      }
      case 'doc.toPdf':
        return { outputs: [await this.docToPdf(input, out('pdf'), op, progress)] };
      case 'doc.convert':
        return { outputs: [await this.docConvert(input, outDir, op.format, progress)] };
      case 'doc.speak':
        return { outputs: [await this.speak(input, out(op.format, ' spoken'), op, progress)] };
      case 'file.unzip':
        return this.unpack(input, outDir, op.password, progress);
      case 'file.base64': {
        const st = await fsp.stat(input);
        if (st.size > 200 * 1024 * 1024) throw new Error('Files over 200 MB are too big to turn into Base64 text');
        const { base64Options } = await import('../../core/textools');
        const text = base64Options((await fsp.readFile(input)).toString('base64'), { urlSafe: op.urlSafe, wrap: op.wrap });
        const o = freeName(outDir, path.basename(input), 'b64.txt');
        await fsp.writeFile(o, text);
        return { outputs: [o], details: text.length <= 2_000_000 ? text : undefined };
      }
      default:
        return undefined;
    }
  }

  private keepImageExt(input: string): string {
    const e = extOf(input);
    return ['jpg', 'jpeg', 'png', 'webp', 'tiff', 'tif', 'avif', 'gif'].includes(e) ? (e === 'jpeg' ? 'jpg' : e) : 'png';
  }

  // ---------------------------------------------------------------- scanning

  /**
   * Photos of paper pages into one PDF: turned upright, the paper's edges
   * trimmed, unevenly lit backgrounds evened out, then black and white or grey.
   */
  lastScanFound = 0;

  /**
   * A photo of a page, pulled flat: the page's corners are found on a small
   * copy, then the full-size photo is straightened to a rectangle.
   */
  async flattenPage(input: string, straighten = true): Promise<{ buffer: Buffer; raw?: { width: number; height: number; channels: 3 }; straightened: boolean; quad?: Quad }> {
    const sharp = this.ctx.sharp();
    const full = await sharp(input).rotate().resize({ width: 2480, height: 2480, fit: 'inside', withoutEnlargement: true }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const W = full.info.width, H = full.info.height;
    if (straighten) {
      const small = await sharp(full.data, { raw: { width: W, height: H, channels: 3 } }).resize({ width: 400, height: 400, fit: 'inside' }).grayscale().raw().toBuffer({ resolveWithObject: true });
      const quad = findPage(new Uint8Array(small.data.buffer, small.data.byteOffset, small.data.length), small.info.width, small.info.height);
      if (quad) {
        const q = scaleQuad(quad, W / small.info.width);
        const [ow, oh] = quadSize(q);
        const px = warpPerspective(new Uint8Array(full.data.buffer, full.data.byteOffset, full.data.length), W, H, 3, q, ow, oh);
        return { buffer: Buffer.from(px), raw: { width: ow, height: oh, channels: 3 }, straightened: true, quad: q };
      }
    }
    return { buffer: full.data, raw: { width: W, height: H, channels: 3 }, straightened: false };
  }

  private async scan(inputs: string[], outDir: string, mode: 'bw' | 'gray' | 'color', pageSize: 'fit' | 'a4' | 'letter', progress: Progress, straighten = true): Promise<string> {
    const sharp = this.ctx.sharp();
    const { PDFDocument } = await import('pdf-lib');
    const doc = await PDFDocument.create();
    let found = 0;
    for (let i = 0; i < inputs.length; i++) {
      progress(i / inputs.length, 'Finding and straightening pages');
      const page = await this.flattenPage(inputs[i], straighten);
      if (page.straightened) found++;
      let img = sharp(page.buffer, page.raw ? { raw: page.raw } : undefined);
      // No page edge found: at least trim plain background around it.
      if (!page.straightened) img = sharp(await img.clone().trim({ threshold: 40 }).png().toBuffer().catch(() => sharp(page.buffer, { raw: page.raw }).png().toBuffer()));
      if (mode === 'color') {
        img = img.normalise({ lower: 1, upper: 99 });
      } else {
        const g = await img.grayscale().normalise({ lower: 2, upper: 97 }).raw().toBuffer({ resolveWithObject: true });
        const gray = new Uint8Array(g.data.buffer, g.data.byteOffset, g.data.length);
        const px = mode === 'bw' ? adaptiveThreshold(gray, g.info.width, g.info.height) : gray;
        img = sharp(Buffer.from(px), { raw: { width: g.info.width, height: g.info.height, channels: 1 } });
      }
      const jpg = await img.jpeg({ quality: mode === 'color' ? 85 : 80 }).toBuffer({ resolveWithObject: true });
      const embedded = await doc.embedJpg(jpg.data);
      const [pw, ph] = pageSize === 'a4' ? [595, 842] : pageSize === 'letter' ? [612, 792] : [jpg.info.width * 0.36, jpg.info.height * 0.36];
      const pg = doc.addPage([pw, ph]);
      const s = Math.min(pw / jpg.info.width, ph / jpg.info.height);
      pg.drawImage(embedded, { x: (pw - jpg.info.width * s) / 2, y: (ph - jpg.info.height * s) / 2, width: jpg.info.width * s, height: jpg.info.height * s });
    }
    this.lastScanFound = found;
    const o = freeName(outDir, inputs.length === 1 ? `${stemOf(inputs[0])} scan` : 'Scan', 'pdf');
    await fsp.writeFile(o, await doc.save());
    return o;
  }

  // ---------------------------------------------------------------- transcription

  private whisperEngine: LocalWhisper | null = null;
  /** The on-device speech model (created on first use; it unloads itself when idle). */
  get whisper(): LocalWhisper {
    return (this.whisperEngine ??= sharedWhisper(this.ctx.modelsDir, () => this.ff()));
  }

  /**
   * Speech to text with times. On this computer by default (a Whisper model,
   * every OS); macOS's own recognizer or the dictation service when chosen.
   */
  async transcribeFile(input: string, progress: Progress, speech: SpeechOptions = {}): Promise<Segment[]> {
    const info = await this.info(input);
    if (!info.audio) throw new Error('This file has no sound');
    const engine = speech.engine ?? 'device';
    let segs: Segment[] = [];
    if (engine === 'system') {
      progress(0, 'Listening with the system recognizer');
      // The recognizer reads plain sound files best: hand it a small mono copy.
      const tmp = path.join(os.tmpdir(), `keeper-sys-${process.pid}-${Date.now()}.m4a`);
      try {
        const c = await exec(this.ff(), ['-hide_banner', '-y', '-nostdin', '-i', input, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'aac', '-b:a', '64k', tmp]);
        if (c.code !== 0) throw new Error('Could not prepare the sound for transcription');
        const r = await this.ctx.hooks.systemTranscribe?.(tmp, speech.language);
        if (r === undefined) throw new Error("This system's own speech recognizer is not available here; choose “On this computer” instead");
        segs = r;
      } finally {
        await fsp.rm(tmp, { force: true });
      }
    } else if (engine === 'device') {
      const r = await this.whisper.transcribe(input, { size: speech.model ?? 'base', language: speech.language ?? 'auto', progress: (f, l) => progress(f, l ?? 'Listening') });
      segs = r.segments;
    } else {
      segs = await this.viaService(input, info.duration ?? 0, progress);
    }
    if (!segs.length) throw new Error('No speech was found');
    return segs;
  }

  /** Through the dictation service. Long recordings go in 10-minute pieces, small and mono. */
  private async viaService(input: string, dur: number, progress: Progress): Promise<Segment[]> {
    if (!this.ctx.hooks.transcribe) throw new Error('Choose a speech-to-text service first (Settings → Island → Dictation), or transcribe on this computer');
    const piece = 600;
    const segs: Segment[] = [];
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'keeper-tx-'));
    try {
      const n = Math.max(1, Math.ceil(dur / piece));
      for (let k = 0; k < n; k++) {
        progress(k / n, n > 1 ? `Listening (part ${k + 1} of ${n})` : 'Listening');
        const part = path.join(dir, `part${k}.mp3`);
        const r = await exec(this.ff(), ['-hide_banner', '-y', '-nostdin', '-ss', String(k * piece), '-t', String(piece), '-i', input, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '48k', part]);
        if (r.code !== 0) throw new Error('Could not prepare the sound for transcription');
        for (const s of await this.ctx.hooks.transcribe(part)) segs.push({ start: s.start + k * piece, end: s.end + k * piece, text: s.text });
      }
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
    return segs;
  }

  // ---------------------------------------------------------------- faces

  private faceSession: Promise<{ run(f: Record<string, unknown>): Promise<Record<string, { data: Float32Array }>> }> | null = null;

  private async faceModel() {
    this.faceSession ??= (async () => {
      const ort = req('onnxruntime-node') as typeof import('onnxruntime-node');
      await fsp.mkdir(this.ctx.modelsDir, { recursive: true });
      const file = path.join(this.ctx.modelsDir, 'face-rfb320.onnx');
      if (!existsSync(file)) {
        // A 1.3 MB face detector (MIT licence), checked against its known fingerprint.
        const res = await fetch(FACE_MODEL.url);
        if (!res.ok) throw new Error(`Could not download the face finder (${res.status})`);
        const buf = Buffer.from(await res.arrayBuffer());
        if (createHash('sha256').update(buf).digest('hex') !== FACE_MODEL.sha256) throw new Error('The face finder download did not match its fingerprint');
        await fsp.writeFile(file + '.partial', buf);
        await fsp.rename(file + '.partial', file);
      }
      return ort.InferenceSession.create(file, { logSeverityLevel: 3 }) as unknown as { run(f: Record<string, unknown>): Promise<Record<string, { data: Float32Array }>> };
    })();
    this.faceSession.catch(() => (this.faceSession = null));
    return this.faceSession;
  }

  async findFaces(input: string): Promise<{ boxes: { x1: number; y1: number; x2: number; y2: number }[]; width: number; height: number }> {
    const sharp = this.ctx.sharp();
    const base = sharp(input).rotate();
    const meta = await sharp(await base.clone().toBuffer()).metadata();
    const W = meta.width ?? 0;
    const H = meta.height ?? 0;
    const session = await this.faceModel();
    const ort = req('onnxruntime-node') as typeof import('onnxruntime-node');
    // Small faces in big photos: also look at overlapping tiles of the picture.
    const boxes: { x1: number; y1: number; x2: number; y2: number; score: number }[] = [];
    const looks: { x: number; y: number; w: number; h: number }[] = [{ x: 0, y: 0, w: W, h: H }];
    if (Math.max(W, H) > 600) {
      const tw = Math.round(W / 2);
      const th = Math.round(H / 2);
      for (const [x, y] of [[0, 0], [W - tw, 0], [0, H - th], [W - tw, H - th], [Math.round((W - tw) / 2), Math.round((H - th) / 2)]]) looks.push({ x, y, w: tw, h: th });
    }
    for (const l of looks) {
      const rgb = await base.clone().extract({ left: l.x, top: l.y, width: l.w, height: l.h }).resize(320, 240, { fit: 'fill' }).removeAlpha().raw().toBuffer();
      const res = await session.run({ input: new ort.Tensor('float32', detectorInput(rgb), [1, 3, 240, 320]) });
      for (const b of facesFromDetector(res.scores.data, res.boxes.data, l.w, l.h, 0.55)) boxes.push({ x1: b.x1 + l.x, y1: b.y1 + l.y, x2: b.x2 + l.x, y2: b.y2 + l.y, score: b.score });
    }
    const { nonMaxSuppression } = await import('../../core/media-ops');
    return { boxes: nonMaxSuppression(boxes, 0.2), width: W, height: H };
  }

  private async hideFaces(input: string, output: string, style: 'blur' | 'pixelate' | 'black', progress: Progress): Promise<{ file: string; faces: number }> {
    const sharp = this.ctx.sharp();
    progress(0.2, 'Looking for faces');
    const { boxes, width, height } = await this.findFaces(input);
    progress(0.7, 'Hiding faces');
    const base = await sharp(input).rotate().toBuffer();
    const layers = [];
    for (const b of boxes) {
      const w = Math.max(1, Math.min(width - b.x1, b.x2 - b.x1));
      const h = Math.max(1, Math.min(height - b.y1, b.y2 - b.y1));
      let patch: Buffer;
      if (style === 'black') patch = await sharp({ create: { width: w, height: h, channels: 3, background: '#000000' } }).png().toBuffer();
      else if (style === 'pixelate') {
        const cells = Math.max(4, Math.round(Math.min(w, h) / 12));
        // Two steps: sharp keeps only the last resize of a chain.
        const small = await sharp(base).extract({ left: b.x1, top: b.y1, width: w, height: h }).resize(Math.max(1, Math.round(w / cells)), Math.max(1, Math.round(h / cells)), { kernel: 'cubic' }).png().toBuffer();
        patch = await sharp(small).resize(w, h, { kernel: 'nearest' }).png().toBuffer();
      } else patch = await sharp(base).extract({ left: b.x1, top: b.y1, width: w, height: h }).blur(Math.max(8, Math.min(w, h) / 5)).png().toBuffer();
      layers.push({ input: patch, left: b.x1, top: b.y1 });
    }
    const img = sharp(base).composite(layers);
    const ext = extOf(output);
    await (ext === 'jpg' ? img.jpeg({ quality: 92 }) : ext === 'webp' ? img.webp({ quality: 92 }) : img.png()).toFile(output);
    return { file: output, faces: boxes.length };
  }

  // ---------------------------------------------------------------- PDF pages

  private renderer(): RenderPages {
    if (this.ctx.hooks.renderPdf) return this.ctx.hooks.renderPdf;
    return async (file, scale) => (await this.popplerRenderer())!(file, scale);
  }

  private async popplerRenderer(): Promise<RenderPages | undefined> {
    const pdftoppm = await findTool(['pdftoppm']);
    if (!pdftoppm) return undefined;
    return async (file, scale) => {
      const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'keeper-pages-'));
      try {
        const r = await exec(pdftoppm, ['-png', '-r', String(Math.round(72 * scale)), file, path.join(dir, 'p')]);
        if (r.code !== 0) throw new Error('Could not draw the pages');
        const names = (await fsp.readdir(dir)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        return Promise.all(names.map((n) => fsp.readFile(path.join(dir, n))));
      } finally {
        await fsp.rm(dir, { recursive: true, force: true });
      }
    };
  }

  // ---------------------------------------------------------------- documents

  private async office(): Promise<string | null> {
    return findTool(officeCandidates());
  }

  /** Converts with LibreOffice into a temporary folder and returns the file it made. */
  private async viaOffice(input: string, target: string, output: string): Promise<string | undefined> {
    const soffice = await this.office();
    if (!soffice) return undefined;
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'keeper-office-'));
    try {
      // A private profile so a running LibreOffice window does not block the conversion.
      const profile = `-env:UserInstallation=file://${path.join(dir, 'profile').replace(/\\/g, '/')}`;
      const r = await exec(soffice, [profile, '--headless', '--norestore', '--convert-to', target, '--outdir', dir, input]);
      const made = (await fsp.readdir(dir)).find((n) => n !== 'profile' && n.toLowerCase().endsWith(`.${target.split(':')[0]}`));
      if (r.code !== 0 || !made) return undefined;
      await fsp.copyFile(path.join(dir, made), output);
      return output;
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  }

  private async htmlOf(input: string): Promise<string | undefined> {
    const e = extOf(input);
    const raw = await fsp.readFile(input);
    if (e === 'md' || e === 'markdown') return htmlPage(markdownToHtml(raw.toString('utf8')), path.basename(input));
    if (e === 'txt' || e === 'log' || e === 'csv' || e === 'json' || e === 'yaml' || e === 'yml' || e === 'xml') return htmlPage(`<pre>${raw.toString('utf8').replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>`, path.basename(input));
    if (e === 'html' || e === 'htm') return raw.toString('utf8');
    if (e === 'docx' || e === 'docm' || e === 'dotx') return htmlPage(docxToHtml(raw), path.basename(input));
    if (e === 'rtf' && process.platform === 'darwin') {
      const r = await exec('/usr/bin/textutil', ['-convert', 'html', '-stdout', input]);
      if (r.code === 0) return r.stdout;
    }
    return undefined;
  }

  private async docToPdf(input: string, output: string, op: Extract<ConvertOp, { tool: 'doc.toPdf' }>, progress: Progress): Promise<string> {
    const e = extOf(input);
    progress(0.1, 'Converting');
    // Markdown and our own HTML render best through the built-in printer; office files through an office suite.
    const builtIn = ['md', 'markdown', 'txt', 'log', 'csv', 'json', 'yaml', 'yml', 'xml', 'html', 'htm'].includes(e);
    if (!builtIn && (await this.viaOffice(input, 'pdf', output))) return output;
    const html = await this.htmlOf(input);
    if (html && this.ctx.hooks.printToPdf) {
      await fsp.writeFile(output, await this.ctx.hooks.printToPdf({ html }, { pageSize: op.pageSize, onePage: op.onePage }));
      return output;
    }
    if (await this.nativeOffice(input, output)) return output;
    if (builtIn && (await this.viaOffice(input, 'pdf', output))) return output;
    throw new Error(['pptx', 'ppt', 'key', 'xlsx', 'xls', 'numbers', 'odp', 'ods'].includes(e) ? 'Install LibreOffice (free), Microsoft Office, or on a Mac Keynote/Numbers, and Keeper will use it for this file' : 'Keeper cannot turn this kind of file into a PDF here');
  }

  /** Office apps that are already installed: Pages/Keynote/Numbers on a Mac, Word/PowerPoint/Excel on Windows. */
  private async nativeOffice(input: string, output: string): Promise<boolean> {
    const e = extOf(input);
    if (process.platform === 'darwin') {
      const app = ['pptx', 'ppt', 'key', 'odp'].includes(e) ? 'Keynote' : ['xlsx', 'xls', 'numbers', 'ods', 'csv'].includes(e) ? 'Numbers' : ['docx', 'doc', 'pages', 'odt', 'rtf'].includes(e) ? 'Pages' : undefined;
      if (!app || !existsSync(`/Applications/${app}.app`)) return false;
      const script = `tell application "${app}"\nset d to open (POSIX file ${JSON.stringify(input)})\nexport d to (POSIX file ${JSON.stringify(output)}) as PDF\nclose d saving no\nend tell`;
      return (await exec('/usr/bin/osascript', ['-e', script])).code === 0 && existsSync(output);
    }
    if (process.platform === 'win32') {
      const q = (s: string) => `'${s.replace(/['‘’‚‛]/g, '$&$&')}'`;
      const ps = ['pptx', 'ppt', 'odp'].includes(e)
        ? `$a = New-Object -ComObject PowerPoint.Application; $p = $a.Presentations.Open(${q(input)}, $true, $false, $false); $p.SaveAs(${q(output)}, 32); $p.Close(); $a.Quit()`
        : ['xlsx', 'xls', 'ods', 'csv'].includes(e)
          ? `$a = New-Object -ComObject Excel.Application; $a.DisplayAlerts = $false; $w = $a.Workbooks.Open(${q(input)}); $w.ExportAsFixedFormat(0, ${q(output)}); $w.Close($false); $a.Quit()`
          : ['docx', 'doc', 'odt', 'rtf', 'txt', 'html', 'htm'].includes(e)
            ? `$a = New-Object -ComObject Word.Application; $d = $a.Documents.Open(${q(input)}, $false, $true); $d.SaveAs2(${q(output)}, 17); $d.Close($false); $a.Quit()`
            : undefined;
      if (!ps) return false;
      return (await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps])).code === 0 && existsSync(output);
    }
    return false;
  }

  private async docConvert(input: string, outDir: string, format: 'docx' | 'html' | 'md' | 'txt', progress: Progress): Promise<string> {
    const e = extOf(input);
    const stem = stemOf(input);
    const output = freeName(outDir, stem, format);
    progress(0.2, 'Converting');
    if (e === format) throw new Error(`This is already a .${format} file`);
    const raw = await fsp.readFile(input);
    // Built in: Word, Markdown, HTML and text to each other.
    if (['docx', 'md', 'markdown', 'txt', 'html', 'htm'].includes(e)) {
      const htmlBody = e === 'docx' ? docxToHtml(raw) : e === 'md' || e === 'markdown' ? markdownToHtml(raw.toString('utf8')) : e === 'txt' ? `<pre>${raw.toString('utf8').replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>` : raw.toString('utf8');
      if (format === 'html') await fsp.writeFile(output, e === 'html' || e === 'htm' ? htmlBody : htmlPage(htmlBody, stem));
      else if (format === 'md') await fsp.writeFile(output, e === 'txt' ? raw.toString('utf8') : htmlToMarkdown(htmlBody));
      else if (format === 'txt') await fsp.writeFile(output, htmlToMarkdown(htmlBody).replace(/[*_`#]+/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'));
      else await fsp.writeFile(output, buildDocx(e === 'md' || e === 'markdown' || e === 'txt' ? markdownBlocks(raw.toString('utf8')) : htmlBlocks(htmlBody), stem));
      return output;
    }
    // Anything else (OpenDocument, RTF, old .doc, WordPerfect…) through an office suite.
    const target = format === 'md' ? 'html' : format === 'txt' ? 'txt:Text' : format;
    const via = await this.viaOffice(input, target, format === 'md' ? output + '.html' : output);
    if (via && format === 'md') {
      await fsp.writeFile(output, htmlToMarkdown(await fsp.readFile(via, 'utf8')));
      await fsp.rm(via, { force: true });
      return output;
    }
    if (via) return output;
    if (e === 'rtf' && process.platform === 'darwin') {
      const r = await exec('/usr/bin/textutil', ['-convert', format === 'md' ? 'html' : format, '-output', format === 'md' ? output + '.html' : output, input]);
      if (r.code === 0 && format !== 'md') return output;
      if (r.code === 0) {
        await fsp.writeFile(output, htmlToMarkdown(await fsp.readFile(output + '.html', 'utf8')));
        await fsp.rm(output + '.html', { force: true });
        return output;
      }
    }
    // Text at least: every office format Keeper can read.
    if (format === 'txt' || format === 'md') {
      const text = ['odt', 'pptx', 'xlsx', 'epub', 'ods', 'odp'].includes(e) ? officeText(raw, e) : '';
      if (text) {
        await fsp.writeFile(output, text);
        return output;
      }
    }
    throw new Error('Install LibreOffice (free) and Keeper will use it to convert this kind of file');
  }

  // ---------------------------------------------------------------- reading aloud

  async speechAvailable(): Promise<boolean> {
    if (process.platform === 'darwin' || process.platform === 'win32') return true;
    return !!(await findTool(['espeak-ng', 'espeak']));
  }

  async textOf(input: string): Promise<string> {
    const e = extOf(input);
    const raw = await fsp.readFile(input);
    if (e === 'pdf') return (await extractPdfText(input, 2_000_000, 2000)).text;
    if (['docx', 'pptx', 'xlsx', 'odt', 'odp', 'ods', 'epub'].includes(e)) return officeText(raw, e);
    const html = ['html', 'htm', 'md', 'markdown'].includes(e) ? await this.htmlOf(input) : undefined;
    if (html) return htmlToMarkdown(html).replace(/[*_`#>|]+/g, ' ');
    return raw.toString('utf8');
  }

  private async speak(input: string, output: string, op: Extract<ConvertOp, { tool: 'doc.speak' }>, progress: Progress): Promise<string> {
    progress(0.05, 'Reading the text');
    const text = (await this.textOf(input)).replace(/\s+/g, ' ').trim();
    if (!text) throw new Error('There is no text to read');
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'keeper-tts-'));
    try {
      const txt = path.join(dir, 'text.txt');
      await fsp.writeFile(txt, text, 'utf8');
      let cmd = ttsCommand(process.platform, txt, '', op.voice, op.rate)!;
      if (process.platform === 'linux') {
        const tool = await findTool(['espeak-ng', 'espeak']);
        if (!tool) throw new Error('Install espeak-ng (or a speech engine) to read aloud to a file');
        cmd = { ...cmd, cmd: tool };
      }
      const raw = path.join(dir, `speech.${cmd.ext}`);
      cmd = ttsCommand(process.platform, txt, raw, op.voice, op.rate)!;
      if (process.platform === 'linux') cmd.cmd = (await findTool(['espeak-ng', 'espeak']))!;
      progress(0.2, 'Speaking');
      const r = await exec(cmd.cmd, cmd.args);
      if (r.code !== 0 || !existsSync(raw)) throw new Error(r.stderr.trim().split('\n').pop() || 'The speech engine could not read this text');
      progress(0.8, 'Saving');
      if (op.format === 'wav' && cmd.ext === 'wav') await fsp.copyFile(raw, output);
      else {
        const codec = op.format === 'mp3' ? ['-c:a', 'libmp3lame', '-q:a', '3'] : op.format === 'm4a' ? ['-c:a', 'aac', '-b:a', '128k'] : ['-c:a', 'pcm_s16le'];
        const c = await exec(this.ff(), ['-hide_banner', '-y', '-nostdin', '-i', raw, ...codec, output]);
        if (c.code !== 0) throw new Error('Could not save the audio');
      }
      return output;
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  }

  // ---------------------------------------------------------------- archives

  private async unpack(input: string, outDir: string, password: string | undefined, progress: Progress): Promise<ExtraResult> {
    const name = path.basename(input);
    const base = name.replace(/\.(tar\.(gz|bz2|xz|zst)|tgz|tbz2?|txz|zip|tar|7z|rar|gz|bz2|xz)$/i, '') || stemOf(input);
    const dest = freeName(outDir, base, '');
    await fsp.mkdir(dest, { recursive: true });
    progress(0.2, 'Unpacking');
    const lower = name.toLowerCase();
    try {
      if (lower.endsWith('.zip')) {
        const r = await writeEntries(unzip(await fsp.readFile(input), password), dest);
        return { outputs: [dest], message: `Unpacked ${r.files} file${r.files === 1 ? '' : 's'}${r.skipped.length ? `; skipped ${r.skipped.length} unsafe name(s)` : ''}` };
      }
      if (/\.(tar|tgz|tar\.gz)$/.test(lower)) {
        const r = await writeEntries(untar(await fsp.readFile(input)), dest);
        return { outputs: [dest], message: `Unpacked ${r.files} file${r.files === 1 ? '' : 's'}` };
      }
    } catch (e) {
      // AES ZIPs and other variants fall through to the system's tools below.
      if (!/AES|method/.test(String(e))) {
        await fsp.rm(dest, { recursive: true, force: true });
        throw e;
      }
    }
    // 7z, RAR, xz, bz2, zstd and AES ZIPs: the system's own archive tool (bsdtar ships with macOS and Windows), then 7-Zip, then unar.
    const sevenZip = await findTool(['7z', '7zz', '7za', ...(process.platform === 'win32' ? [path.join(process.env.ProgramFiles ?? 'C:\\Program Files', '7-Zip', '7z.exe')] : [])]);
    if (sevenZip) {
      const r = await exec(sevenZip, ['x', '-y', `-o${dest}`, ...(password ? [`-p${password}`] : ['-p']), input]);
      if (r.code === 0) return { outputs: [dest] };
    }
    const bsdtar = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : await findTool(['bsdtar', process.platform === 'darwin' ? '/usr/bin/tar' : 'bsdtar']);
    if (bsdtar && existsSync(bsdtar)) {
      const r = await exec(bsdtar, ['-xf', input, '-C', dest, ...(password ? ['--passphrase', password] : [])]);
      if (r.code === 0) return { outputs: [dest] };
    }
    const unar = await findTool(['unar']);
    if (unar) {
      const r = await exec(unar, ['-quiet', '-force-overwrite', '-no-directory', '-o', dest, ...(password ? ['-password', password] : []), input]);
      if (r.code === 0) return { outputs: [dest] };
    }
    await fsp.rm(dest, { recursive: true, force: true });
    throw new Error('Keeper could not unpack this archive; install 7-Zip (Windows, Linux) or The Unarchiver (Mac) for this format');
  }
}

export const FACE_MODEL = {
  url: 'https://raw.githubusercontent.com/Linzaer/Ultra-Light-Fast-Generic-Face-Detector-1MB/master/models/onnx/version-RFB-320.onnx',
  sha256: '34cd7e60aeff28744c657de7a3dc64e872d506741de66987f3426f2b79f88017',
};

export function dataUrlPng(dataUrl: string): Buffer {
  const m = dataUrl.match(/^data:image\/png;base64,(.+)$/);
  if (!m) throw new Error('Draw or type your signature first');
  return Buffer.from(m[1], 'base64');
}

export type { Corner };
