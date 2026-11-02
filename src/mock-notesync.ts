// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Demo data for Notes Everywhere in the browser demo: a few connected apps,
// notes from each, one conflict and one pair of duplicates.

import type { ConflictView, ConnectorView, DuplicateView, HistoryEntry, NoteDetail, NoteHit, NoteSyncApi, NotesOverview, SnapshotView, SyncPlanView, TrashedNoteView } from '../core/api-notesync';
import { sideBySide } from '../core/notes-sync/diff3';
import { connectorDef } from '../core/notes-sync/connectors/registry';
import type { ConnectorKind } from '../core/notes-sync/types';

const now = Date.now();
const H = 3600_000;
const D = 24 * H;
const delay = <T,>(v: T, ms = 250) => new Promise<T>((r) => setTimeout(() => r(v), ms));

interface DemoNote { keeperId: string; title: string; body: string; tags: string[]; modified: number; created: number; where: { connector: string; app: ConnectorKind; folder?: string; inStep?: boolean }[]; locked?: boolean; path: string }

export function mockNotesync(emit: (channel: string, ...args: unknown[]) => void): { notesync: NoteSyncApi } {
  let connectors: ConnectorView[] = [
    { id: 'applenotes-1', kind: 'applenotes', label: 'Apple Notes', app: 'Apple Notes', capability: 'two-way', enabled: true, writeBack: true, pushNew: false, fields: { account: 'iCloud' }, secretsSet: [], available: true, state: 'idle', message: '3 updated, 1 conflict', notes: 214, locked: 3, lastSync: now - 12 * 60_000, reviewed: true, everyMin: 30 },
    { id: 'joplin-1', kind: 'joplin', label: 'Joplin', app: 'Joplin', capability: 'two-way', enabled: true, writeBack: false, pushNew: false, fields: { url: 'http://127.0.0.1:41184' }, secretsSet: ['token'], available: true, state: 'idle', message: 'Everything was already in step', notes: 132, locked: 0, lastSync: now - 40 * 60_000, reviewed: true, everyMin: 30 },
    { id: 'standardnotes-1', kind: 'standardnotes', label: 'Standard Notes backup', app: 'Standard Notes', capability: 'import-only', enabled: true, writeBack: false, pushNew: false, fields: { path: '/Users/demo/Downloads/Standard Notes Backup.txt' }, secretsSet: ['password'], available: true, state: 'idle', message: '58 added', notes: 58, locked: 0, lastSync: now - 2 * D, reviewed: true, everyMin: 0 },
    { id: 'folder-1', kind: 'folder', label: 'Second Brain', app: 'Markdown or text folder', capability: 'two-way', enabled: true, writeBack: true, pushNew: false, fields: { path: '/Users/demo/Documents/Second Brain' }, secretsSet: [], available: true, state: 'needs-review', message: 'Look at the dry run before the first sync', notes: 0, locked: 0, reviewed: false, everyMin: 30 },
  ];
  let notes: DemoNote[] = [
    { keeperId: 'k-1', title: 'Weekend in Lisbon', body: '## Plan\n- [x] Book the flat in Alfama\n- [ ] Tram 28 early, before the crowds\n- [ ] Pastéis de Belém\n\nTrain from the airport: red line, change at Alameda.', tags: ['travel'], modified: now - 3 * H, created: now - 9 * D, where: [{ connector: 'applenotes-1', app: 'applenotes', folder: 'iCloud/Travel', inStep: true }, { connector: 'joplin-1', app: 'joplin', folder: 'Trips', inStep: false }], path: 'Apple Notes/iCloud/Travel/Weekend in Lisbon.md' },
    { keeperId: 'k-2', title: 'Sourdough starter', body: 'Feed 1:1:1 at 9pm. Rye helps when it gets sluggish.\n\nBake when it doubles in 4–6 hours.', tags: ['cooking'], modified: now - 26 * H, created: now - 60 * D, where: [{ connector: 'joplin-1', app: 'joplin', folder: 'Kitchen', inStep: true }], path: 'Joplin/Kitchen/Sourdough starter.md' },
    { keeperId: 'k-3', title: 'Book ideas', body: '- A lighthouse keeper who collects lost letters\n- Owls as messengers between two towns', tags: ['writing', 'ideas'], modified: now - 2 * D, created: now - 120 * D, where: [{ connector: 'standardnotes-1', app: 'standardnotes', inStep: true }], path: 'Standard Notes/Book ideas.md' },
    { keeperId: 'k-4', title: 'Wi-Fi at the cabin', body: 'Network: Pine-Ridge\nThe router is behind the bookshelf.', tags: ['home'], modified: now - 5 * D, created: now - 200 * D, where: [{ connector: 'applenotes-1', app: 'applenotes', folder: 'iCloud/Notes', inStep: true }], path: 'Apple Notes/iCloud/Notes/Wi-Fi at the cabin.md' },
    { keeperId: 'k-5', title: 'Bank details', body: 'This note is locked in Apple Notes. Keeper does not copy locked notes; open it in Apple Notes to read it.', tags: [], modified: now - 30 * D, created: now - 300 * D, where: [{ connector: 'applenotes-1', app: 'applenotes', folder: 'iCloud/Private', inStep: true }], locked: true, path: 'Apple Notes/iCloud/Private/Bank details.md' },
    { keeperId: 'k-6', title: 'Meeting notes — roadmap', body: '## Q1\n- Ship the sync dry run\n- Conflict review screen\n\n## Later\n- Phone quick capture', tags: ['work'], modified: now - 50 * 60_000, created: now - 4 * D, where: [{ connector: 'joplin-1', app: 'joplin', folder: 'Work', inStep: true }], path: 'Joplin/Work/Meeting notes — roadmap.md' },
    { keeperId: 'k-7', title: 'Gift ideas', body: '- Mum: a pottery class\n- Sam: the hiking map of the Dolomites\n- Alex: noise-cancelling earbuds', tags: ['family'], modified: now - 6 * D, created: now - 40 * D, where: [{ connector: 'applenotes-1', app: 'applenotes', folder: 'iCloud/Notes', inStep: true }], path: 'Apple Notes/iCloud/Notes/Gift ideas.md' },
    { keeperId: 'k-8', title: 'Gift ideas', body: '- Mum: a pottery class\n- Sam: the hiking map of the Dolomites\n- Alex: noise cancelling earbuds', tags: ['family'], modified: now - 8 * D, created: now - 41 * D, where: [{ connector: 'standardnotes-1', app: 'standardnotes', inStep: true }], path: 'Standard Notes/Gift ideas.md' },
    { keeperId: 'k-9', title: 'Weekend in Lisbon (from Joplin, conflict)', body: '## Plan\n- [x] Book the flat in Alfama\n- [ ] Tram 28 at sunset\n- [ ] Pastéis de Belém\n\nTrain from the airport: red line, change at Alameda.', tags: ['travel'], modified: now - 12 * 60_000, created: now - 12 * 60_000, where: [], path: 'Joplin/Conflicts/Weekend in Lisbon (from Joplin, conflict).md' },
    { keeperId: 'k-10', title: 'Reading list', body: '- The Overstory\n- Piranesi\n- A Psalm for the Wild-Built', tags: ['books'], modified: now - 10 * D, created: now - 90 * D, where: [{ connector: 'standardnotes-1', app: 'standardnotes', inStep: true }], path: 'Standard Notes/Reading list.md' },
    { keeperId: 'k-11', title: 'Plant watering', body: 'Monstera: every 10 days. Fern: keep damp. Cactus: once a month.', tags: ['home'], modified: now - 15 * D, created: now - 160 * D, where: [{ connector: 'joplin-1', app: 'joplin', folder: 'Home', inStep: true }], path: 'Joplin/Home/Plant watering.md' },
    { keeperId: 'k-12', title: 'Run log', body: 'Mon 5 km 27:40\nWed 8 km 46:10\nSat 12 km 1:12:30', tags: ['health'], modified: now - 1 * D, created: now - 30 * D, where: [{ connector: 'applenotes-1', app: 'applenotes', folder: 'iCloud/Notes', inStep: true }], path: 'Apple Notes/iCloud/Notes/Run log.md' },
  ];
  const mine = '# Weekend in Lisbon\n## Plan\n- [x] Book the flat in Alfama\n- [ ] Tram 28 early, before the crowds\n- [ ] Pastéis de Belém\n\nTrain from the airport: red line, change at Alameda.';
  const theirs = '# Weekend in Lisbon\n## Plan\n- [x] Book the flat in Alfama\n- [ ] Tram 28 at sunset\n- [ ] Pastéis de Belém\n\nTrain from the airport: red line, change at Alameda.';
  let conflicts: ConflictView[] = [{ id: 'c-1', keeperId: 'k-1', copyId: 'k-9', connector: 'joplin-1', app: 'joplin', appName: 'Joplin', title: 'Weekend in Lisbon', at: now - 12 * 60_000, base: mine.replace('early, before the crowds', ''), mine, theirs, rows: sideBySide(mine, theirs) }];
  let dismissed = new Set<string>();
  let trash: TrashedNoteView[] = [{ id: 't-1', keeperId: 'k-20', title: 'Old shopping list', at: now - 3 * D, why: 'deleted in Apple Notes: moved to Keeper’s notes trash', apps: ['applenotes'] }];
  const snaps: SnapshotView[] = [
    { id: 'snap-3', time: now - 12 * 60_000, files: 404, label: 'Before syncing Apple Notes', added: 1, changed: 3, removed: 0 },
    { id: 'snap-2', time: now - D, files: 400, label: 'Before syncing Joplin', added: 6, changed: 2, removed: 1 },
    { id: 'snap-1', time: now - 2 * D, files: 395, label: 'Before syncing Standard Notes backup', added: 58, changed: 0, removed: 0 },
  ];
  const history: HistoryEntry[] = [
    { at: now - 12 * 60_000, keeperId: 'k-1', title: 'Weekend in Lisbon', app: 'joplin', connector: 'joplin-1', action: 'conflict', summary: 'changed in the same place in Keeper and in Joplin' },
    { at: now - 3 * H, keeperId: 'k-1', title: 'Weekend in Lisbon', app: 'applenotes', connector: 'applenotes-1', action: 'updated', summary: 'changed in Apple Notes · +1 −1 lines' },
    { at: now - 9 * D, keeperId: 'k-1', title: 'Weekend in Lisbon', app: 'applenotes', connector: 'applenotes-1', action: 'added', summary: 'new in Apple Notes' },
  ];
  let devices: NotesOverview['devices'] = { on: false, peers: 0 };

  const changed = () => emit('notesync-changed');
  const appsOf = (n: DemoNote) => [...new Set(n.where.map((w) => w.app))];
  const dupGroups = (): DuplicateView[] => (dismissed.has('dup-k-7-k-8') || !notes.find((n) => n.keeperId === 'k-8') ? [] : [{
    id: 'dup-k-7-k-8', score: 0.93,
    notes: ['k-7', 'k-8'].map((id) => notes.find((n) => n.keeperId === id)!).map((n) => ({ keeperId: n.keeperId, title: n.title, apps: appsOf(n), snippet: n.body.replace(/\n/g, ' ').slice(0, 120), modified: n.modified })),
  }]);
  const overview = (): NotesOverview => ({
    hubFolder: '/Users/demo/Documents/Keeper Notes', notes: 404, apps: 4, conflicts: conflicts.length, duplicates: dupGroups().length, trash: trash.length,
    lastSnapshot: snaps[0]?.time, snapshots: snaps.length, connectors, devices, autoSync: true, platform: 'darwin',
  });
  const hit = (n: DemoNote): NoteHit => ({ keeperId: n.keeperId, title: n.title, snippet: n.locked ? 'Locked in its app' : n.body.replace(/\n/g, ' ').slice(0, 140), tags: n.tags, apps: appsOf(n), modified: n.modified, locked: n.locked, path: n.path });
  const detail = (n: DemoNote): NoteDetail => ({
    keeperId: n.keeperId, title: n.title, body: n.body, tags: n.tags, created: n.created, modified: n.modified, locked: n.locked, path: `/Users/demo/Documents/Keeper Notes/${n.path}`,
    where: n.where.map((w) => ({ connector: w.connector, app: w.app, appName: connectorDef(w.app).name, label: connectors.find((c) => c.id === w.connector)?.label ?? w.app, id: `${w.app}-${n.keeperId}`, folder: w.folder, synced: now - 12 * 60_000, inStep: w.inStep !== false })),
    history: history.filter((h) => h.keeperId === n.keeperId), attachments: [],
  });
  const planFor = (id: string): SyncPlanView => {
    if (id === 'folder-1') return { connector: id, made: Date.now(), summary: 'Would add 412, update 0, conflicts 0', counts: { add: 412, update: 0, updateApp: 0, addApp: 0, merge: 0, conflicts: 0, trash: 0, deleteApp: 0, held: 0, locked: 0, unchanged: 0 }, items: ['Garden plan', 'Recipes/Shakshuka', 'Daily/2026-10-30', 'Projects/Owl lamp', 'Gift ideas'].map((t, i) => ({ action: 'add', title: t.split('/').pop()!, sourceId: `${t}.md`, why: 'new in Second Brain', duplicateOf: i === 4 ? 'k-7' : undefined })) };
    return { connector: id, made: Date.now(), summary: 'Would add 0, update 2, conflicts 0', counts: { add: 0, update: 2, updateApp: 0, addApp: 0, merge: 0, conflicts: 0, trash: 0, deleteApp: 0, held: 1, locked: 3, unchanged: 210 }, items: [{ action: 'update', title: 'Run log', why: 'changed in Apple Notes' }, { action: 'update', title: 'Gift ideas', why: 'tags changed in Apple Notes' }, { action: 'held', title: 'Plant watering', why: 'changed in Keeper; write-back is off' }, { action: 'locked', title: 'Bank details', why: 'locked in Apple Notes: listed, not copied' }] };
  };

  const api: NoteSyncApi = {
    overview: () => delay(overview()),
    async setOptions(p) { void p; return overview(); },
    async addConnector(input) {
      const def = connectorDef(input.kind);
      connectors = [...connectors, { id: `${input.kind}-${connectors.length + 1}`, kind: input.kind, label: input.label || def.name, app: def.name, capability: def.capability, enabled: true, writeBack: false, pushNew: false, fields: input.fields ?? {}, secretsSet: Object.keys(input.secrets ?? {}), available: !def.platforms || def.platforms.includes('darwin'), state: 'needs-review', message: 'Look at the dry run before the first sync', notes: 0, locked: 0, reviewed: false, everyMin: def.capability === 'import-only' ? 0 : 30 }];
      changed();
      return overview();
    },
    async updateConnector(id, patch) {
      connectors = connectors.map((c) => (c.id === id ? { ...c, ...patch, fields: { ...c.fields, ...(patch.fields ?? {}) }, secretsSet: [...new Set([...c.secretsSet, ...Object.keys(patch.secrets ?? {})])] } : c));
      changed();
      return overview();
    },
    async removeConnector(id) { connectors = connectors.filter((c) => c.id !== id); changed(); return overview(); },
    test: (id) => delay({ ok: true, message: id === 'joplin-1' ? 'Connected: 132 notes' : 'Connected: 214 notes (3 locked)' }, 500),
    async plan(id) {
      connectors = connectors.map((c) => (c.id === id ? { ...c, reviewed: true, state: 'idle', message: planFor(id).summary } : c));
      changed();
      return delay(planFor(id), 600);
    },
    async sync(id) {
      const p = planFor(id);
      connectors = connectors.map((c) => (c.id === id ? { ...c, lastSync: Date.now(), state: 'idle', message: p.counts.add ? `${p.counts.add} added` : '2 updated', notes: c.notes + p.counts.add } : c));
      changed();
      return delay({ connector: id, summary: p.counts.add ? `${p.counts.add} added` : '2 updated', done: { add: p.counts.add, update: p.counts.update }, errors: [] }, 700);
    },
    async search(q, opts = {}) {
      const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
      return delay(notes.filter((n) => (!opts.tag || n.tags.includes(opts.tag)) && (!opts.app || n.where.some((w) => w.app === opts.app)) && terms.every((t) => `${n.title} ${n.locked ? '' : n.body} ${n.tags.join(' ')}`.toLowerCase().includes(t))).sort((a, b) => b.modified - a.modified).map(hit), 120);
    },
    async tags() {
      const m = new Map<string, { count: number; apps: Set<ConnectorKind> }>();
      for (const n of notes) for (const t of n.tags) { const e = m.get(t) ?? { count: 0, apps: new Set() }; e.count++; appsOf(n).forEach((a) => e.apps.add(a)); m.set(t, e); }
      return [...m].map(([tag, e]) => ({ tag, count: e.count, apps: [...e.apps] })).sort((a, b) => b.count - a.count);
    },
    async note(id) { const n = notes.find((x) => x.keeperId === id); return n ? detail(n) : null; },
    async saveNote(id, input) {
      let n = id ? notes.find((x) => x.keeperId === id) : undefined;
      if (n) Object.assign(n, { title: input.title || n.title, body: input.body, tags: input.tags ?? n.tags, modified: Date.now() });
      else { n = { keeperId: `k-${Date.now()}`, title: input.title || 'Untitled', body: input.body, tags: input.tags ?? [], created: Date.now(), modified: Date.now(), where: [], path: `Inbox/${input.title || 'Untitled'}.md` }; notes = [n, ...notes]; }
      changed();
      return detail(n);
    },
    async copyTo(ids, target) {
      const c = connectors.find((x) => x.id === target);
      if (!c || c.capability === 'import-only') return { done: 0, skipped: ids.length, message: `${c?.app ?? 'That app'} cannot take notes from other apps (import only). Export instead.` };
      for (const n of notes) if (ids.includes(n.keeperId) && !n.where.some((w) => w.connector === target)) n.where.push({ connector: target, app: c.kind, inStep: true });
      changed();
      return delay({ done: ids.length, skipped: 0, message: `${ids.length} copied to ${c.label}` }, 500);
    },
    async migrate(from, to) {
      const ids = notes.filter((n) => n.where.some((w) => w.connector === from)).map((n) => n.keeperId);
      return api.copyTo(ids, to);
    },
    conflicts: () => delay(conflicts),
    async resolveConflict(id, keep) {
      const c = conflicts.find((x) => x.id === id);
      conflicts = conflicts.filter((x) => x.id !== id);
      if (c && keep !== 'both') notes = notes.filter((n) => n.keeperId !== c.copyId);
      if (c) history.unshift({ at: Date.now(), keeperId: c.keeperId, title: c.title, app: c.app, action: 'updated', summary: `conflict settled: kept ${keep}` });
      changed();
    },
    duplicates: () => delay(dupGroups()),
    async resolveDuplicate(id, action) {
      if (action === 'ignore') dismissed = new Set([...dismissed, id]);
      else { const b = notes.find((n) => n.keeperId === 'k-8'); const a = notes.find((n) => n.keeperId === 'k-7'); if (a && b) { a.where.push(...b.where); notes = notes.filter((n) => n !== b); } }
      changed();
    },
    trash: () => delay(trash),
    async restore(id) { trash = trash.filter((t) => t.id !== id); changed(); },
    snapshots: () => delay(snaps),
    async snapshotNow(label) {
      const s: SnapshotView = { id: `snap-${Date.now()}`, time: Date.now(), files: 404, label: label ?? 'By hand', added: 0, changed: 1, removed: 0 };
      snaps.unshift(s);
      changed();
      return s;
    },
    restoreSnapshot: () => delay({ restored: 3 }, 500),
    exportAs: (format, opts) => delay({ path: `/Users/demo/Downloads/Keeper notes ${new Date().toISOString().slice(0, 10)}.${{ 'markdown-zip': 'zip', enex: 'enex', jex: 'jex', 'sn-json': 'json' }[format]}`, notes: opts?.keeperIds?.length ?? 404 }, 600),
    history: (id) => delay(history.filter((h) => !id || h.keeperId === id)),
    async shareWithDevices(on) { devices = on ? { on: true, folderId: 'f-notes', peers: 2 } : { on: false, peers: 0 }; changed(); return overview(); },
    shortcutGuide: async () => (await import('../core/notes-sync/connectors/applenotes')).shortcutSteps('Notes Everywhere → Connect → Markdown or text folder'),
    // ?notes=none (Apple Notes not connected) or ?notes=denied (Automation refused) in the preview shows the Island's row.
    async islandNotes(q = '') {
      const mode = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('notes') : null;
      const list = mode === 'none' ? connectors.filter((c) => c.kind !== 'applenotes') : mode === 'denied' ? connectors.map((c) => (c.kind === 'applenotes' ? { ...c, reviewed: false, state: 'error' as const, message: 'Allow Keeper to control Notes: System Settings → Privacy & Security → Automation.', notes: 0 } : c)) : connectors;
      const hits = (await api.search(q)).filter((h) => mode === null || !h.apps.includes('applenotes'));
      return { hubOn: true, platform: 'darwin', sources: list.map((c) => ({ id: c.id, kind: c.kind, app: c.app, enabled: c.enabled, available: c.available, reviewed: c.reviewed, state: c.state, message: c.message, notes: c.notes, lastSync: c.lastSync })), hits };
    },
  };
  return { notesync: api };
}
