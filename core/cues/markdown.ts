// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Cues are kept as plain Markdown files with a small front-matter block, so
// they sync with Keeper Sync like any file, open in any editor, and are found
// by search and the brain. Reusable checklists are Markdown too.

import { dedupeAnchors, type AnchorKind, type ChecklistItem, type Cue, type CueAnchor, type CueRepeat, type CueTemplate, type CueType } from './model';

const KINDS: AnchorKind[] = ['app', 'site', 'page', 'title', 'file'];
const TYPES: CueType[] = ['note', 'checklist', 'link', 'file'];
const REPEATS: CueRepeat[] = ['daily', 'weekdays', 'weekly', 'monthly', 'yearly'];

const iso = (t: number | undefined) => (t === undefined ? undefined : new Date(t).toISOString());
const time = (v: unknown): number | undefined => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v !== 'string' || !v) return undefined;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : undefined;
};

/** One value per line; strings are JSON-quoted so colons and quotes are safe. */
function yamlLine(k: string, v: unknown): string | null {
  if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) return null;
  if (typeof v === 'boolean' || typeof v === 'number') return `${k}: ${v}`;
  if (Array.isArray(v)) return `${k}: [${v.map((x) => JSON.stringify(String(x))).join(', ')}]`;
  return `${k}: ${JSON.stringify(String(v))}`;
}

function readValue(raw: string): unknown {
  const v = raw.trim();
  if (v === 'true' || v === 'false') return v === 'true';
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (v.startsWith('[') || v.startsWith('"')) {
    try {
      return JSON.parse(v);
    } catch {
      /* fall through */
    }
  }
  return v.replace(/^'(.*)'$/, '$1');
}

function frontMatter(text: string): { meta: Record<string, unknown>; body: string } {
  const t = text.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const m = t.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { meta: {}, body: t };
  const meta: Record<string, unknown> = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (kv) meta[kv[1]] = readValue(kv[2]);
  }
  return { meta, body: t.slice(m[0].length) };
}

/** "app: Figma", "site: github.com" — one anchor per entry. */
function anchorsToList(a: CueAnchor[]): string[] {
  return a.map((x) => `${x.kind}: ${x.value}${x.label ? ` | ${x.label}` : ''}`);
}

function anchorsFromList(v: unknown): CueAnchor[] {
  if (!Array.isArray(v)) return [];
  const out: CueAnchor[] = [];
  for (const s of v) {
    const m = String(s).match(/^(\w+):\s*(.*?)(?:\s+\|\s+(.*))?$/);
    if (!m || !KINDS.includes(m[1] as AnchorKind)) continue;
    out.push({ kind: m[1] as AnchorKind, value: m[2], label: m[3] || undefined });
  }
  return dedupeAnchors(out);
}

export function cueToMarkdown(c: Cue): string {
  const lines = [
    yamlLine('keeper', 'cue'), yamlLine('id', c.id), yamlLine('type', c.type), yamlLine('title', c.title),
    yamlLine('anchors', anchorsToList(c.anchors)), yamlLine('url', c.url), yamlLine('files', c.files),
    yamlLine('due', iso(c.due)), yamlLine('repeat', c.repeat), yamlLine('snoozed', iso(c.snoozedUntil)), yamlLine('nextVisit', c.snoozeNextVisit || undefined),
    yamlLine('show', c.show === 'once' ? 'once' : undefined), yamlLine('done', c.done || undefined), yamlLine('doneAt', iso(c.doneAt)),
    yamlLine('created', iso(c.createdAt)), yamlLine('updated', iso(c.updatedAt)), yamlLine('shown', iso(c.shownAt)), yamlLine('rang', iso(c.rangFor)),
    yamlLine('template', c.templateId), yamlLine('tags', c.tags), yamlLine('pinned', c.pinned || undefined), yamlLine('deleted', iso(c.deletedAt)),
  ].filter((l): l is string => !!l);
  const items = (c.items ?? []).map((i) => `- [${i.done ? 'x' : ' '}] ${i.skipped ? '~~' : ''}${i.text.replace(/\n/g, ' ')}${i.skipped ? '~~' : ''}`);
  const parts = [`---\n${lines.join('\n')}\n---`, `# ${c.title.replace(/\n/g, ' ')}`];
  if (c.url) parts.push(`<${c.url}>`);
  if (c.body.trim()) parts.push(c.body.trim());
  if (items.length) parts.push(items.join('\n'));
  if (c.files?.length) parts.push(c.files.map((f) => `- [${f.split(/[\\/]/).pop()}](${encodeURI(`file://${f.startsWith('/') ? '' : '/'}${f.replace(/\\/g, '/')}`)})`).join('\n'));
  return parts.join('\n\n') + '\n';
}

/** Reads a cue file back. Edits made in another editor (title, body, ticks) are kept. */
export function cueFromMarkdown(text: string, fallbackId = ''): Cue | null {
  const { meta, body } = frontMatter(text);
  if (meta.keeper !== 'cue') return null;
  const id = String(meta.id ?? fallbackId);
  if (!id) return null;
  let rest = body.replace(/^\s*#\s+(.*)\n?/, '');
  const heading = body.match(/^\s*#\s+(.*)/)?.[1]?.trim();
  const url = typeof meta.url === 'string' ? meta.url : undefined;
  if (url) rest = rest.replace(`<${url}>`, '');
  const items: ChecklistItem[] = [];
  const files = Array.isArray(meta.files) ? meta.files.map(String) : undefined;
  const keep: string[] = [];
  for (const line of rest.split('\n')) {
    const m = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.*)$/);
    if (m) {
      const skipped = /^~~.*~~$/.test(m[2].trim());
      items.push({ id: `i${items.length}`, text: m[2].trim().replace(/^~~(.*)~~$/, '$1'), done: m[1] !== ' ', skipped: skipped || undefined });
    } else if (files?.length && /^\s*-\s+\[[^\]]*\]\(file:\/\//.test(line)) {
      /* the file list is written from the front matter */
    } else keep.push(line);
  }
  const type = TYPES.includes(meta.type as CueType) ? (meta.type as CueType) : items.length ? 'checklist' : 'note';
  const created = time(meta.created) ?? 0;
  return {
    id, type, title: heading || String(meta.title ?? 'Cue'), body: keep.join('\n').trim(), url, files,
    items: items.length || type === 'checklist' ? items : undefined,
    anchors: anchorsFromList(meta.anchors), due: time(meta.due), repeat: REPEATS.includes(meta.repeat as CueRepeat) ? (meta.repeat as CueRepeat) : undefined,
    snoozedUntil: time(meta.snoozed), snoozeNextVisit: meta.nextVisit === true || undefined, show: meta.show === 'once' ? 'once' : 'every',
    done: meta.done === true, doneAt: time(meta.doneAt), createdAt: created, updatedAt: time(meta.updated) ?? created, shownAt: time(meta.shown), rangFor: time(meta.rang),
    templateId: typeof meta.template === 'string' ? meta.template : undefined, tags: Array.isArray(meta.tags) ? meta.tags.map(String) : undefined,
    pinned: meta.pinned === true || undefined, deletedAt: time(meta.deleted),
  };
}

export function templateToMarkdown(t: CueTemplate): string {
  const lines = [yamlLine('keeper', 'checklist'), yamlLine('id', t.id), yamlLine('anchors', anchorsToList(t.anchors ?? [])), yamlLine('created', iso(t.createdAt)), yamlLine('used', iso(t.usedAt))].filter(Boolean);
  return `---\n${lines.join('\n')}\n---\n\n# ${t.name}\n\n${t.items.map((i) => `- [ ] ${i}`).join('\n')}\n`;
}

export function templateFromMarkdown(text: string, fallbackId = ''): CueTemplate | null {
  const { meta, body } = frontMatter(text);
  if (meta.keeper !== 'checklist') return null;
  const name = body.match(/^\s*#\s+(.*)/m)?.[1]?.trim() ?? 'Checklist';
  const items = [...body.matchAll(/^\s*[-*]\s+(?:\[[ xX]\]\s+)?(.+)$/gm)].map((m) => m[1].trim());
  const anchors = anchorsFromList(meta.anchors);
  return { id: String(meta.id ?? fallbackId), name, items, anchors: anchors.length ? anchors : undefined, createdAt: time(meta.created) ?? 0, usedAt: time(meta.used) };
}

/** A safe, readable file name: "2026-10-31 Send the invoice (k3x9a).md". */
export function cueFileName(c: Cue): string {
  const d = new Date(c.createdAt || Date.now());
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const title = c.title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Cue';
  return `${day} ${title} (${c.id}).md`;
}

/** The id inside a cue file name, so a renamed title still finds its file. */
export function idFromFileName(name: string): string | undefined {
  return name.match(/\(([a-z0-9]{6,20})\)\.md$/i)?.[1];
}

/** All cues as one Markdown document (export). */
export function exportMarkdown(cues: Cue[]): string {
  return cues.filter((c) => !c.deletedAt).map((c) => cueToMarkdown(c).replace(/^---[\s\S]*?---\n\n/, '')).join('\n---\n\n');
}
