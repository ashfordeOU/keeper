// SPDX-License-Identifier: AGPL-3.0-or-later
// AI apps that can use Keeper over MCP, where each keeps its list of servers,
// and how to add or remove Keeper from that list without touching anything
// else in the file. Pure: the app reads and writes the files (after asking,
// and with a backup).

import path from 'node:path';

export interface McpLaunch {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export type ConfigFormat = 'mcpServers' | 'vscode' | 'zed';

export interface McpApp {
  id: string;
  label: string;
  format: ConfigFormat;
  /** the settings file, or undefined when the app does not exist on this system */
  file(home: string, platform: string, env: Record<string, string | undefined>): string | undefined;
}

const appData = (home: string, platform: string, env: Record<string, string | undefined>) =>
  platform === 'darwin' ? path.join(home, 'Library', 'Application Support') : platform === 'win32' ? env.APPDATA || path.join(home, 'AppData', 'Roaming') : env.XDG_CONFIG_HOME || path.join(home, '.config');

export const MCP_APPS: McpApp[] = [
  { id: 'claude-desktop', label: 'Claude desktop app', format: 'mcpServers', file: (h, p, e) => (p === 'linux' ? path.join(appData(h, p, e), 'Claude', 'claude_desktop_config.json') : path.join(appData(h, p, e), 'Claude', 'claude_desktop_config.json')) },
  { id: 'vscode', label: 'Visual Studio Code', format: 'vscode', file: (h, p, e) => path.join(appData(h, p, e), 'Code', 'User', 'mcp.json') },
  { id: 'cursor', label: 'Cursor', format: 'mcpServers', file: (h) => path.join(h, '.cursor', 'mcp.json') },
  { id: 'windsurf', label: 'Windsurf', format: 'mcpServers', file: (h) => path.join(h, '.codeium', 'windsurf', 'mcp_config.json') },
  { id: 'lmstudio', label: 'LM Studio', format: 'mcpServers', file: (h) => path.join(h, '.lmstudio', 'mcp.json') },
  { id: 'zed', label: 'Zed', format: 'zed', file: (h, p, e) => (p === 'win32' ? path.join(appData(h, p, e), 'Zed', 'settings.json') : path.join(h, '.config', 'zed', 'settings.json')) },
];

export const SERVER_NAME = 'keeper';

/**
 * Parses a settings file. Some apps allow comments and trailing commas (JSONC);
 * those are stripped for reading. Returns undefined when the file is not JSON.
 */
export function parseJsonc(text: string): Record<string, unknown> | undefined {
  if (!text.trim()) return {};
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : undefined;
  } catch {
    /* try without comments */
  }
  let out = '';
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      out += ch;
      if (ch === '\\') { out += text[++i] ?? ''; continue; }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; out += ch; continue; }
    if (ch === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; out += '\n'; continue; }
    if (ch === '/' && text[i + 1] === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; i++; continue; }
    out += ch;
  }
  try {
    const v = JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

function entryFor(format: ConfigFormat, l: McpLaunch): Record<string, unknown> {
  const env = l.env && Object.keys(l.env).length ? { env: l.env } : {};
  if (format === 'vscode') return { type: 'stdio', command: l.command, args: l.args, ...env };
  if (format === 'zed') return { source: 'custom', command: l.command, args: l.args, ...env };
  return { command: l.command, args: l.args, ...env };
}

const keyOf = (format: ConfigFormat) => (format === 'vscode' ? 'servers' : format === 'zed' ? 'context_servers' : 'mcpServers');

/** The file's text with Keeper added (or updated); everything else is kept. */
export function addToConfig(text: string | undefined, format: ConfigFormat, launch: McpLaunch): string {
  const data = parseJsonc(text ?? '');
  if (!data) throw new Error('This settings file is not plain JSON, so Keeper will not change it. Copy the snippet and add it yourself.');
  const key = keyOf(format);
  const servers = (data[key] && typeof data[key] === 'object' ? data[key] : {}) as Record<string, unknown>;
  data[key] = { ...servers, [SERVER_NAME]: entryFor(format, launch) };
  return JSON.stringify(data, null, 2) + '\n';
}

export function removeFromConfig(text: string, format: ConfigFormat): string {
  const data = parseJsonc(text);
  if (!data) throw new Error('This settings file is not plain JSON, so Keeper will not change it.');
  const key = keyOf(format);
  const servers = data[key] as Record<string, unknown> | undefined;
  if (servers && typeof servers === 'object') {
    delete servers[SERVER_NAME];
    if (!Object.keys(servers).length) delete data[key];
  }
  return JSON.stringify(data, null, 2) + '\n';
}

export function isConnected(text: string | undefined, format: ConfigFormat): boolean {
  const data = text ? parseJsonc(text) : undefined;
  const servers = data?.[keyOf(format)] as Record<string, unknown> | undefined;
  return !!servers && typeof servers === 'object' && SERVER_NAME in servers;
}

/** Snippets for apps Keeper does not write to itself. */
export function snippets(l: McpLaunch): { id: string; label: string; text: string }[] {
  const q = (s: string) => (/[\s"'$`\\]/.test(s) ? JSON.stringify(s) : s);
  const envPrefix = Object.entries(l.env ?? {}).map(([k, v]) => `--env ${k}=${q(v)} `).join('');
  return [
    { id: 'json', label: 'Any MCP app (JSON)', text: JSON.stringify({ mcpServers: { [SERVER_NAME]: entryFor('mcpServers', l) } }, null, 2) },
    { id: 'claude-code', label: 'Claude Code (terminal)', text: `claude mcp add ${envPrefix}${SERVER_NAME} -- ${[l.command, ...l.args].map(q).join(' ')}` },
    { id: 'command', label: 'Command line', text: [l.command, ...l.args].map(q).join(' ') },
  ];
}
