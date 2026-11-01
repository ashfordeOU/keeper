// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Abilities in the browser demo: settings, a few memories and schedules,
// personas, a team of three demo AIs that really run the team strategies, and
// canned web results.

import type { AbilitiesApi } from '../core/api-abilities';
import { normalizeAbilities, type AbilitiesSettings, type Persona, type Project, type ScheduledTask } from '../core/abilities/config';
import { IMAGE_PROVIDERS } from '../core/abilities/images';
import { addMemory, editMemory, removeMemory, type Memory } from '../core/abilities/memory';
import { checkPersona } from '../core/abilities/personas';
import { abilityPermission, summarizeCosts } from '../core/abilities/policy';
import { ABILITIES } from '../core/abilities/registry';
import { nextRun, parseSchedule } from '../core/abilities/schedule';
import { SEARCH_PROVIDERS } from '../core/abilities/search';
import { runTeam, type Member, type TeamSpec } from '../core/abilities/teams';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const now = Date.now();

export function mockAbilities(emit: (channel: string, v: unknown) => void): { abilities: AbilitiesApi } {
  let s: AbilitiesSettings = normalizeAbilities({
    search: { provider: 'brave' } as AbilitiesSettings['search'],
    personas: [
      { id: 'researcher', name: 'Researcher', avatar: '🔎', instructions: 'Look things up before answering and cite sources.', memoryScope: 'shared' },
      { id: 'coach', name: 'Coach', avatar: '🧭', instructions: 'Help plan and follow through, one step at a time.', memoryScope: 'own' },
    ],
    projects: [{ id: 'move', name: 'Apartment move', instructions: 'Keep track of dates, costs and who does what.', folders: ['/Users/demo/Documents/Move'] }],
    tasks: [
      { id: 't1', name: 'Morning briefing', prompt: 'Summarise today\'s calendar, unread mail and the weather in five lines.', when: 'every weekday at 8:30', deliver: ['island', 'notification'], enabled: true, lastRun: now - 26 * 3600_000, lastResult: 'Three meetings (first at 10:00), 4 unread mails (1 from your landlord), light rain after 15:00.' },
      { id: 't2', name: 'AI news digest', prompt: 'Research what changed in AI this week and save a short report with sources.', when: 'every friday at 17:00', deliver: ['file', 'notification'], enabled: true },
      { id: 't3', name: 'Call the bank', prompt: 'Remind me to call the bank about the deposit.', when: 'tomorrow at 9', deliver: ['island'], enabled: true, once: true },
    ],
    teams: [
      { id: 'second', name: 'Second opinion', strategy: 'compare', members: ['claude', 'gpt', 'grok'] },
      { id: 'editor', name: 'Writer and editor', strategy: 'critique', members: ['claude', 'gpt'], rounds: 1 },
      { id: 'panel', name: 'Expert panel', strategy: 'panel', members: ['claude', 'gpt', 'grok', 'local'] },
      { id: 'router', name: 'Best for the job', strategy: 'router', members: ['claude', 'gpt', 'grok', 'local'] },
    ],
  });
  let memories: Memory[] = [];
  for (const [text, scope, owner] of [['Prefers metric units and 24-hour time', 'shared'], ['Moving flat on 1 March', 'project', 'move'], ['Training for a half marathon in May', 'persona', 'coach'], ['Partner is called Lena', 'shared']] as [string, Memory['scope'], string?][]) memories = addMemory(memories, { text, scope, owner, by: 'you' }, now - 86_400_000).list;
  memories = editMemory(memories, memories[0].id, { pinned: true });

  const member = (id: string, label: string, style: (p: string) => string, extra: Partial<Member> = {}): Member => ({ id, label, ...extra, ask: async (p) => { await wait(500 + Math.random() * 900); return style(p); } });
  const topic = (p: string) => p.split('\n').find((l) => l.trim())?.slice(0, 80) ?? 'that';
  const members: Member[] = [
    member('claude', 'Claude · claude-opus-5-5', (p) => (p.startsWith('Review') ? 'LGTM' : p.startsWith('Merge') || p.startsWith('Assemble') ? `Combined answer: the panel agrees on the main points; I kept the clearest explanation and noted one disagreement about cost.` : `A careful answer about “${topic(p)}”: three key points, each with a caveat, and a short recommendation.`), { strengths: ['code', 'writing'] }),
    member('gpt', 'OpenAI · gpt-5', (p) => (p.startsWith('Review') ? 'Clear, but add a concrete example in the second paragraph.' : `A direct answer about “${topic(p)}” with a worked example and a checklist.`), { strengths: ['writing', 'code'] }),
    member('grok', 'xAI · grok-4', (p) => `A quick, current take on “${topic(p)}”, with what people are saying this week and two links.`, { strengths: ['research'] }),
    member('local', 'On this computer · llama3.2', (p) => `A short private answer about “${topic(p)}”. Nothing left this computer.`, { strengths: ['private', 'fast'], local: true }),
  ];

  const upsert = <T extends { id: string }>(list: T[], item: Omit<T, 'id'> & { id?: string }): T[] => {
    const id = item.id ?? Math.random().toString(36).slice(2, 10);
    const next = { ...item, id } as T;
    return list.some((x) => x.id === id) ? list.map((x) => (x.id === id ? next : x)) : [...list, next];
  };
  const save = (patch: Partial<AbilitiesSettings>) => { s = normalizeAbilities({ ...s, ...patch }); emit('abilities-changed', null); return s; };

  return {
    abilities: {
      settings: async () => s,
      save: async (patch) => save(patch),
      list: async () => ABILITIES.map((a) => ({ name: a.name, label: a.label, group: a.group, description: a.description, network: a.network, readOnly: a.readOnly, permission: abilityPermission(a.name, s) })),
      providers: async () => ({ search: SEARCH_PROVIDERS, images: IMAGE_PROVIDERS, keys: { 'search:brave': true, xai: true, 'images:openai': true } }),
      setKey: async () => true,
      testSearch: async () => { await wait(600); return { ok: true, message: '3 results', results: [{ title: 'Owl — Wikipedia', url: 'https://en.wikipedia.org/wiki/Owl' }, { title: 'All about owls', url: 'https://www.allaboutbirds.org/' }, { title: 'Owl facts', url: 'https://www.audubon.org/' }] }; },
      call: async (name) => { await wait(700); return { content: `Ran ${name}`, summary: `ran ${name}` }; },
      memories: async () => memories,
      addMemory: async (text, scope, owner) => (memories = addMemory(memories, { text, scope, owner, by: 'you' }).list),
      editMemory: async (id, patch) => (memories = editMemory(memories, id, patch)),
      removeMemory: async (id) => (memories = removeMemory(memories, id)),
      clearMemories: async () => (memories = []),
      costs: async () => summarizeCosts([
        { at: now, ability: 'web_search', provider: 'brave', units: 41, usd: 0.2 },
        { at: now, ability: 'image_generate', provider: 'openai', units: 6, usd: 0.24 },
        { at: now, ability: 'deep_research', provider: 'brave', units: 3 },
      ]),
      saveTask: async (t) => save({ tasks: upsert<ScheduledTask>(s.tasks, t) }).tasks,
      removeTask: async (id) => save({ tasks: s.tasks.filter((t) => t.id !== id) }).tasks,
      runTask: async (id) => {
        await wait(900);
        const answer = 'Done: three meetings today, the first at 10:00; rain later.';
        save({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, lastRun: Date.now(), lastResult: answer } : t)) });
        emit('abilities-task-ran', { id, answer });
        return answer;
      },
      describeSchedule: async (when) => {
        try {
          const sc = parseSchedule(when);
          const next: number[] = [];
          let at = Date.now();
          for (let i = 0; i < 3; i++) { const n = nextRun(sc, at, i ? at : undefined); if (n === undefined || (i && sc.once !== undefined)) break; next.push(n); at = n; }
          return { ok: true, label: sc.label, next };
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
      },
      savePersona: async (p) => { const bad = checkPersona(p); if (bad) throw new Error(bad); return save({ personas: upsert<Persona>(s.personas, p) }).personas; },
      removePersona: async (id) => save({ personas: s.personas.filter((p) => p.id !== id) }).personas,
      saveProject: async (p) => save({ projects: upsert<Project>(s.projects, p) }).projects,
      removeProject: async (id) => save({ projects: s.projects.filter((p) => p.id !== id) }).projects,
      members: async () => members.map((m) => ({ id: m.id, label: m.label, local: m.local, strengths: m.strengths })),
      saveTeam: async (t) => save({ teams: upsert<TeamSpec>(s.teams, t) }).teams,
      removeTeam: async (id) => save({ teams: s.teams.filter((t) => t.id !== id) }).teams,
      runTeam: async (runId, team, prompt) => {
        const spec = typeof team === 'string' ? s.teams.find((t) => t.id === team)! : team;
        return runTeam(spec, members, prompt, { onEntry: (entry) => emit('abilities-team', { runId, entry }) });
      },
      cancelTeam: async () => undefined,
      transcribe: async () => { await wait(800); return 'What is on my calendar tomorrow?'; },
      speak: async () => undefined,
    },
  };
}
