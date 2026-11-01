// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// What every connector offers the sync service: read everything, and (when
// the app allows it) create, update and delete. Network connectors take a
// fetch function so tests can play back recorded answers.

import type { RemoteNote } from '../types';

export interface ConnectorIO {
  /** every note the app has (complete: a missing note was deleted) */
  list(): Promise<{ notes: RemoteNote[]; complete: boolean }>;
  create?(n: RemoteNote): Promise<{ sourceId: string; version?: string }>;
  /** may rename (a file named after the title): then it returns the new id */
  update?(n: RemoteNote): Promise<{ version?: string; sourceId?: string }>;
  remove?(sourceId: string): Promise<void>;
  /** a quick check, e.g. "Connected: 214 notes" */
  test?(): Promise<string>;
}

export interface ListContext {
  /** the text Keeper already has for a note at this version (skips fetching it again) */
  unchanged?(sourceId: string, version: string): { title: string; body: string } | undefined;
}

export interface FetchResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export type FetchFn = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<FetchResponse>;

export class ConnectorError extends Error {
  constructor(public code: 'auth' | 'unreachable' | 'not-supported' | 'bad-data' | 'busy', message: string) {
    super(message);
  }
}

export async function expectOk(r: FetchResponse, what: string): Promise<FetchResponse> {
  if (r.ok) return r;
  if (r.status === 401 || r.status === 403) throw new ConnectorError('auth', `${what}: the sign-in or token was not accepted`);
  const t = await r.text().catch(() => '');
  throw new ConnectorError('unreachable', `${what}: the service answered ${r.status}${t ? ` (${t.slice(0, 120)})` : ''}`);
}

/** Tags written inline as #tag in a body. */
export function inlineTags(body: string): string[] {
  const out = new Set<string>();
  const re = /(^|[\s(,;])#([\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)/gu;
  const noCode = body.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '');
  let m: RegExpExecArray | null;
  while ((m = re.exec(noCode))) out.add(m[2]);
  return [...out];
}

/** The first line of plain text, as a title. */
export function firstLineTitle(text: string): { title: string; body: string } {
  const t = text.replace(/\r\n?/g, '\n').replace(/^\s+/, '');
  const i = t.indexOf('\n');
  const first = (i < 0 ? t : t.slice(0, i)).replace(/^#+\s*/, '').trim();
  return { title: first.slice(0, 200) || 'Untitled', body: i < 0 ? '' : t.slice(i + 1).replace(/^\n/, '') };
}
