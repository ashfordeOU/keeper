// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Where the person is in Keeper, in a form that survives a crash: every window,
// its tabs, each tab's page and history, scroll positions and unsent drafts.
// Pure: the tab operations here are used by the interface, and the checkpoint
// format (two generations, each with a checksum) by the main process.

export interface TabRoute {
  name: string;
  arg?: string;
  q?: string;
}

export interface Tab {
  id: string;
  route: TabRoute;
  /** pages behind this one (Back) */
  back: TabRoute[];
  /** pages ahead after going back (Forward) */
  fwd: TabRoute[];
  pinned?: boolean;
  /** when the tab was last in front, for sleeping and "reopen" order */
  lastActive: number;
}

export interface WindowState {
  /** 'main' for the main window, w1, w2… for windows a tab was moved into */
  key: string;
  tabs: Tab[];
  active: string;
  /** scroll position of each page, by route */
  scroll: Record<string, number>;
  /** text typed and not yet sent or saved, by tab and field */
  drafts: Record<string, string>;
  /** recently closed tabs, newest last, for "Reopen Closed Tab" */
  closed: Tab[];
  bounds?: { x: number; y: number; width: number; height: number };
}

export interface SessionSnapshot {
  version: 1;
  savedAt: number;
  windows: WindowState[];
}

const MAX_HISTORY = 30;
const MAX_CLOSED = 20;
const MAX_TABS = 60;

export const routeKey = (r: TabRoute) => `${r.name}|${r.arg ?? ''}|${r.q ?? ''}`;
const same = (a: TabRoute, b: TabRoute) => routeKey(a) === routeKey(b);

let seq = 0;
export function newTabId(): string {
  return `t${Date.now().toString(36)}${(seq++).toString(36)}`;
}

export function newTab(route: TabRoute, now = Date.now()): Tab {
  return { id: newTabId(), route, back: [], fwd: [], lastActive: now };
}

export function emptyWindow(key = 'main', route: TabRoute = { name: 'home' }): WindowState {
  const t = newTab(route);
  return { key, tabs: [t], active: t.id, scroll: {}, drafts: {}, closed: [] };
}

function mapTab(w: WindowState, id: string, fn: (t: Tab) => Tab): WindowState {
  return { ...w, tabs: w.tabs.map((t) => (t.id === id ? fn(t) : t)) };
}

export function activeTab(w: WindowState): Tab {
  return w.tabs.find((t) => t.id === w.active) ?? w.tabs[0];
}

/** Opens a page in the tab in front, keeping Back history. */
export function navigate(w: WindowState, route: TabRoute): WindowState {
  const t = activeTab(w);
  if (same(t.route, route)) return w;
  return mapTab(w, t.id, (x) => ({ ...x, route, back: [...x.back, x.route].slice(-MAX_HISTORY), fwd: [] }));
}

export function goBack(w: WindowState): WindowState {
  const t = activeTab(w);
  if (!t.back.length) return w;
  const prev = t.back[t.back.length - 1];
  return mapTab(w, t.id, (x) => ({ ...x, route: prev, back: x.back.slice(0, -1), fwd: [x.route, ...x.fwd].slice(0, MAX_HISTORY) }));
}

export function goForward(w: WindowState): WindowState {
  const t = activeTab(w);
  if (!t.fwd.length) return w;
  const next = t.fwd[0];
  return mapTab(w, t.id, (x) => ({ ...x, route: next, back: [...x.back, x.route].slice(-MAX_HISTORY), fwd: x.fwd.slice(1) }));
}

/** A new tab right after the one in front (pinned tabs stay first). */
export function openTab(w: WindowState, route: TabRoute, opts: { background?: boolean; now?: number } = {}): WindowState {
  if (w.tabs.length >= MAX_TABS) return navigate(w, route);
  const t = newTab(route, opts.now);
  const at = Math.max(w.tabs.findIndex((x) => x.id === w.active) + 1, w.tabs.filter((x) => x.pinned).length);
  const tabs = [...w.tabs.slice(0, at), t, ...w.tabs.slice(at)];
  return { ...w, tabs, active: opts.background ? w.active : t.id };
}

export function selectTab(w: WindowState, id: string, now = Date.now()): WindowState {
  if (!w.tabs.some((t) => t.id === id)) return w;
  return { ...mapTab(w, id, (t) => ({ ...t, lastActive: now })), active: id };
}

/** Closing the last tab leaves a fresh Home tab, so a window is never empty. */
export function closeTab(w: WindowState, id: string): WindowState {
  const i = w.tabs.findIndex((t) => t.id === id);
  if (i < 0) return w;
  const gone = w.tabs[i];
  const tabs = w.tabs.filter((t) => t.id !== id);
  const closed = [...w.closed, gone].slice(-MAX_CLOSED);
  // Drafts belong to the tab; they go with it (and come back with "Reopen").
  if (!tabs.length) {
    const fresh = newTab({ name: 'home' });
    return { ...w, tabs: [fresh], active: fresh.id, closed };
  }
  const active = w.active === id ? (tabs[Math.min(i, tabs.length - 1)]).id : w.active;
  return { ...w, tabs, active, closed };
}

export function reopenClosed(w: WindowState): WindowState {
  const last = w.closed[w.closed.length - 1];
  if (!last) return w;
  const back = { ...w, closed: w.closed.slice(0, -1) };
  const at = Math.min(back.tabs.length, back.tabs.findIndex((t) => t.id === w.active) + 1);
  return { ...back, tabs: [...back.tabs.slice(0, at), last, ...back.tabs.slice(at)], active: last.id };
}

export function closeOthers(w: WindowState, id: string): WindowState {
  const keep = w.tabs.filter((t) => t.id === id || t.pinned);
  const gone = w.tabs.filter((t) => !keep.includes(t));
  return { ...w, tabs: keep, active: id, closed: [...w.closed, ...gone].slice(-MAX_CLOSED) };
}

export function closeToRight(w: WindowState, id: string): WindowState {
  const i = w.tabs.findIndex((t) => t.id === id);
  if (i < 0) return w;
  const gone = w.tabs.slice(i + 1).filter((t) => !t.pinned);
  const tabs = w.tabs.filter((t) => !gone.includes(t));
  return { ...w, tabs, active: tabs.some((t) => t.id === w.active) ? w.active : id, closed: [...w.closed, ...gone].slice(-MAX_CLOSED) };
}

export function moveTab(w: WindowState, id: string, to: number): WindowState {
  const from = w.tabs.findIndex((t) => t.id === id);
  if (from < 0) return w;
  const tabs = [...w.tabs];
  const [t] = tabs.splice(from, 1);
  // Pinned tabs stay together at the front.
  const pinned = tabs.filter((x) => x.pinned).length;
  const at = Math.max(0, Math.min(tabs.length, t.pinned ? Math.min(to, pinned) : Math.max(to, pinned)));
  tabs.splice(at, 0, t);
  return { ...w, tabs };
}

export function pinTab(w: WindowState, id: string, pinned: boolean): WindowState {
  const t = w.tabs.find((x) => x.id === id);
  if (!t) return w;
  const rest = w.tabs.filter((x) => x.id !== id);
  const p = { ...t, pinned };
  const lastPinned = rest.filter((x) => x.pinned).length;
  const tabs = pinned ? [...rest.slice(0, lastPinned), p, ...rest.slice(lastPinned)] : [...rest.slice(0, lastPinned), p, ...rest.slice(lastPinned)];
  return { ...w, tabs };
}

export function duplicateTab(w: WindowState, id: string): WindowState {
  const t = w.tabs.find((x) => x.id === id);
  if (!t) return w;
  const copy: Tab = { ...t, id: newTabId(), pinned: false, back: [...t.back], fwd: [...t.fwd], lastActive: Date.now() };
  const i = w.tabs.indexOf(t);
  const drafts = { ...w.drafts };
  for (const [k, v] of Object.entries(w.drafts)) if (k.startsWith(`${id}:`)) drafts[`${copy.id}:${k.slice(id.length + 1)}`] = v;
  return { ...w, tabs: [...w.tabs.slice(0, i + 1), copy, ...w.tabs.slice(i + 1)], active: copy.id, drafts };
}

/** Takes a tab out of this window (to move it into another). */
export function detachTab(w: WindowState, id: string): { rest: WindowState; tab?: Tab; drafts: Record<string, string> } {
  const tab = w.tabs.find((t) => t.id === id);
  if (!tab) return { rest: w, drafts: {} };
  const drafts: Record<string, string> = {};
  const keep: Record<string, string> = {};
  for (const [k, v] of Object.entries(w.drafts)) (k.startsWith(`${id}:`) ? drafts : keep)[k] = v;
  const rest = closeTab({ ...w, drafts: keep }, id);
  return { rest: { ...rest, closed: rest.closed.filter((t) => t.id !== id) }, tab, drafts };
}

/** Tabs that have not been in front for a while are put to sleep (their page is not kept in memory). */
export function sleepingTabs(w: WindowState, now: number, afterMs: number): string[] {
  return w.tabs.filter((t) => t.id !== w.active && now - t.lastActive > afterMs).map((t) => t.id);
}

/** Drops anything malformed so a damaged file can never stop Keeper from opening. */
export function sanitizeWindow(w: unknown, key = 'main'): WindowState {
  const x = (w ?? {}) as Partial<WindowState>;
  const okRoute = (r: unknown): r is TabRoute => !!r && typeof (r as TabRoute).name === 'string';
  const tabs = (Array.isArray(x.tabs) ? x.tabs : [])
    .filter((t) => t && typeof t.id === 'string' && okRoute(t.route))
    .slice(0, MAX_TABS)
    .map((t) => ({
      id: t.id, route: t.route, pinned: !!t.pinned, lastActive: Number(t.lastActive) || 0,
      back: (Array.isArray(t.back) ? t.back : []).filter(okRoute).slice(-MAX_HISTORY),
      fwd: (Array.isArray(t.fwd) ? t.fwd : []).filter(okRoute).slice(0, MAX_HISTORY),
    }));
  if (!tabs.length) return emptyWindow(typeof x.key === 'string' ? x.key : key);
  const strMap = (m: unknown) => Object.fromEntries(Object.entries((m && typeof m === 'object' ? m : {}) as Record<string, unknown>).filter(([, v]) => typeof v === 'string' && v.length < 200_000)) as Record<string, string>;
  const numMap = (m: unknown) => Object.fromEntries(Object.entries((m && typeof m === 'object' ? m : {}) as Record<string, unknown>).filter(([, v]) => typeof v === 'number' && Number.isFinite(v))) as Record<string, number>;
  const active = tabs.some((t) => t.id === x.active) ? (x.active as string) : tabs[0].id;
  const b = x.bounds;
  return {
    key: typeof x.key === 'string' ? x.key : key, tabs, active, scroll: numMap(x.scroll), drafts: strMap(x.drafts),
    closed: (Array.isArray(x.closed) ? x.closed : []).filter((t) => t && typeof t.id === 'string' && okRoute(t.route)).slice(-MAX_CLOSED) as Tab[],
    ...(b && [b.x, b.y, b.width, b.height].every((n) => Number.isFinite(n)) ? { bounds: b } : {}),
  };
}
