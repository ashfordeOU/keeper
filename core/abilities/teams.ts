// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Several AIs working together. A member is anything that can answer: an AI
// service (Claude, OpenAI, Gemini, Grok, a local model) or a live agent session
// (Claude Code, Codex, Grok in Keeper's Terminal, through the agent hub).
//
//   router     sends each request to the member best suited to it
//   compare    asks everyone the same thing; answers side by side
//   critique   A answers, B reviews, A revises (as many rounds as set)
//   panel      everyone answers, then a chair merges them into one answer
//   delegate   a planner splits the work, members do the parts, the planner assembles

export interface Member {
  id: string;
  label: string;
  /** what it is good at, for the router: 'code', 'writing', 'research', 'private', 'fast', 'cheap', 'images' … */
  strengths?: string[];
  local?: boolean;
  /** rough cost per answer, for budgets */
  costPerCall?: number;
  ask(prompt: string, opts: { system?: string; signal?: AbortSignal }): Promise<string>;
}

export type Strategy = 'router' | 'compare' | 'critique' | 'panel' | 'delegate';

export interface TeamSpec {
  id: string;
  name: string;
  strategy: Strategy;
  /** member ids, in role order: critique = [writer, reviewer]; panel/delegate = [chair/planner, ...rest] */
  members: string[];
  rounds?: number;
  /** stop before spending more than this many calls */
  maxCalls?: number;
  instructions?: string;
}

export interface TranscriptEntry {
  member: string;
  role: string;
  text: string;
  ms: number;
  error?: boolean;
}

export interface TeamResult {
  answer: string;
  /** compare: every member's answer */
  answers?: { member: string; label: string; text: string; error?: boolean }[];
  transcript: TranscriptEntry[];
  calls: number;
  /** router: who was chosen and why */
  routed?: { member: string; reason: string };
}

export const TEAM_TEMPLATES: Omit<TeamSpec, 'id' | 'members'>[] = [
  { name: 'Second opinion', strategy: 'compare', instructions: 'Answer independently.' },
  { name: 'Writer and editor', strategy: 'critique', rounds: 1 },
  { name: 'Expert panel', strategy: 'panel' },
  { name: 'Project team', strategy: 'delegate', maxCalls: 12 },
  { name: 'Best for the job', strategy: 'router' },
];

const TASK_HINTS: [RegExp, string][] = [
  [/\b(code|function|bug|error|stack ?trace|compile|typescript|python|sql|regex|script)\b/i, 'code'],
  [/\b(write|rewrite|email|letter|essay|tone|proofread|edit|summari[sz]e)\b/i, 'writing'],
  [/\b(latest|news|today|research|sources?|compare prices|look up)\b/i, 'research'],
  [/\b(password|salary|medical|health|diagnos|bank|tax|private|personal|secret)\b/i, 'private'],
  [/\b(draw|picture|image|logo|illustrat)\w*/i, 'images'],
];

export function classify(prompt: string): string[] {
  return TASK_HINTS.filter(([re]) => re.test(prompt)).map(([, k]) => k);
}

/** Picks the member for a request: private requests go to a member on this computer when there is one. */
export function route(prompt: string, members: Member[]): { member: Member; reason: string } {
  if (!members.length) throw new Error('The team has no members');
  const kinds = classify(prompt);
  if (kinds.includes('private')) {
    const local = members.find((m) => m.local);
    if (local) return { member: local, reason: 'Looks private, so it stays on this computer' };
  }
  let best = members[0];
  let bestScore = -1;
  for (const m of members) {
    const s = kinds.filter((k) => m.strengths?.includes(k)).length * 10 - (m.costPerCall ?? 0);
    if (s > bestScore) { best = m; bestScore = s; }
  }
  const matched = kinds.filter((k) => best.strengths?.includes(k));
  return { member: best, reason: matched.length ? `Good at ${matched.join(' and ')}` : 'First member (no special strengths matched)' };
}

class Budget {
  calls = 0;
  constructor(private max: number) {}
  take() {
    if (this.calls >= this.max) throw new Error(`The team reached its limit of ${this.max} calls`);
    this.calls++;
  }
}

type Log = (e: TranscriptEntry) => void;

async function call(m: Member, role: string, prompt: string, system: string | undefined, budget: Budget, log: Log, signal?: AbortSignal): Promise<string> {
  budget.take();
  const t0 = Date.now();
  try {
    const text = (await m.ask(prompt, { system, signal })).trim();
    log({ member: m.id, role, text, ms: Date.now() - t0 });
    return text;
  } catch (e) {
    const text = e instanceof Error ? e.message : String(e);
    log({ member: m.id, role, text, ms: Date.now() - t0, error: true });
    throw e;
  }
}

/** "1. …\n2. …" or a JSON array → parts */
export function parseParts(text: string, max = 6): string[] {
  const j = text.match(/\[[\s\S]*\]/);
  if (j) {
    try {
      const v = JSON.parse(j[0]) as unknown[];
      const parts = v.map((x) => (typeof x === 'string' ? x : typeof x === 'object' && x && 'task' in x ? String((x as { task: unknown }).task) : '')).filter(Boolean);
      if (parts.length) return parts.slice(0, max);
    } catch {
      /* fall through to lines */
    }
  }
  return text.split('\n').map((l) => l.replace(/^\s*(\d+[.)]|[-*•])\s*/, '').trim()).filter((l) => l.length > 3).slice(0, max);
}

export async function runTeam(spec: TeamSpec, all: Member[], prompt: string, opts: { signal?: AbortSignal; onEntry?: (e: TranscriptEntry) => void } = {}): Promise<TeamResult> {
  const members = spec.members.map((id) => all.find((m) => m.id === id)).filter((m): m is Member => !!m);
  if (!members.length) throw new Error('None of this team\'s members are available');
  // A plain array (the result goes between processes), and each step reported as it happens.
  const t: TranscriptEntry[] = [];
  const log: Log = (e) => { t.push(e); opts.onEntry?.(e); };
  const budget = new Budget(spec.maxCalls ?? 20);
  const sys = spec.instructions;
  const s = opts.signal;
  switch (spec.strategy) {
    case 'router': {
      const r = route(prompt, members);
      const answer = await call(r.member, 'answer', prompt, sys, budget, log, s);
      return { answer, transcript: t, calls: budget.calls, routed: { member: r.member.id, reason: r.reason } };
    }
    case 'compare': {
      const answers = await Promise.all(members.map(async (m) => {
        try {
          return { member: m.id, label: m.label, text: await call(m, 'answer', prompt, sys, budget, log, s) };
        } catch (e) {
          return { member: m.id, label: m.label, text: e instanceof Error ? e.message : String(e), error: true };
        }
      }));
      return { answer: answers.find((a) => !a.error)?.text ?? '', answers, transcript: t, calls: budget.calls };
    }
    case 'critique': {
      const [writer, reviewer = members[0]] = members;
      let draft = await call(writer, 'draft', prompt, sys, budget, log, s);
      for (let i = 0; i < Math.max(1, spec.rounds ?? 1); i++) {
        const review = await call(reviewer, 'review', `Review this answer to the request below. List concrete problems (wrong facts, gaps, unclear parts) and how to fix them. If it is already good, say "LGTM".\n\nRequest:\n${prompt}\n\nAnswer:\n${draft}`, undefined, budget, log, s);
        if (/\bLGTM\b/.test(review)) break;
        draft = await call(writer, 'revision', `Revise your answer using this review. Reply with the full improved answer only.\n\nRequest:\n${prompt}\n\nYour answer:\n${draft}\n\nReview:\n${review}`, sys, budget, log, s);
      }
      return { answer: draft, transcript: t, calls: budget.calls };
    }
    case 'panel': {
      const [chair, ...rest] = members;
      const panel = rest.length ? rest : [chair];
      const views = await Promise.all(panel.map(async (m) => {
        try {
          return `${m.label}:\n${await call(m, 'view', prompt, sys, budget, log, s)}`;
        } catch {
          return `${m.label}: (no answer)`;
        }
      }));
      const answer = await call(chair, 'chair', `Several assistants answered the request below. Merge them into one best answer: keep what they agree on, resolve disagreements (say which view you chose and why in one line), and drop anything unsupported.\n\nRequest:\n${prompt}\n\n${views.join('\n\n---\n\n')}`, sys, budget, log, s);
      return { answer, transcript: t, calls: budget.calls };
    }
    case 'delegate': {
      const [planner, ...workers] = members;
      const crew = workers.length ? workers : [planner];
      const plan = await call(planner, 'plan', `Split this request into 2 to ${Math.min(6, crew.length * 2)} independent parts that different assistants can do in parallel. Reply only with a JSON array of short task descriptions.\n\nRequest:\n${prompt}`, sys, budget, log, s);
      const parts = parseParts(plan, Math.min(6, crew.length * 2));
      const done = await Promise.all(parts.map(async (part, i) => {
        const m = crew[i % crew.length];
        try {
          return `Part ${i + 1} (${m.label}): ${part}\n${await call(m, `part ${i + 1}`, `You are doing one part of a larger request.\n\nWhole request:\n${prompt}\n\nYour part:\n${part}\n\nReply with your part's result only.`, sys, budget, log, s)}`;
        } catch (e) {
          return `Part ${i + 1}: failed (${e instanceof Error ? e.message : String(e)})`;
        }
      }));
      const answer = await call(planner, 'assemble', `Assemble these parts into one complete answer to the request. Fill small gaps yourself and note any part that failed.\n\nRequest:\n${prompt}\n\n${done.join('\n\n---\n\n')}`, sys, budget, log, s);
      return { answer, transcript: t, calls: budget.calls };
    }
  }
}
