// SPDX-License-Identifier: AGPL-3.0-or-later
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { A2AServer, agentCard } from '../core/brain/a2a';
import { AcpAgent, promptText } from '../core/brain/acp';
import { ACTIONS, describeAction, diagnose, permissionFor, visibleActions } from '../core/brain/actions';
import { fromBedrock, fromGemini, fromResponsesOutput, toBedrock, toGemini, toResponsesInput } from '../core/brain/adapters';
import { AGENT_CLIS, launchLine, profileDir } from '../core/brain/agents';
import { addToConfig, isConnected, removeFromConfig } from '../core/brain/apps';
import { addUsage, authHeaders, CATALOG, costOf, modelListRequest, parseModelList } from '../core/brain/catalog';
import {
  anthropicStreamEnd, anthropicStreamStart, anthropicTextDelta, BRAIN_MODEL, fromAnthropicRequest, fromOpenAiRequest, gatewayModels, openAiChunk, openAiStreamEnd, resolveModel, toAnthropicResponse, toOpenAiResponse,
} from '../core/brain/gateway';
import { Harness, type HarnessEnv } from '../core/brain/harness';
import { McpServer } from '../core/brain/mcp';
import { createProvider, type ChatMessage, type ChatProvider, type ChatResult, type ToolSpec } from '../core/brain/providers';
import { fallbackChain, isRetryable, metered, privacyRouter, touchesPrivate } from '../core/brain/routing';
import { draftSkill, parseFrontMatter, parseSkill, serializeSkill, skillForModel, skillsIndex, slugify, validateSkill } from '../core/brain/skills';
import { VectorStore } from '../core/brain/vectors';
import { buildGraph, extractEntities, extractHashTags, extractLinks, neighbourhood, searchGraph, type GraphFile } from '../core/graph/build';
import { ForceLayout, rng } from '../core/graph/layout';
import { prune, suggest, type UsageEvent } from '../core/learn';
import '../core/brain/adapters';

// ---------------------------------------------------------------- a tiny fake AI server per API style

type Handler = (path: string, body: Record<string, unknown>, headers: http.IncomingHttpHeaders) => { status?: number; json?: unknown; sse?: string };
let handler: Handler = () => ({ status: 404, json: {} });
let base = '';
const seen: { path: string; body: Record<string, unknown>; headers: http.IncomingHttpHeaders }[] = [];
let server: http.Server;

beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    let s = '';
    for await (const c of req) s += c;
    const body = s ? JSON.parse(s) : {};
    seen.push({ path: req.url ?? '', body, headers: req.headers });
    const r = handler(req.url ?? '', body, req.headers);
    if (r.sse !== undefined) {
      res.writeHead(r.status ?? 200, { 'content-type': 'text/event-stream' });
      res.end(r.sse);
      return;
    }
    res.writeHead(r.status ?? 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(r.json ?? {}));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

const TOOLS: ToolSpec[] = [{ name: 'search_files', description: 'Search', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } }];
const MSGS: ChatMessage[] = [
  { role: 'system', content: 'Be brief.' },
  { role: 'user', content: 'Find the lease' },
  { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'search_files', args: { query: 'lease' } }] },
  { role: 'tool', content: '1. ~/lease.pdf', toolCallId: 'c1' },
];

describe('catalogue', () => {
  it('has every service with a style, an address and a way to send the key', () => {
    expect(CATALOG.length).toBeGreaterThan(20);
    for (const e of CATALOG) {
      expect(e.id).toMatch(/^[a-z0-9-]+$/);
      if (!e.id.startsWith('custom')) expect(e.baseUrl).toMatch(/^https?:\/\//);
      if (!e.keyless) expect(e.auth).not.toBe('none');
    }
    for (const id of ['openai', 'anthropic', 'xai', 'openrouter', 'groq', 'together', 'fireworks', 'deepseek', 'mistral', 'gemini', 'azure', 'bedrock', 'vertex', 'huggingface', 'ollama', 'lmstudio', 'llamacpp', 'vllm', 'litellm']) expect(CATALOG.some((e) => e.id === id)).toBe(true);
  });
  it('sends keys the way each service expects', () => {
    expect(authHeaders('bearer', 'k')).toEqual({ authorization: 'Bearer k' });
    expect(authHeaders('x-api-key', 'k')['x-api-key']).toBe('k');
    expect(authHeaders('goog-key', 'k')).toEqual({ 'x-goog-api-key': 'k' });
    expect(authHeaders('none', 'k')).toEqual({});
    expect(modelListRequest({ style: 'gemini', auth: 'goog-key', modelsPath: '/models' }, 'https://g/v1beta/', 'k')!.url).toBe('https://g/v1beta/models?pageSize=200');
    expect(modelListRequest({ style: 'openai', auth: 'bearer', modelsPath: '' }, 'https://x', 'k')).toBeNull();
  });
  it('reads every model-list format', () => {
    expect(parseModelList('openai', { data: [{ id: 'b' }, { id: 'a' }, { id: 'a' }] })).toEqual(['a', 'b']);
    expect(parseModelList('ollama', { models: [{ name: 'llama3.2' }, { model: 'qwen3:8b' }] })).toEqual(['llama3.2', 'qwen3:8b']);
    expect(parseModelList('gemini', { models: [{ name: 'models/gemini-x', supportedGenerationMethods: ['generateContent'] }, { name: 'models/embed', supportedGenerationMethods: ['embedContent'] }] })).toEqual(['gemini-x']);
  });
  it('counts usage per connection per day and prices it', () => {
    let rows = addUsage([], 'a', Date.UTC(2026, 9, 1), 1000, 200);
    rows = addUsage(rows, 'a', Date.UTC(2026, 9, 1, 5), 500, 100, true);
    rows = addUsage(rows, 'a', Date.UTC(2026, 9, 2), 1, 1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ calls: 2, input: 1500, output: 300, errors: 1 });
    expect(costOf({ input: 2_000_000, output: 1_000_000 }, { input: 3, output: 15 })).toBe(21);
    expect(costOf({ input: 1, output: 1 }, undefined)).toBeUndefined();
  });
});

describe('adapters (wire formats)', () => {
  it('OpenAI Responses: input items and output with a function call', () => {
    const input = toResponsesInput(MSGS) as Record<string, unknown>[];
    expect(input).toEqual([
      { role: 'user', content: 'Find the lease' },
      { type: 'function_call', call_id: 'c1', name: 'search_files', arguments: '{"query":"lease"}' },
      { type: 'function_call_output', call_id: 'c1', output: '1. ~/lease.pdf' },
    ]);
    const r = fromResponsesOutput({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'Hi' }] }, { type: 'function_call', call_id: 'x', name: 'read_file', arguments: '{"path":"/a"}' }] });
    expect(r).toEqual({ text: 'Hi', toolCalls: [{ id: 'x', name: 'read_file', args: { path: '/a' } }], stop: 'tool' });
    expect(fromResponsesOutput({ output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }] }).stop).toBe('refusal');
  });
  it('Gemini: roles, function calls and responses, system instruction', () => {
    const b = toGemini(MSGS, TOOLS) as { contents: { role: string; parts: Record<string, unknown>[] }[]; systemInstruction: unknown; tools: unknown[] };
    expect(b.systemInstruction).toEqual({ parts: [{ text: 'Be brief.' }] });
    expect(b.contents.map((c) => c.role)).toEqual(['user', 'model', 'user']);
    expect(b.contents[2].parts[0]).toEqual({ functionResponse: { name: 'search_files', response: { content: '1. ~/lease.pdf' } } });
    expect(fromGemini({ candidates: [{ content: { parts: [{ functionCall: { name: 'search_files', args: { query: 'x' } } }] }, finishReason: 'STOP' }] }).stop).toBe('tool');
    expect(fromGemini({ candidates: [{ content: { parts: [{ text: 'a' }, { text: 'b' }] }, finishReason: 'MAX_TOKENS' }] })).toMatchObject({ text: 'ab', stop: 'length' });
  });
  it('Bedrock Converse: toolUse and toolResult blocks', () => {
    const b = toBedrock(MSGS, TOOLS) as { messages: { role: string; content: Record<string, unknown>[] }[]; system: unknown; toolConfig: { tools: unknown[] } };
    expect(b.system).toEqual([{ text: 'Be brief.' }]);
    expect(b.messages[1].content[0]).toEqual({ toolUse: { toolUseId: 'c1', name: 'search_files', input: { query: 'lease' } } });
    expect(b.messages[2].content[0]).toMatchObject({ toolResult: { toolUseId: 'c1' } });
    expect(b.toolConfig.tools).toHaveLength(1);
    expect(fromBedrock({ output: { message: { content: [{ text: 'ok' }] } }, stopReason: 'end_turn', usage: { inputTokens: 5, outputTokens: 2 } })).toMatchObject({ text: 'ok', stop: 'end', usage: { input: 5, output: 2 } });
  });

  it('talks to a fake server in each style', async () => {
    handler = (p) => {
      if (p.endsWith('/responses')) return { json: { output: [{ type: 'message', content: [{ type: 'output_text', text: 'responses ok' }] }] } };
      if (p.includes(':generateContent')) return { json: { candidates: [{ content: { parts: [{ text: 'gemini ok' }] }, finishReason: 'STOP' }] } };
      if (p.endsWith('/converse')) return { json: { output: { message: { content: [{ text: 'bedrock ok' }] } }, stopReason: 'end_turn' } };
      if (p.endsWith('/chat/completions')) return { sse: `data: ${JSON.stringify({ choices: [{ delta: { content: 'chat ' } }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 't1', function: { name: 'search_files', arguments: '{"query":' } }] } }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"x"}' } }] }, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n` };
      return { status: 404 };
    };
    const r1 = await createProvider({ kind: 'openai-responses', baseUrl: base, apiKey: 'k', model: 'm' }).chat(MSGS, TOOLS);
    expect(r1.text).toBe('responses ok');
    expect(seen.at(-1)!.body.instructions).toBe('Be brief.');
    const r2 = await createProvider({ kind: 'gemini', baseUrl: base, apiKey: 'gk', model: 'gemini-x' }).chat(MSGS, TOOLS);
    expect(r2.text).toBe('gemini ok');
    expect(seen.at(-1)!.headers['x-goog-api-key']).toBe('gk');
    const r3 = await createProvider({ kind: 'bedrock', baseUrl: base, apiKey: 'bk', model: 'anthropic.claude' }).chat(MSGS, TOOLS);
    expect(r3.text).toBe('bedrock ok');
    expect(seen.at(-1)!.headers.authorization).toBe('Bearer bk');
    const r4 = await createProvider({ kind: 'openai-compatible', baseUrl: base, apiKey: 'ok', model: 'm' }).chat(MSGS, TOOLS);
    expect(r4).toMatchObject({ text: 'chat ', stop: 'tool', toolCalls: [{ id: 't1', name: 'search_files', args: { query: 'x' } }] });
  });

  it('Claude (the brain\'s provider) understands what Keeper\'s gateway streams in the Anthropic format', async () => {
    handler = (p) => (p.endsWith('/messages') ? { sse: anthropicStreamStart('msg_1', 'm') + anthropicTextDelta('Hello ') + anthropicTextDelta('there') + anthropicStreamEnd({ text: 'Hello there', toolCalls: [{ id: 'tu1', name: 'search_files', args: { query: 'q' } }], stop: 'tool' }, 3) } : { status: 404 });
    const deltas: string[] = [];
    const r = await createProvider({ kind: 'anthropic', baseUrl: base, apiKey: 'ak', model: 'm' }).chat([{ role: 'user', content: 'hi' }], TOOLS, { onDelta: (d) => deltas.push(d) });
    expect(deltas.join('')).toBe('Hello there');
    expect(r.text).toBe('Hello there');
    expect(r.toolCalls).toEqual([{ id: 'tu1', name: 'search_files', args: { query: 'q' } }]);
    expect(r.stop).toBe('tool');
  });
});

// ---------------------------------------------------------------- routing

function fake(id: string, opts: { local?: boolean; fail?: unknown; reply?: string } = {}): ChatProvider & { calls: ChatMessage[][] } {
  const calls: ChatMessage[][] = [];
  return {
    id, label: id, model: id, local: !!opts.local, supportsTools: true, contextTokens: 100_000, calls,
    async chat(m) { calls.push(m); if (opts.fail) throw opts.fail; return { text: opts.reply ?? id, toolCalls: [], stop: 'end' } satisfies ChatResult; },
  };
}

describe('fallback, privacy routing and the meter', () => {
  it('moves on only for errors worth retrying', () => {
    expect(isRetryable(Object.assign(new Error('x'), { status: 503 }))).toBe(true);
    expect(isRetryable(Object.assign(new Error('x'), { status: 400 }))).toBe(false);
    expect(isRetryable(new Error('Could not reach api.example.com: fetch failed'))).toBe(true);
    expect(isRetryable(new Error('Stopped'))).toBe(false);
  });
  it('the next AI answers when the first fails, and says so', async () => {
    const a = fake('a', { fail: Object.assign(new Error('overloaded'), { status: 529 }) });
    const b = fake('b');
    const switched: string[] = [];
    const chain = fallbackChain([a, b], (f, t) => switched.push(`${f.id}->${t.id}`));
    expect((await chain.chat([{ role: 'user', content: 'q' }], [])).text).toBe('b');
    expect(switched).toEqual(['a->b']);
    expect(chain.label).toBe('b');
    // A bad request is not retried elsewhere.
    const c = fallbackChain([fake('c', { fail: Object.assign(new Error('bad'), { status: 400 }) }), fake('d')]);
    await expect(c.chat([{ role: 'user', content: 'q' }], [])).rejects.toThrow('bad');
  });
  it('a conversation that touches a private folder continues on the local AI, never the cloud one', async () => {
    const cloud = fake('cloud');
    const local = fake('local', { local: true });
    const r = privacyRouter(cloud, local, ['/Users/sam/Private']);
    await r.chat([{ role: 'user', content: 'hello' }], []);
    expect(cloud.calls).toHaveLength(1);
    await r.chat([{ role: 'user', content: 'hello' }, { role: 'tool', content: '1. /Users/sam/Private/diary.md' }], []);
    expect(cloud.calls).toHaveLength(1);
    expect(local.calls).toHaveLength(1);
    expect(r.local).toBe(true);
    expect(touchesPrivate([{ role: 'user', content: 'C:\\Users\\sam\\private\\x.txt' }], ['C:\\Users\\sam\\Private'])).toBe(true);
    expect(touchesPrivate([{ role: 'user', content: '/Users/sam/Privateer.txt' }], ['/Users/sam/Private'])).toBe(false);
  });
  it('the meter counts tokens and failures', async () => {
    const log: [number, number, boolean][] = [];
    const m = metered(fake('x', { reply: 'abcdefgh' }), (i, o, e) => log.push([i, o, e]));
    await m.chat([{ role: 'user', content: 'x'.repeat(40) }], []);
    expect(log[0][1]).toBe(2);
    expect(log[0][0]).toBeGreaterThanOrEqual(10);
    const bad = metered(fake('y', { fail: new Error('no') }), (i, o, e) => log.push([i, o, e]));
    await expect(bad.chat([{ role: 'user', content: 'q' }], [])).rejects.toThrow();
    expect(log[1][2]).toBe(true);
  });
});

// ---------------------------------------------------------------- gateway

describe('gateway translation', () => {
  it('lists every connection plus the brain, and resolves names', () => {
    const ms = gatewayModels([{ id: 'anthropic', label: 'Claude' }, { id: 'ollama', label: 'Ollama' }], 'anthropic');
    expect(ms.map((m) => m.id)).toEqual([BRAIN_MODEL, 'keeper/default', 'keeper/anthropic', 'keeper/ollama']);
    expect(resolveModel('keeper/ollama', ms, 'anthropic')).toEqual({ connection: 'ollama', brain: false });
    expect(resolveModel(BRAIN_MODEL, ms, 'anthropic')).toEqual({ connection: 'anthropic', brain: true });
    expect(resolveModel('gpt-whatever', ms, 'anthropic')).toEqual({ connection: 'anthropic', brain: false });
  });
  it('OpenAI requests in, responses and stream chunks out', () => {
    const r = fromOpenAiRequest({ model: 'm', stream: true, max_tokens: 10, messages: [{ role: 'developer', content: 'sys' }, { role: 'user', content: [{ type: 'text', text: 'hi' }] }, { role: 'assistant', content: null, tool_calls: [{ id: 'c', function: { name: 'f', arguments: '{"a":1}' } }] }, { role: 'tool', tool_call_id: 'c', content: 'r' }], tools: [{ type: 'function', function: { name: 'f', parameters: { type: 'object' } } }] });
    expect(r.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool']);
    expect(r.messages[2].toolCalls).toEqual([{ id: 'c', name: 'f', args: { a: 1 } }]);
    expect(r).toMatchObject({ stream: true, maxTokens: 10 });
    const res = toOpenAiResponse('id1', 'keeper/x', { text: '', toolCalls: [{ id: 'c', name: 'f', args: { a: 1 } }], stop: 'tool' }, 1);
    expect(res.choices[0]).toMatchObject({ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: 'c', type: 'function', function: { name: 'f', arguments: '{"a":1}' } }] } });
    expect(openAiChunk('i', 'm', 1, { content: 'x' })).toMatch(/^data: \{.*"delta":\{"content":"x"\}.*\}\n\n$/);
    expect(openAiStreamEnd('i', 'm', 1, { text: 'x', toolCalls: [], stop: 'end' })).toMatch(/"finish_reason":"stop".*\n\ndata: \[DONE\]\n\n$/s);
    expect(() => fromOpenAiRequest({ messages: [] })).toThrow();
  });
  it('Anthropic requests in (tool_result blocks become tool turns), responses out', () => {
    const r = fromAnthropicRequest({ system: [{ type: 'text', text: 's' }], messages: [{ role: 'user', content: 'q' }, { role: 'assistant', content: [{ type: 'text', text: 'looking' }, { type: 'tool_use', id: 't', name: 'f', input: { a: 1 } }] }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: [{ type: 'text', text: 'res' }], is_error: true }, { type: 'text', text: 'and?' }] }] });
    expect(r.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool', 'user']);
    expect(r.messages[3]).toMatchObject({ content: 'res', toolCallId: 't', isError: true });
    const out = toAnthropicResponse('m1', 'x', { text: 'hi', toolCalls: [{ id: 't', name: 'f', args: {} }], stop: 'tool' });
    expect(out.stop_reason).toBe('tool_use');
    expect(out.content).toHaveLength(2);
  });
});

// ---------------------------------------------------------------- actions and MCP

describe('agent actions', () => {
  it('changes default to ask, reads to allow, and switching agents off hides everything', () => {
    expect(permissionFor('trash_files', {}, true)).toBe('ask');
    expect(permissionFor('system_snapshot', {}, true)).toBe('allow');
    expect(permissionFor('trash_files', { trash_files: 'allow' }, true)).toBe('allow');
    expect(permissionFor('trash_files', { trash_files: 'allow' }, false)).toBe('off');
    expect(visibleActions({ move_files: 'off' }, true).some((a) => a.name === 'move_files')).toBe(false);
    expect(visibleActions({}, false)).toEqual([]);
    for (const a of ACTIONS) if (!a.readOnly && a.name !== 'undo_last') expect(a.default).toBe('ask');
  });
  it('describes actions in plain words for the approval prompt', () => {
    expect(describeAction('move_files', { paths: ['/a/x.pdf', '/a/y.pdf'], to: '~/Invoices' })).toBe('move 2 items (x.pdf, y.pdf) to ~/Invoices');
    expect(describeAction('trash_files', { paths: ['/a/old.zip'] })).toBe('send “old.zip” to the Trash');
    expect(describeAction('quit_app', { pid: 42, force: true })).toBe('force quit the program with process id 42');
  });
  it('explains slowness with fixes', () => {
    const f = diagnose({ cpuPercent: 92, cores: 8, memUsed: 15.5 * 1024 ** 3, memTotal: 16 * 1024 ** 3, diskFree: 3 * 1024 ** 3, diskTotal: 500 * 1024 ** 3, top: [{ pid: 9, name: 'Browser', cpu: 180, memory: 4 * 1024 ** 3 }] });
    expect(f.map((x) => x.severity)).toContain('bad');
    expect(f.some((x) => x.fix?.tool === 'suspend_app' && x.fix.args.pid === 9)).toBe(true);
    expect(f.some((x) => /disk is almost full/i.test(x.text))).toBe(true);
    expect(diagnose({ cpuPercent: 5, cores: 8, memUsed: 1, memTotal: 100, top: [] })[0].text).toMatch(/Nothing stands out/);
  });
  it('MCP lists the extra tools, routes calls with the client name, and offers skills as prompts', async () => {
    const calls: string[] = [];
    const srv = new McpServer({
      env: { visibility: 'names', allowed: () => true, search: async () => [], read: async () => ({ text: '', total: 0, truncated: false }) },
      version: 't',
      extraTools: () => [{ name: 'move_files', description: 'Move', inputSchema: { type: 'object' }, annotations: { readOnlyHint: false } }],
      callExtra: async (name, args, client) => { calls.push(`${client}:${name}:${JSON.stringify(args)}`); return { text: 'moved' }; },
      prompts: { list: () => [{ name: 'tax-pack', description: 'Tax' }], get: (n) => (n === 'tax-pack' ? 'BODY' : undefined) },
    });
    const init = await srv.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', clientInfo: { name: 'Claude Code' } } });
    expect((init!.result as { instructions: string }).instructions).toMatch(/permission/);
    expect((init!.result as { capabilities: Record<string, unknown> }).capabilities.prompts).toBeTruthy();
    const list = await srv.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    expect((list!.result as { tools: { name: string }[] }).tools.map((t) => t.name)).toContain('move_files');
    const r = await srv.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'move_files', arguments: { paths: ['/a'], to: '/b' } } });
    expect((r!.result as { content: { text: string }[] }).content[0].text).toBe('moved');
    expect(calls).toEqual(['Claude Code:move_files:{"paths":["/a"],"to":"/b"}']);
    const p = await srv.handle({ jsonrpc: '2.0', id: 4, method: 'prompts/get', params: { name: 'tax-pack' } });
    expect((p!.result as { messages: { content: { text: string } }[] }).messages[0].content.text).toBe('BODY');
    expect((await srv.handle({ jsonrpc: '2.0', id: 5, method: 'prompts/get', params: { name: 'nope' } }))!.error).toBeTruthy();
  });
});

// ---------------------------------------------------------------- agent-to-agent

describe('A2A', () => {
  const mk = (answer = 'It ends on 28 February.') => {
    let n = 0;
    return new A2AServer({ ask: async () => ({ answer, sources: ['/a/lease.pdf'] }), newId: () => `id${++n}`, now: () => Date.UTC(2026, 9, 31) });
  };
  it('publishes an agent card that 1.0 and 0.3 clients can read', () => {
    const c = agentCard({ url: 'http://127.0.0.1:1/a2a', version: '0.1.0', name: 'Keeper', skills: [{ id: 'tax-pack', name: 'tax-pack', description: 'Tax' }] });
    for (const k of ['name', 'description', 'supportedInterfaces', 'version', 'capabilities', 'defaultInputModes', 'defaultOutputModes', 'skills']) expect(c).toHaveProperty(k);
    expect(c.supportedInterfaces[0]).toEqual({ url: 'http://127.0.0.1:1/a2a', protocolBinding: 'JSONRPC', protocolVersion: '1.0' });
    expect(c.skills.every((s) => s.id && s.name && s.description && Array.isArray(s.tags))).toBe(true);
  });
  it('SendMessage (1.0) completes a task with the answer as an artifact; GetTask finds it', async () => {
    const s = mk();
    const r = await s.handle({ jsonrpc: '2.0', id: 1, method: 'SendMessage', params: { message: { messageId: 'm1', role: 'ROLE_USER', parts: [{ text: 'When does my lease end?' }] } } }, '1.0');
    const task = (r.result as { task: { id: string; status: { state: string }; artifacts: { parts: { text?: string }[] }[] } }).task;
    expect(task.status.state).toBe('TASK_STATE_COMPLETED');
    expect(task.artifacts[0].parts[0].text).toBe('It ends on 28 February.');
    const g = await s.handle({ jsonrpc: '2.0', id: 2, method: 'GetTask', params: { id: task.id } }, '1.0');
    expect((g.result as { id: string }).id).toBe(task.id);
    expect((await s.handle({ jsonrpc: '2.0', id: 3, method: 'GetTask', params: { id: 'nope' } }, '1.0')).error!.code).toBe(-32001);
  });
  it('accepts 0.3 method names and states, and refuses unknown versions', async () => {
    const s = mk();
    const r = await s.handle({ jsonrpc: '2.0', id: 1, method: 'message/send', params: { message: { messageId: 'm', role: 'user', parts: [{ kind: 'text', text: 'hi' }] } } }, '0.3');
    expect((r.result as { kind: string; status: { state: string } })).toMatchObject({ kind: 'task', status: { state: 'completed' } });
    expect((await s.handle({ jsonrpc: '2.0', id: 2, method: 'SendMessage', params: {} }, '9.9')).error!.code).toBe(-32009);
    expect((await s.handle({ jsonrpc: '2.0', id: 3, method: 'SendStreamingMessage', params: {} }, '1.0')).error!.code).toBe(-32004);
  });
});

describe('ACP (Keeper as an agent for editors)', () => {
  it('initialize, new session, a prompt that streams, and the stop reason', async () => {
    const notes: { method: string; params: { update: { sessionUpdate: string; content: { text: string } } } }[] = [];
    let n = 0;
    const agent = new AcpAgent({ version: '1', newId: () => String(++n), ask: async (q, o) => { o.onDelta('Hel'); o.onDelta('lo'); return { answer: `Hello (${q})`, history: [q] }; } }, (method, params) => notes.push({ method, params: params as never }));
    const init = await agent.handle({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: 1 } });
    expect(init!.result).toMatchObject({ protocolVersion: 1, authMethods: [] });
    const s = await agent.handle({ jsonrpc: '2.0', id: 1, method: 'session/new', params: { cwd: '/tmp', mcpServers: [] } });
    const sid = (s!.result as { sessionId: string }).sessionId;
    const p = await agent.handle({ jsonrpc: '2.0', id: 2, method: 'session/prompt', params: { sessionId: sid, prompt: [{ type: 'text', text: 'hi' }] } });
    expect(p!.result).toEqual({ stopReason: 'end_turn' });
    expect(notes.map((x) => x.params.update.content.text).join('')).toBe('Hello');
    expect(notes.every((x) => x.method === 'session/update' && x.params.update.sessionUpdate === 'agent_message_chunk')).toBe(true);
    expect((await agent.handle({ jsonrpc: '2.0', id: 3, method: 'session/prompt', params: { sessionId: 'nope', prompt: [] } }))!.error).toBeTruthy();
  });
  it('attached files become part of the prompt', () => {
    expect(promptText([{ type: 'text', text: 'Explain' }, { type: 'resource', resource: { uri: 'file:///a.py', text: 'x=1' } }])).toBe('Explain\n<file file:///a.py>\nx=1\n</file>');
  });
});

// ---------------------------------------------------------------- skills

const SKILL = `---
name: tax-pack
description: >
  Use when preparing the yearly tax pack:
  gathers receipts and statements.
license: Apache-2.0
allowed-tools: [search_files, read_file]
metadata:
  author: sam
  version: "1.0"
---

# Tax pack

1. Search receipts.
`;

describe('skills', () => {
  it('parses front matter (folded text, lists, maps) and round-trips', () => {
    const s = parseSkill(SKILL);
    expect(s.name).toBe('tax-pack');
    expect(s.description).toBe('Use when preparing the yearly tax pack: gathers receipts and statements.');
    expect(s.meta['allowed-tools']).toEqual(['search_files', 'read_file']);
    expect(s.meta.metadata).toEqual({ author: 'sam', version: '1.0' });
    expect(s.body).toBe('# Tax pack\n\n1. Search receipts.');
    expect(validateSkill(s, 'tax-pack')).toEqual([]);
    expect(parseSkill(serializeSkill(s))).toEqual(s);
    expect(parseFrontMatter('a: "x: y"\nb: |\n  one\n  two')).toEqual({ a: 'x: y', b: 'one\ntwo' });
  });
  it('validates names and descriptions like the open format', () => {
    expect(validateSkill({ name: 'Tax Pack', description: 'x', meta: {} })).toHaveLength(1);
    expect(validateSkill({ name: '-tax', description: 'x', meta: {} })).toHaveLength(1);
    expect(validateSkill({ name: 'tax--pack', description: 'x', meta: {} })).toHaveLength(1);
    expect(validateSkill({ name: 'a'.repeat(65), description: 'x', meta: {} }).length).toBeGreaterThan(0);
    expect(validateSkill({ name: 'tax', description: '', meta: {} })).toEqual(['description is missing']);
    expect(validateSkill({ name: 'tax', description: 'x', meta: {} }, 'other')).toHaveLength(1);
    expect(() => parseSkill('# no front matter')).toThrow();
    expect(slugify('Monthly Invoices — 2026!')).toBe('monthly-invoices-2026');
  });
  it('drafts a valid skill from a good answer', () => {
    const s = draftSkill({ title: 'File invoices', question: 'move my invoices', answer: 'Moved 3.', steps: [{ tool: 'search_files', summary: '3 files', args: { query: 'invoice' } }, { tool: 'propose_actions', summary: 'x' }] });
    expect(validateSkill(s)).toEqual([]);
    expect(s.body).toContain('`search_files`');
    expect(s.body).not.toContain('propose_actions` —');
    expect(skillsIndex([s])).toContain('file-invoices:');
  });
  it('progressive disclosure: names up front, the body only when the AI asks for it', async () => {
    const sent: ChatMessage[][] = [];
    let round = 0;
    const provider: ChatProvider = {
      id: 'fake', label: 'fake', model: 'f', local: true, supportsTools: true, contextTokens: 100_000,
      async chat(m, tools) {
        sent.push(m);
        expect(tools.some((t) => t.name === 'use_skill')).toBe(true);
        round++;
        if (round === 1) return { text: '', toolCalls: [{ id: 'u', name: 'use_skill', args: { name: 'tax-pack' } }], stop: 'tool' };
        return { text: 'Done', toolCalls: [], stop: 'end' };
      },
    };
    const skill = parseSkill(SKILL);
    const env: HarnessEnv = {
      visibility: 'snippets', allowed: () => true, search: async () => [], read: async () => ({ text: '', total: 0, truncated: false }),
      skills: { list: () => [{ name: skill.name, description: skill.description }], load: (n) => (n === 'tax-pack' ? skillForModel(skill) : undefined) },
    };
    const r = await new Harness(provider, env).ask('Prepare my taxes');
    expect(r.answer).toBe('Done');
    expect(sent[0][0].content).toContain('tax-pack: Use when preparing');
    expect(sent[0][0].content).not.toContain('Search receipts');
    expect(sent[1].find((m) => m.role === 'tool')!.content).toContain('Search receipts');
    expect(r.trace[0]).toMatchObject({ tool: 'use_skill', summary: 'used the skill tax-pack' });
  });
});

// ---------------------------------------------------------------- learning

describe('learning from use', () => {
  const D = 86_400_000;
  const now = Date.UTC(2026, 9, 31, 12);
  it('suggests an automation after the same move on different days', () => {
    const ev: UsageEvent[] = [0, 1, 2, 9].map((d, i) => ({ t: now - d * D, type: 'move', from: `/u/Downloads/Invoice ${i}.pdf`, to: `/u/Documents/Invoices/Invoice ${i}.pdf` }));
    const s = suggest(ev, now);
    expect(s[0]).toMatchObject({ kind: 'rule', count: 4, make: { type: 'rule', ext: 'pdf', nameContains: 'invoice', scope: '/u/Downloads', to: '/u/Documents/Invoices' } });
    // Same day only: not a habit yet.
    expect(suggest(ev.map((e) => ({ ...e, t: now })), now).filter((x) => x.kind === 'rule')).toEqual([]);
  });
  it('pins folders opened on many days, saves repeated searches, and respects “no thanks”', () => {
    const ev: UsageEvent[] = [
      ...[0, 1, 2, 3].map((d) => ({ t: now - d * D, type: 'open' as const, path: `/u/Projects/a${d}.txt` })),
      ...[0, 1, 2].map((d) => ({ t: now - d * D, type: 'search' as const, q: 'PDFs from  Gmail' })),
    ];
    const s = suggest(ev, now);
    expect(s.find((x) => x.kind === 'pin')?.make).toEqual({ type: 'pin', folder: '/u/Projects' });
    expect(s.find((x) => x.kind === 'saved-search')?.make).toMatchObject({ text: 'pdfs from gmail' });
    expect(suggest(ev, now, { pinned: ['/u/Projects'] }).some((x) => x.kind === 'pin')).toBe(false);
    expect(suggest(ev, now, { dismissed: s.map((x) => x.id) })).toEqual([]);
  });
  it('forgets old events', () => {
    expect(prune([{ t: now - 100 * D, type: 'page', name: 'x' }, { t: now, type: 'page', name: 'y' }], now, 60)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- knowledge graph

describe('knowledge graph', () => {
  const files: GraphFile[] = [
    { path: '/v/Home.md', name: 'Home.md', kind: 'document', mtime: 3, text: 'Start: [[Apartment move]] and [[Tax 2025|taxes]]. #index' },
    { path: '/v/Apartment move.md', name: 'Apartment move.md', kind: 'document', mtime: 2, text: 'See [lease](sub/Lease.md). Lena Fischer helps. #home' },
    { path: '/v/sub/Lease.md', name: 'Lease.md', kind: 'document', mtime: 1, text: 'Acme Property GmbH. Lena Fischer is the contact.' },
    { path: '/v/Tax 2025.md', name: 'Tax 2025.md', kind: 'document', mtime: 1, text: 'Receipts from Acme Property GmbH.' },
    { path: '/d/photo.jpg', name: 'photo.jpg', kind: 'image', mtime: 0, tags: ['home'], source: 'Gmail' },
  ];
  it('finds links, tags and names in text', () => {
    expect(extractLinks('[[A]] [[B#h|x]] ![[C]] [t](d/e.md) [w](https://x.org)')).toEqual({ wiki: ['A', 'B', 'C'], md: ['d/e.md'] });
    expect(extractHashTags('# Heading\nsome #Tag and #two/sub, not#this')).toEqual(['tag', 'two/sub']);
    const e = extractEntities('Lena Fischer met Acme Property GmbH. Write to lena@example.com. The Report was late.');
    expect(e).toEqual(expect.arrayContaining(['Lena Fischer', 'Acme Property GmbH', 'lena@example.com']));
    expect(e).not.toContain('The Report');
    expect(e).not.toContain('Acme Property');
    expect(extractEntities('Ask Lena Fischer about it. Then Marco Rossi Jr writes.')).toEqual(['Lena Fischer', 'Marco Rossi']);
  });
  it('links notes both ways, resolves relative links, shares tags and names', () => {
    const g = buildGraph(files, { similar: (p) => (p === '/d/photo.jpg' ? [{ path: '/v/Home.md', score: 0.8 }] : []) });
    const has = (a: string, b: string, type: string) => g.edges.some((e) => e.type === type && ((e.a === a && e.b === b) || (e.a === b && e.b === a)));
    expect(has('f:/v/Home.md', 'f:/v/Apartment move.md', 'link')).toBe(true);
    expect(has('f:/v/Home.md', 'f:/v/Tax 2025.md', 'link')).toBe(true);
    expect(has('f:/v/Apartment move.md', 'f:/v/sub/Lease.md', 'link')).toBe(true);
    expect(has('f:/v/Apartment move.md', 't:home', 'tag')).toBe(true);
    expect(has('f:/d/photo.jpg', 't:home', 'tag')).toBe(true);
    expect(has('f:/v/sub/Lease.md', 'e:lena fischer', 'entity')).toBe(true);
    expect(has('f:/v/Tax 2025.md', 'e:acme property gmbh', 'entity')).toBe(true);
    expect(has('f:/d/photo.jpg', 's:Gmail', 'source')).toBe(true);
    expect(has('f:/d/photo.jpg', 'f:/v/Home.md', 'similar')).toBe(true);
    expect(g.nodes.find((n) => n.id === 'f:/v/Home.md')!.kind).toBe('note');
    // A name mentioned once is not a node.
    expect(g.nodes.some((n) => n.label === 'Receipts')).toBe(false);
  });
  it('neighbourhoods, search and size limits', () => {
    const g = buildGraph(files);
    const local = neighbourhood(g, 'f:/v/sub/Lease.md', 1);
    expect(local.nodes.map((n) => n.id)).toEqual(expect.arrayContaining(['f:/v/sub/Lease.md', 'f:/v/Apartment move.md', 'e:lena fischer']));
    expect(local.nodes.some((n) => n.id === 'f:/v/Home.md')).toBe(false);
    expect(searchGraph(g, 'lena')[0].label).toBe('Lena Fischer');
    const small = buildGraph(files, { maxFiles: 2 });
    expect(small.truncated).toBe(3);
    expect(small.nodes.filter((n) => n.type === 'file')).toHaveLength(2);
  });
});

describe('force layout', () => {
  const edges = Array.from({ length: 300 }, (_, i) => ({ a: i, b: (i * 7 + 3) % 400, w: 1 }));
  it('is the same every time for the same seed', () => {
    const a = new ForceLayout(400, edges, { seed: 3 });
    const b = new ForceLayout(400, edges, { seed: 3 });
    for (let i = 0; i < 20; i++) { a.step(); b.step(); }
    expect(Array.from(a.x.slice(0, 50))).toEqual(Array.from(b.x.slice(0, 50)));
    expect(rng(1)()).toBe(rng(1)());
  });
  it('settles, and copes with nodes on top of each other', () => {
    const l = new ForceLayout(400, edges, { seed: 1 });
    const first = l.step();
    let last = first;
    for (let i = 0; i < 300; i++) last = l.step();
    expect(last).toBeLessThan(first);
    const same = new ForceLayout(50, [], { seed: 1 });
    same.x.fill(0); same.y.fill(0);
    same.step();
    expect(Array.from(same.x).every(Number.isFinite)).toBe(true);
  });
  it('lays out 10 000 nodes a step in well under a second', () => {
    const n = 10_000;
    const l = new ForceLayout(n, Array.from({ length: n }, (_, i) => ({ a: i, b: (i * 31 + 7) % n, w: 1 })), { seed: 2 });
    const t0 = performance.now();
    l.step();
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});

// ---------------------------------------------------------------- connecting agents

describe('connecting agent apps', () => {
  const launch = { command: '/opt/Keeper/keeper', args: ['mcp'] };
  it('Codex (TOML): adds a table, keeps the rest, removes cleanly', () => {
    const before = 'model = "x"\n\n[mcp_servers.other]\ncommand = "o"\n';
    const t = addToConfig(before, 'codex-toml', { ...launch, env: { A: 'b' } });
    expect(t).toContain('[mcp_servers.keeper]\ncommand = "/opt/Keeper/keeper"\nargs = ["mcp"]');
    expect(t).toContain('[mcp_servers.keeper.env]\nA = "b"');
    expect(t).toContain('[mcp_servers.other]');
    expect(isConnected(t, 'codex-toml')).toBe(true);
    // Adding twice does not duplicate.
    expect(addToConfig(t, 'codex-toml', launch).match(/\[mcp_servers\.keeper\]/g)).toHaveLength(1);
    const r = removeFromConfig(t, 'codex-toml');
    expect(isConnected(r, 'codex-toml')).toBe(false);
    expect(r).toContain('[mcp_servers.other]');
    expect(r).not.toContain('keeper.env');
  });
  it('Hermes (YAML): into an existing mcp_servers map, or a new one', () => {
    const y = 'model: x\nmcp_servers:\n  other:\n    command: o\nterminal: {}\n';
    const t = addToConfig(y, 'hermes-yaml', launch);
    expect(t).toContain('  other:\n    command: o\n  keeper:\n    command: "/opt/Keeper/keeper"\n    args: ["mcp"]\nterminal: {}');
    expect(isConnected(t, 'hermes-yaml')).toBe(true);
    const r = removeFromConfig(t, 'hermes-yaml');
    expect(r).toBe(y);
    expect(addToConfig('model: x\n', 'hermes-yaml', launch)).toBe('model: x\n\nmcp_servers:\n  keeper:\n    command: "/opt/Keeper/keeper"\n    args: ["mcp"]\n');
    expect(removeFromConfig('mcp_servers:\n  keeper:\n    command: k\n', 'hermes-yaml')).toBe('mcp_servers: {}\n');
  });
  it('OpenClaw (mcp.servers in JSON)', () => {
    const t = addToConfig('{ "mcp": { "servers": { "x": {} } }, "agents": {} }', 'openclaw', launch);
    expect(JSON.parse(t).mcp.servers).toEqual({ x: {}, keeper: { command: '/opt/Keeper/keeper', args: ['mcp'] } });
    expect(isConnected(t, 'openclaw')).toBe(true);
    expect(JSON.parse(removeFromConfig(t, 'openclaw')).mcp.servers).toEqual({ x: {} });
  });
  it('starts agents with a separate settings folder per profile, quoted safely', () => {
    const claude = AGENT_CLIS.find((a) => a.id === 'claude')!;
    expect(launchLine(claude, { id: 'p', agent: 'claude', label: 'Work', configDir: "/k/it's here" }, 'linux')).toBe(`CLAUDE_CONFIG_DIR='/k/it'\\''s here' claude`);
    expect(launchLine(claude, { id: 'p', agent: 'claude', label: 'Work', configDir: "C:\\K\\it's" }, 'win32')).toBe(`$env:CLAUDE_CONFIG_DIR='C:\\K\\it''s'; claude`);
    expect(launchLine(claude, undefined, 'darwin')).toBe('claude');
    expect(profileDir('/data/', 'claude', 'Work account!')).toBe('/data/agent-profiles/claude/work-account');
  });
});

describe('vectors', () => {
  it('gives back a stored vector close to the original', () => {
    const v = new VectorStore(4);
    const x = new Float32Array([0.5, 0.5, 0.5, 0.5]);
    v.set(7, x);
    const back = v.get(7)!;
    for (let i = 0; i < 4; i++) expect(Math.abs(back[i] - x[i])).toBeLessThan(0.01);
    expect(v.get(8)).toBeUndefined();
  });
});
