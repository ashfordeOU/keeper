// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The app side of the browser link: each linked browser (through `keeper
// browser-host`) has a session with its open tabs; commands go back as
// notifications on the session's long call and replies come back by id.
// Event-driven: nothing runs unless a browser is linked and something changes.

import { randomUUID } from 'node:crypto';
import { existsSync, promises as fsp } from 'node:fs';
import { BROWSER_LIMITS, buildBlockRules, buildPac, checkCommand, flattenTabs, type BrowserCap, type BrowserSession, type BrowserTab, type TabCommand } from '../../core/browser-tabs';
import { parseList } from '../../core/fw/blocklist';
import type { BrowserTabsApi } from '../../core/api-settingsplus';
import { fwApi } from './fw';
import { addExtension, autoLink, revealExtension, setupStatus } from './browser-setup';

interface Live extends BrowserSession {
  notify: (method: string, params: unknown) => void;
  end: () => void;
}

const sessions = new Map<string, Live>();
const waiting = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
let changed: (() => void) | null = null;
export function onBrowsersChanged(fn: () => void) {
  changed = fn;
}
let expiry: NodeJS.Timeout | undefined;

function sweep() {
  // A browser that stopped pinging (closed, crashed) is dropped; the timer only runs while one is linked.
  const now = Date.now();
  for (const s of sessions.values()) if (now - s.seen > 95_000) { s.end(); sessions.delete(s.id); changed?.(); }
  if (!sessions.size) { clearInterval(expiry); expiry = undefined; }
}

/** keeper/browser.attach: stays open while the browser is linked. */
export function attach(p: Record<string, unknown>, notify: (method: string, params: unknown) => void): Promise<unknown> {
  const id = String(p.session ?? '');
  if (!/^[\w-]{8,64}$/.test(id)) throw new Error('Bad session');
  return new Promise((resolve) => {
    sessions.get(id)?.end();
    sessions.set(id, { id, browser: String(p.browser ?? 'Browser').slice(0, 60), caps: (Array.isArray(p.caps) ? p.caps : []) as BrowserCap[], tabs: [], seen: Date.now(), notify, end: () => resolve({ ended: true }) });
    expiry ??= setInterval(sweep, 30_000);
    expiry.unref?.();
    changed?.();
    // New browsers get the current blocking rules straight away.
    void syncBlocking(id).catch(() => undefined);
  });
}

export function tabsReport(p: Record<string, unknown>) {
  const s = sessions.get(String(p.session));
  if (!s) return { ok: false };
  s.tabs = (Array.isArray(p.tabs) ? p.tabs : []) as BrowserTab[];
  s.seen = Date.now();
  changed?.();
  return { ok: true };
}

export function reply(p: Record<string, unknown>) {
  const w = waiting.get(String(p.reqId));
  if (!w) return { ok: false };
  waiting.delete(String(p.reqId));
  clearTimeout(w.timer);
  if (p.ok) w.resolve(p.result);
  else w.reject(new Error(String(p.error ?? 'The browser refused')));
  return { ok: true };
}

export function ping(p: Record<string, unknown>) {
  const s = sessions.get(String(p.session));
  if (s) s.seen = Date.now();
  return { ok: !!s };
}

export function detach(p: Record<string, unknown>) {
  const s = sessions.get(String(p.session));
  if (s) { s.end(); sessions.delete(s.id); changed?.(); }
  return { ok: true };
}

/** Sends a checked command to a browser and waits for its answer. */
export function command(session: string, c: TabCommand, timeout = 15_000): Promise<unknown> {
  const s = sessions.get(session);
  if (!s) return Promise.reject(new Error('That browser is no longer linked'));
  const checked = checkCommand(c);
  const reqId = randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { waiting.delete(reqId); reject(new Error('The browser did not answer')); }, timeout);
    waiting.set(reqId, { resolve, reject, timer });
    s.notify('keeper/browser.command', { session, reqId, command: checked });
  });
}

const ok = async (p: Promise<unknown>) => {
  try {
    await p;
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
};

/** Keeper's enabled blocklists as rules for the browser (third-party requests only, so sites themselves still open). */
async function blockRules() {
  const st = await fwApi.status();
  const lists = (st.settings as { lists?: { id: string; enabled: boolean }[] }).lists?.filter((l) => l.enabled) ?? [];
  const domains: string[] = [];
  const { app } = await import('electron');
  for (const l of lists) {
    const f = `${app.getPath('userData')}/firewall/lists/${l.id}.txt`;
    if (!existsSync(f)) continue;
    domains.push(...parseList(await fsp.readFile(f, 'utf8')).domains);
    if (domains.length > 4_000_000) break;
  }
  return buildBlockRules(domains);
}

async function syncBlocking(only?: string): Promise<{ ok: boolean; message: string }> {
  const targets = [...sessions.values()].filter((s) => (!only || s.id === only) && s.caps.includes('dnr'));
  if (!targets.length) return { ok: false, message: 'No linked browser can take blocking rules' };
  const rules = await blockRules();
  const res = await Promise.all(targets.map((s) => ok(command(s.id, { cmd: 'setBlockRules', rules }, 60_000))));
  const failed = res.filter((r) => !r.ok).length;
  return { ok: !failed, message: failed ? `${failed} browser(s) refused the rules` : `${rules.length} rule groups sent to ${targets.length} browser(s)` };
}

const liveList = (): BrowserSession[] => [...sessions.values()].map(({ notify: _n, end: _e, ...s }) => s);

/** At start (with the feature on): registers Keeper with the browsers found, so linking needs no button. */
export function startBrowserLink() {
  setTimeout(() => void autoLink(liveList()).catch(() => undefined), 8_000).unref?.();
}

export const browserTabsApi: BrowserTabsApi = {
  async sessions() {
    return { sessions: liveList(), limits: BROWSER_LIMITS, hostInstalled: true };
  },
  async tab(session, tabId, action) {
    const c: TabCommand = action === 'mute' || action === 'unmute' ? { cmd: 'mute', tabId, muted: action === 'mute' } : { cmd: action, tabId };
    return ok(command(session, c));
  },
  async info(session, tabId) {
    return (await command(session, { cmd: 'tabInfo', tabId }).catch(() => null)) as BrowserTab | null;
  },
  async siteSettings(session, url) {
    return (await command(session, { cmd: 'getContentSettings', url })) as Record<string, string>;
  },
  async setSite(session, site, type, value) {
    return ok(command(session, { cmd: 'contentSetting', type, pattern: site, setting: value }));
  },
  async clearSite(session, origin) {
    return ok(command(session, { cmd: 'clearSiteData', origin, what: ['cookies', 'cache', 'localStorage'] }));
  },
  async blockThirdPartyCookies(session, block) {
    return ok(command(session, { cmd: 'thirdPartyCookies', block }));
  },
  syncBlocking: () => syncBlocking(),
  async siteBlocking(session, site, on) {
    return ok(command(session, { cmd: 'setSiteBlocking', site, on }));
  },
  async siteProxy(session, sites, proxy) {
    return ok(command(session, { cmd: 'setProxy', pac: proxy ? buildPac(sites, proxy) : null }));
  },
  async installHost() {
    const r = await autoLink(liveList(), true);
    return { ok: !!r?.installed.length, message: r?.installed.length ? `Keeper is registered with ${r.installed.join(', ')}` : 'No supported browser found on this computer' };
  },
  setup: () => setupStatus(liveList()),
  addExtension: (id) => addExtension(id),
  revealExtension: (id) => revealExtension(id),
};

/** For agents: every open tab across browsers. */
export function allTabs() {
  return flattenTabs([...sessions.values()]);
}
