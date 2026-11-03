// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Runs conversions: video and audio through ffmpeg, pictures through sharp,
// PDFs through pdf-lib (and qpdf for passwords), background removal through
// a small on-device model. Nothing here imports Electron: the few OS-specific
// fallbacks (HEIC decoding, drawing PDF pages) are passed in, so the same code
// runs in tests and in the command-line tool.

import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, promises as fsp } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { degrees, PDFDocument, PDFName, PDFRawStream, rgb, StandardFonts } from 'pdf-lib';
import {
  algoForLength, atempoChain, audioBitrateFor, checksum, decryptFile, ENC_EXT, encryptFile, findParts, freeName, isEncryptedFile, joinParts,
  outputFolder, parseDuration, parseFfmpegTime, parsePageRanges, parseSplitGroups, PRESETS, sameChecksum, splitFile, stemOf, videoBitrate,
} from '../../core/convert';
import type { ConvertCapabilities, ConvertJob, ConvertOp, ConvertResult, Corner, HashAlgo } from '../../core/convert-types';
import { formatBytes } from '../../core/format';
import { lowerPriority } from './governor';
import { decryptPdf, encryptPdf } from '../../core/pdfcrypt';
import { Extra, findTool, officeCandidates, type ExtraHooks } from './convert-extra';
import { FileKit } from './filekit';
import { isKitTool, type KitOp } from '../../core/filekit/tools';
import { featuresForOp } from '../../core/convert-types';
import { featureOn } from './features';
import { featureDef } from '../../core/features';

// The standard output folder (set by the app) and ffmpeg's place live in convert-shared.ts.
export { setStandardOutput } from './convert-shared';
import { ffmpegPath, standardOutput } from './convert-shared';
import { onnxRuntime, onnxRuntimeReady } from '../../core/component-paths';

type Sharp = typeof import('sharp').default;

const req = createRequire(__filename);
/** SHA-256 of rembg's u2netp.onnx (v0.0.0 release), the background-removal model. */
const U2NETP_SHA256 = '309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8';

export interface ConverterHooks extends ExtraHooks {
  /** decodes an image sharp cannot read (HEIC on Windows) into PNG bytes */
  decodeImage?: (file: string) => Promise<Buffer | null>;
  /** draws PDF pages to PNG bytes at the given scale (needs a canvas) */
  renderPdf?: (file: string, scale: number) => Promise<Buffer[]>;
}

export interface ConverterOptions {
  /** where downloaded models are kept */
  modelsDir: string;
  onProgress?: (fraction: number, phase: string) => void;
  hooks?: ConverterHooks;
  /** adds a file to Keeper's brain (the "Prepare for AI" tool) */
  toBrain?: (file: string) => Promise<string>;
}

/** ffmpeg ships inside the app; when packaged it lives outside the asar archive. */
export { ffmpegPath } from './convert-shared';

function which(cmd: string): Promise<string | null> {
  return new Promise((resolve) => {
    const finder = process.platform === 'win32' ? 'where' : 'which';
    const child = spawn(finder, [cmd], { windowsHide: true });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('error', () => resolve(null));
    child.on('close', (code) => resolve(code === 0 ? out.split(/\r?\n/)[0].trim() || null : null));
  });
}

function run(cmd: string, args: string[], onLine?: (line: string) => void): Promise<{ code: number; stderr: string; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true });
    // Conversions use the processor fully, but give way to whatever the person is doing.
    lowerPriority(child);
    let stderr = '';
    let stdout = '';
    let buf = '';
    const feed = (d: Buffer) => {
      const s = d.toString();
      buf += s;
      const lines = buf.split(/\r|\n/);
      buf = lines.pop() ?? '';
      for (const l of lines) onLine?.(l);
    };
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000);
      feed(d);
    });
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
      feed(d);
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stderr, stdout }));
  });
}

const VIDEO_EXT = /\.(mp4|mov|m4v|mkv|avi|webm|wmv|flv|mpg|mpeg|3gp|mts|m2ts|ts|ogv)$/i;

export class Converter {
  private sharpMod: Sharp | null = null;
  readonly extra: Extra;
  private kitMod: FileKit | null = null;
  constructor(private opts: ConverterOptions) {
    this.extra = new Extra({ ffmpeg: ffmpegPath(), modelsDir: opts.modelsDir, sharp: () => this.sharp(), hooks: opts.hooks ?? {} });
  }

  /** The file kit (more PDF tools, "Convert to…"), made on first use. */
  get kit(): FileKit {
    this.kitMod ??= new FileKit({
      extra: this.extra, sharp: () => this.sharp(), ffmpeg: ffmpegPath(), hooks: this.opts.hooks ?? {},
      runOp: (op, inputs, outDir) => this.run({ op, inputs, outDir }),
      toBrain: this.opts.toBrain,
    });
    return this.kitMod;
  }

  private sharp(): Sharp {
    this.sharpMod ??= req('sharp') as Sharp;
    return this.sharpMod;
  }

  private progress(f: number, phase: string) {
    this.opts.onProgress?.(Math.max(0, Math.min(1, f)), phase);
  }

  async capabilities(): Promise<ConvertCapabilities> {
    let bg = false;
    try {
      // Inside the app or downloaded as a component (none is built for Intel Macs).
      bg = onnxRuntimeReady();
    } catch {
      bg = false;
    }
    return {
      ffmpeg: !!ffmpegPath(),
      // Passwords are handled natively; qpdf only helps with packed files.
      qpdf: !!(await which('qpdf')),
      sips: process.platform === 'darwin',
      bgRemoval: bg,
      pdfRender: !!this.opts.hooks?.renderPdf || !!(await which('pdftoppm')),
      office: !!(await findTool(officeCandidates())),
      speech: await this.extra.speechAvailable(),
      transcribe: !!ffmpegPath(),
      transcribeService: !!this.opts.hooks?.transcribe,
      speechModels: await this.extra.whisper.installed(),
    };
  }

  async run(job: ConvertJob): Promise<ConvertResult> {
    // A switch off in Settings → Features stops its tools everywhere (the page, workflows, agents).
    const off = featuresForOp(job.op as { tool: string }, isKitTool).find((f) => !featureOn(f));
    if (off) throw new Error(`${featureDef(off)?.name ?? off} is switched off (Settings → Features)`);
    if (!job.inputs.length) throw new Error('Choose at least one file');
    for (const p of job.inputs) if (!existsSync(p)) throw new Error(`${path.basename(p)} no longer exists`);
    const op = job.op;
    // The person's standard output setting (Health → Settings → Results go to) when the tool was not given a folder.
    const outDir = outputFolder(job.inputs, job.outDir ?? standardOutput(op.tool));
    const needsDir = !['file.checksum', 'file.verify'].includes(op.tool);
    if (needsDir) await fsp.mkdir(outDir, { recursive: true });
    if (isKitTool(op.tool)) {
      const r = await this.kit.run(op as KitOp, job.inputs, outDir, (f, phase) => this.progress(f, phase));
      this.progress(1, 'Done');
      return r;
    }

    // Tools that take all inputs at once.
    const together = await this.extra.many(op, job.inputs, outDir, (f, phase) => this.progress(f, phase));
    if (together) {
      this.progress(1, 'Done');
      return together;
    }
    if (op.tool === 'pdf.merge') return { outputs: [await this.pdfMerge(job.inputs, outDir)] };
    if (op.tool === 'image.toPdf') return { outputs: [await this.imagesToPdf(job.inputs, outDir, op.pageSize)] };
    if (op.tool === 'file.checksum' || op.tool === 'file.verify') return this.checksums(job.inputs, op);
    if (op.tool === 'file.join') {
      const { parts, original } = await findParts(job.inputs[0]);
      const out = freeName(outDir, stemOf(original), path.extname(original).slice(1));
      this.progress(0.1, 'Joining parts');
      await joinParts(parts, out);
      return { outputs: [out], message: `Joined ${parts.length} parts` };
    }

    const outputs: string[] = [];
    const failed: { path: string; reason: string }[] = [];
    const details: string[] = [];
    const messages: string[] = [];
    let before = 0;
    let after = 0;
    for (let i = 0; i < job.inputs.length; i++) {
      const input = job.inputs[i];
      const base = (f: number, phase: string) => this.progress((i + f) / job.inputs.length, job.inputs.length > 1 ? `${phase} (${i + 1} of ${job.inputs.length})` : phase);
      try {
        const extra = await this.extra.one(op, input, outDir, base);
        if (extra?.details) details.push(extra.details);
        if (extra?.message) messages.push(extra.message);
        const made = extra ? extra.outputs : await this.one(op, input, outDir, base);
        outputs.push(...made);
        before += (await fsp.stat(input)).size;
        for (const m of made) after += (await fsp.stat(m).catch(() => ({ size: 0 }))).size;
      } catch (e) {
        failed.push({ path: input, reason: e instanceof Error ? e.message : String(e) });
      }
    }
    this.progress(1, 'Done');
    if (!outputs.length && !details.length && failed.length) throw new Error(failed[0].reason);
    const shrink = /compress|preset|strip|resize/.test(op.tool) && before > after ? `Saved ${formatBytes(before - after)} (${Math.round((1 - after / before) * 100)}% smaller)` : undefined;
    return { outputs, failed: failed.length ? failed : undefined, message: shrink ?? (messages.length === 1 ? messages[0] : messages.length ? messages.join(' · ') : undefined), details: details.length ? details.join('\n\n') : undefined };
  }

  private async one(op: ConvertOp, input: string, outDir: string, progress: (f: number, phase: string) => void): Promise<string[]> {
    const stem = stemOf(input);
    const out = (ext: string, suffix = '') => freeName(outDir, stem + suffix, ext);
    switch (op.tool) {
      // ---------------------------------------------------------- video & audio
      case 'video.compress':
        return [await this.compressVideo(input, out('mp4'), op.targetMb * 1024 * 1024, progress)];
      case 'video.preset': {
        const p = PRESETS[op.preset];
        if (p.targetMb) return [await this.compressVideo(input, out('mp4', ` ${op.preset}`), p.targetMb * 1024 * 1024, progress)];
        const o = out('mp4', ` ${op.preset}`);
        await this.ffmpeg(input, ['-vf', `scale=-2:'min(${p.height},ih)'`, '-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart'], o, progress);
        return [o];
      }
      case 'video.convert': {
        const o = out(op.format);
        const scale = op.width ? `scale=${op.width}:-2` : '';
        if (op.format === 'gif') {
          const fps = op.fps ?? 12;
          const w = op.width ?? 480;
          await this.ffmpeg(input, ['-filter_complex', `fps=${fps},scale=${w}:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`, '-loop', '0'], o, progress);
        } else if (op.format === 'webm') {
          await this.ffmpeg(input, [...(scale ? ['-vf', scale] : []), '-c:v', 'libvpx-vp9', '-crf', '33', '-b:v', '0', '-row-mt', '1', '-c:a', 'libopus', '-b:a', '128k'], o, progress);
        } else {
          await this.ffmpeg(input, [...(scale ? ['-vf', scale] : []), ...(op.fps ? ['-r', String(op.fps)] : []), '-c:v', 'libx264', '-crf', '21', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', ...(op.format === 'mp4' ? ['-movflags', '+faststart'] : [])], o, progress);
        }
        return [o];
      }
      case 'video.trim': {
        if (!(op.end > op.start)) throw new Error('The end must be after the start');
        const isVideo = VIDEO_EXT.test(input);
        const o = out(isVideo ? 'mp4' : path.extname(input).slice(1) || 'm4a', ' trimmed');
        const codec = op.lossless ? ['-c', 'copy', '-avoid_negative_ts', 'make_zero', ...(isVideo ? ['-movflags', '+faststart'] : [])] : isVideo ? ['-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart'] : [];
        await this.ffmpeg(input, ['-t', String(op.end - op.start), ...codec], o, progress, ['-ss', String(op.start)], op.end - op.start);
        return [o];
      }
      case 'video.audio': {
        const o = out(op.format);
        await this.ffmpeg(input, ['-vn', ...(op.format === 'mp3' ? ['-c:a', 'libmp3lame', '-q:a', '2'] : ['-c:a', 'aac', '-b:a', '192k'])], o, progress);
        return [o];
      }
      case 'video.mute': {
        const o = out(path.extname(input).slice(1) || 'mp4', ' silent');
        await this.ffmpeg(input, ['-c:v', 'copy', '-an'], o, progress);
        return [o];
      }
      case 'video.rotate': {
        const o = out('mp4', ' rotated');
        const vf = op.degrees === 90 ? 'transpose=1' : op.degrees === 270 ? 'transpose=2' : 'transpose=1,transpose=1';
        await this.ffmpeg(input, ['-vf', vf, '-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-metadata:s:v', 'rotate=0'], o, progress);
        return [o];
      }
      case 'video.speed': {
        if (!(op.factor > 0.1 && op.factor <= 16)) throw new Error('Choose a speed between 0.1× and 16×');
        const o = out('mp4', ` ${op.factor}x`);
        const hasAudio = await this.hasAudio(input);
        await this.ffmpeg(input, ['-filter:v', `setpts=PTS/${op.factor}`, ...(hasAudio ? ['-filter:a', atempoChain(op.factor)] : ['-an']), '-c:v', 'libx264', '-crf', '21', '-preset', 'medium', '-pix_fmt', 'yuv420p'], o, progress, [], undefined, op.factor);
        return [o];
      }
      case 'video.frames': {
        const dir = freeName(outDir, `${stem} frames`, '');
        await fsp.mkdir(dir, { recursive: true });
        await this.ffmpeg(input, ['-vf', `fps=${op.fps}`, ...(op.format === 'jpg' ? ['-q:v', '2'] : [])], path.join(dir, `frame_%05d.${op.format}`), progress);
        return (await fsp.readdir(dir)).sort().map((n) => path.join(dir, n));
      }
      case 'audio.convert': {
        const codecs: Record<string, string[]> = {
          mp3: ['-c:a', 'libmp3lame', '-q:a', '2'],
          m4a: ['-c:a', 'aac', '-b:a', '192k'],
          wav: ['-c:a', 'pcm_s16le'],
          flac: ['-c:a', 'flac'],
          ogg: ['-c:a', 'libvorbis', '-q:a', '5'],
          aiff: ['-c:a', 'pcm_s16be'],
        };
        const o = out(op.format);
        await this.ffmpeg(input, ['-vn', ...codecs[op.format]], o, progress);
        return [o];
      }
      case 'audio.normalize': {
        const ext = path.extname(input).slice(1).toLowerCase() || 'm4a';
        const o = out(ext, ' even');
        const codec = ext === 'mp3' ? ['-c:a', 'libmp3lame', '-q:a', '2'] : ext === 'wav' ? ['-c:a', 'pcm_s16le'] : ext === 'flac' ? ['-c:a', 'flac'] : ext === 'ogg' ? ['-c:a', 'libvorbis', '-q:a', '5'] : ['-c:a', 'aac', '-b:a', '192k'];
        await this.ffmpeg(input, ['-vn', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', ...codec], o, progress);
        return [o];
      }

      // ---------------------------------------------------------- images
      case 'image.convert': {
        const fmt = op.format;
        const o = out(fmt);
        if (fmt === 'heic') {
          if (process.platform !== 'darwin') throw new Error('Saving HEIC needs a Mac (Windows and Linux can read HEIC but not write it)');
          progress(0.3, 'Converting');
          const r = await run('/usr/bin/sips', ['-s', 'format', 'heic', '-s', 'formatOptions', String(op.quality ?? 85), input, '--out', o]);
          if (r.code !== 0) throw new Error(r.stderr.trim() || 'Could not save as HEIC');
          return [o];
        }
        progress(0.2, 'Converting');
        const img = await this.image(input);
        const q = op.quality ?? 85;
        const piped = fmt === 'jpg' ? img.flatten({ background: '#ffffff' }).jpeg({ quality: q, mozjpeg: true }) : fmt === 'png' ? img.png({ compressionLevel: 9 }) : fmt === 'webp' ? img.webp({ quality: q }) : fmt === 'avif' ? img.avif({ quality: Math.max(30, q - 25) }) : fmt === 'tiff' ? img.tiff({ compression: 'lzw' }) : img.gif();
        await piped.toFile(o);
        return [o];
      }
      case 'image.resize': {
        const img = await this.image(input);
        const meta = await img.metadata();
        const w = meta.width ?? 0;
        const h = meta.height ?? 0;
        const o = out(this.keepExt(input), ' resized');
        progress(0.3, 'Resizing');
        const resized = op.width && op.height
          ? img.resize({ width: op.width, height: op.height, fit: 'fill' })
          : op.percent
          ? img.resize({ width: Math.max(1, Math.round((w * op.percent) / 100)) })
          : img.resize({ width: op.maxSide ?? 1600, height: op.maxSide ?? 1600, fit: 'inside', withoutEnlargement: true });
        await this.encodeLike(resized, o).toFile(o);
        void h;
        return [o];
      }
      case 'image.compress': {
        const ext = this.keepExt(input);
        const o = out(ext === 'png' ? 'png' : ext === 'webp' ? 'webp' : 'jpg', ' small');
        progress(0.3, 'Compressing');
        const img = await this.image(input);
        const enc = o.endsWith('.png') ? img.png({ palette: op.quality < 90, quality: op.quality, compressionLevel: 9, effort: 8 }) : o.endsWith('.webp') ? img.webp({ quality: op.quality }) : img.flatten({ background: '#ffffff' }).jpeg({ quality: op.quality, mozjpeg: true });
        await enc.toFile(o);
        return [o];
      }
      case 'image.strip': {
        // sharp drops EXIF, GPS, XMP and IPTC unless asked to keep them; keep the orientation baked in.
        const o = out(this.keepExt(input), ' clean');
        progress(0.3, 'Removing details');
        await this.encodeLike(await this.image(input), o).toFile(o);
        return [o];
      }
      case 'image.rotate': {
        const o = out(this.keepExt(input), ' rotated');
        await this.encodeLike((await this.image(input)).rotate(op.degrees), o).toFile(o);
        return [o];
      }
      case 'image.watermark': {
        if (!op.text.trim()) throw new Error('Type the watermark text');
        const img = await this.image(input);
        const buf = await img.toBuffer();
        const meta = await this.sharp()(buf).metadata();
        const w = meta.width ?? 1000;
        const h = meta.height ?? 1000;
        const size = Math.max(14, Math.round(Math.min(w, h) / 22));
        const svg = watermarkSvg(op.text, w, h, size, op.position, op.opacity);
        const o = out(this.keepExt(input), ' watermarked');
        await this.encodeLike(this.sharp()(buf).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]), o).toFile(o);
        return [o];
      }
      case 'image.removeBg': {
        const o = await this.removeBackground(input, out('png', ' cut out'), progress);
        if (!op.background) return [o];
        // On a colour instead of transparent (white for shops and passports).
        const flat = out('jpg', ' on colour');
        await this.sharp()(o).flatten({ background: op.background }).jpeg({ quality: 92 }).toFile(flat);
        await fsp.rm(o, { force: true });
        return [flat];
      }

      // ---------------------------------------------------------- PDF
      case 'pdf.split': {
        const src = await this.loadPdf(input);
        const groups = parseSplitGroups(op.ranges, src.getPageCount());
        const made: string[] = [];
        for (let g = 0; g < groups.length; g++) {
          progress(g / groups.length, 'Splitting');
          const doc = await PDFDocument.create();
          for (const p of await doc.copyPages(src, groups[g])) doc.addPage(p);
          const first = groups[g][0] + 1;
          const last = groups[g][groups[g].length - 1] + 1;
          const o = out('pdf', first === last ? ` page ${first}` : ` pages ${first}-${last}`);
          await fsp.writeFile(o, await doc.save());
          made.push(o);
        }
        return made;
      }
      case 'pdf.extract':
      case 'pdf.reorder':
      case 'pdf.delete': {
        const src = await this.loadPdf(input);
        const n = src.getPageCount();
        let pages: number[];
        if (op.tool === 'pdf.delete') {
          const drop = new Set(parsePageRanges(op.pages, n));
          pages = Array.from({ length: n }, (_, i) => i).filter((i) => !drop.has(i));
          if (!pages.length) throw new Error('That would delete every page');
        } else pages = parsePageRanges(op.tool === 'pdf.extract' ? op.pages : op.order, n);
        const doc = await PDFDocument.create();
        for (const p of await doc.copyPages(src, pages)) doc.addPage(p);
        const o = out('pdf', op.tool === 'pdf.extract' ? ' extract' : op.tool === 'pdf.reorder' ? ' reordered' : ' trimmed');
        await fsp.writeFile(o, await doc.save());
        return [o];
      }
      case 'pdf.rotate': {
        const doc = await this.loadPdf(input);
        const pages = doc.getPages();
        const which = op.pages ? new Set(parsePageRanges(op.pages, pages.length)) : null;
        pages.forEach((p, i) => {
          if (!which || which.has(i)) p.setRotation(degrees((p.getRotation().angle + op.degrees) % 360));
        });
        const o = out('pdf', ' rotated');
        await fsp.writeFile(o, await doc.save());
        return [o];
      }
      case 'pdf.number': {
        const doc = await this.loadPdf(input);
        const font = await doc.embedFont(StandardFonts.Helvetica);
        const start = op.start ?? 1;
        doc.getPages().forEach((p, i) => {
          const label = String(start + i);
          const size = 10;
          const tw = font.widthOfTextAtSize(label, size);
          const { width, height } = p.getSize();
          const { x, y } = cornerXY(op.position, width, height, tw, size, 28);
          p.drawText(label, { x, y, size, font, color: rgb(0.25, 0.25, 0.25) });
        });
        const o = out('pdf', ' numbered');
        await fsp.writeFile(o, await doc.save());
        return [o];
      }
      case 'pdf.watermark': {
        if (!op.text.trim()) throw new Error('Type the watermark text');
        const doc = await this.loadPdf(input);
        const font = await doc.embedFont(StandardFonts.HelveticaBold);
        for (const p of doc.getPages()) {
          const { width, height } = p.getSize();
          const size = Math.min(width, height) / Math.max(6, op.text.length * 0.6);
          const tw = font.widthOfTextAtSize(op.text, size);
          // Centred and turned 45°: start so that the middle of the text lands in the middle of the page.
          const c = Math.SQRT1_2;
          p.drawText(op.text, { x: width / 2 - (tw / 2) * c + (size / 2) * c, y: height / 2 - (tw / 2) * c - (size / 2) * c, size, font, rotate: degrees(45), color: rgb(0.5, 0.5, 0.5), opacity: op.opacity });
        }
        const o = out('pdf', ' watermarked');
        await fsp.writeFile(o, await doc.save());
        return [o];
      }
      case 'pdf.compress':
        return [await this.compressPdf(input, out('pdf', ' small'), op.quality, op.maxSide, progress)];
      case 'pdf.encrypt':
      case 'pdf.decrypt': {
        if (!op.password) throw new Error('Type the password');
        const o = out('pdf', op.tool === 'pdf.encrypt' ? ' locked' : ' unlocked');
        progress(0.2, op.tool === 'pdf.encrypt' ? 'Locking' : 'Unlocking');
        const bytes = await fsp.readFile(input);
        try {
          const result = op.tool === 'pdf.encrypt' ? await encryptPdf(bytes, op.password, ownerOf(op), { print: op.allowPrint, copy: op.allowCopy, edit: op.allowEdit }) : await decryptPdf(bytes, op.password);
          await fsp.writeFile(o, result);
          return [o];
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          // Files with packed, encrypted object streams need the outside tool.
          if (msg !== 'PACKED' && !/could not|parse|invalid/i.test(msg)) throw e;
          const qpdf = await which('qpdf');
          if (!qpdf) throw new Error('This PDF stores its pages in a packed form Keeper cannot unlock by itself. Install the free “qpdf” tool and try again.');
          const args = op.tool === 'pdf.encrypt'
            ? ['--encrypt', op.password, ownerOf(op), '256', ...(op.allowPrint === false ? ['--print=none'] : []), ...(op.allowCopy === false ? ['--extract=n'] : []), ...(op.allowEdit === false ? ['--modify=none', '--annotate=n', '--form=n', '--assemble=n'] : []), '--', input, o]
            : [`--password=${op.password}`, '--decrypt', input, o];
          const r = await run(qpdf, args);
          if (r.code !== 0 && r.code !== 3) throw new Error(/invalid password/i.test(r.stderr) ? 'Wrong password' : r.stderr.trim().split('\n').pop() || 'Could not process the file');
          return [o];
        }
      }
      case 'pdf.toImages':
        return this.pdfToImages(input, outDir, op.format, op.dpi, progress);

      // ---------------------------------------------------------- any file
      case 'file.encrypt': {
        const o = freeName(outDir, path.basename(input), ENC_EXT);
        progress(0.1, 'Encrypting');
        await encryptFile(input, o, op.password);
        return [o];
      }
      case 'file.decrypt': {
        if (!(await isEncryptedFile(input))) throw new Error(`${path.basename(input)} is not a file locked by Keeper`);
        const name = path.basename(input).replace(new RegExp(`\\.${ENC_EXT}$`), '');
        const o = freeName(outDir, stemOf(name), path.extname(name).slice(1));
        progress(0.1, 'Decrypting');
        await decryptFile(input, o, op.password);
        return [o];
      }
      case 'file.split': {
        if (!(op.sizeMb > 0)) throw new Error('Choose a part size');
        progress(0.1, 'Splitting');
        return splitFile(input, outDir, Math.floor(op.sizeMb * 1024 * 1024));
      }
      default:
        throw new Error('This tool works on several files at once');
    }
  }

  // ---------------------------------------------------------------- ffmpeg

  private ffmpegBin(): string {
    const p = ffmpegPath();
    if (!p) throw new Error('The video engine is missing from this copy of Keeper');
    return p;
  }

  async probeDuration(input: string): Promise<number | undefined> {
    const r = await run(this.ffmpegBin(), ['-hide_banner', '-i', input]);
    return parseDuration(r.stderr);
  }

  private async hasAudio(input: string): Promise<boolean> {
    const r = await run(this.ffmpegBin(), ['-hide_banner', '-i', input]);
    return /Stream #\d+:\d+.*: Audio:/.test(r.stderr);
  }

  /** Runs ffmpeg, writes to a temporary name and renames on success, so failed jobs leave nothing behind. */
  private async ffmpeg(input: string, args: string[], output: string, progress: (f: number, phase: string) => void, preInput: string[] = [], durationOverride?: number, speed = 1, phase = 'Converting', range: [number, number] = [0, 1]): Promise<void> {
    const duration = durationOverride ?? (await this.probeDuration(input)) ?? 0;
    const ext = path.extname(output);
    // Frame patterns and the null sink (first pass) are written directly.
    const isPattern = output.includes('%0') || output === '/dev/null' || output === 'NUL';
    const tmp = isPattern ? output : output.slice(0, output.length - ext.length) + `.partial${ext}`;
    const r = await run(this.ffmpegBin(), ['-hide_banner', '-y', '-nostdin', ...preInput, '-i', input, ...args, '-progress', 'pipe:1', '-nostats', tmp], (line) => {
      const t = parseFfmpegTime(line);
      if (t !== undefined && duration > 0) progress(range[0] + (range[1] - range[0]) * Math.min(1, (t * speed) / duration), phase);
    });
    if (r.code !== 0) {
      if (!isPattern) await fsp.rm(tmp, { force: true });
      throw new Error(ffmpegError(r.stderr));
    }
    if (!isPattern) await fsp.rename(tmp, output);
  }

  /** Two passes at a computed bitrate so the file lands just under the target size. */
  private async compressVideo(input: string, output: string, targetBytes: number, progress: (f: number, phase: string) => void): Promise<string> {
    const duration = await this.probeDuration(input);
    if (!duration) throw new Error('Could not read how long this video is');
    const { size } = await fsp.stat(input);
    if (size <= targetBytes) throw new Error(`Already smaller than ${formatBytes(targetBytes)}`);
    const audio = audioBitrateFor(targetBytes, duration);
    const hasAudio = await this.hasAudio(input);
    const video = videoBitrate(targetBytes, duration, hasAudio ? audio : 0);
    // Very low bitrates look better at a smaller size.
    const height = video < 400 ? 480 : video < 900 ? 720 : video < 2500 ? 1080 : 0;
    const vf = height ? ['-vf', `scale=-2:'min(${height},ih)'`] : [];
    const passlog = path.join(os.tmpdir(), `keeper-pass-${process.pid}-${Date.now()}`);
    const common = [...vf, '-c:v', 'libx264', '-preset', 'medium', '-b:v', `${video}k`, '-maxrate', `${Math.round(video * 1.3)}k`, '-bufsize', `${video * 2}k`, '-pix_fmt', 'yuv420p', '-passlogfile', passlog];
    try {
      await this.ffmpeg(input, [...common, '-pass', '1', '-an', '-f', 'null'], process.platform === 'win32' ? 'NUL' : '/dev/null', progress, [], duration, 1, 'Analysing', [0, 0.45]);
      await this.ffmpeg(input, [...common, '-pass', '2', ...(hasAudio ? ['-c:a', 'aac', '-b:a', `${audio}k`] : ['-an']), '-movflags', '+faststart'], output, progress, [], duration, 1, 'Compressing', [0.45, 1]);
    } finally {
      for (const suffix of ['-0.log', '-0.log.mbtree']) await fsp.rm(passlog + suffix, { force: true });
    }
    return output;
  }

  // ---------------------------------------------------------------- images

  private keepExt(input: string): string {
    const e = path.extname(input).slice(1).toLowerCase();
    if (['jpg', 'jpeg'].includes(e)) return 'jpg';
    if (['png', 'webp', 'avif', 'tiff', 'gif'].includes(e)) return e;
    return 'jpg'; // HEIC, RAW, BMP… become JPEG
  }

  private encodeLike(img: import('sharp').Sharp, output: string): import('sharp').Sharp {
    const e = path.extname(output).slice(1).toLowerCase();
    if (e === 'png') return img.png({ compressionLevel: 9 });
    if (e === 'webp') return img.webp({ quality: 88 });
    if (e === 'avif') return img.avif({ quality: 60 });
    if (e === 'tiff') return img.tiff({ compression: 'lzw' });
    if (e === 'gif') return img.gif();
    return img.flatten({ background: '#ffffff' }).jpeg({ quality: 88, mozjpeg: true });
  }

  /** Opens any picture: sharp first, then the OS (sips on macOS, the hook elsewhere) for HEIC. Orientation is applied. */
  async image(input: string): Promise<import('sharp').Sharp> {
    const sharp = this.sharp();
    try {
      const s = sharp(input, { failOn: 'none', animated: false });
      await s.metadata().then((m) => {
        if (!m.width) throw new Error('unreadable');
      });
      // A clone of the pipeline with auto-rotation; metadata reading above does not consume it.
      return sharp(input, { failOn: 'none' }).rotate();
    } catch {
      if (process.platform === 'darwin') {
        const tmp = path.join(os.tmpdir(), `keeper-${process.pid}-${Date.now()}.png`);
        const r = await run('/usr/bin/sips', ['-s', 'format', 'png', input, '--out', tmp]);
        if (r.code === 0 && existsSync(tmp)) {
          const buf = await fsp.readFile(tmp);
          await fsp.rm(tmp, { force: true });
          return sharp(buf).rotate();
        }
      }
      const png = await this.opts.hooks?.decodeImage?.(input);
      if (png) return sharp(png);
      throw new Error(`${path.basename(input)} is in a format this computer cannot open`);
    }
  }

  private async imagesToPdf(inputs: string[], outDir: string, pageSize: 'fit' | 'a4' | 'letter'): Promise<string> {
    const doc = await PDFDocument.create();
    const sizes = { a4: [595.28, 841.89], letter: [612, 792] } as const;
    for (let i = 0; i < inputs.length; i++) {
      this.progress(i / inputs.length, 'Adding pictures');
      const img = await this.image(inputs[i]);
      const jpg = await img.flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).toBuffer();
      const emb = await doc.embedJpg(jpg);
      if (pageSize === 'fit') {
        const page = doc.addPage([emb.width * 0.75, emb.height * 0.75]);
        page.drawImage(emb, { x: 0, y: 0, width: emb.width * 0.75, height: emb.height * 0.75 });
      } else {
        const landscape = emb.width > emb.height;
        const [pw, ph] = landscape ? [sizes[pageSize][1], sizes[pageSize][0]] : sizes[pageSize];
        const page = doc.addPage([pw, ph]);
        const margin = 24;
        const scale = Math.min((pw - margin * 2) / emb.width, (ph - margin * 2) / emb.height);
        page.drawImage(emb, { x: (pw - emb.width * scale) / 2, y: (ph - emb.height * scale) / 2, width: emb.width * scale, height: emb.height * scale });
      }
    }
    const o = freeName(outDir, inputs.length === 1 ? stemOf(inputs[0]) : `${stemOf(inputs[0])} and ${inputs.length - 1} more`, 'pdf');
    await fsp.writeFile(o, await doc.save());
    return o;
  }

  // ---------------------------------------------------------------- background removal

  private session: Promise<{ run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array; dims: readonly number[] }>>; inputNames: readonly string[] }> | null = null;

  private async model(): Promise<NonNullable<Converter['session']>> {
    if (this.session) return this.session;
    this.session = (async () => {
      const ort = onnxRuntime('Background removal');
      await fsp.mkdir(this.opts.modelsDir, { recursive: true });
      const file = path.join(this.opts.modelsDir, 'u2netp.onnx');
      if (!existsSync(file)) {
        this.progress(0.05, 'Downloading the cut-out model (5 MB, once)');
        const res = await fetch('https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx');
        if (!res.ok) throw new Error(`Could not download the cut-out model (${res.status})`);
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length < 1_000_000) throw new Error('The cut-out model download was incomplete');
        // Pinned: the same file rembg publishes (its MD5 8e83ca70… matches), so nothing else is ever loaded.
        if (createHash('sha256').update(buf).digest('hex') !== U2NETP_SHA256) throw new Error('The cut-out model did not match its published fingerprint, so Keeper did not use it');
        await fsp.writeFile(file + '.partial', buf);
        await fsp.rename(file + '.partial', file);
      }
      return ort.InferenceSession.create(file) as unknown as ReturnType<Converter['model']>;
    })();
    this.session.catch(() => (this.session = null));
    return this.session;
  }

  /**
   * The subject's mask for a picture (raw, one channel, the picture's own size): 255 where the
   * subject is. Used by background removal here and by the photo editor.
   */
  async cutoutMask(base: Buffer, progress: (f: number, phase: string) => void = () => undefined): Promise<{ alpha: Buffer; width: number; height: number }> {
    const sharp = this.sharp();
    const session = await this.model();
    const ort = onnxRuntime('Background removal');
    progress(0.3, 'Finding the subject');
    const meta = await sharp(base).metadata();
    const W = meta.width!;
    const H = meta.height!;
    const S = 320;
    const { data } = await sharp(base).resize(S, S, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const mean = [0.485, 0.456, 0.406];
    const std = [0.229, 0.224, 0.225];
    let max = 1;
    for (let i = 0; i < data.length; i++) max = Math.max(max, data[i]);
    const chw = new Float32Array(3 * S * S);
    for (let i = 0; i < S * S; i++) for (let c = 0; c < 3; c++) chw[c * S * S + i] = (data[i * 3 + c] / max - mean[c]) / std[c];
    const out = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', chw, [1, 3, S, S]) });
    const first = Object.values(out)[0];
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of first.data) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    const mask = Buffer.alloc(S * S);
    for (let i = 0; i < S * S; i++) mask[i] = Math.round(((first.data[i] - lo) / (hi - lo || 1)) * 255);
    progress(0.8, 'Cutting out');
    // extractChannel keeps the mask single-channel; resizing and blurring would otherwise make it RGB.
    const alpha = await sharp(mask, { raw: { width: S, height: S, channels: 1 } }).resize(W, H, { fit: 'fill' }).blur(0.6).extractChannel(0).raw().toBuffer();
    return { alpha, width: W, height: H };
  }

  /** sharp, for the photo editor (loaded once, with the converter). */
  sharpLib(): Sharp {
    return this.sharp();
  }

  private async removeBackground(input: string, output: string, progress: (f: number, phase: string) => void): Promise<string> {
    const sharp = this.sharp();
    const base = await (await this.image(input)).removeAlpha().toBuffer();
    const { alpha, width: W, height: H } = await this.cutoutMask(base, progress);
    await sharp(base).joinChannel(alpha, { raw: { width: W, height: H, channels: 1 } }).png().toFile(output);
    return output;
  }

  // ---------------------------------------------------------------- PDF helpers

  private async loadPdf(input: string): Promise<PDFDocument> {
    try {
      return await PDFDocument.load(await fsp.readFile(input), { updateMetadata: false });
    } catch (e) {
      if (/encrypt/i.test(String(e))) throw new Error(`${path.basename(input)} is password-protected; remove the password first`);
      throw new Error(`${path.basename(input)} could not be read as a PDF`);
    }
  }

  private async pdfMerge(inputs: string[], outDir: string): Promise<string> {
    const doc = await PDFDocument.create();
    for (let i = 0; i < inputs.length; i++) {
      this.progress(i / inputs.length, 'Merging');
      const src = await this.loadPdf(inputs[i]);
      for (const p of await doc.copyPages(src, src.getPageIndices())) doc.addPage(p);
    }
    const o = freeName(outDir, inputs.length === 1 ? stemOf(inputs[0]) : `${stemOf(inputs[0])} merged`, 'pdf');
    await fsp.writeFile(o, await doc.save());
    this.progress(1, 'Done');
    return o;
  }

  /** Re-saves embedded JPEG photos smaller and packs the file with object streams. */
  private async compressPdf(input: string, output: string, quality: number, maxSide: number, progress: (f: number, phase: string) => void): Promise<string> {
    const doc = await this.loadPdf(input);
    const sharp = this.sharp();
    const objects = doc.context.enumerateIndirectObjects();
    let done = 0;
    for (const [ref, obj] of objects) {
      done++;
      if (!(obj instanceof PDFRawStream)) continue;
      const dict = obj.dict;
      if (dict.get(PDFName.of('Subtype')) !== PDFName.of('Image')) continue;
      if (dict.get(PDFName.of('Filter')) !== PDFName.of('DCTDecode')) continue;
      const cs = dict.get(PDFName.of('ColorSpace'));
      if (cs !== PDFName.of('DeviceRGB') && cs !== PDFName.of('DeviceGray')) continue;
      if (dict.get(PDFName.of('SMask')) || dict.get(PDFName.of('Decode'))) continue;
      progress(done / objects.length, 'Shrinking pictures');
      try {
        const bytes = Buffer.from(obj.contents);
        const out = await sharp(bytes).resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true }).jpeg({ quality, mozjpeg: true }).toBuffer({ resolveWithObject: true });
        if (out.data.length >= bytes.length * 0.95) continue;
        dict.set(PDFName.of('Width'), doc.context.obj(out.info.width));
        dict.set(PDFName.of('Height'), doc.context.obj(out.info.height));
        dict.set(PDFName.of('BitsPerComponent'), doc.context.obj(8));
        dict.set(PDFName.of('ColorSpace'), out.info.channels === 1 ? PDFName.of('DeviceGray') : PDFName.of('DeviceRGB'));
        dict.delete(PDFName.of('DecodeParms'));
        doc.context.assign(ref, PDFRawStream.of(dict, new Uint8Array(out.data)));
      } catch {
        /* leave this picture as it was */
      }
    }
    const bytes = await doc.save({ useObjectStreams: true });
    const { size } = await fsp.stat(input);
    if (bytes.length >= size) throw new Error('This PDF is already as small as Keeper can make it');
    await fsp.writeFile(output, bytes);
    return output;
  }

  private async pdfToImages(input: string, outDir: string, format: 'png' | 'jpg', dpi: number, progress: (f: number, phase: string) => void): Promise<string[]> {
    const dir = freeName(outDir, `${stemOf(input)} pages`, '');
    await fsp.mkdir(dir, { recursive: true });
    progress(0.1, 'Drawing pages');
    // The app draws pages itself; without it (command line), poppler's pdftoppm is used if installed.
    if (this.opts.hooks?.renderPdf) {
      const pngs = await this.opts.hooks.renderPdf(input, dpi / 72);
      for (let i = 0; i < pngs.length; i++) {
        progress(i / pngs.length, 'Saving pages');
        const name = path.join(dir, `page-${String(i + 1).padStart(String(pngs.length).length, '0')}.${format}`);
        if (format === 'png') await fsp.writeFile(name, pngs[i]);
        else await this.sharp()(pngs[i]).flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).toFile(name);
      }
    } else {
      const pdftoppm = await which('pdftoppm');
      if (!pdftoppm) throw new Error('Drawing PDF pages is not available here');
      const r = await run(pdftoppm, [format === 'png' ? '-png' : '-jpeg', '-r', String(dpi), input, path.join(dir, 'page')]);
      if (r.code !== 0) throw new Error(r.stderr.trim() || 'Could not draw the pages');
    }
    return (await fsp.readdir(dir)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map((n) => path.join(dir, n));
  }

  // ---------------------------------------------------------------- checksums

  private async checksums(inputs: string[], op: Extract<ConvertOp, { tool: 'file.checksum' | 'file.verify' }>): Promise<ConvertResult> {
    const algo: HashAlgo = op.tool === 'file.verify' ? (algoForLength(op.expected) ?? op.algo) : op.algo;
    const checksums: ConvertResult['checksums'] = [];
    for (let i = 0; i < inputs.length; i++) {
      this.progress(i / inputs.length, 'Reading');
      checksums.push({ path: inputs[i], algo, hash: await checksum(inputs[i], algo) });
    }
    this.progress(1, 'Done');
    if (op.tool === 'file.verify') {
      const ok = checksums.some((c) => sameChecksum(op.expected, c.hash));
      return { outputs: [], checksums, verified: ok, message: ok ? 'The checksum matches — the file is intact.' : 'The checksum does not match. The file may be damaged or not the one you expected.' };
    }
    return { outputs: [], checksums };
  }
}

function ffmpegError(stderr: string): string {
  const lines = stderr.trim().split('\n').map((l) => l.trim()).filter(Boolean);
  const meaningful = lines.reverse().find((l) => /error|invalid|no such|not found|unsupported|could not|failed/i.test(l) && !/^frame=/.test(l));
  if (/Invalid data found when processing input/i.test(stderr)) return 'This file is not a video or audio file Keeper can read';
  if (/does not contain any stream|Output file .* does not contain/i.test(stderr)) return 'This file has no audio or video to work with';
  return meaningful ?? 'The video engine could not process this file';
}

function cornerXY(pos: Corner, w: number, h: number, tw: number, size: number, margin: number): { x: number; y: number } {
  switch (pos) {
    case 'top-left': return { x: margin, y: h - margin - size };
    case 'top-right': return { x: w - margin - tw, y: h - margin - size };
    case 'bottom-left': return { x: margin, y: margin };
    case 'bottom-right': return { x: w - margin - tw, y: margin };
    case 'center': return { x: (w - tw) / 2, y: (h - size) / 2 };
    default: return { x: (w - tw) / 2, y: margin };
  }
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);
}

function watermarkSvg(text: string, w: number, h: number, size: number, pos: Corner, opacity: number): string {
  const m = Math.round(size * 0.9);
  const anchor = pos.endsWith('right') ? 'end' : pos.endsWith('left') ? 'start' : 'middle';
  const x = anchor === 'end' ? w - m : anchor === 'start' ? m : w / 2;
  const y = pos.startsWith('top') ? m + size : pos === 'center' ? h / 2 + size / 3 : h - m;
  const t = escapeXml(text);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><style>.t{font:600 ${size}px sans-serif}</style><text x="${x}" y="${y}" text-anchor="${anchor}" class="t" fill="#000" fill-opacity="${opacity * 0.35}" transform="translate(1.5,1.5)">${t}</text><text x="${x}" y="${y}" text-anchor="${anchor}" class="t" fill="#fff" fill-opacity="${opacity}">${t}</text></svg>`;
}

/**
 * The owner password: the one given, or, when printing, copying or changes
 * are limited, a long random one nobody knows (so the limits cannot be lifted
 * by typing the open password).
 */
function ownerOf(op: { password: string; ownerPassword?: string; allowPrint?: boolean; allowCopy?: boolean; allowEdit?: boolean }): string {
  if (op.ownerPassword) return op.ownerPassword;
  const limited = op.allowPrint === false || op.allowCopy === false || op.allowEdit === false;
  return limited ? randomBytes(24).toString('base64url') : op.password;
}
