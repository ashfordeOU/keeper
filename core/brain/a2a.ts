// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Agent-to-agent: other agents can hand Keeper a task ("find the lease and
// tell me when it ends") over the A2A protocol's JSON-RPC binding, and read
// Keeper's Agent Card to learn what it can do. Version 1.0 method names are
// used, with the older 0.3 names accepted too. Pure: the app supplies `ask`.

import type { JsonRpcRequest, JsonRpcResponse } from './mcp';

export const A2A_VERSION = '1.0';

export interface A2APart {
  text?: string;
  data?: unknown;
  url?: string;
  mediaType?: string;
  /** 0.3 style */
  kind?: string;
}

export interface A2AMessage {
  messageId: string;
  role: string;
  parts: A2APart[];
  contextId?: string;
  taskId?: string;
}

export type TaskState = 'submitted' | 'working' | 'completed' | 'failed' | 'canceled' | 'rejected' | 'input-required';

export interface A2ATask {
  id: string;
  contextId: string;
  status: { state: TaskState; timestamp: string; message?: A2AMessage };
  artifacts: { artifactId: string; name?: string; parts: A2APart[] }[];
  history: A2AMessage[];
}

export function agentCard(o: { url: string; version: string; name: string; skills: { id: string; name: string; description: string }[] }) {
  return {
    name: o.name,
    description: 'Keeper knows the files on this computer: what is in them, where they came from, and how they relate. Ask it to find, read, summarise or explain files; changes are only ever suggested.',
    version: o.version,
    protocolVersion: A2A_VERSION,
    supportedInterfaces: [{ url: o.url, protocolBinding: 'JSONRPC', protocolVersion: A2A_VERSION }],
    // 0.3 clients read these two.
    url: o.url,
    preferredTransport: 'JSONRPC',
    provider: { organization: 'Ashforde OÜ', url: 'https://github.com/ashfordeOU/keeper' },
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain', 'application/json'],
    securitySchemes: { bearer: { httpAuthSecurityScheme: { scheme: 'Bearer' }, type: 'http', scheme: 'bearer' } },
    security: [{ bearer: [] }],
    skills: [
      { id: 'find-files', name: 'Find files', description: 'Search by words, meaning, kind, date and download source.', tags: ['files', 'search'], examples: ['find the PDF invoices from last month'] },
      { id: 'answer-from-files', name: 'Answer from files', description: 'Answer questions from what is inside the person\'s documents, with the files cited.', tags: ['files', 'qa'], examples: ['when does my apartment lease end?'] },
      ...o.skills.map((s) => ({ id: s.id, name: s.name, description: s.description, tags: ['skill'] })),
    ],
  };
}

const V1_STATE: Record<TaskState, string> = {
  submitted: 'TASK_STATE_SUBMITTED', working: 'TASK_STATE_WORKING', completed: 'TASK_STATE_COMPLETED', failed: 'TASK_STATE_FAILED',
  canceled: 'TASK_STATE_CANCELED', rejected: 'TASK_STATE_REJECTED', 'input-required': 'TASK_STATE_INPUT_REQUIRED',
};

const textOf = (m: A2AMessage | undefined) => (m?.parts ?? []).map((p) => p.text ?? (p.data !== undefined ? JSON.stringify(p.data) : '')).join('\n').trim();

export interface A2ABackend {
  ask(question: string, signal: AbortSignal): Promise<{ answer: string; sources: string[] }>;
  newId(): string;
  now(): number;
}

export class A2AServer {
  private tasks = new Map<string, A2ATask>();
  private running = new Map<string, AbortController>();

  constructor(private b: A2ABackend) {}

  /** Wire form for the version the client speaks. */
  private wire(t: A2ATask, v1: boolean) {
    if (!v1) return { kind: 'task', ...t, artifacts: t.artifacts.map((a) => ({ ...a, parts: a.parts.map((p) => ({ kind: p.data !== undefined ? 'data' : 'text', ...p })) })) };
    const role = (m: A2AMessage) => ({ ...m, role: m.role === 'agent' || m.role === 'ROLE_AGENT' ? 'ROLE_AGENT' : 'ROLE_USER' });
    return { ...t, status: { ...t.status, state: V1_STATE[t.status.state], ...(t.status.message ? { message: role(t.status.message) } : {}) }, history: t.history.map(role) };
  }

  async handle(msg: JsonRpcRequest, version: string): Promise<JsonRpcResponse> {
    const id = msg.id ?? null;
    const v1 = version.startsWith('1');
    const ok = (result: unknown): JsonRpcResponse => ({ jsonrpc: '2.0', id, result });
    const fail = (code: number, message: string): JsonRpcResponse => ({ jsonrpc: '2.0', id, error: { code, message } });
    if (!msg || msg.jsonrpc !== '2.0') return fail(-32600, 'Invalid request');
    if (version && !/^(0\.3|1\.\d+)$/.test(version)) return fail(-32009, `A2A version ${version} is not supported`);
    const p = (msg.params ?? {}) as Record<string, unknown>;
    switch (msg.method) {
      case 'SendMessage':
      case 'message/send': {
        const m = p.message as A2AMessage | undefined;
        if (!m || !Array.isArray(m.parts)) return fail(-32602, 'params.message with parts is required');
        const question = textOf(m);
        if (!question) return fail(-32005, 'Only text (or data) parts are supported');
        const taskId = m.taskId && this.tasks.has(m.taskId) ? m.taskId : this.b.newId();
        const t: A2ATask = this.tasks.get(taskId) ?? { id: taskId, contextId: m.contextId ?? this.b.newId(), status: { state: 'submitted', timestamp: new Date(this.b.now()).toISOString() }, artifacts: [], history: [] };
        t.history.push({ ...m, role: 'user', taskId, contextId: t.contextId });
        t.status = { state: 'working', timestamp: new Date(this.b.now()).toISOString() };
        this.tasks.set(taskId, t);
        const ctrl = new AbortController();
        this.running.set(taskId, ctrl);
        try {
          const r = await this.b.ask(question, ctrl.signal);
          const reply: A2AMessage = { messageId: this.b.newId(), role: 'agent', parts: [{ text: r.answer }], taskId, contextId: t.contextId };
          t.history.push(reply);
          t.artifacts.push({ artifactId: this.b.newId(), name: 'answer', parts: [{ text: r.answer }, { data: { sources: r.sources }, mediaType: 'application/json' }] });
          t.status = { state: 'completed', timestamp: new Date(this.b.now()).toISOString(), message: reply };
        } catch (e) {
          const canceled = ctrl.signal.aborted;
          t.status = { state: canceled ? 'canceled' : 'failed', timestamp: new Date(this.b.now()).toISOString(), message: { messageId: this.b.newId(), role: 'agent', parts: [{ text: canceled ? 'Canceled' : e instanceof Error ? e.message : String(e) }] } };
        } finally {
          this.running.delete(taskId);
        }
        return ok(v1 ? { task: this.wire(t, true) } : this.wire(t, false));
      }
      case 'GetTask':
      case 'tasks/get': {
        const t = this.tasks.get(String(p.id ?? p.name ?? '').replace(/^tasks\//, ''));
        return t ? ok(this.wire(t, v1)) : fail(-32001, 'Task not found');
      }
      case 'ListTasks': {
        return ok({ tasks: [...this.tasks.values()].slice(-50).map((t) => this.wire(t, true)), nextPageToken: '' });
      }
      case 'CancelTask':
      case 'tasks/cancel': {
        const tid = String(p.id ?? p.name ?? '').replace(/^tasks\//, '');
        const t = this.tasks.get(tid);
        if (!t) return fail(-32001, 'Task not found');
        const c = this.running.get(tid);
        if (!c) return fail(-32002, 'The task has already finished');
        c.abort();
        return ok(this.wire(t, v1));
      }
      case 'SendStreamingMessage':
      case 'message/stream':
      case 'SubscribeToTask':
        return fail(-32004, 'Streaming is not supported; use SendMessage');
      default:
        return fail(-32601, `Method not found: ${msg.method}`);
    }
  }
}
