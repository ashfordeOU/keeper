// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Extensions in the main process (core/extensions.ts has the rules): install
// from a folder (its manifest checked, its files fingerprinted and copied into
// Keeper's folder), the permission each one has (Off, Ask or Allow), and the
// calls the window passes on after checking them: search, and sites the
// extension listed. Off: nothing is read or run.

import { app, BrowserWindow, dialog } from 'electron';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import type { ExtensionsApi, InstalledExtension } from '../../core/api-extensions';
import { folderChecksum, hostAllowed, MAX_EXTENSION_BYTES, parseManifest, permissionLines, workerUrl, type ExtManifest, type ExtPermission, type PermState } from '../../core/extensions';
import type { FileEntry } from '../../core/types';
import { featureOn } from './features';

interface Stored { manifest: ExtManifest; checksum: string; enabled: boolean; perms: Partial<Record<ExtPermission, PermState>>; installed: number }

const root = () => path.join(app.getPath('userData'), 'extensions');
const stateFile = () => path.join(root(), 'extensions.json');
let state: Record<string, Stored> | null = null;
let deps: { searchFiles: (q: string, n: number) => FileEntry[]; broadcast: (ch: string) => void } = { searchFiles: () => [], broadcast: () => undefined };

async function load(): Promise<Record<string, Stored>> {
  if (!state) state = await fsp.readFile(stateFile(), 'utf8').then((t) => JSON.parse(t) as Record<string, Stored>).catch(() => ({}));
  return state;
}
async function save() {
  await fsp.mkdir(root(), { recursive: true });
  await fsp.writeFile(stateFile(), JSON.stringify(state, null, 1));
  deps.broadcast('extensions-changed');
}

const need = () => { if (!featureOn('extensions')) throw new Error('Extensions are switched off (Settings → Features)'); };

const view = (s: Stored): InstalledExtension => ({ ...s.manifest, checksum: s.checksum, enabled: s.enabled, perms: s.perms, lines: permissionLines(s.manifest), installed: s.installed });

/** Reads a folder: its manifest and its files (no links, no subfolders deeper than one, at most 2 MB). */
async function readFolder(dir: string): Promise<{ manifest: ExtManifest; files: { name: string; data: Buffer }[]; checksum: string }> {
  const manifest = parseManifest(await fsp.readFile(path.join(dir, 'manifest.json'), 'utf8').catch(() => { throw new Error('That folder has no manifest.json.'); }));
  const files: { name: string; data: Buffer }[] = [];
  let total = 0;
  for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
    if (!e.isFile() || e.name.startsWith('.')) continue;
    const data = await fsp.readFile(path.join(dir, e.name));
    total += data.length;
    if (total > MAX_EXTENSION_BYTES) throw new Error('That extension is larger than 2 MB.');
    files.push({ name: e.name, data });
  }
  if (!files.some((f) => f.name === manifest.main)) throw new Error(`The script ${manifest.main} is missing.`);
  return { manifest, files, checksum: folderChecksum(files) };
}

export const extensionsApi: ExtensionsApi = {
  async list() {
    return Object.values(await load()).map(view).sort((a, b) => a.name.localeCompare(b.name));
  },
  async pick() {
    need();
    const w = BrowserWindow.getFocusedWindow() ?? undefined;
    const opts = { title: 'Choose an extension’s folder', properties: ['openDirectory' as const] };
    const r = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts);
    return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
  },
  async preview(dir: string) {
    need();
    const { manifest, checksum } = await readFolder(dir);
    return { ...manifest, checksum, lines: permissionLines(manifest), replaces: !!(await load())[manifest.id] };
  },
  async install(dir: string, expected?: string) {
    need();
    const { manifest, files, checksum } = await readFolder(dir);
    if (expected && expected.toLowerCase() !== checksum) throw new Error('The extension is not the one you were given: its fingerprint is different.');
    const dest = path.join(root(), manifest.id);
    await fsp.rm(dest, { recursive: true, force: true });
    await fsp.mkdir(dest, { recursive: true });
    for (const f of files) await fsp.writeFile(path.join(dest, f.name), f.data);
    const st = await load();
    // Permissions start at Ask; an update keeps what you chose for ones it still asks for.
    const before = st[manifest.id]?.perms ?? {};
    st[manifest.id] = { manifest, checksum, enabled: true, perms: Object.fromEntries(manifest.permissions.map((p) => [p, before[p] ?? 'ask'])), installed: Date.now() };
    await save();
    return view(st[manifest.id]);
  },
  async remove(id: string) {
    const st = await load();
    delete st[id];
    await fsp.rm(path.join(root(), id.replace(/[^a-z0-9.-]/g, '')), { recursive: true, force: true });
    await save();
  },
  async setEnabled(id: string, on: boolean) {
    const st = await load();
    if (st[id]) st[id].enabled = on;
    await save();
  },
  async setPermission(id: string, p: ExtPermission, v: PermState) {
    const st = await load();
    if (!st[id]?.manifest.permissions.includes(p)) throw new Error('It does not ask for that');
    st[id].perms[p] = v;
    await save();
  },
  async worker(id: string) {
    need();
    const s = (await load())[id];
    if (!s?.enabled) throw new Error('That extension is not on');
    const dir = path.join(root(), id);
    const files = [];
    for (const e of await fsp.readdir(dir)) files.push({ name: e, data: await fsp.readFile(path.join(dir, e)) });
    // Changed on disk since it was installed: refuse to run it.
    if (folderChecksum(files) !== s.checksum) throw new Error(`${s.manifest.name} was changed after it was installed. Install it again.`);
    return workerUrl(files.find((f) => f.name === s.manifest.main)!.data.toString('utf8'), { id });
  },
  async search(id: string, query: string) {
    need();
    const s = (await load())[id];
    if (s?.perms.search === 'off' || !s?.manifest.permissions.includes('search')) throw new Error('Not allowed');
    return deps.searchFiles(String(query).slice(0, 200), 20).map((f) => f.name);
  },
  async fetch(id: string, url: string) {
    need();
    const s = (await load())[id];
    if (!s || s.perms.network === 'off' || !s.manifest.permissions.includes('network') || !hostAllowed(s.manifest, url)) throw new Error('That site is not one this extension may reach');
    const r = await fetch(url, { redirect: 'error' });
    const text = (await r.text()).slice(0, 1_000_000);
    return { status: r.status, text };
  },
};

export function startExtensions(d: typeof deps) {
  deps = d;
}
