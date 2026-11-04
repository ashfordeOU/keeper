// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Settings that follow you between your computers (core/settings-sync.ts has
// the rules): over Keeper Link only, with the computers you choose, for the
// kinds of settings you choose. Each computer asks the other with its doc and
// adopts the merged answer. Off: no timers, no listener, and a request from
// another computer is refused.

import { app } from 'electron';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SettingsSyncApi, SettingsSyncStatus } from '../../core/api-settings-sync';
import { call } from '../../core/link/mux';
import {
  applyItems, DEFAULT_CATEGORIES, itemsOf, keepOlder, mergeDocs, onlyCats, stamp, SYNC_CATEGORIES,
  type OlderVersion, type SyncCategory, type SyncDoc, type SyncSource,
} from '../../core/settings-sync';
import type { AllSettings } from '../../core/settings';
import { onSettings, settings, updateSettings } from '../store';
import { featureOn, onFeature } from './features';
import { linkNode } from './link';
import { onVoiceSettings, saveVoiceSettings, voiceSettings } from './voice/store';

interface State {
  doc: SyncDoc;
  older: OlderVersion[];
  categories: SyncCategory[];
  /** computers this one shares with */
  devices: string[];
  last: Record<string, { at: number; ok: boolean; message?: string }>;
}

const file = () => path.join(app.getPath('userData'), 'settings-sync.json');
let state: State | null = null;
let broadcast: (ch: string) => void = () => undefined;

async function load(): Promise<State> {
  if (state) return state;
  const raw = await fsp.readFile(file(), 'utf8').then((t) => JSON.parse(t) as Partial<State>).catch(() => ({}) as Partial<State>);
  state = { doc: raw.doc ?? {}, older: raw.older ?? [], categories: (raw.categories ?? DEFAULT_CATEGORIES).filter((c) => SYNC_CATEGORIES.some((x) => x.id === c)), devices: raw.devices ?? [], last: raw.last ?? {} };
  return state;
}

let writing = Promise.resolve();
const save = () => (writing = writing.then(() => fsp.writeFile(file(), JSON.stringify(state), { mode: 0o600 })).catch(() => undefined));

const me = () => linkNode()?.thisDevice().id ?? 'this';

function source(): SyncSource {
  const s = settings() as AllSettings & Record<string, unknown>;
  return {
    snippets: voiceSettings().snippets as SyncSource['snippets'],
    look: Object.fromEntries(['appearance', 'theme', 'accent', 'font', 'density', 'corners', 'themeSeasons', 'look'].map((k) => [k, s[k]])),
    launcher: s.launcher as unknown as SyncSource['launcher'],
    rules: s.rules as unknown as SyncSource['rules'],
    searches: s.savedSearches as unknown as SyncSource['searches'],
    mode: s.mode,
  };
}

/** Notes what changed here since last time. */
async function stampNow(): Promise<State> {
  const st = await load();
  const src = source();
  const now = Object.fromEntries(st.categories.map((c) => [c, itemsOf(c, src, os.homedir())]));
  // What this computer had before it ever shared has no age: a change made after sharing began wins over it.
  st.doc = stamp(st.doc, now, Date.now(), me(), 0);
  return st;
}

let applying = false;
/** Writes merged items back into settings and snippets. */
async function adopt(changed: SyncCategory[]) {
  if (!changed.length) return;
  const st = await load();
  const src = source();
  const patch: Record<string, unknown> = {};
  applying = true;
  try {
    for (const c of changed) {
      const out = applyItems(c, st.doc[c] ?? {}, src, os.homedir());
      if (out.snippets) await saveVoiceSettings({ snippets: out.snippets } as never);
      if (out.look) Object.assign(patch, out.look);
      if (out.launcher) patch.launcher = { ...(settings().launcher ?? {}), ...out.launcher };
      if (out.rules) patch.rules = out.rules;
      if (out.searches) patch.savedSearches = out.searches;
      if (out.mode !== undefined) patch.mode = out.mode;
    }
    if (Object.keys(patch).length) await updateSettings(patch as Partial<AllSettings>);
  } finally {
    applying = false;
  }
}

/** Another computer's request: merge its doc into ours, adopt, answer with ours. */
async function answer(p: Record<string, unknown>): Promise<{ doc: SyncDoc; categories: SyncCategory[] }> {
  if (!featureOn('settingsSync')) throw new Error('Settings sharing is off on that computer');
  const device = String(p.$device ?? '');
  const st = await stampNow();
  if (!st.devices.includes(device)) throw new Error('That computer does not share settings with this one');
  const theirCats = (Array.isArray(p.categories) ? p.categories : []) as SyncCategory[];
  const both = st.categories.filter((c) => theirCats.includes(c));
  const m = mergeDocs(st.doc, (p.doc ?? {}) as SyncDoc, both);
  st.doc = m.doc;
  st.older = keepOlder(st.older, m.older);
  st.last[device] = { at: Date.now(), ok: true };
  await save();
  await adopt(m.changed);
  broadcast('settings-sync-changed');
  return { doc: onlyCats(st.doc, both), categories: both };
}

function install() {
  linkNode()?.registerRpc('settings.sync', 'settingsSync', answer);
}

/** Shares with each chosen computer that is reachable now. */
export async function syncNow(): Promise<SettingsSyncStatus> {
  install();
  const node = linkNode();
  const st = await stampNow();
  await save();
  if (node && featureOn('settingsSync')) {
    for (const device of st.devices) {
      try {
        const r = await call<{ doc: SyncDoc; categories: SyncCategory[] }>(await node.connect(device), 'settings.sync', { doc: onlyCats(st.doc, st.categories), categories: st.categories }, 20_000);
        const m = mergeDocs(st.doc, r.doc, r.categories);
        st.doc = m.doc;
        st.older = keepOlder(st.older, m.older);
        st.last[device] = { at: Date.now(), ok: true };
        await adopt(m.changed);
      } catch (e) {
        st.last[device] = { at: Date.now(), ok: false, message: e instanceof Error ? e.message.replace(/^Error: /, '') : String(e) };
      }
    }
    await save();
  }
  broadcast('settings-sync-changed');
  return status();
}

async function status(): Promise<SettingsSyncStatus> {
  const st = await load();
  const node = linkNode();
  const devices = node?.state().devices ?? [];
  return {
    on: featureOn('settingsSync'),
    categories: st.categories,
    devices: devices.map((d) => ({ id: d.id, name: d.name, online: d.online, sharing: st.devices.includes(d.id), last: st.last[d.id] })),
    older: st.older,
  };
}

let soon: NodeJS.Timeout | undefined;
let every: NodeJS.Timeout | undefined;
let offSettings: (() => void) | null = null;
let offVoice: (() => void) | null = null;
const later = () => {
  if (applying) return;
  // Noted now, so the time is when it changed rather than when it was next shared.
  void stampNow().then(save);
  clearTimeout(soon);
  soon = setTimeout(() => void syncNow(), 8_000);
};

export function startSettingsSync(d: { broadcast: (ch: string) => void }) {
  broadcast = d.broadcast;
  onFeature('settingsSync', (on) => {
    clearTimeout(soon);
    clearInterval(every);
    offSettings?.();
    offVoice?.();
    offSettings = offVoice = null;
    if (!on) return;
    install();
    offSettings = onSettings(later);
    offVoice = onVoiceSettings(later);
    every = setInterval(() => void syncNow(), 15 * 60_000);
    every.unref?.();
    soon = setTimeout(() => void syncNow(), 20_000);
  }, { now: true });
}

export const settingsSyncApi: SettingsSyncApi = {
  status,
  syncNow,
  async setCategories(cats) {
    const st = await load();
    st.categories = cats.filter((c) => SYNC_CATEGORIES.some((x) => x.id === c));
    await save();
    later();
    return status();
  },
  async setDevice(device, on) {
    const st = await load();
    st.devices = on ? [...new Set([...st.devices, device])] : st.devices.filter((x) => x !== device);
    // The other computer may ask this one only when it is chosen here.
    const node = linkNode();
    const dev = node?.state().devices.find((x) => x.id === device);
    if (node && dev) node.setPermissions(device, { ...dev.permissions, settingsSync: on });
    // From here on, a change is a change: note how things are now.
    await stampNow();
    await save();
    if (on) later();
    return status();
  },
  async restoreOlder(index) {
    const st = await load();
    const o = st.older[index];
    if (!o) throw new Error('That version is gone');
    const src = source();
    const items = { ...(st.doc[o.cat] ?? {}) };
    items[o.key] = { value: o.value, at: Date.now(), by: me(), hash: 'restored' };
    const out = applyItems(o.cat, items, src, os.homedir());
    // Written as a change here, so it travels to the other computers as the newest.
    if (out.snippets) await saveVoiceSettings({ snippets: out.snippets } as never);
    const patch: Record<string, unknown> = {};
    if (out.look) Object.assign(patch, out.look);
    if (out.launcher) patch.launcher = { ...(settings().launcher ?? {}), ...out.launcher };
    if (out.rules) patch.rules = out.rules;
    if (out.searches) patch.savedSearches = out.searches;
    if (out.mode !== undefined) patch.mode = out.mode;
    if (Object.keys(patch).length) await updateSettings(patch as Partial<AllSettings>);
    st.older = st.older.filter((_, i) => i !== index);
    await save();
    later();
    return status();
  },
};
