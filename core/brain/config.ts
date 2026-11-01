// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Settings for Keeper's brain and the AIs it works with. No Node modules here:
// the interface reads these too. Where the brain's files live is in paths.ts.

import type { Visibility } from './harness';
import type { ProviderKind } from './providers';

export interface AiConnection {
  /** also the name its API key is stored under */
  id: string;
  kind: ProviderKind;
  label: string;
  model: string;
  baseUrl?: string;
  /** false for models that cannot call tools */
  tools?: boolean;
  contextTokens?: number;
}

export interface BrainSettings {
  /** read the text inside files into the word index */
  enabled: boolean;
  /** search by meaning with the on-device model (downloaded when turned on) */
  semantic: boolean;
  /** what AIs may see: names and details only, matching passages, or whole files */
  visibility: Visibility;
  /** only use AIs that run on this computer */
  localOnly: boolean;
  /** blank secrets even for AIs on this computer */
  redactAlways: boolean;
  /** blank secrets for AI apps connected over MCP */
  mcpRedact: boolean;
  /** serve the local API and MCP over HTTP on 127.0.0.1 */
  http: boolean;
  /** 0 picks a free port */
  httpPort: number;
  /** stop building meaning vectors while on battery */
  pauseOnBattery: boolean;
  connections: AiConnection[];
  /** id of the connection the assistant uses */
  active: string;
}

export const DEFAULT_CONNECTIONS: AiConnection[] = [
  { id: 'anthropic', kind: 'anthropic', label: 'Claude', model: 'claude-opus-5-5' },
  { id: 'openai', kind: 'openai', label: 'OpenAI', model: 'gpt-5', baseUrl: 'https://api.openai.com/v1' },
  { id: 'ollama', kind: 'ollama', label: 'Ollama (this computer)', model: 'llama3.2', baseUrl: 'http://127.0.0.1:11434' },
];

export function defaultBrainSettings(): BrainSettings {
  return {
    enabled: true,
    semantic: false,
    visibility: 'snippets',
    localOnly: false,
    redactAlways: false,
    mcpRedact: true,
    http: false,
    httpPort: 0,
    pauseOnBattery: true,
    connections: DEFAULT_CONNECTIONS.map((c) => ({ ...c })),
    active: 'anthropic',
  };
}

/** Fills in anything missing, and carries over the older single-AI setting. */
export function normalizeBrainSettings(raw: Partial<BrainSettings> | undefined, legacy?: { provider: string; model: string; ollamaUrl: string }): BrainSettings {
  const d = defaultBrainSettings();
  const b: BrainSettings = { ...d, ...(raw ?? {}) };
  if (!['names', 'snippets', 'full'].includes(b.visibility)) b.visibility = 'snippets';
  if (!Array.isArray(b.connections) || !b.connections.length) b.connections = d.connections;
  b.connections = b.connections.filter((c) => c && typeof c.id === 'string' && typeof c.kind === 'string').map((c) => ({ ...c, model: c.model ?? '', label: c.label || c.id }));
  if (!raw && legacy) {
    b.active = legacy.provider;
    const c = b.connections.find((x) => x.id === legacy.provider);
    if (c && legacy.model) c.model = legacy.model;
    const o = b.connections.find((x) => x.id === 'ollama');
    if (o && legacy.ollamaUrl) o.baseUrl = legacy.ollamaUrl;
  }
  if (!b.connections.some((c) => c.id === b.active)) b.active = b.connections[0]?.id ?? 'anthropic';
  if (!Number.isInteger(b.httpPort) || b.httpPort < 0 || b.httpPort > 65535) b.httpPort = 0;
  return b;
}
