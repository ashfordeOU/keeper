// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Ready-made ways for several agents to work together. A recipe names roles
// (which harnesses suit each), opens a room, and posts the first tasks; the
// agents then use the hub to claim, hand off and report. The person picks
// which installed agent fills each role.

export interface RecipeRole {
  id: string;
  title: string;
  /** harnesses that suit the role, best first (any installed one can be chosen) */
  prefer: string[];
  /** how many of this role */
  count: number;
  /** what this agent is told when it starts */
  brief: string;
}

export interface Recipe {
  id: string;
  name: string;
  description: string;
  roles: RecipeRole[];
  /** first tasks: role id → title (with {goal}) */
  kickoff: { role: string; title: string; detail: string }[];
}

const HUB_HOWTO = 'You are one of several AI agents in Keeper\'s agent hub, possibly running different tools and accounts. Use the hub tools: hub_list_agents to see who is here, hub_inbox for messages, hub_send / hub_post to talk (@name mentions someone), hub_tasks / hub_claim / hub_complete / hub_handoff for the shared task board, hub_lock before editing files others may touch, and hub_scratch_put/get for shared notes. Keep messages short and concrete.';

export const RECIPES: Recipe[] = [
  {
    id: 'plan-build-review', name: 'Plan, build, review',
    description: 'One agent plans and splits the work, two build it in parallel, a third reviews. Good for mixing strengths, e.g. one model plans, two coding agents build, another model reviews.',
    roles: [
      { id: 'planner', title: 'Planner', prefer: ['claude', 'gemini', 'codex', 'grok'], count: 1, brief: 'You plan. Break the goal into independent tasks, post each with hub_post_task (assign @builder agents or leave open), then wait for results and post a short summary in the room when everything is done.' },
      { id: 'builder', title: 'Builder', prefer: ['codex', 'claude', 'cursor-agent', 'aider', 'opencode'], count: 2, brief: 'You build. Claim an open task (hub_claim), take hub_lock on files you edit, do the work, then hub_complete with what changed. If a task suits another agent better, hub_handoff it with a short summary.' },
      { id: 'reviewer', title: 'Reviewer', prefer: ['grok', 'gemini', 'claude', 'codex'], count: 1, brief: 'You review. When a task is done, read the changes, post concrete findings in the room, and post fix tasks for real problems.' },
    ],
    kickoff: [{ role: 'planner', title: 'Plan: {goal}', detail: 'Plan this goal and post the tasks for the builders: {goal}' }],
  },
  {
    id: 'fan-out', name: 'Fan out, gather',
    description: 'The same job split across several agents at once (one part each), then one agent gathers the results.',
    roles: [
      { id: 'worker', title: 'Worker', prefer: ['claude', 'codex', 'gemini', 'grok', 'aider'], count: 3, brief: 'Claim one open part (hub_claim), do it, and hub_complete with your result.' },
      { id: 'gatherer', title: 'Gatherer', prefer: ['claude', 'gemini', 'codex'], count: 1, brief: 'Wait until every part is done (hub_tasks), then combine the results into one answer and post it in the room.' },
    ],
    kickoff: [
      { role: 'gatherer', title: 'Split: {goal}', detail: 'Split this into independent parts and post one open task per part for the workers, then gather: {goal}' },
    ],
  },
  {
    id: 'debate', name: 'Compare answers',
    description: 'Several different models answer the same question on their own; then they read each other\'s answers and say where they disagree. Useful to catch mistakes one model would miss.',
    roles: [
      { id: 'answerer', title: 'Answerer', prefer: ['claude', 'codex', 'gemini', 'grok'], count: 3, brief: 'Answer the question in the room on your own first (do not read others yet). Post your answer, then read the others and post where you agree, disagree, and why.' },
    ],
    kickoff: [{ role: 'answerer', title: 'Answer: {goal}', detail: '{goal}' }],
  },
  {
    id: 'consensus', name: 'Agree on one answer',
    description: 'Like Compare answers, then one moderator merges them into a single answer everyone signs off on.',
    roles: [
      { id: 'answerer', title: 'Answerer', prefer: ['claude', 'codex', 'gemini', 'grok'], count: 3, brief: 'Post your own answer, then react to the moderator\'s merged answer with "agree" or what must change.' },
      { id: 'moderator', title: 'Moderator', prefer: ['claude', 'gemini'], count: 1, brief: 'Collect the answers, merge them into one, post it, and revise until every answerer agrees (at most three rounds).' },
    ],
    kickoff: [{ role: 'moderator', title: 'Moderate: {goal}', detail: 'Ask the answerers in the room for their answers, then merge: {goal}' }],
  },
];

export interface PlannedAgent {
  role: string;
  slot: number;
  harness: string;
  name: string;
  brief: string;
}

/** Fills each role with an installed harness (the person can change any choice). */
export function planRecipe(r: Recipe, installed: string[], goal: string, choose: Record<string, string> = {}): { agents: PlannedAgent[]; missing: string[]; room: string; kickoff: { role: string; title: string; detail: string }[] } {
  const agents: PlannedAgent[] = [];
  const missing: string[] = [];
  for (const role of r.roles) {
    for (let i = 0; i < role.count; i++) {
      const key = `${role.id}:${i}`;
      const usable = role.prefer.filter((h) => installed.includes(h));
      // Several of one role take different harnesses in turn (so a team mixes models).
      const pick = choose[key] ?? usable[i % Math.max(1, usable.length)] ?? installed[0];
      if (!pick) { missing.push(role.title); continue; }
      agents.push({ role: role.id, slot: i, harness: pick, name: `${role.id}${role.count > 1 ? `-${i + 1}` : ''}`, brief: `${HUB_HOWTO}\n\nYour role: ${role.title} (@${role.id}${role.count > 1 ? `-${i + 1}` : ''}). ${role.brief}\n\nGoal: ${goal}` });
    }
  }
  const room = `${r.id}-${goal.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'team'}`;
  return { agents, missing, room, kickoff: r.kickoff.map((x) => ({ role: x.role, title: x.title.replace('{goal}', goal.slice(0, 120)), detail: x.detail.replace('{goal}', goal) })) };
}

export { HUB_HOWTO };
