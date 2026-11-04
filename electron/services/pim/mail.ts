// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// IMAP and SMTP for one account. A connection opens only when there is work
// and closes after a minute of quiet; the inbox is watched with IMAP IDLE (the
// server says when mail arrives), so nothing polls.

import type { FetchMessageObject, ImapFlow } from 'imapflow';
import type { AddressObject, ParsedMail } from 'mailparser';

// The mail libraries are large (about 2 MB of code): they load the first time mail is used.
const imapFlow = async () => (await import('imapflow')).ImapFlow;
export const parseMail = async (source: Buffer | string, opts: import('mailparser').SimpleParserOptions = {}): Promise<ParsedMail> => (await import('mailparser')).simpleParser(source, opts);
const mailer = async () => (await import('nodemailer')).default;
const mailComposer = async () => (await import('nodemailer/lib/mail-composer')).default;
import { parseUnsubscribe, snippetOf } from '../../../core/pim/mail';
import { keepsKeywords, snoozeOfFlags } from '../../../core/pim/snooze-sync';
import { assertSecure, explainTls } from '../../../core/pim/security';
import type { Account, Address, Attachment, MailFolder, MessageBody, MessageSummary, ServerSettings, SpecialUse } from '../../../core/pim/types';
import { files, readJson, writeJson, type FolderCache } from './store';

export type Auth = { user: string; pass: string } | { user: string; accessToken: string };

const QUIET_MS = 60_000;
/** Messages kept in the list per folder after a check (older ones are fetched as you scroll). */
const KEEP = 2000;
/** At most this many are kept in a folder's list once you have scrolled back (the server's search finds the rest). */
const MAX_KEPT = 25_000;
/** Messages fetched on a folder's first visit. */
const FIRST = 300;

function imapOptions(s: ServerSettings, auth: Auth, insecure?: boolean) {
  assertSecure(s, 'Incoming mail');
  return {
    host: s.host,
    port: s.port,
    secure: s.security === 'tls',
    doSTARTTLS: s.security === 'starttls' ? true : s.security === 'none' ? false : undefined,
    auth: 'pass' in auth ? { user: auth.user, pass: auth.pass } : { user: auth.user, accessToken: auth.accessToken },
    logger: false as const,
    tls: insecure ? { rejectUnauthorized: false } : undefined,
    clientInfo: { name: 'Keeper', vendor: 'Ashforde' },
  };
}

const SPECIAL: Record<string, SpecialUse> = { '\\Inbox': 'inbox', '\\Sent': 'sent', '\\Drafts': 'drafts', '\\Trash': 'trash', '\\Junk': 'junk', '\\Archive': 'archive', '\\All': 'all', '\\Flagged': 'flagged' };

function addr(a?: { name?: string; address?: string }): Address | undefined {
  return a?.address ? { name: a.name || undefined, address: a.address } : undefined;
}

function addrs(list?: { name?: string; address?: string }[]): Address[] {
  return (list ?? []).map(addr).filter((x): x is Address => !!x);
}

function parsedAddrs(a?: AddressObject | AddressObject[]): Address[] {
  const all = Array.isArray(a) ? a : a ? [a] : [];
  return all.flatMap((x) => x.value).map((v) => ({ name: v.name || undefined, address: v.address ?? '' })).filter((v) => v.address);
}

function headerList(buf: Buffer | undefined, name: string): string | undefined {
  if (!buf) return undefined;
  const text = buf.toString('utf8').replace(/\r?\n[ \t]+/g, ' ');
  const m = text.match(new RegExp(`^${name}:\\s*(.*)$`, 'im'));
  return m?.[1].trim();
}

const LIST_HEADERS = ['references', 'list-id', 'list-unsubscribe', 'list-unsubscribe-post', 'precedence', 'auto-submitted'];

/** Mailing-list and bulk headers: for Important / Other and the subscriptions list. */
export function listInfo(buf: Buffer | undefined): Pick<MessageSummary, 'bulk' | 'listId' | 'unsub'> {
  const id = headerList(buf, 'list-id')?.match(/<([^>]+)>/)?.[1] ?? headerList(buf, 'list-id');
  const unsub = parseUnsubscribe(headerList(buf, 'list-unsubscribe'), headerList(buf, 'list-unsubscribe-post'));
  const prec = headerList(buf, 'precedence')?.toLowerCase();
  const auto = headerList(buf, 'auto-submitted')?.toLowerCase();
  const bulk = !!id || prec === 'bulk' || prec === 'list' || prec === 'junk' || (!!auto && auto !== 'no');
  return { ...(bulk ? { bulk } : {}), ...(id ? { listId: id } : {}), ...(unsub ? { unsub } : {}) };
}

function hasAttachments(structure: FetchMessageObject['bodyStructure']): boolean {
  if (!structure) return false;
  const walk = (n: NonNullable<FetchMessageObject['bodyStructure']>): boolean =>
    n.disposition === 'attachment' || (!!n.childNodes && n.childNodes.some(walk));
  return walk(structure);
}

/**
 * What Keeper asks of a mail account's store: an IMAP server (MailAccount), or
 * mail kept on this computer (LocalMailbox: imported mail, POP3 downloads).
 */
export interface MailBox {
  test(): Promise<void>;
  folders(): Promise<MailFolder[]>;
  cachedFolders(): Promise<MailFolder[]>;
  summaries(folder: string, uids: number[]): Promise<MessageSummary[]>;
  cached(folder: string): Promise<FolderCache>;
  sync(folder: string): Promise<{ messages: MessageSummary[]; added: MessageSummary[] }>;
  older(folder: string, count?: number): Promise<MessageSummary[]>;
  source(folder: string, uid: number): Promise<Buffer>;
  body(folder: string, uid: number): Promise<{ body: MessageBody; parsed: ParsedMail }>;
  setFlags(folder: string, uids: number[], flag: string, on: boolean): Promise<void>;
  move(folder: string, uids: number[], dest: string): Promise<Map<number, number> | undefined>;
  keepsKeywords(folder: string): Promise<boolean>;
  byMessageId(folder: string, messageId: string): Promise<number[]>;
  searchWith(folder: string, criteria: Record<string, unknown>, opts?: { skip?: Set<number>; limit?: number }): Promise<number[]>;
  newestText(folder: string): Promise<{ uid: number; text: string } | undefined>;
  ensureFolder(path: string): Promise<void>;
  remove(folder: string, uids: number[], trash?: string): Promise<unknown>;
  append(folder: string, raw: Buffer | string, flags?: string[]): Promise<number | undefined>;
  search(folder: string, text: string): Promise<number[]>;
  /** every message's number in a folder (export) */
  allUids(folder: string): Promise<number[]>;
  watch(folder: string, onNew: () => void): Promise<void>;
  stop(): Promise<void>;
}

export class MailAccount implements MailBox {
  private ops: ImapFlow | null = null;
  private opsTimer: NodeJS.Timeout | undefined;
  private opsQueue: Promise<unknown> = Promise.resolve();
  private idle: ImapFlow | null = null;
  private idleStop = false;
  private idleRetry: NodeJS.Timeout | undefined;

  constructor(public account: Account, private auth: () => Promise<Auth>) {}

  private async open(): Promise<ImapFlow> {
    if (this.ops?.usable) return this.ops;
    const c = new (await imapFlow())(imapOptions(this.account.imap!, await this.auth(), this.account.insecureTls));
    c.on('error', () => undefined);
    await c.connect().catch((e) => { throw explainTls(e, this.account.imap!.host); });
    this.ops = c;
    return c;
  }

  /** Runs IMAP work one job at a time on the shared connection, closing it when quiet. */
  private run<T>(fn: (c: ImapFlow) => Promise<T>): Promise<T> {
    const job = this.opsQueue.then(async () => {
      clearTimeout(this.opsTimer);
      try {
        return await fn(await this.open());
      } finally {
        this.opsTimer = setTimeout(() => void this.closeOps(), QUIET_MS);
      }
    });
    this.opsQueue = job.catch(() => undefined);
    return job;
  }

  private async closeOps() {
    const c = this.ops;
    this.ops = null;
    if (c) await c.logout().catch(() => c.close());
  }

  async test(): Promise<void> {
    const c = new (await imapFlow())(imapOptions(this.account.imap!, await this.auth(), this.account.insecureTls));
    c.on('error', () => undefined);
    await c.connect().catch((e) => { throw explainTls(e, this.account.imap!.host); });
    await c.logout().catch(() => c.close());
  }

  async folders(): Promise<MailFolder[]> {
    return this.run(async (c) => {
      const list = await c.list({ statusQuery: { messages: true, unseen: true } });
      const out: MailFolder[] = list
        .filter((f) => !f.flags?.has('\\Noselect'))
        .map((f) => ({
          account: this.account.id,
          path: f.path,
          name: f.path.toUpperCase() === 'INBOX' ? 'Inbox' : f.name,
          special: f.specialUse ? SPECIAL[f.specialUse] : f.path.toUpperCase() === 'INBOX' ? 'inbox' : undefined,
          unread: f.status?.unseen ?? 0,
          total: f.status?.messages ?? 0,
          delimiter: f.delimiter,
        }));
      // The folder this connection has open gets no STATUS answer in the list: ask for it on its own.
      for (const f of out) {
        const src = list.find((x) => x.path === f.path);
        if (src?.status) continue;
        const st = await c.status(f.path, { messages: true, unseen: true }).catch(() => null);
        if (st) Object.assign(f, { unread: st.unseen ?? f.unread, total: st.messages ?? f.total });
      }
      const order: (SpecialUse | undefined)[] = ['inbox', 'flagged', 'drafts', 'sent', 'archive', 'all', 'junk', 'trash'];
      out.sort((a, b) => (a.special ? order.indexOf(a.special) : 99) - (b.special ? order.indexOf(b.special) : 99) || a.path.localeCompare(b.path));
      await writeJson(files.folders(this.account.id), out);
      return out;
    });
  }

  async cachedFolders(): Promise<MailFolder[]> {
    return readJson<MailFolder[]>(files.folders(this.account.id), []);
  }

  private summary(folder: string, m: FetchMessageObject): MessageSummary {
    const env = m.envelope ?? {};
    const refs = headerList(m.headers, 'references');
    return {
      id: `${this.account.id}:${folder}:${m.uid}`,
      account: this.account.id,
      folder,
      uid: m.uid,
      messageId: env.messageId?.replace(/^<|>$/g, ''),
      inReplyTo: env.inReplyTo?.replace(/^<|>$/g, ''),
      references: refs ? refs.match(/<[^>]+>/g)?.map((r) => r.slice(1, -1)) : undefined,
      subject: env.subject ?? '(no subject)',
      from: addr(env.from?.[0]),
      to: addrs(env.to),
      cc: addrs(env.cc),
      date: env.date ? new Date(env.date).getTime() : m.internalDate ? new Date(m.internalDate).getTime() : 0,
      seen: !!m.flags?.has('\\Seen'),
      flagged: !!m.flags?.has('\\Flagged'),
      answered: !!m.flags?.has('\\Answered'),
      snippet: '',
      hasAttachments: hasAttachments(m.bodyStructure),
      size: m.size,
      labels: [...new Set([...(m.flags ?? []), ...((m as { labels?: Set<string> }).labels ?? [])])].filter((f) => !f.startsWith('\\') && !f.startsWith('$')),
      syncedSnooze: snoozeOfFlags(m.flags ?? []),
      ...listInfo(m.headers),
    };
  }

  /** What the list needs of each message; Gmail's labels too where the server has them. */
  private listQuery(c: ImapFlow) {
    return { uid: true, envelope: true, flags: true, bodyStructure: true, size: true, internalDate: true, headers: LIST_HEADERS, ...(c.capabilities?.has('X-GM-EXT-1') ? { labels: true } : {}) };
  }

  /** Summaries of particular messages (the server's search results that are not in the list). */
  async summaries(folder: string, uids: number[]): Promise<MessageSummary[]> {
    if (!uids.length) return [];
    return this.run(async (c) => {
      const lock = await c.getMailboxLock(folder, { readOnly: true });
      try {
        const out: MessageSummary[] = [];
        for await (const m of c.fetch(uids.join(','), this.listQuery(c), { uid: true })) out.push(this.summary(folder, m));
        return out;
      } finally {
        lock.release();
      }
    });
  }

  async cached(folder: string): Promise<FolderCache> {
    return readJson<FolderCache>(files.folder(this.account.id, folder), { messages: [] });
  }

  /**
   * Brings a folder's list up to date: new messages since last time, flags of
   * the recent ones, and messages removed on the server dropped.
   */
  async sync(folder: string): Promise<{ messages: MessageSummary[]; added: MessageSummary[] }> {
    const cache = await this.cached(folder);
    return this.run(async (c) => {
      const lock = await c.getMailboxLock(folder, { readOnly: true });
      try {
        const box = c.mailbox;
        if (!box) return { messages: cache.messages, added: [] };
        const validity = String(box.uidValidity);
        let list = cache.uidValidity === validity ? cache.messages : [];
        const known = new Map(list.map((m) => [m.uid, m]));
        const added: MessageSummary[] = [];
        const q = this.listQuery(c);
        if (box.exists) {
          const since = list.length ? Math.max(...list.map((m) => m.uid)) + 1 : 0;
          const range = since ? `${since}:*` : `${Math.max(1, box.exists - FIRST + 1)}:*`;
          for await (const m of c.fetch(range, q, { uid: !!since })) {
            if (known.has(m.uid)) continue;
            const s = this.summary(folder, m);
            known.set(m.uid, s);
            added.push(s);
          }
          // A preview line for the newest new messages, from the first few kilobytes only.
          const want = added.sort((a, b) => b.uid - a.uid).slice(0, 100).map((m) => m.uid);
          if (want.length) {
            for await (const m of c.fetch(want.join(','), { uid: true, source: { maxLength: 6000 } }, { uid: true })) {
              const s = known.get(m.uid);
              if (!s || !m.source) continue;
              try {
                const p = await parseMail(m.source, { skipHtmlToText: false, skipImageLinks: true, skipTextLinks: true });
                s.snippet = snippetOf(p.text ?? '');
              } catch {
                /* a preview is a nicety */
              }
            }
          }
          // Flags (read, flagged) of the newest messages, and which ones are gone.
          if (list.length) {
            const recent = [...known.keys()].sort((a, b) => b - a).slice(0, 500);
            const min = recent[recent.length - 1];
            const seen = new Set<number>();
            for await (const m of c.fetch(`${min}:*`, { uid: true, flags: true }, { uid: true })) {
              seen.add(m.uid);
              const s = known.get(m.uid);
              if (s) Object.assign(s, { seen: !!m.flags?.has('\\Seen'), flagged: !!m.flags?.has('\\Flagged'), answered: !!m.flags?.has('\\Answered'), syncedSnooze: snoozeOfFlags(m.flags ?? []) });
            }
            for (const u of recent) if (!seen.has(u)) known.delete(u);
          }
        } else known.clear();
        // The folder's own numbers, kept up to date with every check (not only when folders are listed).
        if (box.exists !== undefined) {
          const unseen = await c.search({ seen: false }, { uid: true }).catch(() => null);
          const all = await readJson<MailFolder[]>(files.folders(this.account.id), []);
          const f = all.find((x) => x.path === folder);
          if (f && Array.isArray(unseen) && (f.total !== box.exists || f.unread !== unseen.length)) {
            Object.assign(f, { total: box.exists, unread: unseen.length });
            await writeJson(files.folders(this.account.id), all);
          }
        }
        // What scrolling back already brought in stays (it is not dropped at the next check).
        list = [...known.values()].sort((a, b) => b.date - a.date).slice(0, Math.min(MAX_KEPT, Math.max(KEEP, cache.messages.length)));
        await writeJson(files.folder(this.account.id, folder), { uidValidity: validity, uidNext: box.uidNext, messages: list } satisfies FolderCache);
        return { messages: list, added };
      } finally {
        lock.release();
      }
    });
  }

  /**
   * Older messages than the oldest in the list (scrolling down): the next
   * `count` by number, stepping further back over gaps left by deleted mail.
   */
  async older(folder: string, count = 300): Promise<MessageSummary[]> {
    const cache = await this.cached(folder);
    let oldest = cache.messages.reduce((m, x) => Math.min(m, x.uid), Infinity);
    if (!Number.isFinite(oldest) || oldest <= 1 || cache.messages.length >= MAX_KEPT) return cache.messages;
    return this.run(async (c) => {
      const lock = await c.getMailboxLock(folder, { readOnly: true });
      try {
        const got: MessageSummary[] = [];
        for (let tries = 0; got.length < count && oldest > 1 && tries < 8; tries++) {
          const from = Math.max(1, oldest - count * (tries + 1));
          for await (const m of c.fetch(`${from}:${oldest - 1}`, this.listQuery(c), { uid: true })) got.push(this.summary(folder, m));
          oldest = from;
        }
        const have = new Set(cache.messages.map((m) => m.uid));
        const all = [...cache.messages, ...got.filter((m) => !have.has(m.uid))].sort((a, b) => b.date - a.date).slice(0, MAX_KEPT);
        await writeJson(files.folder(this.account.id, folder), { ...cache, messages: all });
        return all;
      } finally {
        lock.release();
      }
    });
  }

  /** The whole message from the server, parsed. */
  async source(folder: string, uid: number): Promise<Buffer> {
    return this.run(async (c) => {
      const lock = await c.getMailboxLock(folder, { readOnly: true });
      try {
        const m = await c.fetchOne(String(uid), { source: true }, { uid: true });
        if (!m || !m.source) throw new Error('The message is no longer on the server');
        return m.source;
      } finally {
        lock.release();
      }
    });
  }

  async body(folder: string, uid: number): Promise<{ body: MessageBody; parsed: ParsedMail }> {
    const id = `${this.account.id}:${folder}:${uid}`;
    const parsed = await parseMail(await this.source(folder, uid));
    return { body: toBody(id, parsed), parsed };
  }

  async setFlags(folder: string, uids: number[], flag: string, on: boolean) {
    if (!uids.length) return;
    await this.run(async (c) => {
      const lock = await c.getMailboxLock(folder);
      try {
        // A label on Gmail is a real label (X-GM-LABELS), elsewhere a keyword.
        const useLabels = !flag.startsWith('\\') && !flag.startsWith('$') && !!c.capabilities?.has('X-GM-EXT-1');
        if (on) await c.messageFlagsAdd(uids, [flag], { uid: true, useLabels });
        else await c.messageFlagsRemove(uids, [flag], { uid: true, useLabels });
      } finally {
        lock.release();
      }
    });
  }

  /** Moves messages; the answer maps old uids to their new ones where the server says (UIDPLUS), for Undo. */
  async move(folder: string, uids: number[], dest: string): Promise<Map<number, number> | undefined> {
    if (!uids.length) return undefined;
    return this.run(async (c) => {
      const lock = await c.getMailboxLock(folder);
      try {
        const r = await c.messageMove(uids, dest, { uid: true });
        return r && typeof r === 'object' ? (r as { uidMap?: Map<number, number> }).uidMap : undefined;
      } finally {
        lock.release();
      }
    });
  }

  /** Does this folder keep keywords of Keeper's own (snooze times)? */
  async keepsKeywords(folder: string): Promise<boolean> {
    return this.run(async (c) => {
      // Read-write (SELECT): a read-only EXAMINE always reports no permanent flags.
      const lock = await c.getMailboxLock(folder);
      try {
        return keepsKeywords(c.mailbox ? c.mailbox.permanentFlags : undefined);
      } finally {
        lock.release();
      }
    });
  }

  /** uids in a folder with this Message-ID (to find a moved message, or the previous copy of a draft). */
  async byMessageId(folder: string, messageId: string): Promise<number[]> {
    return this.run(async (c) => {
      const lock = await c.getMailboxLock(folder, { readOnly: true });
      try {
        const r = await c.search({ header: { 'message-id': `<${messageId.replace(/^<|>$/g, '')}>` } }, { uid: true });
        return Array.isArray(r) ? r : [];
      } finally {
        lock.release();
      }
    });
  }

  /** Search with full criteria (imapflow's form), newest first; `skip` leaves out messages already kept here. */
  async searchWith(folder: string, criteria: Record<string, unknown>, opts: { skip?: Set<number>; limit?: number } = {}): Promise<number[]> {
    return this.run(async (c) => {
      const lock = await c.getMailboxLock(folder, { readOnly: true });
      try {
        const r = await c.search(criteria as never, { uid: true });
        return Array.isArray(r) ? r.filter((u) => !opts.skip?.has(u)).sort((a, b) => b - a).slice(0, opts.limit ?? 100) : [];
      } finally {
        lock.release();
      }
    });
  }

  /** The full text of the newest message in a folder (the snooze note), or undefined. */
  async newestText(folder: string): Promise<{ uid: number; text: string } | undefined> {
    return this.run(async (c) => {
      const lock = await c.getMailboxLock(folder, { readOnly: true }).catch(() => null);
      if (!lock) return undefined;
      try {
        if (!c.mailbox || !c.mailbox.exists) return undefined;
        const m = await c.fetchOne('*', { uid: true, source: true });
        if (!m || !m.source) return undefined;
        const p = await parseMail(m.source);
        return { uid: m.uid, text: p.text ?? '' };
      } finally {
        lock.release();
      }
    });
  }

  /** Makes a folder if it is not there (the hidden snooze folder). */
  async ensureFolder(path: string) {
    await this.run(async (c) => {
      const list = await c.list();
      if (!list.some((f) => f.path === path)) await c.mailboxCreate(path);
    });
  }

  /** To the Trash folder, or removed for good when it is already there (or there is none). */
  async remove(folder: string, uids: number[], trash?: string) {
    if (trash && folder !== trash) return this.move(folder, uids, trash);
    await this.run(async (c) => {
      const lock = await c.getMailboxLock(folder);
      try {
        await c.messageDelete(uids, { uid: true });
      } finally {
        lock.release();
      }
    });
  }

  async append(folder: string, raw: Buffer | string, flags: string[] = ['\\Seen']): Promise<number | undefined> {
    return this.run(async (c) => {
      const r = await c.append(folder, raw, flags);
      return r && typeof r === 'object' ? (r as { uid?: number }).uid : undefined;
    });
  }

  /** The server's own search (for older mail not in Keeper's list). */
  async search(folder: string, text: string): Promise<number[]> {
    return this.run(async (c) => {
      const lock = await c.getMailboxLock(folder, { readOnly: true });
      try {
        const r = await c.search({ or: [{ subject: text }, { from: text }, { body: text }] }, { uid: true });
        // The newest first, and not too many.
        return Array.isArray(r) ? r.sort((a, b) => b - a).slice(0, 100) : [];
      } finally {
        lock.release();
      }
    });
  }

  async allUids(folder: string): Promise<number[]> {
    return this.run(async (c) => {
      const lock = await c.getMailboxLock(folder, { readOnly: true });
      try {
        const r = await c.search({ all: true }, { uid: true });
        return Array.isArray(r) ? r : [];
      } finally {
        lock.release();
      }
    });
  }

  /** Watches the inbox and calls `onNew` when the server says something arrived. */
  async watch(folder: string, onNew: () => void) {
    this.idleStop = false;
    clearTimeout(this.idleRetry);
    try {
      // This connection only waits, so it goes into IDLE almost at once.
      const c = new (await imapFlow())({ ...imapOptions(this.account.imap!, await this.auth(), this.account.insecureTls), disableAutoIdle: false, autoIdleDelay: 500 });
      c.on('error', () => undefined);
      c.on('exists', () => onNew());
      c.on('close', () => {
        if (this.idle === c) this.idle = null;
        // Reconnect after a pause unless watching was stopped.
        if (!this.idleStop) this.idleRetry = setTimeout(() => void this.watch(folder, onNew), 60_000);
      });
      await c.connect();
      await c.mailboxOpen(folder, { readOnly: true });
      this.idle = c;
    } catch {
      if (!this.idleStop) this.idleRetry = setTimeout(() => void this.watch(folder, onNew), 5 * 60_000);
    }
  }

  async stop() {
    this.idleStop = true;
    clearTimeout(this.idleRetry);
    clearTimeout(this.opsTimer);
    const i = this.idle;
    this.idle = null;
    if (i) await i.logout().catch(() => i.close());
    await this.closeOps();
  }
}

export function toBody(id: string, parsed: ParsedMail): MessageBody {
  const atts: Attachment[] = parsed.attachments.map((a, i) => ({
    id: String(i),
    filename: a.filename || (a.contentType === 'text/calendar' ? 'invite.ics' : `attachment-${i + 1}`),
    contentType: a.contentType,
    size: a.size,
    cid: a.contentId?.replace(/^<|>$/g, ''),
    inline: a.related || a.contentDisposition === 'inline',
  }));
  const headers: Record<string, string> = {};
  for (const h of parsed.headerLines) headers[h.key] = h.line.slice(h.line.indexOf(':') + 1).trim();
  const cal = parsed.attachments.find((a) => a.contentType === 'text/calendar' || /\.ics$/i.test(a.filename ?? ''));
  return {
    id,
    html: typeof parsed.html === 'string' ? parsed.html : undefined,
    text: parsed.text ?? undefined,
    attachments: atts,
    headers,
    invite: cal ? cal.content.toString('utf8') : undefined,
    listUnsubscribe: parseUnsubscribe(headers['list-unsubscribe'], headers['list-unsubscribe-post']),
  };
}

/** Inline images as data: URLs for the sanitizer (only small ones). */
export function cidMap(parsed: ParsedMail): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of parsed.attachments) {
    if (!a.contentId || a.size > 4_000_000 || !/^image\//.test(a.contentType)) continue;
    out[a.contentId.replace(/^<|>$/g, '')] = `data:${a.contentType};base64,${a.content.toString('base64')}`;
  }
  return out;
}

export function summaryFromParsed(p: ParsedMail): Partial<MessageSummary> {
  return { snippet: snippetOf(p.text ?? ''), from: parsedAddrs(p.from)[0], to: parsedAddrs(p.to) };
}

// ---------------------------------------------------------------- sending

export interface Outgoing {
  from: Address;
  to: Address[];
  cc: Address[];
  bcc: Address[];
  subject: string;
  text: string;
  html?: string;
  inReplyTo?: string;
  references?: string[];
  attachments?: { filename: string; path?: string; content?: Buffer | string; contentType?: string; method?: string }[];
  /** a calendar answer or invitation sent along */
  icalEvent?: { method: string; content: string };
  /** an alias's own Reply-To */
  replyTo?: Address[];
  /** keep this Message-ID (a draft saved again replaces its previous copy) */
  messageId?: string;
  /** keep Bcc in the message (a saved draft, so it is still there when reopened) */
  keepBcc?: boolean;
}

/** The finished message (what is sent and what is saved to Sent). */
export async function compose(o: Outgoing): Promise<{ raw: Buffer; envelope: { from: string; to: string[] }; messageId: string }> {
  const fmt = (a: Address) => (a.name ? { name: a.name, address: a.address } : a.address);
  const mail = new (await mailComposer())({
    from: fmt(o.from), to: o.to.map(fmt), cc: o.cc.map(fmt), bcc: o.bcc.map(fmt), subject: o.subject,
    text: o.text, html: o.html, inReplyTo: o.inReplyTo ? `<${o.inReplyTo}>` : undefined,
    references: o.references?.map((r) => `<${r}>`), attachments: o.attachments, icalEvent: o.icalEvent,
    replyTo: o.replyTo?.length ? o.replyTo.map(fmt) : undefined,
    messageId: o.messageId ? `<${o.messageId.replace(/^<|>$/g, '')}>` : undefined,
    headers: { 'X-Mailer': 'Keeper by Ashforde' },
  });
  const node = mail.compile();
  node.keepBcc = !!o.keepBcc;
  const raw = await node.build();
  const env = node.getEnvelope();
  return { raw, envelope: { from: env.from || o.from.address, to: env.to }, messageId: node.messageId().replace(/^<|>$/g, '') };
}

export async function smtpSend(account: Account, auth: Auth, raw: Buffer | string, envelope: { from: string; to: string[] }) {
  const s = account.smtp!;
  assertSecure(s, 'Sending');
  const t = (await mailer()).createTransport({
    host: s.host, port: s.port, secure: s.security === 'tls', requireTLS: s.security === 'starttls', ignoreTLS: s.security === 'none',
    auth: 'pass' in auth ? { user: auth.user, pass: auth.pass } : { type: 'OAuth2', user: auth.user, accessToken: auth.accessToken },
    tls: account.insecureTls ? { rejectUnauthorized: false } : undefined,
    connectionTimeout: 20_000,
  });
  try {
    await t.sendMail({ envelope, raw }).catch((e) => { throw explainTls(e, s.host); });
  } finally {
    t.close();
  }
}

export async function smtpVerify(account: Account, auth: Auth) {
  const s = account.smtp!;
  assertSecure(s, 'Sending');
  const t = (await mailer()).createTransport({
    host: s.host, port: s.port, secure: s.security === 'tls', requireTLS: s.security === 'starttls', ignoreTLS: s.security === 'none',
    auth: 'pass' in auth ? { user: auth.user, pass: auth.pass } : { type: 'OAuth2', user: auth.user, accessToken: auth.accessToken },
    tls: account.insecureTls ? { rejectUnauthorized: false } : undefined, connectionTimeout: 15_000,
  });
  try {
    await t.verify().catch((e) => { throw explainTls(e, s.host); });
  } finally {
    t.close();
  }
}
