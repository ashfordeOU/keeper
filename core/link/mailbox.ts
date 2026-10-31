// SPDX-License-Identifier: AGPL-3.0-or-later
// How two paired devices find each other over the internet with no server of
// their own: each leaves a short note ("you can reach me at …") on a topic of
// a public push service that speaks the ntfy HTTP API (ntfy.sh, or a
// self-hosted one). The topic name comes from the secret the two devices
// agreed when pairing, so nobody else can guess it; the note is encrypted with
// a key from the same secret and signed with the sender's identity, so the
// service sees only random-looking text and nobody can forge a note.
//
// Trade-offs: the service can see when notes are posted and from which IP
// address, and it can delete or hold them back (then devices fall back to the
// local network or a relay). Notes are short-lived (a few hours).

import crypto from 'node:crypto';
import { hkdf, sign, verify, type Identity } from './identity';

export const DEFAULT_MAILBOX = 'https://ntfy.sh';

export interface Reach {
  /** addresses on the local network, host:port */
  lan?: string[];
  /** a public address that answered from outside (host:port), if any */
  direct?: string[];
  /** the cloudflared hostname, https://… */
  tunnel?: string;
  /** relay base URL this device listens on */
  relay?: string;
  /** the time the note was written */
  at: number;
}

export function topicFor(pairSecret: string): string {
  return 'keeper-' + hkdf(Buffer.from(pairSecret, 'base64url'), Buffer.alloc(0), 'keeper mailbox topic', 16).toString('hex');
}

function keyFor(pairSecret: string) {
  return hkdf(Buffer.from(pairSecret, 'base64url'), Buffer.alloc(0), 'keeper mailbox key', 32);
}

export function sealNote(pairSecret: string, me: Identity, reach: Reach): string {
  const body = Buffer.from(JSON.stringify({ r: reach, from: me.publicKey.toString('base64') }));
  const sig = sign(me, Buffer.concat([Buffer.from('keeper-note'), body]));
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', keyFor(pairSecret), iv);
  const ct = Buffer.concat([c.update(Buffer.concat([sig, body])), c.final(), c.getAuthTag()]);
  return 'k1.' + Buffer.concat([iv, ct]).toString('base64url');
}

/** Reads a note; null unless it is intact, signed by `from` and not older than `maxAgeMs`. */
export function openNote(pairSecret: string, note: string, from: Uint8Array, maxAgeMs = 6 * 3600_000, now = Date.now()): Reach | null {
  if (!note.startsWith('k1.')) return null;
  const raw = Buffer.from(note.slice(3), 'base64url');
  if (raw.length < 12 + 64 + 16) return null;
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', keyFor(pairSecret), raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(raw.length - 16));
    const plain = Buffer.concat([d.update(raw.subarray(12, raw.length - 16)), d.final()]);
    const sig = plain.subarray(0, 64);
    const body = plain.subarray(64);
    if (!verify(from, Buffer.concat([Buffer.from('keeper-note'), body]), sig)) return null;
    const j = JSON.parse(body.toString()) as { r: Reach; from: string };
    if (j.from !== Buffer.from(from).toString('base64')) return null;
    if (typeof j.r?.at !== 'number' || now - j.r.at > maxAgeMs || j.r.at - now > 5 * 60_000) return null;
    return j.r;
  } catch {
    return null;
  }
}

/** Posts a note. */
export async function postNote(server: string, pairSecret: string, me: Identity, reach: Reach, fetchFn: typeof fetch = fetch) {
  const r = await fetchFn(`${server.replace(/\/+$/, '')}/${topicFor(pairSecret)}`, {
    method: 'POST',
    body: sealNote(pairSecret, me, reach),
    headers: { 'X-Cache': 'yes', 'X-Firebase': 'no', 'X-Tags': 'keeper' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new Error(`mailbox ${r.status}`);
}

/** The newest valid note from `from`, or null. */
export async function readNotes(server: string, pairSecret: string, from: Uint8Array, fetchFn: typeof fetch = fetch, since = '6h'): Promise<Reach | null> {
  const r = await fetchFn(`${server.replace(/\/+$/, '')}/${topicFor(pairSecret)}/json?poll=1&since=${since}`, { signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`mailbox ${r.status}`);
  let best: Reach | null = null;
  for (const line of (await r.text()).split('\n')) {
    if (!line.trim()) continue;
    try {
      const ev = JSON.parse(line) as { event?: string; message?: string };
      if (ev.event !== 'message' || !ev.message) continue;
      const n = openNote(pairSecret, ev.message, from);
      if (n && (!best || n.at > best.at)) best = n;
    } catch {
      /* skip */
    }
  }
  return best;
}
