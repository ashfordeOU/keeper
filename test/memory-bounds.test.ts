// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Saving the library index and the brain without building them in memory
// first, text kept without the file it was cut from, and the brain's word
// index holding its postings compactly.
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Bm25 } from '../core/brain/bm25';
import { BrainEngine } from '../core/brain/engine';
import { LocalBrain } from '../core/brain/local';
import { FileIndex } from '../core/indexer';
import { JsonChunks, ownString, writeChunksAtomic, writeChunksAtomicSync } from '../core/json-chunks';
import type { FileEntry } from '../core/types';

const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'keeper-mem-'));

function entry(p: string, i: number, extra: Partial<FileEntry> = {}): FileEntry {
  return { path: p, name: path.basename(p), ext: 'txt', kind: 'document', size: 100 + i, mtime: 1000 + i, btime: 1000 + i, atime: 0, root: 'Documents', ...extra };
}

describe('JsonChunks', () => {
  it('writes the same JSON as JSON.stringify, across many buffers', () => {
    const out = new JsonChunks();
    const big = Array.from({ length: 200_000 }, (_v, i) => (i % 7 ? i : i + 0.5));
    out.raw('{"a":').nums(big).raw(',"b":').value('quote " and é ✓  ').raw(',"c":').nums([1, NaN, Infinity, undefined as unknown as number, -2]).raw(',"d":').num(undefined).raw('}');
    const parts = out.done();
    expect(parts.length).toBeGreaterThan(1);
    expect(Buffer.concat(parts).toString('utf8')).toBe(JSON.stringify({ a: big, b: 'quote " and é ✓  ', c: [1, null, null, null, -2], d: null }));
  });

  it('writes files atomically, asynchronously or at once', async () => {
    const dir = tmp();
    const f = path.join(dir, 'sub', 'x.json');
    await writeChunksAtomic(f, [Buffer.from('{"a":'), Buffer.from('1}')]);
    expect(JSON.parse(readFileSync(f, 'utf8'))).toEqual({ a: 1 });
    writeChunksAtomicSync(f, [Buffer.from('[2]')]);
    expect(JSON.parse(readFileSync(f, 'utf8'))).toEqual([2]);
    expect(existsSync(`${f}.tmp`)).toBe(false);
  });
});

describe('ownString', () => {
  it('keeps the text exactly, including unusual characters', () => {
    for (const s of ['', 'short', 'x'.repeat(50_000).slice(0, 20_000), 'é✓😀 \u0000 \ud800 lone', 'a\nb\tc"d\\e']) expect(ownString(s)).toBe(s);
  });
});

describe('FileIndex saving', () => {
  it('saves the same index it loads, without the text of files', async () => {
    const dir = tmp();
    const file = path.join(dir, 'index.json');
    const ix = new FileIndex(file, [{ path: '/h/Documents', label: 'Documents' }]);
    for (let i = 0; i < 3000; i++) ix.files.set(`/h/Documents/f${i}.txt`, entry(`/h/Documents/f${i}.txt`, i, i % 3 ? {} : { tags: ['work'], source: { id: 'gmail', name: 'Gmail', host: 'mail.google.com' } as FileEntry['source'] }));
    ix.setTags('/h/Documents/f1.txt', ['Plans', 'é']);
    ix.setText('/h/Documents/f2.txt', 'hello "world" ✓');
    ix.hashes.set('/h/Documents/f3.txt', { size: 103, mtime: 1003, sha256: 'ab' });
    ix.lastScan = 12345;
    await ix.save();
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    // Exactly what the earlier whole-object save wrote.
    expect(saved).toEqual(JSON.parse(JSON.stringify({
      version: 3,
      savedAt: 12345,
      files: [...ix.files.values()].map((f) => ({ ...f, text: undefined })),
      tags: Object.fromEntries(ix.tags),
      extras: Object.fromEntries(ix.extras),
      hashes: Object.fromEntries(ix.hashes),
    })));
    const back = new FileIndex(file, []);
    expect(await back.load()).toBe(true);
    expect(back.files.size).toBe(3000);
    expect(back.files.get('/h/Documents/f2.txt')?.text).toBeUndefined();
    expect(back.extras.get('/h/Documents/f2.txt')?.text).toBe('hello "world" ✓');
    expect(back.tags.get('/h/Documents/f1.txt')).toEqual(['plans', 'é']);
    back.saveSync();
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(saved);
  });

  it('never writes twice at once: saves asked for meanwhile follow the one being written', async () => {
    const dir = tmp();
    const file = path.join(dir, 'index.json');
    const ix = new FileIndex(file, []);
    ix.files.set('/a', entry('/a', 1));
    let writes = 0;
    const orig = ix.serialize.bind(ix);
    ix.serialize = () => { writes++; return orig(); };
    const a = ix.save();
    ix.files.set('/b', entry('/b', 2));
    const b = ix.save();
    const c = ix.save();
    await Promise.all([a, b, c]);
    expect(writes).toBe(2);
    expect(JSON.parse(readFileSync(file, 'utf8')).files.map((f: FileEntry) => f.path)).toEqual(['/a', '/b']);
  });

  it('keeps text read from a file without keeping the whole file', () => {
    const ix = new FileIndex(null, []);
    ix.files.set('/a.txt', entry('/a.txt', 1));
    const whole = 'word '.repeat(200_000);
    ix.setText('/a.txt', whole.slice(0, 20_000));
    expect(ix.files.get('/a.txt')?.text).toBe(whole.slice(0, 20_000));
    expect(ix.extras.get('/a.txt')?.text).toBe(ix.files.get('/a.txt')?.text);
  });
});

describe('brain saving', () => {
  const texts = (f: FileEntry) => Promise.resolve(f.path.endsWith('.bin') ? undefined : `# Notes ${f.name}\n\n${'alpha beta gamma delta '.repeat(40 + (f.size % 50))}\n\nPlan for café ✓ ${f.mtime}\n\n${'epsilon zeta '.repeat(120)}`);

  it('writes the same JSON as toJSON(), postings in order even after changes', async () => {
    const e = new BrainEngine({ getText: texts });
    const files = Array.from({ length: 300 }, (_v, i) => entry(`/h/Documents/n${i}.${i % 10 ? 'md' : 'bin'}`, i));
    await e.sync(files);
    // Changed and removed files: passage numbers are reused, so postings fall out of order.
    await e.sync([...files.slice(50).map((f, i) => (i % 3 ? f : { ...f, mtime: f.mtime + 1 })), entry('/h/new.md', 999)]);
    const out = new JsonChunks();
    e.writeJSON(out);
    // The same JSON (an object lists number-like keys first, so the text may order terms differently).
    expect(JSON.parse(out.text())).toEqual(JSON.parse(JSON.stringify(e.toJSON())));
    const again = new BrainEngine({ getText: texts });
    again.load(JSON.parse(out.text()));
    expect(again.files.size).toBe(e.files.size);
    expect((await again.search({ query: 'café', limit: 5 }, new Map(files.slice(50).map((f) => [f.path, f])))).length).toBeGreaterThan(0);
  });

  it('LocalBrain saves to disk and loads back, one save at a time', async () => {
    const dir = tmp();
    const ix = new FileIndex(null, [{ path: '/h', label: 'h' }]);
    const files = Array.from({ length: 50 }, (_v, i) => entry(`/h/n${i}.md`, i));
    for (const f of files) ix.files.set(f.path, f);
    const lb = new LocalBrain({ index: () => ix, dir, excluded: () => [], visibility: () => 'snippets' });
    lb.engine = new BrainEngine({ getText: texts });
    await lb.sync();
    await Promise.all([lb.save(), lb.save(), lb.save()]);
    const saved = readFileSync(path.join(dir, 'brain.json'), 'utf8');
    expect(JSON.parse(saved)).toEqual(JSON.parse(JSON.stringify(lb.engine.toJSON())));
    const back = new LocalBrain({ index: () => ix, dir, excluded: () => [], visibility: () => 'snippets' });
    expect(await back.load()).toBe(true);
    expect(back.engine.files.size).toBe(50);
    writeFileSync(path.join(dir, 'brain.json'), '{}');
    lb.markDirty();
    lb.saveSync();
    expect(readFileSync(path.join(dir, 'brain.json'), 'utf8')).toBe(saved);
  });
});

describe('Bm25 postings', () => {
  const words = (i: number) => Array.from({ length: 30 + (i % 17) }, (_v, k) => `w${(i * 7 + k * k) % 97}`);
  const scores = (b: Bm25, q: string[]) => b.search(q, 1000).map((h) => h.score.toFixed(9)).sort();

  it('ranks the same after removals, compacting and trimming as an index built without them', () => {
    const a = new Bm25();
    const docs: number[] = [];
    for (let i = 0; i < 3000; i++) docs.push(a.add(words(i), i % 5 ? 1 : 1.6));
    for (let i = 1; i < 3000; i += 2) a.remove(docs[i]);
    a.compact();
    a.trim(true);
    const b = new Bm25();
    for (let i = 0; i < 3000; i += 2) b.add(words(i), i % 5 ? 1 : 1.6);
    for (const q of [['w1'], ['w5', 'w9'], ['w42', 'w3', 'w77']]) expect(scores(a, q)).toEqual(scores(b, q));
    // Saved and loaded, the same again.
    expect(scores(Bm25.fromJSON(JSON.parse(JSON.stringify(a.toJSON()))), ['w5', 'w9'])).toEqual(scores(b, ['w5', 'w9']));
  });

  it('reuses freed passage numbers and still saves postings in order', () => {
    const a = new Bm25();
    for (let i = 0; i < 2000; i++) a.add(['x', `y${i % 3}`]);
    for (let i = 0; i < 1500; i++) a.remove(i);
    a.compact();
    for (let i = 0; i < 10; i++) a.add(['x', 'z']);
    const terms = a.toJSON().terms;
    const n = terms.x.length / 2;
    expect(terms.x.slice(1, n).every((d) => d > 0)).toBe(true);
    expect(a.search(['x'], 5000).length).toBe(510);
  });

  it('counts a word up to 255 times in one passage', () => {
    const a = new Bm25();
    a.add(Array.from({ length: 300 }, () => 'same'));
    a.add(['same', 'other']);
    expect(a.toJSON().terms.same.slice(2)).toEqual([255, 1]);
  });
});
