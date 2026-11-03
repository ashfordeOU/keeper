// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper's license server: turns a payment provider's webhook into a signed
// license and e-mails it; renews, counts seats, and sends licenses again. No
// Cloudflare runtime here, so it is tested with plain functions and a fake store
// (test/license-server.test.ts). The token format and the providers' webhooks are
// the app's own (core/pro/license.ts, core/pro/payments.ts).
//
// Nothing personal is kept: the buyer's address is used to send the e-mail and
// stored only as the same hash the license carries.

import { issueLicense, verifyLicense, type LicensePayload, type PaidPlan } from '../../../core/pro/license';
import { PROVIDERS, type ProviderId, type PurchaseEvent } from '../../../core/pro/payments';
import { b64url, emailHash } from '../../../core/pro/sign';

/** The few calls the server needs from its key-value store (Workers KV, or a Map in tests). */
export interface Store {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

export interface Mail { to: string; subject: string; text: string }

export interface Deps {
  store: Store;
  /** PKCS#8 Ed25519 private key, base64 (a secret) */
  privateKey: string;
  /** its public half, base64 (the same one the app ships) */
  publicKey: string;
  /** webhook signing secrets by provider */
  secrets: Partial<Record<ProviderId, string>>;
  /** provider product, variant or price id → plan */
  plans: Record<string, PaidPlan>;
  send(mail: Mail): Promise<void>;
  /** the buyer's address when the webhook lacks it (Paddle sends a customer id) */
  customerEmail?(provider: ProviderId, customerId: string): Promise<string | null>;
  now(): number;
  randomId(): string;
}

export interface LicenseRecord {
  id: string;
  provider: ProviderId;
  orderId: string;
  plan: PaidPlan;
  seats: number;
  email: string;
  exp: number | null;
  status: 'active' | 'cancelled' | 'ended' | 'refunded';
  token: string;
  /** computers using it (the app's random Pro reference, never a name) */
  used: string[];
}

export type Reply = { status: number; body: Record<string, unknown> };

const RESTORE_EVERY_MS = 10 * 60_000;

const readJson = <T>(t: string | null): T | null => {
  try { return t ? (JSON.parse(t) as T) : null; } catch { return null; }
};

async function record(d: Deps, id: string): Promise<LicenseRecord | null> {
  return readJson<LicenseRecord>(await d.store.get(`lic:${id}`));
}

async function save(d: Deps, r: LicenseRecord) {
  await d.store.put(`lic:${r.id}`, JSON.stringify(r));
  await d.store.put(`order:${r.provider}:${r.orderId}`, r.id);
  const list = readJson<string[]>(await d.store.get(`email:${r.email}`)) ?? [];
  if (!list.includes(r.id)) await d.store.put(`email:${r.email}`, JSON.stringify([...list, r.id]));
}

const mailFor = (token: string, plan: PaidPlan): Mail['text'] => [
  `Thank you for Keeper ${plan === 'team' ? 'Team' : 'Pro'}.`,
  '',
  'To use it, open this link on the computer with Keeper:',
  `keeper://license?token=${token}`,
  '',
  'Or copy this license into Keeper → Settings → Account & Pro → Enter a license:',
  token,
  '',
  'Everything Keeper did before stays free. Keep this e-mail: it is your license.',
  '— Ashforde OÜ',
].join('\n');

/** POST /v1/webhook/<provider> */
export async function webhook(d: Deps, provider: string, raw: string, header: (n: string) => string | null): Promise<Reply> {
  const p = PROVIDERS[provider as ProviderId];
  const secret = d.secrets[provider as ProviderId];
  if (!p || provider === 'storekit' || !secret) return { status: 404, body: { error: 'Unknown provider' } };
  if (!(await p.verifyWebhook(raw, header, secret, d.now()))) return { status: 401, body: { error: 'Bad signature' } };
  const ev = p.parseWebhook(raw, (id) => d.plans[id] ?? null);
  // Events Keeper does not use are acknowledged, so the provider stops sending them.
  if (!ev) return { status: 200, body: { ok: true, ignored: true } };
  return { status: 200, body: { ok: true, ...(await apply(d, ev)) } };
}

async function apply(d: Deps, ev: PurchaseEvent): Promise<Record<string, unknown>> {
  const id = await d.store.get(`order:${ev.provider}:${ev.orderId}`);
  const prev = id ? await record(d, id) : null;
  if (ev.kind === 'cancelled' || ev.kind === 'ended' || ev.kind === 'refunded') {
    if (!prev) return { license: null };
    // Cancelled: it runs to the end of the paid period and is not renewed. Refunded: listed in pro.json's "revoked".
    prev.status = ev.kind;
    await save(d, prev);
    return { license: prev.id, status: prev.status };
  }
  const address = ev.email ?? (ev.customerId && d.customerEmail ? await d.customerEmail(ev.provider, ev.customerId) : null);
  const hash = address ? await emailHash(address) : prev?.email;
  if (!hash) return { license: null, error: 'no address' };
  const payload: LicensePayload = {
    v: 1, id: prev?.id ?? d.randomId(), plan: ev.plan, seats: ev.seats, email: hash, iat: d.now(),
    exp: ev.periodEnd ?? null, via: ev.provider,
  };
  const token = await issueLicense(payload, d.privateKey);
  const r: LicenseRecord = { id: payload.id, provider: ev.provider, orderId: ev.orderId, plan: payload.plan, seats: payload.seats, email: hash, exp: payload.exp, status: 'active', token, used: prev?.used ?? [] };
  await save(d, r);
  // The license is e-mailed when it is new; renewals reach the app by itself (/v1/refresh).
  if (!prev && address) await d.send({ to: address, subject: `Your Keeper ${ev.plan === 'team' ? 'Team' : 'Pro'} license`, text: mailFor(token, ev.plan) });
  return { license: r.id };
}

async function fromToken(d: Deps, token: unknown): Promise<LicenseRecord | null> {
  if (typeof token !== 'string') return null;
  // A token that has ended still identifies its license (renewing is exactly for that).
  const c = await verifyLicense(token, [d.publicKey], d.now());
  const id = c.ok ? c.payload.id : c.reason === 'expired' ? c.payload?.id : undefined;
  if (!id) return null;
  return record(d, id);
}

/** POST /v1/refresh { token }: the newest token for this license, or that it was revoked. */
export async function refresh(d: Deps, body: { token?: unknown }): Promise<Reply> {
  const r = await fromToken(d, body.token);
  if (!r) return { status: 404, body: { error: 'Unknown license' } };
  if (r.status === 'refunded') return { status: 200, body: { revoked: true } };
  return { status: 200, body: { token: r.token, status: r.status } };
}

/** POST /v1/activate { token, seat }: counts this computer, unless every seat is taken. */
export async function activate(d: Deps, body: { token?: unknown; seat?: unknown }): Promise<Reply> {
  const r = await fromToken(d, body.token);
  const seat = typeof body.seat === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(body.seat) ? body.seat : null;
  if (!r || !seat) return { status: 404, body: { ok: false, reason: 'unknown' } };
  if (r.status === 'refunded') return { status: 200, body: { ok: false, reason: 'revoked' } };
  if (!r.used.includes(seat)) {
    if (r.used.length >= r.seats) return { status: 200, body: { ok: false, reason: 'seats' } };
    r.used.push(seat);
    await save(d, r);
  }
  return { status: 200, body: { ok: true, used: r.used.length, seats: r.seats } };
}

/** POST /v1/deactivate { token, seat }: frees this computer's seat (to move the license). */
export async function deactivate(d: Deps, body: { token?: unknown; seat?: unknown }): Promise<Reply> {
  const r = await fromToken(d, body.token);
  if (!r) return { status: 404, body: { ok: false } };
  r.used = r.used.filter((s) => s !== body.seat);
  await save(d, r);
  return { status: 200, body: { ok: true, used: r.used.length, seats: r.seats } };
}

/** POST /v1/restore { email }: sends that address its licenses again. The answer never says whether there were any. */
export async function restore(d: Deps, body: { email?: unknown }): Promise<Reply> {
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return { status: 400, body: { error: 'Not an address' } };
  const hash = await emailHash(email);
  const last = Number(await d.store.get(`restore:${hash}`)) || 0;
  if (d.now() - last >= RESTORE_EVERY_MS) {
    await d.store.put(`restore:${hash}`, String(d.now()));
    const ids = readJson<string[]>(await d.store.get(`email:${hash}`)) ?? [];
    for (const id of ids) {
      const r = await record(d, id);
      if (r && (r.status === 'active' || r.status === 'cancelled')) await d.send({ to: email, subject: `Your Keeper ${r.plan === 'team' ? 'Team' : 'Pro'} license`, text: mailFor(r.token, r.plan) });
    }
  }
  return { status: 200, body: { ok: true } };
}

/** A random license id (12 bytes, base64url). */
export const newId = (bytes: Uint8Array) => b64url(bytes.slice(0, 12));
