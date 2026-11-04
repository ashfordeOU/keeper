// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The knowledge graph of everything in the browser demo: the demo notes and
// files with a small made-up life around them (mail with Lena and Marco, a
// lease viewing, a recorded meeting, tasks in projects, places and saved
// pages), built by the real graph code.

import type { AgentsApi, GraphStatus } from '../core/api-agents';
import type { EverythingHit } from '../core/brain/items';
import type { GraphFile } from '../core/graph/build';
import { defaultGraphPrivacy, explain, GraphStore, related, resolveRef, searchNodes, viewOf, type ItemKind, type Sources } from '../core/graph/everything';

const H = 3_600_000;
const D = 24 * H;

export function demoSources(notes: GraphFile[], files: GraphFile[], now = Date.now()): Sources {
  const day = new Date(now);
  day.setHours(10, 0, 0, 0);
  const t0 = day.getTime() - 2 * D;
  const lena = { name: 'Lena Fischer', address: 'lena.fischer@acme-property.example' };
  const marco = { name: 'Marco Rossi', address: 'marco@rossi-accounts.example' };
  const ana = { name: 'Ana Lopez', address: 'ana.lopez@studio-lopez.example' };
  const me = { name: 'Sam', address: 'sam@home.example' };
  return {
    me: [me.address],
    files: [...notes, ...files, { path: `${notes[0]?.path.replace(/[^/]+$/, '') ?? '/'}Lease viewing notes.md`, name: 'Lease viewing notes.md', kind: 'document', mtime: t0 + 0.6 * H, text: 'Walked through the flat with Lena Fischer. Damp in the bathroom; deposit 2,400 EUR. See [[Apartment move]]. #home' }],
    mail: [
      { id: 'acc1:INBOX:41', thread: 'lease', subject: 'Lease renewal and deposit', from: lena, to: [me], date: t0 - 3 * D, account: 'acc1', folder: 'INBOX', text: 'Hi Sam, the new lease is attached. The deposit stays at 2,400 EUR. Can we meet at the flat on Elm Street?', attachments: ['Lease summary.md'] },
      { id: 'acc1:INBOX:44', thread: 'lease', subject: 'Re: Lease renewal and deposit', from: { name: 'Fischer, Lena', address: 'Lena.Fischer@acme-property.example' }, to: [me], date: t0 - 2.5 * D, account: 'acc1', folder: 'INBOX', text: 'Thursday at 10 works. I will bring the keys.' },
      { id: 'acc1:INBOX:52', thread: 'receipts', subject: 'Receipts for the tax return', from: marco, to: [me], date: t0 - 6 * D, account: 'acc1', folder: 'INBOX', text: 'Please send the Café Sol and City Taxi receipts before 31 July.' },
      { id: 'acc1:INBOX:57', thread: 'homepage', subject: 'Homepage drafts', from: ana, to: [me], cc: [marco], date: t0 - 1 * D, account: 'acc1', folder: 'INBOX', text: 'Two directions for the garden blog homepage. Option A has a bigger hero.' },
      { id: 'acc1:INBOX:60', thread: 'billing', subject: 'Your rent receipt', from: { name: 'Acme Billing', address: 'billing@acme-property.example' }, to: [me], date: t0 - 9 * D, account: 'acc1', folder: 'INBOX', text: 'Rent for October received.' },
    ],
    contacts: [
      { id: 'c1', name: 'Lena Fischer', emails: ['lena.fischer@acme-property.example', 'lena@fischer-home.example'], org: 'Acme Property GmbH' },
      { id: 'c2', name: 'Marco Rossi', emails: ['marco@rossi-accounts.example'], org: 'Rossi Accounts' },
    ],
    events: [
      { id: 'cal:lease-viewing', title: 'Lease viewing', start: t0, end: t0 + H, location: 'Flat on Elm Street', attendees: [{ name: 'Lena Fischer', address: 'lena@fischer-home.example' }, me], calendar: 'acc1' },
      { id: 'cal:tax', title: 'Tax return with Marco', start: t0 + 3 * D + 4 * H, end: t0 + 3 * D + 5 * H, attendees: [marco, me], calendar: 'acc1', location: 'Rossi Accounts office' },
      { id: 'cal:garden', title: 'Garden planning', start: t0 + 5 * D, end: t0 + 5 * D + 2 * H, location: 'Allotment', attendees: [ana], calendar: 'acc1' },
    ],
    tasks: [
      { id: 'r1', title: 'Sign the new lease', project: '#home', url: 'keeper://mail/acc1%3AINBOX%3A41', due: t0 + 2 * D },
      { id: 'r2', title: 'Book a van for the move', project: '#home', due: t0 + 9 * D, notes: 'Ask Lena Fischer about parking' },
      { id: 'r3', title: 'Send receipts to Marco', project: '#tax', url: 'keeper://mail/acc1%3AINBOX%3A52', due: t0 + D },
      { id: 'r4', title: 'Order tomato seeds', project: '#garden', due: t0 + 4 * D },
    ],
    meetings: [{ id: 'm1', title: 'Lease viewing', start: t0 + 5 * 60_000, end: t0 + 52 * 60_000, app: 'Keeper', eventId: 'cal:lease-viewing', speakers: ['Lena Fischer'], text: 'Lena Fischer: the deposit is 2,400 EUR. The bathroom will be repainted before March.' }],
    places: [{ id: 'p1', name: 'Elm Street', kind: 'home' }, { id: 'p2', name: 'Allotment' }],
    bookmarks: [{ id: 'b1', title: 'Renting a flat in Berlin: what to check', url: 'https://example.org/renting', added: t0 - 12 * D, site: 'example.org', text: 'Deposits, damp and the handover protocol.' }],
  };
}

export function mockGraph(notes: GraphFile[], files: GraphFile[]): Pick<AgentsApi, 'graphStatus' | 'graphView' | 'graphFind' | 'graphRelated' | 'graphExplain' | 'graphAddToNote' | 'searchEverything'> {
  const store = new GraphStore();
  const src = demoSources(notes, files);
  store.update(src);
  const g = () => store.graph();
  const items: { kind: EverythingHit['kind']; title: string; sub?: string; time?: number; cite: string; text: string }[] = [
    ...(src.mail ?? []).map((m) => ({ kind: 'mail' as const, title: m.subject, sub: m.from?.name, time: m.date, cite: `keeper://mail/${encodeURIComponent(m.id)}`, text: m.text ?? '' })),
    ...(src.events ?? []).map((e) => ({ kind: 'event' as const, title: e.title, sub: e.location, time: e.start, cite: `keeper://event/${encodeURIComponent(e.id)}?at=${e.start}`, text: e.location ?? '' })),
    ...(src.tasks ?? []).map((t) => ({ kind: 'task' as const, title: t.title, sub: t.project, time: t.due, cite: `keeper://task/${t.id}`, text: t.notes ?? '' })),
    ...(src.contacts ?? []).map((c) => ({ kind: 'contact' as const, title: c.name, sub: c.org, cite: `keeper://contact/${encodeURIComponent(c.emails[0])}`, text: c.emails.join(' ') })),
    ...(src.meetings ?? []).map((m) => ({ kind: 'meeting' as const, title: m.title, sub: m.app, time: m.start, cite: `keeper://meeting/${m.id}`, text: m.text ?? '' })),
    ...(src.files ?? []).map((f) => ({ kind: /\.md$/i.test(f.name) ? ('note' as const) : ('file' as const), title: f.name.replace(/\.md$/i, ''), time: f.mtime, cite: f.path, text: f.text ?? '' })),
  ];
  const status = async (): Promise<GraphStatus> => {
    const counts: Partial<Record<ItemKind, number>> = {};
    for (const n of g().nodes) counts[n.kind] = (counts[n.kind] ?? 0) + 1;
    return { on: true, nodes: g().nodes.length, links: g().edges.length, counts, updatedAt: Date.now() - 60_000, lastChange: { added: 0, changed: 2, removed: 0 }, meaning: { on: true, items: items.length, embedded: items.length, pending: 0 }, privacy: defaultGraphPrivacy(), accounts: [{ id: 'acc1', label: 'Home' }], folders: [{ account: 'acc1', path: 'INBOX', name: 'Inbox' }], parts: { mail: true, calendars: true, meetings: true, tracks: true, reader: true, notes: true } };
  };
  return {
    graphStatus: status,
    graphView: async (o = {}) => {
      const focus = typeof o.focus === 'string' ? (g().byId.has(o.focus) ? o.focus : resolveRef(g(), { path: o.focus })) : o.focus ? resolveRef(g(), o.focus) : undefined;
      return viewOf(g(), { ...o, focus });
    },
    graphFind: async (q, kinds) => searchNodes(g(), q, { kinds, limit: 12 }),
    graphRelated: async (ref, o) => {
      const id = resolveRef(g(), ref);
      return id ? { node: g().byId.get(id) ?? null, items: related(g(), id, { limit: o?.limit ?? 8, kinds: o?.kinds }) } : { node: null, items: [] };
    },
    graphExplain: async (a, b) => explain(g(), a, b),
    graphAddToNote: async () => ({ path: 'Daily/today.md' }),
    searchEverything: async (q, o) => {
      const words = q.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
      return items
        .filter((i) => (!o?.kinds?.length || o.kinds.includes(i.kind)) && words.some((w) => `${i.title} ${i.sub ?? ''} ${i.text}`.toLowerCase().includes(w)))
        .map((i): EverythingHit => ({ kind: i.kind, title: i.title, sub: i.sub, time: i.time, cite: i.cite, snippet: i.text.slice(0, 160) || undefined, score: words.filter((w) => `${i.title} ${i.text}`.toLowerCase().includes(w)).length / words.length, why: ['words', 'meaning'] }))
        .sort((a, b) => b.score - a.score)
        .slice(0, o?.limit ?? 20);
    },
  };
}
