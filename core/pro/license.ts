// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper Pro licenses: a signed token that the app checks on its own, with no
// server and no account. A token is
//
//   kpl1.<payload, base64url JSON>.<Ed25519 signature, base64url>
//
// and its payload says which plan, for how many seats, until when, and for whom
// (a hash of the e-mail address, never the address). The server that makes them
// is server/license; the keys are in core/pro/keys.ts.

import { LICENSE_PURPOSE } from './keys';
import { b64url, fromUtf8, signEd25519, unb64url, utf8, verifyEd25519 } from './sign';

export type PaidPlan = 'pro' | 'team';

export interface LicensePayload {
  v: 1;
  /** the license's own id (random) */
  id: string;
  plan: PaidPlan;
  /** computers (pro) or people (team) it covers */
  seats: number;
  /** emailHash() of the buyer's address */
  email: string;
  /** when it was made, ms since 1970 */
  iat: number;
  /** when a subscription period ends, ms; null for a license that never ends */
  exp: number | null;
  /** where it was bought: 'lemonsqueezy', 'paddle', 'appstore' or 'manual' */
  via: string;
}

export const TOKEN_PREFIX = 'kpl1';
/** How long a subscription keeps working past its end when Keeper cannot reach the server to renew it. */
export const GRACE_DAYS = 30;
export const GRACE_MS = GRACE_DAYS * 86_400_000;
/** Tokens longer than this are refused before any work is done. */
const MAX_TOKEN = 2048;

export type LicenseProblem = 'malformed' | 'signature' | 'expired' | 'revoked' | 'future' | 'no-keys';

export type LicenseCheck =
  | { ok: true; payload: LicensePayload; state: 'active' | 'grace'; graceEndsAt?: number }
  | { ok: false; reason: LicenseProblem; payload?: LicensePayload };

export const PROBLEM_TEXT: Record<LicenseProblem, string> = {
  malformed: 'That isn’t a Keeper license.',
  signature: 'That license wasn’t made by Ashforde.',
  expired: 'That license has ended.',
  revoked: 'That license was refunded or replaced.',
  future: 'That license isn’t valid yet. Check this computer’s clock.',
  'no-keys': 'Licenses can’t be checked in this version.',
};

function isPayload(x: unknown): x is LicensePayload {
  const p = x as LicensePayload;
  return !!p && typeof p === 'object' && p.v === 1
    && typeof p.id === 'string' && /^[A-Za-z0-9_-]{6,64}$/.test(p.id)
    && (p.plan === 'pro' || p.plan === 'team')
    && Number.isInteger(p.seats) && p.seats >= 1 && p.seats <= 10_000
    && typeof p.email === 'string' && /^[0-9a-f]{64}$/.test(p.email)
    && Number.isFinite(p.iat)
    && (p.exp === null || Number.isFinite(p.exp))
    && typeof p.via === 'string' && /^[a-z]{1,20}$/.test(p.via);
}

/** Pulls a token out of pasted text or a keeper://license?token=… link. */
export function findToken(text: string): string | null {
  const m = String(text ?? '').match(/kpl1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
  return m && m[0].length <= MAX_TOKEN ? m[0] : null;
}

/** The payload, unchecked (for showing what a pasted token says). */
export function peekLicense(token: string): LicensePayload | null {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) return null;
  try {
    const p = JSON.parse(fromUtf8(unb64url(parts[1])));
    return isPayload(p) ? p : null;
  } catch {
    return null;
  }
}

/** Makes a token. Only the license server (and tests) can: it needs the private key. */
export async function issueLicense(payload: LicensePayload, privateKeyB64: string): Promise<string> {
  if (!isPayload(payload)) throw new Error('Not a license payload');
  const body = b64url(utf8(JSON.stringify(payload)));
  return `${TOKEN_PREFIX}.${body}.${await signEd25519(privateKeyB64, LICENSE_PURPOSE, body)}`;
}

/**
 * Checks a token on this computer: made with one of `keys`, not revoked, and within
 * its period, or within GRACE_DAYS after it (a subscription that could not be renewed
 * because Keeper was offline). A license that never ends stays active.
 */
export async function verifyLicense(token: string, keys: readonly string[], now: number, revoked: readonly string[] = []): Promise<LicenseCheck> {
  if (!keys.length) return { ok: false, reason: 'no-keys' };
  if (typeof token !== 'string' || token.length > MAX_TOKEN) return { ok: false, reason: 'malformed' };
  const parts = token.trim().split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) return { ok: false, reason: 'malformed' };
  const payload = peekLicense(token.trim());
  if (!payload) return { ok: false, reason: 'malformed' };
  if (!(await verifyEd25519(keys, LICENSE_PURPOSE, parts[1], parts[2]))) return { ok: false, reason: 'signature' };
  if (revoked.includes(payload.id)) return { ok: false, reason: 'revoked', payload };
  // A day of clock difference is forgiven.
  if (payload.iat > now + 86_400_000) return { ok: false, reason: 'future', payload };
  if (payload.exp === null || now <= payload.exp) return { ok: true, payload, state: 'active' };
  if (now <= payload.exp + GRACE_MS) return { ok: true, payload, state: 'grace', graceEndsAt: payload.exp + GRACE_MS };
  return { ok: false, reason: 'expired', payload };
}
