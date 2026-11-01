// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper-to-Keeper remote access: the direct UDP carrier, moving connections
// between carriers, help mode, the audit log, fleet search, remote actions,
// unattended service definitions, the Wayland portal and session extras.
import crypto from 'node:crypto';
import dgram from 'node:dgram';
import { afterEach, describe, expect, it } from 'vitest';
import { pipe, Session } from '../core/link/channel';
import { addEntry, auditCsv, auditJson, filterAudit, type AuditEntry } from '../core/link/audit';
import { clipOutput, powerCommand, printCommand, shellCommand, sysInfoLines } from '../core/link/actions';
import { allowedCandidates, better, CARRIER_RANK, hostCandidates, isPrivateV4, parseOffer, retryDelay, wantsDirect } from '../core/link/direct';
import { cleanMeta, commandHash, groupDevices, lastSeenLabel, normalizeTags, searchDevices } from '../core/link/fleet';
import { formatCode, helpAsHelper, helpAsHost, helpLink, helpTag, helpTopic, newHelpCode, newHelpPassword, normalizeCode, normalizePassword, openHelpNote, parseHelpLink, sealHelpNote, HELP_ALLOWED_STREAMS } from '../core/link/help';
import { call, Mux, serve } from '../core/link/mux';
import { allowed, PERMISSIONS } from '../core/link/perms';
import { asCarrier, decodeHello, encodeHello, firstMessage, prepend, Resumable } from '../core/link/resume';
import { bindingRequest, bindingResponse, isStun, parseBindingResponse, stunTarget } from '../core/link/stun';
import { open, P, seal, UdpPath, type Endpoint } from '../core/link/udp';
import { allBounds, allLayout, audioPlan, displayAt, encodingPlan, followDecision, inviteValid, mapFromAll, orderCodecs, passes, pickMonitorDevice, privacyPlan, sanitizeStroke, DEFAULT_PASSTHROUGH } from '../core/screen/extras';
import { evdevButton, evdevKey, parseStreams, requestPath, responseError, selectDevicesOptions, toStream } from '../core/screen/portal';
import type { HostDisplay } from '../core/screen/types';
import { canEnableUnattended, definition, installSteps, launchdPlist, stagedName, systemdUnit, uninstallSteps, windowsServiceSource, LINUX_UNIT_PATH } from '../core/screen/unattended';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- STUN

describe('STUN', () => {
  it('builds a binding request and reads the XOR-mapped address back', () => {
    const { packet, txid } = bindingRequest();
    expect(packet.length).toBe(20);
    expect(isStun(packet)).toBe(true);
    const resp = bindingResponse(txid, { address: '203.0.113.7', port: 54321 });
    expect(parseBindingResponse(resp, txid)).toEqual({ address: '203.0.113.7', port: 54321 });
    expect(parseBindingResponse(resp, crypto.randomBytes(12))).toBeNull();
    expect(parseBindingResponse(Buffer.from('nope'))).toBeNull();
  });
  it('reads STUN entries from the setting', () => {
    expect(stunTarget('stun:stun.example.org:3478')).toEqual({ host: 'stun.example.org', port: 3478 });
    expect(stunTarget('stun.example.org')).toEqual({ host: 'stun.example.org', port: 3478 });
    expect(stunTarget('turn:u:p@x:3478')).toBeNull();
  });
});

// ---------------------------------------------------------------- the UDP path

const socks: dgram.Socket[] = [];
afterEach(() => {
  for (const s of socks.splice(0)) s.close();
});

async function udpPair(opts: { loss?: number } = {}) {
  const key = crypto.randomBytes(32);
  const conn = crypto.randomInt(2 ** 31);
  const mk = async () => {
    const s = dgram.createSocket('udp4');
    socks.push(s);
    await new Promise<void>((r) => s.bind(0, '127.0.0.1', () => r()));
    return s;
  };
  const sa = await mk();
  const sb = await mk();
  const a = new UdpPath(sa, key, conn, 'controlling', { loss: opts.loss });
  const b = new UdpPath(sb, key, conn, 'controlled', { loss: opts.loss });
  sa.on('message', (m, r) => a.handle(m, { address: r.address, port: r.port }));
  sb.on('message', (m, r) => b.handle(m, { address: r.address, port: r.port }));
  const ea: Endpoint = { address: '127.0.0.1', port: sa.address().port };
  const eb: Endpoint = { address: '127.0.0.1', port: sb.address().port };
  // A dead candidate first: punching must try all at once.
  const [ra, rb] = await Promise.all([a.punch([{ address: '127.0.0.1', port: 9 }, eb]), b.punch([ea])]);
  return { a, b, ra, rb, ea, eb, key, conn };
}

describe('direct UDP path', () => {
  it('only accepts packets with the right key and connection', () => {
    const key = crypto.randomBytes(32);
    const p = seal(key, P.Data, 7, Buffer.from('hi'));
    expect(open(key, 7, p)?.body.toString()).toBe('hi');
    expect(open(key, 8, p)).toBeNull();
    expect(open(crypto.randomBytes(32), 7, p)).toBeNull();
    const bad = Buffer.from(p);
    bad[7] ^= 1;
    expect(open(key, 7, bad)).toBeNull();
  });

  it('punches through to the address that answers and carries messages in order', async () => {
    const { a, b, ra, rb, ea, eb } = await udpPair();
    expect(ra).toEqual(eb);
    expect(rb).toEqual(ea);
    const wa = a.wire();
    const wb = b.wire();
    expect(wa.kind).toBe('direct');
    const got: Buffer[] = [];
    wb.onmessage = (m) => got.push(Buffer.from(m));
    const msgs = Array.from({ length: 40 }, (_, i) => crypto.randomBytes(i * 977));
    for (const m of msgs) wa.send(m);
    for (let i = 0; i < 100 && got.length < msgs.length; i++) await wait(20);
    expect(got.length).toBe(msgs.length);
    got.forEach((g, i) => expect(g.equals(msgs[i])).toBe(true));
    wa.close('done');
    for (let i = 0; i < 50 && !wb.closed; i++) await wait(10);
    expect(wb.closed).toBe(true);
  });

  it('recovers from 15% packet loss with everything intact', async () => {
    const { a, b } = await udpPair({ loss: 0.15 });
    const wa = a.wire();
    const wb = b.wire();
    const got: Buffer[] = [];
    wb.onmessage = (m) => got.push(Buffer.from(m));
    const big = crypto.randomBytes(400_000);
    wa.send(big);
    wa.send(Buffer.from('after'));
    for (let i = 0; i < 400 && got.length < 2; i++) await wait(25);
    expect(got[0]?.equals(big)).toBe(true);
    expect(got[1]?.toString()).toBe('after');
    expect(wa.stats.retransmits).toBeGreaterThan(0);
    wa.close();
  });

  it('gives up when no candidate answers', async () => {
    const s = dgram.createSocket('udp4');
    socks.push(s);
    await new Promise<void>((r) => s.bind(0, '127.0.0.1', () => r()));
    const p = new UdpPath(s, crypto.randomBytes(32), 1, 'controlling');
    await expect(p.punch([{ address: '127.0.0.1', port: 9 }], 400)).rejects.toThrow(/No direct path/);
  });
});

// ---------------------------------------------------------------- candidates and ranking

describe('choosing the direct path', () => {
  it('ranks direct above the tunnel and relay, below a local connection', () => {
    expect(better('direct', 'relay')).toBe(true);
    expect(better('direct', 'tunnel')).toBe(true);
    expect(better('direct', 'lan')).toBe(false);
    expect(CARRIER_RANK.local).toBeGreaterThan(CARRIER_RANK.lan);
    expect(wantsDirect('relay')).toBe(true);
    expect(wantsDirect('lan')).toBe(false);
  });
  it('keeps only private addresses for "This network only"', () => {
    const c = [
      { type: 'host' as const, address: '192.168.1.5', port: 4000 },
      { type: 'srflx' as const, address: '198.51.100.4', port: 5000 },
      { type: 'host' as const, address: '100.70.1.2', port: 4000 },
    ];
    expect(allowedCandidates(c, 'lan').map((x) => x.address)).toEqual(['192.168.1.5', '100.70.1.2']);
    expect(allowedCandidates(c, 'internet')).toHaveLength(3);
    expect(isPrivateV4('172.20.0.1')).toBe(true);
    expect(isPrivateV4('8.8.8.8')).toBe(false);
  });
  it('gathers host candidates from the network cards', () => {
    const c = hostCandidates({ eth0: [{ family: 'IPv4', address: '10.0.0.2', internal: false }, { family: 'IPv6', address: 'fe80::1', internal: false }], lo: [{ family: 'IPv4', address: '127.0.0.1', internal: true }] }, 5555);
    expect(c).toEqual([{ type: 'host', address: '10.0.0.2', port: 5555 }]);
  });
  it('checks offers from the other device', () => {
    const key = crypto.randomBytes(32).toString('base64');
    expect(parseOffer({ v: 1, conn: 5, key, candidates: [{ type: 'srflx', address: '198.51.100.1', port: 1 }] }, 'lan')?.candidates).toEqual([]);
    expect(parseOffer({ v: 1, conn: 5, key: 'short', candidates: [] }, 'internet')).toBeNull();
    expect(parseOffer({ v: 2 }, 'internet')).toBeNull();
    expect(retryDelay(0)).toBe(60_000);
    expect(retryDelay(20)).toBe(30 * 60_000);
  });
});

// ---------------------------------------------------------------- moving between carriers

/** Two sessions over an in-memory pipe, like a relay or direct path would give. */
function sessionPair(kind: 'relay' | 'direct') {
  const [x, y] = pipe(kind);
  const k1 = crypto.randomBytes(32);
  const k2 = crypto.randomBytes(32);
  const pub = crypto.randomBytes(32);
  return [new Session(x, k1, k2, pub), new Session(y, k2, k1, pub)] as const;
}

describe('one connection across carriers', () => {
  it('reads hellos', () => {
    expect(decodeHello(encodeHello({ v: 1, id: 'abcdefgh1234', recv: 3 }))).toEqual({ v: 1, id: 'abcdefgh1234', recv: 3 });
    expect(decodeHello(new Uint8Array([0xf0, 1, 2]))).toBeNull();
    expect(decodeHello(encodeHello({ v: 1, id: 'x', recv: 0 }))).toBeNull();
  });

  it('moves live streams from the relay to a direct path and back without losing a byte', async () => {
    const [r1, r2] = sessionPair('relay');
    const A = new Resumable();
    const B = new Resumable(A.id);
    A.adopt(r1, 0);
    B.adopt(r2, 0);
    const ma = new Mux(asCarrier(A), true);
    const mb = new Mux(asCarrier(B), false);
    const received: Buffer[] = [];
    let ended = false;
    mb.onstream = (st) => {
      st.ondata = (c) => void received.push(Buffer.from(c));
      st.onend = () => (ended = true);
      void st.start();
    };
    const st = ma.open({ k: 'data' });
    const payload = crypto.randomBytes(3_000_000);
    const writing = (async () => {
      for (let off = 0; off < payload.length; off += 100_000) {
        await st.write(payload.subarray(off, off + 100_000));
        if (off === 1_000_000) {
          // A direct path appears half-way: both sides adopt it.
          const [d1, d2] = sessionPair('direct');
          A.adopt(d1, B.received);
          B.adopt(d2, A.received);
          expect(A.kind).toBe('direct');
        }
        if (off === 2_000_000) {
          // ...and fails: back to the relay.
          A.pathStats();
          (A as unknown as { paths: { path: Session; kind: string }[] }).paths.find((p) => p.kind === 'direct')!.path.close('gone');
        }
      }
      st.end();
    })();
    await writing;
    for (let i = 0; i < 200 && !ended; i++) await wait(10);
    expect(ended).toBe(true);
    expect(Buffer.concat(received).equals(payload)).toBe(true);
    expect(A.kind).toBe('relay');
    expect(await ma.ping()).toBeGreaterThanOrEqual(0);
  });

  it('closes after a grace period when every path is gone', async () => {
    const [r1] = sessionPair('relay');
    const A = new Resumable(undefined, { graceMs: 50 });
    let detached = false;
    let closed = '';
    A.ondetached = () => (detached = true);
    A.onclose = (r) => (closed = r ?? 'closed');
    A.adopt(r1, 0);
    r1.close('lost');
    await wait(100);
    expect(detached).toBe(true);
    expect(closed).toBeTruthy();
  });

  it('reads the first message and hands it on for a peer without hellos', async () => {
    const [x, y] = sessionPair('relay');
    const first = firstMessage(y, 500);
    x.send(new Uint8Array([1, 2, 3]));
    x.send(new Uint8Array([4]));
    const m = await first;
    expect([...m!]).toEqual([1, 2, 3]);
    const c = prepend(y, m!);
    const seen: number[][] = [];
    c.onmessage = (d) => seen.push([...d]);
    await wait(5);
    expect(seen).toEqual([[1, 2, 3], [4]]);
    expect(await firstMessage(x, 30)).toBeNull();
  });

  it('serves requests on a resumed mux', async () => {
    const [r1, r2] = sessionPair('relay');
    const A = new Resumable();
    const B = new Resumable(A.id);
    A.adopt(r1, 0);
    B.adopt(r2, 0);
    const ma = new Mux(asCarrier(A), true);
    const mb = new Mux(asCarrier(B), false);
    mb.onstream = (st) => void serve(st, { echo: (p) => p.x });
    expect(await call(ma, 'echo', { x: 42 })).toBe(42);
  });
});

// ---------------------------------------------------------------- help mode

describe('help mode', () => {
  it('makes codes and passwords that are easy to read out', () => {
    for (let i = 0; i < 50; i++) {
      expect(newHelpCode()).toMatch(/^[1-9]\d{8}$/);
      expect(newHelpPassword()).toMatch(/^[A-Z3-9]{6}$/);
    }
    expect(normalizeCode('123 456-789')).toBe('123456789');
    expect(normalizeCode('12345')).toBe('');
    expect(normalizePassword(' abc oil ')).toBe('ABC011');
    expect(formatCode('123456789')).toBe('123 456 789');
    expect(helpTag('123456789')).toMatch(/^[0-9a-f]{12}$/);
    expect(helpTopic('123 456 789')).toBe(helpTopic('123456789'));
  });

  it('the web viewer derives the same tag and secret in pure JS', async () => {
    const { helpTagWeb, helpSecretWeb } = await import('../core/link/help-web');
    const { helpCompanionSecret } = await import('../core/link/help');
    expect(helpTagWeb('123 456 789')).toBe(helpTag('123456789'));
    expect(Buffer.from(helpSecretWeb('123456789', 'abc oil')).equals(Buffer.from(helpCompanionSecret('123456789', 'ABC011')))).toBe(true);
  });

  it('builds and reads "Ask for help" links', () => {
    expect(helpLink('123 456 789', 'abc234')).toBe('keeper://help?code=123456789&pw=ABC234');
    expect(parseHelpLink('keeper://help?code=123456789&pw=ABC234')).toEqual({ code: '123456789', password: 'ABC234' });
    expect(parseHelpLink('keeper://help?code=123456789')).toEqual({ code: '123456789', password: undefined });
    expect(parseHelpLink('keeper://pair?code=1')).toBeNull();
    expect(parseHelpLink('keeper://help?code=12')).toBeNull();
  });

  it('seals the "where to find me" note with the code and password', () => {
    const n = sealHelpNote('123456789', 'ABC234', { relay: 'https://r.example', relayId: 'abc', at: Date.now() });
    expect(openHelpNote('123456789', 'abc234', n)?.relay).toBe('https://r.example');
    expect(openHelpNote('123456789', 'XYZ999', n)).toBeNull();
    expect(openHelpNote('123456789', 'ABC234', n, Date.now() + 11 * 60_000)).toBeNull();
  });

  const run = async (helperPw: string) => {
    const [h, s] = pipe('lan');
    let misses = 0;
    const host = new Promise<Awaited<ReturnType<typeof helpAsHost>>>((resolve, reject) => {
      s.onmessage = (first) => {
        s.onmessage = undefined;
        helpAsHost(s, first, '123456789', { password: () => 'ABC234', miss: () => misses++ }).then(resolve, reject);
      };
    });
    const helper = helpAsHelper(h, '123 456 789', helperPw, 'Sam');
    return { host, helper, misses: () => misses };
  };

  it('connects with the right code and password, and the channel works', async () => {
    const { host, helper } = await run('abc234');
    const [hs, ss] = await Promise.all([helper, host]);
    expect(ss.name).toBe('Sam');
    const ma = new Mux(hs, true);
    const mb = new Mux(ss.session, false);
    mb.onstream = (st) => void serve(st, { ping: () => 'pong' });
    expect(await call(ma, 'ping')).toBe('pong');
  });

  it('refuses a wrong password and counts it', async () => {
    const { host, helper, misses } = await run('ZZZ999');
    await expect(helper).rejects.toThrow(/not right/);
    await expect(host).rejects.toThrow(/wrong-password/);
    expect(misses()).toBe(1);
  });

  it('allows a helper only the screen', () => {
    expect(HELP_ALLOWED_STREAMS.has('screen.ctl')).toBe(true);
    expect(HELP_ALLOWED_STREAMS.has('file')).toBe(false);
    expect(HELP_ALLOWED_STREAMS.has('term')).toBe(false);
  });
});

// ---------------------------------------------------------------- permissions, audit, fleet, actions

describe('permissions for remote actions', () => {
  it('has a "Run commands" permission, off by default, and gates the new requests', () => {
    expect(PERMISSIONS.some((p) => p.id === 'runCommands')).toBe(true);
    expect(allowed({}, 'exec.run')).toBe(false);
    expect(allowed({ runCommands: true }, 'exec.run')).toBe(true);
    expect(allowed({}, 'power.restart')).toBe(false);
    expect(allowed({ screenControl: true }, 'power.lock')).toBe(true);
    expect(allowed({}, 'sys.info')).toBe(true);
  });
});

describe('audit log', () => {
  it('keeps newest first, filters and exports safely', () => {
    let l: AuditEntry[] = [];
    l = addEntry(l, { at: 1000, kind: 'command', direction: 'in', device: 'd1', deviceName: 'Laptop', title: 'Ran uptime', ok: true });
    l = addEntry(l, { at: 2000, kind: 'transfer', direction: 'out', device: 'd2', deviceName: 'Desk', title: '=SUM(A1)', ok: false });
    expect(l[0].at).toBe(2000);
    expect(filterAudit(l, { device: 'd1' })).toHaveLength(1);
    expect(filterAudit(l, { kind: 'transfer' })[0].deviceName).toBe('Desk');
    expect(filterAudit(l, { q: 'uptime' })).toHaveLength(1);
    const csv = auditCsv(l);
    expect(csv.split('\n')[0]).toBe('time,kind,direction,device,title,detail,ok,ended');
    expect(csv).toContain("'=SUM(A1)");
    expect(JSON.parse(auditJson(l)).entries).toHaveLength(2);
    expect(addEntry([], { at: 1, kind: 'help', direction: 'in', deviceName: 'x', title: 'y', ok: true }, 3)).toHaveLength(1);
    let many: AuditEntry[] = [];
    for (let i = 0; i < 10; i++) many = addEntry(many, { at: i, kind: 'help', direction: 'in', deviceName: 'x', title: 'y', ok: true }, 5);
    expect(many).toHaveLength(5);
  });
});

describe('fleet', () => {
  const rows = [
    { id: 'a', name: 'Studio Mac', os: 'darwin', online: true, meta: cleanMeta({ tags: ['Office', 'design team'], group: 'Office' }) },
    { id: 'b', name: 'Build box', os: 'linux', online: false, lastSeen: 1, meta: cleanMeta({ tags: ['ci'], notes: 'GPU in slot 2' }) },
    { id: 'c', name: 'Mum’s PC', os: 'win32', online: false, meta: cleanMeta({ group: 'Family' }) },
  ];
  it('cleans tags and notes', () => {
    expect(normalizeTags('Office, design team, office')).toEqual(['office', 'design-team']);
    expect(cleanMeta({ commands: [{ id: '', name: '', command: ' uptime ' }] }).commands[0]).toMatchObject({ name: 'uptime', command: 'uptime' });
  });
  it('searches by words, tags, groups and online state', () => {
    expect(searchDevices(rows, 'mac').map((r) => r.id)).toEqual(['a']);
    expect(searchDevices(rows, 'tag:ci').map((r) => r.id)).toEqual(['b']);
    expect(searchDevices(rows, 'group:family').map((r) => r.id)).toEqual(['c']);
    expect(searchDevices(rows, 'offline').map((r) => r.id)).toEqual(['b', 'c']);
    expect(searchDevices(rows, 'gpu').map((r) => r.id)).toEqual(['b']);
    expect(searchDevices(rows, '')).toHaveLength(3);
  });
  it('groups devices with the ungrouped last, and says when each was seen', () => {
    expect(groupDevices(rows).map((g) => g.group)).toEqual(['Family', 'Office', '']);
    expect(lastSeenLabel(10_000_000, true)).toBe('Online');
    expect(lastSeenLabel(10_000_000, false, 10_000_000 - 30 * 60_000)).toBe('Seen 30 min ago');
    expect(lastSeenLabel(10_000_000, false)).toBe('Not seen yet');
    expect(commandHash(' uptime ')).toBe(commandHash('uptime'));
  });
});

describe('remote actions', () => {
  it('uses the right command for each system', () => {
    expect(powerCommand('lock', 'linux')).toEqual({ file: 'loginctl', args: ['lock-session'] });
    expect(powerCommand('restart', 'win32').file).toBe('shutdown.exe');
    expect(powerCommand('sleep', 'darwin').args).toEqual(['sleepnow']);
    expect(printCommand('/tmp/a b.pdf', 'linux')).toEqual({ file: 'lp', args: ['--', '/tmp/a b.pdf'] });
    expect(printCommand("C:\\it's.pdf", 'win32').args[3]).toContain("it''s.pdf");
    expect(shellCommand('echo hi', 'linux', '/bin/bash')).toEqual({ file: '/bin/bash', args: ['-c', 'echo hi'] });
    expect(shellCommand('echo hi', 'linux', 'bash; rm')).toEqual({ file: '/bin/sh', args: ['-c', 'echo hi'] });
    expect(shellCommand('dir', 'win32').file).toBe('cmd.exe');
    expect(clipOutput('x'.repeat(30), 10)).toContain('20 characters left out');
  });
  it('describes the system snapshot', () => {
    const lines = sysInfoLines({ name: 'n', os: 'Linux', release: '6', arch: 'x64', cpus: 8, cpuModel: 'CPU', memTotal: 8 * 1024 ** 3, memFree: 2 * 1024 ** 3, uptime: 3 * 86400, load: [1, 2, 3], disks: [{ mount: '/', total: 100 * 1024 ** 3, free: 50 * 1024 ** 3 }], battery: { percent: 80, charging: true }, user: 'me', keeper: '0.1.0', at: 0 });
    expect(Object.fromEntries(lines)['Memory']).toBe('6.0 GB of 8.0 GB in use');
    expect(Object.fromEntries(lines)['Up for']).toBe('3 days');
    expect(Object.fromEntries(lines)['Battery']).toBe('80%, charging');
  });
});

// ---------------------------------------------------------------- unattended access

describe('unattended access service', () => {
  const p = { exe: '/opt/Keeper/keeper', daemon: '/opt/Keeper/resources/app/dist-electron/linkd.cjs', dataDir: '/home/sam/.config/Keeper', user: 'sam', home: '/home/sam', helper: '/Applications/Keeper.app/Contents/Helpers/keeper-helper' };
  it('needs one of your devices with control and "Let it in without asking"', () => {
    const devs = [{ id: 'x', name: 'Laptop', permissions: { screenView: true, screenControl: true } }];
    expect(canEnableUnattended(devs, {}).ok).toBe(false);
    expect(canEnableUnattended(devs, { x: true }).ok).toBe(true);
    expect(canEnableUnattended([{ id: 'x', name: 'L', permissions: { screenView: true } }], { x: true }).ok).toBe(false);
  });
  it('writes a systemd unit that runs as the person, at boot', () => {
    const u = systemdUnit(p);
    expect(u).toContain('User=sam');
    expect(u).toContain('ExecStart=/opt/Keeper/keeper /opt/Keeper/resources/app/dist-electron/linkd.cjs --unattended');
    expect(u).toContain('Environment=ELECTRON_RUN_AS_NODE=1');
    expect(u).toContain('WantedBy=multi-user.target');
    expect(u).toContain('Restart=always');
    expect(u).not.toMatch(/User=root/);
    expect(() => systemdUnit({ ...p, user: 'bad user;' })).toThrow();
    expect(systemdUnit({ ...p, home: '/home/s am' })).toContain('Environment=HOME="/home/s am"');
  });
  it('writes a LaunchDaemon with escaped values', () => {
    const x = launchdPlist({ ...p, user: 'sam', dataDir: '/Users/sam/Library/Application Support/Keeper & Co' });
    expect(x).toContain('<string>com.ashforde.keeper.link</string>');
    expect(x).toContain('<key>RunAtLoad</key>');
    expect(x).toContain('Keeper &amp; Co');
    expect(x).toContain('<string>--helper</string>');
  });
  it('writes the Windows service that follows sessions and reaches the secure desktop', () => {
    const cs = windowsServiceSource({ ...p, exe: 'C:\\Program Files\\Keeper\\Keeper.exe' });
    expect(cs).toContain('CanHandleSessionChangeEvent = true');
    expect(cs).toContain('CreateProcessAsUser');
    expect(cs).toContain('WTSGetActiveConsoleSessionId');
    expect(cs).toContain('winsta0\\\\Winlogon');
    expect(cs).toContain('C:\\\\Program Files\\\\Keeper\\\\Keeper.exe');
  });
  it('installs and removes with exact commands', () => {
    expect(installSteps('linux', '/tmp/k/keeper-link.service', p)).toEqual([
      { file: 'install', args: ['-m', '0644', '-o', 'root', '-g', 'root', '/tmp/k/keeper-link.service', LINUX_UNIT_PATH], admin: true },
      { file: 'systemctl', args: ['daemon-reload'], admin: true },
      { file: 'systemctl', args: ['enable', '--now', 'keeper-link.service'], admin: true },
    ]);
    expect(uninstallSteps('linux')[0]).toEqual({ file: 'systemctl', args: ['disable', '--now', 'keeper-link.service'], admin: true });
    expect(installSteps('darwin', '/tmp/x.plist', p).map((s) => s.file)).toEqual(['/bin/mkdir', '/usr/bin/install', '/bin/launchctl']);
    const win = installSteps('win32', 'C:\\k\\KeeperLinkService.cs', p);
    expect(win[0].args).toContain('/out:C:\\k\\KeeperLinkService.exe');
    expect(win.map((s) => s.args[0])).toEqual(['/nologo', 'create', 'description', 'failure', 'start']);
    expect(win.every((s) => s.admin)).toBe(true);
    expect(uninstallSteps('win32').map((s) => s.args[0])).toEqual(['stop', 'delete']);
    expect(stagedName('darwin')).toBe('com.ashforde.keeper.link.plist');
    expect(definition('linux', p)).toBe(systemdUnit(p));
  });
});

// ---------------------------------------------------------------- Wayland portal

describe('Wayland remote desktop portal', () => {
  it('builds request paths and options, remembering the restore token', () => {
    expect(requestPath(':1.42', 'keeperab')).toBe('/org/freedesktop/portal/desktop/request/1_42/keeperab');
    expect(selectDevicesOptions('t1', 'tok')).toEqual({ handle_token: ['s', 't1'], types: ['u', 3], persist_mode: ['u', 2], restore_token: ['s', 'tok'] });
    expect(selectDevicesOptions('t1').restore_token).toBeUndefined();
    expect(responseError(0)).toBeNull();
    expect(responseError(1)).toMatch(/not allowed/);
  });
  it('maps keys and buttons to Linux input codes, and positions to the stream', () => {
    expect(evdevKey('KeyA')).toBe(30);
    expect(evdevKey('Enter')).toBe(28);
    expect(evdevKey('ArrowLeft')).toBe(105);
    expect(evdevKey('Nope')).toBeNull();
    expect(evdevButton(0)).toBe(0x110);
    expect(evdevButton(2)).toBe(0x111);
    const st = parseStreams([[57, { size: { value: [1920, 1080] }, position: { value: [0, 0] } }]]);
    expect(st[0]).toMatchObject({ node: 57, width: 1920, height: 1080 });
    expect(toStream(0.5, 1, st[0], { width: 1, height: 1 })).toEqual({ x: 960, y: 1079 });
  });
});

// ---------------------------------------------------------------- session extras

describe('session extras', () => {
  const ds: HostDisplay[] = [
    { id: 'L', label: 'Left', x: -1920, y: 0, width: 1920, height: 1080, scale: 1, primary: false },
    { id: 'M', label: 'Main', x: 0, y: 0, width: 2560, height: 1440, scale: 2, primary: true },
  ];
  it('finds the display under the pointer, without flicker at the edges', () => {
    expect(displayAt(ds, -10, 10)?.id).toBe('L');
    expect(displayAt(ds, 100, 100)?.id).toBe('M');
    expect(displayAt(ds, 100, 5000)?.id).toBe('M');
    expect(followDecision('M', 'L', 1000, 1100)).toEqual({ since: 1000 });
    expect(followDecision('M', 'L', 1000, 1500)).toEqual({ switchTo: 'L', since: 1500 });
  });
  it('maps "all displays" positions back to one display', () => {
    expect(allBounds(ds)).toEqual({ x: -1920, y: 0, width: 4480, height: 1440 });
    const r = mapFromAll(ds, 0.75, 0.5);
    expect(r?.display.id).toBe('M');
    expect(mapFromAll(ds, 0.1, 0.9)).toBeNull(); // below the shorter left screen
    expect(allLayout(ds, 4480)[0]).toEqual({ id: 'L', x: 0, y: 0, w: 1920, h: 1080 });
  });
  it('orders codecs and plans encodings', () => {
    const c = [{ mimeType: 'video/VP8' }, { mimeType: 'video/H264' }, { mimeType: 'video/AV1' }];
    expect(orderCodecs(c, 'av1')[0].mimeType).toBe('video/AV1');
    expect(orderCodecs(c, 'h264')[0].mimeType).toBe('video/H264');
    expect(orderCodecs(c, 'auto')).toBe(c);
    expect(encodingPlan({ lossless: true, bitrate: 4e6, fps: 30, scale: 0.5, hardware: true })).toMatchObject({ contentHint: 'text', scaleResolutionDownBy: 1, maxFramerate: 15, maxBitrate: 20e6 });
    expect(encodingPlan({ lossless: false, bitrate: 4e6, fps: 30, scale: 0.5, hardware: false }).scaleResolutionDownBy).toBe(2);
  });
  it('knows what each system can do for sound and privacy', () => {
    expect(audioPlan('win32').how).toBe('loopback');
    expect(audioPlan('darwin', 12).how).toBe('none');
    expect(audioPlan('darwin', 14).how).toBe('screencapturekit');
    expect(pickMonitorDevice([{ kind: 'audioinput', deviceId: 'm', label: 'Monitor of Built-in Audio' }, { kind: 'audioinput', deviceId: 'x', label: 'Mic' }])).toBe('m');
    expect(privacyPlan('win32')).toMatchObject({ blank: true, block: true });
    expect(privacyPlan('linux').blank).toBe(false);
  });
  it('cleans annotation strokes and checks viewer invites', () => {
    expect(sanitizeStroke({ points: [[2, -1], [0.5, 'x']], color: 'red', width: 99 })).toEqual({ id: 's', points: [[1, 0]], color: '#ff3b30', width: 24 });
    expect(sanitizeStroke({ points: [] })).toBeNull();
    const inv = { token: 'a'.repeat(22), device: 'd2', expires: Date.now() + 1000 };
    expect(inviteValid(inv, 'd2', 'a'.repeat(22))).toBe(true);
    expect(inviteValid(inv, 'd3', 'a'.repeat(22))).toBe(false);
    expect(inviteValid({ ...inv, expires: 0 }, 'd2', 'a'.repeat(22))).toBe(false);
  });
  it('decides which shortcuts go through', () => {
    expect(passes({ code: 'Tab', altKey: true }, DEFAULT_PASSTHROUGH)).toBe(true);
    expect(passes({ code: 'Tab', altKey: true }, { ...DEFAULT_PASSTHROUGH, appSwitch: false })).toBe(false);
    expect(passes({ code: 'F5' }, { ...DEFAULT_PASSTHROUGH, fkeys: false })).toBe(false);
    expect(passes({ code: 'KeyA' }, { appSwitch: false, meta: false, fkeys: false })).toBe(true);
  });
});

// ---------------------------------------------------------------- placement around the system

describe('where remote access shows up', () => {
  it('is everywhere by default and can be switched per place', async () => {
    const { surfaceOn, toggleSurface, trayEntries } = await import('../core/link/surfaces');
    expect(surfaceOn(undefined, 'help', 'tray')).toBe(true);
    expect(surfaceOn(undefined, 'help', 'contextMenu')).toBe(false);
    const off = toggleSurface(undefined, 'help', 'tray', false);
    expect(surfaceOn(off, 'help', 'tray')).toBe(false);
    expect(surfaceOn(off, 'help', 'island')).toBe(true);
    const t = trayEntries({ devices: [{ id: 'd', name: 'Desk', online: true, via: 'direct', canView: true }], sessions: [{ id: 's', peerName: 'Sam', role: 'host', control: true }], helpOn: true, helpWaiting: '123 456 789', screenOn: true });
    const labels = t.map((e) => ('label' in e ? e.label : '—'));
    expect(labels).toEqual(['—', 'Stop: Sam is controlling this screen', 'Devices', 'Help code 123 456 789 · Stop', 'Help Someone…']);
    expect(trayEntries({ surfaces: { sessions: [], devices: [], help: [] }, devices: [], sessions: [], helpOn: true, screenOn: true })).toEqual([]);
    expect(trayEntries({ devices: [], sessions: [], helpOn: false, screenOn: true })).toEqual([]);
  });
  it('shows viewer sessions and a waiting help code on the Island', async () => {
    const { activitiesFrom } = await import('../core/island-activities');
    const s = { agents: [], events: [], focus: { mode: 'idle' }, keepAwake: { on: false } } as unknown as Parameters<typeof activitiesFrom>[0];
    const a = activitiesFrom(s, 10_000, { remote: [{ id: 'help', title: 'Help code 123 456 789', since: 0, ref: 'help' }] });
    expect(a.find((x) => x.kind === 'remote')).toMatchObject({ title: 'Help code 123 456 789', ref: 'help' });
  });
});

describe('device positions', () => {
  it('accepts only sensible positions', async () => {
    const { cleanPosition } = await import('../core/link/location');
    expect(cleanPosition({ lat: 10, lon: 20, t: 1000, acc: 5, battery: 50 }, 'd', 'D', 2000)).toEqual({ device: 'd', name: 'D', lat: 10, lon: 20, t: 1000, acc: 5, battery: 50 });
    expect(cleanPosition({ lat: 100, lon: 0, t: 1 }, 'd', 'D')).toBeNull();
    expect(cleanPosition({ lat: 1, lon: 1, t: Date.now() + 3600_000 }, 'd', 'D')).toBeNull();
    expect(cleanPosition({ lat: 1, lon: 1, t: 5, battery: 300 }, 'd', 'D', 10)?.battery).toBeUndefined();
    expect(allowed({}, 'loc.get')).toBe(false);
    expect(allowed({ location: true }, 'loc.get')).toBe(true);
  });
});
