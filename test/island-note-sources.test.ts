// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { groupNotes, hitMatches, MAC_AUTOMATION_PRIVACY, notesSetupRow, type HubNoteItem, type IslandNoteSource } from '../core/island-tools/note-sources';
import type { QuickNote } from '../core/island-tools/notes';

const q = (id: string, text: string, updated = 1): QuickNote => ({ id, text, created: 1, updated });
const hit = (keeperId: string, title: string, apps: HubNoteItem['apps'], o: Partial<HubNoteItem> = {}): HubNoteItem => ({ keeperId, title, snippet: '', tags: [], apps, modified: 1, ...o });
const src = (kind: IslandNoteSource['kind'], o: Partial<IslandNoteSource> = {}): IslandNoteSource => ({ id: `${kind}-1`, kind, app: kind, enabled: true, available: true, reviewed: true, state: 'idle', notes: 0, ...o });

describe('groupNotes', () => {
  const local = [q('a', 'Groceries\nmilk'), q('b', 'Ideas for the trip', 5)];
  const hits = [
    hit('k1', 'Weekend in Lisbon', ['joplin', 'applenotes'], { modified: 3 }),
    hit('k2', 'Sourdough', ['joplin'], { snippet: 'feed the starter' }),
    hit('k3', 'Run log', ['applenotes'], { modified: 9 }),
    hit('k4', 'Island jot', ['island']),
    hit('k5', 'Loose note', []),
    hit('k6', 'Bear note', ['bear']),
  ];
  it('puts Keeper first, Apple Notes next on a Mac, then other apps by name, then hub-only notes', () => {
    const g = groupNotes({ local, hits, platform: 'darwin' });
    expect(g.map((x) => x.id)).toEqual(['keeper', 'applenotes', 'bear', 'joplin', 'hub']);
    expect(g[0].local!.map((n) => n.id)).toEqual(['b', 'a']);
    // In two apps: listed under Apple Notes on a Mac; newest first.
    expect(g[1].hub!.map((h) => h.keeperId)).toEqual(['k3', 'k1']);
    // Keeper's own quick notes copied into the hub are not listed twice.
    expect(g.flatMap((x) => x.hub ?? []).some((h) => h.keeperId === 'k4')).toBe(false);
  });
  it('lists a two-app note under its first app off a Mac', () => {
    const g = groupNotes({ local: [], hits, platform: 'win32' });
    expect(g.find((x) => x.id === 'joplin')!.hub!.map((h) => h.keeperId)).toEqual(['k1', 'k2']);
  });
  it('searches both sides with the one box', () => {
    const g = groupNotes({ local, hits, platform: 'darwin', q: 'trip' });
    expect(g.map((x) => x.id)).toEqual(['keeper']);
    expect(g[0].local!.map((n) => n.id)).toEqual(['b']);
    const s = groupNotes({ local, hits, platform: 'darwin', q: 'starter' });
    expect(s.find((x) => x.id === 'joplin')!.hub!.map((h) => h.keeperId)).toEqual(['k2']);
    // Hits the hub already searched (in the whole text) are not filtered again.
    const deep = groupNotes({ local, hits: [hit('k9', 'Untitled', ['applenotes'])], platform: 'darwin', q: 'alfama', hitsQuery: 'alfama' });
    expect(deep.find((x) => x.id === 'applenotes')!.hub).toHaveLength(1);
  });
  it('keeps a connected app’s group even before it has notes, but not during a search', () => {
    const g = groupNotes({ local: [], hits: [], sources: [src('applenotes', { reviewed: false })], platform: 'darwin' });
    expect(g.map((x) => x.id)).toEqual(['keeper', 'applenotes']);
    expect(g[1].source?.id).toBe('applenotes-1');
    expect(groupNotes({ local: [], hits: [], sources: [src('applenotes')], platform: 'darwin', q: 'x' }).map((x) => x.id)).toEqual(['keeper']);
  });
  it('matches every word in title, snippet or tags', () => {
    expect(hitMatches(hit('1', 'Gift ideas', [], { tags: ['family'] }), 'gift family')).toBe(true);
    expect(hitMatches(hit('1', 'Gift ideas', []), 'gift cabin')).toBe(false);
  });
});

describe('notesSetupRow', () => {
  it('offers to switch the hub on, with Apple Notes named on a Mac', () => {
    expect(notesSetupRow({ hubOn: false, platform: 'darwin', sources: [] })).toMatchObject({ title: 'Show your Apple Notes here', action: 'enableHub' });
    expect(notesSetupRow({ hubOn: false, platform: 'linux', sources: [] })).toMatchObject({ action: 'enableHub' });
  });
  it('asks to connect Apple Notes, explains Automation when refused, and asks for the first look', () => {
    expect(notesSetupRow({ hubOn: true, platform: 'darwin', sources: [] })).toMatchObject({ action: 'connect', label: 'Allow' });
    const refused = notesSetupRow({ hubOn: true, platform: 'darwin', sources: [src('applenotes', { reviewed: false, state: 'error', message: 'Allow Keeper to control Notes: System Settings → Privacy & Security → Automation.' })] });
    expect(refused).toMatchObject({ action: 'settings', settingsUrl: MAC_AUTOMATION_PRIVACY, retry: true });
    expect(notesSetupRow({ hubOn: true, platform: 'darwin', sources: [src('applenotes', { reviewed: false, state: 'needs-review' })] })).toMatchObject({ action: 'review' });
  });
  it('says nothing when all is well, off a Mac, or before the hub answered', () => {
    expect(notesSetupRow({ hubOn: true, platform: 'darwin', sources: [src('applenotes')] })).toBeNull();
    expect(notesSetupRow({ hubOn: true, platform: 'win32', sources: [] })).toBeNull();
    expect(notesSetupRow(null)).toBeNull();
  });
});
