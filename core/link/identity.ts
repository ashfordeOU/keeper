// SPDX-License-Identifier: AGPL-3.0-or-later
// Each Keeper has its own identity: an Ed25519 key pair made on first use.
// Other devices remember the public key when they pair and check it on every
// connection afterwards, whatever path the connection takes. Node only.

import crypto from 'node:crypto';

const ED_SPKI = Buffer.from('302a300506032b6570032100', 'hex');
const X_SPKI = Buffer.from('302a300506032b656e032100', 'hex');

export interface Identity {
  /** raw 32-byte Ed25519 public key */
  publicKey: Buffer;
  /** PKCS#8 DER of the private key */
  privateKey: Buffer;
}

export function newIdentity(): Identity {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    publicKey: publicKey.export({ format: 'der', type: 'spki' }).subarray(ED_SPKI.length),
    privateKey: privateKey.export({ format: 'der', type: 'pkcs8' }),
  };
}

export function identityToJson(id: Identity): { pub: string; priv: string } {
  return { pub: id.publicKey.toString('base64'), priv: id.privateKey.toString('base64') };
}

export function identityFromJson(j: { pub: string; priv: string }): Identity {
  return { publicKey: Buffer.from(j.pub, 'base64'), privateKey: Buffer.from(j.priv, 'base64') };
}

const edPublic = (raw: Uint8Array) => crypto.createPublicKey({ key: Buffer.concat([ED_SPKI, Buffer.from(raw)]), format: 'der', type: 'spki' });

export function sign(id: Identity, msg: Uint8Array): Buffer {
  return crypto.sign(null, msg, crypto.createPrivateKey({ key: id.privateKey, format: 'der', type: 'pkcs8' }));
}

export function verify(publicKey: Uint8Array, msg: Uint8Array, sig: Uint8Array): boolean {
  try {
    return publicKey.length === 32 && sig.length === 64 && crypto.verify(null, msg, edPublic(publicKey), sig);
  } catch {
    return false;
  }
}

const B32 = 'abcdefghijkmnpqrstuvwxyz23456789';

/** A short, stable, case-insensitive name for a device's key: 16 characters (80 bits). */
export function deviceId(publicKey: Uint8Array): string {
  const h = crypto.createHash('sha256').update(publicKey).digest();
  let bits = 0;
  let acc = 0;
  let out = '';
  for (const b of h) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5 && out.length < 16) {
      out += B32[(acc >>> (bits - 5)) & 31];
      bits -= 5;
    }
    if (out.length >= 16) break;
  }
  return out;
}

/** For people to compare: "kq3m-8hx2-…" */
export function fingerprint(publicKey: Uint8Array): string {
  return deviceId(publicKey).match(/.{4}/g)!.join('-');
}

// ---------------------------------------------------------------- X25519 for the key exchange

export interface Ephemeral {
  publicKey: Buffer;
  key: crypto.KeyObject;
}

export function ephemeral(): Ephemeral {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
  return { publicKey: publicKey.export({ format: 'der', type: 'spki' }).subarray(X_SPKI.length), key: privateKey };
}

export function dh(mine: Ephemeral, theirs: Uint8Array): Buffer {
  if (theirs.length !== 32) throw new Error('bad key');
  const pub = crypto.createPublicKey({ key: Buffer.concat([X_SPKI, Buffer.from(theirs)]), format: 'der', type: 'spki' });
  const s = crypto.diffieHellman({ privateKey: mine.key, publicKey: pub });
  // An all-zero result means the other side sent a weak key.
  if (s.every((x) => x === 0)) throw new Error('bad key');
  return s;
}

export const sha256 = (...parts: Uint8Array[]) => {
  const h = crypto.createHash('sha256');
  for (const p of parts) h.update(p);
  return h.digest();
};

export const hkdf = (ikm: Uint8Array, salt: Uint8Array, info: string, len: number) => Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from(info), len));

export const hmac = (key: Uint8Array, ...parts: Uint8Array[]) => {
  const h = crypto.createHmac('sha256', key);
  for (const p of parts) h.update(p);
  return h.digest();
};
