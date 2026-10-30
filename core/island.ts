// SPDX-License-Identifier: AGPL-3.0-or-later
// The pure logic behind the Island (the small live panel at the top of the
// screen): calendar files, synced lyrics, AI-agent session status, clipboard
// history and the focus timer. The Electron layer feeds these with data.

import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ---------------------------------------------------------------- calendar (.ics)

export interface CalendarEvent {
  uid: string;
  title: string;
  start: number;
  end: number;
  allDay: boolean;
  location?: string;
  url?: string;
}

/** Undoes RFC 5545 line folding and escaping. */
function unfold(text: string): string[] {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

function unescape(v: string): string {
  return v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
}

/** 20261030T150000Z, 20261030T150000 (floating = local), 20261030 (all-day). */
export function parseIcsDate(value: string, params = ''): { t: number; allDay: boolean } | undefined {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return undefined;
  const [, y, mo, d, h, mi, s, z] = m;
  if (!h) return { t: new Date(+y, +mo - 1, +d).getTime(), allDay: true };
  if (z) return { t: Date.UTC(+y, +mo - 1, +d, +h, +mi, +s), allDay: false };
  // TZID=... is treated as local time; good enough for "what is next today".
  void params;
  return { t: new Date(+y, +mo - 1, +d, +h, +mi, +s).getTime(), allDay: false };
}

const DAY = 86_400_000;

/**
 * Parses VEVENTs, expanding simple weekly/daily/monthly/yearly RRULEs inside
 * [from, to). Cancelled events are left out.
 */
export function parseIcs(text: string, from: number, to: number): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  let cur: Record<string, { value: string; params: string }> | null = null;
  for (const line of unfold(text)) {
    if (line === 'BEGIN:VEVENT') cur = {};
    else if (line === 'END:VEVENT' && cur) {
      expand(cur, from, to, out);
      cur = null;
    } else if (cur) {
      const m = line.match(/^([A-Z-]+)((?:;[^:]*)?):(.*)$/);
      if (m && !(m[1] in cur)) cur[m[1]] = { params: m[2], value: m[3] };
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

function expand(ev: Record<string, { value: string; params: string }>, from: number, to: number, out: CalendarEvent[]) {
  if (ev.STATUS?.value === 'CANCELLED' || !ev.DTSTART) return;
  const start = parseIcsDate(ev.DTSTART.value, ev.DTSTART.params);
  if (!start) return;
  const endP = ev.DTEND ? parseIcsDate(ev.DTEND.value, ev.DTEND.params) : undefined;
  const length = endP ? endP.t - start.t : start.allDay ? DAY : 60 * 60_000;
  const base: Omit<CalendarEvent, 'start' | 'end'> = {
    uid: ev.UID?.value ?? `${start.t}`,
    title: unescape(ev.SUMMARY?.value ?? 'Busy'),
    allDay: start.allDay,
    location: ev.LOCATION ? unescape(ev.LOCATION.value) : undefined,
    url: ev.URL?.value,
  };
  const push = (t: number) => {
    if (t + length > from && t < to) out.push({ ...base, uid: `${base.uid}@${t}`, start: t, end: t + length });
  };
  const rule = ev.RRULE?.value;
  if (!rule) {
    push(start.t);
    return;
  }
  const parts = Object.fromEntries(rule.split(';').map((kv) => kv.split('=') as [string, string]));
  const freq = parts.FREQ;
  const interval = Math.max(1, parseInt(parts.INTERVAL ?? '1', 10));
  const until = parts.UNTIL ? parseIcsDate(parts.UNTIL)?.t ?? Infinity : Infinity;
  const count = parts.COUNT ? parseInt(parts.COUNT, 10) : Infinity;
  const exdates = new Set(
    Object.entries(ev)
      .filter(([k]) => k === 'EXDATE')
      .flatMap(([, v]) => v.value.split(',').map((x) => parseIcsDate(x)?.t)),
  );
  const d = new Date(start.t);
  for (let i = 0, n = 0; i < 5000 && n < count; i++) {
    const t = d.getTime();
    if (t > until || t >= to) break;
    n++;
    if (!exdates.has(t)) push(t);
    if (freq === 'DAILY') d.setDate(d.getDate() + interval);
    else if (freq === 'WEEKLY') d.setDate(d.getDate() + 7 * interval);
    else if (freq === 'MONTHLY') d.setMonth(d.getMonth() + interval);
    else if (freq === 'YEARLY') d.setFullYear(d.getFullYear() + interval);
    else break;
  }
}

export function nextEvent(events: CalendarEvent[], now = Date.now()): CalendarEvent | undefined {
  return events.find((e) => !e.allDay && e.end > now);
}

// ---------------------------------------------------------------- synced lyrics (.lrc)

export interface LyricLine {
  t: number; // seconds
  text: string;
}

export function parseLrc(text: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if (!stamps.length) continue;
    const words = raw.replace(/\[[^\]]*\]/g, '').trim();
    for (const s of stamps) {
      const frac = s[3] ? parseInt(s[3], 10) / 10 ** s[3].length : 0;
      lines.push({ t: parseInt(s[1], 10) * 60 + parseInt(s[2], 10) + frac, text: words });
    }
  }
  return lines.sort((a, b) => a.t - b.t);
}

/** The line being sung at `position` seconds (-1 before the first). */
export function currentLine(lines: LyricLine[], position: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].t <= position) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

// ---------------------------------------------------------------- AI coding agents

export type AgentState = 'working' | 'waiting' | 'done' | 'stuck' | 'idle';

export interface AgentSession {
  id: string;
  tool: 'claude-code' | 'codex';
  project: string;
  cwd?: string;
  state: AgentState;
  /** last line the agent wrote, shortened */
  summary: string;
  updatedAt: number;
  file: string;
}

/**
 * Reads the status of a coding-agent session from the last records of its
 * transcript (JSON Lines). Heuristics:
 *   - an assistant tool call with no result yet, unchanged for a while -> waiting for permission
 *   - recent activity -> working
 *   - an assistant text reply ending the turn -> done
 *   - an error record -> stuck
 */
export function agentStateFromTail(lines: string[], updatedAt: number, now = Date.now()): { state: AgentState; summary: string; cwd?: string } {
  const recs: Record<string, unknown>[] = [];
  for (const l of lines) {
    try {
      recs.push(JSON.parse(l));
    } catch {
      /* partial line */
    }
  }
  const age = now - updatedAt;
  let cwd: string | undefined;
  for (const r of recs) if (typeof r.cwd === 'string') cwd = r.cwd;
  const last = recs[recs.length - 1];
  if (!last) return { state: 'idle', summary: '', cwd };
  const text = summarize(last);
  const isError = JSON.stringify(last).match(/"(?:type|subtype)":"(?:error|api_error)"|"is_error":true/);
  if (isError && age < 30 * 60_000) return { state: 'stuck', summary: text, cwd };
  const msg = (last.message ?? last.payload ?? {}) as { role?: string; content?: unknown; stop_reason?: string; type?: string };
  const role = (last.type as string) ?? msg.role;
  const content = Array.isArray(msg.content) ? (msg.content as { type?: string }[]) : [];
  const pendingTool = (role === 'assistant' || msg.type === 'function_call') && (content.some((c) => c.type === 'tool_use') || msg.type === 'function_call');
  if (pendingTool && age > 8_000 && age < 60 * 60_000) return { state: 'waiting', summary: text, cwd };
  if (age < 15_000) return { state: 'working', summary: text, cwd };
  if (role === 'assistant' && age < 60 * 60_000) return { state: 'done', summary: text, cwd };
  return { state: 'idle', summary: text, cwd };
}

function summarize(rec: Record<string, unknown>): string {
  const msg = (rec.message ?? rec.payload ?? {}) as { content?: unknown };
  const c = msg.content;
  let s = '';
  if (typeof c === 'string') s = c;
  else if (Array.isArray(c)) {
    for (const part of c as { type?: string; text?: string; name?: string }[]) {
      if (part.type === 'text' && part.text) s = part.text;
      else if (part.type === 'tool_use' && part.name) s = `Wants to use ${part.name}`;
    }
  }
  return s.replace(/\s+/g, ' ').trim().slice(0, 140);
}

async function tail(file: string, bytes = 64 * 1024): Promise<string[]> {
  const fh = await fsp.open(file, 'r');
  try {
    const { size } = await fh.stat();
    const len = Math.min(size, bytes);
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, size - len);
    const lines = buf.toString('utf8').split('\n').filter(Boolean);
    return size > len ? lines.slice(1) : lines;
  } finally {
    await fh.close();
  }
}

async function recentJsonl(dir: string, maxAgeMs: number, depth = 4): Promise<string[]> {
  const out: string[] = [];
  const now = Date.now();
  async function go(d: string, level: number) {
    let list;
    try {
      list = await fsp.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of list) {
      const p = path.join(d, e.name);
      if (e.isDirectory() && level < depth) await go(p, level + 1);
      else if (e.isFile() && e.name.endsWith('.jsonl')) {
        const st = await fsp.stat(p).catch(() => null);
        if (st && now - st.mtimeMs < maxAgeMs) out.push(p);
      }
    }
  }
  await go(dir, 0);
  return out;
}

/** Sessions of Claude Code (~/.claude/projects) and Codex (~/.codex/sessions) active in the last few hours. */
export async function scanAgentSessions(home = os.homedir(), now = Date.now()): Promise<AgentSession[]> {
  const sources: { tool: AgentSession['tool']; dir: string }[] = [
    { tool: 'claude-code', dir: path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(home, '.claude'), 'projects') },
    { tool: 'codex', dir: path.join(process.env.CODEX_HOME ?? path.join(home, '.codex'), 'sessions') },
  ];
  const sessions: AgentSession[] = [];
  for (const s of sources) {
    for (const file of await recentJsonl(s.dir, 6 * 3600_000)) {
      try {
        const st = await fsp.stat(file);
        const { state, summary, cwd } = agentStateFromTail(await tail(file), st.mtimeMs, now);
        if (state === 'idle') continue;
        const project = cwd ? path.basename(cwd) : path.basename(path.dirname(file)).replace(/^-/, '').split('-').pop() ?? 'session';
        sessions.push({ id: file, tool: s.tool, project, cwd, state, summary, updatedAt: st.mtimeMs, file });
      } catch {
        /* unreadable */
      }
    }
  }
  const order: Record<AgentState, number> = { waiting: 0, stuck: 1, working: 2, done: 3, idle: 4 };
  return sessions.sort((a, b) => order[a.state] - order[b.state] || b.updatedAt - a.updatedAt);
}

// ---------------------------------------------------------------- clipboard history

export type ClipKind = 'text' | 'link' | 'code' | 'color' | 'image' | 'file';

export interface ClipItem {
  id: string;
  kind: ClipKind;
  text?: string;
  /** data: URL for images (kept small) */
  image?: string;
  at: number;
  pinned?: boolean;
  /** the app that was in front when it was copied */
  source?: string;
  /** the user's own note */
  note?: string;
  /** named lists the user filed it under */
  collections?: string[];
  /** text read from a copied image, so images are searchable too */
  ocr?: string;
  /** page title of a copied link, when fetching titles is on */
  title?: string;
}

/** Decides how a piece of copied text should be shown. */
export function detectClipKind(text: string): ClipKind {
  const t = text.trim();
  if (/^https?:\/\/\S+$/i.test(t)) return 'link';
  if (/^(#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})|(rgb|rgba|hsl|hsla|oklch)\([^)]{3,60}\))$/i.test(t)) return 'color';
  const lines = t.split('\n');
  if (lines.every((l) => /^(\/|[A-Za-z]:\\|~\/)[^\n]+$/.test(l.trim())) && lines.length <= 50 && !/\s{2,}/.test(t)) return 'file';
  // Code: several lines with indentation and symbols typical of programs, or one line that is clearly code.
  const codey = (l: string) => /[{};=<>()[\]]|^\s{2,}\S|=>|::|^\s*(import|export|const|let|var|def|class|function|return|if|for|while|public|private|#include|SELECT|FROM)\b/.test(l);
  const hits = lines.filter(codey).length;
  if ((lines.length >= 2 && hits / lines.length >= 0.5) || /^\s*(const|let|var|function|def|class|import|SELECT)\b.*[=({;:]/.test(t)) return 'code';
  return 'text';
}

export interface ClipFilter {
  q?: string;
  kind?: ClipKind;
  source?: string;
  collection?: string;
}

export class ClipHistory {
  items: ClipItem[] = [];
  constructor(public max = 50, public maxAgeDays = 0) {}

  /** Adds an item unless it repeats the newest one. Re-copying an old item moves it to the top and keeps its pin, note and lists. */
  add(item: Omit<ClipItem, 'id' | 'at'>, now = Date.now()): ClipItem | undefined {
    const key = item.text ?? item.image ?? '';
    if (!key.trim()) return undefined;
    const existing = this.items.findIndex((i) => (i.text ?? i.image) === key);
    if (existing === 0) return undefined;
    let keep: Partial<ClipItem> = {};
    if (existing > 0) {
      const old = this.items.splice(existing, 1)[0];
      keep = { pinned: old.pinned, note: old.note, collections: old.collections, ocr: old.ocr, title: old.title };
    }
    const it: ClipItem = { ...item, ...Object.fromEntries(Object.entries(keep).filter(([, v]) => v !== undefined)), id: `${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, at: now, pinned: !!keep.pinned };
    this.items.unshift(it);
    this.trim(now);
    return it;
  }

  /** Drops the oldest unpinned items beyond the limit, and unpinned items older than the retention period. */
  trim(now = Date.now()) {
    if (this.maxAgeDays > 0) {
      const cutoff = now - this.maxAgeDays * 86_400_000;
      this.items = this.items.filter((i) => i.pinned || (i.collections?.length ?? 0) > 0 || i.at >= cutoff);
    }
    while (this.items.length > this.max) {
      const idx = this.items.map((x) => !x.pinned && !(x.collections?.length)).lastIndexOf(true);
      if (idx < 0) break;
      this.items.splice(idx, 1);
    }
  }

  get(id: string): ClipItem | undefined {
    return this.items.find((i) => i.id === id);
  }

  update(id: string, patch: Partial<Pick<ClipItem, 'note' | 'ocr' | 'title' | 'collections'>>) {
    const it = this.get(id);
    if (it) Object.assign(it, patch);
  }

  togglePin(id: string) {
    const it = this.get(id);
    if (it) it.pinned = !it.pinned;
  }

  toggleCollection(id: string, name: string) {
    const it = this.get(id);
    const n = name.trim();
    if (!it || !n) return;
    const list = it.collections ?? [];
    it.collections = list.includes(n) ? list.filter((c) => c !== n) : [...list, n];
  }

  collections(): string[] {
    return [...new Set(this.items.flatMap((i) => i.collections ?? []))].sort();
  }

  sources(): string[] {
    return [...new Set(this.items.map((i) => i.source).filter((s): s is string => !!s))].sort();
  }

  /** Pinned items first, then newest; matches text, notes, page titles, text inside images and the source app. */
  search(f: ClipFilter = {}): ClipItem[] {
    const q = f.q?.trim().toLowerCase();
    return this.items
      .filter((i) => (!f.kind || i.kind === f.kind) && (!f.source || i.source === f.source) && (!f.collection || i.collections?.includes(f.collection)))
      .filter((i) => !q || [i.text, i.note, i.title, i.ocr, i.source].some((x) => x?.toLowerCase().includes(q)))
      .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.at - a.at);
  }

  remove(id: string) {
    this.items = this.items.filter((i) => i.id !== id);
  }

  clear() {
    this.items = this.items.filter((i) => i.pinned || (i.collections?.length ?? 0) > 0);
  }

  /** A backup the user can keep or move to another computer. */
  export(): string {
    return JSON.stringify({ format: 'keeper-clipboard', version: 1, items: this.items }, null, 2);
  }

  /** Merges a backup; items already present are skipped. Returns how many were added. */
  import(json: string): number {
    const data = JSON.parse(json) as { format?: string; items?: ClipItem[] };
    if (data.format !== 'keeper-clipboard' || !Array.isArray(data.items)) throw new Error('This is not a Keeper clipboard backup');
    const have = new Set(this.items.map((i) => i.text ?? i.image));
    let n = 0;
    for (const it of data.items) {
      if (!it || typeof it.id !== 'string' || have.has(it.text ?? it.image)) continue;
      this.items.push({ ...it, kind: it.kind ?? 'text' });
      n++;
    }
    this.items.sort((a, b) => b.at - a.at);
    this.trim();
    return n;
  }
}

/** Text that looks like a password or secret is not kept in the history. */
export function looksSecret(text: string): boolean {
  const t = text.trim();
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(t)) return true;
  if (/^(sk|pk|rk|ghp|gho|github_pat|xox[abpr]|AKIA|AIza)[-_A-Za-z0-9]{16,}$/.test(t)) return true;
  // One short "word" mixing upper, lower, digits and symbols: probably a password.
  return /^\S{10,64}$/.test(t) && /[a-z]/.test(t) && /[A-Z]/.test(t) && /\d/.test(t) && /[^A-Za-z0-9]/.test(t) && !/^https?:/.test(t);
}

// ---------------------------------------------------------------- focus timer

export interface FocusState {
  mode: 'focus' | 'break' | 'idle';
  /** epoch ms when the current block ends */
  endsAt: number;
  /** remaining ms while paused */
  pausedLeft?: number;
  focusMin: number;
  breakMin: number;
  rounds: number;
}

export function newFocus(focusMin = 25, breakMin = 5): FocusState {
  return { mode: 'idle', endsAt: 0, focusMin, breakMin, rounds: 0 };
}

export function startFocus(s: FocusState, minutes = s.focusMin, now = Date.now()): FocusState {
  return { ...s, mode: 'focus', focusMin: minutes, endsAt: now + minutes * 60_000, pausedLeft: undefined };
}

export function pauseFocus(s: FocusState, now = Date.now()): FocusState {
  if (s.mode === 'idle' || s.pausedLeft !== undefined) return s;
  return { ...s, pausedLeft: Math.max(0, s.endsAt - now) };
}

export function resumeFocus(s: FocusState, now = Date.now()): FocusState {
  if (s.pausedLeft === undefined) return s;
  return { ...s, endsAt: now + s.pausedLeft, pausedLeft: undefined };
}

/** Advances focus -> break -> idle when time runs out. Returns the event that happened, if any. */
export function tickFocus(s: FocusState, now = Date.now()): { state: FocusState; event?: 'focus-done' | 'break-done' } {
  if (s.mode === 'idle' || s.pausedLeft !== undefined || now < s.endsAt) return { state: s };
  if (s.mode === 'focus') return { state: { ...s, mode: 'break', endsAt: now + s.breakMin * 60_000, rounds: s.rounds + 1 }, event: 'focus-done' };
  return { state: { ...s, mode: 'idle', endsAt: 0 }, event: 'break-done' };
}

export function focusLeft(s: FocusState, now = Date.now()): number {
  if (s.mode === 'idle') return 0;
  return s.pausedLeft ?? Math.max(0, s.endsAt - now);
}
