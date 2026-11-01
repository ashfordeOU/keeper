// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper Mesh, the pure parts: addresses, keys and signed records, WireGuard
// configuration, access rules, per-OS commands, the helper's guard and
// cleanup plans.
import { describe, expect, it } from 'vitest';
import { deviceId, newIdentity } from '../core/link/identity';
import { candidates4, cleanSuffix, conflicts, deviceAddr4, deviceAddr6, dnsLabel, inMesh, looksLikeMesh, networkPrefix4, networkPrefix6, overlaps } from '../core/mesh/address';
import { MESH_NOTICES, WINTUN, WIREGUARD_GO_SOURCE, WIREGUARD_NT, WIREGUARD_WINDOWS, wireguardGoBuild, wireguardWindows } from '../core/mesh/binaries';
import { canonical, isWgKey, newWgKey, pathKey, signRecord, verifyRecord, wgPublic, type MeshRecord } from '../core/mesh/keys';
import { aclDown, aclUp, cleanupPlan, dnsDown, dnsUp, emptyApplied, exitServeDown, exitServeUp, exitUseDown, exitUseUp, hostsWrite, ifaceDown, ifaceSync, ifaceUp, linuxIface, routesDown, routesUp, windowsTunnel, withHostsBlock, type IfaceCtx, type Step } from '../core/mesh/os-plan';
import { checkPlan, checkStep } from '../core/mesh/plan-guard';
import { compileAcl, complement, describeRule, parsePorts } from '../core/mesh/rules';
import { allowedIps, endpoint, parseUapiGet, parseWgDump, quickConf, redact, setconf, uapiSet } from '../core/mesh/wgconfig';
import { inPrefix } from '../core/net/addr';

const NET = '0123456789abcdef';

describe('addresses', () => {
  it('gives each network its own ULA /48 and each device a stable address in it', () => {
    const p = networkPrefix6(NET);
    expect(p).toMatch(/^fd[0-9a-f]{2}:[0-9a-f]{1,4}:[0-9a-f]{1,4}::\/48$/);
    expect(networkPrefix6(NET)).toBe(p);
    expect(networkPrefix6('fedcba9876543210')).not.toBe(p);
    const a = deviceAddr6(NET, 'abcdefghijkmnpqr');
    expect(a).toBe(deviceAddr6(NET, 'abcdefghijkmnpqr'));
    expect(inPrefix(a, p.split('/')[0], 48)).toBe(true);
    expect(deviceAddr6(NET, 'zzzzzzzzzzzzzzzz')).not.toBe(a);
    expect(inMesh(a, [p])).toBe(true);
    expect(looksLikeMesh(a)).toBe(true);
    expect(looksLikeMesh('100.70.3.4')).toBe(true);
    expect(looksLikeMesh('192.168.1.4')).toBe(false);
  });

  it('picks an IPv4 /16 in 100.64.0.0/10 that does not clash with local routes', () => {
    const all = candidates4(NET);
    expect(all).toHaveLength(64);
    expect(new Set(all).size).toBe(64);
    for (const c of all) expect(inPrefix(c.split('/')[0], '100.64.0.0', 10)).toBe(true);
    const first = networkPrefix4(NET, []);
    expect(first).toBe(all[0]);
    // a local route on the first choice (a carrier-grade NAT address, say) moves it to the next
    expect(networkPrefix4(NET, [`${all[0].split('/')[0].replace(/\.0\.0$/, '.3.0')}/24`])).toBe(all[1]);
    // the default route never counts as a clash
    expect(networkPrefix4(NET, ['0.0.0.0/0'])).toBe(all[0]);
    // a /10 route covering everything: no IPv4 for this network
    expect(networkPrefix4(NET, ['100.64.0.0/10'])).toBeNull();
    expect(conflicts('100.80.0.0/16', ['100.80.4.1/32', '10.0.0.0/8'])).toEqual(['100.80.4.1/32']);
    expect(overlaps('fd00::/8', 'fd12:3456:789a::/48')).toBe(true);
    expect(overlaps('10.0.0.0/8', 'fd00::/8')).toBe(false);
  });

  it('gives devices IPv4 addresses that avoid ones already taken, deterministically', () => {
    const p4 = '100.99.0.0/16';
    const a = deviceAddr4(p4, NET, 'aaaaaaaaaaaaaaaa');
    expect(inPrefix(a, '100.99.0.0', 16)).toBe(true);
    expect(a).not.toMatch(/\.0\.0$|\.255\.255$|\.0\.1$/);
    expect(deviceAddr4(p4, NET, 'aaaaaaaaaaaaaaaa')).toBe(a);
    const b = deviceAddr4(p4, NET, 'aaaaaaaaaaaaaaaa', [a]);
    expect(b).not.toBe(a);
    expect(deviceAddr4(p4, NET, 'aaaaaaaaaaaaaaaa', [a])).toBe(b);
  });

  it('makes DNS labels and checks the name ending', () => {
    expect(dnsLabel('Ana’s MacBook Pro')).toBe('anas-macbook-pro');
    expect(dnsLabel('Café PC')).toBe('cafe-pc');
    expect(dnsLabel('desk', ['desk'])).toBe('desk-2');
    expect(dnsLabel('!!!')).toBe('device');
    expect(cleanSuffix('.Keeper.')).toBe('keeper');
    expect(cleanSuffix('home.arpa')).toBe('home.arpa');
    expect(() => cleanSuffix('local')).toThrow();
    expect(() => cleanSuffix('bad name')).toThrow();
  });
});

describe('keys and the signed key exchange', () => {
  const alice = newIdentity();
  const bob = newIdentity();
  const A = deviceId(alice.publicKey);
  const B = deviceId(bob.publicKey);
  const wg = newWgKey();
  const rec = (over: Partial<MeshRecord> = {}): MeshRecord => ({ v: 1, net: NET, dev: A, to: B, name: 'Desk', wg: wg.pub, a6: deviceAddr6(NET, A), a4: deviceAddr4('100.99.0.0/16', NET, A), port: 41820, cands: [{ kind: 'lan', addr: '192.168.1.5:41820' }], pk: Buffer.alloc(32, 7).toString('base64'), seq: 1, ts: Date.now(), ...over });

  it('makes WireGuard keys in WireGuard’s format', () => {
    expect(isWgKey(wg.pub)).toBe(true);
    expect(isWgKey(wg.priv)).toBe(true);
    expect(wgPublic(wg.priv)).toBe(wg.pub);
    expect(newWgKey().pub).not.toBe(wg.pub);
    // RFC 7748 test vector (Alice's key pair)
    const priv = Buffer.from('77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a', 'hex').toString('base64');
    expect(Buffer.from(wgPublic(priv), 'base64').toString('hex')).toBe('8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a');
  });

  it('accepts a record signed by the pinned identity', () => {
    const s = signRecord(alice, rec());
    const v = verifyRecord(alice.publicKey, s, { net: NET, to: B, prefix4: '100.99.0.0/16' });
    expect(v.ok).toBe(true);
    // key order does not matter to the signature
    expect(canonical({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe('{"a":[2,{"c":4,"d":3}],"b":1}');
  });

  it('refuses forged, changed, misdirected, replayed and out-of-range records', () => {
    const s = signRecord(alice, rec());
    const want = { net: NET, to: B, prefix4: '100.99.0.0/16' };
    // signed by someone else, claiming to be Alice
    expect(() => signRecord(bob, rec())).toThrow();
    const forged = { rec: rec(), sig: s.sig };
    expect(verifyRecord(bob.publicKey, forged, want)).toMatchObject({ ok: false, why: 'record is from a different device' });
    // a swapped WireGuard key
    expect(verifyRecord(alice.publicKey, { rec: { ...s.rec, wg: newWgKey().pub }, sig: s.sig }, want)).toMatchObject({ ok: false, why: 'bad signature' });
    // meant for another device
    expect(verifyRecord(alice.publicKey, s, { ...want, to: 'cccccccccccccccc' })).toMatchObject({ ok: false });
    // replayed
    expect(verifyRecord(alice.publicKey, s, { ...want, lastSeq: 1 })).toMatchObject({ ok: false, why: 'old record (replayed?)' });
    // an address that is not the one the device id gives
    expect(verifyRecord(alice.publicKey, signRecord(alice, rec({ a6: deviceAddr6(NET, B) })), want)).toMatchObject({ ok: false });
    expect(verifyRecord(alice.publicKey, signRecord(alice, rec({ a4: '10.0.0.1' })), want)).toMatchObject({ ok: false, why: 'IPv4 address outside the network' });
    expect(verifyRecord(alice.publicKey, signRecord(alice, rec({ ts: Date.now() - 30 * 86_400_000 })), want)).toMatchObject({ ok: false });
    expect(verifyRecord(alice.publicKey, signRecord(alice, rec({ wg: 'nope' })), want)).toMatchObject({ ok: false });
  });

  it('derives the same path key on both sides', () => {
    const x = { dev: A, pk: Buffer.alloc(32, 1).toString('base64') };
    const y = { dev: B, pk: Buffer.alloc(32, 2).toString('base64') };
    expect(pathKey(x, y).equals(pathKey(y, x))).toBe(true);
    expect(pathKey(x, y).equals(pathKey(x, { ...y, pk: Buffer.alloc(32, 3).toString('base64') }))).toBe(false);
  });
});

describe('WireGuard configuration', () => {
  const me = newWgKey();
  const p1 = newWgKey();
  const p2 = newWgKey();
  const peers = [
    { name: 'Laptop', pub: p2.pub, allowed: allowedIps({ a6: 'fd12::2', a4: '100.99.0.2' }), endpoint: '127.0.0.1:50002', keepalive: 25 },
    { name: 'NAS', pub: p1.pub, allowed: allowedIps({ a6: 'fd12::3', routes: ['192.168.50.0/24'] }, { acceptRoutes: true, exit: true }), endpoint: '127.0.0.1:50003' },
  ];

  it('writes setconf and a complete file, peers in a fixed order', () => {
    const c = setconf({ priv: me.priv, listenPort: 51000, peers });
    expect(c).toContain(`PrivateKey = ${me.priv}`);
    expect(c).toContain('ListenPort = 51000');
    expect(c).not.toContain('Address');
    expect(c).toContain('AllowedIPs = fd12::3/128, 192.168.50.0/24, 0.0.0.0/0, ::/0');
    expect(c).toContain('PersistentKeepalive = 25');
    // the order of peers given does not change the file
    expect(setconf({ priv: me.priv, listenPort: 51000, peers: [...peers].reverse() })).toBe(c);
    const q = quickConf({ priv: me.priv, peers }, { addresses: ['fd12::1/48', '100.99.0.1/16'], dns: ['fd12::3'], mtu: 1280 });
    expect(q).toMatch(/Address = fd12::1\/48, 100.99.0.1\/16\nDNS = fd12::3\nMTU = 1280/);
    expect(redact(q)).not.toContain(me.priv);
    expect(redact(q)).toContain('PrivateKey = (kept in the keychain)');
  });

  it('writes wireguard-go’s UAPI with hex keys', () => {
    const u = uapiSet({ priv: me.priv, listenPort: 51000, peers });
    expect(u.startsWith('set=1\n')).toBe(true);
    expect(u).toContain(`private_key=${Buffer.from(me.priv, 'base64').toString('hex')}`);
    expect(u).toContain('replace_peers=true');
    expect(u).toContain(`public_key=${Buffer.from(p1.pub, 'base64').toString('hex')}`);
    expect(u).toContain('allowed_ip=::/0');
    expect(u.endsWith('\n\n')).toBe(true);
  });

  it('reads counters from wg dump and UAPI', () => {
    const dump = `privkey\tpubkey\t51000\toff\n${p1.pub}\t(none)\t203.0.113.4:41820\tfd12::3/128\t1700000000\t1024\t2048\t25\n`;
    expect(parseWgDump(dump)).toEqual([{ pub: p1.pub, endpoint: '203.0.113.4:41820', lastHandshake: 1_700_000_000_000, rx: 1024, tx: 2048 }]);
    const get = `private_key=00\nlisten_port=51000\npublic_key=${Buffer.from(p1.pub, 'base64').toString('hex')}\nendpoint=127.0.0.1:5\nlast_handshake_time_sec=1700000000\nlast_handshake_time_nsec=500000000\nrx_bytes=10\ntx_bytes=20\nerrno=0\n`;
    expect(parseUapiGet(get)).toEqual([{ pub: p1.pub, endpoint: '127.0.0.1:5', lastHandshake: 1_700_000_000_500, rx: 10, tx: 20 }]);
    expect(endpoint('fd00::1', 5)).toBe('[fd00::1]:5');
  });
});

describe('access rules', () => {
  it('parses, merges and complements port lists', () => {
    expect(parsePorts('all')).toBeNull();
    expect(parsePorts('443, 80 22 8000-8100, 8050-8200')).toEqual([[22, 22], [80, 80], [443, 443], [8000, 8200]]);
    expect(() => parsePorts('70000')).toThrow();
    expect(() => parsePorts('ssh')).toThrow();
    expect(complement([[22, 22], [80, 90]])).toEqual([[1, 21], [23, 79], [91, 65535]]);
    expect(complement([[1, 65535]])).toEqual([]);
  });

  it('lets own devices reach everything and guests only what a rule allows', () => {
    const peers = [
      { device: 'own1', role: 'own' as const, addrs: ['fd12::2', '100.99.0.2'] },
      { device: 'guest1', role: 'guest' as const, addrs: ['fd12::9'] },
    ];
    expect(compileAcl([], peers)).toEqual([{ src: ['fd12::2', '100.99.0.2'], proto: 'any', ports: null }]);
    const acl = compileAcl([{ id: 'r', from: 'guests', proto: 'tcp', ports: '445, 8080' }], peers);
    expect(acl[1]).toEqual({ src: ['fd12::9'], proto: 'tcp', ports: [[445, 445], [8080, 8080]] });
    expect(describeRule({ id: 'r', from: 'guests', proto: 'tcp', ports: '445' }, (d) => d)).toBe('Guests → port 445 (TCP)');
  });
});

describe('per-OS commands', () => {
  const ctx = (os: IfaceCtx['os'], impl: IfaceCtx['impl']): IfaceCtx => ({ os, impl, iface: os === 'linux' ? 'km-0123' : os === 'darwin' ? 'utun10' : 'Keeper-Home', a6: 'fd12:3456:789a::5', a4: '100.99.0.5', prefix6: 'fd12:3456:789a::/48', prefix4: '100.99.0.0/16', mtu: 1280, conf: os === 'linux' && impl === 'kernel' ? '[Interface]\n' : 'set=1\n', bin: os === 'win32' ? 'C:\\Program Files\\WireGuard\\wireguard.exe' : '/var/lib/keeper-mesh/bin/wireguard-go', wg: '/usr/bin/wg', confPath: os === 'win32' ? 'C:\\ProgramData\\Keeper\\mesh\\Keeper-Home.conf' : undefined });
  const lines = (s: Step[]) => s.map((x) => [x.file, ...x.args].join(' '));

  it('Linux: the kernel interface, addresses, MTU, and removal', () => {
    const c = ctx('linux', 'kernel');
    expect(linuxIface('0123456789abcdef')).toBe('km-0123');
    expect(lines(ifaceUp(c))).toEqual([
      'ip link add dev km-0123 type wireguard',
      '/usr/bin/wg setconf km-0123 /dev/stdin',
      'ip -6 address add fd12:3456:789a::5/48 dev km-0123',
      'ip -4 address add 100.99.0.5/16 dev km-0123',
      'ip link set dev km-0123 mtu 1280 up',
    ]);
    expect(ifaceUp(c)[1].stdin).toBe('[Interface]\n');
    expect(lines(ifaceSync(c))).toEqual(['/usr/bin/wg syncconf km-0123 /dev/stdin']);
    expect(lines(ifaceDown(c))[0]).toBe('ip link delete dev km-0123');
    // userspace: wireguard-go, configured over its control socket
    const g = ifaceUp(ctx('linux', 'wireguard-go'));
    expect(lines(g).slice(0, 2)).toEqual(['/var/lib/keeper-mesh/bin/wireguard-go km-0123', 'uapi km-0123']);
  });

  it('macOS: wireguard-go on utun, routes for the mesh ranges', () => {
    const l = lines(ifaceUp(ctx('darwin', 'wireguard-go')));
    expect(l).toEqual([
      '/var/lib/keeper-mesh/bin/wireguard-go utun10',
      'uapi utun10',
      'ifconfig utun10 inet6 fd12:3456:789a::5 prefixlen 128 alias',
      'route -q -n add -inet6 fd12:3456:789a::/48 -interface utun10',
      'ifconfig utun10 inet 100.99.0.5/32 100.99.0.5 alias',
      'route -q -n add -inet 100.99.0.0/16 -interface utun10',
      'ifconfig utun10 mtu 1280 up',
    ]);
    expect(lines(ifaceDown(ctx('darwin', 'wireguard-go')))).toEqual(['rm -f /var/run/wireguard/utun10.sock']);
  });

  it('Windows: the WireGuard tunnel service with a file only administrators can read', () => {
    const c = ctx('win32', 'wireguard-nt');
    const s = ifaceUp(c);
    expect(s[0].args.join(' ')).toContain('Set-Content -LiteralPath');
    expect(s[0].args.join(' ')).toContain("icacls");
    expect(s[1]).toEqual({ file: c.bin, args: ['/installtunnelservice', c.confPath] });
    expect(lines(ifaceDown(c))[0]).toBe(`${c.bin} /uninstalltunnelservice Keeper-Home`);
    expect(windowsTunnel('Home & Work!')).toBe('Keeper-HomeWork');
  });

  it('goes IPv4-only on a kernel without IPv6', () => {
    const c = { ...ctx('linux', 'kernel'), noV6: true };
    expect(lines(ifaceUp(c)).some((l) => l.includes('-6'))).toBe(false);
    expect(lines(exitServeUp({ os: 'linux', iface: 'km-0123', prefix6: 'fd12::/48', prefix4: '100.99.0.0/16', noV6: true }))).not.toContain('sysctl -w net.ipv6.conf.all.forwarding=1');
    const u = { os: 'linux' as const, iface: 'km-0123', bypass: [], killSwitch: false, allowLan: true, lan: [], noV6: true };
    expect(lines(exitUseUp(u)).some((l) => l.startsWith('ip -6'))).toBe(false);
    expect(lines(exitUseDown(u)).some((l) => l.startsWith('ip -6'))).toBe(false);
    expect(lines(ifaceUp({ ...ctx('darwin', 'wireguard-go'), noV6: true })).some((l) => l.includes('inet6'))).toBe(false);
  });

  it('routes for shared subnets', () => {
    expect(lines(routesUp('linux', 'km-0123', ['192.168.50.0/24', 'fd99::/64']))).toEqual(['ip -4 route replace 192.168.50.0/24 dev km-0123', 'ip -6 route replace fd99::/64 dev km-0123']);
    expect(lines(routesUp('darwin', 'utun10', ['192.168.50.0/24']))).toEqual(['route -q -n add -inet 192.168.50.0/24 -interface utun10']);
    expect(routesUp('win32', 'Keeper-Home', ['192.168.50.0/24'])).toEqual([]);
    expect(routesDown('linux', 'km-0123', ['192.168.50.0/24'])[0]).toMatchObject({ ignoreError: true });
  });

  it('split DNS per system', () => {
    expect(lines(dnsUp({ os: 'linux', iface: 'km-0123', server: 'fd12::5', port: 53, suffix: 'keeper' }))).toEqual(['resolvectl dns km-0123 fd12::5', 'resolvectl domain km-0123 ~keeper']);
    expect(lines(dnsUp({ os: 'linux', iface: 'km-0123', server: 'fd12::5', port: 5053, suffix: 'keeper' }))[0]).toBe('resolvectl dns km-0123 [fd12::5]:5053');
    const mac = dnsUp({ os: 'darwin', iface: 'utun10', server: 'fd12::5', port: 5053, suffix: 'keeper' });
    expect(mac[1]).toEqual({ file: 'tee', args: ['/etc/resolver/keeper'], stdin: '# Keeper Mesh\nnameserver fd12::5\nport 5053\n' });
    const win = dnsUp({ os: 'win32', iface: 'Keeper-Home', server: 'fd12::5', port: 53, suffix: 'keeper' })[0].args.join(' ');
    expect(win).toContain("Add-DnsClientNrptRule -Namespace '.keeper' -NameServers 'fd12::5' -Comment 'Keeper Mesh'");
    expect(lines(dnsDown({ os: 'linux', iface: 'km-0123', suffix: 'keeper' }))).toEqual(['resolvectl revert km-0123']);
    expect(lines(dnsDown({ os: 'darwin', iface: 'utun10', suffix: 'keeper' }))).toEqual(['rm -f /etc/resolver/keeper']);
  });

  it('keeps its own block in the hosts file and nothing else', () => {
    const start = '127.0.0.1 localhost\n::1 localhost\n';
    const a = withHostsBlock(start, [{ ip: 'fd12::2', names: ['laptop.keeper'] }]);
    expect(a).toContain('# BEGIN Keeper Mesh');
    expect(a).toContain('fd12::2\tlaptop.keeper');
    expect(withHostsBlock(a, [{ ip: 'fd12::3', names: ['nas.keeper'] }])).not.toContain('laptop.keeper');
    expect(withHostsBlock(a, [])).toBe(start);
    expect(withHostsBlock('a\r\nb\r\n', [{ ip: 'fd12::2', names: ['x.keeper'] }])).toContain('\r\n# END Keeper Mesh\r\n');
    expect(hostsWrite('linux', 'x')).toEqual([{ file: 'tee', args: ['/etc/hosts'], stdin: 'x' }]);
  });

  it('an exit node: forwarding and NAT on each system, and back as it was', () => {
    const l = exitServeUp({ os: 'linux', iface: 'km-0123', prefix6: 'fd12:3456:789a::/48', prefix4: '100.99.0.0/16' });
    expect(lines(l).slice(0, 2)).toEqual(['sysctl -w net.ipv4.ip_forward=1', 'sysctl -w net.ipv6.conf.all.forwarding=1']);
    expect(l[2].stdin).toContain('ip saddr 100.99.0.0/16 oifname != "km-0123" masquerade');
    expect(l[2].stdin).toContain('ip6 saddr fd12:3456:789a::/48 oifname != "km-0123" masquerade');
    expect(lines(exitServeDown({ os: 'linux', iface: 'km-0123' }, { v4: '1', v6: '0' }))).toEqual(['nft delete table inet keeper_mesh_nat', 'sysctl -w net.ipv4.ip_forward=1', 'sysctl -w net.ipv6.conf.all.forwarding=0']);
    const mac = exitServeUp({ os: 'darwin', iface: 'utun10', prefix6: 'fd12:3456:789a::/48', prefix4: '100.99.0.0/16', wan: 'en1' });
    expect(mac[2]).toMatchObject({ file: 'pfctl', args: ['-a', 'com.apple/250.KeeperMesh/nat', '-f', '-'] });
    expect(mac[2].stdin).toContain('nat on en1 inet from 100.99.0.0/16 to any -> (en1)');
    const win = exitServeUp({ os: 'win32', iface: 'Keeper-Home', prefix6: 'fd12::/48', prefix4: '100.99.0.0/16' }).map((s) => s.args.join(' ')).join('\n');
    expect(win).toContain("Set-NetIPInterface -InterfaceAlias 'Keeper-Home' -Forwarding Enabled");
    expect(win).toContain("New-NetNat -Name 'KeeperMesh' -InternalIPInterfaceAddressPrefix '100.99.0.0/16'");
  });

  it('using an exit node: split default routes, its DNS, and a kill switch', () => {
    const c = { os: 'linux' as const, iface: 'km-0123', bypass: ['203.0.113.7'], gw4: '192.168.1.1', wan: 'wlan0', killSwitch: true, allowLan: true, lan: ['192.168.1.0/24'], dns: 'fd12::9' };
    const up = exitUseUp(c);
    expect(lines(up).slice(0, 7)).toEqual([
      'ip -4 route replace 203.0.113.7/32 via 192.168.1.1 dev wlan0',
      'ip -4 route replace 0.0.0.0/1 dev km-0123',
      'ip -4 route replace 128.0.0.0/1 dev km-0123',
      'ip -6 route replace ::/1 dev km-0123',
      'ip -6 route replace 8000::/1 dev km-0123',
      'resolvectl dns km-0123 fd12::9',
      'resolvectl domain km-0123 ~.',
    ]);
    const ks = up.find((s) => s.file === 'nft')!.stdin!;
    expect(ks).toContain('policy drop');
    expect(ks).toContain('oifname "km-0123" accept');
    expect(ks).toContain('ip daddr { 203.0.113.7 } accept');
    expect(ks).toContain('ip daddr { 192.168.1.0/24 } accept');
    const down = lines(exitUseDown(c));
    expect(down[0]).toBe('nft delete table inet keeper_mesh_kill');
    expect(down).toContain('ip -4 route delete 203.0.113.7/32');
    const mac = exitUseUp({ ...c, os: 'darwin', iface: 'utun10', services: [{ name: 'Wi-Fi', before: [] }] });
    expect(lines(mac)).toContain('networksetup -setdnsservers Wi-Fi fd12::9');
    expect(mac.find((s) => s.file === 'pfctl')!.stdin).toContain('block drop out quick all');
    expect(lines(exitUseDown({ ...c, os: 'darwin', iface: 'utun10', services: [{ name: 'Wi-Fi', before: [] }] }))).toContain('networksetup -setdnsservers Wi-Fi Empty');
    // Windows: AllowedIPs 0/0 in the tunnel file; WireGuard for Windows routes and blocks the rest
    expect(exitUseUp({ ...c, os: 'win32', iface: 'Keeper-Home' })).toEqual([]);
  });

  it('access rules in nftables, pf and Windows Firewall, on the mesh interface only', () => {
    const acl = compileAcl([{ id: 'r', from: 'g', proto: 'tcp', ports: '22, 8000-8100' }], [
      { device: 'o', role: 'own', addrs: ['fd12::2', '100.99.0.2'] },
      { device: 'g', role: 'guest', addrs: ['fd12::9'] },
    ]);
    const nft = aclUp('linux', 'km-0123', acl, 53)[0].stdin!;
    expect(nft).toContain('iifname != "km-0123" accept');
    expect(nft).toContain('ip6 saddr { fd12::2 } accept');
    expect(nft).toContain('ip saddr { 100.99.0.2 } accept');
    expect(nft).toContain('ip6 saddr { fd12::9 } tcp dport { 22, 8000-8100 } accept');
    expect(nft.trim().split('\n').slice(-3)).toEqual(['    drop', '  }', '}']);
    const pf = aclUp('darwin', 'utun10', acl, 53)[0].stdin!;
    expect(pf).toContain('pass in quick on utun10 proto tcp from { fd12::9 } to any port { 22 8000:8100 }');
    expect(pf).toContain('block drop in quick on utun10 all');
    const win = aclUp('win32', 'Keeper-Home', acl, 53)[0].args.join(' ');
    expect(win).toContain("-InterfaceAlias 'Keeper-Home'");
    expect(win).toContain("-RemoteAddress @('fd12::9') -Protocol TCP -LocalPort 22,8000-8100 -Action Allow");
    expect(win).toContain('-LocalPort 1-21,23-7999,8101-65535 -Action Block');
    expect(lines(aclDown('linux'))).toEqual(['nft delete table inet keeper_mesh_acl']);
  });

  it('cleanup undoes everything, newest first, and may run twice', () => {
    const a = { ...emptyApplied('linux'), ifaces: [{ os: 'linux' as const, iface: 'km-0123', impl: 'kernel' as const }], routes: [{ iface: 'km-0123', cidrs: ['192.168.50.0/24'] }], dns: [{ iface: 'km-0123', suffix: 'keeper' }], hosts: true, acl: true, exitServe: { iface: 'km-0123', before: { v4: '0', v6: '0' } }, exitUse: { os: 'linux' as const, iface: 'km-0123', bypass: ['203.0.113.7'], killSwitch: true, allowLan: false, lan: [], dns: 'fd12::9' } };
    const plan = cleanupPlan(a, '127.0.0.1 localhost\n\n# BEGIN Keeper Mesh (managed by Keeper; do not edit)\nfd12::2\tx.keeper\n# END Keeper Mesh\n');
    const l = lines(plan);
    expect(l[0]).toBe('nft delete table inet keeper_mesh_kill');
    expect(l.indexOf('resolvectl revert km-0123')).toBeLessThan(l.indexOf('ip link delete dev km-0123'));
    expect(l).toContain('nft delete table inet keeper_mesh_nat');
    expect(l).toContain('nft delete table inet keeper_mesh_acl');
    expect(l).toContain('ip -4 route delete 192.168.50.0/24 dev km-0123');
    expect(l[l.length - 2]).toBe('ip link delete dev km-0123');
    expect(plan.find((s) => s.file === 'tee')!.stdin).toBe('127.0.0.1 localhost\n');
    expect(plan.every((s) => s.ignoreError)).toBe(true);
    expect(cleanupPlan(emptyApplied('darwin'))).toEqual([]);
    const win = cleanupPlan({ ...emptyApplied('win32'), ifaces: [{ os: 'win32', iface: 'Keeper-Home', impl: 'wireguard-nt', bin: 'wireguard.exe' }], dns: [{ iface: 'Keeper-Home', suffix: 'keeper' }], acl: true });
    expect(win.map((s) => s.args.join(' ')).join('\n')).toMatch(/Remove-DnsClientNrptRule[\s\S]*Remove-NetFirewallRule[\s\S]*uninstalltunnelservice Keeper-Home/);
  });
});

describe('the helper’s guard', () => {
  const o = { os: 'linux' as const, wgGo: '/var/lib/keeper-mesh/bin/wireguard-go', wg: '/usr/bin/wg' };

  it('allows every step Keeper’s own plans make', () => {
    const c: IfaceCtx = { os: 'linux', impl: 'kernel', iface: 'km-0123', a6: 'fd12::5', a4: '100.99.0.5', prefix6: 'fd12::/48', prefix4: '100.99.0.0/16', mtu: 1280, conf: '[Interface]\n', wg: '/usr/bin/wg' };
    const acl = compileAcl([], [{ device: 'o', role: 'own', addrs: ['fd12::2'] }]);
    const all = [
      ...ifaceUp(c), ...ifaceUp({ ...c, impl: 'wireguard-go', bin: o.wgGo, conf: 'set=1\n' }), ...ifaceSync(c), ...ifaceDown(c),
      ...routesUp('linux', 'km-0123', ['192.168.50.0/24']), ...routesDown('linux', 'km-0123', ['192.168.50.0/24']),
      ...dnsUp({ os: 'linux', iface: 'km-0123', server: 'fd12::5', port: 5053, suffix: 'keeper' }), ...dnsDown({ os: 'linux', iface: 'km-0123', suffix: 'keeper' }),
      ...hostsWrite('linux', 'x'), ...aclUp('linux', 'km-0123', acl, 53), ...aclDown('linux'),
      ...exitServeUp({ os: 'linux', iface: 'km-0123', prefix6: 'fd12::/48', prefix4: '100.99.0.0/16' }), ...exitServeDown({ os: 'linux', iface: 'km-0123' }),
      ...exitUseUp({ os: 'linux', iface: 'km-0123', bypass: ['203.0.113.7'], gw4: '192.168.1.1', wan: 'wlan0', killSwitch: true, allowLan: true, lan: ['192.168.1.0/24'], dns: 'fd12::9' }),
      ...exitUseDown({ os: 'linux', iface: 'km-0123', bypass: ['203.0.113.7'], killSwitch: true, allowLan: true, lan: [], dns: 'fd12::9' }),
    ];
    expect(checkPlan(all, o)).toBeNull();
    const mac: IfaceCtx = { ...c, os: 'darwin', iface: 'utun10', impl: 'wireguard-go', bin: o.wgGo, conf: 'set=1\n' };
    const macAll = [...ifaceUp(mac), ...ifaceDown(mac), ...dnsUp({ os: 'darwin', iface: 'utun10', server: 'fd12::5', port: 5053, suffix: 'keeper' }), ...aclUp('darwin', 'utun10', acl, 53), ...exitServeUp({ os: 'darwin', iface: 'utun10', prefix6: 'fd12::/48', wan: 'en0' }), ...exitUseUp({ os: 'darwin', iface: 'utun10', bypass: ['203.0.113.7'], gw4: '192.168.1.1', killSwitch: true, allowLan: false, lan: [], dns: 'fd12::9', services: [{ name: 'Wi-Fi', before: [] }] })];
    expect(checkPlan(macAll, { ...o, os: 'darwin' })).toBeNull();
  });

  it('refuses anything else', () => {
    const bad: Step[] = [
      { file: 'sh', args: ['-c', 'id'] },
      { file: 'ip', args: ['link', 'delete', 'dev', 'eth0'] },
      { file: 'ip', args: ['-4', 'route', 'replace', '0.0.0.0/0', 'via', '10.0.0.1'] },
      { file: 'nft', args: ['-f', '-'], stdin: 'flush ruleset\n' },
      { file: 'nft', args: ['-f', '-'], stdin: 'table inet filter {\n}\n' },
      { file: 'nft', args: ['delete', 'table', 'inet', 'filter'] },
      { file: 'tee', args: ['/etc/sudoers'], stdin: 'x' },
      { file: 'rm', args: ['-f', '/etc/hosts'] },
      { file: 'rm', args: ['-rf', '/'] },
      { file: 'sysctl', args: ['-w', 'kernel.core_pattern=|/tmp/x'] },
      { file: 'resolvectl', args: ['dns', 'eth0', '1.1.1.1'] },
      { file: 'pfctl', args: ['-d'] },
      { file: 'pfctl', args: ['-a', 'com.apple/other', '-F', 'all'] },
      { file: '/tmp/wireguard-go', args: ['km-0123'] },
      { file: o.wgGo, args: ['km-0123'], env: { LD_PRELOAD: '/tmp/x.so' } },
      { file: 'wg', args: ['set', 'km-0123', 'private-key', '/etc/shadow'] },
    ];
    for (const s of bad) expect(checkStep(s, o), JSON.stringify(s)).not.toBeNull();
    expect(checkStep({ file: 'ip', args: ['link'] }, { os: 'win32' })).not.toBeNull();
  });
});

describe('binaries and notices', () => {
  it('pins a SHA-256 for every download and records the licences', () => {
    for (const f of [...Object.values(WIREGUARD_WINDOWS), WIREGUARD_NT, WINTUN, WIREGUARD_GO_SOURCE]) {
      expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(f.url).toMatch(/^https:\/\//);
    }
    expect(wireguardWindows('x64')!.url).toContain('wireguard-amd64-');
    expect(wireguardWindows('mips')).toBeNull();
    // no wireguard-go build is pinned in this source tree: none is downloaded
    expect(wireguardGoBuild('darwin', 'arm64')).toBeNull();
    const names = MESH_NOTICES.map((n) => n.name);
    expect(names).toEqual(expect.arrayContaining(['wireguard-go', 'WireGuard for Windows', 'WireGuardNT (wireguard.dll)', 'Wintun (wintun.dll)']));
    expect(MESH_NOTICES.find((n) => n.name === 'wireguard-go')!.licence).toMatch(/^MIT/);
  });
});
