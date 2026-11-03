// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// VNC extras, byte by byte: the Tight encoding (fill, JPEG passed through,
// basic copy / palette / gradient filters, small rectangles sent raw, the four
// zlib streams and their reset flags) and Apple's sign-in (RFB security type
// 30: Diffie-Hellman, MD5, AES-128-ECB), checked against a vector computed
// independently (Python's pow and hashlib, OpenSSL's AES) and against a
// stand-in Mac that decrypts what Keeper sent.

import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { ardResponse, parseArdChallenge } from '../core/rdc/ard';
import { createTightInflaters } from '../core/rdc/inflate';
import { decodeTightBasic, DEFAULT_ENCODINGS, ENC, FAST_ENCODINGS, PIXEL_FORMAT, RfbClient, TIGHT_GRADIENT, TIGHT_PALETTE, type FrameOp, type RfbEvent } from '../core/rdc/rfb';

const be16 = (n: number) => [n >> 8, n & 255];
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const tick = () => new Promise((r) => setTimeout(r, 5));
/** Waits until `ok()` holds (the Diffie-Hellman answer can take a while on a slow runner). */
const until = async (ok: () => boolean, ms = 5000) => { const end = Date.now() + ms; while (!ok() && Date.now() < end) await tick(); };
const rect = (x: number, y: number, w: number, h: number, enc: number) => [...be16(x), ...be16(y), ...be16(w), ...be16(h), ...be32(enc >>> 0)];
/** Tight's compact length */
const clen = (n: number) => (n < 128 ? [n] : n < 16384 ? [(n & 127) | 128, n >> 7] : [(n & 127) | 128, ((n >> 7) & 127) | 128, n >> 14]);

/** A zlib stream as a Tight server keeps one: each chunk ends with a sync flush, the stream never ends. */
function deflater() {
  const d = zlib.createDeflate();
  const chunks: Buffer[] = [];
  d.on('data', (c: Buffer) => chunks.push(c));
  return (raw: number[] | Uint8Array) => new Promise<number[]>((resolve) => { d.write(Buffer.from(raw)); d.flush(zlib.constants.Z_SYNC_FLUSH, () => resolve([...Buffer.concat(chunks.splice(0))])); });
}

/** A client after a 3.8 handshake with no password; returns what it sent and the events. */
async function connected(opts: ConstructorParameters<typeof RfbClient>[2] = {}) {
  const sent: Uint8Array[] = [];
  const events: RfbEvent[] = [];
  const c = new RfbClient((d) => sent.push(d), (e) => events.push(e), opts);
  void c.run();
  c.feed(Buffer.from('RFB 003.008\n'));
  c.feed(Uint8Array.from([1, 1]));
  c.feed(Uint8Array.from(be32(0)));
  c.feed(Uint8Array.from([...be16(64), ...be16(64), ...PIXEL_FORMAT, ...be32(1), 0x6d]));
  await tick();
  return { c, sent, events };
}

const RGB = (n: number) => Array.from({ length: n }, (_, i) => [(i * 37) & 255, (i * 91) & 255, (i * 13 + 7) & 255]).flat();
const rgba = (rgb: number[]) => { const o: number[] = []; for (let i = 0; i < rgb.length; i += 3) o.push(rgb[i], rgb[i + 1], rgb[i + 2], 255); return o; };

describe('rdc: Tight', () => {
  it('asks for Tight after ZRLE by default, first with JPEG when “fast” is chosen', async () => {
    expect(DEFAULT_ENCODINGS.slice(0, 2)).toEqual([ENC.zrle, ENC.tight]);
    expect(DEFAULT_ENCODINGS).not.toContain(ENC.jpegQuality6);
    expect(FAST_ENCODINGS[0]).toBe(ENC.tight);
    expect(FAST_ENCODINGS).toContain(-26);
    const { sent } = await connected({ encodings: FAST_ENCODINGS });
    const setEnc = sent.find((s) => s[0] === 2)!;
    expect([...setEnc.subarray(0, 4)]).toEqual([2, 0, ...be16(FAST_ENCODINGS.length)]);
    expect([...setEnc.subarray(4, 8)]).toEqual(be32(7));
    expect(setEnc.length).toBe(4 + 4 * FAST_ENCODINGS.length);
    expect([...setEnc.subarray(4 + 4 * FAST_ENCODINGS.indexOf(-26), 8 + 4 * FAST_ENCODINGS.indexOf(-26))]).toEqual([0xff, 0xff, 0xff, 0xe6]);
  });

  it('decodes fill, JPEG, copy (raw and zlib), two- and many-colour palettes, gradient, and stream resets', async () => {
    const tight = createTightInflaters();
    const { c, events } = await connected({ tightInflate: tight.inflate });
    const z0 = deflater();
    const z2 = deflater();
    const z3 = deflater();
    const jpeg = [0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9];
    const big = RGB(16); // 4×4, 48 bytes: zlib on stream 0
    const pal4 = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120];
    const idx = [0, 1, 2, 3, 3, 2, 1, 0, 0, 0, 3, 3, 1, 2, 1, 2]; // 4×4, 16 bytes: zlib on stream 2
    // gradient 3×2: the server sends differences from left + above − above-left
    const img = [[[10, 20, 30], [12, 22, 33], [15, 25, 36]], [[11, 21, 31], [16, 26, 40], [200, 100, 50]]];
    const grad: number[] = [];
    for (let y = 0; y < 2; y++) for (let x = 0; x < 3; x++) for (let k = 0; k < 3; k++) {
      const left = x ? img[y][x - 1][k] : 0;
      const up = y ? img[y - 1][x][k] : 0;
      const ul = x && y ? img[y - 1][x - 1][k] : 0;
      grad.push((img[y][x][k] - Math.max(0, Math.min(255, left + up - ul))) & 255);
    }
    const zBig = await z0(big);
    const zIdx = await z2(idx);
    const zGrad = await z3(grad);
    const fresh = deflater(); // after the reset flag, stream 0 starts again
    const big2 = RGB(16).reverse();
    const zBig2 = await fresh(big2);
    const msg = [
      0, 0, ...be16(8),
      ...rect(0, 0, 4, 4, 7), 0x80, 1, 2, 3, // fill
      ...rect(4, 0, 8, 8, 7), 0x90, ...clen(jpeg.length), ...jpeg, // JPEG, passed on
      ...rect(0, 4, 2, 1, 7), 0x00, 9, 8, 7, 6, 5, 4, // copy, 6 bytes: sent raw
      ...rect(0, 8, 4, 4, 7), 0x00, ...clen(zBig.length), ...zBig, // copy, zlib stream 0
      ...rect(0, 12, 8, 2, 7), 0x50, TIGHT_PALETTE, 1, 255, 0, 0, 0, 0, 255, 0b10100000, 0b00000001, // 2 colours, 1 bit a pixel, raw
      ...rect(8, 12, 4, 4, 7), 0x60, TIGHT_PALETTE, 3, ...pal4, ...clen(zIdx.length), ...zIdx, // 4 colours on stream 2
      ...rect(16, 0, 3, 2, 7), 0x70, TIGHT_GRADIENT, ...clen(zGrad.length), ...zGrad, // gradient on stream 3
      ...rect(20, 0, 4, 4, 7), 0x01, ...clen(zBig2.length), ...zBig2, // reset stream 0, then copy on it
    ];
    c.feed(Uint8Array.from(msg));
    await new Promise((r) => setTimeout(r, 60));
    const up = events.find((e) => e.t === 'update') as { ops: FrameOp[] } | undefined;
    expect(events.find((e) => e.t === 'error')).toBeUndefined();
    const ops = up!.ops;
    expect(ops).toHaveLength(8);
    expect(ops[0]).toEqual({ t: 'fill', x: 0, y: 0, w: 4, h: 4, rgba: [1, 2, 3] });
    expect(ops[1]).toMatchObject({ t: 'jpeg', x: 4, y: 0, w: 8, h: 8 });
    expect([...(ops[1] as { data: Uint8Array }).data]).toEqual(jpeg);
    expect([...(ops[2] as { data: Uint8Array }).data]).toEqual([9, 8, 7, 255, 6, 5, 4, 255]);
    expect([...(ops[3] as { data: Uint8Array }).data]).toEqual(rgba(big));
    const two = (ops[4] as { data: Uint8Array }).data;
    const pix = (d: Uint8Array, i: number) => [...d.subarray(i * 4, i * 4 + 3)];
    expect([0, 1, 2, 3, 15].map((i) => pix(two, i))).toEqual([[0, 0, 255], [255, 0, 0], [0, 0, 255], [255, 0, 0], [0, 0, 255]]);
    expect(pix(two, 7)).toEqual([255, 0, 0]);
    expect([...(ops[5] as { data: Uint8Array }).data]).toEqual(idx.flatMap((i) => [...pal4.slice(i * 3, i * 3 + 3), 255]));
    expect([...(ops[6] as { data: Uint8Array }).data]).toEqual(img.flat().flatMap((p) => [...p, 255]));
    expect([...(ops[7] as { data: Uint8Array }).data]).toEqual(rgba(big2));
    tight.close();
  });

  it('a gradient that clamps, and data that ends early', () => {
    // the last pixel: left 250 + up 250 − above-left 0 = 500 → clamped to 255, plus 3 → 2 (mod 256)
    const d = new Uint8Array([0, 0, 0, 250, 0, 0, 250, 0, 0, 3, 0, 0]);
    const out = decodeTightBasic(d, 2, 2, TIGHT_GRADIENT);
    expect([...out.subarray(12, 15)]).toEqual([2, 0, 0]);
    expect(() => decodeTightBasic(new Uint8Array(5), 2, 2, 0)).toThrow(/ended early/);
  });
});

// RFC 2409's 1024-bit MODP group (Oakley group 2), generator 2, as a Mac sends it
const PRIME = 'FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B139B22514A08798E3404DDEF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7EDEE386BFB5A899FA5AE9F24117C4B1FE649286651ECE65381FFFFFFFFFFFFFFFF';
// computed with Python's pow(), hashlib.md5 and `openssl enc -aes-128-ecb -nopad`:
// server private 0x11…11 (32 bytes), client private 0x2a…2a (128 bytes), padding 0x00…0x7f, user "ana", password "pässword"
const SERVER_PUB =
  'a3616141ace28df1503b7975754b8c03513504fbe6e5373c7334642867b0bfc34f34b23d197bddfcebb0544f05314647406a35f3a460490a86f201e051503691' +
  '1542486fed3e087748d5e5079e17a362555f92c501caf3c5227c47fb2f9f1f0e1470a8935cfb5b58df64efa5cd0b19880cf20cd472e142af343f983240de1980';
const EXPECTED =
  'bfcbbf74a6296cd36b45c9cce18e14cfcd3fc034ee485fe884c3f3b9cc9318bd2ebe9f327786156d565200173b96b652cbb019d166ae2650632959a74be869c8' +
  'd247869cf50ad8c8d0ad77b8cd550c9f305d2ac513f13a7bedc724d90bf83dcb8ed348f7ac8d901d71eae77d6e2b1a752dc92ab6313f4af081a8b958cde02b83' +
  'dc2759f8cd3cfd5ccc3d97430e959867dbcd776dfc61d83e86eead7529f277b01531eaef2fd0013e911ca0fc9e4492d44bdbf97393ce133667a137a9c1f2d548' +
  '6c962b1ca1b8d34793219facc8a7acb291bce4ee0975f5d592601355becf197a7ca1484be85193d3a2824ec9063779e91cb29b1830629fbbaa98aab8e50f3936';

describe('rdc: Apple’s sign-in (type 30)', () => {
  it('matches the independently computed answer, byte for byte', () => {
    const ch = { generator: 2, prime: Buffer.from(PRIME, 'hex'), serverKey: Buffer.from(SERVER_PUB, 'hex') };
    const out = ardResponse(ch, 'ana', 'pässword', Buffer.alloc(128, 0x2a), Uint8Array.from({ length: 128 }, (_, i) => i));
    expect(Buffer.from(out).toString('hex')).toBe(EXPECTED);
    const wire = Uint8Array.from([...be16(2), ...be16(128), ...ch.prime, ...ch.serverKey]);
    expect(parseArdChallenge(wire)).toMatchObject({ generator: 2 });
    expect(Buffer.from(parseArdChallenge(wire)!.serverKey).toString('hex')).toBe(SERVER_PUB);
    expect(parseArdChallenge(wire.subarray(0, 100))).toBeNull();
    expect(() => ardResponse(ch, 'x'.repeat(64), 'p')).toThrow(/too long/);
  });

  it('signs in to a stand-in Mac that decrypts the name and password it was sent', async () => {
    const dh = crypto.createDiffieHellman(Buffer.from(PRIME, 'hex'), Buffer.from([2]));
    const serverPub = dh.generateKeys();
    const sent: Uint8Array[] = [];
    const events: RfbEvent[] = [];
    const c = new RfbClient((d) => sent.push(d), (e) => events.push(e), { username: 'ana', password: 'owl-123', ard: ardResponse });
    let failed: unknown;
    void c.run().catch((e) => { failed = e; });
    c.feed(Buffer.from('RFB 003.889\n')); // Apple's version string
    c.feed(Uint8Array.from([3, 30, 35, 2])); // macOS offers 30, 35 and the VNC password
    await tick();
    expect(Buffer.from(sent[0]).toString()).toBe('RFB 003.008\n');
    expect([...sent[1]]).toEqual([30]);
    c.feed(Uint8Array.from([...be16(2), ...be16(128), ...Buffer.from(PRIME, 'hex'), ...serverPub]));
    // The Diffie-Hellman answer is computed in JavaScript: give a busy runner time, and say why if it fails.
    await until(() => sent.length > 2 || failed !== undefined, 20_000);
    expect(failed).toBeUndefined();
    expect(sent.length).toBeGreaterThan(2);
    const answer = sent[2];
    expect(answer.length).toBe(256);
    const shared = dh.computeSecret(Buffer.from(answer.subarray(128)));
    const key = crypto.createHash('md5').update(Buffer.concat([Buffer.alloc(128 - shared.length), shared])).digest();
    const d = crypto.createDecipheriv('aes-128-ecb', key, null).setAutoPadding(false);
    const creds = Buffer.concat([d.update(Buffer.from(answer.subarray(0, 128))), d.final()]);
    expect(creds.subarray(0, creds.indexOf(0)).toString()).toBe('ana');
    expect(creds.subarray(64, creds.indexOf(0, 64)).toString()).toBe('owl-123');
    c.feed(Uint8Array.from(be32(0))); // accepted
    c.feed(Uint8Array.from([...be16(1440), ...be16(900), ...PIXEL_FORMAT, ...be32(3), ...Buffer.from('Mac')]));
    await tick();
    expect(events).toContainEqual({ t: 'security', type: 30, name: 'Apple Remote Desktop' });
    expect(events).toContainEqual({ t: 'init', width: 1440, height: 900, name: 'Mac' });
  }, 30_000);

  it('without a user name it uses the VNC password if offered, else says what is missing', async () => {
    const sent: Uint8Array[] = [];
    const c = new RfbClient((d) => sent.push(d), () => undefined, { password: 'x', ard: ardResponse });
    void c.run();
    c.feed(Buffer.from('RFB 003.008\n'));
    c.feed(Uint8Array.from([2, 30, 2]));
    await tick();
    expect([...sent[1]]).toEqual([2]);
    const events: RfbEvent[] = [];
    const c2 = new RfbClient(() => undefined, (e) => events.push(e), { password: 'x', ard: ardResponse });
    void c2.run();
    c2.feed(Buffer.from('RFB 003.008\n'));
    c2.feed(Uint8Array.from([1, 30]));
    await tick();
    expect(events.find((e) => e.t === 'error')).toMatchObject({ message: expect.stringMatching(/add the user name/) });
  });
});
