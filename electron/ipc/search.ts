// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// search.everything: the one search box's other sources besides files (which
// the library answers): mail on this computer, events, tasks, contacts, notes
// in Keeper's Notes vaults, Keeper's own features and pages, and system
// settings. Each source has a time limit and is skipped while its feature is
// off; nothing here reaches a server.

import { ipcMain } from 'electron';
import { FEATURES } from '../../core/features';
import { hiddenFolder } from '../../core/pim/mail-mcp';
import { searchCatalog, type Os } from '../../core/settings-catalog';
import { best, groupHits, queryWords, withTimeout, type EverythingHit, type EverythingKind, type EverythingResult } from '../../core/search-everything';
import { featureOn } from '../services/features';
import * as notes from '../services/notes';
import { pim } from '../services/pim';

const DAY = 86_400_000;
const LIMIT_MS = 1500;

type Source = (words: string[], q: string, limit: number) => Promise<EverythingHit[]>;

const sources: Record<EverythingKind, { feature?: string; run: Source }> = {
  mail: {
    feature: 'mail',
    run: async (words, q, limit) => {
      const [r, folders] = await Promise.all([pim.messages({ folder: 'search', query: q }), pim.folders()]);
      const list = r.messages.filter((m) => !hiddenFolder(m.folder, folders, m.account));
      return best(list, words, (m) => [m.subject, `${m.from?.name ?? ''} ${m.from?.address ?? ''} ${m.snippet}`], limit).map((m) => ({
        kind: 'mail', id: m.id, title: m.subject || '(no subject)', detail: m.from ? m.from.name || m.from.address : undefined, when: m.date, route: `mail:${m.id}`,
      }));
    },
  },
  event: {
    feature: 'calendars',
    run: async (words, _q, limit) => {
      const now = Date.now();
      const occ = await pim.occurrences(now - 365 * DAY, now + 365 * DAY);
      // Upcoming first, then the most recent past ones; one row per event.
      const seen = new Set<string>();
      const ordered = [...occ.filter((o) => o.end >= now).sort((a, b) => a.start - b.start), ...occ.filter((o) => o.end < now).sort((a, b) => b.start - a.start)]
        .filter((o) => (seen.has(o.event.id) ? false : (seen.add(o.event.id), true)));
      return best(ordered, words, (o) => [o.event.title, `${o.event.location ?? ''} ${o.event.description ?? ''}`], limit).map((o) => ({
        kind: 'event', id: `${o.event.id}@${o.instance}`, title: o.event.title || '(no title)', detail: o.event.location || undefined, when: o.start, route: `calendar:event:${o.instance}:${o.event.id}`,
      }));
    },
  },
  task: {
    feature: 'planner',
    run: async (words, _q, limit) => {
      const list = (await pim.reminders()).filter((r) => !r.id.startsWith('local:snooze-'));
      // Open tasks before finished ones.
      const ordered = [...list.filter((r) => !r.done), ...list.filter((r) => r.done)];
      return best(ordered, words, (r) => [r.title, r.notes ?? ''], limit).map((r) => ({
        kind: 'task', id: r.id, title: r.title, detail: r.done ? 'Done' : undefined, when: r.due, route: `planner:task:${r.id}`,
      }));
    },
  },
  contact: {
    feature: 'mail',
    run: async (words, _q, limit) => {
      const list = await pim.contacts();
      return best(list, words, (c) => [c.name, `${c.emails.join(' ')} ${c.org ?? ''} ${c.phones.join(' ')}`], limit).map((c) => ({
        // Opening a contact shows the mail from them.
        kind: 'contact', id: c.id, title: c.name || c.emails[0] || 'Contact', detail: [c.emails[0], c.org].filter(Boolean).join(' · ') || undefined, route: c.emails[0] ? `mail:search:${c.emails[0]}` : 'mail',
      }));
    },
  },
  note: {
    feature: 'notes',
    run: async (_words, q, limit) => {
      const out: EverythingHit[] = [];
      for (const v of (await notes.vaults()).filter((x) => !x.missing).slice(0, 4)) {
        const hits = await notes.search(v.id, q, { limit }).catch(() => []);
        for (const h of hits) {
          out.push({ kind: 'note', id: `${v.id}:${h.path}`, title: h.path.split('/').pop()!.replace(/\.md$/i, ''), detail: `${v.name}${h.matches[0] ? ` · ${h.matches[0].text.trim().slice(0, 80)}` : ''}`, route: `notes:open:${h.path}` });
        }
        if (out.length >= limit) break;
      }
      return out.slice(0, limit);
    },
  },
  feature: {
    run: async (words, _q, limit) => {
      const list = FEATURES.filter((f) => !f.platforms || f.platforms.includes(process.platform)).filter((f) => !['everything', 'balanced', 'minimal', 'files'].includes(f.id));
      return best(list, words, (f) => [f.name, f.description], limit).map((f) => {
        const on = featureOn(f.id);
        // A feature that is on opens its page; one that is off (or has no page) opens its switch.
        const page = on ? f.routes?.[0] : undefined;
        return { kind: 'feature', id: f.id, title: f.name, detail: `${on ? 'On' : 'Off'} · ${f.description}`, route: page ?? 'settings:features' };
      });
    },
  },
  setting: {
    feature: 'settingsCatalog',
    run: async (words, q, limit) =>
      words.length ? searchCatalog(q, process.platform as Os).slice(0, limit).map((s) => ({ kind: 'setting', id: s.id, title: s.title, detail: s.category, route: `catalog:${s.title}` })) : [],
  },
};

/** Searches every source but files at once, each within its time limit. */
export async function searchEverything(q: string, opts: { kinds?: EverythingKind[]; limit?: number } = {}): Promise<EverythingResult> {
  const words = queryWords(q);
  if (!words.length) return { groups: [], missed: [] };
  const limit = Math.max(1, Math.min(20, opts.limit ?? 5));
  const kinds = (opts.kinds ?? (Object.keys(sources) as EverythingKind[])).filter((k) => sources[k] && (!sources[k].feature || featureOn(sources[k].feature!)));
  const missed: EverythingKind[] = [];
  const all = await Promise.all(kinds.map(async (k) => {
    const r = await withTimeout(sources[k].run(words, q.trim(), limit), LIMIT_MS);
    if (!r) missed.push(k);
    return r ?? [];
  }));
  return { groups: groupHits(all.flat()), missed };
}

export function registerSearchIpc(d: { show: (route: string) => void }) {
  ipcMain.handle('search.everything', (_e, q: string, opts?: { kinds?: EverythingKind[]; limit?: number }) => searchEverything(String(q ?? ''), opts ?? {}));
  // Opens a result in the main window (Quick Search is a window of its own).
  ipcMain.handle('search.open', (_e, route: string) => d.show(String(route ?? '')));
}
