// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The sync engine: compares one connected app with the hub against what both
// looked like at the last sync, and makes a plan. Nothing here touches a disk
// or the network; the main process carries the plan out.
//
// Rules it keeps:
//   - a change on one side is copied to the other (if write-back is on);
//   - changes on both sides are merged line by line; when they touch the same
//     lines, the hub keeps its text and the app's text becomes a conflict copy
//     with a side-by-side compare — never a silent overwrite;
//   - a note deleted in an app goes to Keeper's notes trash; a note deleted in
//     the hub is deleted in an app only after you say yes;
//   - locked or encrypted notes are listed, never copied as plain text.

import { merge3 } from './diff3';
import { docOf, lockedStub, normTags, splitDoc, tagsHash, textHash } from './hub';
import type { Capability, ConnectorKind, HubNote, PlanCounts, PlanItem, RemoteNote, SourceLink, SyncPlan } from './types';

export interface EngineConnector {
  id: string;
  kind: ConnectorKind;
  /** the app's name, for reasons and conflict copies */
  name: string;
  capability: Capability;
}

export interface EngineInput {
  connector: EngineConnector;
  /** every note in the hub (not the trash) */
  hub: HubNote[];
  /** notes deleted in the hub that still say they live in this app */
  deletedInHub?: HubNote[];
  /** the app's notes as just read */
  remote: RemoteNote[];
  /** is `remote` everything the app has? (a missing note then means it was deleted) */
  complete: boolean;
  /** the text a note had at the last sync, by its hash */
  base(hash: string): string | undefined;
  writeBack: boolean;
  /** also create hub notes that are not in this app yet */
  pushNew?: boolean;
  /** keeper ids with a conflict still waiting for you: left alone */
  openConflicts?: Set<string>;
  now: number;
  newId(): string;
}

export const emptyCounts = (): PlanCounts => ({ add: 0, update: 0, updateApp: 0, addApp: 0, merge: 0, conflicts: 0, trash: 0, deleteApp: 0, held: 0, locked: 0, unchanged: 0 });

export function canWrite(c: Pick<EngineConnector, 'capability'>, writeBack: boolean): boolean {
  return writeBack && c.capability !== 'import-only';
}

function linkFor(n: HubNote, connector: string): SourceLink | undefined {
  return n.sources.find((s) => s.connector === connector);
}

function withLink(n: HubNote, link: SourceLink): HubNote {
  return { ...n, sources: [...n.sources.filter((s) => s.connector !== link.connector), link] };
}

function withoutLink(n: HubNote, connector: string): HubNote {
  return { ...n, sources: n.sources.filter((s) => s.connector !== connector) };
}

function mergeTags(base: { hub: boolean; app: boolean }, hubTags: string[], appTags: string[]): string[] {
  if (base.hub && base.app) return normTags([...hubTags, ...appTags]);
  if (base.app) return normTags(appTags);
  return normTags(hubTags);
}

export function makePlan(inp: EngineInput): SyncPlan {
  const c = inp.connector;
  const write = canWrite(c, inp.writeBack);
  const items: PlanItem[] = [];
  const byLink = new Map<string, HubNote>();
  for (const n of inp.hub) {
    const l = linkFor(n, c.id);
    if (l) byLink.set(l.id, n);
  }
  const deletedByLink = new Map<string, HubNote>();
  for (const n of inp.deletedInHub ?? []) {
    const l = linkFor(n, c.id);
    if (l) deletedByLink.set(l.id, n);
  }
  const dupIndex = new DuplicateIndex(inp.hub.filter((n) => !linkFor(n, c.id)));
  const seen = new Set<string>();
  const linkOf = (r: RemoteNote, extra: Partial<SourceLink> = {}): SourceLink => ({
    connector: c.id, app: c.kind, id: r.sourceId, folder: r.folder, version: r.version,
    hash: textHash(r.title, r.body), tagsHash: tagsHash(r.tags), synced: inp.now, ...extra,
  });
  const atts = (r: RemoteNote) => r.attachments?.filter((a) => a.hash).map((a) => ({ name: a.name, hash: a.hash!, mime: a.mime }));

  for (const r of inp.remote) {
    if (r.trashed) continue; // in the app's trash: treated as gone
    seen.add(r.sourceId);
    const h = byLink.get(r.sourceId);
    if (r.locked) {
      const hub: HubNote = h
        ? { ...h, title: r.title || h.title, locked: true }
        : { keeperId: inp.newId(), title: r.title || 'Locked note', body: lockedStub(c.name), tags: normTags(r.tags), created: r.created ?? inp.now, modified: r.modified ?? inp.now, sources: [], locked: true };
      items.push({ action: 'locked', keeperId: hub.keeperId, sourceId: r.sourceId, title: hub.title, why: `locked in ${c.name}: listed, not copied`, hub: withLink(hub, linkOf({ ...r, body: '' })) });
      continue;
    }
    if (!h) {
      const gone = deletedByLink.get(r.sourceId);
      const l = gone && linkFor(gone, c.id);
      if (gone && l && l.hash === textHash(r.title, r.body)) {
        // Deleted in the hub and unchanged in the app: delete there too, if you say so.
        if (write) items.push({ action: 'delete-app', keeperId: gone.keeperId, sourceId: r.sourceId, title: r.title, why: `deleted in Keeper; still in ${c.name}`, needsConfirm: true });
        continue;
      }
      const hub: HubNote = {
        keeperId: inp.newId(), title: r.title || 'Untitled', body: r.body, tags: normTags(r.tags),
        created: r.created ?? inp.now, modified: r.modified ?? inp.now, sources: [linkOf(r)], attachments: atts(r),
        extra: r.props && Object.keys(r.props).length ? { ...r.props } : undefined,
      };
      const dup = dupIndex.find(hub);
      items.push({ action: 'add', keeperId: hub.keeperId, sourceId: r.sourceId, title: hub.title, why: gone ? `changed in ${c.name} after it was deleted here` : `new in ${c.name}`, hub, duplicateOf: dup });
      continue;
    }
    if (inp.openConflicts?.has(h.keeperId)) {
      items.push({ action: 'conflict', keeperId: h.keeperId, sourceId: r.sourceId, title: h.title, why: 'waiting for you to choose' });
      continue;
    }
    const l = linkFor(h, c.id)!;
    const rh = textHash(r.title, r.body);
    const hh = textHash(h.title, h.body);
    const appChanged = rh !== l.hash;
    const hubChanged = hh !== l.hash;
    const appTags = tagsHash(r.tags) !== l.tagsHash;
    const hubTags = tagsHash(h.tags) !== l.tagsHash;
    const tags = mergeTags({ hub: hubTags, app: appTags }, h.tags, r.tags);
    const tagsDiffer = tagsHash(tags) !== tagsHash(r.tags);
    const props = r.props && Object.keys(r.props).length ? { ...(h.extra ?? {}), ...r.props } : h.extra;

    if (!appChanged && !hubChanged) {
      if (!appTags && !hubTags) { items.push({ action: 'update', keeperId: h.keeperId, sourceId: r.sourceId, title: h.title, why: 'unchanged', hub: withLink(h, { ...l, version: r.version ?? l.version, folder: r.folder ?? l.folder }) }); continue; }
      if (hubTags && !appTags) {
        if (c.capability === 'import-only') { items.push({ action: 'update', keeperId: h.keeperId, sourceId: r.sourceId, title: h.title, why: 'unchanged', hub: h }); continue; }
        if (write) items.push({ action: 'update-app', keeperId: h.keeperId, sourceId: r.sourceId, title: h.title, why: 'tags changed in Keeper', hub: h, app: { ...r, tags } });
        else items.push({ action: 'held', keeperId: h.keeperId, sourceId: r.sourceId, title: h.title, why: 'tags changed in Keeper; write-back is off' });
        continue;
      }
      const hub = withLink({ ...h, tags, modified: r.modified ?? inp.now }, linkOf(r, { tagsHash: tagsHash(tagsDiffer ? r.tags : tags) }));
      items.push({ action: 'update', keeperId: h.keeperId, sourceId: r.sourceId, title: h.title, why: `tags changed in ${c.name}`, hub, app: tagsDiffer && write ? { ...r, tags } : undefined });
      continue;
    }
    if (appChanged && !hubChanged) {
      const hub = withLink({ ...h, title: r.title || h.title, body: r.body, tags, modified: r.modified ?? inp.now, attachments: atts(r) ?? h.attachments, extra: props }, linkOf(r));
      items.push({ action: 'update', keeperId: h.keeperId, sourceId: r.sourceId, title: hub.title, why: `changed in ${c.name}`, hub, app: tagsDiffer && write ? { ...r, tags } : undefined });
      continue;
    }
    if (hubChanged && !appChanged) {
      // An import-only app never receives anything: the hub simply has newer text.
      if (c.capability === 'import-only') { items.push({ action: 'update', keeperId: h.keeperId, sourceId: r.sourceId, title: h.title, why: 'unchanged', hub: h }); continue; }
      if (write) items.push({ action: 'update-app', keeperId: h.keeperId, sourceId: r.sourceId, title: h.title, why: 'changed in Keeper', hub: { ...h, tags }, app: { ...r, title: h.title, body: h.body, tags } });
      else items.push({ action: 'held', keeperId: h.keeperId, sourceId: r.sourceId, title: h.title, why: 'changed in Keeper; write-back is off' });
      continue;
    }
    // Changed on both sides.
    if (rh === hh) {
      items.push({ action: 'update', keeperId: h.keeperId, sourceId: r.sourceId, title: h.title, why: 'same change on both sides', hub: withLink({ ...h, tags }, linkOf(r)) });
      continue;
    }
    const base = l.hash ? inp.base(l.hash) : undefined;
    const mine = docOf(h.title, h.body);
    const theirs = docOf(r.title, r.body);
    const m = base === undefined ? null : merge3(base, mine, theirs);
    if (m?.clean) {
      const merged = splitDoc(m.text);
      const hubNote: HubNote = { ...h, title: merged.title || h.title, body: merged.body, tags, modified: inp.now, extra: props };
      if (write) {
        items.push({ action: 'merge', keeperId: h.keeperId, sourceId: r.sourceId, title: hubNote.title, why: `changed in Keeper and in ${c.name}; merged`, hub: hubNote, app: { ...r, title: hubNote.title, body: hubNote.body, tags }, base });
      } else {
        // The app keeps its text; the hub has both changes and remembers what the app has.
        items.push({ action: 'merge', keeperId: h.keeperId, sourceId: r.sourceId, title: hubNote.title, why: `changed in Keeper and in ${c.name}; merged in Keeper`, hub: withLink(hubNote, linkOf(r)), base });
      }
      continue;
    }
    items.push({
      action: 'conflict', keeperId: h.keeperId, sourceId: r.sourceId, title: h.title,
      why: base === undefined ? `both changed and the last synced text is not known` : `changed in the same place in Keeper and in ${c.name}`,
      theirs: { title: r.title, body: r.body }, base: base ?? '', hub: h,
    });
  }

  // Notes the hub links to this app that the app no longer has.
  if (inp.complete) {
    for (const [sid, h] of byLink) {
      if (seen.has(sid)) continue;
      if (h.locked) { items.push({ action: 'trash', keeperId: h.keeperId, sourceId: sid, title: h.title, why: `gone from ${c.name}`, hub: withoutLink(h, c.id) }); continue; }
      const l = linkFor(h, c.id)!;
      const changed = textHash(h.title, h.body) !== l.hash;
      const others = h.sources.filter((s) => s.connector !== c.id);
      if (changed) items.push({ action: 'unlink', keeperId: h.keeperId, sourceId: sid, title: h.title, why: `deleted in ${c.name}, but changed in Keeper: kept`, hub: withoutLink(h, c.id) });
      else if (others.length) items.push({ action: 'unlink', keeperId: h.keeperId, sourceId: sid, title: h.title, why: `deleted in ${c.name}; still in ${others.map((o) => o.app).join(', ')}`, hub: withoutLink(h, c.id) });
      else items.push({ action: 'trash', keeperId: h.keeperId, sourceId: sid, title: h.title, why: `deleted in ${c.name}: moved to Keeper's notes trash`, hub: withoutLink(h, c.id) });
    }
  }

  if (inp.pushNew && write) {
    for (const n of inp.hub) {
      if (linkFor(n, c.id) || n.locked) continue;
      items.push(addAppItem(n, c));
    }
  }

  return finishPlan(c.id, inp.now, items);
}

/** Copy notes from the hub into an app (convert, bulk migrate). */
export function addAppItem(n: HubNote, c: Pick<EngineConnector, 'name'>): PlanItem {
  const folder = n.sources[0]?.folder;
  return { action: 'add-app', keeperId: n.keeperId, title: n.title, why: `copy to ${c.name}`, hub: n, app: { sourceId: '', title: n.title, body: n.body, tags: n.tags, created: n.created, modified: n.modified, folder } };
}

export function finishPlan(connector: string, now: number, items: PlanItem[]): SyncPlan {
  const counts = emptyCounts();
  for (const i of items) {
    if (i.action === 'update' && i.why === 'unchanged') { counts.unchanged++; continue; }
    if (i.action === 'update' && i.why === 'same change on both sides') { counts.unchanged++; continue; }
    switch (i.action) {
      case 'add': counts.add++; break;
      case 'update': counts.update++; break;
      case 'update-app': counts.updateApp++; break;
      case 'add-app': counts.addApp++; break;
      case 'merge': counts.merge++; break;
      case 'conflict': counts.conflicts++; break;
      case 'trash': case 'unlink': counts.trash++; break;
      case 'delete-app': counts.deleteApp++; break;
      case 'held': counts.held++; break;
      case 'locked': counts.locked++; break;
    }
  }
  return { connector, made: now, items, counts, summary: summarize(counts) };
}

/** "Would add 412, update 3, conflicts 0" (and the rest when there is any). */
export function summarize(c: PlanCounts): string {
  const parts = [`add ${c.add}`, `update ${c.update + c.merge}`];
  if (c.updateApp || c.addApp) parts.push(`send ${c.updateApp + c.addApp} back`);
  if (c.trash) parts.push(`move ${c.trash} to the notes trash`);
  if (c.deleteApp) parts.push(`delete ${c.deleteApp} in the app (asks first)`);
  parts.push(`conflicts ${c.conflicts}`);
  const tail = [c.locked ? `${c.locked} locked (not copied)` : '', c.held ? `${c.held} held back (write-back off)` : ''].filter(Boolean);
  return `Would ${parts.join(', ')}${tail.length ? ` · ${tail.join(', ')}` : ''}`;
}

/** Does this plan change anything? */
export const planHasWork = (p: SyncPlan) => p.items.some((i) => !(i.action === 'update' && (i.why === 'unchanged' || i.why === 'same change on both sides')) && i.action !== 'held');

// ---------------------------------------------------------------- duplicates

/** Lower case, no Markdown punctuation, single spaces. */
export function normalizeText(s: string): string {
  return s.toLowerCase()
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#*_`>~=|[\](){}\-+:;,.!?"'“”‘’]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function shingles(s: string): Set<string> {
  const w = s.split(' ').filter(Boolean);
  const out = new Set<string>();
  if (w.length < 3) { for (const x of w) out.add(x); return out; }
  for (let i = 0; i + 2 < w.length; i++) out.add(`${w[i]} ${w[i + 1]} ${w[i + 2]}`);
  return out;
}

export function similarity(a: { title: string; body: string }, b: { title: string; body: string }): number {
  const na = normalizeText(`${a.title} ${a.body}`);
  const nb = normalizeText(`${b.title} ${b.body}`);
  if (!na && !nb) return 1;
  if (na === nb) return 1;
  const la = na.length;
  const lb = nb.length;
  if (Math.min(la, lb) / Math.max(la, lb) < 0.5) return 0;
  const sa = shingles(na);
  const sb = shingles(nb);
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  const union = sa.size + sb.size - inter;
  return union ? inter / union : 0;
}

export const DUPLICATE_THRESHOLD = 0.8;

const appOf = (n: HubNote): string => n.sources[0]?.app ?? 'hub';

/** Quick look-ups for "is this new note the same as one already in the hub?" */
class DuplicateIndex {
  private exact = new Map<string, string>();
  private byWord = new Map<string, HubNote[]>();
  constructor(notes: HubNote[]) {
    for (const n of notes) {
      if (n.locked) continue;
      const t = normalizeText(`${n.title} ${n.body}`);
      if (!t) continue;
      this.exact.set(t, n.keeperId);
      const k = t.split(' ')[0];
      const arr = this.byWord.get(k) ?? [];
      arr.push(n);
      this.byWord.set(k, arr);
    }
  }
  find(n: HubNote): string | undefined {
    const t = normalizeText(`${n.title} ${n.body}`);
    if (!t) return undefined;
    const hit = this.exact.get(t);
    if (hit) return hit;
    for (const o of this.byWord.get(t.split(' ')[0]) ?? []) if (similarity(n, o) >= DUPLICATE_THRESHOLD) return o.keeperId;
    return undefined;
  }
}

export interface DuplicateGroup {
  id: string;
  notes: string[];
  score: number;
}

/**
 * Notes that look the same but came from different apps (and are not already
 * one hub note linked to both). `dismissed` holds group ids you said are fine.
 */
export function findDuplicates(notes: HubNote[], dismissed: Set<string> = new Set(), max = 5000): DuplicateGroup[] {
  const list = notes.filter((n) => !n.locked).slice(0, max);
  const norm = list.map((n) => normalizeText(`${n.title} ${n.body}`));
  const parent = list.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const score = new Map<number, number>();
  // Buckets by the first word of the title keep this far from n².
  const buckets = new Map<string, number[]>();
  list.forEach((n, i) => {
    if (!norm[i]) return;
    const k = normalizeText(n.title).split(' ')[0] || norm[i].split(' ')[0];
    const b = buckets.get(k) ?? [];
    b.push(i);
    buckets.set(k, b);
  });
  for (const b of buckets.values()) {
    for (let x = 0; x < b.length; x++) {
      for (let y = x + 1; y < b.length; y++) {
        const i = b[x];
        const j = b[y];
        if (appOf(list[i]) === appOf(list[j]) && appOf(list[i]) !== 'hub') continue;
        const s = norm[i] === norm[j] ? 1 : similarity(list[i], list[j]);
        if (s < DUPLICATE_THRESHOLD) continue;
        const ri = find(i);
        const rj = find(j);
        if (ri !== rj) parent[rj] = ri;
        const r = find(i);
        score.set(r, Math.min(score.get(r) ?? 1, s));
      }
    }
  }
  const groups = new Map<number, number[]>();
  list.forEach((_, i) => {
    const r = find(i);
    const g = groups.get(r) ?? [];
    g.push(i);
    groups.set(r, g);
  });
  const out: DuplicateGroup[] = [];
  for (const [r, g] of groups) {
    if (g.length < 2) continue;
    const ids = g.map((i) => list[i].keeperId).sort();
    const id = 'dup-' + ids.join('-').slice(0, 120);
    if (dismissed.has(id)) continue;
    out.push({ id, notes: ids, score: Math.round((score.get(r) ?? 1) * 100) / 100 });
  }
  return out;
}

/** Link duplicates into one hub note: the first keeps its text, the others' app links move to it. */
export function linkDuplicates(keep: HubNote, others: HubNote[], mergeText: boolean): { keep: HubNote; remove: string[] } {
  let body = keep.body;
  if (mergeText) {
    for (const o of others) if (normalizeText(o.body) !== normalizeText(body) && !normalizeText(body).includes(normalizeText(o.body))) body = `${body}\n\n---\n\n${o.body}`;
  }
  const sources = [...keep.sources];
  for (const o of others) for (const s of o.sources) if (!sources.some((x) => x.connector === s.connector)) sources.push(s);
  return { keep: { ...keep, body, tags: normTags([...keep.tags, ...others.flatMap((o) => o.tags)]), sources }, remove: others.map((o) => o.keeperId) };
}
