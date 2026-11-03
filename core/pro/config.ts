// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper Pro's remote switch: a small signed file at PRO_CONFIG_URL that can
// stop offering Pro at once (a kill switch), offer it to a share of installs
// (a rollout), name the checkout pages and list refunded licenses. Read at most
// once a day, and only by builds with Pro switched on (core/pro-switch.ts).
//
// The file is { "config": <base64url JSON>, "sig": <Ed25519 signature> }. A file
// that is not signed by a key in core/pro/keys.ts is ignored, as is one older than
// the copy already kept.

import { CONFIG_PURPOSE } from './keys';
import { b64url, fromUtf8, signEd25519, unb64url, utf8, verifyEd25519 } from './sign';
import type { ProviderId } from './payments';

export const PRO_CONFIG_URL = 'https://keeper.ashforde.org/pro.json';
export const PRO_CONFIG_HOST = 'keeper.ashforde.org';
export const LICENSE_SERVER_URL = 'https://license.ashforde.org';
/** At most one read a day. */
export const CONFIG_EVERY_MS = 86_400_000;

export interface CheckoutLinks {
  /** the merchant of record (it handles sales tax and VAT) */
  provider: ProviderId;
  /** hosted checkout pages by plan and period */
  pro?: { month?: string; year?: string };
  team?: { month?: string; year?: string };
  /** where people manage or cancel a subscription */
  manage?: string;
}

export interface ProConfig {
  v: 1;
  /** when Ashforde signed it, ms */
  issued: number;
  /** false stops offering Pro everywhere (licenses people bought keep working) */
  enabled: boolean;
  /** the share of installs (0–100) that are offered Pro */
  rollout: number;
  checkout?: CheckoutLinks;
  /** license ids that were refunded or replaced */
  revoked?: string[];
}

const HTTPS = /^https:\/\/[^\s"'<>]+$/;
const links = (x: unknown) => !x || (typeof x === 'object' && Object.values(x as Record<string, unknown>).every((u) => typeof u === 'string' && HTTPS.test(u)));

function isConfig(x: unknown): x is ProConfig {
  const c = x as ProConfig;
  if (!c || typeof c !== 'object' || c.v !== 1 || !Number.isFinite(c.issued) || typeof c.enabled !== 'boolean') return false;
  if (typeof c.rollout !== 'number' || c.rollout < 0 || c.rollout > 100) return false;
  if (c.revoked !== undefined && (!Array.isArray(c.revoked) || c.revoked.length > 10_000 || c.revoked.some((r) => typeof r !== 'string'))) return false;
  if (c.checkout !== undefined) {
    const k = c.checkout;
    if (!k || typeof k !== 'object' || !['lemonsqueezy', 'paddle', 'storekit'].includes(k.provider)) return false;
    if (!links(k.pro) || !links(k.team) || (k.manage !== undefined && !(typeof k.manage === 'string' && HTTPS.test(k.manage)))) return false;
  }
  return true;
}

/** The signed file's text. Only Ashforde's release tooling (and tests) can make it. */
export async function signProConfig(config: ProConfig, privateKeyB64: string): Promise<string> {
  if (!isConfig(config)) throw new Error('Not a Pro config');
  const body = b64url(utf8(JSON.stringify(config)));
  return JSON.stringify({ config: body, sig: await signEd25519(privateKeyB64, CONFIG_PURPOSE, body) });
}

/** The config, when the text is a file signed with one of `keys` and not from the future; otherwise null. */
export async function readProConfig(text: string, keys: readonly string[], now: number): Promise<ProConfig | null> {
  if (!keys.length || typeof text !== 'string' || text.length > 512 * 1024) return null;
  let env: { config?: unknown; sig?: unknown };
  try {
    env = JSON.parse(text);
  } catch {
    return null;
  }
  if (!env || typeof env.config !== 'string' || typeof env.sig !== 'string') return null;
  if (!(await verifyEd25519(keys, CONFIG_PURPOSE, env.config, env.sig))) return null;
  let c: unknown;
  try {
    c = JSON.parse(fromUtf8(unb64url(env.config)));
  } catch {
    return null;
  }
  if (!isConfig(c) || c.issued > now + 86_400_000) return null;
  return c;
}

/** Keep the newer of two configs (an older file replayed later never wins). */
export const newerConfig = (kept: ProConfig | null, got: ProConfig | null): ProConfig | null => (!got ? kept : !kept || got.issued > kept.issued ? got : kept);

/** Time for the daily read? */
export const configDue = (lastReadAt: number | undefined, now: number) => !lastReadAt || now - lastReadAt >= CONFIG_EVERY_MS || now < lastReadAt;

/** Which of 100 buckets an install falls in (FNV-1a of its random Pro reference): the same every day. */
export function rolloutBucket(ref: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < ref.length; i++) {
    h ^= ref.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % 100;
}

/** Is Pro offered to this install right now? (Never without a signed config.) */
export const offered = (c: ProConfig | null, ref: string) => !!c && c.enabled && rolloutBucket(ref) < c.rollout;
