// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Apple's own VNC sign-in (RFB security type 30, "Apple Remote Desktop"), as
// a Mac's Screen Sharing asks for it: a Diffie-Hellman exchange with the
// server's generator and prime, MD5 of the shared secret as an AES-128 key,
// and the user name and password (64 bytes each, padded with random bytes)
// sent encrypted with AES-128 in ECB mode, followed by our public key.
// Node only (the RFB client runs in the main process).

import { createCipheriv, createHash, randomBytes } from 'node:crypto';

const toBig = (b: Uint8Array) => (b.length ? BigInt('0x' + Buffer.from(b).toString('hex')) : 0n);
function toBytes(n: bigint, len: number): Uint8Array {
  const hex = n.toString(16).padStart(len * 2, '0');
  return new Uint8Array(Buffer.from(hex.slice(-len * 2), 'hex'));
}
function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let r = 1n;
  let b = base % mod;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) r = (r * b) % mod;
    b = (b * b) % mod;
    e >>= 1n;
  }
  return r;
}

export interface ArdChallenge {
  generator: number;
  prime: Uint8Array;
  serverKey: Uint8Array;
}

/** Reads the server's part: generator (2 bytes), key length (2 bytes), prime and public key. */
export function parseArdChallenge(b: Uint8Array): ArdChallenge | null {
  if (b.length < 4) return null;
  const generator = (b[0] << 8) | b[1];
  const len = (b[2] << 8) | b[3];
  if (!len || b.length < 4 + len * 2) return null;
  return { generator, prime: b.subarray(4, 4 + len), serverKey: b.subarray(4 + len, 4 + len * 2) };
}

/**
 * Our answer: AES-128-ECB(MD5(shared secret), credentials) followed by our
 * public key. `priv` and `pad` are random unless a test passes them.
 */
export function ardResponse(c: ArdChallenge, user: string, password: string, priv: Uint8Array = randomBytes(c.prime.length), pad: Uint8Array = randomBytes(128)): Uint8Array {
  const len = c.prime.length;
  const p = toBig(c.prime);
  if (p < 3n) throw new Error('The Mac sent an unusable key exchange');
  const x = toBig(priv) % p;
  const mine = toBytes(modPow(BigInt(c.generator), x, p), len);
  const shared = toBytes(modPow(toBig(c.serverKey), x, p), len);
  const key = createHash('md5').update(shared).digest();
  const creds = new Uint8Array(pad.subarray(0, 128));
  const u = new TextEncoder().encode(user);
  const w = new TextEncoder().encode(password);
  if (u.length > 63 || w.length > 63) throw new Error('The user name or password is too long for a Mac’s Screen Sharing (63 bytes at most)');
  creds.set(u, 0);
  creds[u.length] = 0;
  creds.set(w, 64);
  creds[64 + w.length] = 0;
  const aes = createCipheriv('aes-128-ecb', key, null);
  aes.setAutoPadding(false);
  const enc = Buffer.concat([aes.update(creds), aes.final()]);
  const out = new Uint8Array(128 + len);
  out.set(enc, 0);
  out.set(mine, 128);
  return out;
}
