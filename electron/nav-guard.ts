// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Defence in depth for every window: Keeper's own pages (which carry the
// preload, and so its whole API) never navigate away from Keeper's page, never
// open a child window (which would inherit the preload), and no page anywhere
// may add a <webview>. Windows that show web content on purpose (the browser,
// remote web consoles, web wallpapers) are on web addresses, have no preload
// and keep their own rules.

import { app, shell } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** May a page with the preload go to `url` by itself? Only Keeper's own page (any view of it). */
export function appNavAllowed(url: string, appIndex: string, devUrl?: string): boolean {
  if (devUrl && (url === devUrl || url.startsWith(devUrl.endsWith('/') ? devUrl : `${devUrl}/`) || url.startsWith(`${devUrl}?`))) return true;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'file:') return false;
  const want = pathToFileURL(appIndex);
  return u.pathname === want.pathname;
}

/** Links a preload page tries to open go to the browser when they are web or mail links. */
export function externalAllowed(url: string): boolean {
  return /^(https?:\/\/|mailto:)/i.test(url);
}

/** Is this page one of Keeper's own (its app page, or a page it wrote itself as a data: URL)? Those carry the preload. */
export function isKeeperPage(current: string, appIndex: string, devUrl?: string): boolean {
  if (!current) return false;
  if (current.startsWith('data:')) return true;
  return appNavAllowed(current, appIndex, devUrl);
}

export function installNavGuard(appDir: string, devUrl?: string) {
  const index = path.join(appDir, 'index.html');
  app.on('web-contents-created', (_e, wc) => {
    wc.on('will-attach-webview', (e) => e.preventDefault());
    const ours = () => isKeeperPage(wc.getURL(), index, devUrl);
    const stop = (e: Electron.Event, url: string) => {
      if (ours() && !appNavAllowed(url, index, devUrl)) e.preventDefault();
    };
    wc.on('will-navigate', stop);
    wc.on('will-redirect', stop);
    // A window's own handler (set after this) replaces this default.
    wc.setWindowOpenHandler(({ url }) => {
      if (!ours()) return { action: 'allow' };
      if (externalAllowed(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
  });
}
