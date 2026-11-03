// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper's license server (server/license), run against stand-ins: signed
// webhooks as Lemon Squeezy and Paddle send them, a fake e-mail service and a
// fake Paddle customer lookup on this computer (real HTTP), and an in-memory
// store in place of Workers KV. No real keys, nothing deployed.

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyLicense } from '../core/pro/license';
import { emailHash, hmacSha256Hex, newKeyPair } from '../core/pro/sign';
import { handle, type Env } from '../server/license/src/worker';

const KEY = await newKeyPair();
const mails: { auth?: string; body: { from: string; to: string; subject: string; text: string } }[] = [];
let server: http.Server;
let base = '';

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      if (req.method === 'POST' && req.url === '/emails') {
        mails.push({ auth: req.headers.authorization, body: JSON.parse(b) });
        res.writeHead(200, { 'content-type': 'application/json' }).end('{"id":"m1"}');
      } else if (req.method === 'GET' && req.url === '/customers/ctm_01') {
        res.writeHead(req.headers.authorization === 'Bearer pdl_key' ? 200 : 401, { 'content-type': 'application/json' }).end(JSON.stringify({ data: { email: 'grace@example.com' } }));
      } else res.writeHead(404).end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

function env(): Env & { kv: Map<string, string> } {
  const kv = new Map<string, string>();
  return {
    kv,
    LICENSES: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); } },
    LICENSE_PRIVATE_KEY: KEY.privateKey, LICENSE_PUBLIC_KEY: KEY.publicKey,
    LEMONSQUEEZY_WEBHOOK_SECRET: 'ls_secret', PADDLE_WEBHOOK_SECRET: 'pdl_secret', PADDLE_API_KEY: 'pdl_key', PADDLE_API_URL: base,
    EMAIL_API_URL: `${base}/emails`, EMAIL_API_KEY: 'mail_key', EMAIL_FROM: 'Keeper <keeper@ashforde.org>',
    PLANS: JSON.stringify({ 111: 'pro', pri_team: 'team' }),
  };
}

const post = (e: Env, path: string, body: string, headers: Record<string, string> = {}) =>
  handle(new Request(`https://license.ashforde.org${path}`, { method: 'POST', body, headers: { 'content-type': 'application/json', ...headers } }), e).then(async (r) => ({ status: r.status, body: await r.json() as Record<string, unknown> }));

const lsBody = (event: string, over: Record<string, unknown> = {}) => JSON.stringify({
  meta: { event_name: event, custom_data: { ref: 'ref-0123456789' } },
  data: { type: 'subscriptions', id: '9001', attributes: { variant_id: 111, user_email: 'Ada@Example.com', customer_id: 77, quantity: 2, renews_at: new Date(Date.now() + 30 * 86_400_000).toISOString(), ...over } },
});
const lsHook = async (e: Env, body: string, secret = 'ls_secret') => post(e, '/v1/webhook/lemonsqueezy', body, { 'x-signature': await hmacSha256Hex(secret, body) });
const tokenFrom = (text: string) => text.match(/kpl1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/)![0];

describe('license server', () => {
  it('turns a Lemon Squeezy purchase into a signed license and e-mails it, once', async () => {
    const e = env();
    mails.length = 0;
    const r = await lsHook(e, lsBody('subscription_created'));
    expect(r).toMatchObject({ status: 200, body: { ok: true } });
    expect(mails).toHaveLength(1);
    const m = mails[0];
    expect(m.auth).toBe('Bearer mail_key');
    expect(m.body).toMatchObject({ to: 'Ada@Example.com', subject: 'Your Keeper Pro license' });
    expect(m.body.text).toContain('keeper://license?token=kpl1.');
    const c = await verifyLicense(tokenFrom(m.body.text), [KEY.publicKey], Date.now());
    expect(c).toMatchObject({ ok: true, payload: { plan: 'pro', seats: 2, via: 'lemonsqueezy', email: await emailHash('ada@example.com') } });
    // The address itself is never stored.
    expect([...e.kv.values()].join(' ')).not.toMatch(/ada@example\.com/i);
    // A renewal updates the license without another e-mail.
    await lsHook(e, lsBody('subscription_payment_success', { subscription_id: 9001 }));
    expect(mails).toHaveLength(1);
  });
  it('refuses webhooks that are not signed by the provider, and unknown providers', async () => {
    const e = env();
    mails.length = 0;
    expect((await lsHook(e, lsBody('subscription_created'), 'wrong')).status).toBe(401);
    expect((await post(e, '/v1/webhook/lemonsqueezy', lsBody('subscription_created'))).status).toBe(401);
    expect((await post(e, '/v1/webhook/storekit', '{}')).status).toBe(404);
    expect((await post(e, '/v1/webhook/other', '{}')).status).toBe(404);
    expect(mails).toHaveLength(0);
    expect(e.kv.size).toBe(0);
    // Events Keeper does not use are acknowledged and ignored.
    expect((await lsHook(e, lsBody('subscription_created', { variant_id: 5 }))).body).toMatchObject({ ignored: true });
  });
  it('a Paddle subscription: address from Paddle’s customer record, Team seats', async () => {
    const e = env();
    mails.length = 0;
    const body = JSON.stringify({ event_type: 'subscription.created', data: { id: 'sub_01', status: 'active', customer_id: 'ctm_01', items: [{ price: { id: 'pri_team' }, quantity: 5 }], current_billing_period: { ends_at: new Date(Date.now() + 365 * 86_400_000).toISOString() } } });
    const ts = String(Math.floor(Date.now() / 1000));
    const r = await post(e, '/v1/webhook/paddle', body, { 'paddle-signature': `ts=${ts};h1=${await hmacSha256Hex('pdl_secret', `${ts}:${body}`)}` });
    expect(r.status).toBe(200);
    expect(mails.map((m) => m.body.to)).toEqual(['grace@example.com']);
    expect(await verifyLicense(tokenFrom(mails[0].body.text), [KEY.publicKey], Date.now())).toMatchObject({ ok: true, payload: { plan: 'team', seats: 5, via: 'paddle' } });
  });
  it('counts seats, frees one to move the license, and renews', async () => {
    const e = env();
    mails.length = 0;
    await lsHook(e, lsBody('subscription_created'));
    const token = tokenFrom(mails[0].body.text);
    expect((await post(e, '/v1/activate', JSON.stringify({ token, seat: 'computer-a1' }))).body).toMatchObject({ ok: true, used: 1, seats: 2 });
    expect((await post(e, '/v1/activate', JSON.stringify({ token, seat: 'computer-a1' }))).body).toMatchObject({ ok: true, used: 1 });
    expect((await post(e, '/v1/activate', JSON.stringify({ token, seat: 'computer-b2' }))).body).toMatchObject({ ok: true, used: 2 });
    expect((await post(e, '/v1/activate', JSON.stringify({ token, seat: 'computer-c3' }))).body).toMatchObject({ ok: false, reason: 'seats' });
    expect((await post(e, '/v1/deactivate', JSON.stringify({ token, seat: 'computer-a1' }))).body).toMatchObject({ ok: true, used: 1 });
    expect((await post(e, '/v1/activate', JSON.stringify({ token, seat: 'computer-c3' }))).body).toMatchObject({ ok: true, used: 2 });
    const r = await post(e, '/v1/refresh', JSON.stringify({ token }));
    expect(r.body).toMatchObject({ status: 'active' });
    expect(await verifyLicense(String(r.body.token), [KEY.publicKey], Date.now())).toMatchObject({ ok: true });
    expect((await post(e, '/v1/refresh', JSON.stringify({ token: 'kpl1.x.y' }))).status).toBe(404);
  });
  it('a refund revokes it; a cancellation runs to the end of the period', async () => {
    const e = env();
    mails.length = 0;
    await lsHook(e, lsBody('subscription_created'));
    const token = tokenFrom(mails[0].body.text);
    await lsHook(e, lsBody('subscription_cancelled'));
    expect((await post(e, '/v1/refresh', JSON.stringify({ token }))).body).toMatchObject({ status: 'cancelled' });
    await lsHook(e, lsBody('order_refunded'));
    expect((await post(e, '/v1/refresh', JSON.stringify({ token }))).body).toEqual({ revoked: true });
    expect((await post(e, '/v1/activate', JSON.stringify({ token, seat: 'computer-z9' }))).body).toMatchObject({ ok: false, reason: 'revoked' });
  });
  it('Restore purchase e-mails the licenses again, never says whether there were any, and not too often', async () => {
    const e = env();
    mails.length = 0;
    await lsHook(e, lsBody('subscription_created'));
    expect((await post(e, '/v1/restore', JSON.stringify({ email: ' ADA@example.com ' }))).body).toEqual({ ok: true });
    expect(mails).toHaveLength(2);
    expect(mails[1].body.to).toBe('ADA@example.com');
    expect((await post(e, '/v1/restore', JSON.stringify({ email: 'ada@example.com' }))).body).toEqual({ ok: true });
    expect(mails).toHaveLength(2);
    expect((await post(e, '/v1/restore', JSON.stringify({ email: 'nobody@example.com' }))).body).toEqual({ ok: true });
    expect(mails).toHaveLength(2);
    expect((await post(e, '/v1/restore', JSON.stringify({ email: 'nope' }))).status).toBe(400);
  });
  it('answers only POST, and refuses large bodies and junk', async () => {
    const e = env();
    expect((await handle(new Request('https://license.ashforde.org/v1/refresh'), e)).status).toBe(405);
    expect((await post(e, '/v1/refresh', 'x'.repeat(70_000))).status).toBe(413);
    expect((await post(e, '/v1/refresh', 'not json')).status).toBe(400);
    expect((await post(e, '/v1/other', '{}')).status).toBe(404);
  });
});
