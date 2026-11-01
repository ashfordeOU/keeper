// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Settings for AI agents in Keeper: what they may do, the model gateway,
// agent-to-agent access, fallback and privacy routing, usage learning and
// skills. No Node modules here (the interface reads these too).

import type { AgentProfile } from './brain/agents';
import type { Permission } from './brain/actions';
import type { Price } from './brain/catalog';
import { defaultComputerPolicy, normalizeComputerPolicy, type ComputerPolicy } from './computer';

export interface AgentSettings {
  /** agents connected over MCP may use action tools (each still behind its permission) */
  actions: boolean;
  /** per-action permission; missing = that action's default */
  permissions: Record<string, Permission>;
  /** OpenAI- and Anthropic-compatible endpoint for other tools, on 127.0.0.1 */
  gateway: boolean;
  /** 0 picks a free port */
  gatewayPort: number;
  /** answer other agents over A2A (needs the gateway) */
  a2a: boolean;
  /** host names besides 127.0.0.1 the gateway answers to (your tunnel's), for phones, Siri or Alexa */
  remoteHosts: string[];
  /** connection ids tried in order when the active AI fails */
  fallback: string[];
  /** conversations that touch these folders continue on `localConnection` */
  privateFolders: string[];
  localConnection: string;
  /** prices per million tokens, per connection, for the cost column */
  prices: Record<string, Price>;
  /** learn from how Keeper is used (only on this computer) */
  learn: boolean;
  learnDays: number;
  /** suggestions the person said no to */
  dismissed: string[];
  /** skills turned off (all others are on) */
  skillsOff: string[];
  /** saved agent profiles (separate accounts) */
  profiles: AgentProfile[];
  /** letting an AI use this computer (screen, pointer, keyboard): off unless the person turns it on */
  computer: ComputerPolicy;
}

export function defaultAgentSettings(): AgentSettings {
  return {
    actions: true,
    permissions: {},
    gateway: false,
    gatewayPort: 0,
    a2a: false,
    remoteHosts: [],
    fallback: [],
    privateFolders: [],
    localConnection: 'ollama',
    prices: {},
    learn: false,
    learnDays: 60,
    dismissed: [],
    skillsOff: [],
    profiles: [],
    computer: defaultComputerPolicy(),
  };
}

export function normalizeAgentSettings(raw: unknown): AgentSettings {
  const d = defaultAgentSettings();
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<AgentSettings>;
  const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const out: AgentSettings = {
    ...d,
    ...r,
    permissions: r.permissions && typeof r.permissions === 'object' ? Object.fromEntries(Object.entries(r.permissions).filter(([, v]) => v === 'off' || v === 'ask' || v === 'allow')) as Record<string, Permission> : {},
    remoteHosts: arr(r.remoteHosts).map((h) => h.trim().toLowerCase()).filter((h) => /^[a-z0-9.-]+$/.test(h)),
    fallback: arr(r.fallback),
    privateFolders: arr(r.privateFolders),
    dismissed: arr(r.dismissed),
    skillsOff: arr(r.skillsOff),
    profiles: Array.isArray(r.profiles) ? r.profiles.filter((p) => p && typeof p.id === 'string' && typeof p.agent === 'string') : [],
    prices: r.prices && typeof r.prices === 'object' ? r.prices : {},
    computer: normalizeComputerPolicy(r.computer),
  };
  for (const k of ['actions', 'gateway', 'a2a', 'learn'] as const) if (typeof out[k] !== 'boolean') out[k] = d[k];
  if (!Number.isInteger(out.gatewayPort) || out.gatewayPort < 0 || out.gatewayPort > 65535) out.gatewayPort = 0;
  if (!Number.isFinite(out.learnDays) || out.learnDays < 1) out.learnDays = d.learnDays;
  if (typeof out.localConnection !== 'string') out.localConnection = d.localConnection;
  return out;
}
