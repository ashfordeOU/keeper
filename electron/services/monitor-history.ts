// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The long-term history file: fed once a minute by Health's existing look at
// running apps (no extra timer), saved every few minutes and on quit.

import { app } from 'electron';
import { promises as fsp, readFileSync } from 'node:fs';
import path from 'node:path';
import { addMinute, decode, emptyStore, encode, importLegacy, query, peaks, toCsv, topApps, type HistoryStore, type MinuteReading } from '../../core/monitor-history';
import type { HistoryView } from '../../core/api-sysmon';
import { featureOn } from './features';
import { monitorSettings } from './monitor-settings';
import { LiveSampler, readSensors } from './monitor-probe';

let store: HistoryStore | null = null;
let dirty = 0;
const sampler = new LiveSampler();
const rapl = new Map<string, { uj: number; t: number }>();

const binFile = () => path.join(app.getPath('userData'), 'monitor-history.bin');
const appsFile = () => path.join(app.getPath('userData'), 'monitor-apps.json');

function load(): HistoryStore {
  if (store) return store;
  try {
    store = decode(new Uint8Array(readFileSync(binFile())));
  } catch {
    store = emptyStore();
  }
  try {
    const apps = JSON.parse(readFileSync(appsFile(), 'utf8'));
    if (Array.isArray(apps)) store.apps = apps;
  } catch {
    /* none yet */
  }
  return store;
}

/** Brings the old one-day history in once, so charts are not empty on the first day; takes the first counter reading so the first minute has rates. */
export function seedFromLegacy(samples: Parameters<typeof importLegacy>[1]) {
  importLegacy(load(), samples);
  void sampler.read().catch(() => undefined);
}

export async function saveHistory() {
  if (!store || !dirty) return;
  dirty = 0;
  const bin = encode(store);
  await fsp.writeFile(binFile() + '.tmp', bin).then(() => fsp.rename(binFile() + '.tmp', binFile())).catch(() => undefined);
  await fsp.writeFile(appsFile() + '.tmp', JSON.stringify(store.apps)).then(() => fsp.rename(appsFile() + '.tmp', appsFile())).catch(() => undefined);
}

/** Called by Health once a minute with what it already read; adds network, disk and sensors. */
export async function recordMinute(r: Omit<MinuteReading, 'netIn' | 'netOut' | 'diskR' | 'diskW'>) {
  if (!featureOn('monitorHistory')) return;
  const live = await sampler.read().catch(() => undefined);
  const extra: Partial<MinuteReading> = { netIn: live?.netIn, netOut: live?.netOut, diskR: live?.diskR, diskW: live?.diskW };
  if (featureOn('monitorSensors')) {
    const s = await readSensors({ gpu: true, temps: true, power: true, quick: true }, rapl).catch(() => undefined);
    if (s) {
      if (s.gpus.length) extra.gpu = Math.max(...s.gpus.map((g) => g.util ?? 0));
      if (s.temps.length) extra.temp = s.temps[0].celsius;
      extra.power = s.power.package ?? (s.power.battery !== undefined && s.power.battery > 0 ? s.power.battery : undefined);
    }
  }
  addMinute(load(), { ...r, ...extra }, monitorSettings().retentionDays);
  // Write every five minutes: a year of history is about 1 MB, so this stays small.
  if (++dirty >= 5) await saveHistory();
}

export function historyView(from: number, to: number, maxPoints = 600): HistoryView {
  const s = load();
  const q = query(s, from, to, Math.max(30, Math.min(2000, maxPoints)));
  return { tier: q.tier, step: q.step, points: q.points, peaks: peaks(q), top: topApps(s, from, to), oldest: s.tiers['1d'][0]?.t ?? s.tiers['1m'][0]?.t ?? null };
}

export function historyCsv(from: number, to: number): string {
  return toCsv(query(load(), from, to, 100_000));
}

export async function clearHistory() {
  store = emptyStore();
  dirty = 1;
  await saveHistory();
}

// Nothing older than five minutes is lost when Keeper quits.
app.on('before-quit', () => void saveHistory());
