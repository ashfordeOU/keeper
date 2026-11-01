// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Agent terminals and the agent hub: starts the service, hands its tools to
// agents (MCP, the `keeper` command), gives agents Keeper starts an identity,
// and answers Keeper's own windows.

import { ipcMain } from 'electron';
import { setAgentResolver, registerKeeperMethod } from '../services/brain';
import { agentClis, agentSettings, launchAgent, requestApproval, setLaunchIdentity, setToolProvider } from '../services/agents';
import { featureOn } from '../services/features';
import * as at from '../services/terminal/agents';
import { openTerminalWindow } from '../services/terminal';
import type { CommandPolicy } from '../../core/terminal/agent/policy';
import type { Limits } from '../../core/terminal/agent/manager';
import type { AgentPerms } from '../../core/terminal/agent/hub';

export async function registerAgentTermIpc(d: { broadcast(channel: string, ...args: unknown[]): void; alert(title: string, detail?: string): void }) {
  await at.startAgentTerminals({
    broadcast: d.broadcast,
    alert: d.alert,
    show: (session) => openTerminalWindow({ session }),
    requestApproval,
    // The person's choice under Agents → Permissions; using terminals asks first, the hub is allowed.
    permission: (action) => agentSettings().permissions?.[action] ?? (action === 'terminal' ? 'ask' : 'allow'),
    launchAgent: (harness, o) => launchAgent(harness, o),
    enabled: () => featureOn('terminal') && featureOn('agentHub'),
  });
  setToolProvider('agent-terminals', { tools: () => at.agentToolList() as never, call: (name, args, client) => at.callAgentTerminalTool(name, args, client) });
  setLaunchIdentity((o) => at.identityFor(o));
  setAgentResolver((token, session) => at.resolveAgent(token, session));
  // The `keeper term …` and `keeper hub …` commands: the same tools, as the person (no agent identity unless the token is set).
  registerKeeperMethod('keeper/agent-tool', async (p) => {
    const name = String(p.name ?? '');
    const args = (p.args as Record<string, unknown>) ?? {};
    const client = typeof p.agent === 'string' ? at.resolveAgent(p.agent, typeof p.session === 'string' ? p.session : undefined) ?? 'keeper command' : 'keeper command';
    return at.callAgentTerminalTool(name, args, client);
  });

  const h = (name: string, fn: (...args: never[]) => unknown) => ipcMain.handle(`agentterm.${name}`, (_e, ...a) => fn(...(a as never[])));
  h('state', () => at.state());
  h('messages', (room: string, after?: number) => at.roomMessages(room, after));
  h('post', (room: string, text: string) => at.humanPost(room, text));
  h('send', (to: string, text: string) => at.humanSend(to, text));
  h('postTask', (o: { title: string; detail?: string; room?: string; assignee?: string; forHarness?: string[] }) => at.humanTask(o));
  h('handoff', (taskId: string, to: string, summary: string) => at.humanHandoff(taskId, to, summary));
  h('takeOver', (id: string, back?: boolean) => at.takeOver(id, !!back));
  h('show', (id: string) => openTerminalWindow({ session: id }));
  h('close', (id: string) => at.closeTerm(id));
  h('stopAll', () => at.stopAll());
  h('pause', (id: string, paused: boolean) => at.pauseAgent(id, paused));
  h('approve', (id: string) => at.approveAgent(id));
  h('setPerms', (id: string, p: Partial<AgentPerms>) => at.setAgentPerms(id, p));
  h('setPolicy', (p: Partial<CommandPolicy>, l?: Partial<Limits>) => at.setPolicy(p, l));
  h('addAgent', (o: { name: string; harness: string; account?: string; run?: string; cwd?: string; headless?: boolean }) => at.addAgent(o));
  h('transcript', (id: string) => at.readTranscript(id));
  h('runRecipe', async (id: string, goal: string, o: { cwd?: string; choose?: Record<string, string> }) => {
    const installed = (await agentClis()).agents.filter((a) => a.installed).map((a) => a.id);
    return at.runRecipe(id, goal, { ...o, installed });
  });
}

export { stopAgentTerminals, stopAll as stopAllAgentTerminals } from '../services/terminal/agents';
