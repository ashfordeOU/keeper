// SPDX-License-Identifier: AGPL-3.0-or-later
// Pairing two devices for the first time.
//
// The device being added to ("host") shows either a 6-digit code, or a QR code
// carrying a long random secret and its own key fingerprint. The other device
// ("joiner") connects to it and they run:
//
//   P1  J → H   commitment = SHA-256(eJ ‖ nJ)        (J cannot change eJ later)
//   P2  H → J   eH, nH
//   P3  J → H   eJ, nJ                                (H checks the commitment)
//       both:   k = HKDF(X25519(eH, eJ), T)           T = the transcript so far
//   P4  J → H   seal_k( J's identity, name, signature over T, HMAC(code or secret, T) )
//   P5  H → J   seal_k( H's identity, name, signature over T )
//       both screens show the same six digits derived from T and both keys
//   P6  each    seal_k( "confirmed" ) once the person has compared them
//
// The HMAC proves the joiner saw the host's screen. The six-digit comparison
// catches a machine in the middle: because the joiner committed to its key
// before seeing the host's, an attacker gets one guess (1 in a million) at
// making the numbers match, and the host stops after five wrong codes.
// With a QR secret (128 bits) the HMAC alone is enough; the digits are still
// shown so both people see the same thing.

import crypto from 'node:crypto';
import { dec, enc, reader, type Wire } from './channel';
import { dh, ephemeral, hkdf, hmac, sha256, sign, verify, type Identity } from './identity';

export interface PeerInfo {
  /** identity key, base64 */
  pub: string;
  name: string;
  os: string;
  /** how to reach it next time (addresses, tunnel, relay) */
  reach?: Record<string, unknown>;
}

export interface PairResult {
  peer: PeerInfo;
  /** shown on both screens */
  sas: string;
  /** a secret both devices keep, for finding each other over the internet later */
  pairSecret: string;
}

const PROTO = Buffer.from('keeper-pair/1');
const b = (x: unknown) => (typeof x === 'string' ? Buffer.from(x, 'base64') : Buffer.alloc(0));
const s = (x: Uint8Array) => Buffer.from(x).toString('base64');

/** A six-digit code for the host to show. */
export function newPairCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

/** A long secret for QR pairing. */
export function newPairSecret(): string {
  return crypto.randomBytes(16).toString('base64url');
}

/** Six digits both people compare. */
export function sasDigits(transcript: Uint8Array, hostKey: Uint8Array, joinerKey: Uint8Array): string {
  const h = sha256(Buffer.from('keeper-sas'), transcript, hostKey, joinerKey);
  return String(h.readUInt32BE(0) % 1_000_000).padStart(6, '0').replace(/(\d{3})(\d{3})/, '$1 $2');
}

function seal(key: Buffer, n: number, plain: Buffer) {
  const iv = Buffer.alloc(12);
  iv.writeUInt32BE(n, 8);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  return Buffer.concat([c.update(plain), c.final(), c.getAuthTag()]);
}

function open(key: Buffer, n: number, sealed: Buffer): Buffer | null {
  if (sealed.length < 16) return null;
  const iv = Buffer.alloc(12);
  iv.writeUInt32BE(n, 8);
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
    d.setAuthTag(sealed.subarray(sealed.length - 16));
    return Buffer.concat([d.update(sealed.subarray(0, sealed.length - 16)), d.final()]);
  } catch {
    return null;
  }
}

function json(buf: Buffer | null): Record<string, unknown> {
  if (!buf) throw new Error('The other device sent a broken pairing message');
  return JSON.parse(buf.toString('utf8'));
}

export interface PairOptions {
  me: Identity;
  info: Omit<PeerInfo, 'pub'>;
  /** the 6-digit code, or the QR secret */
  secret: string;
  /** host only: picks the secret from how the joiner says it is pairing ('code' or 'qr') */
  secretFor?: (mode: string) => string | undefined;
  /** joiner only: how it is pairing */
  mode?: 'code' | 'qr';
  /** asks the person to compare the digits; resolves true to go ahead */
  confirm: (sas: string, peer: PeerInfo) => Promise<boolean>;
  timeoutMs?: number;
}

/** The device being added to. `first` is P1 when a dispatcher already read it. */
export async function pairAsHost(wire: Wire, o: PairOptions, first?: Uint8Array): Promise<PairResult> {
  return closing(wire, hostSteps(wire, o, first));
}

export async function pairAsJoiner(wire: Wire, o: PairOptions & { expectHost?: Uint8Array }): Promise<PairResult> {
  return closing(wire, joinerSteps(wire, o));
}

/** Any failure closes the connection, so the other side stops waiting at once. */
async function closing(wire: Wire, p: Promise<PairResult>): Promise<PairResult> {
  try {
    return await p;
  } catch (e) {
    wire.close(e instanceof Error ? e.message : String(e));
    throw e;
  }
}

async function hostSteps(wire: Wire, o: PairOptions, first?: Uint8Array): Promise<PairResult> {
  const rd = reader(wire);
  const t = o.timeoutMs ?? 120_000;
  const p1 = dec(first ?? (await rd.next(t)));
  if (p1.t !== 'p1') throw new Error('Not a pairing request');
  const commit = b(p1.c);
  const secret = o.secretFor ? o.secretFor(String(p1.m ?? 'code')) : o.secret;
  if (!secret) {
    wire.send(enc({ t: 'perr', error: 'not-pairing' }));
    throw new Error('not-pairing');
  }
  const e = ephemeral();
  const nH = crypto.randomBytes(16);
  wire.send(enc({ t: 'p2', e: s(e.publicKey), n: s(nH) }));
  const p3 = dec(await rd.next(t));
  const eJ = b(p3.e);
  const nJ = b(p3.n);
  if (p3.t !== 'p3' || !sha256(eJ, nJ).equals(commit)) throw new Error('The other device changed its key during pairing');
  const T = sha256(PROTO, commit, e.publicKey, nH, eJ, nJ);
  const k = hkdf(dh(e, eJ), T, 'keeper-pair keys', 64);
  const kJ = k.subarray(0, 32);
  const kH = k.subarray(32);
  const p4 = json(open(kJ, 0, b(dec(await rd.next(t)).box)));
  const jPub = b(p4.pub);
  const proof = b(p4.proof);
  const proofOk = proof.length === 32 && crypto.timingSafeEqual(hmac(Buffer.from(secret), T), proof);
  if (!proofOk) {
    wire.send(enc({ t: 'perr', error: 'wrong-code' }));
    throw new Error('wrong-code');
  }
  if (!verify(jPub, Buffer.concat([Buffer.from('J'), T]), b(p4.sig))) throw new Error('The other device could not prove who it is');
  const pairSecret = hkdf(T, Buffer.alloc(0), 'keeper pair secret', 32).toString('base64url');
  wire.send(enc({ t: 'p5', box: s(seal(kH, 0, Buffer.from(JSON.stringify({ pub: s(o.me.publicKey), ...o.info, sig: s(sign(o.me, Buffer.concat([Buffer.from('H'), T, jPub]))) })))) }));
  const peer: PeerInfo = { pub: s(jPub), name: String(p4.name ?? 'Device').slice(0, 80), os: String(p4.os ?? ''), reach: (p4.reach as Record<string, unknown>) ?? undefined };
  const sas = sasDigits(T, o.me.publicKey, jPub);
  const theirsP = rd.next(t).then((m) => json(open(kJ, 1, b(dec(m).box))));
  theirsP.catch(() => undefined);
  const mine = await o.confirm(sas, peer);
  wire.send(enc({ t: 'p6', box: s(seal(kH, 1, Buffer.from(JSON.stringify({ ok: mine })))) }));
  if (!mine) throw new Error('cancelled');
  const theirs = await theirsP;
  if (theirs.ok !== true) throw new Error('The pairing was not confirmed on the other device');
  return { peer, sas, pairSecret };
}

/** The device joining. `expectHost` is the fingerprint key from a QR code, when there is one. */
async function joinerSteps(wire: Wire, o: PairOptions & { expectHost?: Uint8Array }): Promise<PairResult> {
  const rd = reader(wire);
  const t = o.timeoutMs ?? 120_000;
  const e = ephemeral();
  const nJ = crypto.randomBytes(16);
  const commit = sha256(e.publicKey, nJ);
  wire.send(enc({ t: 'p1', c: s(commit), m: o.mode ?? 'code' }));
  const p2 = dec(await rd.next(t));
  if (p2.t !== 'p2') throw new Error(typeof p2.error === 'string' ? p2.error : 'Not a pairing answer');
  const eH = b(p2.e);
  const nH = b(p2.n);
  wire.send(enc({ t: 'p3', e: s(e.publicKey), n: s(nJ) }));
  const T = sha256(PROTO, commit, eH, nH, e.publicKey, nJ);
  const k = hkdf(dh(e, eH), T, 'keeper-pair keys', 64);
  const kJ = k.subarray(0, 32);
  const kH = k.subarray(32);
  wire.send(enc({ t: 'p4', box: s(seal(kJ, 0, Buffer.from(JSON.stringify({ pub: s(o.me.publicKey), ...o.info, sig: s(sign(o.me, Buffer.concat([Buffer.from('J'), T]))), proof: s(hmac(Buffer.from(o.secret), T)) })))) }));
  const m5 = dec(await rd.next(t));
  if (m5.t === 'perr') throw new Error(m5.error === 'wrong-code' ? 'wrong-code' : String(m5.error));
  const p5 = json(open(kH, 0, b(m5.box)));
  const hPub = b(p5.pub);
  if (o.expectHost && !Buffer.from(o.expectHost).equals(hPub)) throw new Error('This is not the device in the QR code');
  if (!verify(hPub, Buffer.concat([Buffer.from('H'), T, o.me.publicKey]), b(p5.sig))) throw new Error('The other device could not prove who it is');
  const peer: PeerInfo = { pub: s(hPub), name: String(p5.name ?? 'Device').slice(0, 80), os: String(p5.os ?? ''), reach: (p5.reach as Record<string, unknown>) ?? undefined };
  const sas = sasDigits(T, hPub, o.me.publicKey);
  const pairSecret = hkdf(T, Buffer.alloc(0), 'keeper pair secret', 32).toString('base64url');
  const theirsP = rd.next(t).then((m) => json(open(kH, 1, b(dec(m).box))));
  theirsP.catch(() => undefined);
  const mine = await o.confirm(sas, peer);
  wire.send(enc({ t: 'p6', box: s(seal(kJ, 1, Buffer.from(JSON.stringify({ ok: mine })))) }));
  if (!mine) throw new Error('cancelled');
  const theirs = await theirsP;
  if (theirs.ok !== true) throw new Error('The pairing was not confirmed on the other device');
  return { peer, sas, pairSecret };
}
