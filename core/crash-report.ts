// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Crash and error reports for Ashforde: opt-in (off by default) and anonymous.
// A report says which Keeper and which system, which process, the error's
// name and where in Keeper's code it happened: the stack's function names,
// file names and line numbers, with every folder, user name, address and the
// error's message left out. Reports wait in a small queue and go out together.
// The server (server/telemetry, POST /v1/crash) checks them against this same
// schema and refuses anything else.

import { coarseOsVersion, osFamily, OS_FAMILIES } from './telemetry';

export const CRASH_ENDPOINT = 'https://telemetry.ashforde.org/v1/crash';
export const CRASH_FORMAT = 1;
export const CRASH_MAX_BODY = 24 * 1024;
export const MAX_REPORTS = 20;
export const MAX_FRAMES = 12;
/** Reports that could not be sent are dropped after a week. */
export const MAX_AGE_DAYS = 7;

export const PROCESSES = ['main', 'window', 'island', 'widgets', 'mail', 'gpu', 'utility', 'other'] as const;
export const KINDS = ['exception', 'rejection', 'window-error', 'window-crash', 'process-crash', 'unexpected-exit'] as const;
export type CrashProcess = (typeof PROCESSES)[number];
export type CrashKind = (typeof KINDS)[number];

export interface CrashReport {
  version: string;
  channel: 'stable' | 'prerelease';
  os: (typeof OS_FAMILIES)[number];
  osVersion: string;
  arch: 'x64' | 'arm64' | 'ia32' | 'arm' | 'other';
  process: CrashProcess;
  kind: CrashKind;
  /** the error's class name (TypeError), or what stopped (WindowOutOfMemory) */
  name: string;
  /** "at functionName (file.js:12:34)", folders and everything personal removed */
  stack: string[];
  /** how many times it happened between sends */
  count: number;
  /** yyyy-mm-dd (UTC) */
  first: string;
  last: string;
}

export interface CrashBody {
  v: 1;
  reports: CrashReport[];
}

export const NEVER_SENT_CRASH = [
  'The error’s message (it can contain names, paths or text you typed)',
  'Folder paths, file names of your own, user names and the computer’s name',
  'Web addresses, internet addresses, e-mail addresses',
  'An install ID or anything else that could tell reports from one computer apart',
  'What you were doing, your files, searches or settings',
];

// ---------------------------------------------------------------- scrubbing

const NAME = /^[A-Za-z][A-Za-z0-9_]{0,47}$/;
/** A frame as it may be sent: a function name (letters, digits, _ $ . < > [ ] and spaces) and a bare file name with line and column. */
const FRAME = /^at (?:[A-Za-z0-9_$.<>[\] ]{1,120} \()?[A-Za-z0-9_.-]{1,80}:\d{1,7}:\d{1,7}\)?$|^at (?:[A-Za-z0-9_$.<>[\] ]{1,120} \()?(?:native|<anonymous>)\)?$/;

/** The error's class name from an Error or from "TypeError: message" text; never the message. */
export function errorName(e: unknown): string {
  const n = e instanceof Error ? e.name : typeof e === 'string' ? (/^([A-Za-z][A-Za-z0-9_]*)(?::|$)/.exec(e.trim())?.[1] ?? 'Error') : e && typeof e === 'object' && 'name' in e ? String((e as { name: unknown }).name) : 'NonError';
  return NAME.test(n) ? n : 'Error';
}

/**
 * Stack frames with nothing personal: only "at fn (file.js:line:col)". Every
 * folder is cut to the file's name, web addresses to their file, and a frame
 * that still holds anything else (an e-mail, a user name, odd characters) is dropped.
 */
export function scrubStack(stack: string | undefined, personal: string[] = []): string[] {
  if (!stack) return [];
  const words = personal.map((w) => w.trim()).filter((w) => w.length >= 3);
  const out: string[] = [];
  for (const raw of stack.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('at ')) continue;
    const m = /^at (?:async )?(?:(.*?) \()?(.*?)\)?$/.exec(line);
    if (!m) continue;
    let fn = (m[1] ?? '').replace(/^new /, '').replace(/\s+/g, ' ').trim();
    const where = m[2] ?? '';
    let loc: string;
    if (where === 'native' || where === '<anonymous>') loc = where;
    else {
      const lc = /:(\d+):(\d+)$/.exec(where);
      if (!lc) continue;
      const file = where.slice(0, lc.index).replace(/[?#].*$/, '').split(/[\\/]/).filter(Boolean).pop() ?? '';
      if (!/^[A-Za-z0-9_.-]{1,80}$/.test(file)) continue;
      loc = `${file}:${lc[1]}:${lc[2]}`;
    }
    if (fn && !/^[A-Za-z0-9_$.<>[\] ]{1,120}$/.test(fn)) fn = '<anonymous>';
    const frame = fn ? `at ${fn} (${loc})` : `at ${loc}`;
    if (words.some((w) => frame.toLowerCase().includes(w.toLowerCase()))) continue;
    if (/@|\b\d{1,3}(\.\d{1,3}){3}\b/.test(frame)) continue;
    if (FRAME.test(frame)) out.push(frame);
    if (out.length >= MAX_FRAMES) break;
  }
  return out;
}

export function archOf(a: string): CrashReport['arch'] {
  return a === 'x64' || a === 'arm64' || a === 'ia32' || a === 'arm' ? a : 'other';
}

export function makeReport(o: { version: string; prerelease: boolean; platform: string; osRelease: string; arch: string; process: CrashProcess; kind: CrashKind; name: string; stack?: string; personal?: string[]; now?: number }): CrashReport {
  const day = new Date(o.now ?? Date.now()).toISOString().slice(0, 10);
  return {
    version: /^\d+\.\d+\.\d+(-[0-9A-Za-z.]{1,20})?$/.test(o.version) ? o.version : '0.0.0',
    channel: o.prerelease ? 'prerelease' : 'stable',
    os: osFamily(o.platform),
    osVersion: coarseOsVersion(o.platform, o.osRelease),
    arch: archOf(o.arch),
    process: (PROCESSES as readonly string[]).includes(o.process) ? o.process : 'other',
    kind: o.kind,
    name: NAME.test(o.name) ? o.name : 'Error',
    stack: scrubStack(o.stack, o.personal),
    count: 1,
    first: day,
    last: day,
  };
}

/** The same problem again: same process, kind, name and first frames. */
export const signature = (r: Pick<CrashReport, 'process' | 'kind' | 'name' | 'stack' | 'version'>) => `${r.version}|${r.process}|${r.kind}|${r.name}|${r.stack.slice(0, 5).join('|')}`;

/** Adds a report to the queue: the same one again only counts up; at most 50 kept; older than a week dropped. */
export function enqueue(queue: CrashReport[], r: CrashReport, now = Date.now()): CrashReport[] {
  const cutoff = new Date(now - MAX_AGE_DAYS * 86_400_000).toISOString().slice(0, 10);
  const q = queue.filter((x) => x.last >= cutoff).map((x) => ({ ...x }));
  const same = q.find((x) => signature(x) === signature(r));
  if (same) {
    same.count = Math.min(9999, same.count + r.count);
    same.last = r.last > same.last ? r.last : same.last;
    return q;
  }
  return [...q, r].slice(-50);
}

/** The next request: at most MAX_REPORTS reports, the most frequent first. */
export function nextBatch(queue: CrashReport[]): { body: CrashBody; rest: CrashReport[] } {
  const sorted = [...queue].sort((a, b) => b.count - a.count);
  const take = sorted.slice(0, MAX_REPORTS);
  return { body: { v: CRASH_FORMAT, reports: take }, rest: queue.filter((x) => !take.includes(x)) };
}

// ---------------------------------------------------------------- the one check (app and server)

const KEYS: (keyof CrashReport)[] = ['version', 'channel', 'os', 'osVersion', 'arch', 'process', 'kind', 'name', 'stack', 'count', 'first', 'last'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Exactly the fields above, each in its allowed form; anything else is refused. */
export function validateCrashBody(x: unknown): { ok: true; body: CrashBody } | { ok: false; error: string } {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return { ok: false, error: 'Not an object' };
  const b = x as Record<string, unknown>;
  const extra = Object.keys(b).filter((k) => k !== 'v' && k !== 'reports');
  if (extra.length) return { ok: false, error: `Unknown field ${extra[0]}` };
  if (b.v !== CRASH_FORMAT) return { ok: false, error: 'Unknown format' };
  if (!Array.isArray(b.reports) || !b.reports.length || b.reports.length > MAX_REPORTS) return { ok: false, error: 'reports must hold 1 to 20 reports' };
  for (const [i, r] of (b.reports as unknown[]).entries()) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) return { ok: false, error: `reports[${i}] is not an object` };
    const o = r as Record<string, unknown>;
    const keys = Object.keys(o);
    const unknown = keys.find((k) => !KEYS.includes(k as keyof CrashReport));
    if (unknown) return { ok: false, error: `reports[${i}].${unknown} is not allowed` };
    const missing = KEYS.find((k) => !(k in o));
    if (missing) return { ok: false, error: `reports[${i}].${missing} is missing` };
    const bad = (k: string) => ({ ok: false as const, error: `reports[${i}].${k} is not valid` });
    if (typeof o.version !== 'string' || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.]{1,20})?$/.test(o.version)) return bad('version');
    if (o.channel !== 'stable' && o.channel !== 'prerelease') return bad('channel');
    if (!(OS_FAMILIES as readonly unknown[]).includes(o.os)) return bad('os');
    if (typeof o.osVersion !== 'string' || !/^\d{1,3}(\.\d{1,3})?$/.test(o.osVersion)) return bad('osVersion');
    if (!['x64', 'arm64', 'ia32', 'arm', 'other'].includes(o.arch as string)) return bad('arch');
    if (!(PROCESSES as readonly unknown[]).includes(o.process)) return bad('process');
    if (!(KINDS as readonly unknown[]).includes(o.kind)) return bad('kind');
    if (typeof o.name !== 'string' || !NAME.test(o.name)) return bad('name');
    if (!Array.isArray(o.stack) || o.stack.length > MAX_FRAMES || o.stack.some((f) => typeof f !== 'string' || f.length > 220 || !FRAME.test(f) || /@|\b\d{1,3}(\.\d{1,3}){3}\b/.test(f))) return bad('stack');
    if (!Number.isInteger(o.count) || (o.count as number) < 1 || (o.count as number) > 9999) return bad('count');
    if (typeof o.first !== 'string' || !DAY.test(o.first) || typeof o.last !== 'string' || !DAY.test(o.last) || o.first > o.last) return bad('first');
  }
  return { ok: true, body: b as unknown as CrashBody };
}

/** What the "See what's sent" view explains, per field. */
export const CRASH_FIELDS: { key: keyof CrashReport; about: string }[] = [
  { key: 'version', about: 'Keeper’s version' },
  { key: 'channel', about: 'Stable release or test release' },
  { key: 'os', about: 'Operating system' },
  { key: 'osVersion', about: 'Its main version number' },
  { key: 'arch', about: 'Processor type' },
  { key: 'process', about: 'Which part of Keeper (the app, a window, the Island, Mail…)' },
  { key: 'kind', about: 'An error, a window that stopped, or Keeper stopping' },
  { key: 'name', about: 'The kind of error (TypeError), never its message' },
  { key: 'stack', about: 'Where in Keeper’s code: function, file name and line only' },
  { key: 'count', about: 'How many times since the last send' },
  { key: 'first', about: 'The first day it happened' },
  { key: 'last', about: 'The last day it happened' },
];
