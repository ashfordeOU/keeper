// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Web consoles (iDRAC, IPMI, Proxmox, a router…) in a Keeper tab: a page view
// laid over the tab's area, with its own saved cookies per connection. Many of
// these devices use self-signed certificates; a connection can pin one
// certificate by fingerprint, so that one is trusted for this console only and
// any other is refused, even one the system would trust.

import { BrowserWindow, session as electronSession, shell, WebContentsView, type WebContents } from 'electron';

interface WebView {
  sid: string;
  view: WebContentsView;
  win: BrowserWindow | null;
  home: string;
  host: string;
  title: string;
  cert?: { fingerprint: string; trusted: boolean };
  shown: boolean;
}

const views = new Map<string, WebView>();

export interface WebOpen {
  sid: string;
  connId: string;
  url: string;
  /** read each time, so a newly pinned certificate counts straight away */
  pin: () => string | undefined;
  notify: (sid: string, e: unknown) => void;
}

export function openWeb(o: WebOpen) {
  const u = new URL(o.url);
  if (!/^https?:$/.test(u.protocol)) throw new Error('A web console needs an http:// or https:// address');
  const ses = electronSession.fromPartition(`persist:rdc-web-${o.connId.replace(/[^\w-]/g, '')}`);
  ses.setCertificateVerifyProc((req, cb) => {
    const w = views.get(o.sid);
    if (req.hostname !== u.hostname) return cb(-3);
    const fp = req.certificate.fingerprint;
    const pin = o.pin();
    if (w) w.cert = { fingerprint: fp, trusted: pin ? fp === pin : req.verificationResult === 'net::OK' };
    if (pin) return cb(fp === pin ? 0 : -2);
    if (req.verificationResult === 'net::OK') return cb(0);
    o.notify(o.sid, { t: 'cert', fingerprint: fp, host: req.hostname });
    return cb(-2);
  });
  ses.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'clipboard-sanitized-write' || perm === 'fullscreen'));
  const view = new WebContentsView({ webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false } });
  const wc = view.webContents;
  // Pop-ups (a KVM console button) open in the same view; other kinds of links go to the browser.
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void wc.loadURL(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, url) => { if (!/^https?:/.test(url)) e.preventDefault(); });
  const w: WebView = { sid: o.sid, view, win: null, home: u.toString(), host: u.hostname, title: u.hostname, shown: false };
  wc.on('page-title-updated', (_e, title) => { w.title = title; o.notify(o.sid, { t: 'title', title, url: wc.getURL() }); });
  views.set(o.sid, w);
  void wc.loadURL(u.toString()).catch(() => undefined);
}

/** Places the page over the tab (or hides it when the tab is not showing). */
export function showWeb(sid: string, sender: WebContents, rect: { x: number; y: number; width: number; height: number } | null) {
  const w = views.get(sid);
  if (!w) return null;
  const win = BrowserWindow.fromWebContents(sender);
  if (!rect || !win) {
    if (w.win && w.shown && !w.win.isDestroyed()) w.win.contentView.removeChildView(w.view);
    w.shown = false;
  } else {
    if (w.win !== win || !w.shown) {
      if (w.win && w.shown && !w.win.isDestroyed()) w.win.contentView.removeChildView(w.view);
      win.contentView.addChildView(w.view);
      w.win = win;
      w.shown = true;
    }
    const zoom = sender.getZoomFactor();
    w.view.setBounds({ x: Math.round(rect.x * zoom), y: Math.round(rect.y * zoom), width: Math.max(1, Math.round(rect.width * zoom)), height: Math.max(1, Math.round(rect.height * zoom)) });
  }
  return { url: w.view.webContents.getURL() || w.home, title: w.title, cert: w.cert };
}

export function webAction(sid: string, action: 'back' | 'forward' | 'reload' | 'home' | 'external') {
  const w = views.get(sid);
  if (!w) return;
  const wc = w.view.webContents;
  if (action === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
  else if (action === 'forward' && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
  else if (action === 'reload') wc.reload();
  else if (action === 'home') void wc.loadURL(w.home).catch(() => undefined);
  else if (action === 'external') void shell.openExternal(wc.getURL() || w.home);
}

export function closeWeb(sid: string) {
  const w = views.get(sid);
  if (!w) return;
  views.delete(sid);
  if (w.win && w.shown && !w.win.isDestroyed()) w.win.contentView.removeChildView(w.view);
  try { w.view.webContents.close(); } catch { /* gone */ }
}

export function closeAllWeb() {
  for (const sid of [...views.keys()]) closeWeb(sid);
}
