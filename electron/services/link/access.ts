// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Remote access between your own devices, for the window: help mode, fleet
// notes, remote actions, terminals on other devices, the audit log and the
// unattended service. Feature switches: remoteHelp, remoteCommands,
// remoteTerminal, unattendedAccess, linkDirect (core/features.ts).

import { app, dialog, Notification } from 'electron';
import crypto from 'node:crypto';
import { promises as fsp } from 'node:fs';
import type { CommandAsk } from '../../../core/api-access';
import { auditCsv, auditJson, filterAudit, type AuditFilter } from '../../../core/link/audit';
import type { DeviceMeta } from '../../../core/link/fleet';
import { identityToJson } from '../../../core/link/identity';
import { featureOn, onFeature } from '../features';
import { setUnattended, unattendedStatus } from '../screen/unattended';
import { installLocation } from './location';
import type { LinkNode } from './node';
import { installCompanionTerminal, installOps, remoteExec, remoteInfo, remotePower, remotePrint, remoteTerminal, type PtyLike } from './ops';

type Broadcast = (channel: string, ...args: unknown[]) => void;

interface ScreenLike {
  view(device: string, opts?: { control?: boolean; tab?: boolean }): Promise<string>;
  stop(sid: string): void;
  state(): { policy: { unattended: Record<string, boolean> }; sessions: { id: string; peerName: string; role: 'host' | 'viewer'; control: boolean; state: string; help?: boolean }[] };
}

let node: LinkNode | null = null;
let broadcast: Broadcast = () => undefined;
let show: (route?: string) => void = () => undefined;
let screenSvc: ScreenLike | null = null;
const asks = new Map<string, CommandAsk & { resolve: (ok: boolean) => void }>();
const terms = new Map<string, { write(s: string): void; resize(c: number, r: number): void; close(): void }>();

export function setScreenService(s: ScreenLike) {
  screenSvc = s;
}

export function screenService(): ScreenLike | null {
  return screenSvc;
}

function need(): LinkNode {
  if (!node) throw new Error('Keeper Link is starting');
  return node;
}

function needFeature(id: string, label: string) {
  if (!featureOn(id)) throw new Error(`${label} is switched off in Settings → Features`);
}

/** node-pty in the main process (built for Electron); null when it cannot load. */
function ptyFactory(): ((shell: string, args: string[], cols: number, rows: number, cwd: string) => PtyLike | null) | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pty = require('node-pty') as typeof import('node-pty');
    return (shell, args, cols, rows, cwd) => {
      try {
        const p = pty.spawn(shell, args, { name: 'xterm-256color', cols, rows, cwd, env: process.env as Record<string, string> });
        return { onData: (fn) => void p.onData(fn), onExit: (fn) => void p.onExit(fn), write: (d) => p.write(d), resize: (c, r) => p.resize(c, r), kill: () => p.kill() };
      } catch {
        return null;
      }
    };
  } catch {
    return undefined;
  }
}

export function startAccess(n: LinkNode, deps: { broadcast: Broadcast; show: (route?: string) => void; version: string }) {
  node = n;
  broadcast = deps.broadcast;
  show = deps.show;
  installOps(n, {
    version: deps.version,
    pty: ptyFactory(),
    notify: (title, body) => Notification.isSupported() && new Notification({ title, body }).show(),
    approveCommand: (who, command) => {
      // Off in Features: refused without asking.
      if (!featureOn('remoteCommands')) return Promise.resolve(false);
      const id = crypto.randomUUID();
      return new Promise<boolean>((resolve) => {
        const t = setTimeout(() => {
          asks.delete(id);
          resolve(false);
        }, 2 * 60_000);
        asks.set(id, { id, device: '', deviceName: who, command, resolve: (ok) => { clearTimeout(t); asks.delete(id); resolve(ok); } });
        broadcast('access-command', { id, deviceName: who, command });
        show('devices');
        if (Notification.isSupported()) new Notification({ title: `${who} wants to run a command here`, body: command.slice(0, 120) }).show();
      });
    },
  });
  installLocation(n);
  installCompanionTerminal(n, { pty: ptyFactory(), enabled: () => featureOn('remoteTerminal') });
  // For `keeper remote …` on this computer.
  n.registerControl('remote.exec', async (p) => {
    if (!featureOn('remoteCommands')) throw new Error('Run commands is switched off in Settings → Features');
    return remoteExec(n, String(p.device), String(p.command ?? ''), Number(p.timeoutMs) || 60_000);
  });
  n.registerControl('remote.info', async (p) => remoteInfo(n, String(p.device)));
  n.registerControl('remote.power', async (p) => remotePower(n, String(p.device), String(p.action) as 'lock' | 'sleep' | 'restart'));
  n.registerControl('remote.audit', async (p) => n.auditLog({ device: p.device ? String(p.device) : undefined }).slice(0, Number(p.limit) || 50));
  n.registerControl('remote.helpStatus', async () => n.help.status());
  // Turning a feature off stops what it runs.
  onFeature('remoteHelp', (on) => !on && n.help.stop('Help mode was switched off'));
  onFeature('remoteTerminal', (on) => {
    if (on) return;
    for (const t of terms.values()) t.close();
    terms.clear();
  });
}

export const access = {
  async helpStart() {
    needFeature('remoteHelp', 'Help mode');
    return need().help.start();
  },
  async helpStop() {
    need().help.stop('You ended help');
  },
  helpStatus: () => need().help.status(),
  async helpJoin(code: string, password: string, opts: { tab?: boolean } = {}) {
    needFeature('remoteHelp', 'Help mode');
    const g = await need().help.join(code, password, need().state().me.name);
    if (!screenSvc) throw new Error('Remote screens are starting');
    return { sid: await screenSvc.view(g.id, { control: false, tab: opts.tab }), name: g.name };
  },
  setMeta: async (device: string, meta: Partial<DeviceMeta>) => need().setMeta(device, meta),
  audit: async (f: AuditFilter = {}) => need().auditLog(f).slice(0, 1000),
  async exportAudit(format: 'csv' | 'json', device?: string) {
    const list = filterAudit(need().auditLog({}), { device });
    const r = await dialog.showSaveDialog({ title: 'Export the audit log', defaultPath: `${app.getPath('documents')}/Keeper audit ${new Date().toISOString().slice(0, 10)}.${format}`, filters: [{ name: format.toUpperCase(), extensions: [format] }] });
    if (r.canceled || !r.filePath) return null;
    await fsp.writeFile(r.filePath, format === 'csv' ? auditCsv(list) : auditJson(list));
    return r.filePath;
  },
  async exec(device: string, command: string) {
    needFeature('remoteCommands', 'Run commands');
    return remoteExec(need(), device, command);
  },
  power: (device: string, action: 'lock' | 'sleep' | 'restart') => remotePower(need(), device, action),
  info: (device: string) => remoteInfo(need(), device),
  async print(device: string, file?: string) {
    let f = file;
    if (!f) {
      const r = await dialog.showOpenDialog({ title: 'Print on the other device', properties: ['openFile'] });
      if (r.canceled || !r.filePaths[0]) return;
      f = r.filePaths[0];
    }
    await remotePrint(need(), device, f);
  },
  async termOpen(device: string, cols: number, rows: number) {
    needFeature('remoteTerminal', 'Terminals on other devices');
    const id = crypto.randomUUID();
    const dec = new TextDecoder();
    const t = await remoteTerminal(need(), device, cols, rows, (d) => broadcast('access-term', id, dec.decode(d, { stream: true })), (code, reason) => {
      terms.delete(id);
      broadcast('access-term-exit', id, reason ?? (code === null ? 'Closed' : `Exited (${code})`));
    });
    terms.set(id, t);
    return id;
  },
  termWrite: async (id: string, data: string) => terms.get(id)?.write(data),
  termResize: async (id: string, cols: number, rows: number) => terms.get(id)?.resize(cols, rows),
  async termClose(id: string) {
    terms.get(id)?.close();
    terms.delete(id);
  },
  pendingCommands: async () => [...asks.values()].map(({ resolve: _r, ...a }) => a),
  answerCommand: async (id: string, ok: boolean) => asks.get(id)?.resolve(ok),
  async unattended() {
    const n = need();
    return unattendedStatus(n.state().devices, screenSvc?.state().policy.unattended ?? {});
  },
  async setUnattended(on: boolean) {
    if (on) needFeature('unattendedAccess', 'Unattended access');
    const n = need();
    await setUnattended(on, { identity: () => identityToJson(n.me) }, n.state().devices, screenSvc?.state().policy.unattended ?? {});
    n.audit({ kind: 'unattended', direction: 'in', deviceName: n.data.name, title: on ? 'Unattended access turned on' : 'Unattended access turned off', ok: true });
    return access.unattended();
  },
  directStats: async () => ({ ...need().direct.stats, openSockets: need().direct.openSockets }),
};
