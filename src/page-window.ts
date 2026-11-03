// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The interface's side of "Open in New Window" (core/page-window.ts): whether
// this window is a page window, which page it opened on, and opening a page in
// a window of its own from the sidebar, the top bar, the palette or ⌥⌘N.

import { pageOf, type NavRoute } from '../core/nav';
import { api } from './api';

const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();

/** This window shows one page, without the sidebar or tabs. */
export const IS_PAGE_WINDOW = params.get('view') === 'page';
/** …in a light app started by an app icon (Keeper Mail…; core/solo.ts), not in Keeper itself. */
export const IS_SOLO = IS_PAGE_WINDOW && params.get('solo') === '1';
/** The page this window was opened for. */
export const PAGE_WINDOW_PAGE = IS_PAGE_WINDOW ? params.get('page') ?? '' : '';

/** "mail:<id>" → { name: 'mail', arg: '<id>' } */
export function routeFromText(t: string): NavRoute {
  const i = t.indexOf(':');
  return i < 0 ? { name: t } : { name: t.slice(0, i), arg: t.slice(i + 1) };
}

/** The page this window opened on (a page window only). */
export const PAGE_WINDOW_START: NavRoute | null = IS_PAGE_WINDOW && params.get('route') ? routeFromText(params.get('route')!) : null;
/** The page's name in this window's title ("Mail"). */
export const PAGE_WINDOW_LABEL = IS_PAGE_WINDOW ? params.get('label') ?? '' : '';

/** Whether a route belongs to a page that can have a window of its own (every page in the sidebar or palette). */
export function canOpenInWindow(r: NavRoute): boolean {
  return !!api.windows && !!r.name;
}

/** The name a page's window gets: the page's own name (translated where it has one). */
export function windowLabel(r: NavRoute, t?: (k: string) => string): string | undefined {
  const p = pageOf(r);
  if (!p) return undefined;
  return p.i18n && t ? t(p.i18n) : p.label;
}

/** Opens a page in a window of its own (or brings its window forward). */
export async function openInWindow(r: NavRoute, label?: string, toast?: (t: string) => void): Promise<void> {
  if (!api.windows) { toast?.('Pages open in windows of their own in the Keeper app'); return; }
  const res = await api.windows.openPage({ name: r.name, ...(r.arg !== undefined ? { arg: r.arg } : {}), ...(r.q !== undefined ? { q: r.q } : {}) }, label).catch(() => null);
  if (!res) toast?.('This page cannot open in a window of its own');
}
