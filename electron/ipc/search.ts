// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// search.everything: the one search box's other sources besides files (which
// the library answers): mail on this computer, events, tasks, contacts, notes
// in Keeper's Notes vaults, Keeper's own features, pages and settings, and system
// settings. Quick Search also asks for its launcher rows (core/launcher): an
// answer to a sum or conversion, apps, Keeper's actions, saved links and your
// own commands, ranked with what you opened before. Each source has a time
// limit and is skipped while its feature is off; nothing here reaches a
// server (currency rates only when the person turned them on).

import { app, ipcMain } from 'electron';
import { FEATURES, featureOffered } from '../../core/features';
import { hiddenFolder } from '../../core/pim/mail-mcp';
import { searchCatalog, type Os } from '../../core/settings-catalog';
import { best, groupHits, LAUNCH_KINDS, queryWords, scoreText, withTimeout, type EverythingHit, type EverythingKind, type EverythingResult } from '../../core/search-everything';
import { calculate } from '../../core/launcher/calc';
import { availableActions, LAUNCH_ACTIONS } from '../../core/launcher/actions';
import { homeCurrency, matchCommandKeywords, matchLinks } from '../../core/launcher/links';
import { answer as convertAnswer, parseConversion } from '../../core/island-tools/units';
import * as launcher from '../services/launcher';
import { featureOn, onFeature } from '../services/features';
import { searchSettings } from '../../core/settings-schema';
import { settings } from '../store';
import * as notes from '../services/notes';
// Answered here, or by Mail and calendars in a process of its own (services/pim/route.ts).
import { pimCalls as pim } from '../services/pim/route';

const DAY = 86_400_000;
const LIMIT_MS = 1500;

type Source = (words: string[], q: string, limit: number) => Promise<EverythingHit[]>;

/** The launcher's rows score like other matches, plus what you opened before. */
const withHabit = (id: string, score: number) => score + launcher.bonusFor(id);

const sources: Record<EverythingKind, { feature?: string; run: Source }> = {
  answer: {
    feature: 'launcher',
    run: async (_words, q) => {
      const ls = launcher.launcherSettings();
      const out: EverythingHit[] = [];
      const sum = ls.calc ? calculate(q) : undefined;
      if (sum) out.push({ kind: 'answer', id: 'calc', title: `= ${sum.text}`, detail: `${q.trim()} · Enter copies the answer`, copy: String(Number(sum.value.toPrecision(12))), route: '', icon: 'ruler' });
      const conv = ls.calc ? parseConversion(q) : undefined;
      if (conv) {
        let rates;
        if (conv.dim === 'currency' && ls.currency) rates = (await (await import('../services/island-tools')).rates('EUR').catch(() => null)) ?? undefined;
        const home = homeCurrency(app.getLocaleCountryCode() ? `x-${app.getLocaleCountryCode()}` : app.getLocale());
        for (const a of convertAnswer(q, rates, home).slice(0, 3)) {
          out.push({ kind: 'answer', id: `conv:${a.unit}`, title: `= ${a.text}`, detail: conv.dim === 'currency' ? 'European Central Bank reference rate · Enter copies it' : 'Enter copies the answer', copy: a.text.replace(/ [^ ]+$/, '').replace(/,/g, ''), route: '', icon: 'ruler' });
        }
        if (conv.dim === 'currency' && !ls.currency) out.push({ kind: 'answer', id: 'currency-off', title: 'Converting currencies is off', detail: 'Turn it on in Settings → General → Quick Search (downloads daily rates)', route: 'settings:general#launcher.currency', icon: 'coin' });
      }
      return out;
    },
  },
  app: {
    feature: 'launcher',
    run: async (words, _q, limit) => {
      const apps = await launcher.launchApps();
      const scored: EverythingHit[] = [];
      for (const a of apps) {
        const sc = scoreText(words, a.name, a.keywords ?? '');
        if (sc < 0) continue;
        scored.push({ kind: 'app', id: a.id, title: a.name, detail: process.platform === 'darwin' ? a.path.replace(/\/[^/]+$/, '') : a.keywords?.slice(0, 80), route: '', icon: 'app', score: withHabit(`app:${a.id}`, sc) });
      }
      scored.sort((x, y) => (y.score ?? 0) - (x.score ?? 0) || x.title.localeCompare(y.title));
      const top = scored.slice(0, Math.max(limit, 6));
      // Pictures for the few rows that show.
      await Promise.all(top.map(async (h) => { const a = apps.find((x) => x.id === h.id); if (a) h.image = await launcher.appIcon(a); }));
      return top;
    },
  },
  action: {
    feature: 'launcher',
    run: async (words, _q, limit) => {
      const list = availableActions(featureOn, process.platform);
      const out: EverythingHit[] = [];
      for (const a of list) {
        const sc = scoreText(words, a.title, a.words);
        if (sc >= 0) out.push({ kind: 'action', id: a.id, title: a.title, route: '', icon: a.icon, score: withHabit(`action:${a.id}`, sc) });
      }
      return out.sort((x, y) => (y.score ?? 0) - (x.score ?? 0)).slice(0, limit);
    },
  },
  link: {
    feature: 'launcher',
    run: async (words, q) => {
      const ls = launcher.launcherSettings();
      const out: EverythingHit[] = [];
      for (const { link, query } of matchLinks(q, ls.links)) {
        const needs = link.url.includes('{query}');
        if (needs && !query) out.push({ kind: 'link', id: link.id, title: `${link.name}: type what to look for`, detail: link.url.replace(/\{query\}.*/, '…'), route: '', icon: 'globe', fill: `${link.keyword} `, score: 30 });
        else out.push({ kind: 'link', id: link.id, title: needs ? `${link.name}: ${query}` : link.name, detail: link.url.replace('{query}', query), route: '', icon: 'globe', query, score: withHabit(`link:${link.id}`, 40) });
      }
      // By name too ("encyc" finds the Encyclopedia link): Enter fills in its keyword.
      for (const l of ls.links) {
        if (out.some((h) => h.id === l.id)) continue;
        const sc = scoreText(words, l.name, l.keyword);
        if (sc >= 0) out.push({ kind: 'link', id: l.id, title: l.name, detail: `Type “${l.keyword}” and what to look for`, route: '', icon: 'globe', fill: l.url.includes('{query}') ? `${l.keyword} ` : undefined, score: withHabit(`link:${l.id}`, sc) });
      }
      return out;
    },
  },
  command: {
    feature: 'launcher',
    run: async (words, q, limit) => {
      const ls = launcher.launcherSettings();
      const out: EverythingHit[] = [];
      for (const { cmd, query } of matchCommandKeywords(q, ls.commands)) out.push({ kind: 'command', id: cmd.id, title: query ? `${cmd.name}: ${query}` : cmd.name, detail: cmd.confirm ? 'Asks before it runs' : 'Runs straight away', route: '', icon: 'terminal', query, score: withHabit(`command:${cmd.id}`, 40) });
      for (const c of ls.commands) {
        if (out.some((h) => h.id === c.id)) continue;
        const sc = scoreText(words, c.name, c.keyword ?? '');
        if (sc >= 0) out.push({ kind: 'command', id: c.id, title: c.name, detail: c.confirm ? 'Asks before it runs' : 'Runs straight away', route: '', icon: 'terminal', query: '', score: withHabit(`command:${c.id}`, sc) });
      }
      return out.slice(0, limit);
    },
  },
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
    run: async (words, q, limit) => {
      const list = FEATURES.filter((f) => featureOffered(f, process.platform)).filter((f) => !['everything', 'balanced', 'minimal', 'files'].includes(f.id));
      const pages: EverythingHit[] = best(list, words, (f) => [f.name, f.description], limit).map((f) => {
        const on = featureOn(f.id);
        // A feature that is on opens its page; one that is off (or has no page) opens its switch.
        const page = on ? f.routes?.[0] : undefined;
        return { kind: 'feature', id: f.id, title: f.name, detail: `${on ? 'On' : 'Off'} · ${f.description}`, route: page ?? `settings:features#feature:${f.id}` };
      });
      // Keeper's own settings, by their words or what people call them (the Settings registry): each opens on its row.
      const own = words.length ? searchSettings(q, settings(), process.platform).filter((h) => h.kind === 'setting').slice(0, Math.max(2, Math.ceil(limit / 2))) : [];
      return [...pages, ...own.map((h) => ({ kind: 'feature' as const, id: `setting:${h.id}`, title: h.label, detail: `Settings › ${h.crumbs.slice(0, -1).join(' › ')}`, route: `settings:${h.section}#${h.id}` }))].slice(0, limit);
    },
  },
  setting: {
    feature: 'settingsCatalog',
    run: async (words, q, limit) =>
      words.length ? searchCatalog(q, process.platform as Os).slice(0, limit).map((s) => ({ kind: 'setting', id: s.id, title: s.title, detail: s.category, route: `catalog:${s.title}` })) : [],
  },
};

/** Searches every source but files at once, each within its time limit. */
export async function searchEverything(q: string, opts: { kinds?: EverythingKind[]; limit?: number; launch?: boolean } = {}): Promise<EverythingResult> {
  const words = queryWords(q);
  if (!words.length) return { groups: [], missed: [] };
  const limit = Math.max(1, Math.min(20, opts.limit ?? 5));
  // Launcher rows only for Quick Search (the Search page lists what is kept, not apps and sums).
  const wanted = (Object.keys(sources) as EverythingKind[]).filter((k) => opts.launch || !LAUNCH_KINDS.includes(k));
  const kinds = (opts.kinds ?? wanted).filter((k) => sources[k] && (!sources[k].feature || featureOn(sources[k].feature!)));
  const missed: EverythingKind[] = [];
  const all = await Promise.all(kinds.map(async (k) => {
    const r = await withTimeout(sources[k].run(words, q.trim(), limit), LIMIT_MS);
    if (!r) missed.push(k);
    return r ?? [];
  }));
  return { groups: groupHits(all.flat()), missed };
}

export interface SearchDeps {
  show: (route: string) => void;
  /** a keeper:// link, as if opened from outside */
  link: (url: string) => void;
  /** one of the launcher's named jobs (core/launcher/actions.ts `run`) */
  job: (name: NonNullable<(typeof LAUNCH_ACTIONS)[number]['run']>) => Promise<void> | void;
  /** a short note in the Island (a command's output, a problem) */
  note: (title: string, detail: string) => void;
  copy: (text: string) => Promise<void>;
}

/** Opens an app, saved link, command or action chosen in Quick Search. */
async function launch(d: SearchDeps, kind: EverythingKind, id: string, query: string, how: 'open' | 'reveal'): Promise<{ ok: boolean; message?: string }> {
  try {
    if (kind === 'app') {
      const a = (await launcher.launchApps()).find((x) => x.id === id);
      if (!a) return { ok: false, message: 'That app is no longer there' };
      if (how === 'reveal') launcher.revealApp(a);
      else await launcher.openApp(a);
      return { ok: true };
    }
    if (kind === 'link') {
      const l = launcher.launcherSettings().links.find((x) => x.id === id);
      if (!l) return { ok: false, message: 'That saved link is gone' };
      await launcher.openLink(l, query, d.link);
      return { ok: true };
    }
    if (kind === 'command') {
      const c = launcher.launcherSettings().commands.find((x) => x.id === id);
      if (!c) return { ok: false, message: 'That command is gone' };
      const r = await launcher.runCommand(c, query, d.note, d.copy);
      return { ok: r.ran ? !!r.ok : true, message: r.ran ? undefined : 'Not run' };
    }
    if (kind === 'action') {
      const a = availableActions(featureOn, process.platform).find((x) => x.id === id);
      if (!a) return { ok: false, message: 'That is not available now' };
      launcher.noteUse(`action:${a.id}`);
      if (a.link) d.link(a.link);
      else if (a.run) await d.job(a.run);
      return { ok: true };
    }
    return { ok: false, message: 'Nothing to open' };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export function registerSearchIpc(d: SearchDeps) {
  ipcMain.handle('search.everything', (_e, q: string, opts?: { kinds?: EverythingKind[]; limit?: number; launch?: boolean }) => searchEverything(String(q ?? ''), opts ?? {}));
  // Opens a result in the main window (Quick Search is a window of its own).
  ipcMain.handle('search.open', (_e, route: string) => d.show(String(route ?? '')));
  ipcMain.handle('search.launch', (_e, kind: EverythingKind, id: string, query?: string, how?: 'open' | 'reveal') => launch(d, kind, String(id ?? ''), String(query ?? ''), how === 'reveal' ? 'reveal' : 'open'));
  // Off: the list of apps is forgotten (it is read again on first use).
  onFeature('launcher', (on) => { if (!on) launcher.forgetApps(); });
}
