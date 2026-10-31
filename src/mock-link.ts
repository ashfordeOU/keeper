// SPDX-License-Identifier: AGPL-3.0-or-later
// Keeper Link for the browser demo: a few paired devices, a phone, a tunnel.
// Nothing leaves the page.

import type { CompanionInvite, Forward, LinkApi, LinkDevice, LinkSettings, LinkState, LinkTransfer, NearbyDevice, PairInvite, RemoteEntry, TunnelStatus } from '../core/api-link';

const MIN = 60_000;
const DAY = 86_400_000;

function fakeQr(text: string): string {
  // A pattern that reads as a QR code at a glance; the demo cannot be scanned.
  let h = 0;
  for (const c of text) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const n = 29;
  let cells = '';
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const finder = (x < 7 && y < 7) || (x > n - 8 && y < 7) || (x < 7 && y > n - 8);
      const on = finder ? (x % 6 === 0 || y % 6 === 0 || (x % 6 > 1 && x % 6 < 5 && y % 6 > 1 && y % 6 < 5)) && !(x === 6 && y > 6 && y < n - 7) : ((h >>> ((x * 7 + y * 13) % 31)) ^ (x * y)) & 1;
      if (on) cells += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
    }
  return `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 ${n + 4} ${n + 4}" shape-rendering="crispEdges"><rect x="-2" y="-2" width="${n + 4}" height="${n + 4}" fill="#fff"/><g fill="#111">${cells}</g></svg>`)}`;
}

export function mockLink(home: string, emit: (channel: string, ...args: unknown[]) => void) {
  const now = Date.now();
  const settings: LinkSettings = {
    mode: 'internet',
    localOnly: false,
    port: 47821,
    relayUrl: '',
    mailbox: 'https://ntfy.sh',
    stun: ['stun:stun.cloudflare.com:3478'],
    downloadDir: '',
    clipboardSync: false,
    forwardLan: false,
    shares: [{ id: 's1', name: 'Projects', path: `${home}/Projects` }, { id: 's2', name: 'Photos 2026', path: `${home}/Pictures/2026` }],
  };
  const devices: LinkDevice[] = [
    { id: 'kq3m8hx2abcdtw7n', name: 'Studio iMac', os: 'darwin', fingerprint: 'kq3m-8hx2-abcd-tw7n', pairedAt: now - 40 * DAY, lastSeen: now - 2 * MIN, permissions: { sendFiles: true, browse: true, clipboard: true, forward: true }, autoAccept: true, online: true, via: 'lan', where: '192.168.1.20', rtt: 3, nearby: true },
    { id: 'p4t9wz6ek2rsm8va', name: 'Home server', os: 'linux', fingerprint: 'p4t9-wz6e-k2rs-m8va', pairedAt: now - 12 * DAY, lastSeen: now - 1 * MIN, permissions: { sendFiles: true, browse: true, forward: true, sync: true }, autoAccept: false, online: true, via: 'tunnel', where: 'tunnel', rtt: 41 },
    { id: 'g7cn3ve8yu5qhd2b', name: 'Work laptop', os: 'win32', fingerprint: 'g7cn-3ve8-yu5q-hd2b', pairedAt: now - 3 * DAY, lastSeen: now - 5 * 3600_000, permissions: { sendFiles: true }, autoAccept: false, online: false },
  ];
  const transfers: LinkTransfer[] = [
    { id: 't1', name: 'Site photos.zip', size: 420 * 1024 * 1024, done: 286 * 1024 * 1024, direction: 'send', state: 'sending', peer: 'kq3m8hx2abcdtw7n' },
    { id: 't2', name: 'Contract signed.pdf', size: 1.2 * 1024 * 1024, done: 1.2 * 1024 * 1024, direction: 'receive', state: 'done', peer: 'p4t9wz6ek2rsm8va', savedAs: `${home}/Downloads/Keeper/Contract signed.pdf` },
  ];
  const forwards: Forward[] = [{ id: 'f1', device: 'p4t9wz6ek2rsm8va', kind: 'port', localPort: 8123, host: '127.0.0.1', port: 8123, active: true }];
  let tunnel: TunnelStatus = { mode: 'quick', state: 'connected', url: 'https://quiet-harbor-demo.trycloudflare.com', connections: 4, since: now - 3 * 3600_000, restarts: 1, service: false, hasToken: false };
  const companions = [{ id: 'c1', name: 'iPhone', created: now - 6 * DAY, lastSeen: now - 20 * MIN, online: false }];
  const nearby: NearbyDevice[] = [{ id: 'm2xk9qw4ztp7hc3d', name: 'Living room PC', os: 'linux', addresses: ['192.168.1.33'], port: 47821, pairing: true, paired: false }];

  const state = (): LinkState => ({
    me: { id: 'demo4me7device2x', name: 'Demo’s MacBook Pro', os: 'darwin', fingerprint: 'demo-4me7-devi-ce2x', keyProtected: true, addresses: ['192.168.1.14'], port: 47821, listening: true, tunnel, wireguard: [] },
    settings: { ...settings },
    devices: devices.map((d) => ({ ...d })),
    transfers: [...transfers],
    forwards: [...forwards],
    companions: [...companions],
  });
  const changed = () => emit('link-changed');
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const files: Record<string, RemoteEntry[]> = {
    '': [
      { name: 'keeper', isDir: true, size: 0, mtime: now - DAY },
      { name: 'garden-app', isDir: true, size: 0, mtime: now - 3 * DAY },
      { name: 'README.md', isDir: false, size: 4200, mtime: now - 2 * DAY },
      { name: 'roadmap.pdf', isDir: false, size: 820_000, mtime: now - 9 * DAY },
    ],
  };

  const api: LinkApi = {
    state: async () => state(),
    setSettings: async (p) => {
      Object.assign(settings, p);
      changed();
      return state();
    },
    rename: async () => undefined,
    discover: async () => (await wait(900), nearby),
    invite: async (): Promise<PairInvite> => {
      const link = 'keeper://pair?d=demo4me7device2x&k=demo-secret';
      // A device "joins" a few seconds later, and the six digits come up.
      setTimeout(() => emit('link-pair', { id: 'p1', sas: '482 913', role: 'host', peer: { name: 'Living room PC', os: 'linux', fingerprint: 'm2xk-9qw4-ztp7-hc3d' } }), 6000);
      return { code: '305 118'.replace(' ', ''), link, qr: fakeQr(link), expires: Date.now() + 10 * MIN };
    },
    cancelInvite: async () => undefined,
    pair: async () => {
      await wait(500);
      emit('link-pair', { id: 'p2', sas: '771 054', role: 'joiner', peer: { name: 'Living room PC', os: 'linux', fingerprint: 'm2xk-9qw4-ztp7-hc3d' } });
      return { ok: true, device: 'm2xk9qw4ztp7hc3d' };
    },
    confirmPair: async (_id, ok) => {
      if (ok && !devices.some((d) => d.id === 'm2xk9qw4ztp7hc3d')) {
        devices.push({ id: 'm2xk9qw4ztp7hc3d', name: 'Living room PC', os: 'linux', fingerprint: 'm2xk-9qw4-ztp7-hc3d', pairedAt: Date.now(), lastSeen: Date.now(), permissions: { sendFiles: true }, autoAccept: false, online: true, via: 'lan', where: '192.168.1.33', rtt: 4, nearby: true });
        nearby[0].paired = true;
        changed();
      }
    },
    forget: async (id) => {
      const i = devices.findIndex((d) => d.id === id);
      if (i >= 0) devices.splice(i, 1);
      changed();
    },
    setPermissions: async (id, perms, auto) => {
      const d = devices.find((x) => x.id === id);
      if (d) {
        d.permissions = perms;
        if (auto !== undefined) d.autoAccept = auto;
      }
      changed();
    },
    renameDevice: async (id, name) => {
      const d = devices.find((x) => x.id === id);
      if (d) d.name = name;
      changed();
    },
    check: async (id) => {
      await wait(400);
      const d = devices.find((x) => x.id === id);
      return d?.online ? { ok: true, via: d.via, rtt: d.rtt } : { ok: false, error: `Could not reach ${d?.name ?? 'it'}` };
    },
    sendFiles: async (id) => {
      const t: LinkTransfer = { id: 't' + Date.now(), name: 'Holiday.mov', size: 64 * 1024 * 1024, done: 0, direction: 'send', state: 'sending', peer: id };
      transfers.unshift(t);
      for (let i = 1; i <= 10; i++) {
        await wait(200);
        t.done = (t.size * i) / 10;
        if (i === 10) t.state = 'done';
        emit('link-transfer', { ...t });
      }
    },
    answerOffer: async () => undefined,
    sendClipboard: async () => undefined,
    shares: async () => settings.shares,
    list: async (_d, _s, dir) => files[dir] ?? [],
    download: async (_d, _s, f) => `${home}/Downloads/Keeper/${f.split('/').pop()}`,
    addShare: async () => {
      settings.shares.push({ id: 's' + Date.now(), name: 'Documents', path: `${home}/Documents` });
      changed();
      return state();
    },
    removeShare: async (id) => {
      settings.shares = settings.shares.filter((s) => s.id !== id);
      changed();
      return state();
    },
    addForward: async (f) => {
      const fw: Forward = { id: 'f' + Date.now(), ...f, active: true };
      forwards.push(fw);
      changed();
      return fw;
    },
    removeForward: async (id) => {
      const i = forwards.findIndex((f) => f.id === id);
      if (i >= 0) forwards.splice(i, 1);
      changed();
    },
    companionInvite: async (viaTunnel): Promise<CompanionInvite> => {
      const url = viaTunnel ? 'https://quiet-harbor-demo.trycloudflare.com/c/#k=demo&d=demo4me7device2x' : 'http://192.168.1.14:47821/c/#k=demo&d=demo4me7device2x';
      return { url, qr: fakeQr(url), expires: Date.now() + 10 * MIN, https: !!viaTunnel };
    },
    answerCompanion: async () => undefined,
    forgetCompanion: async (id) => {
      const i = companions.findIndex((c) => c.id === id);
      if (i >= 0) companions.splice(i, 1);
      changed();
    },
    pending: async () => ({ pairs: [], offers: [] }),
    tunnel: {
      status: async () => tunnel,
      start: async (mode, _t, hostname) => {
        tunnel = { ...tunnel, mode, state: 'starting', url: undefined, connections: 0 };
        changed();
        setTimeout(() => {
          tunnel = { ...tunnel, state: 'connected', connections: 4, since: Date.now(), url: mode === 'named' ? `https://${hostname || 'home.example.com'}` : 'https://quiet-harbor-demo.trycloudflare.com', hasToken: mode === 'named' || tunnel.hasToken };
          changed();
        }, 1500);
        return tunnel;
      },
      stop: async () => {
        tunnel = { ...tunnel, mode: 'off', state: 'off', url: undefined, connections: 0 };
        changed();
        return tunnel;
      },
      installService: async (on) => {
        tunnel = { ...tunnel, service: on };
        changed();
        return tunnel;
      },
    },
  };
  return { link: api };
}
