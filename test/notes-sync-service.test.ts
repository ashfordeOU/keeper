// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The Notes Everywhere service end to end with a plain folder and a Keep
// Takeout import: dry run, first sync, edits both ways, a conflict and its
// resolution, deletes into the notes trash, duplicates, snapshots and exports.

import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const ROOT = await fsp.mkdtemp(path.join(os.tmpdir(), 'kn-svc-'));
const secrets = new Map<string, string>();
const flags: Record<string, boolean> = { notesHub: true, notesSync: false };

vi.mock('electron', () => ({
  app: { getPath: (k: string) => path.join(ROOT, k) },
  shell: { openExternal: async () => undefined, trashItem: async (p: string) => (await import('node:fs')).promises.rm(p) },
}));
vi.mock('../electron/store', () => ({ getSecret: async (k: string) => secrets.get(k), setSecret: async (k: string, v: string) => { secrets.set(k, v); return true; } }));
vi.mock('../electron/services/features', () => ({ featureOn: (id: string) => flags[id] ?? true, onFeature: () => () => undefined }));
vi.mock('../electron/services/governor', () => ({ poll: () => () => undefined }));

const { notesApi, notesFindings, startNotes } = await import('../electron/services/notes-sync');

const VAULT = path.join(ROOT, 'Vault');
const HUB = path.join(ROOT, 'documents', 'Keeper Notes');
const read = (p: string) => fsp.readFile(p, 'utf8');
const touch = async (p: string, text: string) => { await fsp.writeFile(p, text); const t = new Date(Date.now() + Math.random() * 1000 + 2000); await fsp.utimes(p, t, t); };

beforeAll(async () => {
  await fsp.mkdir(path.join(VAULT, 'Trips'), { recursive: true });
  await fsp.writeFile(path.join(VAULT, 'Trips', 'Lisbon.md'), '---\ntags: [travel]\n---\nline one\nline two\nline three\n');
  await fsp.writeFile(path.join(VAULT, 'Gift ideas.md'), '- Mum: a pottery class\n- Sam: the hiking map\n');
  await fsp.writeFile(path.join(VAULT, 'Scratch.txt'), 'temporary');
  await startNotes({ userData: path.join(ROOT, 'userData'), broadcast: () => undefined });
});
afterAll(async () => { await fsp.rm(ROOT, { recursive: true, force: true }); });

describe('Notes Everywhere service', () => {
  let folderId = '';
  let keepId = '';

  it('connects a folder read-only and refuses to sync before the dry run', async () => {
    const ov = await notesApi.addConnector({ kind: 'folder', fields: { path: VAULT } });
    expect(ov.hubFolder).toBe(HUB);
    const c = ov.connectors[0];
    folderId = c.id;
    expect(c).toMatchObject({ label: 'Vault', writeBack: false, reviewed: false, state: 'needs-review', capability: 'two-way' });
    await expect(notesApi.sync(folderId)).rejects.toThrow(/dry run first/);
    await expect(notesApi.addConnector({ kind: 'folder', fields: { path: HUB } })).rejects.toThrow(/notes folder/);
  });

  it('shows a dry run that changes nothing, then syncs', async () => {
    const p = await notesApi.plan(folderId);
    expect(p.summary).toBe('Would add 3, update 0, conflicts 0');
    expect(await fsp.readdir(HUB).catch(() => [])).not.toContain('Folders');
    const r = await notesApi.sync(folderId);
    expect(r.errors).toEqual([]);
    expect(r.done.add).toBe(3);
    const lisbon = await read(path.join(HUB, 'Folders', 'Vault', 'Trips', 'Lisbon.md'));
    expect(lisbon).toMatch(/keeper-id: k-/);
    expect(lisbon).toContain('source: folder');
    expect(lisbon).toContain('line two');
    const hits = await notesApi.search('line two');
    expect(hits.map((h) => h.title)).toEqual(['Lisbon']);
    expect((await notesApi.tags())[0]).toMatchObject({ tag: 'travel', apps: ['folder'] });
    const again = await notesApi.plan(folderId);
    expect(again.summary).toBe('Would add 0, update 0, conflicts 0');
  });

  it('copies changes made in the app into the hub, and holds Keeper’s changes while write-back is off', async () => {
    await touch(path.join(VAULT, 'Trips', 'Lisbon.md'), '---\ntags: [travel]\n---\nline ONE\nline two\nline three\n');
    let r = await notesApi.sync(folderId);
    expect(r.done.update).toBe(1);
    const [hit] = await notesApi.search('Lisbon');
    const d = (await notesApi.note(hit.keeperId))!;
    expect(d.body).toContain('line ONE');
    expect(d.where[0]).toMatchObject({ app: 'folder', label: 'Vault', inStep: true });
    expect(d.history[0]).toMatchObject({ action: 'updated' });
    await notesApi.saveNote(hit.keeperId, { title: 'Lisbon', body: 'line ONE\nline two\nline THREE' });
    r = await notesApi.sync(folderId);
    expect(r.done.held).toBe(1);
    expect(await read(path.join(VAULT, 'Trips', 'Lisbon.md'))).toContain('line three');
  });

  it('merges edits to different lines once write-back is on', async () => {
    await notesApi.updateConnector(folderId, { writeBack: true });
    await touch(path.join(VAULT, 'Trips', 'Lisbon.md'), '---\ntags: [travel]\n---\nline 1\nline two\nline three\n');
    const p = await notesApi.plan(folderId);
    expect(p.counts.merge).toBe(1);
    await notesApi.sync(folderId);
    expect(await read(path.join(VAULT, 'Trips', 'Lisbon.md'))).toBe('---\ntags:\n  - travel\n---\nline 1\nline two\nline THREE\n');
    const [hit] = await notesApi.search('Lisbon');
    expect((await notesApi.note(hit.keeperId))!.body).toBe('line 1\nline two\nline THREE');
  });

  it('keeps both sides of a real conflict and settles it when asked', async () => {
    const [hit] = await notesApi.search('Lisbon');
    await notesApi.saveNote(hit.keeperId, { title: 'Lisbon', body: 'line 1\nline 2 from Keeper\nline THREE' });
    await touch(path.join(VAULT, 'Trips', 'Lisbon.md'), '---\ntags: [travel]\n---\nline 1\nline 2 from the vault\nline THREE\n');
    const r = await notesApi.sync(folderId);
    expect(r.done.conflicts).toBe(1);
    expect(await read(path.join(VAULT, 'Trips', 'Lisbon.md'))).toContain('from the vault');
    const conflicts = await notesApi.conflicts();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].rows.some((x) => x.kind === 'changed' && x.l === 'line 2 from Keeper' && x.r === 'line 2 from the vault')).toBe(true);
    expect((await notesApi.search('conflict')).length).toBe(1);
    expect((await notesApi.plan(folderId)).items.find((i) => i.action === 'conflict')?.why).toBe('waiting for you to choose');
    expect((await notesFindings()).map((f) => f.id)).toContain('notes:conflicts');
    await notesApi.resolveConflict(conflicts[0].id, 'mine');
    expect(await notesApi.conflicts()).toEqual([]);
    expect((await notesApi.search('conflict')).length).toBe(0);
    await notesApi.sync(folderId);
    expect(await read(path.join(VAULT, 'Trips', 'Lisbon.md'))).toContain('line 2 from Keeper');
  });

  it('moves notes deleted in the app to the notes trash, and restores them', async () => {
    await fsp.rm(path.join(VAULT, 'Scratch.txt'));
    const r = await notesApi.sync(folderId);
    expect(r.done.trash).toBe(1);
    const trash = await notesApi.trash();
    expect(trash.find((t) => t.title === 'Scratch')).toMatchObject({ apps: ['folder'] });
    await notesApi.restore(trash.find((t) => t.title === 'Scratch')!.id);
    expect((await notesApi.search('temporary')).length).toBe(1);
  });

  it('imports a Keep Takeout, finds a duplicate across apps and links it', async () => {
    const keepDir = path.join(ROOT, 'Takeout', 'Keep');
    await fsp.mkdir(keepDir, { recursive: true });
    await fsp.writeFile(path.join(keepDir, 'Gifts.json'), JSON.stringify({ title: 'Gift ideas', textContent: '- Mum: a pottery class\n- Sam: the hiking map!', labels: [{ name: 'family' }], userEditedTimestampUsec: 1730000000000000, createdTimestampUsec: 1720000000000000 }));
    await fsp.writeFile(path.join(keepDir, 'Bike.json'), JSON.stringify({ title: 'Bike', listContent: [{ text: 'Oil chain', isChecked: false }], userEditedTimestampUsec: 1730000000000000 }));
    const ov = await notesApi.addConnector({ kind: 'keep', fields: { path: keepDir } });
    keepId = ov.connectors.find((c) => c.kind === 'keep')!.id;
    await expect(notesApi.updateConnector(keepId, { writeBack: true })).rejects.toThrow(/import only/);
    const p = await notesApi.plan(keepId);
    expect(p.summary).toBe('Would add 2, update 0, conflicts 0');
    expect(p.items.find((i) => i.title === 'Gift ideas')?.duplicateOf).toBeTruthy();
    await notesApi.sync(keepId);
    expect(await read(path.join(HUB, 'Google Keep', 'Bike.md'))).toContain('- [ ] Oil chain');
    const dups = await notesApi.duplicates();
    expect(dups).toHaveLength(1);
    expect(dups[0].notes.flatMap((n) => n.apps).sort()).toEqual(['folder', 'keep']);
    await notesApi.resolveDuplicate(dups[0].id, 'link');
    expect(await notesApi.duplicates()).toEqual([]);
    const [gift] = await notesApi.search('pottery');
    expect((await notesApi.note(gift.keeperId))!.where.map((w) => w.app).sort()).toEqual(['folder', 'keep']);
    // A second import of the same Takeout adds nothing and deletes nothing.
    expect((await notesApi.plan(keepId)).summary).toBe('Would add 0, update 0, conflicts 0');
  });

  it('copies a note into another app and makes snapshots and exports', async () => {
    const [bike] = await notesApi.search('Bike');
    const r = await notesApi.copyTo([bike.keeperId], folderId);
    expect(r.done).toBe(1);
    expect(await read(path.join(VAULT, 'Bike.md'))).toContain('Oil chain');
    expect((await notesApi.note(bike.keeperId))!.where.map((w) => w.app).sort()).toEqual(['folder', 'keep']);
    expect((await notesApi.copyTo([bike.keeperId], keepId)).message).toMatch(/import only/);
    const snaps = await notesApi.snapshots();
    expect(snaps.length).toBeGreaterThan(2);
    for (const f of ['markdown-zip', 'enex', 'jex', 'sn-json'] as const) {
      const e = await notesApi.exportAs(f, { target: path.join(ROOT, `out.${f}`) });
      expect(e.notes).toBeGreaterThan(3);
      expect((await fsp.stat(e.path)).size).toBeGreaterThan(100);
    }
    const ov = await notesApi.overview();
    expect(ov).toMatchObject({ conflicts: 0, duplicates: 0 });
    expect(ov.apps).toBe(2);
    expect((await notesApi.history()).length).toBeGreaterThan(5);
  });

  it('asks before deleting in the app a note deleted in Keeper', async () => {
    const [bike] = await notesApi.search('Bike');
    const rel = (await notesApi.note(bike.keeperId))!.path;
    await fsp.rm(rel);
    const p = await notesApi.plan(folderId);
    const del = p.items.find((i) => i.action === 'delete-app');
    expect(del).toMatchObject({ needsConfirm: true, title: 'Bike' });
    await notesApi.sync(folderId);
    expect(await fsp.access(path.join(VAULT, 'Bike.md')).then(() => true, () => false)).toBe(true);
    await notesApi.sync(folderId, { confirmDeletes: [del!.keeperId!] });
    expect(await fsp.access(path.join(VAULT, 'Bike.md')).then(() => true, () => false)).toBe(false);
  });
});
