// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Sports services through their official APIs with your own app credentials:
// sign-in in the browser with a one-time loopback address, tokens in the
// keychain, then a sync now and then (through the governor). Nothing is
// scraped: Garmin Connect, Suunto, Komoot and Wahoo offer no API to people
// (only to approved partners), so they come in as files (see docs/TRACKS.md).

import { shell } from 'electron';
import crypto from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { parseGpx, parseTcx } from '../../../core/tracks/files';
import { traccarPositions } from '../../../core/tracks/receivers';
import { authorizeUrl, fitbitActivity, fitbitHasGps, OAUTH, polarExercise, readTokens, stravaActivity, stravaRoute, type ServiceId, type StravaStreams, type Tokens } from '../../../core/tracks/services';
import type { LivePosition, Track } from '../../../core/tracks/types';
import { getSecret, setSecret } from '../../store';

type J = Record<string, unknown>;
const UA = 'Keeper (Places & Tracks; +https://github.com/ashfordeOU/keeper)';

async function getJson(url: string, token: string, accept = 'application/json'): Promise<unknown> {
  const r = await fetch(url, { headers: { authorization: `Bearer ${token}`, accept, 'user-agent': UA } });
  if (r.status === 429) throw new Error('The service asked Keeper to slow down; it will try again later.');
  if (!r.ok) throw new Error(`${new URL(url).host} answered ${r.status}`);
  return accept.includes('json') ? r.json() : r.text();
}

// ---------------------------------------------------------------- sign-in

let pending: http.Server | null = null;

/** Opens the service's sign-in page; resolves when the browser comes back with a code. */
export async function signIn(svc: ServiceId, clientId: string): Promise<Tokens> {
  const secret = await getSecret(`tracks.${svc}`);
  if (!clientId || !secret) throw new Error('Add your app’s client ID and secret first.');
  pending?.close();
  const state = crypto.randomBytes(16).toString('base64url');
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return new Promise<Tokens>((resolve, reject) => {
    const timer = setTimeout(() => { srv.close(); reject(new Error('Sign-in took too long. Try again.')); }, 5 * 60_000);
    const srv = http.createServer(async (req, res) => {
      const u = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (u.pathname !== '/callback') { res.writeHead(404); res.end(); return; }
      const done = (msg: string) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(`<p style="font:16px system-ui;margin:40px">${msg} You can close this tab.</p>`); };
      clearTimeout(timer);
      srv.close();
      pending = null;
      if (u.searchParams.get('state') !== state || !u.searchParams.get('code')) {
        done('Sign-in did not finish.');
        return reject(new Error(u.searchParams.get('error') ?? 'Sign-in was cancelled.'));
      }
      try {
        const redirect = `http://127.0.0.1:${(srv.address() as AddressInfo | null)?.port ?? port}/callback`;
        const t = await exchange(svc, clientId, secret, { grant_type: 'authorization_code', code: u.searchParams.get('code')!, redirect_uri: redirect, ...(OAUTH[svc].pkce ? { code_verifier: verifier } : {}) });
        if (svc === 'polar') await registerPolarUser(t);
        await setSecret(`tracks.${svc}.tokens`, JSON.stringify(t));
        done('Connected to Keeper.');
        resolve(t);
      } catch (e) {
        done('Keeper could not finish signing in.');
        reject(e);
      }
    });
    let port = 0;
    srv.listen(0, '127.0.0.1', () => {
      pending = srv;
      port = (srv.address() as AddressInfo).port;
      void shell.openExternal(authorizeUrl(svc, clientId, `http://127.0.0.1:${port}/callback`, state, challenge));
    });
  });
}

async function exchange(svc: ServiceId, clientId: string, secret: string, params: Record<string, string>): Promise<Tokens> {
  const c = OAUTH[svc];
  const body = new URLSearchParams(params);
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', 'user-agent': UA };
  if (c.basicAuth) headers.authorization = `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`;
  else { body.set('client_id', clientId); body.set('client_secret', secret); }
  const r = await fetch(c.token, { method: 'POST', headers, body });
  const j = (await r.json().catch(() => ({}))) as J;
  if (!r.ok) throw new Error(String(j.message ?? j.error_description ?? j.error ?? `Sign-in failed (${r.status})`));
  return readTokens(j);
}

async function registerPolarUser(t: Tokens) {
  if (!t.userId) return;
  // AccessLink needs the member registered once; 409 means it already is.
  const r = await fetch(`${OAUTH.polar.api}/users`, { method: 'POST', headers: { authorization: `Bearer ${t.access}`, 'content-type': 'application/json', accept: 'application/json', 'user-agent': UA }, body: JSON.stringify({ 'member-id': `keeper-${t.userId}` }) });
  if (!r.ok && r.status !== 409) throw new Error(`Polar did not register the account (${r.status})`);
}

async function tokens(svc: ServiceId, clientId: string): Promise<Tokens> {
  const raw = await getSecret(`tracks.${svc}.tokens`);
  if (!raw) throw new Error('Not connected.');
  let t = JSON.parse(raw) as Tokens;
  if (t.expiresAt && t.expiresAt < Date.now() + 60_000 && t.refresh) {
    const secret = await getSecret(`tracks.${svc}`);
    if (!secret) throw new Error('The client secret is missing.');
    t = { ...t, ...(await exchange(svc, clientId, secret, { grant_type: 'refresh_token', refresh_token: t.refresh })) };
    await setSecret(`tracks.${svc}.tokens`, JSON.stringify(t));
  }
  return t;
}

export async function disconnect(svc: ServiceId) {
  await setSecret(`tracks.${svc}.tokens`, '');
}

// ---------------------------------------------------------------- syncing

/** New activities since `after` (with GPS where the service has it). At most `limit` per sync. */
export async function syncService(svc: ServiceId, clientId: string, after: number, have: Set<string>, limit = 30): Promise<Track[]> {
  const t = await tokens(svc, clientId);
  const out: Track[] = [];
  if (svc === 'strava') {
    const list = (await getJson(`${OAUTH.strava.api}/athlete/activities?after=${Math.floor(after / 1000)}&per_page=50`, t.access)) as J[];
    for (const a of list.slice(0, limit)) {
      if (have.has(String(a.id))) continue;
      let streams: StravaStreams | undefined;
      if ((a.map as J | undefined)?.summary_polyline) streams = (await getJson(`${OAUTH.strava.api}/activities/${a.id}/streams?keys=latlng,time,altitude,heartrate,velocity_smooth,cadence,watts&key_by_type=true`, t.access).catch(() => undefined)) as StravaStreams | undefined;
      out.push(stravaActivity(a, streams));
    }
    if (t.userId && !after) {
      const routes = (await getJson(`${OAUTH.strava.api}/athletes/${t.userId}/routes?per_page=50`, t.access).catch(() => [])) as J[];
      for (const r of routes) { const tr = stravaRoute(r); if (tr && !have.has(tr.sourceId!)) out.push(tr); }
    }
  } else if (svc === 'polar') {
    const list = (await getJson(`${OAUTH.polar.api}/exercises`, t.access)) as J[];
    for (const e of list.slice(0, limit)) {
      if (have.has(String(e.id))) continue;
      let pts: Track['points'] = [];
      if (e.has_route) {
        const gpx = (await getJson(`${OAUTH.polar.api}/exercises/${e.id}/gpx`, t.access, 'application/gpx+xml').catch(() => '')) as string;
        pts = gpx ? parseGpx(gpx, 'polar').tracks.flatMap((x) => x.points) : [];
      }
      out.push(polarExercise(e, pts));
    }
  } else {
    const date = new Date(after || Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
    const j = (await getJson(`${OAUTH.fitbit.api}/1/user/-/activities/list.json?afterDate=${date}&sort=asc&limit=50&offset=0`, t.access)) as J;
    for (const a of ((j.activities ?? []) as J[]).slice(0, limit)) {
      if (have.has(String(a.logId))) continue;
      let pts: Track['points'] = [];
      if (fitbitHasGps(a)) {
        const tcx = (await getJson(`${OAUTH.fitbit.api}/1/user/-/activities/${a.logId}.tcx`, t.access, 'application/vnd.garmin.tcx+xml').catch(() => '')) as string;
        pts = tcx ? parseTcx(tcx, 'fitbit').tracks.flatMap((x) => x.points) : [];
      }
      out.push(fitbitActivity(a, pts));
    }
  }
  return out;
}

/** Devices and their last positions from your own Traccar server. */
export async function traccarLive(url: string, user: string): Promise<LivePosition[]> {
  const secret = (await getSecret('tracks.traccar')) ?? '';
  const base = url.replace(/\/+$/, '');
  const headers: Record<string, string> = { accept: 'application/json', 'user-agent': UA, authorization: user ? `Basic ${Buffer.from(`${user}:${secret}`).toString('base64')}` : `Bearer ${secret}` };
  const get = async (p: string) => {
    const r = await fetch(`${base}${p}`, { headers });
    if (r.status === 401) throw new Error('The Traccar server did not accept the user name or password.');
    if (!r.ok) throw new Error(`The Traccar server answered ${r.status}`);
    return (await r.json()) as J[];
  };
  return traccarPositions(await get('/api/devices'), await get('/api/positions'));
}
