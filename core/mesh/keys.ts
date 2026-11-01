// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// WireGuard keys, and the signed note each device sends its peers.
//
// Each device has one WireGuard key pair (Curve25519), kept in the system
// keychain. Its public key travels to peers inside a "mesh record" signed
// with the device's Keeper Link identity (Ed25519), over the Link channel. A
// peer only uses a WireGuard key whose record verifies against the identity
// key it pinned when the two devices paired, so a key nobody paired with can
// never join the tunnel, even if the Link channel were somehow bypassed.

import crypto from 'node:crypto';
import { deviceId, sign, verify, type Identity } from '../link/identity';
import { familyOf, inPrefix, parseCidr } from '../net/addr';
import { deviceAddr6, networkPrefix6 } from './address';
import type { Candidate } from './types';

const X_PKCS8 = Buffer.from('302e020100300506032b656e04220420', 'hex');

export interface WgKeyPair {
  /** base64 of the raw 32-byte keys, as WireGuard writes them */
  priv: string;
  pub: string;
}

export function newWgKey(): WgKeyPair {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('x25519');
  const d = privateKey.export({ format: 'jwk' }).d!;
  const x = publicKey.export({ format: 'jwk' }).x!;
  return { priv: Buffer.from(d, 'base64url').toString('base64'), pub: Buffer.from(x, 'base64url').toString('base64') };
}

export function wgPublic(priv: string): string {
  const raw = Buffer.from(priv, 'base64');
  if (raw.length !== 32) throw new Error('Not a WireGuard private key');
  const k = crypto.createPrivateKey({ key: Buffer.concat([X_PKCS8, raw]), format: 'der', type: 'pkcs8' });
  return Buffer.from(crypto.createPublicKey(k).export({ format: 'jwk' }).x!, 'base64url').toString('base64');
}

export const isWgKey = (k: unknown): k is string => typeof k === 'string' && /^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/.test(k);

/** What a device tells a peer about itself in one network. */
export interface MeshRecord {
  v: 1;
  net: string;
  dev: string;
  /** who it is meant for, so it cannot be replayed to another device as fresh */
  to: string;
  name: string;
  wg: string;
  a6: string;
  a4?: string;
  /** the UDP port its mesh socket listens on */
  port: number;
  cands: Candidate[];
  /** half of the key that authenticates path probes (secret: travels only inside Link) */
  pk: string;
  exit?: boolean;
  routes?: string[];
  seq: number;
  ts: number;
}

export interface SignedRecord {
  rec: MeshRecord;
  sig: string;
}

/** JSON with keys in a fixed order, so both sides sign and check the same bytes. */
export function canonical(o: unknown): string {
  if (Array.isArray(o)) return `[${o.map(canonical).join(',')}]`;
  if (o && typeof o === 'object') {
    return `{${Object.keys(o)
      .filter((k) => (o as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((o as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(o);
}

const CONTEXT = 'keeper-mesh-record-v1\0';

export function signRecord(me: Identity, rec: MeshRecord): SignedRecord {
  if (rec.dev !== deviceId(me.publicKey)) throw new Error('A record can only be signed by its own device');
  return { rec, sig: sign(me, Buffer.from(CONTEXT + canonical(rec))).toString('base64') };
}

export type VerifyResult = { ok: true; rec: MeshRecord } | { ok: false; why: string };

/**
 * Checks a record from a peer: signed by the identity key pinned at pairing,
 * meant for this device, for this network, newer than the last one, with
 * addresses inside the network and the address its device id gives it.
 */
export function verifyRecord(pinnedPub: Uint8Array, s: SignedRecord, want: { net: string; to: string; prefix4?: string; lastSeq?: number; now?: number }): VerifyResult {
  const r = s?.rec;
  if (!r || r.v !== 1) return { ok: false, why: 'unknown record' };
  if (r.dev !== deviceId(pinnedPub)) return { ok: false, why: 'record is from a different device' };
  if (!verify(pinnedPub, Buffer.from(CONTEXT + canonical(r)), Buffer.from(String(s.sig ?? ''), 'base64'))) return { ok: false, why: 'bad signature' };
  if (r.net !== want.net) return { ok: false, why: 'record is for another network' };
  if (r.to !== want.to) return { ok: false, why: 'record was meant for another device' };
  if (!isWgKey(r.wg)) return { ok: false, why: 'not a WireGuard key' };
  if (want.lastSeq !== undefined && r.seq <= want.lastSeq) return { ok: false, why: 'old record (replayed?)' };
  const now = want.now ?? Date.now();
  if (Math.abs(now - r.ts) > 7 * 86_400_000) return { ok: false, why: 'record is too old' };
  if (r.a6 !== deviceAddr6(r.net, r.dev)) return { ok: false, why: 'IPv6 address does not match the device' };
  if (!inPrefix(r.a6, networkPrefix6(r.net).split('/')[0], 48)) return { ok: false, why: 'IPv6 address outside the network' };
  if (r.a4 !== undefined) {
    const p = want.prefix4 ? parseCidr(want.prefix4) : null;
    if (!p || familyOf(r.a4) !== 4 || !inPrefix(r.a4, p.net, p.prefix)) return { ok: false, why: 'IPv4 address outside the network' };
  }
  if (!Number.isInteger(r.port) || r.port < 1 || r.port > 65535) return { ok: false, why: 'bad port' };
  if (!Array.isArray(r.cands) || r.cands.length > 32) return { ok: false, why: 'bad candidates' };
  for (const c of r.cands) if (!c || !['lan', 'public', 'relay'].includes(c.kind) || typeof c.addr !== 'string' || c.addr.length > 300) return { ok: false, why: 'bad candidate' };
  for (const rt of r.routes ?? []) if (!parseCidr(rt)) return { ok: false, why: 'bad route' };
  if (typeof r.pk !== 'string' || Buffer.from(r.pk, 'base64').length !== 32) return { ok: false, why: 'bad path key' };
  return { ok: true, rec: r };
}

/** The key that authenticates path probes between two devices: both halves, in a fixed order. */
export function pathKey(a: { dev: string; pk: string }, b: { dev: string; pk: string }): Buffer {
  const [x, y] = [a, b].sort((p, q) => (p.dev < q.dev ? -1 : 1));
  return Buffer.from(crypto.hkdfSync('sha256', Buffer.concat([Buffer.from(x.pk, 'base64'), Buffer.from(y.pk, 'base64')]), Buffer.from(`${x.dev}${y.dev}`), Buffer.from('keeper-mesh-path'), 32));
}

/** Short form of a WireGuard key, for people to compare. */
export const shortKey = (k: string) => `${k.slice(0, 5)}…${k.slice(-5, -1)}`;
