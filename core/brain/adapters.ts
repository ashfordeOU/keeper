// SPDX-License-Identifier: AGPL-3.0-or-later
// More ways to talk to AI services, next to Claude, the OpenAI chat format and
// Ollama in providers.ts: OpenAI's Responses API, Google Gemini's own API and
// Amazon Bedrock's Converse API (with a Bedrock API key). Each turns Keeper's
// one message shape into the service's and back, tool calls included.

import { authHeaders } from './catalog';
import { DEFAULT_MODEL, registerProvider, type ChatMessage, type ChatProvider, type ProviderConfig, type ToolCall, type ToolSpec } from './providers';

function contextGuess(model: string): number {
  return /gemini|claude|gpt-5|gpt-4\.1/i.test(model) ? 1_000_000 : /gpt-4o|grok|mistral|llama|deepseek|qwen|nova/i.test(model) ? 128_000 : 32_000;
}

async function postJson(url: string, headers: Record<string, string>, body: unknown, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { method: 'POST', signal, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }).catch((e) => {
    throw new Error(`Could not reach ${new URL(url).hostname}: ${e instanceof Error ? e.message : e}`);
  });
  const text = await res.text();
  if (!res.ok) throw Object.assign(new Error(`${new URL(url).hostname} returned ${res.status}: ${text.slice(0, 300)}`), { status: res.status });
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${new URL(url).hostname} sent something that is not JSON`);
  }
}

const system = (m: ChatMessage[]) => m.filter((x) => x.role === 'system').map((x) => x.content).join('\n\n');

// ---------------------------------------------------------------- OpenAI Responses API

export function toResponsesInput(messages: ChatMessage[]): unknown[] {
  const out: unknown[] = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'tool') { out.push({ type: 'function_call_output', call_id: m.toolCallId, output: m.content }); continue; }
    if (m.role === 'assistant') {
      if (m.content) out.push({ role: 'assistant', content: m.content });
      for (const t of m.toolCalls ?? []) out.push({ type: 'function_call', call_id: t.id, name: t.name, arguments: JSON.stringify(t.args) });
      continue;
    }
    out.push({ role: 'user', content: m.content });
  }
  return out;
}

export function fromResponsesOutput(data: unknown): { text: string; toolCalls: ToolCall[]; stop: 'end' | 'tool' | 'length' | 'refusal' } {
  const d = data as { output?: { type: string; content?: { type: string; text?: string; refusal?: string }[]; call_id?: string; name?: string; arguments?: string }[]; status?: string; incomplete_details?: { reason?: string } };
  let text = '';
  let refusal = false;
  const toolCalls: ToolCall[] = [];
  for (const item of d.output ?? []) {
    if (item.type === 'message') for (const c of item.content ?? []) {
      if (c.type === 'output_text' && c.text) text += c.text;
      if (c.type === 'refusal') { refusal = true; text += c.refusal ?? ''; }
    }
    if (item.type === 'function_call') {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(item.arguments || '{}'); } catch { /* keep empty */ }
      toolCalls.push({ id: item.call_id ?? `call_${toolCalls.length}`, name: item.name ?? '', args });
    }
  }
  const stop = refusal ? 'refusal' : toolCalls.length ? 'tool' : d.status === 'incomplete' && d.incomplete_details?.reason === 'max_output_tokens' ? 'length' : 'end';
  return { text, toolCalls, stop };
}

function responsesProvider(c: ProviderConfig): ChatProvider {
  const base = (c.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const model = c.model || DEFAULT_MODEL.openai;
  return {
    id: 'openai-responses', label: 'OpenAI', model, local: false, supportsTools: c.tools ?? true, contextTokens: c.contextTokens ?? contextGuess(model),
    async chat(messages, tools, opts = {}) {
      if (!c.apiKey) throw new Error('Add the OpenAI API key in Settings → AI & Brain.');
      const body: Record<string, unknown> = { model, input: toResponsesInput(messages), store: false };
      const sys = system(messages);
      if (sys) body.instructions = sys;
      if (opts.maxTokens) body.max_output_tokens = opts.maxTokens;
      if (tools.length && this.supportsTools) body.tools = tools.map((t) => ({ type: 'function', name: t.name, description: t.description, parameters: t.parameters }));
      const r = fromResponsesOutput(await postJson(`${base}/responses`, authHeaders('bearer', c.apiKey), body, opts.signal));
      if (r.text) opts.onDelta?.(r.text);
      return r;
    },
  };
}

// ---------------------------------------------------------------- Google Gemini

export function toGemini(messages: ChatMessage[], tools: ToolSpec[]): Record<string, unknown> {
  const contents: { role: string; parts: unknown[] }[] = [];
  const names = new Map<string, string>();
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'assistant') {
      const parts: unknown[] = [];
      if (m.content) parts.push({ text: m.content });
      for (const t of m.toolCalls ?? []) { names.set(t.id, t.name); parts.push({ functionCall: { name: t.name, args: t.args } }); }
      contents.push({ role: 'model', parts: parts.length ? parts : [{ text: '…' }] });
    } else if (m.role === 'tool') {
      const part = { functionResponse: { name: names.get(m.toolCallId ?? '') ?? 'tool', response: { content: m.content, ...(m.isError ? { error: true } : {}) } } };
      const last = contents[contents.length - 1];
      if (last?.role === 'user' && last.parts.every((p) => 'functionResponse' in (p as object))) last.parts.push(part);
      else contents.push({ role: 'user', parts: [part] });
    } else contents.push({ role: 'user', parts: [{ text: m.content }] });
  }
  const body: Record<string, unknown> = { contents };
  const sys = system(messages);
  if (sys) body.systemInstruction = { parts: [{ text: sys }] };
  if (tools.length) body.tools = [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })) }];
  return body;
}

export function fromGemini(data: unknown): { text: string; toolCalls: ToolCall[]; stop: 'end' | 'tool' | 'length' | 'refusal' } {
  const d = data as { candidates?: { content?: { parts?: { text?: string; functionCall?: { name: string; args?: Record<string, unknown> } }[] }; finishReason?: string }[]; promptFeedback?: { blockReason?: string } };
  const cand = d.candidates?.[0];
  let text = '';
  const toolCalls: ToolCall[] = [];
  for (const p of cand?.content?.parts ?? []) {
    if (p.text) text += p.text;
    if (p.functionCall) toolCalls.push({ id: `call_${toolCalls.length}`, name: p.functionCall.name, args: p.functionCall.args ?? {} });
  }
  const fr = cand?.finishReason ?? '';
  const stop = d.promptFeedback?.blockReason || fr === 'SAFETY' || fr === 'PROHIBITED_CONTENT' ? 'refusal' : toolCalls.length ? 'tool' : fr === 'MAX_TOKENS' ? 'length' : 'end';
  return { text, toolCalls, stop };
}

function geminiProvider(c: ProviderConfig): ChatProvider {
  const base = (c.baseUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
  const model = c.model || 'gemini-flash-latest';
  return {
    id: 'gemini', label: 'Google Gemini', model, local: false, supportsTools: c.tools ?? true, contextTokens: c.contextTokens ?? contextGuess(model),
    async chat(messages, tools, opts = {}) {
      if (!c.apiKey) throw new Error('Add the Gemini API key in Settings → AI & Brain.');
      const body = toGemini(messages, this.supportsTools ? tools : []);
      if (opts.maxTokens) body.generationConfig = { maxOutputTokens: opts.maxTokens };
      const r = fromGemini(await postJson(`${base}/models/${encodeURIComponent(model)}:generateContent`, authHeaders('goog-key', c.apiKey), body, opts.signal));
      if (r.text) opts.onDelta?.(r.text);
      return r;
    },
  };
}

// ---------------------------------------------------------------- Amazon Bedrock (Converse)

export function toBedrock(messages: ChatMessage[], tools: ToolSpec[]): Record<string, unknown> {
  const out: { role: string; content: unknown[] }[] = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'assistant') {
      const content: unknown[] = [];
      if (m.content) content.push({ text: m.content });
      for (const t of m.toolCalls ?? []) content.push({ toolUse: { toolUseId: t.id, name: t.name, input: t.args } });
      out.push({ role: 'assistant', content: content.length ? content : [{ text: '…' }] });
    } else if (m.role === 'tool') {
      const block = { toolResult: { toolUseId: m.toolCallId, content: [{ text: m.content }], ...(m.isError ? { status: 'error' } : {}) } };
      const last = out[out.length - 1];
      if (last?.role === 'user' && last.content.every((b) => 'toolResult' in (b as object))) last.content.push(block);
      else out.push({ role: 'user', content: [block] });
    } else out.push({ role: 'user', content: [{ text: m.content }] });
  }
  const body: Record<string, unknown> = { messages: out };
  const sys = system(messages);
  if (sys) body.system = [{ text: sys }];
  if (tools.length) body.toolConfig = { tools: tools.map((t) => ({ toolSpec: { name: t.name, description: t.description, inputSchema: { json: t.parameters } } })) };
  return body;
}

export function fromBedrock(data: unknown): { text: string; toolCalls: ToolCall[]; stop: 'end' | 'tool' | 'length' | 'refusal'; usage?: { input: number; output: number } } {
  const d = data as { output?: { message?: { content?: { text?: string; toolUse?: { toolUseId: string; name: string; input?: Record<string, unknown> } }[] } }; stopReason?: string; usage?: { inputTokens?: number; outputTokens?: number } };
  let text = '';
  const toolCalls: ToolCall[] = [];
  for (const b of d.output?.message?.content ?? []) {
    if (b.text) text += b.text;
    if (b.toolUse) toolCalls.push({ id: b.toolUse.toolUseId, name: b.toolUse.name, args: b.toolUse.input ?? {} });
  }
  const stop = d.stopReason === 'guardrail_intervened' || d.stopReason === 'content_filtered' ? 'refusal' : toolCalls.length ? 'tool' : d.stopReason === 'max_tokens' ? 'length' : 'end';
  return { text, toolCalls, stop, usage: d.usage ? { input: d.usage.inputTokens ?? 0, output: d.usage.outputTokens ?? 0 } : undefined };
}

function bedrockProvider(c: ProviderConfig): ChatProvider {
  const base = (c.baseUrl || 'https://bedrock-runtime.us-east-1.amazonaws.com').replace(/\/+$/, '');
  const model = c.model || '';
  return {
    id: 'bedrock', label: 'Amazon Bedrock', model, local: false, supportsTools: c.tools ?? true, contextTokens: c.contextTokens ?? contextGuess(model),
    async chat(messages, tools, opts = {}) {
      if (!c.apiKey) throw new Error('Add a Bedrock API key in Settings → AI & Brain.');
      if (!model) throw new Error('Choose a Bedrock model id (for example from the Bedrock console).');
      const body = toBedrock(messages, this.supportsTools ? tools : []);
      if (opts.maxTokens) body.inferenceConfig = { maxTokens: opts.maxTokens };
      const r = fromBedrock(await postJson(`${base}/model/${encodeURIComponent(model)}/converse`, authHeaders('bearer', c.apiKey), body, opts.signal));
      if (r.text) opts.onDelta?.(r.text);
      return { text: r.text, toolCalls: r.toolCalls, stop: r.stop };
    },
  };
}

registerProvider({ kind: 'openai-responses', label: 'OpenAI (Responses API)', create: responsesProvider });
registerProvider({ kind: 'gemini', label: 'Google Gemini', create: geminiProvider });
registerProvider({ kind: 'bedrock', label: 'Amazon Bedrock', create: bedrockProvider });
