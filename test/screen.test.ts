// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { frameSettings, LIMITS, QualityController } from '../core/screen/abr';
import { auditTitle, decide, DEFAULT_POLICY, idleExpired } from '../core/screen/consent';
import { decodeFrame, Deframer, encodeFrame, FrameGate, lengthPrefixed } from '../core/screen/frames';
import { coalesce, comboKeys, fromViewer, macKeycode, sanitize, toHostPoint, winVk, xKeysym } from '../core/screen/input';
import { macCalls, winLines, xdotoolBatches } from '../core/screen/inject';
import { adbConnectArgs, adbDropArgs, adbPairArgs, airplayPlan, parseAdbDevices, SCRCPY_FILES, scrcpyArgs, scrcpyDownload, uxplayArgs } from '../core/screen/mirror';
import { checkBinding, filterCandidate, iceServers, normalize, remoteCertificateMatches, sdpFingerprints, soleFingerprint } from '../core/screen/sdp';
import type { HostDisplay } from '../core/screen/types';
import { broadcastAddress, formatMac, magicPacket, parseMac, wakeableInterfaces } from '../core/screen/wol';

const SDP = [
  'v=0', 'o=- 1 2 IN IP4 127.0.0.1', 's=-', 't=0 0',
  'a=fingerprint:sha-256 ab:cd:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89',
  'm=video 9 UDP/TLS/RTP/SAVPF 96',
  'a=fingerprint:sha-256 AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89',
].join('\r\n');
const FP = 'sha-256 AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89';

describe('WebRTC bound to Link identities', () => {
  it('reads fingerprints and normalises case', () => {
    expect(sdpFingerprints(SDP)).toHaveLength(2);
    expect(soleFingerprint(SDP)).toBe(FP);
    expect(normalize('ab cd ef')).toBe('AB:CD:EF');
  });
  it('accepts the stated certificate and refuses another', () => {
    expect(() => checkBinding(SDP, FP)).not.toThrow();
    expect(() => checkBinding(SDP, FP.replace('AB:CD', 'AB:CE'))).toThrow(/not the one/);
    expect(() => checkBinding('v=0\r\n', FP)).toThrow(/no certificate/);
    expect(() => checkBinding(SDP + '\r\na=fingerprint:sha-256 00:11', FP)).toThrow(/more than one/);
  });
  it('checks the certificate DTLS really used', () => {
    const stats = [
      { type: 'transport', id: 't', remoteCertificateId: 'c2' },
      { type: 'certificate', id: 'c1', fingerprint: 'FF:FF', fingerprintAlgorithm: 'sha-256' },
      { type: 'certificate', id: 'c2', fingerprint: FP.split(' ')[1].toLowerCase(), fingerprintAlgorithm: 'sha-256' },
    ];
    expect(remoteCertificateMatches(stats, FP)).toBe(true);
    expect(remoteCertificateMatches(stats.map((s) => (s.id === 'c2' ? { ...s, fingerprint: 'FF:FF' } : s)), FP)).toBe(false);
    expect(remoteCertificateMatches([], FP)).toBe(false);
  });
  it('keeps LAN-only sessions on host candidates', () => {
    expect(filterCandidate('candidate:1 1 udp 2122260223 192.168.1.5 54321 typ host', 'lan')).toBe(true);
    expect(filterCandidate('candidate:2 1 udp 1686052607 203.0.113.9 54321 typ srflx raddr 0.0.0.0 rport 0', 'lan')).toBe(false);
    expect(filterCandidate('candidate:3 1 udp 41885439 198.51.100.2 3478 typ relay', 'internet')).toBe(true);
  });
  it('builds ICE servers from the STUN setting, with TURN credentials', () => {
    expect(iceServers(['stun.l.google.com:19302', 'stun:stun.example.org', 'turn:alice:s%40cret@turn.example.org:3478'])).toEqual([
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun.example.org' },
      { urls: 'turn:turn.example.org:3478', username: 'alice', credential: 's@cret' },
    ]);
  });
});

describe('adaptive quality', () => {
  it('backs off fast on loss and climbs back slowly', () => {
    const q = new QualityController('auto');
    const start = q.current.bitrate;
    const a = q.update({ loss: 0.12, rtt: 80 });
    expect(a.bitrate).toBeLessThan(start);
    let b = a;
    for (let i = 0; i < 10; i++) b = q.update({ loss: 0.2, available: 400_000 });
    expect(b.bitrate).toBeGreaterThanOrEqual(LIMITS.minBitrate);
    expect(b.scale).toBeLessThan(1);
    expect(b.fps).toBeLessThan(30);
    const low = b.bitrate;
    q.update({ loss: 0 });
    expect(q.update({ loss: 0 }).bitrate).toBe(low); // two calm seconds: no change yet
    expect(q.update({ loss: 0 }).bitrate).toBeGreaterThan(low);
  });
  it('never goes above what the path can carry, and fixed presets stay fixed', () => {
    const q = new QualityController('auto');
    for (let i = 0; i < 40; i++) q.update({ loss: 0, available: 2_000_000 });
    expect(q.current.bitrate).toBeLessThanOrEqual(2_000_000);
    const f = new QualityController('speed');
    expect(f.update({ loss: 0.5 })).toEqual(f.current);
    expect(frameSettings({ bitrate: 8_000_000, fps: 30, scale: 1 }).fps).toBe(15);
  });
});

const D1: HostDisplay = { id: '1', label: 'Main', x: 0, y: 0, width: 1440, height: 900, scale: 2, primary: true };
const D2: HostDisplay = { id: '2', label: 'Left', x: -1920, y: 100, width: 1920, height: 1080, scale: 1, primary: false };

describe('input mapping', () => {
  it('maps 0..1 to each OS’s units, across displays and scales', () => {
    expect(toHostPoint(D1, 0.5, 0.5, 'darwin')).toEqual({ x: 720, y: 450 });
    expect(toHostPoint(D1, 0.5, 0.5, 'linux')).toEqual({ x: 1440, y: 900 });
    expect(toHostPoint(D2, 0, 0, 'win32')).toEqual({ x: -1920, y: 100 });
    expect(toHostPoint(D2, 1, 1, 'win32')).toEqual({ x: -1, y: 1179 });
    expect(toHostPoint(D1, 7, -3, 'darwin')).toEqual({ x: 1439, y: 0 });
  });
  it('maps the viewer’s pointer through letterboxing', () => {
    const box = { left: 0, top: 0, width: 1000, height: 1000 };
    expect(fromViewer(500, 500, box, 1600, 900)).toEqual({ x: 0.5, y: 0.5 });
    expect(fromViewer(500, 10, box, 1600, 900)).toBeNull(); // on the black bar above the picture
  });
  it('knows keys on every OS', () => {
    expect([xKeysym('KeyA'), xKeysym('Enter'), xKeysym('ArrowLeft'), xKeysym('F5'), xKeysym('Digit7')]).toEqual(['a', 'Return', 'Left', 'F5', '7']);
    expect([winVk('KeyA'), winVk('F1'), winVk('Digit0'), winVk('Escape')]).toEqual([0x41, 0x70, 0x30, 0x1b]);
    expect([macKeycode('KeyA'), macKeycode('Enter'), macKeycode('Space')]).toEqual([0, 36, 49]);
    expect(comboKeys('ctrl-alt-del', 'win32')).toEqual(['ControlLeft', 'AltLeft', 'Delete']);
    expect(comboKeys('cmd-tab', 'darwin')).toEqual(['MetaLeft', 'Tab']);
  });
  it('drops anything malformed from the network', () => {
    expect(sanitize({ t: 'move', x: 2, y: -1 })).toEqual({ t: 'move', x: 1, y: 0 });
    expect(sanitize({ t: 'down', x: 0.1, y: 0.1, button: 7 })).toBeNull();
    expect(sanitize({ t: 'key', code: 'KeyA; rm -rf /', down: true })).toBeNull();
    expect(sanitize({ t: 'combo', combo: 'reboot' })).toBeNull();
    expect(sanitize({ t: 'text', text: 'x'.repeat(5000) })).toEqual({ t: 'text', text: 'x'.repeat(2000) });
    expect(sanitize(null)).toBeNull();
  });
  it('keeps only the latest of a run of moves', () => {
    expect(coalesce([{ t: 'move', x: 0, y: 0 }, { t: 'move', x: 0.5, y: 0.5 }, { t: 'down', x: 0.5, y: 0.5, button: 0 }, { t: 'move', x: 1, y: 1 }])).toHaveLength(3);
  });
});

describe('injectors', () => {
  it('xdotool: one call per batch, text on its own', () => {
    const b = xdotoolBatches([
      { t: 'move', x: 0.5, y: 0.5 },
      { t: 'down', x: 0.5, y: 0.5, button: 0 },
      { t: 'up', x: 0.5, y: 0.5, button: 0 },
      { t: 'wheel', x: 0.5, y: 0.5, dx: 0, dy: 3 },
      { t: 'key', code: 'KeyA', down: true },
      { t: 'text', text: 'hello world' },
      { t: 'combo', combo: 'alt-tab' },
    ], D1);
    expect(b).toEqual([
      ['mousemove', '1440', '900', 'click', '1', 'click', '--repeat', '3', '--delay', '0', '5', 'keydown', 'a'],
      ['type', '--delay', '2', '--', 'hello world'],
      ['key', 'Alt_L+Tab'],
    ]);
  });
  it('Windows: JSON lines for the SendInput host', () => {
    const l = winLines([{ t: 'down', x: 0, y: 0, button: 2 }, { t: 'key', code: 'ArrowUp', down: true }, { t: 'combo', combo: 'ctrl-alt-del' }], D2);
    expect(l.map((x) => JSON.parse(x))).toEqual([{ m: { x: -1920, y: 100 } }, { b: 2, d: 1 }, { k: 0x26, d: 1, e: 1 }, { sas: 1 }]);
  });
  it('macOS: helper calls in points', () => {
    const c = macCalls([{ t: 'move', x: 1, y: 1 }, { t: 'key', code: 'KeyC', down: true, mods: { meta: true } }], D1);
    expect(c[0]).toEqual({ method: 'input.move', params: { x: 1439, y: 899 } });
    expect(c[1]).toEqual({ method: 'input.key', params: { code: 8, down: true, mods: ['meta'] } });
  });
});

describe('who may see the screen', () => {
  it('needs the device permission, asks unless left in on purpose', () => {
    expect(decide({ from: 'device', id: 'a', wantsControl: true }, DEFAULT_POLICY).do).toBe('deny');
    expect(decide({ from: 'device', id: 'a', wantsControl: true, perms: { screenView: true } }, DEFAULT_POLICY)).toEqual({ do: 'ask', control: false });
    expect(decide({ from: 'device', id: 'a', wantsControl: true, perms: { screenView: true, screenControl: true } }, DEFAULT_POLICY)).toEqual({ do: 'ask', control: true });
    const p = { ...DEFAULT_POLICY, unattended: { a: true } };
    expect(decide({ from: 'device', id: 'a', wantsControl: false, perms: { screenView: true, screenControl: true } }, p)).toEqual({ do: 'allow', control: false });
    // "without asking" is only honoured with control allowed too
    expect(decide({ from: 'device', id: 'a', wantsControl: false, perms: { screenView: true } }, p).do).toBe('ask');
    expect(decide({ from: 'phone', id: 'p', wantsControl: true }, DEFAULT_POLICY).do).toBe('ask');
    expect(decide({ from: 'phone', id: 'p', wantsControl: true }, { ...DEFAULT_POLICY, phones: false }).do).toBe('deny');
  });
  it('ends idle sessions and writes History lines', () => {
    expect(idleExpired(16 * 60_000, 0, DEFAULT_POLICY)).toBe(true);
    expect(idleExpired(16 * 60_000, 0, { ...DEFAULT_POLICY, idleMinutes: 0 })).toBe(false);
    expect(auditTitle({ role: 'host', peerName: 'Laptop', control: true, started: 0, ended: { at: 5 * 60_000, reason: 'done' } })).toBe('Laptop controlled this screen for 5 min');
    expect(auditTitle({ role: 'viewer', peerName: 'Desk', control: false, started: 0 })).toBe('You viewed Desk');
  });
});

describe('frames', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
  it('round-trips and refuses junk', () => {
    const f = encodeFrame({ seq: 3, w: 10, h: 20, at: 5 }, jpeg);
    expect(decodeFrame(f)).toEqual({ header: { seq: 3, w: 10, h: 20, at: 5 }, jpeg });
    expect(decodeFrame(encodeFrame({ seq: 3, w: 10, h: 20, at: 5 }, new Uint8Array([1, 2])))).toBeNull();
    expect(decodeFrame(new Uint8Array([0, 0, 0, 200, 1]))).toBeNull();
  });
  it('splits a stream at any chunk boundary', () => {
    const got: number[] = [];
    const d = new Deframer((m) => got.push(m.length));
    const all = new Uint8Array([...lengthPrefixed(new Uint8Array(5)), ...lengthPrefixed(new Uint8Array(300)), ...lengthPrefixed(new Uint8Array(1))]);
    for (let i = 0; i < all.length; i += 7) d.push(all.subarray(i, i + 7));
    expect(got).toEqual([5, 300, 1]);
  });
  it('keeps at most two frames in flight and recovers from a lost ack', () => {
    const g = new FrameGate(2, 0);
    expect(g.ready(0)).toBe(true);
    const a = g.sent(0);
    g.sent(1);
    expect(g.ready(2)).toBe(false);
    g.ack(a, 50);
    expect(g.ready(51)).toBe(true);
    g.sent(52);
    expect(g.ready(100)).toBe(false);
    expect(g.ready(4000)).toBe(true); // both given up on after 3 s
    expect(g.rtt).toBe(50);
  });
});

describe('Wake-on-LAN', () => {
  it('builds the magic packet', () => {
    const p = magicPacket('AA-BB-CC-DD-EE-FF');
    expect(p.length).toBe(102);
    expect([...p.subarray(0, 6)]).toEqual([255, 255, 255, 255, 255, 255]);
    expect(formatMac(p.subarray(96, 102))).toBe('aa:bb:cc:dd:ee:ff');
    expect(parseMac('00:00:00:00:00:00')).toBeNull();
    expect(() => magicPacket('nope')).toThrow();
  });
  it('finds the broadcast address and skips virtual cards', () => {
    expect(broadcastAddress('192.168.1.23', '255.255.255.0')).toBe('192.168.1.255');
    expect(broadcastAddress('10.4.5.6', '255.255.240.0')).toBe('10.4.15.255');
    const ifs = {
      eth0: [{ mac: '00:11:22:33:44:55', family: 'IPv4', internal: false, address: '192.168.1.5', netmask: '255.255.255.0' }],
      docker0: [{ mac: '02:42:ac:11:00:01', family: 'IPv4', internal: false, address: '172.17.0.1', netmask: '255.255.0.0' }],
      lo: [{ mac: '00:00:00:00:00:00', family: 'IPv4', internal: true, address: '127.0.0.1', netmask: '255.0.0.0' }],
    };
    expect(wakeableInterfaces(ifs)).toEqual([{ name: 'eth0', mac: '00:11:22:33:44:55', broadcast: '192.168.1.255' }]);
  });
});

describe('phones', () => {
  it('pins scrcpy for every platform with a build', () => {
    for (const f of Object.values(SCRCPY_FILES)) expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(scrcpyDownload('linux', 'x64')?.url).toBe('https://github.com/Genymobile/scrcpy/releases/download/v5.0.1/scrcpy-linux-x86_64-v5.0.1.tar.gz');
    expect(scrcpyDownload('linux', 'arm64')).toBeNull();
  });
  it('reads adb devices -l', () => {
    const d = parseAdbDevices('List of devices attached\nR58M123 device usb:1-1 product:beyond1 model:SM_G973F device:beyond1 transport_id:1\n192.168.1.20:5555 unauthorized\n* daemon started *\n');
    expect(d).toEqual([
      { serial: 'R58M123', state: 'device', model: 'SM G973F', product: 'beyond1', wifi: false },
      { serial: '192.168.1.20:5555', state: 'unauthorized', model: undefined, product: undefined, wifi: true },
    ]);
  });
  it('builds scrcpy and adb commands safely', () => {
    expect(scrcpyArgs({ serial: 'R58M123', viewOnly: true, maxSize: 99999, bitrateMbps: 8, stayAwake: true })).toEqual(['--serial', 'R58M123', '--window-title', 'Phone', '--max-size=4096', '--video-bit-rate=8M', '--no-control']);
    expect(() => scrcpyArgs({ serial: 'a b' })).toThrow();
    expect(adbPairArgs('192.168.1.20:37123', '123456')).toEqual(['pair', '192.168.1.20:37123', '123456']);
    expect(() => adbPairArgs('192.168.1.20', '123456')).toThrow();
    expect(() => adbPairArgs('192.168.1.20:37123', '12')).toThrow();
    expect(adbConnectArgs('192.168.1.20:5555')).toEqual(['connect', '192.168.1.20:5555']);
    expect(adbDropArgs('S1', '/x/app.apk')).toEqual(['-s', 'S1', 'install', '-r', '/x/app.apk']);
    expect(adbDropArgs('S1', '/x/photo.jpg')).toEqual(['-s', 'S1', 'push', '/x/photo.jpg', '/sdcard/Download/']);
  });
  it('picks the right AirPlay route per system', () => {
    expect(airplayPlan('darwin', null, '24.1.0').how).toBe('system');
    expect(airplayPlan('darwin', null, '20.6.0').how).toBe('manual');
    expect(airplayPlan('linux', null).how).toBe('install');
    expect(airplayPlan('linux', '/usr/bin/uxplay').how).toBe('uxplay');
    expect(airplayPlan('win32', null).how).toBe('manual');
    expect(uxplayArgs('Desk; rm -rf /')).toEqual(['-n', 'Desk rm -rf', '-nh']);
  });
});
