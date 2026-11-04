// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Opening anything the knowledge graph or the Assistant names: a file, an
// email, an event, a task, a meeting, a person (write to them), a saved page.
// Links are keeper://mail/<id>, keeper://event/<id>?at=<start>,
// keeper://task/<id>, keeper://meeting/<id>, keeper://contact/<address>, a
// web address or a file path.

import type { ItemKind, KNode } from '../../core/graph/everything';
import { api } from '../api';
import type { Route } from '../state';

type Go = (r: Route) => void;

export const KIND_ICON: Record<ItemKind, string> = {
  file: 'document', note: 'note', mail: 'mail', person: 'smile', org: 'globe', event: 'calendar', task: 'listCheck', project: 'columns',
  place: 'map', bookmark: 'book', meeting: 'mic', app: 'app', tag: 'tag', folder: 'folder', source: 'link',
};

/** Starts an email to a person (Mail opens with the address filled in). */
export async function emailTo(address: string, name?: string, go?: Go) {
  await api.pim.stageCompose({ to: [{ address, name }], cc: [], bcc: [], subject: '', body: '', account: '' });
  go?.({ name: 'mail', arg: 'staged' });
}

/** Opens a cited item from its link. */
export function openCite(cite: string, go: Go) {
  const m = cite.match(/^keeper:\/\/(mail|event|task|meeting|contact)\/([^?#]+)(?:\?at=(\d+))?/);
  if (m) {
    const id = decodeURIComponent(m[2]);
    if (m[1] === 'mail') return go({ name: 'mail', arg: id });
    if (m[1] === 'event') return go({ name: 'calendar', arg: `event:${m[3] ?? Date.now()}:${id}` });
    if (m[1] === 'task') return go({ name: 'planner' });
    if (m[1] === 'meeting') return go({ name: 'meetings', arg: id });
    return void emailTo(id, undefined, go);
  }
  if (/^https?:\/\//i.test(cite)) return void api.system.openExternal(cite);
  return void api.files.open(cite);
}

/** The main thing to do with a node, and its name for the button. */
export function primaryAction(n: KNode): { label: string; icon: string } | null {
  switch (n.kind) {
    case 'file': case 'note': return n.path ? { label: 'Open', icon: 'external' } : null;
    case 'mail': return { label: 'Open email', icon: 'mail' };
    case 'event': return { label: 'Open in Calendar', icon: 'calendar' };
    case 'task': case 'project': return { label: 'Open in Planner', icon: 'listCheck' };
    case 'meeting': return { label: 'Open meeting', icon: 'mic' };
    case 'person': return n.emails?.length ? { label: 'Email', icon: 'mail' } : null;
    case 'bookmark': return n.ref ? { label: 'Open page', icon: 'webpage' } : null;
    case 'place': return { label: 'Open in Places', icon: 'map' };
    case 'folder': return n.path ? { label: 'Open folder', icon: 'folder' } : null;
    default: return null;
  }
}

export function openNode(n: KNode, go: Go) {
  switch (n.kind) {
    case 'file': case 'note': return n.path ? void api.files.open(n.path) : undefined;
    case 'mail': return n.ref ? go({ name: 'mail', arg: n.ref }) : undefined;
    case 'event': return n.ref ? go({ name: 'calendar', arg: `event:${n.time ?? Date.now()}:${n.ref}` }) : undefined;
    case 'task': case 'project': return go({ name: 'planner' });
    case 'meeting': return n.ref ? go({ name: 'meetings', arg: n.ref }) : undefined;
    case 'person': return n.emails?.[0] ? void emailTo(n.emails[0], n.label, go) : undefined;
    case 'bookmark': return n.ref ? void api.system.openExternal(n.ref) : undefined;
    case 'place': return go({ name: 'tracks' });
    case 'folder': return n.path ? go({ name: 'browse', arg: n.path }) : undefined;
    default: return go({ name: 'graph', arg: n.id });
  }
}

/** "3 Nov 2026", or "3 Nov, 10:00" for things with a time this year. */
export function whenOf(n: Pick<KNode, 'time' | 'kind'>): string {
  if (!n.time) return '';
  const d = new Date(n.time);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const withTime = n.kind === 'event' || n.kind === 'meeting';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) }) + (withTime ? `, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : '');
}
