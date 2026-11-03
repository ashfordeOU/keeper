// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper's rules as Gmail filters (Gmail API, for accounts signed in with
// Google), so they run while Keeper is closed. Filters Keeper made are
// remembered by id and replaced as a set; filters the person made in Gmail
// are never touched. No window: it runs wherever Mail runs.

import { toGmailFilter, type Rule } from '../../../core/pim/rules';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

async function call<T>(token: string, method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(`${API}${url}`, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 403) throw new Error('Gmail did not allow Keeper to change filters. Sign in with Google again to allow it.');
  if (!r.ok) throw new Error(`Gmail answered ${r.status}`);
  return (r.status === 204 ? undefined : await r.json()) as T;
}

/** Writes the rules marked "also on the server"; returns the ids of the filters Keeper now owns. */
export async function syncGmailFilters(token: string, rules: Rule[], owned: string[]): Promise<{ owned: string[]; written: number; skipped: number }> {
  const want = rules.filter((r) => r.enabled && r.server).map((r) => toGmailFilter(r));
  const labels = (await call<{ labels?: { id: string; name: string }[] }>(token, 'GET', '/labels')).labels ?? [];
  const idOf = async (name: string): Promise<string> => {
    const hit = labels.find((l) => l.name.toLowerCase() === name.toLowerCase());
    if (hit) return hit.id;
    const made = await call<{ id: string; name: string }>(token, 'POST', '/labels', { name, labelListVisibility: 'labelShow', messageListVisibility: 'show' });
    labels.push(made);
    return made.id;
  };
  for (const id of owned) await call(token, 'DELETE', `/settings/filters/${encodeURIComponent(id)}`).catch(() => undefined);
  const next: string[] = [];
  let skipped = 0;
  for (const w of want) {
    if (!w) { skipped++; continue; }
    const add: string[] = [];
    for (const x of w.filter.action.addLabelIds ?? []) add.push(x.startsWith('label:') ? await idOf(x.slice(6)) : x);
    const made = await call<{ id: string }>(token, 'POST', '/settings/filters', { criteria: w.filter.criteria, action: { ...w.filter.action, ...(add.length ? { addLabelIds: add } : {}) } });
    next.push(made.id);
  }
  return { owned: next, written: next.length, skipped };
}
