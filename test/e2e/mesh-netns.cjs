// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper Mesh on a real Linux kernel, in network namespaces (needs root).
// Usage: node test/e2e/mesh-netns.cjs
//
//   k-inet   "the internet": a STUN server and a web server at 198.51.100.1
//   k-nata   home router A: NAT (nftables masquerade) 10.0.1.0/24 → 198.51.100.11
//   k-natb   home router B: NAT 10.0.2.0/24 → 198.51.100.12
//   k-hosta  device "desk"   10.0.1.2, behind A
//   k-hostb  device "laptop" 10.0.2.2, behind B
//
// What is real: the namespaces, the two NATs, STUN, Keeper's data path doing
// simultaneous hole punching through both NATs, Keeper's generated commands
// (addresses, MTU, routes, nftables access rules, exit-node forwarding and
// NAT, split default routes, the kill switch, cleanup) run against the real
// kernel through the helper's guard, ping between mesh addresses, the mesh DNS
// responder answering on a mesh address, and access rules allowing one port
// and dropping another.
//
// What stands in: for the first part, WireGuard itself. This kernel has no
// WireGuard module, so the mesh interface is a veth pair with the same name
// (km-xxxx), with ARP off so it behaves like WireGuard's point-to-point
// layer-3 link. The script first tries `ip link add … type wireguard` and
// reports what the kernel says.
//
// Then real WireGuard: wireguard-go built from the pinned source snapshot (its
// SHA-256 checked first; Go's module checksums for its dependencies), on two
// TUN interfaces in the two devices. A real WireGuard handshake and pings go
// through Keeper's shims over the hole-punched path; then the direct handoff
// gives the path to WireGuard itself (packets no longer pass through Keeper),
// and when the direct path is blocked, WireGuard is pointed back at the shim.
// Set KEEPER_WG_GO to a wireguard-go binary to skip the build; with neither
// that nor a Go toolchain this part is skipped and says so.

const { spawnSync, spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');

const ROOT = path.resolve(__dirname, '../..');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-netns-'));
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) process.exitCode = 1; };
const note = (what) => console.log(`NOTE ${what}`);
if (process.getuid() !== 0) { console.log('SKIP: needs root (network namespaces)'); process.exit(0); }

// ---- bundle Keeper's own code for this script and for the devices
const { buildSync } = require('esbuild');
buildSync({ entryPoints: [path.join(__dirname, 'mesh-netns-child.ts')], outfile: path.join(OUT, 'child.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node22', logLevel: 'error' });
buildSync({
  stdin: { contents: `export * from './core/mesh/binaries'; export * from './core/mesh/address'; export * from './core/mesh/os-plan'; export * from './core/mesh/plan-guard'; export * from './core/mesh/rules'; export * from './core/mesh/keys'; export * from './core/mesh/wgconfig'; export { runSteps } from './electron/services/mesh/helper';`, resolveDir: ROOT, loader: 'ts' },
  outfile: path.join(OUT, 'lib.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node22', logLevel: 'error',
});
const K = require(path.join(OUT, 'lib.cjs'));

const sh = (args, opts = {}) => spawnSync(args[0], args.slice(1), { encoding: 'utf8', ...opts });
const ns = (n, ...args) => sh(['ip', 'netns', 'exec', n, ...args]);
const must = (r, what) => { if (r.status !== 0) throw new Error(`${what}: ${r.stderr || r.stdout}`); return r; };
const NSS = ['k-inet', 'k-nata', 'k-natb', 'k-hosta', 'k-hostb'];
const V6 = fs.existsSync('/proc/sys/net/ipv6');
// This machine may have no ping program: a few lines of Python send one ICMP echo (as root).
const PYPING = `import socket,struct,sys,time,os
dst=sys.argv[1];s=socket.socket(socket.AF_INET,socket.SOCK_RAW,socket.IPPROTO_ICMP);s.settimeout(float(sys.argv[2]))
def ck(b):
  b+=b'\\0'*(len(b)%2);t=sum(struct.unpack('!%dH'%(len(b)//2),b));t=(t>>16)+(t&65535);t+=t>>16;return ~t&65535
i=os.getpid()&65535;h=struct.pack('!BBHHH',8,0,0,i,1)+b'keeper';p=struct.pack('!BBHHH',8,0,ck(h),i,1)+b'keeper'
s.sendto(p,(dst,0))
try:
  while True:
    d,a=s.recvfrom(2048)
    if a[0]==dst and d[20]==0: sys.exit(0)
except Exception: sys.exit(1)`;
const ping = (n, dst, wait = 2) => ({ status: sh(['ip', 'netns', 'exec', n, 'python3', '-I', '-c', PYPING, dst, String(wait)]).status });

/** Runs Keeper plan steps in a namespace with the helper's own runner (each step checked by its guard first). */
async function runPlan(n, steps, label, wgGo) {
  const r = await K.runSteps(steps, { os: 'linux', wg: 'wg', wgGo }, (file, args) => ['ip', ['netns', 'exec', n, file, ...args]]);
  if (!r.ok) throw new Error(`${label}: ${r.message}`);
  return true;
}

const kids = [];
const run = (...a) => { const p = spawn(...a); kids.push(p); if (p.stdout) void lineOf(p, '__attach__').catch(() => undefined); return p; };
function teardown() {
  for (const p of kids.splice(0)) try { p.kill('SIGKILL'); } catch { /* gone */ }
  // removing wireguard-go's control socket makes it exit (as Keeper's own cleanup does)
  for (const f of ['km-aaa1', 'km-bbb2']) fs.rmSync(`/var/run/wireguard/${f}.sock`, { force: true });
  for (const n of NSS) sh(['ip', 'netns', 'del', n]);
}

async function main() {
  teardown();
  for (const n of NSS) must(sh(['ip', 'netns', 'add', n]), `netns ${n}`);
  for (const n of NSS) ns(n, 'ip', 'link', 'set', 'lo', 'up');
  // the internet: a bridge with the two routers' outside ends on it
  must(ns('k-inet', 'ip', 'link', 'add', 'br0', 'type', 'bridge'), 'bridge');
  ns('k-inet', 'ip', 'addr', 'add', '198.51.100.1/24', 'dev', 'br0');
  ns('k-inet', 'ip', 'link', 'set', 'br0', 'up');
  const veth = (a, an, b, bn) => {
    must(sh(['ip', 'link', 'add', 'tmpa', 'type', 'veth', 'peer', 'name', 'tmpb']), 'veth');
    must(sh(['ip', 'link', 'set', 'tmpa', 'netns', a]), 'move');
    must(sh(['ip', 'link', 'set', 'tmpb', 'netns', b]), 'move');
    ns(a, 'ip', 'link', 'set', 'tmpa', 'name', an);
    ns(b, 'ip', 'link', 'set', 'tmpb', 'name', bn);
    ns(a, 'ip', 'link', 'set', an, 'up');
    ns(b, 'ip', 'link', 'set', bn, 'up');
  };
  for (const [x, wan, lan, host] of [['a', '198.51.100.11', '10.0.1', 'k-hosta'], ['b', '198.51.100.12', '10.0.2', 'k-hostb']]) {
    const nat = `k-nat${x}`;
    veth(nat, 'wan', 'k-inet', `to${x}`);
    ns('k-inet', 'ip', 'link', 'set', `to${x}`, 'master', 'br0');
    ns(nat, 'ip', 'addr', 'add', `${wan}/24`, 'dev', 'wan');
    veth(nat, 'lan', host, 'eth0');
    ns(nat, 'ip', 'addr', 'add', `${lan}.1/24`, 'dev', 'lan');
    ns(host, 'ip', 'addr', 'add', `${lan}.2/24`, 'dev', 'eth0');
    ns(host, 'ip', 'route', 'add', 'default', 'via', `${lan}.1`);
    ns(nat, 'sysctl', '-qw', 'net.ipv4.ip_forward=1');
    must(ns(nat, 'nft', 'add table ip nat; add chain ip nat post { type nat hook postrouting priority 100 ; } ; add rule ip nat post oifname "wan" masquerade'), 'nat');
    // like any home router: nothing unasked-for from outside reaches the router itself (so an early probe
    // from the other side is dropped instead of leaving a conntrack entry that would move the mapping)
    must(ns(nat, 'nft', 'add table ip fw; add chain ip fw input { type filter hook input priority 0 ; policy accept ; } ; add rule ip fw input iifname "wan" ct state established,related accept ; add rule ip fw input iifname "wan" drop'), 'router firewall');
  }
  check(ping('k-hosta', '198.51.100.1').status === 0, 'the desk reaches "the internet" through its NAT');

  // ---- the mesh: addresses and names from Keeper's own derivation
  const NET = '3f2a9c1d7e6b5a40';
  const A = 'deskaaaaaaaaaaaa'.replace(/[01lo]/g, 'a');
  const B = 'laptopbbbbbbbbbb'.replace(/[01lo]/g, 'b');
  const p6 = K.networkPrefix6(NET);
  const p4 = K.networkPrefix4(NET, ['10.0.1.0/24', '198.51.100.0/24']);
  const a6 = K.deviceAddr6(NET, A), b6 = K.deviceAddr6(NET, B);
  const a4 = K.deviceAddr4(p4, NET, A), b4 = K.deviceAddr4(p4, NET, B, [a4]);
  const IF = K.linuxIface(NET);
  note(`network ${p6} and ${p4}; desk ${a6} / ${a4}; laptop ${b6} / ${b4}; interface ${IF}`);
  const wa = K.newWgKey(), wb = K.newWgKey();
  const confA = K.setconf({ priv: wa.priv, listenPort: 51000, peers: [{ pub: wb.pub, allowed: K.allowedIps({ a6: b6, a4: b4 }), endpoint: '127.0.0.1:50001' }] });
  const ctx = (who) => ({ noV6: !V6, os: 'linux', impl: 'kernel', iface: IF, a6: who === 'a' ? a6 : b6, a4: who === 'a' ? a4 : b4, prefix6: p6, prefix4: p4, mtu: 1280, conf: confA, wg: 'wg' });

  // ---- the real WireGuard interface, if this kernel has it
  const up = K.ifaceUp(ctx('a'));
  const wgTry = ns('k-hosta', ...[up[0].file, ...up[0].args]);
  if (wgTry.status === 0) note('this kernel has WireGuard: ip link add … type wireguard worked');
  else note(`WireGuard in the kernel: not available here (${wgTry.stderr.trim()}); a veth pair stands in for the tunnel`);
  ns('k-hosta', 'ip', 'link', 'del', IF);

  // stand-in tunnel: a point-to-point veth with the mesh interface's name, no ARP (layer 3 like WireGuard)
  veth('k-hosta', IF, 'k-hostb', IF);
  // With ARP off a veth sends to its own hardware address; giving both ends the same one makes it a clean point-to-point link.
  for (const h of ['k-hosta', 'k-hostb']) { ns(h, 'ip', 'link', 'set', 'dev', IF, 'arp', 'off'); ns(h, 'ip', 'link', 'set', 'dev', IF, 'address', '02:6b:6d:00:00:01'); }
  const rest = (s) => s.filter((x) => !(x.args.includes('wireguard') || x.args[0] === 'setconf'));
  check((await runPlan('k-hosta', rest(K.ifaceUp(ctx('a'))), 'desk interface')) && (await runPlan('k-hostb', rest(K.ifaceUp(ctx('b'))), 'laptop interface')), 'Keeper’s addresses and MTU go on the mesh interface (commands pass the guard and the kernel)');
  const show = ns('k-hosta', 'ip', '-o', 'addr', 'show', 'dev', IF).stdout;
  if (!V6) note('this kernel has no IPv6 (/proc/sys/net/ipv6 is missing): Keeper’s plan goes IPv4-only, as it does on such systems');
  check((!V6 || show.includes(`${a6}/48`)) && show.includes(`${a4}/16`), V6 ? `the desk has ${a6}/48 and ${a4}/16` : `the desk has ${a4}/16 (IPv4 only)`);
  check(/mtu 1280/.test(ns('k-hosta', 'ip', 'link', 'show', IF).stdout), 'MTU 1280');
  await new Promise((r) => setTimeout(r, 1500)); // IPv6 duplicate address detection
  if (V6) check(ns('k-hosta', 'ping', '-c2', '-W2', b6).status === 0, `ping the laptop’s mesh IPv6 address ${b6}`);
  check(ping('k-hosta', b4).status === 0, `ping the laptop’s mesh IPv4 address ${b4}`);
  check(ping('k-hostb', a4).status === 0, `and the other way (${a4})`);

  // ---- STUN and hole punching through the two NATs, with Keeper's real data path
  const stunP = run('ip', ['netns', 'exec', 'k-inet', process.execPath, path.join(OUT, 'child.cjs'), 'stun', JSON.stringify({ ip: '198.51.100.1' })], { stdio: ['pipe', 'pipe', 'inherit'] });
  await lineOf(stunP, 'ready');
  const key = require('node:crypto').randomBytes(32).toString('hex');
  const names = { desk: { a6, a4 }, laptop: { a6: b6, a4: b4 } };
  const da = run('ip', ['netns', 'exec', 'k-hosta', process.execPath, path.join(OUT, 'child.cjs'), 'device', JSON.stringify({ me: A, peer: B, key, stun: '198.51.100.1', lan: '10.0.1.2' })], { stdio: ['pipe', 'pipe', 'inherit'] });
  const db = run('ip', ['netns', 'exec', 'k-hostb', process.execPath, path.join(OUT, 'child.cjs'), 'device', JSON.stringify({ me: B, peer: A, key, stun: '198.51.100.1', lan: '10.0.2.2', dns: { addr: V6 ? b6 : b4, names } })], { stdio: ['pipe', 'pipe', 'inherit'] });
  const ra = await lineOf(da, 'ready');
  const rb = await lineOf(db, 'ready');
  check(ra.stun?.ip === '198.51.100.11' && rb.stun?.ip === '198.51.100.12', `STUN through the NATs: desk is ${ra.stun?.ip}:${ra.stun?.port}, laptop is ${rb.stun?.ip}:${rb.stun?.port}`);
  da.stdin.write(JSON.stringify({ cmd: 'punch', cands: rb.cands }) + '\n');
  db.stdin.write(JSON.stringify({ cmd: 'punch', cands: ra.cands }) + '\n');
  const pa = await lineOf(da, 'punched');
  const pb = await lineOf(db, 'punched');
  if (pa.state !== 'direct') note(`punch: ${JSON.stringify(pa)} / ${JSON.stringify(pb)} / cands ${JSON.stringify(ra.cands)} ${JSON.stringify(rb.cands)}`);
  check(pa.state === 'direct' && pb.state === 'direct' && pa.path === 'internet', `simultaneous hole punching through both NATs: Direct (internet), desk → ${pa.best?.host}:${pa.best?.port} (${pa.best?.rtt} ms), laptop → ${pb.best?.host}:${pb.best?.port}`);
  da.stdin.write(JSON.stringify({ cmd: 'send' }) + '\n');
  const sent = await lineOf(da, 'sent');
  await new Promise((r) => setTimeout(r, 400));
  db.stdin.write(JSON.stringify({ cmd: 'received' }) + '\n');
  const got = await lineOf(db, 'received');
  check(got.got.includes(sent.hex), 'a WireGuard packet from the desk’s WireGuard port → its shim → the punched path → the laptop’s WireGuard port, intact');

  // ---- names: the responder on the laptop's mesh address
  const ask = (name, type) => {
    const r = ns('k-hosta', process.execPath, path.join(OUT, 'child.cjs'), 'dnsq', JSON.stringify({ server: V6 ? b6 : b4, name, type }));
    try { return JSON.parse(r.stdout.trim().split('\n').pop()); } catch { return { error: r.stderr }; }
  };
  const q6 = ask('laptop.keeper', 28);
  const q4 = ask('laptop.keeper', 1);
  check(q6.rcode === 0 && q6.answers?.[0] === b6, `the desk asks the laptop’s responder (${V6 ? b6 : b4}:53): laptop.keeper AAAA → ${q6.answers?.[0]}`);
  check(q4.answers?.[0] === b4 && ask('desk.keeper', 1).answers?.[0] === a4, `laptop.keeper A → ${q4.answers?.[0]}, desk.keeper A → ${a4}`);
  check(ask('ghost.keeper', 28).rcode === 3 && ask('example.com', 1).rcode === 5, 'unknown mesh names: no such name; other names: refused');
  check(ping('k-hosta', q4.answers?.[0] ?? '127.0.0.9').status === 0, `ping laptop.keeper at the address its name resolved to (${q4.answers?.[0]})`);
  note('split DNS itself (resolvectl domain ~keeper) was not run: this container has no systemd-resolved');

  // ---- access rules on the laptop: the desk is a guest allowed port 8080 only
  const srv = run('ip', ['netns', 'exec', 'k-hostb', process.execPath, '-e', "for (const p of [22, 8080]) require('net').createServer((c) => { c.on('error', () => undefined); c.end('hi'); }).listen(p, '0.0.0.0')"], { stdio: 'ignore' });
  const tcp = (port) => ns('k-hosta', process.execPath, '-e', `const s=require('net').connect(${port},'${b4}',()=>{process.exit(0)});s.on('error',()=>process.exit(2));setTimeout(()=>process.exit(3),1500)`).status;
  for (let i = 0; i < 40 && tcp(8080) !== 0; i++) await new Promise((r) => setTimeout(r, 250));
  check(tcp(22) === 0 && tcp(8080) === 0, 'before rules: both ports open');
  const acl = K.compileAcl([{ id: 'r', from: 'guests', proto: 'tcp', ports: '8080' }], [{ device: A, role: 'guest', addrs: [a6, a4] }]);
  await runPlan('k-hostb', K.aclUp('linux', IF, acl, 53), 'acl');
  check(tcp(8080) === 0, 'guest rule: port 8080 allowed');
  check(tcp(22) !== 0, 'guest rule: port 22 dropped on the mesh interface');
  check(ping('k-hosta', b4).status === 0 && ask('laptop.keeper', 28).rcode === 0, 'ping and mesh names still work for the guest');
  check(ns('k-natb', 'sh', '-c', 'true').status === 0 && ns('k-hostb', 'nft', 'list', 'table', 'inet', K.NAMES.nftAcl).status === 0, 'the rules live in Keeper’s own table');
  const owned = K.compileAcl([], [{ device: A, role: 'own', addrs: [a6, a4] }]);
  await runPlan('k-hostb', K.aclUp('linux', IF, owned, 53), 'acl own');
  check(tcp(22) === 0, 'as an own device: every port');
  srv.kill();

  // ---- exit node: the laptop forwards and NATs; the desk routes everything through it
  const whoSeen = () => {
    const r = ns('k-hosta', process.execPath, '-e', "require('http').get('http://198.51.100.1:8000',r=>{let b='';r.on('data',d=>b+=d);r.on('end',()=>{console.log(b);process.exit(0)})}).on('error',()=>process.exit(2)).setTimeout(2000,()=>process.exit(3))");
    return r.status === 0 ? r.stdout.trim() : `failed (${r.status})`;
  };
  const web = run('ip', ['netns', 'exec', 'k-inet', process.execPath, '-e', "require('http').createServer((q,s)=>s.end(q.socket.remoteAddress.replace('::ffff:',''))).listen(8000,'198.51.100.1')"], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 500));
  check(whoSeen() === '198.51.100.11', 'before: the desk reaches the web from its own address (198.51.100.11)');
  const fwdBefore = ns('k-hostb', 'cat', '/proc/sys/net/ipv4/ip_forward').stdout.trim();
  await runPlan('k-hostb', K.exitServeUp({ os: 'linux', iface: IF, prefix6: p6, prefix4: p4, noV6: !V6 }), 'exit serve');
  const use = { noV6: !V6, os: 'linux', iface: IF, bypass: ['198.51.100.12'], gw4: '10.0.1.1', wan: 'eth0', killSwitch: true, allowLan: false, lan: ['10.0.1.0/24'] };
  await runPlan('k-hosta', K.exitUseUp(use), 'exit use');
  check(whoSeen() === '198.51.100.12', `with the laptop as exit node, the web sees ${whoSeen()} (the laptop’s side)`);
  check(ping('k-hosta', '10.0.1.1', 1).status !== 0, 'kill switch with “keep the local network” off: the desk’s own router is not reachable outside the tunnel');
  ns('k-hosta', 'ip', 'link', 'set', IF, 'down');
  check(whoSeen().startsWith('failed'), 'tunnel down: traffic is blocked, not leaked around it (kill switch)');
  ns('k-hosta', 'ip', 'link', 'set', IF, 'up');

  // ---- cleanup: exactly what Keeper recorded, newest first
  const appliedA = { ...K.emptyApplied('linux'), ifaces: [{ os: 'linux', iface: IF, impl: 'kernel' }], exitUse: use, acl: false };
  const appliedB = { ...K.emptyApplied('linux'), exitServe: { iface: IF, before: { v4: fwdBefore, v6: '0' }, noV6: !V6 }, acl: true };
  await runPlan('k-hosta', K.cleanupPlan(appliedA), 'cleanup desk');
  await runPlan('k-hostb', K.cleanupPlan(appliedB), 'cleanup laptop');
  check(whoSeen() === '198.51.100.11', 'after cleanup: the desk’s internet is back to normal (198.51.100.11)');
  check(ping('k-hosta', '10.0.1.1', 1).status === 0, 'after cleanup: the local network is reachable again');
  check(ns('k-hosta', 'nft', 'list', 'tables').stdout.trim() === '' && ns('k-hostb', 'nft', 'list', 'tables').stdout.trim() === '', 'after cleanup: no Keeper nftables tables left');
  check(ns('k-hosta', 'ip', 'link', 'show', IF).status !== 0, 'after cleanup: the mesh interface is gone');
  check(ns('k-hostb', 'cat', '/proc/sys/net/ipv4/ip_forward').stdout.trim() === fwdBefore, `after cleanup: forwarding is back as it was (${fwdBefore})`);
  check(!/0\.0\.0\.0\/1|128\.0\.0\.0\/1/.test(ns('k-hosta', 'ip', 'route').stdout), 'after cleanup: no split default routes left');
  await runPlan('k-hosta', K.cleanupPlan(appliedA), 'cleanup twice');
  check(true, 'the cleanup plan runs twice without harm');

  for (const p of [da, db]) p.stdin.write(JSON.stringify({ cmd: 'quit' }) + '\n');
  web.kill();

  await realWireGuard({ a4, b4, p4, p6, A, B });
  stunP.kill();
}

/** wireguard-go: $KEEPER_WG_GO, or built from the pinned source snapshot (checked) with the Go toolchain here. */
function wireguardGo() {
  if (process.env.KEEPER_WG_GO && fs.existsSync(process.env.KEEPER_WG_GO)) return { bin: process.env.KEEPER_WG_GO, how: 'given by KEEPER_WG_GO' };
  const go = sh(['go', 'version']);
  if (go.status !== 0) return { why: 'no Go toolchain here to build it' };
  const src = K.WIREGUARD_GO_SOURCE;
  const dir = path.join(os.tmpdir(), `keeper-wggo-${src.sha256.slice(0, 12)}`);
  const bin = path.join(dir, 'wireguard-go');
  if (!fs.existsSync(bin)) {
    fs.mkdirSync(dir, { recursive: true });
    const tar = path.join(dir, 'src.tar.xz');
    const dl = sh(['curl', '-fsSL', '-o', tar, src.url]);
    if (dl.status !== 0) return { why: `the pinned source could not be downloaded (${(dl.stderr || '').trim().slice(0, 120)})` };
    const sum = require('node:crypto').createHash('sha256').update(fs.readFileSync(tar)).digest('hex');
    if (sum !== src.sha256) { fs.rmSync(tar); return { why: `the downloaded source does not match the pinned SHA-256 (${sum})` }; }
    if (sh(['tar', '-xJf', tar, '-C', dir]).status !== 0) return { why: 'the source could not be unpacked' };
    const top = fs.readdirSync(dir).find((d) => d.startsWith('wireguard-go-'));
    const b = sh(['go', 'build', '-trimpath', '-ldflags=-s -w -buildid=', '-o', bin, '.'], { cwd: path.join(dir, top), env: { ...process.env, KEEPER_DEFAULTS: 'before-1.0', GOFLAGS: '-mod=readonly', GOTOOLCHAIN: 'local', CGO_ENABLED: '0' }, timeout: 600_000 });
    if (b.status !== 0) return { why: `go build failed: ${(b.stderr || '').trim().slice(0, 200)}` };
  }
  const sum = require('node:crypto').createHash('sha256').update(fs.readFileSync(bin)).digest('hex');
  return { bin, how: `built from wireguard-go ${K.WIREGUARD_GO_VERSION} (source SHA-256 ${src.sha256.slice(0, 12)}… checked) with ${go.stdout.trim().split(' ')[2]}; binary SHA-256 ${sum}`, sum };
}

/** Real WireGuard between the two devices: through Keeper's shims first, then handed off, then back. */
async function realWireGuard({ a4, b4, p4, p6, A, B }) {
  const wgo = wireguardGo();
  if (!wgo.bin) { note(`real WireGuard part skipped: ${wgo.why}`); return; }
  note(`wireguard-go: ${wgo.how}`);
  const local = K.WIREGUARD_GO_LOCAL_BUILD;
  if (wgo.sum && local) note(wgo.sum === local.sha256 ? `the build is reproducible: same SHA-256 as recorded for ${local.go} on ${local.target}` : `this build's SHA-256 differs from the one recorded for ${local.go} on ${local.target} (another Go version?)`);
  const IFA = 'km-aaa1', IFB = 'km-bbb2', WGP = 51820;
  const wa = K.newWgKey(), wb = K.newWgKey();
  const ctx = (who) => ({ noV6: true, os: 'linux', impl: 'wireguard-go', bin: wgo.bin, iface: who === 'a' ? IFA : IFB, a6: '', a4: who === 'a' ? a4 : b4, prefix6: p6, prefix4: p4, mtu: 1280, conf: K.uapiSet({ priv: who === 'a' ? wa.priv : wb.priv, listenPort: WGP, peers: [] }) });
  await runPlan('k-hosta', K.ifaceUp(ctx('a')), 'wireguard-go desk', wgo.bin);
  await runPlan('k-hostb', K.ifaceUp(ctx('b')), 'wireguard-go laptop', wgo.bin);
  check(/tun/.test(ns('k-hosta', 'ip', '-d', 'link', 'show', IFA).stdout) && ns('k-hostb', 'ip', 'link', 'show', IFB).status === 0, `Keeper’s helper steps started wireguard-go on TUN interfaces ${IFA} and ${IFB} (checked by the guard, configured over its control socket)`);
  const key = require('node:crypto').randomBytes(32).toString('hex');
  const child = (n, o) => run('ip', ['netns', 'exec', n, process.execPath, path.join(OUT, 'child.cjs'), 'wgdevice', JSON.stringify(o)], { stdio: ['pipe', 'pipe', 'inherit'] });
  const da = child('k-hosta', { me: A, peer: B, key, stun: '198.51.100.1', lan: '10.0.1.2', iface: IFA, wgPort: WGP, peerWgPort: WGP, peerPub: wb.pub, peerAddr: b4, wgGo: wgo.bin, lib: path.join(OUT, 'lib.cjs') });
  const db = child('k-hostb', { me: B, peer: A, key, stun: '198.51.100.1', lan: '10.0.2.2', iface: IFB, wgPort: WGP, peerWgPort: WGP, peerPub: wa.pub, peerAddr: a4, wgGo: wgo.bin, lib: path.join(OUT, 'lib.cjs') });
  const ra = await lineOf(da, 'ready');
  const rb = await lineOf(db, 'ready');
  da.stdin.write(JSON.stringify({ cmd: 'punch', cands: rb.cands }) + '\n');
  db.stdin.write(JSON.stringify({ cmd: 'punch', cands: ra.cands }) + '\n');
  const pa = await lineOf(da, 'punched');
  const pb = await lineOf(db, 'punched');
  check(pa.state === 'direct' && pb.state === 'direct', `Keeper’s data path punched through both NATs again (desk → ${pa.best?.host}:${pa.best?.port}); WireGuard sees each peer at 127.0.0.1:<shim>`);
  const counters = async (p) => { p.stdin.write(JSON.stringify({ cmd: 'counters' }) + '\n'); return lineOf(p, 'counters'); };
  let ok = false;
  for (let i = 0; i < 20 && !ok; i++) ok = ping('k-hosta', b4, 1).status === 0;
  const c1 = await counters(da);
  check(ok && ping('k-hostb', a4, 1).status === 0, `a real WireGuard handshake, then ping ${b4} ↔ ${a4} over wireguard-go, through Keeper’s shims and the punched path`);
  check(c1.tx > 0 && c1.rx > 0 && c1.wg?.lastHandshake > 0 && /^127\.0\.0\.1:/.test(c1.wg?.endpoint ?? ''), `those packets passed through Keeper (shim counters: ${c1.tx} bytes out, ${c1.rx} in; WireGuard’s endpoint ${c1.wg?.endpoint})`);

  // ---- the handoff: WireGuard gets the direct endpoint itself
  for (const p of [da, db]) p.stdin.write(JSON.stringify({ cmd: 'handoff' }) + '\n');
  const pinger = run('ip', ['netns', 'exec', 'k-hosta', 'python3', '-I', '-c', `import subprocess,time\nwhile True:\n  subprocess.run(['python3','-I','-c',${JSON.stringify(PYPING)},'${b4}','1'])\n  time.sleep(0.3)`], { stdio: 'ignore' });
  const until = async (p, state, ms = 40_000) => {
    const end = Date.now() + ms;
    for (;;) {
      const m = await lineOf(p, 'handoff', Math.max(1000, end - Date.now())).catch(() => null);
      if (m?.state === state) return m;
      if (!m || Date.now() > end) return null;
    }
  };
  const ha = await until(da, 'direct');
  const hb = await until(db, 'direct');
  pinger.kill();
  check(!!ha && !!hb, `direct handoff: both WireGuards now send to each other themselves (desk → ${ha?.endpoint}, laptop → ${hb?.endpoint})`);
  const s0 = await counters(da);
  check(s0.wg?.endpoint === '198.51.100.12:51820', `WireGuard’s own endpoint for the laptop is its NAT’s public address with WireGuard’s port: ${s0.wg?.endpoint}`);
  let pings = 0;
  for (let i = 0; i < 5; i++) pings += ping('k-hosta', b4, 2).status === 0 ? 1 : 0;
  const s1 = await counters(da);
  check(pings === 5 && s1.wg.rx > s0.wg.rx, `5 of 5 pings over WireGuard after the handoff (WireGuard received ${s1.wg.rx - s0.wg.rx} more bytes)`);
  check(s1.tx === s0.tx && s1.rx === s0.rx, `…and none of those packets passed through Keeper: the shim counters did not move (${s0.tx}/${s0.rx})`);

  // ---- the direct path breaks: only WireGuard's port is blocked at the laptop's router; Keeper's own path still works
  must(ns('k-natb', 'nft', 'add table ip block; add chain ip block wgonly { type filter hook forward priority -10 ; } ; add rule ip block wgonly udp dport 51820 drop ; add rule ip block wgonly udp sport 51820 drop'), 'block');
  const pinger2 = run('ip', ['netns', 'exec', 'k-hosta', 'python3', '-I', '-c', `import subprocess,time\nwhile True:\n  subprocess.run(['python3','-I','-c',${JSON.stringify(PYPING)},'${b4}','1'])\n  time.sleep(0.3)`], { stdio: 'ignore' });
  const fa = await until(da, 'shim', 30_000);
  const fb = await until(db, 'shim', 30_000);
  pinger2.kill();
  check(!!fa || !!fb, `with WireGuard’s direct path blocked, Keeper noticed (sending, nothing back) and pointed WireGuard back at the shim (desk: ${fa ? 'shim' : 'still ' + 'direct'}, laptop: ${fb ? 'shim' : 'still direct'})`);
  const f0 = await counters(da);
  let back = false;
  for (let i = 0; i < 15 && !back; i++) back = ping('k-hosta', b4, 1).status === 0;
  const f1 = await counters(da);
  check(back && f1.tx > f0.tx && /^127\.0\.0\.1:/.test(f1.wg?.endpoint ?? ''), `pings work again through Keeper’s shim (shim counters moving again, WireGuard’s endpoint ${f1.wg?.endpoint})`);
  ns('k-natb', 'nft', 'delete table ip block');

  for (const p of [da, db]) p.stdin.write(JSON.stringify({ cmd: 'quit' }) + '\n');
  await runPlan('k-hosta', K.ifaceDown({ os: 'linux', iface: IFA, impl: 'wireguard-go' }), 'down desk');
  await runPlan('k-hostb', K.ifaceDown({ os: 'linux', iface: IFB, impl: 'wireguard-go' }), 'down laptop');
  await new Promise((r) => setTimeout(r, 500));
  check(ns('k-hosta', 'ip', 'link', 'show', IFA).status !== 0 && !fs.existsSync(`/var/run/wireguard/${IFA}.sock`), 'cleanup: the interfaces and wireguard-go’s control sockets are gone');
}

/** Every JSON line a child prints is kept, so nothing is lost while the script waits on another child. */
function lineOf(p, ev, ms = 15000) {
  if (!p.msgs) {
    p.msgs = [];
    p.waiters = [];
    let buf = '';
    p.stdout.on('data', (d) => {
      buf += d;
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const l of lines) {
        let m;
        try { m = JSON.parse(l); } catch { continue; }
        if (process.env.NETNS_DEBUG) console.log('child', JSON.stringify(m).slice(0, 300));
        p.msgs.push(m);
      }
      for (const w of p.waiters.splice(0)) w();
    });
  }
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { const i = p.waiters.indexOf(look); if (i >= 0) p.waiters.splice(i, 1); reject(new Error(`timed out waiting for ${ev}`)); }, ms);
    const look = () => {
      const i = p.msgs.findIndex((m) => m.ev === ev || m.ev === 'error');
      if (i < 0) return void p.waiters.push(look);
      const [m] = p.msgs.splice(i, 1);
      clearTimeout(t);
      if (m.ev === 'error') reject(new Error(m.error));
      else resolve(m);
    };
    look();
  });
}

main()
  .catch((e) => { console.log('FAIL', e.message); process.exitCode = 1; })
  .finally(() => { teardown(); fs.rmSync(OUT, { recursive: true, force: true }); setTimeout(() => process.exit(), 100); });
void http;
