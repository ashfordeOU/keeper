// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The VNC client against recorded handshake bytes and a tiny RFB server that
// speaks over a real TCP socket: sign-in with a VNC password, every picture
// encoding Keeper asks for (Raw, CopyRect, RRE, Hextile, ZRLE), the pointer
// shape, a desktop resize, the clipboard both ways, keys and the pointer.
// Also the port knock and SOCKS5/HTTP proxies.

import net from 'node:net';
import zlib from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { vncResponse } from '../core/rdc/des';
import { createInflater } from '../core/rdc/inflate';
import { probePorts } from '../core/rdc/probe';
import { dialViaProxy, socks5Request } from '../core/rdc/proxy';
import { decodeZrle, PIXEL_FORMAT, RfbClient, type FrameOp, type RfbEvent } from '../core/rdc/rfb';

const be16 = (n: number) => [n >> 8, n & 255];
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const px = (r: number, g: number, b: number) => [r, g, b, 0];

/** Draws ops into an RGBA framebuffer, as the tab does. */
function paint(fb: Uint8Array, W: number, ops: FrameOp[]) {
  for (const op of ops) {
    if (op.t === 'img') for (let y = 0; y < op.h; y++) fb.set(op.data.subarray(y * op.w * 4, (y + 1) * op.w * 4), ((op.y + y) * W + op.x) * 4);
    else if (op.t === 'copy') {
      const src = fb.slice();
      for (let y = 0; y < op.h; y++) fb.set(src.subarray(((op.sy + y) * W + op.sx) * 4, ((op.sy + y) * W + op.sx + op.w) * 4), ((op.y + y) * W + op.x) * 4);
    }
  }
}
const at = (fb: Uint8Array, W: number, x: number, y: number) => [...fb.subarray((y * W + x) * 4, (y * W + x) * 4 + 3)];

class Reader {
  buf = Buffer.alloc(0);
  waiters: (() => void)[] = [];
  constructor(s: net.Socket) { s.on('data', (d) => { this.buf = Buffer.concat([this.buf, d]); this.waiters.splice(0).forEach((w) => w()); }); }
  async read(n: number): Promise<Buffer> {
    while (this.buf.length < n) await new Promise<void>((r) => this.waiters.push(r));
    const out = this.buf.subarray(0, n);
    this.buf = this.buf.subarray(n);
    return out;
  }
}

function zrleStream() {
  const d = zlib.createDeflate();
  const chunks: Buffer[] = [];
  d.on('data', (c: Buffer) => chunks.push(c));
  return (raw: number[]) => new Promise<Buffer>((resolve) => { d.write(Buffer.from(raw)); d.flush(zlib.constants.Z_SYNC_FLUSH, () => resolve(Buffer.concat(chunks.splice(0)))); });
}

const servers: net.Server[] = [];
afterEach(() => { for (const s of servers.splice(0)) s.close(); });

function listen(handler: (s: net.Socket) => void): Promise<number> {
  return new Promise((resolve) => {
    const srv = net.createServer(handler);
    servers.push(srv);
    srv.listen(0, '127.0.0.1', () => resolve((srv.address() as net.AddressInfo).port));
  });
}

describe('rdc: RFB handshake from recorded bytes', () => {
  it('3.3 with no password, then the server name', async () => {
    const sent: Uint8Array[] = [];
    const events: RfbEvent[] = [];
    const c = new RfbClient((d) => sent.push(d), (e) => events.push(e));
    const done = c.run();
    c.feed(Buffer.from('RFB 003.003\n'));
    c.feed(Uint8Array.from([...be32(1)]));
    c.feed(Uint8Array.from([...be16(800), ...be16(600), ...PIXEL_FORMAT, ...be32(4), ...Buffer.from('desk')]));
    await new Promise((r) => setTimeout(r, 10));
    expect(Buffer.from(sent[0]).toString()).toBe('RFB 003.003\n');
    expect([...sent[1]]).toEqual([1]); // shared
    expect(sent[2][0]).toBe(0); // SetPixelFormat
    expect([...sent[2].subarray(4)]).toEqual([...PIXEL_FORMAT]);
    expect(sent[3][0]).toBe(2); // SetEncodings
    expect([...sent[4]]).toEqual([3, 0, 0, 0, 0, 0, ...be16(800), ...be16(600)]); // the whole picture
    expect(events).toContainEqual({ t: 'init', width: 800, height: 600, name: 'desk' });
    c.end();
    await done;
  });

  it('says why a server refuses, and asks for a password only when needed', async () => {
    const events: RfbEvent[] = [];
    const c = new RfbClient(() => undefined, (e) => events.push(e));
    const done = c.run();
    c.feed(Buffer.from('RFB 003.008\n'));
    c.feed(Uint8Array.from([0, ...be32(8), ...Buffer.from('Too many')]));
    await done;
    expect(events).toContainEqual({ t: 'error', message: 'Too many' });
    const ev2: RfbEvent[] = [];
    const c2 = new RfbClient(() => undefined, (e) => ev2.push(e));
    const d2 = c2.run();
    c2.feed(Buffer.from('RFB 003.008\n'));
    c2.feed(Uint8Array.from([1, 2, ...new Array(16).fill(1)]));
    await d2;
    expect(ev2).toContainEqual({ t: 'error', message: 'PASSWORD_NEEDED' });
  });
});

describe('rdc: a tiny RFB server over TCP', () => {
  it('signs in, decodes every encoding, and sends keys, pointer and clipboard', async () => {
    const W = 80, H = 40;
    const fromClient: Buffer[] = [];
    let serverDone: () => void;
    const finished = new Promise<void>((r) => { serverDone = r; });
    const port = await listen(async (s) => {
      const rd = new Reader(s);
      s.write('RFB 003.008\n');
      expect((await rd.read(12)).toString()).toBe('RFB 003.008\n');
      s.write(Buffer.from([1, 2])); // VNC authentication only
      expect((await rd.read(1))[0]).toBe(2);
      const challenge = Buffer.alloc(16, 0).map((_, i) => i * 13);
      s.write(challenge);
      const answer = await rd.read(16);
      expect(answer.equals(Buffer.from(vncResponse('s3cret', challenge)))).toBe(true);
      s.write(Buffer.from(be32(0)));
      await rd.read(1); // ClientInit
      s.write(Buffer.from([...be16(W), ...be16(H), ...PIXEL_FORMAT, ...be32(5), ...Buffer.from('tiny!')]));
      await rd.read(20); // SetPixelFormat
      const enc = await rd.read(4);
      await rd.read(be16(0).length * 0 + enc.readUInt16BE(2) * 4);
      await rd.read(10); // the first update request

      const deflate = zrleStream();
      const rects: number[] = [];
      const rect = (x: number, y: number, w: number, h: number, e: number, body: number[]) => rects.push(...be16(x), ...be16(y), ...be16(w), ...be16(h), ...be32(e >>> 0), ...body);
      // Raw: a 4×2 red block at (0,0).
      rect(0, 0, 4, 2, 0, new Array(8).fill(px(255, 0, 0)).flat());
      // CopyRect: copy it to (10,0).
      rect(10, 0, 4, 2, 1, [...be16(0), ...be16(0)]);
      // RRE: 8×8 blue with a green 2×2 square at (2,2), placed at (20,0).
      rect(20, 0, 8, 8, 2, [...be32(1), ...px(0, 0, 255), ...px(0, 255, 0), ...be16(2), ...be16(2), ...be16(2), ...be16(2)]);
      // Hextile: 20×16 → two tiles. Tile 1: bg white, fg black, one subrect 3×1 at (1,1), one coloured (yellow) 1×1 at (5,5). Tile 2 (4×16): raw grey.
      rect(30, 0, 20, 16, 5, [2 | 4 | 8, ...px(255, 255, 255), ...px(0, 0, 0), 1, 0x11, 0x20,
        // second subencoding byte: 8|16 coloured subrects
      ].concat([]));
      // Fix up: tile 1 needs both kinds; send it as two tiles instead: a plain-subrect tile then a raw tile.
      rects.push(1, ...new Array(4 * 16).fill(px(128, 128, 128)).flat());
      // ZRLE: 70×4 → a 64×4 solid magenta tile and a 6×4 two-colour packed tile, then a second rect with RLE tiles.
      const zA = await deflate([1, 255, 0, 255, 2, 0, 0, 255, 255, 255, 255, ...[0b10101000, 0b01010100, 0b10101000, 0b01010100]]);
      rect(0, 20, 70, 4, 16, [...be32(zA.length), ...zA]);
      const zB = await deflate([128, 10, 20, 30, 2, 40, 50, 60, 255, 255, 255, 0, 130 + 0, 1, 2, 3, 4, 5, 6, 128 | 1, 0]);
      // zB: 4×2 plain RLE: colour (10,20,30) ×3, colour (40,50,60) ×(255+255+255+0+1)=766 (capped to the tile).
      // (the palette-RLE bytes after it belong to no tile and are never read)
      rect(0, 30, 4, 2, 16, [...be32(zB.length), ...zB]);
      // Cursor 2×1: one visible red pixel, one transparent.
      rect(1, 0, 2, 1, -239, [...px(255, 0, 0), ...px(0, 255, 0), 0b10000000]);
      s.write(Buffer.from([0, 0, ...be16(7), ...rects]));
      // Clipboard and a bell.
      s.write(Buffer.from([3, 0, 0, 0, ...be32(5), ...Buffer.from('hello')]));
      s.write(Buffer.from([2]));
      // Desktop resize.
      s.write(Buffer.from([0, 0, ...be16(1), ...be16(0), ...be16(0), ...be16(100), ...be16(50), ...be32(-223 >>> 0)]));
      // Collect what the client sends after that.
      s.on('data', (d) => { fromClient.push(d); if (Buffer.concat(fromClient).length >= 10 + 8 + 6 + 14) serverDone(); });
      rd.buf.length && fromClient.push(rd.buf);
    });

    const events: RfbEvent[] = [];
    const inf = createInflater();
    const sock = net.connect(port, '127.0.0.1');
    const client = new RfbClient((d) => sock.write(d), (e) => events.push(e), { password: 's3cret', inflate: inf.inflate });
    sock.on('data', (d) => client.feed(d));
    sock.on('close', () => client.end());
    const running = client.run();
    const until = async (f: () => boolean) => { for (let i = 0; i < 200 && !f(); i++) await new Promise((r) => setTimeout(r, 10)); };
    await until(() => events.some((e) => e.t === 'resize'));

    expect(events.find((e) => e.t === 'security')).toMatchObject({ name: 'VNC password' });
    expect(events.find((e) => e.t === 'init')).toMatchObject({ width: W, height: H, name: 'tiny!' });
    const upd = events.find((e) => e.t === 'update') as Extract<RfbEvent, { t: 'update' }>;
    expect(upd.ops.map((o) => o.t)).toEqual(['img', 'copy', 'img', 'img', 'img', 'img']);
    const fb = new Uint8Array(W * H * 4);
    paint(fb, W, upd.ops);
    expect(at(fb, W, 0, 0)).toEqual([255, 0, 0]); // raw
    expect(at(fb, W, 13, 1)).toEqual([255, 0, 0]); // copied
    expect(at(fb, W, 20, 0)).toEqual([0, 0, 255]); // RRE background
    expect(at(fb, W, 23, 3)).toEqual([0, 255, 0]); // RRE subrect
    expect(at(fb, W, 30, 0)).toEqual([255, 255, 255]); // hextile background
    expect(at(fb, W, 31, 1)).toEqual([0, 0, 0]); // hextile subrect (x 1, y 1, 3×1)
    expect(at(fb, W, 33, 1)).toEqual([0, 0, 0]);
    expect(at(fb, W, 34, 1)).toEqual([255, 255, 255]);
    expect(at(fb, W, 47, 3)).toEqual([128, 128, 128]); // hextile raw tile
    expect(at(fb, W, 5, 21)).toEqual([255, 0, 255]); // ZRLE solid tile
    expect(at(fb, W, 64, 20)).toEqual([255, 255, 255]); // ZRLE packed: bit 1 → palette[1]
    expect(at(fb, W, 65, 20)).toEqual([0, 0, 255]); // bit 0 → palette[0]
    expect(at(fb, W, 2, 30)).toEqual([10, 20, 30]); // second ZRLE rect (same zlib stream): RLE
    expect(at(fb, W, 3, 30)).toEqual([40, 50, 60]);
    const cur = events.find((e) => e.t === 'cursor') as Extract<RfbEvent, { t: 'cursor' }>;
    expect(cur).toMatchObject({ hotX: 1, hotY: 0, w: 2, h: 1 });
    expect([...cur.rgba]).toEqual([255, 0, 0, 255, 0, 255, 0, 0]);
    expect(events).toContainEqual({ t: 'clipboard', text: 'hello' });
    expect(events).toContainEqual({ t: 'bell' });
    expect(events).toContainEqual({ t: 'resize', width: 100, height: 50 });

    client.requestUpdate(true);
    client.key(0xff0d, true);
    client.pointer(12.4, 7.6, 1);
    client.clipboard('hi\r\nyou');
    await Promise.race([finished, new Promise((r) => setTimeout(r, 2000))]);
    await until(() => Buffer.concat(fromClient).length >= 38);
    const got = [...Buffer.concat(fromClient)];
    expect(got.slice(0, 10)).toEqual([3, 1, 0, 0, 0, 0, ...be16(100), ...be16(50)]);
    expect(got.slice(10, 18)).toEqual([4, 1, 0, 0, ...be32(0xff0d)]);
    expect(got.slice(18, 24)).toEqual([5, 1, ...be16(12), ...be16(8)]);
    expect(got.slice(24, 38)).toEqual([6, 0, 0, 0, ...be32(6), ...Buffer.from('hi\nyou')]);
    sock.destroy();
    await running;
    inf.close();
  });

  it('ZRLE palette RLE tiles', () => {
    // 3×1 tile: palette of 2, index 0 run 2, index 1 once.
    const d = Uint8Array.from([130, 1, 1, 1, 9, 9, 9, 0x80 | 0, 1, 1]);
    const out = decodeZrle(d, 3, 1);
    expect([...out]).toEqual([1, 1, 1, 255, 1, 1, 1, 255, 9, 9, 9, 255]);
  });
});

describe('rdc: the port knock and proxies', () => {
  it('finds what answers, quickly', async () => {
    const open = await listen((s) => s.destroy());
    const closedSrv = net.createServer();
    const closed = await new Promise<number>((r) => closedSrv.listen(0, '127.0.0.1', () => { const p = (closedSrv.address() as net.AddressInfo).port; closedSrv.close(() => r(p)); }));
    const t0 = Date.now();
    const r = await probePorts('127.0.0.1', [open, closed], { timeoutMs: 300 });
    expect(r).toEqual([expect.objectContaining({ port: open, open: true }), expect.objectContaining({ port: closed, open: false })]);
    expect(Date.now() - t0).toBeLessThan(1500);
    // A host that never answers times out instead of hanging.
    const slow = await probePorts('10.255.255.1', [3389], { timeoutMs: 200 });
    expect(slow[0].open).toBe(false);
  });

  it('builds SOCKS5 requests for names and addresses', () => {
    expect([...socks5Request('a.b', 22)]).toEqual([5, 1, 0, 3, 3, 97, 46, 98, 0, 22]);
    expect([...socks5Request('10.0.0.1', 5900)]).toEqual([5, 1, 0, 1, 10, 0, 0, 1, 23, 12]);
    expect(socks5Request('::1', 80).length).toBe(4 + 16 + 2);
  });

  it('reaches a host through a SOCKS5 proxy and an HTTP proxy', async () => {
    const target = await listen((s) => s.end('banner'));
    const socks = await listen((s) => {
      const rd = new Reader(s);
      void (async () => {
        await rd.read(3); s.write(Buffer.from([5, 0]));
        const h = await rd.read(5); const len = h[4]; const rest = await rd.read(len + 2);
        void rest; s.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
        const up = net.connect(target, '127.0.0.1'); up.pipe(s); if (rd.buf.length) up.write(rd.buf); s.on('data', (d) => up.write(d));
      })();
    });
    const http = await listen((s) => {
      s.once('data', (d) => {
        expect(d.toString()).toMatch(/^CONNECT target\.test:\d+ HTTP\/1\.1/);
        s.write('HTTP/1.1 200 Connection established\r\n\r\n');
        net.connect(target, '127.0.0.1').pipe(s);
      });
    });
    const read = (sock: net.Socket) => new Promise<string>((r) => { let t = ''; sock.on('data', (d) => (t += d)); sock.on('end', () => r(t)); });
    expect(await read(await dialViaProxy({ type: 'socks5', host: '127.0.0.1', port: socks }, 'target.test', target))).toBe('banner');
    expect(await read(await dialViaProxy({ type: 'http', host: '127.0.0.1', port: http }, 'target.test', target))).toBe('banner');
  });
});
