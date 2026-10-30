// SPDX-License-Identifier: AGPL-3.0-or-later
// Thumbnails the viewer draws itself when the system cannot: PDF first pages,
// font samples, and a miniature page for text, code, tables and documents.
// They are handed back to the main process to be cached on disk.

import { rtfToText } from '../../core/docparse';
import { codeLanguage } from '../../core/previewKind';
import { api, isDemo } from '../api';
import { extOfName, fetchBytes, fileUrl } from './util';

const FONT = /^(ttf|otf|woff2?|ttc)$/;
const PDF = /^(pdf|ai)$/;
const TEXT = /^(txt|md|markdown|json|jsonl|log|srt|vtt|html?|xml|ya?ml|toml|ini|py|js|mjs|cjs|ts|tsx|jsx|go|rs|java|kt|swift|c|h|cc|cpp|hpp|cs|rb|php|sh|bash|zsh|ps1|sql|css|scss|vue|svelte|lua|r|dart|eml|vcf|ics|ipynb)$/;
const TABLE = /^(csv|tsv|xlsx|xlsm|xls|ods)$/;
const DOC = /^(docx|docm|odt|rtf)$/;
const inflight = new Map<string, Promise<string | null>>();

export function canRenderThumb(path: string): boolean {
  if (isDemo) return false;
  const e = extOfName(path.split(/[\\/]/).pop() ?? '');
  return PDF.test(e) || FONT.test(e) || TEXT.test(e) || TABLE.test(e) || DOC.test(e);
}

/** The best thumbnail available: the system's or a cached one, else one drawn here. */
export async function getThumb(path: string, size: number): Promise<string | null> {
  const s = await api.files.thumbnail(path, size).catch(() => null);
  if (s) return s;
  return canRenderThumb(path) ? renderThumb(path, size) : null;
}

export function renderThumb(path: string, size: number): Promise<string | null> {
  const key = `${path}@${size}`;
  let p = inflight.get(key);
  if (!p) {
    p = draw(path, size).catch(() => null).finally(() => setTimeout(() => inflight.delete(key), 1000));
    inflight.set(key, p);
  }
  return p;
}

async function draw(path: string, size: number): Promise<string | null> {
  const ext = extOfName(path.split(/[\\/]/).pop() ?? '');
  let url: string | null = null;
  if (PDF.test(ext)) {
    const { pdfThumb } = await import('./pdf');
    url = await pdfThumb(await fetchBytes(path, 300 * 1024 * 1024), size);
  } else if (FONT.test(ext)) {
    url = await fontThumb(path, size);
  } else if (TABLE.test(ext)) {
    url = await tableThumb(path, ext, size);
  } else if (DOC.test(ext)) {
    let text = '';
    if (ext === 'rtf') text = rtfToText((await api.preview.text(path, 256 * 1024)).text);
    else if (ext === 'odt') {
      const JSZip = (await import('jszip')).default;
      const zip = await JSZip.loadAsync(await fetchBytes(path, 100 * 1024 * 1024));
      text = ((await zip.file('content.xml')?.async('string')) ?? '').replace(/<text:(p|h)[^>]*>/g, '\n').replace(/<[^>]+>/g, '').trim();
    } else {
      const mammoth = (await import('mammoth')).default;
      text = (await mammoth.extractRawText({ arrayBuffer: await fetchBytes(path, 100 * 1024 * 1024) })).value;
    }
    url = pageThumb(text, size, { serif: true });
  } else if (TEXT.test(ext)) {
    const t = await api.preview.text(path, 6 * 1024);
    const code = !!codeLanguage(path, ext) || /^(json|jsonl|xml|ya?ml|toml|ini|ipynb)$/.test(ext);
    url = pageThumb(t.text, size, { mono: code, markdown: ext === 'md' || ext === 'markdown' });
  }
  if (url) void api.preview.storeThumb(path, size, url).catch(() => undefined);
  return url;
}

function canvasFor(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = Math.round(size * 0.82);
  return [c, c.getContext('2d')!];
}

/** A small portrait page with the first lines of text on it. */
function pageThumb(text: string, size: number, o: { mono?: boolean; serif?: boolean; markdown?: boolean }): string {
  const [c, g] = canvasFor(size);
  const ph = c.height * 0.94;
  const pw = ph * 0.77;
  const x0 = (c.width - pw) / 2;
  const y0 = (c.height - ph) / 2;
  g.shadowColor = 'rgba(0,0,0,.18)';
  g.shadowBlur = size / 40;
  g.shadowOffsetY = size / 160;
  g.fillStyle = '#ffffff';
  g.fillRect(x0, y0, pw, ph);
  g.shadowColor = 'transparent';
  const pad = pw * 0.09;
  const fs = Math.max(4, pw / (o.mono ? 30 : 26));
  const lh = fs * 1.42;
  const family = o.mono ? 'ui-monospace, Menlo, Consolas, monospace' : o.serif ? 'Georgia, serif' : '-apple-system, "Segoe UI", sans-serif';
  const lines = text.replace(/\t/g, '  ').replace(/\r/g, '').split('\n');
  let y = y0 + pad + fs;
  g.save();
  g.beginPath();
  g.rect(x0 + pad, y0 + pad / 2, pw - pad * 2, ph - pad);
  g.clip();
  for (const raw of lines) {
    if (y > y0 + ph - pad / 2) break;
    const heading = o.markdown && /^#{1,3}\s/.test(raw);
    const line = o.markdown ? raw.replace(/^#{1,6}\s*/, '').replace(/[*_`]/g, '') : raw;
    g.font = `${heading ? 700 : 400} ${heading ? fs * 1.35 : fs}px ${family}`;
    g.fillStyle = heading ? '#1b1b1f' : o.mono ? '#3a3a48' : '#2b2b33';
    // Wrap prose; leave code as it is.
    if (!o.mono && g.measureText(line).width > pw - pad * 2) {
      const words = line.split(' ');
      let cur = '';
      for (const w of words) {
        const t = cur ? `${cur} ${w}` : w;
        if (g.measureText(t).width > pw - pad * 2 && cur) {
          g.fillText(cur, x0 + pad, y);
          y += lh;
          cur = w;
          if (y > y0 + ph - pad / 2) break;
        } else cur = t;
      }
      if (cur && y <= y0 + ph - pad / 2) g.fillText(cur, x0 + pad, y);
    } else g.fillText(line, x0 + pad, y);
    y += heading ? lh * 1.35 : lh;
  }
  g.restore();
  return c.toDataURL('image/png');
}

async function tableThumb(path: string, ext: string, size: number): Promise<string | null> {
  let rows: string[][];
  if (ext === 'csv' || ext === 'tsv') {
    const t = (await api.preview.text(path, 8 * 1024)).text;
    const sep = ext === 'tsv' ? '\t' : ',';
    rows = t.split(/\r?\n/).slice(0, 18).map((l) => l.split(sep).map((x) => x.replace(/^"|"$/g, '')));
  } else {
    const XLSX = await import('xlsx');
    const wb = XLSX.read(new Uint8Array(await fetchBytes(path, 60 * 1024 * 1024)), { type: 'array', sheetRows: 18 });
    rows = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' }) as string[][];
  }
  const [c, g] = canvasFor(size);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, c.width, c.height);
  const cols = Math.min(6, Math.max(1, ...rows.map((r) => r.length)));
  const cw = c.width / cols;
  const rh = c.height / 14;
  const fs = Math.max(4, rh * 0.5);
  rows.slice(0, 14).forEach((r, i) => {
    if (i === 0) {
      g.fillStyle = '#eef0ff';
      g.fillRect(0, 0, c.width, rh);
    }
    for (let j = 0; j < cols; j++) {
      g.font = `${i === 0 ? 700 : 400} ${fs}px -apple-system, "Segoe UI", sans-serif`;
      g.fillStyle = '#2b2b33';
      const v = String(r[j] ?? '');
      g.save();
      g.beginPath();
      g.rect(j * cw, i * rh, cw - 2, rh);
      g.clip();
      g.fillText(v, j * cw + fs * 0.5, i * rh + rh * 0.68);
      g.restore();
    }
    g.strokeStyle = '#e3e3ea';
    g.beginPath();
    g.moveTo(0, (i + 1) * rh);
    g.lineTo(c.width, (i + 1) * rh);
    g.stroke();
  });
  for (let j = 1; j < cols; j++) {
    g.beginPath();
    g.moveTo(j * cw, 0);
    g.lineTo(j * cw, c.height);
    g.stroke();
  }
  return c.toDataURL('image/png');
}

async function fontThumb(path: string, size: number): Promise<string> {
  const family = `kp-thumb-${Math.random().toString(36).slice(2)}`;
  const face = new FontFace(family, `url("${fileUrl(path)}")`);
  await face.load();
  document.fonts.add(face);
  const [c, g] = canvasFor(size);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#1b1b1f';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `${Math.round(size * 0.42)}px "${family}"`;
  g.fillText('Aa', c.width / 2, c.height * 0.46);
  g.font = `${Math.round(size * 0.075)}px "${family}"`;
  g.fillStyle = '#6b6b75';
  g.fillText('The quick brown fox', c.width / 2, c.height * 0.85);
  document.fonts.delete(face);
  return c.toDataURL('image/png');
}
