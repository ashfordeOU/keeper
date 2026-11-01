// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Demo data for the agent terminals and hub: a small mixed team at work.

import type { AgentTermApi, AgentTermState } from '../core/api-agentterm';
import { AgentBus } from '../core/terminal/agent/bus';
import { AgentHub } from '../core/terminal/agent/hub';
import { DEFAULT_LIMITS } from '../core/terminal/agent/manager';
import { DEFAULT_POLICY } from '../core/terminal/agent/policy';
import { RECIPES } from '../core/terminal/agent/recipes';

export function mockAgentTerm(emit: (channel: string, ...args: unknown[]) => void): { agentterm: AgentTermApi } {
  const bus = new AgentBus();
  const hub = new AgentHub(bus);
  const now = Date.now();
  const planner = hub.launch({ name: 'planner', harness: 'claude', model: 'claude-opus-5-5', account: 'Work', folder: '~/code/shop' }).agent;
  const b1 = hub.launch({ name: 'builder-1', harness: 'codex', account: 'Personal', folder: '~/code/shop' }).agent;
  const b2 = hub.launch({ name: 'builder-2', harness: 'claude', account: 'Personal', folder: '~/code/shop' }).agent;
  const rev = hub.launch({ name: 'reviewer', harness: 'grok', folder: '~/code/shop' }).agent;
  const t1 = hub.postTask(planner.id, { title: 'Dark mode: theme tokens', room: 'plan-build-review-dark-mode' });
  const t2 = hub.postTask(planner.id, { title: 'Dark mode: settings toggle', room: 'plan-build-review-dark-mode' });
  hub.postTask(planner.id, { title: 'Dark mode: screenshots for docs', room: 'plan-build-review-dark-mode' });
  hub.claim(b1.id, t1.id);
  hub.claim(b2.id, t2.id);
  hub.complete(b2.id, t2.id, 'Toggle added under Settings → Appearance; persists across restarts.');
  hub.post(rev.id, 'plan-build-review-dark-mode', '@builder-2 the toggle reads the setting twice on start; see Settings.tsx line 88.');
  bus.acquire('src/styles/tokens.css', b1.id, 10 * 60_000);
  hub.seen(rev.id, 'waiting', 'waiting for builder-1');
  const state = (): AgentTermState => ({
    terms: [
      { id: 'a1b2', owner: `agent:${b1.id}`, name: 'builder-1 · npm test', children: ['c3d4', 'e5f6'], createdAt: now - 600_000, headless: false, controller: 'agent', family: 'posix', status: 'running', running: 'npm test -- --watch=false', lastOutput: now, cwd: '~/code/shop', sub: [
        { id: 'c3d4', owner: `agent:${b1.id}`, name: 'dev server', parent: 'a1b2', children: [], createdAt: now - 500_000, headless: true, controller: 'agent', family: 'posix', status: 'idle', lastOutput: now - 20_000, cwd: '~/code/shop', sub: [] },
        { id: 'e5f6', owner: `agent:${b1.id}`, name: 'lint', parent: 'a1b2', children: [], createdAt: now - 400_000, headless: true, controller: 'agent', family: 'posix', status: 'waiting', prompt: 'Fix 3 problems automatically? [y/N]', lastOutput: now - 4000, cwd: '~/code/shop', sub: [] },
      ] },
      { id: 'g7h8', owner: `agent:${b2.id}`, name: 'builder-2 · build', children: [], createdAt: now - 300_000, headless: false, controller: 'human', family: 'posix', status: 'idle', lastOutput: now - 60_000, cwd: '~/code/shop', sub: [] },
    ],
    agents: hub.list(),
    tasks: hub.taskList().reverse(),
    rooms: bus.channelNames(),
    locks: bus.lockList(),
    policy: { ...DEFAULT_POLICY, deny: ['npm publish*'], jail: ['~/code'] },
    limits: DEFAULT_LIMITS,
    recipes: RECIPES.map((r) => ({ id: r.id, name: r.name, description: r.description, roles: r.roles.map((x) => ({ id: x.id, title: x.title, count: x.count, prefer: x.prefer })) })),
  });
  const changed = () => emit('agentterm-changed');
  return {
    agentterm: {
      state: async () => state(),
      messages: async (room, after) => bus.read(room, after ?? 0, 200),
      post: async (room, text) => { const m = hub.post(hub.asHuman().id, room, text); changed(); return m; },
      send: async (to, text) => { const m = hub.send(hub.asHuman().id, to, text); changed(); return m; },
      postTask: async (o) => { hub.asHuman(); const t = hub.postTask('human', o); changed(); return t; },
      handoff: async (id, to, summary) => { hub.asHuman(); const t = hub.handoff('human', id, to, { summary }); changed(); return t; },
      takeOver: async () => changed(),
      show: async () => undefined,
      close: async (id) => [id],
      stopAll: async () => 3,
      pause: async (id, p) => { hub.setPerms(id, p ? { send: false, terminals: false, tasks: false } : { send: true, terminals: true, tasks: true }); changed(); },
      approve: async (id) => { hub.approve(id); changed(); },
      setPerms: async (id, p) => { hub.setPerms(id, p); changed(); },
      setPolicy: async () => changed(),
      addAgent: async (o) => { const r = hub.launch({ name: o.name, harness: o.harness, account: o.account }); changed(); return { id: r.agent.id, token: r.token, env: `KEEPER_AGENT_TOKEN=${r.token}` }; },
      transcript: async () => '# opened by builder-1\n> $ npm test\nPASS src/theme.test.ts\nTests: 12 passed',
      runRecipe: async (id, goal) => ({ room: `${id}-${goal.slice(0, 10)}`, started: ['planner', 'builder-1'], missing: [] }),
    },
  };
}
