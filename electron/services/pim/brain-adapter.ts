// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// What AI agents (Keeper's assistant, MCP clients) may use from mail and
// calendars: searching mail and listing events read only what is already on
// this computer (never Spam, Trash or security mail); creating an event is a change and is meant to be offered
// for the person's approval by the agents layer.

import { redact } from '../../../core/brain/redact';
import type { ContactIn, EventIn, MailIn, TaskIn } from '../../../core/graph/everything';
import { snippetOf, threadMessages } from '../../../core/pim/mail';
import { hiddenFolder } from '../../../core/pim/mail-mcp';
import { parseQuickAdd } from '../../../core/pim/quickadd';
import { hasSignInCode, isSecurityAlert } from '../../../core/pim/triage';
import { pim, pimInternals } from './index';
import { files as pimFiles, readJson } from './store';

/** What mail and calendars add to the knowledge graph and to search by meaning. */
export interface PimGraphItems {
  mail: MailIn[];
  contacts: ContactIn[];
  events: EventIn[];
  tasks: TaskIn[];
  /** the person's own addresses */
  me: string[];
  accounts: { id: string; label: string }[];
  folders: { account: string; path: string; name: string }[];
}

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
        // Spam, Trash and security mail (sign-in codes, password resets) are never handed to agents.
        if (hiddenFolder(m.folder, folders, m.account) || m.security || isSecurityAlert(m) || hasSignInCode(`${m.subject}\n${m.snippet}`)) continue;
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
  /**
   * Everything kept on this computer for the knowledge graph: mail (never Spam, Trash
   * or security mail; the text of messages already read), contacts, events and tasks.
   * Nothing is fetched from a server for it.
   */
  async graphItems(o: { mailMax?: number; bodiesMax?: number } = {}): Promise<PimGraphItems> {
    const accounts = await pim.accounts();
    const folders = await pim.folders();
    const me = [...new Set(accounts.flatMap((a) => [a.email, ...(a.identities ?? []).map((i) => i.email)]).filter((x): x is string => !!x).map((x) => x.toLowerCase()))];
    const all = (await pimInternals.everywhere())
      .filter((m) => !hiddenFolder(m.folder, folders, m.account) && !m.security && !isSecurityAlert(m) && !hasSignInCode(`${m.subject}\n${m.snippet}`))
      .sort((a, b) => b.date - a.date)
      .slice(0, o.mailMax ?? 20_000);
    const threadOf = new Map<string, string>();
    for (const t of threadMessages(all)) for (const m of t.messages) threadOf.set(m.id, t.id);
    const mail: MailIn[] = [];
    let bodies = 0;
    for (const m of all) {
      let text = m.snippet;
      let attachments: string[] | undefined;
      // The text of messages already read (kept on this computer); others give their preview.
      if (bodies < (o.bodiesMax ?? 3000) && (m.hasAttachments || !m.bulk)) {
        const b = await readJson<{ body?: { text?: string; html?: string; attachments?: { filename: string; inline?: boolean }[] } } | null>(pimFiles.body(m.id), null);
        if (b?.body) {
          bodies++;
          const t = b.body.text ?? (b.body.html ? snippetOf(b.body.html.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' '), 4000) : '');
          if (t) text = t.slice(0, 4000);
          attachments = b.body.attachments?.filter((x) => !x.inline && x.filename).map((x) => x.filename);
        }
      }
      if (hasSignInCode(text)) text = m.snippet;
      mail.push({ id: m.id, thread: threadOf.get(m.id) ?? m.id, subject: m.subject, from: m.from, to: m.to, cc: m.cc, date: m.date, account: m.account, folder: m.folder, messageId: m.messageId, text: redact(text).text, attachments });
    }
    const contacts: ContactIn[] = (await pim.contacts()).map((c) => ({ id: c.id, name: c.name, emails: c.emails, org: c.org, note: c.note }));
    const events: EventIn[] = [];
    const accountOf = new Map(pimInternals.state().calendars.map((c) => [c.id, c.account]));
    for (const [cal, list] of pimInternals.events()) for (const e of list) {
      if (e.status === 'cancelled') continue;
      events.push({ id: e.id, uid: e.uid, title: e.title, start: e.start, end: e.end, allDay: e.allDay, location: e.location, description: e.description?.slice(0, 4000), attendees: e.attendees?.map((a) => ({ name: a.name, address: a.email })), organizer: e.organizer ? { name: e.organizer.name, address: e.organizer.email } : undefined, calendar: accountOf.get(cal) ?? cal });
    }
    const yearAgo = Date.now() - 365 * 86_400_000;
    const tasks: TaskIn[] = (await pim.reminders()).filter((r) => !r.done || (r.doneAt ?? 0) > yearAgo).map((r) => ({ id: r.id, title: r.title, notes: r.notes, due: r.due, created: r.created, done: r.done, project: r.project, url: r.url }));
    return { mail, contacts, events, tasks, me, accounts: accounts.filter((a) => a.mail).map((a) => ({ id: a.id, label: a.label })), folders: folders.map((f) => ({ account: f.account, path: f.path, name: f.name })) };
  },
  /** Adds an event from plain English (callers ask the person first). */
  async createEvent(text: string) {
    const e = await pim.quickAdd(text);
    return e ? { id: e.id, title: e.title, start: new Date(e.start).toISOString(), end: new Date(e.end).toISOString() } : null;
  },
};
