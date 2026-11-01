// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Batch rename: preview every new name before anything changes on disk.

import type { FileEntry } from './types';

export type RenameStep =
  | { type: 'replace'; find: string; with: string; regex?: boolean; caseSensitive?: boolean }
  | { type: 'prefix'; text: string }
  | { type: 'suffix'; text: string }
  | { type: 'case'; to: 'lower' | 'upper' | 'title' | 'sentence' }
  /** {n} counter, {n:3} zero-padded, {name} original name, {ext}, {date} yyyy-MM-dd of mtime, {yyyy} {MM} {dd} */
  | { type: 'template'; pattern: string; start?: number; step?: number }
  | { type: 'trim' }
  | { type: 'cleanup' }
  | { type: 'extension'; to: string };

export interface RenamePreview {
  from: string;
  to: string;
  newName: string;
  changed: boolean;
  conflict?: string;
}

const ILLEGAL = /[<>:"/\\|?*\x00-\x1f]/g;

function splitName(name: string): [string, string] {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
}

/** Works for both / and \ paths without Node's path module, so the interface can preview too. */
function dirOf(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i >= 0 ? p.slice(0, i) : '';
}

function sepOf(p: string): string {
  return p.includes('\\') && !p.includes('/') ? '\\' : '/';
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|[\s_\-.(])(\p{L})/gu, (_m, a: string, b: string) => a + b.toUpperCase());
}

function applyStep(base: string, ext: string, step: RenameStep, i: number, f: FileEntry): [string, string] {
  switch (step.type) {
    case 'replace': {
      if (!step.find) return [base, ext];
      const flags = step.caseSensitive ? 'g' : 'gi';
      const re = step.regex ? safeRegExp(step.find, flags) : new RegExp(step.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
      return re ? [base.replace(re, step.with), ext] : [base, ext];
    }
    case 'prefix': return [step.text + base, ext];
    case 'suffix': return [base + step.text, ext];
    case 'case': {
      const fn = step.to === 'lower' ? (s: string) => s.toLowerCase() : step.to === 'upper' ? (s: string) => s.toUpperCase() : step.to === 'title' ? titleCase : (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
      return [fn(base), ext];
    }
    case 'template': {
      const d = new Date(f.mtime);
      const n = (step.start ?? 1) + i * (step.step ?? 1);
      const out = step.pattern.replace(/\{(\w+)(?::(\d+))?\}/g, (m, key: string, pad?: string) => {
        switch (key) {
          case 'n': return pad ? String(n).padStart(+pad, '0') : String(n);
          case 'name': return base;
          case 'ext': return ext.replace(/^\./, '');
          case 'date': return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          case 'yyyy': return String(d.getFullYear());
          case 'MM': return String(d.getMonth() + 1).padStart(2, '0');
          case 'dd': return String(d.getDate()).padStart(2, '0');
          case 'kind': return f.kind;
          case 'source': return f.source?.name ?? '';
          default: return m;
        }
      });
      return [out, ext];
    }
    case 'trim': return [base.trim().replace(/\s{2,}/g, ' '), ext];
    case 'cleanup': return [base.replace(/[_]+/g, ' ').replace(/\s*\(\d+\)$/, '').replace(/\s+copy(\s\d+)?$/i, '').replace(/\s{2,}/g, ' ').trim(), ext];
    case 'extension': return [base, step.to ? '.' + step.to.replace(/^\./, '') : ''];
  }
}

function safeRegExp(src: string, flags: string): RegExp | null {
  try {
    return new RegExp(src, flags);
  } catch {
    return null;
  }
}

/**
 * Applies every step to every file and reports conflicts: two files ending up
 * with the same name, a name that already exists, or an illegal name.
 */
export function previewRename(files: FileEntry[], steps: RenameStep[], exists: (p: string) => boolean = () => false): RenamePreview[] {
  const out: RenamePreview[] = files.map((f, i) => {
    let [base, ext] = splitName(f.name);
    for (const s of steps) [base, ext] = applyStep(base, ext, s, i, f);
    const newName = (base + ext).replace(ILLEGAL, '-');
    const to = dirOf(f.path) + sepOf(f.path) + newName;
    return { from: f.path, to, newName, changed: newName !== f.name };
  });
  const seen = new Map<string, number>();
  for (const p of out) seen.set(p.to.toLowerCase(), (seen.get(p.to.toLowerCase()) ?? 0) + 1);
  const sources = new Set(out.map((p) => p.from.toLowerCase()));
  for (const p of out) {
    if (!p.newName.replace(/\.[^.]*$/, '').trim()) p.conflict = 'Name would be empty';
    else if (p.newName.length > 255) p.conflict = 'Name is too long';
    else if ((seen.get(p.to.toLowerCase()) ?? 0) > 1) p.conflict = 'Two files would get this name';
    else if (p.changed && p.from.toLowerCase() !== p.to.toLowerCase() && !sources.has(p.to.toLowerCase()) && exists(p.to)) p.conflict = 'A file with this name already exists';
  }
  return out;
}
