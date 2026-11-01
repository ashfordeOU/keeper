// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// IPC and `keeper rdc …` for Remote Desktops.

import { app, ipcMain } from 'electron';
import type { Connection } from '../../core/rdc/types';
import type { Format } from '../../core/rdc/formats';
import type { HostId } from '../../core/rdc/hosting';
import { registerFindings } from '../services/guide';
import { featureOn } from '../services/features';
import { hostingFindings } from '../../core/rdc/hosting';
import { registerKeeperMethod } from '../services/brain';
import * as rdc from '../services/rdc';
import * as places from '../services/rdc/places';

function handle(name: string, fn: (...args: never[]) => unknown) {
  ipcMain.handle(name, async (_e, ...args) => fn(...(args as never[])));
}

export function registerRdcIpc(d: { broadcast: (channel: string, ...args: unknown[]) => void; preload: string; showMain: (route?: string) => void; openTab: (route: { name: string; arg?: string; q?: string }, ownWindow: boolean) => void }) {
  rdc.initRdc(d);
  // The saved list is read once in the background so the tray menu can show it without waiting.
  rdc.preload();
  void places.initPlaces({
    preload: d.preload,
    showMain: d.showMain,
    openTab: d.openTab,
    connect: (t, o) => rdc.connect(t, o),
    disconnect: (sid) => rdc.disconnect(sid),
    list: () => rdc.state(),
    snapshot: () => rdc.snapshot(),
    importConn: (c, secret) => rdc.importConn(c, secret),
  });
  handle('rdc.places', () => places.currentPlaces());
  handle('rdc.setPlaces', (p: never) => places.setPlaces(p));
  handle('rdc.trayPreview', () => places.trayPreview());
  handle('rdc.showQuick', () => places.showQuick());
  handle('rdc.closeQuick', () => places.closeQuick());
  handle('rdc.openRoute', (r: never) => places.openResult({ route: r }));
  handle('rdc.openFile', (f: string) => places.openConnectionFile(f));
  handle('rdc.state', () => rdc.state());
  handle('rdc.save', (c: never) => rdc.save(c));
  handle('rdc.remove', (ids: string[]) => rdc.remove(ids));
  handle('rdc.duplicate', (id: string) => rdc.duplicate(id));
  handle('rdc.setPassword', (id: string, pw: string | null) => rdc.setPassword(id, pw));
  handle('rdc.quick', (text: string) => rdc.quick(String(text ?? '')));
  handle('rdc.probe', (host: string, ports?: number[]) => rdc.probe(host, ports));
  ipcMain.handle('rdc.connect', (e, target: string | Connection, opts?: { password?: string; external?: boolean; trustKey?: string; trustCert?: string }) => rdc.connect(target, { ...(opts ?? {}), viewer: e.sender }));
  handle('rdc.disconnect', (sid: string) => rdc.disconnect(sid));
  handle('rdc.command', (t: string | Connection) => rdc.command(t));
  ipcMain.handle('rdc.vncAttach', (e, sid: string) => rdc.vncAttach(sid, e.sender));
  ipcMain.on('rdc.vncDetach', (e, sid: string) => rdc.vnc.detach(sid, e.sender));
  ipcMain.on('rdc.vncInput', (_e, sid: string, events: unknown) => { rdc.vnc.input(sid, events as never); });
  ipcMain.on('rdc.vncAck', (_e, sid: string, seq: number) => rdc.vnc.ack(sid, seq));
  handle('rdc.vncClipboard', (sid: string, text: string) => rdc.vnc.clipboard(sid, text));
  handle('rdc.vncKeys', (sid: string, combo: string) => rdc.vnc.keys(sid, combo));
  handle('rdc.vncSetViewOnly', (sid: string, on: boolean) => rdc.vnc.setViewOnly(sid, on));
  ipcMain.handle('rdc.webShow', (e, sid: string, rect: { x: number; y: number; width: number; height: number } | null) => rdc.web.show(sid, e.sender, rect));
  handle('rdc.webAction', (sid: string, a: never) => rdc.web.action(sid, a));
  ipcMain.handle('rdc.watch', (e, on: boolean) => rdc.watch(e.sender, !!on));
  handle('rdc.wake', (id: string) => rdc.wake(id));
  handle('rdc.importFile', (p?: string) => rdc.importFile(p));
  handle('rdc.importText', (text: string, f?: Format, name?: string) => rdc.importTextIn(text, f, name));
  handle('rdc.exportTo', (ids: string[], f: Format) => rdc.exportTo(ids, f));
  handle('rdc.exportText', (ids: string[], f: Format) => rdc.exportTextOut(ids, f));
  handle('rdc.engines', (refresh?: boolean) => rdc.engines(refresh));
  handle('rdc.hostStatus', () => rdc.hosting.status());
  handle('rdc.hostSet', (id: HostId, on: boolean, o?: never) => rdc.hosting.set(id, on, o));
  handle('rdc.hostFix', (c: 'nla' | 'lockout') => rdc.hosting.fix(c));
  handle('rdc.hostViaLink', (dev: string, on: boolean) => rdc.hosting.viaLink(dev, on));

  // The security checklist feeds the To do list, only while hosting is switched on.
  registerFindings('rdc-hosting', async () => (featureOn('rdcHosting') ? hostingFindings((await rdc.hosting.status()).checks) : []));

  // keeper rdc list | connect | add | import | export | probe | host … | forward
  registerKeeperMethod('keeper/rdc', async (p) => {
    const cmd = String(p.cmd ?? 'list');
    const a = (p.args as Record<string, unknown> | undefined) ?? {};
    switch (cmd) {
      case 'list': return (await rdc.state()).connections;
      case 'sessions': return (await rdc.state()).sessions;
      case 'connect': {
        const r = await rdc.connect(String(a.target), { external: !!a.external, password: typeof a.password === 'string' ? a.password : undefined, trustKey: typeof a.trustKey === 'string' ? a.trustKey : undefined });
        if (r.route) places.openResult(r);
        return r;
      }
      case 'add': {
        const q = await rdc.quick(String(a.uri));
        if (!q.conn) throw new Error(q.message ?? 'Not a connection');
        const { id: _i, created: _c, ...rest } = q.conn;
        return rdc.save({ ...rest, name: typeof a.name === 'string' ? a.name : rest.name, folder: typeof a.folder === 'string' ? a.folder : undefined });
      }
      case 'import': return a.text ? rdc.importTextIn(String(a.text), undefined, String(a.name ?? '')) : rdc.importFile(String(a.path));
      case 'export': return rdc.exportTextOut((a.ids as string[]) ?? [], (a.format as Format) ?? 'json');
      case 'probe': return rdc.probe(String(a.host), a.ports as number[] | undefined);
      case 'command': return rdc.command(String(a.target));
      case 'host-status': return rdc.hosting.status();
      case 'host-set': return rdc.hosting.set(a.id as HostId, !!a.on, { password: typeof a.password === 'string' ? a.password : undefined, localOnly: a.localOnly !== false });
      case 'host-link': return rdc.hosting.viaLink(String(a.device), a.on !== false);
      case 'forward': {
        const st = await rdc.state();
        const { findConnection } = await import('../../core/rdc/list');
        const c = findConnection(st.connections, String(a.name));
        if (!c) throw new Error(`No connection called “${a.name}”`);
        const { link } = await import('../services/link');
        const ls = await link.state();
        const dev = ls.devices.find((x) => x.id === a.device || x.name.toLowerCase() === String(a.device).toLowerCase());
        if (!dev) throw new Error(`No paired device called “${a.device}”`);
        const { freePort } = await import('../services/rdc/gateway');
        const { portOf } = await import('../../core/rdc/clients');
        const localPort = typeof a.localPort === 'number' ? a.localPort : await freePort();
        const f = await link.addForward({ device: dev.id, kind: 'port', localPort, host: c.host, port: portOf(c) });
        if (f.error) throw new Error(f.error);
        return { localPort: f.localPort, device: dev.name, host: c.host, port: portOf(c) };
      }
      default: throw new Error('Commands: list, connect, add, import, export, probe, host, forward');
    }
  });

  app.on('before-quit', () => rdc.stopRdc());
}
