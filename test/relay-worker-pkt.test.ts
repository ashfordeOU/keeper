// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper Mesh's packet path on the Cloudflare Worker relay (relay/cloudflare/
// pkt.js): the same rules as the Node relay, with stand-in sockets, and then
// Keeper's real PacketRelayClient talking to it over real WebSockets.

import crypto from 'node:crypto';
import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deviceId, newIdentity, sign, type Identity } from '../core/link/identity';
import { acceptWebSocket } from '../core/link/ws';
import { PacketRelayClient, unwrap as nodeUnwrap, wrap as nodeWrap } from '../core/mesh/packet-relay';
// @ts-expect-error plain JavaScript module of the Worker
import { CONTEXT, deviceIdOf, ID_RE, MAX_PACKET, PacketHub, unwrap, wrap } from '../relay/cloudflare/pkt.js';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!fn() && Date.now() < end) await wait(20);
}

type Ev = { data: unknown };
/** A stand-in for an accepted Workers WebSocket. */
class FakeWs {
  sent: (string | Uint8Array)[] = [];
  closed?: { code: number; reason: string };
  private l: Record<string, ((e: Ev) => void)[]> = { message: [], close: [] };
  send(d: string | Uint8Array) { if (this.closed) throw new Error('closed'); this.sent.push(d); }
  close(code: number, reason: string) { if (this.closed) return; this.closed = { code, reason }; for (const f of this.l.close) f({ data: undefined }); }
  addEventListener(k: string, f: (e: Ev) => void) { this.l[k].push(f); }
  /** from the device */
  emit(d: string | Uint8Array | ArrayBuffer) { for (const f of this.l.message) f({ data: d }); }
  texts() { return this.sent.filter((x): x is string => typeof x === 'string').map((x) => JSON.parse(x)); }
  packets() { return this.sent.filter((x): x is Uint8Array => typeof x !== 'string').map((x) => unwrap(x)); }
}

async function joined(hub: InstanceType<typeof PacketHub>, me: Identity) {
  const ws = new FakeWs();
  const id = deviceId(me.publicKey);
  hub.join(ws, id);
  const n = ws.texts()[0].n;
  ws.emit(JSON.stringify({ t: 'auth', pub: me.publicKey.toString('base64'), sig: sign(me, Buffer.from(CONTEXT + n)).toString('base64') }));
  await waitFor(() => ws.texts().some((m) => m.t === 'ready'));
  return { ws, id };
}

describe('the Worker relay’s packet path (logic)', () => {
  it('frames packets exactly as the Node relay does, and names devices the same way', async () => {
    const pkt = crypto.randomBytes(300);
    const id = 'abcdefghijkmnpqr';
    expect(Buffer.from(wrap(id, pkt)).equals(Buffer.from(nodeWrap(id, pkt)))).toBe(true);
    expect(unwrap(nodeWrap(id, pkt))).toEqual(nodeUnwrap(nodeWrap(id, pkt)));
    expect(unwrap(new Uint8Array(16 + MAX_PACKET + 1))).toBeNull();
    expect(unwrap(new Uint8Array(10))).toBeNull();
    const me = newIdentity();
    expect(await deviceIdOf(new Uint8Array(me.publicKey))).toBe(deviceId(me.publicKey));
    expect(ID_RE.test(deviceId(me.publicKey))).toBe(true);
  });

  it('passes a packet only when both devices listed each other; a third device is dropped', async () => {
    const hub = new PacketHub();
    const a = await joined(hub, newIdentity());
    const b = await joined(hub, newIdentity());
    const c = await joined(hub, newIdentity());
    const p = crypto.randomBytes(1400);
    a.ws.emit(JSON.stringify({ t: 'allow', ids: [b.id] }));
    a.ws.emit(wrap(b.id, p));
    expect(b.ws.packets()).toHaveLength(0); // b has not allowed a yet
    b.ws.emit(JSON.stringify({ t: 'allow', ids: [a.id] }));
    a.ws.emit(wrap(b.id, p).buffer); // an ArrayBuffer, as Workers deliver binary messages
    expect(b.ws.packets()).toHaveLength(1);
    expect(b.ws.packets()[0].id).toBe(a.id);
    expect(Buffer.from(b.ws.packets()[0].packet).equals(p)).toBe(true);
    c.ws.emit(JSON.stringify({ t: 'allow', ids: [b.id] }));
    c.ws.emit(wrap(b.id, p));
    expect(b.ws.packets()).toHaveLength(1);
    expect(hub.stats).toMatchObject({ packets: 1, bytes: 1400 });
    expect(hub.stats.dropped).toBe(2);
    c.ws.emit(JSON.stringify({ t: 'ping' }));
    expect(c.ws.texts().at(-1)).toEqual({ t: 'pong' });
  });

  it('refuses a device that cannot prove its id, and one that never tries', async () => {
    const hub = new PacketHub({ authMs: 50 });
    const real = newIdentity();
    const fake = newIdentity();
    const ws = new FakeWs();
    hub.join(ws, deviceId(real.publicKey));
    ws.emit(JSON.stringify({ t: 'auth', pub: fake.publicKey.toString('base64'), sig: sign(fake, Buffer.from(CONTEXT + ws.texts()[0].n)).toString('base64') }));
    await waitFor(() => !!ws.closed);
    expect(ws.closed?.reason).toBe('bad proof');
    // the right key, signing the wrong context (Link's relay sign-in), is refused too
    const ws2 = new FakeWs();
    hub.join(ws2, deviceId(real.publicKey));
    ws2.emit(JSON.stringify({ t: 'auth', pub: real.publicKey.toString('base64'), sig: sign(real, Buffer.from('keeper-relay ' + ws2.texts()[0].n)).toString('base64') }));
    await waitFor(() => !!ws2.closed);
    expect(ws2.closed?.reason).toBe('bad proof');
    const idle = new FakeWs();
    hub.join(idle, deviceId(real.publicKey));
    await wait(120);
    expect(idle.closed?.reason).toBe('no proof');
    const bad = new FakeWs();
    hub.join(bad, 'NOT-AN-ID');
    expect(bad.closed?.reason).toBe('bad request');
    expect(hub.members.size).toBe(0);
  });

  it('a second connection for the same device replaces the first; leaving forgets it', async () => {
    const hub = new PacketHub();
    const me = newIdentity();
    const one = await joined(hub, me);
    const two = await joined(hub, me);
    expect(one.ws.closed?.reason).toBe('replaced');
    expect(hub.members.get(two.id)?.ws).toBe(two.ws);
    two.ws.close(1000, 'bye');
    expect(hub.members.size).toBe(0);
  });

  it('keeps to the byte budget per second and the device limit', async () => {
    let t = 1000;
    const hub = new PacketHub({ bytesPerSecond: 3000, maxDevices: 2, now: () => t });
    const a = await joined(hub, newIdentity());
    const b = await joined(hub, newIdentity());
    expect(hub.admits(deviceId(newIdentity().publicKey))).toBe(false);
    expect(hub.admits(a.id)).toBe(true); // reconnecting is fine
    a.ws.emit(JSON.stringify({ t: 'allow', ids: [b.id] }));
    b.ws.emit(JSON.stringify({ t: 'allow', ids: [a.id] }));
    for (let i = 0; i < 3; i++) a.ws.emit(wrap(b.id, new Uint8Array(1400)));
    expect(b.ws.packets()).toHaveLength(2);
    t += 1500;
    a.ws.emit(wrap(b.id, new Uint8Array(1400)));
    expect(b.ws.packets()).toHaveLength(3);
  });
});

describe('Keeper’s mesh client against the Worker’s packet path, over real WebSockets', () => {
  let server: http.Server;
  let url: string;
  const hub = new PacketHub();

  beforeAll(async () => {
    server = http.createServer((_q, s) => s.end('x'));
    // The Worker hands /v1/pkt upgrades to the hub; here a Node server does, through the same socket shape.
    server.on('upgrade', (req, socket, head) => {
      const u = new URL(req.url ?? '/', 'http://x');
      const id = u.searchParams.get('id') ?? '';
      if (u.pathname !== '/v1/pkt' || !hub.admits(id)) return void socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      const w = acceptWebSocket(req, socket, head, 'relay');
      if (!w) return;
      const l: Record<string, ((e: Ev) => void)[]> = { message: [], close: [] };
      w.ontext = (s) => l.message.forEach((f) => f({ data: s }));
      w.onmessage = (d) => l.message.forEach((f) => f({ data: new Uint8Array(d) }));
      w.onclose = () => l.close.forEach((f) => f({ data: undefined }));
      hub.join({ send: (d: string | Uint8Array) => (typeof d === 'string' ? w.sendText(d) : w.send(d)), close: (_c: number, r: string) => w.close(r), addEventListener: (k: string, f: (e: Ev) => void) => l[k].push(f) }, id);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(() => { hub.close(); server.close(); });

  it('two devices exchange WireGuard-sized packets both ways; an unlisted one cannot reach them', async () => {
    const a = newIdentity();
    const b = newIdentity();
    const c = newIdentity();
    const A = deviceId(a.publicKey);
    const B = deviceId(b.publicKey);
    const ca = new PacketRelayClient(url, a);
    const cb = new PacketRelayClient(url, b);
    const cc = new PacketRelayClient(url, c);
    await Promise.all([ca.connect(), cb.connect(), cc.connect()]);
    const gotB: Buffer[] = [];
    const gotA: Buffer[] = [];
    cb.onpacket = (from, p) => { if (from === A) gotB.push(Buffer.from(p)); };
    ca.onpacket = (from, p) => { if (from === B) gotA.push(Buffer.from(p)); };
    ca.setAllow([B]);
    cb.setAllow([A]);
    cc.setAllow([B]);
    await wait(80);
    const p1 = crypto.randomBytes(1420);
    const p2 = crypto.randomBytes(148);
    ca.send(B, p1);
    cb.send(A, p2);
    cc.send(B, crypto.randomBytes(64));
    await waitFor(() => gotA.length === 1 && gotB.length === 1);
    expect(gotB[0].equals(p1)).toBe(true);
    expect(gotA[0].equals(p2)).toBe(true);
    await wait(100);
    expect(gotB).toHaveLength(1);
    expect(hub.stats.dropped).toBeGreaterThanOrEqual(1);
    ca.close();
    cb.close();
    cc.close();
  });
});
