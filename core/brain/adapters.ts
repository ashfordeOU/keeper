// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// More ways to talk to AI services, next to Claude, the OpenAI chat format and
// Ollama in providers.ts: OpenAI's Responses API, Google Gemini's own API and
// Amazon Bedrock's Converse API (with a Bedrock API key). Each turns Keeper's
// one message shape into the service's and back, tool calls included.

import { authHeaders } from './catalog';
import { DEFAULT_MODEL, isLocalUrl, providerFactories, registerProvider, type ChatMessage, type ChatProvider, type ProviderConfig, type ToolCall, type ToolSpec } from './providers';
import {
  fromGeminiCallName, geminiComputerKind, geminiComputerTool, geminiNeedsConfirmation, geminiResponsePart, openAiCallArgs, openAiCallOutputItem, openAiComputerToolFor,
  type OpenAiSafetyCheck,
} from '../cu/native';

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
  // Calls to the built-in computer tool: answered with computer_call_output while the model's own items are kept,
  // as plain text once older turns were trimmed (an output with no matching computer_call would be refused).
  const native = new Map<string, { checks?: OpenAiSafetyCheck[]; replayed: boolean }>();
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'tool' && native.has(m.toolCallId ?? '')) {
      const n = native.get(m.toolCallId ?? '')!;
      if (n.replayed) {
        out.push(openAiCallOutputItem(m.toolCallId!, m.images?.[0], m.isError ? undefined : n.checks));
        if (m.content.trim() && (m.isError || m.content.length > 1)) out.push({ role: 'user', content: [{ type: 'input_text', text: `Keeper: ${m.content}` }] });
      } else out.push({ role: 'user', content: [{ type: 'input_text', text: `Earlier screen action result: ${m.content}` }] });
      continue;
    }
    if (m.role === 'assistant' && Array.isArray(m.raw) && (m.rawProvider === 'openai-responses' || m.rawProvider === 'openai')) {
      // The model's own items (reasoning, computer_call…) go back exactly as they came.
      out.push(...(m.raw as unknown[]));
      for (const t of m.toolCalls ?? []) if (t.args.openai_actions) native.set(t.id, { checks: t.args.pending_safety_checks as OpenAiSafetyCheck[] | undefined, replayed: true });
      continue;
    }
    if (m.role === 'tool') {
      out.push({ type: 'function_call_output', call_id: m.toolCallId, output: m.content });
      if (m.images?.length) out.push({ role: 'user', content: [{ type: 'input_text', text: 'Screenshot from the last tool call:' }, ...m.images.map((i) => ({ type: 'input_image', image_url: `data:${i.mime};base64,${i.data}` }))] });
      continue;
    }
    if (m.role === 'assistant') {
      if (m.content) out.push({ role: 'assistant', content: m.content });
      for (const t of m.toolCalls ?? []) {
        if (t.args.openai_actions) { native.set(t.id, { replayed: false }); continue; }
        out.push({ type: 'function_call', call_id: t.id, name: t.name, arguments: JSON.stringify(t.args) });
      }
      continue;
    }
    out.push({ role: 'user', content: m.content });
  }
  return out;
}

export function fromResponsesOutput(data: unknown, computerTool?: string): { text: string; toolCalls: ToolCall[]; stop: 'end' | 'tool' | 'length' | 'refusal'; raw?: unknown } {
  const d = data as { output?: { type: string; content?: { type: string; text?: string; refusal?: string }[]; call_id?: string; name?: string; arguments?: string; action?: Record<string, unknown>; actions?: Record<string, unknown>[]; pending_safety_checks?: OpenAiSafetyCheck[] }[]; status?: string; incomplete_details?: { reason?: string } };
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
    // The built-in computer tool: a batch of actions for Keeper's computer tool.
    if (item.type === 'computer_call' && computerTool) toolCalls.push({ id: item.call_id ?? `call_${toolCalls.length}`, name: computerTool, args: { ...openAiCallArgs(item) } });
  }
  const stop = refusal ? 'refusal' : toolCalls.length ? 'tool' : d.status === 'incomplete' && d.incomplete_details?.reason === 'max_output_tokens' ? 'length' : 'end';
  return { text, toolCalls, stop, ...(computerTool ? { raw: d.output ?? [] } : {}) };
}

function responsesProvider(c: ProviderConfig): ChatProvider {
  const base = (c.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const model = c.model || DEFAULT_MODEL.openai;
  return {
    id: 'openai-responses', label: 'OpenAI', model, local: isLocalUrl(base), supportsTools: c.tools ?? true, contextTokens: c.contextTokens ?? contextGuess(model),
    async chat(messages, tools, opts = {}) {
      // A gateway on this computer (a local proxy) may need no key.
      if (!c.apiKey && !isLocalUrl(base)) throw new Error('Add the OpenAI API key in Settings → AI & Brain.');
      const body: Record<string, unknown> = { model, input: toResponsesInput(messages), store: false };
      const sys = system(messages);
      if (sys) body.instructions = sys;
      if (opts.maxTokens) body.max_output_tokens = opts.maxTokens;
      // OpenAI's own computer tool stands in for Keeper's when the model has it.
      const cu = this.supportsTools ? tools.find((t) => t.native?.openai && openAiComputerToolFor(model, t.native.openai)) : undefined;
      if (tools.length && this.supportsTools) body.tools = tools.map((t) => (t === cu ? openAiComputerToolFor(model, t.native!.openai!) : { type: 'function', name: t.name, description: t.description, parameters: t.parameters }));
      if (cu) {
        // Nothing is stored at OpenAI, so reasoning comes back sealed and is sent again with the next turn.
        body.include = ['reasoning.encrypted_content'];
        body.truncation = 'auto';
      }
      const r = fromResponsesOutput(await postJson(`${base}/responses`, authHeaders('bearer', c.apiKey), body, opts.signal), cu?.name);
      if (r.text) opts.onDelta?.(r.text);
      return r;
    },
  };
}

// ---------------------------------------------------------------- Google Gemini

export function toGemini(messages: ChatMessage[], tools: ToolSpec[], model = ''): Record<string, unknown> {
  const contents: { role: string; parts: unknown[] }[] = [];
  const names = new Map<string, string>();
  const native = new Map<string, Record<string, unknown>>();
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'assistant' && Array.isArray(m.raw) && m.rawProvider === 'gemini') {
      // The model's own parts (with their thought signatures) go back exactly as they came.
      for (const t of m.toolCalls ?? []) {
        if (typeof t.args.gemini_action === 'string') { names.set(t.id, t.args.gemini_action); native.set(t.id, t.args); } else names.set(t.id, t.name);
      }
      contents.push({ role: 'model', parts: m.raw as unknown[] });
      continue;
    }
    if (m.role === 'tool' && native.has(m.toolCallId ?? '')) {
      const args = native.get(m.toolCallId ?? '')!;
      const part = geminiResponsePart(String(args.gemini_action), m.content, m.images ?? [], { error: m.isError, acknowledged: !m.isError && !!geminiNeedsConfirmation(args) });
      const last = contents[contents.length - 1];
      if (last?.role === 'user' && last.parts.every((p) => 'functionResponse' in (p as object) || 'inlineData' in (p as object))) last.parts.push(part);
      else contents.push({ role: 'user', parts: [part] });
      continue;
    }
    if (m.role === 'assistant') {
      const parts: unknown[] = [];
      if (m.content) parts.push({ text: m.content });
      for (const t of m.toolCalls ?? []) { names.set(t.id, t.name); parts.push({ functionCall: { name: t.name, args: t.args } }); }
      contents.push({ role: 'model', parts: parts.length ? parts : [{ text: '…' }] });
    } else if (m.role === 'tool') {
      const part = { functionResponse: { name: names.get(m.toolCallId ?? '') ?? 'tool', response: { content: m.content, ...(m.isError ? { error: true } : {}) } } };
      const pics = (m.images ?? []).map((i) => ({ inlineData: { mimeType: i.mime, data: i.data } }));
      const last = contents[contents.length - 1];
      if (last?.role === 'user' && last.parts.every((p) => 'functionResponse' in (p as object) || 'inlineData' in (p as object))) last.parts.push(part, ...pics);
      else contents.push({ role: 'user', parts: [part, ...pics] });
    } else contents.push({ role: 'user', parts: [{ text: m.content }] });
  }
  const body: Record<string, unknown> = { contents };
  const sys = system(messages);
  if (sys) body.systemInstruction = { parts: [{ text: sys }] };
  // Gemini's own computer-use tool stands in for Keeper's when the model has it.
  const cu = geminiComputerKind(model) ? tools.find((t) => t.native?.gemini) : undefined;
  const fns = tools.filter((t) => t !== cu);
  if (tools.length) body.tools = [...(fns.length ? [{ functionDeclarations: fns.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })) }] : []), ...(cu ? [geminiComputerTool(cu.native!.gemini)] : [])];
  return body;
}

export function fromGemini(data: unknown, computerTool?: string): { text: string; toolCalls: ToolCall[]; stop: 'end' | 'tool' | 'length' | 'refusal'; raw?: unknown } {
  const d = data as { candidates?: { content?: { parts?: { text?: string; thought?: boolean; functionCall?: { id?: string; name: string; args?: Record<string, unknown> } }[] }; finishReason?: string }[]; promptFeedback?: { blockReason?: string } };
  const cand = d.candidates?.[0];
  let text = '';
  const toolCalls: ToolCall[] = [];
  for (const p of cand?.content?.parts ?? []) {
    if (p.text) text += p.text;
    if (p.functionCall && computerTool && fromGeminiCallName(p.functionCall.name)) {
      // One of the computer-use tool's functions: a call to Keeper's computer tool.
      toolCalls.push({ id: p.functionCall.id ?? `call_${toolCalls.length}`, name: computerTool, args: { gemini_action: p.functionCall.name, ...(p.functionCall.args ?? {}) } });
    } else if (p.functionCall) toolCalls.push({ id: p.functionCall.id ?? `call_${toolCalls.length}`, name: p.functionCall.name, args: p.functionCall.args ?? {} });
  }
  const fr = cand?.finishReason ?? '';
  const stop = d.promptFeedback?.blockReason || fr === 'SAFETY' || fr === 'PROHIBITED_CONTENT' ? 'refusal' : toolCalls.length ? 'tool' : fr === 'MAX_TOKENS' ? 'length' : 'end';
  return { text, toolCalls, stop, ...(computerTool && cand?.content?.parts ? { raw: cand.content.parts } : {}) };
}

function geminiProvider(c: ProviderConfig): ChatProvider {
  const base = (c.baseUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
  const model = c.model || 'gemini-flash-latest';
  return {
    id: 'gemini', label: 'Google Gemini', model, local: isLocalUrl(base), supportsTools: c.tools ?? true, contextTokens: c.contextTokens ?? contextGuess(model),
    async chat(messages, tools, opts = {}) {
      if (!c.apiKey && !isLocalUrl(base)) throw new Error('Add the Gemini API key in Settings → AI & Brain.');
      const body = toGemini(messages, this.supportsTools ? tools : [], model);
      if (opts.maxTokens) body.generationConfig = { maxOutputTokens: opts.maxTokens };
      const cu = this.supportsTools && geminiComputerKind(model) ? tools.find((t) => t.native?.gemini) : undefined;
      const r = fromGemini(await postJson(`${base}/models/${encodeURIComponent(model)}:generateContent`, authHeaders('goog-key', c.apiKey), body, opts.signal), cu?.name);
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
      const pics = (m.images ?? []).map((i) => ({ image: { format: i.mime.split('/')[1] ?? 'png', source: { bytes: i.data } } }));
      const block = { toolResult: { toolUseId: m.toolCallId, content: [{ text: m.content }, ...pics], ...(m.isError ? { status: 'error' } : {}) } };
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

// OpenAI over the chat format switches to the Responses API for turns that use the computer,
// since OpenAI's own computer tool exists only there.
const plainOpenAi = providerFactories().find((f) => f.kind === 'openai');
if (plainOpenAi) {
  registerProvider({
    ...plainOpenAi,
    create: (c) => {
      const chat = plainOpenAi.create(c);
      const responses = responsesProvider({ ...c, baseUrl: c.baseUrl || 'https://api.openai.com/v1' });
      return {
        ...chat,
        chat(messages, tools, opts) {
          const cu = chat.supportsTools && tools.some((t) => t.native?.openai && openAiComputerToolFor(chat.model, t.native.openai));
          return cu ? responses.chat(messages, tools, opts) : chat.chat(messages, tools, opts);
        },
      };
    },
  });
}
registerProvider({ kind: 'gemini', label: 'Google Gemini', create: geminiProvider });
registerProvider({ kind: 'bedrock', label: 'Amazon Bedrock', create: bedrockProvider });
