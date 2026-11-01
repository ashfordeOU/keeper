// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Runs Keeper notes plugins in a Web Worker: no Node, no DOM, no network
// (the worker's fetch, XHR, WebSocket and importScripts are removed before
// the plugin loads). The plugin reaches the vault only through `keeper.*`
// calls that the host checks against the permissions the person granted.

import { allowed, type PluginManifest, type PluginPermission } from '../../core/notes/plugins';

export interface PluginCommand { plugin: string; id: string; name: string }

export interface PluginBridge {
  list(): Promise<string[]>;
  read(path: string): Promise<string>;
  write(path: string, text: string): Promise<void>;
  create(path: string, text: string): Promise<void>;
  search(q: string): Promise<string[]>;
  notice(text: string): void;
  getSelection(): string;
  replaceSelection(text: string): void;
}

const PRELUDE = `
'use strict';
for (const k of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'indexedDB', 'caches', 'BroadcastChannel']) { try { self[k] = undefined; } catch {} }
let seq = 0; const waiting = new Map(); const commands = new Map();
const call = (method, ...args) => new Promise((res, rej) => { const id = ++seq; waiting.set(id, { res, rej }); postMessage({ t: 'call', id, method, args }); });
self.keeper = {
  vault: { list: () => call('vault.list'), read: (p) => call('vault.read', p), write: (p, t) => call('vault.write', p, t), create: (p, t) => call('vault.create', p, t), search: (q) => call('vault.search', q) },
  editor: { getSelection: () => call('editor.getSelection'), replaceSelection: (t) => call('editor.replaceSelection', t) },
  ui: { notice: (t) => call('ui.notice', t) },
  commands: { add: (id, name, run) => { commands.set(id, run); return call('commands.add', id, name); } },
};
onmessage = async (e) => {
  const m = e.data;
  if (m.t === 'reply') { const w = waiting.get(m.id); waiting.delete(m.id); if (!w) return; m.error ? w.rej(new Error(m.error)) : w.res(m.value); }
  if (m.t === 'run') { try { await commands.get(m.id)?.(); } catch (err) { postMessage({ t: 'error', error: String(err && err.message || err) }); } }
};
`;

export class PluginHost {
  private worker: Worker;
  readonly commands: PluginCommand[] = [];
  constructor(readonly manifest: PluginManifest, code: string, private granted: PluginPermission[], private bridge: PluginBridge, private onCommands: () => void, private onError: (e: string) => void) {
    // The plugin's code goes in the same script, after the lock-down (no eval needed).
    const body = `${PRELUDE}\n;(async () => {\n${code}\n})().catch((err) => postMessage({ t: 'error', error: String(err && err.message || err) }));\n`;
    const url = URL.createObjectURL(new Blob([body], { type: 'text/javascript' }));
    this.worker = new Worker(url);
    URL.revokeObjectURL(url);
    this.worker.onmessage = (e) => void this.handle(e.data as { t: string; id: number; method: string; args: unknown[]; error?: string });
  }

  run(id: string) { this.worker.postMessage({ t: 'run', id }); }
  stop() { this.worker.terminate(); }

  private async handle(m: { t: string; id: number; method: string; args: unknown[]; error?: string }) {
    if (m.t === 'error') { this.onError(`${this.manifest.name}: ${m.error}`); return; }
    if (m.t !== 'call') return;
    const reply = (value?: unknown, error?: string) => this.worker.postMessage({ t: 'reply', id: m.id, value, error });
    if (!allowed(m.method, this.manifest, this.granted)) return reply(undefined, `${m.method} is not allowed for this plugin`);
    const a = m.args as string[];
    try {
      switch (m.method) {
        case 'vault.list': return reply(await this.bridge.list());
        case 'vault.read': return reply(await this.bridge.read(a[0]));
        case 'vault.write': return reply(await this.bridge.write(a[0], a[1]));
        case 'vault.create': return reply(await this.bridge.create(a[0], a[1]));
        case 'vault.search': return reply(await this.bridge.search(a[0]));
        case 'ui.notice': this.bridge.notice(String(a[0]).slice(0, 300)); return reply();
        case 'editor.getSelection': return reply(this.bridge.getSelection());
        case 'editor.replaceSelection': this.bridge.replaceSelection(String(a[0])); return reply();
        case 'commands.add':
          this.commands.push({ plugin: this.manifest.id, id: a[0], name: `${this.manifest.name}: ${a[1]}` });
          this.onCommands();
          return reply();
      }
      return reply(undefined, 'Unknown call');
    } catch (e) {
      return reply(undefined, (e as Error).message);
    }
  }
}
