// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Notes Everywhere in the main process: the hub folder, the connected apps,
// dry runs and syncs, conflicts, duplicates, the notes trash, snapshots and
// exports. Nothing runs in the background unless automatic syncing is
// switched on (feature "notesSync"); then every check goes through the governor.

import { app, shell } from 'electron';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import type { ConflictView, ConnectorView, DuplicateView, NoteDetail, NoteHit, NoteSyncApi, NotesOverview, SyncPlanView, SyncResultView } from '../../../core/api-notesync';
import { writeTar, writeZip } from '../../../core/notes-sync/archive';
import { changeSummary, sideBySide } from '../../../core/notes-sync/diff3';
import { addAppItem, canWrite, findDuplicates, finishPlan, linkDuplicates, makePlan } from '../../../core/notes-sync/engine';
import { ATTACH_DIR, docOf, newKeeperId, normTags, splitDoc, tagsHash, textHash } from '../../../core/notes-sync/hub';
import { plainText } from '../../../core/notes-sync/markdown';
import { shortcutSteps } from '../../../core/notes-sync/connectors/applenotes';
import { ATTACHMENT_REF, writeEnex } from '../../../core/notes-sync/connectors/evernote';
import { jexItems } from '../../../core/notes-sync/connectors/joplin';
import { availableOn, connectorDef, type ExportFormat } from '../../../core/notes-sync/connectors/registry';
import { snBackupFrom } from '../../../core/notes-sync/connectors/standardnotes';
import { ConnectorError, type ConnectorIO } from '../../../core/notes-sync/connectors/io';
import type { ConflictEntry, ConnectorKind, HistoryEntry, HubNote, PlanItem, RemoteNote, SyncPlan } from '../../../core/notes-sync/types';
import { getSecret, setSecret } from '../../store';
import { featureOn, onFeature } from '../features';
import { poll } from '../governor';
import { connectorIO, type ConnectorConfig } from './connectors';
import { HubStore } from './hubstore';

interface NotesConfig {
  hubFolder: string;
  connectors: ConnectorConfig[];
  dismissedDuplicates: string[];
  devicesFolderId?: string;
}

export interface NotesDeps {
  userData: string;
  broadcast(channel: string, ...args: unknown[]): void;
}

let deps: NotesDeps | null = null;
let cfg: NotesConfig | null = null;
let hub: HubStore | null = null;
const running = new Map<string, Promise<unknown>>();
const status = new Map<string, { state: ConnectorView['state']; message?: string }>();
const stopPolls = new Map<string, () => void>();

const DEFAULT_HUB = () => path.join(app.getPath('documents'), 'Keeper Notes');
const cfgFile = () => path.join(deps!.userData, 'notesync.json');

async function conf(): Promise<NotesConfig> {
  if (cfg) return cfg;
  try {
    const j = JSON.parse(await fsp.readFile(cfgFile(), 'utf8')) as Partial<NotesConfig>;
    cfg = { hubFolder: j.hubFolder || DEFAULT_HUB(), connectors: j.connectors ?? [], dismissedDuplicates: j.dismissedDuplicates ?? [], devicesFolderId: j.devicesFolderId };
  } catch {
    cfg = { hubFolder: process.env.KEEPER_NOTES_HUB || DEFAULT_HUB(), connectors: [], dismissedDuplicates: [] };
  }
  return cfg;
}

async function save(patch: Partial<NotesConfig> = {}) {
  cfg = { ...(await conf()), ...patch };
  await fsp.mkdir(path.dirname(cfgFile()), { recursive: true });
  const tmp = cfgFile() + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(cfg, null, 1));
  await fsp.rename(tmp, cfgFile());
}

async function store(): Promise<HubStore> {
  const c = await conf();
  if (!hub || hub.root !== c.hubFolder) hub = new HubStore(c.hubFolder);
  return hub;
}

const changed = () => deps?.broadcast('notesync-changed');
const conn = async (id: string) => {
  const c = (await conf()).connectors.find((x) => x.id === id);
  if (!c) throw new Error('That connection is gone');
  return c;
};
const appName = (k: ConnectorKind) => connectorDef(k).name;

async function ioFor(c: ConnectorConfig): Promise<ConnectorIO> {
  const h = await store();
  return connectorIO(c, {
    secret: (n) => getSecret(n),
    saveSecret: async (n, v) => { await setSecret(n, v ?? ''); },
    openUrl: (u) => shell.openExternal(u),
    trashFile: (p) => shell.trashItem(p),
    island: {
      get: async () => (await import('../island-tools')).getStore().then((s) => s.notes),
      save: async (notes) => { await (await import('../island-tools')).saveStore({ notes }); },
    },
    ctx: {
      // Pages whose version has not moved: use the text Keeper synced last time.
      unchanged: (sid, version) => {
        for (const n of h.notes.values()) {
          const l = n.sources.find((s) => s.connector === c.id && s.id === sid);
          if (!l) continue;
          if (l.version !== version || !l.hash) return undefined;
          const b = h.base(l.hash);
          return b === undefined ? undefined : splitDoc(b);
        }
        return undefined;
      },
    },
  });
}

// ---------------------------------------------------------------- attachments and planning

/** Stores attachments by hash and points the body at them. */
async function settleAttachments(notes: RemoteNote[]) {
  const h = await store();
  for (const n of notes) {
    if (!n.attachments?.length) continue;
    for (const a of n.attachments) {
      if (!a.data) continue;
      const { hash, rel } = await h.storeAttachment(a.data, a.name);
      a.hash = hash;
      if (a.sourceRef) n.body = n.body.split(`${ATTACHMENT_REF}${a.sourceRef}`).join(rel.replace(/ /g, '%20'));
      delete a.data;
    }
  }
}

interface Prepared { c: ConnectorConfig; io: ConnectorIO; plan: SyncPlan; remote: Map<string, RemoteNote> }

async function prepare(c: ConnectorConfig): Promise<Prepared> {
  const h = await store();
  const notes = await h.scan();
  await h.loadBases(notes.flatMap((n) => n.sources.filter((s) => s.connector === c.id).map((s) => s.hash ?? '')));
  const io = await ioFor(c);
  const listed = await io.list();
  await settleAttachments(listed.notes);
  const trash = await h.trashList();
  const deletedInHub: HubNote[] = [...h.vanished, ...trash.filter((t) => t.sources.some((s) => s.connector === c.id)).map((t) => ({ keeperId: t.keeperId, title: t.title, body: '', tags: [], created: 0, modified: 0, sources: t.sources }))];
  const conflicts = await h.conflicts();
  const plan = makePlan({
    connector: { id: c.id, kind: c.kind, name: appName(c.kind), capability: connectorDef(c.kind).capability },
    hub: notes, deletedInHub, remote: listed.notes, complete: listed.complete, base: h.base,
    writeBack: c.writeBack, pushNew: c.pushNew, openConflicts: new Set(conflicts.filter((x) => x.connector === c.id).map((x) => x.keeperId)),
    now: Date.now(), newId: newKeeperId,
  });
  return { c, io, plan, remote: new Map(listed.notes.map((n) => [n.sourceId, n])) };
}

function planView(p: SyncPlan, limit = 400): SyncPlanView {
  const visible = p.items.filter((i) => !(i.action === 'update' && (i.why === 'unchanged' || i.why === 'same change on both sides')));
  return { connector: p.connector, made: p.made, summary: p.summary, counts: p.counts, items: visible.slice(0, limit).map((i) => ({ action: i.action, keeperId: i.keeperId, sourceId: i.sourceId, title: i.title, why: i.why, duplicateOf: i.duplicateOf, needsConfirm: i.needsConfirm })) };
}

/** Carries out a plan. Writes to the app first, then the hub, so a failure leaves the hub as it was. */
async function apply(p: Prepared, confirmDeletes: Set<string>): Promise<SyncResultView> {
  const h = await store();
  const { c, io } = p;
  const def = connectorDef(c.kind);
  const name = def.name;
  const errors: string[] = [];
  const done: Record<string, number> = {};
  const count = (k: string) => (done[k] = (done[k] ?? 0) + 1);
  const history: HistoryEntry[] = [];
  const now = Date.now();
  const writable = canWrite(def, c.writeBack);
  const conflicts = await h.conflicts();
  const linkHash = async (title: string, body: string) => h.putBase(title, body);
  const hist = (n: { keeperId: string; title: string }, action: HistoryEntry['action'], summary?: string, extra: Partial<HistoryEntry> = {}) => history.push({ at: now, keeperId: n.keeperId, title: n.title, app: c.kind, connector: c.id, action, summary, ...extra });
  const place = (r?: RemoteNote) => ({ appFolder: def.hubFolder, folder: c.kind === 'folder' ? `${c.label}${r?.folder ? '/' + r.folder : ''}` : r?.folder });

  if (p.plan.items.some((i) => i.action !== 'update' || i.why !== 'unchanged')) await h.snapshot(`Before syncing ${c.label}`);

  for (const it of p.plan.items) {
    try {
      const r = it.sourceId ? p.remote.get(it.sourceId) : undefined;
      switch (it.action) {
        case 'add': case 'locked': {
          const n = it.hub!;
          if (r && !r.locked) await linkHash(r.title, r.body);
          await h.write(n, place(r));
          if (it.action === 'add') { count('add'); hist(n, 'added', it.why); } else count('locked');
          break;
        }
        case 'update': {
          const n = it.hub!;
          const old = h.get(n.keeperId);
          if (r) await linkHash(r.title, r.body);
          let out = n;
          if (it.app && writable && io.update) {
            const w = await io.update(it.app);
            const hash = await linkHash(it.app.title, it.app.body);
            out = { ...n, sources: n.sources.map((s) => (s.connector === c.id ? { ...s, version: w.version ?? s.version, id: w.sourceId ?? s.id, hash, tagsHash: tagsHash(it.app!.tags) } : s)) };
          }
          if (JSON.stringify(old) !== JSON.stringify({ ...out, rel: old?.rel })) await h.write(out);
          if (it.why !== 'unchanged' && it.why !== 'same change on both sides') { count('update'); hist(out, 'updated', `${it.why} · ${changeSummary(old?.body ?? '', out.body)}`, { before: old ? textHash(old.title, old.body) : undefined, after: textHash(out.title, out.body) }); }
          break;
        }
        case 'update-app': case 'merge': case 'add-app': {
          const n = it.hub!;
          let out = n;
          if (it.app && (writable || it.action === 'add-app')) {
            const w = it.action === 'add-app' ? await io.create!(it.app) : await io.update!(it.app);
            const hash = await linkHash(it.app.title, it.app.body);
            const link = { connector: c.id, app: c.kind, id: (w as { sourceId?: string }).sourceId ?? it.sourceId ?? '', folder: it.app.folder, version: w.version, hash, tagsHash: tagsHash(it.app.tags), synced: now };
            out = { ...n, sources: [...n.sources.filter((s) => s.connector !== c.id), link] };
          }
          const old = h.get(n.keeperId);
          await h.write(out);
          count(it.action === 'merge' ? 'merge' : it.action === 'add-app' ? 'addApp' : 'updateApp');
          hist(out, it.action === 'merge' ? 'merged' : it.action === 'add-app' ? 'copied' : 'written', it.action === 'merge' ? `${it.why} · ${changeSummary(old?.body ?? '', out.body)}` : `sent to ${name}`);
          break;
        }
        case 'conflict': {
          if (!it.theirs || !it.hub) break; // already waiting
          const copy: HubNote = { keeperId: newKeeperId(), title: `${it.theirs.title || it.title} (from ${name}, conflict)`, body: it.theirs.body, tags: it.hub.tags, created: now, modified: now, sources: [] };
          const written = await h.write(copy, { appFolder: def.hubFolder, folder: 'Conflicts' });
          const e: ConflictEntry = { id: `c-${now.toString(36)}-${conflicts.length}`, keeperId: it.hub.keeperId, copyId: written.keeperId, connector: c.id, app: c.kind, title: it.hub.title, base: it.base ?? '', mine: docOf(it.hub.title, it.hub.body), theirs: docOf(it.theirs.title, it.theirs.body), at: now };
          conflicts.push(e);
          count('conflicts');
          hist(it.hub, 'conflict', it.why);
          break;
        }
        case 'trash': {
          const n = h.get(it.keeperId!);
          if (n) { await h.moveToTrash({ ...n, sources: it.hub?.sources ?? [] }, it.why, n.sources.map((s) => s.app)); count('trash'); hist(n, 'trashed', it.why); }
          break;
        }
        case 'unlink': {
          await h.write(it.hub!);
          count('trash');
          hist(it.hub!, 'updated', it.why);
          break;
        }
        case 'delete-app': {
          if (!it.keeperId || !confirmDeletes.has(it.keeperId)) break;
          if (!io.remove) { errors.push(`${it.title}: ${name} cannot delete notes from Keeper`); break; }
          await io.remove(it.sourceId!);
          await h.updateTrash((l) => l.map((t) => (t.keeperId === it.keeperId ? { ...t, sources: t.sources.filter((s) => s.connector !== c.id) } : t)));
          await h.forgetVanished(it.keeperId, c.id);
          count('deleteApp');
          history.push({ at: now, keeperId: it.keeperId, title: it.title, app: c.kind, connector: c.id, action: 'deleted-in-app', summary: `deleted in ${name} after you said yes` });
          break;
        }
        case 'held': count('held'); break;
      }
    } catch (e) {
      errors.push(`${it.title}: ${(e as Error).message}`);
    }
  }
  await h.saveConflicts(conflicts);
  await h.log(history);
  const parts = Object.entries(done).filter(([, v]) => v).map(([k, v]) => `${v} ${({ add: 'added', update: 'updated', merge: 'merged', updateApp: 'sent back', addApp: 'copied', conflicts: v === 1 ? 'conflict' : 'conflicts', trash: 'moved to the notes trash', deleteApp: 'deleted in the app', held: 'held back', locked: 'locked' } as Record<string, string>)[k] ?? k}`);
  return { connector: c.id, summary: parts.length ? parts.join(', ') : 'Everything was already in step', done, errors };
}

async function runSync(id: string, opts: { confirmDeletes?: string[]; auto?: boolean } = {}): Promise<SyncResultView> {
  const c = await conn(id);
  if (!c.reviewed) throw new Error('Look at the dry run first: press “Dry run”, check what would change, then sync.');
  const prev = running.get(id);
  if (prev) await prev.catch(() => undefined);
  const job = (async () => {
    status.set(id, { state: 'syncing' });
    changed();
    try {
      const p = await prepare(c);
      const r = await apply(p, new Set(opts.confirmDeletes ?? []));
      c.lastSync = Date.now();
      c.message = r.errors.length ? `${r.summary}; ${r.errors.length} could not be done` : r.summary;
      await save();
      status.set(id, { state: r.errors.length ? 'error' : 'idle', message: c.message });
      return r;
    } catch (e) {
      const msg = (e as Error).message;
      status.set(id, { state: 'error', message: msg });
      c.message = msg;
      await save();
      throw e;
    } finally {
      changed();
    }
  })();
  running.set(id, job);
  try { return await job; } finally { running.delete(id); }
}

// ---------------------------------------------------------------- automatic syncing (governor only)

function schedule() {
  for (const stop of stopPolls.values()) stop();
  stopPolls.clear();
  if (!cfg || !featureOn('notesSync')) return;
  for (const c of cfg.connectors) {
    const def = connectorDef(c.kind);
    if (!c.enabled || !c.reviewed || c.everyMin <= 0 || def.capability === 'import-only' || !availableOn(def, process.platform)) continue;
    stopPolls.set(c.id, poll(`notesync.${c.id}`, { baseMs: c.everyMin * 60_000, idleFactor: 3, pauseWhenLocked: true }, () => runSync(c.id, { auto: true }).catch(() => undefined), { now: false, feature: 'notesSync' }));
  }
}

// ---------------------------------------------------------------- views

async function connectorView(c: ConnectorConfig, h: HubStore): Promise<ConnectorView> {
  const def = connectorDef(c.kind);
  const secrets: string[] = [];
  for (const f of def.fields) if (f.type === 'secret' && (await getSecret(`notesync.${c.id}.${f.key}`))) secrets.push(f.key);
  let notes = 0;
  let locked = 0;
  for (const n of h.notes.values()) if (n.sources.some((s) => s.connector === c.id)) { notes++; if (n.locked) locked++; }
  const available = availableOn(def, process.platform);
  const st = status.get(c.id);
  return {
    id: c.id, kind: c.kind, label: c.label, app: def.name, capability: def.capability, enabled: c.enabled, writeBack: c.writeBack, pushNew: c.pushNew,
    fields: c.fields, secretsSet: secrets, available, reviewed: c.reviewed, everyMin: c.everyMin, notes, locked, lastSync: c.lastSync,
    state: !available ? 'unavailable' : st?.state ?? (!c.reviewed ? 'needs-review' : c.message && /could not|not |error/i.test(c.message) && !c.lastSync ? 'error' : 'idle'),
    message: !available ? `Needs ${def.platforms?.map((p) => (p === 'darwin' ? 'a Mac' : p === 'win32' ? 'Windows' : p)).join(' or ')}` : st?.message ?? c.message,
  };
}

async function overview(): Promise<NotesOverview> {
  const c = await conf();
  const h = await store();
  await h.scan(3000);
  const conflicts = (await h.conflicts()).length;
  const snaps = await h.manifests();
  const notes = [...h.notes.values()];
  let devices: NotesOverview['devices'] = { on: false, peers: 0 };
  if (c.devicesFolderId) {
    try {
      const ov = await (await import('../sync')).syncApi.overview();
      const f = ov.folders.find((x) => x.id === c.devicesFolderId);
      devices = f ? { on: true, folderId: f.id, peers: f.devices.length, message: f.message } : { on: false, peers: 0, message: 'The notes folder is no longer synced' };
    } catch { devices = { on: true, folderId: c.devicesFolderId, peers: 0, message: 'Sync is off' }; }
  }
  return {
    hubFolder: c.hubFolder,
    notes: notes.length,
    apps: new Set(notes.flatMap((n) => n.sources.map((s) => s.app))).size,
    conflicts,
    duplicates: findDuplicates(notes, new Set(c.dismissedDuplicates)).length,
    trash: (await h.trashList()).length,
    lastSnapshot: snaps[snaps.length - 1]?.time,
    snapshots: snaps.length,
    connectors: await Promise.all(c.connectors.map((x) => connectorView(x, h))),
    devices,
    autoSync: featureOn('notesSync'),
    platform: process.platform,
  };
}

function snippet(body: string, terms: string[]): string {
  const plain = plainText(body);
  const lower = plain.toLowerCase();
  const at = terms.map((t) => lower.indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, at - 40);
  return (start ? '…' : '') + plain.slice(start, start + 160) + (plain.length > start + 160 ? '…' : '');
}

const hit = (n: HubNote, terms: string[]): NoteHit => ({ keeperId: n.keeperId, title: n.title, snippet: n.locked ? 'Locked in its app' : snippet(n.body, terms), tags: n.tags, apps: [...new Set(n.sources.map((s) => s.app))], modified: n.modified, locked: n.locked, path: n.rel ?? '' });

async function detail(keeperId: string): Promise<NoteDetail | null> {
  const h = await store();
  await h.scan(1000);
  const n = h.get(keeperId);
  if (!n) return null;
  const c = await conf();
  return {
    keeperId: n.keeperId, title: n.title, body: n.body, tags: n.tags, created: n.created, modified: n.modified, locked: n.locked,
    path: path.join(h.root, n.rel ?? ''),
    where: n.sources.map((s) => ({ connector: s.connector, app: s.app, appName: appName(s.app), label: c.connectors.find((x) => x.id === s.connector)?.label ?? appName(s.app), id: s.id, folder: s.folder, synced: s.synced, inStep: s.hash === textHash(n.title, n.body) })),
    history: await h.history(keeperId, 50),
    attachments: (n.attachments ?? []).map((a) => ({ name: a.name, path: path.join(h.root, ATTACH_DIR, a.hash.slice(0, 2)) })),
  };
}

async function hubNotesFor(ids?: string[]): Promise<HubNote[]> {
  const h = await store();
  await h.scan(1000);
  const all = [...h.notes.values()].filter((n) => !n.locked);
  return ids?.length ? all.filter((n) => ids.includes(n.keeperId)) : all;
}

async function copyTo(ids: string[], targetId: string, move = false): Promise<{ done: number; skipped: number; message: string }> {
  const target = await conn(targetId);
  const def = connectorDef(target.kind);
  const notes = (await hubNotesFor(ids)).filter((n) => !n.sources.some((s) => s.connector === targetId));
  if (target.kind === 'evernote') {
    const r = await exportAs('enex', { keeperIds: notes.map((n) => n.keeperId) });
    return { done: r.notes, skipped: ids.length - r.notes, message: `Saved ${path.basename(r.path)} in Downloads: in Evernote, choose File → Import Notes.` };
  }
  if (def.capability === 'import-only') return { done: 0, skipped: ids.length, message: `${def.name} cannot take notes from other apps (import only). Export instead.` };
  if (!availableOn(def, process.platform)) return { done: 0, skipped: ids.length, message: `${def.name} is not on this computer.` };
  const io = await ioFor(target);
  if (!io.create) return { done: 0, skipped: ids.length, message: `${def.name} cannot create notes.` };
  const items: PlanItem[] = notes.map((n) => addAppItem(n, { name: def.name }));
  const plan = finishPlan(targetId, Date.now(), items);
  const r = await apply({ c: target, io, plan, remote: new Map() }, new Set());
  let removed = 0;
  if (move && !r.errors.length) {
    const h = await store();
    for (const n of notes) {
      const fresh = h.get(n.keeperId);
      if (!fresh) continue;
      for (const s of fresh.sources.filter((x) => x.connector !== targetId)) {
        const from = (await conf()).connectors.find((x) => x.id === s.connector);
        if (!from) continue;
        const fio = await ioFor(from).catch(() => null);
        if (!fio?.remove) continue;
        await fio.remove(s.id).then(() => { removed++; }, () => undefined);
        await h.write({ ...fresh, sources: fresh.sources.filter((x) => x.connector !== s.connector) });
      }
    }
  }
  changed();
  const done = r.done.addApp ?? 0;
  return { done, skipped: ids.length - done, message: `${done} copied to ${target.label}${move ? `, ${removed} removed from where they were` : ''}${r.errors.length ? `; ${r.errors.length} could not be copied (${r.errors[0]})` : ''}` };
}

async function exportAs(format: ExportFormat, opts: { keeperIds?: string[]; target?: string } = {}): Promise<{ path: string; notes: number }> {
  const notes = await hubNotesFor(opts.keeperIds);
  const h = await store();
  const stamp = new Date().toISOString().slice(0, 10);
  const ext = { 'markdown-zip': 'zip', enex: 'enex', jex: 'jex', 'sn-json': 'json' }[format];
  const target = opts.target || path.join(app.getPath('downloads'), `Keeper notes ${stamp}.${ext}`);
  let data: Uint8Array | string;
  if (format === 'markdown-zip') {
    const entries = [];
    for (const n of notes) entries.push({ name: n.rel ?? `${n.title}.md`, data: await fsp.readFile(path.join(h.root, n.rel ?? '')).catch(() => Buffer.from(n.body)), mtime: n.modified });
    for (const n of notes) for (const a of n.attachments ?? []) { const d = await h.readAttachment(a.hash, a.name); if (d) entries.push({ name: path.posix.join(ATTACH_DIR, a.hash.slice(0, 2), path.basename(a.name).replace(/^.*?(\.[^.]+)?$/, `${a.hash}$1`)), data: d }); }
    data = writeZip(entries);
  } else if (format === 'enex') {
    const input = [];
    for (const n of notes) {
      const files = [];
      for (const a of n.attachments ?? []) { const d = await h.readAttachment(a.hash, a.name); if (d) files.push({ link: `${ATTACH_DIR}/${a.hash.slice(0, 2)}/${a.hash}${/\.[^.]+$/.exec(a.name)?.[0]?.toLowerCase() ?? ''}`, name: a.name, mime: a.mime, data: d }); }
      input.push({ title: n.title, body: n.body, tags: n.tags, created: n.created, modified: n.modified, files });
    }
    data = writeEnex(input);
  } else if (format === 'jex') {
    data = writeTar(jexItems(notes.map((n) => ({ ...n, folder: n.rel?.includes('/') ? n.rel.slice(0, n.rel.lastIndexOf('/')) : undefined }))).map((i) => ({ name: i.name, data: new TextEncoder().encode(i.text) })));
  } else {
    data = snBackupFrom(notes);
  }
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.writeFile(target, data);
  return { path: target, notes: notes.length };
}

// ---------------------------------------------------------------- the API

export const notesApi: NoteSyncApi = {
  overview,
  async setOptions(patch) {
    if (patch.hubFolder) {
      const p = path.resolve(patch.hubFolder);
      if ((await conf()).connectors.some((c) => c.kind === 'folder' && c.fields.path && (path.resolve(c.fields.path) === p || p.startsWith(path.resolve(c.fields.path) + path.sep) || path.resolve(c.fields.path).startsWith(p + path.sep)))) throw new Error('The notes folder cannot be inside a connected folder, or hold one.');
      await fsp.mkdir(p, { recursive: true });
      await save({ hubFolder: p });
    }
    changed();
    return overview();
  },
  async addConnector(input) {
    const def = connectorDef(input.kind);
    const c = await conf();
    if (input.kind === 'folder' && input.fields?.path) {
      const p = path.resolve(input.fields.path);
      const hubP = path.resolve(c.hubFolder);
      if (p === hubP || p.startsWith(hubP + path.sep) || hubP.startsWith(p + path.sep)) throw new Error('That folder is (or holds) Keeper’s notes folder. Choose another one.');
    }
    const id = `${input.kind}-${Math.random().toString(36).slice(2, 8)}`;
    for (const [k, v] of Object.entries(input.secrets ?? {})) if (v) await setSecret(`notesync.${id}.${k}`, v);
    const label = input.label || (input.kind === 'folder' && input.fields?.path ? path.basename(input.fields.path) : def.name);
    // Every connection starts read-only, and needs a dry run before its first sync.
    const cc: ConnectorConfig = { id, kind: input.kind, label, enabled: true, writeBack: false, pushNew: false, fields: input.fields ?? {}, everyMin: def.capability === 'import-only' ? 0 : 30, reviewed: false };
    await save({ connectors: [...c.connectors, cc] });
    schedule();
    changed();
    return overview();
  },
  async updateConnector(id, patch) {
    const c = await conn(id);
    for (const [k, v] of Object.entries(patch.secrets ?? {})) await setSecret(`notesync.${id}.${k}`, v);
    // a new password, email or server: sign in afresh (the kept session and keys belong to the old one)
    if (patch.secrets?.password || patch.fields?.email !== undefined || patch.fields?.server !== undefined) await setSecret(`notesync.${id}.session`, '');
    if (patch.writeBack && connectorDef(c.kind).capability === 'import-only') throw new Error(`${appName(c.kind)} is import only: Keeper cannot write to it.`);
    Object.assign(c, { ...patch, secrets: undefined, fields: patch.fields ? { ...c.fields, ...patch.fields } : c.fields });
    delete (c as { secrets?: unknown }).secrets;
    if (patch.fields || patch.secrets) c.reviewed = false;
    await save();
    schedule();
    changed();
    return overview();
  },
  async removeConnector(id) {
    const c = await conf();
    stopPolls.get(id)?.();
    await setSecret(`notesync.${id}.session`, '');
    // The hub keeps its copies; only the link to the app is forgotten.
    await save({ connectors: c.connectors.filter((x) => x.id !== id) });
    changed();
    return overview();
  },
  async test(id) {
    try {
      const io = await ioFor(await conn(id));
      return { ok: true, message: io.test ? await io.test() : 'Ready' };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  },
  async plan(id) {
    const c = await conn(id);
    try {
      const p = await prepare(c);
      if (!c.reviewed) { c.reviewed = true; await save(); schedule(); }
      status.set(id, { state: 'idle', message: p.plan.summary });
      changed();
      return planView(p.plan);
    } catch (e) {
      const err = e as ConnectorError;
      const msg = err.message;
      status.set(id, { state: 'error', message: msg });
      changed();
      return { connector: id, made: Date.now(), summary: msg, counts: { add: 0, update: 0, updateApp: 0, addApp: 0, merge: 0, conflicts: 0, trash: 0, deleteApp: 0, held: 0, locked: 0, unchanged: 0 }, items: [], message: msg, needs: err.code === 'auth' ? (/password/i.test(msg) ? 'password' : 'token') : /Add .*(folder|file|export)/.test(msg) ? 'path' : undefined };
    }
  },
  sync: (id, opts) => runSync(id, opts),
  async search(q, opts = {}) {
    const h = await store();
    await h.scan(2000);
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    const out: { n: HubNote; score: number }[] = [];
    for (const n of h.notes.values()) {
      if (opts.tag && !n.tags.includes(opts.tag)) continue;
      if (opts.app && !n.sources.some((s) => s.app === opts.app)) continue;
      const title = n.title.toLowerCase();
      const body = n.locked ? '' : n.body.toLowerCase();
      if (!terms.every((t) => title.includes(t) || body.includes(t) || n.tags.some((g) => g.toLowerCase().includes(t)))) continue;
      out.push({ n, score: terms.reduce((s, t) => s + (title.includes(t) ? 3 : 1), 0) + n.modified / 1e14 });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, opts.limit ?? 200).map((x) => hit(x.n, terms));
  },
  async tags() {
    const h = await store();
    await h.scan(2000);
    const m = new Map<string, { count: number; apps: Set<ConnectorKind> }>();
    for (const n of h.notes.values()) for (const t of n.tags) {
      const e = m.get(t) ?? { count: 0, apps: new Set() };
      e.count++;
      for (const s of n.sources) e.apps.add(s.app);
      m.set(t, e);
    }
    return [...m].map(([tag, e]) => ({ tag, count: e.count, apps: [...e.apps] })).sort((a, b) => b.count - a.count);
  },
  note: detail,
  async saveNote(keeperId, input) {
    const h = await store();
    await h.scan(500);
    const now = Date.now();
    const old = keeperId ? h.get(keeperId) : undefined;
    if (keeperId && !old) throw new Error('That note is gone');
    if (old?.locked) throw new Error('Locked notes can only be changed in their own app.');
    const n: HubNote = old
      ? { ...old, title: input.title || old.title, body: input.body, tags: input.tags ? normTags(input.tags) : old.tags, modified: now }
      : { keeperId: newKeeperId(), title: input.title || 'Untitled', body: input.body, tags: normTags(input.tags ?? []), created: now, modified: now, sources: [] };
    const out = await h.write(n, { appFolder: 'Inbox' });
    await h.log([{ at: now, keeperId: out.keeperId, title: out.title, app: 'hub', action: old ? 'edited' : 'added', summary: old ? changeSummary(old.body, out.body) : 'made in Keeper' }]);
    changed();
    return (await detail(out.keeperId))!;
  },
  copyTo: (ids, target, move) => copyTo(ids, target, move),
  async migrate(from, to) {
    const ids = (await hubNotesFor()).filter((n) => n.sources.some((s) => s.connector === from)).map((n) => n.keeperId);
    return copyTo(ids, to, false);
  },
  async conflicts() {
    const h = await store();
    const cs = (await conf()).connectors;
    return (await h.conflicts()).map((c): ConflictView => ({ ...c, appName: cs.find((x) => x.id === c.connector)?.label ?? appName(c.app), rows: sideBySide(c.mine, c.theirs) }));
  },
  async resolveConflict(id, keep, merged) {
    const h = await store();
    await h.scan();
    const list = await h.conflicts();
    const e = list.find((x) => x.id === id);
    if (!e) return;
    const n = h.get(e.keeperId);
    const theirs = splitDoc(e.theirs);
    // The app has "theirs": that is now the base, so the hub's choice flows back on the next sync.
    const hash = await h.putBase(theirs.title, theirs.body);
    if (n) {
      let next: HubNote = n;
      if (keep === 'theirs') next = { ...n, title: theirs.title, body: theirs.body };
      if (keep === 'merged' && merged !== undefined) { const m = splitDoc(merged.includes('\n') ? merged : `${n.title}\n${merged}`); next = { ...n, title: m.title || n.title, body: m.body }; }
      next = { ...next, modified: Date.now(), sources: next.sources.map((s) => (s.connector === e.connector ? { ...s, hash } : s)) };
      await h.write(next);
      await h.log([{ at: Date.now(), keeperId: n.keeperId, title: next.title, app: e.app, connector: e.connector, action: 'updated', summary: `conflict settled: kept ${keep === 'mine' ? 'Keeper’s text' : keep === 'theirs' ? `${appName(e.app)}’s text` : keep === 'both' ? 'both' : 'a merge'}` }]);
    }
    if (keep !== 'both') { const copy = h.get(e.copyId); if (copy) await h.moveToTrash(copy, 'conflict settled'); }
    await h.saveConflicts(list.filter((x) => x.id !== id));
    changed();
  },
  async duplicates() {
    const h = await store();
    await h.scan(2000);
    const c = await conf();
    return findDuplicates([...h.notes.values()], new Set(c.dismissedDuplicates)).map((g): DuplicateView => ({
      id: g.id, score: g.score,
      notes: g.notes.map((id) => h.get(id)!).filter(Boolean).map((n) => ({ keeperId: n.keeperId, title: n.title, apps: [...new Set(n.sources.map((s) => s.app))], snippet: snippet(n.body, []), modified: n.modified })),
    }));
  },
  async resolveDuplicate(id, action, keepId) {
    const c = await conf();
    if (action === 'ignore') { await save({ dismissedDuplicates: [...c.dismissedDuplicates, id] }); changed(); return; }
    const h = await store();
    await h.scan();
    const g = findDuplicates([...h.notes.values()], new Set()).find((x) => x.id === id);
    if (!g) return;
    const notes = g.notes.map((x) => h.get(x)!).filter(Boolean);
    const keep = notes.find((n) => n.keeperId === keepId) ?? notes.sort((a, b) => b.modified - a.modified)[0];
    const r = linkDuplicates(keep, notes.filter((n) => n !== keep), action === 'merge');
    await h.write({ ...r.keep, modified: Date.now() });
    for (const rid of r.remove) { const n = h.get(rid); if (n) await h.moveToTrash({ ...n, sources: [] }, `linked with “${keep.title}”`); }
    await h.log([{ at: Date.now(), keeperId: keep.keeperId, title: keep.title, app: 'hub', action: 'merged-duplicate', summary: `${action === 'merge' ? 'merged' : 'linked'} with ${r.remove.length} copy${r.remove.length === 1 ? '' : 'ies'} from other apps` }]);
    changed();
  },
  async trash() {
    const h = await store();
    return (await h.trashList()).map((t) => ({ id: t.id, keeperId: t.keeperId, title: t.title, at: t.at, why: t.why, apps: [...new Set(t.apps ?? t.sources.map((s) => s.app))] as ConnectorKind[] }));
  },
  async restore(id) {
    const h = await store();
    const n = await h.restore(id);
    if (n) await h.log([{ at: Date.now(), keeperId: n.keeperId, title: n.title, app: 'hub', action: 'restored', summary: 'back from the notes trash' }]);
    changed();
  },
  async snapshots() {
    const h = await store();
    return h.summarize(await h.manifests());
  },
  async snapshotNow(label) {
    const h = await store();
    const m = await h.snapshot(label ?? 'By hand', false);
    changed();
    if (!m) return null;
    return h.summarize(await h.manifests()).find((s) => s.id === m.id) ?? null;
  },
  async restoreSnapshot(id, paths) {
    const h = await store();
    const restored = await h.restoreSnapshot(id, paths);
    changed();
    return { restored };
  },
  exportAs: (format, opts) => exportAs(format, opts),
  async history(keeperId) {
    return (await store()).history(keeperId, 300);
  },
  async shareWithDevices(on, devices) {
    const c = await conf();
    const { syncApi } = await import('../sync');
    if (on) {
      if (!c.devicesFolderId) {
        const ov = await syncApi.overview();
        const ids = devices ?? ov.peers.map((p) => p.id);
        await fsp.mkdir(c.hubFolder, { recursive: true });
        const before = new Set(ov.folders.map((f) => f.id));
        const after = await syncApi.addFolder({ path: c.hubFolder, label: 'Notes', mode: 'two-way', devices: ids, ignore: ['.keeper-notes/'] });
        const f = after.folders.find((x) => !before.has(x.id) && x.path === c.hubFolder);
        await save({ devicesFolderId: f?.id });
      }
    } else if (c.devicesFolderId) {
      await syncApi.removeFolder(c.devicesFolderId).catch(() => undefined);
      await save({ devicesFolderId: undefined });
    }
    changed();
    return overview();
  },
  async shortcutGuide() {
    return shortcutSteps('Notes Everywhere → Connect → Markdown or text folder');
  },
  async islandNotes(q = '', limit = 300) {
    const hubOn = featureOn('notesHub');
    if (!hubOn) return { hubOn, platform: process.platform, sources: [], hits: [] };
    const c = await conf();
    const h = await store();
    const hits = await notesApi.search(String(q ?? '').slice(0, 200), { limit: Math.max(1, Math.min(Number(limit) || 300, 1000)) });
    const sources = c.connectors.map((x) => {
      const def = connectorDef(x.kind);
      const st = status.get(x.id);
      let notes = 0;
      for (const n of h.notes.values()) if (n.sources.some((s) => s.connector === x.id)) notes++;
      const available = availableOn(def, process.platform);
      return {
        id: x.id, kind: x.kind, app: def.name, enabled: x.enabled, available, reviewed: x.reviewed, notes, lastSync: x.lastSync,
        state: (!available ? 'unavailable' : st?.state ?? (!x.reviewed ? 'needs-review' : 'idle')) as 'idle' | 'syncing' | 'error' | 'needs-review' | 'unavailable',
        message: st?.message ?? x.message,
      };
    });
    return { hubOn, platform: process.platform, sources, hits: hits.map((x) => ({ keeperId: x.keeperId, title: x.title, snippet: x.snippet, tags: x.tags, apps: x.apps, modified: x.modified, locked: x.locked })) };
  },
};

// ---------------------------------------------------------------- start, the To do list, the phone

export async function startNotes(d: NotesDeps) {
  deps = d;
  await conf();
  onFeature('notesSync', () => schedule(), { now: true });
}

export function stopNotes() {
  for (const stop of stopPolls.values()) stop();
  stopPolls.clear();
}

/** For the To do list: notes in connected apps without a recent snapshot, and conflicts waiting. */
export async function notesFindings(): Promise<import('../../../core/guide/types').Finding[]> {
  if (!deps || !featureOn('notesHub')) return [];
  const c = await conf();
  const live = c.connectors.filter((x) => x.enabled);
  if (!live.length) return [];
  const h = await store();
  const snaps = await h.manifests();
  const out: import('../../../core/guide/types').Finding[] = [];
  const last = snaps[snaps.length - 1]?.time ?? 0;
  if (!c.devicesFolderId && Date.now() - last > 7 * 24 * 3600_000) {
    const apps = new Set(live.map((x) => x.kind)).size;
    out.push({
      id: 'notes:backup', source: 'notes', area: 'backup', severity: 'medium',
      title: `Notes in ${apps} app${apps === 1 ? '' : 's'} aren’t backed up`,
      why: 'If an app loses your notes or closes down, there is no copy. Keeper can keep dated snapshots of every note and copy them to your other devices.',
      fix: { kind: 'page', route: { name: 'noteshub', arg: 'backups' }, label: 'Open notes backups', steps: [{ text: 'Press “Snapshot now”.' }, { text: 'Turn on “Copy to my other devices” or add the notes folder to a backup in Sync & Backup.' }] },
    });
  }
  const conflicts = (await h.conflicts()).length;
  if (conflicts) out.push({
    id: 'notes:conflicts', source: 'notes', area: 'storage', severity: 'low',
    title: `${conflicts} note${conflicts === 1 ? '' : 's'} changed in two places`,
    why: 'Both copies are kept. Choose which text to keep, or keep both.',
    fix: { kind: 'page', route: { name: 'noteshub', arg: 'conflicts' }, label: 'Review conflicts' },
  });
  return out;
}

/** Search, read, edit and jot notes from the phone companion. */
export function registerNotesCompanion(node: { registerCompanionOp(op: string, fn: (h: Record<string, unknown>, body: Uint8Array, cid: string) => Promise<{ r?: unknown; body?: Uint8Array }>): void }) {
  const on = () => { if (!featureOn('notesHub')) throw new Error('Notes are switched off on the computer'); };
  node.registerCompanionOp('notes.search', async (h) => { on(); return { r: await notesApi.search(String(h.q ?? ''), { limit: 50 }) }; });
  node.registerCompanionOp('notes.read', async (h) => { on(); return { r: await notesApi.note(String(h.id ?? '')) }; });
  node.registerCompanionOp('notes.save', async (h) => { on(); return { r: await notesApi.saveNote(h.id ? String(h.id) : null, { title: String(h.title ?? ''), body: String(h.body ?? ''), tags: Array.isArray(h.tags) ? h.tags.map(String) : undefined }) }; });
  node.registerCompanionOp('notes.capture', async (h) => {
    on();
    const text = String(h.text ?? '').trim();
    if (!text) throw new Error('Nothing to save');
    const i = text.indexOf('\n');
    return { r: await notesApi.saveNote(null, { title: (i < 0 ? text : text.slice(0, i)).slice(0, 120), body: i < 0 ? '' : text.slice(i + 1) }) };
  });
}

