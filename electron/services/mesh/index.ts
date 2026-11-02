// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper Mesh inside the app: the engine (engine.ts) with this computer's
// keychain, the privileged helper or administrator prompt (driver.ts), the
// governor for endpoint refreshes, prompts in the window, and a loopback
// control port for the keeper command.
//
// Zero cost while off: with the feature off nothing listens, nothing runs on
// a timer, and no interface exists. The engine object only answers other
// devices with "Keeper Mesh is off here".

import { app, clipboard, dialog, Notification, type MenuItemConstructorOptions } from 'electron';
import crypto from 'node:crypto';
import { promises as fsp } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { newWgKey, wgPublic, type WgKeyPair } from '../../../core/mesh/keys';
import { cleanPlaces, type MeshApi, type MeshInvite, type MeshRole, type MeshRule, type MeshState, type TrayRow } from '../../../core/mesh/types';
import { KeychainLockedError } from '../../../core/keychain';
import { getSecret, secretLocked, setSecret } from '../../store';
import { runCmds } from '../elevate';
import { featureOn, onFeature } from '../features';
import { poll } from '../governor';
import type { LinkNode } from '../link/node';
import { RealDriver } from './driver';
import { MeshEngine, type MeshData } from './engine';
import { linkPort } from './link-port';

type Broadcast = (channel: string, ...args: unknown[]) => void;

let engine: MeshEngine | null = null;
let broadcast: Broadcast = () => undefined;
let show: (route?: string) => void = () => undefined;
let stopPoll: (() => void) | null = null;
let control: http.Server | null = null;
let changedTimer: NodeJS.Timeout | undefined;
const controlToken = crypto.randomBytes(24).toString('base64url');

const dir = () => path.join(app.getPath('userData'), 'mesh');
const file = () => path.join(dir(), 'mesh.json');

async function writeJson(f: string, v: unknown) {
  await fsp.mkdir(path.dirname(f), { recursive: true, mode: 0o700 });
  const tmp = `${f}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(v, null, 2), { mode: 0o600 });
  await fsp.rename(tmp, f);
}

let writing: Promise<void> = Promise.resolve();
const save = (d: MeshData) => (writing = writing.then(() => writeJson(file(), d)).catch(() => undefined));

/** This device's WireGuard key pair: the system keychain, or a file only you can read when there is none. */
async function wgKey(): Promise<WgKeyPair> {
  const fromKeychain = await getSecret('mesh.wgKey').catch(() => undefined);
  if (fromKeychain) return { priv: fromKeychain, pub: wgPublic(fromKeychain) };
  // Saved but the keychain said no: a new key would cut this device off from its mesh.
  if (await secretLocked('mesh.wgKey').catch(() => false)) throw new KeychainLockedError(process.platform, 'this device’s mesh key');
  const f = path.join(dir(), 'wg.key');
  const fromFile = await fsp.readFile(f, 'utf8').then((t) => t.trim(), () => '');
  if (fromFile) {
    // move it into the keychain once there is one
    if (await setSecret('mesh.wgKey', fromFile).catch(() => false)) await fsp.rm(f, { force: true });
    return { priv: fromFile, pub: wgPublic(fromFile) };
  }
  const k = newWgKey();
  if (!(await setSecret('mesh.wgKey', k.priv).catch(() => false))) {
    await fsp.mkdir(dir(), { recursive: true, mode: 0o700 });
    await fsp.writeFile(f, k.priv, { mode: 0o600 });
  }
  return k;
}

let onChange: () => void = () => undefined;

function changed() {
  clearTimeout(changedTimer);
  changedTimer = setTimeout(() => {
    broadcast('mesh-changed', islandExit());
    // the tray menu shows mesh controls too
    onChange();
  }, 80);
}

/** What the Island shows: the exit node in use, if any. */
export function islandExit(): { name: string; since: number } | null {
  const s = engine?.state();
  if (!s?.exit.using || !s.on || !s.places.exit.includes('island') || !featureOn('keeperMesh')) return null;
  const peer = s.networks.flatMap((n) => n.peers).find((p) => p.device === s.exit.using);
  return { name: peer?.name ?? 'another device', since: exitSince };
}
let exitSince = Date.now();

export async function startMesh(d: { node: () => LinkNode | null; broadcast: Broadcast; show: (route?: string) => void; onChange?: () => void }) {
  broadcast = d.broadcast;
  onChange = d.onChange ?? onChange;
  show = d.show;
  const node = d.node();
  if (!node) return;
  const driver = new RealDriver({
    dir: dir(),
    helper: path.join(__dirname, 'mesh-helper.cjs'),
    elevate: (steps) => runCmds(steps),
  });
  engine = new MeshEngine(
    linkPort(node),
    driver,
    {
      load: () => fsp.readFile(file(), 'utf8').then((t) => JSON.parse(t) as MeshData, () => null),
      save,
      wgKey,
      changed,
      invite: (i: MeshInvite) => {
        broadcast('mesh-invite', i);
        if (Notification.isSupported()) {
          const n = new Notification({ title: `${i.fromName} invites this device to “${i.name}”`, body: 'Open Keeper to join the mesh network or decline.' });
          n.on('click', () => show('mesh'));
          n.show();
        }
      },
      confirm: async (title, detail) => (await dialog.showMessageBox({ type: 'question', buttons: ['Allow', 'Cancel'], defaultId: 1, cancelId: 1, message: title, detail })).response === 0,
    },
    { feature: () => featureOn('keeperMesh') && featureOn('link'), handoff: () => featureOn('meshDirectHandoff') },
  );
  engine.forceRelay = process.env.KEEPER_MESH_FORCE_RELAY === '1';
  await engine.start();
  onFeature('keeperMesh', (on) => void (on ? whenOn() : whenOff()), { now: true });
}

async function whenOn() {
  if (!engine) return;
  // Endpoint refresh through the governor: slower when nobody is at the computer, paused while locked.
  stopPoll = poll('mesh.refresh', { baseMs: 60_000, idleFactor: 3, maxMs: 10 * 60_000 }, () => (engine?.isUp ? engine.refresh() : undefined), { feature: 'keeperMesh', now: false });
  await startControl();
  if (engine.data.on) await engine.up().catch(() => undefined);
  changed();
}

async function whenOff() {
  stopPoll?.();
  stopPoll = null;
  control?.close();
  control = null;
  await fsp.rm(path.join(dir(), 'control.json'), { force: true }).catch(() => undefined);
  await engine?.down().catch(() => undefined);
  changed();
}

/**
 * Mesh controls for the tray / menu bar, as chosen under "Where mesh controls
 * appear": on and off, the exit node, and each device's address to copy.
 * Synchronous (the tray menu is rebuilt from it), so it reads cached state.
 */
export function meshTrayItems(): MenuItemConstructorOptions[] {
  if (!engine || !featureOn('keeperMesh')) return [];
  const s = engine.state();
  const items: MenuItemConstructorOptions[] = [];
  const say = (p: Promise<unknown>) => void p.catch((e) => dialog.showErrorBox('Keeper Mesh', (e as Error).message)).finally(changed);
  if (s.places.power.includes('tray')) items.push({ label: 'Keeper Mesh', type: 'checkbox', checked: s.on, click: () => say(mesh.setOn(!s.on)) });
  if (s.on && s.places.exit.includes('tray')) {
    const offers = s.networks.flatMap((n) => n.peers.filter((p) => p.offersExit));
    items.push({
      label: s.exit.using ? `Exit Node: ${offers.find((p) => p.device === s.exit.using)?.name ?? 'on'}` : 'Exit Node',
      submenu: [
        { label: 'None (normal internet)', type: 'radio', checked: !s.exit.using, click: () => say(mesh.setExit(null)) },
        ...offers.map((p) => ({ label: p.name, type: 'radio' as const, checked: s.exit.using === p.device, click: () => say(mesh.setExit(p.device)) })),
        ...(offers.length ? [] : [{ label: 'No device offers itself yet', enabled: false }]),
      ],
    });
  }
  if (s.on && s.places.addresses.includes('tray')) {
    const rows: MenuItemConstructorOptions[] = [];
    for (const n of s.networks) {
      if (s.networks.length > 1) rows.push({ label: n.name, enabled: false });
      rows.push({ label: `This device  ${n.me.a4 ?? n.me.a6}`, click: () => clipboard.writeText(n.me.a4 ?? n.me.a6) });
      for (const p of n.peers.filter((x) => x.a6)) rows.push({ label: `${p.name}  ${p.a4 ?? p.a6}`, toolTip: `${p.dns} · click to copy`, click: () => clipboard.writeText((p.a4 ?? p.a6)!) });
    }
    if (rows.length) items.push({ label: 'Copy Mesh Address', submenu: rows });
  }
  if (items.length) items.push({ label: 'Mesh…', click: () => show('mesh') }, { type: 'separator' });
  return items;
}

export async function stopMesh() {
  await whenOff();
}

function need(): MeshEngine {
  if (!engine) throw new Error('Keeper Mesh needs Keeper Link; it is starting');
  return engine;
}

// ---------------------------------------------------------------- for the IPC layer and the keeper command

export const mesh: MeshApi = {
  state: async () => (engine ? need().refreshState() : offState()),
  setOn: async (on) => {
    if (on && !featureOn('keeperMesh')) throw new Error('Turn on Keeper Mesh in Settings → Features first');
    return need().setOn(on);
  },
  createNetwork: (name, ipv4) => need().createNetwork(name, ipv4),
  renameNetwork: (id, name) => need().renameNetwork(id, name),
  removeNetwork: (id) => need().removeNetwork(id),
  addMember: (net, device, role: MeshRole) => need().addMember(net, device, role),
  removeMember: (net, device) => need().removeMember(net, device),
  answerInvite: (id, ok) => need().answerInvite(id, ok),
  setExit: async (device, opts) => {
    exitSince = Date.now();
    return need().setExit(device, opts);
  },
  offerExit: (on) => need().offerExit(on),
  advertise: (routes) => need().advertise(routes),
  acceptRoutes: (device, on) => need().acceptRoutes(device, on),
  saveRule: (net, rule: MeshRule) => need().saveRule(net, rule),
  removeRule: (net, id) => need().removeRule(net, id),
  setDns: (p) => need().setDns(p),
  ping: (device) => need().ping(device),
  pathTest: (device) => need().pathTest(device),
  mtuProbe: (device) => need().mtuProbe(device),
  setPlaces: (p) => need().setPlaces(p),
  trayPreview: async () => {
    const rows = (items: MenuItemConstructorOptions[]): TrayRow[] => items.filter((i) => i.type !== 'separator').map((i) => ({ label: String(i.label ?? ''), ...(i.type === 'checkbox' || i.type === 'radio' ? { checked: !!i.checked } : {}), ...(Array.isArray(i.submenu) ? { submenu: rows(i.submenu as MenuItemConstructorOptions[]) } : {}) }));
    return rows(meshTrayItems());
  },
  config: async (net) => need().config(net),
};

function offState(): MeshState {
  return { places: cleanPlaces(undefined), feature: featureOn('keeperMesh'), on: false, iface: { state: 'off' }, port: 0, candidates: [], networks: [], exit: { offering: false, killSwitch: true, dnsThrough: true, allowLan: true }, advertise: { routes: [], approved: false }, dns: { suffix: 'keeper', split: 'off', hosts: false }, invites: [] };
}

/** Finds a device by id, name or mesh name ("laptop", "laptop.keeper"). */
function deviceOf(s: MeshState, q: string): string {
  const t = q.toLowerCase();
  for (const n of s.networks) for (const p of n.peers) if (p.device === t || p.name.toLowerCase() === t || p.dns === t || p.dns.split('.')[0] === t) return p.device;
  throw new Error(`No device called ${q} in your mesh`);
}

/**
 * The keeper command: loopback only, with a token in a file only this
 * account can read (the same scheme as Keeper Link's control port).
 */
async function startControl() {
  if (control) return;
  control = http.createServer(async (req, res) => {
    const send = (code: number, body: unknown) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const remote = (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
    const given = String(req.headers['x-keeper-token'] ?? '');
    if (remote !== '127.0.0.1' || req.method !== 'POST' || req.headers.origin || given.length !== controlToken.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(controlToken))) return send(403, { ok: false, e: 'no' });
    let body = '';
    for await (const c of req) {
      body += c;
      if (body.length > 100_000) return send(413, { ok: false, e: 'too large' });
    }
    const p = (body ? JSON.parse(body) : {}) as Record<string, string>;
    const op = (req.url ?? '').replace(/^\/mesh\//, '');
    try {
      const s = await mesh.state();
      const dev = (x: string) => deviceOf(s, x);
      const net = (x?: string) => (x ? s.networks.find((n) => n.id === x || n.name.toLowerCase() === x.toLowerCase())?.id : s.networks[0]?.id) ?? (() => { throw new Error('No mesh network yet: make one on the Mesh page'); })();
      let r: unknown;
      switch (op) {
        case 'state': r = s; break;
        case 'up': r = await mesh.setOn(true); break;
        case 'down': r = await mesh.setOn(false); break;
        case 'ping': r = await mesh.ping(dev(p.device)); break;
        case 'path': r = await mesh.pathTest(dev(p.device)); break;
        case 'exit': r = await mesh.setExit(p.device === 'off' ? null : dev(p.device)); break;
        case 'advertise': r = await mesh.advertise(String(p.routes ?? '').split(',').filter(Boolean)); break;
        case 'rule-add': r = await mesh.saveRule(net(p.net), { id: '', from: p.from === 'own' || p.from === 'guests' ? p.from : dev(p.from), proto: (p.proto as MeshRule['proto']) || 'tcp', ports: p.ports }); break;
        case 'rule-remove': r = await mesh.removeRule(net(p.net), p.id); break;
        case 'config': r = await mesh.config(net(p.net)); break;
        default: return send(404, { ok: false, e: 'unknown' });
      }
      send(200, { ok: true, r });
    } catch (e) {
      send(200, { ok: false, e: e instanceof Error ? e.message : String(e) });
    }
  });
  await new Promise<void>((r) => control!.listen(0, '127.0.0.1', () => r()));
  const port = (control.address() as { port: number }).port;
  await writeJson(path.join(dir(), 'control.json'), { port, token: controlToken, pid: process.pid });
}
