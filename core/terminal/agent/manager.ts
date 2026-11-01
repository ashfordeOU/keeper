// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Terminals for agents. One implementation behind every way in (MCP tools,
// agent-to-agent, the `keeper term` command, Keeper's own windows):
//
//   create   a terminal for an agent, optionally the child of another (a
//            sub-worker), in a group, with a time limit, shown or headless
//   run      type one command, wait for it to finish (or for a pattern, the
//            prompt, or nothing), and get back clean output with its exit code
//   read     output since a cursor; write / keys; wait; snapshot; resize
//   close    one terminal, or it and everything it started
//
// Children end with their parent; terminals past their time limit end; an
// agent can only hold so many. Commands that look destructive wait for the
// person's yes; a person can take any terminal over, and then the agent's
// typing is refused until they hand it back. Pure: the main process supplies
// the session host and the clock.

import { capOutput, cleanOutput, looksLikeInputPrompt } from './clean';
import { classifyCommand, DEFAULT_POLICY, insideJail, pathsOutsideJail, type CommandPolicy } from './policy';
import { agentEnv, findMarks, keySequence, newNonce, shellFamily, wrapCommand, type ShellFamily } from './wrap';
import type { AgentBus } from './bus';

export interface HostPort {
  create(req: { profileId?: string; cwd?: string; env: Record<string, string>; title: string; group?: string; cols: number; rows: number; persist: boolean }): Promise<{ id: string; pid?: number; cwd?: string; shellFile: string; shellKind?: string }>;
  write(id: string, data: string): void;
  kill(id: string): Promise<void>;
  resize(id: string, cols: number, rows: number): void;
  /** everything the terminal has kept (raw), for snapshots and late joiners */
  scrollback(id: string): Promise<string>;
}

export type Controller = 'agent' | 'human';
export type TermStatus = 'starting' | 'idle' | 'running' | 'waiting' | 'exited';

export interface AgentTerm {
  id: string;
  owner: string;
  name: string;
  group?: string;
  parent?: string;
  children: string[];
  createdAt: number;
  /** ends at this time (ms); undefined = no limit */
  deadline?: number;
  headless: boolean;
  controller: Controller;
  cwd?: string;
  pid?: number;
  family: ShellFamily;
  status: TermStatus;
  /** the command running now (through `run`) */
  running?: string;
  lastOutput: number;
  exit?: { code?: number; at: number };
  /** what the program seems to be asking, when waiting */
  prompt?: string;
}

export interface Limits {
  maxSessionsPerAgent: number;
  /** default and largest time limit for a terminal */
  defaultTtlMs: number;
  maxTtlMs: number;
  /** longest single command wait */
  maxRunMs: number;
  /** characters of output returned at most (the rest is saved to a file) */
  maxOutputChars: number;
  /** quiet this long while not finished: check whether it waits for input */
  inputIdleMs: number;
}

export const DEFAULT_LIMITS: Limits = { maxSessionsPerAgent: 12, defaultTtlMs: 2 * 3600_000, maxTtlMs: 24 * 3600_000, maxRunMs: 30 * 60_000, maxOutputChars: 16_000, inputIdleMs: 1500 };

export interface RunOptions {
  wait?: 'exit' | 'prompt' | 'regex' | 'none';
  regex?: string;
  timeoutMs?: number;
  /** typed once the command has started (answers to questions, piped text) */
  stdin?: string;
  /** press Ctrl+C when the wait times out */
  interruptOnTimeout?: boolean;
  maxChars?: number;
}

export interface RunResult {
  session: string;
  status: 'done' | 'timeout' | 'waiting-for-input' | 'matched' | 'started' | 'exited';
  exitCode?: number;
  output: string;
  truncated: boolean;
  /** the whole output, when it was cut */
  savedTo?: string;
  durationMs: number;
  cursor: number;
  prompt?: string;
  redacted?: Record<string, number>;
}

export interface ManagerHooks {
  now(): number;
  /** blanks secrets; returns the text and what was found */
  redact?(text: string): { text: string; found: Record<string, number> };
  /** asks the person; resolves true to go ahead */
  approve?(owner: string, what: string, why: string[]): Promise<boolean>;
  /** keeps a full copy of long output; returns where */
  spill?(session: string, text: string): string | undefined;
  /** a line for the terminal's transcript */
  transcript?(session: string, kind: 'in' | 'out' | 'note', text: string): void;
  /** something changed (for windows and saving) */
  changed?(): void;
  /** raises or lowers the program's priority (sub-workers run below normal) */
  lowerPriority?(pid: number): void;
  home?: string;
  platform?: string;
}

interface Live {
  t: AgentTerm;
  /** raw output kept for runs and reads */
  buf: string;
  /** characters received before buf starts */
  base: number;
  waiters: Set<() => void>;
  /** the command in flight through run(): its marks and where its output starts */
  run?: { nonce: string; cursor: number; command: string };
  /** a run() call is waiting on this terminal right now */
  inRun?: boolean;
}

const MAX_BUF = 2 * 1024 * 1024;

export class AgentTerminals {
  private live = new Map<string, Live>();
  private reaper?: ReturnType<typeof setTimeout>;
  limits: Limits = { ...DEFAULT_LIMITS };
  policy: CommandPolicy = { ...DEFAULT_POLICY };

  constructor(private host: HostPort, private hooks: ManagerHooks, private bus?: AgentBus) {}

  // ---------------------------------------------------------------- feeding (from the host)

  /** Output arrived from the host. */
  data(id: string, chunk: string) {
    const l = this.live.get(id);
    if (!l) return;
    l.buf += chunk;
    if (l.buf.length > MAX_BUF) {
      const cut = l.buf.length - MAX_BUF;
      l.buf = l.buf.slice(cut);
      l.base += cut;
    }
    l.t.lastOutput = this.hooks.now();
    if (l.t.status === 'waiting') { l.t.status = l.t.running ? 'running' : 'idle'; l.t.prompt = undefined; }
    // A command that outlived its run() call (timed out, or asked a question) finishing later.
    if (l.run && !l.inRun) {
      const m = findMarks(l.buf.slice(Math.max(0, l.run.cursor - l.base)), l.run.nonce);
      if (m.done) {
        this.bus?.emit({ kind: 'command-finished', session: id, command: l.run.command, exitCode: m.exitCode, at: this.hooks.now() });
        l.run = undefined;
        l.t.running = undefined;
        l.t.status = 'idle';
        this.hooks.changed?.();
      }
    }
    for (const w of [...l.waiters]) w();
  }

  /** The shell said a prompt is showing (shell integration). */
  prompt(id: string) {
    const l = this.live.get(id);
    if (!l) return;
    for (const w of [...l.waiters]) w();
  }

  /** The program in a terminal ended. */
  exited(id: string, code?: number) {
    const l = this.live.get(id);
    if (!l) return;
    l.t.status = 'exited';
    l.t.exit = { code, at: this.hooks.now() };
    l.t.running = undefined;
    for (const w of [...l.waiters]) w();
    this.bus?.emit({ kind: 'session-exited', session: id, code, at: this.hooks.now() });
    this.bus?.releaseSession(id);
    this.hooks.transcript?.(id, 'note', `ended (${code ?? '?'})`);
    // Sub-workers end with the terminal that started them.
    for (const c of l.t.children) void this.close(c, { cascade: true, reason: 'its parent ended' });
    this.hooks.changed?.();
  }

  // ---------------------------------------------------------------- lifecycle

  list(owner?: string): AgentTerm[] {
    return [...this.live.values()].map((l) => l.t).filter((t) => !owner || t.owner === owner);
  }

  get(id: string): AgentTerm | undefined {
    return this.live.get(id)?.t;
  }

  /** Terminals as a tree: roots with their sub-workers. */
  tree(owner?: string): (AgentTerm & { sub: ReturnType<AgentTerminals['tree']> })[] {
    const all = this.list(owner);
    const build = (t: AgentTerm): AgentTerm & { sub: ReturnType<AgentTerminals['tree']> } => ({ ...t, sub: t.children.map((c) => this.get(c)).filter((x): x is AgentTerm => !!x).map(build) });
    return all.filter((t) => !t.parent || !this.live.has(t.parent)).map(build);
  }

  async create(owner: string, o: { name?: string; profileId?: string; cwd?: string; env?: Record<string, string>; group?: string; parent?: string; ttlMs?: number; headless?: boolean; ci?: boolean; cols?: number; rows?: number; persist?: boolean }): Promise<AgentTerm> {
    const mine = this.list(owner).filter((t) => t.status !== 'exited');
    if (mine.length >= this.limits.maxSessionsPerAgent) throw new Error(`This agent already has ${mine.length} terminals open (the limit is ${this.limits.maxSessionsPerAgent}). Close some first.`);
    const parent = o.parent ? this.live.get(o.parent)?.t : undefined;
    if (o.parent && !parent) throw new Error('The parent terminal is not open');
    const cwd = o.cwd ?? parent?.cwd;
    if (cwd && !insideJail(cwd, this.policy.jail, this.hooks.platform === 'win32')) throw new Error(`Agent terminals must stay inside ${this.policy.jail.join(', ')}`);
    const group = o.group ?? parent?.group;
    const ttl = Math.min(o.ttlMs ?? this.limits.defaultTtlMs, this.limits.maxTtlMs);
    // Children get a narrow set of the parent's variables: the group, never secrets.
    const env = { ...agentEnv({ ci: o.ci }), ...(o.env ?? {}), KEEPER_AGENT_OWNER: owner, ...(group ? { KEEPER_GROUP: group } : {}), ...(parent ? { KEEPER_PARENT_SESSION: parent.id } : {}) };
    const made = await this.host.create({ profileId: o.profileId, cwd, env, title: (o.name ?? 'Agent terminal').slice(0, 80), group, cols: o.cols ?? 120, rows: o.rows ?? 32, persist: o.persist ?? true });
    const now = this.hooks.now();
    const t: AgentTerm = {
      id: made.id, owner, name: (o.name ?? `${owner.replace(/^agent:/, '')} terminal`).slice(0, 80), group, parent: parent?.id, children: [], createdAt: now,
      deadline: ttl > 0 ? now + ttl : undefined, headless: !!o.headless, controller: 'agent', cwd: made.cwd ?? cwd, pid: made.pid,
      family: shellFamily(made.shellFile, made.shellKind), status: 'idle', lastOutput: now,
    };
    this.live.set(t.id, { t, buf: '', base: 0, waiters: new Set() });
    if (parent) {
      parent.children.push(t.id);
      if (t.pid) this.hooks.lowerPriority?.(t.pid);
    }
    this.bus?.emit({ kind: 'session-created', session: t.id, parent: parent?.id, at: now });
    this.hooks.transcript?.(t.id, 'note', `opened by ${owner}${parent ? ` as a sub-worker of ${parent.id}` : ''} in ${t.cwd ?? '?'}`);
    this.scheduleReaper();
    this.hooks.changed?.();
    return t;
  }

  /** Re-adopts terminals that kept running while Keeper was closed. */
  adopt(t: AgentTerm, scrollback = '') {
    if (this.live.has(t.id)) return;
    this.live.set(t.id, { t: { ...t, status: t.status === 'exited' ? 'exited' : 'idle', running: undefined }, buf: scrollback.slice(-MAX_BUF), base: Math.max(0, scrollback.length - MAX_BUF), waiters: new Set() });
    this.scheduleReaper();
  }

  async close(id: string, o: { cascade?: boolean; reason?: string; by?: string } = {}): Promise<string[]> {
    const l = this.live.get(id);
    if (!l) return [];
    if (o.by && l.t.owner !== o.by && !o.by.startsWith('human')) throw new Error('That terminal belongs to another agent');
    const closed: string[] = [];
    if (o.cascade !== false) for (const c of [...l.t.children]) closed.push(...(await this.close(c, { cascade: true, reason: o.reason })));
    this.live.delete(id);
    if (l.t.parent) {
      const p = this.live.get(l.t.parent)?.t;
      if (p) p.children = p.children.filter((c) => c !== id);
    }
    for (const w of l.waiters) w();
    this.bus?.releaseSession(id);
    this.hooks.transcript?.(id, 'note', `closed${o.reason ? ` (${o.reason})` : ''}`);
    try {
      await this.host.kill(id);
    } catch {
      /* already gone */
    }
    closed.push(id);
    this.hooks.changed?.();
    return closed;
  }

  /** Ends everything agents opened (the stop button). */
  async closeAll(): Promise<number> {
    let n = 0;
    for (const t of this.tree()) n += (await this.close(t.id, { cascade: true, reason: 'stopped by the person' })).length;
    return n;
  }

  private scheduleReaper() {
    if (this.reaper) clearTimeout(this.reaper);
    const next = Math.min(...this.list().map((t) => t.deadline ?? Infinity));
    if (!Number.isFinite(next)) return;
    this.reaper = setTimeout(() => void this.reap(), Math.max(1000, next - this.hooks.now()));
    (this.reaper as { unref?: () => void }).unref?.();
  }

  /** Ends terminals past their time limit, and children whose parent is gone. */
  async reap(): Promise<string[]> {
    const now = this.hooks.now();
    const gone: string[] = [];
    for (const t of this.list()) {
      if (!this.live.has(t.id)) continue;
      if (t.deadline !== undefined && t.deadline <= now) gone.push(...(await this.close(t.id, { cascade: true, reason: 'its time limit ran out' })));
      else if (t.parent && !this.live.has(t.parent)) gone.push(...(await this.close(t.id, { cascade: true, reason: 'its parent is gone' })));
    }
    this.scheduleReaper();
    return gone;
  }

  // ---------------------------------------------------------------- control

  private mine(id: string, owner: string, write = false): Live {
    const l = this.live.get(id);
    if (!l) throw new Error(`No agent terminal ${id}`);
    if (write && l.t.controller === 'human' && !owner.startsWith('human')) throw new Error('A person has taken over this terminal; wait until they hand it back.');
    return l;
  }

  /** A person takes a terminal over, or hands it back. */
  handoff(id: string, to: Controller, by: string) {
    const l = this.mine(id, by);
    l.t.controller = to;
    this.hooks.transcript?.(id, 'note', to === 'human' ? `taken over by ${by}` : `handed back to the agent by ${by}`);
    this.hooks.changed?.();
  }

  write(id: string, owner: string, data: string) {
    const l = this.mine(id, owner, true);
    if (l.t.status === 'exited') throw new Error('The program in this terminal has ended');
    this.hooks.transcript?.(id, 'in', data);
    this.host.write(id, data);
  }

  keys(id: string, owner: string, keys: string[]): void {
    const seq = keys.map((k) => {
      const s = keySequence(k);
      if (s === undefined) throw new Error(`Unknown key “${k}” (use names like C-c, Enter, Up, Tab, Escape, F5)`);
      return s;
    }).join('');
    this.write(id, owner, seq);
  }

  resize(id: string, owner: string, cols: number, rows: number) {
    this.mine(id, owner);
    this.host.resize(id, Math.max(20, Math.min(400, cols | 0)), Math.max(5, Math.min(200, rows | 0)));
  }

  /** Output since `cursor` (a number from an earlier read or run), cleaned unless `raw`. */
  read(id: string, owner: string, o: { cursor?: number; maxChars?: number; raw?: boolean } = {}): { text: string; cursor: number; truncated: boolean; missed: boolean; status: TermStatus; redacted?: Record<string, number> } {
    const l = this.mine(id, owner);
    const end = l.base + l.buf.length;
    const from = Math.max(o.cursor ?? Math.max(0, end - 8000), 0);
    const missed = from < l.base;
    const raw = l.buf.slice(Math.max(0, from - l.base));
    let text = o.raw ? raw : cleanOutput(raw);
    let redacted: Record<string, number> | undefined;
    if (this.hooks.redact) {
      const r = this.hooks.redact(text);
      text = r.text;
      if (Object.keys(r.found).length) redacted = r.found;
    }
    const c = capOutput(text, o.maxChars ?? this.limits.maxOutputChars, 0.1);
    return { text: c.text, cursor: end, truncated: c.truncated || missed, missed, status: l.t.status, redacted };
  }

  /** The visible screen as text: the last rows of output. */
  snapshot(id: string, owner: string, rows = 40): string {
    const l = this.mine(id, owner);
    const lines = cleanOutput(l.buf.slice(-64 * 1024)).split('\n');
    const text = lines.slice(-rows).join('\n');
    return this.hooks.redact ? this.hooks.redact(text).text : text;
  }

  private waitChange(l: Live, ms: number): Promise<void> {
    return new Promise((resolve) => {
      const done = () => { clearTimeout(timer); l.waiters.delete(done); resolve(); };
      const timer = setTimeout(done, Math.max(1, ms));
      l.waiters.add(done);
    });
  }

  /** Waits until output matches, the shell shows a prompt, the terminal goes quiet, or it ends. */
  async wait(id: string, owner: string, o: { regex?: string; idleMs?: number; timeoutMs?: number; cursor?: number } = {}): Promise<{ status: 'matched' | 'idle' | 'exited' | 'timeout' | 'waiting-for-input'; cursor: number; match?: string; prompt?: string }> {
    const l = this.mine(id, owner);
    const start = this.hooks.now();
    const limit = Math.min(o.timeoutMs ?? 60_000, this.limits.maxRunMs);
    const from = o.cursor ?? l.base + l.buf.length;
    const re = o.regex ? new RegExp(o.regex, 'm') : undefined;
    for (;;) {
      if (!this.live.has(id)) return { status: 'exited', cursor: from };
      const end = l.base + l.buf.length;
      const clean = cleanOutput(l.buf.slice(Math.max(0, from - l.base)));
      if (re) {
        const m = re.exec(clean);
        if (m) return { status: 'matched', cursor: end, match: m[0] };
      }
      if (l.t.status === 'exited') return { status: 'exited', cursor: end };
      const quiet = this.hooks.now() - l.t.lastOutput;
      if (o.idleMs && quiet >= o.idleMs) return { status: 'idle', cursor: end };
      if (!re && !o.idleMs && quiet >= this.limits.inputIdleMs) {
        const ask = looksLikeInputPrompt(cleanOutput(l.buf.slice(-4000)));
        if (ask.waiting) return { status: 'waiting-for-input', cursor: end, prompt: ask.prompt };
      }
      const left = limit - (this.hooks.now() - start);
      if (left <= 0) return { status: 'timeout', cursor: end };
      await this.waitChange(l, Math.min(left, o.idleMs ? Math.max(50, o.idleMs - quiet) : this.limits.inputIdleMs));
    }
  }

  /** Types one command and waits as asked; returns its clean output and exit code. */
  async run(id: string, owner: string, command: string, o: RunOptions = {}): Promise<RunResult> {
    const l = this.mine(id, owner, true);
    if (l.t.status === 'exited') throw new Error('The program in this terminal has ended; open a new one');
    if (l.t.running) {
      // Ctrl+C or the program ending may have finished it without a mark (e.g. an interrupted run).
      const back = l.run && (this.hooks.now() - l.t.lastOutput > 500) && /[$#%>]\s*$/.test(cleanOutput(l.buf.slice(-400)).replace(/\s+$/, ' ').trimEnd() + ' ');
      if (!back) throw new Error(`This terminal is still running “${l.t.running.slice(0, 80)}”. Wait for it (term_wait), answer it (term_write), open a sub-worker terminal, or send C-c.`);
      l.run = undefined;
      l.t.running = undefined;
    }
    // The person's rules first: refused, asked, or fine.
    const verdict = classifyCommand(command, this.policy);
    if (verdict.risk === 'deny') throw new Error(`Not allowed: ${verdict.reasons.join('; ')}`);
    const outside = pathsOutsideJail(command, this.policy.jail, this.hooks.home ?? '', this.hooks.platform === 'win32');
    const why = [...verdict.reasons, ...(outside.length ? [`reaches outside the allowed folders (${outside.slice(0, 3).join(', ')})`] : [])];
    if ((verdict.risk === 'ask' || outside.length) && why.length) {
      const ok = this.hooks.approve ? await this.hooks.approve(owner, `run “${command.slice(0, 200)}” in ${l.t.name}`, why) : false;
      if (!ok) throw new Error(`The person did not allow this command (${why.join('; ')}).`);
    }
    const nonce = newNonce();
    const started = this.hooks.now();
    const cursor0 = l.base + l.buf.length;
    l.t.running = command;
    l.t.status = 'running';
    l.run = { nonce, cursor: cursor0, command };
    l.inRun = true;
    this.hooks.changed?.();
    this.hooks.transcript?.(id, 'in', `$ ${command}`);
    this.host.write(id, wrapCommand(command, l.t.family, nonce));
    const wait = o.wait ?? 'exit';
    const limit = Math.min(o.timeoutMs ?? 120_000, this.limits.maxRunMs);
    const re = o.regex ? new RegExp(o.regex, 'm') : undefined;
    let fed = !o.stdin;
    let result: RunResult | undefined;
    const finish = (status: RunResult['status'], body: string, exitCode?: number, prompt?: string): RunResult => {
      let text = cleanOutput(body).replace(/^\n+/, '').replace(/\s+$/, '');
      let redacted: Record<string, number> | undefined;
      if (this.hooks.redact) {
        const r = this.hooks.redact(text);
        text = r.text;
        if (Object.keys(r.found).length) redacted = r.found;
      }
      const cap = capOutput(text, o.maxChars ?? this.limits.maxOutputChars);
      const savedTo = cap.truncated ? this.hooks.spill?.(id, text) : undefined;
      l.inRun = false;
      // Ctrl+C on a time-out stops the command (its end mark never comes): the terminal is free again.
      const freed = status === 'done' || status === 'exited' || (status === 'timeout' && o.interruptOnTimeout);
      if (freed) { l.t.running = undefined; l.run = undefined; l.t.status = l.t.status === 'exited' ? 'exited' : 'idle'; }
      if (status === 'waiting-for-input') { l.t.status = 'waiting'; l.t.prompt = prompt; this.bus?.emit({ kind: 'waiting-for-input', session: id, prompt: prompt ?? '', at: this.hooks.now() }); }
      if (status === 'done') this.bus?.emit({ kind: 'command-finished', session: id, command, exitCode, at: this.hooks.now() });
      this.hooks.transcript?.(id, 'out', text);
      this.hooks.changed?.();
      return { session: id, status, exitCode, output: cap.text, truncated: cap.truncated, savedTo, durationMs: this.hooks.now() - started, cursor: l.base + l.buf.length, prompt, redacted };
    };
    if (wait === 'none') return finish('started', '');
    while (!result) {
      const raw = l.buf.slice(Math.max(0, cursor0 - l.base));
      const m = findMarks(raw, nonce);
      if (m.started && !fed) {
        fed = true;
        this.host.write(id, o.stdin!);
      }
      if (m.done) { result = finish('done', m.body, m.exitCode); break; }
      if (re && m.started && re.test(cleanOutput(m.body))) { result = finish('matched', m.body); break; }
      if (!this.live.has(id) || (l.t.status as string) === 'exited') { result = finish('exited', m.body, l.t.exit?.code); break; }
      const quiet = this.hooks.now() - l.t.lastOutput;
      if (m.started && quiet >= this.limits.inputIdleMs) {
        const ask = looksLikeInputPrompt(cleanOutput(m.body.slice(-4000)));
        if (ask.waiting) { result = finish('waiting-for-input', m.body, undefined, ask.prompt); break; }
      }
      const left = limit - (this.hooks.now() - started);
      if (left <= 0) {
        if (o.interruptOnTimeout) this.host.write(id, '\x03');
        result = finish('timeout', m.body);
        break;
      }
      await this.waitChange(l, Math.min(left, this.limits.inputIdleMs));
      void wait;
    }
    return result;
  }
}
