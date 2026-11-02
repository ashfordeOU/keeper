// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// agent-desktop (Apache-2.0, https://github.com/vercel-labs/agent-desktop): a
// small program that reads and operates other apps through the system's
// accessibility tree (AX on macOS, UI Automation on Windows, AT-SPI on Linux).
// Keeper ships it (scripts/fetch-agent-desktop.mjs) and the computer-use tools
// use it first to list the controls in the front window and press or fill one;
// computer-os.ts falls back to its own system scripts when it is missing, says
// no, or is too slow.
//
// Every call prints one JSON envelope: { version, ok, command, data | error }.
// A snapshot gives refs (@<snapshot id>:e<N>) for the elements that can be
// acted on; a ref belongs to its snapshot and goes stale when the app changes
// (STALE_REF, AMBIGUOUS_TARGET, SNAPSHOT_NOT_FOUND). Keeper takes one fresh
// snapshot and tries again, once, and only when the error says nothing was sent.
//
// Ref actions stay "headless" (accessibility calls, no pointer, no focus
// change): Keeper never passes --headed. When an element has no such action,
// the caller clicks its centre with Keeper's own pointer, as it always did.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, chmodSync } from 'node:fs';
import path from 'node:path';
import type { UiNode } from '../../core/computer';

export const ENVELOPE_VERSION = '2.5';

export interface AdDisposition {
  delivery?: 'unknown' | 'not_delivered' | 'delivery_uncertain' | 'delivered_unverified' | 'delivered_verified' | string;
  retry?: 'unknown' | 'safe' | 'unsafe' | string;
}

export interface AdErrorBody {
  code: string;
  message: string;
  suggestion?: string;
  disposition?: AdDisposition;
  details?: unknown;
}

export interface AdEnvelope<T = unknown> {
  version: string;
  ok: boolean;
  command: string;
  data?: T;
  error?: AdErrorBody;
}

export interface AdRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One element of a snapshot, as agent-desktop prints it. */
export interface AdNode {
  ref_id?: string;
  role: string;
  name?: string;
  value?: string;
  description?: string;
  states?: string[];
  available_actions?: string[];
  bounds?: AdRect;
  children_count?: number;
  subtree_truncated?: boolean;
  children?: AdNode[];
}

export interface AdSnapshot {
  app?: string;
  window?: { id?: string; title?: string };
  snapshot_id: string;
  ref_count?: number;
  complete?: boolean;
  tree: AdNode;
}

/** agent-desktop answered with an error envelope (or not at all). */
export class AgentDesktopError extends Error {
  constructor(
    message: string,
    readonly code: string,
    /** what agent-desktop knows about whether the action reached the app */
    readonly disposition: AdDisposition = {},
  ) {
    super(message);
  }
  /** Nothing was sent: trying again, or another way, cannot do the action twice. */
  get safe(): boolean {
    return this.disposition.retry === 'safe' || this.disposition.delivery === 'not_delivered';
  }
}

/** A press or write that may have reached the app although it reported a failure: never repeat it blindly. */
export class MaybeDelivered extends Error {}

/** The one JSON envelope a call prints; throws when stdout is not one. */
export function parseEnvelope<T = unknown>(stdout: string): AdEnvelope<T> {
  const text = stdout.trim();
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    // Some builds log a line before the envelope: take the last line that parses.
    const line = text.split('\n').reverse().find((l) => l.trim().startsWith('{'));
    if (!line) throw new AgentDesktopError('agent-desktop printed no answer', 'NO_ENVELOPE');
    try {
      v = JSON.parse(line);
    } catch {
      throw new AgentDesktopError('agent-desktop printed something that is not JSON', 'NO_ENVELOPE');
    }
  }
  const e = v as AdEnvelope<T>;
  if (!e || typeof e !== 'object' || typeof e.ok !== 'boolean' || typeof e.command !== 'string') throw new AgentDesktopError('agent-desktop printed an unexpected answer', 'NO_ENVELOPE');
  if (!e.ok && (!e.error || typeof e.error.code !== 'string')) throw new AgentDesktopError('agent-desktop failed without saying why', 'NO_ENVELOPE');
  return e;
}

/** The data of a successful envelope; an AgentDesktopError for an error one. */
export function unwrap<T>(e: AdEnvelope<T>): T {
  if (e.ok) return e.data as T;
  const er = e.error!;
  throw new AgentDesktopError(er.message || er.code, er.code, er.disposition ?? {});
}

// ---------------------------------------------------------------- tree → Keeper's UiNode

export interface MappedTree {
  root: UiNode;
  /** Keeper id (w0/1/2) → agent-desktop ref */
  refs: Map<string, string>;
  snapshotId: string;
  complete: boolean;
}

/**
 * agent-desktop's tree in Keeper's shape. Ids stay Keeper's path ids (w0/2/1),
 * so the tools and what the AI sees do not change with the engine; the refs
 * are kept beside them. Bounds are screen coordinates, like the built-in engine's.
 */
export function mapSnapshot(s: AdSnapshot, maxNodes = 2000): MappedTree {
  const refs = new Map<string, string>();
  let count = 0;
  const walk = (n: AdNode, id: string): UiNode | null => {
    if (count++ >= maxNodes) return null;
    const out: UiNode = { id, role: n.role || 'unknown' };
    const name = n.name?.trim() || n.description?.trim();
    if (name) out.name = name;
    if (typeof n.value === 'string' && n.value !== '' && !n.states?.includes('secure')) out.value = n.value;
    if (n.bounds && Number.isFinite(n.bounds.x) && Number.isFinite(n.bounds.y) && n.bounds.width > 0 && n.bounds.height > 0) {
      out.x = n.bounds.x;
      out.y = n.bounds.y;
      out.width = n.bounds.width;
      out.height = n.bounds.height;
    }
    out.enabled = !n.states?.includes('disabled');
    if (n.ref_id) {
      out.actionable = true;
      refs.set(id, n.ref_id);
    }
    if (n.children?.length) {
      out.children = [];
      n.children.forEach((c, i) => {
        const m = walk(c, `${id}/${i}`);
        if (m) out.children!.push(m);
      });
    }
    return out;
  };
  const root = walk(s.tree, 'w0') ?? { id: 'w0', role: 'window' };
  return { root, refs, snapshotId: s.snapshot_id, complete: s.complete !== false };
}

/** The node in a fresh tree that is the same control as `old`: same role and label, nearest to the same place. */
export function counterpart(fresh: MappedTree, old: UiNode): string | undefined {
  const all: UiNode[] = [];
  const walk = (n: UiNode) => {
    if (fresh.refs.has(n.id) && n.role === old.role && (n.name ?? '') === (old.name ?? '')) all.push(n);
    for (const c of n.children ?? []) walk(c);
  };
  walk(fresh.root);
  const same = all.find((n) => n.id === old.id);
  if (same) return fresh.refs.get(same.id);
  if (all.length === 1) return fresh.refs.get(all[0].id);
  // Several alike (rows of one list): only the one at the same place will do.
  const at = all.filter((n) => old.x !== undefined && n.x !== undefined && Math.abs(n.x - old.x) <= 2 && Math.abs((n.y ?? 0) - (old.y ?? 0)) <= 2);
  return at.length === 1 ? fresh.refs.get(at[0].id) : undefined;
}

// ---------------------------------------------------------------- the program

/** Where agent-desktop is: bundled with Keeper, a development copy, or KEEPER_AGENT_DESKTOP. Never one from PATH (its output may differ). */
export function findAgentDesktop(o: { resourcesPath?: string; appPath?: string; env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform } = {}): string | null {
  const exe = (o.platform ?? process.platform) === 'win32' ? 'agent-desktop.exe' : 'agent-desktop';
  const env = o.env ?? process.env;
  const candidates = [
    env.KEEPER_AGENT_DESKTOP,
    o.resourcesPath && path.join(o.resourcesPath, 'agent-desktop', exe),
    o.appPath && path.join(o.appPath, 'vendor', 'agent-desktop', 'current', exe),
  ].filter((p): p is string => !!p);
  return candidates.find((c) => existsSync(c)) ?? null;
}

export type Runner = (bin: string, args: string[], o: { timeoutMs: number; env: NodeJS.ProcessEnv }) => Promise<{ stdout: string; code: number | null; timedOut: boolean }>;

/** Starts the program with a deadline; its output is capped (a snapshot of a huge window stays well under it). */
export const spawnRunner: Runner = (bin, args, o) =>
  new Promise((resolve) => {
    const child = spawn(bin, args, { env: o.env, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    const chunks: Buffer[] = [];
    let size = 0;
    let timedOut = false;
    const t = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, o.timeoutMs);
    child.stdout.on('data', (d: Buffer) => {
      size += d.length;
      if (size <= 48 * 1024 * 1024) chunks.push(d);
      else child.kill('SIGKILL');
    });
    child.on('error', () => {
      clearTimeout(t);
      resolve({ stdout: '', code: null, timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(t);
      resolve({ stdout: Buffer.concat(chunks).toString('utf8'), code, timedOut });
    });
  });

export interface AgentDesktopOptions {
  bin: string;
  /** its own state folder (snapshots and refs), private to this person: AGENT_DESKTOP_HOME */
  home?: string;
  run?: Runner;
  env?: NodeJS.ProcessEnv;
}

/** Arguments for one ref action. Options first, then `--`, so a value that starts with "-" is never read as a flag. */
export function actionArgs(kind: 'click' | 'set-value' | 'type' | 'scroll', ref: string, o: { text?: string; direction?: 'up' | 'down' | 'left' | 'right'; amount?: number; timeoutMs?: number } = {}): string[] {
  if (!/^@[A-Za-z0-9]+:e\d+$/.test(ref)) throw new AgentDesktopError(`Not an agent-desktop ref: ${ref}`, 'INVALID_ARGS', { delivery: 'not_delivered', retry: 'safe' });
  const t = ['--timeout-ms', String(Math.round(o.timeoutMs ?? 5000))];
  switch (kind) {
    case 'click': return ['click', ...t, '--', ref];
    case 'set-value': return ['set-value', ...t, '--', ref, o.text ?? ''];
    case 'type': return ['type', ...t, '--', ref, o.text ?? ''];
    case 'scroll': return ['scroll', ...t, '--direction', o.direction ?? 'down', '--amount', String(Math.max(1, Math.min(30, Math.round(o.amount ?? 3)))), '--', ref];
  }
}

const STALE = new Set(['STALE_REF', 'AMBIGUOUS_TARGET', 'SNAPSHOT_NOT_FOUND']);

export class AgentDesktop {
  private readonly run: Runner;
  private homeReady = false;

  constructor(private readonly o: AgentDesktopOptions) {
    this.run = o.run ?? spawnRunner;
  }

  private env(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...(this.o.env ?? process.env) };
    // Its own state, apart from any agent-desktop the person uses in a terminal. It must be private (0700).
    if (this.o.home) {
      if (!this.homeReady) {
        mkdirSync(this.o.home, { recursive: true, mode: 0o700 });
        if (process.platform !== 'win32') chmodSync(this.o.home, 0o700);
        this.homeReady = true;
      }
      env.AGENT_DESKTOP_HOME = this.o.home;
    }
    // Never the session or agent of a terminal Keeper was started from.
    delete env.AGENT_DESKTOP_SESSION;
    delete env.AGENT_DESKTOP_AGENT_ID;
    return env;
  }

  /** One call: its envelope, or an AgentDesktopError (TIMEOUT, NOT_STARTED, NO_ENVELOPE or agent-desktop's own code). */
  async call<T>(args: string[], timeoutMs: number): Promise<T> {
    const r = await this.run(this.o.bin, args, { timeoutMs, env: this.env() });
    // A timed-out action may still have happened: its delivery is unknown.
    if (r.timedOut) throw new AgentDesktopError(`agent-desktop took longer than ${Math.round(timeoutMs / 1000)} s`, 'TIMEOUT', { delivery: 'unknown', retry: 'unknown' });
    if (r.code === null && !r.stdout) throw new AgentDesktopError('agent-desktop could not be started', 'NOT_STARTED', { delivery: 'not_delivered', retry: 'safe' });
    return unwrap(parseEnvelope<T>(r.stdout));
  }

  async version(): Promise<string> {
    return (await this.call<{ version: string }>(['version'], 5000)).version;
  }

  /** The front window's controls (the focused app), with bounds. */
  async snapshot(o: { maxDepth?: number; timeoutMs?: number; interactiveOnly?: boolean } = {}): Promise<MappedTree> {
    const budget = Math.max(500, Math.min(30_000, o.timeoutMs ?? 4000));
    const args = ['snapshot', '--compact', '--include-bounds', '--max-depth', String(Math.max(1, Math.min(30, o.maxDepth ?? 10))), '--timeout-ms', String(budget)];
    if (o.interactiveOnly) args.push('-i');
    const s = await this.call<AdSnapshot>(args, budget + 4000);
    if (!s || typeof s.snapshot_id !== 'string' || !s.tree) throw new AgentDesktopError('agent-desktop returned no tree', 'NO_ENVELOPE');
    return mapSnapshot(s);
  }

  /**
   * One ref action. A stale ref is re-found once in a fresh snapshot (same role, label and place)
   * and tried again, only when agent-desktop says nothing was sent. Returns the fresh tree when it took one.
   */
  async act(kind: 'click' | 'set-value' | 'type' | 'scroll', ref: string, node: UiNode | undefined, o: { text?: string; direction?: 'up' | 'down' | 'left' | 'right'; amount?: number; maxDepth?: number } = {}): Promise<{ fresh?: MappedTree }> {
    const timeoutMs = kind === 'type' ? 5000 + 30 * (o.text?.length ?? 0) : 5000;
    try {
      await this.call(actionArgs(kind, ref, { ...o, timeoutMs }), timeoutMs + 4000);
      return {};
    } catch (e) {
      if (!(e instanceof AgentDesktopError) || !STALE.has(e.code) || !e.safe || !node) throw e;
    }
    const fresh = await this.snapshot({ maxDepth: o.maxDepth });
    const again = counterpart(fresh, node);
    if (!again) throw new AgentDesktopError('That control is no longer there; read the controls again', 'STALE_REF', { delivery: 'not_delivered', retry: 'safe' });
    await this.call(actionArgs(kind, again, { ...o, timeoutMs }), timeoutMs + 4000);
    return { fresh };
  }
}
