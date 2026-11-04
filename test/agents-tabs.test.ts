// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The Agents page in four tabs: every old tab still opens, on its own view.
import { describe, expect, it } from 'vitest';
import { AGENT_GROUPS, agentView } from '../core/agents-tabs';

describe('Agents tabs', () => {
  it('are four, at most three views each', () => {
    expect(AGENT_GROUPS.map((g) => g.label)).toEqual(['Apps', 'Permissions', 'Memory', 'Automation']);
    for (const g of AGENT_GROUPS) expect(g.views.length).toBeLessThanOrEqual(3);
  });
  it('open every one of the eleven old tabs on its view', () => {
    const old = ['connect', 'services', 'abilities', 'teams', 'schedules', 'personas', 'memory', 'permissions', 'skills', 'gateway', 'learning'];
    for (const t of old) expect(agentView(t, 'connect').view, t).toBe(t === 'abilities' ? 'skills' : t);
    expect(agentView('gateway', 'connect').group).toBe('permissions');
    expect(agentView('learning', 'connect').group).toBe('memory');
  });
  it('merge Abilities into Skills', () => {
    expect(agentView('abilities', 'connect')).toEqual({ group: 'automation', view: 'skills' });
    expect(AGENT_GROUPS.flatMap((g) => g.views.map(([v]) => v))).not.toContain('abilities');
  });
  it('open a group on its first view, and fall back for anything else', () => {
    expect(agentView('automation', 'connect')).toEqual({ group: 'automation', view: 'skills' });
    expect(agentView(undefined, 'connect')).toEqual({ group: 'apps', view: 'connect' });
    expect(agentView(undefined, 'skills')).toEqual({ group: 'automation', view: 'skills' });
    expect(agentView('nonsense', 'connect')).toEqual({ group: 'apps', view: 'connect' });
  });
});
