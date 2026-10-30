import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
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
