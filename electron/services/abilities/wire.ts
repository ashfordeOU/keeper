// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Connects the abilities to every way an AI reaches Keeper: the Assistant
// (and askBrain, used by the gateway's ask endpoint, agent-to-agent callers,
// voice assistants and scheduled tasks), MCP clients, and plain chat clients
// through the gateway.

import { abilityMcpTools } from '../../../core/abilities/mcp';
import { isAbility } from '../../../core/abilities/mcp';
import { setGatewayAbilities, setToolProvider, requestApproval } from '../agents';
import { askBrain, brainSettings, setAbilityTools } from '../brain';
import { abilitiesOn, abilitySettings, addTeamMemberSource, callAbility, harnessAbilities, startAbilities, stopAbilities } from './index';

/** Is the AI in use one that runs on this computer? (memories marked private only go to those) */
function activeIsLocal(): boolean {
  const b = brainSettings();
  const c = b.connections.find((x) => x.id === b.active);
  return !!c && (c.kind === 'ollama' || c.kind === 'platform' || /localhost|127\.0\.0\.1/.test(c.baseUrl ?? ''));
}

let hubMembersAdded = false;

export async function wireAbilities(d: { broadcast(channel: string, ...args: unknown[]): void; alert(title: string, detail?: string): void; ocr(file: string): Promise<string> }) {
  await startAbilities({
    broadcast: d.broadcast,
    alert: d.alert,
    ocr: d.ocr,
    approve: (client, action, description) => requestApproval(client, action, description, false),
    ask: async (prompt, o) => {
      const r = await askBrain(o.system ? `${o.system}\n\n---\n\n${prompt}` : prompt, { client: 'schedule', signal: o.signal });
      return { answer: r.answer };
    },
  });
  // The Assistant and askBrain: abilities offered next to the file tools.
  setAbilityTools((o) => harnessAbilities({ ...o, localModel: activeIsLocal() }));
  // MCP clients (Claude Code, Codex, Cursor, …): the same abilities, behind the same permissions.
  setToolProvider('abilities', {
    tools: () => (abilitiesOn() ? abilityMcpTools(abilitySettings()) : []),
    call: async (name, args, client) => {
      if (!isAbility(name)) return { text: `Unknown tool ${name}`, isError: true };
      const r = await callAbility(name, args, { client, localModel: false });
      return { text: r.content, isError: r.isError, structured: r.citations || r.files ? { citations: r.citations, files: r.files } : undefined };
    },
  });
  // Teams can include live agent sessions from the agent hub (Claude Code, Codex, Grok, … under any account):
  // the request becomes a task assigned to that agent, and its result is the member's answer.
  if (!hubMembersAdded) {
    hubMembersAdded = true;
    addTeamMemberSource(async () => {
      const hub = await import('../terminal/agents').catch(() => null);
      if (!hub) return [];
      let st: ReturnType<typeof hub.state>;
      try {
        st = hub.state();
      } catch {
        return [];
      }
      return st.agents.filter((a) => a.approved && a.status !== 'away' && a.harness !== 'keeper').map((a) => ({
        id: `agent:${a.id}`,
        label: `${a.name} (${a.harness}${a.account ? ` · ${a.account}` : ''})`,
        strengths: /claude|codex|cursor|gemini/.test(a.harness) ? ['code'] : a.harness === 'grok' ? ['research'] : [],
        ask: async (prompt: string, o: { system?: string; signal?: AbortSignal }) => {
          const task = hub.humanTask({ title: prompt.split('\n')[0].slice(0, 80), detail: o.system ? `${o.system}\n\n${prompt}` : prompt, assignee: a.id }) as { id: string };
          const until = Date.now() + 15 * 60_000;
          while (Date.now() < until) {
            if (o.signal?.aborted) throw new Error('Stopped');
            const t = hub.state().tasks.find((x) => x.id === task.id);
            if (t?.status === 'done') return t.result ?? '(done, no result given)';
            if (t?.status === 'failed' || t?.status === 'cancelled') throw new Error(`${a.name} ${t.status === 'failed' ? 'could not do it' : 'cancelled it'}${t.result ? `: ${t.result}` : ''}`);
            await new Promise((r) => setTimeout(r, 1500));
          }
          throw new Error(`${a.name} did not finish within 15 minutes`);
        },
      }));
    });
  }
  // Plain chat clients through the gateway: "<model>+abilities", or every model when the setting is on.
  setGatewayAbilities((asked) => {
    if (!abilitiesOn() || !(asked || abilitySettings().gatewayInject)) return undefined;
    const h = harnessAbilities({ client: 'gateway', localModel: false });
    if (!h) return undefined;
    return { specs: h.specs, instructions: h.instructions, run: async (c) => h.run(c) };
  });
}

export function unwireAbilities() {
  setAbilityTools(null);
  setToolProvider('abilities', null);
  setGatewayAbilities(null);
  stopAbilities();
}
