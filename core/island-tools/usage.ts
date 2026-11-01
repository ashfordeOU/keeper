// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// AI usage in the Island: how much of each coding assistant's session and
// weekly allowance is used, read from what those tools already keep on this
// computer (and, only when the person allows it, from the provider's own
// usage endpoint with the sign-in that tool already has). Pure parsers.

export type UsageTool = 'claude' | 'codex' | 'copilot' | 'cursor' | 'gemini' | 'grok' | 'qwen' | 'opencode' | 'ollama' | 'lmstudio' | 'antigravity';

export interface UsageWindow {
  /** "5-hour session", "Weekly", "Monthly premium requests"… */
  label: string;
  /** 0–100, how much is used; undefined when only token counts are known */
  usedPercent?: number;
  /** ms since epoch */
  resetsAt?: number;
  /** tokens counted locally in this window */
  tokens?: number;
  /** requests used / allowed, where the tool counts requests */
  used?: number;
  limit?: number;
}

export interface UsageReport {
  tool: UsageTool;
  label: string;
  /** found: the tool is installed and signed in here; partial: only local counts; none: nothing here */
  state: 'ok' | 'partial' | 'none' | 'error';
  windows: UsageWindow[];
  /** where the numbers came from, in plain words */
  source: string;
  message?: string;
  updatedAt: number;
}

export const USAGE_TOOLS: { id: UsageTool; label: string; how: string }[] = [
  { id: 'claude', label: 'Claude Code', how: 'Token counts from its session files in ~/.claude; exact session and weekly limits from Anthropic with Claude Code\'s own sign-in when you allow it.' },
  { id: 'codex', label: 'Codex', how: 'The 5-hour and weekly limits Codex writes into its session files in ~/.codex.' },
  { id: 'copilot', label: 'GitHub Copilot', how: 'Premium requests left this month, from GitHub with Copilot\'s own sign-in when you allow it.' },
  { id: 'cursor', label: 'Cursor', how: 'Requests used this month, from Cursor with its own sign-in when you allow it (needs the sqlite3 command to read it).' },
  { id: 'gemini', label: 'Gemini', how: 'Gemini CLI does not keep its limits on this computer; open its usage page instead.' },
  { id: 'grok', label: 'Grok', how: 'Grok does not keep its limits on this computer; open its usage page instead.' },
  { id: 'ollama', label: 'Ollama', how: 'Models loaded right now, the memory they hold and when they unload, from Ollama on this computer (127.0.0.1:11434). Local models have no limits.' },
  { id: 'lmstudio', label: 'LM Studio', how: 'Models loaded in LM Studio\'s local server (127.0.0.1:1234). Local models have no limits.' },
  { id: 'antigravity', label: 'Antigravity', how: 'Antigravity does not keep its limits on this computer; its usage shows in its own settings.' },
];

// ---------------------------------------------------------------- local model servers

/** Ollama `GET /api/ps`: the loaded models, their size in memory and when they unload. */
export function ollamaPs(body: unknown): UsageWindow[] {
  const models = (body as { models?: { name?: string; model?: string; size?: number; size_vram?: number; expires_at?: string }[] })?.models;
  if (!Array.isArray(models)) return [];
  return models.map((m) => {
    const gb = (n?: number) => (n ? `${(n / 1024 ** 3).toFixed(1)} GB` : '');
    const where = m.size_vram && m.size && m.size_vram >= m.size * 0.95 ? 'graphics memory' : m.size_vram ? `${Math.round(((m.size_vram ?? 0) / (m.size || 1)) * 100)}% on graphics` : 'memory';
    const t = Date.parse(m.expires_at ?? '');
    return { label: `${m.name ?? m.model ?? 'Model'} · ${gb(m.size)} in ${where}`, resetsAt: Number.isFinite(t) && t < Date.now() + 365 * 86_400_000 ? t : undefined };
  });
}

/** LM Studio `GET /api/v0/models`: models with state "loaded". */
export function lmStudioModels(body: unknown): UsageWindow[] {
  const data = (body as { data?: { id?: string; state?: string; type?: string; max_context_length?: number }[] })?.data;
  if (!Array.isArray(data)) return [];
  return data.filter((m) => m.state === 'loaded').map((m) => ({ label: `${m.id ?? 'Model'} loaded${m.max_context_length ? ` · ${Math.round(m.max_context_length / 1024)}k context` : ''}` }));
}

const H5 = 5 * 3600_000;
const D7 = 7 * 86_400_000;

// ---------------------------------------------------------------- Claude Code

export interface TokenLine {
  at: number;
  tokens: number;
  model?: string;
}

/** Assistant turns with token usage from a Claude Code session file (JSON lines). */
export function claudeTokenLines(jsonl: string): TokenLine[] {
  const out: TokenLine[] = [];
  const seen = new Set<string>();
  for (const line of jsonl.split('\n')) {
    if (!line.includes('"usage"')) continue;
    try {
      const o = JSON.parse(line) as { timestamp?: string; requestId?: string; message?: { id?: string; model?: string; usage?: Record<string, number> } };
      const u = o.message?.usage;
      if (!u || !o.timestamp) continue;
      // Streaming writes the same message more than once; count it once.
      const id = `${o.message?.id ?? ''}:${o.requestId ?? ''}`;
      if (id !== ':' && seen.has(id)) continue;
      seen.add(id);
      const tokens = (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
      out.push({ at: Date.parse(o.timestamp), tokens, model: o.message?.model });
    } catch {
      /* a partly written line */
    }
  }
  return out.filter((l) => Number.isFinite(l.at));
}

/**
 * Claude's session limit runs in 5-hour blocks that start with the first message
 * after the previous block ended. Returns the current block (if one is open).
 */
export function claudeBlock(lines: TokenLine[], now = Date.now()): { start: number; end: number; tokens: number } | undefined {
  const sorted = [...lines].sort((a, b) => a.at - b.at);
  let start = -1;
  let tokens = 0;
  for (const l of sorted) {
    if (start < 0 || l.at >= start + H5) {
      start = Math.floor(l.at / 3600_000) * 3600_000;
      tokens = 0;
    }
    tokens += l.tokens;
  }
  if (start < 0 || now >= start + H5) return undefined;
  return { start, end: start + H5, tokens };
}

export function claudeLocal(lines: TokenLine[], now = Date.now()): UsageWindow[] {
  const block = claudeBlock(lines, now);
  const week = lines.filter((l) => l.at > now - D7).reduce((n, l) => n + l.tokens, 0);
  return [
    { label: '5-hour session', tokens: block?.tokens ?? 0, resetsAt: block?.end },
    { label: 'Last 7 days', tokens: week },
  ];
}

const pct = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return undefined;
  // Some answers give 0–1, others 0–100.
  return n <= 1 && n > 0 && !Number.isInteger(n) ? n * 100 : n;
};
const when = (v: unknown, base = 0): number | undefined => {
  if (typeof v === 'string') { const t = Date.parse(v); return Number.isFinite(t) ? t : undefined; }
  if (typeof v === 'number' && Number.isFinite(v)) return v > 1e12 ? v : v > 1e9 ? v * 1000 : base ? base + v * 1000 : undefined;
  return undefined;
};

/** Anthropic's account usage answer (five_hour / seven_day, or a newer `limits` list). */
export function claudeOAuthUsage(body: unknown): UsageWindow[] {
  const o = (body ?? {}) as Record<string, unknown>;
  const out: UsageWindow[] = [];
  const add = (label: string, v: unknown) => {
    const w = v as Record<string, unknown> | null | undefined;
    if (!w || typeof w !== 'object') return;
    const u = pct(w.utilization ?? w.used_percent ?? w.percent);
    if (u === undefined) return;
    out.push({ label, usedPercent: u, resetsAt: when(w.resets_at ?? w.reset_at) });
  };
  add('5-hour session', o.five_hour);
  add('Weekly', o.seven_day);
  add('Weekly (Opus)', o.seven_day_opus);
  add('Weekly (Sonnet)', o.seven_day_sonnet);
  if (Array.isArray(o.limits)) {
    for (const l of o.limits as Record<string, unknown>[]) {
      const name = String(l.name ?? l.type ?? l.window ?? 'Limit');
      if (out.some((x) => x.label.toLowerCase() === name.toLowerCase())) continue;
      add(name.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()), l);
    }
  }
  return out;
}

// ---------------------------------------------------------------- Codex

/** The newest rate-limit report in a Codex session file (JSON lines). Handles the older and newer shapes. */
export function codexRateLimits(jsonl: string): UsageWindow[] | undefined {
  const lines = jsonl.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.includes('rate_limit')) continue;
    try {
      const o = JSON.parse(line) as { timestamp?: string; payload?: Record<string, unknown> } & Record<string, unknown>;
      const p = (o.payload ?? o) as Record<string, unknown>;
      const rl = (p.rate_limits ?? p.rate_limit ?? (p.msg as Record<string, unknown> | undefined)?.rate_limits) as Record<string, unknown> | undefined;
      if (!rl) continue;
      const base = o.timestamp ? Date.parse(o.timestamp) : 0;
      const out: UsageWindow[] = [];
      const read = (v: unknown, fallback: string) => {
        const w = v as Record<string, unknown> | undefined;
        if (!w) return;
        const mins = Number(w.window_minutes ?? (Number(w.limit_window_seconds) / 60));
        const label = mins === 300 ? '5-hour session' : mins >= 10_000 && mins <= 10_100 ? 'Weekly' : Number.isFinite(mins) && mins > 0 ? `${Math.round(mins / 60)}-hour window` : fallback;
        const resets = w.resets_at !== undefined ? when(w.resets_at) : w.reset_at !== undefined ? when(w.reset_at) : w.resets_in_seconds !== undefined ? when(Number(w.resets_in_seconds), base) : undefined;
        const u = pct(w.used_percent);
        if (u !== undefined) out.push({ label, usedPercent: u, resetsAt: resets });
      };
      read(rl.primary ?? rl.primary_window, '5-hour session');
      read(rl.secondary ?? rl.secondary_window, 'Weekly');
      if (out.length) return out;
    } catch {
      /* skip */
    }
  }
  return undefined;
}

// ---------------------------------------------------------------- Copilot

/** The OAuth token Copilot's editors keep in ~/.config/github-copilot/{apps,hosts}.json. */
export function copilotToken(json: string): string | undefined {
  try {
    const o = JSON.parse(json) as Record<string, { oauth_token?: string }>;
    for (const [k, v] of Object.entries(o)) if (k.startsWith('github.com') && v?.oauth_token) return v.oauth_token;
  } catch {
    /* not JSON */
  }
  return undefined;
}

export function copilotQuota(body: unknown): UsageWindow[] {
  const o = (body ?? {}) as Record<string, unknown>;
  const snaps = (o.quota_snapshots ?? {}) as Record<string, Record<string, unknown>>;
  const reset = when(o.quota_reset_date ?? o.quota_reset_date_utc);
  const out: UsageWindow[] = [];
  const add = (key: string, label: string) => {
    const s = snaps[key];
    if (!s || s.unlimited === true) return;
    const ent = Number(s.entitlement);
    const rem = Number(s.remaining ?? s.quota_remaining);
    const left = pct(s.percent_remaining) ?? (ent > 0 && Number.isFinite(rem) ? (rem / ent) * 100 : undefined);
    if (left === undefined) return;
    out.push({ label, usedPercent: Math.max(0, Math.min(100, 100 - left)), resetsAt: reset, used: ent > 0 && Number.isFinite(rem) ? ent - rem : undefined, limit: ent > 0 ? ent : undefined });
  };
  add('premium_interactions', 'Premium requests this month');
  add('chat', 'Chat this month');
  add('completions', 'Completions this month');
  return out;
}

// ---------------------------------------------------------------- Cursor

/** Cursor's usage answer: { "gpt-4": { numRequests, maxRequestUsage }, startOfMonth }. */
export function cursorUsage(body: unknown): UsageWindow[] {
  const o = (body ?? {}) as Record<string, unknown>;
  const start = when(o.startOfMonth);
  const resets = start ? new Date(new Date(start).setMonth(new Date(start).getMonth() + 1)).getTime() : undefined;
  const out: UsageWindow[] = [];
  for (const [model, v] of Object.entries(o)) {
    const w = v as Record<string, unknown>;
    if (!w || typeof w !== 'object' || w.numRequests === undefined) continue;
    const used = Number(w.numRequests);
    const limit = w.maxRequestUsage === null || w.maxRequestUsage === undefined ? undefined : Number(w.maxRequestUsage);
    out.push({ label: model === 'gpt-4' ? 'Premium requests this month' : `${model} requests this month`, used, limit, usedPercent: limit ? Math.min(100, (used / limit) * 100) : undefined, resetsAt: resets });
  }
  return out;
}

// ---------------------------------------------------------------- shared

/** The window closest to its limit, for a warning in the closed Island. */
export function mostUsed(reports: UsageReport[]): { tool: UsageTool; label: string; window: UsageWindow } | undefined {
  let best: { tool: UsageTool; label: string; window: UsageWindow } | undefined;
  for (const r of reports) for (const w of r.windows) {
    if (w.usedPercent === undefined) continue;
    if (!best || w.usedPercent > (best.window.usedPercent ?? 0)) best = { tool: r.tool, label: r.label, window: w };
  }
  return best;
}

export function warnLevel(usedPercent: number | undefined): 'ok' | 'high' | 'full' {
  if (usedPercent === undefined) return 'ok';
  return usedPercent >= 98 ? 'full' : usedPercent >= 80 ? 'high' : 'ok';
}

export function formatTokens(n: number): string {
  return n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n);
}
