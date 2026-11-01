// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Standard Notes two-way sync: the published crypto vectors from Standard
// Notes' own test suite, then the whole service against a local stand-in sync
// server answering from a recorded account (test/fixtures/notes-sync/
// sn-standin.cjs): sign-in with PKCE and a two-step code, pages, an expired
// and a revoked session, the dry run and sync through the engine, write-back,
// a conflict kept for review, tags, delete to the trash, and proof that the
// server never received a word of plain text.

import { createRequire } from 'node:module';
import { promises as fsp, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { xchachaOpen, xchachaSeal } from '../core/notes-sync/crypto';
import { snAuthOf, snDecrypt, snDecryptFor, snEncrypt, snKeyParamsFrom, snPkce, snRootKey, snSalt, snServerUrl, snSortedJson, snSyncResponse, StandardNotesApi, SN_ARGON2, type SnItem } from '../core/notes-sync/connectors/standardnotes';

const ROOT = await fsp.mkdtemp(path.join(os.tmpdir(), 'kn-sn-'));
const secrets = new Map<string, string>();
vi.mock('electron', () => ({
  app: { getPath: (k: string) => path.join(ROOT, k) },
  shell: { openExternal: async () => undefined, trashItem: async (p: string) => (await import('node:fs')).promises.rm(p) },
}));
vi.mock('../electron/store', () => ({ getSecret: async (k: string) => secrets.get(k), setSecret: async (k: string, v: string) => { if (v) secrets.set(k, v); else secrets.delete(k); return true; } }));
vi.mock('../electron/services/features', () => ({ featureOn: () => true, onFeature: () => () => undefined }));
vi.mock('../electron/services/governor', () => ({ poll: () => () => undefined }));

const { argon2 } = await import('../electron/services/notes-sync/connectors');
const { notesApi, startNotes } = await import('../electron/services/notes-sync');
const { startStandin } = createRequire(import.meta.url)('./fixtures/notes-sync/sn-standin.cjs') as { startStandin: (o: { account: unknown; mfaCode?: string; pageSize?: number }) => Promise<Standin> };
interface Standin { url: string; requests: { path: string; body: string; auth?: string }[]; items(): SnItem[]; put(it: SnItem): void; expireAccess(): void; revoke(): void; close(): Promise<void> }

const ACCOUNT = JSON.parse(readFileSync(path.join(__dirname, 'fixtures/notes-sync/sn-account.json'), 'utf8'));
const PASSWORD = 'Lighthouse keeper 7';
const ITEMS_KEY = '015c'.repeat(16); // the fixture's items key (made by the recording script)
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const fetchFn = async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
  const r = await fetch(url, init);
  return { ok: r.ok, status: r.status, headers: { get: (n: string) => r.headers.get(n) }, json: () => r.json(), text: () => r.text() };
};
/** what a note looks like on the server, opened with the fixture's items key (as another device would) */
const openOnServer = (s: Standin, uuid: string) => {
  const it = s.items().find((i) => i.uuid === uuid)!;
  const ik = snDecryptFor(it.enc_item_key!, ITEMS_KEY, uuid);
  return ik ? JSON.parse(snDecryptFor(it.content as string, ik, uuid)!) : null;
};
const sealAs = (it: SnItem, content: object): SnItem => {
  const k = 'ab'.repeat(32);
  return { ...it, enc_item_key: snEncrypt(k, ITEMS_KEY, '11'.repeat(24), { u: it.uuid, v: '004' }), content: snEncrypt(JSON.stringify(content), k, '22'.repeat(24), { u: it.uuid, v: '004' }) };
};

afterAll(async () => { await fsp.rm(ROOT, { recursive: true, force: true }); });

describe('Standard Notes 004 crypto, against Standard Notes’ published vectors', () => {
  it('Argon2id with the 004 settings: "argon2 generated salt" (salt = first half of sha256("foo:bar"))', async () => {
    const out = await argon2('foobarfoo🔒', snSalt('foo', 'bar'), { ...SN_ARGON2, length: 32 });
    expect(hex(out)).toBe('bb6ec440708c271ce34decd7f997e2444d309b1105992779ccdb47f78a5fda6f');
  }, 60_000);
  it('Argon2id: "argon2 libsodium.js test matching"', async () => {
    const out = await argon2('correct horse battery staple', Buffer.from('808182838485868788898a8b8c8d8e8f', 'hex'), { iterations: 2, memoryKiB: 65536, parallelism: 1, length: 16 });
    expect(hex(out)).toBe('720f95400220748a811bca9b8cff5d6e');
  }, 60_000);
  it('XChaCha20-Poly1305: "xchacha predefined string"', () => {
    const plain = "Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, sunscreen would be it.🌞";
    const key = Buffer.from('808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f', 'hex');
    const n = Buffer.from('404142434445464748494a4b4c4d4e4f5051525354555657', 'hex');
    const aad = Buffer.from('50515253c0c1c2c3c4c5c6c7', 'hex');
    const ct = xchachaSeal(key, n, new TextEncoder().encode(plain), aad);
    expect(Buffer.from(ct).toString('base64')).toBe('vW0XnT6D1DuVdleUk8DpOVcqFwAlK/rMvtKQLCE5bLtzHH8bC0qmRAvzqC9O2n45rmTGcIxUwhbLlrcuEhO0Ui+Mm6QNtdlFsRtpuYLBu54/P6wrw2lIj3ayODVl0//5IflmTJdjfal2iBL2FcaLE7UuOqw6kdl7HV6PKzn0pIOeHH3rkwQ=');
    expect(new TextDecoder().decode(xchachaOpen(key, n, ct, aad)!)).toBe(plain);
  });
  it('opens a real items key from Standard Notes’ own test suite with the password, all on this computer', async () => {
    // packages/snjs/mocha/model_tests/importing.test.js, "real crypto": key params of playground@bitar.io, password "password"
    const kp = { identifier: 'playground@bitar.io', pw_nonce: '651ae1ec9580339a3567ee7f0f8672492de2c166a556c13d119728a03c60f793', version: '004' };
    const uuid = '10051be7-4ca2-4af3-aae9-021939df4fab';
    const encItemKey = '004:d25deb224251b4705a44d8ce125a62f6a2f0e0e856603e8f:FEv1pfU/VfY7XhJrTfpcdhaSBfmNySTQtHohFYDm8V84KlyF5YaXRKV7BfXsa77DKTjOCU/EHHsWwhBEEfsNnzNySHxTHNc26bpoz0V8h50=:eyJrcCI6eyJpZGVudGlmaWVyIjoicGxheWdyb3VuZEBiaXRhci5pbyIsInB3X25vbmNlIjoiNjUxYWUxZWM5NTgwMzM5YTM1NjdlZTdmMGY4NjcyNDkyZGUyYzE2NmE1NTZjMTNkMTE5NzI4YTAzYzYwZjc5MyIsInZlcnNpb24iOiIwMDQiLCJvcmlnaW5hdGlvbiI6InByb3RvY29sLXVwZ3JhZGUiLCJjcmVhdGVkIjoiMTYxNDc4NDE5MjQ5NyJ9LCJ1IjoiMTAwNTFiZTctNGNhMi00YWYzLWFhZTktMDIxOTM5ZGY0ZmFiIiwidiI6IjAwNCJ9';
    const content = '004:77a986823b8ffdd87164b6f541de6ed420b70ac67e055774:+8cjww1QbyXNX+PSKeCwmnysv0rAoEaKh409VWQJpDbEy/pPZCT6c0rKxLzvyMiSq6EwkOiduZMzokRgCKP7RuRqNPJceWsxNnpIUwa40KR1IP2tdreW4J8v9pFEzPMec1oq40u+c+UI/Y6ChOLV/4ozyWmpQCK3y8Ugm7B1/FzaeDs9Ie6Mvf98+XECoi0fWv9SO2TeBvq1G24LXd4zf0j8jd0sKZbLPXH0+gaUXtBH7A56lHvB0ED9NuiHI8xopTBd9ogKlz/b5+JB4zA2zQCQ3WMEE1qz6WeB2S4FMomgeO1e3trabdU0ICu0WMvDVii4qNlQo/inD41oHXKeV5QwnYoGjPrLJIaP0hiLKhDURTHygCdvWdp63OWI+aGxv0/HI+nfcRsqSE+aYECrWB/kp/c5yTrEqBEafuWZkw==:eyJrcCI6eyJpZGVudGlmaWVyIjoicGxheWdyb3VuZEBiaXRhci5pbyIsInB3X25vbmNlIjoiNjUxYWUxZWM5NTgwMzM5YTM1NjdlZTdmMGY4NjcyNDkyZGUyYzE2NmE1NTZjMTNkMTE5NzI4YTAzYzYwZjc5MyIsInZlcnNpb24iOiIwMDQiLCJvcmlnaW5hdGlvbiI6InByb3RvY29sLXVwZ3JhZGUiLCJjcmVhdGVkIjoiMTYxNDc4NDE5MjQ5NyJ9LCJ1IjoiMTAwNTFiZTctNGNhMi00YWYzLWFhZTktMDIxOTM5ZGY0ZmFiIiwidiI6IjAwNCJ9';
    const { masterKey } = await snRootKey('password', kp, argon2);
    const itemKey = snDecryptFor(encItemKey, masterKey, uuid);
    expect(itemKey).toMatch(/^[0-9a-f]{64}$/);
    const c = JSON.parse(snDecryptFor(content, itemKey!, uuid)!);
    expect(c.version).toBe('003'); // an items key for the account's older items, made during its upgrade to 004
    expect(c.itemsKey).toMatch(/^[0-9a-f]{64}$/);
    // the same ciphertext, claimed for another item, is refused
    expect(snDecryptFor(encItemKey, masterKey, 'someone-else')).toBeNull();
    expect(snAuthOf(content)?.kp?.identifier).toBe('playground@bitar.io');
  }, 60_000);
  it('seals the way 004 does: sorted authenticated data, five parts, opens again', () => {
    expect(snSortedJson({ v: '004', u: 'x', kp: { version: '004', identifier: 'a' } })).toBe('{"kp":{"identifier":"a","version":"004"},"u":"x","v":"004"}');
    const s = snEncrypt('hello', 'aa'.repeat(32), 'bb'.repeat(24), { v: '004', u: 'n1' });
    expect(s.split(':')).toHaveLength(5);
    expect(s.endsWith(':e30=')).toBe(true);
    expect(snDecrypt(s, 'aa'.repeat(32))).toBe('hello');
    expect(snDecryptFor(s, 'aa'.repeat(32), 'n2')).toBeNull();
  });
  it('PKCE, server addresses and answers', () => {
    const p = snPkce('0'.repeat(64));
    expect(p.challenge).toBe(Buffer.from('60e05bd1b195af2f94112fa7197a5c88289058840ce7c6df9693756bc6250f55').toString('base64url'));
    expect(snPkce().verifier).toMatch(/^[0-9a-f]{64}$/);
    expect(snServerUrl('')).toBe('https://api.standardnotes.com');
    expect(snServerUrl('notes.example.org/')).toBe('https://notes.example.org');
    expect(snServerUrl('http://127.0.0.1:3000')).toBe('http://127.0.0.1:3000');
    expect(() => snServerUrl('http://notes.example.org')).toThrow(/https/);
    expect(snKeyParamsFrom({ data: { identifier: 'evil@x', pw_nonce: 'n', version: '004' } }, 'me@x')).toMatchObject({ identifier: 'me@x', pw_nonce: 'n' });
    expect(snSyncResponse({ unsaved: [{ item: { uuid: 'a' }, error: { tag: 'sync_conflict' } }] }).conflicts[0]).toMatchObject({ type: 'sync_conflict', unsaved_item: { uuid: 'a' } });
  });
});

describe('Standard Notes account against a local stand-in sync server', () => {
  let s: Standin;
  let id = '';
  const BOOK = '0d7c5b1e-1f3a-4f0e-8a51-7a0a2c1b0b01';
  const GIFT = '0d7c5b1e-1f3a-4f0e-8a51-7a0a2c1b0b02';
  beforeAll(async () => {
    s = await startStandin({ account: ACCOUNT, mfaCode: '424242', pageSize: 2 });
    await startNotes({ userData: path.join(ROOT, 'userData'), broadcast: () => undefined });
  });
  afterAll(async () => { await s.close(); });

  it('asks for the two-step code, then signs in with it (once) and keeps the session', async () => {
    const ov = await notesApi.addConnector({ kind: 'standardnotes-sync', fields: { email: 'ana@example.com', server: s.url }, secrets: { password: PASSWORD } });
    const c = ov.connectors.find((x) => x.kind === 'standardnotes-sync')!;
    id = c.id;
    expect(c).toMatchObject({ capability: 'two-way', app: 'Standard Notes', writeBack: false });
    expect((await notesApi.plan(id)).summary).toMatch(/asks for your two-step code/);
    await notesApi.updateConnector(id, { secrets: { code: '000000' } });
    expect((await notesApi.plan(id)).summary).toMatch(/did not accept that two-step code/);
    await notesApi.updateConnector(id, { secrets: { code: '424242' } });
    const p = await notesApi.plan(id);
    expect(p.summary).toMatch(/^Would add 2, update 0, conflicts 0 · 1 locked/); // the note in its trash stays out
    expect(secrets.has(`notesync.${id}.code`)).toBe(false); // used once, then forgotten
    const sess = JSON.parse(secrets.get(`notesync.${id}.session`)!);
    expect(sess).toMatchObject({ email: 'ana@example.com', server: s.url });
    expect(sess.masterKey).toMatch(/^[0-9a-f]{64}$/);
    // PKCE: the challenge went first, the verifier only with the sign-in
    const lp = s.requests.filter((r) => r.path === '/v2/login-params').map((r) => JSON.parse(r.body));
    const li = s.requests.filter((r) => r.path === '/v2/login').map((r) => JSON.parse(r.body));
    expect(li).toHaveLength(1);
    expect(lp.at(-1).code_challenge).toBe(snPkce(li[0].code_verifier).challenge);
    expect(li[0].password).toMatch(/^[0-9a-f]{64}$/);
    expect(li[0].password).not.toBe(sess.masterKey);
  }, 60_000);

  it('syncs: notes, tags, a protected note listed but not opened, pages followed', async () => {
    const r = await notesApi.sync(id);
    expect(r.errors).toEqual([]);
    expect(r.done.add).toBe(2);
    expect(r.done.locked).toBe(1);
    const [book] = await notesApi.search('lighthouse');
    expect(book).toMatchObject({ title: 'Book ideas', tags: ['writing'] });
    expect(await notesApi.search('private words')).toEqual([]);
    expect(s.requests.filter((x) => x.path === '/v1/items').length).toBeGreaterThanOrEqual(4); // 7 items, 2 a page
    expect(s.requests.filter((x) => x.path === '/v2/login')).toHaveLength(1);
  });

  it('writes back sealed on this computer; another device opens it; no plain text reached the server', async () => {
    await notesApi.updateConnector(id, { writeBack: true });
    await notesApi.plan(id);
    const [book] = await notesApi.search('lighthouse');
    await notesApi.saveNote(book.keeperId, { title: 'Book ideas', body: '- A lighthouse keeper who collects lost letters\n- Owls as messengers\n- Tidewater clocks', tags: ['writing', 'novel'] });
    const r = await notesApi.sync(id);
    expect(r.errors).toEqual([]);
    expect(r.done.updateApp).toBe(1);
    expect(openOnServer(s, BOOK)).toMatchObject({ title: 'Book ideas', text: expect.stringContaining('Tidewater clocks') });
    const tags = s.items().filter((i) => i.content_type === 'Tag').map((i) => openOnServer(s, i.uuid));
    expect(tags.find((t) => t.title === 'novel')?.references).toEqual([{ uuid: BOOK, content_type: 'Note' }]);
    const sent = s.requests.map((x) => x.body).join('\n');
    for (const secret of ['Tidewater', 'lighthouse', 'novel', PASSWORD, ITEMS_KEY]) expect(sent).not.toContain(secret);
    for (const it of s.items()) if (!it.deleted) expect(String(it.content)).toMatch(/^004:/);
  });

  it('an expired session is refreshed; a revoked one signs in again (no Argon2 needed: the key stays in the keychain)', async () => {
    s.expireAccess();
    expect((await notesApi.plan(id)).summary).toMatch(/^Would/);
    expect(s.requests.some((x) => x.path === '/v1/sessions/refresh')).toBe(true);
    s.revoke();
    await notesApi.updateConnector(id, { secrets: { code: '424242' } });
    expect((await notesApi.plan(id)).summary).toMatch(/^Would/);
    expect(s.requests.filter((x) => x.path === '/v2/login')).toHaveLength(2);
  });

  it('a change on both sides to the same line is a conflict kept for review; nothing is overwritten', async () => {
    const [gift] = await notesApi.search('pottery');
    await notesApi.saveNote(gift.keeperId, { title: 'Gift ideas', body: '- Mum: a pottery class in Keeper\n- Sam: the hiking map' });
    const it = s.items().find((i) => i.uuid === GIFT)!;
    s.put(sealAs(it, { title: 'Gift ideas', text: '- Mum: a pottery class on the phone\n- Sam: the hiking map', references: [], appData: {} }));
    const p = await notesApi.plan(id);
    expect(p.counts.conflicts).toBe(1);
    const r = await notesApi.sync(id);
    expect(r.done.conflicts).toBe(1);
    expect(openOnServer(s, GIFT).text).toContain('on the phone');
    const [c] = await notesApi.conflicts();
    expect(c.mine).toContain('in Keeper');
    expect(c.theirs).toContain('on the phone');
  });

  it('a change made there while Keeper sends is refused by the server and merged next time', async () => {
    const api = new StandardNotesApi({ server: s.url, email: 'ana@example.com', password: PASSWORD, session: JSON.parse(secrets.get(`notesync.${id}.session`)!), fetch: fetchFn, argon2 });
    const { notes } = await api.list();
    const book = notes.find((n) => n.sourceId === BOOK)!;
    const it = s.items().find((i) => i.uuid === BOOK)!;
    s.put(sealAs(it, { ...openOnServer(s, BOOK), text: 'changed on the phone meanwhile' }));
    await expect(api.update({ ...book, body: 'from Keeper' })).rejects.toThrow(/changed in Standard Notes while Keeper was sending/);
    expect(openOnServer(s, BOOK).text).toBe('changed on the phone meanwhile');
  });

  it('creates notes with tags, and deleting moves a note to Standard Notes’ trash', async () => {
    const api = new StandardNotesApi({ server: s.url, email: 'ana@example.com', password: PASSWORD, session: JSON.parse(secrets.get(`notesync.${id}.session`)!), fetch: fetchFn, argon2 });
    await api.list();
    const made = await api.create({ sourceId: '', title: 'From Keeper', body: 'hello', tags: ['writing'] });
    expect(openOnServer(s, made.sourceId)).toMatchObject({ title: 'From Keeper', text: 'hello' });
    const writing = s.items().filter((i) => i.content_type === 'Tag').map((i) => openOnServer(s, i.uuid)).find((t) => t.title === 'writing');
    expect(writing.references.map((r: { uuid: string }) => r.uuid)).toContain(made.sourceId);
    await api.remove(made.sourceId);
    expect(openOnServer(s, made.sourceId).trashed).toBe(true);
    expect((await api.list()).notes.find((n) => n.sourceId === made.sourceId)?.trashed).toBe(true);
  });

  it('a wrong password is refused by the server; a new password drops the kept session', async () => {
    const bad = new StandardNotesApi({ server: s.url, email: 'ana@example.com', password: 'nope', code: '424242', fetch: fetchFn, argon2: async () => new Uint8Array(64) });
    await expect(bad.list()).rejects.toThrow(/did not accept that email and password/);
    await notesApi.updateConnector(id, { secrets: { password: PASSWORD } });
    expect(secrets.has(`notesync.${id}.session`)).toBe(false);
  });
});
