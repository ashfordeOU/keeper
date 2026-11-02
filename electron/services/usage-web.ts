// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Web sign-ins for the AI usage tracker (Claude on claude.ai, ChatGPT on
// chatgpt.com). Each account has its own browser partition,
// `persist:usage-<accountId>`: the sign-in window shows the provider's own
// login page in it, so Keeper never sees the password, and the cookies stay
// in that partition. Reading usage sends requests only to the provider's own
// origin, with that partition's session. Removing the account wipes the
// partition (storage, cookies, cache) and its folder.
//
// Unofficial: the endpoints are the ones the providers' web apps use, not
// documented APIs. Nothing here runs unless the person added such an
// account, and usage is only read once they turned on its opt-in switch.

import { app, BrowserWindow, session, type Session } from 'electron';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { browserUserAgent, hasSessionCookie, orphanPartitions, sameOrigin, usagePartition, webAnswer, WEB_PROVIDERS, type WebAnswer, type WebProviderId } from '../../core/usage-tracker/web';

declare const __KEEPER_OFFICIAL__: boolean | undefined;
const OFFICIAL = typeof __KEEPER_OFFICIAL__ === 'boolean' && __KEEPER_OFFICIAL__;

/**
 * The provider's base address. Tests stand a local server in for it through KEEPER_USAGE_STUB
 * (`<stub>/claude.ai/…`), which official builds ignore.
 */
export function webBase(provider: WebProviderId): string {
  const spec = WEB_PROVIDERS[provider];
  const stub = !OFFICIAL ? process.env.KEEPER_USAGE_STUB : undefined;
  return stub ? `${stub.replace(/\/$/, '')}/${new URL(spec.origin).host}` : spec.origin;
}
const loginUrl = (provider: WebProviderId) => `${webBase(provider)}${new URL(WEB_PROVIDERS[provider].login).pathname}`;

const prepared = new Set<string>();
function sessionFor(accountId: string): Session {
  const ses = session.fromPartition(usagePartition(accountId));
  if (!prepared.has(accountId)) {
    prepared.add(accountId);
    // A plain browser's user agent: some sign-in pages refuse Electron's.
    ses.setUserAgent(browserUserAgent(ses.getUserAgent()));
    // A sign-in page needs no camera, microphone, location or notifications.
    ses.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'clipboard-sanitized-write' || perm === 'fullscreen'));
    ses.setPermissionCheckHandler((_wc, perm) => perm === 'clipboard-sanitized-write' || perm === 'fullscreen');
  }
  return ses;
}

export interface WebResult {
  status: number;
  answer: WebAnswer;
  body: unknown;
}

/** GET a path on the provider's own origin with the account's session (its cookies). */
export async function webGet(accountId: string, provider: WebProviderId, pathAndQuery: string, headers: Record<string, string> = {}): Promise<WebResult> {
  const base = webBase(provider);
  const url = `${base}${pathAndQuery}`;
  if (!sameOrigin(url, base)) throw new Error('Not the provider’s own address');
  const res = await sessionFor(accountId).fetch(url, {
    credentials: 'include',
    headers: { accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text().catch(() => '');
  // Sent on to the login page: the session is gone.
  let status = res.status;
  try { if (res.redirected && /login|auth|sign/i.test(new URL(res.url).pathname)) status = 401; } catch { /* no final address */ }
  const answer = webAnswer(status, res.headers.get('content-type'), text, res.headers.get('cf-mitigated'));
  let body: unknown;
  if (answer === 'ok') try { body = JSON.parse(text); } catch { body = undefined; }
  return { status, answer, body };
}

/** Is the account's partition signed in (the provider's session cookie is there)? */
export async function hasSession(accountId: string, provider: WebProviderId): Promise<boolean> {
  const cookies = await sessionFor(accountId).cookies.get({ url: `${webBase(provider)}/` }).catch(() => []);
  return hasSessionCookie(provider, cookies);
}

// ---------------------------------------------------------------- the sign-in window

const open = new Map<string, BrowserWindow>();

export interface SignInResult {
  ok: boolean;
  cancelled?: boolean;
  message?: string;
}

/**
 * Shows the provider's own sign-in page in a window of its own, in the account's partition, and
 * waits until the site has set its session cookie and confirms it (`confirm` asks the site who is
 * signed in), or the person closes the window.
 */
export function signInWindow(accountId: string, provider: WebProviderId, confirm: () => Promise<boolean>, opts: { parent?: BrowserWindow | null; title: string }): Promise<SignInResult> {
  const already = open.get(accountId);
  if (already && !already.isDestroyed()) {
    already.show();
    already.focus();
    return Promise.resolve({ ok: false, message: 'The sign-in window is already open.' });
  }
  const ses = sessionFor(accountId);
  const partition = usagePartition(accountId);
  const webPreferences = { partition, sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false, spellcheck: true } as const;
  const win = new BrowserWindow({
    width: 480, height: 720, minWidth: 380, minHeight: 520, title: opts.title, show: !process.env.KEEPER_USAGE_SIGNIN_HIDDEN || OFFICIAL,
    parent: opts.parent && !opts.parent.isDestroyed() && process.platform !== 'linux' ? opts.parent : undefined, autoHideMenuBar: true, webPreferences,
  });
  open.set(accountId, win);
  win.webContents.on('page-title-updated', (e) => e.preventDefault());
  // Sign in with Google or Apple opens a pop-up: keep it in the same partition, with no preload.
  win.webContents.setWindowOpenHandler(({ url }) => (/^https?:/i.test(url)
    ? { action: 'allow', overrideBrowserWindowOptions: { width: 500, height: 680, parent: win, autoHideMenuBar: true, webPreferences } }
    : { action: 'deny' }));
  return new Promise<SignInResult>((resolve) => {
    let done = false;
    let checking = false;
    const finish = (r: SignInResult) => {
      if (done) return;
      done = true;
      ses.cookies.off('changed', onCookie);
      clearInterval(timer);
      open.delete(accountId);
      if (!win.isDestroyed()) win.close();
      resolve(r);
    };
    const check = async () => {
      if (done || checking) return;
      checking = true;
      try {
        if (await hasSession(accountId, provider) && await confirm().catch(() => false)) finish({ ok: true });
      } finally {
        checking = false;
      }
    };
    const onCookie = () => void check();
    ses.cookies.on('changed', onCookie);
    win.webContents.on('did-navigate', () => void check());
    win.webContents.on('did-navigate-in-page', () => void check());
    // Some sites set the cookie from a script after the page loads.
    const timer = setInterval(() => void check(), 3000);
    win.on('closed', () => finish({ ok: false, cancelled: true, message: 'The sign-in window was closed before signing in.' }));
    void win.loadURL(loginUrl(provider)).catch(() => undefined);
  });
}

/** Closes an open sign-in window (when the account is removed meanwhile). */
export function closeSignIn(accountId: string) {
  const w = open.get(accountId);
  if (w && !w.isDestroyed()) w.close();
  open.delete(accountId);
}

// ---------------------------------------------------------------- forgetting a sign-in

const partitionsDir = () => path.join(app.getPath('userData'), 'Partitions');

/** Wipes everything the account's partition holds: cookies, storage, cache, and its folder. */
export async function forgetSignIn(accountId: string): Promise<void> {
  closeSignIn(accountId);
  let ses: Session;
  try { ses = sessionFor(accountId); } catch { return; }
  await ses.clearStorageData().catch(() => undefined);
  await ses.clearCache().catch(() => undefined);
  await ses.clearAuthCache().catch(() => undefined);
  await ses.cookies.flushStore().catch(() => undefined);
  // The (now empty) folder; it may still be held open on Windows until Keeper quits.
  await fsp.rm(path.join(partitionsDir(), usagePartition(accountId).slice('persist:'.length)), { recursive: true, force: true }).catch(() => undefined);
}

/** Partitions left by accounts that no longer exist (a removal cut short): wiped at start. */
export async function forgetOrphans(accountIds: string[]): Promise<string[]> {
  const names = await fsp.readdir(partitionsDir()).catch(() => [] as string[]);
  const gone = orphanPartitions(names, accountIds);
  for (const d of gone) await forgetSignIn(d.slice('usage-'.length));
  return gone;
}
