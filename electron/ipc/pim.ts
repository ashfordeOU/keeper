// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Mail, calendars, reminders, alarms and contacts over IPC, and for the
// keeper command and AI agents through Keeper's local socket.

import { ipcMain } from 'electron';
import { mailMcp } from '../../core/pim/mail-mcp';
import { setToolProvider } from '../services/agents';
import { registerKeeperMethod } from '../services/brain';
import { featureOn } from '../services/features';
import { pim, threadOf } from '../services/pim';
import { pimTools } from '../services/pim/brain-adapter';
import { mailLink } from '../../core/pim/mail-link';
import { markOrigin } from '../services/origin-mark';

export const PIM_METHODS = Object.keys(pim) as (keyof typeof pim)[];

export function registerPimIpc() {
  for (const m of PIM_METHODS) {
    ipcMain.handle(`pim.${m}`, (_e, ...args: unknown[]) => (pim[m] as (...a: unknown[]) => unknown)(...args));
  }
  // A saved attachment records the message it came from (Downloaded From → Mail).
  ipcMain.removeHandler('pim.saveAttachment');
  ipcMain.handle('pim.saveAttachment', async (_e, id: string, att: string, to?: string) => {
    const saved = await pim.saveAttachment(id, att, to);
    if (saved) await markOrigin(saved, { url: mailLink(id) });
    return saved;
  });
  // `keeper` command and agents: read-only questions answered here; changes ask in the app.
  registerKeeperMethod('keeper/mail.search', (p) => pimTools.searchMail(String(p.query ?? ''), Number(p.limit ?? 20)));
  registerKeeperMethod('keeper/calendar.list', (p) => pimTools.listEvents(Number(p.from ?? Date.now()), Number(p.to ?? Date.now() + 7 * 86_400_000)));
  registerKeeperMethod('keeper/calendar.add', (p) => pimTools.createEvent(String(p.text ?? '')));
  // Mail for coding assistants (MCP): only accounts the person shared, search, read and drafts only.
  const mail = mailMcp({
    accounts: () => pim.accounts(),
    folders: () => pim.folders(),
    search: async (query, limit) => (await pim.messages({ folder: 'search', query })).messages.slice(0, limit),
    read: async (id) => { const o = await pim.open(id, { markRead: false }); return { summary: o.summary, text: o.text }; },
    thread: (id) => threadOf(id),
    saveDraft: (d) => pim.saveDraft(d),
  });
  setToolProvider('mail', { tools: () => (featureOn('mail') ? mail.tools() as never : []), call: (name, args) => mail.call(name, args) });
}
