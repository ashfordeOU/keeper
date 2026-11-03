// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Mail rules: conditions on the sender, recipients, subject, text,
// attachments and mailing list, and what to do (move, archive, mark read,
// flag, label, delete). They run on this computer as mail arrives; where the
// provider can run them itself (Sieve on IMAP servers that offer ManageSieve,
// Gmail's filters) the same rule can be written there too, so it works while
// Keeper is closed. Pure: no network.

import type { Address, MessageSummary } from './types';

export type RuleField = 'from' | 'to' | 'subject' | 'body' | 'any' | 'list';
export type RuleCondition =
  | { field: RuleField; contains: string }
  | { field: 'attachment'; has: boolean };
export type RuleAction =
  | { action: 'move'; folder: string } | { action: 'archive' } | { action: 'flag' } | { action: 'read' }
  | { action: 'label'; label: string } | { action: 'trash' };

/** A rule as kept now; older rules (one condition list, one action) read the same way. */
export interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  /** only for this account */
  account?: string;
  when: RuleCondition[];
  /** 'all' (default): every condition must match; 'any': one is enough */
  match?: 'all' | 'any';
  then: RuleAction;
  /** more actions after the first */
  also?: RuleAction[];
  /** later rules are skipped once this one matched (default true) */
  stop?: boolean;
  /** also written to the provider (Sieve or Gmail filters) */
  server?: boolean;
}

const lc = (s?: string) => (s ?? '').toLowerCase();
const addr = (a?: Address) => (a ? `${a.name ?? ''} ${a.address}` : '');

export function conditionMatches(c: RuleCondition, m: MessageSummary & { text?: string }): boolean {
  if (c.field === 'attachment') return !!m.hasAttachments === c.has;
  const needle = lc(c.contains).trim();
  if (!needle) return true;
  const hay = {
    from: addr(m.from),
    to: [...m.to, ...m.cc].map(addr).join(' '),
    subject: m.subject,
    body: m.text ?? m.snippet,
    list: m.listId ?? '',
    any: [addr(m.from), ...m.to.map(addr), m.subject, m.text ?? m.snippet, m.listId ?? ''].join(' '),
  }[c.field];
  return lc(hay).includes(needle);
}

export function ruleMatchesV2(rule: Rule, m: MessageSummary & { text?: string }): boolean {
  if (!rule.enabled || !rule.when.length) return false;
  if (rule.account && rule.account !== m.account) return false;
  // A rule whose only condition is empty would match everything: never.
  if (rule.when.every((c) => c.field !== 'attachment' && !c.contains.trim())) return false;
  return rule.match === 'any' ? rule.when.some((c) => conditionMatches(c, m)) : rule.when.every((c) => conditionMatches(c, m));
}

/** Every action the rules ask for on one message, in order (stopping after a rule that says so). */
export function evaluateRules(rules: Rule[], m: MessageSummary & { text?: string }): { rule: Rule; actions: RuleAction[] }[] {
  const out: { rule: Rule; actions: RuleAction[] }[] = [];
  for (const r of rules) {
    if (!ruleMatchesV2(r, m)) continue;
    out.push({ rule: r, actions: [r.then, ...(r.also ?? [])] });
    if (r.stop !== false) break;
  }
  return out;
}

/**
 * The final effect of the actions on one message: flags to set, labels to add,
 * and at most one place to end up (the last move, archive or delete wins).
 */
export function planActions(actions: RuleAction[]): { read: boolean; flag: boolean; labels: string[]; dest?: { kind: 'move'; folder: string } | { kind: 'archive' } | { kind: 'trash' } } {
  const plan: ReturnType<typeof planActions> = { read: false, flag: false, labels: [] };
  for (const a of actions) {
    if (a.action === 'read') plan.read = true;
    else if (a.action === 'flag') plan.flag = true;
    else if (a.action === 'label') { if (a.label.trim() && !plan.labels.includes(a.label.trim())) plan.labels.push(a.label.trim()); }
    else if (a.action === 'move') plan.dest = { kind: 'move', folder: a.folder };
    else if (a.action === 'archive') plan.dest = { kind: 'archive' };
    else if (a.action === 'trash') plan.dest = { kind: 'trash' };
  }
  return plan;
}

export function describeRule(r: Rule): string {
  const cond = r.when.map((c) => (c.field === 'attachment' ? (c.has ? 'it has attachments' : 'it has no attachments') : `${{ from: 'sender', to: 'recipients', subject: 'subject', body: 'text', any: 'anything', list: 'mailing list' }[c.field]} contains “${c.contains}”`)).join(r.match === 'any' ? ' or ' : ' and ');
  const act = (a: RuleAction) => ({ move: `move to ${'folder' in a ? a.folder : ''}`, archive: 'archive', flag: 'flag', read: 'mark as read', label: `label “${'label' in a ? a.label : ''}”`, trash: 'delete' }[a.action]);
  return `If ${cond || 'anything'}: ${[r.then, ...(r.also ?? [])].map(act).join(', ')}`;
}

// ---------------------------------------------------------------- Sieve (RFC 5228) for IMAP servers with ManageSieve

const sieveString = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

function sieveTest(c: RuleCondition): string | null {
  if (c.field === 'attachment') {
    // Without the "mime" extension a header test is the honest approximation.
    const t = 'header :contains "Content-Type" "multipart/mixed"';
    return c.has ? t : `not ${t}`;
  }
  const v = sieveString(c.contains.trim());
  if (c.field === 'from') return `address :contains "from" ${v}`;
  if (c.field === 'to') return `address :contains ["to", "cc"] ${v}`;
  if (c.field === 'subject') return `header :contains "subject" ${v}`;
  if (c.field === 'list') return `header :contains "list-id" ${v}`;
  if (c.field === 'body') return `body :text :contains ${v}`;
  if (c.field === 'any') return `anyof (header :contains ["from", "to", "cc", "subject", "list-id"] ${v}, body :text :contains ${v})`;
  return null;
}

/** Rules the server can run: every condition and action has a Sieve form (archive needs to know the folder). */
export function sieveCapable(r: Rule): boolean {
  return r.when.length > 0 && r.when.every((c) => sieveTest(c) !== null);
}

export const SIEVE_SCRIPT = 'keeper';

/** A Sieve script for the rules marked "run on the server" (and switched on). */
export function toSieve(rules: Rule[], o: { archive?: string; trash?: string; extensions?: string[] } = {}): string {
  const ext = new Set(o.extensions ?? ['fileinto', 'imap4flags', 'body']);
  const lines: string[] = [];
  const used = new Set<string>();
  const body: string[] = [];
  for (const r of rules) {
    if (!r.enabled || !r.server || !sieveCapable(r)) continue;
    if (r.when.some((c) => c.field === 'body' || c.field === 'any') && !ext.has('body')) continue;
    const tests = r.when.map(sieveTest) as string[];
    if (tests.some((t) => t.startsWith('body') || t.includes('body :text'))) used.add('body');
    const acts: string[] = [];
    for (const a of [r.then, ...(r.also ?? [])]) {
      if (a.action === 'read') { used.add('imap4flags'); acts.push('addflag "\\\\Seen";'); }
      else if (a.action === 'flag') { used.add('imap4flags'); acts.push('addflag "\\\\Flagged";'); }
      else if (a.action === 'label') { used.add('imap4flags'); acts.push(`addflag ${sieveString(a.label)};`); }
      else if (a.action === 'move') { used.add('fileinto'); acts.push(`fileinto ${sieveString(a.folder)};`); }
      else if (a.action === 'archive' && o.archive) { used.add('fileinto'); acts.push(`fileinto ${sieveString(o.archive)};`); }
      else if (a.action === 'trash') { if (o.trash) { used.add('fileinto'); acts.push(`fileinto ${sieveString(o.trash)};`); } else acts.push('discard;'); }
    }
    if (!acts.length) continue;
    if (r.stop !== false) acts.push('stop;');
    const cond = tests.length === 1 ? tests[0] : `${r.match === 'any' ? 'anyof' : 'allof'} (${tests.join(', ')})`;
    body.push(`# ${(r.name || describeRule(r)).replace(/[\r\n]/g, ' ')}`, `if ${cond} {`, ...acts.map((x) => `  ${x}`), '}');
  }
  const req = [...used].filter((x) => ext.has(x)).sort();
  lines.push('# Written by Keeper (Mail → Rules). Changes made here are replaced when the rules change in Keeper.');
  if (req.length) lines.push(`require [${req.map((x) => `"${x}"`).join(', ')}];`);
  return [...lines, ...body, ''].join('\n');
}

// ---------------------------------------------------------------- ManageSieve (RFC 5804): the bits of the protocol that are pure

/** A ManageSieve string: quoted when short and simple, else a literal {n+}. */
export function msString(s: string): string {
  if (!/[\r\n"\\]/.test(s) && Buffer.byteLength(s) < 1000) return `"${s}"`;
  return `{${Buffer.byteLength(s)}+}\r\n${s}`;
}

/** Splits a server's capability lines ("IMPLEMENTATION" "Dovecot", "SIEVE" "fileinto ..."). */
export function parseCapabilities(lines: string[]): { sasl: string[]; extensions: string[]; starttls: boolean; implementation?: string } {
  const out = { sasl: [] as string[], extensions: [] as string[], starttls: false, implementation: undefined as string | undefined };
  for (const l of lines) {
    const m = l.match(/^"([^"]+)"(?:\s+"([^"]*)")?/);
    if (!m) continue;
    const k = m[1].toUpperCase();
    if (k === 'SASL') out.sasl = (m[2] ?? '').split(/\s+/).filter(Boolean).map((x) => x.toUpperCase());
    else if (k === 'SIEVE') out.extensions = (m[2] ?? '').split(/\s+/).filter(Boolean).map((x) => x.toLowerCase());
    else if (k === 'STARTTLS') out.starttls = true;
    else if (k === 'IMPLEMENTATION') out.implementation = m[2];
  }
  return out;
}

/** "OK", "NO" or "BYE" at the start of a line ends a response. */
export function responseEnd(line: string): { status: 'OK' | 'NO' | 'BYE'; text: string } | null {
  const m = line.match(/^(OK|NO|BYE)\b\s*(?:\([^)]*\)\s*)?(?:"((?:[^"\\]|\\.)*)")?/i);
  return m ? { status: m[1].toUpperCase() as 'OK' | 'NO' | 'BYE', text: (m[2] ?? '').replace(/\\(.)/g, '$1') } : null;
}

// ---------------------------------------------------------------- Gmail filters (Gmail API, when signed in with Google)

export interface GmailFilter {
  criteria: { from?: string; to?: string; subject?: string; query?: string; hasAttachment?: boolean };
  action: { addLabelIds?: string[]; removeLabelIds?: string[] };
}

export function gmailCapable(r: Rule): boolean {
  return r.match !== 'any' && r.when.length > 0;
}

/**
 * A Gmail filter for a rule. Label names are given as names; the caller turns
 * them into label ids. Archive = take INBOX off; read = take UNREAD off.
 */
export function toGmailFilter(r: Rule): { filter: GmailFilter; labels: string[] } | null {
  if (!gmailCapable(r)) return null;
  const criteria: GmailFilter['criteria'] = {};
  const query: string[] = [];
  const q = (s: string) => (/\s/.test(s) ? `"${s.replace(/"/g, '')}"` : s);
  for (const c of r.when) {
    if (c.field === 'attachment') criteria.hasAttachment = c.has || undefined;
    else if (c.field === 'from') criteria.from = c.contains;
    else if (c.field === 'to') criteria.to = c.contains;
    else if (c.field === 'subject') criteria.subject = c.contains;
    else if (c.field === 'list') query.push(`list:${q(c.contains)}`);
    else query.push(q(c.contains));
  }
  if (query.length) criteria.query = query.join(' ');
  const add: string[] = [];
  const remove: string[] = [];
  const labels: string[] = [];
  for (const a of [r.then, ...(r.also ?? [])]) {
    if (a.action === 'read') remove.push('UNREAD');
    else if (a.action === 'archive') remove.push('INBOX');
    else if (a.action === 'flag') add.push('STARRED');
    else if (a.action === 'trash') add.push('TRASH');
    else if (a.action === 'label') { labels.push(a.label); add.push(`label:${a.label}`); }
    else if (a.action === 'move') { labels.push(a.folder); add.push(`label:${a.folder}`); remove.push('INBOX'); }
  }
  return { filter: { criteria, action: { ...(add.length ? { addLabelIds: add } : {}), ...(remove.length ? { removeLabelIds: [...new Set(remove)] } : {}) } }, labels };
}

