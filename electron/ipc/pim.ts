// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Mail, calendars, reminders, alarms and contacts over IPC, and for the
// keeper command and AI agents through Keeper's local socket.

import { mailMcp } from '../../core/pim/mail-mcp';
import { requestApproval, setToolProvider } from '../services/agents';
import { registerKeeperMethod } from '../services/keeper-methods';
import { featureOn } from '../services/features';
import { pimCalls as pim, pimToolCalls as pimTools, threadOfCall as threadOf } from '../services/pim/route';
import { registerPimWindowIpc } from './pim-window';

export { PIM_METHODS } from './pim-window';

// Answered here, or by Mail and calendars in a process of its own (services/pim/route.ts).
export function registerPimIpc() {
  registerPimWindowIpc();
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
    // Tidying asks the person each time (one question per batch), in Keeper.
    approve: async (q) => (await requestApproval(q.client ?? 'An app connected over MCP', 'mail_tidy', `${q.action} ${q.count} message${q.count === 1 ? '' : 's'}: ${q.samples.join('; ')}${q.count > q.samples.length ? '; …' : ''}`, true)) !== 'deny',
    tidy: async (ids, a) => {
      if (a.action === 'archive') await pim.archive(ids);
      else if (a.action === 'label') await pim.label(ids, a.label, true);
      else await pim.move(ids, a.folder);
    },
    // Sending is never done by an app: the message opens in Keeper and waits for the person.
    proposeSend: (d) => pim.stageCompose(d),
  });
  setToolProvider('mail', { tools: () => (featureOn('mail') ? mail.tools() as never : []), call: (name, args) => mail.call(name, args) });
}
