// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Extensions: small add-ons that bring commands to the command palette. Each
// one is a folder with manifest.json and one script. It runs in a sandboxed
// frame with no Node, no require and no network of its own, and talks to Keeper
// only by messages; each thing it may do is a permission shown in plain words
// before it is installed, and set to Off, Ask or Allow (the same three choices
// as AI agents' permissions). Keeper checks every message against them.

import { createHash } from 'node:crypto';

/** Surfaces an extension can add to. v1 runs commands; the others are named so a manifest can be refused plainly. */
export const SURFACES = ['commands', 'today-cards', 'island-cards', 'automation-steps', 'notes-renderers'] as const;
export type Surface = (typeof SURFACES)[number];
export const SUPPORTED_SURFACES: Surface[] = ['commands'];

/** What an extension can ask Keeper to do. */
export type ExtPermission = 'notify' | 'search' | 'clipboard' | 'inbox' | 'network';
export type PermState = 'off' | 'ask' | 'allow';

export const PERMISSION_WORDS: Record<ExtPermission, string> = {
  notify: 'Show you short messages',
  search: 'See the names of files that match its searches',
  clipboard: 'Put text on your clipboard',
  inbox: 'Add things to your Inbox',
  network: 'Reach these sites',
};

export interface ExtManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  surfaces: Surface[];
  /** the script, relative to the folder (default main.js) */
  main: string;
  commands: { id: string; title: string }[];
  permissions: ExtPermission[];
  /** sites for the network permission (host names, no paths) */
  hosts: string[];
}

export const MAX_EXTENSION_BYTES = 2 * 1024 * 1024;

/** Reads and checks a manifest; throws one plain message for the first problem. */
export function parseManifest(text: string): ExtManifest {
  let m: Record<string, unknown>;
  try { m = JSON.parse(text); } catch { throw new Error('manifest.json is not valid JSON.'); }
  if (!m || typeof m !== 'object') throw new Error('manifest.json is empty.');
  const id = String(m.id ?? '');
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(id) || id.length > 80) throw new Error('The id must look like "example.word-count" (small letters, numbers, dots and dashes).');
  const name = String(m.name ?? '').trim();
  if (!name || name.length > 60) throw new Error('Give the extension a name of 60 characters or fewer.');
  const version = String(m.version ?? '');
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('The version must look like 1.0.0.');
  const surfaces = Array.isArray(m.surfaces) ? m.surfaces.map(String) : [];
  if (!surfaces.length) throw new Error('Say where the extension appears (surfaces), for example ["commands"].');
  for (const s of surfaces) {
    if (!(SURFACES as readonly string[]).includes(s)) throw new Error(`"${s}" is not a place an extension can appear.`);
    if (!SUPPORTED_SURFACES.includes(s as Surface)) throw new Error(`This Keeper runs commands only; "${s}" comes in a later version.`);
  }
  const main = String(m.main ?? 'main.js');
  if (!/^[\w-]+\.js$/.test(main)) throw new Error('main must be a script in the extension’s own folder, such as main.js.');
  const commands = (Array.isArray(m.commands) ? m.commands : []).map((c: unknown) => {
    const x = (c ?? {}) as Record<string, unknown>;
    const cid = String(x.id ?? '');
    const title = String(x.title ?? '').trim();
    if (!/^[a-z0-9-]{1,40}$/.test(cid) || !title || title.length > 60) throw new Error('Each command needs an id (small letters, numbers, dashes) and a short title.');
    return { id: cid, title };
  });
  if (surfaces.includes('commands') && !commands.length) throw new Error('List at least one command.');
  const permissions = [...new Set((Array.isArray(m.permissions) ? m.permissions : []).map(String))];
  for (const p of permissions) if (!(p in PERMISSION_WORDS)) throw new Error(`"${p}" is not a permission Keeper knows.`);
  const hosts = [...new Set((Array.isArray(m.hosts) ? m.hosts : []).map((h: unknown) => String(h).toLowerCase()))];
  for (const h of hosts) if (!/^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h)) throw new Error(`"${h}" is not a site name (use example.com or *.example.com).`);
  if (permissions.includes('network') && !hosts.length) throw new Error('The network permission needs the sites it reaches (hosts).');
  if (hosts.length && !permissions.includes('network')) throw new Error('hosts are only used with the network permission.');
  return {
    id, name, version, surfaces: surfaces as Surface[], main, commands, permissions: permissions as ExtPermission[], hosts,
    ...(m.description ? { description: String(m.description).slice(0, 300) } : {}),
    ...(m.author ? { author: String(m.author).slice(0, 80) } : {}),
  };
}

/** Each permission in plain words, for the sheet shown before installing. */
export function permissionLines(m: ExtManifest): { id: ExtPermission; text: string }[] {
  return m.permissions.map((p) => ({ id: p, text: p === 'network' ? `${PERMISSION_WORDS.network}: ${m.hosts.join(', ')}` : PERMISSION_WORDS[p] }));
}

/** One fingerprint for the whole folder: each file's name and contents, in name order. */
export function folderChecksum(files: { name: string; data: Buffer }[]): string {
  const h = createHash('sha256');
  for (const f of [...files].sort((a, b) => a.name.localeCompare(b.name))) h.update(`${f.name}\0${f.data.length}\0`).update(f.data);
  return h.digest('hex');
}

/** Whether a site is one the extension listed (exact, or under a *.domain). */
export function hostAllowed(m: Pick<ExtManifest, 'hosts'>, url: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  const h = u.hostname.toLowerCase();
  return m.hosts.some((x) => (x.startsWith('*.') ? h === x.slice(2) || h.endsWith(x.slice(1)) : h === x));
}

/** What a message from an extension may do now. */
export function decide(m: Pick<ExtManifest, 'permissions'>, states: Partial<Record<ExtPermission, PermState>>, p: ExtPermission): PermState {
  if (!m.permissions.includes(p)) return 'off';
  return states[p] ?? 'ask';
}

/** The messages an extension may send, and the permission each needs. */
export const CALLS: Record<string, ExtPermission> = { notify: 'notify', search: 'search', 'clipboard.write': 'clipboard', 'inbox.add': 'inbox', fetch: 'network' };

/**
 * The script an extension runs in: a worker made from a data: address, so it
 * has an origin of its own (none of Keeper's storage), no window, no Node and
 * no network (the window's content policy allows none). A tiny `keeper` object
 * only posts messages; then the extension's own script.
 */
export function workerScript(script: string, ext: { id: string }): string {
  return `(() => {
  let seq = 0; const waiting = new Map(); const handlers = new Map();
  const call = (method, args) => new Promise((resolve, reject) => { const id = ++seq; waiting.set(id, { resolve, reject }); postMessage({ keeperExt: ${JSON.stringify(ext.id)}, id, method, args }); });
  addEventListener('message', async (e) => {
    const m = e.data || {};
    if (m.reply && waiting.has(m.reply)) { const w = waiting.get(m.reply); waiting.delete(m.reply); m.error ? w.reject(new Error(m.error)) : w.resolve(m.result); return; }
    if (m.command !== undefined) {
      const fn = handlers.get(m.command);
      try { if (!fn) throw new Error('No such command'); await fn(); postMessage({ keeperExt: ${JSON.stringify(ext.id)}, done: m.command }); }
      catch (err) { postMessage({ keeperExt: ${JSON.stringify(ext.id)}, done: m.command, error: String((err && err.message) || err) }); }
    }
  });
  self.keeper = Object.freeze({
    onCommand: (id, fn) => handlers.set(String(id), fn),
    notify: (text) => call('notify', { text: String(text) }),
    search: (query) => call('search', { query: String(query) }),
    copy: (text) => call('clipboard.write', { text: String(text) }),
    catch: (text) => call('inbox.add', { text: String(text) }),
    fetch: (url) => call('fetch', { url: String(url) }),
  });
})();
${script}
`;
}

/** The worker's address: the script as a data: URL (an origin of its own). */
export function workerUrl(script: string, ext: { id: string }): string {
  return `data:text/javascript;base64,${Buffer.from(workerScript(script, ext)).toString('base64')}`;
}
