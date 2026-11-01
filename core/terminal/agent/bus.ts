// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// How agents (and people) working in different terminals talk to each other:
//
//   channels   named topics anyone in Keeper can post to and read from, with a
//              short history and a cursor per reader
//   mailboxes  messages addressed to one terminal, read once
//   scratch    a small shared key/value board per group, with versions so two
//              writers cannot silently overwrite each other
//   locks      advisory locks with a lease (a folder, a file, "the database"),
//              released when their holder's terminal ends or the lease runs out
//   events     command finished, pattern seen, terminal ended, message posted:
//              anyone can wait for the next one that matches
//
// Pure and in memory; the main process saves a snapshot so nothing is lost
// when Keeper restarts.

export interface BusMessage {
  seq: number;
  channel: string;
  from: string;
  text: string;
  data?: unknown;
  at: number;
}

export interface MailItem {
  id: number;
  to: string;
  from: string;
  text: string;
  data?: unknown;
  at: number;
}

export interface ScratchEntry {
  value: unknown;
  version: number;
  by: string;
  at: number;
}

export interface LockInfo {
  name: string;
  holder: string;
  /** the terminal holding it (released when it ends) */
  session?: string;
  token: string;
  expires: number;
  note?: string;
}

export type BusEvent =
  | { kind: 'command-finished'; session: string; command: string; exitCode?: number; at: number }
  | { kind: 'pattern'; session: string; pattern: string; line: string; at: number }
  | { kind: 'session-exited'; session: string; code?: number; at: number }
  | { kind: 'session-created'; session: string; parent?: string; at: number }
  | { kind: 'waiting-for-input'; session: string; prompt: string; at: number }
  | { kind: 'message'; channel: string; from: string; seq: number; at: number }
  | { kind: 'mail'; to: string; from: string; at: number }
  | { kind: 'lock'; name: string; holder?: string; state: 'taken' | 'released' | 'expired'; at: number };

export interface EventFilter {
  kinds?: BusEvent['kind'][];
  session?: string;
  channel?: string;
}

interface Waiter {
  filter: EventFilter;
  resolve: (e: BusEvent | null) => void;
  timer?: ReturnType<typeof setTimeout>;
}

export interface BusSnapshot {
  channels: Record<string, BusMessage[]>;
  seq: number;
  mail: MailItem[];
  mailSeq: number;
  scratch: Record<string, Record<string, ScratchEntry>>;
  locks: LockInfo[];
}

const HISTORY = 200;
const MAX_MAIL = 500;
const MAX_TEXT = 64 * 1024;

const matches = (e: BusEvent, f: EventFilter) =>
  (!f.kinds?.length || f.kinds.includes(e.kind)) &&
  (!f.session || ('session' in e && e.session === f.session) || ('to' in e && e.to === f.session)) &&
  (!f.channel || ('channel' in e && e.channel === f.channel));

export class AgentBus {
  private channels = new Map<string, BusMessage[]>();
  private seq = 0;
  private mail: MailItem[] = [];
  private mailSeq = 0;
  private scratch = new Map<string, Map<string, ScratchEntry>>();
  private locks = new Map<string, LockInfo>();
  private recent: BusEvent[] = [];
  private waiters = new Set<Waiter>();
  onChange?: () => void;

  constructor(private now: () => number = Date.now, private token: () => string = () => Math.random().toString(36).slice(2, 12)) {}

  // ---------------------------------------------------------------- events

  emit(e: BusEvent) {
    this.recent.push(e);
    if (this.recent.length > 500) this.recent.splice(0, this.recent.length - 500);
    for (const w of [...this.waiters]) {
      if (!matches(e, w.filter)) continue;
      this.waiters.delete(w);
      if (w.timer) clearTimeout(w.timer);
      w.resolve(e);
    }
    this.onChange?.();
  }

  /** The next event that matches (or one that happened after `since`), or null after the timeout. */
  waitFor(filter: EventFilter, timeoutMs: number, since?: number): Promise<BusEvent | null> {
    if (since !== undefined) {
      const hit = this.recent.find((e) => e.at > since && matches(e, filter));
      if (hit) return Promise.resolve(hit);
    }
    return new Promise((resolve) => {
      const w: Waiter = { filter, resolve };
      if (timeoutMs > 0) w.timer = setTimeout(() => { this.waiters.delete(w); resolve(null); }, timeoutMs);
      this.waiters.add(w);
    });
  }

  events(since = 0, filter: EventFilter = {}): BusEvent[] {
    return this.recent.filter((e) => e.at > since && matches(e, filter));
  }

  /** Stops every pending wait (Keeper quitting). */
  close() {
    for (const w of this.waiters) { if (w.timer) clearTimeout(w.timer); w.resolve(null); }
    this.waiters.clear();
  }

  // ---------------------------------------------------------------- channels

  post(channel: string, from: string, text: string, data?: unknown): BusMessage {
    const name = channel.trim().slice(0, 80) || 'general';
    const m: BusMessage = { seq: ++this.seq, channel: name, from, text: text.slice(0, MAX_TEXT), data, at: this.now() };
    const list = this.channels.get(name) ?? [];
    list.push(m);
    if (list.length > HISTORY) list.splice(0, list.length - HISTORY);
    this.channels.set(name, list);
    this.emit({ kind: 'message', channel: name, from, seq: m.seq, at: m.at });
    return m;
  }

  /** Messages after `after` (a seq from an earlier read). */
  read(channel: string, after = 0, limit = 50): BusMessage[] {
    return (this.channels.get(channel) ?? []).filter((m) => m.seq > after).slice(0, limit);
  }

  channelNames(): { name: string; count: number; last?: number }[] {
    return [...this.channels.entries()].map(([name, l]) => ({ name, count: l.length, last: l[l.length - 1]?.at }));
  }

  // ---------------------------------------------------------------- mailboxes

  send(to: string, from: string, text: string, data?: unknown): MailItem {
    const m: MailItem = { id: ++this.mailSeq, to, from, text: text.slice(0, MAX_TEXT), data, at: this.now() };
    this.mail.push(m);
    if (this.mail.length > MAX_MAIL) this.mail.splice(0, this.mail.length - MAX_MAIL);
    this.emit({ kind: 'mail', to, from, at: m.at });
    return m;
  }

  /** Takes the messages waiting for `to` (each is delivered once). */
  receive(to: string, peek = false): MailItem[] {
    const mine = this.mail.filter((m) => m.to === to);
    if (!peek) this.mail = this.mail.filter((m) => m.to !== to);
    if (!peek && mine.length) this.onChange?.();
    return mine;
  }

  /** Takes only the messages for `to` that match. */
  take(to: string, pred: (m: MailItem) => boolean): MailItem[] {
    const hit = this.mail.filter((m) => m.to === to && pred(m));
    if (hit.length) {
      this.mail = this.mail.filter((m) => !hit.includes(m));
      this.onChange?.();
    }
    return hit;
  }

  pendingMail(to: string): number {
    return this.mail.filter((m) => m.to === to).length;
  }

  // ---------------------------------------------------------------- scratch board

  /** Writes a value; with `ifVersion`, only when nobody changed it since that version. */
  put(group: string, key: string, value: unknown, by: string, ifVersion?: number): { ok: boolean; entry?: ScratchEntry; current?: ScratchEntry } {
    const g = this.scratch.get(group) ?? new Map<string, ScratchEntry>();
    const cur = g.get(key);
    if (ifVersion !== undefined && (cur?.version ?? 0) !== ifVersion) return { ok: false, current: cur };
    const size = JSON.stringify(value ?? null).length;
    if (size > MAX_TEXT) return { ok: false, current: cur };
    const e: ScratchEntry = { value, version: (cur?.version ?? 0) + 1, by, at: this.now() };
    if (value === undefined || value === null) g.delete(key); else g.set(key, e);
    this.scratch.set(group, g);
    this.onChange?.();
    return { ok: true, entry: e };
  }

  get(group: string, key?: string): Record<string, ScratchEntry> | ScratchEntry | undefined {
    const g = this.scratch.get(group);
    if (!g) return key ? undefined : {};
    return key ? g.get(key) : Object.fromEntries(g);
  }

  // ---------------------------------------------------------------- locks

  private expire() {
    const t = this.now();
    for (const [name, l] of this.locks) {
      if (l.expires > t) continue;
      this.locks.delete(name);
      this.emit({ kind: 'lock', name, holder: l.holder, state: 'expired', at: t });
    }
  }

  /** Takes a lock for `ttlMs` (default a minute); renewing with the same holder extends it. */
  acquire(name: string, holder: string, ttlMs = 60_000, session?: string, note?: string): { ok: true; lock: LockInfo } | { ok: false; heldBy: LockInfo } {
    this.expire();
    const cur = this.locks.get(name);
    if (cur && cur.holder !== holder) return { ok: false, heldBy: cur };
    const lock: LockInfo = { name, holder, session, token: cur?.token ?? this.token(), expires: this.now() + Math.max(1000, Math.min(ttlMs, 24 * 3600_000)), note };
    this.locks.set(name, lock);
    if (!cur) this.emit({ kind: 'lock', name, holder, state: 'taken', at: this.now() });
    else this.onChange?.();
    return { ok: true, lock };
  }

  release(name: string, holder: string, token?: string): boolean {
    const cur = this.locks.get(name);
    if (!cur || cur.holder !== holder || (token && cur.token !== token)) return false;
    this.locks.delete(name);
    this.emit({ kind: 'lock', name, holder, state: 'released', at: this.now() });
    return true;
  }

  /** Waits until a lock is free (or the timeout), then takes it. */
  async acquireWait(name: string, holder: string, ttlMs: number, timeoutMs: number, session?: string): Promise<{ ok: true; lock: LockInfo } | { ok: false; heldBy: LockInfo }> {
    const end = this.now() + timeoutMs;
    for (;;) {
      const r = this.acquire(name, holder, ttlMs, session);
      if (r.ok) return r;
      const left = Math.min(end - this.now(), r.heldBy.expires - this.now() + 5);
      if (left <= 0) return r;
      await this.waitFor({ kinds: ['lock'] }, left);
    }
  }

  /** Locks held by a terminal end with it. */
  releaseSession(session: string) {
    for (const [name, l] of this.locks) if (l.session === session) {
      this.locks.delete(name);
      this.emit({ kind: 'lock', name, holder: l.holder, state: 'released', at: this.now() });
    }
  }

  lockList(): LockInfo[] {
    this.expire();
    return [...this.locks.values()];
  }

  /** When the next lease runs out (to schedule one timer, not a poll). */
  nextExpiry(): number | undefined {
    let n: number | undefined;
    for (const l of this.locks.values()) n = n === undefined ? l.expires : Math.min(n, l.expires);
    return n;
  }

  // ---------------------------------------------------------------- saving

  snapshot(): BusSnapshot {
    const scratch: BusSnapshot['scratch'] = {};
    for (const [g, m] of this.scratch) scratch[g] = Object.fromEntries(m);
    return { channels: Object.fromEntries(this.channels), seq: this.seq, mail: this.mail, mailSeq: this.mailSeq, scratch, locks: [...this.locks.values()] };
  }

  restore(s: Partial<BusSnapshot>) {
    this.channels = new Map(Object.entries(s.channels ?? {}));
    this.seq = s.seq ?? 0;
    this.mail = s.mail ?? [];
    this.mailSeq = s.mailSeq ?? 0;
    this.scratch = new Map(Object.entries(s.scratch ?? {}).map(([g, m]) => [g, new Map(Object.entries(m))]));
    this.locks = new Map((s.locks ?? []).map((l) => [l.name, l]));
    this.expire();
  }
}
