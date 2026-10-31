// SPDX-License-Identifier: AGPL-3.0-or-later
// AI agents that run in a terminal, and how Keeper starts them: in a chosen
// folder, with Keeper's MCP server attached, and — for people with more than
// one account — with a separate settings folder per profile so each stays
// signed in on its own. Pure: the app finds them and opens the terminal.

export interface AgentCli {
  id: string;
  label: string;
  /** the command on PATH */
  command: string;
  /** the MCP app entry in apps.ts that connects Keeper to it */
  mcpApp?: string;
  /** environment variable that moves its settings (and sign-in) folder, for separate profiles */
  configEnv?: string;
  install?: string;
  vendor: string;
}

export const AGENT_CLIS: AgentCli[] = [
  { id: 'claude', label: 'Claude Code', command: 'claude', mcpApp: 'claude-code', configEnv: 'CLAUDE_CONFIG_DIR', vendor: 'Anthropic', install: 'https://docs.anthropic.com/en/docs/claude-code' },
  { id: 'codex', label: 'Codex CLI', command: 'codex', mcpApp: 'codex', configEnv: 'CODEX_HOME', vendor: 'OpenAI', install: 'https://github.com/openai/codex' },
  { id: 'gemini', label: 'Gemini CLI', command: 'gemini', mcpApp: 'gemini-cli', vendor: 'Google', install: 'https://github.com/google-gemini/gemini-cli' },
  { id: 'grok', label: 'Grok CLI', command: 'grok', vendor: 'xAI models', install: 'https://x.ai/api' },
  { id: 'cursor-agent', label: 'Cursor Agent CLI', command: 'cursor-agent', mcpApp: 'cursor', vendor: 'Cursor', install: 'https://cursor.com/cli' },
  { id: 'openclaw', label: 'OpenClaw', command: 'openclaw', mcpApp: 'openclaw', vendor: 'OpenClaw', install: 'https://docs.openclaw.ai' },
  { id: 'hermes', label: 'Hermes Agent', command: 'hermes', mcpApp: 'hermes', vendor: 'Nous Research', install: 'https://hermes-agent.nousresearch.com' },
  { id: 'copilot', label: 'GitHub Copilot CLI', command: 'copilot', vendor: 'GitHub', install: 'https://github.com/github/copilot-cli' },
  { id: 'opencode', label: 'opencode', command: 'opencode', vendor: 'opencode', install: 'https://opencode.ai' },
  { id: 'aider', label: 'Aider', command: 'aider', vendor: 'Aider', install: 'https://aider.chat' },
  { id: 'goose', label: 'Goose', command: 'goose', vendor: 'Block', install: 'https://block.github.io/goose' },
  { id: 'qwen', label: 'Qwen Code', command: 'qwen', vendor: 'Alibaba', install: 'https://github.com/QwenLM/qwen-code' },
  { id: 'amp', label: 'Amp', command: 'amp', vendor: 'Sourcegraph', install: 'https://ampcode.com' },
];

export interface AgentProfile {
  id: string;
  agent: string;
  /** e.g. "Work account" */
  label: string;
  /** separate settings folder (empty = the agent's usual one) */
  configDir?: string;
  /** folder to start in */
  cwd?: string;
  env?: Record<string, string>;
}

const shQuote = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);
const psQuote = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** The line typed into a shell to start an agent with a profile. */
export function launchLine(a: AgentCli, p: AgentProfile | undefined, platform: string, extraArgs: string[] = []): string {
  const env: Record<string, string> = { ...(p?.env ?? {}) };
  if (p?.configDir && a.configEnv) env[a.configEnv] = p.configDir;
  const cmd = [a.command, ...extraArgs];
  if (platform === 'win32') {
    const sets = Object.entries(env).map(([k, v]) => `$env:${k}=${psQuote(v)}; `).join('');
    return sets + cmd.map((c, i) => (i ? psQuote(c) : c)).join(' ');
  }
  const sets = Object.entries(env).map(([k, v]) => `${k}=${shQuote(v)} `).join('');
  return sets + cmd.map(shQuote).join(' ');
}

/** Which agents are installed, from `which`/`where` output per command. */
export function installedFrom(found: Record<string, string | undefined>): (AgentCli & { path?: string; installed: boolean })[] {
  return AGENT_CLIS.map((a) => ({ ...a, path: found[a.command], installed: !!found[a.command] }));
}

/** A settings folder for a new profile, inside Keeper's data, so profiles never share a sign-in. */
export function profileDir(dataDir: string, agent: string, label: string, sep = '/'): string {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'profile';
  return [dataDir.replace(/[\\/]+$/, ''), 'agent-profiles', agent, slug].join(sep);
}
