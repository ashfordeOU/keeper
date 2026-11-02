// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Mail for coding assistants and other MCP apps, with hard limits: only
// accounts the person opted in, only searching, reading and writing drafts
// (never sending, deleting or moving), and never Spam, Trash, or security
// mail (sign-in codes, password resets, sign-in alerts). Secrets and codes
// are blanked in what is returned. The limits live here, apart from the
// mail code, so they can be tested on their own.

import { redact } from '../brain/redact';
import { hasSignInCode, isSecurityAlert, redactCodes } from './triage';
import type { Account, Address, MailFolder, MessageSummary } from './types';

export interface MailMcpBackend {
  accounts(): Promise<Account[]>;
  folders(): Promise<MailFolder[]>;
  /** cached messages matching the words, every account and folder */
  search(query: string, limit: number): Promise<MessageSummary[]>;
  /** one message with its plain text */
  read(id: string): Promise<{ summary: MessageSummary; text?: string }>;
  /** the conversation a message belongs to */
  thread(id: string): Promise<MessageSummary[]>;
  /** saves a draft in the account's Drafts folder (never sends) */
  saveDraft(d: { account: string; to: Address[]; cc: Address[]; bcc: Address[]; subject: string; body: string; inReplyTo?: string; references?: string[] }): Promise<void>;
}

export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; openWorldHint: boolean; title: string };
}

export const MAIL_TOOLS: McpToolDef[] = [
  {
    name: 'mail_search',
    description: 'Search the person\'s mail in Keeper (only accounts they shared with coding assistants). Words in any order; from:, to:, subject:, is:unread, has:attachment work. Spam, Trash and security mail (sign-in codes, password resets) are never included.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number', description: 'at most 50 (default 20)' } }, required: ['query'] },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, title: 'Search mail' },
  },
  {
    name: 'mail_read',
    description: 'Read one message (by the id from mail_search): sender, recipients, date, subject and plain text. Secrets and codes are blanked.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, title: 'Read a message' },
  },
  {
    name: 'mail_thread',
    description: 'List the messages of the conversation a message belongs to (ids, senders, dates, subjects, previews).',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, title: 'Read a conversation' },
  },
  {
    name: 'mail_draft',
    description: 'Write a draft into the account\'s Drafts folder for the person to review and send themselves. Nothing is sent. Give reply_to (a message id) to draft a reply in that conversation.',
    inputSchema: {
      type: 'object',
      properties: {
        account: { type: 'string', description: 'account id (from mail_search results); defaults to the reply\'s account or the first shared account' },
        to: { type: 'array', items: { type: 'string' } }, cc: { type: 'array', items: { type: 'string' } },
        subject: { type: 'string' }, body: { type: 'string' }, reply_to: { type: 'string' },
      },
      required: ['body'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, title: 'Write a draft' },
  },
];

const HIDDEN_FOLDER = /(^|[/.])(spam|junk|bulk|trash|bin|deleted( items| messages)?|papierkorb|corbeille|papelera|cestino)$/i;

/** Spam and Trash are never shown, by their special use or by their usual names. */
export function hiddenFolder(path: string, folders: MailFolder[], account: string): boolean {
  const f = folders.find((x) => x.account === account && x.path === path);
  if (f?.special === 'junk' || f?.special === 'trash') return true;
  return HIDDEN_FOLDER.test(path.trim());
}

/** May an MCP client see this message at all? */
export function visibleToAgents(m: MessageSummary, shared: Set<string>, folders: MailFolder[], text?: string): boolean {
  if (!shared.has(m.account)) return false;
  if (hiddenFolder(m.folder, folders, m.account)) return false;
  if (m.security || isSecurityAlert({ subject: m.subject, snippet: m.snippet, text })) return false;
  if (hasSignInCode(`${m.subject}\n${m.snippet}`)) return false;
  return true;
}

/** Text as it leaves Keeper: secrets and one-time codes blanked. */
export const cleanForAgents = (t: string) => redact(redactCodes(t)).text;

const who = (a?: Address) => (a ? (a.name ? `${a.name} <${a.address}>` : a.address) : '');
const addrList = (v: unknown): Address[] => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []).map((x) => String(x).trim()).filter((x) => /@/.test(x)).map((x) => {
  const m = x.match(/^(.*)<([^>]+)>$/);
  return m ? { name: m[1].trim().replace(/^"|"$/g, '') || undefined, address: m[2].trim() } : { address: x };
});

type Result = { text: string; isError?: boolean; structured?: unknown };

/** The mail tools for MCP, enforcing every limit above on each call. */
export function mailMcp(b: MailMcpBackend) {
  const shared = async () => new Set((await b.accounts()).filter((a) => a.mail && a.mcp).map((a) => a.id));
  const deny = (text: string): Result => ({ text, isError: true });

  async function call(name: string, args: Record<string, unknown>): Promise<Result> {
    if (!MAIL_TOOLS.some((t) => t.name === name)) return deny(`Unknown tool ${name}. Mail tools can search, read and write drafts only.`);
    const ok = await shared();
    if (!ok.size) return deny('No mail account is shared with coding assistants. The person can allow one in Keeper → Settings → Mail & Calendar.');
    const folders = await b.folders();

    if (name === 'mail_search') {
      const limit = Math.max(1, Math.min(50, Number(args.limit) || 20));
      const found = (await b.search(String(args.query ?? ''), limit * 3)).filter((m) => visibleToAgents(m, ok, folders)).slice(0, limit);
      const rows = found.map((m) => ({ id: m.id, account: m.account, folder: m.folder, from: who(m.from), date: new Date(m.date).toISOString(), subject: cleanForAgents(m.subject), preview: cleanForAgents(m.snippet) }));
      return { text: rows.length ? rows.map((r) => `${r.id}\n  ${r.date} · ${r.from}\n  ${r.subject}\n  ${r.preview}`).join('\n') : 'No messages found.', structured: { messages: rows } };
    }

    const id = String(args.id ?? args.reply_to ?? '');
    if (name === 'mail_read' || name === 'mail_thread') {
      if (!id) return deny('Give the id of a message from mail_search.');
      const account = id.slice(0, id.indexOf(':'));
      if (!ok.has(account)) return deny('That message is in an account that is not shared.');
      let msg: Awaited<ReturnType<MailMcpBackend['read']>>;
      try {
        msg = await b.read(id);
      } catch {
        return deny('No such message.');
      }
      if (!visibleToAgents(msg.summary, ok, folders, msg.text)) return deny('That message cannot be shared (Spam, Trash, or security mail such as sign-in codes).');
      if (name === 'mail_read') {
        const s = msg.summary;
        const head = [`From: ${who(s.from)}`, `To: ${s.to.map(who).join(', ')}`, s.cc.length ? `Cc: ${s.cc.map(who).join(', ')}` : '', `Date: ${new Date(s.date).toISOString()}`, `Subject: ${cleanForAgents(s.subject)}`].filter(Boolean).join('\n');
        return { text: `${head}\n\n${cleanForAgents((msg.text ?? s.snippet).slice(0, 30_000))}` };
      }
      const list = (await b.thread(id)).filter((m) => visibleToAgents(m, ok, folders));
      return { text: list.map((m) => `${m.id}\n  ${new Date(m.date).toISOString()} · ${who(m.from)}\n  ${cleanForAgents(m.subject)}\n  ${cleanForAgents(m.snippet)}`).join('\n') || 'Nothing to show.' };
    }

    // mail_draft: written to Drafts, never sent.
    const body = String(args.body ?? '').slice(0, 100_000);
    let account = typeof args.account === 'string' ? args.account : '';
    let subject = typeof args.subject === 'string' ? args.subject : '';
    let to = addrList(args.to);
    const cc = addrList(args.cc);
    let inReplyTo: string | undefined;
    let references: string[] | undefined;
    const replyTo = typeof args.reply_to === 'string' ? args.reply_to : '';
    if (replyTo) {
      const acc = replyTo.slice(0, replyTo.indexOf(':'));
      if (!ok.has(acc)) return deny('That message is in an account that is not shared.');
      const orig = await b.read(replyTo).catch(() => null);
      if (!orig || !visibleToAgents(orig.summary, ok, folders, orig.text)) return deny('That message cannot be replied to from here.');
      account ||= acc;
      subject ||= /^re:/i.test(orig.summary.subject) ? orig.summary.subject : `Re: ${orig.summary.subject}`;
      if (!to.length && orig.summary.from) to = [orig.summary.from];
      inReplyTo = orig.summary.messageId;
      references = [...(orig.summary.references ?? []), ...(inReplyTo ? [inReplyTo] : [])];
    }
    account ||= [...ok][0];
    if (!ok.has(account)) return deny('That account is not shared with coding assistants.');
    await b.saveDraft({ account, to, cc, bcc: [], subject, body, inReplyTo, references });
    return { text: `Saved a draft "${subject || '(no subject)'}" in Drafts. The person reviews and sends it in their mail app; nothing was sent.` };
  }

  return { tools: () => MAIL_TOOLS, call };
}
