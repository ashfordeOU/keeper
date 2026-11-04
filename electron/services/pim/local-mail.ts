// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Mail kept on this computer: the "On this computer" account that imported
// mail lands in, and the store a POP3 account downloads into. Each message is
// an .eml file; each folder's list is the same small JSON file the IMAP
// accounts use (store.ts), so search, conversations, labels and the rest work
// the same. Nothing here connects anywhere.

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import type { ParsedMail } from 'mailparser';
import { snippetOf } from '../../../core/pim/mail';
import { FOLDER_NAMES, messageIdOf, specialOf } from '../../../core/pim/mail-import';
import type { Account, MailFolder, MessageBody, MessageSummary, SpecialUse } from '../../../core/pim/types';
import { listInfo, parseMail, toBody, type MailBox } from './mail';
import { files, hash, pimDir, readJson, writeJson, type FolderCache } from './store';

/** The special folders every local store starts with. */
const STARTERS: SpecialUse[] = ['inbox', 'sent', 'drafts', 'archive', 'junk', 'trash'];

interface LocalFolders {
  folders: { path: string; special?: SpecialUse }[];
}

type Addr = { name?: string; address: string };
const addr = (a?: { name?: string; address?: string }): Addr | undefined => (a?.address ? { name: a.name || undefined, address: a.address } : undefined);
function addrs(x: ParsedMail['to']): { name?: string; address: string }[] {
  const all = Array.isArray(x) ? x : x ? [x] : [];
  return all.flatMap((g) => g.value).map(addr).filter((v): v is Addr => !!v);
}

/** What the list needs of a message, read from the message itself. */
export async function summaryOf(account: string, folder: string, uid: number, raw: Buffer, flags: string[]): Promise<MessageSummary> {
  const p = await parseMail(raw, { skipHtmlToText: false, skipImageLinks: true, skipTextLinks: true, skipTextToHtml: true });
  const head = raw.subarray(0, Math.min(raw.length, 64_000));
  const refs = (p.references ? (Array.isArray(p.references) ? p.references : [p.references]) : []).map((r) => r.replace(/^<|>$/g, ''));
  const date = p.date?.getTime();
  return {
    id: `${account}:${folder}:${uid}`, account, folder, uid,
    messageId: p.messageId?.replace(/^<|>$/g, '') ?? messageIdOf(raw),
    inReplyTo: typeof p.inReplyTo === 'string' ? p.inReplyTo.replace(/^<|>$/g, '') : undefined,
    references: refs.length ? refs : undefined,
    subject: p.subject || '(no subject)',
    from: addr(Array.isArray(p.from) ? p.from[0]?.value[0] : p.from?.value[0]),
    to: addrs(p.to), cc: addrs(p.cc),
    date: date && Number.isFinite(date) ? date : 0,
    seen: flags.includes('\\Seen'), flagged: flags.includes('\\Flagged'), answered: flags.includes('\\Answered'),
    snippet: snippetOf(p.text ?? ''),
    hasAttachments: p.attachments.some((a) => !a.related && a.contentDisposition !== 'inline'),
    size: raw.length,
    labels: flags.filter((f) => !f.startsWith('\\') && !f.startsWith('$')),
    ...listInfo(head),
  };
}

export class LocalMailbox implements MailBox {
  private caches = new Map<string, FolderCache>();
  private dirty = new Set<string>();
  private flushTimer: NodeJS.Timeout | undefined;

  constructor(public account: Account) {}

  private get root() {
    return path.join(pimDir(), 'local-mail', hash(this.account.id));
  }
  private file(folder: string, uid: number) {
    return path.join(this.root, hash(folder), `${uid}.eml`);
  }
  private async layout(): Promise<LocalFolders> {
    const l = await readJson<LocalFolders>(path.join(this.root, 'folders.json'), { folders: [] });
    if (!l.folders.length) l.folders = STARTERS.map((s) => ({ path: s === 'inbox' ? 'INBOX' : FOLDER_NAMES[s], special: s }));
    return l;
  }
  private async saveLayout(l: LocalFolders) {
    await writeJson(path.join(this.root, 'folders.json'), l);
  }

  async test() { /* nothing to connect to */ }

  async cached(folder: string): Promise<FolderCache> {
    let c = this.caches.get(folder);
    if (!c) {
      c = await readJson<FolderCache>(files.folder(this.account.id, folder), { messages: [], uidNext: 1 });
      this.caches.set(folder, c);
    }
    return c;
  }

  /** Writes changed lists soon (many changes in a row are written once). */
  private touch(folder: string) {
    this.dirty.add(folder);
    clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => void this.flush(), 250);
  }

  async flush() {
    clearTimeout(this.flushTimer);
    const list = [...this.dirty];
    this.dirty.clear();
    for (const f of list) {
      const c = this.caches.get(f);
      if (c) {
        c.messages.sort((a, b) => b.date - a.date);
        await writeJson(files.folder(this.account.id, f), c);
      }
    }
    if (list.length) await this.folders();
  }

  async folders(): Promise<MailFolder[]> {
    const l = await this.layout();
    const out: MailFolder[] = [];
    for (const f of l.folders) {
      const c = await this.cached(f.path);
      out.push({ account: this.account.id, path: f.path, name: f.path === 'INBOX' ? 'Inbox' : f.path.split('/').pop()!, special: f.special, unread: c.messages.filter((m) => !m.seen).length, total: c.messages.length, delimiter: '/' });
    }
    const order: (SpecialUse | undefined)[] = ['inbox', 'flagged', 'drafts', 'sent', 'archive', 'all', 'junk', 'trash'];
    out.sort((a, b) => (a.special ? order.indexOf(a.special) : 99) - (b.special ? order.indexOf(b.special) : 99) || a.path.localeCompare(b.path));
    await writeJson(files.folders(this.account.id), out);
    return out;
  }

  async cachedFolders(): Promise<MailFolder[]> {
    const got = await readJson<MailFolder[]>(files.folders(this.account.id), []);
    return got.length ? got : this.folders();
  }

  /** Makes a folder (and its parents) if it is not there; a special one takes Keeper's own name. */
  async ensureFolder(p: string, special?: SpecialUse): Promise<void> {
    const l = await this.layout();
    const parts = p.split('/');
    let changed = false;
    for (let i = 1; i <= parts.length; i++) {
      const sub = parts.slice(0, i).join('/');
      if (l.folders.some((f) => f.path === sub)) continue;
      l.folders.push({ path: sub, special: i === parts.length ? special ?? (i === 1 ? specialOf(sub) : undefined) : undefined });
      changed = true;
    }
    if (changed) await this.saveLayout(l);
  }

  /** The folder path holding a kind of special folder. */
  async specialPath(s: SpecialUse): Promise<string> {
    const l = await this.layout();
    return l.folders.find((f) => f.special === s)?.path ?? (s === 'inbox' ? 'INBOX' : FOLDER_NAMES[s]);
  }

  /** Removes a folder that is empty (an import taken back). */
  async dropFolderIfEmpty(p: string) {
    const c = await this.cached(p);
    const l = await this.layout();
    const f = l.folders.find((x) => x.path === p);
    if (!f || f.special || c.messages.length || l.folders.some((x) => x.path.startsWith(`${p}/`))) return;
    l.folders = l.folders.filter((x) => x.path !== p);
    await this.saveLayout(l);
    this.caches.delete(p);
    await fsp.rm(files.folder(this.account.id, p), { force: true });
    await fsp.rm(path.join(this.root, hash(p)), { recursive: true, force: true });
  }

  async summaries(folder: string, uids: number[]): Promise<MessageSummary[]> {
    const set = new Set(uids);
    return (await this.cached(folder)).messages.filter((m) => set.has(m.uid));
  }

  async sync(folder: string): Promise<{ messages: MessageSummary[]; added: MessageSummary[] }> {
    return { messages: [...(await this.cached(folder)).messages], added: [] };
  }

  async older(folder: string): Promise<MessageSummary[]> {
    return [...(await this.cached(folder)).messages];
  }

  async source(folder: string, uid: number): Promise<Buffer> {
    try {
      return await fsp.readFile(this.file(folder, uid));
    } catch {
      throw new Error('This message is no longer on this computer');
    }
  }

  async body(folder: string, uid: number): Promise<{ body: MessageBody; parsed: ParsedMail }> {
    const parsed = await parseMail(await this.source(folder, uid));
    return { body: toBody(`${this.account.id}:${folder}:${uid}`, parsed), parsed };
  }

  async setFlags(folder: string, uids: number[], flag: string, on: boolean) {
    const c = await this.cached(folder);
    const set = new Set(uids);
    for (const m of c.messages) {
      if (!set.has(m.uid)) continue;
      if (flag === '\\Seen') m.seen = on;
      else if (flag === '\\Flagged') m.flagged = on;
      else if (flag === '\\Answered') m.answered = on;
      else if (!flag.startsWith('\\') && !flag.startsWith('$')) m.labels = on ? [...new Set([...(m.labels ?? []), flag])] : (m.labels ?? []).filter((x) => x !== flag);
    }
    this.touch(folder);
  }

  /**
   * Adds a message; the answer is its number in the folder. `flush` false
   * leaves writing the list to the caller (an import writes once per batch).
   */
  async append(folder: string, raw: Buffer | string, flags: string[] = ['\\Seen'], opts: { summary?: Partial<MessageSummary> } = {}): Promise<number | undefined> {
    const buf = typeof raw === 'string' ? Buffer.from(raw, 'utf8') : raw;
    await this.ensureFolder(folder);
    const c = await this.cached(folder);
    const uid = c.uidNext && c.uidNext > 0 ? c.uidNext : (c.messages.reduce((m, x) => Math.max(m, x.uid), 0) + 1);
    c.uidNext = uid + 1;
    const file = this.file(folder, uid);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, buf);
    const s = await summaryOf(this.account.id, folder, uid, buf, flags);
    c.messages.push({ ...s, ...opts.summary });
    this.touch(folder);
    return uid;
  }

  async move(folder: string, uids: number[], dest: string): Promise<Map<number, number>> {
    const map = new Map<number, number>();
    if (folder === dest) return map;
    await this.ensureFolder(dest);
    const from = await this.cached(folder);
    const to = await this.cached(dest);
    const set = new Set(uids);
    for (const m of from.messages.filter((x) => set.has(x.uid))) {
      const uid = to.uidNext && to.uidNext > 0 ? to.uidNext : to.messages.reduce((a, x) => Math.max(a, x.uid), 0) + 1;
      to.uidNext = uid + 1;
      await fsp.mkdir(path.dirname(this.file(dest, uid)), { recursive: true });
      await fsp.rename(this.file(folder, m.uid), this.file(dest, uid)).catch(async () => {
        await fsp.copyFile(this.file(folder, m.uid), this.file(dest, uid));
        await fsp.rm(this.file(folder, m.uid), { force: true });
      });
      to.messages.push({ ...m, uid, folder: dest, id: `${this.account.id}:${dest}:${uid}` });
      map.set(m.uid, uid);
    }
    from.messages = from.messages.filter((x) => !set.has(x.uid));
    this.touch(folder);
    this.touch(dest);
    return map;
  }

  async remove(folder: string, uids: number[], trash?: string) {
    if (trash && folder !== trash) return this.move(folder, uids, trash);
    const c = await this.cached(folder);
    const set = new Set(uids);
    for (const u of uids) await fsp.rm(this.file(folder, u), { force: true });
    c.messages = c.messages.filter((m) => !set.has(m.uid));
    this.touch(folder);
    return undefined;
  }

  async keepsKeywords(): Promise<boolean> { return true; }

  async byMessageId(folder: string, messageId: string): Promise<number[]> {
    const id = messageId.replace(/^<|>$/g, '');
    return (await this.cached(folder)).messages.filter((m) => m.messageId === id).map((m) => m.uid);
  }

  /** Every message is already in the list, so the list's own search covers it. */
  async searchWith(): Promise<number[]> { return []; }
  async search(): Promise<number[]> { return []; }
  async allUids(folder: string): Promise<number[]> { return (await this.cached(folder)).messages.map((m) => m.uid); }

  async newestText(folder: string): Promise<{ uid: number; text: string } | undefined> {
    const c = await this.cached(folder);
    const m = c.messages.reduce<MessageSummary | undefined>((a, x) => (!a || x.uid > a.uid ? x : a), undefined);
    if (!m) return undefined;
    const p = await parseMail(await this.source(folder, m.uid));
    return { uid: m.uid, text: p.text ?? '' };
  }

  async watch() { /* nothing arrives by itself */ }
  async stop() { await this.flush(); }
}
