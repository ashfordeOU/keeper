// SPDX-License-Identifier: AGPL-3.0-or-later
// What AI agents (Keeper's assistant, MCP clients) may use from mail and
// calendars: searching mail and listing events read only what is already on
// this computer; creating an event is a change and is meant to be offered
// for the person's approval by the agents layer.

import { redact } from '../../../core/brain/redact';
import { parseQuickAdd } from '../../../core/pim/quickadd';
import { pim } from './index';

export const pimTools = {
  /** Mail in Keeper's lists (all accounts, all synced folders) that matches the words. */
  async searchMail(query: string, limit = 20) {
    const folders = await pim.folders();
    const seen = new Set<string>();
    const out: { id: string; from?: string; subject: string; date: string; snippet: string; account: string; folder: string }[] = [];
    for (const f of [{ account: undefined, path: 'unified' }, ...folders.map((x) => ({ account: x.account, path: x.path }))]) {
      const r = await pim.messages({ account: f.account, folder: f.path, query }).catch(() => ({ messages: [] }));
      for (const m of r.messages) {
        if (seen.has(m.id)) continue;
        seen.add(m.id);
        out.push({ id: m.id, from: m.from ? `${m.from.name ?? ''} <${m.from.address}>`.trim() : undefined, subject: m.subject, date: new Date(m.date).toISOString(), snippet: redact(m.snippet).text, account: m.account, folder: m.folder });
        if (out.length >= limit) return out;
      }
    }
    return out;
  },
  /** Events in a time range (repeats expanded), from every visible calendar. */
  async listEvents(from: number, to: number) {
    const occ = await pim.occurrences(from, to);
    return occ.slice(0, 200).map((o) => ({ id: o.event.id, title: o.event.title, start: new Date(o.start).toISOString(), end: new Date(o.end).toISOString(), allDay: o.event.allDay, location: o.event.location, calendar: o.event.calendar }));
  },
  /** What an event typed in plain English would be (no change made). */
  async previewEvent(text: string) {
    return parseQuickAdd(text);
  },
  /** Adds an event from plain English (callers ask the person first). */
  async createEvent(text: string) {
    const e = await pim.quickAdd(text);
    return e ? { id: e.id, title: e.title, start: new Date(e.start).toISOString(), end: new Date(e.end).toISOString() } : null;
  },
};
