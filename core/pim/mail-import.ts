// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Reading mail other apps kept: .mbox files (one file, many messages), .eml
// files, Apple Mail's .emlx files and folder layout, Thunderbird profiles and
// Outlook for Mac's .olm export; and writing .mbox for export. Pure: the main
// process reads the files and hands the bytes here.

import type { SpecialUse } from './types';

// ---------------------------------------------------------------- mbox

/** A line that starts a message in an mbox file ("From sender date"). */
const FROM_LINE = /^From \S*.*\d{4}\s*$|^From \S+\s*$/;

/**
 * Splits an mbox file into messages as the bytes arrive (files can be many
 * gigabytes, so nothing waits for the whole file). Each message comes out
 * with its "From " line taken off and ">From " lines put back as they were
 * (mboxrd and mboxo both read fine).
 */
export class MboxSplitter {
  private rest = Buffer.alloc(0);
  private cur: Buffer[] = [];
  private started = false;
  private fromLine = '';

  constructor(private onMessage: (raw: Buffer, fromLine: string) => void) {}

  push(chunk: Buffer) {
    const buf = this.rest.length ? Buffer.concat([this.rest, chunk]) : chunk;
    let start = 0;
    for (;;) {
      const nl = buf.indexOf(10, start);
      if (nl < 0) break;
      this.line(buf.subarray(start, nl + 1));
      start = nl + 1;
    }
    this.rest = Buffer.from(buf.subarray(start));
  }

  end() {
    if (this.rest.length) this.line(this.rest);
    this.rest = Buffer.alloc(0);
    this.flush();
  }

  private line(l: Buffer) {
    // Only short lines can be a "From " line; checking them as text is cheap.
    if (l.length < 400 && l[0] === 0x46 /* F */ && l.subarray(0, 5).toString('latin1') === 'From ') {
      const text = l.toString('latin1').replace(/\r?\n$/, '');
      if (FROM_LINE.test(text)) {
        this.flush();
        this.started = true;
        this.fromLine = text;
        return;
      }
    }
    if (!this.started) {
      // A file without "From " lines is one message (an .eml saved as .mbox).
      if (l.toString('latin1').trim() === '') return;
      this.started = true;
    }
    // ">From " (and ">>From ") had one ">" added when written.
    if (l[0] === 0x3e /* > */) {
      const m = /^>+From /.exec(l.subarray(0, 64).toString('latin1'));
      if (m) l = l.subarray(1);
    }
    this.cur.push(l);
  }

  private flush() {
    if (!this.started) return;
    let raw = Buffer.concat(this.cur);
    this.cur = [];
    // The blank line that separates messages belongs to the file, not the message.
    let end = raw.length;
    while (end > 0 && (raw[end - 1] === 10 || raw[end - 1] === 13)) end--;
    raw = raw.subarray(0, end);
    if (raw.length && looksLikeMessage(raw)) this.onMessage(Buffer.concat([raw, Buffer.from('\r\n')]), this.fromLine);
    this.fromLine = '';
  }
}

/** Every message in an mbox held in memory (small files, tests). */
export function splitMbox(data: Buffer | string): Buffer[] {
  const out: Buffer[] = [];
  const s = new MboxSplitter((raw) => out.push(raw));
  s.push(typeof data === 'string' ? Buffer.from(data, 'utf8') : data);
  s.end();
  return out;
}

/** Has headers: a "Name: value" line before the first blank line. */
export function looksLikeMessage(raw: Buffer): boolean {
  const head = raw.subarray(0, 4000).toString('latin1');
  const top = head.split(/\r?\n\r?\n/)[0];
  return /^[!-9;-~]+:[ \t]?/m.test(top);
}

function asctime(t: number): string {
  const d = new Date(t);
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
  const p = (n: number) => String(n).padStart(2, '0');
  return `${day} ${mon} ${String(d.getUTCDate()).padStart(2, ' ')} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} ${d.getUTCFullYear()}`;
}

/**
 * One message as it is written into an mbox file (mboxrd): a "From " line,
 * the message with every ">*From " line given one more ">", and a blank line.
 */
export function toMboxEntry(raw: Buffer | string, sender: string, date: number): Buffer {
  const text = (typeof raw === 'string' ? Buffer.from(raw, 'utf8') : raw).toString('latin1');
  const body = text.replace(/\r\n/g, '\n').replace(/^(>*From )/gm, '>$1').replace(/\n*$/, '\n');
  const who = (sender || 'MAILER-DAEMON').replace(/\s+/g, '');
  return Buffer.from(`From ${who} ${asctime(date || 0)}\n${body}\n`, 'latin1');
}

// ---------------------------------------------------------------- headers

/** A header's value from a raw message (folded lines joined), or undefined. */
export function rawHeader(raw: Buffer | string, name: string): string | undefined {
  const text = (typeof raw === 'string' ? raw : raw.subarray(0, 64_000).toString('latin1'));
  const top = text.split(/\r?\n\r?\n/)[0].replace(/\r?\n[ \t]+/g, ' ');
  const m = top.match(new RegExp(`^${name.replace(/[-]/g, '\\-')}:[ \\t]*(.*)$`, 'im'));
  return m ? m[1].trim() : undefined;
}

/** The Message-ID without its angle brackets. */
export function messageIdOf(raw: Buffer | string): string | undefined {
  const v = rawHeader(raw, 'message-id');
  const m = v?.match(/<([^>]+)>/);
  return (m?.[1] ?? v)?.trim() || undefined;
}

/** Gmail Takeout's labels (X-Gmail-Labels: Inbox,Important,"Work, Projects"). */
export function gmailLabels(raw: Buffer | string): string[] {
  const v = rawHeader(raw, 'x-gmail-labels');
  if (!v) return [];
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (const ch of v) {
    if (ch === '"') q = !q;
    else if (ch === ',' && !q) { out.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out.filter(Boolean);
}

const GMAIL_SYSTEM: Record<string, SpecialUse | 'skip'> = {
  inbox: 'inbox', sent: 'sent', drafts: 'drafts', draft: 'drafts', trash: 'trash', spam: 'junk',
  archived: 'archive', important: 'skip', starred: 'skip', unread: 'skip', opened: 'skip', 'category personal': 'skip',
  'category social': 'skip', 'category promotions': 'skip', 'category updates': 'skip', 'category forums': 'skip', chat: 'skip',
};

/**
 * Where a Gmail Takeout message goes: its system folder (Inbox, Sent…) or else
 * its first label as a folder of its own, or Archive; with the other labels
 * kept as labels, and Unread and Starred as flags.
 */
export function gmailPlacement(labels: string[]): { folder: string; labels: string[]; seen: boolean; flagged: boolean } {
  const lower = labels.map((l) => l.toLowerCase());
  const seen = !lower.includes('unread');
  const flagged = lower.includes('starred');
  const special = (['trash', 'spam', 'drafts', 'draft', 'sent', 'inbox'] as const).find((s) => lower.includes(s));
  const own = labels.filter((l) => !GMAIL_SYSTEM[l.toLowerCase()]);
  const folder = special ? FOLDER_NAMES[GMAIL_SYSTEM[special] as SpecialUse] : own[0] ?? 'Archive';
  return { folder, labels: own.filter((l) => l !== folder), seen, flagged };
}

// ---------------------------------------------------------------- folders

/** The names Keeper gives the special folders of the "On this computer" mail. */
export const FOLDER_NAMES: Record<SpecialUse, string> = { inbox: 'Inbox', sent: 'Sent', drafts: 'Drafts', trash: 'Trash', junk: 'Junk', archive: 'Archive', all: 'All Mail', flagged: 'Flagged' };

const SPECIAL_NAMES: [RegExp, SpecialUse][] = [
  [/^(inbox|posteingang|boîte de réception|bandeja de entrada|posta in arrivo)$/i, 'inbox'],
  [/^(sent|sent messages|sent items|sent mail|outbox sent|gesendet|gesendete objekte|envoyés|éléments envoyés|enviados|posta inviata|\[gmail\]\/sent mail)$/i, 'sent'],
  [/^(drafts?|entwürfe|brouillons|borradores|bozze|\[gmail\]\/drafts)$/i, 'drafts'],
  [/^(trash|deleted messages|deleted items|deleted|bin|papierkorb|corbeille|papelera|cestino|\[gmail\]\/trash|\[gmail\]\/bin)$/i, 'trash'],
  [/^(junk|junk e-?mail|spam|bulk mail|\[gmail\]\/spam)$/i, 'junk'],
  [/^(archive|archives|archiv|archivo|\[gmail\]\/all mail|all mail)$/i, 'archive'],
];

/** A special folder's kind from its name in another app (Inbox, Sent Items, Deleted Messages…). */
export function specialOf(name: string): SpecialUse | undefined {
  const leaf = name.trim();
  for (const [re, s] of SPECIAL_NAMES) if (re.test(leaf)) return s;
  return undefined;
}

/**
 * The folder an imported mailbox lands in under the import's own folder:
 * special folders become Keeper's own (Inbox, Sent…), others keep their path.
 */
export function targetFolder(sourcePath: string[]): { path: string; special?: SpecialUse } {
  const parts = sourcePath.map((p) => p.replace(/\.(mbox|sbd|mbx)$/i, '').trim()).filter(Boolean);
  if (parts.length === 1) {
    const s = specialOf(parts[0]);
    if (s) return { path: FOLDER_NAMES[s], special: s };
  }
  if (parts.length === 2 && /^\[gmail\]$/i.test(parts[0])) {
    const s = specialOf(`[Gmail]/${parts[1]}`);
    if (s) return { path: FOLDER_NAMES[s], special: s };
  }
  return { path: parts.join('/') || 'Imported' };
}

// ---------------------------------------------------------------- Apple Mail

export interface EmlxMessage {
  raw: Buffer;
  seen: boolean;
  flagged: boolean;
  answered: boolean;
  deleted: boolean;
  /** an .partial.emlx: attachments were kept in separate files */
  partial: boolean;
}

/**
 * An Apple Mail .emlx file: the byte count on the first line, the message,
 * then a property list with the flags (bit 0 read, 1 deleted, 2 answered,
 * 4 flagged).
 */
export function parseEmlx(buf: Buffer, partial = false): EmlxMessage | null {
  const nl = buf.indexOf(10);
  if (nl < 0 || nl > 20) return null;
  const len = Number(buf.subarray(0, nl).toString('latin1').trim());
  if (!Number.isFinite(len) || len <= 0) return null;
  const raw = buf.subarray(nl + 1, Math.min(buf.length, nl + 1 + len));
  const plist = buf.subarray(nl + 1 + len).toString('utf8');
  const flags = Number(plist.match(/<key>flags<\/key>\s*<integer>(\d+)<\/integer>/)?.[1] ?? 0);
  return { raw: Buffer.from(raw), seen: (flags & 1) !== 0, deleted: (flags & 2) !== 0, answered: (flags & 4) !== 0, flagged: (flags & 16) !== 0, partial };
}

/**
 * The folder of an Apple Mail .emlx file from its path inside ~/Library/Mail/V*:
 * "<account>/Work.mbox/Clients.mbox/<id>/Data/1/Messages/12.emlx" → ["Work", "Clients"].
 * The account part is returned on its own (its folder name, an id or "Mailboxes" for On My Mac).
 */
export function appleMailFolder(relPath: string): { account: string; folder: string[] } | null {
  const parts = relPath.split(/[\\/]+/).filter(Boolean);
  if (!/\.emlx$/i.test(parts[parts.length - 1] ?? '')) return null;
  const boxes = parts.map((p, i) => ({ p, i })).filter(({ p }) => /\.mbox$/i.test(p));
  if (!boxes.length) return null;
  return { account: parts[0], folder: boxes.map(({ p }) => p.replace(/\.mbox$/i, '')) };
}

/** The newest Apple Mail store folder (V10 before V9) among the names in ~/Library/Mail. */
export function appleMailVersion(names: string[]): string | undefined {
  return names.filter((n) => /^V\d+$/.test(n)).sort((a, b) => Number(b.slice(1)) - Number(a.slice(1)))[0];
}

// ---------------------------------------------------------------- Thunderbird

export interface ThunderbirdProfile {
  name: string;
  /** the profile folder, absolute */
  path: string;
  isDefault: boolean;
}

/** Profiles from Thunderbird's profiles.ini (paths made absolute against the folder it is in). */
export function parseProfilesIni(text: string, base: string, sep = '/'): ThunderbirdProfile[] {
  const out: ThunderbirdProfile[] = [];
  let cur: Record<string, string> | null = null;
  let installDefault = '';
  const flush = () => {
    if (cur?.path) {
      const rel = cur.isrelative !== '0';
      const p = rel ? `${base.replace(/[\\/]+$/, '')}${sep}${cur.path.replace(/[\\/]/g, sep)}` : cur.path;
      out.push({ name: cur.name || cur.path, path: p, isDefault: cur.default === '1' });
    }
  };
  let section = '';
  for (const line of text.split(/\r?\n/)) {
    const s = line.match(/^\[(.+)\]\s*$/);
    if (s) {
      flush();
      section = s[1];
      cur = /^Profile\d+$/i.test(section) ? {} : null;
      continue;
    }
    const kv = line.match(/^([^=;#]+)=(.*)$/);
    if (!kv) continue;
    const k = kv[1].trim().toLowerCase();
    const v = kv[2].trim();
    if (cur) cur[k] = v;
    else if (/^Install/i.test(section) && k === 'default') installDefault = v;
  }
  flush();
  if (installDefault) for (const p of out) p.isDefault = p.path.replace(/\\/g, '/').endsWith(installDefault.replace(/\\/g, '/'));
  return out.sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
}

/** Where Thunderbird keeps profiles.ini on each system (the regular install and the packaged ones). */
export function thunderbirdRoots(platform: string, home: string, appData?: string): string[] {
  if (platform === 'darwin') return [`${home}/Library/Thunderbird`];
  if (platform === 'win32') return [`${appData ?? `${home}\\AppData\\Roaming`}\\Thunderbird`];
  return [`${home}/.thunderbird`, `${home}/snap/thunderbird/common/.thunderbird`, `${home}/.var/app/org.mozilla.Thunderbird/.thunderbird`, `${home}/.var/app/net.thunderbird.Thunderbird/.thunderbird`];
}

const NOT_MAIL = /\.(msf|dat|json|sqlite|sqlite-wal|sqlite-shm|html?|js|txt|log|bak|mozlz4|lock|db|ini|xml|rdf|css|png|jpg|ico)$/i;

/**
 * The mailboxes in a Thunderbird mail folder ("Mail/Local Folders",
 * "ImapMail/imap.example.com"): files without an extension next to their
 * ".msf" index, with sub-folders in "Name.sbd" directories. Given every file's
 * path relative to that folder, returns each mailbox file and its folder path.
 */
export function thunderbirdMailboxes(files: { path: string; size: number }[]): { file: string; folder: string[] }[] {
  const all = new Set(files.map((f) => f.path.replace(/\\/g, '/')));
  const out: { file: string; folder: string[] }[] = [];
  for (const f of files) {
    const p = f.path.replace(/\\/g, '/');
    const leaf = p.split('/').pop()!;
    if (NOT_MAIL.test(leaf) || leaf.startsWith('.') || f.size === 0) continue;
    if (/(^|\/)(cur|new|tmp)\//.test(p)) continue;
    const known = all.has(`${p}.msf`) || /^(inbox|sent|drafts|trash|junk|archives|templates|unsent messages)$/i.test(leaf);
    if (!known) continue;
    out.push({ file: f.path, folder: p.split('/').map((x) => x.replace(/\.sbd$/i, '')) });
  }
  return out.sort((a, b) => a.folder.join('/').localeCompare(b.folder.join('/')));
}

/** A Thunderbird account folder's name for people ("Local Folders", "imap.example.com" → the server). */
export function thunderbirdAccountName(dir: string): string {
  const leaf = dir.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? dir;
  return leaf.replace(/-\d+$/, '');
}

// ---------------------------------------------------------------- Outlook for Mac (.olm)

const xmlText = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&');

function tag(xml: string, name: string): string | undefined {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return m ? xmlText(m[1]) : undefined;
}

function olmAddresses(xml: string, name: string): { name?: string; address: string }[] {
  const block = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1] ?? '';
  const out: { name?: string; address: string }[] = [];
  for (const m of block.matchAll(/<emailAddress\b([^>]*)\/?>/g)) {
    const attrs = m[1];
    const address = attrs.match(/OPFContactEmailAddressAddress="([^"]*)"/)?.[1];
    const nm = attrs.match(/OPFContactEmailAddressName="([^"]*)"/)?.[1];
    if (address) out.push({ address: xmlText(address), name: nm && nm !== address ? xmlText(nm) : undefined });
  }
  return out;
}

export interface OlmMessage {
  subject: string;
  from?: { name?: string; address: string };
  to: { name?: string; address: string }[];
  cc: { name?: string; address: string }[];
  date?: number;
  messageId?: string;
  inReplyTo?: string;
  text?: string;
  html?: string;
  seen: boolean;
  flagged: boolean;
  /** attachment files inside the archive, with their names and types */
  attachments: { url: string; name: string; type: string }[];
}

/** One message from an Outlook for Mac export (an XML file inside the .olm). */
export function parseOlmMessage(xml: string): OlmMessage | null {
  if (!/<email\b/.test(xml)) return null;
  const sent = tag(xml, 'OPFMessageCopySentTime') ?? tag(xml, 'OPFMessageCopyReceivedTime');
  const t = sent ? Date.parse(sent) : NaN;
  const atts: OlmMessage['attachments'] = [];
  for (const m of xml.matchAll(/<messageAttachment\b([^>]*)\/?>/g)) {
    const url = m[1].match(/OPFAttachmentURL="([^"]*)"/)?.[1];
    if (!url) continue;
    atts.push({ url: xmlText(url), name: xmlText(m[1].match(/OPFAttachmentName="([^"]*)"/)?.[1] ?? 'attachment'), type: m[1].match(/OPFAttachmentContentType="([^"]*)"/)?.[1] ?? 'application/octet-stream' });
  }
  return {
    subject: tag(xml, 'OPFMessageCopySubject') ?? '',
    from: olmAddresses(xml, 'OPFMessageCopySenderAddress')[0] ?? olmAddresses(xml, 'OPFMessageCopyFromAddresses')[0],
    to: olmAddresses(xml, 'OPFMessageCopyToAddresses'),
    cc: olmAddresses(xml, 'OPFMessageCopyCCAddresses'),
    date: Number.isFinite(t) ? t : undefined,
    messageId: tag(xml, 'OPFMessageCopyMessageID')?.replace(/^<|>$/g, ''),
    inReplyTo: tag(xml, 'OPFMessageCopyInReplyTo')?.replace(/^<|>$/g, ''),
    text: tag(xml, 'OPFMessageCopyBody'),
    html: tag(xml, 'OPFMessageCopyHTMLBody'),
    seen: tag(xml, 'OPFMessageGetIsRead') !== '0',
    flagged: (tag(xml, 'OPFMessageGetFlagStatus') ?? '0') !== '0',
    attachments: atts,
  };
}

/** The folder of a message inside an .olm archive ("Accounts/x/com.microsoft.__Messages/Inbox/Work/message_1.xml" → ["Inbox", "Work"]). */
export function olmFolder(entry: string): string[] | null {
  const parts = entry.split('/');
  const i = parts.indexOf('com.microsoft.__Messages');
  if (i < 0 || !/\.xml$/i.test(parts[parts.length - 1])) return null;
  return parts.slice(i + 1, -1);
}

// ---------------------------------------------------------------- building a message

const encWord = (s: string) => (/[^\x20-\x7e]/.test(s) ? `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=` : s);
const fmtAddr = (a: { name?: string; address: string }) => (a.name ? `${/[",;<>@]/.test(a.name) && !/[^\x20-\x7e]/.test(a.name) ? `"${a.name.replace(/"/g, '')}"` : encWord(a.name)} <${a.address}>` : a.address);
const b64 = (b: Buffer) => b.toString('base64').replace(/(.{76})/g, '$1\r\n');

function rfcDate(t: number): string {
  return new Date(t).toUTCString().replace('GMT', '+0000');
}

/**
 * A plain RFC 5322 message built from parts (an .olm message, a test), so
 * every imported message is kept and read the same way.
 */
export function buildMessage(m: { subject: string; from?: { name?: string; address: string }; to: { name?: string; address: string }[]; cc?: { name?: string; address: string }[]; date?: number; messageId?: string; inReplyTo?: string; text?: string; html?: string; attachments?: { name: string; type: string; content: Buffer }[] }): Buffer {
  const H = [`Date: ${rfcDate(m.date ?? 0)}`, `Subject: ${encWord(m.subject)}`];
  if (m.from) H.push(`From: ${fmtAddr(m.from)}`);
  if (m.to.length) H.push(`To: ${m.to.map(fmtAddr).join(', ')}`);
  if (m.cc?.length) H.push(`Cc: ${m.cc.map(fmtAddr).join(', ')}`);
  if (m.messageId) H.push(`Message-ID: <${m.messageId}>`);
  if (m.inReplyTo) H.push(`In-Reply-To: <${m.inReplyTo}>`);
  H.push('MIME-Version: 1.0');
  const tag2 = (m.messageId ?? m.subject).length.toString(36);
  const bound = (n: number) => `=_keeper_${n}_${tag2}`;
  // A part: its headers, a blank line, its content.
  type Part = { head: string[]; body: string };
  const textPart = (type: string, text: string): Part => ({ head: [`Content-Type: ${type}; charset=utf-8`, 'Content-Transfer-Encoding: base64'], body: b64(Buffer.from(text, 'utf8')) });
  const multi = (kind: string, b: string, parts: Part[]): Part => ({ head: [`Content-Type: multipart/${kind}; boundary="${b}"`], body: [...parts.flatMap((p) => [`--${b}`, ...p.head, '', p.body]), `--${b}--`, ''].join('\r\n') });
  let top: Part = m.html && m.text ? multi('alternative', bound(2), [textPart('text/plain', m.text), textPart('text/html', m.html)]) : m.html ? textPart('text/html', m.html) : textPart('text/plain', m.text ?? '');
  if (m.attachments?.length) {
    top = multi('mixed', bound(1), [top, ...m.attachments.map((a) => ({ head: [`Content-Type: ${a.type}; name="${encWord(a.name)}"`, `Content-Disposition: attachment; filename="${encWord(a.name)}"`, 'Content-Transfer-Encoding: base64'], body: b64(a.content) }))]);
  }
  return Buffer.from([...H, ...top.head, '', top.body, ''].join('\r\n'), 'utf8');
}

// ---------------------------------------------------------------- the import's summary

export interface ImportCounts {
  added: number;
  /** already there (same Message-ID in the same folder) */
  skipped: number;
  /** could not be read */
  failed: number;
  folders: number;
}

/** A short line for the summary ("1,204 messages in 6 folders · 3 already here"). */
export function importSummary(c: ImportCounts, noun = 'message'): string {
  const n = (x: number) => x.toLocaleString('en-US');
  const parts = [`${n(c.added)} ${noun}${c.added === 1 ? '' : 's'}${c.folders > 1 ? ` in ${n(c.folders)} folders` : ''}`];
  if (c.skipped) parts.push(`${n(c.skipped)} already here`);
  if (c.failed) parts.push(`${n(c.failed)} could not be read`);
  return parts.join(' · ');
}

/** A file name safe on every system, for exported mail. */
export function safeFileName(s: string, fallback = 'message'): string {
  const v = s.replace(/[\\/:*?"<>|\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return v.replace(/^\.+/, '') || fallback;
}
