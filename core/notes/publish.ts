// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Publishing chosen notes as a static website (plain HTML files you can put
// on any web host), and the note composer: merging one note into another and
// extracting a selection into a new note, with links kept working.

import { renderNote } from './render';
import { splitFrontmatter } from './parse';
import { applyEdits, dirOf, extOf, relativePath, titleOf, type FileEdits, type LinkFormat, type VaultIndex } from './vault';

export interface SiteFile { path: string; content: string | { copyFrom: string } }

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** "Folder/My note.md" → "folder/my-note.html" */
export function pageName(path: string): string {
  return `${path.replace(/\.md$/i, '').split('/').map((p) => p.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'page').join('/')}.html`;
}

const CSS = `:root{color-scheme:light dark;--bg:#fff;--fg:#1f2328;--muted:#656d76;--accent:#7c3aed;--line:#d0d7de;--code:#f6f8fa}
@media (prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--muted:#8d96a0;--accent:#a78bfa;--line:#30363d;--code:#161b22}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.65 system-ui,-apple-system,Segoe UI,sans-serif}
.wrap{display:grid;grid-template-columns:260px minmax(0,1fr);min-height:100vh}nav{border-right:1px solid var(--line);padding:24px 16px;font-size:14px}
nav a{display:block;padding:3px 6px;border-radius:6px;color:var(--fg);text-decoration:none}nav a:hover,nav a.on{background:var(--code)}
main{max-width:760px;padding:32px 24px;width:100%}a{color:var(--accent)}a.is-unresolved{opacity:.6}pre{background:var(--code);padding:12px;border-radius:8px;overflow:auto}
code{background:var(--code);padding:.1em .3em;border-radius:4px}img{max-width:100%}mark{background:#fde68a;color:#111}
.callout{border-left:4px solid var(--accent);background:var(--code);padding:8px 14px;border-radius:6px;margin:1em 0}.callout-title{font-weight:600}
.tag{background:var(--code);border-radius:999px;padding:0 8px;text-decoration:none;font-size:.9em}.backlinks{border-top:1px solid var(--line);margin-top:48px;padding-top:16px;color:var(--muted);font-size:14px}
.nt-embed{border-left:2px solid var(--line);padding-left:12px;margin:1em 0}table{border-collapse:collapse}td,th{border:1px solid var(--line);padding:4px 10px}
@media (max-width:760px){.wrap{grid-template-columns:1fr}nav{border-right:0;border-bottom:1px solid var(--line)}}`;

/**
 * Builds a website from chosen notes: one page per note, links between
 * published notes kept (links to unpublished notes become plain text),
 * pictures they embed copied along, a contents list and backlinks.
 */
export function buildSite(vault: VaultIndex, paths: string[], opts: { title?: string; math?: (tex: string, display: boolean) => string } = {}): SiteFile[] {
  const chosen = new Set(paths.filter((p) => vault.note(p)));
  const files: SiteFile[] = [];
  const assets = new Set<string>();
  const sorted = [...chosen].sort((a, b) => a.localeCompare(b));
  for (const p of sorted) {
    const page = pageName(p);
    const rel = (target: string) => relativePath(dirOf(page), target);
    const text = vault.note(p)!.text;
    const html = renderNote(text, {
      resolve: (t) => {
        const r = vault.resolve(t, p);
        if (!r) return null;
        if (extOf(r) === 'md') return chosen.has(r) ? r : null;
        return r;
      },
      href: (r) => (extOf(r) === 'md' ? rel(pageName(r)) : rel(`files/${r}`)),
      src: (r) => { assets.add(r); return rel(`files/${r}`); },
      read: (r) => (chosen.has(r) ? vault.note(r)?.text ?? null : null),
      math: opts.math,
    });
    const back = vault.backlinks(p).filter((b) => chosen.has(b.source));
    const nav = sorted.map((q) => `<a href="${esc(rel(pageName(q)))}"${q === p ? ' class="on"' : ''}>${esc(titleOf(q))}</a>`).join('');
    const backHtml = back.length ? `<div class="backlinks"><strong>Linked from</strong><ul>${back.map((b) => `<li><a href="${esc(rel(pageName(b.source)))}">${esc(titleOf(b.source))}</a></li>`).join('')}</ul></div>` : '';
    files.push({ path: page, content: doc(titleOf(p), opts.title ?? 'Notes', rel('style.css'), nav, `<h1>${esc(titleOf(p))}</h1>${html}${backHtml}`) });
  }
  const indexNav = sorted.map((q) => `<a href="${esc(pageName(q))}">${esc(titleOf(q))}</a>`).join('');
  files.push({ path: 'index.html', content: doc(opts.title ?? 'Notes', opts.title ?? 'Notes', 'style.css', indexNav, `<h1>${esc(opts.title ?? 'Notes')}</h1><ul>${sorted.map((q) => `<li><a href="${esc(pageName(q))}">${esc(titleOf(q))}</a></li>`).join('')}</ul>`) });
  files.push({ path: 'style.css', content: CSS });
  for (const a of assets) files.push({ path: `files/${a}`, content: { copyFrom: a } });
  return files;
}

function doc(title: string, site: string, css: string, nav: string, main: string): string {
  // Plain pages: no scripts, so a published site cannot run anything.
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · ${esc(site)}</title><link rel="stylesheet" href="${esc(css)}"></head><body><div class="wrap"><nav><strong>${esc(site)}</strong>${nav}</nav><main>${main}</main></div></body></html>\n`;
}

// ---------------------------------------------------------------- note composer

/**
 * Merges `from` into `into` (appended, its properties combined), and points
 * every link at `from` to `into`. The caller deletes `from` afterwards.
 */
export function mergeNotes(vault: VaultIndex, from: string, into: string, format: LinkFormat = 'shortest'): { into: string; text: string; edits: FileEdits[] } {
  const a = vault.note(into)!.text;
  const b = vault.note(from)!.text;
  const bBody = splitFrontmatter(b).body.replace(/^\s+/, '');
  const text = `${a.replace(/\s*$/, '')}\n\n${bBody}`;
  const edits = vault.renameEdits([{ from, to: into }], format).filter((e) => e.path !== into);
  return { into, text: text.endsWith('\n') ? text : `${text}\n`, edits };
}

/** Moves a selection into a new note and leaves a link (or an embed) in its place. */
export function extractSelection(text: string, from: number, to: number, newTitle: string, mode: 'link' | 'embed' | 'none' = 'link'): { source: string; extracted: string } {
  const sel = text.slice(from, to);
  const ref = mode === 'none' ? '' : `${mode === 'embed' ? '!' : ''}[[${newTitle}]]`;
  return { source: applyEdits(text, [{ from, to, insert: ref }]), extracted: sel.endsWith('\n') ? sel : `${sel}\n` };
}
