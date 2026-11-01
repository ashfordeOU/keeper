// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { changeSummary, lineMatches, merge3, sideBySide } from '../core/notes-sync/diff3';
import { addAppItem, findDuplicates, linkDuplicates, makePlan, planHasWork, similarity, summarize, type EngineInput } from '../core/notes-sync/engine';
import { docOf, tagsHash, textHash } from '../core/notes-sync/hub';
import type { HubNote, RemoteNote, SourceLink } from '../core/notes-sync/types';

const NOW = Date.UTC(2026, 9, 31, 12);

describe('three-way merge', () => {
  it('takes the side that changed', () => {
    expect(merge3('a\nb', 'a\nb', 'a\nB')).toMatchObject({ clean: true, text: 'a\nB' });
    expect(merge3('a\nb', 'A\nb', 'a\nb')).toMatchObject({ clean: true, text: 'A\nb' });
  });
  it('merges edits to different lines', () => {
    const base = 'one\ntwo\nthree\nfour\nfive';
    const r = merge3(base, 'ONE\ntwo\nthree\nfour\nfive', 'one\ntwo\nthree\nfour\nFIVE');
    expect(r.clean).toBe(true);
    expect(r.text).toBe('ONE\ntwo\nthree\nfour\nFIVE');
  });
  it('merges an insertion on one side with an edit on the other', () => {
    const r = merge3('a\nb\nc', 'a\nnew\nb\nc', 'a\nb\nC');
    expect(r).toMatchObject({ clean: true, text: 'a\nnew\nb\nC' });
  });
  it('accepts the same change on both sides', () => {
    expect(merge3('a\nb\nc', 'a\nX\nc', 'a\nX\nc')).toMatchObject({ clean: true, text: 'a\nX\nc' });
    const r = merge3('a\nb\nc\nd', 'a\nX\nc\nD', 'a\nX\nc\nd');
    expect(r).toMatchObject({ clean: true, text: 'a\nX\nc\nD' });
  });
  it('reports a conflict when both change the same line, and keeps mine in the text', () => {
    const r = merge3('a\nb\nc', 'a\nmine\nc', 'a\ntheirs\nc');
    expect(r.clean).toBe(false);
    expect(r.conflicts).toBe(1);
    expect(r.text).toBe('a\nmine\nc');
    expect(r.chunks.find((c) => !c.ok)).toMatchObject({ base: ['b'], mine: ['mine'], theirs: ['theirs'] });
  });
  it('treats two different insertions at the same place as a conflict', () => {
    expect(merge3('a\nb', 'a\nX\nb', 'a\nY\nb').clean).toBe(false);
  });
  it('handles deletions', () => {
    expect(merge3('a\nb\nc\nd', 'a\nc\nd', 'a\nb\nc\nD')).toMatchObject({ clean: true, text: 'a\nc\nD' });
    expect(merge3('a\nb\nc', 'a\nc', 'a\nB\nc').clean).toBe(false);
  });
  it('handles empty texts', () => {
    expect(merge3('', 'x', '')).toMatchObject({ clean: true, text: 'x' });
    expect(merge3('', 'x', 'y').clean).toBe(false);
  });
  it('finds common lines in order', () => {
    expect(lineMatches(['a', 'b', 'c'], ['a', 'x', 'c'])).toEqual([[0, 0], [2, 2]]);
  });
  it('summarises and compares side by side', () => {
    expect(changeSummary('a\nb', 'a\nc\nd')).toBe('+2 −1 lines');
    expect(changeSummary('a', 'a')).toBe('no text changes');
    const rows = sideBySide('a\nb\nc', 'a\nB\nc\nd');
    expect(rows.map((r) => r.kind)).toEqual(['same', 'changed', 'same', 'right']);
  });
});

// ---------------------------------------------------------------- planning

let seq = 0;
const newId = () => `k-${++seq}`;
const C = { id: 'joplin-1', kind: 'joplin' as const, name: 'Joplin', capability: 'two-way' as const };

function linked(title: string, body: string, sid: string, extra: Partial<HubNote> = {}, link: Partial<SourceLink> = {}): HubNote {
  return { keeperId: `h-${sid}`, title, body, tags: [], created: 1, modified: 1, rel: `Joplin/${title}.md`, sources: [{ connector: C.id, app: 'joplin', id: sid, hash: textHash(title, body), tagsHash: tagsHash([]), version: '1', ...link }], ...extra };
}
const remote = (sid: string, title: string, body: string, extra: Partial<RemoteNote> = {}): RemoteNote => ({ sourceId: sid, title, body, tags: [], version: '2', ...extra });

function plan(over: Partial<EngineInput>) {
  const bases = new Map<string, string>();
  for (const n of over.hub ?? []) for (const s of n.sources) if (s.hash && (over as { baseText?: Record<string, string> }).baseText?.[s.id]) bases.set(s.hash, (over as { baseText: Record<string, string> }).baseText[s.id]);
  return makePlan({ connector: C, hub: [], remote: [], complete: true, base: (h) => bases.get(h), writeBack: true, now: NOW, newId, ...over });
}

describe('sync plan', () => {
  it('adds new notes and says so in the dry-run summary', () => {
    const p = plan({ remote: [remote('a', 'One', 'x'), remote('b', 'Two', 'y')] });
    expect(p.counts.add).toBe(2);
    expect(p.summary).toBe('Would add 2, update 0, conflicts 0');
    expect(p.items[0].hub?.sources[0]).toMatchObject({ connector: 'joplin-1', id: 'a', hash: textHash('One', 'x') });
    expect(planHasWork(p)).toBe(true);
  });
  it('does nothing for notes that did not change', () => {
    const p = plan({ hub: [linked('One', 'x', 'a')], remote: [remote('a', 'One', 'x')] });
    expect(p.counts.unchanged).toBe(1);
    expect(planHasWork(p)).toBe(false);
  });
  it('updates the hub when only the app changed', () => {
    const p = plan({ hub: [linked('One', 'x', 'a')], remote: [remote('a', 'One', 'x2')] });
    expect(p.items[0]).toMatchObject({ action: 'update', why: 'changed in Joplin' });
    expect(p.items[0].hub?.body).toBe('x2');
    expect(p.items[0].hub?.sources[0].hash).toBe(textHash('One', 'x2'));
  });
  it('writes back when only the hub changed and write-back is on', () => {
    const h = { ...linked('One', 'x', 'a'), body: 'edited' };
    const p = plan({ hub: [h], remote: [remote('a', 'One', 'x')] });
    expect(p.items[0]).toMatchObject({ action: 'update-app' });
    expect(p.items[0].app).toMatchObject({ sourceId: 'a', body: 'edited' });
  });
  it('holds hub changes back while write-back is off (connectors start read-only)', () => {
    const h = { ...linked('One', 'x', 'a'), body: 'edited' };
    const p = plan({ hub: [h], remote: [remote('a', 'One', 'x')], writeBack: false });
    expect(p.items[0].action).toBe('held');
    expect(p.summary).toContain('1 held back');
  });
  it('never writes to an import-only app, even with write-back on', () => {
    const h = { ...linked('One', 'x', 'a'), body: 'edited' };
    const p = makePlan({ connector: { ...C, capability: 'import-only' }, hub: [h], remote: [remote('a', 'One', 'x')], complete: false, base: () => undefined, writeBack: true, now: NOW, newId });
    expect(p.items[0]).toMatchObject({ action: 'update', why: 'unchanged' });
    expect(p.items[0].app).toBeUndefined();
    expect(planHasWork(p)).toBe(false);
  });
  it('merges changes to different lines made on both sides', () => {
    const base = 'l1\nl2\nl3\nl4';
    const h = { ...linked('Doc', base, 'a'), body: 'L1\nl2\nl3\nl4' };
    const bases = new Map([[textHash('Doc', base), docOf('Doc', base)]]);
    const p = makePlan({ connector: C, hub: [h], remote: [remote('a', 'Doc', 'l1\nl2\nl3\nL4')], complete: true, base: (x) => bases.get(x), writeBack: true, now: NOW, newId });
    expect(p.items[0].action).toBe('merge');
    expect(p.items[0].hub?.body).toBe('L1\nl2\nl3\nL4');
    expect(p.items[0].app?.body).toBe('L1\nl2\nl3\nL4');
  });
  it('makes a conflict (never a silent overwrite) when both changed the same line', () => {
    const base = 'l1\nl2';
    const h = { ...linked('Doc', base, 'a'), body: 'l1\nmine' };
    const bases = new Map([[textHash('Doc', base), docOf('Doc', base)]]);
    const p = makePlan({ connector: C, hub: [h], remote: [remote('a', 'Doc', 'l1\ntheirs')], complete: true, base: (x) => bases.get(x), writeBack: true, now: NOW, newId });
    expect(p.items[0]).toMatchObject({ action: 'conflict', theirs: { body: 'l1\ntheirs' } });
    expect(p.items[0].app).toBeUndefined();
    expect(p.counts.conflicts).toBe(1);
  });
  it('makes a conflict when the base is unknown', () => {
    const h = { ...linked('Doc', 'a', 'x'), body: 'b' };
    const p = plan({ hub: [h], remote: [remote('x', 'Doc', 'c')] });
    expect(p.items[0].action).toBe('conflict');
  });
  it('leaves notes with an open conflict alone', () => {
    const h = { ...linked('Doc', 'a', 'x'), body: 'b' };
    const p = plan({ hub: [h], remote: [remote('x', 'Doc', 'c')], openConflicts: new Set([h.keeperId]) });
    expect(p.items[0]).toMatchObject({ action: 'conflict', why: 'waiting for you to choose' });
    expect(p.items[0].theirs).toBeUndefined();
  });
  it('moves notes deleted in the app to the notes trash', () => {
    const p = plan({ hub: [linked('Gone', 'x', 'a')], remote: [] });
    expect(p.items[0]).toMatchObject({ action: 'trash' });
    expect(p.summary).toContain('move 1 to the notes trash');
  });
  it('keeps notes deleted in the app but changed in Keeper', () => {
    const h = { ...linked('Gone', 'x', 'a'), body: 'changed' };
    const p = plan({ hub: [h], remote: [] });
    expect(p.items[0].action).toBe('unlink');
    expect(p.items[0].hub?.sources).toEqual([]);
  });
  it('only unlinks when the note still lives in another app', () => {
    const h = linked('Both', 'x', 'a');
    h.sources.push({ connector: 'apple-1', app: 'applenotes', id: 'z' });
    const p = plan({ hub: [h], remote: [] });
    expect(p.items[0]).toMatchObject({ action: 'unlink', why: expect.stringContaining('still in applenotes') });
  });
  it('does not treat missing notes as deleted when the listing is not complete (imports)', () => {
    const p = plan({ hub: [linked('Gone', 'x', 'a')], remote: [], complete: false });
    expect(p.items).toEqual([]);
  });
  it('asks before deleting in the app a note deleted in Keeper', () => {
    const gone = linked('Old', 'x', 'a');
    const p = plan({ hub: [], deletedInHub: [gone], remote: [remote('a', 'Old', 'x')] });
    expect(p.items[0]).toMatchObject({ action: 'delete-app', needsConfirm: true, keeperId: gone.keeperId });
    expect(p.summary).toContain('delete 1 in the app (asks first)');
  });
  it('brings back a note deleted in Keeper if the app changed it since', () => {
    const gone = linked('Old', 'x', 'a');
    const p = plan({ hub: [], deletedInHub: [gone], remote: [remote('a', 'Old', 'changed')] });
    expect(p.items[0]).toMatchObject({ action: 'add', why: expect.stringContaining('after it was deleted') });
  });
  it('lists locked notes without copying their text', () => {
    const p = plan({ remote: [remote('a', 'Bank', 'SECRET', { locked: true })] });
    expect(p.items[0].action).toBe('locked');
    expect(p.items[0].hub?.body).not.toContain('SECRET');
    expect(p.items[0].hub?.locked).toBe(true);
    expect(p.summary).toContain('1 locked');
  });
  it('skips notes in the app’s trash', () => {
    expect(plan({ remote: [remote('a', 'X', 'y', { trashed: true })] }).items).toEqual([]);
  });
  it('merges tags from both sides', () => {
    const h = { ...linked('T', 'x', 'a'), tags: ['mine'] };
    const p = plan({ hub: [h], remote: [remote('a', 'T', 'x', { tags: ['theirs'] })] });
    expect(p.items[0].hub?.tags).toEqual(['mine', 'theirs']);
    expect(p.items[0].app?.tags).toEqual(['mine', 'theirs']);
  });
  it('sends a tag change made in Keeper back', () => {
    const h = { ...linked('T', 'x', 'a'), tags: ['new'] };
    const p = plan({ hub: [h], remote: [remote('a', 'T', 'x')] });
    expect(p.items[0]).toMatchObject({ action: 'update-app', app: { tags: ['new'] } });
  });
  it('copies new hub notes to the app only when asked', () => {
    const hubOnly: HubNote = { keeperId: 'k-x', title: 'Mine', body: 'b', tags: [], created: 1, modified: 1, sources: [] };
    expect(plan({ hub: [hubOnly] }).items).toEqual([]);
    const p = plan({ hub: [hubOnly], pushNew: true });
    expect(p.items[0]).toMatchObject({ action: 'add-app', app: { title: 'Mine' } });
    expect(addAppItem(hubOnly, { name: 'Joplin' }).why).toBe('copy to Joplin');
  });
  it('flags a new note that duplicates one from another app', () => {
    const other: HubNote = { keeperId: 'k-apple', title: 'Gift ideas', body: 'Mum: pottery class\nSam: hiking map', tags: [], created: 1, modified: 1, sources: [{ connector: 'apple-1', app: 'applenotes', id: 'q' }] };
    const p = plan({ hub: [other], remote: [remote('a', 'Gift ideas', 'Mum: pottery class\nSam: hiking map!')] });
    expect(p.items[0]).toMatchObject({ action: 'add', duplicateOf: 'k-apple' });
  });
  it('writes a summary with every kind', () => {
    expect(summarize({ add: 412, update: 3, updateApp: 1, addApp: 0, merge: 0, conflicts: 0, trash: 0, deleteApp: 0, held: 0, locked: 0, unchanged: 0 })).toBe('Would add 412, update 3, send 1 back, conflicts 0');
  });
});

describe('duplicates', () => {
  const n = (id: string, app: 'applenotes' | 'joplin' | null, title: string, body: string): HubNote => ({ keeperId: id, title, body, tags: [], created: 1, modified: 1, sources: app ? [{ connector: app, app, id }] : [] });
  it('finds the same note in two apps', () => {
    const g = findDuplicates([n('a', 'applenotes', 'Gift ideas', '- Mum: a pottery class\n- Sam: the hiking map'), n('b', 'joplin', 'Gift ideas', 'Mum: a pottery class. Sam: the hiking map'), n('c', 'joplin', 'Gifts', 'something else')]);
    expect(g).toHaveLength(1);
    expect(g[0].notes).toEqual(['a', 'b']);
  });
  it('ignores near copies inside one app and dismissed groups', () => {
    const a = n('a', 'joplin', 'Same', 'text here');
    const b = n('b', 'joplin', 'Same', 'text here');
    expect(findDuplicates([a, b])).toEqual([]);
    const c = n('c', 'applenotes', 'Same', 'text here');
    const g = findDuplicates([a, c]);
    expect(g).toHaveLength(1);
    expect(findDuplicates([a, c], new Set([g[0].id]))).toEqual([]);
  });
  it('scores similarity', () => {
    expect(similarity({ title: 'A', body: 'one two three four five' }, { title: 'a', body: 'One, two, three; four five.' })).toBe(1);
    expect(similarity({ title: 'A', body: 'completely different words here' }, { title: 'B', body: 'nothing in common at all really' })).toBeLessThan(0.3);
  });
  it('links duplicates: one note, both apps', () => {
    const a = n('a', 'applenotes', 'X', 'body');
    const b = { ...n('b', 'joplin', 'X', 'body more'), tags: ['t'] };
    const r = linkDuplicates(a, [b], true);
    expect(r.keep.sources.map((s) => s.app)).toEqual(['applenotes', 'joplin']);
    expect(r.keep.body).toContain('body more');
    expect(r.keep.tags).toEqual(['t']);
    expect(r.remove).toEqual(['b']);
  });
});
