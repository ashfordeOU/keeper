// SPDX-License-Identifier: AGPL-3.0-or-later
// What the interface can ask of Keeper's brain.

import type { BrainHit, BrainStatus } from './brain-contract';
import type { AiConnection } from './brain/config';
import type { HarnessResult, TraceStep } from './brain/harness';
import type { ChatMessage } from './brain/providers';

export interface ConnectionInfo extends AiConnection {
  hasKey: boolean;
  local: boolean;
  needsKey: boolean;
}

export interface ConnectionsInfo {
  connections: ConnectionInfo[];
  active: string;
  /** kinds of AI this computer can use (the system's own model appears when it is available) */
  kinds: { kind: string; label: string; available: boolean }[];
  presets: { id: string; label: string; baseUrl: string; local?: boolean; keyless?: boolean }[];
}

export interface McpAppInfo {
  id: string;
  label: string;
  file: string;
  installed: boolean;
  connected: boolean;
}

export interface ServerInfo {
  http: boolean;
  port: number;
  token: string;
  socket: string;
  snippets: { id: string; label: string; text: string }[];
}

export type AskResult = Omit<HarnessResult, 'messages'> & { messages: ChatMessage[] };

export interface BrainApi {
  status(): Promise<BrainStatus>;
  search(query: string, opts?: { limit?: number; mode?: 'hybrid' | 'words' | 'meaning' }): Promise<BrainHit[]>;
  /** answers with the active AI; deltas and steps arrive as 'brain-delta' / 'brain-step' events with the same reqId */
  ask(reqId: string, question: string, history?: ChatMessage[]): Promise<AskResult>;
  cancel(reqId: string): Promise<void>;
  setSemantic(on: boolean): Promise<BrainStatus>;
  removeModel(): Promise<BrainStatus>;
  rebuild(): Promise<BrainStatus>;
  connections(): Promise<ConnectionsInfo>;
  testConnection(id: string): Promise<{ ok: boolean; message: string }>;
  apps(): Promise<McpAppInfo[]>;
  setAppConnected(id: string, on: boolean): Promise<{ ok: boolean; message: string }>;
  server(): Promise<ServerInfo>;
  /** bytes the meaning-search model downloads */
  modelSize(): Promise<number>;
}

export type BrainDelta = { reqId: string; text: string };
export type BrainStep = { reqId: string; step: TraceStep };
