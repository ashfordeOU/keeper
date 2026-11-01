// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper Mesh for the browser demo: one network with a laptop, a NAS that
// shares a subnet and offers itself as an exit node, and a guest. Nothing
// leaves the page.

import { cleanPlaces, DEFAULT_PLACES, type MeshApi, type MeshRule, type MeshState } from '../core/mesh/types';

export function mockMesh(emit: (channel: string, ...args: unknown[]) => void) {
  const now = Date.now();
  const s: MeshState = {
    feature: true,
    on: true,
    iface: { state: 'up', name: 'km-3f2a', impl: 'kernel' },
    wgPub: 'mA3k9vQ1xYz8cW2nR4tL6pE0sD7fG5hJ3kL1mN9bV8c=',
    port: 41820,
    candidates: [{ kind: 'lan', addr: '192.168.1.20:41820' }, { kind: 'public', addr: '203.0.113.44:41820' }],
    networks: [
      {
        id: '3f2a9c1d7e6b5a40',
        name: 'Home',
        members: [],
        rules: [{ id: 'r1', from: 'guests', proto: 'tcp', ports: '445, 8096', note: 'Files and the media server' }],
        ipv4: true,
        prefix6: 'fd7c:41e2:9a07::/48',
        prefix4: '100.87.0.0/16',
        created: now - 40 * 86_400_000,
        owner: 'me',
        me: { a6: 'fd7c:41e2:9a07:0:8e1f:2b44:a1c9:5d02', a4: '100.87.12.40', dns: 'studio.keeper' },
        peers: [
          { device: 'laptop', name: 'MacBook Air', dns: 'macbook-air.keeper', role: 'own', online: true, joined: true, a6: 'fd7c:41e2:9a07:0:41b0:9c3d:77e2:1a90', a4: '100.87.201.7', wgKey: 'Qx7p2…Lw0t', path: 'lan', endpoint: '192.168.1.31:41820', latencyMs: 3, lastHandshake: now - 42_000, rx: 182_400_000, tx: 24_900_000, offersExit: false, routes: [], routesAccepted: false, keyVerified: true },
          { device: 'nas', name: 'Garage NAS', dns: 'garage-nas.keeper', role: 'own', online: true, joined: true, a6: 'fd7c:41e2:9a07:0:d9a2:63f0:2c18:be41', a4: '100.87.77.3', wgKey: 'Zr4m8…Pq2s', path: 'internet', endpoint: '198.51.100.9:41820', latencyMs: 24, lastHandshake: now - 95_000, rx: 2_400_000_000, tx: 610_000_000, offersExit: true, routes: ['192.168.50.0/24'], routesAccepted: true, keyVerified: true },
          { device: 'sam', name: 'Sam’s PC', dns: 'sams-pc.keeper', role: 'guest', online: false, joined: true, a6: 'fd7c:41e2:9a07:0:12aa:f0c3:9e71:44d5', wgKey: 'Hk1v5…Yu9e', path: 'relay', endpoint: 'https://relay.example.org', latencyMs: 61, lastHandshake: now - 26 * 60_000, rx: 9_800_000, tx: 1_200_000, offersExit: false, routes: [], routesAccepted: false, keyVerified: true },
        ],
      },
    ],
    exit: { offering: false, killSwitch: true, dnsThrough: true, allowLan: true },
    advertise: { routes: [], approved: false },
    dns: { suffix: 'keeper', responder: '[fd7c:41e2:9a07:0:8e1f:2b44:a1c9:5d02]:53', split: 'on', hosts: false },
    relay: { url: 'https://relay.example.org', connected: true },
    invites: [],
    places: { ...DEFAULT_PLACES },
  };
  const changed = () => {
    emit('mesh-changed', s.exit.using ? { name: s.networks[0].peers.find((p) => p.device === s.exit.using)?.name ?? '', since: Date.now() } : null);
    return structuredClone(s);
  };
  const net = (id: string) => s.networks.find((n) => n.id === id) ?? s.networks[0];
  const diag = (lines: string[]) => ({ ok: true, lines });
  const api: MeshApi = {
    state: async () => structuredClone(s),
    setOn: async (on) => {
      s.on = on;
      s.iface = on ? { state: 'up', name: 'km-3f2a', impl: 'kernel' } : { state: 'off' };
      return changed();
    },
    createNetwork: async (name) => {
      s.networks.push({ ...structuredClone(s.networks[0]), id: Math.random().toString(16).slice(2, 18), name, peers: [], rules: [], prefix6: 'fd21:9b3e:c40d::/48', prefix4: '100.101.0.0/16', me: { a6: 'fd21:9b3e:c40d:0:8e1f:2b44:a1c9:5d02', a4: '100.101.40.2', dns: 'studio.keeper' } });
      return changed();
    },
    renameNetwork: async (id, name) => {
      net(id).name = name;
      return changed();
    },
    removeNetwork: async (id) => {
      s.networks = s.networks.filter((n) => n.id !== id);
      return changed();
    },
    addMember: async () => changed(),
    removeMember: async (id, device) => {
      net(id).peers = net(id).peers.filter((p) => p.device !== device);
      return changed();
    },
    answerInvite: async () => changed(),
    setExit: async (device, o) => {
      s.exit = { ...s.exit, ...o, using: device ?? undefined };
      return changed();
    },
    offerExit: async (on) => {
      s.exit.offering = on;
      return changed();
    },
    advertise: async (routes) => {
      s.advertise = { routes, approved: routes.length > 0 };
      return changed();
    },
    acceptRoutes: async (device, on) => {
      for (const n of s.networks) for (const p of n.peers) if (p.device === device) p.routesAccepted = on;
      return changed();
    },
    saveRule: async (id, rule: MeshRule) => {
      const n = net(id);
      n.rules = [...n.rules.filter((r) => r.id !== rule.id), { ...rule, id: rule.id || Math.random().toString(36).slice(2, 8) }];
      return changed();
    },
    removeRule: async (id, rid) => {
      net(id).rules = net(id).rules.filter((r) => r.id !== rid);
      return changed();
    },
    setDns: async (p) => {
      s.dns = { ...s.dns, ...p };
      return changed();
    },
    ping: async (d) => diag([`64 bytes from ${s.networks[0].peers.find((p) => p.device === d)?.a4 ?? 'fd7c::2'}: icmp_seq=1 ttl=64 time=3.1 ms`, '3 packets transmitted, 3 received, 0% packet loss']),
    pathTest: async () => diag(['This device: lan 192.168.1.20:41820, public 203.0.113.44:41820', 'Path: Direct (LAN) via 192.168.1.31:41820, 3 ms', 'Relay: connected (https://relay.example.org)']),
    setPlaces: async (p) => {
      s.places = cleanPlaces({ ...s.places, ...p });
      return changed();
    },
    trayPreview: async () => [{ label: 'Keeper Mesh', checked: s.on }, { label: 'Exit Node', submenu: [{ label: 'None (normal internet)', checked: !s.exit.using }, { label: 'Garage NAS', checked: s.exit.using === 'nas' }] }, { label: 'Copy Mesh Address', submenu: s.networks[0].peers.map((p) => ({ label: `${p.name}  ${p.a4 ?? p.a6}` })) }, { label: 'Mesh…' }],
    mtuProbe: async () => diag(['The largest packet that gets through whole: 1280 bytes']),
    config: async () => '[Interface]\nPrivateKey = (kept in the keychain)\nAddress = fd7c:41e2:9a07:0:8e1f:2b44:a1c9:5d02/48, 100.87.12.40/16\nListenPort = 51820\nMTU = 1280\n\n[Peer]\n# MacBook Air\nPublicKey = Qx7p2…Lw0t\nAllowedIPs = fd7c:41e2:9a07:0:41b0:9c3d:77e2:1a90/128, 100.87.201.7/32\nEndpoint = 127.0.0.1:50211\nPersistentKeepalive = 25\n',
  };
  return { mesh: api };
}
