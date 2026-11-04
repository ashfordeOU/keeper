// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Imports and exports for Mail, Calendar, Reminders and Contacts: reading the
// files and stores other apps keep (core/pim/*-import.ts does the reading of
// each format), adding what was found, reporting progress, and taking an
// import back. Mail goes into the "On this computer" account (local-mail.ts).

import { execFile } from 'node:child_process';
import { createReadStream, promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseEvents } from '../../../core/pim/ical';
import { IMPORT_SOURCES, type FoundSource, type ImportArea, type ImportProgress, type ImportRequest, type ImportResult, type ImportSourceId } from '../../../core/pim/import-flow';
import { appleMailFolder, appleMailVersion, buildMessage, gmailLabels, gmailPlacement, importSummary, MboxSplitter, messageIdOf, olmFolder, parseEmlx, parseOlmMessage, parseProfilesIni, safeFileName, targetFolder, thunderbirdAccountName, thunderbirdMailboxes, thunderbirdRoots, toMboxEntry } from '../../../core/pim/mail-import';
import { contactKey, contactsFromCsv, contactsFromVcf, contactsToCsv, contactsToVcf } from '../../../core/pim/contact-import';
import { taskKey, tasksFromApple, tasksFromCsv, tasksFromGoogle, tasksFromIcs, tasksFromMsTodo, tasksFromTodoist, tasksFromTodoistCsv, tasksToCsv, tasksToIcs, type AppleReminder } from '../../../core/pim/task-import';
import type { CalEvent, Contact, MailFolder, Reminder } from '../../../core/pim/types';
import type { LocalMailbox } from './local-mail';
import type { MailBox } from './mail';
import { pimDir, readJson, writeJson } from './store';
import { ZipReader } from './zip-read';

/** What the importer needs from the rest of Mail and calendars (index.ts). */
export interface ImportHost {
  progress(p: ImportProgress): void;
  /** the "On this computer" mail store (made the first time) */
  localMail(): Promise<{ account: string; box: LocalMailbox }>;
  /** the lists changed: read them again and tell the windows */
  mailChanged(folders: string[]): Promise<void>;
  /** adds events to a calendar (a new one named `name` when no id); answers the calendar and whether it was made */
  addEvents(evs: CalEvent[], opts: { calendar?: string; name: string }): Promise<{ calendar: string; created: boolean; uids: string[] }>;
  removeEvents(calendar: string, uids: string[], dropCalendar: boolean): Promise<void>;
  reminders(): Reminder[];
  addReminders(list: Reminder[]): Promise<void>;
  removeReminders(ids: string[]): Promise<void>;
  contacts(): Contact[];
  addContacts(list: Contact[]): Promise<void>;
  removeContacts(ids: string[]): Promise<void>;
  /** a one-time access token from the person's sign-in (never kept) */
  signInToken(provider: 'google' | 'microsoft', scopes: string[]): Promise<string>;
  mailbox(account: string): MailBox | undefined;
  folders(account: string): Promise<MailFolder[]>;
}

const historyFile = () => path.join(pimDir(), 'imports.json');
const running = new Map<string, { cancelled: boolean }>();

export async function importHistory(): Promise<ImportResult[]> {
  // What it takes to undo stays here; the windows only see that it can be undone.
  return (await readJson<ImportResult[]>(historyFile(), [])).map((r) => ({ ...r, undo: undefined }));
}

async function remember(r: ImportResult) {
  const all = await readJson<ImportResult[]>(historyFile(), []);
  await writeJson(historyFile(), [r, ...all.filter((x) => x.id !== r.id)].slice(0, 30));
}

export function cancelImport(id: string) {
  const j = running.get(id);
  if (j) j.cancelled = true;
}

// ---------------------------------------------------------------- finding what is on this computer

const exists = (p: string) => fsp.access(p).then(() => true, () => false);

/** Thunderbird profiles and Apple Mail's store, when this computer has them. */
export async function foundSources(): Promise<FoundSource[]> {
  const out: FoundSource[] = [];
  const home = os.homedir();
  for (const root of thunderbirdRoots(process.platform, home, process.env.APPDATA)) {
    const ini = await fsp.readFile(path.join(root, 'profiles.ini'), 'utf8').catch(() => null);
    if (!ini) continue;
    for (const p of parseProfilesIni(ini, root, path.sep)) {
      if (!(await exists(p.path))) continue;
      out.push({ source: 'thunderbird', ref: p.path, label: p.name, detail: p.isDefault ? 'Default profile' : path.basename(p.path) });
    }
  }
  if (process.platform === 'darwin') {
    const mail = path.join(home, 'Library', 'Mail');
    const names = await fsp.readdir(mail).catch(() => [] as string[]);
    const v = appleMailVersion(names);
    if (v) out.push({ source: 'apple-mail', ref: path.join(mail, v), label: 'Apple Mail', detail: `Mail’s folder (${v})` });
    out.push({ source: 'apple-reminders', ref: 'reminders', label: 'Reminders', detail: 'Every list on this Mac' });
  }
  return out;
}

/** Every file under a folder (with sizes), relative to it. Hidden folders are skipped. */
async function walk(dir: string, max = 400_000): Promise<{ path: string; size: number }[]> {
  const out: { path: string; size: number }[] = [];
  const go = async (rel: string) => {
    if (out.length >= max) return;
    const items = await fsp.readdir(path.join(dir, rel), { withFileTypes: true }).catch((e: NodeJS.ErrnoException) => {
      if (e.code === 'EPERM' || e.code === 'EACCES') throw Object.assign(new Error('Keeper may not read this folder. On a Mac, allow Full Disk Access for Keeper in System Settings → Privacy & Security.'), { code: 'NO_ACCESS' });
      return [];
    });
    for (const it of items) {
      if (it.name.startsWith('.')) continue;
      const r = rel ? path.join(rel, it.name) : it.name;
      if (it.isDirectory()) await go(r);
      else if (it.isFile()) out.push({ path: r, size: (await fsp.stat(path.join(dir, r)).catch(() => ({ size: 0 }))).size });
    }
  };
  await go('');
  return out;
}

// ---------------------------------------------------------------- mail

interface MailPlan {
  /** a folder in the local store and what fills it */
  folder: string;
  items: ({ kind: 'mbox'; file: string } | { kind: 'eml'; file: string } | { kind: 'emlx'; file: string } | { kind: 'olm'; zip: string; entry: string })[];
  /** split a Gmail download by its labels */
  gmail?: boolean;
}

const BATCH = 500;

async function planMail(req: ImportRequest): Promise<{ label: string; top: string; plans: MailPlan[] }> {
  const paths = req.paths ?? [];
  if (req.source === 'mbox') {
    const plans: MailPlan[] = [];
    for (const f of paths) {
      const st = await fsp.stat(f);
      // An Apple Mail export is a folder named X.mbox holding an "mbox" file.
      if (st.isDirectory()) {
        const inner = path.join(f, 'mbox');
        if (await exists(inner)) plans.push({ folder: targetFolder([path.basename(f)]).path, items: [{ kind: 'mbox', file: inner }] });
        continue;
      }
      const name = path.basename(f).replace(/\.(mbox|mbx|mbs)$/i, '');
      const gmail = /all mail including spam and trash|^all mail$/i.test(name) || /takeout/i.test(f);
      plans.push({ folder: targetFolder([name]).path, items: [{ kind: 'mbox', file: f }], gmail });
    }
    const one = paths.length === 1 ? path.basename(paths[0]).replace(/\.\w+$/, '') : 'Mailbox files';
    return { label: one, top: plans.some((p) => p.gmail) ? 'Gmail download' : 'Imported', plans };
  }
  if (req.source === 'eml') {
    const plans = new Map<string, MailPlan>();
    for (const p of paths) {
      const st = await fsp.stat(p);
      const files = st.isDirectory() ? (await walk(p)).map((f) => ({ abs: path.join(p, f.path), rel: f.path })) : [{ abs: p, rel: path.basename(p) }];
      const base = st.isDirectory() ? path.basename(p) : 'Messages';
      for (const f of files) {
        if (!/\.(eml|emlx|msg|txt)$/i.test(f.rel) && st.isDirectory()) continue;
        const dirParts = path.dirname(f.rel) === '.' ? [] : path.dirname(f.rel).split(path.sep);
        const folder = [base, ...dirParts].join('/');
        const plan = plans.get(folder) ?? { folder, items: [] };
        plan.items.push({ kind: /\.emlx$/i.test(f.rel) ? 'emlx' : 'eml', file: f.abs });
        plans.set(folder, plan);
      }
    }
    return { label: paths.length === 1 ? path.basename(paths[0]) : 'Message files', top: 'Imported', plans: [...plans.values()] };
  }
  if (req.source === 'apple-mail') {
    const root = paths[0];
    const files = await walk(root);
    const plans = new Map<string, MailPlan>();
    // Account folders are ids; "Mailboxes" is On My Mac.
    for (const f of files) {
      const where = appleMailFolder(f.path);
      if (!where) continue;
      const acct = where.account === 'Mailboxes' ? 'On My Mac' : where.account.slice(0, 8);
      const folder = [acct, ...where.folder].join('/');
      const plan = plans.get(folder) ?? { folder, items: [] };
      plan.items.push({ kind: 'emlx', file: path.join(root, f.path) });
      plans.set(folder, plan);
    }
    return { label: 'Apple Mail', top: 'Apple Mail', plans: [...plans.values()] };
  }
  if (req.source === 'thunderbird') {
    const profile = paths[0];
    const plans: MailPlan[] = [];
    for (const kind of ['Mail', 'ImapMail']) {
      const dir = path.join(profile, kind);
      for (const server of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
        if (!server.isDirectory()) continue;
        const sdir = path.join(dir, server.name);
        const boxes = thunderbirdMailboxes(await walk(sdir));
        for (const b of boxes) plans.push({ folder: [thunderbirdAccountName(server.name), ...b.folder].join('/'), items: [{ kind: 'mbox', file: path.join(sdir, b.file) }] });
        // Maildir storage: cur/ and new/ hold one file per message.
        for (const f of await walk(sdir)) {
          const m = f.path.split(path.sep);
          if (m.length >= 2 && (m[m.length - 2] === 'cur' || m[m.length - 2] === 'new')) {
            const folder = [thunderbirdAccountName(server.name), ...m.slice(0, -2).map((x) => x.replace(/\.sbd$/, ''))].join('/');
            let plan = plans.find((p) => p.folder === folder);
            if (!plan) { plan = { folder, items: [] }; plans.push(plan); }
            plan.items.push({ kind: 'eml', file: path.join(sdir, f.path) });
          }
        }
      }
    }
    return { label: `Thunderbird · ${path.basename(profile)}`, top: 'Thunderbird', plans };
  }
  if (req.source === 'olm') {
    const plans = new Map<string, MailPlan>();
    for (const file of paths) {
      const z = await ZipReader.open(file);
      try {
        for (const e of z.entries) {
          const f = olmFolder(e.name);
          if (!f) continue;
          const folder = f.join('/') || 'Inbox';
          const plan = plans.get(folder) ?? { folder, items: [] };
          plan.items.push({ kind: 'olm', zip: file, entry: e.name });
          plans.set(folder, plan);
        }
      } finally {
        await z.close();
      }
    }
    return { label: paths.length === 1 ? path.basename(paths[0]) : 'Outlook archives', top: 'Outlook archive', plans: [...plans.values()] };
  }
  throw new Error('Keeper can’t read this kind of mail yet');
}

/** A unique top folder for this import ("Thunderbird", "Thunderbird 2"). */
async function freeTop(box: LocalMailbox, top: string): Promise<string> {
  const have = new Set((await box.folders()).map((f) => f.path.split('/')[0]));
  if (!have.has(top)) return top;
  for (let i = 2; ; i++) if (!have.has(`${top} ${i}`)) return `${top} ${i}`;
}

async function importMail(id: string, req: ImportRequest, host: ImportHost, job: { cancelled: boolean }): Promise<ImportResult> {
  const plan = await planMail(req);
  const { account, box } = await host.localMail();
  const top = await freeTop(box, plan.top);
  const total = plan.plans.reduce((n, p) => n + (p.items.length === 1 && p.items[0].kind === 'mbox' ? 0 : p.items.length), 0) || undefined;
  const added = new Map<string, number[]>();
  const seen = new Map<string, Set<string>>();
  const notes: string[] = [];
  let done = 0;
  let skipped = 0;
  let failed = 0;
  let partial = 0;
  const report = (current?: string) => host.progress({ id, source: req.source, phase: 'adding', done, total, current });

  const put = async (folder: string, raw: Buffer, flags: string[], extra: { labels?: string[] } = {}) => {
    const path_ = `${top}/${folder}`;
    const mid = messageIdOf(raw);
    const s = seen.get(path_) ?? new Set<string>();
    seen.set(path_, s);
    if (mid && s.has(mid)) { skipped++; return; }
    if (mid) s.add(mid);
    try {
      const uid = await box.append(path_, raw, flags, extra.labels?.length ? { summary: { labels: extra.labels } } : {});
      if (uid !== undefined) added.set(path_, [...(added.get(path_) ?? []), uid]);
      done++;
    } catch {
      failed++;
    }
    if (done % BATCH === 0) { await box.flush(); report(folder); }
  };

  for (const p of plan.plans) {
    if (job.cancelled) break;
    report(p.folder);
    for (const it of p.items) {
      if (job.cancelled) break;
      try {
        if (it.kind === 'mbox') {
          // Read as a stream: mbox files can be many gigabytes.
          const queue: { raw: Buffer }[] = [];
          const splitter = new MboxSplitter((raw) => queue.push({ raw }));
          const stream = createReadStream(it.file, { highWaterMark: 1 << 20 });
          const drain = async () => {
            while (queue.length) {
              const { raw } = queue.shift()!;
              if (p.gmail) {
                const g = gmailPlacement(gmailLabels(raw));
                await put(g.folder, raw, [...(g.seen ? ['\\Seen'] : []), ...(g.flagged ? ['\\Flagged'] : [])], { labels: g.labels });
              } else await put(p.folder, raw, statusFlags(raw));
            }
          };
          for await (const chunk of stream) {
            splitter.push(chunk as Buffer);
            await drain();
            if (job.cancelled) { stream.destroy(); break; }
          }
          splitter.end();
          if (!job.cancelled) await drain();
        } else if (it.kind === 'eml') {
          const raw = await fsp.readFile(it.file);
          await put(p.folder, raw, ['\\Seen']);
        } else if (it.kind === 'emlx') {
          const m = parseEmlx(await fsp.readFile(it.file), /\.partial\.emlx$/i.test(it.file));
          if (!m) { failed++; continue; }
          if (m.deleted) { skipped++; continue; }
          if (m.partial) partial++;
          await put(p.folder, m.raw, [...(m.seen ? ['\\Seen'] : []), ...(m.flagged ? ['\\Flagged'] : []), ...(m.answered ? ['\\Answered'] : [])]);
        } else {
          const z = await ZipReader.open(it.zip);
          try {
            const entry = z.entries.find((e) => e.name === it.entry);
            const msg = entry && parseOlmMessage((await z.read(entry)).toString('utf8'));
            if (!msg) { failed++; continue; }
            const atts: { name: string; type: string; content: Buffer }[] = [];
            for (const a of msg.attachments) {
              const e = z.find(a.url);
              if (e) atts.push({ name: a.name, type: a.type, content: await z.read(e) });
            }
            await put(p.folder, buildMessage({ ...msg, attachments: atts }), [...(msg.seen ? ['\\Seen'] : []), ...(msg.flagged ? ['\\Flagged'] : [])]);
          } finally {
            await z.close();
          }
        }
      } catch (e) {
        if ((e as { code?: string }).code === 'NO_ACCESS') throw e;
        failed++;
        notes.push(`${path.basename('file' in it ? it.file : it.entry)} could not be read`);
      }
    }
  }
  await box.flush();
  const folders = [...added.keys()];
  await host.mailChanged(folders);
  if (partial) notes.push(`${partial} message${partial === 1 ? '' : 's'} came without their attachments (Mail kept them apart).`);
  const counts = { added: done, skipped, failed, folders: folders.length };
  return {
    id, area: 'mail', source: req.source, label: plan.label, at: Date.now(), ...counts, summary: importSummary(counts), cancelled: job.cancelled || undefined,
    open: folders.length ? `${account}:${folders.sort((a, b) => (added.get(b)?.length ?? 0) - (added.get(a)?.length ?? 0))[0]}` : undefined,
    undo: { kind: 'mail', account, added: [...added].map(([folder, uids]) => ({ folder, uids })), folders: [...new Set(folders.flatMap((f) => f.split('/').map((_, i, a) => a.slice(0, i + 1).join('/'))))] },
    notes: notes.length ? notes.slice(0, 5) : undefined,
  };
}

/** Read and flagged marks some apps write into mbox files (Status: RO, X-Status: F). */
function statusFlags(raw: Buffer): string[] {
  const head = raw.subarray(0, 8000).toString('latin1').split(/\r?\n\r?\n/)[0];
  const st = head.match(/^Status:\s*(\S*)/im)?.[1] ?? '';
  const xs = head.match(/^X-Status:\s*(\S*)/im)?.[1] ?? '';
  const moz = parseInt(head.match(/^X-Mozilla-Status:\s*([0-9a-f]{4})/im)?.[1] ?? '0', 16);
  const flags: string[] = [];
  // Without any marks a message from an export counts as read.
  if (st.includes('R') || (moz & 0x1) || (!st && !moz)) flags.push('\\Seen');
  if (xs.includes('F') || (moz & 0x4)) flags.push('\\Flagged');
  if (xs.includes('A') || (moz & 0x2)) flags.push('\\Answered');
  return flags;
}

// ---------------------------------------------------------------- calendar

async function importCalendar(id: string, req: ImportRequest, host: ImportHost): Promise<ImportResult> {
  const file = req.paths?.[0];
  if (!file) throw new Error('Choose a calendar file');
  const evs = parseEvents(await fsp.readFile(file, 'utf8'));
  host.progress({ id, source: req.source, phase: 'adding', done: 0, total: evs.length });
  const name = path.basename(file).replace(/\.(ics|ical|icalendar|ifb)$/i, '');
  const r = await host.addEvents(evs, { calendar: req.calendar, name });
  const series = new Set(evs.map((e) => e.uid)).size;
  const repeating = evs.filter((e) => e.rrule).length;
  const changedOnes = evs.filter((e) => e.recurrenceId !== undefined).length;
  const counts = { added: series, skipped: 0, failed: 0, folders: 1 };
  const extras = [repeating ? `${repeating} repeating` : '', changedOnes ? `${changedOnes} changed occurrence${changedOnes === 1 ? '' : 's'}` : ''].filter(Boolean);
  return { id, area: 'calendar', source: req.source, label: name, at: Date.now(), ...counts, summary: [importSummary(counts, 'event'), ...extras].join(' · '), open: r.calendar, undo: { kind: 'calendar', calendar: r.calendar, created: r.created, uids: r.uids } };
}

// ---------------------------------------------------------------- reminders

/** Apple Reminders through the Reminders app's scripting (macOS asks once). */
async function appleReminders(): Promise<AppleReminder[]> {
  const script = `
const R = Application('Reminders');
const out = [];
R.lists().forEach((l) => {
  const name = l.name();
  const rs = l.reminders;
  const n = rs.name(), body = rs.body(), due = rs.dueDate(), allday = rs.alldayDueDate(), done = rs.completed(), doneAt = rs.completionDate(), pr = rs.priority(), ids = rs.id(), made = rs.creationDate();
  for (let i = 0; i < n.length; i++) out.push({ title: n[i], notes: body[i] || undefined, list: name, due: (allday[i] || due[i]) ? (allday[i] || due[i]).getTime() : undefined, dueAllDay: !!allday[i], completed: done[i], completedAt: doneAt[i] ? doneAt[i].getTime() : undefined, priority: pr[i], id: ids[i], created: made[i] ? made[i].getTime() : undefined });
});
JSON.stringify(out);`;
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-l', 'JavaScript', '-e', script], { maxBuffer: 64 * 1024 * 1024, timeout: 120_000 }, (err, stdout) => {
      if (err) return reject(new Error(/not allowed|-1743/i.test(String(err.message)) ? 'Keeper may not read Reminders. Allow it in System Settings → Privacy & Security → Reminders.' : 'Reminders could not be read'));
      try { resolve(JSON.parse(stdout) as AppleReminder[]); } catch { reject(new Error('Reminders answered something Keeper can’t read')); }
    });
  });
}

async function getJson(url: string, token: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
  if (res.status === 401 || res.status === 403) throw new Error('The sign-in was not accepted. Try again.');
  if (!res.ok) throw new Error(`The service answered ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

/** Where the task services live (tests point these at a stand-in server). */
export const TASK_APIS = {
  google: 'https://tasks.googleapis.com/tasks/v1',
  graph: 'https://graph.microsoft.com/v1.0',
  todoist: 'https://api.todoist.com/api/v1',
};

export async function googleTasks(token: string): Promise<Reminder[]> {
  const lists: { title: string; items: Parameters<typeof tasksFromGoogle>[0][number]['items'] }[] = [];
  const ls = (await getJson(`${TASK_APIS.google}/users/@me/lists?maxResults=100`, token)).items as { id: string; title: string }[] ?? [];
  for (const l of ls) {
    const items: Parameters<typeof tasksFromGoogle>[0][number]['items'] = [];
    let page: string | undefined;
    do {
      const r = await getJson(`${TASK_APIS.google}/lists/${encodeURIComponent(l.id)}/tasks?maxResults=100&showCompleted=true&showHidden=true${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`, token);
      items.push(...((r.items as typeof items) ?? []));
      page = r.nextPageToken as string | undefined;
    } while (page);
    lists.push({ title: l.title, items });
  }
  return tasksFromGoogle(lists);
}

export async function msTodoTasks(token: string): Promise<Reminder[]> {
  const lists: Parameters<typeof tasksFromMsTodo>[0] = [];
  const ls = ((await getJson(`${TASK_APIS.graph}/me/todo/lists`, token)).value as { id: string; displayName: string }[]) ?? [];
  for (const l of ls) {
    const tasks: Parameters<typeof tasksFromMsTodo>[0][number]['tasks'] = [];
    let next: string | undefined = `${TASK_APIS.graph}/me/todo/lists/${encodeURIComponent(l.id)}/tasks?$expand=checklistItems&$top=100`;
    while (next) {
      const r = await getJson(next, token);
      tasks.push(...((r.value as typeof tasks) ?? []));
      next = r['@odata.nextLink'] as string | undefined;
    }
    lists.push({ displayName: l.displayName, tasks });
  }
  return tasksFromMsTodo(lists);
}

export async function todoistTasks(token: string): Promise<Reminder[]> {
  const all = async (what: string) => {
    const out: Record<string, unknown>[] = [];
    let cursor: string | undefined;
    do {
      const r = await getJson(`${TASK_APIS.todoist}/${what}?limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, token);
      out.push(...((r.results as Record<string, unknown>[]) ?? []));
      cursor = (r.next_cursor as string | null) ?? undefined;
    } while (cursor);
    return out;
  };
  const [projects, tasks] = await Promise.all([all('projects'), all('tasks')]);
  return tasksFromTodoist(tasks as never, projects as never);
}

/** A Todoist file: a project's CSV, a JSON backup, or a backup .zip of CSV files (one per project). */
async function todoistFile(file: string): Promise<Reminder[]> {
  if (/\.zip$/i.test(file)) {
    const z = await ZipReader.open(file);
    try {
      const out: Reminder[] = [];
      for (const e of z.entries.filter((x) => /\.csv$/i.test(x.name))) out.push(...tasksFromTodoistCsv((await z.read(e)).toString('utf8'), path.basename(e.name).replace(/\s*\[\d+\]\s*\.csv$|\.csv$/i, '')));
      return out;
    } finally {
      await z.close();
    }
  }
  const text = await fsp.readFile(file, 'utf8');
  if (/\.json$/i.test(file)) {
    const j = JSON.parse(text) as { items?: unknown[]; tasks?: unknown[]; projects?: unknown[] } | unknown[];
    return Array.isArray(j) ? tasksFromTodoist(j as never) : tasksFromTodoist((j.items ?? j.tasks ?? []) as never, (j.projects ?? []) as never);
  }
  return tasksFromTodoistCsv(text, path.basename(file).replace(/\s*\[\d+\]\s*\.csv$|\.csv$/i, ''));
}

async function importReminders(id: string, req: ImportRequest, host: ImportHost): Promise<ImportResult> {
  let list: Reminder[];
  let label = IMPORT_SOURCES.find((s) => s.id === req.source)?.label ?? 'Tasks';
  host.progress({ id, source: req.source, phase: 'reading', done: 0 });
  if (req.source === 'apple-reminders') list = tasksFromApple(await appleReminders());
  else if (req.source === 'google-tasks') list = await googleTasks(await host.signInToken('google', ['https://www.googleapis.com/auth/tasks.readonly']));
  else if (req.source === 'ms-todo') list = await msTodoTasks(await host.signInToken('microsoft', ['https://graph.microsoft.com/Tasks.Read', 'offline_access']));
  else if (req.source === 'todoist') list = req.token ? await todoistTasks(req.token.trim()) : (await Promise.all((req.paths ?? []).map(todoistFile))).flat();
  else {
    const file = req.paths?.[0];
    if (!file) throw new Error('Choose a file');
    label = path.basename(file);
    const text = await fsp.readFile(file, 'utf8');
    list = req.source === 'tasks-ics' ? tasksFromIcs(text) : tasksFromCsv(text);
  }
  const have = new Set(host.reminders().map(taskKey));
  const fresh = list.filter((t) => { const k = taskKey(t); if (have.has(k)) return false; have.add(k); return true; });
  host.progress({ id, source: req.source, phase: 'adding', done: 0, total: fresh.length });
  await host.addReminders(fresh);
  const lists = new Set(fresh.map((t) => t.project ?? '')).size;
  const counts = { added: fresh.length, skipped: list.length - fresh.length, failed: 0, folders: lists };
  return { id, area: 'reminders', source: req.source, label, at: Date.now(), ...counts, summary: importSummary(counts, 'task').replace(/ in (\d+) folders/, ' in $1 lists'), undo: { kind: 'reminders', ids: fresh.map((t) => t.id) } };
}

// ---------------------------------------------------------------- contacts

async function importContacts(id: string, req: ImportRequest, host: ImportHost): Promise<ImportResult> {
  const file = req.paths?.[0];
  if (!file) throw new Error('Choose a file');
  const text = await fsp.readFile(file, 'utf8');
  const got = req.source === 'vcf' ? contactsFromVcf(text) : contactsFromCsv(text);
  const have = new Set(host.contacts().map(contactKey));
  const fresh = got.filter((c) => { const k = contactKey(c); if (have.has(k)) return false; have.add(k); return true; }).map((c) => ({ ...c, account: 'local', id: `local:${randomUUID()}`, uid: c.uid ?? randomUUID(), href: undefined, etag: undefined }));
  await host.addContacts(fresh);
  const counts = { added: fresh.length, skipped: got.length - fresh.length, failed: 0, folders: 1 };
  return { id, area: 'contacts', source: req.source, label: path.basename(file), at: Date.now(), ...counts, summary: importSummary(counts, 'contact'), undo: { kind: 'contacts', ids: fresh.map((c) => c.id) } };
}

// ---------------------------------------------------------------- running and taking back

export function areaOf(source: ImportSourceId): ImportArea {
  return IMPORT_SOURCES.find((s) => s.id === source)?.area ?? 'mail';
}

export async function runImport(req: ImportRequest, host: ImportHost, id = randomUUID()): Promise<ImportResult> {
  const src = IMPORT_SOURCES.find((s) => s.id === req.source);
  if (!src) throw new Error('Unknown kind of import');
  if (src.unavailable) throw new Error(src.unavailable);
  const job = { cancelled: false };
  running.set(id, job);
  host.progress({ id, source: req.source, phase: 'reading', done: 0 });
  try {
    const r = src.area === 'mail' ? await importMail(id, req, host, job) : src.area === 'calendar' ? await importCalendar(id, req, host) : src.area === 'reminders' ? await importReminders(id, req, host) : await importContacts(id, req, host);
    await remember(r);
    host.progress({ id, source: req.source, phase: r.cancelled ? 'cancelled' : 'done', done: r.added, total: r.added });
    return { ...r, undo: undefined };
  } catch (e) {
    host.progress({ id, source: req.source, phase: 'failed', done: 0 });
    throw e;
  } finally {
    running.delete(id);
  }
}

export async function undoImport(id: string, host: ImportHost): Promise<ImportResult | null> {
  const all = await readJson<ImportResult[]>(historyFile(), []);
  const r = all.find((x) => x.id === id);
  if (!r || r.undone || !r.undo) return null;
  const u = r.undo;
  if (u.kind === 'mail') {
    const { box } = await host.localMail();
    for (const a of u.added) await box.remove(a.folder, a.uids);
    await box.flush();
    for (const f of [...u.folders].sort((a, b) => b.length - a.length)) await box.dropFolderIfEmpty(f);
    await box.folders();
    await host.mailChanged(u.added.map((a) => a.folder));
  } else if (u.kind === 'calendar') await host.removeEvents(u.calendar, u.uids, u.created);
  else if (u.kind === 'reminders') await host.removeReminders(u.ids);
  else await host.removeContacts(u.ids);
  const next = { ...r, undone: true };
  await writeJson(historyFile(), all.map((x) => (x.id === id ? next : x)));
  return { ...next, undo: undefined };
}

// ---------------------------------------------------------------- export

/** Every message in a folder, in batches, read from wherever it is kept. */
async function eachMessage(box: MailBox, folder: string, fn: (raw: Buffer, uid: number, date: number, from: string) => Promise<void>, cancelled: () => boolean) {
  const uids = await box.allUids(folder);
  const known = new Map((await box.cached(folder)).messages.map((m) => [m.uid, m]));
  for (const uid of uids.sort((a, b) => a - b)) {
    if (cancelled()) return;
    const raw = await box.source(folder, uid).catch(() => null);
    if (!raw) continue;
    const m = known.get(uid);
    await fn(raw, uid, m?.date ?? 0, m?.from?.address ?? '');
  }
}

/**
 * A folder (or every folder of an account) written out: one .mbox file per
 * folder, or a folder of .eml files per folder, into `dest`.
 */
export async function exportMail(account: string, folder: string | undefined, format: 'mbox' | 'eml', dest: string, host: ImportHost): Promise<{ path: string; count: number }> {
  const box = host.mailbox(account);
  if (!box) throw new Error('This account was removed');
  const folders = folder ? [folder] : (await host.folders(account)).map((f) => f.path);
  const id = randomUUID();
  const job = { cancelled: false };
  running.set(id, job);
  let count = 0;
  try {
    for (const f of folders) {
      const name = safeFileName(f.replace(/\//g, ' - ') === 'INBOX' ? 'Inbox' : f.replace(/\//g, ' - '), 'Folder');
      host.progress({ id, source: format === 'mbox' ? 'mbox' : 'eml', phase: 'adding', done: count, current: f });
      if (format === 'mbox') {
        const file = folders.length === 1 && /\.mbox$/i.test(dest) ? dest : path.join(dest, `${name}.mbox`);
        await fsp.mkdir(path.dirname(file), { recursive: true });
        const fh = await fsp.open(file, 'w');
        try {
          await eachMessage(box, f, async (raw, _uid, date, from) => { await fh.write(toMboxEntry(raw, from, date)); count++; }, () => job.cancelled);
        } finally {
          await fh.close();
        }
      } else {
        const dir = path.join(dest, name);
        await fsp.mkdir(dir, { recursive: true });
        await eachMessage(box, f, async (raw, uid) => {
          const subj = (raw.subarray(0, 8000).toString('utf8').match(/^Subject:\s*(.*)$/im)?.[1] ?? '').trim();
          await fsp.writeFile(path.join(dir, `${String(uid).padStart(6, '0')} ${safeFileName(subj.replace(/=\?[^?]+\?[bq]\?[^?]*\?=/gi, '').trim(), 'message')}.eml`), raw);
          count++;
        }, () => job.cancelled);
      }
    }
  } finally {
    running.delete(id);
    host.progress({ id, source: format === 'mbox' ? 'mbox' : 'eml', phase: 'done', done: count, total: count });
  }
  return { path: dest, count };
}

export async function exportTasks(list: Reminder[], format: 'csv' | 'ics', file: string) {
  await fsp.writeFile(file, format === 'csv' ? tasksToCsv(list) : tasksToIcs(list));
  return { path: file, count: list.length };
}

export async function exportContacts(list: Contact[], format: 'vcf' | 'csv', file: string) {
  await fsp.writeFile(file, format === 'vcf' ? contactsToVcf(list) : contactsToCsv(list));
  return { path: file, count: list.length };
}

