// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Using more than one AI sensibly: a fallback chain (when one service fails,
// the next answers), a privacy rule (once a conversation touches a private
// folder, it continues on an AI that runs on this computer), and a meter that
// counts tokens per connection. Each wraps a ChatProvider and is one itself.

import type { ChatMessage, ChatOptions, ChatProvider, ChatResult, ToolSpec } from './providers';

/** Worth trying the next AI: network trouble, rate limits, overload, server errors, a missing key. */
export function isRetryable(e: unknown): boolean {
  const status = (e as { status?: number })?.status;
  if (typeof status === 'number') return status === 401 || status === 403 || status === 404 || status === 408 || status === 409 || status === 429 || status >= 500;
  const m = e instanceof Error ? e.message : String(e);
  if (/Stopped|aborted|AbortError/i.test(m)) return false;
  return /could not reach|ECONN|ETIMEDOUT|ENOTFOUND|fetch failed|socket|timeout|returned (401|403|404|408|409|429|5\d\d)|Add (your|the|a) .*key|overloaded|rate limit/i.test(m);
}

/** Tries each provider in order; the conversation is kept, so the next one carries on. */
export function fallbackChain(chain: ChatProvider[], onSwitch?: (from: ChatProvider, to: ChatProvider, why: string) => void): ChatProvider {
  if (!chain.length) throw new Error('No AI to use');
  if (chain.length === 1) return chain[0];
  const first = chain[0];
  let current = 0;
  return {
    id: first.id,
    label: first.label,
    model: first.model,
    // Local only when every link is.
    local: chain.every((p) => p.local),
    supportsTools: chain.every((p) => p.supportsTools),
    contextTokens: Math.min(...chain.map((p) => p.contextTokens)),
    async chat(messages: ChatMessage[], tools: ToolSpec[], opts?: ChatOptions): Promise<ChatResult> {
      let lastErr: unknown;
      for (let i = current; i < chain.length; i++) {
        const p = chain[i];
        try {
          // A different service cannot read another's private reasoning blocks.
          const msgs = i === 0 ? messages : messages.map((m) => (m.raw && m.rawProvider !== p.id ? { ...m, raw: undefined, rawProvider: undefined } : m));
          const r = await p.chat(msgs, tools, opts);
          current = i;
          this.label = p.label;
          this.model = p.model;
          return r;
        } catch (e) {
          lastErr = e;
          if (!isRetryable(e) || i === chain.length - 1) throw e;
          onSwitch?.(p, chain[i + 1], e instanceof Error ? e.message : String(e));
        }
      }
      throw lastErr;
    },
  };
}

const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

/** Does any text in the conversation mention a path inside one of these folders? */
export function touchesPrivate(messages: ChatMessage[], folders: string[]): boolean {
  if (!folders.length) return false;
  const fs = folders.map(norm).filter(Boolean);
  for (const m of messages) {
    const t = m.content.replace(/\\/g, '/').toLowerCase();
    if (fs.some((f) => t.includes(f + '/') || t.endsWith(f))) return true;
  }
  return false;
}

/**
 * Starts on `main`; as soon as a private folder appears in the conversation,
 * the rest of it goes to `local` (and the private text never reaches `main`).
 */
export function privacyRouter(main: ChatProvider, local: ChatProvider, folders: string[], onRoute?: (to: ChatProvider) => void): ChatProvider {
  if (!folders.length || main === local) return main;
  let switched = false;
  return {
    id: main.id,
    label: main.label,
    model: main.model,
    local: main.local,
    supportsTools: main.supportsTools && local.supportsTools,
    contextTokens: Math.min(main.contextTokens, local.contextTokens),
    async chat(messages, tools, opts) {
      if (!switched && touchesPrivate(messages, folders)) {
        switched = true;
        this.label = local.label;
        this.model = local.model;
        this.local = local.local;
        onRoute?.(local);
      }
      if (!switched) return main.chat(messages, tools, opts);
      return local.chat(messages.map((m) => (m.raw && m.rawProvider !== local.id ? { ...m, raw: undefined, rawProvider: undefined } : m)), tools, opts);
    },
  };
}

/** Rough tokens: four characters each. Services that report exact counts can override. */
const tokens = (s: string) => Math.ceil(s.length / 4);

/** Counts every call (tokens in and out, errors) for one connection. */
export function metered(p: ChatProvider, record: (input: number, output: number, error: boolean) => void): ChatProvider {
  return {
    ...p,
    async chat(messages, tools, opts) {
      const input = messages.reduce((n, m) => n + tokens(m.content) + 4, 0) + tools.reduce((n, t) => n + tokens(t.description) + tokens(JSON.stringify(t.parameters)), 0);
      try {
        const r = await p.chat(messages, tools, opts);
        record(input, tokens(r.text) + r.toolCalls.reduce((n, t) => n + tokens(JSON.stringify(t.args)) + 4, 0), false);
        return r;
      } catch (e) {
        record(input, 0, true);
        throw e;
      }
    },
  };
}
