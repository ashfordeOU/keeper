// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Remote Desktop in a Keeper tab: the RDCleanPath messages byte by byte (the
// vectors are the IronRDP project's own, crates/ironrdp-testsuite-core/tests/
// rdcleanpath.rs, so the relay speaks exactly what the engine expects), X.224,
// the certificate decision, tab or outside app (with .rdp imports), keys and
// sizes, the component's on-demand rules, and the relay itself over real
// sockets against a stand-in RDP server (X.224 confirm, then TLS).

import { createHash } from 'node:crypto';
import net from 'node:net';
import tls from 'node:tls';
import { afterEach, describe, expect, it } from 'vitest';
import {
  certVerdict, colonHex, decodeRDCleanPath, derInteger, encodeRDCleanPath, failureText, parseConfirm, parseRelayRequest, pduLength, pinOf,
  PROTOCOL_HYBRID, PROTOCOL_SSL, RDCLEANPATH_VERSION, relayError, relayResponse, requestedProtocols, sameToken, tpktLength, x224Request,
} from '../core/rdc/rdcleanpath';
import { comboScancodes, desktopSize, engineMessage, destinationOf, evenSize, RDP_COMBOS, rdpKey, rdpWhere, relayRefusal, SCANCODES, splitUser, tabLimits } from '../core/rdc/rdp-tab';
import { parseRdp } from '../core/rdc/formats';
import { normalizePlaces } from '../core/rdc/places';
import { backgroundPlan, componentsFor, missingFor, probePath, type ComponentInfo } from '../core/components';
import type { Connection } from '../core/rdc/types';
import { probeRdpCert, RdpRelay } from '../electron/services/rdc/rdp';
import { connectWs } from '../core/link/ws';

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const bytes = (a: number[]) => Uint8Array.from(a);
const DEADBEEF = bytes([0xde, 0xad, 0xbe, 0xff]);

// ---- IronRDP's own vectors
const REQUEST_DER = bytes([
  0x30, 0x32, 0xa0, 0x4, 0x2, 0x2, 0xd, 0x3e, 0xa2, 0xd, 0xc, 0xb, 0x64, 0x65, 0x73, 0x74, 0x69, 0x6e, 0x61, 0x74,
  0x69, 0x6f, 0x6e, 0xa3, 0xc, 0xc, 0xa, 0x70, 0x72, 0x6f, 0x78, 0x79, 0x20, 0x61, 0x75, 0x74, 0x68, 0xa5, 0x5, 0xc,
  0x3, 0x50, 0x43, 0x42, 0xa6, 0x6, 0x4, 0x4, 0xde, 0xad, 0xbe, 0xff,
]);
const VMCONNECT_REQUEST_DER = bytes([
  0x30, 0x2a, 0xa0, 0x4, 0x2, 0x2, 0xd, 0x3e, 0xa2, 0xd, 0xc, 0xb, 0x64, 0x65, 0x73, 0x74, 0x69, 0x6e, 0x61, 0x74,
  0x69, 0x6f, 0x6e, 0xa3, 0xc, 0xc, 0xa, 0x70, 0x72, 0x6f, 0x78, 0x79, 0x20, 0x61, 0x75, 0x74, 0x68, 0xa5, 0x5, 0xc,
  0x3, 0x50, 0x43, 0x42,
]);
const RESPONSE_SUCCESS_DER = bytes([
  0x30, 0x34, 0xa0, 0x4, 0x2, 0x2, 0xd, 0x3e, 0xa6, 0x6, 0x4, 0x4, 0xde, 0xad, 0xbe, 0xff, 0xa7, 0x14, 0x30, 0x12,
  0x4, 0x4, 0xde, 0xad, 0xbe, 0xff, 0x4, 0x4, 0xde, 0xad, 0xbe, 0xff, 0x4, 0x4, 0xde, 0xad, 0xbe, 0xff, 0xa9, 0xe,
  0xc, 0xc, 0x31, 0x39, 0x32, 0x2e, 0x31, 0x36, 0x38, 0x2e, 0x37, 0x2e, 0x39, 0x35,
]);
const RESPONSE_HTTP_ERROR_DER = bytes([0x30, 0x15, 0xa0, 0x4, 0x2, 0x2, 0xd, 0x3e, 0xa1, 0xd, 0x30, 0xb, 0xa0, 0x3, 0x2, 0x1, 0x1, 0xa1, 0x4, 0x2, 0x2, 0x1, 0xf4]);
const RESPONSE_TLS_ERROR_DER = bytes([0x30, 0x14, 0xa0, 0x04, 0x02, 0x02, 0x0d, 0x3e, 0xa1, 0x0c, 0x30, 0x0a, 0xa0, 0x03, 0x02, 0x01, 0x01, 0xa3, 0x03, 0x02, 0x01, 0x30]);

describe('RDCleanPath messages', () => {
  it('writes a request exactly as IronRDP does', () => {
    expect(hex(encodeRDCleanPath({ version: RDCLEANPATH_VERSION, destination: 'destination', proxyAuth: 'proxy auth', preconnectionBlob: 'PCB', x224: DEADBEEF }))).toBe(hex(REQUEST_DER));
  });
  it('reads IronRDP’s request, and the relay accepts it', () => {
    const p = decodeRDCleanPath(REQUEST_DER);
    expect(p).toMatchObject({ version: 3390, destination: 'destination', proxyAuth: 'proxy auth', preconnectionBlob: 'PCB' });
    expect(hex(p.x224!)).toBe('deadbeff');
    expect(parseRelayRequest(REQUEST_DER)).toMatchObject({ destination: 'destination', token: 'proxy auth', preconnectionBlob: 'PCB' });
  });
  it('writes the answers exactly as IronRDP does', () => {
    expect(hex(relayResponse(DEADBEEF, [DEADBEEF, DEADBEEF, DEADBEEF], '192.168.7.95'))).toBe(hex(RESPONSE_SUCCESS_DER));
    expect(hex(relayError({ errorCode: 1, httpStatusCode: 500 }))).toBe(hex(RESPONSE_HTTP_ERROR_DER));
    expect(hex(relayError({ errorCode: 1, tlsAlertCode: 48 }))).toBe(hex(RESPONSE_TLS_ERROR_DER));
  });
  it('reads answers back, errors included', () => {
    const r = decodeRDCleanPath(RESPONSE_SUCCESS_DER);
    expect(r.certChain?.map(hex)).toEqual(['deadbeff', 'deadbeff', 'deadbeff']);
    expect(r.serverAddr).toBe('192.168.7.95');
    expect(decodeRDCleanPath(RESPONSE_HTTP_ERROR_DER).error).toEqual({ errorCode: 1, httpStatusCode: 500 });
    expect(decodeRDCleanPath(RESPONSE_TLS_ERROR_DER).error).toEqual({ errorCode: 1, tlsAlertCode: 48 });
  });
  it('refuses what it does not do: answers as requests, the Hyper-V console form, other versions, junk', () => {
    expect(() => parseRelayRequest(RESPONSE_SUCCESS_DER)).toThrow(/answer/);
    expect(() => parseRelayRequest(VMCONNECT_REQUEST_DER)).toThrow(/X\.224/);
    const v2 = REQUEST_DER.slice();
    v2[7] = 0x3f;
    expect(() => decodeRDCleanPath(v2)).toThrow(/Version 3391/);
    expect(() => decodeRDCleanPath(Uint8Array.from([...REQUEST_DER, 0]))).toThrow();
    expect(() => decodeRDCleanPath(REQUEST_DER.subarray(0, 20))).toThrow();
    // [3] before [2]
    const outOfOrder = Uint8Array.from([0x30, 16, 0xa0, 4, 2, 2, 0x0d, 0x3e, 0xa3, 3, 0x0c, 1, 0x61, 0xa2, 3, 0x0c, 1, 0x62]);
    expect(() => decodeRDCleanPath(outOfOrder)).toThrow(/order/);
  });
  it('knows the whole size from the first bytes, long lengths included', () => {
    expect(pduLength(REQUEST_DER.subarray(0, 1))).toBeNull();
    expect(pduLength(REQUEST_DER.subarray(0, 2))).toBe(REQUEST_DER.length);
    const big = relayResponse(DEADBEEF, [new Uint8Array(1000).fill(7)], '10.0.0.1:3389');
    expect(big[1]).toBe(0x82);
    expect(pduLength(big.subarray(0, 3))).toBeNull();
    expect(pduLength(big.subarray(0, 4))).toBe(big.length);
    expect(decodeRDCleanPath(big).certChain?.[0].length).toBe(1000);
    expect(() => pduLength(Uint8Array.from([0x16, 3]))).toThrow();
  });
  it('writes numbers the DER way', () => {
    expect(hex(derInteger(0))).toBe('020100');
    expect(hex(derInteger(127))).toBe('02017f');
    expect(hex(derInteger(128))).toBe('02020080');
    expect(hex(derInteger(3390))).toBe('02020d3e');
  });
  it('compares tokens in full', () => {
    expect(sameToken('abc', 'abc')).toBe(true);
    expect(sameToken('abc', 'abd')).toBe(false);
    expect(sameToken('abc', 'abcd')).toBe(false);
    expect(sameToken('', 'a')).toBe(false);
  });
});

describe('X.224', () => {
  it('builds a Connection Request and reads the protocols back', () => {
    const cr = x224Request(PROTOCOL_SSL | PROTOCOL_HYBRID, 'keeper');
    expect(cr[0]).toBe(3);
    expect(tpktLength(cr)).toBe(cr.length);
    expect(cr[5]).toBe(0xe0);
    expect(Buffer.from(cr).includes('Cookie: mstshash=keeper\r\n')).toBe(true);
    expect(requestedProtocols(cr)).toBe(3);
    expect(requestedProtocols(x224Request(0xb))).toBe(0xb);
  });
  it('reads what the server chose, or why it refused', () => {
    const cc = (type: number, v: number) => bytes([3, 0, 0, 19, 14, 0xd0, 0, 0, 0x12, 0x34, 0, type, 0, 8, 0, v, 0, 0, 0]);
    expect(parseConfirm(cc(2, 2))).toEqual({ ok: true, protocol: 2 });
    expect(parseConfirm(cc(3, 5))).toEqual({ ok: false, failure: 5 });
    expect(parseConfirm(bytes([3, 0, 0, 11, 6, 0xd0, 0, 0, 0, 0, 0]))).toEqual({ ok: true, protocol: 0 });
    expect(failureText(5)).toMatch(/Network Level Authentication/);
    expect(failureText(99)).toMatch(/code 99/);
    expect(() => parseConfirm(x224Request(1))).toThrow();
    expect(tpktLength(bytes([3, 0]))).toBeNull();
    expect(() => tpktLength(bytes([0x16, 3, 1, 0]))).toThrow();
  });
});

describe('certificates', () => {
  it('pins the SHA-256 the way web consoles do, and shows colon hex', () => {
    const d = createHash('sha256').update('abc').digest();
    expect(pinOf(d)).toBe(`sha256/${d.toString('base64')}`);
    expect(colonHex(bytes([0xab, 0x01]))).toBe('AB:01');
  });
  it('asks the first time and when it changes; trusts a pin, the system or "any"', () => {
    expect(certVerdict({ seen: 'a', systemTrusted: false })).toBe('ask');
    expect(certVerdict({ seen: 'a', systemTrusted: true })).toBe('trusted');
    expect(certVerdict({ seen: 'a', systemTrusted: false, acceptAny: true })).toBe('any');
    expect(certVerdict({ pin: 'a', seen: 'a', systemTrusted: false })).toBe('pinned');
    expect(certVerdict({ pin: 'a', seen: 'b', systemTrusted: true })).toBe('changed');
    expect(certVerdict({ pin: 'a', seen: 'b', systemTrusted: false, trustedNow: 'b' })).toBe('pinned');
    expect(certVerdict({ seen: 'b', systemTrusted: false, trustedNow: 'c' })).toBe('ask');
  });
});

const conn = (rdp: Connection['rdp'] = {}): Connection => ({ id: 'c1', name: 'Desk', protocol: 'rdp', host: 'desk.lan', created: 1, rdp });

describe('tab or outside app', () => {
  const tab = { inTab: true, engine: 'ready' as const };
  it('opens in a tab by default, even before the engine is downloaded', () => {
    expect(rdpWhere(conn(), tab)).toEqual({ where: 'tab' });
    expect(rdpWhere(conn(), { ...tab, engine: 'missing' })).toEqual({ where: 'tab' });
  });
  it('uses the outside app when asked, chosen, switched off or not available', () => {
    expect(rdpWhere(conn(), { ...tab, external: true }).where).toBe('outside');
    expect(rdpWhere(conn({ where: 'outside' }), tab).where).toBe('outside');
    expect(rdpWhere(conn(), { ...tab, inTab: false }).where).toBe('outside');
    expect(rdpWhere(conn(), { ...tab, engine: 'unavailable' })).toMatchObject({ where: 'outside', reason: expect.stringMatching(/not available/) });
  });
  it('says why options only the outside app has send it there', () => {
    expect(rdpWhere(conn({ gateway: 'rdg.example.com' }), tab)).toEqual({ where: 'outside', reason: 'A Remote Desktop Gateway needs the outside app.' });
    expect(rdpWhere(conn({ admin: true }), tab).reason).toMatch(/admin/);
    expect(rdpWhere(conn({ multimon: true }), tab).reason).toMatch(/monitors/);
    expect(rdpWhere(conn({ drives: true }), tab).reason).toMatch(/home folder/);
    expect(tabLimits(conn({ gateway: 'g', admin: true }))).toHaveLength(2);
    expect(tabLimits(conn({ clipboard: false, fullscreen: true }))).toEqual([]);
  });
  it('maps .rdp files onto the same choice', () => {
    const plain = parseRdp('full address:s:desk.lan:3390\r\nusername:s:WORK\\ana\r\ndesktopwidth:i:1600\r\ndesktopheight:i:900\r\nredirectclipboard:i:1\r\ndynamic resolution:i:1\r\n', 'Desk.rdp')[0].conn as Connection;
    expect(plain).toMatchObject({ host: 'desk.lan', port: 3390, user: 'ana', domain: 'WORK' });
    expect(rdpWhere(plain, tab)).toEqual({ where: 'tab' });
    expect(desktopSize(plain, { width: 1000, height: 700 }, { width: 1920, height: 1080 })).toEqual({ width: 1600, height: 900, follow: false });
    const viaGateway = parseRdp('full address:s:desk.lan\r\ngatewayhostname:s:rdg.example.com\r\ngatewayusagemethod:i:1\r\n')[0].conn as Connection;
    expect(rdpWhere(viaGateway, tab).where).toBe('outside');
    const admin = parseRdp('full address:s:desk.lan\r\nadministrative session:i:1\r\nuse multimon:i:1\r\n')[0].conn as Connection;
    expect(tabLimits(admin)).toHaveLength(2);
    const noClip = parseRdp('full address:s:desk.lan\r\nredirectclipboard:i:0\r\nenablecredsspsupport:i:0\r\n')[0].conn as Connection;
    expect(noClip.rdp).toMatchObject({ clipboard: false, nla: false });
    expect(rdpWhere(noClip, tab).where).toBe('tab');
  });
});

describe('sizes', () => {
  it('follows the tab unless a size is fixed, with even widths in range', () => {
    expect(desktopSize(conn(), { width: 1201.4, height: 801 }, { width: 1920, height: 1080 })).toEqual({ width: 1200, height: 801, follow: true });
    expect(desktopSize(conn({ dynamicResolution: false }), { width: 1000, height: 700 }, { width: 1920, height: 1080 }).follow).toBe(false);
    expect(desktopSize(conn({ fullscreen: true }), { width: 1000, height: 700 }, { width: 2560, height: 1440 })).toEqual({ width: 2560, height: 1440, follow: true });
    expect(evenSize(50, 99999)).toEqual({ width: 200, height: 8192 });
    expect(evenSize(1025, 768).width).toBe(1024);
  });
});

describe('keys', () => {
  it('sends physical keys as scancodes, extended ones with 0xE0', () => {
    expect(rdpKey({ code: 'KeyA', key: 'a' })).toEqual({ t: 'scancode', code: 0x1e });
    expect(rdpKey({ code: 'KeyQ', key: 'a' })).toEqual({ t: 'scancode', code: 0x10 }); // AZERTY: the remote layout decides
    expect(rdpKey({ code: 'ArrowLeft', key: 'ArrowLeft' })).toEqual({ t: 'scancode', code: 0xe04b });
    expect(rdpKey({ code: 'MetaLeft', key: 'Meta' })).toEqual({ t: 'scancode', code: 0xe05b });
    expect(rdpKey({ code: 'NumpadEnter', key: 'Enter' })).toEqual({ t: 'scancode', code: 0xe01c });
    expect(rdpKey({ code: 'Unknown', key: '' })).toBeNull();
    expect(Object.values(SCANCODES).every((c) => c > 0 && (c < 0x80 || (c >= 0xe000 && c < 0xe080)))).toBe(true);
  });
  it('types letters as letters when asked, but shortcuts stay keys', () => {
    expect(rdpKey({ code: 'KeyQ', key: 'a' }, 'letters')).toEqual({ t: 'unicode', text: 'a' });
    expect(rdpKey({ code: 'Digit2', key: 'é' }, 'letters')).toEqual({ t: 'unicode', text: 'é' });
    expect(rdpKey({ code: 'KeyC', key: 'c', ctrlKey: true }, 'letters')).toEqual({ t: 'scancode', code: 0x2e });
    expect(rdpKey({ code: 'KeyQ', key: '@', ctrlKey: true, altKey: true }, 'letters')).toEqual({ t: 'unicode', text: '@' }); // AltGr
    expect(rdpKey({ code: 'Enter', key: 'Enter' }, 'letters')).toEqual({ t: 'scancode', code: 0x1c });
  });
  it('presses combinations in order and lets go in reverse', () => {
    expect(comboScancodes(RDP_COMBOS.cad.keys)).toEqual([
      { code: 0x1d, down: true }, { code: 0x38, down: true }, { code: 0xe053, down: true },
      { code: 0xe053, down: false }, { code: 0x38, down: false }, { code: 0x1d, down: false },
    ]);
    expect(RDP_COMBOS.win.keys).toEqual([0xe05b]);
  });
  it('splits DOMAIN\\name', () => {
    expect(splitUser('WORK\\ana')).toEqual({ user: 'ana', domain: 'WORK' });
    expect(splitUser(' ana@work.example ')).toEqual({ user: 'ana@work.example' });
    expect(splitUser('\\ana')).toEqual({ user: '\\ana' });
  });
});

describe('the engine’s errors', () => {
  it('in plain words, without its source locations', () => {
    expect(engineMessage('[read frame by hint @ /home/runner/work/IronRDP/IronRDP/crates/ironrdp-connector/src/lib.rs:416] custom error: not enough bytes')).toBe('The computer closed the connection before the session started.');
    expect(engineMessage('[x @ a.rs:1] general error: server sent license error')).toBe('Server sent license error.');
    expect(engineMessage('Operation timed out')).toBe('The computer stopped answering.');
    expect(engineMessage('')).toBe('The connection did not start.');
  });
});

describe('the relay’s checks', () => {
  it('wants this session’s token and this computer', () => {
    const req = { destination: 'Desk.lan:3389', token: 'tok', x224: new Uint8Array() };
    expect(relayRefusal(req, { token: 'tok', destination: 'desk.lan:3389' })).toBeNull();
    expect(relayRefusal(req, { token: 'other', destination: 'desk.lan:3389' })).toBe('token');
    expect(relayRefusal(req, { token: 'tok', destination: 'evil:3389' })).toBe('destination');
    expect(destinationOf('fe80::1', 3389)).toBe('[fe80::1]:3389');
    expect(destinationOf('desk', 3390)).toBe('desk:3390');
  });
});

describe('the engine as a downloadable part', () => {
  const info = (state: ComponentInfo['state']): ComponentInfo => ({ id: 'ironrdp', name: 'x', description: '', state, downloadSize: 1, estimate: true, sizeOnDisk: 0, neededBy: ['remoteDesktops'] });
  it('is found by its one script and belongs to Remote Desktops', () => {
    expect(probePath('ironrdp', 'win32', 'x64')).toBe('iron-remote-desktop-rdp.js');
    expect(componentsFor(['remoteDesktops'])).toContain('ironrdp');
    expect(componentsFor(['remoteDesktops'], { partly: false })).not.toContain('ironrdp');
  });
  it('waits for its first use: no download after an update, no offer on the feature’s row', () => {
    const base = { previousVersion: '1.0.0', currentVersion: '1.0.1', onFeatures: ['remoteDesktops'], platform: 'linux', arch: 'x64' };
    expect(backgroundPlan({ ...base, infos: [info('missing')] })).toEqual([]);
    expect(backgroundPlan({ ...base, infos: [info('outdated')] })).toEqual(['ironrdp']);
    expect(missingFor('remoteDesktops', [info('missing')])).toEqual([]);
    expect(missingFor('remoteDesktops', [info('error')]).map((x) => x.id)).toEqual(['ironrdp']);
  });
  it('is on in Where it appears unless switched off', () => {
    expect(normalizePlaces({}).rdpInTab).toBe(true);
    expect(normalizePlaces({ rdpInTab: false }).rdpInTab).toBe(false);
  });
});

// ---------------------------------------------------------------- the relay over real sockets

const KEY = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgMCWyRlQn9j+C5XlK
iSKpMTmytF23+tFuPKDW/MfApVWhRANCAARwxlgnHbiMWwB26iTY98htBYg7PYQt
jhaFeiNwfPYUlGoOtM1Xf63luHTOoZh7HEe/3c0KE5kaISM2CZFmK3T4
-----END PRIVATE KEY-----`;
const CERT = `-----BEGIN CERTIFICATE-----
MIIBljCCATugAwIBAgIUTD4Ii1ckx1uv3tNnm+9cxHCaWiEwCgYIKoZIzj0EAwIw
FDESMBAGA1UEAwwJZGVzay50ZXN0MCAXDTI2MTEwNDAzMDIzM1oYDzIxMjYxMDEx
MDMwMjMzWjAUMRIwEAYDVQQDDAlkZXNrLnRlc3QwWTATBgcqhkjOPQIBBggqhkjO
PQMBBwNCAARwxlgnHbiMWwB26iTY98htBYg7PYQtjhaFeiNwfPYUlGoOtM1Xf63l
uHTOoZh7HEe/3c0KE5kaISM2CZFmK3T4o2kwZzAdBgNVHQ4EFgQUYhJiXJ4gwoas
8XEusxEmjoh/MR0wHwYDVR0jBBgwFoAUYhJiXJ4gwoas8XEusxEmjoh/MR0wDwYD
VR0TAQH/BAUwAwEB/zAUBgNVHREEDTALgglkZXNrLnRlc3QwCgYIKoZIzj0EAwID
SQAwRgIhAMTpsa3r6Z44rMk/qlcspyDllDctMXpuBll7bT3HxNMzAiEAvp8FbLcY
HsTxtn6eg6Ho22iU8FomCV4iMaFfQVJ8TT8=
-----END CERTIFICATE-----`;
const CERT_SHA256 = 'EE:39:59:F6:10:AB:55:E7:BE:3F:AC:9E:3B:0B:66:1F:86:0B:C4:45:D0:7F:C6:64:D1:20:26:A2:17:99:CC:CD';
const CERT_PIN = `sha256/${Buffer.from(CERT_SHA256.replace(/:/g, ''), 'hex').toString('base64')}`;

/** A stand-in RDP server: reads the X.224 request, confirms HYBRID (or refuses), then speaks TLS and echoes "ECHO:" + what it gets. */
function fakeRdp(o: { refuse?: number } = {}): Promise<{ port: number; requests: Uint8Array[]; got: Buffer[]; close(): void }> {
  const requests: Uint8Array[] = [];
  const got: Buffer[] = [];
  const socks = new Set<net.Socket>();
  const srv = net.createServer((s) => {
    socks.add(s);
    s.on('error', () => undefined);
    let buf = Buffer.alloc(0);
    const onData = (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      const n = tpktLength(buf);
      if (n === null || buf.length < n) return;
      s.off('data', onData);
      requests.push(new Uint8Array(buf.subarray(0, n)));
      const neg = o.refuse ? [3, 0, 8, 0, o.refuse, 0, 0, 0] : [2, 0x1f, 8, 0, PROTOCOL_HYBRID, 0, 0, 0];
      s.write(Buffer.from([3, 0, 0, 19, 14, 0xd0, 0, 0, 0x12, 0x34, 0, ...neg]));
      if (o.refuse) { s.end(); return; }
      const t = new tls.TLSSocket(s, { isServer: true, key: KEY, cert: CERT });
      t.on('error', () => undefined);
      t.on('data', (x: Buffer) => { got.push(x); t.write(Buffer.concat([Buffer.from('ECHO:'), x])); });
    };
    s.on('data', onData);
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({
    port: (srv.address() as net.AddressInfo).port, requests, got,
    close: () => { srv.close(); for (const s of socks) s.destroy(); },
  })));
}

/** The engine's side: a WebSocket to the relay that sends one request and collects what comes back. */
async function engineSide(url: string) {
  const ws = await connectWs(url, 'local', 5000);
  const inbox: Uint8Array[] = [];
  let closed = false;
  ws.onmessage = (d) => inbox.push(d);
  ws.onclose = () => { closed = true; };
  const next = async (ms = 5000) => {
    const t0 = Date.now();
    while (!inbox.length) {
      if (Date.now() - t0 > ms) throw new Error('nothing came back');
      await new Promise((r) => setTimeout(r, 20));
    }
    return inbox.shift()!;
  };
  return { ws, next, get closed() { return closed; } };
}

const cleanup: (() => void)[] = [];
afterEach(() => { while (cleanup.length) cleanup.pop()!(); });

describe('the relay', () => {
  it('passes the request on, does TLS, answers with the certificate, then copies bytes both ways', async () => {
    const srv = await fakeRdp();
    cleanup.push(srv.close);
    const states: string[] = [];
    const relay = new RdpRelay({ host: '127.0.0.1', port: srv.port, name: 'desk.test', destination: 'desk.test:3389', pin: CERT_PIN, onState: (s) => states.push(s) });
    await relay.listen();
    cleanup.push(() => relay.close());
    expect(relay.url).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/rdp\/[\w-]{32}$/);
    const e = await engineSide(relay.url);
    const cr = x224Request(PROTOCOL_SSL | PROTOCOL_HYBRID, 'ana');
    // In two pieces, as a WebSocket may deliver it.
    const req = encodeRDCleanPath({ version: 3390, destination: 'desk.test:3389', proxyAuth: relay.token, x224: cr });
    e.ws.send(req.subarray(0, 10));
    e.ws.send(req.subarray(10));
    const answer = decodeRDCleanPath(await e.next());
    expect(answer.error).toBeUndefined();
    expect(parseConfirm(answer.x224!)).toEqual({ ok: true, protocol: PROTOCOL_HYBRID });
    expect(colonHex(createHash('sha256').update(answer.certChain![0]).digest())).toBe(CERT_SHA256);
    expect(answer.serverAddr).toMatch(/^127\.0\.0\.1:\d+$/);
    expect(hex(srv.requests[0])).toBe(hex(cr));
    expect(states).toContain('connected');
    e.ws.send(new TextEncoder().encode('TSRequest'));
    const back = Buffer.from(await e.next()).toString();
    expect(back).toBe('ECHO:TSRequest');
    expect(Buffer.concat(srv.got).toString()).toBe('TSRequest');
    expect(relay.sent).toBe(9);
  });

  it('refuses a wrong token, another computer and a wrong path, without dialling', async () => {
    const srv = await fakeRdp();
    cleanup.push(srv.close);
    const errors: string[] = [];
    const relay = new RdpRelay({ host: '127.0.0.1', port: srv.port, name: 'desk.test', destination: 'desk.test:3389', pin: CERT_PIN, onState: (_s, why) => { if (why) errors.push(why); } });
    await relay.listen();
    cleanup.push(() => relay.close());
    const bad = await engineSide(relay.url);
    bad.ws.send(encodeRDCleanPath({ version: 3390, destination: 'desk.test:3389', proxyAuth: 'guess', x224: x224Request(3) }));
    expect(decodeRDCleanPath(await bad.next()).error?.errorCode).toBe(1);
    const other = await engineSide(relay.url);
    other.ws.send(encodeRDCleanPath({ version: 3390, destination: 'bank.example:3389', proxyAuth: relay.token, x224: x224Request(3) }));
    expect(decodeRDCleanPath(await other.next()).error?.errorCode).toBe(1);
    expect(errors.join(' ')).toMatch(/token.*another computer/);
    expect(srv.requests).toHaveLength(0);
    await expect(connectWs(relay.url.replace(/\/rdp\/.*/, '/rdp/nope'), 'local', 3000)).rejects.toBeTruthy();
  });

  it('refuses a certificate other than the trusted one', async () => {
    const srv = await fakeRdp();
    cleanup.push(srv.close);
    const errors: string[] = [];
    const relay = new RdpRelay({ host: '127.0.0.1', port: srv.port, name: 'desk.test', destination: 'desk.test:3389', pin: 'sha256/somethingelse=', onState: (_s, why) => { if (why) errors.push(why); } });
    await relay.listen();
    cleanup.push(() => relay.close());
    const e = await engineSide(relay.url);
    e.ws.send(encodeRDCleanPath({ version: 3390, destination: 'desk.test:3389', proxyAuth: relay.token, x224: x224Request(3) }));
    const a = decodeRDCleanPath(await e.next());
    expect(a.error).toMatchObject({ errorCode: 105, tlsAlertCode: 42 });
    expect(a.certChain).toBeUndefined();
    expect(errors[0]).toMatch(/different certificate/);
  });

  it('passes a refusal on with the server’s own answer', async () => {
    const srv = await fakeRdp({ refuse: 5 });
    cleanup.push(srv.close);
    const errors: string[] = [];
    const relay = new RdpRelay({ host: '127.0.0.1', port: srv.port, name: 'desk.test', destination: 'desk.test:3389', acceptAny: true, onState: (_s, why) => { if (why) errors.push(why); } });
    await relay.listen();
    cleanup.push(() => relay.close());
    const e = await engineSide(relay.url);
    e.ws.send(encodeRDCleanPath({ version: 3390, destination: 'desk.test:3389', proxyAuth: relay.token, x224: x224Request(1) }));
    const a = decodeRDCleanPath(await e.next());
    expect(a.error?.errorCode).toBe(2);
    expect(parseConfirm(a.x224!)).toEqual({ ok: false, failure: 5 });
    expect(errors[0]).toMatch(/Network Level Authentication/);
  });

  it('reads the certificate before a session (for the first-connection question)', async () => {
    const srv = await fakeRdp();
    cleanup.push(srv.close);
    const c = await probeRdpCert('127.0.0.1', srv.port, 'desk.test');
    expect(c).toMatchObject({ sha256: CERT_SHA256, pin: CERT_PIN, subject: 'desk.test', systemTrusted: false });
    expect(c.sha1).toMatch(/^([0-9A-F]{2}:){19}[0-9A-F]{2}$/);
    expect(requestedProtocols(srv.requests[0])).toBe(PROTOCOL_SSL | PROTOCOL_HYBRID);
  });
});
