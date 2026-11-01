// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The tools agents use, in MCP's shape: terminals (term_*) and the hub (hub_*).
// The same calls serve MCP clients, the agent-to-agent endpoint, the `keeper
// term` / `keeper hub` commands and Keeper's own windows.

import type { AgentHub, ContextBundle } from './hub';
import type { AgentTerminals, RunOptions } from './manager';

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; openWorldHint?: boolean; title?: string };
}

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required });
const s = (description: string) => ({ type: 'string', description });
const n = (description: string) => ({ type: 'integer', description });
const b = (description: string) => ({ type: 'boolean', description });
const ro = { readOnlyHint: true, openWorldHint: false };
const rw = { readOnlyHint: false, openWorldHint: false };

export const TERM_TOOLS: ToolDef[] = [
  { name: 'term_create', annotations: rw, description: 'Open a terminal you control (a real shell on the person\'s computer, shown in Keeper\'s Agents view). Use parent to open a sub-worker terminal that ends with its parent; group lets terminals share notes. Pagers and interactive prompts are turned off where possible.', inputSchema: obj({ name: s('a short label'), cwd: s('starting folder'), parent: s('id of the terminal this one works for (sub-worker)'), group: s('group name shared by related terminals'), ttl_minutes: n('close automatically after this long (default 120)'), env: { type: 'object', additionalProperties: { type: 'string' } }, profile: s('a Keeper terminal profile id'), headless: b('do not show it as a tab'), ci: b('set CI=1') }) },
  { name: 'term_run', annotations: rw, description: 'Run one command in a terminal and wait. Returns clean output (no colours), the exit code, and a cursor for term_read. If the program asks a question it returns status waiting-for-input with the prompt instead of hanging; answer with term_write. Destructive commands may wait for the person\'s approval. Pass session "new" to open a terminal first.', inputSchema: obj({ session: s('terminal id, or "new"'), command: s('the command line'), wait: { type: 'string', enum: ['exit', 'regex', 'none'], description: 'exit (default): until it finishes; regex: until output matches; none: start it and return (use for servers)' }, regex: s('for wait=regex'), timeout_seconds: n('default 120, max 1800'), stdin: s('text typed after it starts'), interrupt_on_timeout: b('press Ctrl+C if it times out'), max_chars: n('output returned at most (the rest is saved to a file)') }, ['command']) },
  { name: 'term_read', annotations: ro, description: 'Read a terminal\'s output since a cursor (from term_run or an earlier read), cleaned of colours. Works on your own terminals and, read-only, on terminals in your group.', inputSchema: obj({ session: s('terminal id'), cursor: n('read after this point'), max_chars: n('limit'), raw: b('keep escape codes') }, ['session']) },
  { name: 'term_write', annotations: rw, description: 'Type text into a terminal (answers to questions, input for a running program). Add "\\r" to press Enter, or use term_keys.', inputSchema: obj({ session: s('terminal id'), text: s('text to type') }, ['session', 'text']) },
  { name: 'term_keys', annotations: rw, description: 'Press keys in a terminal: names like C-c, C-d, Enter, Tab, Escape, Up, Down, F5, M-x.', inputSchema: obj({ session: s('terminal id'), keys: { type: 'array', items: { type: 'string' } } }, ['session', 'keys']) },
  { name: 'term_wait', annotations: ro, description: 'Wait until a terminal\'s output matches a pattern, goes quiet for idle_ms, asks for input, or ends.', inputSchema: obj({ session: s('terminal id'), regex: s('pattern to wait for'), idle_ms: n('return after this much quiet'), timeout_seconds: n('default 60'), cursor: n('only output after this point') }, ['session']) },
  { name: 'term_list', annotations: ro, description: 'Your terminals as a tree (sub-workers under their parent) with status: idle, running, waiting (for input), exited.', inputSchema: obj({ all: b('include other agents\' terminals (read-only info)') }) },
  { name: 'term_snapshot', annotations: ro, description: 'What the terminal screen shows now, as text (useful for full-screen programs).', inputSchema: obj({ session: s('terminal id'), rows: n('rows from the bottom (default 40)') }, ['session']) },
  { name: 'term_resize', annotations: rw, description: 'Change a terminal\'s size.', inputSchema: obj({ session: s('terminal id'), cols: n('columns'), rows: n('rows') }, ['session', 'cols', 'rows']) },
  { name: 'term_close', annotations: { ...rw, destructiveHint: true }, description: 'Close a terminal (ending its program) and, by default, every sub-worker it started.', inputSchema: obj({ session: s('terminal id'), keep_children: b('leave its sub-workers running') }, ['session']) },
  { name: 'term_show', annotations: rw, description: 'Show a terminal to the person in Keeper (and optionally hand it over to them; you get it back when they return it).', inputSchema: obj({ session: s('terminal id'), hand_over: b('let the person take control') }, ['session']) },
];

export const HUB_TOOLS: ToolDef[] = [
  { name: 'hub_whoami', annotations: ro, description: 'Your identity in Keeper\'s agent hub (id, name, harness, account) and how many messages wait for you.', inputSchema: obj({}) },
  { name: 'hub_list_agents', annotations: ro, description: 'Agents in the hub (any tool or model, any account): name, harness, model, account, folder, status (idle, working, waiting, away) and what they are doing.', inputSchema: obj({ online: b('only those not away'), harness: s('only this harness') }) },
  { name: 'hub_set_status', annotations: rw, description: 'Tell others what you are doing.', inputSchema: obj({ status: { type: 'string', enum: ['idle', 'working', 'waiting'] }, doing: s('a short description') }) },
  { name: 'hub_send', annotations: rw, description: 'Send a direct message to another agent (by id or @name). Use in_reply_to to answer a question.', inputSchema: obj({ to: s('agent id or @name'), text: s('message'), in_reply_to: n('id of the message you answer') }, ['to', 'text']) },
  { name: 'hub_ask', annotations: rw, description: 'Ask another agent and wait for the answer (it replies with hub_send in_reply_to). Times out with no answer.', inputSchema: obj({ to: s('agent id or @name'), question: s('the question'), timeout_seconds: n('default 300') }, ['to', 'question']) },
  { name: 'hub_inbox', annotations: rw, description: 'Messages waiting for you (each is delivered once).', inputSchema: obj({ peek: b('leave them in the inbox') }) },
  { name: 'hub_post', annotations: rw, description: 'Post in a room (a shared channel, e.g. a project). @name mentions reach that agent\'s inbox; @all reaches everyone online. thread replies to a message.', inputSchema: obj({ room: s('room name'), text: s('message'), thread: n('message number this replies to') }, ['room', 'text']) },
  { name: 'hub_read', annotations: ro, description: 'Read a room\'s messages after a message number.', inputSchema: obj({ room: s('room name'), after: n('last message number you saw'), limit: n('default 50') }, ['room']) },
  { name: 'hub_rooms', annotations: ro, description: 'Rooms with how many messages each has.', inputSchema: obj({}) },
  { name: 'hub_post_task', annotations: rw, description: 'Put a task on the shared board, optionally for a specific agent or only for certain harnesses.', inputSchema: obj({ title: s('short title'), detail: s('what to do'), room: s('room to report progress in'), assignee: s('agent id or @name'), for_harness: { type: 'array', items: { type: 'string' } } }, ['title']) },
  { name: 'hub_tasks', annotations: ro, description: 'The task board.', inputSchema: obj({ status: { type: 'string', enum: ['open', 'claimed', 'done', 'failed', 'cancelled'] }, mine: b('only tasks assigned to you'), room: s('only this room') }) },
  { name: 'hub_claim', annotations: rw, description: 'Claim an open task (only one agent wins).', inputSchema: obj({ task_id: s('e.g. T3') }, ['task_id']) },
  { name: 'hub_complete', annotations: rw, description: 'Finish your task with its result (or mark it failed).', inputSchema: obj({ task_id: s('e.g. T3'), result: s('what you did / found'), failed: b('it could not be done') }, ['task_id', 'result']) },
  { name: 'hub_handoff', annotations: rw, description: 'Hand your task to another agent (any harness or account) with what it needs to carry on.', inputSchema: obj({ task_id: s('e.g. T3'), to: s('agent id or @name'), summary: s('where it stands'), files: { type: 'array', items: { type: 'string' } }, notes: s('anything else'), scratch: { type: 'array', items: { type: 'string' } }, include_output_of: s('terminal id whose last output to attach') }, ['task_id', 'to', 'summary']) },
  { name: 'hub_lock', annotations: rw, description: 'Take an advisory lock (e.g. a file or folder path, "database") so others wait; released when your terminal ends or the lease runs out.', inputSchema: obj({ name: s('what to lock'), lease_seconds: n('default 120'), wait_seconds: n('wait this long if someone holds it (default 0)'), session: s('your terminal id (lock ends with it)') }, ['name']) },
  { name: 'hub_unlock', annotations: rw, description: 'Release a lock you hold.', inputSchema: obj({ name: s('what was locked') }, ['name']) },
  { name: 'hub_locks', annotations: ro, description: 'Locks held now and by whom.', inputSchema: obj({}) },
  { name: 'hub_scratch_put', annotations: rw, description: 'Write a shared note on your group\'s board. if_version prevents overwriting someone else\'s newer write.', inputSchema: obj({ group: s('board name (default: shared)'), key: s('note name'), value: { description: 'text or JSON' }, if_version: n('only if the note is still at this version') }, ['key', 'value']) },
  { name: 'hub_scratch_get', annotations: ro, description: 'Read shared notes (one key, or the whole board).', inputSchema: obj({ group: s('board name (default: shared)'), key: s('note name') }) },
  { name: 'hub_wait', annotations: ro, description: 'Wait for the next event: a message or mention for you, a task change, a command finishing, a terminal ending or asking for input, a lock freeing.', inputSchema: obj({ kinds: { type: 'array', items: { type: 'string', enum: ['message', 'mail', 'command-finished', 'session-exited', 'session-created', 'waiting-for-input', 'lock', 'pattern'] } }, session: s('only events about this terminal'), room: s('only this room'), timeout_seconds: n('default 60') }) },
];

export const AGENT_TOOLS = [...TERM_TOOLS, ...HUB_TOOLS];
export const isTermTool = (name: string) => name.startsWith('term_');
export const isHubTool = (name: string) => name.startsWith('hub_');

export interface ToolContext {
  terms: AgentTerminals;
  hub: AgentHub;
  /** the hub agent calling (undefined for clients not in the hub yet) */
  agentId?: string;
  /** shows a terminal in Keeper */
  show?(session: string): void;
}

export interface ToolResult {
  text: string;
  isError?: boolean;
  structured?: unknown;
}

const str = (v: unknown) => (v === undefined || v === null ? undefined : String(v));
const num = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : Number(v));

const runText = (r: { status: string; exitCode?: number; output: string; truncated: boolean; savedTo?: string; durationMs: number; session: string; prompt?: string }) =>
  [
    `[${r.session}] ${r.status}${r.exitCode !== undefined ? ` · exit ${r.exitCode}` : ''} · ${(r.durationMs / 1000).toFixed(1)} s${r.truncated ? ' · output shortened' : ''}${r.savedTo ? ` (full output: ${r.savedTo})` : ''}`,
    r.prompt ? `It is waiting for input: ${r.prompt}` : '',
    r.output,
  ].filter(Boolean).join('\n');

/** Runs one tool for a caller. Permission checks happen before this (in the app). */
export async function callAgentTool(ctx: ToolContext, name: string, a: Record<string, unknown>): Promise<ToolResult> {
  const me = ctx.agentId;
  const owner = me ? `agent:${me}` : 'agent:unknown';
  const { terms, hub } = ctx;
  const need = () => {
    if (!me) throw new Error('Join the hub first: this tool needs an agent identity (Keeper gives one to agents it starts; others are asked about once).');
    return me;
  };
  const readable = (id: string) => {
    const t = terms.get(id);
    if (!t) throw new Error(`No agent terminal ${id}`);
    const mine = terms.get(id)!.owner === owner;
    const myTerms = terms.list(owner);
    const sameGroup = !!t.group && myTerms.some((x) => x.group === t.group);
    if (!mine && !sameGroup) throw new Error('That terminal belongs to another agent and is not in your group');
    return t;
  };
  const writable = (id: string) => {
    const t = terms.get(id);
    if (!t) throw new Error(`No agent terminal ${id}`);
    if (t.owner !== owner) throw new Error('That terminal belongs to another agent; ask it (hub_send) or work in your own');
    return t;
  };
  switch (name) {
    // ---------------------------------------------------------------- terminals
    case 'term_create': {
      const t = await terms.create(owner, { name: str(a.name), cwd: str(a.cwd), parent: str(a.parent), group: str(a.group), ttlMs: num(a.ttl_minutes) !== undefined ? Number(a.ttl_minutes) * 60_000 : undefined, env: (a.env as Record<string, string>) ?? undefined, profileId: str(a.profile), headless: !!a.headless, ci: !!a.ci });
      if (me) hub.seen(me, 'working');
      return { text: `Opened terminal ${t.id} (${t.name}) in ${t.cwd ?? 'the home folder'}${t.parent ? `, a sub-worker of ${t.parent}` : ''}${t.deadline ? `; it closes by itself at ${new Date(t.deadline).toISOString()}` : ''}.`, structured: t };
    }
    case 'term_run': {
      let id = str(a.session);
      if (!id || id === 'new') id = (await terms.create(owner, { name: String(a.command).slice(0, 40) })).id;
      writable(id);
      const o: RunOptions = { wait: (str(a.wait) as RunOptions['wait']) ?? 'exit', regex: str(a.regex), timeoutMs: num(a.timeout_seconds) !== undefined ? Number(a.timeout_seconds) * 1000 : undefined, stdin: str(a.stdin), interruptOnTimeout: !!a.interrupt_on_timeout, maxChars: num(a.max_chars) };
      const r = await terms.run(id, owner, String(a.command ?? ''), o);
      return { text: runText(r), structured: r, isError: r.status === 'done' && (r.exitCode ?? 0) !== 0 ? false : undefined };
    }
    case 'term_read': {
      const id = String(a.session);
      readable(id);
      const r = terms.read(id, owner, { cursor: num(a.cursor), maxChars: num(a.max_chars), raw: !!a.raw });
      return { text: `[${id}] ${r.status}${r.missed ? ' · some older output is gone' : ''} · cursor ${r.cursor}\n${r.text}`, structured: { cursor: r.cursor, status: r.status, truncated: r.truncated } };
    }
    case 'term_write': {
      const id = String(a.session);
      writable(id);
      terms.write(id, owner, String(a.text ?? ''));
      return { text: 'Typed.' };
    }
    case 'term_keys': {
      const id = String(a.session);
      writable(id);
      terms.keys(id, owner, Array.isArray(a.keys) ? a.keys.map(String) : []);
      return { text: 'Pressed.' };
    }
    case 'term_wait': {
      const id = String(a.session);
      readable(id);
      const r = await terms.wait(id, owner, { regex: str(a.regex), idleMs: num(a.idle_ms), timeoutMs: num(a.timeout_seconds) !== undefined ? Number(a.timeout_seconds) * 1000 : undefined, cursor: num(a.cursor) });
      return { text: `${r.status}${r.match ? `: ${r.match}` : ''}${r.prompt ? ` — asks: ${r.prompt}` : ''} (cursor ${r.cursor})`, structured: r };
    }
    case 'term_list': {
      const tree = terms.tree(a.all ? undefined : owner);
      const line = (t: ReturnType<AgentTerminals['tree']>[number], depth: number): string[] => [
        `${'  '.repeat(depth)}${t.id} ${t.name} · ${t.status}${t.running ? ` (${t.running.slice(0, 60)})` : ''}${t.controller === 'human' ? ' · taken over by the person' : ''}${a.all && t.owner !== owner ? ` · ${t.owner.replace(/^agent:/, '')}` : ''}`,
        ...t.sub.flatMap((c) => line(c, depth + 1)),
      ];
      return { text: tree.flatMap((t) => line(t, 0)).join('\n') || 'No terminals.', structured: tree };
    }
    case 'term_snapshot': {
      const id = String(a.session);
      readable(id);
      return { text: terms.snapshot(id, owner, num(a.rows) ?? 40) };
    }
    case 'term_resize': {
      const id = String(a.session);
      writable(id);
      terms.resize(id, owner, Number(a.cols), Number(a.rows));
      return { text: 'Resized.' };
    }
    case 'term_close': {
      const id = String(a.session);
      writable(id);
      const closed = await terms.close(id, { cascade: !a.keep_children, by: owner, reason: 'closed by the agent' });
      return { text: `Closed ${closed.join(', ')}.` };
    }
    case 'term_show': {
      const id = String(a.session);
      writable(id);
      ctx.show?.(id);
      if (a.hand_over) terms.handoff(id, 'human', owner.replace('agent:', 'human-requested-by:'));
      return { text: a.hand_over ? 'Shown and handed to the person; you get it back when they return it.' : 'Shown to the person.' };
    }

    // ---------------------------------------------------------------- hub
    case 'hub_whoami': {
      const ag = me ? hub.get(me) : undefined;
      if (!ag) return { text: 'You are not in the hub yet. Ask the person to open you from Keeper, or approve this app in Keeper.' };
      return { text: `${ag.name} (id ${ag.id}) · ${ag.harness}${ag.model ? ` · ${ag.model}` : ''}${ag.account ? ` · account ${ag.account}` : ''} · ${hub.bus.pendingMail(ag.id)} message(s) waiting`, structured: ag };
    }
    case 'hub_list_agents': {
      const list = hub.list({ online: !!a.online, harness: str(a.harness) }).filter((x) => x.harness !== 'human' || a.online === undefined || true);
      return { text: list.map((x) => `@${x.id} ${x.name} · ${x.harness}${x.model ? `/${x.model}` : ''}${x.account ? ` · ${x.account}` : ''} · ${x.status}${x.doing ? ` (${x.doing})` : ''}${x.folder ? ` · ${x.folder}` : ''}${x.approved ? '' : ' · not approved yet'}`).join('\n') || 'Nobody else is here.', structured: list };
    }
    case 'hub_set_status':
      hub.seen(need(), (str(a.status) as 'idle') ?? undefined, str(a.doing));
      return { text: 'Updated.' };
    case 'hub_send': {
      const m = hub.send(need(), String(a.to), String(a.text ?? ''), { inReplyTo: num(a.in_reply_to) });
      return { text: `Sent (message ${m.id}).`, structured: m };
    }
    case 'hub_ask': {
      const r = await hub.ask(need(), String(a.to), String(a.question ?? ''), (num(a.timeout_seconds) ?? 300) * 1000);
      return r ? { text: `${hub.get(r.from)?.name ?? r.from}: ${r.text}`, structured: r } : { text: 'No answer before the time ran out.', isError: true };
    }
    case 'hub_inbox': {
      const list = hub.inbox(need(), !!a.peek);
      return { text: list.map((m) => `#${m.id} from @${m.from} (${new Date(m.at).toISOString()}): ${m.text}`).join('\n\n') || 'No messages.', structured: list };
    }
    case 'hub_post': {
      const m = hub.post(need(), String(a.room), String(a.text ?? ''), { thread: num(a.thread) });
      return { text: `Posted in #${m.channel} (message ${m.seq}).`, structured: m };
    }
    case 'hub_read': {
      const list = hub.bus.read(String(a.room), num(a.after) ?? 0, num(a.limit) ?? 50);
      if (me) hub.seen(me);
      return { text: list.map((m) => `${m.seq} @${m.from}${(m.data as { thread?: number } | undefined)?.thread ? ` ↳${(m.data as { thread: number }).thread}` : ''}: ${m.text}`).join('\n') || 'Nothing new.', structured: list };
    }
    case 'hub_rooms':
      return { text: hub.bus.channelNames().map((c) => `#${c.name} · ${c.count} messages`).join('\n') || 'No rooms yet; hub_post creates one.' };
    case 'hub_post_task': {
      const t = hub.postTask(need(), { title: String(a.title), detail: str(a.detail), room: str(a.room), assignee: str(a.assignee), forHarness: Array.isArray(a.for_harness) ? a.for_harness.map(String) : undefined });
      return { text: `Posted task ${t.id}${t.assignee ? ` for @${t.assignee}` : ''}.`, structured: t };
    }
    case 'hub_tasks': {
      const list = hub.taskList({ status: str(a.status) as never, assignee: a.mine ? me : undefined, room: str(a.room) });
      return { text: list.map((t) => `${t.id} [${t.status}] ${t.title}${t.assignee ? ` · @${t.assignee}` : ''}${t.forHarness ? ` · for ${t.forHarness.join('/')}` : ''}${t.result ? `\n    result: ${t.result.slice(0, 200)}` : ''}`).join('\n') || 'The board is empty.', structured: list };
    }
    case 'hub_claim': {
      const t = hub.claim(need(), String(a.task_id));
      return { text: `You have ${t.id}: ${t.title}${t.detail ? `\n\n${t.detail}` : ''}${t.context ? `\n\nContext: ${t.context.summary}` : ''}`, structured: t };
    }
    case 'hub_complete': {
      const t = hub.complete(need(), String(a.task_id), String(a.result ?? ''), !!a.failed);
      return { text: `${t.id} marked ${t.status}.` };
    }
    case 'hub_handoff': {
      const bundle: ContextBundle = { summary: String(a.summary ?? ''), files: Array.isArray(a.files) ? a.files.map(String) : undefined, notes: str(a.notes), scratch: Array.isArray(a.scratch) ? a.scratch.map(String) : undefined };
      const from = str(a.include_output_of);
      if (from) bundle.output = terms.read(readable(from).id, owner, { maxChars: 6000 }).text;
      const t = hub.handoff(need(), String(a.task_id), String(a.to), bundle);
      return { text: `${t.id} is now with @${t.assignee}.` };
    }
    case 'hub_lock': {
      const holder = need();
      const lease = (num(a.lease_seconds) ?? 120) * 1000;
      const r = (num(a.wait_seconds) ?? 0) > 0
        ? await hub.bus.acquireWait(String(a.name), holder, lease, Number(a.wait_seconds) * 1000, str(a.session))
        : hub.bus.acquire(String(a.name), holder, lease, str(a.session));
      return r.ok ? { text: `Locked “${r.lock.name}” until ${new Date(r.lock.expires).toISOString()}.`, structured: r.lock } : { text: `“${r.heldBy.name}” is held by @${r.heldBy.holder} until ${new Date(r.heldBy.expires).toISOString()}.`, isError: true, structured: r.heldBy };
    }
    case 'hub_unlock':
      return hub.bus.release(String(a.name), need()) ? { text: 'Released.' } : { text: 'You do not hold that lock.', isError: true };
    case 'hub_locks':
      return { text: hub.bus.lockList().map((l) => `${l.name} · @${l.holder} · until ${new Date(l.expires).toISOString()}`).join('\n') || 'No locks.' };
    case 'hub_scratch_put': {
      const r = hub.bus.put(str(a.group) ?? 'shared', String(a.key), a.value, need(), num(a.if_version));
      return r.ok ? { text: `Saved (version ${r.entry!.version}).` } : { text: `Not saved: it changed (now version ${r.current?.version ?? 0} by @${r.current?.by ?? '?'}). Read it again first.`, isError: true, structured: r.current };
    }
    case 'hub_scratch_get': {
      const v = hub.bus.get(str(a.group) ?? 'shared', str(a.key));
      return { text: JSON.stringify(v ?? null, null, 2).slice(0, 20_000), structured: v };
    }
    case 'hub_wait': {
      const kinds = Array.isArray(a.kinds) ? (a.kinds.map(String) as never[]) : undefined;
      const e = await hub.bus.waitFor({ kinds, session: str(a.session) ?? (kinds?.includes('mail' as never) ? me : undefined), channel: str(a.room) }, (num(a.timeout_seconds) ?? 60) * 1000);
      return e ? { text: JSON.stringify(e), structured: e } : { text: 'Nothing happened before the time ran out.' };
    }
  }
  return { text: `Unknown tool ${name}`, isError: true };
}
