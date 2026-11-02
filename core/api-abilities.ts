// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The window's view of Keeper's abilities (Agents → Abilities, the Agents
// page's Teams and Schedules, the Assistant's voice mode).

import type { AbilitiesSettings, Persona, Project, ScheduledTask } from './abilities/config';
import type { Memory } from './abilities/memory';
import type { CostSummary } from './abilities/policy';
import type { TeamResult, TeamSpec } from './abilities/teams';

export interface AbilityInfo {
  name: string;
  label: string;
  group: string;
  description: string;
  network: 'always' | 'maybe' | 'never';
  readOnly: boolean;
  permission: 'off' | 'ask' | 'allow';
}

export interface ProviderInfo {
  id: string;
  label: string;
  needsKey: boolean;
  keyHint?: string;
  local?: boolean;
  site?: string;
  edits?: boolean;
}

export interface AbilitiesApi {
  settings(): Promise<AbilitiesSettings>;
  save(patch: Partial<AbilitiesSettings>): Promise<AbilitiesSettings>;
  list(): Promise<AbilityInfo[]>;
  providers(): Promise<{ search: ProviderInfo[]; images: ProviderInfo[]; keys: Record<string, boolean> }>;
  setKey(name: string, value: string): Promise<boolean>;
  /** tries the chosen search service */
  testSearch(query?: string): Promise<{ ok: boolean; message: string; results?: { title: string; url: string }[] }>;
  /** runs one ability from the window (the person is the caller) */
  call(name: string, args: Record<string, unknown>): Promise<{ content: string; summary: string; isError?: boolean; files?: string[] }>;
  memories(): Promise<Memory[]>;
  addMemory(text: string, scope?: Memory['scope'], owner?: string): Promise<Memory[]>;
  editMemory(id: string, patch: Partial<Pick<Memory, 'text' | 'cloud' | 'pinned'>>): Promise<Memory[]>;
  removeMemory(id: string): Promise<Memory[]>;
  clearMemories(): Promise<Memory[]>;
  costs(days?: number): Promise<CostSummary>;
  saveTask(t: Omit<ScheduledTask, 'id'> & { id?: string }): Promise<ScheduledTask[]>;
  removeTask(id: string): Promise<ScheduledTask[]>;
  runTask(id: string): Promise<string>;
  /** "every weekday at 8:30" → the next times it runs, or why it cannot */
  describeSchedule(when: string): Promise<{ ok: boolean; label?: string; next?: number[]; error?: string }>;
  savePersona(p: Omit<Persona, 'id'> & { id?: string }): Promise<Persona[]>;
  removePersona(id: string): Promise<Persona[]>;
  saveProject(p: Omit<Project, 'id'> & { id?: string }): Promise<Project[]>;
  removeProject(id: string): Promise<Project[]>;
  members(): Promise<{ id: string; label: string; local?: boolean; strengths?: string[] }[]>;
  saveTeam(t: Omit<TeamSpec, 'id'> & { id?: string }): Promise<TeamSpec[]>;
  removeTeam(id: string): Promise<TeamSpec[]>;
  runTeam(runId: string, team: string | TeamSpec, prompt: string): Promise<TeamResult>;
  cancelTeam(runId: string): Promise<void>;
  /** speech to text with the chosen service (voice mode) */
  transcribe(audio: ArrayBuffer, mime: string): Promise<string>;
  speak(text: string): Promise<void>;
}
