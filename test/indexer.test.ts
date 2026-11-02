// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileIndex } from '../core/indexer';
import { Journal, undoMoves, moveFile } from '../core/journal';
import { parseReply } from '../core/ai';

describe('FileIndex', () => {
  it('scans, persists and searches', async () => {
    const home = mkdtempSync(path.join(tmpdir(), 'keeper-idx-'));
    const dl = path.join(home, 'Downloads');
    mkdirSync(path.join(dl, 'node_modules'), { recursive: true });
    writeFileSync(path.join(dl, 'Invoice.pdf'), 'x'.repeat(100));
    writeFileSync(path.join(dl, 'Screenshot 2026-10-01 at 10.00.00.png'), 'png');
    writeFileSync(path.join(dl, '.hidden'), 'h');
    writeFileSync(path.join(dl, 'node_modules', 'skip.js'), 'x');
    const store = path.join(home, 'index.json');
    const idx = new FileIndex(store, [{ path: dl, label: 'Downloads' }], [], {
      readSource: async (p) => (p.endsWith('.pdf') ? { id: 'gmail', name: 'Gmail', host: 'mail.google.com' } : undefined),
    });
    await idx.scan();
    expect(idx.all().map((f) => f.name).sort()).toEqual(['Invoice.pdf', 'Screenshot 2026-10-01 at 10.00.00.png']);
    idx.setText(path.join(dl, 'Screenshot 2026-10-01 at 10.00.00.png'), 'Tracking number 1Z999');
    idx.setTags(path.join(dl, 'Invoice.pdf'), ['Work', 'tax']);
    await idx.save();

    const again = new FileIndex(store, [{ path: dl, label: 'Downloads' }]);
    expect(await again.load()).toBe(true);
    expect(again.query('pdfs from gmail').hits.map((h) => h.file.name)).toEqual(['Invoice.pdf']);
    expect(again.query('#work').hits).toHaveLength(1);
    expect(again.bySource()[0]).toMatchObject({ id: 'gmail', count: 1 });
    expect(again.totals().document.count).toBe(1);
  });
});

describe('FileIndex saving: a snapshot and a journal', () => {
  function library() {
    const home = mkdtempSync(path.join(tmpdir(), 'keeper-idxj-'));
    const docs = path.join(home, 'Documents');
    mkdirSync(docs, { recursive: true });
    for (let i = 0; i < 20; i++) writeFileSync(path.join(docs, `note ${i}.txt`), `note ${i}`);
    const store = path.join(home, 'data', 'index.json');
    return { home, docs, store, folders: [{ path: docs, label: 'Documents' }] };
  }

  it('keeps small changes in the journal and replays them on loading, without rewriting the snapshot', async () => {
    const { docs, store, folders } = library();
    const idx = new FileIndex(store, folders);
    await idx.scan();
    const snap = statSync(store);
    const a = path.join(docs, 'note 1.txt');
    const b = path.join(docs, 'note 2.txt');
    idx.setText(a, 'hello journal');
    idx.setTags(b, ['Work']);
    idx.setMeta(a, { pages: 3 });
    idx.remove(path.join(docs, 'note 3.txt'));
    idx.rename(path.join(docs, 'note 4.txt'), path.join(docs, 'renamed.txt'));
    await idx.flushLog();
    // The snapshot is untouched; the journal holds a few short lines.
    expect(statSync(store).mtimeMs).toBe(snap.mtimeMs);
    expect(statSync(store).size).toBe(snap.size);
    expect(statSync(`${store}.log`).size).toBeLessThan(2000);

    const back = new FileIndex(store, folders);
    expect(await back.load()).toBe(true);
    expect(back.extras.get(a)?.text).toBe('hello journal');
    expect(back.extras.get(a)?.meta).toEqual({ pages: 3 });
    expect(back.tags.get(b)).toEqual(['work']);
    expect(back.files.has(path.join(docs, 'note 3.txt'))).toBe(false);
    expect(back.files.has(path.join(docs, 'note 4.txt'))).toBe(false);
    expect(back.files.get(path.join(docs, 'renamed.txt'))?.name).toBe('renamed.txt');
    expect(back.files.size).toBe(19);
  });

  it('an unchanged library writes nothing on a rescan; a changed file goes to the journal', async () => {
    const { docs, store, folders } = library();
    const idx = new FileIndex(store, folders);
    await idx.scan();
    // A first read: the brain looks at everything.
    expect(idx.drainChanged()).toBeNull();
    const written = idx.bytesWritten;
    const snap = statSync(store).mtimeMs;
    expect((await idx.scan()).changed).toBe(0);
    expect(idx.bytesWritten).toBe(written);
    expect(statSync(store).mtimeMs).toBe(snap);
    // One file changed, one added.
    writeFileSync(path.join(docs, 'note 5.txt'), 'changed and longer');
    utimesSync(path.join(docs, 'note 5.txt'), new Date(), new Date(Date.now() + 5000));
    writeFileSync(path.join(docs, 'new.txt'), 'new');
    expect((await idx.scan()).changed).toBe(2);
    expect(statSync(store).mtimeMs).toBe(snap);
    expect(idx.bytesWritten - written).toBeLessThan(2000);
    // Only those two are news for the brain.
    expect(idx.drainChanged()?.sort()).toEqual([path.join(docs, 'new.txt'), path.join(docs, 'note 5.txt')]);
    const back = new FileIndex(store, folders);
    await back.load();
    expect(back.files.get(path.join(docs, 'note 5.txt'))?.size).toBe('changed and longer'.length);
    expect(back.files.has(path.join(docs, 'new.txt'))).toBe(true);
  });

  it('skips a half-written last line, and lines left from before the last snapshot', async () => {
    const { docs, store, folders } = library();
    const idx = new FileIndex(store, folders);
    await idx.scan();
    idx.setText(path.join(docs, 'note 1.txt'), 'kept');
    await idx.flushLog();
    appendFileSync(`${store}.log`, '{"g":');
    let back = new FileIndex(store, folders);
    expect(await back.load()).toBe(true);
    expect(back.extras.get(path.join(docs, 'note 1.txt'))?.text).toBe('kept');
    // Quitting folds the journal into the snapshot; a journal line still being written then belongs to the old one.
    back.saveSync();
    appendFileSync(`${store}.log`, `${JSON.stringify({ g: 1, t: [path.join(docs, 'note 2.txt'), ['stale']] })}\n`);
    back = new FileIndex(store, folders);
    await back.load();
    expect(back.extras.get(path.join(docs, 'note 1.txt'))?.text).toBe('kept');
    expect(back.tags.has(path.join(docs, 'note 2.txt'))).toBe(false);
  });

  it('a new snapshot empties the journal', async () => {
    const { docs, store, folders } = library();
    const idx = new FileIndex(store, folders);
    await idx.scan();
    for (let i = 0; i < 10; i++) idx.setText(path.join(docs, `note ${i}.txt`), `text ${i}`.repeat(50));
    await idx.flushLog();
    expect(statSync(`${store}.log`).size).toBeGreaterThan(1000);
    await idx.save();
    expect(statSync(`${store}.log`).size).toBeLessThan(40);
    expect(JSON.parse(readFileSync(store, 'utf8')).extras[path.join(docs, 'note 9.txt')].text).toContain('text 9');
    expect(existsSync(`${store}.tmp`)).toBe(false);
  });
});

describe('walking folders', () => {
  it('finds the same files with direct and asynchronous looks at their details', async () => {
    const { walk } = await import('../core/walk');
    const root = mkdtempSync(path.join(tmpdir(), 'keeper-walk-'));
    for (let d = 0; d < 5; d++) {
      mkdirSync(path.join(root, `d${d}`, 'sub'), { recursive: true });
      for (let i = 0; i < 120; i++) writeFileSync(path.join(root, `d${d}`, i % 2 ? 'sub' : '', `f${i}.txt`), 'x'.repeat(i));
    }
    const list = async (statSync: boolean) => {
      const out: string[] = [];
      await walk(root, { statSync, onEntry: (e) => { out.push(`${e.path}:${e.stats.size}`); } });
      return out.sort();
    };
    const direct = await list(true);
    expect(direct).toHaveLength(600);
    expect(direct).toEqual(await list(false));
  });
});

describe('Journal', () => {
  it('records moves and undoes them', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'keeper-j-'));
    const a = path.join(dir, 'a.txt');
    const b = path.join(dir, 'sub', 'a.txt');
    writeFileSync(a, 'hi');
    mkdirSync(path.dirname(b));
    await moveFile(a, b);
    const j = new Journal(path.join(dir, 'journal.json'));
    const e = await j.record('Moved', [{ type: 'move', from: a, to: b, size: 2 }]);
    expect(e?.undoable).toBe(true);
    const r = await undoMoves(e!);
    expect(r.restored).toBe(1);
    const j2 = new Journal(path.join(dir, 'journal.json'));
    await j2.load();
    expect(j2.list()).toHaveLength(1);
  });
});

describe('assistant replies', () => {
  it('keeps only suggestions for files it was shown', () => {
    const allowed = new Map([['/u/Downloads/a.dmg', { path: '/u/Downloads/a.dmg', size: 100 } as never]]);
    const raw = 'You can remove the installer.\n```json\n{"suggestions":[{"path":"~/Downloads/a.dmg","reason":"installed","safety":"safe"},{"path":"/etc/passwd","reason":"x"}],"search":"installers"}\n```';
    const r = parseReply(raw, allowed, '/u');
    expect(r.text).toBe('You can remove the installer.');
    expect(r.suggestions).toEqual([{ path: '/u/Downloads/a.dmg', reason: 'installed', size: 100, safety: 'safe' }]);
    expect(r.search).toBe('installers');
  });
});

describe('undo removes folders an action created', () => {
  it('moves back and deletes the now-empty folder', async () => {
    const { mkdtempSync, writeFileSync, mkdirSync, existsSync } = await import('node:fs');
    const os = await import('node:os');
    const p = await import('node:path');
    const dir = mkdtempSync(p.join(os.tmpdir(), 'keeper-undo-'));
    const from = p.join(dir, 'a.pdf');
    const folder = p.join(dir, 'Documents');
    writeFileSync(from, 'x');
    mkdirSync(folder);
    await moveFile(from, p.join(folder, 'a.pdf'));
    const r = await undoMoves({ id: 'x', at: 0, title: '', freed: 0, undoable: true, ops: [{ type: 'create', from: folder, size: 0 }, { type: 'move', from, to: p.join(folder, 'a.pdf'), size: 0 }] });
    expect(r.restored).toBe(1);
    expect(existsSync(from)).toBe(true);
    expect(existsSync(folder)).toBe(false);
  });
});
