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

export type ConfigFormat = 'mcpServers' | 'vscode' | 'zed' | 'codex-toml' | 'openclaw' | 'hermes-yaml';

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
  // Agents that run in a terminal (their MCP settings files, as documented by each).
  { id: 'claude-code', label: 'Claude Code', format: 'mcpServers', file: (h) => path.join(h, '.claude.json') },
  { id: 'codex', label: 'Codex CLI', format: 'codex-toml', file: (h, _p, e) => path.join(e.CODEX_HOME || path.join(h, '.codex'), 'config.toml') },
  { id: 'gemini-cli', label: 'Gemini CLI', format: 'mcpServers', file: (h) => path.join(h, '.gemini', 'settings.json') },
  { id: 'openclaw', label: 'OpenClaw', format: 'openclaw', file: (h) => path.join(h, '.openclaw', 'openclaw.json') },
  { id: 'hermes', label: 'Hermes Agent', format: 'hermes-yaml', file: (h) => path.join(h, '.hermes', 'config.yaml') },
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

// ---------------------------------------------------------------- TOML (Codex) and YAML (Hermes)

const tomlStr = (s: string) => JSON.stringify(s);

/** Codex keeps servers as [mcp_servers.<name>] tables in config.toml. */
function tomlRemove(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let skipping = false;
  for (const l of lines) {
    const h = l.trim().match(/^\[+([^\]]+)\]+$/);
    if (h) skipping = h[1].trim() === `mcp_servers.${SERVER_NAME}` || h[1].trim().startsWith(`mcp_servers.${SERVER_NAME}.`);
    if (!skipping) out.push(l);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

function tomlAdd(text: string, l: McpLaunch): string {
  const block = [`[mcp_servers.${SERVER_NAME}]`, `command = ${tomlStr(l.command)}`, `args = [${l.args.map(tomlStr).join(', ')}]`];
  if (l.env && Object.keys(l.env).length) block.push('', `[mcp_servers.${SERVER_NAME}.env]`, ...Object.entries(l.env).map(([k, v]) => `${/^[A-Za-z0-9_-]+$/.test(k) ? k : tomlStr(k)} = ${tomlStr(v)}`));
  const base = tomlRemove(text).replace(/\s+$/, '');
  return (base ? base + '\n\n' : '') + block.join('\n') + '\n';
}

/** Hermes keeps servers under a top-level `mcp_servers:` map in config.yaml. */
function yamlRange(lines: string[]): { start: number; end: number } | null {
  const start = lines.findIndex((l) => /^mcp_servers:\s*(#.*)?$/.test(l));
  if (start < 0) return null;
  let end = start + 1;
  while (end < lines.length && (lines[end].trim() === '' || /^\s/.test(lines[end]))) end++;
  return { start, end };
}

function yamlRemove(text: string): string {
  const lines = text.split('\n');
  const r = yamlRange(lines);
  if (!r) return text;
  const out = lines.slice(0, r.start + 1);
  let skipping = false;
  for (let i = r.start + 1; i < r.end; i++) {
    const m = lines[i].match(/^(\s+)([^\s#][^:]*):/);
    if (m && m[1].length === 2) skipping = m[2].trim().replace(/^["']|["']$/g, '') === SERVER_NAME;
    if (!skipping || !lines[i].trim()) out.push(lines[i]);
  }
  const rest = lines.slice(r.end);
  // An emptied map becomes `{}` so the file stays valid.
  if (!out.slice(r.start + 1).some((l) => l.trim())) out[r.start] = 'mcp_servers: {}';
  return [...out, ...rest].join('\n');
}

function yamlAdd(text: string, l: McpLaunch): string {
  const q = (s: string) => JSON.stringify(s);
  const entry = [`  ${SERVER_NAME}:`, `    command: ${q(l.command)}`, `    args: [${l.args.map(q).join(', ')}]`];
  if (l.env && Object.keys(l.env).length) entry.push('    env:', ...Object.entries(l.env).map(([k, v]) => `      ${k}: ${q(v)}`));
  const lines = yamlRemove(text).split('\n');
  const r = yamlRange(lines);
  if (!r) return (text.replace(/\s+$/, '') ? text.replace(/\s+$/, '') + '\n\n' : '') + ['mcp_servers:', ...entry].join('\n') + '\n';
  lines[r.start] = 'mcp_servers:';
  let at = r.end;
  while (at > r.start + 1 && !lines[at - 1].trim()) at--;
  lines.splice(at, 0, ...entry);
  return lines.join('\n').replace(/\s*$/, '\n');
}

/** The file's text with Keeper added (or updated); everything else is kept. */
export function addToConfig(text: string | undefined, format: ConfigFormat, launch: McpLaunch): string {
  if (format === 'codex-toml') return tomlAdd(text ?? '', launch);
  if (format === 'hermes-yaml') return yamlAdd(text ?? '', launch);
  const data = parseJsonc(text ?? '');
  if (!data) throw new Error('This settings file is not plain JSON, so Keeper will not change it. Copy the snippet and add it yourself.');
  if (format === 'openclaw') {
    // OpenClaw: mcp.servers.<name> in openclaw.json.
    const mcp = (data.mcp && typeof data.mcp === 'object' ? data.mcp : {}) as Record<string, unknown>;
    const servers = (mcp.servers && typeof mcp.servers === 'object' ? mcp.servers : {}) as Record<string, unknown>;
    data.mcp = { ...mcp, servers: { ...servers, [SERVER_NAME]: entryFor('mcpServers', launch) } };
    return JSON.stringify(data, null, 2) + '\n';
  }
  const key = keyOf(format);
  const servers = (data[key] && typeof data[key] === 'object' ? data[key] : {}) as Record<string, unknown>;
  data[key] = { ...servers, [SERVER_NAME]: entryFor(format, launch) };
  return JSON.stringify(data, null, 2) + '\n';
}

export function removeFromConfig(text: string, format: ConfigFormat): string {
  if (format === 'codex-toml') return tomlRemove(text);
  if (format === 'hermes-yaml') return yamlRemove(text);
  const data = parseJsonc(text);
  if (!data) throw new Error('This settings file is not plain JSON, so Keeper will not change it.');
  if (format === 'openclaw') {
    const servers = (data.mcp as Record<string, unknown> | undefined)?.servers as Record<string, unknown> | undefined;
    if (servers && typeof servers === 'object') delete servers[SERVER_NAME];
    return JSON.stringify(data, null, 2) + '\n';
  }
  const key = keyOf(format);
  const servers = data[key] as Record<string, unknown> | undefined;
  if (servers && typeof servers === 'object') {
    delete servers[SERVER_NAME];
    if (!Object.keys(servers).length) delete data[key];
  }
  return JSON.stringify(data, null, 2) + '\n';
}

export function isConnected(text: string | undefined, format: ConfigFormat): boolean {
  if (format === 'codex-toml') return !!text && new RegExp(`^\\s*\\[mcp_servers\\.${SERVER_NAME}\\]\\s*$`, 'm').test(text);
  if (format === 'hermes-yaml') {
    const lines = (text ?? '').split('\n');
    const r = yamlRange(lines);
    return !!r && lines.slice(r.start + 1, r.end).some((l) => new RegExp(`^  ["']?${SERVER_NAME}["']?:`).test(l));
  }
  if (format === 'openclaw') {
    const data = text ? parseJsonc(text) : undefined;
    const servers = (data?.mcp as Record<string, unknown> | undefined)?.servers as Record<string, unknown> | undefined;
    return !!servers && typeof servers === 'object' && SERVER_NAME in servers;
  }
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
    { id: 'claude-code', label: 'Claude Code (terminal)', text: `claude mcp add --scope user ${envPrefix}${SERVER_NAME} -- ${[l.command, ...l.args].map(q).join(' ')}` },
    { id: 'codex', label: 'Codex CLI (terminal)', text: `codex mcp add ${envPrefix}${SERVER_NAME} -- ${[l.command, ...l.args].map(q).join(' ')}` },
    { id: 'gemini', label: 'Gemini CLI (terminal)', text: `gemini mcp add ${SERVER_NAME} ${[l.command, ...l.args].map(q).join(' ')}` },
    { id: 'command', label: 'Command line', text: [l.command, ...l.args].map(q).join(' ') },
  ];
}
