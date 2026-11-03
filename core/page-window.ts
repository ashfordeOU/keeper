// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Pages in windows of their own ("Open in New Window"): which page a request
// names, what its window is called, and where it opens. No Electron here; the
// windows themselves are made by electron/services/page-windows.ts.
//
// A page window is keyed by its page (core/nav.ts): asking again for a page
// that already has a window brings that window forward instead of opening a
// second one. Its size and place are kept per page in settings (pageWindows).

import { NAV_PAGES, navPage, pageOf, type NavRoute } from './nav';

/** Where a window is on the screen. */
export interface Rect { x: number; y: number; width: number; height: number }

/** A page window's place, as kept in settings. */
export interface SavedPageWindow extends Rect {
  maximized?: boolean;
  /** when it was last moved or resized (the oldest go first when too many are kept) */
  at?: number;
}

export const PAGE_WINDOW_DEFAULT = { width: 1100, height: 760 };
export const PAGE_WINDOW_MIN = { width: 520, height: 420 };
/** Places kept, at most (one per page, the most recently used). */
export const PAGE_WINDOWS_KEPT = 40;

/** The command-line switch that opens a page in its own window: `--keeper-open=mail`. */
export const OPEN_SWITCH = '--keeper-open';

/** The calls the interface makes. */
export interface PageWindowsApi {
  /** opens the page this route belongs to in a window of its own, or brings its window forward */
  openPage(route: NavRoute, label?: string): Promise<{ key: string; created: boolean } | null>;
  /** the pages that have a window of their own now */
  list(): Promise<{ key: string; title: string }[]>;
}

const PAGE_ID = /^[a-z][a-z0-9-]{0,39}$/;
const ROUTE_NAME = /^[a-z][a-zA-Z0-9-]{0,39}$/;

/** A page that can be named from outside Keeper (a launcher, a link, the command line): only Keeper's own pages. */
export function openablePage(id: unknown): string | undefined {
  if (typeof id !== 'string') return undefined;
  const v = id.trim().toLowerCase();
  return PAGE_ID.test(v) && navPage(v) ? v : undefined;
}

/** The page named by `--keeper-open=<page>` (or `--keeper-open <page>`) in a command line; anything else is ignored. */
export function pageFromArgv(argv: readonly string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith(`${OPEN_SWITCH}=`)) return openablePage(a.slice(OPEN_SWITCH.length + 1));
    if (a === OPEN_SWITCH) return openablePage(argv[i + 1]);
  }
  return undefined;
}

/** The page named by `keeper://open/<page>`; undefined for every other link (keeper://open?path=… included). */
export function pageFromUrl(url: string): string | undefined {
  let u: URL;
  try { u = new URL(url); } catch { return undefined; }
  if (u.protocol !== 'keeper:') return undefined;
  const parts = `${u.hostname}${u.pathname}`.split('/').filter(Boolean);
  if (parts.length !== 2 || parts[0] !== 'open') return undefined;
  let id: string;
  try { id = decodeURIComponent(parts[1]); } catch { return undefined; }
  return openablePage(id);
}

/** The window a route opens in: its page's id, or the route's name for a page outside the sidebar. */
export function pageWindowKey(r: NavRoute): string | undefined {
  if (!r || typeof r.name !== 'string' || !ROUTE_NAME.test(r.name)) return undefined;
  return pageOf(r)?.id ?? r.name.toLowerCase();
}

/** A route that came from a window: a plain name, an argument and a query of sensible length. */
export function cleanRoute(r: unknown): NavRoute | undefined {
  if (!r || typeof r !== 'object') return undefined;
  const { name, arg, q } = r as Record<string, unknown>;
  if (typeof name !== 'string' || !ROUTE_NAME.test(name)) return undefined;
  const out: NavRoute = { name };
  if (typeof arg === 'string' && arg.length <= 2000) out.arg = arg;
  if (typeof q === 'string' && q.length <= 2000) out.q = q;
  return out;
}

/** The route a page opens on (its first tab for a page with tabs). */
export function routeOfPage(id: string): NavRoute | undefined {
  const p = navPage(id);
  return p ? { ...p.route } : undefined;
}

/** The page's name for its window: the sidebar's name, or the name the window gave. */
export function pageWindowLabel(key: string, given?: string): string {
  const clean = typeof given === 'string' ? given.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 60) : '';
  return clean || navPage(key)?.label || key.charAt(0).toUpperCase() + key.slice(1);
}

/** "Mail — Keeper" */
export function pageWindowTitle(label: string, brand = 'Keeper'): string {
  return `${label} — ${brand}`;
}

/** Every page that can open in a window of its own from outside Keeper, for help text and tests. */
export function openablePages(): string[] {
  return NAV_PAGES.map((p) => p.id);
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Places read back from settings: well-formed ones only, the most recent PAGE_WINDOWS_KEPT. */
export function sanitizePageWindows(raw: unknown): Record<string, SavedPageWindow> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const ok: [string, SavedPageWindow][] = [];
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^[a-z][a-z0-9-]{0,39}$/.test(k) || !v || typeof v !== 'object') continue;
    const { x, y, width, height, maximized, at } = v as Record<string, unknown>;
    if (![x, y, width, height].every(finite) || (width as number) < 50 || (height as number) < 50 || (width as number) > 20000 || (height as number) > 20000) continue;
    if (Math.abs(x as number) > 100000 || Math.abs(y as number) > 100000) continue;
    ok.push([k, { x: Math.round(x as number), y: Math.round(y as number), width: Math.round(width as number), height: Math.round(height as number), ...(maximized === true ? { maximized: true } : {}), ...(finite(at) ? { at } : {}) }]);
  }
  ok.sort((a, b) => (b[1].at ?? 0) - (a[1].at ?? 0));
  return Object.fromEntries(ok.slice(0, PAGE_WINDOWS_KEPT));
}

/** Keeps one page's place, dropping the oldest when too many are kept. */
export function rememberPageWindow(all: Record<string, SavedPageWindow> | undefined, key: string, place: SavedPageWindow, now = Date.now()): Record<string, SavedPageWindow> {
  return sanitizePageWindows({ ...(all ?? {}), [key]: { ...place, at: now } });
}

function overlap(a: Rect, b: Rect): { w: number; h: number } {
  return { w: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)), h: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)) };
}

/** Fits a window inside one display's usable area: no bigger than it, and wholly on it. */
export function fitInto(r: Rect, area: Rect, min = PAGE_WINDOW_MIN): Rect {
  const width = Math.max(Math.min(min.width, area.width), Math.min(r.width, area.width));
  const height = Math.max(Math.min(min.height, area.height), Math.min(r.height, area.height));
  const x = Math.min(Math.max(r.x, area.x), area.x + area.width - width);
  const y = Math.min(Math.max(r.y, area.y), area.y + area.height - height);
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

/**
 * Where a page window opens. Its saved place when enough of it (the title bar's worth) is on a
 * display that is connected now, moved and shrunk to fit that display; otherwise the default size
 * centred on `near` (the display with the pointer), shifted a little for each window already open
 * so new windows do not stack exactly.
 */
export function placePageWindow(saved: SavedPageWindow | undefined, areas: Rect[], near: Rect, cascade = 0): Rect {
  if (saved && areas.length) {
    let best: Rect | undefined;
    let bestArea = 0;
    for (const a of areas) {
      const o = overlap(saved, a);
      if (o.w * o.h > bestArea) { bestArea = o.w * o.h; best = a; }
    }
    // At least a strip of the title bar must have been on that display to trust the place.
    const titleBar: Rect = { x: saved.x, y: saved.y, width: saved.width, height: Math.min(40, saved.height) };
    if (best) {
      const o = overlap(titleBar, best);
      if (o.w >= Math.min(120, saved.width) && o.h >= Math.min(20, titleBar.height)) return fitInto(saved, best);
    }
    // The display it was on is gone: the same size, on the display with the pointer.
    return fitInto({ ...centred(near, saved.width, saved.height), x: centred(near, saved.width, saved.height).x + cascade * 28, y: centred(near, saved.width, saved.height).y + cascade * 28 }, near);
  }
  const c = centred(near, PAGE_WINDOW_DEFAULT.width, PAGE_WINDOW_DEFAULT.height);
  return fitInto({ ...c, x: c.x + cascade * 28, y: c.y + cascade * 28 }, near);
}

function centred(area: Rect, width: number, height: number): Rect {
  const w = Math.min(width, area.width);
  const h = Math.min(height, area.height);
  return { x: Math.round(area.x + (area.width - w) / 2), y: Math.round(area.y + (area.height - h) / 2), width: w, height: h };
}
