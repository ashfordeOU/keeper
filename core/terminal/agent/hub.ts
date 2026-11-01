// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The agent hub: where AI agents of any kind meet, whatever harness runs them
// (Claude Code, Codex, Gemini, Grok, Cursor, OpenClaw, Hermes, aider, opencode,
// Keeper's own assistant…) and whichever account they are signed in with.
//
//   directory   who is here: name, harness, model, account/profile, folder,
//               terminal, status (idle, working, waiting, away)
//   messages    direct messages, rooms with threads, @mentions, broadcasts,
//               and questions that wait for an answer
//   tasks       a shared board: post, claim, complete, fail, hand off with a
//               context bundle (summary, files, notes, the last output)
//   scratch, locks   shared notes and advisory locks (from the bus)
//
// Agents only ever exchange what they write to each other; Keeper never passes
// one account's sign-in, config or keys to another. Each agent has its own
// permissions for sending, receiving, tasks, handoffs and terminals. Agents
// Keeper did not start must be approved by the person before they can write.

import type { AgentBus, BusMessage, MailItem } from './bus';

export type AgentStatus = 'idle' | 'working' | 'waiting' | 'away';
export type Via = 'mcp' | 'bridge' | 'keeper';

export interface AgentPerms {
  send: boolean;
  receive: boolean;
  tasks: boolean;
  handoff: boolean;
  terminals: boolean;
  /** receive only from agents on the same account/profile */
  sameAccountOnly: boolean;
}

export const DEFAULT_PERMS: AgentPerms = { send: true, receive: true, tasks: true, handoff: true, terminals: true, sameAccountOnly: false };

export interface HubAgent {
  id: string;
  name: string;
  /** which program runs it: claude, codex, gemini, grok, cursor-agent, … or 'mcp-client' / 'keeper' */
  harness: string;
  model?: string;
  /** the sign-in profile (separate config folder = separate account) */
  account?: string;
  /** the terminal it runs in, when known */
  session?: string;
  parent?: string;
  folder?: string;
  status: AgentStatus;
  via: Via;
  /** started by Keeper (trusted), or approved by the person */
  approved: boolean;
  joinedAt: number;
  lastSeen: number;
  perms: AgentPerms;
  /** short description of what it is doing */
  doing?: string;
}

export type TaskStatus = 'open' | 'claimed' | 'done' | 'failed' | 'cancelled';

export interface ContextBundle {
  summary: string;
  files?: string[];
  notes?: string;
  /** keys on the group's scratch board worth reading */
  scratch?: string[];
  /** the end of a terminal's output */
  output?: string;
}

export interface HubTask {
  id: string;
  title: string;
  detail?: string;
  room?: string;
  createdBy: string;
  assignee?: string;
  /** only agents running this harness may claim it (empty: anyone) */
  forHarness?: string[];
  status: TaskStatus;
  result?: string;
  context?: ContextBundle;
  createdAt: number;
  updatedAt: number;
  history: { at: number; by: string; what: string }[];
}

export interface HubSnapshot {
  agents: HubAgent[];
  tasks: HubTask[];
  taskSeq: number;
  names: Record<string, string>;
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

export class AgentHub {
  private agents = new Map<string, HubAgent>();
  private tokens = new Map<string, string>();
  private tasks = new Map<string, HubTask>();
  private taskSeq = 0;
  /** names the person approved for agents that connected on their own */
  private approvedNames: Record<string, string> = {};
  onChange?: () => void;

  constructor(public bus: AgentBus, private now: () => number = Date.now, private mint: () => string = () => Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)) {}

  // ---------------------------------------------------------------- directory

  /** An agent Keeper starts: registered and trusted, with a token its tools present. */
  launch(a: Omit<HubAgent, 'id' | 'status' | 'via' | 'approved' | 'joinedAt' | 'lastSeen' | 'perms'> & { id?: string; perms?: Partial<AgentPerms> }): { agent: HubAgent; token: string } {
    const id = a.id ?? this.uniqueId(a.name || a.harness);
    const agent: HubAgent = { ...a, id, status: 'idle', via: 'keeper', approved: true, joinedAt: this.now(), lastSeen: this.now(), perms: { ...DEFAULT_PERMS, ...(a.perms ?? {}) } };
    this.agents.set(id, agent);
    const token = this.mint();
    this.tokens.set(token, id);
    this.changed();
    return { agent, token };
  }

  /** The agent a token belongs to. */
  byToken(token: string | undefined): HubAgent | undefined {
    const id = token ? this.tokens.get(token) : undefined;
    return id ? this.agents.get(id) : undefined;
  }

  /** An agent that connected by itself (no token): known if approved before, else waiting for the person. */
  join(clientName: string, harness = 'mcp-client', extra: Partial<HubAgent> = {}): HubAgent {
    const key = clientName.toLowerCase();
    const known = this.approvedNames[key];
    const existing = known ? this.agents.get(known) : [...this.agents.values()].find((x) => x.via === 'mcp' && x.name.toLowerCase() === key);
    if (existing) {
      existing.lastSeen = this.now();
      if (existing.status === 'away') existing.status = 'idle';
      this.changed();
      return existing;
    }
    const id = known ?? this.uniqueId(clientName);
    const agent: HubAgent = { id, name: clip(clientName || 'AI app', 60), harness, status: 'idle', via: 'mcp', approved: !!known, joinedAt: this.now(), lastSeen: this.now(), perms: { ...DEFAULT_PERMS }, ...extra };
    this.agents.set(id, agent);
    this.changed();
    return agent;
  }

  approve(id: string, name?: string) {
    const a = this.agents.get(id);
    if (!a) return;
    a.approved = true;
    if (name) a.name = clip(name, 60);
    this.approvedNames[a.name.toLowerCase()] = id;
    this.changed();
  }

  private uniqueId(base: string): string {
    const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'agent';
    let id = slug;
    for (let i = 2; this.agents.has(id); i++) id = `${slug}-${i}`;
    return id;
  }

  get(id: string): HubAgent | undefined {
    return this.agents.get(id);
  }

  /** Finds an agent by id, @name or name. */
  find(ref: string): HubAgent | undefined {
    const r = ref.replace(/^@/, '').toLowerCase();
    return this.agents.get(r) ?? [...this.agents.values()].find((a) => a.name.toLowerCase() === r || a.id.toLowerCase() === r);
  }

  list(filter: { online?: boolean; harness?: string } = {}): HubAgent[] {
    return [...this.agents.values()].filter((a) => (!filter.online || a.status !== 'away') && (!filter.harness || a.harness === filter.harness));
  }

  seen(id: string, status?: AgentStatus, doing?: string) {
    const a = this.agents.get(id);
    if (!a) return;
    a.lastSeen = this.now();
    if (status) a.status = status;
    if (doing !== undefined) a.doing = clip(doing, 120);
    this.changed();
  }

  setPerms(id: string, p: Partial<AgentPerms>) {
    const a = this.agents.get(id);
    if (!a) return;
    a.perms = { ...a.perms, ...p };
    this.changed();
  }

  /** Away when its terminal ended or it has been silent too long. */
  away(id: string) {
    const a = this.agents.get(id);
    if (a && a.status !== 'away') {
      a.status = 'away';
      // Its claimed tasks go back on the board.
      for (const t of this.tasks.values()) if (t.assignee === id && t.status === 'claimed') this.touch(t, 'hub', `back on the board (${a.name} went away)`, { status: 'open', assignee: undefined });
      this.changed();
    }
  }

  forgetSession(session: string) {
    for (const a of this.agents.values()) if (a.session === session) this.away(a.id);
  }

  // ---------------------------------------------------------------- checks

  private canWrite(a: HubAgent | undefined, what: keyof AgentPerms): HubAgent {
    if (!a) throw new Error('Unknown agent: open it from Keeper, or connect through keeper mcp');
    if (!a.approved) throw new Error('The person has not approved this agent in Keeper yet');
    if (!a.perms[what]) throw new Error(`This agent is not allowed to ${what === 'send' ? 'send messages' : what}`);
    a.lastSeen = this.now();
    return a;
  }

  private mayReceive(to: HubAgent, from: HubAgent): boolean {
    if (!to.perms.receive) return false;
    if (to.perms.sameAccountOnly && (to.account ?? '') !== (from.account ?? '')) return false;
    return true;
  }

  // ---------------------------------------------------------------- messages

  /** A direct message (or, with `inReplyTo`, an answer to a question). */
  send(fromId: string, toRef: string, text: string, o: { inReplyTo?: number; data?: unknown } = {}): MailItem {
    const from = this.canWrite(this.agents.get(fromId), 'send');
    const to = this.find(toRef);
    if (!to) throw new Error(`No agent called ${toRef}. hub_list_agents shows who is here.`);
    if (!this.mayReceive(to, from)) throw new Error(`${to.name} does not take messages from ${from.name}`);
    return this.bus.send(to.id, from.id, text, { ...(o.data && typeof o.data === 'object' ? o.data : {}), ...(o.inReplyTo ? { inReplyTo: o.inReplyTo } : {}) });
  }

  /** Posts in a room; @names in the text also land in those agents' inboxes. */
  post(fromId: string, room: string, text: string, o: { thread?: number; data?: unknown } = {}): BusMessage {
    const from = this.canWrite(this.agents.get(fromId), 'send');
    const m = this.bus.post(room, from.id, text, { ...(o.data && typeof o.data === 'object' ? o.data : {}), ...(o.thread ? { thread: o.thread } : {}) });
    for (const name of new Set([...text.matchAll(/(?:^|\s)@([\w.-]+)/g)].map((x) => x[1]))) {
      if (name === 'all' || name === 'everyone') continue;
      const to = this.find(name);
      if (to && to.id !== from.id && this.mayReceive(to, from)) this.bus.send(to.id, from.id, `[mentioned in #${m.channel}] ${clip(text, 2000)}`, { room: m.channel, seq: m.seq });
    }
    if (/(?:^|\s)@(?:all|everyone)\b/.test(text)) for (const to of this.list({ online: true })) if (to.id !== from.id && this.mayReceive(to, from)) this.bus.send(to.id, from.id, `[#${m.channel}] ${clip(text, 2000)}`, { room: m.channel, seq: m.seq });
    return m;
  }

  /** Sends a message to everyone online. */
  broadcast(fromId: string, text: string): number {
    const from = this.canWrite(this.agents.get(fromId), 'send');
    let n = 0;
    for (const to of this.list({ online: true })) if (to.id !== from.id && this.mayReceive(to, from)) { this.bus.send(to.id, from.id, text, { broadcast: true }); n++; }
    return n;
  }

  inbox(id: string, peek = false): MailItem[] {
    const a = this.agents.get(id);
    if (a) a.lastSeen = this.now();
    return this.bus.receive(id, peek);
  }

  /** Asks another agent and waits for its answer (sent with inReplyTo). */
  async ask(fromId: string, toRef: string, question: string, timeoutMs: number): Promise<MailItem | null> {
    const q = this.send(fromId, toRef, question, { data: { question: true } });
    const to = this.find(toRef)!;
    const end = this.now() + timeoutMs;
    for (;;) {
      // Takes just the answer; anything else stays in the inbox.
      const [answer] = this.bus.take(fromId, (m) => m.from === to.id && (m.data as { inReplyTo?: number } | undefined)?.inReplyTo === q.id);
      if (answer) return answer;
      const left = end - this.now();
      if (left <= 0) return null;
      await this.bus.waitFor({ kinds: ['mail'], session: fromId }, left);
    }
  }

  // ---------------------------------------------------------------- tasks

  private touch(t: HubTask, by: string, what: string, patch: Partial<HubTask> = {}) {
    Object.assign(t, patch);
    t.updatedAt = this.now();
    t.history.push({ at: t.updatedAt, by, what });
    if (t.history.length > 50) t.history.splice(0, t.history.length - 50);
    if (t.room) this.bus.post(t.room, 'hub', `Task ${t.id} “${clip(t.title, 80)}”: ${what}`, { task: t.id });
    this.changed();
  }

  postTask(byId: string, o: { title: string; detail?: string; room?: string; assignee?: string; forHarness?: string[]; context?: ContextBundle }): HubTask {
    const by = this.canWrite(this.agents.get(byId) ?? (byId.startsWith('human') ? this.human(byId) : undefined), 'tasks');
    const assignee = o.assignee ? this.find(o.assignee) : undefined;
    if (o.assignee && !assignee) throw new Error(`No agent called ${o.assignee}`);
    const t: HubTask = {
      id: `T${++this.taskSeq}`, title: clip(o.title, 200), detail: o.detail?.slice(0, 20_000), room: o.room, createdBy: by.id, assignee: assignee?.id,
      forHarness: o.forHarness?.length ? o.forHarness : undefined, status: assignee ? 'claimed' : 'open', context: o.context, createdAt: this.now(), updatedAt: this.now(), history: [],
    };
    this.tasks.set(t.id, t);
    this.touch(t, by.id, assignee ? `posted for ${assignee.name}` : 'posted');
    if (assignee) this.bus.send(assignee.id, by.id, `New task ${t.id}: ${t.title}${t.detail ? `\n\n${t.detail}` : ''}`, { task: t.id });
    return t;
  }

  /** Claims an open task (only one agent wins). */
  claim(byId: string, taskId: string): HubTask {
    const a = this.canWrite(this.agents.get(byId), 'tasks');
    const t = this.tasks.get(taskId);
    if (!t) throw new Error(`No task ${taskId}`);
    if (t.status !== 'open') throw new Error(`Task ${taskId} is ${t.status}${t.assignee ? ` by ${this.agents.get(t.assignee)?.name ?? t.assignee}` : ''}`);
    if (t.forHarness && !t.forHarness.includes(a.harness)) throw new Error(`Task ${taskId} is for ${t.forHarness.join(' or ')}`);
    this.touch(t, a.id, `claimed by ${a.name}`, { status: 'claimed', assignee: a.id });
    a.status = 'working';
    a.doing = t.title;
    return t;
  }

  complete(byId: string, taskId: string, result: string, failed = false): HubTask {
    const a = this.canWrite(this.agents.get(byId), 'tasks');
    const t = this.tasks.get(taskId);
    if (!t) throw new Error(`No task ${taskId}`);
    if (t.assignee !== a.id) throw new Error(`Task ${taskId} is not assigned to ${a.name}`);
    this.touch(t, a.id, failed ? `failed: ${clip(result, 200)}` : `done by ${a.name}`, { status: failed ? 'failed' : 'done', result: result.slice(0, 50_000) });
    a.status = 'idle';
    a.doing = undefined;
    if (t.createdBy !== a.id && this.agents.has(t.createdBy)) this.bus.send(t.createdBy, a.id, `Task ${t.id} ${failed ? 'failed' : 'is done'}: ${clip(result, 4000)}`, { task: t.id, inReplyTo: undefined });
    return t;
  }

  /** Passes a task (and what is known so far) to another agent, of any harness or account. */
  handoff(byId: string, taskId: string, toRef: string, context: ContextBundle): HubTask {
    const a = this.canWrite(this.agents.get(byId) ?? (byId.startsWith('human') ? this.human(byId) : undefined), 'handoff');
    const t = this.tasks.get(taskId);
    if (!t) throw new Error(`No task ${taskId}`);
    if (t.assignee && t.assignee !== a.id && !a.id.startsWith('human')) throw new Error(`Only the agent working on ${taskId} can hand it off`);
    const to = this.find(toRef);
    if (!to) throw new Error(`No agent called ${toRef}`);
    if (!this.mayReceive(to, a)) throw new Error(`${to.name} does not take work from ${a.name}`);
    const bundle: ContextBundle = { summary: context.summary.slice(0, 20_000), files: context.files?.slice(0, 200), notes: context.notes?.slice(0, 20_000), scratch: context.scratch?.slice(0, 50), output: context.output?.slice(-20_000) };
    this.touch(t, a.id, `handed from ${a.name} to ${to.name}`, { status: 'claimed', assignee: to.id, context: bundle });
    if (a.status === 'working' && a.doing === t.title) { a.status = 'idle'; a.doing = undefined; }
    to.status = 'working';
    to.doing = t.title;
    this.bus.send(to.id, a.id, handoffText(t, bundle, a), { task: t.id, handoff: true });
    return t;
  }

  cancel(byId: string, taskId: string) {
    const t = this.tasks.get(taskId);
    if (!t) throw new Error(`No task ${taskId}`);
    if (t.createdBy !== byId && !byId.startsWith('human')) throw new Error('Only who posted a task (or the person) can cancel it');
    this.touch(t, byId, 'cancelled', { status: 'cancelled' });
  }

  taskList(filter: { status?: TaskStatus; assignee?: string; room?: string } = {}): HubTask[] {
    return [...this.tasks.values()].filter((t) => (!filter.status || t.status === filter.status) && (!filter.assignee || t.assignee === filter.assignee) && (!filter.room || t.room === filter.room));
  }

  task(id: string): HubTask | undefined {
    return this.tasks.get(id);
  }

  /** The person, as a participant (they can post, assign and hand off). */
  private human(id: string): HubAgent {
    let h = this.agents.get(id);
    if (!h) {
      h = { id, name: 'You', harness: 'human', status: 'idle', via: 'keeper', approved: true, joinedAt: this.now(), lastSeen: this.now(), perms: { ...DEFAULT_PERMS } };
      this.agents.set(id, h);
    }
    return h;
  }

  /** Lets the person speak in rooms and to agents. */
  asHuman(id = 'human'): HubAgent {
    return this.human(id);
  }

  // ---------------------------------------------------------------- saving

  private changed() {
    this.onChange?.();
  }

  snapshot(): HubSnapshot {
    return { agents: [...this.agents.values()], tasks: [...this.tasks.values()].slice(-500), taskSeq: this.taskSeq, names: this.approvedNames };
  }

  restore(s: Partial<HubSnapshot>) {
    // Agents come back as away until they show up again; their tokens do not survive a restart.
    this.agents = new Map((s.agents ?? []).map((a) => [a.id, { ...a, status: a.harness === 'human' ? 'idle' : 'away' } as HubAgent]));
    this.tasks = new Map((s.tasks ?? []).map((t) => [t.id, t]));
    this.taskSeq = s.taskSeq ?? 0;
    this.approvedNames = s.names ?? {};
  }
}

/** What the receiving agent reads when work is handed to it. */
export function handoffText(t: HubTask, b: ContextBundle, from: HubAgent): string {
  const parts = [`${from.name} (${from.harness}${from.model ? `, ${from.model}` : ''}) handed you task ${t.id}: ${t.title}`];
  if (t.detail) parts.push(`Task: ${t.detail}`);
  parts.push(`Where it stands: ${b.summary}`);
  if (b.files?.length) parts.push(`Files: ${b.files.join(', ')}`);
  if (b.notes) parts.push(`Notes: ${b.notes}`);
  if (b.scratch?.length) parts.push(`Shared notes to read (hub_scratch_get): ${b.scratch.join(', ')}`);
  if (b.output) parts.push(`Last output:\n${b.output}`);
  parts.push(`When finished, call hub_complete with task_id ${t.id} and your result.`);
  return parts.join('\n\n');
}
