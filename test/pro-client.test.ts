// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper Pro on this computer (core/pro/client.ts): nothing at all with Pro off;
// with it on, one read of the remote switch a day, licenses in the keychain,
// seats, renewing, checkout and the App Store edition.

import { describe, expect, it } from 'vitest';
import { signProConfig, type ProConfig } from '../core/pro/config';
import { LICENSE_SECRET, ProClient, type ProDeps, type ProStore } from '../core/pro/client';
import { issueLicense, type LicensePayload } from '../core/pro/license';
import { emailHash, newKeyPair } from '../core/pro/sign';

const DAY = 86_400_000;
const START = Date.parse('2027-03-01T12:00:00Z');
const KEY = await newKeyPair();
const HASH = await emailHash('ada@example.com');
const CONFIG: ProConfig = { v: 1, issued: START - DAY, enabled: true, rollout: 100, checkout: { provider: 'lemonsqueezy', pro: { year: 'https://ashforde.lemonsqueezy.com/buy/2' }, team: { year: 'https://ashforde.lemonsqueezy.com/buy/3' }, manage: 'https://ashforde.lemonsqueezy.com/billing' } };
const license = (over: Partial<LicensePayload> = {}) => issueLicense({ v: 1, id: 'lic_abcdef12', plan: 'pro', seats: 1, email: HASH, iat: START - DAY, exp: null, via: 'lemonsqueezy', ...over }, KEY.privateKey);

function harness(o: { enabled: boolean; keychain?: boolean; edition?: 'direct' | 'mas'; server?: (path: string, body: Record<string, unknown>) => unknown; config?: string | null }) {
  const calls = { fetch: [] as string[], every: 0, load: 0, secretsRead: 0, opened: [] as string[] };
  const secrets = new Map<string, string>();
  let store: ProStore = {};
  let now = START;
  const deps: ProDeps = {
    enabled: o.enabled, freeThrough: o.enabled ? '1.2.0' : null, edition: o.edition ?? 'direct', keys: [KEY.publicKey],
    configUrl: 'https://keeper.ashforde.org/pro.json', serverUrl: 'https://license.ashforde.org',
    now: () => now,
    fetch: async (url, init) => {
      calls.fetch.push(url);
      if (url.endsWith('/pro.json')) {
        if (o.config === null) throw new Error('offline');
        return { ok: true, status: 200, text: async () => o.config ?? '' };
      }
      const r = o.server?.(new URL(url).pathname, JSON.parse(init?.body ?? '{}'));
      if (r === undefined) throw new Error('offline');
      return { ok: true, status: 200, text: async () => JSON.stringify(r) };
    },
    load: async () => { calls.load++; return store; },
    save: async (s) => { store = JSON.parse(JSON.stringify(s)); },
    getSecret: async (n) => { calls.secretsRead++; return secrets.get(n); },
    setSecret: async (n, v) => { if (o.keychain === false) return false; if (v) secrets.set(n, v); else secrets.delete(n); return true; },
    openExternal: async (u) => { calls.opened.push(u); },
    randomRef: () => 'ref-0123456789',
    every: () => { calls.every++; return () => undefined; },
  };
  return { client: new ProClient(deps), calls, secrets, store: () => store, tick: (ms: number) => { now += ms; } };
}

describe('Keeper Pro switched off (the default)', () => {
  it('does nothing at all: no file, no keychain, no timer, no request', async () => {
    const h = harness({ enabled: false, config: await signProConfig(CONFIG, KEY.privateKey) });
    await h.client.start();
    await h.client.tick();
    expect(await h.client.status()).toEqual({ enabled: false });
    expect(h.calls).toEqual({ fetch: [], every: 0, load: 0, secretsRead: 0, opened: [] });
    expect(h.client.entitlements().plan).toBe('free');
  });
  it('refuses every action, and still asks nothing of the network', async () => {
    const h = harness({ enabled: false });
    const t = await license();
    await expect(h.client.activate(t)).rejects.toThrow(/isn’t part of this version/);
    await expect(h.client.deactivate()).rejects.toThrow();
    await expect(h.client.checkout('pro', 'year')).rejects.toThrow();
    await expect(h.client.manage()).rejects.toThrow();
    await expect(h.client.restore('ada@example.com')).rejects.toThrow();
    expect(h.calls.fetch).toEqual([]);
    expect(h.secrets.size).toBe(0);
  });
});

describe('Keeper Pro switched on', () => {
  it('reads the remote switch once a day, keeps the newest signed copy, and offers Pro by it', async () => {
    const h = harness({ enabled: true, config: await signProConfig(CONFIG, KEY.privateKey) });
    await h.client.start();
    await new Promise((r) => setTimeout(r, 0));
    expect(h.calls.every).toBe(1);
    await h.client.tick();
    await h.client.tick();
    expect(h.calls.fetch.filter((u) => u.endsWith('/pro.json'))).toHaveLength(1);
    const s = await h.client.status();
    expect(s).toMatchObject({ enabled: true, offered: true, plan: 'free', manage: true, buy: [{ plan: 'pro', period: 'year' }, { plan: 'team', period: 'year' }] });
    expect(s.enabled && s.features.every((f) => f.proposal && !f.has)).toBe(true);
    h.tick(DAY);
    await h.client.tick();
    expect(h.calls.fetch.filter((u) => u.endsWith('/pro.json'))).toHaveLength(2);
    expect(h.store().ref).toBe('ref-0123456789');
  });
  it('a forged or missing switch offers nothing, and offline is fine', async () => {
    const other = await newKeyPair();
    for (const config of [await signProConfig(CONFIG, other.privateKey), 'junk', null]) {
      const h = harness({ enabled: true, config });
      await h.client.tick();
      expect(await h.client.status()).toMatchObject({ offered: false, buy: [] });
    }
  });
  it('a pasted license goes into the keychain and gives its plan; removing it frees the seat', async () => {
    const seen: string[] = [];
    const h = harness({ enabled: true, server: (p) => { seen.push(p); return { ok: true }; } });
    const t = await license();
    await expect(h.client.activate('hello')).rejects.toThrow(/isn’t a Keeper license/);
    const s = await h.client.activate(`keeper://license?token=${t}`);
    expect(s).toMatchObject({ plan: 'pro', license: { id: 'lic_abcdef12', state: 'active', seats: 1 } });
    expect(h.secrets.get(LICENSE_SECRET)).toBe(t);
    expect(await h.client.deactivate()).toMatchObject({ plan: 'free', license: undefined });
    expect(h.secrets.has(LICENSE_SECRET)).toBe(false);
    expect(seen).toEqual(['/v1/activate', '/v1/deactivate']);
  });
  it('without a keychain (Linux with no keyring) the license is kept in the data file, and removed from it', async () => {
    const h = harness({ enabled: true, keychain: false });
    const t = await license();
    expect(await h.client.activate(t)).toMatchObject({ plan: 'pro' });
    expect(h.store().license).toBe(t);
    await h.client.deactivate();
    expect(h.store().license).toBeUndefined();
  });
  it('works offline, but not when every seat is taken', async () => {
    const off = harness({ enabled: true });
    expect(await off.client.activate(await license())).toMatchObject({ plan: 'pro' });
    const full = harness({ enabled: true, server: () => ({ ok: false, reason: 'seats' }) });
    await expect(full.client.activate(await license({ seats: 2 }))).rejects.toThrow(/in use on 2 computers/);
    expect(full.secrets.size).toBe(0);
  });
  it('refuses licenses from another key and refunded ones', async () => {
    const other = await newKeyPair();
    const h = harness({ enabled: true, config: await signProConfig({ ...CONFIG, revoked: ['lic_refunded'] }, KEY.privateKey) });
    await h.client.tick();
    await expect(h.client.activate(await issueLicense({ v: 1, id: 'lic_abcdef12', plan: 'pro', seats: 1, email: HASH, iat: START, exp: null, via: 'manual' }, other.privateKey))).rejects.toThrow(/wasn’t made by Ashforde/);
    await expect(h.client.activate(await license({ id: 'lic_refunded' }))).rejects.toThrow(/refunded/);
  });
  it('renews a subscription near its end, and keeps working through the grace period offline', async () => {
    let next = '';
    const h = harness({ enabled: true, server: (p) => (p === '/v1/refresh' ? (next ? { token: next } : undefined) : { ok: true }) });
    await h.client.activate(await license({ exp: START + 3 * DAY }));
    // Offline at the end: 30 more days.
    h.tick(10 * DAY);
    await h.client.tick();
    expect(await h.client.status()).toMatchObject({ plan: 'pro', license: { state: 'grace' } });
    h.tick(24 * DAY);
    await h.client.tick();
    expect(await h.client.status()).toMatchObject({ plan: 'free', problem: 'That license has ended.' });
    // Back online: the renewed license arrives and is used.
    next = await license({ exp: START + 400 * DAY, iat: START + 30 * DAY });
    h.tick(DAY);
    await h.client.tick();
    expect(await h.client.status()).toMatchObject({ plan: 'pro', license: { state: 'active', exp: START + 400 * DAY } });
    expect(h.secrets.get(LICENSE_SECRET)).toBe(next);
  });
  it('opens the hosted checkout and the subscription page in the browser', async () => {
    const h = harness({ enabled: true, config: await signProConfig(CONFIG, KEY.privateKey) });
    await h.client.tick();
    await h.client.checkout('pro', 'year');
    await h.client.manage();
    await expect(h.client.checkout('pro', 'month')).rejects.toThrow(/isn’t open/);
    expect(h.calls.opened[0]).toMatch(/^https:\/\/ashforde\.lemonsqueezy\.com\/buy\/2\?.*checkout%5Bcustom%5D%5Bref%5D=ref-0123456789/);
    expect(h.calls.opened[1]).toBe('https://ashforde.lemonsqueezy.com/billing');
  });
  it('the App Store edition offers no web checkout (StoreKit plugs in there)', async () => {
    const h = harness({ enabled: true, edition: 'mas', config: await signProConfig(CONFIG, KEY.privateKey) });
    await h.client.tick();
    expect(await h.client.status()).toMatchObject({ edition: 'mas', buy: [], manage: false });
    await expect(h.client.checkout('pro', 'year')).rejects.toThrow();
  });
  it('Restore purchase asks the server and says the same either way', async () => {
    const h = harness({ enabled: true, server: () => ({ ok: true }) });
    await expect(h.client.restore('not an address')).rejects.toThrow();
    expect(await h.client.restore('ada@example.com')).toMatch(/on its way/);
    await expect(harness({ enabled: true }).client.restore('ada@example.com')).rejects.toThrow(/couldn’t reach/);
  });
});
