// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The optional assistant. It only ever sees file names, folders, sizes, dates
// and kinds — never file contents — and it can only suggest; nothing is removed
// without the user pressing a button. Works with Claude, OpenAI, or a model
// running locally through Ollama (nothing leaves the computer at all).

import { formatBytes, formatDate } from './format';
import type { AiMessage, AiProvider, AiReply, AiSuggestion, CleanupGroup, DuplicateGroup, FileEntry, Safety } from './types';

export const DEFAULT_MODELS: Record<AiProvider, string> = {
  anthropic: 'claude-opus-5-5',
  openai: 'gpt-5',
  ollama: 'llama3.2',
};

export interface AiContext {
  platform: string;
  disk?: { total: number; free: number };
  cleanup: CleanupGroup[];
  largest: FileEntry[];
  duplicates: DuplicateGroup[];
  downloads: FileEntry[];
  home: string;
}

const MAX_FILES = 120;

/** A compact, metadata-only picture of the disk for the model. */
export function buildContext(ctx: AiContext): { text: string; allowed: Map<string, FileEntry> } {
  const allowed = new Map<string, FileEntry>();
  const line = (f: FileEntry) => {
    allowed.set(f.path, f);
    const src = f.source ? ` from ${f.source.name}` : '';
    return `- ${f.path.replace(ctx.home, '~')} | ${formatBytes(f.size)} | ${f.kind} | modified ${formatDate(f.mtime)}${f.atime ? ` | opened ${formatDate(f.atime)}` : ''}${src}`;
  };
  const parts: string[] = [];
  parts.push(`Operating system: ${ctx.platform}`);
  if (ctx.disk) parts.push(`Disk: ${formatBytes(ctx.disk.free)} free of ${formatBytes(ctx.disk.total)}`);
  if (ctx.cleanup.length) {
    parts.push('\nCleanup groups Keeper already found:');
    for (const g of ctx.cleanup) parts.push(`- ${g.name} (${g.safety}): ${formatBytes(g.size)} in ${g.count} items — ${g.description}`);
  }
  let budget = MAX_FILES;
  const take = (list: FileEntry[], n: number) => {
    const out = list.slice(0, Math.min(n, budget));
    budget -= out.length;
    return out;
  };
  const big = take(ctx.largest, 50);
  if (big.length) parts.push('\nLargest files:', ...big.map(line));
  const dupes = ctx.duplicates.slice(0, 15);
  if (dupes.length) {
    parts.push('\nDuplicate groups (first path is the copy Keeper would keep):');
    for (const g of dupes) {
      const keep = g.files.find((f) => f.path === g.keep)!;
      const rest = take(g.files.filter((f) => f.path !== g.keep), 4);
      parts.push(`* ${g.kind}, ${formatBytes(g.reclaimable)} reclaimable`, line(keep), ...rest.map(line));
    }
  }
  const dl = take(ctx.downloads, 40);
  if (dl.length) parts.push('\nDownloads folder (oldest first):', ...dl.map(line));
  return { text: parts.join('\n'), allowed };
}

const SYSTEM = `You are the assistant inside Keeper, a file manager and disk cleaner. You help people understand what is using their space and decide what they can safely remove.

You only know file names, folders, sizes, dates and kinds from the inventory you are given; you have not seen inside any file. Never claim to know what a file contains.

When you suggest removing something, only use exact paths from the inventory. Prefer things that are clearly safe (installers for apps already installed, duplicate copies, caches, old downloads) and say plainly when something needs the person to look first (personal photos, documents, anything that might be the only copy). Keeper sends files to the Trash, so they can be restored.

Keep the answer short and friendly. After your answer, if you have concrete suggestions, add one fenced code block tagged json in this shape:
{"suggestions":[{"path":"<exact path from the inventory>","reason":"<short reason>","safety":"safe"|"review"}],"search":"<optional plain-English search Keeper should run, e.g. 'videos over 1 GB older than a year'>"}
Leave the block out when you have nothing concrete to suggest.`;

export interface AskOptions {
  provider: AiProvider;
  model?: string;
  apiKey?: string;
  ollamaUrl?: string;
  signal?: AbortSignal;
}

export async function askAssistant(history: AiMessage[], ctx: AiContext, opts: AskOptions): Promise<AiReply> {
  const { text: inventory, allowed } = buildContext(ctx);
  const system = `${SYSTEM}\n\n<inventory>\n${inventory}\n</inventory>`;
  const raw = await callProvider(system, history, opts);
  return parseReply(raw, allowed, ctx.home);
}

async function callProvider(system: string, history: AiMessage[], opts: AskOptions): Promise<string> {
  const model = opts.model || DEFAULT_MODELS[opts.provider];
  if (opts.provider === 'anthropic') {
    if (!opts.apiKey) throw new Error('Add your Anthropic API key in Settings → AI & Brain.');
    // The SDK is large: it loads the first time this provider is used.
    const client = new (await import('@anthropic-ai/sdk')).default({ apiKey: opts.apiKey });
    const response = await client.beta.messages.create(
      {
        model,
        max_tokens: 16000,
        system,
        messages: history.map((m) => ({ role: m.role, content: m.content })),
        output_config: { effort: 'low' },
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      },
      { signal: opts.signal },
    );
    if (response.stop_reason === 'refusal') throw new Error('The assistant declined to answer that. Try asking in a different way.');
    return response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n');
  }
  if (opts.provider === 'openai') {
    if (!opts.apiKey) throw new Error('Add your OpenAI API key in Settings → AI & Brain.');
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: opts.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${opts.apiKey}` },
      body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, ...history] }),
    });
    if (!res.ok) throw new Error(`OpenAI returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content ?? '';
  }
  // Ollama: a model on this computer; nothing leaves the machine.
  const base = (opts.ollamaUrl || 'http://127.0.0.1:11434').replace(/\/$/, '');
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    signal: opts.signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, stream: false, messages: [{ role: 'system', content: system }, ...history] }),
  }).catch(() => {
    throw new Error(`Could not reach Ollama at ${base}. Is it running? (ollama serve)`);
  });
  if (!res.ok) throw new Error(`Ollama returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { message?: { content?: string } };
  return data.message?.content ?? '';
}

/**
 * Splits the model's answer into prose and suggestions. Any suggested path that
 * is not in the inventory Keeper sent is dropped: the model cannot point Keeper
 * at files it was not shown.
 */
export function parseReply(raw: string, allowed: Map<string, FileEntry>, home = ''): AiReply {
  const fence = raw.match(/```json\s*([\s\S]*?)```/i);
  const text = raw.replace(/```json[\s\S]*?```/i, '').trim();
  const suggestions: AiSuggestion[] = [];
  let search: string | undefined;
  if (fence) {
    try {
      const data = JSON.parse(fence[1]) as { suggestions?: { path?: string; reason?: string; safety?: string }[]; search?: string };
      for (const s of data.suggestions ?? []) {
        if (!s.path) continue;
        const p = home && s.path.startsWith('~') ? home + s.path.slice(1) : s.path;
        const f = allowed.get(p);
        if (!f || suggestions.some((x) => x.path === p)) continue;
        const safety: Safety = s.safety === 'safe' ? 'safe' : 'review';
        suggestions.push({ path: p, reason: String(s.reason ?? '').slice(0, 300), size: f.size, safety });
      }
      if (typeof data.search === 'string' && data.search.trim()) search = data.search.trim().slice(0, 200);
    } catch {
      /* not valid JSON: keep the prose only */
    }
  }
  return { text, suggestions, search };
}
