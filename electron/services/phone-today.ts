// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The phone companion's Today (core/phone-today.ts): the day's events and
// tasks, ticking a task off, catching words, a photo or a voice note into the
// Inbox, and finding files on this computer. All over the companion's own
// encrypted channel; each part answers only while its feature is on.

import { shell } from 'electron';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { phoneFileHit, phoneToday, uploadedName, type PhoneEvent, type PhoneTask } from '../../core/phone-today';
import type { FileEntry } from '../../core/types';
import { featureOn } from './features';
import { addInbox, inboxCount } from './inbox';

type Op = (h: Record<string, unknown>, body: Uint8Array, cid: string) => Promise<{ r: unknown; body?: Uint8Array }>;

/** Files found on this computer, for Find (most recent search per phone, so Show only reveals what was found). */
const found = new Map<string, Set<string>>();

export function registerPhoneToday(node: { registerCompanionOp(op: string, fn: Op): void; receivedDir(): string }, d: { searchFiles: (q: string, limit: number) => FileEntry[] }) {
  const pim = async () => (await import('./pim')).pim;
  node.registerCompanionOp('today.get', async () => {
    const now = Date.now();
    let events: PhoneEvent[] = [];
    let tasks: PhoneTask[] = [];
    if (featureOn('calendars')) {
      const { pimTools } = await import('./pim/brain-adapter');
      const start = new Date(now); start.setHours(0, 0, 0, 0);
      events = (await pimTools.listEvents(start.getTime(), start.getTime() + 86_400_000).catch(() => [])).map((e) => ({ id: e.id, title: e.title, start: Date.parse(e.start), end: Date.parse(e.end), allDay: e.allDay, location: e.location }));
      tasks = ((await (await pim()).reminders().catch(() => [])) as PhoneTask[]);
    }
    const inbox = featureOn('captureInbox') ? await inboxCount().catch(() => 0) : 0;
    return { r: { ...phoneToday(now, events, tasks, inbox), parts: { tasks: featureOn('calendars'), inbox: featureOn('captureInbox') } } };
  });
  node.registerCompanionOp('tasks.done', async (h) => {
    if (!featureOn('calendars')) throw new Error('Tasks are switched off on the computer');
    const t = await (await pim()).completeReminder(String(h.id ?? ''), h.done !== false);
    if (!t) throw new Error('That task is gone');
    return { r: true };
  });
  node.registerCompanionOp('inbox.add', async (h) => {
    if (!featureOn('captureInbox')) throw new Error('The Inbox is switched off on the computer');
    const name = h.name !== undefined ? uploadedName(h.name) : null;
    if (h.name !== undefined && !name) throw new Error('That file name is not allowed');
    const file = name ? path.join(node.receivedDir(), name) : undefined;
    if (file && !existsSync(file)) throw new Error('That file did not arrive');
    const kind = h.kind === 'voice' ? 'voice' : h.kind === 'shot' ? 'shot' : file ? 'file' : undefined;
    const item = await addInbox({ text: String(h.text ?? '').slice(0, 20_000), ...(file ? { path: file } : {}), ...(kind ? { kind } : {}), source: 'phone' });
    if (!item) throw new Error('Nothing to keep');
    return { r: { id: item.id } };
  });
  node.registerCompanionOp('find', async (h, _b, cid) => {
    const q = String(h.q ?? '').trim().slice(0, 200);
    if (!q) return { r: [] };
    const hits = d.searchFiles(q, 20).map((f) => phoneFileHit(f, os.homedir()));
    found.set(cid, new Set(hits.map((x) => x.path)));
    // The phone gets names and folders, never the files themselves (those go through shared folders).
    return { r: hits.map(({ path: p, ...rest }) => ({ ...rest, id: Buffer.from(p).toString('base64url') })) };
  });
  node.registerCompanionOp('find.show', async (h, _b, cid) => {
    const p = Buffer.from(String(h.id ?? ''), 'base64url').toString();
    if (!found.get(cid)?.has(p)) throw new Error('Search for it again');
    shell.showItemInFolder(p);
    return { r: true };
  });
}
