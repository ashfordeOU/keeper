// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Paying for Keeper Pro, whoever takes the money. Direct downloads use a
// merchant of record (Lemon Squeezy or Paddle: they sell to the buyer and handle
// EU VAT and sales tax for Ashforde OÜ in Estonia). The Mac App Store edition must
// use Apple's in-app purchase (StoreKit), which plugs in behind the same interface.
//
// The app only opens the provider's hosted checkout in the browser; the license
// comes back by e-mail, as a keeper://license?token=… link, or pasted. The
// provider tells the license server (server/license) through a signed webhook,
// and the server makes the license. No card or address ever passes through Keeper.

import { hmacSha256Hex, sameText } from './sign';
import type { PaidPlan } from './license';

export type ProviderId = 'lemonsqueezy' | 'paddle' | 'storekit';
export type Period = 'month' | 'year';

export interface CheckoutRequest {
  plan: PaidPlan;
  period: Period;
  seats?: number;
  /** filled in on the checkout page when the person gave it */
  email?: string;
  /** this install's random Pro reference, so "Restore purchase" can find the license */
  ref: string;
}

/** What a provider's webhook means, the same for every provider. */
export interface PurchaseEvent {
  kind: 'started' | 'renewed' | 'changed' | 'cancelled' | 'ended' | 'refunded';
  provider: ProviderId;
  /** the provider's subscription or order id: one license per id */
  orderId: string;
  plan: PaidPlan;
  seats: number;
  /** the buyer's address (servers only; never stored, only hashed) */
  email?: string;
  /** the provider's customer id, to look the address up when the event lacks it */
  customerId?: string;
  /** end of the paid period, ms; absent for a one-time purchase */
  periodEnd?: number;
  /** what the app passed to the checkout */
  ref?: string;
}

export interface PaymentProvider {
  id: ProviderId;
  /** the checkout page for this request, from the page Ashforde set up at the provider */
  checkoutUrl(base: string, r: CheckoutRequest): string | null;
  /** is this webhook really from the provider? (header names differ) */
  verifyWebhook(raw: string, headers: (name: string) => string | null, secret: string, now: number): Promise<boolean>;
  /** what it means, or null for events Keeper ignores */
  parseWebhook(raw: string, planOf: (productOrPrice: string) => PaidPlan | null): PurchaseEvent | null;
}

const num = (x: unknown) => (typeof x === 'number' ? x : typeof x === 'string' && x ? Number(x) : NaN);
const time = (x: unknown) => (typeof x === 'string' && !Number.isNaN(Date.parse(x)) ? Date.parse(x) : undefined);
const json = (raw: string): Record<string, unknown> | null => {
  try {
    const j = JSON.parse(raw);
    return j && typeof j === 'object' ? j : null;
  } catch {
    return null;
  }
};
const withParams = (base: string, params: [string, string | undefined][]) => {
  const u = new URL(base);
  for (const [k, v] of params) if (v !== undefined && v !== '') u.searchParams.set(k, v);
  return u.toString();
};

// ---------------------------------------------------------------- Lemon Squeezy

/**
 * Lemon Squeezy: a "buy" link per variant (https://<store>.lemonsqueezy.com/buy/<id>)
 * takes checkout[email], checkout[custom][…] and quantity; its webhooks are signed
 * with an HMAC-SHA256 of the raw body in X-Signature.
 */
export const lemonSqueezy: PaymentProvider = {
  id: 'lemonsqueezy',
  checkoutUrl(base, r) {
    if (!/^https:\/\//.test(base)) return null;
    return withParams(base, [['checkout[email]', r.email], ['checkout[custom][ref]', r.ref], ['checkout[custom][plan]', r.plan], ['quantity', r.seats && r.seats > 1 ? String(r.seats) : undefined]]);
  },
  async verifyWebhook(raw, header, secret) {
    const sig = header('x-signature');
    if (!sig || !secret) return false;
    return sameText(sig.toLowerCase(), await hmacSha256Hex(secret, raw));
  },
  parseWebhook(raw, planOf) {
    const j = json(raw);
    const meta = j?.meta as { event_name?: string; custom_data?: Record<string, string> } | undefined;
    const data = j?.data as { id?: string; type?: string; attributes?: Record<string, unknown> } | undefined;
    const a = data?.attributes;
    if (!meta?.event_name || !data?.id || !a) return null;
    const first = (a.first_order_item ?? {}) as Record<string, unknown>;
    const variant = String(a.variant_id ?? first.variant_id ?? '');
    const plan = planOf(variant);
    if (!plan) return null;
    const kinds: Record<string, PurchaseEvent['kind']> = {
      order_created: 'started', subscription_created: 'started', subscription_payment_success: 'renewed', subscription_updated: 'changed',
      subscription_resumed: 'changed', subscription_cancelled: 'cancelled', subscription_expired: 'ended', order_refunded: 'refunded', subscription_payment_refunded: 'refunded',
    };
    const kind = kinds[meta.event_name];
    if (!kind) return null;
    // A subscription's own events carry its id; an order of a subscription product is followed by subscription_created.
    if (meta.event_name === 'order_created' && data.type === 'orders' && a.subscription_id) return null;
    const orderId = String(meta.event_name === 'subscription_payment_success' || meta.event_name === 'subscription_payment_refunded' ? a.subscription_id ?? data.id : data.id);
    const seats = Math.max(1, Math.round(num(a.quantity ?? first.quantity)) || 1);
    return {
      kind, provider: 'lemonsqueezy', orderId, plan, seats,
      email: typeof a.user_email === 'string' ? a.user_email : undefined,
      customerId: a.customer_id !== undefined ? String(a.customer_id) : undefined,
      periodEnd: time(a.renews_at) ?? time(a.ends_at),
      ref: meta.custom_data?.ref,
    };
  },
};

// ---------------------------------------------------------------- Paddle

/**
 * Paddle Billing: a hosted checkout link (set up in Paddle → Checkout → Hosted
 * checkouts) takes price_id, quantity and user_email; custom data comes back on the
 * subscription. Webhooks are signed in Paddle-Signature: "ts=…;h1=…", where h1 is an
 * HMAC-SHA256 of "ts:raw body". Signatures older than five minutes are refused.
 */
export const paddle: PaymentProvider = {
  id: 'paddle',
  checkoutUrl(base, r) {
    if (!/^https:\/\//.test(base)) return null;
    return withParams(base, [['user_email', r.email], ['quantity', r.seats && r.seats > 1 ? String(r.seats) : undefined], ['custom_data', JSON.stringify({ ref: r.ref, plan: r.plan })]]);
  },
  async verifyWebhook(raw, header, secret, now) {
    const h = header('paddle-signature');
    if (!h || !secret) return false;
    const parts = Object.fromEntries(h.split(';').map((p) => p.split('=') as [string, string]));
    const ts = Number(parts.ts);
    if (!parts.h1 || !Number.isFinite(ts) || Math.abs(now / 1000 - ts) > 300) return false;
    return sameText(parts.h1.toLowerCase(), await hmacSha256Hex(secret, `${parts.ts}:${raw}`));
  },
  parseWebhook(raw, planOf) {
    const j = json(raw);
    const type = j?.event_type as string | undefined;
    const d = j?.data as Record<string, unknown> | undefined;
    if (!type || !d?.id) return null;
    const items = (d.items ?? []) as { price?: { id?: string }; price_id?: string; quantity?: number }[];
    const priceId = items[0]?.price?.id ?? items[0]?.price_id ?? '';
    const plan = planOf(String(priceId));
    if (!plan) return null;
    const kinds: Record<string, PurchaseEvent['kind']> = {
      'subscription.created': 'started', 'subscription.activated': 'started', 'subscription.updated': 'changed', 'subscription.resumed': 'changed',
      'subscription.canceled': 'cancelled', 'subscription.past_due': 'changed', 'transaction.completed': 'renewed', 'adjustment.created': 'refunded',
    };
    let kind = kinds[type];
    if (!kind) return null;
    const status = d.status as string | undefined;
    if (type === 'subscription.updated' && status === 'canceled') kind = 'ended';
    // A transaction belongs to a subscription; a one-time purchase has none.
    const orderId = String(type.startsWith('transaction.') ? d.subscription_id ?? d.id : type.startsWith('adjustment.') ? d.subscription_id ?? d.transaction_id ?? d.id : d.id);
    if (type === 'transaction.completed' && !d.subscription_id) kind = 'started';
    const period = (d.current_billing_period ?? d.billing_period) as { ends_at?: string } | undefined;
    const custom = (d.custom_data ?? {}) as Record<string, string>;
    return {
      kind, provider: 'paddle', orderId, plan, seats: Math.max(1, Math.round(num(items[0]?.quantity)) || 1),
      email: typeof custom.email === 'string' ? custom.email : undefined,
      customerId: typeof d.customer_id === 'string' ? d.customer_id : undefined,
      periodEnd: time(period?.ends_at), ref: custom.ref,
    };
  },
};

// ---------------------------------------------------------------- StoreKit (Mac App Store)

/**
 * What the Mac App Store edition's native side will provide (docs/MAS-EDITION.md):
 * Apple's own purchase sheet, restore, and the signed transactions StoreKit 2 gives.
 * Not built yet: no native code ships for it, and the direct download never uses it.
 */
export interface StoreKitBridge {
  /** product ids → localized price text, from the App Store */
  products(ids: string[]): Promise<{ id: string; price: string }[]>;
  /** shows Apple's purchase sheet; the verified transaction, or null when cancelled */
  purchase(productId: string): Promise<VerifiedReceipt | null>;
  /** the person's current purchases (Restore Purchases) */
  restore(): Promise<VerifiedReceipt[]>;
}

/** A purchase StoreKit has verified (its JWS checked by the system), as the entitlement layer reads it. */
export interface VerifiedReceipt {
  productId: string;
  /** Apple's original transaction id: one per subscription */
  originalTransactionId: string;
  /** end of the paid period, ms; null for a one-time purchase */
  expires: number | null;
  revoked: boolean;
}

/** The stand-in for builds without StoreKit: every call says so. */
export const noStoreKit: StoreKitBridge = {
  products: async () => [],
  purchase: async () => { throw new Error('Purchases through the App Store aren’t in this version.'); },
  restore: async () => [],
};

/** StoreKit as a provider: there is no web checkout and no webhook; the bridge does the work in the app. */
export const storeKit: PaymentProvider = {
  id: 'storekit',
  checkoutUrl: () => null,
  verifyWebhook: async () => false,
  parseWebhook: () => null,
};

export const PROVIDERS: Record<ProviderId, PaymentProvider> = { lemonsqueezy: lemonSqueezy, paddle, storekit: storeKit };

/** The Mac App Store edition must use Apple's in-app purchase; the direct download uses the configured merchant. */
export function providerFor(edition: 'direct' | 'mas', configured: ProviderId | undefined): PaymentProvider | null {
  if (edition === 'mas') return storeKit;
  if (!configured || configured === 'storekit') return null;
  return PROVIDERS[configured];
}
