// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Taking notes out of a vault: a Markdown folder with the pictures and files
// the notes use (optionally with plain Markdown links for apps without
// [[links]]), an Evernote .enex, and one self-contained web page per note
// (for HTML and PDF). Pure: the main process reads and writes the disk.

import { writeEnex, type EnexInput } from '../notes-sync/connectors/evernote';
import { parseNote, splitFrontmatter } from './parse';
import { isNote, type VaultIndex } from './vault';
import type { YamlValue } from './yaml';

export interface ExportFile { path: string; text?: string; copyFrom?: string }

const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const base = (p: string) => p.slice(p.lastIndexOf('/') + 1);

/** A path from one file's folder to another file ("a/b.md" → "c/d.png" = "../c/d.png"). */
export function relPath(fromFile: string, to: string): string {
  const a = dirOf(fromFile).split('/').filter(Boolean);
  const b = to.split('/');
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/');
}

const encodePath = (p: string) => p.split('/').map(encodeURIComponent).join('/');

/** [[links]] and ![[embeds]] written as plain Markdown links, for apps that only read those. */
export function plainLinks(text: string, from: string, resolve: (target: string) => string | null): string {
  const parsed = parseNote(text);
  let out = '';
  let at = 0;
  for (const l of parsed.links.filter((x) => x.kind === 'wiki' && !x.inProps).sort((x, y) => x.from - y.from)) {
    const to = l.target ? resolve(l.target) : from;
    const shown = l.alias ?? (l.target ? base(l.target).replace(/\.md$/, '') : l.subpath ?? '');
    const anchor = l.subpath ? `#${encodeURIComponent(l.subpath.replace(/^\^/, ''))}` : '';
    const href = to ? encodePath(relPath(from, to)) : encodePath(`${l.target}.md`);
    out += text.slice(at, l.from) + (l.embed && to && !isNote(to) ? `![${shown}](${href})` : `[${shown}](${href}${anchor})`);
    at = l.to;
  }
  return out + text.slice(at);
}

/** The notes (all, or the chosen ones) and every file they link to or embed, keeping the vault's layout. */
export function markdownExport(vault: VaultIndex, paths: string[] | null, opts: { plain?: boolean } = {}): ExportFile[] {
  const notes = (paths ?? vault.allFiles().map((f) => f.path)).filter(isNote);
  const out: ExportFile[] = [];
  const extra = new Set<string>();
  for (const p of notes) {
    const text = vault.note(p)?.text ?? '';
    for (const l of vault.outgoing(p)) if (l.resolved && !isNote(l.resolved)) extra.add(l.resolved);
    out.push(opts.plain ? { path: p, text: plainLinks(text, p, (t) => vault.resolve(t, p)) } : { path: p, copyFrom: p });
  }
  for (const p of [...extra].sort()) if (!notes.includes(p)) out.push({ path: p, copyFrom: p });
  return out;
}

/** One vault note as Evernote sees one: title, tags (properties and #tags), dates and the files it embeds. */
export function enexNote(path: string, text: string, opts: { mtime: number; ctime: number; resolve: (target: string) => string | null; read: (path: string) => Uint8Array | null }): EnexInput {
  const parsed = parseNote(text);
  const props = parsed.props as Record<string, YamlValue>;
  const { body } = splitFrontmatter(text);
  const files: NonNullable<EnexInput['files']> = [];
  // ![[picture.png]] → ![picture.png](picture.png) with the bytes alongside.
  const md = body.replace(/!\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (all, target: string) => {
    const to = opts.resolve(target.trim());
    if (!to || isNote(to)) return all;
    const data = opts.read(to);
    if (!data) return all;
    const name = base(to);
    if (!files.some((f) => f.link === name)) files.push({ link: name, name, data, mime: mimeOf(name) });
    return `![${name}](${name})`;
  }).replace(/(?<!!)\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_all, target: string, alias?: string) => alias ?? target);
  const tagSet = new Set<string>();
  for (const t of parsed.tags) tagSet.add(t.tag.replace(/^#/, ''));
  const timeProp = (k: string) => (typeof props[k] === 'string' ? Date.parse(props[k] as string) : NaN);
  const created = timeProp('created');
  const modified = timeProp('modified');
  const aliases = Array.isArray(props.aliases) ? props.aliases.map(String) : [];
  return {
    title: aliases[0] ?? base(path).replace(/\.md$/, ''),
    body: md.replace(/^\n+/, ''),
    tags: [...tagSet],
    created: Number.isFinite(created) ? created : opts.ctime,
    modified: Number.isFinite(modified) ? modified : opts.mtime,
    files,
  };
}

export function enexExport(notes: EnexInput[]): string {
  return writeEnex(notes);
}

const MIMES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', pdf: 'application/pdf', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', mp4: 'video/mp4' };
export const mimeOf = (name: string) => MIMES[(/\.([^.]+)$/.exec(name)?.[1] ?? '').toLowerCase()] ?? 'application/octet-stream';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A note's rendered HTML as one page that needs nothing else (pictures already inside as data). */
export function htmlPage(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
:root { color-scheme: light; }
body { margin: 0; background: #fff; color: #18181b; font: 16px/1.7 -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; }
main { max-width: 70ch; margin: 0 auto; padding: 48px 24px 64px; }
h1, h2, h3 { line-height: 1.25; } h1 { font-size: 2em; margin-top: 0; }
a { color: #4b4bd6; } img { max-width: 100%; border-radius: 6px; }
pre { background: #f4f4f5; padding: 12px 14px; border-radius: 8px; overflow: auto; font-size: 14px; }
code { font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace; font-size: .9em; }
:not(pre) > code { background: #f4f4f5; padding: 1px 5px; border-radius: 4px; }
table { border-collapse: collapse; margin: 1em 0; } th, td { border: 1px solid #e4e4e7; padding: 4px 10px; }
blockquote { border-left: 3px solid #e4e4e7; margin: 1em 0; padding: 0 14px; color: #52525b; }
.task-list-item { list-style: none; margin-left: -1.3em; } .task-list-item.is-checked { color: #71717a; text-decoration: line-through; }
mark { background: #fde68a; } .callout { border-left: 3px solid #4b4bd6; background: #f4f4ff; padding: 10px 14px; border-radius: 8px; margin: 1em 0; }
.nt-embed { border-left: 3px solid #e4e4e7; padding-left: 14px; } .nt-missing { color: #71717a; }
@media print { main { padding: 0; } a { color: inherit; } }
</style></head>
<body><main><h1>${esc(title)}</h1>
${bodyHtml}
</main></body></html>
`;
}

export function dataUri(name: string, data: Uint8Array): string {
  let s = '';
  for (let i = 0; i < data.length; i += 0x8000) s += String.fromCharCode(...data.subarray(i, i + 0x8000));
  return `data:${mimeOf(name)};base64,${btoa(s)}`;
}
