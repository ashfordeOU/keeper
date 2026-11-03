// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Paying for Keeper Pro: the merchants' hosted checkouts and signed webhooks
// (Lemon Squeezy, Paddle), the App Store stand-in, and the owner's signing tool.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readProConfig } from '../core/pro/config';
import { lemonSqueezy, noStoreKit, paddle, providerFor, storeKit } from '../core/pro/payments';
import { hmacSha256Hex } from '../core/pro/sign';

const NOW = Date.parse('2027-03-01T12:00:00Z');
const plans = (id: string) => (id === '111' || id === 'pri_pro' ? 'pro' as const : id === '222' || id === 'pri_team' ? 'team' as const : null);
const headers = (h: Record<string, string>) => (n: string) => h[n.toLowerCase()] ?? null;

const lsEvent = (event: string, over: Record<string, unknown> = {}) => JSON.stringify({
  meta: { event_name: event, custom_data: { ref: 'install-ref-1', plan: 'pro' } },
  data: { type: 'subscriptions', id: '9001', attributes: { variant_id: 111, user_email: 'ada@example.com', customer_id: 77, quantity: 2, renews_at: '2027-04-01T12:00:00.000000Z', ...over } },
});
const paddleEvent = (type: string, over: Record<string, unknown> = {}) => JSON.stringify({
  event_type: type,
  data: { id: 'sub_01', status: 'active', customer_id: 'ctm_01', items: [{ price: { id: 'pri_team' }, quantity: 5 }], current_billing_period: { ends_at: '2028-03-01T12:00:00Z' }, custom_data: { ref: 'install-ref-2' }, ...over },
});

describe('Lemon Squeezy', () => {
  it('opens its hosted checkout with the install’s reference, and never anything else about the computer', () => {
    const u = new URL(lemonSqueezy.checkoutUrl('https://ashforde.lemonsqueezy.com/buy/abc', { plan: 'pro', period: 'year', ref: 'r1', seats: 3, email: 'ada@example.com' })!);
    expect(u.origin + u.pathname).toBe('https://ashforde.lemonsqueezy.com/buy/abc');
    expect(Object.fromEntries(u.searchParams)).toEqual({ 'checkout[email]': 'ada@example.com', 'checkout[custom][ref]': 'r1', 'checkout[custom][plan]': 'pro', quantity: '3' });
    expect(lemonSqueezy.checkoutUrl('http://insecure', { plan: 'pro', period: 'year', ref: 'r1' })).toBeNull();
  });
  it('accepts only webhooks signed with the shared secret', async () => {
    const raw = lsEvent('subscription_created');
    const sig = await hmacSha256Hex('s3cret', raw);
    expect(await lemonSqueezy.verifyWebhook(raw, headers({ 'x-signature': sig }), 's3cret', NOW)).toBe(true);
    expect(await lemonSqueezy.verifyWebhook(raw + ' ', headers({ 'x-signature': sig }), 's3cret', NOW)).toBe(false);
    expect(await lemonSqueezy.verifyWebhook(raw, headers({ 'x-signature': sig }), 'other', NOW)).toBe(false);
    expect(await lemonSqueezy.verifyWebhook(raw, headers({}), 's3cret', NOW)).toBe(false);
  });
  it('turns its events into the same purchase events', () => {
    expect(lemonSqueezy.parseWebhook(lsEvent('subscription_created'), plans)).toEqual({ kind: 'started', provider: 'lemonsqueezy', orderId: '9001', plan: 'pro', seats: 2, email: 'ada@example.com', customerId: '77', periodEnd: Date.parse('2027-04-01T12:00:00Z'), ref: 'install-ref-1' });
    expect(lemonSqueezy.parseWebhook(lsEvent('subscription_payment_success', { subscription_id: 9001 }), plans)).toMatchObject({ kind: 'renewed', orderId: '9001' });
    expect(lemonSqueezy.parseWebhook(lsEvent('subscription_cancelled'), plans)?.kind).toBe('cancelled');
    expect(lemonSqueezy.parseWebhook(lsEvent('subscription_expired'), plans)?.kind).toBe('ended');
    expect(lemonSqueezy.parseWebhook(lsEvent('order_refunded'), plans)?.kind).toBe('refunded');
    expect(lemonSqueezy.parseWebhook(lsEvent('subscription_created', { variant_id: 999 }), plans)).toBeNull();
    expect(lemonSqueezy.parseWebhook(lsEvent('affiliate_activated'), plans)).toBeNull();
    expect(lemonSqueezy.parseWebhook('not json', plans)).toBeNull();
  });
});

describe('Paddle', () => {
  it('opens its hosted checkout with the reference in custom data', () => {
    const u = new URL(paddle.checkoutUrl('https://buy.paddle.example/checkout/hsc_1', { plan: 'team', period: 'year', ref: 'r2', seats: 5 })!);
    expect(u.searchParams.get('quantity')).toBe('5');
    expect(JSON.parse(u.searchParams.get('custom_data')!)).toEqual({ ref: 'r2', plan: 'team' });
  });
  it('accepts only fresh webhooks signed with the secret', async () => {
    const raw = paddleEvent('subscription.created');
    const ts = String(Math.floor(NOW / 1000));
    const h1 = await hmacSha256Hex('whsec', `${ts}:${raw}`);
    expect(await paddle.verifyWebhook(raw, headers({ 'paddle-signature': `ts=${ts};h1=${h1}` }), 'whsec', NOW)).toBe(true);
    expect(await paddle.verifyWebhook(raw, headers({ 'paddle-signature': `ts=${ts};h1=${h1}` }), 'whsec', NOW + 6 * 60_000)).toBe(false);
    expect(await paddle.verifyWebhook(raw.replace('pri_team', 'pri_pro'), headers({ 'paddle-signature': `ts=${ts};h1=${h1}` }), 'whsec', NOW)).toBe(false);
    expect(await paddle.verifyWebhook(raw, headers({ 'paddle-signature': `h1=${h1}` }), 'whsec', NOW)).toBe(false);
  });
  it('turns its events into the same purchase events', () => {
    expect(paddle.parseWebhook(paddleEvent('subscription.created'), plans)).toEqual({ kind: 'started', provider: 'paddle', orderId: 'sub_01', plan: 'team', seats: 5, email: undefined, customerId: 'ctm_01', periodEnd: Date.parse('2028-03-01T12:00:00Z'), ref: 'install-ref-2' });
    expect(paddle.parseWebhook(paddleEvent('transaction.completed', { id: 'txn_1', subscription_id: 'sub_01' }), plans)).toMatchObject({ kind: 'renewed', orderId: 'sub_01' });
    expect(paddle.parseWebhook(paddleEvent('transaction.completed', { id: 'txn_2', subscription_id: null }), plans)).toMatchObject({ kind: 'started', orderId: 'txn_2' });
    expect(paddle.parseWebhook(paddleEvent('subscription.canceled'), plans)?.kind).toBe('cancelled');
    expect(paddle.parseWebhook(paddleEvent('subscription.updated', { status: 'canceled' }), plans)?.kind).toBe('ended');
    expect(paddle.parseWebhook(paddleEvent('customer.created'), plans)).toBeNull();
  });
});

describe('the Mac App Store edition', () => {
  it('always uses Apple’s in-app purchase, never a web checkout', async () => {
    expect(providerFor('mas', 'lemonsqueezy')).toBe(storeKit);
    expect(providerFor('direct', 'paddle')).toBe(paddle);
    expect(providerFor('direct', 'storekit')).toBeNull();
    expect(providerFor('direct', undefined)).toBeNull();
    expect(storeKit.checkoutUrl('https://x', { plan: 'pro', period: 'year', ref: 'r' })).toBeNull();
    expect(await storeKit.verifyWebhook('{}', () => null, 's', NOW)).toBe(false);
    await expect(noStoreKit.purchase('org.ashforde.keeper.pro.year')).rejects.toThrow(/App Store/);
    expect(await noStoreKit.restore()).toEqual([]);
  });
});

describe('the owner’s tool (scripts/pro.mjs)', () => {
  it('makes a key pair and signs a pro.json the app accepts', async () => {
    const out = execFileSync(process.execPath, ['scripts/pro.mjs', 'keys'], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' });
    const [pub, priv] = [...out.matchAll(/^ {2}([A-Za-z0-9+/=]{40,})$/gm)].map((m) => m[1]);
    expect(pub).toBeTruthy();
    const dir = mkdtempSync(path.join(os.tmpdir(), 'keeper-pro-'));
    try {
      const cfg = path.join(dir, 'config.json');
      writeFileSync(cfg, JSON.stringify({ enabled: true, rollout: 10 }));
      const text = execFileSync(process.execPath, ['scripts/pro.mjs', 'sign-config', cfg], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8', env: { ...process.env, KEEPER_PRO_PRIVATE_KEY: priv } });
      const c = await readProConfig(text.trim(), [pub], Date.now() + 1000);
      expect(c).toMatchObject({ v: 1, enabled: true, rollout: 10 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
