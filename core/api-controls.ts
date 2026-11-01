// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Quick Controls between the main process and the window.

import type { Plan } from './controls/plan';
import type { ControlDef, ControlState, ControlValue, LogEntry, Os, Preset } from './controls/types';
import type { PermissionGrant } from './security/types';

export interface ControlsView {
  os: Os;
  defs: ControlDef[];
  states: ControlState[];
  presets: Preset[];
  log: LogEntry[];
  /** firewall profile id → preset id */
  bindings: Record<string, string>;
  /** firewall profiles to bind presets to */
  profiles: { id: string; name: string; active: boolean }[];
  /** true when changes are written to a file instead of the system (tests) */
  dryRun: boolean;
  readAt: number;
}

export interface ControlsResult {
  ok: boolean;
  message: string;
  /** set when the change makes the system less protected and was not confirmed */
  needsConfirm?: { warnings: string[] };
  /** opened the system's Settings page instead */
  opened?: string;
  view?: ControlsView;
}

export interface ControlsApi {
  /** every control with its state here (read on demand, cached for a few seconds) */
  list(refresh?: boolean): Promise<ControlsView>;
  /** switch one; weakening changes need confirmWeaker */
  set(id: string, value: ControlValue, opts?: { confirmWeaker?: boolean }): Promise<ControlsResult>;
  /** what a preset would change now */
  preview(presetId: string): Promise<Plan>;
  /** apply a preset (one administrator prompt for all its changes) */
  applyPreset(presetId: string, opts?: { confirmWeaker?: boolean }): Promise<ControlsResult>;
  /** put a logged change back */
  undo(logId: string, opts?: { confirmWeaker?: boolean }): Promise<ControlsResult>;
  /** open the Settings page for a control Keeper cannot change */
  open(id: string): Promise<{ ok: boolean; label?: string; message?: string }>;
  /** bind a preset to a firewall profile (null removes) */
  bind(profileId: string, presetId: string | null): Promise<ControlsView>;
  /** apps with camera, microphone, location… access */
  perApp(): Promise<{ grants: PermissionGrant[]; notes: string[] }>;
  /** allow or deny one app (Windows directly; elsewhere revokes or opens Settings) */
  perAppSet(grant: PermissionGrant, allowed: boolean): Promise<{ ok: boolean; message: string }>;
  /** brings the main window to the Quick Controls page (from the Island) */
  showPage(): Promise<void>;
}
