// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { readFileSync, promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { bytesToHex, hchacha20, hexToBytes, xchachaOpen, xchachaSeal } from '../core/notes-sync/crypto';
import { appleBodyFor, createScript, fromAppleRows, listScript, shortcutSteps, updateScript } from '../core/notes-sync/connectors/applenotes';
import { enexTime, parseEnex, toEnexTime, writeEnex } from '../core/notes-sync/connectors/evernote';
import { folderFileText, folderNoteFromFile, folderRelFor, isNoteFile } from '../core/notes-sync/connectors/folder';
import { fromKeepHtml, fromKeepTakeout, fromNotesnookBackup, fromNotesnookFile, fromSamsungFile } from '../core/notes-sync/connectors/imports';
import { firstLineTitle, inlineTags, type FetchFn } from '../core/notes-sync/connectors/io';
import { jexItems, JoplinApi, notesFromItems, parseJoplinItem, serializeJoplinItem } from '../core/notes-sync/connectors/joplin';
import { bearCreateUrl, bearUpdateUrl, coreDataTime, fromBearRows, fromStickyRows, msToTicks, stickyPlain, stickyUpdate, ticksToMs } from '../core/notes-sync/connectors/localdb';
import { blocksToMd, mdToBlocks, NotionApi, type NotionBlock } from '../core/notes-sync/connectors/notion';
import { firstBlockId, oneNoteHtmlToMd, OneNoteApi, oneNotePageHtml } from '../core/notes-sync/connectors/onenote';
import { CONNECTORS, availableOn, connectorDef } from '../core/notes-sync/connectors/registry';
import { fromSimplenote, SimplenoteApi, toSimplenote } from '../core/notes-sync/connectors/simplenote';
import { parseSnBackup, snBackupFrom, snDecrypt, snDecryptItems, snEncrypt, snSalt, snSyncRequest, snSyncResponse, type SnItem } from '../core/notes-sync/connectors/standardnotes';
import { readTar } from '../core/notes-sync/archive';
import { connectorIO } from '../electron/services/notes-sync/connectors';

const FX = path.join(__dirname, 'fixtures', 'notes-sync');
const fx = (n: string) => readFileSync(path.join(FX, n), 'utf8');

/** Plays back recorded answers; records every request. */
function fakeFetch(routes: [RegExp, (url: string, init?: { method?: string; body?: string }) => { status?: number; body: unknown; headers?: Record<string, string> }][]) {
  const calls: { url: string; method: string; body?: string; headers?: Record<string, string> }[] = [];
  const fn: FetchFn = async (url, init) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body, headers: init?.headers });
    const r = routes.find(([re]) => re.test(`${init?.method ?? 'GET'} ${url}`));
    if (!r) return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}), text: async () => 'not found' };
    const out = r[1](url, init);
    const text = typeof out.body === 'string' ? out.body : JSON.stringify(out.body);
    const status = out.status ?? 200;
    return { ok: status < 400, status, headers: { get: (n: string) => out.headers?.[n.toLowerCase()] ?? null }, json: async () => JSON.parse(text), text: async () => text };
  };
  return { fn, calls };
}

describe('registry', () => {
  it('declares an honest capability and platform for every app', () => {
    expect(CONNECTORS.map((c) => c.kind)).toEqual(['folder', 'joplin', 'joplin-files', 'standardnotes', 'standardnotes-sync', 'notesnook', 'onenote', 'notion', 'simplenote', 'evernote', 'applenotes', 'bear', 'sticky', 'keep', 'samsung', 'island']);
    expect(connectorDef('keep').capability).toBe('import-only');
    expect(connectorDef('samsung').capability).toBe('import-only');
    expect(connectorDef('evernote').capability).toBe('import-limited-write');
    expect(availableOn(connectorDef('applenotes'), 'linux')).toBe(false);
    expect(availableOn(connectorDef('applenotes'), 'darwin')).toBe(true);
    expect(availableOn(connectorDef('sticky'), 'win32')).toBe(true);
    for (const c of CONNECTORS) expect(c.limits.every((l) => l.length < 200)).toBe(true);
  });
});

describe('helpers', () => {
  it('reads inline tags and first-line titles', () => {
    expect(inlineTags('a #home and #work/deep but not `#code` or # heading')).toEqual(['home', 'work/deep']);
    expect(firstLineTitle('\n# Title\nbody')).toEqual({ title: 'Title', body: 'body' });
  });
});

describe('plain folders', () => {
  it('maps files to notes and back, keeping properties', () => {
    const n = folderNoteFromFile('Projects/Owl lamp.md', '---\ntags: [making, ideas]\nstatus: draft\n---\nUse warm light.\n', 1000, 50);
    expect(n).toMatchObject({ sourceId: 'Projects/Owl lamp.md', title: 'Owl lamp', body: 'Use warm light.', tags: ['making', 'ideas'], folder: 'Projects', version: '1000-50', props: { status: 'draft' } });
    expect(folderFileText(n, n.sourceId)).toBe('---\nstatus: draft\ntags:\n  - making\n  - ideas\n---\nUse warm light.\n');
    const t = folderNoteFromFile('todo.txt', 'buy milk\r\n', 1, 2);
    expect(t).toMatchObject({ title: 'todo', body: 'buy milk\n', tags: [] });
    expect(folderFileText({ ...t, body: 'x' }, 'todo.txt')).toBe('x\n');
    expect(folderRelFor({ title: 'A/B', folder: 'X/Y' })).toBe('X/Y/A B.md');
    expect(isNoteFile('a/b.md')).toBe(true);
    expect(isNoteFile('.settings/x.md')).toBe(false);
    expect(isNoteFile('_resources/x.md')).toBe(false);
    expect(isNoteFile('a/b.png')).toBe(false);
  });
  it('lists, creates, renames and updates files on disk', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'kn-folder-'));
    await fsp.writeFile(path.join(root, 'One.md'), 'first');
    const io = await connectorIO({ id: 'f', kind: 'folder', label: 'F', enabled: true, writeBack: true, pushNew: false, fields: { path: root }, everyMin: 0, reviewed: true }, { secret: async () => undefined, openUrl: async () => undefined, trashFile: async (p) => fsp.rm(p), island: { get: async () => [], save: async () => undefined }, ctx: {} });
    const l = await io.list();
    expect(l.notes.map((n) => n.title)).toEqual(['One']);
    const made = await io.create!({ sourceId: '', title: 'Two', body: 'second', tags: ['x'], folder: 'Sub' });
    expect(made.sourceId).toBe('Sub/Two.md');
    expect(await fsp.readFile(path.join(root, 'Sub', 'Two.md'), 'utf8')).toBe('---\ntags:\n  - x\n---\nsecond\n');
    const up = await io.update!({ sourceId: 'One.md', title: 'One renamed', body: 'changed', tags: [] });
    expect(up.sourceId).toBe('One renamed.md');
    expect(await fsp.readFile(path.join(root, 'One renamed.md'), 'utf8')).toBe('changed\n');
    await io.remove!('Sub/Two.md');
    expect((await io.list()).notes.map((n) => n.sourceId)).toEqual(['One renamed.md']);
    await fsp.rm(root, { recursive: true, force: true });
  });
});

describe('Joplin', () => {
  it('parses and writes item files (sync folder / JEX)', () => {
    const it1 = parseJoplinItem(fx('joplin-item-note.md'));
    expect(it1).toMatchObject({ type: 1, title: 'Lisbon', body: 'Tram 28 early.\nPastéis de Belém.' });
    expect(it1.props).toMatchObject({ id: '0123456789abcdef0123456789abcdef', parent_id: 'fedcba9876543210fedcba9876543210', author: '', encryption_applied: '0' });
    expect(parseJoplinItem(serializeJoplinItem(it1))).toEqual(it1);
    const r = notesFromItems([fx('joplin-item-note.md'), fx('joplin-item-folder.md'), fx('joplin-item-tag.md'), fx('joplin-item-notetag.md')]);
    expect(r.notes).toHaveLength(1);
    expect(r.notes[0]).toMatchObject({ sourceId: '0123456789abcdef0123456789abcdef', title: 'Lisbon', folder: 'Trips', tags: ['travel'], modified: Date.parse('2026-10-30T18:12:00.000Z') });
  });
  it('skips encrypted items', () => {
    const enc = serializeJoplinItem({ type: 1, title: '', body: '', props: { id: 'e1', encryption_applied: '1', encryption_cipher_text: 'xyz' } });
    const r = notesFromItems([enc]);
    expect(r.encrypted).toBe(1);
    expect(r.notes[0]).toMatchObject({ locked: true, body: '' });
  });
  it('writes a JEX the reader understands', () => {
    const items = jexItems([{ title: 'A', body: 'x', tags: ['t'], created: 1, modified: 2, folder: 'Home/Sub' }]);
    const back = notesFromItems(items.map((i) => i.text));
    expect(back.notes[0]).toMatchObject({ title: 'A', body: 'x', tags: ['t'], folder: 'Home/Sub' });
  });
  it('talks to the Data API (recorded answers)', async () => {
    const { fn, calls } = fakeFetch([
      [/GET .*\/ping/, () => ({ body: fx('joplin-ping.txt') })],
      [/GET .*\/folders\?/, () => ({ body: fx('joplin-folders.json') })],
      [/GET .*\/notes\?.*page=1/, () => ({ body: fx('joplin-notes-1.json') })],
      [/GET .*\/notes\?.*page=2/, () => ({ body: fx('joplin-notes-2.json') })],
      [/GET .*\/tags\/t1\/notes/, () => ({ body: fx('joplin-tag-notes.json') })],
      [/GET .*\/tags\?/, () => ({ body: fx('joplin-tags.json') })],
      [/PUT .*\/notes\/n1/, () => ({ body: { id: 'n1', updated_time: 1730200000000 } })],
      [/POST .*\/notes\?/, () => ({ body: { id: 'n9', updated_time: 5 } })],
      [/POST .*\/tags\/t1\/notes/, () => ({ body: '' })],
      [/DELETE .*\/tags\/t1\/notes\/n1/, () => ({ body: '' })],
    ]);
    const api = new JoplinApi('', 'TOKEN', fn);
    const l = await api.list();
    expect(l.complete).toBe(true);
    expect(l.notes).toHaveLength(2);
    expect(l.notes[0]).toMatchObject({ sourceId: 'n1', title: 'Lisbon', body: 'Tram 28 early.', folder: 'Trips/Portugal', tags: ['travel'], version: '1730100000000' });
    expect(l.notes[1]).toMatchObject({ sourceId: 'n2', locked: true });
    expect(calls[0].url).toMatch(/^http:\/\/127\.0\.0\.1:41184\/folders\?.*token=TOKEN/);
    const u = await api.update({ sourceId: 'n1', title: 'Lisbon', body: 'new', tags: [] });
    expect(u.version).toBe('1730200000000');
    expect(JSON.parse(calls.find((c) => c.method === 'PUT')!.body!)).toEqual({ title: 'Lisbon', body: 'new' });
    expect(calls.some((c) => c.method === 'DELETE' && /tags\/t1\/notes\/n1/.test(c.url))).toBe(true);
    const c = await api.create({ sourceId: '', title: 'New', body: 'b', tags: ['travel'] });
    expect(c.sourceId).toBe('n9');
    expect(calls.some((x) => x.method === 'POST' && /tags\/t1\/notes/.test(x.url) && x.body === '{"id":"n9"}')).toBe(true);
    await expect(new JoplinApi('', 'T', fakeFetch([]).fn).test()).rejects.toThrow(/Web Clipper/);
  });
});

describe('XChaCha20-Poly1305', () => {
  it('matches the HChaCha20 test vector', () => {
    const key = new Uint8Array(32).map((_, i) => i);
    const nonce = hexToBytes('000000090000004a0000000031415927');
    expect(bytesToHex(hchacha20(key, nonce))).toBe('82413b4227b27bfed30e42508a877d73a0f9e4d58a74a853c12ec41326d3ecdc');
  });
  it('seals and opens, and refuses a wrong key', () => {
    const key = new Uint8Array(32).fill(7);
    const nonce = new Uint8Array(24).fill(3);
    const ct = xchachaSeal(key, nonce, new TextEncoder().encode('hello'), new TextEncoder().encode('ad'));
    expect(new TextDecoder().decode(xchachaOpen(key, nonce, ct, new TextEncoder().encode('ad'))!)).toBe('hello');
    expect(xchachaOpen(new Uint8Array(32), nonce, ct, new TextEncoder().encode('ad'))).toBeNull();
  });
});

describe('Standard Notes', () => {
  it('reads a decrypted backup with tags, skipping protected text and trash', () => {
    const r = parseSnBackup(fx('sn-decrypted.json'));
    expect(r.encrypted).toBe(false);
    expect(r.notes.find((n) => n.sourceId === 'n-1')).toMatchObject({ title: 'Book ideas', body: '- A lighthouse keeper\n- Owls as messengers', tags: ['writing'] });
    expect(r.notes.find((n) => n.sourceId === 'n-2')).toMatchObject({ locked: true, body: '' });
    expect(r.notes.find((n) => n.sourceId === 'n-3')?.trashed).toBe(true);
  });
  it('opens an encrypted (004) backup with the key derived on this computer', () => {
    const master = 'aa'.repeat(32);
    const itemsKey = 'bb'.repeat(32);
    const ik1 = 'cc'.repeat(32);
    const ik2 = 'dd'.repeat(32);
    const n1 = (b: number) => b.toString(16).padStart(2, '0').repeat(24);
    const items: SnItem[] = [
      { uuid: 'ik', content_type: 'SN|ItemsKey', enc_item_key: snEncrypt(ik1, master, n1(1), { u: 'ik', v: '004' }), content: snEncrypt(JSON.stringify({ itemsKey, version: '004' }), ik1, n1(2), { u: 'ik', v: '004' }) },
      { uuid: 'note', content_type: 'Note', items_key_id: 'ik', enc_item_key: snEncrypt(ik2, itemsKey, n1(3), { u: 'note', v: '004' }), content: snEncrypt(JSON.stringify({ title: 'Secret plan', text: 'owls', references: [] }), ik2, n1(4), { u: 'note', v: '004' }), updated_at: '2026-10-01T00:00:00Z' },
    ];
    const text = JSON.stringify({ version: '004', keyParams: { identifier: 'me@example.com', pw_nonce: 'abc', version: '004' }, items });
    const locked = parseSnBackup(text);
    expect(locked).toMatchObject({ encrypted: true, needsPassword: true, notes: [] });
    const open = parseSnBackup(text, master);
    expect(open.notes).toEqual([expect.objectContaining({ sourceId: 'note', title: 'Secret plan', body: 'owls' })]);
    expect(parseSnBackup(text, 'ee'.repeat(32)).notes).toEqual([]);
    expect(snDecrypt(items[1].content as string, ik2)).toContain('Secret plan');
    expect(snDecryptItems(items, master).skipped).toBe(0);
    expect(snSalt('me@example.com', 'abc')).toHaveLength(16);
  });
  it('writes a decrypted backup Standard Notes can import', () => {
    const j = JSON.parse(snBackupFrom([{ title: 'A', body: 'x', tags: ['t'], created: 1, modified: 2 }]));
    expect(j.version).toBe('004');
    const back = parseSnBackup(JSON.stringify(j));
    expect(back.notes[0]).toMatchObject({ title: 'A', body: 'x', tags: ['t'] });
  });
  it('shapes sync requests and answers', () => {
    expect(snSyncRequest([], 'tok')).toMatchObject({ api: '20200115', sync_token: 'tok', limit: 150 });
    expect(snSyncResponse({ data: { retrieved_items: [{ uuid: 'a' }], sync_token: 's' } })).toMatchObject({ retrieved: [{ uuid: 'a' }], syncToken: 's' });
  });
});

describe('Notesnook', () => {
  it('reads an unencrypted backup', () => {
    const backup = JSON.stringify({ version: 5.9, type: 'web', data: { n1: { id: 'n1', type: 'note', title: 'Groceries', contentId: 'c1', dateCreated: 1, dateEdited: 2 }, c1: { id: 'c1', type: 'tiptap', data: '<p>Milk <strong>now</strong></p><ul class="checklist"><li class="checked">eggs</li></ul>', noteId: 'n1' }, t1: { id: 't1', type: 'tag', title: 'home' }, r1: { id: 'r1', type: 'relation', fromType: 'tag', fromId: 't1', toType: 'note', toId: 'n1' } } });
    const r = fromNotesnookBackup(backup);
    expect(r.notes[0]).toMatchObject({ title: 'Groceries', body: 'Milk **now**\n\n- [x] eggs', tags: ['home'] });
    expect(fromNotesnookBackup(JSON.stringify({ encrypted: true, data: { cipher: 'x' } })).encrypted).toBe(true);
  });
  it('reads Markdown exports with their properties', () => {
    const n = fromNotesnookFile('Work/Plan.md', '---\ntitle: The plan\ncreated_at: 2026-10-01T00:00:00Z\nupdated_at: 2026-10-02T00:00:00Z\ntags: [work]\n---\nStep one', 5);
    expect(n).toMatchObject({ title: 'The plan', body: 'Step one', tags: ['work'], created: Date.parse('2026-10-01T00:00:00Z') });
    expect(fromNotesnookFile('a.html', '<html><head><title>T</title></head><body><p>x</p></body></html>', 1)).toMatchObject({ title: 'T', body: 'x' });
  });
});

describe('Google Keep Takeout', () => {
  const files = ['Shopping.json', 'Idea.json', 'Old.json', 'Shopping.html'].map((name) => ({ name, text: fx(`keep/${name}`) }));
  it('reads the .json notes: checklists, labels, links, archive and trash', () => {
    const notes = fromKeepTakeout(files);
    expect(notes).toHaveLength(3);
    expect(notes[0]).toMatchObject({ sourceId: 'Shopping', title: 'Shopping', body: '- [x] Milk\n- [ ] Eggs', tags: ['home'], modified: 1730300000000, created: 1730200000000 });
    expect(notes[1]).toMatchObject({ title: 'Owl-shaped lamp', tags: ['ideas', 'making'], folder: 'Archive' });
    expect(notes[1].body).toContain('[Lamp kit](https://example.com/lamp)');
    expect(notes[2].trashed).toBe(true);
  });
  it('falls back to the .html files', () => {
    const n = fromKeepHtml('Shopping.html', fx('keep/Shopping.html'));
    expect(n).toMatchObject({ title: 'Shopping', tags: ['home'] });
    expect(n.body).toContain('Milk');
  });
});

describe('Samsung Notes exports', () => {
  it('reads text, HTML and Markdown, and nothing else', () => {
    expect(fromSamsungFile('Notes/Recipe_20261001.txt', 'eggs', 1)).toMatchObject({ title: 'Recipe', body: 'eggs' });
    expect(fromSamsungFile('Plan.html', '<p>one</p><p>two</p>', 1)).toMatchObject({ title: 'Plan', body: 'one\n\ntwo' });
    expect(fromSamsungFile('x.sdocx', '', 1)).toBeNull();
  });
});

describe('Evernote', () => {
  it('reads an .enex (ENML → Markdown, attachments by hash)', () => {
    const [n] = parseEnex(fx('sample.enex'), 'Recipes');
    expect(n).toMatchObject({ title: 'Recipe & notes', tags: ['cooking', 'family'], created: Date.UTC(2026, 9, 1, 9), folder: 'Recipes' });
    expect(n.body).toBe('**Shakshuka**\n- [x] Buy peppers\n- [ ] Buy feta\n\n- Onion\n- Tomatoes\n\n![pan.png](attachment:5d41402abc4b2a76b9719d911017c592)');
    expect(n.attachments?.[0]).toMatchObject({ name: 'pan.png', mime: 'image/png', sourceRef: '5d41402abc4b2a76b9719d911017c592' });
    expect(new TextDecoder().decode(n.attachments![0].data)).toBe('hello');
  });
  it('writes an .enex that reads back the same', () => {
    const data = new TextEncoder().encode('hello');
    const xml = writeEnex([{ title: 'A & B', body: '# Head\n\n- [x] done\n\n![pan](attachments/ab/pan.png)', tags: ['t'], created: Date.UTC(2026, 0, 2), modified: Date.UTC(2026, 0, 3), files: [{ link: 'attachments/ab/pan.png', name: 'pan.png', mime: 'image/png', data }] }]);
    expect(xml).toContain('<en-media hash="5d41402abc4b2a76b9719d911017c592" type="image/png"/>');
    expect(xml).toContain('<en-todo checked="true"/>');
    const [back] = parseEnex(xml);
    expect(back).toMatchObject({ title: 'A & B', tags: ['t'], created: Date.UTC(2026, 0, 2) });
    expect(back.body).toContain('# Head');
    expect(back.body).toContain('[x] done');
    expect(back.attachments?.[0].name).toBe('pan.png');
    expect(enexTime(toEnexTime(Date.UTC(2026, 4, 5, 6, 7, 8)))).toBe(Date.UTC(2026, 4, 5, 6, 7, 8));
  });
});

describe('Notion', () => {
  it('turns blocks into Markdown and Markdown into blocks', () => {
    const blocks = JSON.parse(fx('notion-blocks-p1.json')).results as NotionBlock[];
    blocks[2].children = JSON.parse(fx('notion-blocks-b3.json')).results;
    expect(blocksToMd(blocks)).toBe('## Q1\n\n- [x] **Dry run**\n- Review\n  - Conflicts\n\nSee [*docs*](https://example.com)');
    const md = mdToBlocks('# T\n- [ ] a\n- b\n1. c\n> q\n```js\nx\n```\n---\npara');
    expect(md.map((b) => b.type)).toEqual(['heading_1', 'to_do', 'bulleted_list_item', 'numbered_list_item', 'quote', 'code', 'divider', 'paragraph']);
  });
  it('lists pages and updates one (recorded answers)', async () => {
    const { fn, calls } = fakeFetch([
      [/POST .*\/v1\/search/, () => ({ body: fx('notion-search.json') })],
      [/GET .*\/blocks\/p1\/children/, () => ({ body: fx('notion-blocks-p1.json') })],
      [/GET .*\/blocks\/b3\/children/, () => ({ body: fx('notion-blocks-b3.json') })],
      [/PATCH .*\/pages\/p1/, () => ({ body: { id: 'p1' } })],
      [/DELETE .*\/blocks\//, () => ({ body: {} })],
      [/PATCH .*\/blocks\/p1\/children/, () => ({ body: { results: [] } })],
      [/GET .*\/pages\/p1/, () => ({ body: { id: 'p1', last_edited_time: '2026-10-31T00:00:00.000Z' } })],
    ]);
    const api = new NotionApi('secret_x', fn);
    const l = await api.list();
    expect(l.notes).toHaveLength(1);
    expect(l.notes[0]).toMatchObject({ sourceId: 'p1', title: 'Roadmap', tags: ['work'], version: '2026-10-30T10:00:00.000Z' });
    expect(calls[0].headers).toMatchObject({ authorization: 'Bearer secret_x', 'notion-version': '2022-06-28' });
    const u = await api.update({ sourceId: 'p1', title: 'Roadmap 2', body: '- one', tags: [] });
    expect(u.version).toBe('2026-10-31T00:00:00.000Z');
    expect(JSON.parse(calls.find((c) => c.method === 'PATCH' && /pages\/p1/.test(c.url))!.body!)).toEqual({ properties: { Name: { title: [{ type: 'text', text: { content: 'Roadmap 2' } }] } } });
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(4);
    await expect(api.create({ sourceId: '', title: 'x', body: '', tags: [] })).rejects.toThrow(/Choose a Notion page/);
  });
  it('skips fetching pages Keeper already has at that version', async () => {
    const { fn, calls } = fakeFetch([[/POST .*\/v1\/search/, () => ({ body: fx('notion-search.json') })]]);
    const api = new NotionApi('t', fn, undefined, { unchanged: (id, v) => (id === 'p1' && v === '2026-10-30T10:00:00.000Z' ? { title: 'Roadmap', body: 'cached' } : undefined) });
    expect((await api.list()).notes[0].body).toBe('cached');
    expect(calls).toHaveLength(1);
  });
});

describe('OneNote', () => {
  it('maps pages and writes edits into the first block (recorded answers)', async () => {
    const { fn, calls } = fakeFetch([
      [/GET .*\/me\/onenote\/pages\?/, () => ({ body: fx('onenote-pages.json') })],
      [/GET .*\/pages\/0-abc\/content/, () => ({ body: fx('onenote-page.html') })],
      [/PATCH .*\/pages\/0-abc\/content/, () => ({ body: '' })],
      [/POST .*\/sections\/s1\/pages/, () => ({ body: { id: '0-new', lastModifiedDateTime: 'v1' } })],
    ]);
    const api = new OneNoteApi('tok', fn, 's1');
    const l = await api.list();
    expect(l.notes[0]).toMatchObject({ sourceId: '0-abc', title: 'Garden', folder: 'Life/Home', body: 'Plant **tulips** in November.\n\n- Bulbs\n- Compost' });
    await api.update({ sourceId: '0-abc', title: 'Garden', body: 'new text', tags: [] });
    const patch = JSON.parse(calls.find((c) => c.method === 'PATCH')!.body!);
    expect(patch).toEqual([{ target: 'title', action: 'replace', content: 'Garden' }, { target: 'div:{1}{30}', action: 'replace', content: '<div><p>new text</p></div>' }]);
    expect((await api.create({ sourceId: '', title: 'T', body: 'b', tags: [] })).sourceId).toBe('0-new');
    expect(calls.find((c) => c.method === 'POST')!.headers!['content-type']).toBe('text/html');
    expect(oneNotePageHtml('A<B', 'x')).toContain('<title>A&lt;B</title>');
    expect(firstBlockId('<body><div id="div:{9}">')).toBe('div:{9}');
    expect(oneNoteHtmlToMd('<html><body><p>hi</p></body></html>')).toBe('hi');
  });
});

describe('Simplenote', () => {
  it('signs in, lists, and saves (recorded answers)', async () => {
    const { fn, calls } = fakeFetch([
      [/POST https:\/\/auth\.simperium\.com/, () => ({ body: { access_token: 'AT' } })],
      [/GET .*\/note\/index/, () => ({ body: fx('simplenote-index.json') })],
      [/POST .*\/note\/i\/s1/, () => ({ body: {}, headers: { 'x-simperium-version': '8' } })],
    ]);
    const api = new SimplenoteApi('me@x.org', 'pw', fn);
    const l = await api.list();
    expect(l.notes[0]).toMatchObject({ sourceId: 's1', title: 'Run log', body: 'Mon 5 km', tags: ['health'], version: '7', modified: 1730100000250 });
    expect(l.notes[1].trashed).toBe(true);
    expect(calls[1].headers!['x-simperium-token']).toBe('AT');
    const u = await api.update({ sourceId: 's1', title: 'Run log', body: 'Tue 6 km', tags: ['health'] });
    expect(u.version).toBe('8');
    const sent = JSON.parse(calls[2].body!);
    expect(sent).toMatchObject({ content: 'Run log\nTue 6 km', tags: ['health'], deleted: false, systemTags: ['markdown'], creationDate: 1730000000.5 });
    expect(fromSimplenote('a', 1, toSimplenote({ sourceId: 'a', title: 'T', body: '', tags: [] }))).toMatchObject({ title: 'T', body: '' });
  });
  it('says when the sign-in is wrong', async () => {
    const { fn } = fakeFetch([[/POST https:\/\/auth/, () => ({ status: 401, body: 'no' })]]);
    await expect(new SimplenoteApi('a', 'b', fn).list()).rejects.toThrow(/did not accept/);
  });
});

describe('Apple Notes', () => {
  it('builds scripts with the values escaped', () => {
    expect(listScript('iCloud')).toContain('"iCloud"');
    expect(listScript()).toContain('passwordProtected');
    expect(createScript('Trips"', '<div>x</div>')).toContain('"Trips\\""');
    expect(updateScript('x-coredata://1', '<b>')).toContain('if (n.passwordProtected()) throw');
    expect(appleBodyFor('A<b', 'line')).toBe('<div><h1>A&lt;b</h1></div><div>line</div>');
  });
  it('maps rows, takes the title line off, and never reads locked notes', () => {
    const notes = fromAppleRows([
      { id: 'a', name: 'Trip', body: '<div><h1>Trip</h1></div><div>Pack <b>light</b></div>', created: 1, modified: 2, folder: 'Travel', account: 'iCloud', locked: false },
      { id: 'b', name: 'Bank', body: null, created: 1, modified: 2, folder: 'Private', account: 'iCloud', locked: true },
    ]);
    expect(notes[0]).toMatchObject({ sourceId: 'a', title: 'Trip', body: 'Pack **light**', folder: 'iCloud/Travel', version: '2' });
    expect(notes[1]).toMatchObject({ locked: true, body: '' });
    expect(shortcutSteps('x').steps.length).toBeGreaterThan(4);
  });
});

describe('Bear and Sticky Notes', () => {
  it('maps Bear rows and writes bear:// links', () => {
    const notes = fromBearRows([
      { ZUNIQUEIDENTIFIER: 'B1', ZTITLE: 'Ideas', ZTEXT: '# Ideas\nOwls #making', ZCREATIONDATE: 0, ZMODIFICATIONDATE: 100, ZTRASHED: 0 },
      { ZUNIQUEIDENTIFIER: 'B2', ZTITLE: 'Secret', ZTEXT: 'x', ZENCRYPTED: 1 },
      { ZUNIQUEIDENTIFIER: 'B3', ZTITLE: 'Gone', ZPERMANENTLYDELETED: 1 },
    ]);
    expect(notes).toHaveLength(2);
    expect(notes[0]).toMatchObject({ sourceId: 'B1', title: 'Ideas', body: 'Owls #making', tags: ['making'], modified: coreDataTime(100) });
    expect(notes[1]).toMatchObject({ locked: true, body: '' });
    expect(bearCreateUrl({ title: 'A b', body: 'x&y', tags: ['t1', 't2'] })).toBe('bear://x-callback-url/create?title=A%20b&text=x%26y&tags=t1%2Ct2&open_note=no&show_window=no');
    expect(bearUpdateUrl({ sourceId: 'B1', title: 'T', body: 'b' })).toContain('mode=replace_all&text=%23%20T%0Ab');
  });
  it('maps Sticky Notes rows and the update', () => {
    const t = msToTicks(Date.UTC(2026, 9, 1));
    expect(ticksToMs(t)).toBe(Date.UTC(2026, 9, 1));
    expect(stickyPlain('\\id=abc-1 Call mum\n\\id=def-2 at 6')).toBe('Call mum\nat 6');
    const notes = fromStickyRows([{ Id: 's1', Text: '\\id=abc Call mum\n\\id=def at 6', CreatedAt: t, UpdatedAt: t, DeletedAt: null }, { Id: 's2', Text: 'x', DeletedAt: 5 }]);
    expect(notes).toEqual([expect.objectContaining({ sourceId: 's1', title: 'Call mum', body: 'at 6', modified: Date.UTC(2026, 9, 1) })]);
    const q = stickyUpdate({ sourceId: 's1', title: 'A', body: 'b' }, 0);
    expect(q.sql).toBe('UPDATE Note SET Text = ?, UpdatedAt = ? WHERE Id = ?');
    expect(stickyPlain(String(q.params[0]))).toBe('A\nb');
  });
});

describe('file imports through the service layer', () => {
  const deps = { secret: async () => undefined, openUrl: async () => undefined, trashFile: async () => undefined, island: { get: async () => [], save: async () => undefined }, ctx: {} };
  it('imports a Keep Takeout folder (import only: no writes offered)', async () => {
    const io = await connectorIO({ id: 'k', kind: 'keep', label: 'Keep', enabled: true, writeBack: false, pushNew: false, fields: { path: path.join(FX, 'keep') }, everyMin: 0, reviewed: true }, deps);
    const l = await io.list();
    expect(l.complete).toBe(false);
    expect(l.notes.map((n) => n.title).sort()).toEqual(['Old', 'Owl-shaped lamp', 'Shopping']);
    expect(io.create).toBeUndefined();
    expect(io.update).toBeUndefined();
  });
  it('imports a JEX file', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'kn-jex-'));
    const { writeTar } = await import('../core/notes-sync/archive');
    const jex = writeTar(jexItems([{ title: 'From JEX', body: 'x', tags: [], created: 1, modified: 2 }]).map((i) => ({ name: i.name, data: new TextEncoder().encode(i.text) })));
    await fsp.writeFile(path.join(dir, 'export.jex'), jex);
    expect(readTar(jex).length).toBe(2);
    const io = await connectorIO({ id: 'j', kind: 'joplin-files', label: 'J', enabled: true, writeBack: false, pushNew: false, fields: { path: path.join(dir, 'export.jex') }, everyMin: 0, reviewed: true }, deps);
    expect((await io.list()).notes.map((n) => n.title)).toEqual(['From JEX']);
    await fsp.rm(dir, { recursive: true, force: true });
  });
  it('asks for the password of an encrypted Standard Notes backup', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'kn-sn-'));
    await fsp.writeFile(path.join(dir, 'b.txt'), JSON.stringify({ version: '004', keyParams: { identifier: 'a', pw_nonce: 'b', version: '004' }, items: [{ uuid: 'x', content_type: 'Note', content: '004:aa:bb:cc' }] }));
    const io = await connectorIO({ id: 's', kind: 'standardnotes', label: 'S', enabled: true, writeBack: false, pushNew: false, fields: { path: path.join(dir, 'b.txt') }, everyMin: 0, reviewed: true }, deps);
    await expect(io.list()).rejects.toThrow(/encrypted: add its password/);
    await fsp.rm(dir, { recursive: true, force: true });
  });
  it('refuses Mac-only and Windows-only apps elsewhere', async () => {
    if (process.platform !== 'darwin') await expect(connectorIO({ id: 'a', kind: 'applenotes', label: 'A', enabled: true, writeBack: false, pushNew: false, fields: {}, everyMin: 0, reviewed: true }, deps)).rejects.toThrow(/Mac/);
    if (process.platform !== 'win32') await expect(connectorIO({ id: 's', kind: 'sticky', label: 'S', enabled: true, writeBack: false, pushNew: false, fields: {}, everyMin: 0, reviewed: true }, deps)).rejects.toThrow(/Windows/);
  });
  it('syncs Keeper’s own quick notes both ways', async () => {
    let store = [{ id: 'q1', text: 'Call Sam\nabout the map', created: 1, updated: 2 }];
    const io = await connectorIO({ id: 'i', kind: 'island', label: 'Q', enabled: true, writeBack: true, pushNew: false, fields: {}, everyMin: 0, reviewed: true }, { ...deps, island: { get: async () => store, save: async (n) => { store = n; } } });
    expect((await io.list()).notes[0]).toMatchObject({ sourceId: 'q1', title: 'Call Sam', body: 'about the map' });
    await io.update!({ sourceId: 'q1', title: 'Call Sam', body: 'tonight', tags: [] });
    expect(store[0].text).toBe('Call Sam\ntonight');
  });
});
