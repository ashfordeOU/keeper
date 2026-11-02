// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper as a suite: one install, one version, one Settings, and several parts
// that each run in a process of their own, so one stopping never takes the
// others with it (docs/SUITE.md). This file holds what does not need Electron:
// the list of parts, the rules for starting, stopping and restarting them (a
// small state machine), and the framing of messages between Keeper's processes.

/**
 * A part runs as Keeper's own program started with `--keeper-role=<role>`: the
 * Island and widgets own windows; Mail and calendars has none (its sync, send-later,
 * snooze and alert timers keep running while the app is away).
 */
export type PartRole = 'island' | 'widgets' | 'mail';

export interface PartDef {
  role: PartRole;
  name: string;
  description: string;
  /** the feature in core/features.ts that switches it on and off */
  feature: string;
  /** every feature it serves: it runs while any of them is on, and its switch turns them all */
  features: string[];
}

export const PARTS: PartDef[] = [
  { role: 'island', name: 'Island', description: 'The Island and the clipboard picker, in a process of their own: they stay on screen if Keeper’s main window stops.', feature: 'island', features: ['island'] },
  { role: 'widgets', name: 'Desktop widgets', description: 'Each widget on the desktop, in a process of their own: they stay if Keeper’s main window stops.', feature: 'widgets', features: ['widgets'] },
  { role: 'mail', name: 'Mail and calendars', description: 'Mail, calendars, reminders and alarms, in a process of their own: new mail, send later, snoozes and alerts carry on if Keeper’s main window stops.', feature: 'mail', features: ['mail', 'calendars', 'alarms'] },
];

export const PART_ROLES: readonly PartRole[] = PARTS.map((p) => p.role);
export const isPartRole = (r: unknown): r is PartRole => typeof r === 'string' && (PART_ROLES as readonly string[]).includes(r);
export const partDef = (role: PartRole) => PARTS.find((p) => p.role === role)!;

export const ROLE_FLAG = '--keeper-role=';

/**
 * Do the parts run in processes of their own? The person's choice when they made one;
 * otherwise yes, except in the Minimal resource mode, where one process is lighter
 * (each part's own process costs about 30–35 MB).
 */
export function separateByDefault(s: { suiteSeparate?: boolean; resourceMode?: string }): boolean {
  return s.suiteSeparate ?? s.resourceMode !== 'minimal';
}

/** The role this process was started for ('app' for Keeper itself, with or without `--keeper-role=app`). */
export function roleOf(argv: readonly string[]): PartRole | 'app' {
  const a = argv.find((x) => x.startsWith(ROLE_FLAG));
  const r = a?.slice(ROLE_FLAG.length);
  return isPartRole(r) ? r : 'app';
}

/** Exit code of a part that found another copy of itself already running. */
export const EXIT_ALREADY_RUNNING = 3;

// ---------------------------------------------------------------- the supervisor's rules

export type PartState = 'off' | 'starting' | 'running' | 'stopping' | 'waiting' | 'failed';

export interface RestartPolicy {
  /** waits before each restart after a crash, in order (the last one repeats) */
  backoffMs: number[];
  /** more crashes than this within `windowMs` and the part stays stopped until restarted by hand */
  maxCrashes: number;
  windowMs: number;
  /** a part that ran this long without stopping starts the backoff from the beginning again */
  stableMs: number;
  /** a part that does not say hello in this long after starting is stopped and counted as a crash */
  startTimeoutMs: number;
}

export const DEFAULT_POLICY: RestartPolicy = {
  backoffMs: [500, 2000, 5000, 15_000, 30_000],
  maxCrashes: 5,
  windowMs: 10 * 60_000,
  stableMs: 2 * 60_000,
  startTimeoutMs: 30_000,
};

export interface PartStatus {
  state: PartState;
  /** the person (or the feature switch) wants it running */
  wanted: boolean;
  pid?: number;
  startedAt?: number;
  /** restarts after crashes since Keeper started */
  restarts: number;
  crashes: number[];
  lastCrash?: { at: number; reason: string };
  /** when a waiting part starts again */
  retryAt?: number;
}

/** What the supervisor should do next. */
export type PartAction =
  | { do: 'spawn' }
  | { do: 'stop' }
  | { do: 'schedule'; inMs: number }
  | { do: 'none' };

export type PartEvent =
  | { type: 'want'; on: boolean }
  | { type: 'spawned'; pid: number }
  | { type: 'hello'; pid: number }
  | { type: 'exited'; reason: string; expected?: boolean }
  | { type: 'timer' }
  | { type: 'restart' }
  | { type: 'startTimeout' };

export function initialStatus(): PartStatus {
  return { state: 'off', wanted: false, restarts: 0, crashes: [] };
}

/**
 * The state machine for one part. Pure: it takes the status, an event and the time,
 * and returns the next status and the one thing to do. The supervisor does the doing.
 *
 *   off ──want──▶ starting ──hello──▶ running
 *    ▲               │ exited             │ exited (crash)
 *    │               ▼                    ▼
 *    └──want off── waiting ◀──────────────┘  (backoff, then starting again)
 *                    │ too many crashes
 *                    ▼
 *                  failed ──restart (by hand)──▶ starting
 */
export function step(s: PartStatus, e: PartEvent, now: number, policy: RestartPolicy = DEFAULT_POLICY): { status: PartStatus; action: PartAction } {
  const next: PartStatus = { ...s, crashes: s.crashes.filter((t) => now - t < policy.windowMs) };
  const none = { status: next, action: { do: 'none' } as PartAction };
  switch (e.type) {
    case 'want': {
      next.wanted = e.on;
      if (e.on) {
        if (next.state === 'off' || next.state === 'stopping') return { status: { ...next, state: 'starting', retryAt: undefined }, action: { do: 'spawn' } };
        // Switched on again by the person: a part given up on gets another chance.
        if (next.state === 'failed') return { status: { ...next, state: 'starting', crashes: [], retryAt: undefined }, action: { do: 'spawn' } };
        return none;
      }
      if (next.state === 'starting' || next.state === 'running') return { status: { ...next, state: 'stopping', retryAt: undefined }, action: { do: 'stop' } };
      if (next.state === 'waiting' || next.state === 'failed') return { status: { ...next, state: 'off', retryAt: undefined, pid: undefined }, action: { do: 'none' } };
      return none;
    }
    case 'spawned':
      return { status: { ...next, pid: e.pid }, action: { do: 'none' } };
    case 'hello':
      if (!next.wanted) return { status: { ...next, state: 'stopping', pid: e.pid }, action: { do: 'stop' } };
      return { status: { ...next, state: 'running', pid: e.pid, startedAt: next.state === 'running' && next.pid === e.pid ? next.startedAt : now }, action: { do: 'none' } };
    case 'startTimeout':
      if (next.state !== 'starting') return none;
      return { status: { ...next, state: 'stopping' }, action: { do: 'stop' } };
    case 'exited': {
      const was = next.state;
      const ranFor = next.startedAt ? now - next.startedAt : 0;
      next.pid = undefined;
      next.startedAt = undefined;
      // Stopped because it was asked to, or no longer wanted: done.
      if (e.expected || !next.wanted || was === 'off') {
        if (!next.wanted) return { status: { ...next, state: 'off' }, action: { do: 'none' } };
        // Restart asked for by hand: straight back up.
        return { status: { ...next, state: 'starting' }, action: { do: 'spawn' } };
      }
      // A crash: counted, then started again after a wait that grows with each crash in a row.
      if (ranFor >= policy.stableMs) next.crashes = [];
      next.crashes = [...next.crashes, now];
      next.lastCrash = { at: now, reason: e.reason };
      if (next.crashes.length > policy.maxCrashes) return { status: { ...next, state: 'failed', retryAt: undefined }, action: { do: 'none' } };
      const wait = policy.backoffMs[Math.min(next.crashes.length - 1, policy.backoffMs.length - 1)];
      return { status: { ...next, state: 'waiting', retryAt: now + wait }, action: { do: 'schedule', inMs: wait } };
    }
    case 'timer':
      if (next.state !== 'waiting' || !next.wanted) return none;
      if (next.retryAt && now < next.retryAt) return { status: next, action: { do: 'schedule', inMs: next.retryAt - now } };
      return { status: { ...next, state: 'starting', retryAt: undefined, restarts: next.restarts + 1 }, action: { do: 'spawn' } };
    case 'restart':
      if (!next.wanted) return none;
      if (next.state === 'running' || next.state === 'starting') return { status: { ...next, state: 'stopping' }, action: { do: 'stop' } };
      // Restart from the suite page: a failed or waiting part starts now, its crash count forgiven.
      return { status: { ...next, state: 'starting', crashes: [], retryAt: undefined, restarts: next.restarts + 1 }, action: { do: 'spawn' } };
  }
  return none;
}

/** A restart asked for by hand: the exit that follows the stop is not a crash and the part comes straight back. */
export function restartExit(s: PartStatus): PartEvent {
  return { type: 'exited', reason: 'restarted', expected: s.wanted };
}

// ---------------------------------------------------------------- messages between processes

/**
 * Every message is a 4-byte big-endian length and then the message itself
 * (v8-serialized by the processes, so Buffers, typed arrays, Maps and Dates
 * arrive as they were sent). The first message from a part must be `hello`
 * with the token of this run of Keeper; anything else closes the connection.
 */
export type SuiteMessage =
  | { t: 'hello'; role: PartRole; token: string; pid: number; version: string }
  | { t: 'welcome'; settings: unknown; channels: string[]; sends: string[] }
  | { t: 'denied'; reason: string }
  /**
   * a part asks the app to run one of its IPC handlers (`sender` names the part's window);
   * channels that start with `suite:` are the app's answers for parts only, never a window's
   */
  | { t: 'call'; id: number; channel: string; args: unknown[]; sender?: SenderInfo }
  | { t: 'result'; id: number; ok: true; value: unknown }
  | { t: 'result'; id: number; ok: false; error: string }
  /** fire-and-forget IPC (ipcRenderer.send) from a part's window */
  | { t: 'send'; channel: string; args: unknown[]; sender?: SenderInfo }
  /** an event for the windows: to every one of a part's windows, or to one (`to`) */
  | { t: 'event'; channel: string; args: unknown[]; to?: number }
  /** the app tells a part to do something (open the Island on a tab, close, report memory…) */
  | { t: 'cmd'; id: number; name: string; args: unknown[] }
  | { t: 'channels'; channels: string[]; sends: string[] }
  /** a part tells the app something, no answer (Mail's new-mail alert for the Island…) */
  | { t: 'note'; name: string; args: unknown[] }
  | { t: 'ping' }
  | { t: 'pong' };

export interface SenderInfo { id: number; url: string }

export const MAX_FRAME = 64 * 1024 * 1024;

/** Splits a byte stream into frames; returns the frames and what is left over. */
export function splitFrames(buf: Uint8Array): { frames: Uint8Array[]; rest: Uint8Array } {
  const frames: Uint8Array[] = [];
  let at = 0;
  while (buf.length - at >= 4) {
    const len = ((buf[at] << 24) >>> 0) + (buf[at + 1] << 16) + (buf[at + 2] << 8) + buf[at + 3];
    if (len > MAX_FRAME) throw new Error(`message too large (${len} bytes)`);
    if (buf.length - at - 4 < len) break;
    frames.push(buf.subarray(at + 4, at + 4 + len));
    at += 4 + len;
  }
  return { frames, rest: buf.subarray(at) };
}

export function frame(body: Uint8Array): Uint8Array {
  if (body.length > MAX_FRAME) throw new Error(`message too large (${body.length} bytes)`);
  const out = new Uint8Array(body.length + 4);
  out[0] = (body.length >>> 24) & 0xff;
  out[1] = (body.length >>> 16) & 0xff;
  out[2] = (body.length >>> 8) & 0xff;
  out[3] = body.length & 0xff;
  out.set(body, 4);
  return out;
}

/** Same length and same bytes, in a time that does not depend on where they differ. */
export function tokenMatches(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** Is this a well-formed first message from a part? */
export function validHello(m: unknown): m is Extract<SuiteMessage, { t: 'hello' }> {
  const h = m as Record<string, unknown> | null;
  return !!h && h.t === 'hello' && isPartRole(h.role) && typeof h.token === 'string' && typeof h.pid === 'number';
}

/**
 * How long a part keeps running without the app before it closes too: long
 * enough for the watchdog to start a crashed Keeper again (a few seconds, up to
 * about 15 on a Mac while the crash report is written), short enough that a
 * Keeper that was quit for good does not leave an Island behind.
 */
export const ORPHAN_GRACE_MS = 90_000;
