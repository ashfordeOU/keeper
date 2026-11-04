// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// One knowledge graph of everything Keeper knows on this computer: files and
// notes, mail threads, people (one person however many addresses and ways of
// writing their name), organisations, calendar events, tasks and projects,
// places, saved pages, recorded meetings and the apps they came from. Every
// link says why it exists ("Lena Fischer was invited to “Lease viewing”").
//
// Built in two steps so it stays quick as things change:
//   1. each item becomes a fragment (its own node, the people it names and its
//      links, some only by a handle such as a file name or a message id). Only
//      items whose signature changed are read again (GraphStore.update);
//   2. the fragments are put together: people merged, handles resolved, and the
//      links that need everything at once (near in time, same place) added.
// Pure: the app hands in what each part knows, already filtered for privacy.

import { extractEntities, extractHashTags, extractLinks, type GraphFile } from './build';

export type ItemKind = 'file' | 'note' | 'mail' | 'person' | 'org' | 'event' | 'task' | 'project' | 'place' | 'bookmark' | 'meeting' | 'app' | 'tag' | 'folder' | 'source';
export type Reason = 'emailed' | 'attended' | 'mentioned' | 'attached' | 'linked' | 'project' | 'tagged' | 'time' | 'place' | 'similar' | 'works' | 'recorded' | 'folder' | 'source';

export const ITEM_KINDS: ItemKind[] = ['person', 'org', 'mail', 'event', 'meeting', 'task', 'project', 'note', 'file', 'place', 'bookmark', 'app', 'tag', 'folder', 'source'];

/** What each kind is called, one and many. */
export const KIND_LABEL: Record<ItemKind, [string, string]> = {
  file: ['File', 'Files'], note: ['Note', 'Notes'], mail: ['Email', 'Mail'], person: ['Person', 'People'], org: ['Organisation', 'Organisations'],
  event: ['Event', 'Events'], task: ['Task', 'Tasks'], project: ['Project', 'Projects'], place: ['Place', 'Places'], bookmark: ['Saved page', 'Saved pages'],
  meeting: ['Meeting', 'Meetings'], app: ['App', 'Apps'], tag: ['Tag', 'Tags'], folder: ['Folder', 'Folders'], source: ['Source', 'Sources'],
};

/** Why two things are linked, in plain words. */
export const REASON_LABEL: Record<Reason, string> = {
  emailed: 'Emailed', attended: 'Attended', mentioned: 'Mentioned in', attached: 'Attached to', linked: 'Linked', project: 'Same project', tagged: 'Tagged',
  time: 'Near in time', place: 'Same place', similar: 'Similar meaning', works: 'Works at', recorded: 'Recorded in', folder: 'In folder', source: 'Same source',
};

// ---------------------------------------------------------------- what the parts hand in

export interface Addr { name?: string; address: string }

export interface MailIn {
  /** Keeper's message id (account:folder:uid) */
  id: string;
  /** the conversation it belongs to */
  thread: string;
  subject: string;
  from?: Addr;
  to: Addr[];
  cc?: Addr[];
  date: number;
  account: string;
  folder: string;
  /** the Message-ID header */
  messageId?: string;
  text?: string;
  attachments?: string[];
}

export interface ContactIn { id: string; name: string; emails: string[]; org?: string; note?: string }

export interface EventIn {
  id: string;
  uid?: string;
  title: string;
  start: number;
  end: number;
  allDay?: boolean;
  location?: string;
  description?: string;
  attendees?: Addr[];
  organizer?: Addr;
  /** the account its calendar belongs to */
  calendar?: string;
}

export interface TaskIn { id: string; title: string; notes?: string; due?: number; created?: number; done?: boolean; project?: string; url?: string }
export interface PlaceIn { id: string; name: string; kind?: string }
export interface BookmarkIn { id: string; title: string; url: string; added: number; text?: string; site?: string }
export interface MeetingIn {
  id: string;
  title: string;
  start: number;
  end: number;
  app?: string;
  eventId?: string;
  /** e-mail addresses or names */
  attendees?: string[];
  /** speakers the person named */
  speakers?: string[];
  text?: string;
  notePath?: string;
}

export interface Sources {
  files?: GraphFile[];
  mail?: MailIn[];
  contacts?: ContactIn[];
  events?: EventIn[];
  tasks?: TaskIn[];
  places?: PlaceIn[];
  bookmarks?: BookmarkIn[];
  meetings?: MeetingIn[];
  /** the person's own addresses (never a node: they would link to everything) */
  me?: string[];
}

// ---------------------------------------------------------------- names, addresses, organisations

const FREE_MAIL = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'hotmail.co.uk', 'live.com', 'msn.com', 'yahoo.com', 'yahoo.co.uk', 'ymail.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'gmx.de', 'gmx.net', 'gmx.com', 'web.de', 'proton.me', 'protonmail.com', 'pm.me', 'mail.com', 'yandex.ru', 'yandex.com', 'fastmail.com', 'fastmail.fm', 'hey.com', 'zoho.com', 'qq.com', '163.com', 't-online.de', 'orange.fr', 'free.fr', 'libero.it', 'btinternet.com', 'sky.com', 'mailbox.org', 'posteo.de', 'tutanota.com', 'tuta.io']);
const ROLE = /^(no-?reply|do-?not-?reply|donotreply|info|support|hello|hi|team|notifications?|notify|news|newsletters?|mailer-daemon|postmaster|billing|invoices?|admin|contact|sales|help|service|office|bounce[s]?|alerts?|updates?|marketing|accounts?|security|receipts?)$/i;
const TWO_PART_TLD = /^(co|com|org|net|ac|gov|ltd|plc)\.[a-z]{2}$/;
const ORG_SUFFIX_WORDS = /\b(inc|ltd|llc|gmbh|ag|sa|s a|bv|ab|oy|oü|ou|corp|corporation|company|co|limited|plc|kg|se|srl|spa|pty|nv)\b\.?/g;

/** One way of writing an address: lower case, no "+tag", Gmail's dots ignored. */
export function normEmail(e: string): string {
  const s = e.trim().toLowerCase().replace(/^mailto:/, '');
  const at = s.lastIndexOf('@');
  if (at < 1) return s;
  let local = s.slice(0, at).replace(/\+.*$/, '');
  let domain = s.slice(at + 1);
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.replace(/\./g, '');
  return `${local}@${domain}`;
}

/** One way of writing a name: no accents, titles or quotes; "Fischer, Lena" is "lena fischer". */
export function normName(n: string): string {
  let s = n.normalize('NFD').replace(/\p{M}/gu, '').replace(/["'“”‘’`]/g, '').replace(/\(.*?\)/g, ' ').replace(/<.*?>/g, ' ').trim();
  const comma = s.match(/^([^,]+),\s*([^,]+)$/);
  if (comma) s = `${comma[2]} ${comma[1]}`;
  return s.toLowerCase().replace(/\./g, ' ').replace(/[^\p{L}\p{N}\- ]/gu, ' ').replace(/\b(dr|mr|mrs|ms|mx|prof|sir|herr|frau)\s+/g, '').replace(/\s+/g, ' ').trim();
}

/** A name worth merging people on: two to four words of letters. */
export function isFullName(norm: string): boolean {
  const w = norm.split(' ');
  return w.length >= 2 && w.length <= 4 && w.every((x) => /^\p{L}[\p{L}-]*$/u.test(x)) && w.some((x) => x.length > 1);
}

/** "lena.fischer@…" names Lena Fischer; "lf@…" names nobody. */
export function nameFromEmail(e: string): string | undefined {
  const local = normEmail(e).split('@')[0];
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length < 2 || parts.length > 3 || !parts.every((p) => /^[a-zÀ-ɏ]{2,}$/.test(p))) return undefined;
  return parts.join(' ');
}

export const isRoleAddress = (e: string) => ROLE.test(normEmail(e).split('@')[0]);

/** The organisation part of a domain: mail.acme-property.co.uk → acme-property. */
export function domainName(domain: string): string | undefined {
  const d = domain.toLowerCase().replace(/^.*@/, '');
  if (FREE_MAIL.has(d)) return undefined;
  const parts = d.split('.');
  if (parts.length < 2) return undefined;
  const two = parts.slice(-2).join('.');
  const label = TWO_PART_TLD.test(two) && parts.length >= 3 ? parts[parts.length - 3] : parts[parts.length - 2];
  return label && label !== 'example' ? label : parts.length >= 3 ? parts[parts.length - 3] : label;
}

/** One way of writing an organisation's name: "Acme Property GmbH", "acme-property" → "acme property". */
export function normOrg(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[-_&+]/g, ' ').replace(ORG_SUFFIX_WORDS, ' ').replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();
}

const titleCase = (s: string) => s.split(' ').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
const ORG_IN_TEXT = /\b(?:Inc|Ltd|LLC|GmbH|OÜ|AG|SA|BV|AB|Oy|Corp|Corporation|Company|Limited|PLC)\.?$/;

/** A short date for reasons ("3 Nov 2026"). */
export function shortDate(t: number): string {
  return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

class UnionFind {
  private p = new Map<string, string>();
  find(x: string): string {
    let r = this.p.get(x) ?? x;
    if (r === x) { if (!this.p.has(x)) this.p.set(x, x); return x; }
    r = this.find(r);
    this.p.set(x, r);
    return r;
  }
  union(a: string, b: string) {
    const x = this.find(a), y = this.find(b);
    if (x !== y) this.p.set(x < y ? y : x, x < y ? x : y);
  }
  keys() { return this.p.keys(); }
  has(x: string) { return this.p.has(x); }
}

// ---------------------------------------------------------------- fragments

/** A person as one item names them: their addresses and names (keys e:… and n:…). */
export interface PersonFact { keys: string[]; names: string[]; emails: string[]; org?: string; contact?: boolean }

export interface FNode {
  id: string;
  kind: ItemKind;
  label: string;
  sub?: string;
  time?: number;
  end?: number;
  path?: string;
  /** what opening it needs: a message id, an event id, a web address… */
  ref?: string;
  location?: string;
  allDay?: boolean;
  /** how many items were folded into it (messages in a thread) */
  count?: number;
}

/** A link from a fragment. `b` is a node id, or a reference: @p:<key> a person, @o:<name> an organisation, @m:<text> a name in text, @h:<handle> another item. */
export interface FEdge { a: string; b: string; reason: Reason; why: string; w?: number }

export interface Frag {
  key: string;
  sig: string;
  nodes: FNode[];
  people: PersonFact[];
  edges: FEdge[];
  /** names other items can link to this one by: stem:…, path:…, name:…, mid:…, ev:… */
  handles: [string, string][];
}

const personFact = (a: Addr | string, me: Set<string>, extra: Partial<PersonFact> = {}): PersonFact | null => {
  const addr = typeof a === 'string' ? (a.includes('@') ? a : '') : a.address;
  const name = typeof a === 'string' ? (a.includes('@') ? '' : a) : a.name ?? '';
  const keys: string[] = [];
  const emails: string[] = [];
  const names: string[] = [];
  if (addr) {
    const e = normEmail(addr);
    if (me.has(e)) return null;
    keys.push(`e:${e}`);
    emails.push(addr.trim().toLowerCase());
  }
  const n = normName(name);
  if (n && isFullName(n) && !n.includes('@')) { keys.push(`n:${n}`); names.push(name.trim().replace(/^["']|["']$/g, '')); }
  else if (name.trim() && !name.includes('@')) names.push(name.trim().replace(/^["']|["']$/g, ''));
  if (addr && !names.length) {
    const g = nameFromEmail(addr);
    if (g) keys.push(`n:${g}`);
  }
  if (!keys.length) return null;
  return { keys, names, emails, ...extra };
};

const refOf = (f: PersonFact) => `@p:${f.keys[0]}`;
const lowerPath = (p: string) => p.replace(/\\/g, '/').toLowerCase();
const stemOf = (n: string) => n.replace(/\.[^.]+$/, '');
const dirOf = (p: string) => { const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')); return i > 0 ? p.slice(0, i) : p; };
const baseOf = (p: string) => p.split(/[\\/]/).pop() ?? p;
const KEEPER_MAIL = /keeper:\/\/mail\/([^\s)\]>"']+)/g;
const mentionsIn = (text: string, max = 12) => (text ? extractEntities(text, max) : []);

/** Mail ids in keeper://mail/… links. */
function mailLinks(text?: string): string[] {
  if (!text) return [];
  return [...text.matchAll(KEEPER_MAIL)].map((m) => { try { return decodeURIComponent(m[1]); } catch { return m[1]; } });
}

function fileFrag(f: GraphFile, entities: boolean, folders: boolean): Frag {
  const id = `f:${f.path}`;
  const note = /\.(md|markdown)$/i.test(f.name);
  const text = f.text ?? '';
  const fr: Frag = { key: id, sig: '', nodes: [{ id, kind: note ? 'note' : 'file', label: note ? stemOf(f.name) : f.name, time: f.mtime, path: f.path, sub: f.kind }], people: [], edges: [], handles: [[`stem:${stemOf(f.name).toLowerCase()}`, id], [`path:${lowerPath(f.path)}`, id], [`name:${f.name.toLowerCase()}`, id]] };
  if (text) {
    const { wiki, md } = extractLinks(text);
    for (const w of wiki) fr.edges.push({ a: id, b: `@h:stem:${stemOf(baseOf(w)).toLowerCase()}`, reason: 'linked', why: `“${stemOf(f.name)}” links to [[${w}]]`, w: 2 });
    for (const m of md) {
      const abs = (lowerPath(dirOf(f.path)) + '/' + m.toLowerCase()).split('/').reduce<string[]>((acc, part) => (part === '..' ? acc.slice(0, -1) : part === '.' || part === '' ? acc : [...acc, part]), []).join('/');
      fr.edges.push({ a: id, b: `@h:path:${f.path.startsWith('/') ? '/' : ''}${abs}`, reason: 'linked', why: `“${stemOf(f.name)}” links to ${baseOf(m)}`, w: 2 });
    }
    for (const mid of mailLinks(text)) fr.edges.push({ a: id, b: `@h:mid:${mid}`, reason: 'linked', why: `“${stemOf(f.name)}” links to this email`, w: 2 });
  }
  const tags = new Set([...(f.tags ?? []).map((t) => t.toLowerCase()), ...(text && /\.(md|markdown|txt)$/i.test(f.name) ? extractHashTags(text) : [])]);
  for (const t of tags) {
    fr.nodes.push({ id: `t:${t}`, kind: 'tag', label: `#${t}` });
    fr.edges.push({ a: id, b: `t:${t}`, reason: 'tagged', why: `Tagged #${t}` });
    fr.edges.push({ a: id, b: `@h:project:${normOrg(t)}`, reason: 'project', why: `Tagged #${t}, like the project` });
  }
  if (f.source) {
    if (/^Mail$/i.test(f.source) || /^keeper:\/\/mail\//.test(f.sourceUrl ?? '')) {
      const mid = f.sourceUrl?.match(/^keeper:\/\/mail\/([^?#]+)/)?.[1];
      if (mid) fr.edges.push({ a: id, b: `@h:mid:${decodeURIComponent(mid)}`, reason: 'attached', why: `“${f.name}” was saved from this email`, w: 3 });
    } else {
      const sid = `s:${f.source.toLowerCase()}`;
      fr.nodes.push({ id: sid, kind: 'source', label: f.source });
      fr.edges.push({ a: id, b: sid, reason: 'source', why: `Downloaded from ${f.source}`, w: 0.5 });
    }
  }
  if (entities && text) for (const e of mentionsIn(text)) fr.edges.push({ a: id, b: `@m:${e}`, reason: 'mentioned', why: `Named in “${note ? stemOf(f.name) : f.name}”` });
  if (folders) {
    const d = dirOf(f.path);
    fr.nodes.push({ id: `d:${d}`, kind: 'folder', label: baseOf(d) || d, path: d });
    fr.edges.push({ a: id, b: `d:${d}`, reason: 'folder', why: `In ${baseOf(d) || d}`, w: 0.5 });
  }
  return fr;
}

function mailFrag(m: MailIn, me: Set<string>): Frag {
  const id = `m:${m.thread}`;
  // A conversation is named by its subject without "Re:" and "Fwd:".
  const fr: Frag = { key: `mail:${m.id}`, sig: '', nodes: [{ id, kind: 'mail', label: m.subject.replace(/^(\s*(re|fw|fwd|aw|sv|wg|tr)\s*(\[\d+\])?\s*:\s*)+/i, '').trim() || '(no subject)', time: m.date, ref: m.id, sub: m.from?.name || m.from?.address, count: 1 }], people: [], edges: [], handles: [[`mid:${m.id}`, id], ...(m.messageId ? [[`mid:${m.messageId.replace(/^<|>$/g, '')}`, id] as [string, string]] : [])] };
  const when = shortDate(m.date);
  const subj = m.subject || '(no subject)';
  // {who} becomes the person's own name when the graph is put together.
  const who = (a: Addr) => a.name || '{who}';
  const add = (a: Addr, role: 'from' | 'to') => {
    if (isRoleAddress(a.address)) {
      const dn = domainName(a.address.split('@')[1] ?? '');
      if (dn && role === 'from') fr.edges.push({ a: id, b: `@o:${normOrg(dn)}`, reason: 'emailed', why: `${who(a)} wrote “${subj}” · ${when}`, w: 0.5 });
      return;
    }
    const f = personFact(a, me);
    if (!f) return;
    fr.people.push(f);
    fr.edges.push({ a: refOf(f), b: id, reason: 'emailed', why: role === 'from' ? `${who(a)} wrote “${subj}” · ${when}` : `Sent to ${who(a)} · ${when}`, w: role === 'from' ? 1.5 : 1 });
  };
  if (m.from) add(m.from, 'from');
  for (const a of [...m.to, ...(m.cc ?? [])].slice(0, 25)) add(a, 'to');
  for (const att of m.attachments ?? []) fr.edges.push({ a: id, b: `@h:name:${att.toLowerCase()}`, reason: 'attached', why: `“${att}” came with “${subj}”`, w: 3 });
  for (const e of mentionsIn(`${m.subject}\n${m.text ?? ''}`, 8)) fr.edges.push({ a: id, b: `@m:${e}`, reason: 'mentioned', why: `Named in “${subj}”` });
  return fr;
}

function contactFrag(c: ContactIn, me: Set<string>): Frag {
  const fr: Frag = { key: `contact:${c.id}`, sig: '', nodes: [], people: [], edges: [], handles: [] };
  const keys: string[] = [];
  for (const e of c.emails) { const n = normEmail(e); if (!me.has(n)) keys.push(`e:${n}`); }
  const n = normName(c.name);
  if (n && isFullName(n)) keys.push(`n:${n}`);
  if (keys.length) fr.people.push({ keys, names: c.name ? [c.name] : [], emails: c.emails.map((e) => e.toLowerCase()), org: c.org, contact: true });
  return fr;
}

function eventFrag(e: EventIn, me: Set<string>): Frag {
  const id = `ev:${e.id}`;
  const fr: Frag = { key: id, sig: '', nodes: [{ id, kind: 'event', label: e.title || 'Event', time: e.start, end: e.end, allDay: e.allDay, location: e.location, ref: e.id, sub: e.location }], people: [], edges: [], handles: [[`ev:${e.id}`, id], ...(e.uid ? [[`evuid:${e.uid}`, id] as [string, string]] : [])] };
  const t = e.title || 'the event';
  if (e.organizer) {
    const f = personFact(e.organizer, me);
    if (f) { fr.people.push(f); fr.edges.push({ a: refOf(f), b: id, reason: 'attended', why: `${e.organizer.name || '{who}'} organised “${t}” · ${shortDate(e.start)}`, w: 1.5 }); }
  }
  for (const a of (e.attendees ?? []).slice(0, 40)) {
    const f = personFact(a, me);
    if (!f) continue;
    fr.people.push(f);
    fr.edges.push({ a: refOf(f), b: id, reason: 'attended', why: `${a.name || '{who}'} was invited to “${t}” · ${shortDate(e.start)}`, w: 1.2 });
  }
  for (const mid of mailLinks(e.description)) fr.edges.push({ a: id, b: `@h:mid:${mid}`, reason: 'linked', why: `“${t}” was made from this email`, w: 2 });
  for (const n of mentionsIn(`${e.title}\n${e.description ?? ''}`, 8)) fr.edges.push({ a: id, b: `@m:${n}`, reason: 'mentioned', why: `Named in “${t}”` });
  return fr;
}

function taskFrag(t: TaskIn): Frag {
  const id = `tk:${t.id}`;
  const fr: Frag = { key: id, sig: '', nodes: [{ id, kind: 'task', label: t.title || 'Task', time: t.due ?? t.created, ref: t.id, sub: t.done ? 'Done' : t.due ? `Due ${shortDate(t.due)}` : undefined }], people: [], edges: [], handles: [[`task:${t.id}`, id]] };
  const p = t.project?.replace(/^#/, '').trim();
  if (p) {
    const pid = `pr:${normOrg(p)}`;
    fr.nodes.push({ id: pid, kind: 'project', label: p });
    fr.handles.push([`project:${normOrg(p)}`, pid]);
    fr.edges.push({ a: id, b: pid, reason: 'project', why: `In the project ${p}`, w: 1.5 });
  }
  for (const mid of [...mailLinks(t.url), ...mailLinks(t.notes)]) fr.edges.push({ a: id, b: `@h:mid:${mid}`, reason: 'linked', why: `“${t.title}” was made from this email`, w: 2 });
  for (const n of mentionsIn(`${t.title}\n${t.notes ?? ''}`, 6)) fr.edges.push({ a: id, b: `@m:${n}`, reason: 'mentioned', why: `Named in the task “${t.title}”` });
  return fr;
}

function meetingFrag(m: MeetingIn, me: Set<string>): Frag {
  const id = `mt:${m.id}`;
  const fr: Frag = { key: id, sig: '', nodes: [{ id, kind: 'meeting', label: m.title || 'Meeting', time: m.start, end: m.end, ref: m.id, sub: m.app }], people: [], edges: [], handles: [[`meeting:${m.id}`, id]] };
  const t = m.title || 'the meeting';
  if (m.app) {
    const aid = `ap:${m.app.toLowerCase()}`;
    fr.nodes.push({ id: aid, kind: 'app', label: m.app });
    fr.edges.push({ a: id, b: aid, reason: 'recorded', why: `“${t}” was recorded in ${m.app}`, w: 0.8 });
  }
  if (m.eventId) fr.edges.push({ a: id, b: `@h:ev:${m.eventId}`, reason: 'linked', why: `Recorded during the calendar event`, w: 3 });
  if (m.notePath) fr.edges.push({ a: id, b: `@h:path:${lowerPath(m.notePath)}`, reason: 'linked', why: `The notes written for “${t}”`, w: 3 });
  for (const a of [...(m.attendees ?? []), ...(m.speakers ?? []).filter((s) => !/^speaker\s*\d+$/i.test(s))].slice(0, 30)) {
    const f = personFact(a, me);
    if (!f) continue;
    fr.people.push(f);
    fr.edges.push({ a: refOf(f), b: id, reason: 'attended', why: `${a.includes('@') ? '{who}' : a} was in “${t}” · ${shortDate(m.start)}`, w: 1.5 });
  }
  for (const n of mentionsIn(m.text ?? '', 10)) fr.edges.push({ a: id, b: `@m:${n}`, reason: 'mentioned', why: `Named in “${t}”` });
  return fr;
}

function placeFrag(p: PlaceIn): Frag {
  const id = `pl:${p.id}`;
  return { key: id, sig: '', nodes: [{ id, kind: 'place', label: p.name, sub: p.kind && p.kind !== 'other' ? p.kind : undefined }], people: [], edges: [], handles: [[`place:${normOrg(p.name)}`, id]] };
}

function bookmarkFrag(b: BookmarkIn): Frag {
  const id = `bm:${b.id}`;
  const fr: Frag = { key: id, sig: '', nodes: [{ id, kind: 'bookmark', label: b.title || b.url, time: b.added, ref: b.url, sub: b.site }], people: [], edges: [], handles: [[`url:${b.url}`, id]] };
  if (b.site) {
    const sid = `s:${b.site.toLowerCase()}`;
    fr.nodes.push({ id: sid, kind: 'source', label: b.site });
    fr.edges.push({ a: id, b: sid, reason: 'source', why: `Saved from ${b.site}`, w: 0.5 });
  }
  for (const n of mentionsIn(`${b.title}\n${b.text ?? ''}`, 8)) fr.edges.push({ a: id, b: `@m:${n}`, reason: 'mentioned', why: `Named in “${b.title}”` });
  return fr;
}

// ---------------------------------------------------------------- the graph

export interface KNode extends FNode {
  degree: number;
  /** other names and addresses (people) */
  aliases?: string[];
  emails?: string[];
  /** for a summary node: how many items it stands for */
  cluster?: number;
}

export interface KEdge {
  a: string;
  b: string;
  reason: Reason;
  w: number;
  /** why the link exists, in a sentence or three */
  why: string[];
}

export interface KnowledgeGraph {
  nodes: KNode[];
  edges: KEdge[];
  byId: Map<string, KNode>;
  /** edge numbers per node */
  adj: Map<string, number[]>;
  /** e:<address> / n:<name> → person node id */
  people: Map<string, string>;
  handles: Map<string, string[]>;
}

export interface BuildOptions {
  entities?: boolean;
  folders?: boolean;
  /** links per event to things that happened during it */
  nearPerEvent?: number;
}

const MS_MIN = 60_000;

/** Holds the fragments of everything and puts them together; only changed items are read again. */
export class GraphStore {
  private frags = new Map<string, Frag>();
  private cache: KnowledgeGraph | null = null;
  /** how many items have been read (for tests and the status line) */
  extracted = 0;
  constructor(private o: BuildOptions = {}) {}

  get size() { return this.frags.size; }

  /** Brings the store in line with what the parts hold now. Items not handed in are dropped. */
  update(s: Sources): { added: number; changed: number; removed: number } {
    const me = new Set((s.me ?? []).map(normEmail));
    const seen = new Set<string>();
    let added = 0, changed = 0;
    const put = (key: string, sig: string, make: () => Frag) => {
      seen.add(key);
      const old = this.frags.get(key);
      if (old && old.sig === sig) return;
      const f = make();
      f.key = key;
      f.sig = sig;
      this.extracted++;
      this.frags.set(key, f);
      if (old) changed++; else added++;
    };
    const meSig = [...me].sort().join(',');
    const ents = this.o.entities !== false, folders = this.o.folders !== false;
    for (const f of s.files ?? []) put(`f:${f.path}`, `${f.mtime}|${f.text?.length ?? 0}|${(f.tags ?? []).join(',')}|${f.source ?? ''}|${f.sourceUrl ?? ''}|${f.name}`, () => fileFrag(f, ents, folders));
    for (const m of s.mail ?? []) put(`mail:${m.id}`, `${m.thread}|${m.subject}|${m.date}|${m.text?.length ?? 0}|${(m.attachments ?? []).join(',')}|${meSig}|${[m.from, ...m.to, ...(m.cc ?? [])].map((a) => a && `${a.name}<${a.address}>`).join(',')}`, () => mailFrag(m, me));
    for (const c of s.contacts ?? []) put(`contact:${c.id}`, `${c.name}|${c.emails.join(',')}|${c.org ?? ''}|${meSig}`, () => contactFrag(c, me));
    for (const e of s.events ?? []) put(`ev:${e.id}`, `${e.title}|${e.start}|${e.end}|${e.location ?? ''}|${e.description?.length ?? 0}|${(e.attendees ?? []).map((a) => a.address).join(',')}|${e.organizer?.address ?? ''}|${meSig}`, () => eventFrag(e, me));
    for (const t of s.tasks ?? []) put(`tk:${t.id}`, `${t.title}|${t.notes?.length ?? 0}|${t.due ?? ''}|${t.done}|${t.project ?? ''}|${t.url ?? ''}`, () => taskFrag(t));
    for (const p of s.places ?? []) put(`pl:${p.id}`, `${p.name}|${p.kind ?? ''}`, () => placeFrag(p));
    for (const b of s.bookmarks ?? []) put(`bm:${b.id}`, `${b.title}|${b.url}|${b.text?.length ?? 0}`, () => bookmarkFrag(b));
    for (const m of s.meetings ?? []) put(`mt:${m.id}`, `${m.title}|${m.start}|${m.end}|${m.text?.length ?? 0}|${m.eventId ?? ''}|${m.notePath ?? ''}|${(m.attendees ?? []).join(',')}|${(m.speakers ?? []).join(',')}|${meSig}`, () => meetingFrag(m, me));
    let removed = 0;
    for (const k of [...this.frags.keys()]) if (!seen.has(k)) { this.frags.delete(k); removed++; }
    if (added || changed || removed) this.cache = null;
    return { added, changed, removed };
  }

  /** The whole graph, put together (kept until something changes). */
  graph(): KnowledgeGraph {
    this.cache ??= assemble([...this.frags.values()], this.o);
    return this.cache;
  }

  toJSON() {
    return { v: 1, extracted: this.extracted, frags: [...this.frags.values()] };
  }

  load(data: unknown): boolean {
    const d = data as { v?: number; frags?: Frag[] };
    if (!d || d.v !== 1 || !Array.isArray(d.frags)) return false;
    this.frags = new Map(d.frags.filter((f) => f && typeof f.key === 'string').map((f) => [f.key, f]));
    this.cache = null;
    return true;
  }
}

/** Builds the graph in one go (tests, the preview window, small data). */
export function buildEverything(s: Sources, o: BuildOptions = {}): KnowledgeGraph {
  const st = new GraphStore(o);
  st.update(s);
  return st.graph();
}

export function assemble(frags: Frag[], o: BuildOptions = {}): KnowledgeGraph {
  // 1. People: every address and full name an item gives for one person joins them.
  const uf = new UnionFind();
  const names = new Map<string, Map<string, number>>();
  const emails = new Map<string, Set<string>>();
  const orgs = new Map<string, string>();
  for (const fr of frags) for (const p of fr.people) {
    for (const k of p.keys) uf.find(k);
    for (let i = 1; i < p.keys.length; i++) uf.union(p.keys[0], p.keys[i]);
    for (const n of p.names) { const m = names.get(p.keys[0]) ?? new Map(); m.set(n, (m.get(n) ?? 0) + (p.contact ? 100 : 1)); names.set(p.keys[0], m); }
    for (const e of p.emails) { const s = emails.get(p.keys[0]) ?? new Set(); s.add(e); emails.set(p.keys[0], s); }
    if (p.org) orgs.set(p.keys[0], p.org);
  }
  // "L. Fischer" is Lena Fischer when she is the only Fischer whose name starts with L.
  const byLast = new Map<string, string[]>();
  const nameKeys = [...uf.keys()].filter((k) => k.startsWith('n:'));
  for (const k of nameKeys) {
    const w = k.slice(2).split(' ');
    if (w[0].length > 1) byLast.set(w[w.length - 1], [...(byLast.get(w[w.length - 1]) ?? []), k]);
  }
  for (const k of nameKeys) {
    const w = k.slice(2).split(' ');
    if (w[0].length !== 1) continue;
    const c = (byLast.get(w[w.length - 1]) ?? []).filter((x) => x.slice(2)[0] === w[0]);
    const roots = new Set(c.map((x) => uf.find(x)));
    if (roots.size === 1) uf.union(k, c[0]);
  }
  // One node per group, named by its contact card, else the name used most, else the address.
  const groups = new Map<string, string[]>();
  for (const k of uf.keys()) { const r = uf.find(k); groups.set(r, [...(groups.get(r) ?? []), k]); }
  const nodes = new Map<string, KNode>();
  const people = new Map<string, string>();
  const personOrg = new Map<string, string>();
  for (const keys of groups.values()) {
    const sorted = [...keys].sort((a, b) => Number(b.startsWith('e:')) - Number(a.startsWith('e:')) || (a < b ? -1 : 1));
    const id = `pe:${sorted[0].slice(2)}`;
    const counts = new Map<string, number>();
    const mails = new Set<string>();
    let org: string | undefined;
    for (const k of keys) {
      for (const [n, c] of names.get(k) ?? []) counts.set(n, (counts.get(n) ?? 0) + c);
      for (const e of emails.get(k) ?? []) mails.add(e);
      if (k.startsWith('e:')) mails.add(k.slice(2));
      org ??= orgs.get(k);
    }
    const ranked = [...counts.entries()].sort((a, b) => Number(isFullName(normName(b[0]))) - Number(isFullName(normName(a[0]))) || b[1] - a[1]);
    const nameKey = sorted.find((k) => k.startsWith('n:'));
    const label = ranked[0]?.[0] || (nameKey ? titleCase(nameKey.slice(2)) : [...mails][0] ?? sorted[0].slice(2));
    const uniqMails = [...new Map([...mails].sort((a, b) => b.length - a.length).map((m) => [normEmail(m), m])).values()].sort((a, b) => a.length - b.length);
    const aliases = [...new Map([...counts.keys(), ...(nameKey ? [titleCase(nameKey.slice(2))] : [])].map((n) => [normName(n), n])).values()].filter((n) => normName(n) !== normName(label));
    nodes.set(id, { id, kind: 'person', label, degree: 0, emails: uniqMails, aliases: aliases.length ? aliases : undefined, sub: uniqMails[0] });
    for (const k of keys) people.set(k, id);
    // Their organisation: the card's, or the company domain of an address.
    const dom = uniqMails.map((m) => domainName(m.split('@')[1] ?? '')).find(Boolean);
    if (org || dom) personOrg.set(id, org ?? dom!);
  }

  // 2. Organisations, by one way of writing their name.
  const orgLabel = new Map<string, string>();
  const domainToOrg = new Map<string, string>();
  for (const [pid, o2] of personOrg) {
    const p = nodes.get(pid)!;
    const dom = p.emails?.map((m) => domainName(m.split('@')[1] ?? '')).find(Boolean);
    const fromCard = o2 !== dom;
    const key = normOrg(o2);
    if (!key) continue;
    if (fromCard) orgLabel.set(key, o2);
    else if (!orgLabel.has(key)) orgLabel.set(key, titleCase(o2.replace(/[-_]/g, ' ')));
    if (dom && fromCard) domainToOrg.set(normOrg(dom), key);
  }
  const orgId = (key: string) => {
    const k = domainToOrg.get(key) ?? key;
    const id = `or:${k}`;
    if (!nodes.has(id)) nodes.set(id, { id, kind: 'org', label: orgLabel.get(k) ?? titleCase(k), degree: 0 });
    return id;
  };

  for (const o2 of personOrg.values()) if (normOrg(o2)) orgId(normOrg(o2));

  // 3. Item nodes (a thread made of many messages is one node) and handles.
  const handles = new Map<string, string[]>();
  for (const fr of frags) {
    for (const n of fr.nodes) {
      const cur = nodes.get(n.id);
      if (!cur) nodes.set(n.id, { ...n, degree: 0 });
      else if (n.kind === 'mail') {
        cur.count = (cur.count ?? 1) + 1;
        if ((n.time ?? 0) > (cur.time ?? 0)) { cur.time = n.time; cur.ref = n.ref; cur.sub = n.sub; }
      }
    }
    for (const [h, id] of fr.handles) { const l = handles.get(h); if (!l) handles.set(h, [id]); else if (!l.includes(id)) l.push(id); }
  }

  // 4. Links: references resolved; a name in text becomes a person or organisation
  // when someone already is that person, or when two or more items name it.
  const edges = new Map<string, KEdge>();
  const addEdge = (a: string, b: string, reason: Reason, why: string, w = 1) => {
    if (a === b || !nodes.has(a) || !nodes.has(b)) return;
    const [x, y] = a < b ? [a, b] : [b, a];
    const key = `${x}\u0000${y}\u0000${reason}`;
    const e = edges.get(key);
    if (e) { e.w += w; if (e.why.length < 3 && !e.why.includes(why)) e.why.push(why); }
    else edges.set(key, { a: x, b: y, reason, w, why: [why] });
  };
  // "L. Fischer" in a text: the one person called Fischer whose name starts with L.
  const byInitial = (n: string): string | undefined => {
    const w = n.split(' ');
    if (w.length !== 2 || w[0].length !== 1) return undefined;
    const ids = new Set((byLast.get(w[1]) ?? []).filter((k) => k[2] === w[0]).map((k) => people.get(k)));
    return ids.size === 1 ? [...ids][0] : undefined;
  };
  const mentionLater = new Map<string, { a: string; why: string }[]>();
  const resolve = (ref: string): string[] => {
    if (!ref.startsWith('@')) return [ref];
    if (ref.startsWith('@p:')) { const p = people.get(ref.slice(3)); return p ? [p] : []; }
    if (ref.startsWith('@o:')) return ref.length > 3 ? [orgId(ref.slice(3))] : [];
    if (ref.startsWith('@h:')) return (handles.get(ref.slice(3)) ?? []).slice(0, 3);
    return [];
  };
  for (const fr of frags) for (const e of fr.edges) {
    if (e.b.startsWith('@m:')) {
      const text = e.b.slice(3);
      if (text.includes('@')) {
        const p = people.get(`e:${normEmail(text)}`);
        if (p) addEdge(e.a, p, 'mentioned', e.why, e.w ?? 1);
        continue;
      }
      const n = normName(text);
      const p = people.get(`n:${n}`) ?? byInitial(n);
      if (p) { addEdge(e.a, p, 'mentioned', e.why, e.w ?? 1); continue; }
      const ok = normOrg(text);
      const oid = `or:${domainToOrg.get(ok) ?? ok}`;
      if (ok && nodes.has(oid)) { addEdge(e.a, oid, 'mentioned', e.why, e.w ?? 1); continue; }
      const key = ORG_IN_TEXT.test(text) ? `o|${ok}|${text}` : `p|${n}|${text}`;
      mentionLater.set(key, [...(mentionLater.get(key) ?? []), { a: e.a, why: e.why }]);
      continue;
    }
    for (const a of resolve(e.a)) for (const b of resolve(e.b)) {
      const p = e.a.startsWith('@p:') ? a : e.b.startsWith('@p:') ? b : undefined;
      addEdge(a, b, e.reason, p ? e.why.replace('{who}', nodes.get(p)?.label ?? 'Someone') : e.why, e.w ?? 1);
    }
  }
  for (const [key, list] of mentionLater) {
    const from = [...new Set(list.map((x) => x.a))];
    if (from.length < 2) continue;
    const [kind, norm, label] = key.split('|');
    let id: string;
    if (kind === 'o') id = orgId(norm);
    else {
      id = `pe:${norm}`;
      if (!nodes.has(id)) nodes.set(id, { id, kind: 'person', label, degree: 0 });
      people.set(`n:${norm}`, id);
    }
    for (const x of list) addEdge(x.a, id, 'mentioned', x.why);
  }
  for (const [pid, o2] of personOrg) {
    const k = normOrg(o2);
    if (k) addEdge(pid, orgId(k), 'works', `${nodes.get(pid)!.label} · ${orgLabel.get(domainToOrg.get(k) ?? k) ?? titleCase(k)}`, 0.8);
  }

  // 5. Things that happened during an event, and events at a place.
  const all = [...nodes.values()];
  const timed = all.filter((n) => n.time && (n.kind === 'note' || n.kind === 'file' || n.kind === 'mail' || n.kind === 'meeting')).sort((a, b) => a.time! - b.time!);
  const times = timed.map((n) => n.time!);
  const lower = (t: number) => { let lo = 0, hi = times.length; while (lo < hi) { const m = (lo + hi) >> 1; if (times[m] < t) lo = m + 1; else hi = m; } return lo; };
  const places = all.filter((n) => n.kind === 'place').map((n) => ({ id: n.id, key: normOrg(n.label) })).filter((p) => p.key.length >= 3);
  for (const ev of all.filter((n) => n.kind === 'event')) {
    if (ev.time && ev.end && !ev.allDay && ev.end - ev.time <= 8 * 60 * MS_MIN) {
      const from = ev.time - 10 * MS_MIN, to = ev.end + 10 * MS_MIN;
      const near: KNode[] = [];
      for (let i = lower(from); i < timed.length && times[i] <= to; i++) near.push(timed[i]);
      near.sort((a, b) => Math.abs(a.time! - ev.time!) - Math.abs(b.time! - ev.time!));
      for (const n of near.slice(0, o.nearPerEvent ?? 8)) addEdge(ev.id, n.id, 'time', n.kind === 'mail' ? `“${n.label}” arrived during “${ev.label}”` : n.kind === 'meeting' ? `Recorded during “${ev.label}”` : `Changed during “${ev.label}”`, 0.8);
    }
    if (ev.location) {
      const loc = normOrg(ev.location);
      for (const p of places) if (loc === p.key || (` ${loc} `).includes(` ${p.key} `)) addEdge(ev.id, p.id, 'place', `“${ev.label}” is at ${nodes.get(p.id)!.label}`, 1.2);
    }
  }

  const edgeList = [...edges.values()];
  const adj = new Map<string, number[]>();
  edgeList.forEach((e, i) => {
    nodes.get(e.a)!.degree++;
    nodes.get(e.b)!.degree++;
    (adj.get(e.a) ?? adj.set(e.a, []).get(e.a)!).push(i);
    (adj.get(e.b) ?? adj.set(e.b, []).get(e.b)!).push(i);
  });
  // People and organisations nothing links to are left out (an address seen only on the person themselves).
  const keep = [...nodes.values()].filter((n) => n.degree > 0 || !['person', 'org', 'tag', 'folder', 'source', 'app', 'project'].includes(n.kind));
  return { nodes: keep, edges: edgeList, byId: new Map(keep.map((n) => [n.id, n])), adj, people, handles };
}

// ---------------------------------------------------------------- questions the graph answers

/** A node by what a page knows about it: a file path, a message, an event, an address. */
export type ItemRef = { id: string } | { path: string } | { mail: string } | { event: string } | { email: string } | { task: string } | { meeting: string } | { name: string };

export function resolveRef(g: KnowledgeGraph, r: ItemRef): string | undefined {
  if ('id' in r) return g.byId.has(r.id) ? r.id : undefined;
  if ('path' in r) return g.byId.has(`f:${r.path}`) ? `f:${r.path}` : g.handles.get(`path:${lowerPath(r.path)}`)?.[0];
  if ('mail' in r) return g.handles.get(`mid:${r.mail}`)?.[0];
  if ('event' in r) return g.byId.has(`ev:${r.event}`) ? `ev:${r.event}` : g.handles.get(`evuid:${r.event}`)?.[0];
  if ('task' in r) return g.byId.has(`tk:${r.task}`) ? `tk:${r.task}` : undefined;
  if ('meeting' in r) return g.byId.has(`mt:${r.meeting}`) ? `mt:${r.meeting}` : undefined;
  if ('email' in r) return g.people.get(`e:${normEmail(r.email)}`);
  if ('name' in r) return g.people.get(`n:${normName(r.name)}`) ?? searchNodes(g, r.name, { limit: 1 })[0]?.id;
  return undefined;
}

const otherEnd = (e: KEdge, id: string) => (e.a === id ? e.b : e.a);
const STRUCTURE = new Set<ItemKind>(['folder', 'source', 'tag']);

/** Nodes whose name, other names or addresses match the words; exact names and well-linked ones first. */
export function searchNodes(g: KnowledgeGraph, q: string, o: { kinds?: ItemKind[]; limit?: number } = {}): KNode[] {
  const words = normName(q).split(' ').filter(Boolean);
  if (!words.length) return [];
  const whole = words.join(' ');
  const out: { n: KNode; s: number }[] = [];
  for (const n of g.nodes) {
    if (o.kinds?.length && !o.kinds.includes(n.kind)) continue;
    const hay = normName([n.label, ...(n.aliases ?? []), ...(n.emails ?? [])].join(' ')) + ' ' + [...(n.emails ?? [])].join(' ');
    if (!words.every((w) => hay.includes(w))) continue;
    const exact = normName(n.label) === whole ? 100 : normName(n.label).startsWith(whole) ? 40 : 10;
    const kindBoost = n.kind === 'person' || n.kind === 'org' || n.kind === 'project' ? 15 : STRUCTURE.has(n.kind) ? -5 : 0;
    out.push({ n, s: exact + kindBoost + Math.log2(1 + n.degree) * 4 });
  }
  return out.sort((a, b) => b.s - a.s).slice(0, o.limit ?? 20).map((x) => x.n);
}

export interface GraphView {
  nodes: KNode[];
  edges: KEdge[];
  /** how many of each kind are folded into summary nodes or left out */
  hidden: Partial<Record<ItemKind, number>>;
  /** how many nodes the whole graph has */
  total: number;
  counts: Partial<Record<ItemKind, number>>;
  focus?: string;
}

export interface ViewOptions {
  kinds?: ItemKind[];
  from?: number;
  to?: number;
  focus?: string;
  depth?: number;
  /** most nodes drawn; the rest fold into one summary node per kind */
  max?: number;
  /** extra links by meaning for the focused node */
  similar?: (id: string) => { id: string; score: number }[];
}

const inTime = (n: KNode, from?: number, to?: number) => !n.time || ((from === undefined || (n.end ?? n.time) >= from) && (to === undefined || n.time <= to));

/** What the Graph page draws: a neighbourhood around one thing, or the best-linked part of everything with the rest summed up. */
export function viewOf(g: KnowledgeGraph, o: ViewOptions = {}): GraphView {
  const counts: Partial<Record<ItemKind, number>> = {};
  for (const n of g.nodes) counts[n.kind] = (counts[n.kind] ?? 0) + 1;
  const ok = (n: KNode) => (!o.kinds?.length || o.kinds.includes(n.kind)) && inTime(n, o.from, o.to);
  const max = o.max ?? 1500;
  if (o.focus && g.byId.has(o.focus)) {
    const keep = new Set([o.focus]);
    let frontier = [o.focus];
    for (let d = 0; d < Math.min(3, o.depth ?? 1) && keep.size < max; d++) {
      const next: string[] = [];
      for (const id of frontier) {
        const es = (g.adj.get(id) ?? []).map((i) => g.edges[i]).sort((x, y) => y.w - x.w);
        for (const e of es) {
          const other = otherEnd(e, id);
          const n = g.byId.get(other);
          // Folders and sources hold too much to walk through.
          if (!n || keep.has(other) || !ok(n) || keep.size >= Math.min(max, 400)) continue;
          keep.add(other);
          if (!STRUCTURE.has(n.kind) && (n.degree < 400 || d === 0)) next.push(other);
        }
      }
      frontier = next;
    }
    const nodes = [...keep].map((id) => g.byId.get(id)!);
    const edges = g.edges.filter((e) => keep.has(e.a) && keep.has(e.b));
    if (o.similar) for (const s of o.similar(o.focus).slice(0, 6)) {
      const n = g.byId.get(s.id);
      if (!n || s.score < 0.5) continue;
      if (!keep.has(s.id)) { keep.add(s.id); nodes.push(n); }
      edges.push({ a: o.focus, b: s.id, reason: 'similar', w: s.score, why: [`About the same thing (${Math.round(s.score * 100)}% alike)`] });
    }
    return { nodes, edges, hidden: {}, total: g.nodes.length, counts, focus: o.focus };
  }
  const pool = g.nodes.filter(ok);
  if (pool.length <= max) {
    const ids = new Set(pool.map((n) => n.id));
    return { nodes: pool, edges: g.edges.filter((e) => ids.has(e.a) && ids.has(e.b)), hidden: {}, total: g.nodes.length, counts };
  }
  // Level of detail: the best-linked nodes, and one summary node per kind for the rest.
  const shown = [...pool].sort((a, b) => b.degree - a.degree).slice(0, max);
  const ids = new Set(shown.map((n) => n.id));
  const hidden: Partial<Record<ItemKind, number>> = {};
  const toHub = new Map<string, Map<string, number>>();
  for (const n of pool) {
    if (ids.has(n.id)) continue;
    hidden[n.kind] = (hidden[n.kind] ?? 0) + 1;
    for (const i of g.adj.get(n.id) ?? []) {
      const other = otherEnd(g.edges[i], n.id);
      if (!ids.has(other)) continue;
      const m = toHub.get(n.kind) ?? new Map<string, number>();
      m.set(other, (m.get(other) ?? 0) + 1);
      toHub.set(n.kind, m);
    }
  }
  const nodes: KNode[] = [...shown];
  const edges = g.edges.filter((e) => ids.has(e.a) && ids.has(e.b));
  for (const [kind, n] of Object.entries(hidden) as [ItemKind, number][]) {
    const id = `c:${kind}`;
    nodes.push({ id, kind, label: `${n.toLocaleString('en-GB')} more ${KIND_LABEL[kind][1].toLowerCase()}`, degree: 0, cluster: n });
    for (const [hub, c] of [...(toHub.get(kind) ?? new Map()).entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)) {
      edges.push({ a: id, b: hub, reason: 'linked', w: Math.min(3, c / 5), why: [`${c} of them link to ${g.byId.get(hub)!.label}`] });
    }
  }
  return { nodes, edges, hidden, total: g.nodes.length, counts };
}

export interface RelatedItem {
  node: KNode;
  reason: Reason;
  why: string[];
  /** linked through this person, organisation, project or event */
  via?: KNode;
  score: number;
}

const REASON_RANK: Record<Reason, number> = { attached: 9, linked: 8, attended: 7, emailed: 7, project: 6, mentioned: 5, place: 5, time: 4, similar: 4, works: 4, recorded: 3, tagged: 2, source: 1, folder: 0.5 };

/** What is related to one thing, best first: its own links, then things linked through the people, projects and events it shares. */
export function related(g: KnowledgeGraph, id: string, o: { limit?: number; kinds?: ItemKind[]; similar?: (id: string) => { id: string; score: number }[]; now?: number } = {}): RelatedItem[] {
  const self = g.byId.get(id);
  if (!self) return [];
  const limit = o.limit ?? 12;
  const now = o.now ?? Date.now();
  const recency = (n: KNode) => (n.time ? Math.max(0, 1 - Math.abs(now - n.time) / (365 * 86_400_000)) : 0);
  const out = new Map<string, RelatedItem>();
  const want = (n: KNode) => !STRUCTURE.has(n.kind) && (!o.kinds?.length || o.kinds.includes(n.kind));
  const direct = (g.adj.get(id) ?? []).map((i) => g.edges[i]);
  for (const e of direct) {
    const n = g.byId.get(otherEnd(e, id));
    if (!n || !want(n)) continue;
    const s = REASON_RANK[e.reason] + Math.min(2, e.w) + recency(n);
    const cur = out.get(n.id);
    if (!cur || cur.score < s) out.set(n.id, { node: n, reason: e.reason, why: e.why, score: s });
  }
  for (const s of o.similar?.(id) ?? []) {
    const n = g.byId.get(s.id);
    if (n && s.score >= 0.5 && !out.has(n.id) && want(n)) out.set(n.id, { node: n, reason: 'similar', why: [`About the same thing (${Math.round(s.score * 100)}% alike)`], score: REASON_RANK.similar + s.score });
  }
  if (out.size < limit) {
    // Second step through people, organisations, projects, events and meetings (not through huge hubs).
    const hubs = direct.map((e) => g.byId.get(otherEnd(e, id))!).filter((n) => n && ['person', 'org', 'project', 'event', 'meeting', 'mail'].includes(n.kind) && n.degree < 300);
    for (const h of hubs) {
      for (const i of g.adj.get(h.id) ?? []) {
        const e = g.edges[i];
        const n = g.byId.get(otherEnd(e, h.id));
        if (!n || n.id === id || out.has(n.id) || !want(n) || n.kind === self.kind && n.kind === 'person') continue;
        const s = (REASON_RANK[e.reason] + recency(n)) / 3;
        out.set(n.id, { node: n, reason: e.reason, why: e.why, via: h, score: s });
      }
    }
  }
  return [...out.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

export interface Explanation {
  /** each step: a node, and the link that led to it from the one before */
  steps: { node: KNode; reason?: Reason; why?: string[] }[];
}

/** How two things are connected: the shortest chain of links (up to four), each with its reason. */
export function explain(g: KnowledgeGraph, a: string, b: string, maxDepth = 4): Explanation | null {
  if (!g.byId.has(a) || !g.byId.has(b)) return null;
  if (a === b) return { steps: [{ node: g.byId.get(a)! }] };
  const prev = new Map<string, { from: string; edge: number }>();
  let frontier = [a];
  const seen = new Set([a]);
  for (let d = 0; d < maxDepth && frontier.length; d++) {
    const next: string[] = [];
    for (const id of frontier) {
      // Strongest links first, so the chain shown is the most telling one.
      const es = [...(g.adj.get(id) ?? [])].sort((x, y) => REASON_RANK[g.edges[y].reason] - REASON_RANK[g.edges[x].reason]);
      for (const i of es) {
        const o2 = otherEnd(g.edges[i], id);
        if (seen.has(o2)) continue;
        const n = g.byId.get(o2)!;
        seen.add(o2);
        prev.set(o2, { from: id, edge: i });
        if (o2 === b) {
          const steps: Explanation['steps'] = [];
          let cur = b;
          while (cur !== a) {
            const p = prev.get(cur)!;
            const e = g.edges[p.edge];
            steps.unshift({ node: g.byId.get(cur)!, reason: e.reason, why: e.why });
            cur = p.from;
          }
          steps.unshift({ node: g.byId.get(a)! });
          return { steps };
        }
        // Only walk on through things that say something (not a folder of thousands).
        if (!STRUCTURE.has(n.kind) && n.degree < 500) next.push(o2);
      }
    }
    frontier = next;
  }
  return null;
}

// ---------------------------------------------------------------- privacy

export interface GraphPrivacy {
  mail: boolean;
  calendar: boolean;
  tasks: boolean;
  contacts: boolean;
  meetings: boolean;
  places: boolean;
  reader: boolean;
  /** mail accounts left out, by id */
  leaveOutAccounts: string[];
  /** folders left out: file folders (paths) and mail folders ("<account>:<folder>") */
  leaveOutFolders: string[];
}

export function defaultGraphPrivacy(): GraphPrivacy {
  return { mail: true, calendar: true, tasks: true, contacts: true, meetings: true, places: true, reader: true, leaveOutAccounts: [], leaveOutFolders: [] };
}

export function normalizeGraphPrivacy(raw: unknown): GraphPrivacy {
  const d = defaultGraphPrivacy();
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out = { ...d };
  for (const k of ['mail', 'calendar', 'tasks', 'contacts', 'meetings', 'places', 'reader'] as const) if (typeof r[k] === 'boolean') out[k] = r[k] as boolean;
  for (const k of ['leaveOutAccounts', 'leaveOutFolders'] as const) if (Array.isArray(r[k])) out[k] = (r[k] as unknown[]).filter((x): x is string => typeof x === 'string' && !!x.trim()).slice(0, 200);
  return out;
}

/** Which Keeper parts are on (a part that is off adds nothing). */
export interface PartsOn { mail: boolean; calendars: boolean; planner?: boolean; meetings: boolean; tracks: boolean; reader: boolean; notes?: boolean }

const under = (p: string, dir: string) => {
  const a = lowerPath(p), d = lowerPath(dir).replace(/\/+$/, '');
  return a === d || a.startsWith(d + '/');
};

/** Leaves out what the person chose to keep out, and everything from parts that are off. */
export function applyPrivacy(s: Sources, p: GraphPrivacy, parts: PartsOn): Sources {
  const accounts = new Set(p.leaveOutAccounts);
  const mailFolders = new Set(p.leaveOutFolders.filter((f) => !/^[\\/]|^[a-z]:[\\/]|^~/i.test(f)));
  const fileFolders = p.leaveOutFolders.filter((f) => /^[\\/]|^[a-z]:[\\/]/i.test(f));
  const outside = (path?: string) => !!path && fileFolders.some((d) => under(path, d));
  return {
    ...s,
    files: (s.files ?? []).filter((f) => !outside(f.path)),
    mail: parts.mail && p.mail ? (s.mail ?? []).filter((m) => !accounts.has(m.account) && !mailFolders.has(`${m.account}:${m.folder}`)) : [],
    contacts: (parts.mail || parts.calendars) && p.contacts ? s.contacts ?? [] : [],
    events: parts.calendars && p.calendar ? (s.events ?? []).filter((e) => !e.calendar || !accounts.has(e.calendar)) : [],
    tasks: parts.calendars && p.tasks ? s.tasks ?? [] : [],
    meetings: parts.meetings && p.meetings ? (s.meetings ?? []).filter((m) => !outside(m.notePath)) : [],
    places: parts.tracks && p.places ? s.places ?? [] : [],
    bookmarks: parts.reader && p.reader ? s.bookmarks ?? [] : [],
  };
}
