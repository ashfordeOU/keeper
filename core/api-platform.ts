// SPDX-License-Identifier: AGPL-3.0-or-later
// The interface ↔ main-process contract for Keeper inside the operating
// system: Spotlight, desktop search, Explorer, Windows agents, MCP.

import type { Integration, IntegrationId } from './platform-integrations';

export interface PlatformApi {
  /** what this computer offers and what is switched on; `refresh` asks the system again */
  list(refresh?: boolean): Promise<Integration[]>;
  set(id: IntegrationId, on: boolean): Promise<{ list: Integration[]; message?: string }>;
  /** one-off actions such as "copy-mcp" or "register-odr"; `copy` is text for the clipboard */
  action(id: string): Promise<{ ok: boolean; message?: string; copy?: string }>;
  /** opens Keeper's assistant with this question */
  ask(question: string): Promise<void>;
}
