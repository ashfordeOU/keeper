// SPDX-License-Identifier: AGPL-3.0-or-later
// Keeper as a Model Context Protocol server, so any AI app that speaks MCP
// (desktop chat apps, code editors, the operating system's agent hosts) can
// search and read the person's files through Keeper's brain, with the same
// limits as Keeper's own assistant: only the indexed folders, nothing
// excluded, secrets blanked, and changes only ever suggested.
//
// The protocol is JSON-RPC 2.0. This file handles messages; the transports
// (stdio for `keeper mcp`, Streamable HTTP on 127.0.0.1) only move them.

import type { BrainHit } from '../brain-contract';
import { Harness, harnessTools, type HarnessEnv } from './harness';
import type { ChatProvider } from './providers';

export const MCP_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface McpBackend {
  env: HarnessEnv;
  /** answers with the person's own AI; undefined when none is set up */
  ask?(question: string): Promise<{ answer: string; sources: BrainHit[] }>;
  savedSearches?(): { id: string; name: string; text: string }[];
  status?(): Record<string, unknown>;
  version: string;
  /** blank secrets in results (default on: MCP clients usually send what they read to a cloud model) */
  redact?: boolean;
  /** more tools: agent actions (each behind the person's permission), skills, the knowledge graph */
  extraTools?(): McpTool[];
  callExtra?(name: string, args: Record<string, unknown>, client: string): Promise<{ text: string; isError?: boolean; structured?: unknown }>;
  /** skills offered to agents as prompts */
  prompts?: { list(): { name: string; description: string }[]; get(name: string): string | undefined };
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; openWorldHint?: boolean; title?: string };
}

const INSTRUCTIONS = 'Keeper has indexed the files on this computer (names, folders, dates, download sources, and the text inside documents, PDFs and screenshots). Use search_files first, then read_file for the parts you need. Cite exact paths. Changes are only suggested to the person inside Keeper; this server never moves or deletes anything.';

/** A provider stand-in so the harness's tool code can run without an AI. */
function toolOnly(local: boolean): ChatProvider {
  return { id: 'mcp', label: 'MCP client', model: '', local, supportsTools: true, contextTokens: 200_000, chat: async () => ({ text: '', toolCalls: [], stop: 'end' }) };
}

export class McpServer {
  private initialized = false;
  clientInfo?: { name?: string; version?: string };

  constructor(private backend: McpBackend) {}

  private tools() {
    const list = harnessTools(this.backend.env)
      .filter((t) => t.name !== 'propose_actions')
      .map((t) => ({ name: t.name, description: t.description, inputSchema: t.parameters, annotations: { readOnlyHint: true, openWorldHint: false } }));
    if (this.backend.ask) {
      list.push({
        name: 'ask_keeper',
        description: 'Ask Keeper\'s own assistant a question about the files; it searches and reads as needed and answers with cited paths. Uses the AI the person set up in Keeper.',
        inputSchema: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] },
        annotations: { readOnlyHint: true, openWorldHint: true },
      });
    }
    for (const t of this.backend.extraTools?.() ?? []) if (!list.some((x) => x.name === t.name)) list.push(t as (typeof list)[number]);
    return list;
  }

  /** Handles one message; returns undefined for notifications. */
  async handle(msg: JsonRpcRequest): Promise<JsonRpcResponse | undefined> {
    const id = msg.id ?? null;
    const isNotification = msg.id === undefined;
    const ok = (result: unknown): JsonRpcResponse => ({ jsonrpc: '2.0', id, result });
    const fail = (code: number, message: string): JsonRpcResponse => ({ jsonrpc: '2.0', id, error: { code, message } });
    if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return fail(-32600, 'Invalid request');
    try {
      switch (msg.method) {
        case 'initialize': {
          const asked = String(msg.params?.protocolVersion ?? '');
          this.clientInfo = msg.params?.clientInfo as McpServer['clientInfo'];
          this.initialized = true;
          return ok({
            protocolVersion: MCP_VERSIONS.includes(asked) ? asked : MCP_VERSIONS[0],
            capabilities: { tools: { listChanged: false }, resources: { listChanged: false, subscribe: false }, logging: {}, ...(this.backend.prompts ? { prompts: { listChanged: false } } : {}) },
            serverInfo: { name: 'keeper', title: 'Keeper', version: this.backend.version },
            instructions: (this.backend.extraTools?.() ?? []).some((t) => t.annotations?.readOnlyHint === false)
              ? INSTRUCTIONS.replace('Changes are only suggested to the person inside Keeper; this server never moves or deletes anything.', 'Tools that change things (move, rename, tag, Trash, open, quit) run only with the person\'s permission; Keeper may ask them first, so a call can take a while or be declined. Files only ever go to the Trash, and changes can be undone with undo_last.')
              : INSTRUCTIONS,
          });
        }
        case 'notifications/initialized':
        case 'notifications/cancelled':
          return undefined;
        case 'ping':
          return ok({});
        case 'logging/setLevel':
          return ok({});
        case 'tools/list':
          return ok({ tools: this.tools() });
        case 'tools/call':
          return ok(await this.callTool(String(msg.params?.name ?? ''), (msg.params?.arguments ?? {}) as Record<string, unknown>));
        case 'resources/list': {
          const saved = this.backend.savedSearches?.() ?? [];
          return ok({
            resources: [
              { uri: 'keeper://status', name: 'status', title: 'Keeper index status', mimeType: 'application/json' },
              ...saved.map((s) => ({ uri: `keeper://saved/${encodeURIComponent(s.id)}`, name: s.name, title: `Saved search: ${s.name}`, description: s.text, mimeType: 'text/plain' })),
            ],
          });
        }
        case 'resources/templates/list':
          return ok({ resourceTemplates: [{ uriTemplate: 'keeper://search/{query}', name: 'search', title: 'Search Keeper', mimeType: 'text/plain' }] });
        case 'resources/read': {
          const uri = String(msg.params?.uri ?? '');
          let text: string;
          let mimeType = 'text/plain';
          if (uri === 'keeper://status') { text = JSON.stringify(this.backend.status?.() ?? {}, null, 1); mimeType = 'application/json'; }
          else if (uri.startsWith('keeper://saved/')) {
            const s = (this.backend.savedSearches?.() ?? []).find((x) => x.id === decodeURIComponent(uri.slice('keeper://saved/'.length)));
            if (!s) return fail(-32002, 'Resource not found');
            text = (await this.callTool('search_files', { query: s.text, limit: 30 })).content[0].text;
          } else if (uri.startsWith('keeper://search/')) {
            text = (await this.callTool('search_files', { query: decodeURIComponent(uri.slice('keeper://search/'.length)), limit: 20 })).content[0].text;
          } else return fail(-32002, 'Resource not found');
          return ok({ contents: [{ uri, mimeType, text }] });
        }
        case 'prompts/list':
          return ok({ prompts: (this.backend.prompts?.list() ?? []).map((p) => ({ name: p.name, description: p.description })) });
        case 'prompts/get': {
          const body = this.backend.prompts?.get(String(msg.params?.name ?? ''));
          if (body === undefined) return fail(-32602, 'Unknown prompt');
          return ok({ description: (this.backend.prompts?.list() ?? []).find((p) => p.name === msg.params?.name)?.description, messages: [{ role: 'user', content: { type: 'text', text: body } }] });
        }
        default:
          return isNotification ? undefined : fail(-32601, `Method not found: ${msg.method}`);
      }
    } catch (e) {
      return fail(-32603, e instanceof Error ? e.message : String(e));
    }
  }

  get ready(): boolean {
    return this.initialized;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<{ content: { type: 'text'; text: string }[]; isError?: boolean; structuredContent?: unknown }> {
    if (name === 'ask_keeper') {
      if (!this.backend.ask) return { content: [{ type: 'text', text: 'No AI is set up in Keeper. Use search_files and read_file instead.' }], isError: true };
      const r = await this.backend.ask(String(args.question ?? ''));
      return { content: [{ type: 'text', text: r.answer + (r.sources.length ? `\n\nSources:\n${r.sources.map((s) => `- ${s.path}`).join('\n')}` : '') }], structuredContent: { answer: r.answer, sources: r.sources.map((s) => s.path) } };
    }
    if (this.backend.callExtra && (this.backend.extraTools?.() ?? []).some((t) => t.name === name)) {
      const r = await this.backend.callExtra(name, args, this.clientInfo?.name ?? 'an AI app');
      return { content: [{ type: 'text', text: r.text }], ...(r.isError ? { isError: true } : {}), ...(r.structured !== undefined ? { structuredContent: r.structured } : {}) };
    }
    if (name === 'propose_actions' || !this.tools().some((t) => t.name === name)) return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    const h = new Harness(toolOnly(this.backend.redact === false), this.backend.env);
    try {
      const r = await h.runTool({ id: 'mcp', name, args }, []);
      // Same secret filter as Keeper's own assistant uses for cloud AIs.
      const text = h.clean(r.content);
      return { content: [{ type: 'text', text }] };
    } catch (e) {
      return { content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }], isError: true };
    }
  }
}

/** Newline-delimited JSON over a pair of streams (stdio for `keeper mcp`). */
export function serveLines(server: McpServer, input: NodeJS.ReadableStream, write: (line: string) => void): Promise<void> {
  return new Promise((resolve) => {
    let buf = '';
    let queue = Promise.resolve();
    const onLine = (line: string) => {
      if (!line.trim()) return;
      let msg: JsonRpcRequest | JsonRpcRequest[];
      try {
        msg = JSON.parse(line);
      } catch {
        write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }));
        return;
      }
      // Answers go out in order.
      queue = queue.then(async () => {
        if (Array.isArray(msg)) {
          const out = (await Promise.all(msg.map((m) => server.handle(m)))).filter(Boolean);
          if (out.length) write(JSON.stringify(out));
        } else {
          const r = await server.handle(msg);
          if (r) write(JSON.stringify(r));
        }
      });
    };
    input.setEncoding?.('utf8');
    input.on('data', (chunk: string | Buffer) => {
      buf += chunk.toString();
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        onLine(buf.slice(0, i));
        buf = buf.slice(i + 1);
      }
    });
    input.on('end', () => {
      if (buf.trim()) onLine(buf);
      void queue.then(() => resolve());
    });
  });
}
