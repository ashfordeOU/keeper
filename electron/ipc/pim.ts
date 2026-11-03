// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Mail, calendars, reminders, alarms and contacts over IPC, and for the
// keeper command and AI agents through Keeper's local socket.

import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { mailMcp } from '../../core/pim/mail-mcp';
import { requestApproval, setToolProvider } from '../services/agents';
import { registerKeeperMethod } from '../services/brain';
import { featureOn } from '../services/features';
import { mailLink } from '../../core/pim/mail-link';
import { markOrigin } from '../services/origin-mark';
import { pim as pimHere } from '../services/pim';
import { pimCalls as pim, pimToolCalls as pimTools, threadOfCall as threadOf } from '../services/pim/route';

export const PIM_METHODS = Object.keys(pimHere) as (keyof typeof pimHere)[];

// Answered here, or by Mail and calendars in a process of its own (services/pim/route.ts).
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
  // Save as PDF: the message is drawn in a hidden window (no scripts) and printed to a file.
  ipcMain.removeHandler('pim.savePdf');
  ipcMain.handle('pim.savePdf', async (e, id: string) => {
    const html = await pim.printable(id);
    const owner = BrowserWindow.fromWebContents(e.sender) ?? undefined;
    const title = (html.match(/<title>([^<]*)<\/title>/)?.[1] ?? 'Message').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'Message';
    const pick = owner ? await dialog.showSaveDialog(owner, { defaultPath: path.join(app.getPath('downloads'), `${title}.pdf`), filters: [{ name: 'PDF', extensions: ['pdf'] }] }) : { canceled: true, filePath: undefined };
    if (pick.canceled || !pick.filePath) return null;
    const w = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true, offscreen: true } });
    try {
      await w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      const pdf = await w.webContents.printToPDF({ printBackground: true });
      await fsp.writeFile(pick.filePath, pdf);
      return pick.filePath;
    } finally {
      w.destroy();
    }
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
