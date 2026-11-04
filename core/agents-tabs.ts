// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The Agents page's tabs: four groups (once eleven tabs in a row), each with a
// few views under a small switch. Every old tab is still a route
// (agents:skills, agents:gateway…) and opens its group on that view.
// Abilities and Skills were two words for one idea: they are one Skills view.

export type AgentView = 'connect' | 'services' | 'abilities' | 'teams' | 'schedules' | 'personas' | 'memory' | 'permissions' | 'skills' | 'gateway' | 'learning';
export type AgentGroup = 'apps' | 'permissions' | 'memory' | 'automation';

export const AGENT_GROUPS: { id: AgentGroup; label: string; views: [AgentView, string][] }[] = [
  { id: 'apps', label: 'Apps', views: [['connect', 'Agents & apps'], ['services', 'AI services']] },
  { id: 'permissions', label: 'Permissions', views: [['permissions', 'What agents may do'], ['gateway', 'Gateway']] },
  { id: 'memory', label: 'Memory', views: [['memory', 'Memory'], ['personas', 'Personas & projects'], ['learning', 'Learning']] },
  { id: 'automation', label: 'Automation', views: [['skills', 'Skills'], ['schedules', 'Schedules'], ['teams', 'Teams']] },
];

/** The group and view an old or new route argument opens (abilities is part of Skills now). */
export function agentView(arg: string | undefined, fallback: AgentView): { group: AgentGroup; view: AgentView } {
  const a = arg === 'abilities' ? 'skills' : arg;
  const byGroup = AGENT_GROUPS.find((g) => g.id === a);
  if (byGroup) return { group: byGroup.id, view: byGroup.views[0][0] };
  const g = AGENT_GROUPS.find((x) => x.views.some(([v]) => v === a)) ?? AGENT_GROUPS.find((x) => x.views.some(([v]) => v === fallback))!;
  return { group: g.id, view: (g.views.find(([v]) => v === a)?.[0] ?? (g.views.some(([v]) => v === fallback) ? fallback : g.views[0][0])) };
}

