// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Cues across the system: the popup beside the app or page a cue belongs to,
// the composer (Island, popup, palette, shortcut, browser button), the
// dashboard page's IPC, the `keeper cues` command, AI abilities and the
// browser extension's "capture this page".

import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Notification, screen, shell } from 'electron';
import path from 'node:path';
import { promises as fsp } from 'node:fs';
import { registerAbility } from '../../core/abilities/registry';
import type { CueInput, CueSettings } from '../../core/cues/api';
import { searchCues, whenText } from '../../core/cues/dashboard';
import { describeAnchor, type Cue, type CueAnchor } from '../../core/cues/model';
import { registerKeeperMethod } from '../services/brain';
import { CuesService } from '../services/cues';
import { featureOn, onFeature } from '../services/features';
import { linuxWindowBounds, type FrontWindow } from '../services/fg-watch';

export interface CuesContext {
  preload: string;
  broadcast(channel: string, ...args: unknown[]): void;
  lockDown(win: BrowserWindow): void;
  show(route?: string): void;
  /** quiet Island alerts and the cue beside the pill */
  island(kind: 'due' | 'here' | 'hint', title: string, detail: string, ref?: string): void;
  setCueHere(c: { id: string; title: string; count: number } | undefined): void;
  /** opens the Island on its Cues tool */
  openIsland(tool: string): void;
  /** called when cues change (tray menu) */
  updateTray(): void;
}

const DEV_URL = process.env.VITE_DEV_SERVER_URL;
let svc: CuesService | null = null;
let ctx: CuesContext;
let popupWin: BrowserWindow | null = null;
let popupData: { cues: Cue[]; front?: Partial<FrontWindow> & { url?: string }; compose?: { text?: string; attach?: CueAnchor['kind'][] } } = { cues: [] };
let shortcut = '';

const W = 360;

export function cuesService(): CuesService | null {
  return svc;
}

async function placePopup(front: FrontWindow | undefined, height: number): Promise<Electron.Rectangle> {
  let b = front?.bounds;
  if (!b && process.platform === 'linux') b = await linuxWindowBounds().catch(() => undefined);
  const d = b ? screen.getDisplayMatching({ x: b.x, y: b.y, width: Math.max(1, b.width), height: Math.max(1, b.height) }) : screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const wa = d.workArea;
  // Inside the window's top-right corner, below its title bar; beside it when there is room outside.
  let x = b ? (b.x + b.width + W + 12 <= wa.x + wa.width ? b.x + b.width + 8 : b.x + b.width - W - 16) : wa.x + wa.width - W - 16;
  let y = b ? b.y + 48 : wa.y + 60;
  x = Math.max(wa.x + 8, Math.min(wa.x + wa.width - W - 8, x));
  y = Math.max(wa.y + 8, Math.min(wa.y + wa.height - height - 8, y));
  return { x: Math.round(x), y: Math.round(y), width: W, height };
}

async function openPopup(cues: Cue[], front: FrontWindow | undefined, compose?: { text?: string; attach?: CueAnchor['kind'][] }) {
  popupData = { cues, front: front ? { ...front, url: svc?.front?.url } : svc?.front ? { app: svc.front.app ?? '', title: svc.front.title ?? '', url: svc.front.url } : undefined, compose };
  const height = compose ? 300 : Math.min(460, 120 + cues.length * 96);
  const bounds = await placePopup(front, height);
  if (!popupWin || popupWin.isDestroyed()) {
    popupWin = new BrowserWindow({
      ...bounds, frame: false, transparent: true, resizable: false, show: false, skipTaskbar: true, alwaysOnTop: true, fullscreenable: false, hasShadow: false,
      title: 'Keeper cue', webPreferences: { preload: ctx.preload, contextIsolation: true, sandbox: true },
    });
    popupWin.setAlwaysOnTop(true, 'floating');
    popupWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    ctx.lockDown(popupWin);
    if (DEV_URL) void popupWin.loadURL(`${DEV_URL}?view=cue`);
    else void popupWin.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { query: { view: 'cue' } });
    popupWin.on('closed', () => { popupWin = null; });
    popupWin.once('ready-to-show', () => (compose ? popupWin?.show() : popupWin?.showInactive()));
  } else {
    popupWin.setBounds(bounds);
    popupWin.webContents.send('event:cue-popup');
    if (compose) { popupWin.show(); popupWin.focus(); } else popupWin.showInactive();
  }
}

function closePopup() {
  if (popupWin && !popupWin.isDestroyed()) popupWin.hide();
}

function registerShortcut(s: CueSettings) {
  if (shortcut) { try { globalShortcut.unregister(shortcut); } catch { /* gone */ } shortcut = ''; }
  if (!featureOn('cues') || !s.shortcut) return;
  try {
    if (globalShortcut.register(s.shortcut, () => void compose({ attach: ['page', 'app'] }))) shortcut = s.shortcut;
  } catch {
    /* taken by another app */
  }
}

/** The shortcut and the palette: a composer beside what is in front, attached to it. */
async function compose(o: { text?: string; attach?: CueAnchor['kind'][] } = {}) {
  if (!svc) return;
  const { frontWindow } = await import('../services/fg-watch');
  await openPopup([], frontWindow(), { text: o.text, attach: o.attach });
}

/** Called by main.ts after it registers its own shortcuts (it clears all of them first). */
export function registerCueShortcut() {
  shortcut = '';
  if (svc) registerShortcut(svc.settings);
}

function cueLine(c: Cue): Record<string, unknown> {
  return {
    id: c.id, type: c.type, title: c.title, body: c.body.slice(0, 400), url: c.url, places: c.anchors.map(describeAnchor), due: c.due ? new Date(c.due).toISOString() : undefined,
    repeat: c.repeat, done: c.done, items: c.items?.map((i) => `${i.done ? '[x]' : i.skipped ? '[-]' : '[ ]'} ${i.text}`),
  };
}

/** Tray entries: a new cue, and the cues due today. */
export function cueTrayItems(): Electron.MenuItemConstructorOptions[] {
  if (!svc || !featureOn('cues') || !svc.settings.tray) return [];
  const end = new Date().setHours(23, 59, 59, 999);
  const due = svc.cues.filter((c) => !c.deletedAt && !c.done && c.due !== undefined && c.due <= end).slice(0, 6);
  return [{
    label: due.length ? `Cues (${due.length} due today)` : 'Cues',
    submenu: [
      { label: 'New Cue Here…', accelerator: svc.settings.shortcut || undefined, click: () => void compose({ attach: ['page', 'app'] }) },
      ...due.map((c) => ({ label: `${c.title.slice(0, 40)} · ${whenText(c.due!)}`, click: () => ctx.show(`cues:${c.id}`) })),
      { type: 'separator' as const },
      { label: 'Open Cues', click: () => ctx.show('cues') },
    ],
  }];
}

export function registerCuesIpc(c: CuesContext) {
  ctx = c;
  let changedTimer: NodeJS.Timeout | undefined;
  const changed = () => {
    clearTimeout(changedTimer);
    changedTimer = setTimeout(() => {
      ctx.broadcast('cues-changed');
      if (svc) {
        const here = svc.showing.map((id) => svc!.cues.find((x) => x.id === id)).filter((x): x is Cue => !!x && !x.done && !x.deletedAt);
        ctx.setCueHere(here.length ? { id: here[0].id, title: here[0].title, count: here.length } : undefined);
      }
      ctx.updateTray();
    }, 120);
  };
  const make = () => new CuesService({
    popup: (cues, front, comp) => void openPopup(cues, front, comp),
    closePopup,
    notify: (cue) => {
      if (!Notification.isSupported()) return;
      const n = new Notification({ title: cue.title, body: cue.body.split('\n')[0] || (cue.anchors[0] ? describeAnchor(cue.anchors[0]) : 'Cue'), silent: false });
      n.on('click', () => ctx.show(`cues:${cue.id}`));
      n.show();
    },
    island: (kind, title, detail, ref) => ctx.island(kind, title, detail, ref),
    changed,
  });

  onFeature('cues', (on) => {
    if (on) {
      svc ??= make();
      void svc.start().then(() => { registerShortcut(svc!.settings); changed(); });
    } else if (svc) {
      svc.stop();
      svc = null;
      registerShortcut({ shortcut: '' } as CueSettings);
      ctx.setCueHere(undefined);
      ctx.updateTray();
    }
  }, { now: true });

  const need = () => {
    if (!svc) throw new Error('Cues are switched off in Settings → Features');
    return svc;
  };
  const h = (name: string, fn: (...args: never[]) => unknown) => ipcMain.handle(`cues.${name}`, (_e, ...args) => fn(...(args as never[])));
  h('state', () => need().state());
  h('list', (o?: { filter?: never; q?: string; sort?: never }) => need().list(o));
  h('create', (i: CueInput) => need().create(i));
  h('update', (id: string, p: CueInput & { items?: string[] }) => need().update(id, p));
  h('toggleItem', (id: string, item: string) => need().toggleItem(id, item));
  h('skipItem', (id: string, item: string) => need().skipItem(id, item));
  h('complete', (id: string) => need().complete(id));
  h('reopen', (id: string) => need().reopen(id));
  h('snooze', (id: string, ch: never) => need().snooze(id, ch));
  h('remove', (id: string) => need().remove(id));
  h('restore', (id: string) => need().restore(id));
  h('purge', (id: string) => need().purge(id));
  h('dismiss', (id: string) => need().dismiss(id));
  h('templates', () => need().templates);
  h('saveTemplate', (t: never) => need().saveTemplate(t));
  h('removeTemplate', (id: string) => need().removeTemplate(id));
  h('startTemplate', (id: string, o?: never) => need().startTemplate(id, o));
  h('parse', (t: string) => need().parse(t));
  h('suggest', (t: string) => need().suggest(t));
  h('settings', () => need().settings);
  h('setSettings', async (p: Partial<CueSettings>) => { const s = await need().setSettings(p); registerShortcut(s); return s; });
  h('compose', (o?: { text?: string; attach?: CueAnchor['kind'][] }) => compose(o));
  h('openFolder', () => void shell.openPath(need().folder));
  h('exportMarkdown', async () => {
    const r = await dialog.showSaveDialog({ defaultPath: path.join(app.getPath('documents'), `Cues ${new Date().toISOString().slice(0, 10)}.md`), filters: [{ name: 'Markdown', extensions: ['md'] }] });
    if (r.canceled || !r.filePath) return null;
    await fsp.writeFile(r.filePath, need().exportAll());
    return r.filePath;
  });
  h('syncWithDevices', async () => {
    const s = need();
    try {
      const { syncApi } = await import('../services/sync');
      await syncApi.addFolder({ path: s.folder, label: 'Cues', mode: 'two-way', devices: [] });
      return { ok: true, message: 'The Cues folder now syncs with your devices. Add it on each device under Sync & Backup.' };
    } catch (e) {
      return { ok: false, message: `${e instanceof Error ? e.message : String(e)}. You can add “${s.folder}” under Sync & Backup → Synced folders.` };
    }
  });
  h('popup', () => ({ ...popupData, cues: popupData.cues.map((x) => svc?.cues.find((y) => y.id === x.id) ?? x) }));
  h('closePopup', () => closePopup());
  h('openPage', (id?: string) => { closePopup(); ctx.show(id ? `cues:${id}` : 'cues'); });
  // The browser extension (through keeper browser-host) and tests report the page in front.
  h('reportPage', (url: string, title: string) => need().browserActive(url, title));

  // ---------------------------------------------------------------- the browser extension and `keeper cues`
  registerKeeperMethod('keeper/cues.active', (p) => {
    if (svc && typeof p.url === 'string') svc.browserActive(p.url, String(p.title ?? ''));
    return { ok: !!svc };
  });
  registerKeeperMethod('keeper/cues.capture', async (p) => {
    const s = need();
    const url = String(p.url ?? '');
    const cue = await s.create({ text: String(p.text ?? ''), title: String(p.title ?? '') || undefined, url: url || undefined, type: p.text ? undefined : 'link', anchors: url ? [{ kind: p.site ? 'site' : 'page', value: p.site ? new URL(url).hostname.replace(/^www\./, '') : url, label: String(p.title ?? '') || undefined }] : [] });
    ctx.island('here', 'Cue saved', `${cue.title} · comes back on this ${p.site ? 'site' : 'page'}`, cue.id);
    return { id: cue.id, title: cue.title };
  });
  registerKeeperMethod('keeper/cues', async (p) => {
    const s = need();
    const cmd = String(p.cmd ?? 'list');
    const args = (p.args as string[] | undefined) ?? [];
    if (cmd === 'list') return s.list({ filter: (p.filter as never) ?? 'all', q: typeof p.q === 'string' ? p.q : undefined }).slice(0, 100).map(cueLine);
    if (cmd === 'add') {
      const anchors: CueAnchor[] = [];
      if (typeof p.app === 'string') anchors.push({ kind: 'app', value: p.app, label: p.app });
      if (typeof p.site === 'string') anchors.push({ kind: 'site', value: p.site, label: p.site });
      if (typeof p.page === 'string') anchors.push({ kind: 'page', value: p.page });
      if (typeof p.title === 'string') anchors.push({ kind: 'title', value: p.title, label: p.title });
      return cueLine(await s.create({ text: args.join(' '), anchors }));
    }
    if (cmd === 'done') return cueLine(await s.complete(args[0]));
    if (cmd === 'snooze') return cueLine(await s.snooze(args[0], (args[1] as never) ?? '1h'));
    if (cmd === 'rm' || cmd === 'remove') { await s.remove(args[0]); return { ok: true }; }
    if (cmd === 'search') return searchCues(s.cues, args.join(' ')).slice(0, 30).map(cueLine);
    if (cmd === 'templates') return s.templates.map((t) => ({ id: t.id, name: t.name, steps: t.items.length }));
    if (cmd === 'run') return cueLine(await s.startTemplate(args[0]));
    throw new Error('Commands: list [--filter waiting|later|overdue|done] | add <text> [--app A] [--site S] [--page URL] [--title WORDS] | done <id> | snooze <id> [10m|1h|tomorrow|nextvisit] | rm <id> | search <words> | templates | run <checklist id>');
  });

  // ---------------------------------------------------------------- abilities for any AI (permissions in Settings → Abilities)
  registerAbility({
    name: 'cues_search', label: 'Find cues', group: 'Time', defaultPermission: 'allow', network: 'never', readOnly: true,
    description: 'Searches the person\'s cues (notes, checklists, links and files tied to an app, a website, a page, a window title or a time) and lists them with where they come back and when they are due. Empty query lists open cues.',
    parameters: { type: 'object', properties: { query: { type: 'string' }, filter: { type: 'string', enum: ['all', 'waiting', 'later', 'overdue', 'done'] } } },
    describe: (a) => (a.query ? `Find cues about “${String(a.query).slice(0, 60)}”` : 'List open cues'),
  }, async (a) => {
    if (!svc) return { content: 'Cues are switched off.', summary: 'off', isError: true };
    const list = a.query ? searchCues(svc.cues, String(a.query)) : svc.list({ filter: (a.filter as never) ?? 'all' });
    return { content: JSON.stringify(list.slice(0, 40).map(cueLine)), summary: `${list.length} cues` };
  });
  registerAbility({
    name: 'cues_create', label: 'Leave a cue', group: 'Time', defaultPermission: 'ask', network: 'never', readOnly: false,
    description: 'Leaves a cue that comes back when the person opens an app or website, or at a time. "text" is read like a reminder ("send the invoice tomorrow 9am"; lines starting with "- " become checklist steps). Places: app (name), site (domain), page (URL), title (words in the window title).',
    parameters: { type: 'object', properties: { text: { type: 'string' }, app: { type: 'string' }, site: { type: 'string' }, page: { type: 'string' }, title: { type: 'string' } }, required: ['text'] },
    describe: (a) => `Leave a cue: “${String(a.text).slice(0, 80)}”${a.app ? ` in ${a.app}` : ''}${a.site ? ` on ${a.site}` : ''}`,
  }, async (a) => {
    if (!svc) return { content: 'Cues are switched off.', summary: 'off', isError: true };
    const anchors: CueAnchor[] = [];
    if (a.app) anchors.push({ kind: 'app', value: String(a.app), label: String(a.app) });
    if (a.site) anchors.push({ kind: 'site', value: String(a.site), label: String(a.site) });
    if (a.page) anchors.push({ kind: 'page', value: String(a.page) });
    if (a.title) anchors.push({ kind: 'title', value: String(a.title), label: String(a.title) });
    const cue = await svc.create({ text: String(a.text), anchors });
    return { content: JSON.stringify(cueLine(cue)), summary: `Cue “${cue.title}” saved` };
  });
  registerAbility({
    name: 'cues_update', label: 'Tick off or snooze a cue', group: 'Time', defaultPermission: 'ask', network: 'never', readOnly: false,
    description: 'Marks a cue done, ticks a checklist step, or snoozes it (10m, 1h, 3h, tonight, tomorrow, nextweek, nextvisit). Ids come from cues_search.',
    parameters: { type: 'object', properties: { id: { type: 'string' }, action: { type: 'string', enum: ['done', 'reopen', 'snooze', 'tick'] }, snooze: { type: 'string' }, step: { type: 'string', description: 'the step text to tick' } }, required: ['id', 'action'] },
    describe: (a) => `${String(a.action)} a cue`,
  }, async (a) => {
    if (!svc) return { content: 'Cues are switched off.', summary: 'off', isError: true };
    const id = String(a.id);
    let cue: Cue;
    if (a.action === 'done') cue = await svc.complete(id);
    else if (a.action === 'reopen') cue = await svc.reopen(id);
    else if (a.action === 'snooze') cue = await svc.snooze(id, (String(a.snooze ?? '1h')) as never);
    else {
      const step = svc.get(id).items?.find((i) => i.text.toLowerCase().includes(String(a.step ?? '').toLowerCase()));
      if (!step) return { content: 'No such step', summary: 'not found', isError: true };
      cue = await svc.toggleItem(id, step.id);
    }
    return { content: JSON.stringify(cueLine(cue)), summary: 'Done' };
  });
}

/** keeper://cue?text=…&attach=page,app (Shortcuts, scripts, launchers). */
export function handleCueLink(u: URL) {
  const attach = (u.searchParams.get('attach') ?? 'page,app').split(',').filter((k): k is CueAnchor['kind'] => ['app', 'site', 'page', 'title', 'file'].includes(k));
  void compose({ text: u.searchParams.get('text') ?? undefined, attach });
}

export function stopCues() {
  svc?.stop();
  popupWin?.destroy();
}
