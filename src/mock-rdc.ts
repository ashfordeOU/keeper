// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Remote Desktops for the browser demo: a realistic list across every
// protocol, a couple of sessions, this computer and the programs. Nothing
// connects anywhere and nothing pops up over the page.

import type { RdcApi, RdcState } from '../core/rdc/api';
import { engineInfo, ENGINES } from '../core/rdc/engines';
import { exportText } from '../core/rdc/formats';
import type { HostStatus } from '../core/rdc/hosting';
import { securityChecks } from '../core/rdc/hosting';
import type { Connection, Online } from '../core/rdc/types';
import { defaultPort } from '../core/rdc/types';
import { guessFromPorts, parseTarget } from '../core/rdc/uri';
import { DEFAULT_PLACES, trayEntries, type RdcPlaces } from '../core/rdc/places';

export function mockRdc(emit: (channel: string, ...args: unknown[]) => void): { rdc: RdcApi } {
  const now = Date.now();
  const H = 3600_000;
  let n = 0;
  const c = (x: Partial<Connection> & Pick<Connection, 'name' | 'protocol' | 'host'>): Connection => ({ id: `demo-${++n}`, created: now - 30 * 24 * H, ...x });
  const list: Connection[] = [
    c({ name: 'Office PC', protocol: 'rdp', host: 'office-pc.corp.example', user: 'ana', domain: 'CORP', folder: 'Work', tags: ['windows'], color: '#3b82f6', favourite: true, hasPassword: true, mac: '3c:52:82:1a:9f:07', rdp: { multimon: true, clipboard: true, drives: true, nla: true }, lastUsed: now - 3 * H }),
    c({ name: 'Build server', protocol: 'ssh', host: 'build-01.lab.example', user: 'ci', folder: 'Work/Lab', tags: ['linux'], color: '#22c55e', auth: 'key', keyFile: '~/.ssh/id_ed25519', jump: ['bastion.example.com'], ssh: { agent: true, forwards: [{ kind: 'L', listen: 8080, host: 'localhost', port: 80 }] }, lastUsed: now - 26 * H }),
    c({ name: 'Raspberry Pi', protocol: 'vnc', host: 'raspberrypi.local', port: 5900, folder: 'Home', tags: ['pi'], color: '#a855f7', favourite: true, hasPassword: true, vnc: { scale: 'fit' }, lastUsed: now - 2 * 24 * H }),
    c({ name: 'Studio Mac mini', protocol: 'vnc', host: 'localhost', folder: 'Home', tags: ['mac'], gateway: { kind: 'link', device: 'dev-studio' }, askEveryTime: true }),
    c({ name: 'Mum’s laptop', protocol: 'rdp', host: '100.64.0.12', folder: 'Family', gateway: { kind: 'mesh', address: '100.64.0.12' }, user: 'mum' }),
    c({ name: 'Proxmox', protocol: 'web', host: 'pve.home.arpa', port: 8006, folder: 'Home/Lab', tags: ['servers'], web: { url: 'https://pve.home.arpa:8006/', pin: 'sha256/q0vH1Lw7c4K1y5mQ5V2r2wJ9C4uYV0b3T0rS7n8m2Xc=' }, color: '#f59e0b' }),
    c({ name: 'iDRAC — rack 2', protocol: 'web', host: '10.0.20.12', folder: 'Work/Lab', tags: ['servers'], web: { url: 'https://10.0.20.12/' } }),
    c({ name: 'Windows VM (SPICE)', protocol: 'spice', host: 'pve.home.arpa', port: 5901, folder: 'Home/Lab' }),
    c({ name: 'Old desktop (X2Go)', protocol: 'x2go', host: 'oldbox.local', user: 'ana', x2go: { command: 'XFCE' }, folder: 'Home' }),
    c({ name: 'Core switch', protocol: 'telnet', host: '10.0.0.2', folder: 'Work/Network', tags: ['network'] }),
    c({ name: 'Router console', protocol: 'serial', host: '/dev/ttyUSB0', serial: { baud: 115200 }, folder: 'Work/Network', tags: ['network'] }),
    c({ name: 'File server (PowerShell)', protocol: 'winrm', host: 'fs01.corp.example', user: 'ana', domain: 'CORP', folder: 'Work', tags: ['windows'] }),
    c({ name: 'Laptop over Mosh', protocol: 'mosh', host: 'devbox.example.com', user: 'ana', folder: 'Work', auth: 'agent' }),
    c({ name: 'Web server', protocol: 'ssh', host: 'web.example.com', user: 'deploy', port: 2222, gateway: { kind: 'ssh', host: 'bastion.example.com', user: 'ana' }, ssh: { x11: false }, tags: ['linux'], folder: 'Work' }),
  ];
  const status: Record<string, Online> = {};
  list.forEach((x, i) => { status[x.id] = i % 5 === 3 ? 'offline' : x.gateway?.kind === 'link' ? 'online' : i % 4 === 2 ? 'unknown' : 'online'; });
  const state = (): RdcState => ({
    connections: list,
    sessions: [{ id: 'demo-s1', connId: 'demo-1', name: 'Office PC', protocol: 'rdp', kind: 'external', state: 'connected', started: now - 20 * 60_000, program: 'freerdp' }],
    keychain: true,
    platform: 'darwin',
  });
  const host: HostStatus = {
    os: 'darwin',
    items: [{ id: 'mac-screen', name: 'Screen Sharing', protocol: 'vnc', port: 5900, available: true, on: false, listening: 'no', needsAdmin: true }],
    checks: [],
    viaLink: [{ device: 'dev-studio', name: 'Studio Mac mini' }],
  };
  host.checks = securityChecks({ os: 'darwin', items: host.items });
  let places: RdcPlaces = { ...DEFAULT_PLACES };
  const no = async (): Promise<never> => { throw new Error('Not available in the demo'); };
  const changed = () => emit('rdc-changed');
  return {
    rdc: {
      state: async () => state(),
      save: async (x) => {
        const i = list.findIndex((y) => y.id === x.id);
        const out = { ...(i >= 0 ? list[i] : { id: `demo-${++n}`, created: Date.now() }), ...x } as Connection;
        if (i >= 0) list[i] = out; else list.push(out);
        changed();
        return out;
      },
      remove: async (ids) => { for (const id of ids) { const i = list.findIndex((y) => y.id === id); if (i >= 0) list.splice(i, 1); } changed(); },
      duplicate: async (id) => { const s = list.find((y) => y.id === id)!; const d = { ...s, id: `demo-${++n}`, name: `${s.name} copy` }; list.push(d); changed(); return d; },
      setPassword: async () => true,
      quick: async (text) => {
        const t = parseTarget(text);
        if (!t) return { message: 'Type a computer name, an address, or rdp://host' };
        const g = t.protocol ? { protocol: t.protocol, port: t.port ?? defaultPort(t.protocol) ?? 0 } : guessFromPorts([3389]);
        return { conn: { id: `tmp-${Date.now()}`, created: Date.now(), name: t.host, protocol: g!.protocol, host: t.host, user: t.user, port: g!.port } };
      },
      probe: async (_h, ports) => (ports ?? [3389, 22]).map((p) => ({ port: p, open: p === 3389 || p === 22, ms: 4 })),
      connect: async () => ({ message: 'Connections do not open in the demo' }),
      disconnect: async () => undefined,
      command: async (id) => {
        const x = typeof id === 'string' ? list.find((y) => y.id === id) : id;
        if (x?.protocol === 'rdp') return { file: '/opt/homebrew/bin/sdl-freerdp3', args: [`/v:${x.host}:3389`, `/t:${x.name}`, ...(x.user ? [`/u:${x.user}`] : []), '/from-stdin:force', '+clipboard', '/sound', '/cert:tofu'], engine: 'freerdp', stdin: true, files: [] };
        if (x?.protocol === 'ssh') return { file: '/usr/bin/ssh', args: [`${x.user}@${x.host}`], engine: 'ssh', stdin: false, files: [] };
        return { error: 'Shown in the app' };
      },
      vncAttach: async () => null,
      vncDetach: () => undefined,
      vncInput: () => undefined,
      vncAck: () => undefined,
      vncClipboard: async () => undefined,
      vncKeys: async () => undefined,
      vncSetViewOnly: async () => undefined,
      webShow: async () => null,
      webAction: async () => undefined,
      watch: async () => status,
      wake: async () => ({ sent: 4 }),
      importFile: async () => null,
      importText: no,
      exportTo: async () => null,
      exportText: async (ids, f) => exportText(ids.length ? list.filter((x) => ids.includes(x.id)) : list, f),
      engines: async () => ENGINES.map((e) => engineInfo(e, 'darwin', ['ssh', 'freerdp', 'vncviewer'].includes(e.id) ? { path: e.id === 'ssh' ? '/usr/bin/ssh' : e.id === 'freerdp' ? '/opt/homebrew/bin/sdl-freerdp3' : '/opt/homebrew/bin/vncviewer', bin: e.id === 'freerdp' ? 'sdl-freerdp3' : e.id } : null)),
      hostStatus: async () => host,
      hostSet: async () => ({ ok: false, message: 'Not available in the demo' }),
      hostFix: async () => ({ ok: false, message: 'Not available in the demo' }),
      hostViaLink: async () => ({ ok: false, message: 'Not available in the demo' }),
      places: async () => places,
      setPlaces: async (p) => (places = { ...places, ...p }),
      trayPreview: async () => trayEntries(list, state().sessions, places),
      showQuick: async () => undefined,
      closeQuick: async () => undefined,
      openRoute: async () => undefined,
      openFile: async () => null,
    },
  };
}
