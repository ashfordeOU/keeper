// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Browser-preview stand-ins for System Settings+, App controls and Browser tabs.

import { CONTROLS } from '../core/appctl';
import { BROWSER_LIMITS, type BrowserCap } from '../core/browser-tabs';
import { AFTER_TEXT, CATALOG, catalogCounts, catalogFor, opText, searchCatalog, settingById, showCmd, writeCmds, type ChangeRecord, type SettingDef } from '../core/settings-catalog';
import type { AppControlState, CatalogEntry } from '../core/api-settingsplus';
import type { DetectedBrowser, SetupBrowserId } from '../core/browser-setup';

const OS = 'linux' as const;
const entry = (s: SettingDef): CatalogEntry => ({ ...s, afterText: AFTER_TEXT[s.after], advice: s.op.t === 'advice', technical: opText(s) } as CatalogEntry);

export function mockSettingsPlus() {
  const values = new Map<string, string>();
  const log: ChangeRecord[] = [];
  let favs: string[] = ['linux.gnome.colorscheme'];
  const states: Record<string, AppControlState> = {};
  // Demo: ?browsers=none starts with no browser connected (the setup screen); "Add to Chrome" connects it a few seconds later.
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
  let demoLinked = q.get('browsers') !== 'none';
  const demoBrowsers = (): DetectedBrowser[] => [
    { id: 'chrome', name: 'Chrome', engine: 'chromium', supported: true, linked: true, connected: demoLinked },
    { id: 'firefox', name: 'Firefox', engine: 'firefox', supported: true, linked: true, connected: false },
    { id: 'safari', name: 'Safari', engine: 'webkit', supported: false, linked: false, connected: false },
  ];
  const demoFolder = '/Users/demo/Library/Application Support/Keeper/browser-extension';
  return {
    catalog: {
      list: async (all?: boolean) => ({ os: OS, entries: (all ? CATALOG : catalogFor(OS)).map(entry), counts: catalogCounts() }),
      search: async (q: string) => searchCatalog(q, OS).map(entry),
      read: async (ids: string[]) => ids.map((id) => { const s = settingById(id)!; const v = values.get(id); return { id, raw: v, value: v ?? s?.systemDefault ?? '', isDefault: v === undefined }; }),
      preview: async (id: string, value: string) => { const s = settingById(id)!; return { id, title: s.title, from: values.get(id) ?? s.systemDefault, to: value, commands: writeCmds(s, value).map(showCmd), admin: s.admin, afterText: AFTER_TEXT[s.after], risk: s.risk, warning: s.warning }; },
      apply: async (id: string, value: string) => { const s = settingById(id)!; const r: ChangeRecord = { id: String(Date.now()), settingId: id, title: s.title, os: OS, at: Date.now(), from: values.get(id), to: value, wasUnset: !values.has(id), by: 'person' }; values.set(id, value); log.unshift(r); return { ok: true, message: AFTER_TEXT[s.after], record: r }; },
      reset: async (id: string) => { values.delete(id); return { ok: true, message: 'Default restored' }; },
      log: async () => log,
      undo: async (cid: string) => { const r = log.find((l) => l.id === cid); if (r) { r.undone = true; if (r.from === undefined) values.delete(r.settingId); else values.set(r.settingId, r.from); } return { ok: true, message: 'Undone' }; },
      backups: async () => [],
      restoreBackup: async () => ({ ok: true, message: 'Restored' }),
      favourites: async () => favs,
      setFavourite: async (id: string, on: boolean) => (favs = on ? [...favs, id] : favs.filter((f) => f !== id)),
      exportProfile: async (name: string) => JSON.stringify({ format: 'keeper-setup-profile', version: 1, name, created: Date.now(), os: OS, settings: [...values].map(([id, value]) => ({ id, value })) }, null, 2),
      previewProfile: async () => ({ name: 'Profile', items: [] }),
      applyProfile: async () => [],
    },
    appctl: {
      controls: async () => CONTROLS.map((c) => ({ id: c.id, title: c.title, description: c.description, support: c.support[OS], note: c.notes[OS], admin: !!c.admin[OS] })),
      list: async () => Object.values(states),
      get: async (a: AppControlState['app']) => states[a.name] ?? { key: a.name, app: a },
      preview: async () => ({ commands: ['(as administrator) sh -c …'], notes: [] }),
      set: async (a: AppControlState['app'], patch: Partial<AppControlState>) => { states[a.name] = { ...(states[a.name] ?? { key: a.name, app: a }), ...patch }; return { ok: true, message: 'Done', state: states[a.name] }; },
      clear: async (a: AppControlState['app']) => { delete states[a.name]; return { ok: true, message: 'Cleared' }; },
      running: async () => [{ name: 'firefox', path: '/usr/lib/firefox/firefox', pid: 4242, appId: 'firefox.desktop' }, { name: 'code', path: '/usr/share/code/code', pid: 5151 }],
    },
    browserTabs: {
      sessions: async () => ({ sessions: !demoLinked ? [] : [{ id: 'demo', browser: 'Chrome 131', caps: ['tabs', 'mute', 'discard', 'contentSettings', 'dnr'] as BrowserCap[], seen: Date.now(), tabs: [
        { id: 1, windowId: 1, url: 'https://news.example.com/today', title: 'Today’s news', active: true, audible: false, muted: false, discarded: false, incognito: false, bytes: 3_400_000, requests: 180, parties: [{ host: 'ads.tracker.example', requests: 40, blocked: 38 }, { host: 'cdn.example.net', requests: 60 }] },
        { id: 2, windowId: 1, url: 'https://video.example.org/watch', title: 'A video', active: false, audible: true, muted: false, discarded: false, incognito: false, bytes: 48_000_000, requests: 90, parties: [] },
      ] }], limits: BROWSER_LIMITS, hostInstalled: true }),
      tab: async () => ({ ok: true }),
      info: async () => null,
      siteSettings: async () => ({ camera: 'ask', microphone: 'ask', location: 'block', notifications: 'block', javascript: 'allow' }),
      setSite: async () => ({ ok: true }),
      clearSite: async () => ({ ok: true }),
      blockThirdPartyCookies: async () => ({ ok: true }),
      syncBlocking: async () => ({ ok: true, message: 'Sent' }),
      siteBlocking: async () => ({ ok: true }),
      siteProxy: async () => ({ ok: true }),
      installHost: async () => ({ ok: true, message: 'Keeper is registered with Chrome, Firefox' }),
      setup: async () => ({ browsers: demoBrowsers(), connected: demoLinked }),
      addExtension: async (id: SetupBrowserId) => {
        if (q.get('connect') !== 'never') setTimeout(() => { demoLinked = true; }, 6000);
        return { ok: true, mode: 'unpacked' as const, opened: true, page: id === 'firefox' ? 'about:debugging#/runtime/this-firefox' : 'chrome://extensions', folder: id === 'firefox' ? `${demoFolder}-firefox/manifest.json` : demoFolder };
      },
      revealExtension: async (id: SetupBrowserId) => ({ ok: true, folder: id === 'firefox' ? `${demoFolder}-firefox/manifest.json` : demoFolder }),
    },
  };
}
