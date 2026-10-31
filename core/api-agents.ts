// SPDX-License-Identifier: AGPL-3.0-or-later
// What the interface can ask of the agents layer: AI services and costs,
// actions and approvals, the model gateway, agent apps and launchers, skills,
// usage learning and the knowledge graph.

import type { Permission } from './brain/actions';
import type { AgentCli, AgentProfile } from './brain/agents';
import type { CatalogEntry } from './brain/catalog';
import type { GatewayModel } from './brain/gateway';
import type { Graph } from './graph/build';
import type { Suggestion } from './learn';

export interface ApprovalRequest {
  id: string;
  client: string;
  action: string;
  description: string;
  destructive: boolean;
  at: number;
}

export interface AuditItem {
  at: number;
  client: string;
  action: string;
  description: string;
  status: 'done' | 'denied' | 'error' | 'off';
  detail?: string;
  journalId?: string;
}

export interface ActionInfo {
  name: string;
  label: string;
  group: string;
  readOnly: boolean;
  destructive: boolean;
  permission: Permission;
  default: Permission;
}

export interface UsageRow {
  id: string;
  calls: number;
  input: number;
  output: number;
  errors: number;
  cost?: number;
}

export interface GatewayInfo {
  on: boolean;
  port: number;
  token: string;
  base: string;
  a2a: boolean;
  remoteHosts: string[];
  models: GatewayModel[];
  snippets: { id: string; label: string; text: string }[];
}

export interface SkillInfo {
  name: string;
  description: string;
  body: string;
  enabled: boolean;
  files?: string[];
  meta: Record<string, unknown>;
}

export interface AgentsApi {
  catalog(): Promise<CatalogEntry[]>;
  addConnection(catalogId: string, o: { model?: string; baseUrl?: string; key?: string; label?: string }): Promise<{ ok: boolean; id: string; message?: string }>;
  listModels(connectionId: string): Promise<{ ok: boolean; models: string[]; message?: string }>;
  usage(days?: number): Promise<UsageRow[]>;

  actions(): Promise<ActionInfo[]>;
  setPermission(name: string, p: Permission): Promise<void>;
  pending(): Promise<ApprovalRequest[]>;
  decide(id: string, d: 'once' | 'always' | 'deny'): Promise<void>;
  audit(): Promise<AuditItem[]>;

  gateway(): Promise<GatewayInfo>;
  rotateToken(): Promise<GatewayInfo>;

  clis(refresh?: boolean): Promise<{ agents: (AgentCli & { path?: string; installed: boolean })[]; profiles: AgentProfile[] }>;
  saveProfile(p: { id?: string; agent: string; label: string; cwd?: string; separate?: boolean }): Promise<AgentProfile[]>;
  removeProfile(id: string): Promise<void>;
  launch(agentId: string, o?: { profileId?: string; cwd?: string }): Promise<{ ok: boolean; message: string }>;

  skills(): Promise<SkillInfo[]>;
  saveSkill(text: string, previousName?: string): Promise<{ ok: boolean; errors: string[]; name?: string }>;
  removeSkill(name: string): Promise<void>;
  setSkillEnabled(name: string, on: boolean): Promise<void>;
  importSkill(folder: string): Promise<{ ok: boolean; errors: string[]; name?: string }>;
  otherSkills(): Promise<{ path: string; name: string; from: string }[]>;
  exportSkill(name: string): Promise<string | null>;
  draftSkill(input: { title: string; question: string; answer: string; steps: { tool: string; summary: string; args?: Record<string, unknown> }[] }): Promise<string>;

  learning(): Promise<{ on: boolean; events: number; since?: number; summary: string }>;
  suggestions(): Promise<Suggestion[]>;
  applySuggestion(id: string): Promise<{ ok: boolean; message: string }>;
  dismissSuggestion(id: string): Promise<void>;
  forget(): Promise<void>;
  record(e: { type: 'search'; q: string } | { type: 'page'; name: string } | { type: 'open'; path: string }): Promise<void>;

  graph(o?: { within?: string[]; kinds?: string[]; days?: number; similar?: boolean; maxFiles?: number; focus?: string; depth?: number }): Promise<Graph>;
}
