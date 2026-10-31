// SPDX-License-Identifier: AGPL-3.0-or-later
// Keeper as an agent for editors that speak the Agent Client Protocol: the
// editor starts `keeper acp` and talks JSON-RPC over stdio. A session is a
// conversation with Keeper's assistant; answers stream back as
// `session/update` notifications. Pure: the app (or the CLI) supplies `ask`.

import type { JsonRpcRequest, JsonRpcResponse } from './mcp';

export const ACP_VERSION = 1;

export interface AcpBackend {
  ask(question: string, opts: { signal: AbortSignal; onDelta: (t: string) => void; cwd?: string; history?: unknown }): Promise<{ answer: string; history?: unknown; stop?: string }>;
  newId(): string;
  version: string;
}

type Block = { type: string; text?: string; resource?: { uri?: string; text?: string }; uri?: string; name?: string };

/** The text of a prompt: typed text, plus any files the editor attached. */
export function promptText(blocks: Block[]): string {
  return blocks.map((b) => {
    if (b.type === 'text') return b.text ?? '';
    if (b.type === 'resource' && b.resource?.text) return `\n<file ${b.resource.uri ?? ''}>\n${b.resource.text}\n</file>`;
    if (b.type === 'resource_link') return `\n(file: ${b.uri ?? b.name ?? ''})`;
    return '';
  }).join('').trim();
}

export class AcpAgent {
  private sessions = new Map<string, { cwd?: string; history?: unknown; ctrl?: AbortController }>();

  constructor(private b: AcpBackend, private notify: (method: string, params: unknown) => void) {}

  async handle(msg: JsonRpcRequest): Promise<JsonRpcResponse | undefined> {
    const id = msg.id ?? null;
    const ok = (result: unknown): JsonRpcResponse => ({ jsonrpc: '2.0', id, result });
    const fail = (code: number, message: string): JsonRpcResponse => ({ jsonrpc: '2.0', id, error: { code, message } });
    const p = (msg.params ?? {}) as Record<string, unknown>;
    switch (msg.method) {
      case 'initialize':
        return ok({
          protocolVersion: ACP_VERSION,
          agentCapabilities: { loadSession: false, promptCapabilities: { image: false, audio: false, embeddedContext: true }, mcpCapabilities: { http: false, sse: false } },
          agentInfo: { name: 'keeper', title: 'Keeper', version: this.b.version },
          authMethods: [],
        });
      case 'authenticate':
        return ok({});
      case 'session/new': {
        const sid = `sess_${this.b.newId()}`;
        this.sessions.set(sid, { cwd: typeof p.cwd === 'string' ? p.cwd : undefined });
        return ok({ sessionId: sid });
      }
      case 'session/prompt': {
        const sid = String(p.sessionId ?? '');
        const s = this.sessions.get(sid);
        if (!s) return fail(-32602, 'Unknown session');
        const text = promptText(Array.isArray(p.prompt) ? (p.prompt as Block[]) : []);
        if (!text) return ok({ stopReason: 'end_turn' });
        s.ctrl = new AbortController();
        const messageId = `msg_${this.b.newId()}`;
        try {
          const r = await this.b.ask(text, {
            signal: s.ctrl.signal, cwd: s.cwd, history: s.history,
            onDelta: (t) => this.notify('session/update', { sessionId: sid, update: { sessionUpdate: 'agent_message_chunk', messageId, content: { type: 'text', text: t } } }),
          });
          s.history = r.history;
          return ok({ stopReason: r.stop === 'refusal' ? 'refusal' : r.stop === 'length' ? 'max_tokens' : 'end_turn' });
        } catch (e) {
          if (s.ctrl.signal.aborted) return ok({ stopReason: 'cancelled' });
          return fail(-32603, e instanceof Error ? e.message : String(e));
        } finally {
          s.ctrl = undefined;
        }
      }
      case 'session/cancel':
        this.sessions.get(String(p.sessionId ?? ''))?.ctrl?.abort();
        return undefined;
      default:
        return msg.id === undefined ? undefined : fail(-32601, `Method not found: ${msg.method}`);
    }
  }
}
