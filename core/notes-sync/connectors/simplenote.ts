// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Simplenote through its sync service (the same one its own apps use):
// plain-text notes whose first line is the title.

import { ConnectorError, expectOk, firstLineTitle, type ConnectorIO, type FetchFn } from './io';
import type { RemoteNote } from '../types';

export const SIMPLENOTE_APP = 'chalk-bump-f49';
export const SIMPLENOTE_KEY = 'e2f0978acfea407aa23fdf557478d3f2';
const AUTH = `https://auth.simperium.com/1/${SIMPLENOTE_APP}/authorize/`;
const API = `https://api.simperium.com/1/${SIMPLENOTE_APP}/note`;

export interface SimplenoteData {
  content: string;
  tags: string[];
  deleted: boolean;
  creationDate: number;
  modificationDate: number;
  systemTags?: string[];
  shareURL?: string;
  publishURL?: string;
}

export function fromSimplenote(id: string, v: number | string, d: SimplenoteData): RemoteNote {
  const { title, body } = firstLineTitle(d.content ?? '');
  return { sourceId: id, title, body, tags: d.tags ?? [], created: Math.round((d.creationDate ?? 0) * 1000) || undefined, modified: Math.round((d.modificationDate ?? 0) * 1000) || undefined, version: String(v), trashed: !!d.deleted };
}

export function toSimplenote(n: RemoteNote, prev?: Partial<SimplenoteData>): SimplenoteData {
  return {
    ...prev,
    content: n.body ? `${n.title}\n${n.body}` : n.title,
    tags: n.tags,
    deleted: false,
    creationDate: prev?.creationDate ?? (n.created ?? Date.now()) / 1000,
    modificationDate: Date.now() / 1000,
    systemTags: prev?.systemTags ?? [],
  };
}

export class SimplenoteApi implements ConnectorIO {
  private token?: string;
  private data = new Map<string, SimplenoteData>();
  constructor(private email: string, private password: string, private fetch: FetchFn, token?: string) { this.token = token; }

  async signIn(): Promise<string> {
    if (this.token) return this.token;
    const r = await this.fetch(AUTH, { method: 'POST', headers: { 'x-simperium-api-key': SIMPLENOTE_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ username: this.email, password: this.password }) })
      .catch(() => { throw new ConnectorError('unreachable', 'Simplenote could not be reached.'); });
    if (r.status === 401 || r.status === 400) throw new ConnectorError('auth', 'Simplenote did not accept that email and password.');
    await expectOk(r, 'Simplenote');
    this.token = ((await r.json()) as { access_token: string }).access_token;
    return this.token;
  }

  private async call(method: string, url: string, body?: unknown) {
    const token = await this.signIn();
    const r = await this.fetch(url, { method, headers: { 'x-simperium-token': token, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return expectOk(r, 'Simplenote');
  }

  async test() {
    const { notes } = await this.list();
    return `Connected: ${notes.filter((n) => !n.trashed).length} notes`;
  }

  async list() {
    const notes: RemoteNote[] = [];
    let mark: string | undefined;
    do {
      const j = (await (await this.call('GET', `${API}/index?data=true&limit=100${mark ? `&mark=${encodeURIComponent(mark)}` : ''}`)).json()) as { index: { id: string; v: number; d: SimplenoteData }[]; mark?: string };
      for (const e of j.index) { this.data.set(e.id, e.d); notes.push(fromSimplenote(e.id, e.v, e.d)); }
      mark = j.mark;
    } while (mark);
    return { notes, complete: true };
  }

  private async put(id: string, d: SimplenoteData) {
    const r = await this.call('POST', `${API}/i/${id}?response=1`, d);
    this.data.set(id, d);
    return r.headers.get('x-simperium-version') ?? undefined;
  }

  async create(n: RemoteNote) {
    const id = crypto.randomUUID().replace(/-/g, '');
    return { sourceId: id, version: await this.put(id, toSimplenote(n)) };
  }

  async update(n: RemoteNote) {
    return { version: await this.put(n.sourceId, toSimplenote(n, this.data.get(n.sourceId))) };
  }

  /** Simplenote's delete moves the note to its trash. */
  async remove(id: string) {
    const d = this.data.get(id);
    if (d) await this.put(id, { ...d, deleted: true });
  }
}
