// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The disk, network and script side of each connector. The mapping between
// each app's format and notes lives in core/notes-sync/connectors.

import { execFile } from 'node:child_process';
import * as nodeCrypto from 'node:crypto';
import { randomBytes } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readTar, readZip } from '../../../core/notes-sync/archive';
import { createScript, deleteScript, fromAppleRows, listScript, updateScript, appleBodyFor, type AppleNoteRow } from '../../../core/notes-sync/connectors/applenotes';
import { parseEnex } from '../../../core/notes-sync/connectors/evernote';
import { folderFileText, folderNoteFromFile, folderRelFor, isNoteFile } from '../../../core/notes-sync/connectors/folder';
import { fromKeepTakeout, fromNotesnookBackup, fromNotesnookFile, fromSamsungFile } from '../../../core/notes-sync/connectors/imports';
import { ConnectorError, firstLineTitle, type ConnectorIO, type FetchFn, type ListContext } from '../../../core/notes-sync/connectors/io';
import { JoplinApi, notesFromItems } from '../../../core/notes-sync/connectors/joplin';
import { BEAR_DB_REL, BEAR_SQL, bearCreateUrl, bearTrashUrl, bearUpdateUrl, fromBearRows, fromStickyRows, STICKY_DB_REL, STICKY_PROCESS, STICKY_SQL, stickyInsert, stickyUpdate } from '../../../core/notes-sync/connectors/localdb';
import { NotionApi } from '../../../core/notes-sync/connectors/notion';
import { OneNoteApi } from '../../../core/notes-sync/connectors/onenote';
import { SimplenoteApi } from '../../../core/notes-sync/connectors/simplenote';
import { parseSnBackup, snRootKey, type Argon2 } from '../../../core/notes-sync/connectors/standardnotes';
import type { ConnectorKind, RemoteNote } from '../../../core/notes-sync/types';
import { readRows, runWrite } from './sqlite';
import { permissionNeeded } from '../permission-nudge';

export interface ConnectorConfig {
  id: string;
  kind: ConnectorKind;
  label: string;
  enabled: boolean;
  writeBack: boolean;
  pushNew: boolean;
  fields: Record<string, string>;
  everyMin: number;
  reviewed: boolean;
  lastSync?: number;
  message?: string;
}

export interface IoDeps {
  secret(name: string): Promise<string | undefined>;
  openUrl(url: string): Promise<void>;
  trashFile(p: string): Promise<void>;
  /** Keeper's own quick notes (the Island) */
  island: { get(): Promise<{ id: string; text: string; created: number; updated: number }[]>; save(notes: { id: string; text: string; created: number; updated: number; pinned?: boolean }[]): Promise<void> };
  ctx: ListContext;
}

const fetchFn: FetchFn = async (url, init) => {
  const r = await fetch(url, { method: init?.method ?? 'GET', headers: init?.headers, body: init?.body });
  return { ok: r.ok, status: r.status, headers: { get: (n) => r.headers.get(n) }, json: () => r.json(), text: () => r.text() };
};

const run = (cmd: string, args: string[], timeout = 120_000) => new Promise<string>((resolve, reject) => execFile(cmd, args, { maxBuffer: 512 << 20, timeout }, (err, out, errOut) => (err ? reject(new Error((errOut || err.message).trim().slice(0, 300))) : resolve(out))));

async function walkFiles(root: string, accept: (rel: string) => boolean, max = 50_000): Promise<{ rel: string; abs: string; mtime: number; size: number }[]> {
  const out: { rel: string; abs: string; mtime: number; size: number }[] = [];
  const walk = async (dir: string, rel: string) => {
    for (const e of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (out.length >= max) return;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!e.name.startsWith('.') && e.name !== 'node_modules') await walk(path.join(dir, e.name), r); continue; }
      if (!e.isFile() || !accept(r)) continue;
      const st = await fsp.stat(path.join(dir, e.name)).catch(() => null);
      if (st) out.push({ rel: r, abs: path.join(dir, e.name), mtime: st.mtimeMs, size: st.size });
    }
  };
  await walk(root, '');
  return out;
}

const need = (v: string | undefined, what: string) => {
  if (!v) throw new ConnectorError('not-supported', `Add ${what} in this connection’s settings.`);
  return v;
};

// Node 24 (in Electron) has Argon2 built in; the type definitions here are older.
type NodeArgon2 = (algo: 'argon2id', p: { message: string; nonce: Uint8Array; parallelism: number; tagLength: number; memory: number; passes: number }, cb: (err: Error | null, key: Buffer) => void) => void;
const argon2: Argon2 = (password, salt, o) => new Promise((resolve, reject) => {
  const fn = (nodeCrypto as unknown as { argon2?: NodeArgon2 }).argon2;
  if (typeof fn !== 'function') return reject(new Error('Opening encrypted backups needs a newer Keeper.'));
  fn('argon2id', { message: password, nonce: salt, parallelism: o.parallelism, tagLength: o.length, memory: o.memoryKiB, passes: o.iterations }, (err, key) => (err ? reject(err) : resolve(new Uint8Array(key))));
});

// ---------------------------------------------------------------- plain folders

class FolderIO implements ConnectorIO {
  constructor(private root: string, private trash: (p: string) => Promise<void>) {}
  async test() {
    const st = await fsp.stat(this.root).catch(() => null);
    if (!st?.isDirectory()) throw new ConnectorError('unreachable', 'That folder is not there.');
    const n = (await walkFiles(this.root, isNoteFile)).length;
    return `${n} note file${n === 1 ? '' : 's'} found`;
  }
  async list() {
    const st = await fsp.stat(this.root).catch(() => null);
    if (!st?.isDirectory()) throw new ConnectorError('unreachable', 'That folder is not there.');
    const notes: RemoteNote[] = [];
    for (const f of await walkFiles(this.root, isNoteFile)) {
      const text = await fsp.readFile(f.abs, 'utf8').catch(() => null);
      if (text !== null) notes.push(folderNoteFromFile(f.rel, text, f.mtime, f.size));
    }
    return { notes, complete: true };
  }
  private abs(rel: string) {
    const p = path.resolve(this.root, ...rel.split('/'));
    if (!p.startsWith(path.resolve(this.root) + path.sep)) throw new Error('Outside the folder');
    return p;
  }
  private async free(rel: string) {
    let r = rel;
    for (let i = 2; await fsp.access(this.abs(r)).then(() => true, () => false); i++) r = rel.replace(/(\.[^./]+)$/, ` ${i}$1`);
    return r;
  }
  private async version(rel: string) { const st = await fsp.stat(this.abs(rel)); return `${Math.round(st.mtimeMs)}-${st.size}`; }
  async create(n: RemoteNote) {
    const rel = await this.free(folderRelFor(n));
    await fsp.mkdir(path.dirname(this.abs(rel)), { recursive: true });
    await fsp.writeFile(this.abs(rel), folderFileText(n, rel));
    return { sourceId: rel, version: await this.version(rel) };
  }
  async update(n: RemoteNote) {
    let rel = n.sourceId;
    const ext = /\.[^./]+$/.exec(rel)?.[0] ?? '.md';
    const want = folderRelFor({ title: n.title, folder: rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : undefined }, ext.slice(1));
    if (want !== rel && !(await fsp.access(this.abs(want)).then(() => true, () => false))) {
      await fsp.rename(this.abs(rel), this.abs(want));
      rel = want;
    }
    await fsp.writeFile(this.abs(rel), folderFileText(n, rel));
    return { version: await this.version(rel), sourceId: rel };
  }
  async remove(id: string) { await this.trash(this.abs(id)); }
}

// ---------------------------------------------------------------- imports from files

async function readTextFiles(p: string, accept: RegExp): Promise<{ name: string; text: string; mtime: number; data?: Buffer }[]> {
  const st = await fsp.stat(p).catch(() => null);
  if (!st) throw new ConnectorError('unreachable', 'That file or folder is not there.');
  if (st.isDirectory()) {
    const files = await walkFiles(p, (r) => accept.test(r) || /\.(png|jpe?g|gif|webp|heic|pdf|m4a|mp3|3gp|awb)$/i.test(r));
    return Promise.all(files.map(async (f) => {
      const data = await fsp.readFile(f.abs);
      return { name: f.rel, text: accept.test(f.rel) ? data.toString('utf8') : '', mtime: f.mtime, data };
    }));
  }
  const buf = await fsp.readFile(p);
  if (/\.zip$/i.test(p) || (buf[0] === 0x50 && buf[1] === 0x4b)) return readZip(buf).map((e) => ({ name: e.name, text: accept.test(e.name) ? Buffer.from(e.data).toString('utf8') : '', mtime: st.mtimeMs, data: Buffer.from(e.data) }));
  return [{ name: path.basename(p), text: buf.toString('utf8'), mtime: st.mtimeMs }];
}

const importOnly = (list: () => Promise<RemoteNote[]>): ConnectorIO => ({
  list: async () => ({ notes: await list(), complete: false }),
  test: async () => { const n = await list(); return `${n.length} note${n.length === 1 ? '' : 's'} found`; },
});

// ---------------------------------------------------------------- the connectors

export async function connectorIO(c: ConnectorConfig, d: IoDeps): Promise<ConnectorIO> {
  const sec = (k: string) => d.secret(`notesync.${c.id}.${k}`);
  switch (c.kind) {
    case 'folder':
      return new FolderIO(need(c.fields.path, 'a folder'), d.trashFile);

    case 'joplin':
      return new JoplinApi(c.fields.url || '', need(await sec('token'), 'Joplin’s authorisation token'), fetchFn);

    case 'joplin-files':
      return importOnly(async () => {
        const p = need(c.fields.path, 'the sync folder or .jex file');
        const st = await fsp.stat(p).catch(() => null);
        let texts: string[];
        if (st?.isFile()) texts = readTar(await fsp.readFile(p)).filter((e) => /^[0-9a-f]{32}\.md$/.test(path.basename(e.name))).map((e) => Buffer.from(e.data).toString('utf8'));
        else texts = await Promise.all((await walkFiles(p, (r) => /^[0-9a-f]{32}\.md$/.test(r))).map((f) => fsp.readFile(f.abs, 'utf8')));
        return notesFromItems(texts).notes;
      });

    case 'standardnotes':
      return importOnly(async () => {
        const text = await fsp.readFile(need(c.fields.path, 'a backup file'), 'utf8');
        let r = parseSnBackup(text);
        if (r.needsPassword) {
          const pw = await sec('password');
          if (!pw || !r.keyParams) throw new ConnectorError('auth', 'This backup is encrypted: add its password (it stays on this computer).');
          const { masterKey } = await snRootKey(pw, r.keyParams, argon2);
          r = parseSnBackup(text, masterKey);
          if (!r.notes.length && r.skipped) throw new ConnectorError('auth', 'That password does not open this backup.');
        }
        return r.notes;
      });

    case 'notesnook':
      return importOnly(async () => {
        const p = need(c.fields.path, 'the export');
        const files = await readTextFiles(p, /\.(md|html?|txt|json|nnbackup)$/i);
        const out: RemoteNote[] = [];
        for (const f of files) {
          if (/\.(json|nnbackup)$/i.test(f.name)) {
            const r = fromNotesnookBackup(f.text);
            if (r.encrypted) throw new ConnectorError('not-supported', 'This Notesnook backup is encrypted. Make an unencrypted backup or export as Markdown.');
            out.push(...r.notes);
          } else {
            const n = fromNotesnookFile(f.name, f.text, f.mtime);
            if (n) out.push(n);
          }
        }
        return out;
      });

    case 'onenote':
      return new OneNoteApi(need(await sec('token'), 'a Microsoft Graph token'), fetchFn, c.fields.section || undefined, d.ctx);

    case 'notion':
      return new NotionApi(need(await sec('token'), 'a Notion integration token'), fetchFn, c.fields.parent || undefined, d.ctx);

    case 'simplenote':
      return new SimplenoteApi(need(c.fields.email, 'your email'), need(await sec('password'), 'your password'), fetchFn);

    case 'evernote':
      return importOnly(async () => {
        const p = need(c.fields.path, 'an .enex file');
        const st = await fsp.stat(p).catch(() => null);
        if (!st) throw new ConnectorError('unreachable', 'That file is not there.');
        const files = st.isDirectory() ? (await walkFiles(p, (r) => /\.enex$/i.test(r))).map((f) => f.abs) : [p];
        const out: RemoteNote[] = [];
        for (const f of files) out.push(...parseEnex(await fsp.readFile(f, 'utf8'), path.basename(f).replace(/\.enex$/i, '')));
        return out;
      });

    case 'keep':
      return importOnly(async () => {
        const files = await readTextFiles(need(c.fields.path, 'the Takeout Keep folder'), /\.(json|html?)$/i);
        const bin = new Map(files.filter((f) => f.data).map((f) => [path.basename(f.name), new Uint8Array(f.data!)]));
        return fromKeepTakeout(files.filter((f) => f.text), (n) => bin.get(path.basename(n)));
      });

    case 'samsung':
      return importOnly(async () => {
        const files = await readTextFiles(need(c.fields.path, 'the folder of exported notes'), /\.(txt|html?|md)$/i);
        return files.filter((f) => f.text).map((f) => fromSamsungFile(f.name, f.text, f.mtime)).filter((n): n is RemoteNote => !!n);
      });

    case 'applenotes': {
      if (process.platform !== 'darwin') throw new ConnectorError('not-supported', 'Apple Notes can only be reached from a Mac. On iPhone, use the Shortcut steps.');
      const jxa = (s: string) => run('osascript', ['-l', 'JavaScript', '-e', s]);
      const account = c.fields.account || undefined;
      const io: ConnectorIO = {
        async list() {
          let out: string;
          try { out = await jxa(listScript(account)); } catch (e) { if (/not allowed|-1743/.test(String(e))) permissionNeeded('automation.notes', 'notesSync'); throw new ConnectorError('auth', /not allowed|-1743/.test(String(e)) ? 'Allow Keeper to control Notes: System Settings → Privacy & Security → Automation.' : `Notes did not answer: ${(e as Error).message}`); }
          return { notes: fromAppleRows(JSON.parse(out) as AppleNoteRow[]), complete: true };
        },
        async test() { const r = await io.list(); return `Connected: ${r.notes.length} notes (${r.notes.filter((n) => n.locked).length} locked)`; },
        async create(n) {
          const folder = (n.folder ?? '').split('/').pop() || 'Notes';
          const r = JSON.parse(await jxa(createScript(folder, appleBodyFor(n.title, n.body), account))) as { id: string; modified: number };
          return { sourceId: r.id, version: String(r.modified) };
        },
        async update(n) {
          const r = JSON.parse(await jxa(updateScript(n.sourceId, appleBodyFor(n.title, n.body)))) as { modified: number };
          return { version: String(r.modified) };
        },
        async remove(id) { await jxa(deleteScript(id)); },
      };
      return io;
    }

    case 'bear': {
      if (process.platform !== 'darwin') throw new ConnectorError('not-supported', 'Bear is only on Mac.');
      const db = path.join(os.homedir(), BEAR_DB_REL);
      const read = async () => {
        if (!(await fsp.access(db).then(() => true, () => false))) throw new ConnectorError('unreachable', 'Bear’s notes were not found. Is Bear installed?');
        return fromBearRows(await readRows(db, BEAR_SQL));
      };
      const settle = () => new Promise((r) => setTimeout(r, 1500));
      return {
        async list() { return { notes: await read(), complete: true }; },
        async test() { return `Connected: ${(await read()).filter((n) => !n.trashed).length} notes`; },
        async create(n) {
          const before = new Set((await read()).map((x) => x.sourceId));
          await d.openUrl(bearCreateUrl(n));
          await settle();
          const made = (await read()).find((x) => !before.has(x.sourceId) && x.title === n.title);
          if (!made) throw new ConnectorError('busy', 'Bear did not confirm the new note. It will be matched on the next sync.');
          return { sourceId: made.sourceId, version: made.version };
        },
        async update(n) { await d.openUrl(bearUpdateUrl(n)); await settle(); return { version: (await read()).find((x) => x.sourceId === n.sourceId)?.version }; },
        async remove(id) { await d.openUrl(bearTrashUrl(id)); },
      };
    }

    case 'sticky': {
      if (process.platform !== 'win32') throw new ConnectorError('not-supported', 'Sticky Notes is only on Windows.');
      const db = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), ...STICKY_DB_REL.split('/'));
      const running = async () => /Microsoft\.Notes\.exe/i.test(await run('tasklist', ['/FI', `IMAGENAME eq ${STICKY_PROCESS}`], 10_000).catch(() => ''));
      const guard = async () => { if (await running()) throw new ConnectorError('busy', 'Close Sticky Notes first: Keeper only writes while it is closed.'); };
      const read = async () => fromStickyRows(await readRows(db, STICKY_SQL));
      return {
        async list() { return { notes: await read(), complete: true }; },
        async test() { return `Connected: ${(await read()).length} sticky notes`; },
        async create(n) { await guard(); const q = stickyInsert(n); await runWrite(db, q.sql, q.params); return { sourceId: q.id }; },
        async update(n) { await guard(); const q = stickyUpdate(n); await runWrite(db, q.sql, q.params); return {}; },
      };
    }

    case 'island':
      return {
        async list() {
          const notes = await d.island.get();
          return { complete: true, notes: notes.map((q) => ({ ...firstLineTitle(q.text), sourceId: q.id, tags: [], created: q.created, modified: q.updated, version: String(q.updated) })) };
        },
        async test() { return `${(await d.island.get()).length} quick notes`; },
        async create(n) {
          const all = await d.island.get();
          const id = randomBytes(6).toString('hex');
          const now = Date.now();
          await d.island.save([{ id, text: n.body ? `${n.title}\n${n.body}` : n.title, created: now, updated: now }, ...all]);
          return { sourceId: id, version: String(now) };
        },
        async update(n) {
          const now = Date.now();
          await d.island.save((await d.island.get()).map((q) => (q.id === n.sourceId ? { ...q, text: n.body ? `${n.title}\n${n.body}` : n.title, updated: now } : q)));
          return { version: String(now) };
        },
        async remove(id) { await d.island.save((await d.island.get()).filter((q) => q.id !== id)); },
      };
  }
  throw new ConnectorError('not-supported', 'Unknown connector');
}
