// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper-to-Keeper remote access in the interface: help mode, your devices as
// a fleet (groups, tags, notes, search), remote actions, a terminal on another
// device, the audit log, unattended access, and how the direct carrier is doing.

import type { ExecResultView, HelpOfferView, HelpStatusView, UnattendedStatus } from './access-types';
import type { AuditEntry, AuditFilter } from './link/audit';
import type { SysInfo } from './link/actions';
import type { DeviceMeta } from './link/fleet';

export type { AuditEntry, AuditFilter, DeviceMeta, ExecResultView, HelpOfferView, HelpStatusView, SysInfo, UnattendedStatus };

export interface CommandAsk {
  id: string;
  device: string;
  deviceName: string;
  command: string;
}

export interface AccessApi {
  /** "Get help": a 9-digit code and a one-time password, for 10 minutes */
  helpStart(): Promise<HelpOfferView>;
  /** stop waiting, and end any help session */
  helpStop(): Promise<void>;
  helpStatus(): Promise<HelpStatusView>;
  /** "Help someone": connect with their code and password and open their screen (view only) */
  helpJoin(code: string, password: string, opts?: { tab?: boolean }): Promise<{ sid: string; name: string }>;
  setMeta(device: string, meta: Partial<DeviceMeta>): Promise<DeviceMeta>;
  audit(filter?: AuditFilter): Promise<AuditEntry[]>;
  /** saves the log as CSV or JSON (asks where); returns the file, or null when cancelled */
  exportAudit(format: 'csv' | 'json', device?: string): Promise<string | null>;
  exec(device: string, command: string): Promise<ExecResultView>;
  power(device: string, action: 'lock' | 'sleep' | 'restart'): Promise<void>;
  info(device: string): Promise<SysInfo>;
  /** prints a file on the other device's default printer (asks which file when none is given) */
  print(device: string, file?: string): Promise<void>;
  /** a terminal on another device; output arrives as 'access-term' events (id, text) and 'access-term-exit' (id, reason) */
  termOpen(device: string, cols: number, rows: number): Promise<string>;
  termWrite(id: string, data: string): Promise<void>;
  termResize(id: string, cols: number, rows: number): Promise<void>;
  termClose(id: string): Promise<void>;
  /** a device asks to run a command here for the first time */
  pendingCommands(): Promise<CommandAsk[]>;
  answerCommand(id: string, ok: boolean): Promise<void>;
  unattended(): Promise<UnattendedStatus>;
  setUnattended(on: boolean): Promise<UnattendedStatus>;
  /** direct-path attempts on this device */
  directStats(): Promise<{ attempts: number; ok: number; failed: number; lastError: string; openSockets: number }>;
}
