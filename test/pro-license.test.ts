// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper Pro licenses and the signed remote switch (pro.json): checked on this
// computer with Ed25519, offline.

import { describe, expect, it } from 'vitest';
import { configDue, newerConfig, offered, readProConfig, rolloutBucket, signProConfig, type ProConfig } from '../core/pro/config';
import { findToken, GRACE_MS, issueLicense, peekLicense, verifyLicense, type LicensePayload } from '../core/pro/license';
import { b64url, emailHash, newKeyPair, signEd25519, unb64url, utf8 } from '../core/pro/sign';
import { LICENSE_PURPOSE } from '../core/pro/keys';

const NOW = Date.parse('2027-03-01T12:00:00Z');
const DAY = 86_400_000;
const KEY = await newKeyPair();
const OTHER = await newKeyPair();
const payload = async (over: Partial<LicensePayload> = {}): Promise<LicensePayload> => ({ v: 1, id: 'lic_abcdef12', plan: 'pro', seats: 2, email: await emailHash('Ada@Example.com '), iat: NOW - DAY, exp: NOW + 30 * DAY, via: 'paddle', ...over });

describe('licenses', () => {
  it('a valid license is active, with its plan and seats', async () => {
    const t = await issueLicense(await payload(), KEY.privateKey);
    expect(t).toMatch(/^kpl1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    const c = await verifyLicense(t, [KEY.publicKey], NOW);
    expect(c).toMatchObject({ ok: true, state: 'active', payload: { plan: 'pro', seats: 2, via: 'paddle' } });
    // The e-mail address is only a hash, the same however it is typed.
    expect(c.ok && c.payload.email).toBe(await emailHash('ada@example.com'));
    expect(JSON.stringify(peekLicense(t))).not.toMatch(/ada|example/i);
  });
  it('one that never ends stays active', async () => {
    const t = await issueLicense(await payload({ exp: null }), KEY.privateKey);
    expect(await verifyLicense(t, [KEY.publicKey], NOW + 3650 * DAY)).toMatchObject({ ok: true, state: 'active' });
  });
  it('past its end it works for 30 more days (offline grace), then stops', async () => {
    const t = await issueLicense(await payload({ exp: NOW }), KEY.privateKey);
    expect(await verifyLicense(t, [KEY.publicKey], NOW + DAY)).toMatchObject({ ok: true, state: 'grace', graceEndsAt: NOW + GRACE_MS });
    expect(await verifyLicense(t, [KEY.publicKey], NOW + GRACE_MS)).toMatchObject({ ok: true, state: 'grace' });
    expect(await verifyLicense(t, [KEY.publicKey], NOW + GRACE_MS + 1)).toMatchObject({ ok: false, reason: 'expired' });
  });
  it('a changed license is refused', async () => {
    const t = await issueLicense(await payload(), KEY.privateKey);
    const [pre, body, sig] = t.split('.');
    const forged = JSON.parse(new TextDecoder().decode(unb64url(body)));
    forged.plan = 'team';
    forged.seats = 500;
    expect(await verifyLicense(`${pre}.${b64url(utf8(JSON.stringify(forged)))}.${sig}`, [KEY.publicKey], NOW)).toMatchObject({ ok: false, reason: 'signature' });
    // Flip a real byte (the last base64 character partly holds unused padding bits).
    const bytes = unb64url(sig); bytes[10] ^= 0x01;
    const flipped = b64url(bytes);
    expect(await verifyLicense(`${pre}.${body}.${flipped}`, [KEY.publicKey], NOW)).toMatchObject({ ok: false, reason: 'signature' });
  });
  it('one signed with another key is refused; either of two listed keys works (moving to a new key)', async () => {
    const t = await issueLicense(await payload(), OTHER.privateKey);
    expect(await verifyLicense(t, [KEY.publicKey], NOW)).toMatchObject({ ok: false, reason: 'signature' });
    expect(await verifyLicense(t, [KEY.publicKey, OTHER.publicKey], NOW)).toMatchObject({ ok: true });
    expect(await verifyLicense(t, [], NOW)).toMatchObject({ ok: false, reason: 'no-keys' });
    expect(await verifyLicense(t, ['not a key', 'AAAA'], NOW)).toMatchObject({ ok: false, reason: 'signature' });
  });
  it('a signature made for something else (the remote switch) never passes as a license', async () => {
    const body = b64url(utf8(JSON.stringify(await payload())));
    const sig = await signEd25519(KEY.privateKey, 'keeper-pro-config-v1', body);
    expect(await verifyLicense(`kpl1.${body}.${sig}`, [KEY.publicKey], NOW)).toMatchObject({ ok: false, reason: 'signature' });
    expect(await verifyLicense(`kpl1.${body}.${await signEd25519(KEY.privateKey, LICENSE_PURPOSE, body)}`, [KEY.publicKey], NOW)).toMatchObject({ ok: true });
  });
  it('refunded licenses, ones from the future and things that are not licenses are refused', async () => {
    const t = await issueLicense(await payload(), KEY.privateKey);
    expect(await verifyLicense(t, [KEY.publicKey], NOW, ['lic_abcdef12'])).toMatchObject({ ok: false, reason: 'revoked' });
    const later = await issueLicense(await payload({ iat: NOW + 3 * DAY }), KEY.privateKey);
    expect(await verifyLicense(later, [KEY.publicKey], NOW)).toMatchObject({ ok: false, reason: 'future' });
    for (const junk of ['', 'kpl1', 'kpl1.a.b', 'kpl2.e30.AAAA', 'x'.repeat(5000), `kpl1.${b64url(utf8('{"v":1}'))}.AAAA`]) expect(await verifyLicense(junk, [KEY.publicKey], NOW), junk.slice(0, 20)).toMatchObject({ ok: false, reason: 'malformed' });
    await expect(issueLicense({ ...(await payload()), seats: 0 }, KEY.privateKey)).rejects.toThrow();
  });
  it('finds the license in pasted text or a keeper://license link', async () => {
    const t = await issueLicense(await payload(), KEY.privateKey);
    expect(findToken(`keeper://license?token=${t}`)).toBe(t);
    expect(findToken(`Your license:\n\n  ${t}  \n\nThanks`)).toBe(t);
    expect(findToken('nothing here')).toBeNull();
  });
});

describe('the remote switch (pro.json)', () => {
  const config: ProConfig = { v: 1, issued: NOW, enabled: true, rollout: 25, checkout: { provider: 'lemonsqueezy', pro: { month: 'https://ashforde.lemonsqueezy.com/buy/1', year: 'https://ashforde.lemonsqueezy.com/buy/2' }, manage: 'https://ashforde.lemonsqueezy.com/billing' }, revoked: ['lic_refunded'] };
  it('reads a file signed by Ashforde', async () => {
    expect(await readProConfig(await signProConfig(config, KEY.privateKey), [KEY.publicKey], NOW)).toEqual(config);
  });
  it('ignores one with another key, a changed one, one from the future, and junk', async () => {
    const text = await signProConfig(config, KEY.privateKey);
    expect(await readProConfig(text, [OTHER.publicKey], NOW)).toBeNull();
    expect(await readProConfig(text, [], NOW)).toBeNull();
    const env = JSON.parse(text);
    const changed = { ...config, rollout: 100 };
    expect(await readProConfig(JSON.stringify({ config: b64url(utf8(JSON.stringify(changed))), sig: env.sig }), [KEY.publicKey], NOW)).toBeNull();
    expect(await readProConfig(await signProConfig({ ...config, issued: NOW + 5 * DAY }, KEY.privateKey), [KEY.publicKey], NOW)).toBeNull();
    for (const junk of ['', '{}', 'null', '<html>', JSON.stringify({ config: 'x', sig: 'y' })]) expect(await readProConfig(junk, [KEY.publicKey], NOW)).toBeNull();
    // Checkout links must be https.
    await expect(signProConfig({ ...config, checkout: { provider: 'paddle', pro: { month: 'http://x' } } }, KEY.privateKey)).rejects.toThrow();
    // A license signature never passes as the switch.
    const body = b64url(utf8(JSON.stringify(config)));
    expect(await readProConfig(JSON.stringify({ config: body, sig: await signEd25519(KEY.privateKey, LICENSE_PURPOSE, body) }), [KEY.publicKey], NOW)).toBeNull();
  });
  it('an older file replayed later never replaces a newer one', () => {
    const a = { ...config, issued: NOW - DAY, enabled: true };
    const b = { ...config, issued: NOW, enabled: false };
    expect(newerConfig(b, a)).toBe(b);
    expect(newerConfig(a, b)).toBe(b);
    expect(newerConfig(null, a)).toBe(a);
    expect(newerConfig(a, null)).toBe(a);
  });
  it('is read at most once a day', () => {
    expect(configDue(undefined, NOW)).toBe(true);
    expect(configDue(NOW - DAY + 1, NOW)).toBe(false);
    expect(configDue(NOW - DAY, NOW)).toBe(true);
    // A clock set back does not stop the reads for good.
    expect(configDue(NOW + 5 * DAY, NOW)).toBe(true);
  });
  it('the kill switch and the rollout decide who is offered Pro, the same way every day', () => {
    expect(offered(null, 'abc')).toBe(false);
    expect(offered({ ...config, enabled: false, rollout: 100 }, 'abc')).toBe(false);
    expect(offered({ ...config, rollout: 0 }, 'abc')).toBe(false);
    expect(offered({ ...config, rollout: 100 }, 'abc')).toBe(true);
    expect(rolloutBucket('same-ref')).toBe(rolloutBucket('same-ref'));
    const refs = Array.from({ length: 4000 }, (_, i) => `ref-${i}-${(i * 7919) % 1000}`);
    const share = refs.filter((r) => offered(config, r)).length / refs.length;
    expect(share).toBeGreaterThan(0.2);
    expect(share).toBeLessThan(0.3);
  });
});
