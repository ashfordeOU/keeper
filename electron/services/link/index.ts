// SPDX-License-Identifier: AGPL-3.0-or-later
// Keeper Link inside the app: keeps the device node and the tunnel running,
// stores their data in Keeper's folder (keys in the system keychain when
// there is one), and turns their questions into prompts in the window.

import { app, dialog, Notification, powerMonitor } from 'electron';
import crypto from 'node:crypto';
import { existsSync, promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import QRCode from 'qrcode';
import type { CompanionInvite, FileOffer, LinkSettings, LinkState, PairPrompt, TunnelStatus } from '../../../core/api-link';
import type { TunnelConfig, TunnelMode } from '../../../core/link/cloudflared';
import type { PermissionSet } from '../../../core/link/perms';
import { getSecret, setSecret } from '../../store';
import { readText, writeText } from '../clip';
import { TunnelSupervisor } from './cloudflared';
import { LinkNode, type LinkData } from './node';

type Broadcast = (channel: string, ...args: unknown[]) => void;

let node: LinkNode | null = null;
let tunnel: TunnelSupervisor | null = null;
let tunnelConfig: TunnelConfig = { mode: 'off' };
let broadcast: Broadcast = () => undefined;
let showWindow: (route?: string) => void = () => undefined;
let changedTimer: NodeJS.Timeout | undefined;
const companionAsks = new Map<string, (ok: boolean) => void>();
const pendingOffers = new Map<string, FileOffer>();
const pendingPairs = new Map<string, PairPrompt>();

const dir = () => path.join(app.getPath('userData'), 'link');
const dataFile = () => path.join(dir(), 'link.json');
const tunnelFile = () => path.join(dir(), 'tunnel.json');
/** where the keeper command finds this app's local control address and token */
const controlFile = () => path.join(dir(), 'control.json');
const controlToken = crypto.randomBytes(24).toString('base64url');

async function writeJson(file: string, value: unknown) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  await fsp.rename(tmp, file);
}

let writing: Promise<void> = Promise.resolve();
const save = (d: LinkData) => (writing = writing.then(() => writeJson(dataFile(), d)).catch(() => undefined));

function changed() {
  clearTimeout(changedTimer);
  changedTimer = setTimeout(() => broadcast('link-changed'), 80);
}

function notify(title: string, body: string, route = 'devices') {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body });
  n.on('click', () => showWindow(route));
  n.show();
}

export function linkNode(): LinkNode | null {
  return node;
}

export async function startLink(deps: { broadcast: Broadcast; show: (route?: string) => void }) {
  broadcast = deps.broadcast;
  showWindow = deps.show;
  tunnelConfig = await fsp.readFile(tunnelFile(), 'utf8').then((t) => JSON.parse(t) as TunnelConfig).catch(() => ({ mode: 'off' as TunnelMode }));
  node = new LinkNode(
    {
      load: () => fsp.readFile(dataFile(), 'utf8').then((t) => JSON.parse(t) as LinkData).catch(() => null),
      save,
      getSecret,
      setSecret,
      changed,
      transfer: (p) => broadcast('link-transfer', p),
      pairPrompt: (p) => {
        pendingPairs.set(p.id, p);
        broadcast('link-pair', p);
        showWindow('devices');
      },
      offer: (o) => {
        pendingOffers.set(o.id, o);
        broadcast('link-offer', o);
        notify(`${o.fromName} wants to send you ${o.name}`, 'Open Keeper to accept or decline.');
      },
      approveCompanion: (name) =>
        new Promise<boolean>((resolve) => {
          const id = Math.random().toString(36).slice(2);
          const t = setTimeout(() => {
            companionAsks.delete(id);
            resolve(false);
          }, 2 * 60_000);
          companionAsks.set(id, (ok) => {
            clearTimeout(t);
            companionAsks.delete(id);
            resolve(ok);
          });
          broadcast('link-companion', { id, name });
          showWindow('devices');
        }),
      notify: (t, b) => notify(t, b),
      clipboard: { read: readText, write: writeText },
      downloads: () => {
        // Without an XDG download folder set, Linux reports the home folder itself.
        const d = app.getPath('downloads');
        return d === os.homedir() && existsSync(path.join(d, 'Downloads')) ? path.join(d, 'Downloads') : d;
      },
      companionDir: () => path.join(__dirname, 'companion'),
      qr: (t) => QRCode.toDataURL(t, { margin: 1, width: 360 }),
      tunnel: () => tunnel?.status,
    },
    { hostname: os.hostname(), os: process.platform, controlToken },
  );
  await node.start();
  if (node.port) await writeJson(controlFile(), { port: node.port, token: controlToken, pid: process.pid }).catch(() => undefined);
  tunnel = new TunnelSupervisor({
    binDir: path.join(dir(), 'bin'),
    binPath: process.env.KEEPER_CLOUDFLARED || undefined,
    port: () => node?.port ?? 0,
    token: () => getSecret('link.tunnelToken'),
    onStatus: () => changed(),
    onUrl: (u) => node?.setTunnelUrl(u),
  });
  if (tunnelConfig.mode !== 'off' && node.data.settings.mode === 'internet' && !node.data.settings.localOnly) void tunnel.start(tunnelConfig);
  // After sleep the network may be different: look again.
  powerMonitor.on('resume', () => {
    tunnel?.kick();
    node?.scheduleNote(3000);
  });
}

export async function stopLink() {
  await fsp.rm(controlFile(), { force: true }).catch(() => undefined);
  await tunnel?.stop();
  await node?.stop();
}

function need(): LinkNode {
  if (!node) throw new Error('Keeper Link is starting');
  return node;
}

// ---------------------------------------------------------------- for the IPC layer

export const link = {
  state: (): LinkState => need().state(),
  async setSettings(patch: Partial<LinkSettings>) {
    await need().setSettings(patch);
    if (need().port) await writeJson(controlFile(), { port: need().port, token: controlToken, pid: process.pid }).catch(() => undefined);
    const s = need().data.settings;
    // The tunnel follows "internet" mode and "never leaves my network".
    if (tunnel && tunnelConfig.mode !== 'off') {
      if (s.mode !== 'internet' || s.localOnly) await tunnel.stop();
      else if (tunnel.status.state === 'stopped' || tunnel.status.state === 'off') void tunnel.start(tunnelConfig);
    }
    return need().state();
  },
  rename: (name: string) => need().rename(name),
  discover: () => need().discover(),
  invite: () => need().createInvite(),
  cancelInvite: () => need().cancelInvite(),
  pair: (t: { deviceId?: string; address?: string; code?: string; link?: string }) => need().pair(t),
  confirmPair(id: string, ok: boolean) {
    pendingPairs.delete(id);
    need().confirmPair(id, ok);
  },
  forget: (d: string) => need().forget(d),
  setPermissions: (d: string, p: PermissionSet, auto?: boolean) => need().setPermissions(d, p, auto),
  renameDevice: (d: string, name: string) => need().renameDevice(d, name),
  check: (d: string) => need().check(d),
  async sendFiles(device: string, paths?: string[]) {
    let files = paths;
    if (!files?.length) {
      const r = await dialog.showOpenDialog({ title: 'Send files', properties: ['openFile', 'multiSelections'] });
      if (r.canceled) return;
      files = r.filePaths;
    }
    await need().sendFiles(device, files);
  },
  answerOffer(id: string, accept: boolean, always?: boolean) {
    pendingOffers.delete(id);
    need().answerOffer(id, accept, always);
  },
  sendClipboard: (d: string) => need().sendClipboard(d),
  shares: (d: string) => need().remoteShares(d),
  list: (d: string, share: string, dirPath: string) => need().remoteList(d, share, dirPath),
  download: (d: string, share: string, file: string) => need().remoteDownload(d, share, file),
  async addShare(p?: string) {
    let folder = p;
    if (!folder) {
      const r = await dialog.showOpenDialog({ title: 'Share a folder with your devices', properties: ['openDirectory', 'createDirectory'] });
      if (r.canceled || !r.filePaths[0]) return need().state();
      folder = r.filePaths[0];
    }
    await need().addShare(folder);
    return need().state();
  },
  async removeShare(id: string) {
    await need().removeShare(id);
    return need().state();
  },
  addForward: (f: { device: string; kind: 'port' | 'socks'; localPort: number; host?: string; port?: number }) => need().addForward(f),
  removeForward: (id: string) => need().removeForward(id),
  async companionInvite(viaTunnel?: boolean): Promise<CompanionInvite> {
    const n = need();
    const url = viaTunnel && n.tunnelUrl ? n.tunnelUrl : `http://${n.thisDevice().addresses[0] ?? '127.0.0.1'}:${n.port}`;
    return n.companionInvite(url);
  },
  answerCompanion(id: string, ok: boolean) {
    companionAsks.get(id)?.(ok);
  },
  forgetCompanion: (id: string) => need().forgetCompanion(id),
  /** prompts that are waiting, for a window that opens late */
  pending: () => ({ pairs: [...pendingPairs.values()], offers: [...pendingOffers.values()] }),
  tunnel: {
    status: (): TunnelStatus => tunnel?.status ?? { mode: 'off', state: 'off', connections: 0, restarts: 0, service: false, hasToken: false },
    async start(mode: TunnelMode, token?: string, hostname?: string): Promise<TunnelStatus> {
      if (!tunnel) throw new Error('Keeper Link is starting');
      if (token !== undefined && token.trim()) {
        const t = token.trim();
        // The dashboard shows "cloudflared service install <token>"; accept the whole line too.
        const clean = t.replace(/^.*\binstall\s+/, '').replace(/^.*--token\s+/, '').trim();
        if (!(await setSecret('link.tunnelToken', clean))) throw new Error('This computer has no keychain to keep the token in safely');
      }
      tunnelConfig = { ...tunnelConfig, mode, hostname: hostname ?? tunnelConfig.hostname };
      await writeJson(tunnelFile(), tunnelConfig);
      if (mode !== 'off' && need().data.settings.mode !== 'internet') await need().setSettings({ mode: 'internet', localOnly: false });
      return tunnel.start(tunnelConfig);
    },
    async stop(): Promise<TunnelStatus> {
      tunnelConfig = { ...tunnelConfig, mode: 'off' };
      await writeJson(tunnelFile(), tunnelConfig);
      if (!tunnel) throw new Error('Keeper Link is starting');
      return tunnel.start(tunnelConfig);
    },
    async installService(on: boolean): Promise<TunnelStatus> {
      if (!tunnel) throw new Error('Keeper Link is starting');
      const { installTunnelService } = await import('./service');
      await installTunnelService(on, await tunnel.ensureBinary(), await getSecret('link.tunnelToken'));
      tunnelConfig = { ...tunnelConfig, service: on };
      await writeJson(tunnelFile(), tunnelConfig);
      tunnel.status = { ...tunnel.status, service: on };
      changed();
      return tunnel.status;
    },
  },
};
