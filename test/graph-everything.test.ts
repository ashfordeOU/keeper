// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The knowledge graph of everything: one person however they are written,
// organisations from addresses and cards, a link with a reason for every kind,
// only changed items read again, privacy choices, explanations, the related
// list and level of detail with a hundred thousand nodes.

import { describe, expect, it } from 'vitest';
import {
  applyPrivacy, buildEverything, defaultGraphPrivacy, domainName, explain, GraphStore, isRoleAddress, nameFromEmail, normalizeGraphPrivacy, normEmail, normName, normOrg,
  related, resolveRef, searchNodes, viewOf, type KnowledgeGraph, type Reason, type Sources,
} from '../core/graph/everything';

const T0 = Date.UTC(2026, 10, 3, 9, 0);
const H = 3_600_000;

const demo = (): Sources => ({
  me: ['me@home.example'],
  files: [
    { path: '/h/Notes/Lease viewing.md', name: 'Lease viewing.md', kind: 'document', mtime: T0 + 0.5 * H, text: 'Met Lena Fischer at the flat. See [[Apartment move]]. #home' },
    { path: '/h/Notes/Apartment move.md', name: 'Apartment move.md', kind: 'document', mtime: T0 - 48 * H, text: 'Moving in March with L. Fischer from Acme Property GmbH.' },
    { path: '/h/Downloads/lease.pdf', name: 'lease.pdf', kind: 'document', mtime: T0 - 24 * H, source: 'Mail', sourceUrl: 'keeper://mail/acc1%3AINBOX%3A7', text: 'Lease between Acme Property GmbH and the tenant.' },
    { path: '/h/Downloads/floorplan.png', name: 'floorplan.png', kind: 'image', mtime: T0 - 30 * H },
  ],
  mail: [
    { id: 'acc1:INBOX:7', thread: 't1', subject: 'Lease renewal', from: { name: 'Lena Fischer', address: 'lena.fischer@acme-property.de' }, to: [{ address: 'me@home.example' }], date: T0 - 24 * H, account: 'acc1', folder: 'INBOX', attachments: ['lease.pdf', 'floorplan.png'], text: 'Please sign by Friday.' },
    { id: 'acc1:INBOX:8', thread: 't1', subject: 'Re: Lease renewal', from: { name: 'Fischer, Lena', address: 'Lena.Fischer+lease@ACME-property.de' }, to: [{ address: 'me@home.example' }], date: T0 - 20 * H, account: 'acc1', folder: 'INBOX' },
    { id: 'acc1:INBOX:9', thread: 't2', subject: 'Your receipt', from: { name: 'Acme Billing', address: 'billing@acme-property.de' }, to: [{ address: 'me@home.example' }], date: T0 - 10 * H, account: 'acc1', folder: 'INBOX' },
    { id: 'acc2:INBOX:1', thread: 't3', subject: 'Holiday photos', from: { name: 'Sam Doe', address: 'sam.doe@gmail.com' }, to: [{ address: 'me@home.example' }], date: T0 - 5 * H, account: 'acc2', folder: 'INBOX' },
  ],
  contacts: [{ id: 'c1', name: 'Lena Fischer', emails: ['lena@fischer-family.example', 'lena.fischer@acme-property.de'], org: 'Acme Property GmbH' }],
  events: [{ id: 'cal:e1', uid: 'e1', title: 'Lease viewing', start: T0, end: T0 + H, location: 'Flat on Elm Street, Berlin', attendees: [{ name: 'Lena Fischer', address: 'lena@fischer-family.example' }, { address: 'me@home.example' }], calendar: 'acc1' }],
  tasks: [{ id: 'r1', title: 'Sign the lease', project: '#home', url: 'keeper://mail/acc1%3AINBOX%3A7', due: T0 + 72 * H }],
  places: [{ id: 'p1', name: 'Elm Street' }],
  meetings: [{ id: 'm1', title: 'Lease viewing', start: T0 + 5 * 60_000, end: T0 + 50 * 60_000, app: 'Keeper', eventId: 'cal:e1', speakers: ['Lena Fischer', 'Speaker 2'], notePath: '/h/Notes/Lease viewing.md' }],
  bookmarks: [{ id: 'b1', title: 'Renting in Berlin', url: 'https://example.org/renting', added: T0 - 100 * H, site: 'example.org' }],
});

const edgeBetween = (g: KnowledgeGraph, a: string, b: string, reason?: Reason) => g.edges.find((e) => ((e.a === a && e.b === b) || (e.a === b && e.b === a)) && (!reason || e.reason === reason));

describe('names and addresses', () => {
  it('writes addresses one way', () => {
    expect(normEmail('Lena.Fischer+lease@ACME-property.de')).toBe('lena.fischer@acme-property.de');
    expect(normEmail('j.o.e+x@googlemail.com')).toBe('joe@gmail.com');
    expect(nameFromEmail('lena.fischer@acme.de')).toBe('lena fischer');
    expect(nameFromEmail('lf@acme.de')).toBeUndefined();
    expect(isRoleAddress('no-reply@shop.example')).toBe(true);
    expect(isRoleAddress('lena@shop.example')).toBe(false);
  });
  it('writes names one way, whatever the order, accents and titles', () => {
    expect(normName('Fischer, Lena')).toBe('lena fischer');
    expect(normName('Dr. Zoë Müller')).toBe('zoe muller');
    expect(normName('"Lena Fischer" (Acme)')).toBe('lena fischer');
  });
  it('finds the organisation in a domain and in a name', () => {
    expect(domainName('mail.acme-property.co.uk')).toBe('acme-property');
    expect(domainName('gmail.com')).toBeUndefined();
    expect(normOrg('Acme Property GmbH')).toBe('acme property');
    expect(normOrg('acme-property')).toBe('acme property');
  });
});

describe('one person, many ways of writing them', () => {
  const g = buildEverything(demo());
  it('merges addresses, the card, the name written backwards and initials into one person', () => {
    const people = g.nodes.filter((n) => n.kind === 'person');
    const lena = people.filter((n) => /fischer/i.test(n.label));
    expect(lena).toHaveLength(1);
    expect(lena[0].label).toBe('Lena Fischer');
    expect(lena[0].emails).toEqual(expect.arrayContaining(['lena@fischer-family.example', 'lena.fischer@acme-property.de']));
    expect(resolveRef(g, { email: 'LENA.FISCHER+x@acme-property.de' })).toBe(lena[0].id);
    expect(resolveRef(g, { name: 'Fischer, Lena' })).toBe(lena[0].id);
    // "L. Fischer" in a note is her too.
    expect(edgeBetween(g, 'f:/h/Notes/Apartment move.md', lena[0].id, 'mentioned')).toBeTruthy();
  });
  it('never makes a node of the person themselves, or of a role address', () => {
    expect(g.nodes.some((n) => n.emails?.includes('me@home.example'))).toBe(false);
    expect(g.nodes.some((n) => n.kind === 'person' && /billing/i.test(n.label))).toBe(false);
  });
  it('puts her in her organisation, which the billing mail and the lease also reach', () => {
    const lena = resolveRef(g, { email: 'lena@fischer-family.example' })!;
    const org = g.nodes.find((n) => n.kind === 'org')!;
    expect(org.label).toBe('Acme Property GmbH');
    expect(g.nodes.filter((n) => n.kind === 'org')).toHaveLength(1);
    expect(edgeBetween(g, lena, org.id, 'works')).toBeTruthy();
    expect(edgeBetween(g, 'm:t2', org.id, 'emailed')).toBeTruthy();
    expect(edgeBetween(g, 'f:/h/Downloads/lease.pdf', org.id, 'mentioned')).toBeTruthy();
  });
  it('keeps people who share no address or name apart', () => {
    expect(g.nodes.filter((n) => n.kind === 'person').map((n) => n.label).sort()).toEqual(['Lena Fischer', 'Sam Doe']);
  });
});

describe('a link with a reason for every kind', () => {
  const g = buildEverything(demo());
  const lena = resolveRef(g, { email: 'lena@fischer-family.example' })!;
  it('mail threads: emailed, one node per conversation, attachments', () => {
    const t1 = g.byId.get('m:t1')!;
    expect(t1.count).toBe(2);
    expect(t1.label).toBe('Lease renewal');
    expect(edgeBetween(g, lena, 'm:t1', 'emailed')!.why[0]).toMatch(/Lena Fischer wrote “Lease renewal”/);
    expect(edgeBetween(g, 'm:t1', 'f:/h/Downloads/lease.pdf', 'attached')).toBeTruthy();
    expect(edgeBetween(g, 'm:t1', 'f:/h/Downloads/floorplan.png', 'attached')!.why[0]).toMatch(/floorplan.png/);
  });
  it('events: attended, same place, near in time', () => {
    expect(edgeBetween(g, lena, 'ev:cal:e1', 'attended')!.why[0]).toMatch(/invited to “Lease viewing”/);
    expect(edgeBetween(g, 'ev:cal:e1', 'pl:p1', 'place')).toBeTruthy();
    expect(edgeBetween(g, 'ev:cal:e1', 'f:/h/Notes/Lease viewing.md', 'time')!.why[0]).toMatch(/Changed during/);
  });
  it('tasks: same project, made from an email; notes tagged with the project', () => {
    expect(edgeBetween(g, 'tk:r1', 'pr:home', 'project')).toBeTruthy();
    expect(edgeBetween(g, 'tk:r1', 'm:t1', 'linked')!.why[0]).toMatch(/made from this email/);
    expect(edgeBetween(g, 'f:/h/Notes/Lease viewing.md', 'pr:home', 'project')).toBeTruthy();
  });
  it('meetings: the event, its notes, the speakers and the app', () => {
    expect(edgeBetween(g, 'mt:m1', 'ev:cal:e1', 'linked')).toBeTruthy();
    expect(edgeBetween(g, 'mt:m1', 'f:/h/Notes/Lease viewing.md', 'linked')).toBeTruthy();
    expect(edgeBetween(g, lena, 'mt:m1', 'attended')).toBeTruthy();
    expect(edgeBetween(g, 'mt:m1', 'ap:keeper', 'recorded')).toBeTruthy();
    expect(g.nodes.some((n) => n.label === 'Speaker 2')).toBe(false);
  });
  it('notes: wiki links, tags and names in text', () => {
    expect(edgeBetween(g, 'f:/h/Notes/Lease viewing.md', 'f:/h/Notes/Apartment move.md', 'linked')).toBeTruthy();
    expect(edgeBetween(g, 'f:/h/Notes/Lease viewing.md', 't:home', 'tagged')).toBeTruthy();
    expect(edgeBetween(g, 'f:/h/Notes/Lease viewing.md', lena, 'mentioned')).toBeTruthy();
  });
  it('a reason names the person, even when the item only had their address', () => {
    const s = demo();
    s.events = [{ id: 'e2', title: 'Coffee', start: T0 + 100 * H, end: T0 + 101 * H, attendees: [{ address: 'sam.doe@gmail.com' }] }];
    const g2 = buildEverything(s);
    const sam = resolveRef(g2, { email: 'sam.doe@gmail.com' })!;
    expect(edgeBetween(g2, sam, 'ev:e2', 'attended')!.why[0]).toMatch(/^Sam Doe was invited to “Coffee”/);
  });
  it('saved pages: where they came from', () => {
    expect(edgeBetween(g, 'bm:b1', 's:example.org', 'source')).toBeTruthy();
  });
  it('a name only in one file stays out; in two it becomes a node', () => {
    const g2 = buildEverything({ files: [
      { path: '/a.md', name: 'a.md', kind: 'document', mtime: 1, text: 'Lunch with Omar Haddad.' },
      { path: '/b.md', name: 'b.md', kind: 'document', mtime: 1, text: 'Call Omar Haddad.' },
      { path: '/c.md', name: 'c.md', kind: 'document', mtime: 1, text: 'Ask Priya Raman.' },
    ] });
    expect(g2.nodes.some((n) => n.label === 'Omar Haddad' && n.kind === 'person')).toBe(true);
    expect(g2.nodes.some((n) => n.label === 'Priya Raman')).toBe(false);
  });
});

describe('only what changed is read again', () => {
  it('reads new and changed items, drops gone ones, and keeps the rest', () => {
    const st = new GraphStore();
    const s = demo();
    expect(st.update(s).added).toBeGreaterThan(10);
    const first = st.extracted;
    expect(st.update(s)).toEqual({ added: 0, changed: 0, removed: 0 });
    expect(st.extracted).toBe(first);
    const g1 = st.graph();
    expect(st.graph()).toBe(g1);
    const s2 = { ...s, mail: [...s.mail!, { id: 'acc1:INBOX:10', thread: 't1', subject: 'Re: Lease renewal', from: { address: 'lena@fischer-family.example' }, to: [], date: T0, account: 'acc1', folder: 'INBOX' }], tasks: [] };
    expect(st.update(s2)).toEqual({ added: 1, changed: 0, removed: 1 });
    expect(st.extracted).toBe(first + 1);
    const g2 = st.graph();
    expect(g2).not.toBe(g1);
    expect(g2.byId.get('m:t1')!.count).toBe(3);
    expect(g2.byId.has('tk:r1')).toBe(false);
    const files = s2.files!.map((f) => (f.name === 'lease.pdf' ? { ...f, mtime: f.mtime + 1 } : f));
    expect(st.update({ ...s2, files }).changed).toBe(1);
  });
  it('saves and loads its fragments', () => {
    const st = new GraphStore();
    st.update(demo());
    const copy = new GraphStore();
    expect(copy.load(JSON.parse(JSON.stringify(st.toJSON())))).toBe(true);
    expect(copy.update(demo())).toEqual({ added: 0, changed: 0, removed: 0 });
    expect(copy.graph().nodes.length).toBe(st.graph().nodes.length);
    expect(copy.load({ v: 9 })).toBe(false);
  });
});

describe('privacy', () => {
  const parts = { mail: true, calendars: true, meetings: true, tracks: true, reader: true };
  it('adds no mail when Mail is off or mail is left out', () => {
    expect(applyPrivacy(demo(), defaultGraphPrivacy(), { ...parts, mail: false }).mail).toEqual([]);
    expect(applyPrivacy(demo(), { ...defaultGraphPrivacy(), mail: false }, parts).mail).toEqual([]);
    const g = buildEverything(applyPrivacy(demo(), { ...defaultGraphPrivacy(), mail: false }, parts));
    expect(g.nodes.some((n) => n.kind === 'mail')).toBe(false);
  });
  it('leaves out chosen accounts, mail folders and file folders', () => {
    const p = { ...defaultGraphPrivacy(), leaveOutAccounts: ['acc2'], leaveOutFolders: ['acc1:INBOX', '/h/Downloads/'] };
    const s = applyPrivacy(demo(), p, parts);
    expect(s.mail).toEqual([]);
    expect(s.files!.map((f) => f.name)).toEqual(['Lease viewing.md', 'Apartment move.md']);
    const p2 = applyPrivacy(demo(), { ...defaultGraphPrivacy(), leaveOutAccounts: ['acc2'] }, parts);
    expect(p2.mail!.map((m) => m.account)).toEqual(['acc1', 'acc1', 'acc1']);
  });
  it('adds nothing from parts that are off', () => {
    const s = applyPrivacy(demo(), defaultGraphPrivacy(), { mail: true, calendars: false, meetings: false, tracks: false, reader: false });
    expect([s.events, s.tasks, s.meetings, s.places, s.bookmarks].every((x) => x!.length === 0)).toBe(true);
  });
  it('reads stored choices safely', () => {
    expect(normalizeGraphPrivacy({ mail: false, leaveOutFolders: ['/x', 3, ''] })).toEqual({ ...defaultGraphPrivacy(), mail: false, leaveOutFolders: ['/x'] });
    expect(normalizeGraphPrivacy('nonsense')).toEqual(defaultGraphPrivacy());
  });
});

describe('questions the graph answers', () => {
  const g = buildEverything(demo());
  const lena = resolveRef(g, { email: 'lena@fischer-family.example' })!;
  it('finds a person by any of their names or addresses', () => {
    expect(searchNodes(g, 'lena')[0].id).toBe(lena);
    expect(searchNodes(g, 'fischer-family')[0].id).toBe(lena);
    expect(searchNodes(g, 'lease', { kinds: ['mail'] }).map((n) => n.id)).toEqual(['m:t1']);
  });
  it('shows a focused neighbourhood with a time filter', () => {
    const v = viewOf(g, { focus: lena, depth: 2 });
    expect(v.nodes.map((n) => n.kind)).toEqual(expect.arrayContaining(['person', 'mail', 'event', 'meeting', 'note', 'file']));
    const recent = viewOf(g, { focus: lena, from: T0 - 2 * H });
    expect(recent.nodes.some((n) => n.id === 'm:t1')).toBe(false);
    expect(recent.nodes.some((n) => n.id === 'ev:cal:e1')).toBe(true);
  });
  it('lists related things, the person’s mail first for a note that names them', () => {
    const r = related(g, 'f:/h/Notes/Apartment move.md', { now: T0 });
    expect(r[0].node.id).toBe('f:/h/Notes/Lease viewing.md');
    const via = r.find((x) => x.node.id === 'm:t1')!;
    expect(via.via?.id).toBe(lena);
    const forLena = related(g, lena, { now: T0 }).map((x) => x.node.kind);
    expect(forLena).toEqual(expect.arrayContaining(['mail', 'event', 'meeting', 'note']));
  });
  it('explains a connection step by step', () => {
    const x = explain(g, 'f:/h/Downloads/lease.pdf', 'ev:cal:e1')!;
    expect(x.steps[0].node.id).toBe('f:/h/Downloads/lease.pdf');
    expect(x.steps[x.steps.length - 1].node.id).toBe('ev:cal:e1');
    expect(x.steps.length).toBeLessThanOrEqual(4);
    expect(x.steps.slice(1).every((s) => s.why?.length)).toBe(true);
    expect(explain(g, 'f:/h/Downloads/lease.pdf', 'nope')).toBeNull();
  });
  it('resolves what each page knows', () => {
    expect(resolveRef(g, { mail: 'acc1:INBOX:8' })).toBe('m:t1');
    expect(resolveRef(g, { event: 'cal:e1' })).toBe('ev:cal:e1');
    expect(resolveRef(g, { path: '/h/Notes/Lease viewing.md' })).toBe('f:/h/Notes/Lease viewing.md');
    expect(resolveRef(g, { meeting: 'm1' })).toBe('mt:m1');
  });
});

describe('a hundred thousand nodes', () => {
  it('builds, updates one item and draws a summary quickly', () => {
    const files = Array.from({ length: 60_000 }, (_, i) => ({ path: `/h/f${i % 300}/file${i}.txt`, name: `file${i}.txt`, kind: 'document', mtime: T0 - i * 60_000 }));
    const mail = Array.from({ length: 40_000 }, (_, i) => ({ id: `a:INBOX:${i}`, thread: `t${i}`, subject: `Order ${i}`, from: { name: `Person ${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(97 + ((i >> 5) % 26))} Smith`, address: `p${i % 2000}@co${i % 50}.example` }, to: [], date: T0 - i * 30_000, account: 'a', folder: 'INBOX' }));
    const st = new GraphStore({ folders: true });
    let t = performance.now();
    st.update({ files, mail });
    const g = st.graph();
    const build = performance.now() - t;
    expect(g.nodes.length).toBeGreaterThan(100_000);
    t = performance.now();
    st.update({ files, mail: [...mail.slice(1), { ...mail[0], subject: 'Order changed' }] });
    st.graph();
    const again = performance.now() - t;
    t = performance.now();
    const v = viewOf(g, { max: 1500 });
    const draw = performance.now() - t;
    expect(v.nodes.length).toBeLessThanOrEqual(1500 + 15);
    expect(Object.values(v.hidden).reduce((a, b) => a + b, 0)).toBeGreaterThan(90_000);
    expect(v.nodes.some((n) => n.cluster)).toBe(true);
    expect(build).toBeLessThan(15_000);
    expect(again).toBeLessThan(build);
    expect(draw).toBeLessThan(1500);
  }, 60_000);
});
