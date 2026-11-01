// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The settings catalogue in the app: reads current values, previews the exact
// commands, takes a backup before the first change to an area, applies through
// one administrator prompt when needed, keeps a change log with undo, and
// exports or imports setup profiles. Only catalogue operations ever run.

import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import { existsSync, promises as fsp } from 'node:fs';
import path from 'node:path';
import {
  AFTER_TEXT, CATALOG, UNSET, afterCmds, backupCmd, catalogCounts, catalogFor, opText, parseRead, readCmd, searchCatalog, settingById, showCmd, validateValue, writeCmds,
  type ChangeRecord, type Cmd, type Os, type ReadResult, type SettingDef,
} from '../../core/settings-catalog';
import { exportProfile, parseProfile, previewProfile } from '../../core/settings-catalog/profile';
import type { BackupInfo, CatalogApi, CatalogEntry, ChangePreview } from '../../core/api-settingsplus';
import { runCmds, runOne } from './elevate';

const OS = process.platform as Os;
let dataDir = '';
const dir = () => (dataDir ||= path.join(app.getPath('userData'), 'settings-catalog'));
const file = (n: string) => path.join(dir(), n);

/** Tests and the command line point this somewhere else. */
export function setCatalogDir(d: string) {
  dataDir = d;
  loaded = false;
}

let loaded = false;
let log: ChangeRecord[] = [];
let favourites: string[] = [];
let backups: BackupInfo[] = [];
let changed: (() => void) | null = null;
export function onCatalogChanged(fn: () => void) {
  changed = fn;
}

async function load() {
  if (loaded) return;
  loaded = true;
  const read = async <T>(n: string, d: T): Promise<T> => {
    try {
      return JSON.parse(await fsp.readFile(file(n), 'utf8')) as T;
    } catch {
      return d;
    }
  };
  log = await read('log.json', []);
  favourites = await read('favourites.json', []);
  backups = await read('backups.json', []);
}

async function save(n: 'log' | 'favourites' | 'backups') {
  await fsp.mkdir(dir(), { recursive: true });
  const data = n === 'log' ? log.slice(0, 500) : n === 'favourites' ? favourites : backups.slice(0, 300);
  const f = file(`${n}.json`);
  await fsp.writeFile(`${f}.tmp`, JSON.stringify(data, null, 1), { mode: 0o600 });
  await fsp.rename(`${f}.tmp`, f);
  changed?.();
}

export function entry(s: SettingDef): CatalogEntry {
  return {
    id: s.id, os: s.os, versions: s.versions, category: s.category, title: s.title, description: s.description, kind: s.kind,
    on: s.on, off: s.off, choices: s.choices, min: s.min, max: s.max, unit: s.unit, systemDefault: s.systemDefault, admin: s.admin,
    after: s.after, afterText: AFTER_TEXT[s.after], risk: s.risk, warning: s.warning, steps: s.steps, sources: s.sources,
    advice: s.op.t === 'advice', technical: opText(s),
  };
}

// ---------------------------------------------------------------- reading

/** Reads one setting; settings that share one command (pmset -g custom) run it once per batch. */
async function readOne(s: SettingDef, batch: Map<string, Promise<{ ok: boolean; stdout: string }>>): Promise<ReadResult> {
  const c = readCmd(s.op);
  if (!c) return { id: s.id, value: s.systemDefault, isDefault: true, error: s.op.t === 'winfeature' ? 'Reading this needs an administrator' : undefined };
  const key = `${c.file}\0${c.args.join('\0')}`;
  if (!batch.has(key)) batch.set(key, runOne(c, 8000).then((r) => ({ ok: r.ok, stdout: r.stdout })));
  const res = await batch.get(key)!;
  const raw = parseRead(s, res.stdout, res.ok);
  return raw === undefined ? { id: s.id, value: s.systemDefault, isDefault: true } : { id: s.id, raw, value: raw, isDefault: sameValue(raw, s.systemDefault) };
}

/** "1" and "1.0", "true" and "true": the same value however the system prints it. */
const sameValue = (a: string, b: string) => a === b || (/^-?[\d.]+$/.test(a) && /^-?[\d.]+$/.test(b) && Number(a) === Number(b));

export async function readValues(ids: string[]): Promise<ReadResult[]> {
  const defs = ids.map(settingById).filter((s): s is SettingDef => !!s && s.os === OS);
  const batch = new Map<string, Promise<{ ok: boolean; stdout: string }>>();
  const out: ReadResult[] = [];
  // a few at a time: reading is cheap but there can be hundreds
  for (let i = 0; i < defs.length; i += 8) out.push(...(await Promise.all(defs.slice(i, i + 8).map((s) => readOne(s, batch)))));
  return out;
}

// ---------------------------------------------------------------- changing

function plan(s: SettingDef, value: string): { cmds: Cmd[]; error?: string } {
  const err = validateValue(s, value);
  if (err) return { cmds: [], error: err };
  if (s.os !== OS) return { cmds: [], error: 'This setting is for another system' };
  return { cmds: [...writeCmds(s, value), ...afterCmds(s.after)] };
}

export async function preview(id: string, value: string): Promise<ChangePreview> {
  const s = settingById(id);
  if (!s) throw new Error('Unknown setting');
  const [now] = await readValues([id]);
  const p = plan(s, value);
  const b = backupCmd(s.op, '<backup file>');
  return {
    id, title: s.title, from: now?.value, to: value, commands: p.cmds.map(showCmd), backup: b ? showCmd(b) : undefined,
    admin: p.cmds.some((c) => c.admin), afterText: AFTER_TEXT[s.after], risk: s.risk, warning: s.warning, error: p.error,
  };
}

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');

/** A snapshot of the area (defaults domain, registry key, gsettings schema) before Keeper first changes it each day. */
async function backupFor(s: SettingDef): Promise<string | undefined> {
  const op = s.op;
  if (op.t !== 'defaults' && op.t !== 'reg' && op.t !== 'gsettings') return undefined;
  const target = op.t === 'defaults' ? op.domain : op.t === 'reg' ? `${op.hive}\\${op.path}` : op.schema;
  const today = new Date().toDateString();
  const recent = backups.find((b) => b.target === target && new Date(b.at).toDateString() === today);
  if (recent && existsSync(recent.file)) return recent.file;
  await fsp.mkdir(file('backups'), { recursive: true });
  const ext = op.t === 'defaults' ? 'plist' : op.t === 'reg' ? 'reg' : 'txt';
  const f = file(`backups/${target.replace(/[^\w.-]+/g, '_').slice(0, 80)}-${stamp()}.${ext}`);
  const c = backupCmd(op, f);
  if (!c) return undefined;
  const r = await runOne(c, 20_000);
  if (!r.ok) return undefined;
  if (op.t === 'gsettings') await fsp.writeFile(f, r.stdout, { mode: 0o600 });
  if (!existsSync(f)) return undefined;
  backups.unshift({ id: randomUUID(), at: Date.now(), settingId: s.id, title: s.title, kind: op.t, target, file: f });
  await save('backups');
  return f;
}

async function change(s: SettingDef, value: string, by: ChangeRecord['by']): Promise<{ ok: boolean; message: string; record?: ChangeRecord }> {
  await load();
  const p = plan(s, value);
  if (p.error) return { ok: false, message: p.error };
  const [before] = await readValues([s.id]);
  const backup = await backupFor(s).catch(() => undefined);
  const r = await runCmds(p.cmds);
  if (!r.ok) return { ok: false, message: r.message };
  const record: ChangeRecord = { id: randomUUID(), settingId: s.id, title: s.title, os: s.os, at: Date.now(), from: before?.raw, to: value, wasUnset: !before || before.raw === undefined, backup, by };
  log.unshift(record);
  await save('log');
  return { ok: true, message: AFTER_TEXT[s.after], record };
}

export async function apply(id: string, value: string, by: ChangeRecord['by'] = 'person') {
  const s = settingById(id);
  if (!s) return { ok: false, message: 'Unknown setting' };
  return change(s, value, by);
}

export async function reset(id: string, by: ChangeRecord['by'] = 'person') {
  const s = settingById(id);
  if (!s) return { ok: false, message: 'Unknown setting' };
  if (s.removeToRestore || s.systemDefault === UNSET) {
    if (!['defaults', 'reg', 'gsettings'].includes(s.op.t)) return change(s, s.systemDefault, by);
    return change(s, UNSET, by);
  }
  return change(s, s.systemDefault, by);
}

export async function undo(changeId: string): Promise<{ ok: boolean; message: string }> {
  await load();
  const rec = log.find((l) => l.id === changeId);
  if (!rec) return { ok: false, message: 'That change is not in the log' };
  if (rec.undone) return { ok: false, message: 'Already undone' };
  const s = settingById(rec.settingId);
  if (!s) return { ok: false, message: 'Unknown setting' };
  const canUnset = ['defaults', 'reg', 'gsettings'].includes(s.op.t);
  const to = rec.wasUnset || rec.from === undefined ? (canUnset ? UNSET : s.systemDefault) : rec.from;
  const r = await change(s, to, 'restore');
  if (r.ok) {
    rec.undone = true;
    await save('log');
  }
  return r;
}

/** Puts a whole snapshot back (every value in that defaults domain, registry key or schema). */
export async function restoreBackup(id: string): Promise<{ ok: boolean; message: string }> {
  await load();
  const b = backups.find((x) => x.id === id);
  if (!b || !existsSync(b.file)) return { ok: false, message: 'That backup is no longer there' };
  const s = settingById(b.settingId);
  let cmds: Cmd[];
  if (b.kind === 'defaults') cmds = [{ file: '/usr/bin/defaults', args: ['import', b.target, b.file], admin: s?.admin }, ...afterCmds(s?.after ?? 'none')];
  else if (b.kind === 'reg') cmds = [{ file: 'reg', args: ['import', b.file], admin: b.target.startsWith('HKLM') }];
  else {
    // `gsettings list-recursively` lines: schema key value — only lines for the snapshot's own schema are applied.
    const lines = (await fsp.readFile(b.file, 'utf8')).split('\n');
    cmds = lines.map((l) => l.match(/^(\S+) (\S+) (.+)$/)).filter((m): m is RegExpMatchArray => !!m && m[1] === b.target)
      .map((m) => ({ file: 'gsettings', args: ['set', m[1], m[2], m[3]] }));
  }
  const r = await runCmds(cmds);
  if (r.ok) {
    log.unshift({ id: randomUUID(), settingId: b.settingId, title: `Restored snapshot: ${b.target}`, os: OS, at: Date.now(), to: 'snapshot', wasUnset: false, backup: b.file, by: 'restore' });
    await save('log');
  }
  return { ok: r.ok, message: r.ok ? 'Snapshot restored' : r.message };
}

// ---------------------------------------------------------------- API

export const catalogApi: CatalogApi = {
  async list(all) {
    return { os: OS, entries: (all ? CATALOG : catalogFor(OS)).map(entry), counts: catalogCounts() };
  },
  async search(q) {
    return searchCatalog(q, OS).map(entry);
  },
  read: readValues,
  preview,
  apply: (id, v) => apply(id, v, 'person'),
  reset: (id) => reset(id, 'person'),
  async log() {
    await load();
    return log;
  },
  undo,
  async backups() {
    await load();
    return backups;
  },
  restoreBackup,
  async favourites() {
    await load();
    return favourites;
  },
  async setFavourite(id, on) {
    await load();
    favourites = on ? [...new Set([...favourites, id])] : favourites.filter((f) => f !== id);
    await save('favourites');
    return favourites;
  },
  async exportProfile(name, ids) {
    await load();
    // By default: everything Keeper changed (and not undone), at its current value.
    const wanted = ids?.length ? ids : [...new Set(log.filter((l) => !l.undone && l.by !== 'restore').map((l) => l.settingId))];
    const values = await readValues(wanted);
    return JSON.stringify(exportProfile(name, OS, values.filter((v) => !v.isDefault || ids?.includes(v.id)).map((v) => ({ id: v.id, value: v.value }))), null, 2);
  },
  async previewProfile(text) {
    const p = parseProfile(text);
    const now = await readValues(p.settings.map((s) => s.id));
    return { name: p.name, items: previewProfile(p, OS, new Map(now.map((r) => [r.id, r]))) };
  },
  async applyProfile(text, ids) {
    const p = parseProfile(text);
    const out: { id: string; ok: boolean; message: string }[] = [];
    for (const s of p.settings.filter((x) => ids.includes(x.id))) {
      const r = await apply(s.id, s.value, 'profile');
      out.push({ id: s.id, ok: r.ok, message: r.message });
    }
    return out;
  },
};
