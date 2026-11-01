// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Help mode: a one-time support session with someone who is not paired.
//
// The person who needs help ("the host") presses Get help and reads out a
// 9-digit session code and a one-time password. The helper types both. That
// is all they share; nothing is remembered afterwards.
//
// Finding each other: on the same network through mDNS (a short tag of the
// code in the announcement); over the internet through an encrypted note on
// the Mailbox topic of the code (saying which relay or tunnel to use), sealed
// with a key from the code AND the password.
//
// Handshake (the helper proves first, so a stranger who connects to the host
// learns nothing they could test guesses against offline; five wrong tries
// end the code):
//   H1 helper → host   eA, nA, helper's name
//   H2 host → helper   eB, nB
//   H3 helper → host   HMAC(k, "helper" ‖ T)
//   H4 host → helper   HMAC(k, "host" ‖ T)
//   T = SHA-256(proto ‖ eA ‖ nA ‖ eB ‖ nB ‖ name)   k = HKDF(code ‖ password, T)
//   traffic keys = HKDF(X25519(eA, eB) ‖ k, T)
// Both sides then run the normal encrypted channel and mux over the wire.
//
// Strength: 9 digits and 6 password characters are about 60 bits. A passive
// watcher learns nothing (X25519). Someone in the middle who impersonates the
// host to the helper gets one HMAC they could brute-force offline; at 60 bits
// and 10 minutes of validity that is out of reach in practice.

import crypto from 'node:crypto';
import { Session, enc, dec, reader, type Wire } from './channel';
import { dh, ephemeral, hkdf, hmac, sha256 } from './identity';
import { formatCode, helpLink, normalizeCode, normalizePassword, parseHelpLink } from './help-web';

export const HELP_TTL_MS = 10 * 60_000;
export const HELP_MAX_MISSES = 5;
/** no 0/O, 1/I/L, 5/S, 2/Z: easy to read out on the phone */
const PW_ALPHABET = 'ABCDEFGHJKMNPQRTUVWXY346789';

export function newHelpCode(): string {
  // 9 digits, never starting with 0 (so it reads like a number)
  return String(100_000_000 + crypto.randomInt(900_000_000));
}

export function newHelpPassword(len = 6): string {
  let s = '';
  for (let i = 0; i < len; i++) s += PW_ALPHABET[crypto.randomInt(PW_ALPHABET.length)];
  return s;
}

export { formatCode, helpLink, normalizeCode, normalizePassword, parseHelpLink };


function secret(code: string, password: string): Buffer {
  return Buffer.from(`${normalizeCode(code)}|${normalizePassword(password)}`);
}

/** The short tag in mDNS announcements: lets helpers on the network find the host from the code alone. */
export function helpTag(code: string): string {
  return sha256(Buffer.from('keeper-help-tag'), Buffer.from(normalizeCode(code))).subarray(0, 6).toString('hex');
}

/** The Mailbox topic for a code (anyone with the code can find it; the note inside also needs the password). */
export function helpTopic(code: string): string {
  return 'keeper-help-' + hkdf(Buffer.from(normalizeCode(code)), Buffer.alloc(0), 'keeper help topic', 12).toString('hex');
}

export interface HelpReach {
  lan?: string[];
  tunnel?: string;
  relay?: string;
  /** the id the host listens under on the relay */
  relayId?: string;
  at: number;
}

export function sealHelpNote(code: string, password: string, reach: HelpReach): string {
  const key = hkdf(secret(code, password), Buffer.alloc(0), 'keeper help note', 32);
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(reach)), c.final(), c.getAuthTag()]);
  return 'h1.' + Buffer.concat([iv, ct]).toString('base64url');
}

export function openHelpNote(code: string, password: string, note: string, now = Date.now()): HelpReach | null {
  if (!note.startsWith('h1.')) return null;
  const raw = Buffer.from(note.slice(3), 'base64url');
  if (raw.length < 12 + 16) return null;
  try {
    const key = hkdf(secret(code, password), Buffer.alloc(0), 'keeper help note', 32);
    const d = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(raw.length - 16));
    const r = JSON.parse(Buffer.concat([d.update(raw.subarray(12, raw.length - 16)), d.final()]).toString()) as HelpReach;
    if (typeof r.at !== 'number' || now - r.at > HELP_TTL_MS || r.at - now > 5 * 60_000) return null;
    return r;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- handshake

const PROTO = Buffer.from('keeper-help/1');
const b64 = (x: Uint8Array) => Buffer.from(x).toString('base64');
const unb64 = (s: unknown) => (typeof s === 'string' ? Buffer.from(s, 'base64') : Buffer.alloc(0));

function derive(shared: Buffer, sec: Buffer, t: Buffer) {
  const k = hkdf(sec, t, 'keeper help confirm', 32);
  const traffic = hkdf(Buffer.concat([shared, k]), t, 'keeper help traffic', 64);
  return { k, a2b: traffic.subarray(0, 32), b2a: traffic.subarray(32, 64) };
}

export interface HelpPeer {
  session: Session;
  /** the helper's name (as they typed it) */
  name: string;
}

/** The helper's side: connects with the code and password the host read out. */
export async function helpAsHelper(wire: Wire, code: string, password: string, name: string, timeoutMs = 15_000): Promise<Session> {
  const rd = reader(wire);
  const e = ephemeral();
  const nA = crypto.randomBytes(16);
  const nm = name.slice(0, 60);
  wire.send(enc({ t: 'hp1', v: 1, e: b64(e.publicKey), n: b64(nA), name: nm }));
  const m2 = dec(await rd.next(timeoutMs));
  if (m2.t === 'herr') throw new Error(String(m2.error ?? 'Refused'));
  if (m2.t !== 'hp2') throw new Error('That is not a Keeper waiting for help');
  const eB = unb64(m2.e);
  const nB = unb64(m2.n);
  if (eB.length !== 32 || nB.length !== 16) throw new Error('Broken answer');
  const t = sha256(PROTO, e.publicKey, nA, eB, nB, Buffer.from(nm));
  const keys = derive(dh(e, eB), secret(code, password), t);
  wire.send(enc({ t: 'hp3', mac: b64(hmac(keys.k, Buffer.from('helper'), t)) }));
  const m4 = dec(await rd.next(timeoutMs));
  if (m4.t === 'herr') throw new Error(String(m4.error ?? 'The code or password is not right'));
  const want = hmac(keys.k, Buffer.from('host'), t);
  const got = unb64(m4.mac);
  if (m4.t !== 'hp4' || got.length !== want.length || !crypto.timingSafeEqual(got, want)) {
    throw new Error('The other computer could not prove it has this code');
  }
  return new Session(wire, keys.a2b, keys.b2a, eB, rd.rest());
}

export interface HostCheck {
  /** checks the code is current; answers with the password for it, or throws */
  password(): string;
  /** a wrong password was tried */
  miss(): void;
}

/** The host's side. `first` is H1, already read by whoever answered the connection. */
export async function helpAsHost(wire: Wire, first: Uint8Array, code: string, check: HostCheck, timeoutMs = 15_000): Promise<HelpPeer> {
  const rd = reader(wire);
  const m1 = dec(first);
  if (m1.t !== 'hp1' || m1.v !== 1) throw new Error('Not a help request');
  const eA = unb64(m1.e);
  const nA = unb64(m1.n);
  const nm = String(m1.name ?? 'Helper').slice(0, 60);
  if (eA.length !== 32 || nA.length !== 16) throw new Error('Broken request');
  let pw: string;
  try {
    pw = check.password();
  } catch (err) {
    wire.send(enc({ t: 'herr', error: err instanceof Error ? err.message : 'No help session is waiting' }));
    wire.close('no session');
    throw err;
  }
  const e = ephemeral();
  const nB = crypto.randomBytes(16);
  wire.send(enc({ t: 'hp2', e: b64(e.publicKey), n: b64(nB) }));
  const t = sha256(PROTO, eA, nA, e.publicKey, nB, Buffer.from(nm));
  const keys = derive(dh(e, eA), secret(code, pw), t);
  const m3 = dec(await rd.next(timeoutMs));
  const got = unb64(m3.mac);
  const want = hmac(keys.k, Buffer.from('helper'), t);
  if (m3.t !== 'hp3' || got.length !== want.length || !crypto.timingSafeEqual(got, want)) {
    check.miss();
    wire.send(enc({ t: 'herr', error: 'The code or password is not right' }));
    wire.close('wrong password');
    throw new Error('wrong-password');
  }
  wire.send(enc({ t: 'hp4', mac: b64(hmac(keys.k, Buffer.from('host'), t)) }));
  return { session: new Session(wire, keys.b2a, keys.a2b, eA, rd.rest()), name: nm };
}

/** The browser helper (web viewer) uses the companion channel: its key comes from the code and password. */
export function helpCompanionSecret(code: string, password: string): Uint8Array {
  return new Uint8Array(hkdf(secret(code, password), Buffer.alloc(0), 'keeper help companion', 32));
}

// ---------------------------------------------------------------- what a helper may do

export interface HelpGrant {
  /** the helper may use the mouse and keyboard (the host turned it on; can turn it off again) */
  control: boolean;
}

/** Help sessions start view-only; only the person being helped changes that. */
export const HELP_START: HelpGrant = { control: false };

/** Help never gets files, terminals, commands or ports: only the screen, and chat. */
export const HELP_ALLOWED_STREAMS = new Set(['screen.ctl', 'screen.frames']);
export const HELP_ALLOWED_RPC = new Set(['hello', 'ping', 'help.chat']);
