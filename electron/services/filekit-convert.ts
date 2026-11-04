// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// "Convert to…": one entry point that turns any file into another format,
// choosing the route from core/filekit/matrix.ts. Keeper does most formats
// itself; office files, e-books, Ghostscript and Graphviz routes use those
// programs when they are installed and say so when they are not.

import { existsSync, promises as fsp } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { freeName, stemOf } from '../../core/convert';
import type { ConvertResult } from '../../core/convert-types';
import { fontKind, sfntToWoff, sfntToWoff2, woff2ToSfnt, woffToSfnt, writeIcns, writeIco, ICNS_SIZES } from '../../core/filekit/binfmt';
import {
  csvToTable, markdownTable, parseCsv, parseToml, tableToCsv, tableToHtml, tableToMarkdown, tableToValue, valueToTable, valueToXml, writeCsv, writeToml, xmlDocToValue,
  type Table, type Value,
} from '../../core/filekit/data';
import { dxfToSvg, parseDxf } from '../../core/filekit/dxf';
import {
  contactsToCsv, contactsToVcf, eventsToCsv, notebookToHtml, notebookToMarkdown, notebookToScript, parseIcs, parseSubtitles, parseVcf, shiftCues, writeSubtitles, type SubFormat,
} from '../../core/filekit/formats';
import { familyOf, targetsFor } from '../../core/filekit/matrix';
import { zip } from '../../core/zipwrite';
import { exec, findTool } from './convert-extra';
import { openPicture } from './photo-open';
import { writeBmp } from '../../core/photo-formats';
import type { KitHelpers } from './filekit';

const req = createRequire(__filename);
const extOf = (p: string) => path.extname(p).slice(1).toLowerCase();
const str = (v: unknown, d = '') => (v === undefined || v === null ? d : String(v));

/** Any picture Keeper can read, as something sharp opens (a path, or raw RGBA): the same opener as the photo editor's. */
async function decodeAny(input: string, h: KitHelpers): Promise<string | Buffer | { raw: Buffer; width: number; height: number }> {
  const o = await openPicture(input, { sharp: h.ctx.sharp(), systemDecode: (h.ctx.hooks as { decodeImage?: (f: string) => Promise<Buffer | null> }).decodeImage });
  if (o.via === 'sharp' || o.via === 'svg') return input;
  return { raw: o.data, width: o.width, height: o.height };
}

async function sharpOf(input: string, h: KitHelpers) {
  const src = await decodeAny(input, h);
  const sharp = h.ctx.sharp();
  if (typeof src === 'object' && 'raw' in src) return sharp(src.raw, { raw: { width: src.width, height: src.height, channels: 4 } });
  return sharp(src, { failOn: 'none', density: /\.svgz?$/i.test(input) ? 300 : undefined }).rotate();
}

async function iconPngs(input: string, h: KitHelpers, sizes: number[]) {
  const base = await (await sharpOf(input, h)).png().toBuffer();
  const sharp = h.ctx.sharp();
  return Promise.all(sizes.map(async (size) => ({ size, png: await sharp(base).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer() })));
}

// ---------------------------------------------------------------- tables and data

type YamlLib = { loadAll(t: string): unknown[]; dump(v: unknown, o?: object): string };

const VALUE_FORMATS = new Set(['json', 'yaml', 'yml', 'toml', 'xml']);

async function readValue(input: string): Promise<Value> {
  const e = extOf(input);
  const text = await fsp.readFile(input, 'utf8');
  if (e === 'json') return JSON.parse(text.replace(/^﻿/, '')) as Value;
  if (e === 'jsonl' || e === 'ndjson') return text.split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l) as Value);
  if (e === 'yaml' || e === 'yml') { const y = req('js-yaml') as YamlLib; const docs = y.loadAll(text) as Value[]; return docs.length === 1 ? docs[0] : docs; }
  if (e === 'toml') return parseToml(text);
  if (e === 'xml') return xmlDocToValue(text);
  throw new Error(`.${e} is not structured data`);
}

function writeValue(v: Value, fmt: string): string {
  if (fmt === 'json') return JSON.stringify(v, null, 2) + '\n';
  if (fmt === 'yaml' || fmt === 'yml') { const y = req('js-yaml') as YamlLib; return y.dump(v, { lineWidth: 120, noRefs: true }); }
  if (fmt === 'toml') return writeToml(Array.isArray(v) ? { items: v } : v);
  if (fmt === 'xml') return valueToXml(v);
  throw new Error(`Cannot write .${fmt} here`);
}

async function sqlJs() {
  const init = req('sql.js') as (o?: object) => Promise<{ Database: new (data?: Uint8Array) => { exec(sql: string): { columns: string[]; values: unknown[][] }[]; run(sql: string, params?: unknown[]): void; export(): Uint8Array; close(): void } }>;
  const wasm = req.resolve('sql.js/dist/sql-wasm.wasm');
  return init({ locateFile: () => wasm });
}

/** Every table in a file (one for CSV/JSON, one per sheet, one per database table). */
async function readTables(input: string, h: KitHelpers): Promise<Table[]> {
  const e = extOf(input);
  if (e === 'csv' || e === 'tsv' || e === 'txt') return [{ name: stemOf(input), ...csvToTable(await fsp.readFile(input, 'utf8'), e === 'tsv' ? '\t' : undefined) }];
  if (VALUE_FORMATS.has(e) || e === 'jsonl' || e === 'ndjson') return [{ name: stemOf(input), ...valueToTable(await readValue(input)) }];
  if (e === 'md' || e === 'markdown') { const t = markdownTable(await fsp.readFile(input, 'utf8')); if (!t) throw new Error('No table was found in this Markdown file'); return [{ name: stemOf(input), ...t }]; }
  if (['xlsx', 'xls', 'xlsm', 'xlsb', 'ods', 'html', 'htm', 'numbers'].includes(e)) {
    const XLSX = await import('xlsx');
    const wb = XLSX.read(await fsp.readFile(input), { type: 'buffer', cellDates: true });
    return wb.SheetNames.map((n) => {
      const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[n], { header: 1, raw: true, defval: null }) as unknown[][];
      const columns = ((rows.shift() ?? []) as unknown[]).map((c, i) => (c === null || c === undefined || c === '' ? `Column ${i + 1}` : String(c)));
      return { name: n, columns, rows: rows.filter((r) => r.some((c) => c !== null && c !== '')).map((r) => columns.map((_, i) => { const v = r[i]; return v instanceof Date ? v.toISOString() : (v as string | number | boolean | null) ?? null; })) };
    });
  }
  if (['sqlite', 'sqlite3', 'db'].includes(e)) {
    const SQL = await sqlJs();
    const db = new SQL.Database(new Uint8Array(await fsp.readFile(input)));
    try {
      const names = db.exec("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name")[0]?.values.map((v) => String(v[0])) ?? [];
      return names.map((n) => { const r = db.exec(`SELECT * FROM "${n.replace(/"/g, '""')}" LIMIT 1000000`)[0]; return { name: n, columns: r?.columns ?? [], rows: (r?.values ?? []).map((row) => row.map((v) => (v instanceof Uint8Array ? `<${v.length} bytes>` : (v as string | number | null)))) }; });
    } finally { db.close(); }
  }
  if (e === 'parquet') {
    const duck = await h.tool(['duckdb']);
    if (!duck) throw new Error('Reading Parquet needs DuckDB (free); install it and Keeper will use it');
    const r = await exec(duck, ['-csv', '-c', `SELECT * FROM read_parquet('${input.replace(/'/g, "''")}')`]);
    if (r.code !== 0) throw new Error(r.stderr.trim() || 'DuckDB could not read this file');
    return [{ name: stemOf(input), ...csvToTable(r.stdout) }];
  }
  if (e === 'ics' || e === 'ical') return [{ name: 'Events', ...csvToTable(eventsToCsv(parseIcs(await fsp.readFile(input, 'utf8')))) }];
  if (e === 'vcf' || e === 'vcard') return [{ name: 'Contacts', ...csvToTable(contactsToCsv(parseVcf(await fsp.readFile(input, 'utf8')))) }];
  throw new Error(`Keeper cannot read tables from .${e} files`);
}

async function writeTables(tables: Table[], fmt: string, input: string, h: KitHelpers): Promise<string[]> {
  const many = tables.length > 1;
  const one = async (t: Table, ext: string, body: string | Buffer) => { const o = freeName(h.outDir, many ? `${stemOf(input)} ${t.name}` : stemOf(input), ext); await fsp.writeFile(o, body); return o; };
  switch (fmt) {
    case 'csv': return Promise.all(tables.map((t) => one(t, 'csv', tableToCsv(t))));
    case 'tsv': return Promise.all(tables.map((t) => one(t, 'tsv', tableToCsv(t, '\t'))));
    case 'md': return [await one({ ...tables[0], name: '' }, 'md', tables.map((t) => `${many ? `## ${t.name}\n\n` : ''}${tableToMarkdown(t)}`).join('\n'))];
    case 'html': return [await one({ ...tables[0], name: '' }, 'html', tables.length === 1 ? tableToHtml(tables[0], stemOf(input)) : tables.map((t) => tableToHtml(t, t.name ?? '')).join('\n'))];
    case 'json': return [await one({ ...tables[0], name: '' }, 'json', JSON.stringify(many ? Object.fromEntries(tables.map((t) => [t.name, tableToValue(t)])) : tableToValue(tables[0]), null, 2) + '\n')];
    case 'yaml': case 'toml': case 'xml': {
      const v: Value = many ? Object.fromEntries(tables.map((t) => [t.name ?? 'table', tableToValue(t)])) : fmt === 'xml' ? { rows: { row: tableToValue(tables[0]) } } : tableToValue(tables[0]);
      return [await one({ ...tables[0], name: '' }, fmt, writeValue(v, fmt))];
    }
    case 'xlsx': case 'ods': {
      const XLSX = await import('xlsx');
      const wb = XLSX.utils.book_new();
      const used = new Set<string>();
      for (const t of tables) {
        let n = (t.name || 'Sheet').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet';
        for (let i = 2; used.has(n); i++) n = `${n.slice(0, 28)} ${i}`;
        used.add(n);
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([t.columns, ...t.rows]), n);
      }
      const o = freeName(h.outDir, stemOf(input), fmt);
      await fsp.writeFile(o, XLSX.write(wb, { type: 'buffer', bookType: fmt }) as Buffer);
      return [o];
    }
    case 'sqlite': {
      const SQL = await sqlJs();
      const db = new SQL.Database();
      try {
        for (const t of tables) {
          const name = (t.name || 'data').replace(/"/g, '');
          const types = t.columns.map((_, i) => (t.rows.every((r) => r[i] === null || typeof r[i] === 'number') ? 'REAL' : 'TEXT'));
          db.run(`CREATE TABLE "${name}" (${t.columns.map((c, i) => `"${c.replace(/"/g, '""')}" ${types[i]}`).join(', ')})`);
          for (const r of t.rows) db.run(`INSERT INTO "${name}" VALUES (${t.columns.map(() => '?').join(',')})`, r.map((v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v)));
        }
        const o = freeName(h.outDir, stemOf(input), 'sqlite');
        await fsp.writeFile(o, db.export());
        return [o];
      } finally { db.close(); }
    }
    case 'parquet': {
      const duck = await h.tool(['duckdb']);
      if (!duck) throw new Error('Writing Parquet needs DuckDB (free); install it and Keeper will use it');
      const tmp = path.join(await h.tmp(), 'data.csv');
      await fsp.writeFile(tmp, tableToCsv(tables[0]));
      const o = freeName(h.outDir, stemOf(input), 'parquet');
      const r = await exec(duck, ['-c', `COPY (SELECT * FROM read_csv_auto('${tmp.replace(/'/g, "''")}')) TO '${o.replace(/'/g, "''")}' (FORMAT PARQUET)`]);
      if (r.code !== 0) throw new Error(r.stderr.trim() || 'DuckDB could not write Parquet');
      return [o];
    }
    default: throw new Error(`Cannot write tables as .${fmt}`);
  }
}

// ---------------------------------------------------------------- e-books

/** An EPUB's chapters in reading order as one web page (pictures inlined). */
export async function epubToHtml(input: string): Promise<{ html: string; title: string }> {
  const JSZip = (await import('jszip')).default;
  const z = await JSZip.loadAsync(await fsp.readFile(input));
  const container = await z.file('META-INF/container.xml')?.async('string');
  const opfPath = container?.match(/full-path="([^"]+)"/)?.[1];
  if (!opfPath) throw new Error('This e-book is damaged (no package file)');
  const opf = (await z.file(opfPath)?.async('string')) ?? '';
  const base = path.posix.dirname(opfPath);
  const items = new Map<string, { href: string; type: string }>();
  for (const m of opf.matchAll(/<item\b[^>]*>/g)) {
    const id = m[0].match(/\bid="([^"]+)"/)?.[1];
    const href = m[0].match(/\bhref="([^"]+)"/)?.[1];
    const type = m[0].match(/media-type="([^"]+)"/)?.[1] ?? '';
    if (id && href) items.set(id, { href: decodeURIComponent(href), type });
  }
  const spine = [...opf.matchAll(/<itemref\b[^>]*idref="([^"]+)"/g)].map((m) => items.get(m[1])).filter((x): x is { href: string; type: string } => !!x);
  const title = opf.match(/<dc:title[^>]*>([^<]*)</)?.[1] ?? stemOf(input);
  const parts: string[] = [];
  for (const it of spine) {
    const p = path.posix.join(base, it.href);
    let body = (await z.file(p)?.async('string')) ?? '';
    body = body.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? body;
    body = body.replace(/<script[\s\S]*?<\/script>/gi, '');
    // Pictures become data addresses so the page stands alone.
    const srcs = [...body.matchAll(/(?:src|xlink:href|href)="([^"]+\.(?:png|jpe?g|gif|svg|webp))"/gi)];
    for (const s of srcs) {
      const file = z.file(path.posix.normalize(path.posix.join(path.posix.dirname(p), decodeURIComponent(s[1]))));
      if (!file) continue;
      const ext = s[1].split('.').pop()!.toLowerCase();
      const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
      body = body.split(`"${s[1]}"`).join(`"data:${mime};base64,${await file.async('base64')}"`);
    }
    parts.push(`<section>${body}</section>`);
  }
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>body{font:16px/1.6 Georgia,serif;max-width:720px;margin:40px auto;padding:0 16px}img{max-width:100%}section{page-break-after:always}</style></head><body>${parts.join('\n')}</body></html>`;
  return { html, title };
}

// ---------------------------------------------------------------- e-mail

/** An Outlook .msg (a compound file) read for its subject, people, date and body. */
async function readMsg(input: string): Promise<{ subject: string; from: string; to: string; date?: string; text: string; html?: string }> {
  const XLSX = await import('xlsx');
  const cfb = (XLSX as unknown as { CFB: { read(b: Buffer, o: object): { FileIndex: { name: string; content: Uint8Array }[]; FullPaths: string[] } } }).CFB.read(await fsp.readFile(input), { type: 'buffer' });
  const get = (id: string) => {
    const i = cfb.FullPaths.findIndex((p) => p.toUpperCase().endsWith(`/__SUBSTG1.0_${id}`) && !p.toUpperCase().includes('__RECIP_') && !p.toUpperCase().includes('__ATTACH_'));
    return i >= 0 ? Buffer.from(cfb.FileIndex[i].content ?? []) : undefined;
  };
  const text = (id: string) => { const u = get(`${id}001F`); if (u) return u.toString('utf16le').replace(/\0+$/, ''); const a = get(`${id}001E`); return a ? a.toString('latin1').replace(/\0+$/, '') : ''; };
  const html = get('10130102')?.toString('utf8');
  return { subject: text('0037'), from: [text('0C1A'), text('0C1F') || text('5D01')].filter(Boolean).join(' '), to: text('0E04'), text: text('1000'), html };
}

function mailHtml(m: { subject: string; from: string; to: string; date?: string; text: string; html?: string }): string {
  const e = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const body = m.html ? m.html.replace(/<script[\s\S]*?<\/script>/gi, '') : `<pre style="white-space:pre-wrap;font:inherit">${e(m.text)}</pre>`;
  return `<!doctype html><meta charset="utf-8"><title>${e(m.subject)}</title><style>body{font:15px/1.5 system-ui,sans-serif;max-width:820px;margin:28px auto;padding:0 16px}.h{border-bottom:1px solid #ddd;padding-bottom:10px;margin-bottom:14px;color:#444}</style><div class="h"><h2>${e(m.subject || '(no subject)')}</h2><div><b>From</b> ${e(m.from)}</div><div><b>To</b> ${e(m.to)}</div>${m.date ? `<div><b>Date</b> ${e(m.date)}</div>` : ''}</div>${body}`;
}

async function readMail(input: string): Promise<{ subject: string; from: string; to: string; date?: string; text: string; html?: string; attachments: { filename?: string; content: Buffer }[] }> {
  if (extOf(input) === 'msg') return { ...(await readMsg(input)), attachments: [] };
  const { simpleParser } = await import('mailparser');
  const m = await simpleParser(await fsp.readFile(input));
  const addr = (a: unknown) => (Array.isArray(a) ? a.map((x: { text: string }) => x.text).join(', ') : (a as { text?: string } | undefined)?.text ?? '');
  return { subject: m.subject ?? '', from: addr(m.from), to: addr(m.to), date: m.date?.toISOString(), text: m.text ?? '', html: typeof m.html === 'string' ? m.html : undefined, attachments: m.attachments.map((a) => ({ filename: a.filename, content: a.content })) };
}

// ---------------------------------------------------------------- archives

/** A plain ustar archive of files (name, bytes). */
export function tar(entries: { name: string; data?: Buffer; mtime?: Date }[]): Buffer {
  const blocks: Buffer[] = [];
  for (const e of entries) {
    const dir = e.name.endsWith('/');
    const h = Buffer.alloc(512);
    let name = e.name;
    let prefix = '';
    if (Buffer.byteLength(name) > 100) { const cut = name.lastIndexOf('/', 154); prefix = name.slice(0, cut); name = name.slice(cut + 1); }
    h.write(name, 0, 100, 'utf8');
    h.write(dir ? '0000755\0' : '0000644\0', 100);
    h.write('0000000\0', 108); h.write('0000000\0', 116);
    h.write(`${(e.data?.length ?? 0).toString(8).padStart(11, '0')}\0`, 124);
    h.write(`${Math.floor((e.mtime ?? new Date()).getTime() / 1000).toString(8).padStart(11, '0')}\0`, 136);
    h.write('        ', 148);
    h.write(dir ? '5' : '0', 156);
    h.write('ustar\0', 257); h.write('00', 263);
    h.write(prefix, 345, 155, 'utf8');
    let sum = 0;
    for (const c of h) sum += c;
    h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
    blocks.push(h);
    if (e.data?.length) { blocks.push(e.data); if (e.data.length % 512) blocks.push(Buffer.alloc(512 - (e.data.length % 512))); }
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

async function walk(dir: string, base = dir): Promise<{ name: string; abs: string; dir: boolean }[]> {
  const out: { name: string; abs: string; dir: boolean }[] = [];
  for (const d of await fsp.readdir(dir, { withFileTypes: true })) {
    const abs = path.join(dir, d.name);
    const name = path.relative(base, abs).split(path.sep).join('/');
    if (d.isDirectory()) { out.push({ name: `${name}/`, abs, dir: true }); out.push(...(await walk(abs, base))); } else if (d.isFile()) out.push({ name, abs, dir: false });
  }
  return out;
}

// ---------------------------------------------------------------- 3D models

async function loadModel(input: string): Promise<import('three').Object3D> {
  const THREE = await import('three');
  const e = extOf(input);
  const b = await fsp.readFile(input);
  const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  const mat = new THREE.MeshStandardMaterial({ color: 0xbbbbbb });
  switch (e) {
    case 'stl': { const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js'); return new THREE.Mesh(new STLLoader().parse(ab), mat); }
    case 'ply': { const { PLYLoader } = await import('three/examples/jsm/loaders/PLYLoader.js'); const g = new PLYLoader().parse(ab); g.computeVertexNormals(); return new THREE.Mesh(g, mat); }
    case 'obj': { const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js'); return new OBJLoader().parse(b.toString('utf8')); }
    case 'gltf': case 'glb': {
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
      return new Promise((resolve, reject) => new GLTFLoader().parse(e === 'gltf' ? b.toString('utf8') : ab, path.dirname(input) + path.sep, (g) => resolve(g.scene), reject));
    }
    case '3mf': { const { ThreeMFLoader } = await import('three/examples/jsm/loaders/3MFLoader.js'); return new ThreeMFLoader().parse(ab); }
    case 'fbx': { const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js'); return new FBXLoader().parse(ab, path.dirname(input) + path.sep); }
    case 'dae': { const { ColladaLoader } = await import('three/examples/jsm/loaders/ColladaLoader.js'); return new ColladaLoader().parse(b.toString('utf8'), path.dirname(input) + path.sep)!.scene; }
    default: throw new Error(`Keeper cannot read .${e} models`);
  }
}

/** Node has Blob but no FileReader, which the glTF exporter uses; a tiny one is enough. */
function ensureFileReader() {
  const g = globalThis as unknown as { FileReader?: unknown };
  if (g.FileReader) return;
  g.FileReader = class {
    result: unknown = null;
    onloadend: (() => void) | null = null;
    readAsArrayBuffer(b: Blob) { void b.arrayBuffer().then((r) => { this.result = r; this.onloadend?.(); }); }
    readAsDataURL(b: Blob) { void b.arrayBuffer().then((r) => { this.result = `data:${b.type || 'application/octet-stream'};base64,${Buffer.from(r).toString('base64')}`; this.onloadend?.(); }); }
  };
}

async function saveModel(obj: import('three').Object3D, fmt: string, output: string) {
  obj.updateMatrixWorld(true);
  switch (fmt) {
    case 'stl': { const { STLExporter } = await import('three/examples/jsm/exporters/STLExporter.js'); const dv = new STLExporter().parse(obj, { binary: true }) as unknown as DataView; await fsp.writeFile(output, Buffer.from(dv.buffer, dv.byteOffset, dv.byteLength)); return; }
    case 'obj': { const { OBJExporter } = await import('three/examples/jsm/exporters/OBJExporter.js'); await fsp.writeFile(output, new OBJExporter().parse(obj)); return; }
    case 'ply': {
      const g = globalThis as unknown as { requestAnimationFrame?: (cb: () => void) => unknown };
      g.requestAnimationFrame ??= (cb) => setTimeout(cb, 0);
      const { PLYExporter } = await import('three/examples/jsm/exporters/PLYExporter.js');
      const data = await new Promise<ArrayBuffer | string>((resolve) => new PLYExporter().parse(obj, (r) => resolve(r as ArrayBuffer | string), { binary: true }));
      await fsp.writeFile(output, typeof data === 'string' ? data : Buffer.from(data));
      return;
    }
    case 'glb': case 'gltf': {
      ensureFileReader();
      const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
      const r = await new GLTFExporter().parseAsync(obj, { binary: fmt === 'glb' });
      await fsp.writeFile(output, fmt === 'glb' ? Buffer.from(r as ArrayBuffer) : JSON.stringify(r));
      return;
    }
    default: throw new Error(`Keeper cannot write .${fmt} models`);
  }
}

// ---------------------------------------------------------------- the router

export async function convertTo(input: string, h: KitHelpers): Promise<ConvertResult> {
  const e = extOf(input);
  const fmt = str(h.args.format).toLowerCase().replace(/^\./, '');
  const fam = familyOf(e);
  if (!fam) throw new Error(`Keeper does not know how to convert .${e || 'extensionless'} files yet`);
  const target = targetsFor(e).find((t) => t.format === fmt);
  if (!target) throw new Error(`.${e} files cannot become .${fmt}; choose one of: ${targetsFor(e).map((t) => t.format).join(', ')}`);
  const o = (ext = fmt, suffix = '') => freeName(h.outDir, stemOf(input) + suffix, ext);
  const done = (outputs: string[], message?: string): ConvertResult => ({ outputs, message });
  h.progress(0.15, `Converting to ${target.label}`);
  const runOp = (op: Parameters<KitHelpers['ctx']['runOp']>[0], file = input) => h.ctx.runOp(op, [file], h.outDir);

  switch (fam) {
    case 'image': case 'icon': {
      if (fmt === 'ico') { const out = o(); await fsp.writeFile(out, writeIco(await iconPngs(input, h, [16, 24, 32, 48, 64, 128, 256]))); return done([out]); }
      if (fmt === 'icns') { const out = o(); await fsp.writeFile(out, writeIcns(await iconPngs(input, h, ICNS_SIZES))); return done([out]); }
      const img = await sharpOf(input, h);
      if (fmt === 'bmp') {
        const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        let alpha = false;
        for (let i = 3; i < data.length; i += 4) if (data[i] < 255) { alpha = true; break; }
        const out = o();
        await fsp.writeFile(out, writeBmp(data, info.width, info.height, alpha));
        return done([out]);
      }
      if (fmt === 'heic') { const tmp = path.join(await h.tmp(), `${stemOf(input)}.png`); await img.png().toFile(tmp); return runOp({ tool: 'image.convert', format: 'heic' }, tmp); }
      if (fmt === 'pdf') { const tmp = path.join(await h.tmp(), `${stemOf(input)}.png`); await img.png().toFile(tmp); return runOp({ tool: 'image.toPdf', pageSize: 'fit' }, tmp); }
      if (fmt === 'svg') {
        const png = await img.png().toBuffer();
        const m = await h.ctx.sharp()(png).metadata();
        const out = o();
        await fsp.writeFile(out, `<svg xmlns="http://www.w3.org/2000/svg" width="${m.width}" height="${m.height}" viewBox="0 0 ${m.width} ${m.height}"><image width="${m.width}" height="${m.height}" href="data:image/png;base64,${png.toString('base64')}"/></svg>\n`);
        return done([out], 'The picture is inside the SVG as it is; it does not become lines and shapes');
      }
      const out = o(fmt === 'jpeg' ? 'jpg' : fmt);
      const piped = fmt === 'jpg' ? img.flatten({ background: '#ffffff' }).jpeg({ quality: 88, mozjpeg: true }) : fmt === 'png' ? img.png({ compressionLevel: 9 }) : fmt === 'webp' ? img.webp({ quality: 85 }) : fmt === 'avif' ? img.avif({ quality: 55 }) : fmt === 'tiff' ? img.tiff({ compression: 'lzw' }) : img.gif();
      await piped.toFile(out);
      return done([out]);
    }
    case 'vector': {
      if (e === 'svg' || e === 'svgz') {
        if (fmt === 'pdf') {
          const svg = await fsp.readFile(input, 'utf8');
          if (h.ctx.hooks.printToPdf) {
            const out = o();
            await fsp.writeFile(out, await h.ctx.hooks.printToPdf({ html: `<!doctype html><style>@page{margin:0}html,body{margin:0}svg{width:100%;height:auto;display:block}</style>${svg}` }, { pageSize: 'a4', onePage: true }));
            return done([out], 'Kept as lines and shapes');
          }
          const tmp = path.join(await h.tmp(), `${stemOf(input)}.png`);
          await (await sharpOf(input, h)).png().toFile(tmp);
          return runOp({ tool: 'image.toPdf', pageSize: 'fit' }, tmp);
        }
        if (fmt === 'ico' || fmt === 'icns') { const out = o(); await fsp.writeFile(out, fmt === 'ico' ? writeIco(await iconPngs(input, h, [16, 24, 32, 48, 64, 128, 256])) : writeIcns(await iconPngs(input, h, ICNS_SIZES))); return done([out]); }
        const img = await sharpOf(input, h);
        const out = o();
        await (fmt === 'jpg' ? img.flatten({ background: '#ffffff' }).jpeg({ quality: 90 }) : fmt === 'webp' ? img.webp({ quality: 90 }) : img.png()).toFile(out);
        return done([out]);
      }
      if (e === 'ai') {
        // Illustrator files saved with PDF compatibility are PDFs inside.
        const head = (await fsp.readFile(input)).subarray(0, 5).toString('latin1');
        if (head !== '%PDF-') throw new Error('This Illustrator file was saved without PDF compatibility; open it in Illustrator (or Inkscape) and save with “Create PDF compatible file”');
        const tmp = path.join(await h.tmp(), `${stemOf(input)}.pdf`);
        await fsp.copyFile(input, tmp);
        if (fmt === 'pdf') { const out = o(); await fsp.copyFile(input, out); return done([out]); }
        if (fmt === 'svg') return h.kit('pdf.toSvg', {}, tmp);
        return runOp({ tool: 'pdf.toImages', format: 'png', dpi: 200 }, tmp);
      }
      // EPS through Ghostscript.
      const gs = await findTool(process.platform === 'win32' ? ['gswin64c', 'gs'] : ['gs']);
      if (!gs) throw new Error('EPS files need Ghostscript (free, AGPL); install it and Keeper will use it');
      const out = o(fmt === 'svg' ? 'pdf' : fmt);
      const r = await exec(gs, ['-q', '-dNOPAUSE', '-dBATCH', '-dSAFER', '-dEPSCrop', ...(fmt === 'png' ? ['-sDEVICE=png16m', '-r300'] : ['-sDEVICE=pdfwrite']), `-sOutputFile=${out}`, input]);
      if (r.code !== 0) throw new Error('Ghostscript could not read this EPS file');
      if (fmt === 'svg') return h.kit('pdf.toSvg', {}, out);
      return done([out]);
    }
    case 'pdf': {
      switch (fmt) {
        case 'docx': return runOp({ tool: 'pdf.toWord' });
        case 'png': case 'jpg': return runOp({ tool: 'pdf.toImages', format: fmt, dpi: 150 });
        case 'svg': return h.kit('pdf.toSvg', {}, input);
        case 'cbz': return h.kit('pdf.toCbz', { dpi: 150 }, input);
        case 'txt': case 'md': case 'html': case 'json': return h.kit('pdf.toText', { format: fmt }, input);
        case 'csv': case 'xlsx': return h.kit('pdf.tables', { format: fmt }, input);
        case 'epub': {
          const md = await h.kit('pdf.toText', { format: 'md' }, input);
          return pandoc(md.outputs[0], 'epub', o(), h, true);
        }
      }
      break;
    }
    case 'document': {
      if (['pptx', 'ppt', 'odp', 'key'].includes(e)) {
        if (fmt === 'pdf') return runOp({ tool: 'doc.toPdf', pageSize: 'a4', onePage: false });
        if (fmt === 'png') { const pdf = await runOp({ tool: 'doc.toPdf', pageSize: 'a4', onePage: false }); const r = await runOp({ tool: 'pdf.toImages', format: 'png', dpi: 150 }, pdf.outputs[0]); await fsp.rm(pdf.outputs[0], { force: true }); return r; }
        return office(input, fmt, o(), h);
      }
      if (fmt === 'pdf') return runOp({ tool: 'doc.toPdf', pageSize: 'a4', onePage: false });
      if (['docx', 'html', 'md', 'txt'].includes(fmt) && ['docx', 'md', 'markdown', 'txt', 'html', 'htm', 'odt', 'rtf', 'doc', 'docm', 'dotx', 'wpd', 'pages'].includes(e)) {
        try { return await runOp({ tool: 'doc.convert', format: fmt as 'docx' }); } catch (err) { if (!(await findTool(['pandoc']))) throw err; }
      }
      if (fmt === 'odt' || fmt === 'rtf') return office(input, fmt, o(), h);
      return pandoc(input, fmt, o(), h);
    }
    case 'ebook': {
      if (e === 'cbz' || e === 'cbr') {
        const dir = await h.tmp();
        const un = await h.ctx.runOp({ tool: 'file.unzip' }, [input], dir);
        const pics = un.outputs.length === 1 && (await fsp.stat(un.outputs[0])).isDirectory() ? (await walk(un.outputs[0])).filter((f) => !f.dir).map((f) => f.abs) : un.outputs;
        const images = pics.filter((p) => /\.(jpe?g|png|webp|gif|avif)$/i.test(p)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        if (!images.length) throw new Error('No pictures were found inside');
        if (fmt === 'zip') { const out = o('zip'); await fsp.writeFile(out, zip(await Promise.all(images.map(async (p) => ({ name: path.basename(p), data: await fsp.readFile(p) }))))); return done([out]); }
        const r = await h.ctx.runOp({ tool: 'image.toPdf', pageSize: 'fit' }, images, h.outDir);
        const out = o('pdf');
        await fsp.rename(r.outputs[0], out);
        return done([out], `${images.length} pages`);
      }
      const calibre = await findTool(['ebook-convert']);
      const viaCalibre = async (to: string, out: string) => {
        if (!calibre) throw new Error(`.${e} to .${to} needs Calibre (free, GPL); install it from calibre-ebook.com and Keeper will use its converter`);
        const r = await exec(calibre, [input, out]);
        if (r.code !== 0 || !existsSync(out)) throw new Error('Calibre could not convert this book');
        return out;
      };
      if (['mobi', 'azw3', 'fb2', 'epub'].includes(fmt)) return done([await viaCalibre(fmt, o())], 'Converted with Calibre');
      // Other e-books become EPUB with Calibre first; Keeper takes it from there.
      let book = input;
      if (e !== 'epub') book = await viaCalibre('epub', path.join(await h.tmp(), `${stemOf(input)}.epub`));
      const { html, title } = await epubToHtml(book);
      if (fmt === 'html') { const out = o(); await fsp.writeFile(out, html); return done([out]); }
      if (fmt === 'pdf') { const out = o(); await h.htmlToPdf(html, out); return done([out], `“${title}”`); }
      const tmp = path.join(await h.tmp(), `${stemOf(input)}.html`);
      await fsp.writeFile(tmp, html.replace(/<head>[\s\S]*?<\/head>/i, ''));
      const r = await h.ctx.runOp({ tool: 'doc.convert', format: fmt as 'md' }, [tmp], h.outDir);
      return done(r.outputs, `“${title}”`);
    }
    case 'sheet': case 'data': case 'calendar': case 'contacts': {
      if (fmt === 'pdf' && fam === 'sheet') return runOp({ tool: 'doc.toPdf', pageSize: 'a4', onePage: false });
      if (fmt === 'pdf') {
        const tables = await readTables(input, h);
        const out = o();
        await h.htmlToPdf(tables.map((t) => tableToHtml(t, tables.length > 1 ? t.name ?? '' : stemOf(input))).join('\n'), out);
        return done([out]);
      }
      if ((VALUE_FORMATS.has(e) || e === 'jsonl' || e === 'ndjson') && VALUE_FORMATS.has(fmt)) {
        const out = o(fmt === 'yml' ? 'yaml' : fmt);
        await fsp.writeFile(out, writeValue(await readValue(input), fmt));
        return done([out]);
      }
      if (fam === 'calendar' && fmt === 'json') { const out = o(); await fsp.writeFile(out, JSON.stringify(parseIcs(await fsp.readFile(input, 'utf8')), null, 2)); return done([out]); }
      if (fam === 'contacts' && fmt === 'json') { const out = o(); await fsp.writeFile(out, JSON.stringify(parseVcf(await fsp.readFile(input, 'utf8')), null, 2)); return done([out]); }
      const tables = await readTables(input, h);
      if (!tables.length) throw new Error('No tables were found');
      const outs = await writeTables(tables, fmt, input, h);
      return done(outs, `${tables.reduce((n, t) => n + t.rows.length, 0).toLocaleString()} rows${tables.length > 1 ? ` in ${tables.length} tables` : ''}`);
    }
    case 'subtitle': {
      const cues = parseSubtitles(await fsp.readFile(input, 'utf8'), e);
      if (!cues.length) throw new Error('No subtitles were found in this file');
      const out = o();
      await fsp.writeFile(out, writeSubtitles(cues, fmt as SubFormat));
      return done([out], `${cues.length} subtitles`);
    }
    case 'notebook': {
      const json = await fsp.readFile(input, 'utf8');
      if (fmt === 'md') { const out = o(); await fsp.writeFile(out, notebookToMarkdown(json)); return done([out]); }
      if (fmt === 'py') { const s = notebookToScript(json); const out = o(s.ext); await fsp.writeFile(out, s.text); return done([out]); }
      const { markdownToHtml } = await import('../../core/devtools');
      const html = notebookToHtml(json, stemOf(input), markdownToHtml);
      if (fmt === 'html') { const out = o(); await fsp.writeFile(out, html); return done([out]); }
      const out = o('pdf');
      await h.htmlToPdf(html, out);
      return done([out]);
    }
    case 'mail': {
      const m = await readMail(input);
      if (fmt === 'eml') {
        const out = o();
        const date = m.date ? new Date(m.date).toUTCString() : new Date().toUTCString();
        await fsp.writeFile(out, `From: ${m.from}\r\nTo: ${m.to}\r\nSubject: ${m.subject}\r\nDate: ${date}\r\nMIME-Version: 1.0\r\nContent-Type: ${m.html ? 'text/html' : 'text/plain'}; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${m.html ?? m.text}`);
        return done([out]);
      }
      const html = mailHtml(m);
      if (fmt === 'html') { const out = o(); await fsp.writeFile(out, html); return done([out]); }
      if (fmt === 'txt') { const out = o(); await fsp.writeFile(out, `Subject: ${m.subject}\nFrom: ${m.from}\nTo: ${m.to}\n${m.date ? `Date: ${m.date}\n` : ''}\n${m.text}`); return done([out]); }
      if (fmt === 'md') { const { htmlToMarkdown } = await import('../../core/docx'); const out = o(); await fsp.writeFile(out, `# ${m.subject}\n\n**From** ${m.from}  \n**To** ${m.to}  \n${m.date ? `**Date** ${m.date}\n` : ''}\n${m.html ? htmlToMarkdown(m.html) : m.text}\n`); return done([out]); }
      const out = o('pdf');
      await h.htmlToPdf(html, out);
      return done([out]);
    }
    case 'mailbox': return mboxSplit([input], h, fmt === 'csv');
    case 'font': {
      const b = await fsp.readFile(input);
      const kind = fontKind(b);
      if (!kind) throw new Error('This font file is not one Keeper recognises');
      const sfnt = kind === 'woff' ? woffToSfnt(b) : kind === 'woff2' ? woff2ToSfnt(b) : b;
      const isCff = sfnt.subarray(0, 4).toString('latin1') === 'OTTO';
      const out = fmt === 'ttf' || fmt === 'otf' ? o(isCff ? 'otf' : 'ttf') : o();
      await fsp.writeFile(out, fmt === 'woff' ? sfntToWoff(sfnt) : fmt === 'woff2' ? sfntToWoff2(sfnt) : sfnt);
      return done([out], (fmt === 'ttf' && isCff) || (fmt === 'otf' && !isCff) ? `Saved as .${isCff ? 'otf' : 'ttf'}: changing the outline type itself needs a font editor` : undefined);
    }
    case 'model': {
      const obj = await loadModel(input);
      const out = o();
      await saveModel(obj, fmt, out);
      return done([out]);
    }
    case 'cad': {
      const d = parseDxf(await fsp.readFile(input, 'latin1'));
      const svg = dxfToSvg(d, { background: '#ffffff', stroke: '#111111' });
      const skipped = Object.entries(d.skipped).map(([k, n]) => `${n} ${k.toLowerCase()}`).join(', ');
      const note = `${d.shapes.length} shapes${d.units ? ` · units ${d.units}` : ''}${skipped ? ` · not drawn: ${skipped}` : ''}`;
      if (fmt === 'svg') { const out = o(); await fsp.writeFile(out, svg); return done([out], note); }
      const png = await h.ctx.sharp()(Buffer.from(svg), { density: 150 }).png().toBuffer();
      if (fmt === 'png') { const out = o(); await fsp.writeFile(out, png); return done([out], note); }
      const out = o('pdf');
      if (h.ctx.hooks.printToPdf) await fsp.writeFile(out, await h.ctx.hooks.printToPdf({ html: `<!doctype html><style>@page{margin:10mm}body{margin:0}svg{width:100%;height:auto}</style>${svg}` }, { pageSize: 'a4', onePage: false }));
      else { const tmp = path.join(await h.tmp(), `${stemOf(input)}.png`); await fsp.writeFile(tmp, png); const r = await h.ctx.runOp({ tool: 'image.toPdf', pageSize: 'fit' }, [tmp], h.outDir); await fsp.rename(r.outputs[0], out); }
      return done([out], note);
    }
    case 'archive': {
      const dir = await h.tmp();
      const un = await h.ctx.runOp({ tool: 'file.unzip' }, [input], dir);
      const root = un.outputs.length === 1 && (await fsp.stat(un.outputs[0])).isDirectory() ? un.outputs[0] : dir;
      const files = await walk(root);
      const entries = await Promise.all(files.map(async (f) => (f.dir ? { name: f.name } : { name: f.name, data: await fsp.readFile(f.abs), mtime: (await fsp.stat(f.abs)).mtime })));
      const out = o(fmt);
      if (fmt === 'zip') await fsp.writeFile(out, zip(entries));
      else { const t = tar(entries); await fsp.writeFile(out, fmt === 'tgz' ? gzipSync(t) : t); }
      return done([out], `${files.filter((f) => !f.dir).length} files`);
    }
    case 'audio': {
      if (fmt === 'opus') {
        if (!h.ctx.ffmpeg) throw new Error('The audio engine is missing from this copy of Keeper');
        const out = o();
        const r = await exec(h.ctx.ffmpeg, ['-hide_banner', '-y', '-i', input, '-vn', '-c:a', 'libopus', '-b:a', '128k', out]);
        if (r.code !== 0) throw new Error('Could not convert the sound');
        return done([out]);
      }
      return runOp({ tool: 'audio.convert', format: fmt as 'mp3' });
    }
    case 'video': {
      if (fmt === 'mp3' || fmt === 'm4a') return runOp({ tool: 'video.audio', format: fmt });
      if (fmt === 'mkv') {
        if (!h.ctx.ffmpeg) throw new Error('The video engine is missing from this copy of Keeper');
        const out = o();
        // Re-wrapping keeps quality and is instant; re-encode only when the streams do not fit.
        let r = await exec(h.ctx.ffmpeg, ['-hide_banner', '-y', '-i', input, '-map', '0', '-c', 'copy', out]);
        if (r.code !== 0) r = await exec(h.ctx.ffmpeg, ['-hide_banner', '-y', '-i', input, '-c:v', 'libx264', '-crf', '20', '-c:a', 'aac', out]);
        if (r.code !== 0) throw new Error('Could not convert the video');
        return done([out]);
      }
      return runOp({ tool: 'video.convert', format: fmt as 'mp4' });
    }
    case 'diagram': {
      const dot = await findTool(['dot']);
      if (!dot) throw new Error('Graphviz diagrams need Graphviz (free); install it and Keeper will use it');
      const out = o();
      const r = await exec(dot, [`-T${fmt}`, input, '-o', out]);
      if (r.code !== 0) throw new Error(r.stderr.trim() || 'Graphviz could not draw this diagram');
      return done([out]);
    }
  }
  throw new Error(`.${e} to .${fmt} is not available yet`);
}

async function office(input: string, fmt: string, out: string, h: KitHelpers): Promise<ConvertResult> {
  const { officeCandidates } = await import('./convert-extra');
  const soffice = await findTool(officeCandidates());
  if (!soffice) throw new Error(`.${fmt} needs LibreOffice (free); install it and Keeper will use it`);
  const dir = await h.tmp();
  const profile = `-env:UserInstallation=file://${path.join(dir, 'profile').replace(/\\/g, '/')}`;
  const r = await exec(soffice, [profile, '--headless', '--norestore', '--convert-to', fmt, '--outdir', dir, input]);
  const made = (await fsp.readdir(dir)).find((n) => n.toLowerCase().endsWith(`.${fmt}`));
  if (r.code !== 0 || !made) throw new Error('LibreOffice could not convert this file');
  await fsp.copyFile(path.join(dir, made), out);
  return { outputs: [out], message: 'Converted with LibreOffice' };
}

async function pandoc(input: string, fmt: string, out: string, h: KitHelpers, removeInput = false): Promise<ConvertResult> {
  const bin = await findTool(['pandoc']);
  if (!bin) throw new Error(`.${fmt} needs Pandoc (free, GPL); install it from pandoc.org and Keeper will use it`);
  const from = ({ md: 'markdown', markdown: 'markdown', htm: 'html', txt: 'markdown', adoc: 'asciidoc', asciidoc: 'asciidoc', tex: 'latex', ipynb: 'ipynb' } as Record<string, string>)[extOf(input)];
  const r = await exec(bin, [...(from ? ['-f', from] : []), '-t', fmt === 'md' ? 'gfm' : fmt === 'tex' ? 'latex' : fmt === 'txt' ? 'plain' : fmt, '-s', '-o', out, input], undefined, { cwd: path.dirname(input) });
  if (removeInput) await fsp.rm(input, { force: true });
  if (r.code !== 0) throw new Error(r.stderr.trim().split('\n').pop() || 'Pandoc could not convert this file');
  void h;
  return { outputs: [out], message: 'Converted with Pandoc' };
}

// ---------------------------------------------------------------- the smaller tools

export async function subShift(input: string, h: KitHelpers): Promise<ConvertResult> {
  const e = extOf(input);
  const cues = parseSubtitles(await fsp.readFile(input, 'utf8'), e);
  if (!cues.length) throw new Error('No subtitles were found in this file');
  const s = Number(h.args.seconds ?? 0);
  const f = Number(h.args.factor ?? 1) || 1;
  const out = freeName(h.outDir, `${stemOf(input)} shifted`, e === 'ssa' ? 'ass' : e);
  await fsp.writeFile(out, writeSubtitles(shiftCues(cues, s, f), (e === 'ssa' ? 'ass' : e) as SubFormat));
  return { outputs: [out], message: `${cues.length} subtitles moved ${s >= 0 ? 'later' : 'earlier'} by ${Math.abs(s)} s${f !== 1 ? `, stretched ×${f}` : ''}` };
}

export async function vcardFromTable(input: string, h: KitHelpers): Promise<ConvertResult> {
  const tables = await readTables(input, h);
  const t = tables[0];
  if (!t?.rows.length) throw new Error('No rows were found');
  const rows = t.rows.map((r) => Object.fromEntries(t.columns.map((c, i) => [c, r[i] === null ? '' : String(r[i])])));
  const out = freeName(h.outDir, stemOf(input), 'vcf');
  await fsp.writeFile(out, contactsToVcf(rows));
  return { outputs: [out], message: `${rows.length} contacts` };
}

/** Splits mbox archives at their "From " lines into .eml files (or an index). */
export async function mboxSplit(inputs: string[], h: KitHelpers, indexOnly = false): Promise<ConvertResult> {
  const outputs: string[] = [];
  const index: unknown[][] = [['File', 'Date', 'From', 'To', 'Subject']];
  const { simpleParser } = await import('mailparser');
  for (const input of inputs) {
    const text = await fsp.readFile(input, 'latin1');
    const msgs = text.split(/\r?\n(?=From [^\n]*\d{4}\r?\n)/).map((m) => m.replace(/^From [^\n]*\n/, '').replace(/^>(>*From )/gm, '$1')).filter((m) => m.trim());
    const dir = indexOnly ? h.outDir : path.join(h.outDir, stemOf(input));
    if (!indexOnly) await fsp.mkdir(dir, { recursive: true });
    for (const [i, m] of msgs.entries()) {
      h.progress(i / msgs.length, 'Reading messages');
      const raw = Buffer.from(m, 'latin1');
      const p = await simpleParser(raw).catch(() => undefined);
      const subj = (p?.subject ?? `message ${i + 1}`).replace(/[\\/:*?"<>|\n\r]/g, ' ').slice(0, 80).trim() || `message ${i + 1}`;
      const name = `${String(i + 1).padStart(4, '0')} ${subj}`;
      if (!indexOnly) { const o = freeName(dir, name, 'eml'); await fsp.writeFile(o, raw); outputs.push(o); }
      const addr = (a: unknown) => (Array.isArray(a) ? a.map((x: { text: string }) => x.text).join(', ') : (a as { text?: string } | undefined)?.text ?? '');
      index.push([`${name}.eml`, p?.date?.toISOString() ?? '', addr(p?.from), addr(p?.to), p?.subject ?? '']);
    }
  }
  const idx = freeName(h.outDir, `${stemOf(inputs[0])} index`, 'csv');
  await fsp.writeFile(idx, writeCsv(index));
  outputs.unshift(idx);
  return { outputs, message: `${index.length - 1} messages` };
}

export async function qrMake(input: string, h: KitHelpers): Promise<ConvertResult> {
  const QR = (await import('qrcode')).default;
  const text = str(h.args.text).trim() || (await fsp.readFile(input, 'utf8')).trim();
  if (!text) throw new Error('There is no text to put in the code');
  if (text.length > 2900) throw new Error('Too much text for one QR code (about 2,900 characters at most)');
  const size = Number(h.args.size ?? 1024);
  const png = freeName(h.outDir, `${stemOf(input)} QR`, 'png');
  const svg = freeName(h.outDir, `${stemOf(input)} QR`, 'svg');
  await QR.toFile(png, text, { width: size, margin: 2, errorCorrectionLevel: 'M' });
  await fsp.writeFile(svg, await QR.toString(text, { type: 'svg', margin: 2 }));
  return { outputs: [png, svg] };
}

export async function qrRead(input: string, h: KitHelpers): Promise<ConvertResult> {
  const { decodeCode } = await import('../../core/codes');
  const img = await sharpOf(input, h);
  const found: string[] = [];
  // Try the whole picture, then a smaller copy (helps with huge photos).
  for (const width of [undefined, 1200, 800]) {
    const { data, info } = await (width ? img.clone().resize({ width, withoutEnlargement: true }) : img.clone()).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const c = decodeCode(data, info.width, info.height);
    if (c) { found.push(`${c.format.replace(/_/g, ' ')}: ${c.value}`); break; }
  }
  return { outputs: [], details: found.length ? found.join('\n') : 'No QR code or barcode was found', message: found.length ? 'Found a code' : undefined };
}

export { parseCsv };
