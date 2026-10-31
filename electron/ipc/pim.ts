// SPDX-License-Identifier: AGPL-3.0-or-later
// Mail, calendars, reminders, alarms and contacts over IPC, and for the
// keeper command and AI agents through Keeper's local socket.

import { ipcMain } from 'electron';
import { registerKeeperMethod } from '../services/brain';
import { pim } from '../services/pim';
import { pimTools } from '../services/pim/brain-adapter';

export const PIM_METHODS = Object.keys(pim) as (keyof typeof pim)[];

export function registerPimIpc() {
  for (const m of PIM_METHODS) {
    ipcMain.handle(`pim.${m}`, (_e, ...args: unknown[]) => (pim[m] as (...a: unknown[]) => unknown)(...args));
  }
  // `keeper` command and agents: read-only questions answered here; changes ask in the app.
  registerKeeperMethod('keeper/mail.search', (p) => pimTools.searchMail(String(p.query ?? ''), Number(p.limit ?? 20)));
  registerKeeperMethod('keeper/calendar.list', (p) => pimTools.listEvents(Number(p.from ?? Date.now()), Number(p.to ?? Date.now() + 7 * 86_400_000)));
  registerKeeperMethod('keeper/calendar.add', (p) => pimTools.createEvent(String(p.text ?? '')));
}
