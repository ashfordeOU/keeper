// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The Inbox across the system: its calls, the small card the shortcut opens
// from any app (text, dictation, a screenshot area, a pasted link or a dropped
// file), and its entry in the tray menu. Off, it has no shortcut and no card.

import { BrowserWindow, ipcMain, screen } from 'electron';
import path from 'node:path';
import type { InboxInput, InboxItem } from '../../core/inbox';
import { featureOn, onFeature } from '../services/features';
import { addInbox, inboxCount, listInbox, removeInbox, restoreInbox } from '../services/inbox';
import { keepUnmanaged, overlayOptions } from '../services/unmanaged';

export interface InboxContext {
  preload: string;
  broadcast(channel: string, ...args: unknown[]): void;
  lockDown(win: BrowserWindow): void;
  show(route?: string): void;
  updateTray(): void;
}

const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const W = 460;
const H = 236;
let ctx: InboxContext;
let card: BrowserWindow | null = null;
let count = 0;

const need = () => {
  if (!featureOn('captureInbox')) throw new Error('The Inbox is switched off in Settings → Features');
};

async function changed() {
  count = await inboxCount();
  ctx.broadcast('inbox-changed', count);
  ctx.updateTray();
}

/** The card, near the top of the screen the pointer is on, in front of everything. */
function openCard() {
  if (!featureOn('captureInbox')) return;
  const wa = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const bounds = { x: Math.round(wa.x + (wa.width - W) / 2), y: Math.round(wa.y + wa.height * 0.18), width: W, height: H };
  if (card && !card.isDestroyed()) {
    card.setBounds(bounds);
    card.webContents.send('event:inbox-card');
    card.show();
    card.focus();
    return;
  }
  card = new BrowserWindow({
    ...overlayOptions('inbox'),
    ...bounds, frame: false, transparent: true, resizable: false, show: false, alwaysOnTop: true, hasShadow: false,
    webPreferences: { preload: ctx.preload, contextIsolation: true, sandbox: true },
  });
  keepUnmanaged(card, 'inbox');
  card.setAlwaysOnTop(true, 'floating');
  card.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  ctx.lockDown(card);
  if (DEV_URL) void card.loadURL(`${DEV_URL}?view=inbox-card`);
  else void card.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { query: { view: 'inbox-card' } });
  card.on('closed', () => { card = null; });
  card.once('ready-to-show', () => { card?.show(); card?.focus(); });
}

function closeCard() {
  if (card && !card.isDestroyed()) card.hide();
}

/** Called from main.ts's registerShortcuts (which clears every shortcut first). */
export function registerInboxShortcut(reg: (acc: string, fn: () => void, owner?: string) => void, accelerator: string) {
  if (featureOn('captureInbox') && accelerator) reg(accelerator, openCard, 'Inbox: catch something');
}

/** Tray: catch something, and how much waits in the Inbox. */
export function inboxTrayItems(accelerator?: string): Electron.MenuItemConstructorOptions[] {
  if (!ctx || !featureOn('captureInbox')) return [];
  return [
    { label: 'Catch Something…', accelerator: accelerator || undefined, click: openCard },
    ...(count ? [{ label: `Sort the Inbox (${count})`, click: () => ctx.show('inbox') }] : []),
  ];
}

export function openInboxCard() {
  openCard();
}

export function registerInboxIpc(c: InboxContext) {
  ctx = c;
  const h = (name: string, fn: (...args: never[]) => unknown) => ipcMain.handle(`inbox.${name}`, (_e, ...args) => fn(...(args as never[])));
  h('list', () => { need(); return listInbox(); });
  h('add', async (input: InboxInput) => { need(); const item = await addInbox(input ?? {}); if (item) await changed(); return item; });
  h('remove', async (id: string) => { need(); await removeInbox(String(id)); await changed(); });
  h('restore', async (item: InboxItem) => { need(); await restoreInbox(item); await changed(); });
  h('card', (action: 'open' | 'close' | 'hide' | 'show') => {
    if (action === 'open' || action === 'show') openCard();
    else closeCard();
  });
  onFeature('captureInbox', (on) => {
    if (on) void changed().catch(() => undefined);
    else if (card && !card.isDestroyed()) { card.destroy(); card = null; }
  }, { now: true });
}
