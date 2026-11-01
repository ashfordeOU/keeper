// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { crc32, readTar, readZip, writeTar, writeZip } from '../core/notes-sync/archive';
import { diffManifests, needsSnapshot, pruneSnapshots } from '../core/notes-sync/backup';
import { attachmentPath, docOf, freeHubPath, hubPathFor, lockedStub, parseHubNote, safeName, serializeHubNote, splitDoc, textHash } from '../core/notes-sync/hub';
import { htmlToMarkdown, markdownToHtml, plainText } from '../core/notes-sync/markdown';
import type { HubNote } from '../core/notes-sync/types';
import { HubStore } from '../electron/services/notes-sync/hubstore';

describe('hub files', () => {
  const note: HubNote = {
    keeperId: 'k-1', title: 'Shopping: weekend', body: 'Milk\n- [ ] eggs', tags: ['home', '#food', 'home'], created: Date.UTC(2026, 9, 1), modified: Date.UTC(2026, 9, 30),
    sources: [{ connector: 'joplin-1', app: 'joplin', id: 'abc', version: '17', hash: 'h1', tagsHash: 't1', synced: Date.UTC(2026, 9, 30), folder: 'Home' }],
    attachments: [{ name: 'pan.png', hash: 'ff00', mime: 'image/png' }], extra: { aliases: ['groceries'], rating: 5 },
  };
  it('round-trips a note with its properties', () => {
    const text = serializeHubNote(note);
    expect(text).toMatch(/^---\nkeeper-id: k-1\n/);
    expect(text).toContain('source: joplin');
    expect(text).toContain('source-id: abc');
    const back = parseHubNote(text, 'Joplin/Home/Shopping.md');
    expect(back).toMatchObject({ keeperId: 'k-1', title: 'Shopping: weekend', body: 'Milk\n- [ ] eggs', tags: ['food', 'home'], created: note.created, modified: note.modified, rel: 'Joplin/Home/Shopping.md' });
    expect(back.sources[0]).toMatchObject({ connector: 'joplin-1', app: 'joplin', id: 'abc', version: '17', hash: 'h1', tagsHash: 't1', folder: 'Home', synced: note.sources[0].synced });
    expect(back.attachments).toEqual([{ name: 'pan.png', hash: 'ff00', mime: 'image/png' }]);
    expect(back.extra).toEqual({ aliases: ['groceries'], rating: 5 });
  });
  it('reads a Markdown file written by hand', () => {
    const n = parseHubNote('# Hello\nworld', 'Inbox/Hello there.md', 5);
    expect(n).toMatchObject({ keeperId: '', title: 'Hello there', body: '# Hello\nworld', sources: [], created: 5 });
  });
  it('hashes title and body together, ignoring trailing spaces', () => {
    expect(textHash('A', 'b  \n')).toBe(textHash('A', 'b'));
    expect(textHash('A', 'b')).not.toBe(textHash('B', 'b'));
    expect(splitDoc(docOf('T', 'x\ny'))).toEqual({ title: 'T', body: 'x\ny' });
  });
  it('makes safe, unique paths', () => {
    expect(safeName('a/b: c?*')).toBe('a b c');
    expect(safeName('   ')).toBe('Untitled');
    expect(hubPathFor('Apple Notes', 'iCloud/Travel', 'Trip #1')).toBe('Apple Notes/iCloud/Travel/Trip 1.md');
    expect(freeHubPath('A/x.md', (r) => r === 'A/x.md' || r === 'A/x 2.md')).toBe('A/x 3.md');
    expect(attachmentPath('abcdef', 'Photo.JPG')).toBe('attachments/ab/abcdef.jpg');
    expect(lockedStub('Apple Notes')).toContain('locked in Apple Notes');
  });
});

describe('HTML and Markdown', () => {
  it('turns Apple Notes HTML into Markdown', () => {
    const html = '<div><h1>Trip</h1></div><div>First line</div><div>Second <b>bold</b> and <i>it</i></div><div><br></div><ul><li>one</li><li>two<ul><li>nested</li></ul></li></ul><div><a href="https://x.org">link</a></div>';
    expect(htmlToMarkdown(html)).toBe('# Trip\n\nFirst line\nSecond **bold** and *it*\n\n- one\n- two\n  - nested\n\n[link](https://x.org)');
  });
  it('keeps checklists, code, quotes, tables and entities', () => {
    expect(htmlToMarkdown('<ul class="checklist"><li class="checked">done</li><li>todo</li></ul>')).toBe('- [x] done\n- [ ] todo');
    expect(htmlToMarkdown('<pre><code class="language-js">a &lt; b</code></pre>')).toBe('```js\na < b\n```');
    expect(htmlToMarkdown('<blockquote><p>wise</p></blockquote>')).toBe('> wise');
    expect(htmlToMarkdown('<table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table>')).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |');
    expect(htmlToMarkdown('<p>Fish &amp; chips&nbsp;&#8212; 5*2</p>')).toBe('Fish & chips — 5\\*2');
    expect(htmlToMarkdown('<p>x<script>alert(1)</script>y</p><style>p{}</style>')).toBe('xy');
  });
  it('turns Markdown into HTML and back', () => {
    const md = '# Title\n\nSome **bold** and *it* with `code` and [a link](https://x.org).\n\n- [x] done\n- [ ] todo\n  - nested\n\n1. one\n2. two\n\n> quoted\n\n```\nraw <b>\n```\n\n---';
    const html = markdownToHtml(md);
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<b>bold</b>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('<input type="checkbox" checked="checked"/>');
    expect(html).toContain('raw &lt;b&gt;');
    const back = htmlToMarkdown(html);
    expect(back).toContain('# Title');
    expect(back).toContain('- [x] done');
    expect(back).toContain('  - nested');
    expect(back).toContain('1. one');
    expect(back).toContain('> quoted');
    expect(back).toContain('[a link](https://x.org)');
  });
  it('writes the Apple Notes flavour: one div per line', () => {
    expect(markdownToHtml('a\nb\n\nc', { flavour: 'apple' })).toBe('<div>a</div><div>b</div><div><br/></div><div>c</div>');
    expect(htmlToMarkdown(markdownToHtml('a\nb\n\nc', { flavour: 'apple' }))).toBe('a\nb\n\nc');
  });
  it('makes plain text for snippets', () => {
    expect(plainText('# T\n- [x] **done** [l](u)')).toBe('T done l');
  });
});

describe('archives', () => {
  const enc = new TextEncoder();
  it('writes and reads tar (JEX)', () => {
    const t = writeTar([{ name: 'a.md', data: enc.encode('hello') }, { name: `${'d'.repeat(120)}/resources/x.png`, data: new Uint8Array(700) }]);
    expect(t.length % 512).toBe(0);
    const back = readTar(t);
    expect(back.map((e) => e.name)).toEqual(['a.md', `${'d'.repeat(120)}/resources/x.png`]);
    expect(new TextDecoder().decode(back[0].data)).toBe('hello');
    expect(back[1].data.length).toBe(700);
  });
  it('writes and reads zip', () => {
    expect(crc32(enc.encode('hello'))).toBe(0x3610a686);
    const z = writeZip([{ name: 'Notes/ä.md', data: enc.encode('one') }, { name: 'b.txt', data: enc.encode('two') }]);
    const back = readZip(z);
    expect(back.map((e) => [e.name, new TextDecoder().decode(e.data)])).toEqual([['Notes/ä.md', 'one'], ['b.txt', 'two']]);
  });
});

describe('snapshots', () => {
  it('diffs manifests and decides when a snapshot is needed', () => {
    const a = { id: 'a', time: 1, files: { 'x.md': '1', 'y.md': '2' } };
    const b = { id: 'b', time: 2, files: { 'x.md': '1', 'y.md': '3', 'z.md': '4' } };
    expect(diffManifests(a, b)).toEqual({ added: ['z.md'], changed: ['y.md'], removed: [] });
    expect(needsSnapshot(a, a.files)).toBe(false);
    expect(needsSnapshot(a, b.files)).toBe(true);
    expect(needsSnapshot(undefined, {})).toBe(false);
  });
  it('prunes old snapshots and finds unused contents', () => {
    const day = 86_400_000;
    const all = Array.from({ length: 30 }, (_, i) => ({ id: `s${i}`, time: Date.UTC(2026, 0, 1) + i * day, files: { 'n.md': `h${i}` } }));
    const { drop, orphans } = pruneSnapshots(all, { last: 2, daily: 3, weekly: 0, monthly: 0, yearly: 0 });
    expect(drop.length).toBe(27);
    expect(orphans(['h0', 'h29'])).toEqual(['h0']);
  });
});

describe('the hub folder on disk', () => {
  it('scans, gives hand-written notes an id, trashes, restores and snapshots', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'kn-hub-'));
    await fsp.mkdir(path.join(root, 'Inbox'));
    await fsp.writeFile(path.join(root, 'Inbox', 'Hand made.md'), 'Written by hand');
    await fsp.mkdir(path.join(root, '.obsidian'));
    await fsp.writeFile(path.join(root, '.obsidian', 'x.md'), 'not a note');
    const h = new HubStore(root);
    const notes = await h.scan();
    expect(notes).toHaveLength(1);
    expect(notes[0].keeperId).toMatch(/^k-/);
    expect(await fsp.readFile(path.join(root, 'Inbox', 'Hand made.md'), 'utf8')).toContain(`keeper-id: ${notes[0].keeperId}`);
    const written = await h.write({ keeperId: 'k-new', title: 'From Joplin', body: 'x', tags: [], created: 1, modified: 1, sources: [{ connector: 'j', app: 'joplin', id: '1' }] }, { appFolder: 'Joplin', folder: 'Trips' });
    expect(written.rel).toBe('Joplin/Trips/From Joplin.md');
    const s1 = await h.snapshot('first');
    expect(s1 && Object.keys(s1.files)).toHaveLength(2);
    expect(await h.snapshot()).toBeNull();
    await h.moveToTrash(written, 'deleted in Joplin');
    expect(await fsp.access(path.join(root, written.rel!)).then(() => true, () => false)).toBe(false);
    const trash = await h.trashList();
    expect(trash[0]).toMatchObject({ keeperId: 'k-new', why: 'deleted in Joplin' });
    await h.restore(trash[0].id);
    expect(h.get('k-new')?.rel).toBe('Joplin/Trips/From Joplin.md');
    const hash = await h.putBase('T', 'body');
    const h2 = new HubStore(root);
    await h2.loadBases([hash]);
    expect(h2.base(hash)).toBe(docOf('T', 'body'));
    await h.log([{ at: 1, keeperId: 'k-new', title: 'x', action: 'added' }, { at: 2, keeperId: 'other', title: 'y', action: 'added' }]);
    expect((await h.history('k-new')).map((e) => e.at)).toEqual([1]);
    await fsp.writeFile(path.join(root, 'Joplin', 'Trips', 'From Joplin.md'), 'broken');
    const restored = await h.restoreSnapshot(s1!.id);
    expect(restored).toBe(2);
    expect(await fsp.readFile(path.join(root, 'Joplin', 'Trips', 'From Joplin.md'), 'utf8')).toContain('keeper-id: k-new');
    await fsp.rm(root, { recursive: true, force: true });
  });
  it('notices notes deleted by hand', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'kn-hub-'));
    const h = new HubStore(root);
    await h.scan();
    const n = await h.write({ keeperId: 'k-gone', title: 'Bye', body: 'x', tags: [], created: 1, modified: 1, sources: [{ connector: 'j', app: 'joplin', id: '1' }] }, { appFolder: 'Joplin' });
    await h.scan();
    await fsp.rm(path.join(root, n.rel!));
    await h.scan();
    expect(h.vanished.map((x) => x.keeperId)).toEqual(['k-gone']);
    await h.forgetVanished('k-gone', 'j');
    await h.scan();
    expect(h.vanished).toEqual([]);
    await fsp.rm(root, { recursive: true, force: true });
  });
});
