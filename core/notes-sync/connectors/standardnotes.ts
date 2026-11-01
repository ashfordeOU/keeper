// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Standard Notes: reads decrypted backups, opens encrypted (protocol 004)
// backups on this computer, and syncs both ways with a Standard Notes sync
// server (the official one or a self-hosted one) through its documented API.
//
// Argon2id turns your password into the root key on this computer; only its
// second half (the "server password") is sent when signing in, exactly as
// Standard Notes' own apps do. XChaCha20-Poly1305 opens the items keys and
// then each note, and seals every note Keeper sends back. Nothing in plain
// text ever leaves this computer: the server only ever sees 004 ciphertext.

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { bytesToHex, hexToBytes, xchachaOpen, xchachaSeal } from '../crypto';
import { ConnectorError, type ConnectorIO, type FetchFn, type FetchResponse } from './io';
import type { RemoteNote } from '../types';

export const SN_DEFAULT_SERVER = 'https://api.standardnotes.com';

export interface SnKeyParams {
  identifier: string;
  pw_nonce: string;
  version: string;
  origination?: string;
  created?: string;
}

export interface SnItem {
  uuid: string;
  content_type: string;
  content: unknown;
  enc_item_key?: string;
  items_key_id?: string | null;
  created_at?: string;
  updated_at?: string;
  created_at_timestamp?: number;
  updated_at_timestamp?: number;
  deleted?: boolean;
}

export interface SnBackup {
  version?: string;
  keyParams?: SnKeyParams;
  auth_params?: SnKeyParams;
  items: SnItem[];
}

/** Argon2id, supplied by the caller (Node's crypto.argon2 in the app). */
export type Argon2 = (password: string, salt: Uint8Array, opts: { iterations: number; memoryKiB: number; parallelism: number; length: number }) => Promise<Uint8Array>;

export const SN_ARGON2 = { iterations: 5, memoryKiB: 65536, parallelism: 1, length: 64 };

/** The Argon2 salt: the first 16 bytes of sha256("identifier:nonce"). */
export function snSalt(identifier: string, nonce: string): Uint8Array {
  return hexToBytes(createHash('sha256').update(`${identifier}:${nonce}`).digest('hex').slice(0, 32));
}

/** Root key from a password: the first half encrypts items keys, the second is the server password. */
export async function snRootKey(password: string, kp: SnKeyParams, argon2: Argon2): Promise<{ masterKey: string; serverPassword: string }> {
  if (kp.version !== '004') throw new Error(`This backup uses an older format (${kp.version}). Open it in Standard Notes and download a new backup.`);
  const out = bytesToHex(await argon2(password, snSalt(kp.identifier, kp.pw_nonce), SN_ARGON2));
  return { masterKey: out.slice(0, 64), serverPassword: out.slice(64, 128) };
}

const b64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'));
const utf8 = (s: string) => new TextEncoder().encode(s);

/** Opens "004:nonce:ciphertext:authenticatedData" with a hex key, or null. */
export function snDecrypt(payload: string, keyHex: string): string | null {
  const p = payload.split(':');
  if (p.length < 4 || p[0] !== '004') return null;
  const out = xchachaOpen(hexToBytes(keyHex), hexToBytes(p[1]), b64(p[2]), utf8(p[3]));
  return out ? new TextDecoder().decode(out) : null;
}

/** JSON with keys sorted at every level, as Standard Notes encodes authenticated data. */
export function snSortedJson(o: unknown): string {
  if (Array.isArray(o)) return `[${o.map(snSortedJson).join(',')}]`;
  if (o && typeof o === 'object') return `{${Object.keys(o).filter((k) => (o as Record<string, unknown>)[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${snSortedJson((o as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(o);
}

/** Seals text the way protocol 004 does: "004:nonce:ciphertext:authenticatedData:additionalData". */
export function snEncrypt(plain: string, keyHex: string, nonceHex: string, auth: Record<string, unknown>): string {
  const ad = Buffer.from(snSortedJson(auth)).toString('base64');
  const ct = xchachaSeal(hexToBytes(keyHex), hexToBytes(nonceHex), utf8(plain), utf8(ad));
  return `004:${nonceHex}:${Buffer.from(ct).toString('base64')}:${ad}:e30=`;
}

/** The authenticated data inside a 004 string ({u, v, kp?}), or null. */
export function snAuthOf(payload: string): { u?: string; v?: string; kp?: SnKeyParams } | null {
  const p = payload.split(':');
  if (p.length < 4) return null;
  try {
    return JSON.parse(Buffer.from(p[3], 'base64').toString('utf8')) as { u?: string; v?: string };
  } catch {
    return null;
  }
}

/** Opens an item's 004 string only if it was sealed for this item (a server cannot swap one note's text into another). */
export function snDecryptFor(payload: string, keyHex: string, uuid: string): string | null {
  const a = snAuthOf(payload);
  if (!a || a.u !== uuid || a.v !== '004') return null;
  return snDecrypt(payload, keyHex);
}

const timeOf = (s?: string, ts?: number) => (ts ? Math.round(ts / 1000) : s ? Date.parse(s) || undefined : undefined);

export interface SnParseResult {
  notes: RemoteNote[];
  encrypted: boolean;
  /** encrypted, and no key yet */
  needsPassword: boolean;
  /** items that could not be opened */
  skipped: number;
  keyParams?: SnKeyParams;
}

/** Decrypts every item it can, given the root key's master key. */
export function snDecryptItems(items: SnItem[], masterKey: string): { items: SnItem[]; skipped: number } {
  const itemsKeys = new Map<string, string>();
  let skipped = 0;
  for (const it of items) {
    if (it.content_type !== 'SN|ItemsKey' || typeof it.content !== 'string' || !it.enc_item_key) continue;
    const ik = snDecryptFor(it.enc_item_key, masterKey, it.uuid);
    const c = ik ? snDecryptFor(it.content, ik, it.uuid) : null;
    if (!c) { skipped++; continue; }
    try { itemsKeys.set(it.uuid, (JSON.parse(c) as { itemsKey: string }).itemsKey); } catch { skipped++; }
  }
  const out: SnItem[] = [];
  for (const it of items) {
    if (typeof it.content !== 'string' || !it.content.startsWith('004:')) { out.push(it); continue; }
    if (it.content_type === 'SN|ItemsKey') continue;
    const key = it.items_key_id ? itemsKeys.get(it.items_key_id) : [...itemsKeys.values()][0];
    const ik = key && it.enc_item_key ? snDecryptFor(it.enc_item_key, key, it.uuid) : null;
    const c = ik ? snDecryptFor(it.content, ik, it.uuid) : null;
    if (!c) { skipped++; continue; }
    try { out.push({ ...it, content: JSON.parse(c) }); } catch { skipped++; }
  }
  return { items: out, skipped };
}

/** Notes from a backup's (decrypted) items, with tags from Tag items' references. */
export function snNotesFromItems(items: SnItem[]): RemoteNote[] {
  const tagsOf = new Map<string, string[]>();
  for (const it of items) {
    if (it.content_type !== 'Tag' || it.deleted || !it.content || typeof it.content !== 'object') continue;
    const c = it.content as { title?: string; references?: { uuid: string; content_type?: string }[] };
    for (const r of c.references ?? []) if (!r.content_type || r.content_type === 'Note') tagsOf.set(r.uuid, [...(tagsOf.get(r.uuid) ?? []), c.title ?? '']);
  }
  const notes: RemoteNote[] = [];
  for (const it of items) {
    if (it.content_type !== 'Note' || !it.content || typeof it.content !== 'object') continue;
    const c = it.content as { title?: string; text?: string; trashed?: boolean; protected?: boolean; appData?: Record<string, Record<string, unknown>> };
    notes.push({
      sourceId: it.uuid,
      title: c.title || 'Untitled',
      body: c.protected ? '' : c.text ?? '',
      tags: (tagsOf.get(it.uuid) ?? []).filter(Boolean),
      created: timeOf(it.created_at, it.created_at_timestamp),
      modified: timeOf(it.updated_at, it.updated_at_timestamp),
      version: it.updated_at_timestamp ? String(it.updated_at_timestamp) : it.updated_at,
      trashed: !!c.trashed || !!it.deleted,
      locked: c.protected ? true : undefined,
    });
  }
  return notes;
}

/** Reads a backup file's text. Pass the master key to open an encrypted one. */
export function parseSnBackup(text: string, masterKey?: string): SnParseResult {
  let j: SnBackup;
  try {
    j = JSON.parse(text) as SnBackup;
  } catch {
    throw new Error('This is not a Standard Notes backup file.');
  }
  if (!Array.isArray(j.items)) throw new Error('This is not a Standard Notes backup file.');
  const kp = j.keyParams ?? j.auth_params;
  const encrypted = j.items.some((i) => typeof i.content === 'string' && i.content.startsWith('00'));
  if (!encrypted) return { notes: snNotesFromItems(j.items), encrypted: false, needsPassword: false, skipped: 0 };
  if (!masterKey) return { notes: [], encrypted: true, needsPassword: true, skipped: 0, keyParams: kp };
  const { items, skipped } = snDecryptItems(j.items, masterKey);
  return { notes: snNotesFromItems(items), encrypted: true, needsPassword: false, skipped, keyParams: kp };
}

/** A decrypted backup to import back into Standard Notes (Preferences → Backups → Import). */
export function snBackupFrom(notes: { title: string; body: string; tags: string[]; created: number; modified: number }[]): string {
  const items: SnItem[] = [];
  const tagRefs = new Map<string, string[]>();
  for (const n of notes) {
    const uuid = randomUUID();
    items.push({ uuid, content_type: 'Note', created_at: new Date(n.created).toISOString(), updated_at: new Date(n.modified).toISOString(), content: { title: n.title, text: n.body, references: [], appData: {} } });
    for (const t of n.tags) tagRefs.set(t, [...(tagRefs.get(t) ?? []), uuid]);
  }
  for (const [t, refs] of tagRefs) items.push({ uuid: randomUUID(), content_type: 'Tag', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), content: { title: t, references: refs.map((uuid) => ({ uuid, content_type: 'Note' })), appData: {} } });
  return JSON.stringify({ version: '004', items }, null, 2);
}


// ---------------------------------------------------------------- the sync server
//
// The same calls Standard Notes' own apps make (see its "api" and "snjs" packages):
//   POST /v2/login-params  {api, email, code_challenge[, mfa_code]}   → key params (or "mfa-required")
//   POST /v2/login         {api, email, password: serverPassword, ephemeral, code_verifier}
//   POST /v1/sessions/refresh {api, access_token, refresh_token}      (after a 498 answer)
//   POST /v1/items         {api, items, sync_token, cursor_token, limit}   (Authorization: Bearer)
// The PKCE pair binds the two sign-in calls together, as in the apps.

/** The API version Keeper speaks; servers since 2020 understand it. */
export const SN_API = '20200115';

export interface SnSession {
  server: string;
  email: string;
  accessToken: string;
  refreshToken: string;
  accessExpiration?: number;
  refreshExpiration?: number;
  keyParams: SnKeyParams;
  /** the root key's first half; kept only in the system keychain so Argon2 runs once per sign-in */
  masterKey?: string;
}

/** The server's address: the official one by default; plain http only for this computer. */
export function snServerUrl(s?: string): string {
  const raw = (s ?? '').trim() || SN_DEFAULT_SERVER;
  let u: URL;
  try {
    u = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new ConnectorError('not-supported', 'That server address does not look right.');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) throw new ConnectorError('not-supported', 'Use an https address for the server (http only works for a server on this computer).');
  return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`;
}

/** PKCE as Standard Notes does it: a random hex verifier; the challenge is base64url of the hex SHA-256 text. */
export function snPkce(verifier = randomBytes(32).toString('hex')): { verifier: string; challenge: string } {
  return { verifier, challenge: Buffer.from(createHash('sha256').update(verifier).digest('hex')).toString('base64url') };
}

/** The body of a sync request (POST <server>/v1/items with a session token). */
export function snSyncRequest(items: SnItem[], syncToken?: string, cursorToken?: string) {
  return { api: SN_API, items, sync_token: syncToken, cursor_token: cursorToken, limit: 150 };
}

export interface SnConflict {
  type?: string;
  server_item?: SnItem;
  unsaved_item?: SnItem;
}

export function snSyncResponse(j: unknown): { retrieved: SnItem[]; saved: SnItem[]; conflicts: SnConflict[]; syncToken?: string; cursorToken?: string } {
  const o = (j ?? {}) as { data?: unknown } & Record<string, unknown>;
  const d = (o.data ?? o) as Record<string, unknown>;
  // servers before 2020 called conflicts "unsaved" ({item, error})
  const old = ((d.unsaved as { item?: SnItem; error?: { tag?: string } }[]) ?? []).map((u) => ({ type: u.error?.tag ?? 'sync_conflict', unsaved_item: u.item }));
  return {
    retrieved: (d.retrieved_items as SnItem[]) ?? [],
    saved: (d.saved_items as SnItem[]) ?? [],
    conflicts: [...((d.conflicts as SnConflict[]) ?? []), ...old],
    syncToken: d.sync_token as string | undefined,
    cursorToken: (d.cursor_token as string | undefined) || undefined,
  };
}

interface SnError { tag?: string; message?: string; payload?: { mfa_key?: string } }

async function readJson(r: FetchResponse): Promise<Record<string, unknown>> {
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  return j && typeof j === 'object' ? j : {};
}
const dataOf = (j: Record<string, unknown>) => ((j.data && typeof j.data === 'object' ? j.data : j) as Record<string, unknown>);
const errorOf = (j: Record<string, unknown>): SnError | undefined => (j.error ?? dataOf(j).error) as SnError | undefined;

function sessionFrom(j: Record<string, unknown>): Pick<SnSession, 'accessToken' | 'refreshToken' | 'accessExpiration' | 'refreshExpiration'> | null {
  const s = dataOf(j).session as { access_token?: string; refresh_token?: string; access_expiration?: number; refresh_expiration?: number } | undefined;
  if (!s?.access_token || !s.refresh_token) return null;
  return { accessToken: s.access_token, refreshToken: s.refresh_token, accessExpiration: s.access_expiration, refreshExpiration: s.refresh_expiration };
}

/** Key params from a login-params answer; the identifier is always the email you typed (as the apps do). */
export function snKeyParamsFrom(j: Record<string, unknown>, email: string): SnKeyParams | null {
  const d = dataOf(j);
  const kp = ((d.key_params as Record<string, unknown>) ?? d) as Partial<SnKeyParams>;
  if (!kp.version || !kp.pw_nonce) return null;
  return { identifier: email, pw_nonce: String(kp.pw_nonce), version: String(kp.version), origination: kp.origination, created: kp.created };
}

export interface SnAccountOpts {
  /** the server's address (empty: the official server) */
  server?: string;
  email: string;
  password: string;
  /** a two-step (authenticator) code, used only when the server asks for one */
  code?: string;
  /** the session from an earlier sign-in, if any */
  session?: SnSession;
  /** told when the session starts, is refreshed, or ends (undefined) */
  onSession?: (s: SnSession | undefined) => Promise<void> | void;
  fetch: FetchFn;
  argon2: Argon2;
}

type Content = Record<string, unknown> & { title?: string; text?: string; references?: { uuid: string; content_type?: string }[]; appData?: Record<string, Record<string, unknown>>; protected?: boolean; trashed?: boolean };

const ver = (it?: SnItem) => (it?.updated_at_timestamp ? String(it.updated_at_timestamp) : it?.updated_at);
const nonce = () => randomBytes(24).toString('hex');
const nowMicro = () => Date.now() * 1000;

/** Standard Notes through its sync server: two-way, end-to-end encrypted on this computer. */
export class StandardNotesApi implements ConnectorIO {
  readonly server: string;
  private session?: SnSession;
  /** items as the server holds them (encrypted) */
  private items = new Map<string, SnItem>();
  /** decrypted content of notes, tags and items keys */
  private plain = new Map<string, Content>();
  private itemsKeys = new Map<string, { key: string; isDefault: boolean; created: number }>();
  private syncToken?: string;
  private loaded = false;

  constructor(private o: SnAccountOpts) {
    this.server = snServerUrl(o.server);
    const s = o.session;
    this.session = s && s.server === this.server && s.email === o.email ? s : undefined;
  }

  private async post(path: string, body: Record<string, unknown>, token?: string): Promise<FetchResponse> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    const go = () => this.o.fetch(this.server + path, { method: 'POST', headers, body: JSON.stringify(body) });
    // once more after a dropped connection (a kept-alive connection the server closed while Argon2 ran, say)
    return go().catch(() => go()).catch(() => {
      throw new ConnectorError('unreachable', `The Standard Notes server (${new URL(this.server).host}) could not be reached.`);
    });
  }

  private fail(r: FetchResponse, j: Record<string, unknown>, what: string): never {
    const e = errorOf(j);
    if (r.status === 401 || r.status === 403) throw new ConnectorError('auth', e?.message ? `Standard Notes: ${e.message}` : `Standard Notes did not accept ${what}.`);
    if (r.status === 429) throw new ConnectorError('busy', 'Standard Notes says there were too many tries. Wait a few minutes and sync again.');
    throw new ConnectorError('unreachable', `Standard Notes answered ${r.status}${e?.message ? ` (${e.message.slice(0, 120)})` : ''}.`);
  }

  private async setSession(s: SnSession | undefined) {
    this.session = s;
    await this.o.onSession?.(s);
  }

  /** Signs in (once; the session is kept), asking for the two-step code if the server wants one. */
  async signIn(): Promise<SnSession> {
    if (this.session) return this.session;
    const { verifier, challenge } = snPkce();
    const base = { api: SN_API, email: this.o.email, code_challenge: challenge };
    let r = await this.post('/v2/login-params', base);
    let j = await readJson(r);
    let err = errorOf(j);
    let mfa: Record<string, string> = {};
    if (!r.ok && err?.tag === 'u2f-required') throw new ConnectorError('not-supported', 'This account signs in with a security key, which Keeper cannot use. Use a backup file instead.');
    if (!r.ok && (err?.tag === 'mfa-required' || err?.tag === 'mfa-invalid')) {
      if (!this.o.code) throw new ConnectorError('auth', 'Standard Notes asks for your two-step code. Type the current code from your authenticator app in this connection’s settings, then sync.');
      const key = err.payload?.mfa_key;
      mfa = { mfa_code: this.o.code, ...(key && /^mfa_[\w-]{1,80}$/.test(key) ? { [key]: this.o.code } : {}) };
      r = await this.post('/v2/login-params', { ...base, ...mfa });
      j = await readJson(r);
      err = errorOf(j);
      if (!r.ok && /^mfa-/.test(err?.tag ?? '')) throw new ConnectorError('auth', 'Standard Notes did not accept that two-step code. Type a fresh one and sync again.');
    }
    if (!r.ok) this.fail(r, j, 'that email');
    const kp = snKeyParamsFrom(j, this.o.email);
    if (!kp) throw new ConnectorError('bad-data', 'The server’s answer did not include the account’s key settings.');
    if (kp.version !== '004') throw new ConnectorError('not-supported', `This account uses an older encryption version (${kp.version}). Sign in once with Standard Notes’ own app to upgrade it, then try again.`);
    const root = await snRootKey(this.o.password, kp, this.o.argon2);
    r = await this.post('/v2/login', { api: SN_API, email: this.o.email, password: root.serverPassword, ephemeral: false, code_verifier: verifier, ...mfa });
    j = await readJson(r);
    if (!r.ok) {
      if (r.status === 401) throw new ConnectorError('auth', 'Standard Notes did not accept that email and password.');
      this.fail(r, j, 'the sign-in');
    }
    const s = sessionFrom(j);
    if (!s) throw new ConnectorError('bad-data', 'The server’s answer did not include a session.');
    await this.setSession({ server: this.server, email: this.o.email, ...s, keyParams: kp, masterKey: root.masterKey });
    return this.session!;
  }

  private async refresh(): Promise<boolean> {
    const s = this.session;
    if (!s) return false;
    const r = await this.post('/v1/sessions/refresh', { api: SN_API, access_token: s.accessToken, refresh_token: s.refreshToken });
    const ns = r.ok ? sessionFrom(await readJson(r)) : null;
    await this.setSession(ns ? { ...s, ...ns } : undefined);
    return !!ns;
  }

  /** A call with the session; refreshes it when it expired, signs in again when it was revoked. */
  private async authed(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    for (let attempt = 0; ; attempt++) {
      const s = await this.signIn();
      const r = await this.post(path, body, s.accessToken);
      if (r.ok) return readJson(r);
      const j = await readJson(r);
      if (attempt < 2 && r.status === 498) { await this.refresh(); continue; }
      if (attempt < 2 && r.status === 401) { await this.setSession(undefined); continue; }
      this.fail(r, j, 'the session');
    }
  }

  private async masterKey(): Promise<string> {
    const s = await this.signIn();
    if (s.masterKey) return s.masterKey;
    const { masterKey } = await snRootKey(this.o.password, s.keyParams, this.o.argon2);
    await this.setSession({ ...s, masterKey });
    return masterKey;
  }

  private open(it: SnItem, master: string) {
    if (it.deleted || typeof it.content !== 'string' || !it.enc_item_key) { this.plain.delete(it.uuid); return; }
    let key: string | undefined;
    if (it.content_type === 'SN|ItemsKey') key = master;
    else key = it.items_key_id ? this.itemsKeys.get(it.items_key_id)?.key : this.defaultKey()?.key;
    const ik = key ? snDecryptFor(it.enc_item_key, key, it.uuid) : null;
    const c = ik ? snDecryptFor(it.content, ik, it.uuid) : null;
    let parsed: Content | null = null;
    try { parsed = c ? (JSON.parse(c) as Content) : null; } catch { parsed = null; }
    if (!parsed) { this.plain.delete(it.uuid); return; }
    this.plain.set(it.uuid, parsed);
    if (it.content_type === 'SN|ItemsKey' && typeof parsed.itemsKey === 'string') {
      this.itemsKeys.set(it.uuid, { key: parsed.itemsKey, isDefault: !!parsed.isDefault, created: it.created_at_timestamp ?? (Date.parse(it.created_at ?? '') || 0) });
    }
  }

  private defaultKey(): { id: string; key: string } | undefined {
    const all = [...this.itemsKeys.entries()].sort((a, b) => Number(b[1].isDefault) - Number(a[1].isDefault) || b[1].created - a[1].created);
    return all[0] ? { id: all[0][0], key: all[0][1].key } : undefined;
  }

  /** Downloads every item (a page at a time) and opens it on this computer. */
  private async pullAll() {
    this.items.clear();
    this.plain.clear();
    this.itemsKeys.clear();
    let cursor: string | undefined;
    let pages = 0;
    do {
      const res = snSyncResponse(await this.authed('/v1/items', snSyncRequest([], undefined, cursor)));
      for (const it of res.retrieved) this.items.set(it.uuid, it);
      cursor = res.cursorToken;
      this.syncToken = res.syncToken ?? this.syncToken;
      if (++pages > 5000) throw new ConnectorError('bad-data', 'The server kept sending more pages.');
    } while (cursor);
    const master = await this.masterKey();
    // items keys first: everything else is sealed with one of them
    for (const it of this.items.values()) if (it.content_type === 'SN|ItemsKey') this.open(it, master);
    for (const it of this.items.values()) if (it.content_type !== 'SN|ItemsKey') this.open(it, master);
    this.loaded = true;
  }

  /** Seals one item for the server: a fresh item key, sealed with the default items key. */
  private seal(uuid: string, contentType: string, content: Content, base?: SnItem): SnItem {
    const ik = this.defaultKey();
    if (!ik) throw new ConnectorError('bad-data', 'This account has no items key yet. Open it once in Standard Notes’ own app, then sync again.');
    const itemKey = randomBytes(32).toString('hex');
    const ad = { u: uuid, v: '004' };
    const now = nowMicro();
    return {
      uuid,
      content_type: contentType,
      items_key_id: ik.id,
      enc_item_key: snEncrypt(itemKey, ik.key, nonce(), ad),
      content: snEncrypt(JSON.stringify(content), itemKey, nonce(), ad),
      created_at: base?.created_at ?? new Date(now / 1000).toISOString(),
      created_at_timestamp: base?.created_at_timestamp ?? now,
      updated_at: base?.updated_at,
      updated_at_timestamp: base?.updated_at_timestamp,
      deleted: false,
    };
  }

  /** Sends sealed items; returns the uuids the server refused because they changed there meanwhile. */
  private async push(items: SnItem[]): Promise<Set<string>> {
    const res = snSyncResponse(await this.authed('/v1/items', snSyncRequest(items, this.syncToken)));
    this.syncToken = res.syncToken ?? this.syncToken;
    const master = await this.masterKey();
    for (const it of res.retrieved) { this.items.set(it.uuid, it); this.open(it, master); }
    const sent = new Map(items.map((i) => [i.uuid, i]));
    for (const sv of res.saved) {
      const mine = sent.get(sv.uuid);
      if (!mine) continue;
      const meta = Object.fromEntries(Object.entries(sv).filter(([k, v]) => v !== undefined && v !== null && k !== 'content' && k !== 'enc_item_key'));
      this.items.set(sv.uuid, { ...mine, ...meta } as SnItem);
      this.open(this.items.get(sv.uuid)!, master);
    }
    const refused = new Set<string>();
    for (const c of res.conflicts) {
      const theirs = c.server_item;
      const id = theirs?.uuid ?? c.unsaved_item?.uuid;
      if (!id) continue;
      refused.add(id);
      if (theirs) { this.items.set(id, theirs); this.open(theirs, master); }
    }
    return refused;
  }

  /** Tag items to change so the note carries exactly these tags (tags are items that list their notes). */
  private tagChanges(note: string, tags: string[]): SnItem[] {
    const want = new Set(tags.map((t) => t.trim()).filter(Boolean));
    const done = new Set<string>();
    const out: SnItem[] = [];
    for (const [uuid, it] of this.items) {
      if (it.content_type !== 'Tag' || it.deleted) continue;
      const c = this.plain.get(uuid);
      if (!c) continue;
      const refs = c.references ?? [];
      const has = refs.some((r) => r.uuid === note);
      const title = c.title ?? '';
      if (want.has(title) && !done.has(title)) {
        done.add(title);
        if (!has) out.push(this.seal(uuid, 'Tag', { ...c, references: [...refs, { uuid: note, content_type: 'Note' }] }, it));
      } else if (!want.has(title) && has) out.push(this.seal(uuid, 'Tag', { ...c, references: refs.filter((r) => r.uuid !== note) }, it));
    }
    for (const t of want) if (!done.has(t)) out.push(this.seal(randomUUID(), 'Tag', { title: t, references: [{ uuid: note, content_type: 'Note' }], appData: {} }));
    return out;
  }

  private noteContent(n: Pick<RemoteNote, 'title' | 'body'>, prev?: Content): Content {
    const appData = { ...(prev?.appData ?? {}) };
    appData['org.standardnotes.sn'] = { ...(appData['org.standardnotes.sn'] ?? {}), client_updated_at: new Date().toISOString() };
    const c: Content = { references: [], ...prev, title: n.title, text: n.body, appData, preview_plain: n.body.replace(/\s+/g, ' ').trim().slice(0, 200) };
    delete c.preview_html;
    return c;
  }

  async test() {
    const { notes } = await this.list();
    return `Connected to ${new URL(this.server).host}: ${notes.filter((n) => !n.trashed).length} notes`;
  }

  async list() {
    await this.pullAll();
    const open: SnItem[] = [];
    const locked: RemoteNote[] = [];
    for (const it of this.items.values()) {
      if (it.deleted || (it.content_type !== 'Note' && it.content_type !== 'Tag')) continue;
      const c = this.plain.get(it.uuid);
      if (c) open.push({ ...it, content: c });
      else if (it.content_type === 'Note') locked.push({ sourceId: it.uuid, title: 'A note Keeper cannot open', body: '', tags: [], locked: true, version: ver(it) });
    }
    return { notes: [...snNotesFromItems(open), ...locked], complete: true };
  }

  private async ready() {
    if (!this.loaded) await this.pullAll();
  }

  async create(n: RemoteNote) {
    await this.ready();
    const uuid = randomUUID();
    const note = this.seal(uuid, 'Note', this.noteContent(n));
    await this.push([note, ...this.tagChanges(uuid, n.tags)]);
    return { sourceId: uuid, version: ver(this.items.get(uuid)) };
  }

  async update(n: RemoteNote) {
    await this.ready();
    const it = this.items.get(n.sourceId);
    const prev = this.plain.get(n.sourceId);
    if (!it || !prev || it.deleted) throw new ConnectorError('bad-data', 'This note is not in Standard Notes any more, or cannot be opened here.');
    if (prev.protected) throw new ConnectorError('not-supported', 'This note is protected in Standard Notes, so Keeper leaves it alone.');
    const refused = await this.push([this.seal(n.sourceId, 'Note', this.noteContent(n, prev), it), ...this.tagChanges(n.sourceId, n.tags)]);
    if (refused.has(n.sourceId)) throw new ConnectorError('busy', 'This note changed in Standard Notes while Keeper was sending it. Nothing was overwritten: sync again to merge the two.');
    return { version: ver(this.items.get(n.sourceId)) };
  }

  /** Moves the note to Standard Notes' trash (it can be restored there). */
  async remove(id: string) {
    await this.ready();
    const it = this.items.get(id);
    const prev = this.plain.get(id);
    if (!it || !prev || it.deleted) return;
    const refused = await this.push([this.seal(id, 'Note', { ...prev, trashed: true }, it)]);
    if (refused.has(id)) throw new ConnectorError('busy', 'This note changed in Standard Notes meanwhile, so it was not moved to the trash.');
  }

  /** Ends the session on the server (signing out). */
  async signOut() {
    const s = this.session;
    if (!s) return;
    await this.post('/v1/logout', { api: SN_API }, s.accessToken).catch(() => undefined);
    await this.setSession(undefined);
  }
}
