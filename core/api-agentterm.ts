// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper's windows ↔ agent terminals and the agent hub.

import type { BusMessage, LockInfo } from './terminal/agent/bus';
import type { AgentPerms, HubAgent, HubTask } from './terminal/agent/hub';
import type { AgentTerm, Limits } from './terminal/agent/manager';
import type { CommandPolicy } from './terminal/agent/policy';

export type AgentTermNode = AgentTerm & { sub: AgentTermNode[] };

export interface AgentTermState {
  terms: AgentTermNode[];
  agents: HubAgent[];
  tasks: HubTask[];
  rooms: { name: string; count: number; last?: number }[];
  locks: LockInfo[];
  policy: CommandPolicy;
  limits: Limits;
  recipes: { id: string; name: string; description: string; roles: { id: string; title: string; count: number; prefer: string[] }[] }[];
}

export interface AgentTermApi {
  state(): Promise<AgentTermState>;
  messages(room: string, after?: number): Promise<BusMessage[]>;
  post(room: string, text: string): Promise<BusMessage>;
  send(to: string, text: string): Promise<unknown>;
  postTask(o: { title: string; detail?: string; room?: string; assignee?: string; forHarness?: string[] }): Promise<HubTask>;
  handoff(taskId: string, to: string, summary: string): Promise<HubTask>;
  takeOver(id: string, back?: boolean): Promise<void>;
  show(id: string): Promise<void>;
  close(id: string): Promise<string[]>;
  stopAll(): Promise<number>;
  pause(id: string, paused: boolean): Promise<void>;
  approve(id: string): Promise<void>;
  setPerms(id: string, p: Partial<AgentPerms>): Promise<void>;
  setPolicy(p: Partial<CommandPolicy>, l?: Partial<Limits>): Promise<void>;
  /** an agent started outside Keeper (KEEPER_AGENT_TOKEN in its environment), or a command Keeper runs in a terminal as an agent */
  addAgent(o: { name: string; harness: string; account?: string; run?: string; cwd?: string; headless?: boolean }): Promise<{ id: string; token: string; session?: string; env: string }>;
  transcript(id: string): Promise<string>;
  runRecipe(id: string, goal: string, o: { cwd?: string; choose?: Record<string, string> }): Promise<{ room: string; started: string[]; missing: string[] }>;
}
