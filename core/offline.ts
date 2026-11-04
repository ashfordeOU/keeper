// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Offline check: every way Keeper could reach the internet, read from the
// parts and settings themselves, each with its own switch, and one change that
// turns them all off. Privacy-max's own part (core/modes.ts), there for anyone.
// It lists switches; it does not watch the network (Network & firewall does).

import { FEATURES, featureOffered, isOn } from './features';
import type { AllSettings } from './settings';

/** Parts that reach the internet while on (for things you set up, or on their own). */
export const ONLINE_PARTS: { id: string; why: string }[] = [
  { id: 'updates', why: 'Looks for a new Keeper' },
  { id: 'weather', why: 'Forecasts for your places' },
  { id: 'islandWeather', why: 'The forecast in the Island' },
  { id: 'islandStocks', why: 'Prices you follow' },
  { id: 'islandSales', why: 'Sales from your shops' },
  { id: 'mail', why: 'Your mail accounts' },
  { id: 'calendars', why: 'Calendars you subscribe to' },
  { id: 'reader', why: 'Feeds you follow' },
  { id: 'link', why: 'Your other devices' },
  { id: 'remote', why: 'Cloud drives and servers you add' },
  { id: 'monitors', why: 'Sites you watch' },
  { id: 'phoneAlerts', why: 'Alerts to your phone' },
  { id: 'videoDownload', why: 'Videos you save' },
  { id: 'tracks', why: 'Maps and places' },
  { id: 'monorail', why: 'Monorail' },
  { id: 'usageTracker', why: 'AI accounts you add' },
  { id: 'crashReports', why: 'Crash reports, when you send one' },
  { id: 'usageStats', why: 'Anonymous usage stats' },
];

/** Settings that reach the internet while on (toggles only; the rest are under their part). */
export const ONLINE_SETTINGS: { path: string; label: string }[] = [
  { path: 'launcher.currency', label: 'Currency rates' },
  { path: 'reader.fullText', label: 'Whole articles' },
  { path: 'reader.images', label: 'Pictures in articles' },
  { path: 'island.lyrics', label: 'Song lyrics' },
  { path: 'island.clipFetchTitles', label: 'Titles for copied links' },
];

export interface OnlineThing {
  kind: 'part' | 'setting';
  id: string;
  label: string;
  why?: string;
  on: boolean;
}

const at = (s: unknown, path: string) => path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), s);

/** Every way Keeper could reach the internet on this computer, and whether it is on. */
export function onlineThings(s: AllSettings, platform = ''): OnlineThing[] {
  const out: OnlineThing[] = [];
  for (const p of ONLINE_PARTS) {
    const f = FEATURES.find((x) => x.id === p.id);
    if (!f || !featureOffered(f, platform)) continue;
    out.push({ kind: 'part', id: p.id, label: f.plain ?? f.name, why: p.why, on: isOn(s, p.id, platform) });
  }
  for (const x of ONLINE_SETTINGS) {
    const v = at(s, x.path);
    if (typeof v !== 'boolean') continue;
    out.push({ kind: 'setting', id: x.path, label: x.label, on: v });
  }
  return out;
}

/** "3 ways on", "Offline: nothing reaches the internet". */
export function offlineLine(things: OnlineThing[]): string {
  const n = things.filter((t) => t.on).length;
  return n ? `${n} ${n === 1 ? 'way' : 'ways'} on` : 'Offline: nothing reaches the internet';
}

/** The feature ids and setting paths to switch off for "Turn all off" (the person's own choices too: they asked). */
export function allOff(things: OnlineThing[]): { parts: string[]; settings: string[] } {
  return { parts: things.filter((t) => t.on && t.kind === 'part').map((t) => t.id), settings: things.filter((t) => t.on && t.kind === 'setting').map((t) => t.id) };
}
