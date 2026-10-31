// SPDX-License-Identifier: AGPL-3.0-or-later
// Keeper as a model gateway: other tools that speak the OpenAI or Anthropic
// API point at Keeper (127.0.0.1, with a token) and get the person's own AI
// connections — and, through the "keeper/brain" model, answers grounded in
// their files. This file only translates between those wire formats and
// Keeper's message shape; the app runs the server.

import type { ChatMessage, ChatResult, ToolCall, ToolSpec } from './providers';

export const BRAIN_MODEL = 'keeper/brain';

export interface GatewayModel {
  id: string;
  /** connection id it maps to (empty for the brain) */
  connection: string;
  label: string;
}

/** Every connection as `keeper/<id>`, the active one as `keeper/default`, plus the brain. */
export function gatewayModels(connections: { id: string; label: string }[], active: string): GatewayModel[] {
  return [
    { id: BRAIN_MODEL, connection: active, label: 'Keeper brain (answers from your files)' },
    { id: 'keeper/default', connection: active, label: 'The AI chosen in Keeper' },
    ...connections.map((c) => ({ id: `keeper/${c.id}`, connection: c.id, label: c.label })),
  ];
}

/** Which connection a requested model name means (unknown names go to the active one). */
export function resolveModel(model: string | undefined, models: GatewayModel[], active: string): { connection: string; brain: boolean } {
  const m = models.find((x) => x.id === model);
  if (m) return { connection: m.connection, brain: m.id === BRAIN_MODEL };
  return { connection: active, brain: false };
}

// ---------------------------------------------------------------- OpenAI chat completions

type OaiContent = string | null | { type: string; text?: string }[];

function oaiText(c: OaiContent | undefined): string {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((p) => (p.type === 'text' || p.type === 'input_text' ? p.text ?? '' : '')).join('');
  return '';
}

export interface OaiRequest {
  model?: string;
  messages?: { role: string; content?: OaiContent; tool_calls?: { id: string; function: { name: string; arguments: string } }[]; tool_call_id?: string }[];
  tools?: { type: string; function: { name: string; description?: string; parameters?: Record<string, unknown> } }[];
  stream?: boolean;
  max_tokens?: number;
  max_completion_tokens?: number;
}

export function fromOpenAiRequest(r: OaiRequest): { messages: ChatMessage[]; tools: ToolSpec[]; stream: boolean; maxTokens?: number } {
  if (!Array.isArray(r.messages) || !r.messages.length) throw new Error('messages is required');
  const messages: ChatMessage[] = r.messages.map((m) => {
    const role = m.role === 'developer' ? 'system' : m.role;
    if (role === 'tool') return { role: 'tool', content: oaiText(m.content), toolCallId: m.tool_call_id };
    if (role === 'assistant') {
      const toolCalls = (m.tool_calls ?? []).map((t) => {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(t.function.arguments || '{}'); } catch { /* keep empty */ }
        return { id: t.id, name: t.function.name, args };
      });
      return { role: 'assistant', content: oaiText(m.content), ...(toolCalls.length ? { toolCalls } : {}) };
    }
    return { role: role === 'system' ? 'system' : 'user', content: oaiText(m.content) };
  });
  const tools = (r.tools ?? []).filter((t) => t.type === 'function').map((t) => ({ name: t.function.name, description: t.function.description ?? '', parameters: t.function.parameters ?? { type: 'object', properties: {} } }));
  return { messages, tools, stream: !!r.stream, maxTokens: r.max_completion_tokens ?? r.max_tokens };
}

const finishOf = (stop: ChatResult['stop']) => (stop === 'tool' ? 'tool_calls' : stop === 'length' ? 'length' : stop === 'refusal' ? 'content_filter' : 'stop');

const oaiToolCalls = (calls: ToolCall[]) => calls.map((t) => ({ id: t.id, type: 'function', function: { name: t.name, arguments: JSON.stringify(t.args) } }));

export function toOpenAiResponse(id: string, model: string, r: ChatResult, created = Math.floor(Date.now() / 1000), usage?: { input: number; output: number }) {
  return {
    id, object: 'chat.completion', created, model,
    choices: [{ index: 0, finish_reason: finishOf(r.stop), message: { role: 'assistant', content: r.text || null, ...(r.toolCalls.length ? { tool_calls: oaiToolCalls(r.toolCalls) } : {}) } }],
    ...(usage ? { usage: { prompt_tokens: usage.input, completion_tokens: usage.output, total_tokens: usage.input + usage.output } } : {}),
  };
}

/** Server-sent event lines for a streamed answer: text as it arrives, tool calls and the finish at the end. */
export function openAiChunk(id: string, model: string, created: number, delta: Record<string, unknown>, finish: string | null = null): string {
  return `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
}

export function openAiStreamEnd(id: string, model: string, created: number, r: ChatResult): string {
  let s = '';
  if (r.toolCalls.length) s += openAiChunk(id, model, created, { tool_calls: oaiToolCalls(r.toolCalls).map((t, index) => ({ index, ...t })) });
  s += openAiChunk(id, model, created, {}, finishOf(r.stop));
  return s + 'data: [DONE]\n\n';
}

// ---------------------------------------------------------------- Anthropic messages

type AnthBlock = { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown>; tool_use_id?: string; content?: string | { type: string; text?: string }[]; is_error?: boolean };

export interface AnthropicRequest {
  model?: string;
  system?: string | { type: string; text: string }[];
  messages?: { role: string; content: string | AnthBlock[] }[];
  tools?: { name: string; description?: string; input_schema?: Record<string, unknown> }[];
  stream?: boolean;
  max_tokens?: number;
}

export function fromAnthropicRequest(r: AnthropicRequest): { messages: ChatMessage[]; tools: ToolSpec[]; stream: boolean; maxTokens?: number } {
  if (!Array.isArray(r.messages) || !r.messages.length) throw new Error('messages is required');
  const messages: ChatMessage[] = [];
  const sys = typeof r.system === 'string' ? r.system : (r.system ?? []).map((b) => b.text).join('\n\n');
  if (sys) messages.push({ role: 'system', content: sys });
  for (const m of r.messages) {
    if (typeof m.content === 'string') { messages.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }); continue; }
    if (m.role === 'assistant') {
      const text = m.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
      const toolCalls = m.content.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id ?? '', name: b.name ?? '', args: b.input ?? {} }));
      messages.push({ role: 'assistant', content: text, ...(toolCalls.length ? { toolCalls } : {}) });
      continue;
    }
    const text = m.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
    for (const b of m.content.filter((x) => x.type === 'tool_result')) {
      const content = typeof b.content === 'string' ? b.content : (b.content ?? []).map((x) => x.text ?? '').join('');
      messages.push({ role: 'tool', content, toolCallId: b.tool_use_id, ...(b.is_error ? { isError: true } : {}) });
    }
    if (text) messages.push({ role: 'user', content: text });
  }
  const tools = (r.tools ?? []).map((t) => ({ name: t.name, description: t.description ?? '', parameters: t.input_schema ?? { type: 'object', properties: {} } }));
  return { messages, tools, stream: !!r.stream, maxTokens: r.max_tokens };
}

const stopOf = (stop: ChatResult['stop']) => (stop === 'tool' ? 'tool_use' : stop === 'length' ? 'max_tokens' : stop === 'refusal' ? 'refusal' : 'end_turn');

export function toAnthropicResponse(id: string, model: string, r: ChatResult, usage = { input: 0, output: 0 }) {
  const content: AnthBlock[] = [];
  if (r.text) content.push({ type: 'text', text: r.text });
  for (const t of r.toolCalls) content.push({ type: 'tool_use', id: t.id, name: t.name, input: t.args });
  return { id, type: 'message', role: 'assistant', model, content, stop_reason: stopOf(r.stop), stop_sequence: null, usage: { input_tokens: usage.input, output_tokens: usage.output } };
}

export function anthropicEvent(type: string, data: Record<string, unknown>): string {
  return `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
}

export function anthropicStreamStart(id: string, model: string): string {
  return anthropicEvent('message_start', { message: { id, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } })
    + anthropicEvent('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
}

export function anthropicTextDelta(text: string): string {
  return anthropicEvent('content_block_delta', { index: 0, delta: { type: 'text_delta', text } });
}

export function anthropicStreamEnd(r: ChatResult, outputTokens = 0): string {
  let s = anthropicEvent('content_block_stop', { index: 0 });
  r.toolCalls.forEach((t, i) => {
    s += anthropicEvent('content_block_start', { index: i + 1, content_block: { type: 'tool_use', id: t.id, name: t.name, input: {} } });
    s += anthropicEvent('content_block_delta', { index: i + 1, delta: { type: 'input_json_delta', partial_json: JSON.stringify(t.args) } });
    s += anthropicEvent('content_block_stop', { index: i + 1 });
  });
  return s + anthropicEvent('message_delta', { delta: { stop_reason: stopOf(r.stop), stop_sequence: null }, usage: { output_tokens: outputTokens } }) + anthropicEvent('message_stop', {});
}
