// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Standard Notes: reads decrypted backups, and opens encrypted (protocol 004)
// backups on this computer — Argon2id turns your password into the root key,
// XChaCha20-Poly1305 opens the items keys and then each note. The password and
// keys never leave this computer. Also writes a decrypted backup to import back.
//
// Signing in to a sync server (including a self-hosted one) is not built yet;
// the request and answer shapes are here so it can be added without guessing.

import { createHash, randomUUID } from 'node:crypto';
import { bytesToHex, hexToBytes, xchachaOpen, xchachaSeal } from '../crypto';
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

/** Seals text the way protocol 004 does (for tests and future write-back). */
export function snEncrypt(plain: string, keyHex: string, nonceHex: string, auth: Record<string, unknown>): string {
  const ad = Buffer.from(JSON.stringify(auth)).toString('base64');
  const ct = xchachaSeal(hexToBytes(keyHex), hexToBytes(nonceHex), utf8(plain), utf8(ad));
  return `004:${nonceHex}:${Buffer.from(ct).toString('base64')}:${ad}`;
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
    const ik = snDecrypt(it.enc_item_key, masterKey);
    const c = ik ? snDecrypt(it.content, ik) : null;
    if (!c) { skipped++; continue; }
    try { itemsKeys.set(it.uuid, (JSON.parse(c) as { itemsKey: string }).itemsKey); } catch { skipped++; }
  }
  const out: SnItem[] = [];
  for (const it of items) {
    if (typeof it.content !== 'string' || !it.content.startsWith('004:')) { out.push(it); continue; }
    if (it.content_type === 'SN|ItemsKey') continue;
    const key = it.items_key_id ? itemsKeys.get(it.items_key_id) : [...itemsKeys.values()][0];
    const ik = key && it.enc_item_key ? snDecrypt(it.enc_item_key, key) : null;
    const c = ik ? snDecrypt(it.content, ik) : null;
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

// ---------------------------------------------------------------- the sync server (shapes only)

/** The body of a sync request (POST <server>/v1/items/sync with a session token). */
export function snSyncRequest(items: SnItem[], syncToken?: string, cursorToken?: string) {
  return { api: '20200115', items, sync_token: syncToken, cursor_token: cursorToken, limit: 150 };
}

export function snSyncResponse(j: unknown): { retrieved: SnItem[]; saved: SnItem[]; conflicts: unknown[]; syncToken?: string; cursorToken?: string } {
  const o = (j ?? {}) as { data?: unknown } & Record<string, unknown>;
  const d = (o.data ?? o) as Record<string, unknown>;
  return {
    retrieved: (d.retrieved_items as SnItem[]) ?? [],
    saved: (d.saved_items as SnItem[]) ?? [],
    conflicts: (d.conflicts as unknown[]) ?? [],
    syncToken: d.sync_token as string | undefined,
    cursorToken: d.cursor_token as string | undefined,
  };
}

export const SN_SERVER_STATUS = 'Signing in to the sync server is not built yet. Use a backup file: Preferences → Backups → Download backup.';
