// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Google and Microsoft sign-in: the browser opens the provider's own page,
// the answer comes back to a one-time address on this computer, and the
// tokens are kept in the system keychain and renewed when they run out.

import { shell } from 'electron';
import http from 'node:http';
import { authUrl, codeExchange, GRAPH_SCOPES, pkce, readRedirect, readTokenResponse, refreshRequest, type OAuthClient, type OAuthProvider, type Tokens } from '../../../core/pim/oauth';
import { readSecret, putSecret } from './store';

/** Client IDs: Settings first, then the ones Keeper was built with (environment at build or run time). */
export function clientFor(p: OAuthProvider, prefs?: { google?: string; googleSecret?: string; microsoft?: string }): OAuthClient | undefined {
  if (p === 'google') {
    const id = prefs?.google || process.env.KEEPER_GOOGLE_CLIENT_ID;
    return id ? { clientId: id, clientSecret: prefs?.googleSecret || process.env.KEEPER_GOOGLE_CLIENT_SECRET } : undefined;
  }
  const id = prefs?.microsoft || process.env.KEEPER_MS_CLIENT_ID;
  return id ? { clientId: id } : undefined;
}

async function postForm(url: string, body: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body });
  return (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as Record<string, unknown>;
}

let pending: { abort: () => void } | null = null;

export function cancelSignIn() {
  pending?.abort();
  pending = null;
}

/** Opens the provider's sign-in page and waits (up to 5 minutes) for the answer. */
export async function signIn(p: OAuthProvider, client: OAuthClient, email?: string, open: (url: string) => unknown = (u) => shell.openExternal(u), scopes?: string[]): Promise<Tokens> {
  cancelSignIn();
  const { verifier, challenge, state } = pkce();
  return new Promise<Tokens>((resolve, reject) => {
    let done = false;
    // Known once the one-time server is listening; it must match the address in the request.
    let redirect = '';
    const server = http.createServer((req, res) => {
      const r = readRedirect(req.url ?? '/');
      if (!r.code && !r.error) { res.writeHead(404); res.end(); return; }
      const ok = !!r.code && r.state === state;
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><meta charset="utf-8"><title>Keeper</title><body style="font:16px system-ui;padding:40px;text-align:center">${ok ? 'Signed in. You can close this tab and go back to Keeper.' : 'Sign-in did not finish. You can close this tab.'}</body>`);
      finish(async () => {
        if (!ok) throw new Error(r.error ?? 'The sign-in answer did not match; please try again.');
        const req2 = codeExchange(p, client, r.code!, verifier, redirect);
        return readTokenResponse(await postForm(req2.url, req2.body));
      });
    });
    const timer = setTimeout(() => finish(async () => { throw new Error('Sign-in took too long'); }), 5 * 60_000);
    const finish = (fn: () => Promise<Tokens>) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      server.close();
      pending = null;
      fn().then(resolve, reject);
    };
    pending = { abort: () => finish(async () => { throw new Error('Sign-in cancelled'); }) };
    server.listen(0, '127.0.0.1', () => {
      redirect = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
      void open(authUrl(p, client, redirect, challenge, state, email, scopes));
    });
  });
}

const tokenKey = (account: string, resource = 'mail') => `oauth.${account}.${resource}`;

export async function saveTokens(account: string, t: Tokens, resource = 'mail') {
  await putSecret(tokenKey(account, resource), JSON.stringify(t));
}

/**
 * A fresh access token for an account, renewed with the refresh token when it
 * has run out. Microsoft calendars need a separate token for Graph.
 */
export async function accessToken(account: string, p: OAuthProvider, client: OAuthClient, resource: 'mail' | 'graph' = 'mail'): Promise<string> {
  const raw = (await readSecret(tokenKey(account, resource))) ?? (resource === 'graph' ? await readSecret(tokenKey(account, 'mail')) : undefined);
  if (!raw) throw new Error('Sign in again to use this account');
  const t = JSON.parse(raw) as Tokens;
  if (resource === 'mail' && t.expires > Date.now()) return t.access;
  if (resource === 'graph' && raw === (await readSecret(tokenKey(account, 'graph'))) && t.expires > Date.now()) return t.access;
  if (!t.refresh) throw new Error('Sign in again to use this account');
  const req = refreshRequest(p, client, t.refresh, resource === 'graph' ? GRAPH_SCOPES : undefined);
  const next = readTokenResponse(await postForm(req.url, req.body), Date.now(), t.refresh);
  await saveTokens(account, next, resource);
  return next.access;
}
