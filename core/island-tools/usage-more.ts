// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// More AI services for the Island's usage meter, beside the ones in
// usage.ts: Gemini-style CLIs (Gemini CLI, Qwen Code) and OpenCode count
// replies and tokens from their own session files on this computer. Nothing
// is sent anywhere. Pure parsers, merged into the usage list by
// electron/services/island-tools.ts.

import type { UsageReport, UsageWindow } from './usage';

export type MoreUsageTool = 'gemini' | 'qwen' | 'opencode';

export interface ReplyLine {
  at: number;
  tokens: number;
  cost?: number;
}

/** Replies with token counts from a Gemini-style session file (chats/session-*.json). */
export function geminiReplies(json: string): ReplyLine[] {
  let o: { messages?: { type?: string; timestamp?: string; tokens?: Record<string, number> }[] };
  try {
    o = JSON.parse(json);
  } catch {
    return [];
  }
  const out: ReplyLine[] = [];
  for (const m of o.messages ?? []) {
    if (m.type !== 'gemini' && m.type !== 'model' && m.type !== 'assistant') continue;
    const at = Date.parse(m.timestamp ?? '');
    if (!Number.isFinite(at)) continue;
    const t = m.tokens ?? {};
    out.push({ at, tokens: Number(t.total ?? (t.input ?? 0) + (t.output ?? 0) + (t.thoughts ?? 0) + (t.tool ?? 0)) || 0 });
  }
  return out;
}

/** One OpenCode message file: assistant replies carry tokens and cost. */
export function opencodeReply(json: string): ReplyLine | null {
  try {
    const m = JSON.parse(json) as { role?: string; time?: { created?: number; completed?: number }; tokens?: { input?: number; output?: number; reasoning?: number; cache?: { read?: number; write?: number } }; cost?: number };
    if (m.role !== 'assistant' || !m.time?.created) return null;
    const t = m.tokens ?? {};
    return { at: m.time.created, tokens: (t.input ?? 0) + (t.output ?? 0) + (t.reasoning ?? 0) + (t.cache?.read ?? 0) + (t.cache?.write ?? 0), cost: typeof m.cost === 'number' ? m.cost : undefined };
  } catch {
    return null;
  }
}

const startOfDay = (now: number) => new Date(now).setHours(0, 0, 0, 0);

/**
 * Today and the last 7 days. With a daily request allowance (free tiers count
 * requests per day, reset at midnight Pacific), today shows as a share of it.
 */
export function dailyWindows(lines: ReplyLine[], now = Date.now(), dailyLimit?: number): UsageWindow[] {
  const day0 = startOfDay(now);
  const today = lines.filter((l) => l.at >= day0);
  const week = lines.filter((l) => l.at > now - 7 * 86_400_000);
  const sum = (ls: ReplyLine[]) => ls.reduce((n, l) => n + l.tokens, 0);
  const w: UsageWindow = { label: 'Today', tokens: sum(today), used: today.length, resetsAt: day0 + 86_400_000 };
  if (dailyLimit && dailyLimit > 0) Object.assign(w, { limit: dailyLimit, usedPercent: Math.min(100, (today.length / dailyLimit) * 100) });
  return [w, { label: 'Last 7 days', tokens: sum(week), used: week.length }];
}

/** Five-hour blocks and the week, with what it cost (OpenCode records the price of each reply). */
export function costWindows(lines: ReplyLine[], now = Date.now()): (UsageWindow & { cost?: number })[] {
  const h5 = lines.filter((l) => l.at > now - 5 * 3600_000);
  const week = lines.filter((l) => l.at > now - 7 * 86_400_000);
  const sum = (ls: ReplyLine[], k: 'tokens' | 'cost') => ls.reduce((n, l) => n + (l[k] ?? 0), 0);
  return [
    { label: 'Last 5 hours', tokens: sum(h5, 'tokens'), used: h5.length, cost: sum(h5, 'cost') || undefined },
    { label: 'Last 7 days', tokens: sum(week, 'tokens'), used: week.length, cost: sum(week, 'cost') || undefined },
  ];
}

export const MORE_TOOLS: { id: MoreUsageTool; label: string; how: string; daily?: number }[] = [
  { id: 'gemini', label: 'Gemini CLI', how: 'Replies and tokens counted from its session files in ~/.gemini (signed in with a Google account, the free tier allows about 1,000 requests a day).', daily: 1000 },
  { id: 'qwen', label: 'Qwen Code', how: 'Replies and tokens counted from its session files in ~/.qwen (the free sign-in allows about 2,000 requests a day).', daily: 2000 },
  { id: 'opencode', label: 'OpenCode', how: 'Tokens and cost counted from its message files in ~/.local/share/opencode.' },
];

export function report(tool: MoreUsageTool, lines: ReplyLine[], files: number, now = Date.now(), dailyLimit?: number): UsageReport {
  const info = MORE_TOOLS.find((t) => t.id === tool)!;
  const base = { tool: tool as UsageReport['tool'], label: info.label, updatedAt: now };
  if (!files) return { ...base, state: 'none', windows: [], source: '', message: info.how };
  const windows = tool === 'opencode' ? costWindows(lines, now) : dailyWindows(lines, now, dailyLimit ?? info.daily);
  return { ...base, state: 'partial', windows, source: `Counted from ${files} session file${files === 1 ? '' : 's'} on this computer` };
}

/** What can honestly be said about services that keep no counts on the computer. */
export const NO_LOCAL_COUNTS: Record<string, string> = {
  grok: 'Grok’s tools keep no usage on this computer and xAI has no read-only usage endpoint for a personal sign-in; Keeper links to its usage page instead.',
};
