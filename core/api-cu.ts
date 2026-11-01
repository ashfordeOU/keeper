// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Computer use beyond the screen: Keeper's browser for AIs, private desktops,
// task plans and checkpoints, saved sign-ins and recorded workflows.

import type { Sensitive } from './cu/guard';
import type { SavedSecret } from './cu/secrets';
import type { Checkpoint } from './cu/run';
import type { WorkflowSchedule } from './cu/schedule';

export type CuScheduleView = WorkflowSchedule & { label: string; next?: number };

export interface CuTab {
  id: string;
  client: string;
  url: string;
  title: string;
  visible: boolean;
  takenOver: boolean;
  recording: boolean;
  steps: number;
  downloads: string[];
}

export interface CuState {
  tabs: CuTab[];
  desktops: { id: string; client: string; display: string; since: number }[];
  desktopSupport: { ok: boolean; why?: string };
  tasks: Checkpoint[];
  resumable: string[];
  workflows: { id: string; name: string; site: string; params: { name: string; example: string; secret?: boolean }[]; steps: number; created: number; text: string }[];
  schedules: CuScheduleView[];
}

export interface CuSettingsView {
  askBefore: Sensitive[];
  secrets: SavedSecret[];
  showTabs: boolean;
  maxSteps: number;
  maxMinutes: number;
  mcpScreenshots: 'images' | 'text';
  phoneApprovals: boolean;
  labels: Record<Sensitive, string>;
}

export interface CuApi {
  state(): Promise<CuState>;
  settings(): Promise<CuSettingsView>;
  setSettings(patch: Partial<Omit<CuSettingsView, 'labels'>>): Promise<unknown>;
  /** value only for keychain secrets; it goes straight into the system keychain */
  saveSecret(s: SavedSecret, value?: string): Promise<boolean>;
  removeSecret(name: string): Promise<void>;
  show(tabId: string, on: boolean): Promise<void>;
  takeOver(tabId: string, on: boolean): Promise<void>;
  closeTab(tabId: string): Promise<void>;
  /** opens a visible tab that records what the person does; returns its id */
  record(url: string): Promise<string>;
  stopRecording(tabId: string, name: string): Promise<string | null>;
  runWorkflow(id: string, values: Record<string, string>, visible: boolean): Promise<{ ok: boolean; note: string }>;
  removeWorkflow(id: string): Promise<void>;
  resume(taskId: string): Promise<boolean>;
  forgetTask(taskId: string): Promise<void>;
  editPlan(client: string, steps: string): Promise<string>;
  /** runs a workflow by itself: on a schedule, when Keeper starts or when the computer wakes */
  addSchedule(s: Pick<WorkflowSchedule, 'workflowId' | 'trigger' | 'when' | 'values' | 'visible'>): Promise<string>;
  setSchedule(id: string, on: boolean): Promise<void>;
  removeSchedule(id: string): Promise<void>;
  runSchedule(id: string): Promise<{ ok: boolean; note: string } | null>;
}
