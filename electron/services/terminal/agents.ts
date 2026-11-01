// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Agent terminals and the agent hub, main-process side. Owns the bus, the hub
// and the terminal manager; gives agents Keeper starts an identity; checks the
// person's permissions; types messages in for agents that only read their
// prompt; keeps transcripts; and saves everything so it survives a restart.
// Nothing runs while nothing happens: timers exist only while a message waits
// to be delivered or a terminal has a time limit.

import { app } from 'electron';
import { appendFile, mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { redact } from '../../../core/brain/redact';
import { AgentBus, type BusSnapshot } from '../../../core/terminal/agent/bus';
import { deliverQueued, BRIDGE_DEFAULTS } from '../../../core/terminal/agent/bridge';
import { AgentHub, type AgentPerms, type HubSnapshot } from '../../../core/terminal/agent/hub';
import { AgentTerminals, DEFAULT_LIMITS, type AgentTerm, type Limits } from '../../../core/terminal/agent/manager';
import { DEFAULT_POLICY, type CommandPolicy } from '../../../core/terminal/agent/policy';
import { planRecipe, RECIPES } from '../../../core/terminal/agent/recipes';
import { AGENT_TOOLS, callAgentTool, isTermTool } from '../../../core/terminal/agent/tools';
import { shellFamily } from '../../../core/terminal/agent/wrap';
import { hostPort, routeToAgents } from './agent-port';
import { agentLaunch, hostClient, setHostTap } from './index';

export interface AgentTermDeps {
  broadcast(channel: string, ...args: unknown[]): void;
  alert(title: string, detail?: string): void;
  /** opens a terminal in Keeper's Terminal window */
  show(session: string): void;
  requestApproval(client: string, action: string, description: string, destructive?: boolean): Promise<'once' | 'always' | 'deny'>;
  /** the person's permission for an agent action ('terminal', 'agent_hub') */
  permission(action: string): 'off' | 'ask' | 'allow';
  /** starts an installed agent program in a terminal (with a hub identity) */
  launchAgent(harness: string, o: { cwd?: string }): Promise<{ ok: boolean; message: string }>;
  /** is the Terminal feature switched on */
  enabled(): boolean;
}

interface Saved {
  terms: AgentTerm[];
  bus: BusSnapshot;
  hub: HubSnapshot;
  policy: CommandPolicy;
  limits: Limits;
}

const dir = () => path.join(app.getPath('userData'), 'terminal');
const stateFile = () => path.join(dir(), 'agents.json');
const transcripts = () => path.join(dir(), 'transcripts');
const RETENTION_DAYS = 14;

let deps: AgentTermDeps | null = null;
let bus: AgentBus;
let hub: AgentHub;
let terms: AgentTerminals;
let saveTimer: NodeJS.Timeout | undefined;
let pushTimer: NodeJS.Timeout | undefined;
const allowedOnce = new Set<string>();
/** the name the next launched agent gets (recipes name their agents by role) */
let nextName: string | undefined;

export function agentTerminals() {
  return { terms, hub, bus };
}

function changed() {
  if (!deps) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => deps?.broadcast('agentterm-changed'), 150);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void save(), 2000);
}

async function save() {
  const s: Saved = { terms: terms.list(), bus: bus.snapshot(), hub: hub.snapshot(), policy: terms.policy, limits: terms.limits };
  await mkdir(dir(), { recursive: true });
  const tmp = `${stateFile()}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(s), { mode: 0o600 });
  await rename(tmp, stateFile());
}

// ---------------------------------------------------------------- transcripts

const pendingLog = new Map<string, string>();
let logTimer: NodeJS.Timeout | undefined;
function transcript(session: string, kind: 'in' | 'out' | 'note', text: string) {
  const stamp = new Date().toISOString();
  const line = kind === 'note' ? `# ${stamp} ${text}\n` : kind === 'in' ? `> ${text.replace(/\n/g, '\n> ')}\n` : `${text}\n`;
  pendingLog.set(session, (pendingLog.get(session) ?? '') + line);
  if (!logTimer) logTimer = setTimeout(() => {
    logTimer = undefined;
    const batch = [...pendingLog.entries()];
    pendingLog.clear();
    void mkdir(transcripts(), { recursive: true }).then(() => Promise.all(batch.map(([id, t]) => appendFile(path.join(transcripts(), `${id}.log`), t, { mode: 0o600 }))));
  }, 500);
}

async function pruneTranscripts() {
  try {
    const cut = Date.now() - RETENTION_DAYS * 86_400_000;
    for (const f of await readdir(transcripts())) {
      const p = path.join(transcripts(), f);
      if ((await stat(p)).mtimeMs < cut) await unlink(p);
    }
  } catch {
    /* nothing yet */
  }
}

export async function readTranscript(session: string): Promise<string> {
  try {
    return redact(await readFile(path.join(transcripts(), `${session.replace(/[^\w-]/g, '')}.log`), 'utf8')).text.slice(-200_000);
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------- the bridge

const deliveries = new Map<string, NodeJS.Timeout>();
/** Tries to deliver an agent's waiting messages through its terminal, every few seconds until done. */
function scheduleDelivery(agentId: string, delay = 1500) {
  if (deliveries.has(agentId)) return;
  deliveries.set(agentId, setTimeout(async () => {
    deliveries.delete(agentId);
    const a = hub.get(agentId);
    if (!a?.session || a.status === 'away' || !hub.bus.pendingMail(agentId)) return;
    try {
      await deliverQueued(hub, terms, a, { ...BRIDGE_DEFAULTS, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), now: Date.now });
    } catch {
      /* the terminal ended; the message stays queued */
    }
    if (hub.bus.pendingMail(agentId) && a.via !== 'mcp') scheduleDelivery(agentId, 3000);
  }, delay));
}

/** Watches a terminal Keeper started for an agent, so the bridge can type into it. */
async function observe(session: string, agentId: string) {
  if (terms.get(session)) return;
  try {
    const port = currentPort!;
    const scrollback = await port.scrollback(session);
    terms.adopt({
      id: session, owner: `agent:${agentId}`, name: hub.get(agentId)?.name ?? 'agent', children: [], createdAt: Date.now(), headless: false, controller: 'agent',
      family: shellFamily(process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL ?? '/bin/sh'), status: 'idle', lastOutput: Date.now(),
    }, scrollback);
  } catch {
    /* gone already */
  }
}

let currentPort: ReturnType<typeof hostPort> | null = null;

// ---------------------------------------------------------------- tools for agents

async function whoIs(client: string): Promise<string> {
  if (client.startsWith('hub:')) return client.slice(4);
  // The keeper command run by the person in their own shell acts as the person.
  if (client === 'keeper command') return hub.asHuman().id;
  // An app that connected on its own: known, or the person is asked once.
  const a = hub.join(client);
  if (!a.approved) {
    const d = await deps!.requestApproval(client, 'agent_hub', `join Keeper's agent hub as “${a.name}” (to message other agents and use terminals)`);
    if (d === 'deny') throw new Error('The person did not let this app join the agent hub.');
    hub.approve(a.id);
  }
  return a.id;
}

async function callTool(name: string, args: Record<string, unknown>, client: string) {
  try {
    const id = await whoIs(client);
    const action = isTermTool(name) ? 'terminal' : 'agent_hub';
    const perm = id === 'human' ? 'allow' : deps!.permission(action);
    if (perm === 'off') return { text: action === 'terminal' ? 'The person has not allowed agents to use terminals in Keeper.' : 'The person has turned the agent hub off.', isError: true };
    if (perm === 'ask' && !allowedOnce.has(`${id}:${action}`)) {
      const d = await deps!.requestApproval(hub.get(id)?.name ?? client, action, action === 'terminal' ? 'use terminals on this computer through Keeper (run commands, open sub-worker terminals)' : 'talk to other agents through Keeper\'s hub');
      if (d === 'deny') return { text: 'The person declined. Do not try again unless they ask.', isError: true };
      allowedOnce.add(`${id}:${action}`);
    }
    const a = hub.get(id);
    if (a && a.via === 'keeper' && a.harness !== 'human') a.via = 'mcp';
    if (isTermTool(name) && a && !a.perms.terminals) return { text: 'This agent is paused or not allowed to use terminals.', isError: true };
    const r = await callAgentTool({ terms, hub, agentId: id, show: (s) => deps?.show(s) }, name, args);
    if (name === 'term_create' && terms.list().filter((t) => t.status !== 'exited').length === 1) deps?.alert(`${a?.name ?? 'An agent'} is using a terminal`, 'See it in Terminal → Agents. Stop all from there or the command palette.');
    return r;
  } catch (e) {
    return { text: e instanceof Error ? e.message : String(e), isError: true };
  }
}

export function agentToolList() {
  return deps?.enabled() === false ? [] : AGENT_TOOLS;
}

export { callTool as callAgentTerminalTool };

// ---------------------------------------------------------------- start and stop

export async function startAgentTerminals(d: AgentTermDeps) {
  deps = d;
  bus = new AgentBus();
  hub = new AgentHub(bus);
  const port = hostPort(() => hostClient(), (req) => agentLaunch(req));
  currentPort = port;
  terms = new AgentTerminals(port, {
    now: Date.now,
    redact,
    approve: async (owner, what, why) => (await d.requestApproval(hub.get(owner.replace(/^agent:/, ''))?.name ?? owner, 'terminal', `${what} — ${why.join('; ')}`, true)) !== 'deny',
    spill: (id, text) => {
      const p = path.join(transcripts(), `${id}-${Date.now()}.out.txt`);
      void mkdir(transcripts(), { recursive: true }).then(() => writeFile(p, text, { mode: 0o600 }));
      return p;
    },
    transcript,
    changed,
    lowerPriority: (pid) => { try { os.setPriority(pid, 10); } catch { /* not ours */ } },
    home: os.homedir(),
    platform: process.platform,
  }, bus);
  bus.onChange = changed;
  hub.onChange = changed;
  // Messages for agents that run in a terminal: deliver when they are idle.
  const pump = () => {
    void bus.waitFor({ kinds: ['mail', 'session-exited'] }, 0).then((e) => {
      if (e?.kind === 'mail') {
        const a = hub.get(e.to);
        if (a?.session && a.harness !== 'human') scheduleDelivery(a.id);
      } else if (e?.kind === 'session-exited') hub.forgetSession(e.session);
      if (deps) pump();
    });
  };
  pump();
  try {
    const s = JSON.parse(await readFile(stateFile(), 'utf8')) as Partial<Saved>;
    bus.restore(s.bus ?? {});
    hub.restore(s.hub ?? {});
    terms.policy = { ...DEFAULT_POLICY, ...(s.policy ?? {}) };
    terms.limits = { ...DEFAULT_LIMITS, ...(s.limits ?? {}) };
    // Terminals that kept running while Keeper was closed come back under their agent.
    if (s.terms?.length) {
      const c = await hostClient();
      const alive = new Set(c.sessions.filter((x) => !x.exit).map((x) => x.id));
      for (const t of s.terms) if (alive.has(t.id)) terms.adopt(t, await port.scrollback(t.id));
    }
  } catch {
    /* first run */
  }
  setHostTap((m) => routeToAgents(m, terms));
  void pruneTranscripts();
}

export async function stopAgentTerminals() {
  clearTimeout(saveTimer);
  for (const t of deliveries.values()) clearTimeout(t);
  deliveries.clear();
  if (terms) await save().catch(() => undefined);
  bus?.close();
  setHostTap(null);
  deps = null;
}

/** Agents Keeper starts get a hub identity in their environment (and their terminal is watched for the bridge). */
export function identityFor(o: { agent: string; label: string; profile?: string; cwd: string }): Record<string, string> {
  if (!hub) return {};
  const name = nextName ?? o.label;
  nextName = undefined;
  const { agent, token } = hub.launch({ name, harness: o.agent, account: o.profile, folder: o.cwd });
  return { KEEPER_AGENT_TOKEN: token, KEEPER_AGENT_ID: agent.id };
}

/** Who a `keeper mcp` connection is (from its token), noting the terminal it runs in. */
export function resolveAgent(token?: string, session?: string): string | undefined {
  const a = hub?.byToken(token);
  if (!a) return undefined;
  if (session && a.session !== session) {
    a.session = session;
    void observe(session, a.id);
  }
  hub.seen(a.id, a.status === 'away' ? 'idle' : undefined);
  return `hub:${a.id}`;
}

// ---------------------------------------------------------------- for Keeper's windows

export function state() {
  return {
    terms: terms.tree(),
    agents: hub.list(),
    tasks: hub.taskList().slice(-200).reverse(),
    rooms: bus.channelNames(),
    locks: bus.lockList(),
    policy: terms.policy,
    limits: terms.limits,
    recipes: RECIPES.map((r) => ({ id: r.id, name: r.name, description: r.description, roles: r.roles.map((x) => ({ id: x.id, title: x.title, count: x.count, prefer: x.prefer })) })),
  };
}

export function roomMessages(room: string, after = 0) {
  return bus.read(room, after, 200);
}

export function humanPost(room: string, text: string) {
  return hub.post(hub.asHuman().id, room, text);
}

export function humanSend(to: string, text: string) {
  return hub.send(hub.asHuman().id, to, text);
}

export function humanTask(o: { title: string; detail?: string; room?: string; assignee?: string; forHarness?: string[] }) {
  hub.asHuman();
  return hub.postTask('human', o);
}

export function humanHandoff(taskId: string, to: string, summary: string) {
  hub.asHuman();
  return hub.handoff('human', taskId, to, { summary });
}

export function takeOver(id: string, back = false) {
  terms.handoff(id, back ? 'agent' : 'human', 'human');
}

export async function closeTerm(id: string) {
  return terms.close(id, { cascade: true, reason: 'closed by the person', by: 'human' });
}

export async function stopAll(): Promise<number> {
  for (const a of hub.list()) if (a.harness !== 'human') hub.setPerms(a.id, { terminals: false });
  const n = await terms.closeAll();
  // Agents may use terminals again once the person says so (Resume on each agent).
  return n;
}

const PAUSED: Partial<AgentPerms> = { send: false, tasks: false, handoff: false, terminals: false };
export function pauseAgent(id: string, paused: boolean) {
  hub.setPerms(id, paused ? PAUSED : { send: true, tasks: true, handoff: true, terminals: true });
}

export function approveAgent(id: string) {
  hub.approve(id);
}

export function setAgentPerms(id: string, p: Partial<AgentPerms>) {
  hub.setPerms(id, p);
}

export function setPolicy(p: Partial<CommandPolicy>, l?: Partial<Limits>) {
  terms.policy = { ...terms.policy, ...p };
  if (l) terms.limits = { ...terms.limits, ...l };
  changed();
}

/** An agent started outside Keeper joins with this token in its environment (KEEPER_AGENT_TOKEN), or Keeper opens a terminal running it. */
export async function addAgent(o: { name: string; harness: string; account?: string; run?: string; cwd?: string; headless?: boolean }) {
  const { agent, token } = hub.launch({ name: o.name, harness: o.harness || 'custom', account: o.account, folder: o.cwd });
  let session: string | undefined;
  if (o.run) {
    const t = await terms.create(`agent:${agent.id}`, { name: o.name, cwd: o.cwd, env: { KEEPER_AGENT_TOKEN: token, KEEPER_AGENT_ID: agent.id }, headless: o.headless, ttlMs: 0 });
    session = t.id;
    agent.session = t.id;
    terms.write(t.id, `agent:${agent.id}`, o.run + '\r');
  }
  changed();
  return { id: agent.id, token, session, env: `KEEPER_AGENT_TOKEN=${token}` };
}

/** Starts a team from a recipe: launches the chosen agents, opens a room, briefs each, posts the first tasks. */
export async function runRecipe(recipeId: string, goal: string, o: { cwd?: string; installed: string[]; choose?: Record<string, string> }) {
  const r = RECIPES.find((x) => x.id === recipeId);
  if (!r) throw new Error('Unknown recipe');
  const plan = planRecipe(r, o.installed, goal, o.choose);
  if (!plan.agents.length) throw new Error(`No installed agent can fill: ${plan.missing.join(', ')}`);
  const human = hub.asHuman();
  hub.post(human.id, plan.room, `Team “${r.name}” started for: ${goal}`);
  const started: string[] = [];
  for (const p of plan.agents) {
    nextName = p.name;
    const res = await deps!.launchAgent(p.harness, { cwd: o.cwd });
    nextName = undefined;
    if (!res.ok) continue;
    const a = hub.find(p.name);
    if (a) {
      hub.send(human.id, a.id, p.brief);
      started.push(a.id);
    }
  }
  for (const k of plan.kickoff) {
    const to = plan.agents.find((a) => a.role === k.role);
    hub.postTask(human.id, { title: k.title, detail: k.detail, room: plan.room, assignee: to?.name });
  }
  changed();
  return { room: plan.room, started, missing: plan.missing };
}
