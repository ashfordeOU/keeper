// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// XChaCha20-Poly1305 (the extended-nonce variant some encrypted notes apps
// use), built on the ChaCha20 and Poly1305 Keeper already has. Keys never
// leave this computer; nothing here is sent anywhere.

import { open, seal } from '../link/jscrypto';

function rotl(x: number, n: number) { return (x << n) | (x >>> (32 - n)); }

function quarter(s: Uint32Array, a: number, b: number, c: number, d: number) {
  s[a] += s[b]; s[d] = rotl(s[d] ^ s[a], 16);
  s[c] += s[d]; s[b] = rotl(s[b] ^ s[c], 12);
  s[a] += s[b]; s[d] = rotl(s[d] ^ s[a], 8);
  s[c] += s[d]; s[b] = rotl(s[b] ^ s[c], 7);
}

/** HChaCha20: a 32-byte subkey from a key and the first 16 bytes of an extended nonce. */
export function hchacha20(key: Uint8Array, nonce16: Uint8Array): Uint8Array {
  if (key.length !== 32 || nonce16.length !== 16) throw new Error('HChaCha20 needs a 32-byte key and a 16-byte nonce');
  const s = new Uint32Array(16);
  s[0] = 0x61707865; s[1] = 0x3320646e; s[2] = 0x79622d32; s[3] = 0x6b206574;
  const kv = new DataView(key.buffer, key.byteOffset, 32);
  const nv = new DataView(nonce16.buffer, nonce16.byteOffset, 16);
  for (let i = 0; i < 8; i++) s[4 + i] = kv.getUint32(i * 4, true);
  for (let i = 0; i < 4; i++) s[12 + i] = nv.getUint32(i * 4, true);
  for (let i = 0; i < 10; i++) {
    quarter(s, 0, 4, 8, 12); quarter(s, 1, 5, 9, 13); quarter(s, 2, 6, 10, 14); quarter(s, 3, 7, 11, 15);
    quarter(s, 0, 5, 10, 15); quarter(s, 1, 6, 11, 12); quarter(s, 2, 7, 8, 13); quarter(s, 3, 4, 9, 14);
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 4; i++) ov.setUint32(i * 4, s[i] >>> 0, true);
  for (let i = 0; i < 4; i++) ov.setUint32(16 + i * 4, s[12 + i] >>> 0, true);
  return out;
}

function subNonce(nonce24: Uint8Array): Uint8Array {
  const n = new Uint8Array(12);
  n.set(nonce24.subarray(16, 24), 4);
  return n;
}

/** XChaCha20-Poly1305 encrypt: ciphertext || 16-byte tag. */
export function xchachaSeal(key: Uint8Array, nonce24: Uint8Array, plaintext: Uint8Array, aad?: Uint8Array): Uint8Array {
  if (nonce24.length !== 24) throw new Error('XChaCha20 needs a 24-byte nonce');
  return seal(hchacha20(key, nonce24.subarray(0, 16)), subNonce(nonce24), plaintext, aad);
}

/** XChaCha20-Poly1305 decrypt, or null when the key is wrong or the data was changed. */
export function xchachaOpen(key: Uint8Array, nonce24: Uint8Array, sealed: Uint8Array, aad?: Uint8Array): Uint8Array | null {
  if (nonce24.length !== 24) return null;
  return open(hchacha20(key, nonce24.subarray(0, 16)), subNonce(nonce24), sealed, aad);
}

export const hexToBytes = (h: string): Uint8Array => {
  const clean = h.trim();
  const out = new Uint8Array(clean.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
};

export const bytesToHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
