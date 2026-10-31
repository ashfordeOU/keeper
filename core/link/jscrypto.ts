// SPDX-License-Identifier: AGPL-3.0-or-later
// Small, dependency-free cryptography for places without WebCrypto or a
// ChaCha20 cipher: the phone companion page served over plain HTTP on the
// local network (browsers only offer crypto.subtle on secure pages), and the
// app side that talks to it. SHA-256, HMAC, HKDF (RFC 5869) and
// ChaCha20-Poly1305 (RFC 8439). Checked against Node's own implementations
// in test/link.test.ts. Device-to-device links use Node's AES-256-GCM instead.

// ---------------------------------------------------------------- bytes

export const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
export const fromUtf8 = (b: Uint8Array): string => new TextDecoder().decode(b);

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function toHex(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += x.toString(16).padStart(2, '0');
  return s;
}

export function fromHex(h: string): Uint8Array {
  const out = new Uint8Array(h.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** base64url without padding */
export function toB64u(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    if (i + 1 < b.length) s += B64[(n >> 6) & 63];
    if (i + 2 < b.length) s += B64[n & 63];
  }
  return s;
}

export function fromB64u(s: string): Uint8Array {
  const clean = s.replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n = (B64.indexOf(clean[i]) << 18) | (B64.indexOf(clean[i + 1]) << 12) | ((i + 2 < clean.length ? B64.indexOf(clean[i + 2]) : 0) << 6) | (i + 3 < clean.length ? B64.indexOf(clean[i + 3]) : 0);
    out[o++] = (n >> 16) & 255;
    if (i + 2 < clean.length) out[o++] = (n >> 8) & 255;
    if (i + 3 < clean.length) out[o++] = n & 255;
  }
  return out.subarray(0, o);
}

/** Constant-time comparison. */
export function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

// ---------------------------------------------------------------- SHA-256

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function sha256(data: Uint8Array): Uint8Array {
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const bits = data.length * 8;
  const padLen = ((data.length + 9 + 63) >> 6) << 6;
  const m = new Uint8Array(padLen);
  m.set(data);
  m[data.length] = 0x80;
  const dv = new DataView(m.buffer);
  dv.setUint32(padLen - 8, Math.floor(bits / 0x100000000));
  dv.setUint32(padLen - 4, bits >>> 0);
  const w = new Uint32Array(64);
  for (let off = 0; off < padLen; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15], b = w[i - 2];
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) ov.setUint32(i * 4, h[i]);
  return out;
}

export function hmacSha256(key: Uint8Array, data: Uint8Array): Uint8Array {
  let k = key.length > 64 ? sha256(key) : key;
  const kk = new Uint8Array(64);
  kk.set(k);
  k = kk;
  const ipad = k.map((x) => x ^ 0x36);
  const opad = k.map((x) => x ^ 0x5c);
  return sha256(concat(opad, sha256(concat(ipad, data))));
}

/** HKDF-SHA256 (RFC 5869). */
export function hkdf(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Uint8Array {
  const prk = hmacSha256(salt.length ? salt : new Uint8Array(32), ikm);
  const out = new Uint8Array(length);
  let t: Uint8Array = new Uint8Array(0);
  for (let i = 0, o = 0; o < length; i++) {
    t = hmacSha256(prk, concat(t, info, new Uint8Array([i + 1])));
    out.set(t.subarray(0, Math.min(t.length, length - o)), o);
    o += t.length;
  }
  return out;
}

// ---------------------------------------------------------------- ChaCha20

function quarter(s: Uint32Array, a: number, b: number, c: number, d: number) {
  s[a] += s[b]; s[d] ^= s[a]; s[d] = (s[d] << 16) | (s[d] >>> 16);
  s[c] += s[d]; s[b] ^= s[c]; s[b] = (s[b] << 12) | (s[b] >>> 20);
  s[a] += s[b]; s[d] ^= s[a]; s[d] = (s[d] << 8) | (s[d] >>> 24);
  s[c] += s[d]; s[b] ^= s[c]; s[b] = (s[b] << 7) | (s[b] >>> 25);
}

function chachaBlock(key: Uint8Array, counter: number, nonce: Uint8Array, out: Uint8Array) {
  const kv = new DataView(key.buffer, key.byteOffset, 32);
  const nv = new DataView(nonce.buffer, nonce.byteOffset, 12);
  const init = new Uint32Array(16);
  init[0] = 0x61707865; init[1] = 0x3320646e; init[2] = 0x79622d32; init[3] = 0x6b206574;
  for (let i = 0; i < 8; i++) init[4 + i] = kv.getUint32(i * 4, true);
  init[12] = counter;
  for (let i = 0; i < 3; i++) init[13 + i] = nv.getUint32(i * 4, true);
  const s = init.slice();
  for (let i = 0; i < 10; i++) {
    quarter(s, 0, 4, 8, 12); quarter(s, 1, 5, 9, 13); quarter(s, 2, 6, 10, 14); quarter(s, 3, 7, 11, 15);
    quarter(s, 0, 5, 10, 15); quarter(s, 1, 6, 11, 12); quarter(s, 2, 7, 8, 13); quarter(s, 3, 4, 9, 14);
  }
  const ov = new DataView(out.buffer, out.byteOffset, 64);
  for (let i = 0; i < 16; i++) ov.setUint32(i * 4, (s[i] + init[i]) >>> 0, true);
}

export function chacha20(key: Uint8Array, nonce: Uint8Array, counter: number, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length);
  const block = new Uint8Array(64);
  for (let off = 0; off < data.length; off += 64, counter++) {
    chachaBlock(key, counter, nonce, block);
    const n = Math.min(64, data.length - off);
    for (let i = 0; i < n; i++) out[off + i] = data[off + i] ^ block[i];
  }
  return out;
}

// ---------------------------------------------------------------- Poly1305 (16-bit limbs, after the public-domain "poly1305-donna-16")

export function poly1305(key: Uint8Array, msg: Uint8Array): Uint8Array {
  const r = new Uint16Array(10);
  const h = new Uint16Array(10);
  const pad = new Uint16Array(8);
  const t = new Uint16Array(8);
  for (let i = 0; i < 8; i++) t[i] = key[i * 2] | (key[i * 2 + 1] << 8);
  r[0] = t[0] & 0x1fff;
  r[1] = ((t[0] >>> 13) | (t[1] << 3)) & 0x1fff;
  r[2] = ((t[1] >>> 10) | (t[2] << 6)) & 0x1f03;
  r[3] = ((t[2] >>> 7) | (t[3] << 9)) & 0x1fff;
  r[4] = ((t[3] >>> 4) | (t[4] << 12)) & 0x00ff;
  r[5] = (t[4] >>> 1) & 0x1ffe;
  r[6] = ((t[4] >>> 14) | (t[5] << 2)) & 0x1fff;
  r[7] = ((t[5] >>> 11) | (t[6] << 5)) & 0x1f81;
  r[8] = ((t[6] >>> 8) | (t[7] << 8)) & 0x1fff;
  r[9] = (t[7] >>> 5) & 0x007f;
  for (let i = 0; i < 8; i++) pad[i] = key[16 + i * 2] | (key[16 + i * 2 + 1] << 8);

  const blocks = (m: Uint8Array, final: boolean) => {
    const hibit = final ? 0 : 1 << 11;
    const d = new Uint32Array(10);
    const tt = new Uint16Array(8);
    for (let i = 0; i < 8; i++) tt[i] = m[i * 2] | (m[i * 2 + 1] << 8);
    h[0] += tt[0] & 0x1fff;
    h[1] += ((tt[0] >>> 13) | (tt[1] << 3)) & 0x1fff;
    h[2] += ((tt[1] >>> 10) | (tt[2] << 6)) & 0x1fff;
    h[3] += ((tt[2] >>> 7) | (tt[3] << 9)) & 0x1fff;
    h[4] += ((tt[3] >>> 4) | (tt[4] << 12)) & 0x1fff;
    h[5] += (tt[4] >>> 1) & 0x1fff;
    h[6] += ((tt[4] >>> 14) | (tt[5] << 2)) & 0x1fff;
    h[7] += ((tt[5] >>> 11) | (tt[6] << 5)) & 0x1fff;
    h[8] += ((tt[6] >>> 8) | (tt[7] << 8)) & 0x1fff;
    h[9] += (tt[7] >>> 5) | hibit;
    let c = 0;
    for (let i = 0; i < 10; i++) {
      let di = c;
      for (let j = 0; j < 10; j++) {
        di += h[j] * (j <= i ? r[i - j] : 5 * r[i + 10 - j]);
        if (j === 4) {
          c = di >>> 13;
          di &= 0x1fff;
        }
      }
      c += di >>> 13;
      di &= 0x1fff;
      d[i] = di;
    }
    c = ((c << 2) + c) | 0;
    c = (c + d[0]) | 0;
    d[0] = c & 0x1fff;
    c >>>= 13;
    d[1] += c;
    for (let i = 0; i < 10; i++) h[i] = d[i];
  };

  let off = 0;
  for (; off + 16 <= msg.length; off += 16) blocks(msg.subarray(off, off + 16), false);
  if (off < msg.length) {
    const last = new Uint8Array(16);
    last.set(msg.subarray(off));
    last[msg.length - off] = 1;
    blocks(last, true);
  }

  // finish
  const g = new Uint16Array(10);
  let c = h[1] >>> 13;
  h[1] &= 0x1fff;
  for (let i = 2; i < 10; i++) {
    h[i] += c;
    c = h[i] >>> 13;
    h[i] &= 0x1fff;
  }
  h[0] += c * 5;
  c = h[0] >>> 13;
  h[0] &= 0x1fff;
  h[1] += c;
  c = h[1] >>> 13;
  h[1] &= 0x1fff;
  h[2] += c;
  g[0] = h[0] + 5;
  c = g[0] >>> 13;
  g[0] &= 0x1fff;
  for (let i = 1; i < 10; i++) {
    g[i] = h[i] + c;
    c = g[i] >>> 13;
    g[i] &= 0x1fff;
  }
  g[9] -= 1 << 13;
  let mask = (c ^ 1) - 1;
  for (let i = 0; i < 10; i++) g[i] &= mask;
  mask = ~mask;
  for (let i = 0; i < 10; i++) h[i] = (h[i] & mask) | g[i];
  h[0] = (h[0] | (h[1] << 13)) & 0xffff;
  h[1] = ((h[1] >>> 3) | (h[2] << 10)) & 0xffff;
  h[2] = ((h[2] >>> 6) | (h[3] << 7)) & 0xffff;
  h[3] = ((h[3] >>> 9) | (h[4] << 4)) & 0xffff;
  h[4] = ((h[4] >>> 12) | (h[5] << 1) | (h[6] << 14)) & 0xffff;
  h[5] = ((h[6] >>> 2) | (h[7] << 11)) & 0xffff;
  h[6] = ((h[7] >>> 5) | (h[8] << 8)) & 0xffff;
  h[7] = ((h[8] >>> 8) | (h[9] << 5)) & 0xffff;
  let f = h[0] + pad[0];
  h[0] = f & 0xffff;
  for (let i = 1; i < 8; i++) {
    f = (((h[i] + pad[i]) | 0) + (f >>> 16)) | 0;
    h[i] = f & 0xffff;
  }
  const out = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    out[i * 2] = h[i] & 0xff;
    out[i * 2 + 1] = (h[i] >>> 8) & 0xff;
  }
  return out;
}

// ---------------------------------------------------------------- ChaCha20-Poly1305 AEAD (RFC 8439)

function macData(aad: Uint8Array, ct: Uint8Array): Uint8Array {
  const pad = (n: number) => (16 - (n % 16)) % 16;
  const m = new Uint8Array(aad.length + pad(aad.length) + ct.length + pad(ct.length) + 16);
  m.set(aad, 0);
  m.set(ct, aad.length + pad(aad.length));
  const dv = new DataView(m.buffer);
  const lo = m.length - 16;
  dv.setUint32(lo, aad.length, true);
  dv.setUint32(lo + 8, ct.length, true);
  return m;
}

/** Returns ciphertext || 16-byte tag. */
export function seal(key: Uint8Array, nonce: Uint8Array, plaintext: Uint8Array, aad: Uint8Array = new Uint8Array(0)): Uint8Array {
  const otk = chacha20(key, nonce, 0, new Uint8Array(32));
  const ct = chacha20(key, nonce, 1, plaintext);
  return concat(ct, poly1305(otk, macData(aad, ct)));
}

/** Returns the plaintext, or null when the message was changed or the key is wrong. */
export function open(key: Uint8Array, nonce: Uint8Array, sealed: Uint8Array, aad: Uint8Array = new Uint8Array(0)): Uint8Array | null {
  if (sealed.length < 16) return null;
  const ct = sealed.subarray(0, sealed.length - 16);
  const tag = sealed.subarray(sealed.length - 16);
  const otk = chacha20(key, nonce, 0, new Uint8Array(32));
  if (!equal(poly1305(otk, macData(aad, ct)), tag)) return null;
  return chacha20(key, nonce, 1, ct);
}
