// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// What the interface can ask of the agents layer: AI services and costs,
// actions and approvals, the model gateway, agent apps and launchers, skills,
// usage learning and the knowledge graph.

import type { Permission } from './brain/actions';
import type { AgentCli, AgentProfile } from './brain/agents';
import type { CatalogEntry } from './brain/catalog';
import type { GatewayModel } from './brain/gateway';
import type { Graph } from './graph/build';
import type { Explanation, GraphPrivacy, GraphView, ItemKind, ItemRef, KNode, RelatedItem, ViewOptions } from './graph/everything';
import type { EverythingHit, ItemDocKind } from './brain/items';

/** The knowledge graph of everything: what it holds and what it may include. */
export interface GraphStatus {
  on: boolean;
  nodes: number;
  links: number;
  counts: Partial<Record<ItemKind, number>>;
  updatedAt: number;
  lastChange: { added: number; changed: number; removed: number };
  meaning: { on: boolean; items: number; embedded: number; pending: number };
  privacy: GraphPrivacy;
  accounts: { id: string; label: string }[];
  folders: { account: string; path: string; name: string }[];
  parts: { mail: boolean; calendars: boolean; meetings: boolean; tracks: boolean; reader: boolean; notes: boolean };
}
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
  /** denied: the person said no · refused: Keeper's own safety rules blocked it */
  status: 'done' | 'denied' | 'refused' | 'error' | 'off';
  detail?: string;
  journalId?: string;
  /** using the computer: a small picture of what the AI saw */
  shot?: string;
}

export interface ComputerState {
  sessions: { id: string; client: string; since: number; actions: number }[];
  /** the shortcut that stops every session */
  stopShortcut: string;
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
  /** AIs using this computer right now */
  computerState(): Promise<ComputerState>;
  /** stops every AI using this computer */
  computerStop(): Promise<void>;
  /** a picture from the activity log, as a data URL */
  computerShot(file: string): Promise<string | null>;

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

  /** the graph of everything: files, notes, mail, people, organisations, events, tasks, projects, places, saved pages, meetings, apps */
  graphStatus(): Promise<GraphStatus>;
  /** a neighbourhood around one thing, or the best-linked part of everything with the rest summed up */
  graphView(o?: Omit<ViewOptions, 'similar' | 'focus'> & { focus?: string | ItemRef }): Promise<GraphView>;
  graphFind(q: string, kinds?: ItemKind[]): Promise<KNode[]>;
  /** what relates to a file, an email, an event, a person… with the reason for each */
  graphRelated(ref: ItemRef, o?: { limit?: number; kinds?: ItemKind[] }): Promise<{ node: KNode | null; items: RelatedItem[] }>;
  /** how two things are connected, step by step */
  graphExplain(a: string, b: string): Promise<Explanation | null>;
  /** a link to the thing in today's daily note */
  graphAddToNote(id: string): Promise<{ path: string } | null>;
  /** one search over files, mail, events, tasks, contacts, notes, meetings and saved pages */
  searchEverything(q: string, o?: { kinds?: (ItemDocKind | 'file')[]; limit?: number }): Promise<EverythingHit[]>;
}
