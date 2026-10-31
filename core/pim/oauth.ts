// SPDX-License-Identifier: AGPL-3.0-or-later
// Signing in to Google and Microsoft with OAuth 2.0 for installed apps:
// authorization code with PKCE (RFC 7636) and a loopback redirect
// (RFC 8252). No client secret is needed by Microsoft; Google issues one for
// desktop apps that is not actually secret. Keeper needs client IDs registered
// by whoever builds it — see docs/PIM.md.

import { createHash, randomBytes } from 'node:crypto';

export type OAuthProvider = 'google' | 'microsoft';

export interface OAuthClient {
  clientId: string;
  /** Google desktop apps get one; it is not confidential */
  clientSecret?: string;
}

export const ENDPOINTS: Record<OAuthProvider, { auth: string; token: string; scopes: string[] }> = {
  google: {
    auth: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    // Full mail access over IMAP/SMTP, calendars and contacts over CalDAV/CardDAV, and the address.
    scopes: ['https://mail.google.com/', 'https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/carddav', 'openid', 'email'],
  },
  microsoft: {
    auth: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: ['https://outlook.office.com/IMAP.AccessAsUser.All', 'https://outlook.office.com/SMTP.Send', 'offline_access', 'openid', 'email'],
  },
};

/** Microsoft issues one token per resource; calendars use Microsoft Graph. */
export const GRAPH_SCOPES = ['https://graph.microsoft.com/Calendars.ReadWrite', 'https://graph.microsoft.com/Contacts.Read', 'offline_access'];

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function pkce(): { verifier: string; challenge: string; state: string } {
  const verifier = b64url(randomBytes(48));
  return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()), state: b64url(randomBytes(16)) };
}

export function authUrl(p: OAuthProvider, client: OAuthClient, redirect: string, challenge: string, state: string, email?: string, scopes = ENDPOINTS[p].scopes): string {
  const u = new URL(ENDPOINTS[p].auth);
  const q: Record<string, string> = {
    client_id: client.clientId, redirect_uri: redirect, response_type: 'code', scope: scopes.join(' '),
    code_challenge: challenge, code_challenge_method: 'S256', state,
  };
  if (p === 'google') Object.assign(q, { access_type: 'offline', prompt: 'consent' });
  if (email) q.login_hint = email;
  for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
  return u.toString();
}

export function tokenRequest(p: OAuthProvider, client: OAuthClient, body: Record<string, string>): { url: string; body: string } {
  const b = new URLSearchParams({ client_id: client.clientId, ...body });
  if (client.clientSecret) b.set('client_secret', client.clientSecret);
  return { url: ENDPOINTS[p].token, body: b.toString() };
}

export function codeExchange(p: OAuthProvider, client: OAuthClient, code: string, verifier: string, redirect: string) {
  return tokenRequest(p, client, { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirect });
}

export function refreshRequest(p: OAuthProvider, client: OAuthClient, refreshToken: string, scopes?: string[]) {
  return tokenRequest(p, client, { grant_type: 'refresh_token', refresh_token: refreshToken, ...(scopes ? { scope: scopes.join(' ') } : {}) });
}

export interface Tokens {
  access: string;
  refresh?: string;
  /** ms since epoch */
  expires: number;
  email?: string;
}

export function readTokenResponse(json: Record<string, unknown>, now = Date.now(), previousRefresh?: string): Tokens {
  if (typeof json.access_token !== 'string') throw new Error(String(json.error_description ?? json.error ?? 'Sign-in failed'));
  let email: string | undefined;
  if (typeof json.id_token === 'string') {
    try {
      const payload = JSON.parse(Buffer.from(json.id_token.split('.')[1], 'base64url').toString('utf8'));
      email = payload.email ?? payload.preferred_username;
    } catch {
      /* no address in the token */
    }
  }
  return { access: json.access_token, refresh: typeof json.refresh_token === 'string' ? json.refresh_token : previousRefresh, expires: now + (Number(json.expires_in) || 3600) * 1000 - 60_000, email };
}

/** The SASL XOAUTH2 string IMAP and SMTP servers expect. */
export function xoauth2(user: string, access: string): string {
  return Buffer.from(`user=${user}\x01auth=Bearer ${access}\x01\x01`).toString('base64');
}

/** Reads the code and state from the loopback request's URL. */
export function readRedirect(url: string): { code?: string; state?: string; error?: string } {
  const u = new URL(url, 'http://127.0.0.1');
  return { code: u.searchParams.get('code') ?? undefined, state: u.searchParams.get('state') ?? undefined, error: u.searchParams.get('error_description') ?? u.searchParams.get('error') ?? undefined };
}
