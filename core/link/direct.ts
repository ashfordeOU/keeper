// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Choosing and describing the direct path: which addresses a device offers
// (its own network cards, and what a STUN server sees from outside), which of
// those the person's reach setting allows, and how carriers rank.

import type { CarrierKind } from './channel';
import type { Endpoint } from './udp';

export type DirectScope = 'lan' | 'internet';

export interface Candidate extends Endpoint {
  /** host: a network card here; srflx: as a STUN server sees us from outside */
  type: 'host' | 'srflx';
}

/** The offer a device makes, inside the Link channel. */
export interface DirectOffer {
  v: 1;
  /** random connection id for the UDP packets */
  conn: number;
  /** 32-byte path key, base64 (only ever sent inside the encrypted channel) */
  key: string;
  candidates: Candidate[];
}

/** Better carriers rank higher. Direct beats the tunnel and the relay; a plain local connection is already direct. */
export const CARRIER_RANK: Record<CarrierKind, number> = { local: 5, lan: 4, direct: 3, tunnel: 2, relay: 1 };

export function better(a: CarrierKind | undefined, b: CarrierKind | undefined): boolean {
  return (a ? CARRIER_RANK[a] : 0) > (b ? CARRIER_RANK[b] : 0);
}

/** Worth looking for a direct path: the connection goes through someone else's server. */
export function wantsDirect(kind: string | undefined): boolean {
  return kind === 'relay' || kind === 'tunnel';
}

export function isPrivateV4(ip: string): boolean {
  return /^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip) || /^127\./.test(ip) || /^169\.254\./.test(ip) || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip);
}

/** This device's host candidates from os.networkInterfaces(), IPv4 only (most home routers). */
export function hostCandidates(ifaces: Record<string, { family: string | number; address: string; internal: boolean }[] | undefined>, port: number, includeLoopback = false): Candidate[] {
  const out: Candidate[] = [];
  for (const list of Object.values(ifaces)) {
    for (const a of list ?? []) {
      const v4 = a.family === 'IPv4' || a.family === 4;
      if (!v4 || a.address.startsWith('169.254.')) continue;
      if (a.internal && !includeLoopback) continue;
      out.push({ type: 'host', address: a.address, port });
    }
  }
  return out;
}

/** What the reach setting allows: "This network only" and "Never leaves my network" keep private addresses only. */
export function allowedCandidates(c: Candidate[], scope: DirectScope): Candidate[] {
  return c.filter((x) => /^\d{1,3}(\.\d{1,3}){3}$/.test(x.address) && x.port > 0 && x.port < 65536 && (scope === 'internet' || (x.type === 'host' && isPrivateV4(x.address))));
}

/** Checks an offer that came from the other device. */
export function parseOffer(o: unknown, scope: DirectScope): DirectOffer | null {
  if (!o || typeof o !== 'object') return null;
  const x = o as Record<string, unknown>;
  if (x.v !== 1 || !Number.isInteger(x.conn) || typeof x.key !== 'string' || !Array.isArray(x.candidates)) return null;
  const key = Buffer.from(x.key, 'base64');
  if (key.length !== 32) return null;
  const candidates = allowedCandidates(
    (x.candidates as unknown[]).slice(0, 16).filter((c): c is Candidate => !!c && typeof c === 'object' && typeof (c as Candidate).address === 'string' && Number.isInteger((c as Candidate).port) && ((c as Candidate).type === 'host' || (c as Candidate).type === 'srflx')),
    scope,
  );
  return { v: 1, conn: (x.conn as number) >>> 0, key: x.key, candidates };
}

/** Back-off between tries while a device stays connected only through a relay or tunnel. */
export function retryDelay(attempt: number): number {
  return Math.min(30 * 60_000, 60_000 * 2 ** Math.max(0, attempt));
}
