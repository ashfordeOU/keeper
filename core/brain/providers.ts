// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// One shape for every AI Keeper can talk to: Claude, anything that speaks the
// OpenAI chat format (OpenAI, OpenRouter, Groq, Mistral, DeepSeek, Gemini's
// compatible endpoint, LM Studio, llama.cpp, Azure, …), Ollama, and the
// operating system's own on-device model (registered by the platform layer).
// The harness only ever sees ChatProvider, so switching AI changes nothing else.

// The SDK is large: it loads the first time this provider is used.
import type Anthropic from '@anthropic-ai/sdk';
import { noteRateHeaders } from '../usage-tracker/rate-store';
import { COMPATIBLE_PRESETS, isLocalUrl } from './presets';

export { COMPATIBLE_PRESETS, isLocalUrl };

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** assistant turns: the tools it asked for */
  toolCalls?: ToolCall[];
  /** tool turns: which call this answers */
  toolCallId?: string;
  isError?: boolean;
  /** tool turns: pictures that belong to the result (a screenshot from the computer tool) */
  images?: { mime: string; data: string }[];
  /** the provider's own form of an assistant turn (thinking blocks and all), sent back unchanged */
  raw?: unknown;
  rawProvider?: string;
}

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema for the arguments */
  parameters: Record<string, unknown>;
  /**
   * The AI's own built-in form of this tool, used instead of the function when
   * the provider supports it (Claude's computer-use toolset). Its calls come
   * back as calls to this tool, with the member's name in args.action.
   */
  native?: {
    anthropic?: Record<string, unknown>;
    anthropicToolsetName?: string;
    /** OpenAI's computer tool (Responses API): the screenshot size the tool works in */
    openai?: { width: number; height: number };
    /** Gemini's computer-use tool, and which environment it drives */
    gemini?: 'desktop' | 'browser';
  };
}

/** Claude models that take the computer-use toolset (5.5 and later on the Claude API). */
export function supportsAnthropicToolset(model: string): boolean {
  const m = model.match(/claude-(?:opus|sonnet|haiku|fable)-(\d+)(?:-(\d+))?/);
  if (!m) return false;
  const major = Number(m[1]);
  const minor = Number(m[2] ?? 0);
  return major > 5 || (major === 5 && minor >= 5);
}

export interface ChatResult {
  text: string;
  toolCalls: ToolCall[];
  stop: 'end' | 'tool' | 'length' | 'refusal';
  raw?: unknown;
}

export interface ChatOptions {
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
  maxTokens?: number;
}

export interface ChatProvider {
  /** e.g. 'anthropic', 'openai-compatible', 'ollama', 'platform' */
  id: string;
  label: string;
  model: string;
  /** runs on this computer (nothing is sent anywhere) */
  local: boolean;
  supportsTools: boolean;
  /** how many tokens of context the model takes */
  contextTokens: number;
  chat(messages: ChatMessage[], tools: ToolSpec[], opts?: ChatOptions): Promise<ChatResult>;
}

export type ProviderKind = 'anthropic' | 'openai' | 'openai-compatible' | 'ollama' | 'platform' | 'openai-responses' | 'gemini' | 'bedrock';

export interface ProviderConfig {
  kind: ProviderKind;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  /** override when the model's context size is known to differ */
  contextTokens?: number;
  /** some local models cannot call tools; Keeper then looks things up first and hands them over */
  tools?: boolean;
}

export interface ProviderFactory {
  kind: ProviderKind | string;
  label: string;
  create(c: ProviderConfig): ChatProvider;
  /** whether it can run here at all (e.g. the OS model needs a recent system) */
  available?(): Promise<boolean>;
}

const registry = new Map<string, ProviderFactory>();

/** The platform layer adds the operating system's model here (and anyone else may add theirs). */
export function registerProvider(f: ProviderFactory): void {
  registry.set(f.kind, f);
}

export function providerFactories(): ProviderFactory[] {
  return [...registry.values()];
}

export function createProvider(c: ProviderConfig): ChatProvider {
  const f = registry.get(c.kind);
  if (!f) throw new Error(`No AI connection of type “${c.kind}” is available on this computer`);
  return f.create(c);
}

export const DEFAULT_MODEL: Record<string, string> = {
  anthropic: 'claude-opus-5-5',
  openai: 'gpt-5',
  'openai-compatible': '',
  ollama: 'llama3.2',
};

function contextFor(model: string): number {
  const m = model.toLowerCase();
  if (/claude/.test(m)) return 1_000_000;
  if (/gemini/.test(m)) return 1_000_000;
  if (/gpt-5|gpt-4\.1|o3|o4/.test(m)) return 400_000;
  if (/gpt-4o|gpt-4-turbo|mistral-large|deepseek|grok/.test(m)) return 128_000;
  return 8_192;
}

// ---------------------------------------------------------------- Claude

function anthropicProvider(c: ProviderConfig): ChatProvider {
  const model = c.model || DEFAULT_MODEL.anthropic;
  return {
    id: 'anthropic',
    label: 'Claude',
    model,
    local: false,
    supportsTools: true,
    contextTokens: c.contextTokens ?? contextFor(model),
    async chat(messages, tools, opts = {}) {
      if (!c.apiKey) throw new Error('Add your Anthropic API key in Settings → AI & Brain.');
      const client = new (await import('@anthropic-ai/sdk')).default({ apiKey: c.apiKey, ...(c.baseUrl ? { baseURL: c.baseUrl } : {}) });
      const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
      const out: Anthropic.Beta.BetaMessageParam[] = [];
      for (const m of messages) {
        if (m.role === 'system') continue;
        if (m.role === 'assistant') {
          // Thinking blocks and tool calls go back exactly as they came.
          if (m.raw && m.rawProvider === 'anthropic') out.push({ role: 'assistant', content: m.raw as Anthropic.Beta.BetaContentBlockParam[] });
          else out.push({ role: 'assistant', content: m.content || '…' });
          continue;
        }
        if (m.role === 'tool') {
          const content: Anthropic.Beta.BetaToolResultBlockParam['content'] = m.images?.length
            ? [...m.images.map((i) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: i.mime as 'image/png', data: i.data } })), { type: 'text' as const, text: m.content || ' ' }]
            : m.content;
          const block: Anthropic.Beta.BetaToolResultBlockParam = { type: 'tool_result', tool_use_id: m.toolCallId!, content, ...(m.isError ? { is_error: true } : {}) };
          const last = out[out.length - 1];
          // All results for one turn go in one user message.
          if (last?.role === 'user' && Array.isArray(last.content) && last.content.every((b) => (b as { type: string }).type === 'tool_result')) (last.content as Anthropic.Beta.BetaToolResultBlockParam[]).push(block);
          else out.push({ role: 'user', content: [block] });
          continue;
        }
        out.push({ role: 'user', content: m.content });
      }
      const stream = client.beta.messages.stream(
        {
          model,
          max_tokens: opts.maxTokens ?? 16000,
          system: system || undefined,
          messages: out,
          tools: tools.map((t) => (t.native?.anthropic && supportsAnthropicToolset(model) ? t.native.anthropic : { name: t.name, description: t.description, input_schema: t.parameters as Anthropic.Beta.BetaTool.InputSchema })),
          thinking: { type: 'adaptive' },
          output_config: { effort: 'medium' },
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
        } as unknown as Anthropic.Beta.MessageCreateParamsStreaming,
        { signal: opts.signal },
      );
      if (opts.onDelta) stream.on('text', (d) => opts.onDelta!(d));
      const msg = await stream.finalMessage();
      // Rate limits left, for the usage tracker (headers only; nothing is stored).
      noteRateHeaders('anthropic', (n) => stream.response?.headers.get(n));
      const text = msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
      // A member of a built-in toolset (e.g. "left_click" of the computer toolset) becomes a call to Keeper's tool of that name.
      const toolsetOwner = (set?: string) => tools.find((t) => t.native?.anthropicToolsetName && t.native.anthropicToolsetName === set);
      const toolCalls = msg.content.flatMap((b) => {
        if (b.type !== 'tool_use') return [];
        const owner = toolsetOwner((b as { toolset_name?: string }).toolset_name);
        if (owner) return [{ id: b.id, name: owner.name, args: { action: b.name, ...((b.input ?? {}) as Record<string, unknown>) } }];
        return [{ id: b.id, name: b.name, args: (b.input ?? {}) as Record<string, unknown> }];
      });
      const stop = msg.stop_reason === 'refusal' ? 'refusal' : msg.stop_reason === 'max_tokens' ? 'length' : toolCalls.length ? 'tool' : 'end';
      return { text, toolCalls, stop, raw: msg.content };
    },
  };
}

// ---------------------------------------------------------------- OpenAI chat format

interface OaiMessage {
  role: string;
  content: string | null;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

function toOai(messages: ChatMessage[]): OaiMessage[] {
  return messages.flatMap((m): OaiMessage[] => {
    if (m.role === 'tool') {
      const out: OaiMessage[] = [{ role: 'tool', content: m.content, tool_call_id: m.toolCallId }];
      // Tool messages carry text only; a picture that belongs to the result follows as the user's.
      if (m.images?.length) out.push({ role: 'user', content: [{ type: 'text', text: 'Screenshot from the last tool call:' }, ...m.images.map((i) => ({ type: 'image_url', image_url: { url: `data:${i.mime};base64,${i.data}` } }))] as unknown as string });
      return out;
    }
    if (m.role === 'assistant' && m.toolCalls?.length) {
      return [{ role: 'assistant', content: m.content || null, tool_calls: m.toolCalls.map((t) => ({ id: t.id, type: 'function' as const, function: { name: t.name, arguments: JSON.stringify(t.args) } })) }];
    }
    return [{ role: m.role, content: m.content }];
  });
}

function parseArgs(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

/** Reads a text/event-stream body line by line. */
async function* sse(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line.startsWith('data:')) yield line.slice(5).trim();
    }
  }
  if (buf.trim().startsWith('data:')) yield buf.trim().slice(5).trim();
}

function compatibleProvider(c: ProviderConfig, label = 'OpenAI-compatible'): ChatProvider {
  const base = (c.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const model = c.model || DEFAULT_MODEL.openai;
  const local = isLocalUrl(base);
  return {
    id: c.kind,
    label,
    model,
    local,
    supportsTools: c.tools ?? true,
    contextTokens: c.contextTokens ?? contextFor(model),
    async chat(messages, tools, opts = {}) {
      if (!c.apiKey && !local) throw new Error(`Add the API key for ${base} in Settings → AI & Brain.`);
      const body: Record<string, unknown> = { model, messages: toOai(messages), stream: true };
      if (tools.length && this.supportsTools) body.tools = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        signal: opts.signal,
        headers: { 'content-type': 'application/json', ...(c.apiKey ? { authorization: `Bearer ${c.apiKey}`, 'api-key': c.apiKey } : {}) },
        body: JSON.stringify(body),
      }).catch((e) => {
        throw new Error(local ? `Could not reach the model at ${base}. Is it running?` : `Could not reach ${base}: ${e instanceof Error ? e.message : e}`);
      });
      noteRateHeaders(base, (n) => res.headers.get(n));
      if (!res.ok) throw new Error(`${new URL(base).hostname} returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
      let text = '';
      const calls = new Map<number, { id: string; name: string; args: string }>();
      let finish = '';
      const type = res.headers.get('content-type') ?? '';
      if (!type.includes('event-stream') || !res.body) {
        const data = (await res.json()) as { choices?: { message?: OaiMessage; finish_reason?: string }[] };
        const m = data.choices?.[0]?.message;
        text = m?.content ?? '';
        if (text) opts.onDelta?.(text);
        m?.tool_calls?.forEach((t, i) => calls.set(i, { id: t.id, name: t.function.name, args: t.function.arguments }));
        finish = data.choices?.[0]?.finish_reason ?? '';
      } else {
        for await (const data of sse(res.body)) {
          if (data === '[DONE]') break;
          let ev: { choices?: { delta?: { content?: string | null; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] }; finish_reason?: string | null }[] };
          try { ev = JSON.parse(data); } catch { continue; }
          const ch = ev.choices?.[0];
          if (!ch) continue;
          if (ch.delta?.content) { text += ch.delta.content; opts.onDelta?.(ch.delta.content); }
          for (const t of ch.delta?.tool_calls ?? []) {
            const i = t.index ?? 0;
            const cur = calls.get(i) ?? { id: '', name: '', args: '' };
            if (t.id) cur.id = t.id;
            if (t.function?.name) cur.name += t.function.name;
            if (t.function?.arguments) cur.args += t.function.arguments;
            calls.set(i, cur);
          }
          if (ch.finish_reason) finish = ch.finish_reason;
        }
      }
      const toolCalls = [...calls.values()].filter((t) => t.name).map((t, i) => ({ id: t.id || `call_${i}`, name: t.name, args: parseArgs(t.args) }));
      return { text, toolCalls, stop: toolCalls.length ? 'tool' : finish === 'length' ? 'length' : finish === 'content_filter' ? 'refusal' : 'end' };
    },
  };
}

// ---------------------------------------------------------------- Ollama

function ollamaProvider(c: ProviderConfig): ChatProvider {
  const base = (c.baseUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '');
  const model = c.model || DEFAULT_MODEL.ollama;
  return {
    id: 'ollama',
    label: 'Ollama',
    model,
    local: isLocalUrl(base),
    supportsTools: c.tools ?? true,
    contextTokens: c.contextTokens ?? 8_192,
    async chat(messages, tools, opts = {}) {
      const body: Record<string, unknown> = {
        model,
        stream: true,
        // Ollama takes pictures as a list of base64 strings on the message (vision models only).
        messages: messages.map((m) => (m.role === 'assistant' && m.toolCalls?.length ? { role: 'assistant', content: m.content, tool_calls: m.toolCalls.map((t) => ({ function: { name: t.name, arguments: t.args } })) } : { role: m.role, content: m.content, ...(m.images?.length ? { images: m.images.map((i) => i.data) } : {}) })),
      };
      if (tools.length && this.supportsTools) body.tools = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
      const res = await fetch(`${base}/api/chat`, { method: 'POST', signal: opts.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {
        throw new Error(`Could not reach Ollama at ${base}. Is it running? (ollama serve)`);
      });
      if (!res.ok) {
        const t = await res.text();
        // Models without tool support say so; retry once without tools.
        if (tools.length && /does not support tools/i.test(t)) { this.supportsTools = false; return this.chat(messages, [], opts); }
        throw new Error(`Ollama returned ${res.status}: ${t.slice(0, 300)}`);
      }
      let text = '';
      const toolCalls: ToolCall[] = [];
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (!line) continue;
          let ev: { message?: { content?: string; tool_calls?: { function: { name: string; arguments: Record<string, unknown> | string } }[] } };
          try { ev = JSON.parse(line); } catch { continue; }
          const d = ev.message?.content;
          if (d) { text += d; opts.onDelta?.(d); }
          for (const t of ev.message?.tool_calls ?? []) toolCalls.push({ id: `call_${toolCalls.length}`, name: t.function.name, args: typeof t.function.arguments === 'string' ? parseArgs(t.function.arguments) : t.function.arguments });
        }
      }
      return { text, toolCalls, stop: toolCalls.length ? 'tool' : 'end' };
    },
  };
}

registerProvider({ kind: 'anthropic', label: 'Claude (Anthropic)', create: anthropicProvider });
registerProvider({ kind: 'openai', label: 'OpenAI', create: (c) => compatibleProvider({ ...c, baseUrl: c.baseUrl || 'https://api.openai.com/v1' }, 'OpenAI') });
registerProvider({ kind: 'openai-compatible', label: 'Any OpenAI-compatible service', create: (c) => compatibleProvider(c, COMPATIBLE_PRESETS.find((p) => c.baseUrl?.startsWith(p.baseUrl))?.label ?? 'OpenAI-compatible') });
registerProvider({ kind: 'ollama', label: 'Ollama (this computer)', create: ollamaProvider });
