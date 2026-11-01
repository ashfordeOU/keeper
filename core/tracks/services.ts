// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Sports services through their official APIs, with credentials the person
// registers themselves: Strava API v3, Polar AccessLink v3 and the Fitbit Web
// API. This file turns their JSON into tracks and builds their OAuth requests;
// the main process does the fetching (electron/services/tracks/services.ts).

import { decodePolyline } from './geo';
import { finishTrack } from './stats';
import type { Point, Track } from './types';
import { hashId, isoDuration, parseTime, sportFrom } from './util';

type J = Record<string, unknown>;
const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export type ServiceId = 'strava' | 'polar' | 'fitbit';

export interface OAuthConfig {
  authorize: string;
  token: string;
  scope: string;
  /** client secret sent as HTTP Basic (Polar, Fitbit) instead of in the body (Strava) */
  basicAuth: boolean;
  /** Fitbit wants PKCE */
  pkce: boolean;
  api: string;
}

export const OAUTH: Record<ServiceId, OAuthConfig> = {
  strava: { authorize: 'https://www.strava.com/oauth/authorize', token: 'https://www.strava.com/oauth/token', scope: 'read,activity:read_all', basicAuth: false, pkce: false, api: 'https://www.strava.com/api/v3' },
  polar: { authorize: 'https://flow.polar.com/oauth2/authorization', token: 'https://polarremote.com/v2/oauth2/token', scope: 'accesslink.read_all', basicAuth: true, pkce: false, api: 'https://www.polaraccesslink.com/v3' },
  fitbit: { authorize: 'https://www.fitbit.com/oauth2/authorize', token: 'https://api.fitbit.com/oauth2/token', scope: 'activity location heartrate profile', basicAuth: true, pkce: true, api: 'https://api.fitbit.com' },
};

export function authorizeUrl(svc: ServiceId, clientId: string, redirect: string, state: string, challenge?: string): string {
  const c = OAUTH[svc];
  const q = new URLSearchParams({ client_id: clientId, response_type: 'code', redirect_uri: redirect, scope: c.scope, state });
  if (svc === 'strava') q.set('approval_prompt', 'auto');
  if (c.pkce && challenge) {
    q.set('code_challenge', challenge);
    q.set('code_challenge_method', 'S256');
  }
  return `${c.authorize}?${q}`;
}

export interface Tokens { access: string; refresh?: string; expiresAt?: number; userId?: string }

/** Every service answers the token request in a slightly different shape. */
export function readTokens(j: J, now = Date.now()): Tokens {
  const access = String(j.access_token ?? '');
  if (!access) throw new Error(String(j.message ?? j.error_description ?? j.error ?? 'The service did not return a token'));
  const exp = n(j.expires_at) ? n(j.expires_at)! * 1000 : n(j.expires_in) ? now + n(j.expires_in)! * 1000 : undefined;
  const athlete = j.athlete as J | undefined;
  return { access, refresh: j.refresh_token ? String(j.refresh_token) : undefined, expiresAt: exp, userId: String(j.x_user_id ?? j.user_id ?? athlete?.id ?? '') || undefined };
}

// ---------------------------------------------------------------- Strava

export interface StravaStreams { latlng?: { data: [number, number][] }; time?: { data: number[] }; altitude?: { data: number[] }; heartrate?: { data: number[] }; velocity_smooth?: { data: number[] }; cadence?: { data: number[] }; watts?: { data: number[] } }

/** A summary activity (GET /athlete/activities), with its streams when fetched. */
export function stravaActivity(a: J, streams?: StravaStreams): Track {
  const start = parseTime(a.start_date as string);
  const id = String(a.id);
  const reported = { distanceM: n(a.distance), elapsedS: n(a.elapsed_time), movingS: n(a.moving_time), ascentM: n(a.total_elevation_gain), avgHr: n(a.average_heartrate), maxHr: n(a.max_heartrate), maxSpeed: n(a.max_speed), calories: n(a.calories) };
  let points: Point[] = [];
  if (streams?.latlng?.data?.length) {
    const t = streams.time?.data ?? [];
    points = streams.latlng.data.map(([lat, lon], i) => {
      const p: Point = { t: start + (t[i] ?? i) * 1000, lat, lon };
      const e = streams.altitude?.data?.[i], h = streams.heartrate?.data?.[i], v = streams.velocity_smooth?.data?.[i], c = streams.cadence?.data?.[i], w = streams.watts?.data?.[i];
      if (e !== undefined) p.ele = e;
      if (h !== undefined) p.hr = h;
      if (v !== undefined) p.speed = v;
      if (c !== undefined) p.cad = c;
      if (w !== undefined) p.power = w;
      return p;
    });
  } else {
    const poly = (a.map as J | undefined)?.summary_polyline as string | undefined;
    if (poly) {
      // The summary line has no times: spread the elapsed time along it so the timeline is right.
      const ll = decodePolyline(poly);
      const dur = (reported.elapsedS ?? 0) * 1000;
      points = ll.map(([lat, lon], i) => ({ t: start + (ll.length > 1 ? (dur * i) / (ll.length - 1) : 0), lat, lon }));
    }
  }
  const sportType = String(a.sport_type ?? a.type ?? '');
  const track = finishTrack({ id: hashId(`strava:${id}`), name: String(a.name ?? sportType), sport: sportFrom(sportType), source: 'strava', sourceId: id, points, reported, start });
  if (!points.length) track.end = start + (reported.elapsedS ?? 0) * 1000;
  return track;
}

/** A saved route (GET /athletes/{id}/routes): planned, not done. */
export function stravaRoute(r: J): Track | undefined {
  const poly = (r.map as J | undefined)?.summary_polyline as string | undefined;
  if (!poly) return undefined;
  const ll = decodePolyline(poly);
  const t0 = parseTime((r.created_at ?? r.timestamp) as string) || 0;
  const id = String(r.id_str ?? r.id);
  return finishTrack({ id: hashId(`strava-route:${id}`), name: String(r.name ?? 'Route'), sport: r.type === 2 ? 'run' : 'ride', source: 'strava', sourceId: `route:${id}`, planned: true, points: ll.map(([lat, lon], i) => ({ t: t0 + i * 1000, lat, lon })), reported: { distanceM: n(r.distance), ascentM: n(r.elevation_gain) } });
}

// ---------------------------------------------------------------- Polar AccessLink

/** An exercise from GET /v3/exercises. Points come from its GPX (parsed separately) when has_route. */
export function polarExercise(e: J, points: Point[] = []): Track {
  const start = parseTime(e.start_time as string) - (n(e.start_time_utc_offset) !== undefined && !/[zZ]|[+-]\d\d:?\d\d$/.test(String(e.start_time)) ? n(e.start_time_utc_offset)! * 60_000 : 0);
  const hr = (e.heart_rate ?? {}) as J;
  const reported = { elapsedS: isoDuration(e.duration as string), distanceM: n(e.distance), avgHr: n(hr.average), maxHr: n(hr.maximum), calories: n(e.calories) };
  const sport = String(e.detailed_sport_info ?? e.sport ?? 'Other');
  const id = String(e.id);
  const track = finishTrack({ id: hashId(`polar:${id}`), name: sport.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()), sport: sportFrom(sport), source: 'polar', sourceId: id, points, reported, start });
  if (!points.length) track.end = start + (reported.elapsedS ?? 0) * 1000;
  return track;
}

// ---------------------------------------------------------------- Fitbit

/** An entry of GET /1/user/-/activities/list.json. Points come from its TCX (parsed separately). */
export function fitbitActivity(a: J, points: Point[] = []): Track {
  const start = parseTime(a.startTime as string);
  const unit = String(a.distanceUnit ?? 'Kilometer');
  const dist = n(a.distance);
  const reported = { elapsedS: n(a.duration) ? n(a.duration)! / 1000 : undefined, movingS: n(a.activeDuration) ? n(a.activeDuration)! / 1000 : undefined, distanceM: dist === undefined ? undefined : /mile/i.test(unit) ? dist * 1609.344 : dist * 1000, avgHr: n(a.averageHeartRate), calories: n(a.calories), ascentM: n(a.elevationGain) };
  const id = String(a.logId);
  const track = finishTrack({ id: hashId(`fitbit:${id}`), name: String(a.activityName ?? 'Activity'), sport: sportFrom(String(a.activityName ?? '')), source: 'fitbit', sourceId: id, points, reported, start });
  if (!points.length) track.end = start + (reported.elapsedS ?? 0) * 1000;
  return track;
}

/** Whether a Fitbit activity has a GPS track worth fetching. */
export const fitbitHasGps = (a: J) => typeof a.tcxLink === 'string' && (a.hasGps === true || a.logType === 'mobile_run' || a.logType === 'tracker' || a.hasGps === undefined);
