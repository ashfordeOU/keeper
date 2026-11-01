// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The file kit's tools: PDF arranging, marking, structure, cleaning, repair,
// output, and "Convert to…" for every format (filekit-convert.ts). Pure work
// lives in core/filekit; outside programs (qpdf, Ghostscript, poppler,
// pandoc, Calibre, LibreOffice, Graphviz) are found on demand and only when
// a tool needs them, so nothing here costs anything while idle.

import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument, PDFName, rgb, StandardFonts } from 'pdf-lib';
import { freeName, loadPdfJs, stemOf } from '../../core/convert';
import type { ConvertOp, ConvertResult } from '../../core/convert-types';
import * as K from '../../core/filekit/pdfkit';
import { blocksToMarkdown, chunkForAi, diffHtml, diffSummary, diffWords, findTables, linesToText, toBlocks, toCsv, toLines, type Piece } from '../../core/filekit/textlayout';
import { kitArgs, type KitArgs, type KitOp, type KitTool } from '../../core/filekit/tools';
import { zip } from '../../core/zipwrite';
import { exec, findTool, type Extra, type ExtraHooks } from './convert-extra';
import { makeSearchable, textItems, type RenderPages } from './pdf-tools';
import { convertTo, subShift, mboxSplit, vcardFromTable, qrMake, qrRead } from './filekit-convert';
import { signPdfWithCertificate, verifyPdfSignatures } from './filekit-sign';

type Sharp = typeof import('sharp').default;
export type Progress = (f: number, phase: string) => void;

export interface KitContext {
  extra: Extra;
  sharp: () => Sharp;
  ffmpeg: string | null;
  hooks: ExtraHooks & { decodeImage?: (file: string) => Promise<Buffer | null> };
  /** runs another Convert tool (used by "Convert to…" for video, audio, pictures and documents) */
  runOp: (op: ConvertOp, inputs: string[], outDir: string) => Promise<ConvertResult>;
  /** adds a file to Keeper's brain, when it is set up */
  toBrain?: (file: string) => Promise<string>;
}

export interface KitHelpers {
  ctx: KitContext;
  args: KitArgs;
  outDir: string;
  progress: Progress;
  out: (input: string, ext: string, suffix?: string) => string;
  tool: (names: string[]) => Promise<string | null>;
  render: (file: string, scale: number) => Promise<Buffer[]>;
  /** HTML to PDF, with the app's printer or an office suite */
  htmlToPdf: (html: string, output: string) => Promise<string>;
  tmp: () => Promise<string>;
  /** runs another file kit tool on one file */
  kit: (tool: KitTool, args: KitArgs, input: string) => Promise<ConvertResult>;
}

const str = (v: unknown, d = '') => (v === undefined || v === null ? d : String(v));
const num = (v: unknown, d: number) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));
const bool = (v: unknown) => v === true || v === 'true' || v === 1;
const read = async (p: string) => new Uint8Array(await fsp.readFile(p));
const mm = (v: number) => (v / 25.4) * 72;
const COLORS: Record<string, [number, number, number]> = { grey: [0.5, 0.5, 0.5], red: [0.8, 0.1, 0.1], blue: [0.1, 0.3, 0.8], black: [0, 0, 0] };

export class FileKit {
  constructor(private ctx: KitContext) {}

  private helpers(args: KitArgs, outDir: string, progress: Progress): KitHelpers {
    return {
      ctx: this.ctx, args, outDir, progress,
      out: (input, ext, suffix = '') => freeName(outDir, stemOf(input) + suffix, ext),
      tool: (names) => findTool(names),
      render: (file, scale) => this.render(file, scale),
      htmlToPdf: (html, output) => this.htmlToPdf(html, output),
      tmp: () => fsp.mkdtemp(path.join(os.tmpdir(), 'keeper-kit-')),
      kit: (tool, a, input) => this.one({ tool, args: a }, input, { ...this.helpers({ ...kitArgs({ tool } as never), ...a }, outDir, progress) }),
    };
  }

  /** Draws every page of a PDF as PNG, with the app's renderer or poppler. */
  async render(file: string, scale: number): Promise<Buffer[]> {
    const hook: RenderPages | undefined = this.ctx.hooks.renderPdf;
    if (hook) return hook(file, scale);
    const pdftoppm = await findTool(['pdftoppm']);
    if (!pdftoppm) throw new Error('Drawing PDF pages needs poppler (pdftoppm) when Keeper runs from the command line');
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'keeper-pages-'));
    try {
      const r = await exec(pdftoppm, ['-png', '-r', String(Math.round(72 * scale)), file, path.join(dir, 'p')]);
      if (r.code !== 0) throw new Error('Could not draw the pages');
      const names = (await fsp.readdir(dir)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      return Promise.all(names.map((n) => fsp.readFile(path.join(dir, n))));
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  }

  async htmlToPdf(html: string, output: string): Promise<string> {
    if (this.ctx.hooks.printToPdf) {
      await fsp.writeFile(output, await this.ctx.hooks.printToPdf({ html }, { pageSize: 'a4', onePage: false }));
      return output;
    }
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'keeper-html-'));
    try {
      const src = path.join(dir, `${path.basename(output, '.pdf')}.html`);
      await fsp.writeFile(src, html);
      const r = await this.ctx.extra.one({ tool: 'doc.toPdf', pageSize: 'a4', onePage: false }, src, dir, () => {});
      const made = r?.outputs[0];
      if (!made) throw new Error('Could not make a PDF here');
      await fsp.copyFile(made, output);
      return output;
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  }

  async run(op: KitOp, inputs: string[], outDir: string, progress: Progress): Promise<ConvertResult> {
    const args = kitArgs(op as never);
    const h = this.helpers(args, outDir, progress);
    // Tools that take every file at once.
    switch (op.tool) {
      case 'pdf.alternate': {
        progress(0.2, 'Mixing pages');
        const o = freeName(outDir, `${stemOf(inputs[0])} mixed`, 'pdf');
        await fsp.writeFile(o, await K.alternate(await Promise.all(inputs.map(read)), { reverseSecond: bool(args.reverseSecond) }));
        return { outputs: [o], message: `Mixed ${inputs.length} PDFs` };
      }
      case 'pdf.bates': {
        progress(0.2, 'Numbering');
        const r = await K.bates(await Promise.all(inputs.map(read)), { prefix: str(args.prefix), suffix: str(args.suffix), digits: num(args.digits, 6), start: num(args.start, 1), spot: str(args.spot, 'bottom-right') as K.Spot });
        const outputs: string[] = [];
        for (let i = 0; i < inputs.length; i++) {
          const o = freeName(outDir, `${stemOf(inputs[i])} ${r.ranges[i][0]}-${r.ranges[i][1]}`, 'pdf');
          await fsp.writeFile(o, r.files[i]);
          outputs.push(o);
        }
        return { outputs, message: `Numbered ${r.ranges[0][0]} to ${r.ranges[r.ranges.length - 1][1]}; the next number is ${K.batesLabel(r.next, { prefix: str(args.prefix), suffix: str(args.suffix), digits: num(args.digits, 6) })}`, details: inputs.map((f, i) => `${path.basename(f)}: ${r.ranges[i][0]} – ${r.ranges[i][1]}`).join('\n') };
      }
      case 'pdf.compare': return this.compare(inputs, h);
      case 'convert.mbox': return mboxSplit(inputs, h);
      default: break;
    }
    const outputs: string[] = [];
    const failed: { path: string; reason: string }[] = [];
    const details: string[] = [];
    const messages: string[] = [];
    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i];
      const part: Progress = (f, phase) => progress((i + f) / inputs.length, inputs.length > 1 ? `${phase} (${i + 1} of ${inputs.length})` : phase);
      try {
        const r = await this.one(op, input, { ...h, progress: part });
        outputs.push(...r.outputs);
        if (r.details) details.push(inputs.length > 1 ? `${path.basename(input)}\n${r.details}` : r.details);
        if (r.message) messages.push(r.message);
        if (r.failed) failed.push(...r.failed);
      } catch (e) {
        failed.push({ path: input, reason: e instanceof Error ? e.message : String(e) });
      }
    }
    if (!outputs.length && !details.length && failed.length) throw new Error(failed[0].reason);
    return { outputs, failed: failed.length ? failed : undefined, message: [...new Set(messages)].join(' · ') || undefined, details: details.length ? details.join('\n\n') : undefined };
  }

  private async one(op: KitOp, input: string, h: KitHelpers): Promise<ConvertResult> {
    const a = h.args;
    const { out, progress } = h;
    const save = async (bytes: Uint8Array, suffix: string, message?: string): Promise<ConvertResult> => {
      const o = out(input, 'pdf', suffix);
      await fsp.writeFile(o, bytes);
      return { outputs: [o], message };
    };
    const isPdf = /\.pdf$/i.test(input);
    if (op.tool.startsWith('pdf.') && op.tool !== 'pdf.forAi' && !isPdf) throw new Error('This tool works on PDFs');
    progress(0.1, 'Working');
    switch (op.tool) {
      case 'pdf.reverse': return save(await K.reverse(await read(input)), ' reversed');
      case 'pdf.divide': {
        const bytes = await read(input);
        const n = await K.pageCount(bytes);
        const mode = str(a.mode, 'every');
        const groups = K.divideGroups(n, mode === 'at' ? { at: str(a.at) } : mode === 'parts' ? { parts: num(a.n, 2) } : { every: num(a.n, 2) });
        const outputs: string[] = [];
        for (const [k, g] of groups.entries()) {
          progress(k / groups.length, 'Dividing');
          const o = out(input, 'pdf', ` part ${k + 1} (pages ${g[0] + 1}-${g[g.length - 1] + 1})`);
          await fsp.writeFile(o, await K.pickPages(bytes, g));
          outputs.push(o);
        }
        return { outputs, message: `${groups.length} parts` };
      }
      case 'pdf.blank': return this.removeBlank(input, h);
      case 'pdf.rotateAny': return save(await K.rotateAny(await read(input), num(a.angle, 15), str(a.pages)), ' rotated');
      case 'pdf.nup': return save(await K.nUp(await read(input), num(a.per, 4), { paper: str(a.paper, 'a4'), border: bool(a.border) }), ` ${num(a.per, 4)}-up`);
      case 'pdf.booklet': return save(await K.booklet(await read(input), { paper: str(a.paper, 'a4') }), ' booklet', 'Print double-sided, flipping on the short edge, then fold');
      case 'pdf.single': return save(await K.singlePage(await read(input)), ' one page');
      case 'pdf.overlay': {
        const layer = str(a.layer);
        if (!layer) throw new Error('Choose the PDF to lay on the pages');
        return save(await K.overlay(await read(input), await read(layer), { under: bool(a.under), repeat: a.repeat !== false }), bool(a.under) ? ' underlay' : ' overlay');
      }
      case 'pdf.poster': return save(await K.poster(await read(input), { across: num(a.across, 2), down: num(a.down, 2), overlap: num(a.overlap, 14) }), ' poster');
      case 'pdf.crop': {
        if (str(a.mode, 'auto') === 'manual') return save(await K.crop(await read(input), { margins: { top: mm(num(a.top, 10)), right: mm(num(a.right, 10)), bottom: mm(num(a.bottom, 10)), left: mm(num(a.left, 10)) } }), ' cropped');
        return save(await K.crop(await read(input), { boxes: await this.contentBoxes(input) }), ' cropped');
      }
      case 'pdf.paper': return save(await K.fitPaper(await read(input), str(a.paper, 'a4'), { orientation: str(a.orientation, 'auto') as 'auto' }), ` ${str(a.paper, 'a4').toUpperCase()}`);
      case 'pdf.dimensions': {
        const facts = await K.dimensions(await read(input));
        return { outputs: [], details: facts.map((f) => `Page ${f.page}: ${f.widthMm} × ${f.heightMm} mm (${f.width} × ${f.height} pt)${f.paper ? ` · ${f.paper.toUpperCase()}` : ''}${f.rotation ? ` · turned ${f.rotation}°` : ''}`).join('\n') };
      }
      case 'pdf.headerFooter': {
        const hf = (p: 'header' | 'footer'): K.HeaderFooter | undefined => {
          const v = { left: str(a[`${p}Left`]), center: str(a[`${p}Center`]), right: str(a[`${p}Right`]) };
          return v.left || v.center || v.right ? { ...v, size: num(a.size, 9), pages: str(a.pages) } : undefined;
        };
        return save(await K.headerFooter(await read(input), { header: hf('header'), footer: hf('footer'), file: path.basename(input) }), ' with header and footer');
      }
      case 'pdf.stamp': return save(await K.stamp(await read(input), { text: a.text === 'custom' ? str(a.custom) : str(a.text, 'APPROVED'), spot: str(a.spot, 'top-right') as K.Spot, pages: str(a.pages, '1'), date: bool(a.date) }), ' stamped');
      case 'pdf.markText': return save(await K.textWatermark(await read(input), { text: str(a.text, 'CONFIDENTIAL'), angle: num(a.angle, 45), opacity: num(a.opacity, 18) / 100, tile: bool(a.tile), color: COLORS[str(a.color, 'grey')], pages: str(a.pages) }), ' watermarked');
      case 'pdf.markImage': {
        let img = await read(str(a.image));
        // Anything that is not PNG or JPEG goes through the picture engine first.
        if (!(img[0] === 0x89 && img[1] === 0x50) && !(img[0] === 0xff && img[1] === 0xd8)) img = new Uint8Array(await this.ctx.sharp()(Buffer.from(img)).png().toBuffer());
        return save(await K.imageWatermark(await read(input), img, { spot: str(a.spot, 'center') as K.Spot, scale: num(a.scale, 30) / 100, opacity: num(a.opacity, 30) / 100, pages: str(a.pages) }), ' with picture');
      }
      case 'pdf.replaceText': return this.replaceText(input, h);
      case 'pdf.colors': return this.recolor(input, h, str(a.mode, 'grey'));
      case 'pdf.rasterize': return this.recolor(input, h, 'none');
      case 'pdf.deskew': return this.deskew(input, h);
      case 'pdf.annotsRemove': {
        const r = await K.removeAnnotations(await read(input), { keepLinks: a.keepLinks !== false, keepForms: a.keepForms !== false });
        return save(r.bytes, ' without comments', r.removed ? `Removed ${r.removed} annotation${r.removed === 1 ? '' : 's'}` : 'There were no comments to remove');
      }
      case 'pdf.bookmarks': {
        const mode = str(a.mode, 'read');
        if (mode === 'read') {
          const list = await K.readBookmarks(await read(input));
          return { outputs: [], details: list.length ? K.formatBookmarks(list) : 'This PDF has no bookmarks. Choose “Make them from headings” or write your own.' };
        }
        const list = mode === 'auto' ? await this.headingBookmarks(input) : K.parseBookmarks(str(a.text));
        if (!list.length) throw new Error('No headings were found to make bookmarks from');
        const r = await save(await K.setBookmarks(await read(input), list), ' bookmarked');
        return { ...r, details: K.formatBookmarks(list) };
      }
      case 'pdf.toc': {
        let list = await K.readBookmarks(await read(input));
        if (!list.length) list = await this.headingBookmarks(input);
        return save(await K.tableOfContents(await read(input), list, { title: str(a.title, 'Contents') }), ' with contents');
      }
      case 'pdf.labels': {
        const ranges = K.parseLabelSpec(str(a.spec, '1: decimal'));
        const n = await K.pageCount(await read(input));
        const r = await save(await K.setPageLabels(await read(input), ranges), ' labelled');
        return { ...r, details: `Pages read: ${Array.from({ length: Math.min(n, 30) }, (_, i) => K.labelFor(i + 1, ranges)).join(', ')}${n > 30 ? ', …' : ''}` };
      }
      case 'pdf.meta': {
        const mode = str(a.mode, 'view');
        const bytes = await read(input);
        if (mode === 'view') {
          const m = await K.readMeta(bytes);
          const rows: [string, unknown][] = [['Title', m.title], ['Author', m.author], ['Subject', m.subject], ['Keywords', m.keywords], ['Made with', m.creator], ['Saved by', m.producer], ['Created', m.created], ['Changed', m.modified], ['Pages', m.pages], ['PDF version', m.version], ['Has XMP details', m.xmp ? 'yes' : 'no'], ['Password-protected', m.encrypted ? 'yes' : 'no']];
          return { outputs: [], details: rows.map(([k, v]) => `${k}: ${v ?? '—'}`).join('\n') };
        }
        if (mode === 'strip') {
          const r = await K.sanitize(bytes, { metadata: true });
          return save(r.bytes, ' without details', 'Removed the title, author, software, dates and XMP details');
        }
        const pick = (k: string) => (a[k] === undefined || a[k] === '' ? undefined : str(a[k]));
        return save(await K.writeMeta(bytes, { title: pick('title'), author: pick('author'), subject: pick('subject'), keywords: pick('keywords') }), ' details changed');
      }
      case 'pdf.attachments': {
        if (str(a.mode, 'extract') === 'add') {
          const f = str(a.file);
          return save(await K.attach(await read(input), [{ name: path.basename(f), data: await read(f) }]), ' with attachment');
        }
        const list = await K.listAttachments(await read(input));
        if (!list.length) return { outputs: [], message: 'This PDF has no attached files' };
        const outputs: string[] = [];
        for (const f of list) {
          const name = path.basename(f.name).replace(/[\\/:*?"<>|]/g, '_') || 'attachment';
          const o = freeName(h.outDir, stemOf(name), path.extname(name).slice(1));
          await fsp.writeFile(o, f.data);
          outputs.push(o);
        }
        return { outputs, message: `${list.length} attached file${list.length === 1 ? '' : 's'}` };
      }
      case 'pdf.layers': {
        const bytes = await read(input);
        const layers = await K.listLayers(bytes);
        if (!layers.length) return { outputs: [], details: 'This PDF has no layers' };
        const hide = str(a.hide).split(',').map((s) => s.trim()).filter(Boolean);
        const list = layers.map((l) => `${l.visible && !hide.includes(l.name) ? '●' : '○'} ${l.name}`).join('\n');
        if (!hide.length) return { outputs: [], details: list };
        return { ...(await save(await K.setLayers(bytes, Object.fromEntries(layers.map((l) => [l.name, !hide.includes(l.name)]))), ' layers')), details: list };
      }
      case 'pdf.fields': {
        const fields = str(a.mode, 'auto') === 'spec' ? K.parseFieldSpec(str(a.spec)) : await this.findBlanks(input);
        if (!fields.length) throw new Error('No blanks (____ lines or [ ] boxes) were found; list the fields yourself instead');
        return save(await K.addFields(await read(input), fields), ' fillable', `Added ${fields.length} field${fields.length === 1 ? '' : 's'}`);
      }
      case 'pdf.flatten': {
        const r = await K.flatten(await read(input));
        return save(r.bytes, ' flattened', r.fields ? `Fixed ${r.fields} field${r.fields === 1 ? '' : 's'} into the page` : 'There were no form fields');
      }
      case 'pdf.sanitize': {
        const r = await K.sanitize(await read(input), { scripts: bool(a.scripts), attachments: bool(a.attachments), metadata: bool(a.metadata), links: bool(a.links), annotations: bool(a.annotations), layers: bool(a.layers), forms: bool(a.forms), thumbnails: true });
        return save(r.bytes, ' clean', r.removed.length ? `Removed: ${r.removed.join(', ')}` : 'Nothing risky was found; saved a clean copy anyway');
      }
      case 'pdf.unlock': {
        if (!bool(a.owner)) throw new Error('Confirm that you own the document or may change it');
        const o = out(input, 'pdf', ' unrestricted');
        const qpdf = await h.tool(['qpdf']);
        if (qpdf) {
          const r = await exec(qpdf, ['--decrypt', input, o]);
          if (r.code === 0 || r.code === 3) return { outputs: [o], message: 'Printing, copying and editing are allowed in the copy' };
          if (/password/i.test(r.stderr)) throw new Error('This PDF needs a password to open; use Remove a password instead');
        }
        const { decryptPdf } = await import('../../core/pdfcrypt');
        await fsp.writeFile(o, await decryptPdf(await read(input), '').catch(() => { throw new Error('This PDF needs a password to open; use Remove a password instead'); }));
        return { outputs: [o], message: 'Printing, copying and editing are allowed in the copy' };
      }
      case 'pdf.linearize': {
        const qpdf = await h.tool(['qpdf']);
        if (!qpdf) throw new Error('Fast web view needs qpdf (free); install it and try again');
        const o = out(input, 'pdf', ' web');
        const r = await exec(qpdf, ['--linearize', input, o]);
        if (r.code !== 0 && r.code !== 3) throw new Error(r.stderr.trim().split('\n').pop() || 'qpdf could not rearrange this PDF');
        return { outputs: [o] };
      }
      case 'pdf.repair': return this.repair(input, h);
      case 'pdf.shrink': return this.shrink(input, h);
      case 'pdf.pdfa': return str(a.mode, 'convert') === 'check' ? this.pdfaCheck(input) : this.pdfa(input, h);
      case 'pdf.outlines': {
        const gs = await this.gs();
        const o = out(input, 'pdf', ' outlined');
        const r = await exec(gs, ['-q', '-dNOPAUSE', '-dBATCH', '-dSAFER', '-sDEVICE=pdfwrite', '-dNoOutputFonts', `-sOutputFile=${o}`, input]);
        if (r.code !== 0) throw new Error('Ghostscript could not outline this PDF');
        return { outputs: [o], message: 'Text is now shapes: it prints the same anywhere but can no longer be selected' };
      }
      case 'pdf.certSign': return signPdfWithCertificate(input, h);
      case 'pdf.certVerify': return { outputs: [], details: await verifyPdfSignatures(input) };
      case 'pdf.toText': return this.toText(input, h);
      case 'pdf.tables': return this.tables(input, h);
      case 'pdf.forAi': return this.forAi(input, h);
      case 'pdf.images': return this.extractImages(input, h);
      case 'pdf.toSvg': {
        const cairo = await h.tool(['pdftocairo']);
        if (!cairo) throw new Error('PDF to SVG needs poppler (pdftocairo); install poppler-utils (Linux), poppler (Homebrew) or use Convert to… → PNG');
        const n = await K.pageCount(await read(input));
        const outputs: string[] = [];
        for (let p = 1; p <= n; p++) {
          progress(p / n, 'Drawing pages');
          const o = out(input, 'svg', n > 1 ? ` page ${p}` : '');
          const r = await exec(cairo, ['-svg', '-f', String(p), '-l', String(p), input, o]);
          if (r.code !== 0) throw new Error('Could not draw the page as SVG');
          outputs.push(o);
        }
        return { outputs };
      }
      case 'pdf.toCbz': {
        const pages = await this.render(input, num(a.dpi, 150) / 72);
        const sharp = this.ctx.sharp();
        const entries = [];
        for (const [i, png] of pages.entries()) {
          progress(i / pages.length, 'Packing pages');
          entries.push({ name: `${String(i + 1).padStart(4, '0')}.jpg`, data: await sharp(png).jpeg({ quality: 88 }).toBuffer() });
        }
        const o = out(input, 'cbz');
        await fsp.writeFile(o, zip(entries));
        return { outputs: [o] };
      }
      case 'convert.to': return convertTo(input, h);
      case 'convert.subShift': return subShift(input, h);
      case 'convert.vcard': return vcardFromTable(input, h);
      case 'image.qrRead': return qrRead(input, h);
      case 'file.qrMake': return qrMake(input, h);
      default: throw new Error(`${op.tool} is not available`);
    }
  }

  // ---------------------------------------------------------------- helpers that look at pages

  // (see findIcc below the class)

  private async gs(): Promise<string> {
    const gs = await findTool(process.platform === 'win32' ? ['gswin64c', 'gswin32c', 'gs'] : ['gs']);
    if (!gs) throw new Error('This needs Ghostscript (free, AGPL); install it from ghostscript.com or your package manager and Keeper will use it');
    return gs;
  }

  /** Which pages paint nothing (no text, no shapes, no pictures). */
  private async paintedPages(input: string): Promise<{ painted: boolean; images: boolean }[]> {
    const lib = (await loadPdfJs()) as unknown as { OPS: Record<string, number>; getDocument(src: object): { promise: Promise<{ numPages: number; getPage(n: number): Promise<{ getOperatorList(): Promise<{ fnArray: number[] }> }>; destroy(): Promise<void> }> } };
    const doc = await lib.getDocument({ data: await read(input), isEvalSupported: false, disableFontFace: true, verbosity: 0 }).promise;
    const O = lib.OPS;
    const paint = new Set([O.showText, O.showSpacedText, O.nextLineShowText, O.nextLineSetSpacingShowText, O.stroke, O.closeStroke, O.fill, O.eoFill, O.fillStroke, O.eoFillStroke, O.closeFillStroke, O.closeEOFillStroke, O.shadingFill, O.paintFormXObjectBegin, O.paintSolidColorImageMask].filter((x) => x !== undefined));
    const imgs = new Set([O.paintImageXObject, O.paintInlineImageXObject, O.paintImageMaskXObject, O.paintImageXObjectRepeat, O.paintInlineImageXObjectGroup].filter((x) => x !== undefined));
    try {
      const out: { painted: boolean; images: boolean }[] = [];
      for (let p = 1; p <= doc.numPages; p++) {
        const ops = (await (await doc.getPage(p)).getOperatorList()).fnArray;
        const images = ops.some((o) => imgs.has(o));
        out.push({ painted: images || ops.some((o) => paint.has(o)), images });
      }
      return out;
    } finally {
      await doc.destroy();
    }
  }

  /** Share of a page picture that is not near-white. */
  private async inkShare(png: Buffer): Promise<{ share: number; box?: { x: number; y: number; w: number; h: number } }> {
    const { data, info } = await this.ctx.sharp()(png).greyscale().resize({ width: 300, withoutEnlargement: true }).raw().toBuffer({ resolveWithObject: true });
    let ink = 0;
    let minX = info.width; let minY = info.height; let maxX = -1; let maxY = -1;
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
      if (data[y * info.width + x] < 200) { ink++; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
    const share = ink / (info.width * info.height);
    return { share, box: maxX >= 0 ? { x: minX / info.width, y: minY / info.height, w: (maxX - minX + 1) / info.width, h: (maxY - minY + 1) / info.height } : undefined };
  }

  private async removeBlank(input: string, h: KitHelpers): Promise<ConvertResult> {
    h.progress(0.1, 'Looking at the pages');
    const facts = await this.paintedPages(input);
    const tol = num(h.args.tolerance, 0.3) / 100;
    const blank = new Set<number>();
    facts.forEach((f, i) => { if (!f.painted) blank.add(i); });
    // Scans and drawn pages: look at the picture.
    if (facts.some((f) => f.images)) {
      try {
        const pngs = await this.render(input, 0.5);
        // Only pictures (scans) can be "nearly empty"; a page with real text or drawings is never blank.
        for (const [i, png] of pngs.entries()) if (!blank.has(i) && facts[i].images && (await this.inkShare(png)).share <= tol) blank.add(i);
      } catch { /* without a renderer, only truly empty pages count */ }
    }
    if (!blank.size) return { outputs: [], message: 'No blank pages were found' };
    if (blank.size === facts.length) throw new Error('Every page looks blank');
    const keep = facts.map((_, i) => i).filter((i) => !blank.has(i));
    const o = h.out(input, 'pdf', ' without blanks');
    await fsp.writeFile(o, await K.pickPages(await read(input), keep));
    return { outputs: [o], message: `Removed ${blank.size} blank page${blank.size === 1 ? '' : 's'} (${[...blank].map((i) => i + 1).join(', ')})` };
  }

  private async contentBoxes(input: string): Promise<({ x: number; y: number; w: number; h: number } | null)[]> {
    try {
      const pngs = await this.render(input, 0.75);
      return Promise.all(pngs.map(async (p) => (await this.inkShare(p)).box ?? null));
    } catch {
      // Without drawing the pages, the text tells where the content is.
      const { items, sizes } = await textItems(input);
      return sizes.map((s, i) => {
        const its = items.filter((t) => t.page === i + 1 && t.str.trim());
        if (!its.length) return null;
        const x0 = Math.min(...its.map((t) => t.x)); const x1 = Math.max(...its.map((t) => t.x + t.width));
        const y0 = Math.min(...its.map((t) => t.y - t.height * 0.3)); const y1 = Math.max(...its.map((t) => t.y + t.height));
        return { x: x0 / s.width, y: 1 - y1 / s.height, w: (x1 - x0) / s.width, h: (y1 - y0) / s.height };
      });
    }
  }

  private async lines(input: string) {
    const { items, sizes } = await textItems(input);
    return { lines: toLines(items as Piece[]), sizes, items };
  }

  private async headingBookmarks(input: string): Promise<K.Bookmark[]> {
    const { lines } = await this.lines(input);
    const blocks = toBlocks(lines).filter((b) => b.kind === 'heading');
    const root: K.Bookmark[] = [];
    const stack: { level: number; list: K.Bookmark[] }[] = [{ level: 0, list: root }];
    for (const b of blocks.slice(0, 500)) {
      const bm: K.Bookmark = { title: b.text.slice(0, 120), page: b.page, children: [] };
      while (stack.length > 1 && stack[stack.length - 1].level >= (b.level ?? 2)) stack.pop();
      stack[stack.length - 1].list.push(bm);
      stack.push({ level: b.level ?? 2, list: bm.children! });
    }
    const clean = (l: K.Bookmark[]): K.Bookmark[] => l.map((b) => (b.children?.length ? { ...b, children: clean(b.children) } : { title: b.title, page: b.page }));
    return clean(root);
  }

  private async findBlanks(input: string): Promise<K.NewField[]> {
    const { items } = await textItems(input);
    const fields: K.NewField[] = [];
    let n = 0;
    for (const it of items) {
      const line = it.str.match(/_{4,}/);
      if (line) {
        const before = it.str.slice(0, line.index);
        const cw = it.width / Math.max(1, it.str.length);
        fields.push({ type: 'text', name: `field ${++n}`, page: it.page, x: it.x + before.length * cw, y: it.y - 2, w: Math.max(40, line[0].length * cw), h: Math.max(12, it.height + 4) });
      }
      for (const m of it.str.matchAll(/\[\s?\]|☐/g)) {
        const cw = it.width / Math.max(1, it.str.length);
        fields.push({ type: 'checkbox', name: `tick ${++n}`, page: it.page, x: it.x + (m.index ?? 0) * cw, y: it.y - 1, w: it.height, h: it.height });
      }
    }
    return fields;
  }

  private async replaceText(input: string, h: KitHelpers): Promise<ConvertResult> {
    const find = str(h.args.find);
    const repl = str(h.args.replace);
    const cs = bool(h.args.caseSensitive);
    const { items } = await textItems(input);
    const doc = await PDFDocument.load(await read(input), { ignoreEncryption: true });
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const esc = find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let count = 0;
    for (const it of items) {
      const re = new RegExp(esc, cs ? 'g' : 'gi');
      for (const m of it.str.matchAll(re)) {
        const page = doc.getPage(it.page - 1);
        const cw = it.width / Math.max(1, it.str.length);
        const x = it.x + (m.index ?? 0) * cw;
        const w = m[0].length * cw;
        page.drawRectangle({ x: x - 0.5, y: it.y - it.height * 0.25, width: w + 1, height: it.height * 1.2, color: rgb(1, 1, 1) });
        const text = K.winAnsi(repl);
        const natural = font.widthOfTextAtSize(text, it.height);
        const size = natural > w * 1.6 && text.length ? Math.max(4, (it.height * (w * 1.6)) / natural) : it.height;
        if (text) page.drawText(text, { x, y: it.y, size, font, color: rgb(0, 0, 0) });
        count++;
      }
    }
    if (!count) return { outputs: [], message: `“${find}” was not found as text (scanned pages need Make searchable first)` };
    const o = h.out(input, 'pdf', ' edited');
    await fsp.writeFile(o, await doc.save());
    return { outputs: [o], message: `Changed ${count} place${count === 1 ? '' : 's'}. The old words are covered; to remove them for good, also run Redact.` };
  }

  /** Pages redrawn as pictures, in a new look, at the size they had. */
  private async recolor(input: string, h: KitHelpers, mode: string): Promise<ConvertResult> {
    const dpi = num(h.args.dpi, 150);
    h.progress(0.05, 'Drawing the pages');
    const pngs = await this.render(input, dpi / 72);
    const src = await PDFDocument.load(await read(input), { ignoreEncryption: true });
    const out = await PDFDocument.create();
    const sharp = this.ctx.sharp();
    for (const [i, png] of pngs.entries()) {
      h.progress(0.1 + (0.85 * i) / pngs.length, 'Recolouring');
      let img = sharp(png).flatten({ background: '#ffffff' });
      switch (mode) {
        case 'grey': img = img.greyscale(); break;
        case 'invert': img = img.negate({ alpha: false }); break;
        case 'bw': img = img.greyscale().normalise().threshold(170); break;
        case 'contrast': img = img.linear(1.35, -30).modulate({ saturation: 1.15 }); break;
        case 'sepia': img = img.recomb([[0.393, 0.769, 0.189], [0.349, 0.686, 0.168], [0.272, 0.534, 0.131]]); break;
        case 'scan': img = img.greyscale().linear(1.15, 8).rotate(0.35 * (i % 2 ? 1 : -1), { background: '#f7f7f4' }).blur(0.45).modulate({ brightness: 0.98 }); break;
        default: break;
      }
      const jpg = await img.jpeg({ quality: mode === 'bw' ? 92 : 84 }).toBuffer();
      const p = src.getPage(i);
      const { width, height } = K.visibleSize(p);
      const embedded = await out.embedJpg(jpg);
      out.addPage([width, height]).drawImage(embedded, { x: 0, y: 0, width, height });
    }
    const o = h.out(input, 'pdf', mode === 'none' ? ' flattened' : ` ${mode === 'bw' ? 'black and white' : mode === 'grey' ? 'greyscale' : mode}`);
    await fsp.writeFile(o, await out.save());
    return { outputs: [o] };
  }

  /** Tilt of a page picture in degrees, by the angle that makes text rows sharpest. */
  async skewOf(png: Buffer): Promise<number> {
    const sharp = this.ctx.sharp();
    const base = await sharp(png).greyscale().resize({ width: 700, withoutEnlargement: true }).threshold(160).negate().raw().toBuffer({ resolveWithObject: true });
    const score = async (deg: number) => {
      const { data, info } = await sharp(base.data, { raw: { width: base.info.width, height: base.info.height, channels: 1 } }).rotate(deg, { background: '#000000' }).raw().toBuffer({ resolveWithObject: true });
      let s = 0;
      let prev = 0;
      for (let y = 0; y < info.height; y++) {
        let row = 0;
        for (let x = 0; x < info.width; x++) row += data[(y * info.width + x) * info.channels] > 128 ? 1 : 0;
        s += (row - prev) ** 2;
        prev = row;
      }
      return s;
    };
    let best = 0;
    let bestScore = await score(0);
    for (const step of [1, 0.25]) {
      const center = best;
      for (let d = -(step === 1 ? 6 : 1); d <= (step === 1 ? 6 : 1); d += step) {
        const deg = center + d;
        if (deg === center) continue;
        const sc = await score(deg);
        if (sc > bestScore * 1.01) { bestScore = sc; best = deg; }
      }
    }
    return best;
  }

  private async deskew(input: string, h: KitHelpers): Promise<ConvertResult> {
    const dpi = num(h.args.dpi, 200);
    h.progress(0.05, 'Drawing the pages');
    const pngs = await this.render(input, dpi / 72);
    const src = await PDFDocument.load(await read(input), { ignoreEncryption: true });
    const out = await PDFDocument.create();
    const sharp = this.ctx.sharp();
    const turned: string[] = [];
    for (const [i, png] of pngs.entries()) {
      h.progress(0.1 + (0.5 * i) / pngs.length, 'Straightening');
      const angle = await this.skewOf(png);
      const meta = await sharp(png).metadata();
      let img = sharp(png).flatten({ background: '#ffffff' });
      if (Math.abs(angle) >= 0.4) {
        turned.push(`page ${i + 1}: ${angle > 0 ? '+' : ''}${angle.toFixed(2)}°`);
        const rotated = await img.rotate(angle, { background: '#ffffff' }).toBuffer();
        const rm = await sharp(rotated).metadata();
        img = sharp(rotated).extract({ left: Math.max(0, Math.round(((rm.width ?? 0) - (meta.width ?? 0)) / 2)), top: Math.max(0, Math.round(((rm.height ?? 0) - (meta.height ?? 0)) / 2)), width: meta.width ?? 1, height: meta.height ?? 1 });
      }
      const jpg = await img.jpeg({ quality: 88 }).toBuffer();
      const { width, height } = K.visibleSize(src.getPage(i));
      out.addPage([width, height]).drawImage(await out.embedJpg(jpg), { x: 0, y: 0, width, height });
    }
    const o = h.out(input, 'pdf', ' straight');
    await fsp.writeFile(o, await out.save());
    if (bool(h.args.ocr) && this.ctx.hooks.ocrWords) {
      const tmp = o.replace(/\.pdf$/, ' .partial.pdf');
      await fsp.rename(o, tmp);
      try {
        await makeSearchable(tmp, o, (f, s) => this.render(f, s), this.ctx.hooks.ocrWords, (i, n) => h.progress(0.6 + (0.4 * i) / n, 'Reading the text'));
      } finally {
        await fsp.rm(tmp, { force: true });
      }
    }
    return { outputs: [o], message: turned.length ? `Straightened ${turned.length} page${turned.length === 1 ? '' : 's'}` : 'The pages were already straight', details: turned.join('\n') || undefined };
  }

  private async repair(input: string, h: KitHelpers): Promise<ConvertResult> {
    const o = h.out(input, 'pdf', ' repaired');
    const qpdf = await h.tool(['qpdf']);
    if (qpdf) {
      const r = await exec(qpdf, [input, o]);
      if (r.code === 0 || r.code === 3) return { outputs: [o], message: r.code === 3 ? `Repaired: ${r.stderr.split('\n').filter(Boolean).length} problems fixed` : 'The file was fine; saved a rebuilt copy' };
    }
    const gs = await findTool(['gs', 'gswin64c']);
    if (gs) {
      const r = await exec(gs, ['-q', '-dNOPAUSE', '-dBATCH', '-dSAFER', '-sDEVICE=pdfwrite', `-sOutputFile=${o}`, input]);
      if (r.code === 0) return { outputs: [o], message: 'Rebuilt with Ghostscript' };
    }
    // Built in: pdf-lib reads what it can and writes a clean file.
    const doc = await PDFDocument.load(await read(input), { ignoreEncryption: true, throwOnInvalidObject: false, updateMetadata: false });
    await fsp.writeFile(o, await doc.save());
    return { outputs: [o], message: 'Rebuilt the file’s structure' };
  }

  private async shrink(input: string, h: KitHelpers): Promise<ConvertResult> {
    const engine = str(h.args.engine, 'auto');
    const level = str(h.args.level, 'ebook');
    const o = h.out(input, 'pdf', ' smaller');
    const before = (await fsp.stat(input)).size;
    const done = async (how: string): Promise<ConvertResult> => {
      const after = (await fsp.stat(o)).size;
      if (after >= before) { await fsp.copyFile(input, o); return { outputs: [o], message: `Already as small as ${how} can make it` }; }
      return { outputs: [o], message: `${how}: ${Math.round((1 - after / before) * 100)}% smaller` };
    };
    const gs = engine === 'qpdf' || engine === 'keeper' ? null : await findTool(process.platform === 'win32' ? ['gswin64c', 'gs'] : ['gs']);
    if (gs) {
      const r = await exec(gs, ['-q', '-dNOPAUSE', '-dBATCH', '-dSAFER', '-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.5', `-dPDFSETTINGS=/${level}`, '-dDetectDuplicateImages=true', `-sOutputFile=${o}`, input]);
      if (r.code === 0) return done('Ghostscript');
    } else if (engine === 'gs') throw new Error('Ghostscript is not installed; install it, or choose Best available');
    const qpdf = engine === 'keeper' ? null : await h.tool(['qpdf']);
    if (qpdf) {
      const r = await exec(qpdf, ['--object-streams=generate', '--compress-streams=y', '--recompress-flate', '--compression-level=9', '--remove-unreferenced-resources=yes', input, o]);
      if (r.code === 0 || r.code === 3) {
        if (engine === 'qpdf') return done('qpdf');
        // Lossless first, then the built-in picture squeeze on top.
        const r2 = await this.ctx.runOp({ tool: 'pdf.compress', quality: level === 'screen' ? 45 : level === 'printer' || level === 'prepress' ? 80 : 60, maxSide: level === 'screen' ? 1200 : level === 'printer' || level === 'prepress' ? 3000 : 1600 }, [o], h.outDir).catch(() => undefined);
        if (r2?.outputs[0] && (await fsp.stat(r2.outputs[0])).size < (await fsp.stat(o)).size) await fsp.rename(r2.outputs[0], o);
        else if (r2?.outputs[0]) await fsp.rm(r2.outputs[0], { force: true });
        return done('qpdf and Keeper');
      }
    } else if (engine === 'qpdf') throw new Error('qpdf is not installed');
    const r = await this.ctx.runOp({ tool: 'pdf.compress', quality: level === 'screen' ? 45 : 60, maxSide: level === 'screen' ? 1200 : 1600 }, [input], h.outDir);
    await fsp.rename(r.outputs[0], o);
    return done('Keeper');
  }

  private async pdfa(input: string, h: KitHelpers): Promise<ConvertResult> {
    const gs = await this.gs();
    const level = str(h.args.level, '2');
    const o = h.out(input, 'pdf', ` PDF-A-${level}b`);
    // PDF/A needs a colour profile in the file (an output intent); Ghostscript ships sRGB ones.
    const icc = await findIcc(gs);
    const dir = await h.tmp();
    const def = path.join(dir, 'PDFA_def.ps');
    if (icc) await fsp.writeFile(def, `%!\n/ICCProfile (${icc.replace(/\\/g, '/').replace(/[()]/g, '\\$&')}) def\n[/_objdef {icc_PDFA} /type /stream /OBJ pdfmark\n[{icc_PDFA} <</N 3>> /PUT pdfmark\n[{icc_PDFA} ICCProfile (r) file /PUT pdfmark\n[/_objdef {OutputIntent_PDFA} /type /dict /OBJ pdfmark\n[{OutputIntent_PDFA} <</Type /OutputIntent /S /GTS_PDFA1 /DestOutputProfile {icc_PDFA} /OutputConditionIdentifier (sRGB)>> /PUT pdfmark\n[{Catalog} <</OutputIntents [ {OutputIntent_PDFA} ]>> /PUT pdfmark\n`);
    const r = await exec(gs, ['-q', '-dNOPAUSE', '-dBATCH', `-dPDFA=${level}`, '-dPDFACompatibilityPolicy=1', '-sColorConversionStrategy=RGB', '-sDEVICE=pdfwrite', ...(icc ? [`--permit-file-read=${icc}`, `--permit-file-read=${def}`] : []), '-dSAFER', `-sOutputFile=${o}`, ...(icc ? [def] : []), input]);
    await fsp.rm(dir, { recursive: true, force: true });
    if (r.code !== 0) throw new Error(`Ghostscript could not convert: ${r.stderr.trim().split('\n').pop()}`);
    const check = await this.pdfaCheck(o);
    return { outputs: [o], message: `Converted to PDF/A-${level}b`, details: check.details };
  }

  /** The basic rules a PDF/A file must follow, checked one by one (not a full validator). */
  private async pdfaCheck(input: string): Promise<ConvertResult> {
    const bytes = await read(input);
    const meta = await K.readMeta(bytes);
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    // Everything readable, compressed objects included, to look for forbidden things.
    let text = Buffer.from(bytes).toString('latin1');
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
      const d = K.decodeStream(obj);
      if (d && d.length < 2_000_000) text += Buffer.from(d).toString('latin1');
      else text += String(obj);
    }
    const part = text.match(/pdfaid:part(?:>|=["'])(\d)/)?.[1];
    const conf = text.match(/pdfaid:conformance(?:>|=["'])([ABU])/i)?.[1];
    const intents = doc.catalog.has(PDFName.of('OutputIntents'));
    const js = /\/JavaScript|\/JS\s*[(<]/.test(text);
    const rows: [boolean, string][] = [
      [!!part, part ? `Says it is PDF/A-${part}${conf?.toLowerCase() ?? ''}` : 'Does not say it is PDF/A (no pdfaid in its details)'],
      [!meta.encrypted, meta.encrypted ? 'Password-protected (not allowed)' : 'Not password-protected'],
      [!js, js ? 'Contains JavaScript (not allowed)' : 'No JavaScript'],
      [intents, intents ? 'Has a colour profile (output intent)' : 'No colour profile (output intent)'],
      [!/\/Launch/.test(text), /\/Launch/.test(text) ? 'Launches programs (not allowed)' : 'Launches nothing'],
      [meta.xmp, meta.xmp ? 'Has XMP details' : 'No XMP details'],
    ];
    const pdffonts = await findTool(['pdffonts']);
    if (pdffonts) {
      const r = await exec(pdffonts, [input]);
      const notEmbedded = r.stdout.split('\n').slice(2).filter((l) => l.trim() && / no\s+(yes|no)\s+(yes|no)\s+\d+\s+\d+\s*$/.test(l)).length;
      rows.push([notEmbedded === 0, notEmbedded ? `${notEmbedded} font${notEmbedded === 1 ? '' : 's'} not embedded (not allowed)` : 'Every font is embedded']);
    }
    const ok = rows.every(([b]) => b);
    return { outputs: [], message: ok ? 'Passes the basic PDF/A checks' : 'Does not pass every PDF/A check', verified: ok, details: `${rows.map(([b, s]) => `${b ? '✓' : '✕'} ${s}`).join('\n')}\n\nThese are the basic rules; a full validator (veraPDF) checks hundreds more.` };
  }

  private async toText(input: string, h: KitHelpers): Promise<ConvertResult> {
    const fmt = str(h.args.format, 'md');
    h.progress(0.2, 'Reading the text');
    const { lines } = await this.lines(input);
    if (!lines.length) throw new Error('No text was found; for scans, run Make searchable first');
    const o = h.out(input, fmt);
    if (fmt === 'txt') await fsp.writeFile(o, linesToText(lines));
    else if (fmt === 'md') await fsp.writeFile(o, blocksToMarkdown(toBlocks(lines)));
    else if (fmt === 'json') {
      const pages = new Map<number, { page: number; lines: { text: string; x: number; y: number; size: number }[] }>();
      for (const l of lines) (pages.get(l.page) ?? pages.set(l.page, { page: l.page, lines: [] }).get(l.page)!).lines.push({ text: l.text, x: Math.round(l.x), y: Math.round(l.y), size: Math.round(l.size * 10) / 10 });
      await fsp.writeFile(o, JSON.stringify({ file: path.basename(input), pages: [...pages.values()] }, null, 1));
    } else {
      const { markdownToHtml } = await import('../../core/devtools');
      const { htmlPage } = await import('../../core/docx');
      await fsp.writeFile(o, htmlPage(markdownToHtml(blocksToMarkdown(toBlocks(lines))), path.basename(input)));
    }
    return { outputs: [o] };
  }

  private async tables(input: string, h: KitHelpers): Promise<ConvertResult> {
    const fmt = str(h.args.format, 'xlsx');
    h.progress(0.2, 'Finding tables');
    const { lines } = await this.lines(input);
    const tables = findTables(lines);
    if (!tables.length) return { outputs: [], message: 'No tables were found (scanned pages need Make searchable first)' };
    const outputs: string[] = [];
    if (fmt === 'csv') {
      for (const [i, t] of tables.entries()) { const o = h.out(input, 'csv', ` table ${i + 1} (page ${t.page})`); await fsp.writeFile(o, toCsv(t.rows)); outputs.push(o); }
    } else if (fmt === 'json') {
      const o = h.out(input, 'json', ' tables');
      await fsp.writeFile(o, JSON.stringify(tables, null, 1));
      outputs.push(o);
    } else if (fmt === 'md') {
      const { tableToMarkdown } = await import('../../core/filekit/data');
      const o = h.out(input, 'md', ' tables');
      await fsp.writeFile(o, tables.map((t, i) => `## Table ${i + 1} (page ${t.page})\n\n${tableToMarkdown({ columns: t.rows[0], rows: t.rows.slice(1) })}`).join('\n'));
      outputs.push(o);
    } else {
      const XLSX = await import('xlsx');
      const wb = XLSX.utils.book_new();
      tables.forEach((t, i) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(t.rows.map((r) => r.map((c) => (/^-?\d+([.,]\d+)?$/.test(c) ? Number(c.replace(',', '.')) : c)))), `Table ${i + 1} p${t.page}`.slice(0, 31)));
      const o = h.out(input, 'xlsx', ' tables');
      await fsp.writeFile(o, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
      outputs.push(o);
    }
    return { outputs, message: `Found ${tables.length} table${tables.length === 1 ? '' : 's'}` };
  }

  private async forAi(input: string, h: KitHelpers): Promise<ConvertResult> {
    h.progress(0.2, 'Reading');
    let blocks;
    if (/\.pdf$/i.test(input)) blocks = toBlocks((await this.lines(input)).lines);
    else {
      const raw = await fsp.readFile(input, 'utf8');
      let page = 1;
      blocks = raw.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).map((p) => {
        const hd = p.match(/^(#{1,6})\s+(.*)$/);
        if (p.includes('\f')) page++;
        return hd ? { page, kind: 'heading' as const, level: hd[1].length, text: hd[2] } : { page, kind: /^[-*]\s/.test(p) ? ('list' as const) : ('paragraph' as const), text: p.replace(/^[-*]\s+/, '') };
      });
    }
    const chunks = chunkForAi(blocks, { target: num(h.args.words, 350), overlap: num(h.args.overlap, 40), source: path.basename(input) });
    if (!chunks.length) throw new Error('No text was found; for scans, run Make searchable first');
    const o = h.out(input, 'json', ' for AI');
    await fsp.writeFile(o, JSON.stringify({ source: path.basename(input), made: new Date().toISOString(), chunks }, null, 1));
    const md = h.out(input, 'md', ' for AI');
    await fsp.writeFile(md, chunks.map((c) => `<!-- ${c.id} · page ${c.pages.join(', ')}${c.heading ? ` · ${c.heading}` : ''} -->\n${c.heading ? `## ${c.heading}\n\n` : ''}${c.text}`).join('\n\n'));
    let note = '';
    if (bool(h.args.brain)) note = this.ctx.toBrain ? await this.ctx.toBrain(md) : 'Keeper’s brain is not available here';
    return { outputs: [o, md], message: `${chunks.length} chunks, about ${chunks.reduce((n, c) => n + c.tokens, 0).toLocaleString()} tokens${note ? ` · ${note}` : ''}` };
  }

  private async extractImages(input: string, h: KitHelpers): Promise<ConvertResult> {
    const min = num(h.args.min, 32);
    const imgs = (await K.listImages(await read(input))).filter((i) => i.width >= min && i.height >= min);
    if (!imgs.length) return { outputs: [], message: 'No pictures were found' };
    const sharp = this.ctx.sharp();
    const outputs: string[] = [];
    let skipped = 0;
    for (const [n, im] of imgs.entries()) {
      h.progress(n / imgs.length, 'Saving pictures');
      const name = `${stemOf(input)} page ${im.page} ${n + 1}`;
      try {
        if (im.filter === '/DCTDecode') { const o = freeName(h.outDir, name, 'jpg'); await fsp.writeFile(o, im.data); outputs.push(o); continue; }
        if (im.filter === '/JPXDecode') { const o = freeName(h.outDir, name, 'jp2'); await fsp.writeFile(o, im.data); outputs.push(o); continue; }
        if (im.filter && im.filter !== '/FlateDecode') { skipped++; continue; }
        const channels = /RGB/.test(im.colorSpace) ? 3 : /CMYK/.test(im.colorSpace) ? 4 : /Gray/.test(im.colorSpace) ? 1 : 0;
        if (!channels || im.bpc !== 8 || im.data.length < im.width * im.height * channels) { skipped++; continue; }
        const o = freeName(h.outDir, name, 'png');
        let img = sharp(Buffer.from(im.data.subarray(0, im.width * im.height * channels)), { raw: { width: im.width, height: im.height, channels: channels as 1 | 3 | 4 } });
        if (channels === 4) img = img.negate({ alpha: false }).removeAlpha();
        await img.png().toFile(o);
        outputs.push(o);
      } catch { skipped++; }
    }
    return { outputs, message: `${outputs.length} picture${outputs.length === 1 ? '' : 's'}${skipped ? `; ${skipped} in formats Keeper cannot save as they are (use PDF to pictures for those pages)` : ''}` };
  }

  private async compare(inputs: string[], h: KitHelpers): Promise<ConvertResult> {
    if (inputs.length !== 2) throw new Error('Choose exactly two PDFs to compare');
    const [A, B] = inputs;
    h.progress(0.1, 'Reading both');
    const [ta, tb] = await Promise.all([textItems(A), textItems(B)]);
    // Words, each remembering the text piece (and so the place) it came from.
    const wordsOf = (items: Awaited<ReturnType<typeof textItems>>['items']) => {
      const words: { w: string; page: number; x: number; y: number; width: number; h: number }[] = [];
      for (const it of items) {
        const cw = it.width / Math.max(1, it.str.length);
        for (const m of it.str.matchAll(/\S+/g)) words.push({ w: m[0], page: it.page, x: it.x + (m.index ?? 0) * cw, y: it.y, width: m[0].length * cw, h: it.height });
      }
      return words;
    };
    const wa = wordsOf(ta.items);
    const wb = wordsOf(tb.items);
    h.progress(0.3, 'Comparing the words');
    const ops = diffWords(wa.map((w) => w.w), wb.map((w) => w.w));
    const sum = diffSummary(ops);
    // Marked copies: removed words in red on the first, added words in green on the second.
    const mark = async (file: string, words: typeof wa, kind: 'removed' | 'added') => {
      const doc = await PDFDocument.load(await read(file), { ignoreEncryption: true });
      let i = 0;
      for (const op of ops) {
        if (op.kind === 'same' || op.kind === kind) {
          for (let k = 0; k < op.words.length; k++, i++) {
            if (op.kind !== kind) continue;
            const w = words[i];
            const page = doc.getPage(w.page - 1);
            page.drawRectangle({ x: w.x - 1, y: w.y - w.h * 0.25, width: w.width + 2, height: w.h * 1.25, color: kind === 'added' ? rgb(0.2, 0.8, 0.35) : rgb(0.95, 0.25, 0.25), opacity: 0.35 });
          }
        }
      }
      const o = freeName(h.outDir, `${stemOf(file)} ${kind === 'added' ? 'additions' : 'removals'} marked`, 'pdf');
      await fsp.writeFile(o, await doc.save());
      return o;
    };
    const outputs = [await mark(A, wa, 'removed'), await mark(B, wb, 'added')];
    let pageNote = '';
    const changedPages: number[] = [];
    if (h.args.visual !== false) {
      try {
        h.progress(0.5, 'Comparing how the pages look');
        const [pa, pb] = await Promise.all([this.render(A, 1), this.render(B, 1)]);
        const sharp = this.ctx.sharp();
        for (let p = 0; p < Math.max(pa.length, pb.length); p++) {
          if (!pa[p] || !pb[p]) { changedPages.push(p + 1); continue; }
          const meta = await sharp(pa[p]).metadata();
          const W = meta.width ?? 600; const H = meta.height ?? 800;
          const ra = await sharp(pa[p]).flatten({ background: '#fff' }).greyscale().resize(W, H, { fit: 'fill' }).raw().toBuffer();
          const rb = await sharp(pb[p]).flatten({ background: '#fff' }).greyscale().resize(W, H, { fit: 'fill' }).raw().toBuffer();
          const overlay = Buffer.alloc(W * H * 4);
          let diff = 0;
          for (let k = 0; k < W * H; k++) {
            const d = Math.abs(ra[k] - rb[k]);
            const g = 255 - Math.round((255 - rb[k]) * 0.35);
            if (d > 40) { diff++; overlay[k * 4] = 230; overlay[k * 4 + 1] = 40; overlay[k * 4 + 2] = 40; } else { overlay[k * 4] = g; overlay[k * 4 + 1] = g; overlay[k * 4 + 2] = g; }
            overlay[k * 4 + 3] = 255;
          }
          if (diff / (W * H) > 0.0005) {
            changedPages.push(p + 1);
            const o = freeName(h.outDir, `page ${p + 1} differences`, 'png');
            await sharp(overlay, { raw: { width: W, height: H, channels: 4 } }).png().toFile(o);
            outputs.push(o);
          }
        }
        pageNote = changedPages.length ? `<p class="sum">Pages that look different: ${changedPages.join(', ')} (red marks in the “page … differences” pictures).</p>` : '<p class="sum">Every page looks the same.</p>';
      } catch { pageNote = '<p class="sum">Pages could not be drawn here, so only the words were compared.</p>'; }
    }
    const report = freeName(h.outDir, `${stemOf(A)} vs ${stemOf(B)}`, 'html');
    await fsp.writeFile(report, diffHtml(ops, path.basename(A), path.basename(B), pageNote));
    outputs.unshift(report);
    const same = !sum.added && !sum.removed && !changedPages.length;
    return { outputs, verified: same, message: same ? 'The two PDFs have the same text and look the same' : `${sum.added} words added, ${sum.removed} removed${changedPages.length ? `; ${changedPages.length} page${changedPages.length === 1 ? ' looks' : 's look'} different` : ''}` };
  }
}

/** An sRGB colour profile that comes with Ghostscript (for PDF/A output intents). */
async function findIcc(gs: string): Promise<string | undefined> {
  const real = await fsp.realpath(gs).catch(() => gs);
  const roots = [path.resolve(path.dirname(real), '..', 'share', 'ghostscript'), path.resolve(path.dirname(real), '..'), '/usr/share/ghostscript', '/usr/local/share/ghostscript', '/opt/homebrew/share/ghostscript'];
  for (const r of roots) {
    const dirs = [r, ...(await fsp.readdir(r).catch(() => [] as string[])).map((d) => path.join(r, d))];
    for (const d of dirs) for (const name of ['srgb.icc', 'default_rgb.icc']) {
      const p = path.join(d, 'iccprofiles', name);
      if (await fsp.access(p).then(() => true, () => false)) return p;
    }
  }
  return undefined;
}
