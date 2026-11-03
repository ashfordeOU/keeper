// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Notes in the browser demo: one sample vault held in memory, run by the
// same core code as the app (links, search, bases, templates, canvas).

import type { NotesApi, NotesSettings, VaultInfo } from '../core/api-notes';
import { display, parseBase, runBase } from '../core/notes/bases';
import { DEFAULT_CONFIG, freeName, newNoteFolder, type Bookmark } from '../core/notes/config';
import { extractSelection, mergeNotes } from '../core/notes/publish';
import { renderNote } from '../core/notes/render';
import { sectionText, splitLinkInner } from '../core/notes/parse';
import { searchVault } from '../core/notes/search';
import { fillTemplate, periodicPath, shiftPeriod } from '../core/notes/templates';
import { applyEdits, dirOf, isNote, titleOf, VaultIndex, type VaultFile } from '../core/notes/vault';

const SAMPLE: Record<string, string> = {
  'Welcome.md': `---
tags: [start]
aliases: [Home]
---
# Welcome to your vault

Notes are plain Markdown files in a folder, so other notes apps open the same vault.

- Link notes with [[Projects/Garden plan|double brackets]]; see who links back in the side panel.
- Keep tasks: see [[Reading list]].
- Draw on a [[Ideas.canvas|canvas]], or see your books in [[Books.base]].

> [!tip] Try it
> Press **Ctrl+O** to jump to a note, **Ctrl+Shift+F** to search with \`tag:#project\` or \`path:Projects\`.

$$e^{i\\pi} + 1 = 0$$

\`\`\`mermaid
graph LR
  Idea --> Note --> Link
\`\`\`
`,
  'Projects/Garden plan.md': `---
status: active
due: 2026-11-15
tags: [project, home/garden]
---
# Garden plan

Plant bulbs before the first frost. Ask about the soil test ^soil

## Tasks
- [ ] Buy tulip bulbs
- [x] Clear the bed
- [ ] Order compost #todo

See also [[Reading list#Gardening]].
`,
  'Reading list.md': `# Reading list

## Gardening
- [ ] The Well-Tempered Garden

## Novels
- [x] [[Books/Dune|Dune]]
`,
  'Books/Dune.md': `---
tags: [book]
author: Frank Herbert
rating: 5
status: done
---
A desert planet. Mentions the garden plan in passing.
`,
  'Books/Emma.md': `---
tags: [book]
author: Jane Austen
rating: 4
status: reading
---
`,
  'Books.base': `filters:
  and:
    - file.hasTag("book")
views:
  - type: table
    name: All books
    order: [file.name, author, rating, status]
    sort:
      - property: rating
        direction: DESC
  - type: cards
    name: Reading
    filters: 'status == "reading"'
`,
  'Ideas.canvas': JSON.stringify({ nodes: [
    { id: 'a1b2c3d4e5f60718', type: 'text', text: '# Ideas\nGrow herbs indoors', x: -200, y: -80, width: 260, height: 120, color: '4' },
    { id: 'b1b2c3d4e5f60718', type: 'file', file: 'Projects/Garden plan.md', x: 160, y: -120, width: 320, height: 240 },
  ], edges: [{ id: 'e1b2c3d4e5f60718', fromNode: 'a1b2c3d4e5f60718', fromSide: 'right', toNode: 'b1b2c3d4e5f60718', toSide: 'left', toEnd: 'arrow' }] }, null, '\t'),
  'Templates/Daily.md': '# {{date:dddd, MMMM D}}\n\n## Plan\n- [ ] \n\n## Notes\n',
};

export function mockNotes(emit: (channel: string, ...args: unknown[]) => void): { notes: NotesApi } {
  const index = new VaultIndex();
  const texts = new Map<string, string>();
  const folders = new Set<string>(['Projects', 'Books', 'Templates']);
  let settings: NotesSettings = { ai: false, agentsCanEdit: false, snapshotMinutes: 5, snapshotDays: 7 };
  let bookmarks: Bookmark[] = [{ type: 'file', path: 'Welcome.md' }];
  const config = { ...DEFAULT_CONFIG, periodic: { ...DEFAULT_CONFIG.periodic, day: { enabled: true, folder: 'Daily', format: 'YYYY-MM-DD', template: 'Templates/Daily' } }, templates: { ...DEFAULT_CONFIG.templates, folder: 'Templates' } };
  const info: VaultInfo = { id: 'demo', name: 'Demo vault', path: '/Users/demo/Notes', shared: true, openedAt: Date.now() };
  const put = (p: string, t: string) => {
    texts.set(p, t);
    const f: VaultFile = { path: p, mtime: Date.now(), ctime: Date.now() - 86_400_000, size: t.length };
    index.set(f, isNote(p) ? t : undefined);
    if (dirOf(p)) folders.add(dirOf(p));
    return f;
  };
  for (const [p, t] of Object.entries(SAMPLE)) put(p, t);
  const changed = (paths: string[]) => emit('notes-changed', { vault: 'demo', paths });

  const notes: NotesApi = {
    vaults: async () => [info],
    addVault: async () => info,
    createVault: async () => info,
    removeVault: async () => [info],
    open: async () => ({ ...info, config, files: index.allFiles(), folders: [...folders].sort(), took: 1 }),
    close: async () => undefined,
    vaultPath: async () => info.path,
    read: async (_v, p) => texts.get(p) ?? '',
    write: async (_v, p, t) => put(p, t),
    create: async (_v, p, t = '') => { if (texts.has(p)) throw new Error(`${p} already exists`); return put(p, t); },
    createFolder: async (_v, p) => { folders.add(p); },
    newNote: async (_v, o = {}) => { const p = freeName((x) => texts.has(x), o.folder ?? newNoteFolder(config, o.activePath), o.title ?? 'Untitled', 'md'); put(p, o.text ?? ''); return p; },
    remove: async (_v, p) => { for (const k of [...texts.keys()]) if (k === p || k.startsWith(`${p}/`)) { texts.delete(k); index.remove(k); } folders.delete(p); },
    rename: async (_v, from, to) => {
      if (!/\.\w+$/.test(to) && /\.\w+$/.test(from)) to += from.slice(from.lastIndexOf('.'));
      const moves = texts.has(from) ? [{ from, to }] : [...texts.keys()].filter((k) => k.startsWith(`${from}/`)).map((k) => ({ from: k, to: to + k.slice(from.length) }));
      const edits = index.renameEdits(moves);
      const out = new Map<string, string>();
      for (const e of edits) {
        const old = moves.find((m) => m.to === e.path)?.from ?? e.path;
        out.set(e.path, applyEdits(texts.get(old) ?? '', e.edits));
      }
      for (const m of moves) { const t = texts.get(m.from)!; texts.delete(m.from); texts.set(m.to, t); }
      index.applyRename(moves, out);
      for (const [p, t] of out) texts.set(p, t);
      if (dirOf(to)) folders.add(dirOf(to));
      return { changed: [...out.keys()], to };
    },
    saveAttachment: async (_v, _n, name) => { put(name, ''); return name; },
    fileUrl: async (_v, p) => p,
    reveal: async () => undefined,
    backlinks: async (_v, p) => index.backlinks(p).map((b) => ({ source: b.source, links: b.links.map((l) => ({ ...l, context: (texts.get(b.source) ?? '').split('\n')[l.line] ?? '' })) })),
    outgoing: async (_v, p) => index.outgoing(p),
    unlinked: async (_v, p) => index.unlinkedMentions(p),
    linkMention: async (_v, s, from, to, target) => { put(s, applyEdits(texts.get(s) ?? '', [{ from, to, insert: `[[${titleOf(target)}]]` }])); },
    tags: async () => index.tags(),
    search: async (_v, q, o = {}) => searchVault(index.allFiles(), (p) => index.note(p), q, { limit: o.limit ?? 200, caseSensitive: o.caseSensitive }),
    suggest: async (_v, q) => index.suggest(q, 40).map((x) => ({ ...x, link: index.linkText(x.path, '', 'shortest', 'wiki') })),
    resolve: async (_v, t, from) => index.resolve(t, from),
    unresolved: async () => [...index.unresolved()].map(([target, l]) => ({ target, sources: l.map((x) => x.source) })),
    graph: async (_v, o = {}) => (o.center ? index.localGraph(o.center, o.depth ?? 1, o) : index.graph(o)),
    random: async () => { const n = index.allNotes(); return n[Math.floor(Math.random() * n.length)]?.path ?? null; },
    periodic: async (_v, period, date, offset = 0) => {
      const d = shiftPeriod(date ? new Date(date) : new Date(), period, offset);
      const p = periodicPath(d, period, config.periodic[period]);
      if (texts.has(p)) return { path: p, created: false };
      put(p, fillTemplate(texts.get('Templates/Daily.md') ?? '', { title: titleOf(p), date: d }));
      changed([p]);
      return { path: p, created: true };
    },
    templates: async () => [...texts.keys()].filter((k) => k.startsWith('Templates/')),
    fillTemplate: async (_v, t, p) => fillTemplate(texts.get(t) ?? '', { title: titleOf(p) }),
    base: async (_v, o) => {
      const def = parseBase(o.text ?? texts.get(o.path ?? '') ?? '');
      const r = runBase(def, index, o.view ?? 0, { thisFile: o.thisFile });
      const rows = r.rows.map((x) => ({ path: x.path, cells: Object.fromEntries(Object.entries(x.cells).map(([k, v]) => [k, display(v)])) }));
      return { ...r, rows, views: def.views.map((v) => ({ name: v.name, type: v.type })), display: rows.map((x) => x.cells as Record<string, string>) };
    },
    merge: async (_v, from, into) => { const m = mergeNotes(index, from, into); put(into, m.text); for (const e of m.edits) put(e.path, applyEdits(texts.get(e.path) ?? '', e.edits)); texts.delete(from); index.remove(from); },
    extract: async (_v, p, from, to, title, mode) => { const target = freeName((x) => texts.has(x), dirOf(p), title, 'md'); const r = extractSelection(texts.get(p) ?? '', from, to, titleOf(target), mode); put(target, r.extracted); put(p, r.source); return target; },
    publish: async (_v, paths) => ({ out: '/Users/demo/Site', files: paths.length + 2 }),
    render: async (_v, p, o = {}) => renderNote(o.text ?? texts.get(p) ?? '', { resolve: (t) => index.resolve(t, p), href: (x) => `#${encodeURI(x)}`, read: (x) => texts.get(x) ?? null }),
    preview: async (_v, target, from) => {
      const l = splitLinkInner(target);
      const r = l.target ? index.resolve(l.target, from) : from;
      if (!r) return null;
      const t = texts.get(r) ?? '';
      const part = l.subpath ? sectionText(t, l.subpath) ?? t : t;
      return { path: r, html: renderNote(part, { resolve: (x) => index.resolve(x, r), href: (x) => `#${encodeURI(x)}` }) };
    },
    snapshots: async () => [{ id: `${Date.now() - 3_600_000}.md`, at: Date.now() - 3_600_000, size: 200 }],
    snapshot: async (_v, p) => texts.get(p) ?? '',
    bookmarks: async () => bookmarks,
    setBookmarks: async (_v, items) => { bookmarks = items; },
    capture: async (text) => { const { path: p } = await notes.periodic('demo', 'day'); put(p, `${texts.get(p) ?? ''}- ${text}\n`); return { path: p }; },
    settings: async () => settings,
    setSettings: async (patch) => (settings = { ...settings, ...patch }),
    ask: async (_v, q) => (settings.ai ? { text: `From your notes: bulbs go in before the first frost [[Garden plan]]. (${q})`, cites: ['Projects/Garden plan.md'], provider: 'Demo' } : { text: '', cites: [], error: 'AI for notes is off. Turn it on in Notes → Settings.' }),
    assist: async () => (settings.ai ? { text: '- A demo summary.', cites: [] } : { text: '', cites: [], error: 'AI for notes is off.' }),
    plugins: async () => ({ keeper: [], foreign: [{ id: 'dataview', name: 'Dataview' }] }),
    pluginCode: async () => '',
    setPlugin: async () => undefined,
    importPick: async () => null,
    importPreview: async () => { throw new Error('Importing works in the Keeper app.'); },
    importRun: async () => { throw new Error('Importing works in the Keeper app.'); },
    importCancel: async () => undefined,
    imports: async () => [],
    importUndo: async () => ({ removed: 0, kept: [] }),
    exportNotes: async () => null,
  };
  return { notes };
}
