// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage-aware decluttering: Keeper counts, on this computer only, when each
// part's pages were last opened. A part that has stayed unopened for 30 days
// becomes a gentle row on the Fix-it List ("You haven't opened Weather in 30
// days. Turn it off?"), with what it costs while on and Undo. Nothing is ever
// sent anywhere and nothing is switched off without the person's say-so.

import { FEATURES, featurePatch, type FeatureDef, type FeatureState } from './features';
import type { Finding } from './guide/types';
import type { AllSettings } from './settings';

export const DAY = 86_400_000;
/** A part unopened this long is offered for switching off. */
export const UNUSED_DAYS = 30;

/** What is kept (page-use.json): when counting began, and each part's last opening and count. */
export interface PageUse {
  since: number;
  parts: Record<string, { last: number; n: number }>;
}

export const emptyUse = (now: number): PageUse => ({ since: now, parts: {} });

export function normalizeUse(v: unknown, now: number): PageUse {
  if (!v || typeof v !== 'object') return emptyUse(now);
  const r = v as Partial<PageUse>;
  const parts: PageUse['parts'] = {};
  if (r.parts && typeof r.parts === 'object') {
    for (const [k, x] of Object.entries(r.parts)) if (x && typeof x.last === 'number' && typeof x.n === 'number') parts[k] = { last: x.last, n: x.n };
  }
  return { since: typeof r.since === 'number' && r.since <= now ? r.since : now, parts };
}

/** One opening of a part's page. */
export function noteUse(u: PageUse, feature: string, now: number): PageUse {
  const p = u.parts[feature];
  return { ...u, parts: { ...u.parts, [feature]: { last: now, n: (p?.n ?? 0) + 1 } } };
}

/**
 * Parts whose only use is their page, so an unopened page means an unused part.
 * Parts that work for you without their page being opened (rules that tidy, sync,
 * backups, monitors, Mail, the sidebar's places, shortcuts, the Island…) are
 * never judged this way.
 */
export const JUDGED = new Set(['cleanup', 'duplicates', 'space', 'convert', 'weather', 'tracks', 'journal', 'reader', 'notes', 'assistant', 'tools', 'studio', 'stage', 'photoEditor', 'remoteDesktops', 'settingsCatalog', 'processes']);

/** Can this part be judged by how often its pages are opened? */
export function judged(f: FeatureDef): boolean {
  return JUDGED.has(f.id) && !!f.routes?.length && !f.always && !f.ownChoice;
}

export interface Unused {
  feature: FeatureDef;
  /** days since it was last opened (or since counting began) */
  days: number;
  /** other parts that would go off with it */
  takes: string[];
}

/**
 * Parts that are on, have pages, and were not opened for 30 days or more.
 * Nothing is offered until Keeper has counted for 30 days. A part another part
 * that is on still needs (Weather for the Island's weather) is left alone.
 */
export function unusedParts(states: Map<string, FeatureState>, use: PageUse, now: number, days = UNUSED_DAYS): Unused[] {
  if (now - use.since < days * DAY) return [];
  const on = (id: string) => states.get(id)?.on === true;
  const out: Unused[] = [];
  for (const f of FEATURES) {
    if (!judged(f) || !on(f.id)) continue;
    const last = use.parts[f.id]?.last ?? use.since;
    const idle = Math.floor((now - last) / DAY);
    if (idle < days) continue;
    const needed = FEATURES.some((o) => o.id !== f.id && on(o.id) && o.requires?.includes(f.id) && !o.routes?.length);
    if (needed) continue;
    const takes = FEATURES.filter((o) => o.id !== f.id && on(o.id) && o.requires?.includes(f.id)).map((o) => o.name);
    out.push({ feature: f, days: idle, takes });
  }
  return out.sort((a, b) => b.days - a.days || a.feature.name.localeCompare(b.feature.name));
}

/** "30 days", "about 2 months". */
export function idleWords(days: number): string {
  return days < 60 ? `${days} days` : `about ${Math.round(days / 30)} months`;
}

/** The Fix-it List's rows: "Good to know", with what the part costs while on and Turn it off (with Undo). */
export function declutterFindings(list: Unused[]): Finding[] {
  return list.map(({ feature: f, days, takes }) => ({
    id: `declutter:${f.id}`,
    source: 'declutter',
    area: 'performance',
    severity: 'low',
    title: `You haven’t opened ${f.name} in ${idleWords(days)}`,
    why: `Turn it off to keep Keeper light.${f.cost.background ? ` While on: ${lower(f.cost.background)}.` : ''}${takes.length ? ` ${takes.join(', ')} goes off with it.` : ''} You can turn it on again any time.`,
    detail: f.name,
    impact: f.cost.memory ? `Saves ${lower(f.cost.memory)}` : undefined,
    fix: { kind: 'auto', action: 'declutter.off', label: 'Turn it off' },
    group: { key: 'declutter', one: '1 part you haven’t used lately', many: '{n} parts you haven’t used lately' },
    confidence: 'likely',
  }));
}

const lower = (s: string) => s.replace(/\.$/, '').replace(/^[A-Z](?![A-Z])/, (c) => c.toLowerCase());

/** The settings change for Turn it off, and for Undo. */
export function declutterPatch(s: AllSettings, featureId: string, on: boolean): Partial<AllSettings> {
  return featurePatch(s, featureId, on);
}

/** The part a declutter finding is about. */
export const featureOfFinding = (id: string) => (id.startsWith('declutter:') ? id.slice('declutter:'.length) : undefined);
