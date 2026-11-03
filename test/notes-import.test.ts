// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Importing notes from every app Keeper reads from files, end to end on
// made-up exports (test/fixtures/notes-import/make.mjs): titles, dates,
// folders, tags, checklists, tables, pictures and files, links between notes
// and unicode. Then exports and round trips (export → import → equal), the
// service writing into a real vault with Undo, and 5,000 notes.

import { promises as fsp, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const ROOT = await fsp.mkdtemp(path.join(os.tmpdir(), 'kn-import-'));
vi.mock('electron', () => ({
  app: { getPath: (k: string) => path.join(ROOT, k) },
  shell: { trashItem: async (p: string) => (await import('node:fs')).promises.rm(p, { recursive: true, force: true }), openPath: async () => '' },
  dialog: {},
  BrowserWindow: class {},
}));
vi.mock('../electron/store', () => ({ getSecret: async () => undefined, setSecret: async () => true, settings: () => ({}) }));

// @ts-expect-error a plain .mjs script, shared with the end-to-end test
const { makeFixtures, PICS } = await import('./fixtures/notes-import/make.mjs') as { makeFixtures: (dir: string) => Record<string, string>; PICS: Record<string, Buffer> };
const { planImport, readImport, joinRel, bearTags, importFolderName } = await import('../core/notes/importer');
const { gatherFiles, importPreview, importRun, importUndo, importsList, exportNotes } = await import('../electron/services/notes-io');
const notes = await import('../electron/services/notes');
const { relPath, plainLinks, enexNote, enexExport } = await import('../core/notes/exporter');
const { VaultIndex } = await import('../core/notes/vault');
const { readZip } = await import('../core/notes-sync/archive');

type Plan = ReturnType<typeof planImport>;
let FX: Record<string, string>;
const dec = new TextDecoder();
const noteText = (plan: Plan, endsWith: string) => { const f = plan.files.find((x) => x.note && x.path.endsWith(endsWith)); return f ? dec.decode(f.data) : undefined; };
const paths = (plan: Plan) => plan.files.map((f) => f.path).sort();
const run = async (source: Parameters<typeof readImport>[0], p: string, opts: { masterKey?: string } = {}) => {
  const b = readImport(source, await gatherFiles(p), opts);
  return planImport(b, { folder: 'In', app: source });
};

beforeAll(async () => { FX = makeFixtures(path.join(ROOT, 'fx')); });
afterAll(async () => { await fsp.rm(ROOT, { recursive: true, force: true }); }, 60_000);

describe('helpers', () => {
  it('joins relative links and finds Bear tags', () => {
    expect(joinRel('a/b', '../c/d.png')).toBe('a/c/d.png');
    expect(joinRel('', './x.png')).toBe('x.png');
    expect(bearTags('Feed it #food/baking #quick meals# and `#notatag`')).toEqual(['quick meals', 'food/baking']);
    expect(importFolderName('Evernote', (f) => f === 'From Evernote')).toBe('From Evernote 2');
    expect(relPath('a/b.md', 'c/d.png')).toBe('../c/d.png');
    expect(relPath('a/b.md', 'a/c.md')).toBe('c.md');
  });
});

describe('Evernote .enex', () => {
  it('keeps titles, dates, notebook, tags, checklists, tables, pictures, files and links between notes', async () => {
    const plan = await run('evernote', FX.evernote);
    expect(paths(plan)).toEqual(['In/Garden/Café ☕ plans — 東京.md', 'In/Garden/Garden plan.md', 'In/Garden/Q3 Q4 plan.md', 'In/attachments/leaf.png', 'In/attachments/seed list.pdf']);
    const g = noteText(plan, 'Garden plan.md')!;
    expect(g).toContain('tags:\n  - garden\n  - spring-jobs');
    expect(g).toContain('created: \"2026-03-01T08:00:00Z\"');
    expect(g).toContain('modified: \"2026-04-02T09:30:00Z\"');
    expect(g).toContain('source: evernote');
    expect(g).toContain('- [x] Order compost');
    expect(g).toContain('- [ ] Dig the north bed');
    expect(g).toContain('| **Bed** | **Crop** |');
    expect(g).toContain('| South | Tomatoes \\| cherry |');
    expect(g).toContain('![[leaf.png]]');
    expect(g).toContain('![[seed list.pdf]]');
    expect(g).toContain('[[Café ☕ plans — 東京]]');
    const cafe = noteText(plan, 'Café ☕ plans — 東京.md')!;
    expect(cafe).toContain('## Places');
    expect(cafe).toContain('- Bakery\n  - open at 7');
    expect(cafe).toContain('[[Garden plan]]');
    const q = noteText(plan, 'Q3 Q4 plan.md')!;
    expect(q).toContain('aliases:\n  - "Q3 / Q4: plan?"');
    expect(q).toContain('*review*');
    expect(q).toContain('~~old~~');
    expect(Buffer.from(plan.files.find((f) => f.path.endsWith('leaf.png'))!.data).equals(PICS.leaf)).toBe(true);
    expect(plan.notes).toBe(3);
    expect(plan.attachments).toBe(2);
  });
});

describe('Joplin .jex', () => {
  it('keeps notebooks, tags, pictures, links between notes, and skips encrypted notes', async () => {
    const plan = await run('joplin-jex', FX['joplin-jex']);
    expect(paths(plan)).toEqual(['In/Home/Kitchen/Renovation.md', 'In/Home/Tiles — größe 20×20.md', 'In/attachments/sky.png']);
    const r = noteText(plan, 'Renovation.md')!;
    expect(r).toContain('tags:\n  - diy');
    expect(r).toContain('[[Tiles — größe 20×20|the tiles]]');
    expect(r).toContain('![[sky.png]]');
    expect(r).toContain('- [x] Measure');
    expect(r).toContain('| Kitchen | 1200 |');
    expect(r).toContain('created: \"2026-02-02T10:00:00Z\"');
    expect(noteText(plan, 'Tiles — größe 20×20.md')).toContain('[[Renovation]]');
    expect(plan.skipped.map((s) => s.why)).toEqual(['Locked in the app, so its text cannot be read']);
  });
});

describe('Standard Notes backup', () => {
  it('reads a decrypted backup: tags, checklists, unicode; protected and trashed notes are skipped with a reason', async () => {
    const plan = await run('standardnotes', FX.standardnotes);
    expect(paths(plan)).toEqual(['In/Reading list.md']);
    const t = noteText(plan, 'Reading list.md')!;
    expect(t).toContain('tags:\n  - books');
    expect(t).toContain('- [ ] A book about rivers');
    expect(t).toContain('ünïcödé ✓');
    expect(plan.skipped.map((s) => s.title).sort()).toEqual(['Old draft', 'Passwords hint']);
  });
});

describe('Notesnook', () => {
  it('reads a Markdown export with its picture and properties', async () => {
    const plan = await run('notesnook', FX.notesnook);
    expect(paths(plan)).toEqual(['In/Ideas/Bike trip route.md', 'In/attachments/sun.png']);
    const t = noteText(plan, 'Bike trip route.md')!;
    expect(t).toContain('aliases:\n  - "Bike trip: route"');
    expect(t).toContain('tags:\n  - travel\n  - summer');
    expect(t).toContain('created: \"2026-03-03T10:00:00Z\"');
    expect(t).toContain('![[sun.png]]');
    expect(t).toContain('- [ ] Pump the tyres');
  });
  it('reads an unencrypted backup: checklist and table from the editor’s HTML, tags from relations', async () => {
    const plan = await run('notesnook', FX['notesnook-backup']);
    const t = noteText(plan, 'Weekly review.md')!;
    expect(t).toContain('tags:\n  - routine');
    expect(t).toContain('- [x] Taxes');
    expect(t).toContain('- [ ] Call mum');
    expect(t).toContain('| Day | Hours |');
  });
});

describe('Markdown vault from another notes app', () => {
  it('copies notes and pictures exactly, leaving settings and trash behind, so links keep working', async () => {
    const plan = await run('markdown', FX.markdown);
    expect(paths(plan)).toEqual(['In/Files/leaf.png', 'In/Home.md', 'In/Ideas – ébauche.md', 'In/Projects/Shed.md']);
    expect(noteText(plan, 'Home.md')).toBe(await fsp.readFile(path.join(FX.markdown, 'Home.md'), 'utf8'));
    expect(plan.notes).toBe(3);
    expect(plan.attachments).toBe(1);
  });
});

describe('Bear export', () => {
  it('reads Markdown and TextBundles: title from the first heading, nested and multi-word tags, highlights, pictures', async () => {
    const plan = await run('bear', FX.bear);
    expect(paths(plan)).toEqual(['In/Sourdough.md', 'In/Trip notes.md', 'In/attachments/sky.png']);
    const s = noteText(plan, 'Sourdough.md')!;
    expect(s).toContain('tags:\n  - quick-meals\n  - food/baking');
    expect(s).toContain('==Remember the salt==');
    expect(s).not.toContain('# Sourdough');
    expect(noteText(plan, 'Trip notes.md')).toContain('The view: ![[sky.png]]');
  });
});

describe('Google Keep Takeout', () => {
  it('reads checklists, labels, pictures and links; archive becomes a folder; trash is skipped', async () => {
    const plan = await run('keep', FX.keep);
    expect(paths(plan)).toEqual(['In/Archive/Photo of the whiteboard.md', 'In/Shopping.md', 'In/attachments/board.png']);
    const s = noteText(plan, 'Shopping.md')!;
    expect(s).toContain('- [x] Eggs\n- [ ] Flour');
    expect(s).toContain('tags:\n  - home');
    const wb = noteText(plan, 'Photo of the whiteboard.md')!;
    expect(wb).toContain('with the plan');
    expect(wb).toContain('![[board.png]]');
    expect(wb).toContain('[Plan page](https://example.com/plan)');
    expect(plan.skipped.map((x) => x.title)).toEqual(['Binned']);
  });
  it('also opens the Takeout .zip', async () => {
    const { writeZip } = await import('../core/notes-sync/archive');
    const files = await gatherFiles(FX.keep);
    const zipPath = path.join(ROOT, 'takeout.zip');
    await fsp.writeFile(zipPath, writeZip(files.map((f) => ({ name: `Takeout/Keep/${f.rel}`, data: f.data }))));
    const plan = await run('keep', zipPath);
    expect(plan.notes).toBe(2);
  });
});

describe('Simplenote export', () => {
  it('reads notes.json from the .zip: first line is the title, tags, pinned, unicode; trash is skipped', async () => {
    const plan = await run('simplenote', FX.simplenote);
    expect(paths(plan)).toEqual(['In/Packing list.md', 'In/Ünïcode title 😀.md']);
    const p = noteText(plan, 'Packing list.md')!;
    expect(p).toContain('- socks');
    expect(p).toContain('tags:\n  - travel');
    expect(p).toContain('pinned: true');
    expect(plan.skipped.map((x) => x.title)).toEqual(['Trash me']);
  });
});

describe('Apple Notes saved as files', () => {
  it('reads Markdown and HTML with folders, checklists, a table and a picture', async () => {
    const plan = await run('applenotes-export', FX['applenotes-export']);
    expect(paths(plan)).toEqual(['In/attachments/sketch.png', 'In/iCloud/Notes/Groceries.md', 'In/iCloud/Work/Meeting.md']);
    const m = noteText(plan, 'Meeting.md')!;
    expect(m).toContain('Agenda for **Monday**');
    expect(m).toContain('- [x] Slides\n- [ ] Room');
    expect(m).toContain('| Ana | Notes |');
    expect(m).toContain('![[sketch.png]]');
    expect(m).not.toMatch(/^# Meeting/m);
  });
});

describe('the plan never overwrites', () => {
  it('picks free names for clashes inside the import and with the vault', () => {
    const plan = planImport({ notes: [{ sourceId: '1', title: 'Same', body: 'a', tags: [] }, { sourceId: '2', title: 'same', body: 'b', tags: [] }] }, { folder: 'X', app: 'T', taken: (p) => p.toLowerCase() === 'x/same.md' });
    expect(paths(plan)).toEqual(['X/Same 2.md', 'X/same 3.md']);
  });
});

// ---------------------------------------------------------------- exports and round trips

describe('exports', () => {
  const vault = () => {
    const v = new VaultIndex();
    const add = (p: string, text?: string) => v.set({ path: p, mtime: 1_700_000_000_000, ctime: 1_690_000_000_000, size: text?.length ?? 3 }, text);
    add('Home.md', '---\ntags: [index]\ncreated: 2026-01-02T03:04:05Z\n---\n# Home\n\nSee [[Projects/Shed|the shed]] and ![[leaf.png]].\n\n- [ ] one #todo\n');
    add('Projects/Shed.md', 'Back to [[Home]].\n');
    add('Files/leaf.png');
    return v;
  };
  it('writes [[links]] as plain Markdown links for apps without them', () => {
    const v = vault();
    expect(plainLinks(v.note('Home.md')!.text, 'Home.md', (t) => v.resolve(t, 'Home.md'))).toContain('See [the shed](Projects/Shed.md) and ![leaf.png](Files/leaf.png).');
    expect(plainLinks('Back to [[Home]].', 'Projects/Shed.md', (t) => v.resolve(t, 'Projects/Shed.md'))).toBe('Back to [Home](../Home.md).');
  });
  it('an Evernote export reads back with the same title, tags, dates, text and picture', async () => {
    const v = vault();
    const enex = enexExport([enexNote('Home.md', v.note('Home.md')!.text, { mtime: 1_700_000_000_000, ctime: 1, resolve: (t) => v.resolve(t, 'Home.md'), read: (p) => (p === 'Files/leaf.png' ? new Uint8Array(PICS.leaf) : null) })]);
    const plan = planImport(readImport('evernote', [{ rel: 'Out.enex', data: new TextEncoder().encode(enex) }]), { folder: '', app: 'Evernote' });
    const t = noteText(plan, 'Home.md')!;
    expect(t).toContain('tags:\n  - todo\n  - index');
    expect(t).toContain('created: \"2026-01-02T03:04:05Z\"');
    expect(t).toContain('# Home');
    expect(t).toContain('See the shed and ![[leaf.png]]');
    expect(t).toContain('- [ ] one #todo');
    expect(Buffer.from(plan.files.find((f) => f.path.endsWith('leaf.png'))!.data).equals(PICS.leaf)).toBe(true);
  });
});

describe('the service, in a real vault', () => {
  let vaultId = '';
  const VAULT = path.join(ROOT, 'My Vault');
  beforeAll(async () => {
    notes.initNotes({ broadcast: () => undefined });
    await fsp.mkdir(VAULT, { recursive: true });
    await fsp.writeFile(path.join(VAULT, 'Mine.md'), '# Mine\n');
    vaultId = (await notes.addVault(VAULT))!.id;
    await notes.openVault(vaultId);
  });

  it('previews, imports with progress into its own folder, and Undo takes it back (but keeps notes changed since)', async () => {
    const pre = await importPreview(vaultId, 'evernote', { path: FX.evernote });
    expect(pre).toMatchObject({ folder: 'From Evernote', notes: 3, attachments: 2 });
    expect(pre.sample).toContain('Garden/Garden plan');
    const sum = await importRun(pre.job);
    expect(sum).toMatchObject({ folder: 'From Evernote', notes: 3, attachments: 2 });
    const garden = path.join(VAULT, 'From Evernote', 'Garden', 'Garden plan.md');
    expect(await fsp.readFile(garden, 'utf8')).toContain('[[Café ☕ plans — 東京]]');
    expect((await fsp.stat(garden)).mtimeMs).toBe(Date.parse('2026-04-02T09:30:00Z'));
    const open = await notes.openVault(vaultId);
    expect(open.files.some((f) => f.path === 'From Evernote/Garden/Garden plan.md')).toBe(true);
    expect((await notes.search(vaultId, 'Tomatoes')).map((h) => h.path)).toEqual(['From Evernote/Garden/Garden plan.md']);

    // A second import of the same app goes next to it, never over it.
    expect((await importPreview(vaultId, 'evernote', { path: FX.evernote })).folder).toBe('From Evernote 2');

    // The person edits one imported note; Undo keeps that one.
    const cafe = path.join(VAULT, 'From Evernote', 'Garden', 'Café ☕ plans — 東京.md');
    await fsp.appendFile(cafe, '\nmy own line\n');
    expect((await importsList(vaultId)).map((s) => s.job)).toEqual([sum.job]);
    const undo = await importUndo(vaultId, sum.job);
    expect(undo.removed).toBe(4);
    expect(undo.kept).toEqual(['From Evernote/Garden/Café ☕ plans — 東京.md']);
    expect(await fsp.readdir(path.join(VAULT, 'From Evernote', 'Garden'))).toEqual(['Café ☕ plans — 東京.md']);
    await expect(fsp.stat(path.join(VAULT, 'From Evernote', 'attachments'))).rejects.toThrow();
    expect(await fsp.readFile(path.join(VAULT, 'Mine.md'), 'utf8')).toBe('# Mine\n');
    expect(await importsList(vaultId)).toEqual([]);
  });

  it('round trip: a Markdown export of the vault imports back byte for byte', async () => {
    const out = path.join(ROOT, 'md-out');
    await fsp.writeFile(path.join(VAULT, 'Linked.md'), 'Link to [[Mine]] and ![[pic.png]]\n');
    await fsp.mkdir(path.join(VAULT, 'img'), { recursive: true });
    await fsp.writeFile(path.join(VAULT, 'img', 'pic.png'), PICS.sun);
    await notes.openVault(vaultId);
    const r = await exportNotes(vaultId, 'markdown', { out, paths: ['Linked.md', 'Mine.md'] });
    const exported = (await gatherFiles(r!.out)).map((f) => f.rel).sort();
    expect(exported).toEqual(['Linked.md', 'Mine.md', 'img/pic.png']);
    const pre = await importPreview(vaultId, 'markdown', { path: r!.out, folder: 'Round trip' });
    await importRun(pre.job);
    for (const p of exported) expect(Buffer.from(await fsp.readFile(path.join(VAULT, 'Round trip', p))).equals(await fsp.readFile(path.join(VAULT, p)))).toBe(true);
  });

  it('round trip: the whole vault as a .zip opens again with the same files', async () => {
    const out = path.join(ROOT, 'vault.zip');
    await exportNotes(vaultId, 'zip', { out });
    const entries = readZip(new Uint8Array(await fsp.readFile(out)));
    const open = await notes.openVault(vaultId);
    expect(entries.map((e) => e.name.replace(/^My Vault\//, '')).sort()).toEqual(open.files.map((f) => f.path).sort());
    for (const e of entries) expect(Buffer.from(e.data).equals(await fsp.readFile(path.join(VAULT, e.name.replace(/^My Vault\//, ''))))).toBe(true);
  });

  it('round trip: an Evernote export of the vault imports back with the same notes', async () => {
    const out = path.join(ROOT, 'out.enex');
    await exportNotes(vaultId, 'enex', { out, paths: ['Mine.md', 'Linked.md'] });
    const plan = planImport(readImport('evernote', await gatherFiles(out)), { folder: '', app: 'Evernote' });
    // The file's name is the notebook.
    expect(paths(plan)).toEqual(['attachments/pic.png', 'out/Linked.md', 'out/Mine.md']);
    expect(noteText(plan, 'Mine.md')).toContain('# Mine');
    expect(noteText(plan, 'Linked.md')).toContain('Link to Mine and ![[pic.png]]');
  });

  it('one note as a web page carries its pictures inside', async () => {
    const out = path.join(ROOT, 'note.html');
    await exportNotes(vaultId, 'html', { out, paths: ['Linked.md'] });
    const html = await fsp.readFile(out, 'utf8');
    expect(html).toContain('<title>Linked</title>');
    expect(html).toContain('src="data:image/png;base64,');
    expect(html).not.toContain('keeper-file:');
  });

  it('imports 5,000 notes in batches, with progress, and the index and search have all of them', async () => {
    const big = path.join(ROOT, 'big');
    await fsp.mkdir(big, { recursive: true });
    for (let i = 0; i < 5000; i += 500) await Promise.all(Array.from({ length: 500 }, (_, k) => fsp.writeFile(path.join(big, `Note ${i + k}.txt`), `Line ${i + k} about item${i + k}\nmore`)));
    const t0 = Date.now();
    const pre = await importPreview(vaultId, 'simplenote', { path: big, folder: 'Big' });
    expect(pre.notes).toBe(5000);
    const progress: number[] = [];
    notes.initNotes({ broadcast: () => undefined });
    const { initNotesIo } = await import('../electron/services/notes-io');
    initNotesIo({ broadcast: (_c, e) => { const p = e as { done: number; phase: string }; if (p.phase === 'writing') progress.push(p.done); } });
    const sum = await importRun(pre.job);
    expect(sum.notes).toBe(5000);
    expect(progress.length).toBeGreaterThan(3);
    expect(progress[progress.length - 1]).toBe(5000);
    const open = await notes.openVault(vaultId);
    expect(open.files.filter((f) => f.path.startsWith('Big/')).length).toBe(5000);
    expect((await notes.search(vaultId, 'item4321')).map((h) => h.path)).toEqual(['Big/Line 4321 about item4321.md']);
    expect(Date.now() - t0).toBeLessThan(20_000);
  }, 60_000);

  it('Cancel stops between batches; Undo removes what was written', async () => {
    const pre = await importPreview(vaultId, 'simplenote', { path: path.join(ROOT, 'big'), folder: 'Stopped' });
    const { importCancel } = await import('../electron/services/notes-io');
    const p = importRun(pre.job);
    importCancel(pre.job);
    const sum = await p;
    expect(sum.cancelled).toBe(true);
    expect(sum.notes).toBeLessThan(5000);
    await importUndo(vaultId, sum.job);
    await expect(fsp.stat(path.join(VAULT, 'Stopped'))).rejects.toThrow();
  }, 60_000);
});

// ---------------------------------------------------------------- apps read through their services (recorded answers)

describe('apps read through their services, with a stand-in server', () => {
  const SYNC = path.join(__dirname, 'fixtures', 'notes-sync');
  const fx = (n: string) => readFileSync(path.join(SYNC, n), 'utf8');
  const serve = (routes: [RegExp, () => string][]) => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: { method?: string; headers?: Record<string, string> }) => {
      const key = `${init?.method ?? 'GET'} ${url}`;
      seen.push(`${key} ${JSON.stringify(init?.headers ?? {})}`);
      const hit = routes.find(([re]) => re.test(key));
      return new Response(hit ? hit[1]() : 'not found', { status: hit ? 200 : 404 });
    });
    return seen;
  };
  const read = async (...a: Parameters<typeof import('../electron/services/notes-io').readSource>) => (await import('../electron/services/notes-io')).readSource(...a);

  it('Notion: pages come in with their checklists; the token is only sent to Notion', async () => {
    const seen = serve([
      [/POST .*\/v1\/search/, () => fx('notion-search.json')],
      [/GET .*\/blocks\/p1\/children/, () => fx('notion-blocks-p1.json')],
      [/GET .*\/blocks\/b3\/children/, () => fx('notion-blocks-b3.json')],
    ]);
    const plan = planImport(await read('notion', { fields: { token: 'secret_x' } }), { folder: 'N', app: 'Notion' });
    const t = noteText(plan, 'Roadmap.md')!;
    expect(t).toContain('tags:\n  - work');
    expect(t).toContain('- [x] **Dry run**');
    expect(seen.every((s) => s.includes('api.notion.com') && s.includes('Bearer secret_x'))).toBe(true);
    vi.unstubAllGlobals();
  });

  it('OneNote: pages keep their notebook and section as folders', async () => {
    serve([
      [/GET .*\/me\/onenote\/pages\?/, () => fx('onenote-pages.json')],
      [/GET .*\/pages\/0-abc\/content/, () => fx('onenote-page.html')],
    ]);
    const plan = planImport(await read('onenote', { fields: { token: 'tok' } }), { folder: 'O', app: 'OneNote' });
    expect(noteText(plan, 'O/Life/Home/Garden.md')).toContain('Plant **tulips** in November.');
    vi.unstubAllGlobals();
  });

  it('Joplin while it runs: notebooks and tags through its Web Clipper service; encrypted notes skipped', async () => {
    serve([
      [/GET .*\/ping/, () => fx('joplin-ping.txt')],
      [/GET .*\/folders\?/, () => fx('joplin-folders.json')],
      [/GET .*\/notes\?.*page=1/, () => fx('joplin-notes-1.json')],
      [/GET .*\/notes\?.*page=2/, () => fx('joplin-notes-2.json')],
      [/GET .*\/tags\/t1\/notes/, () => fx('joplin-tag-notes.json')],
      [/GET .*\/tags\?/, () => fx('joplin-tags.json')],
    ]);
    const plan = planImport(await read('joplin', { fields: { token: 'TOKEN' } }), { folder: 'J', app: 'Joplin' });
    expect(noteText(plan, 'J/Trips/Portugal/Lisbon.md')).toContain('tags:\n  - travel');
    expect(plan.skipped).toHaveLength(1);
    vi.unstubAllGlobals();
  });

  it('Apple Notes and Bear are read on a Mac only, and say so elsewhere', async () => {
    if (process.platform === 'darwin') return;
    await expect(read('applenotes', {})).rejects.toThrow(/Mac/);
    await expect(read('bear-mac', {})).rejects.toThrow(/Mac/);
  });
});
