// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Menu bar icons (macOS): a divider of Keeper's own in the menu bar. While it
// is hiding, its title grows as wide as the screen, so every icon left of it
// is pushed out of sight; a click shows them again (and hides them after a
// while), a right-click lists the hidden ones to open. Icons move across the
// divider by a ⌘-drag, the same way people move them by hand. All public:
//
//   which icons there are   CGWindowListCopyWindowInfo (status windows, layer 25),
//                           through JavaScript for Automation's ObjC bridge
//   opening one             System Events: the app's second menu bar, AXPress
//   moving one              CGEvent mouse events with ⌘ held (Accessibility)
//
// Windows and Linux get an honest line (and on Windows the system's own
// setting); nothing runs there. Nothing runs on a Mac either while the part is
// off: no divider, no timers.

import { app, Menu, nativeImage, screen, shell, systemPreferences, Tray } from 'electron';
import os from 'node:os';
import type { MenuBarApi, MenuBarStatus } from '../../core/api-menubar';
import { changedIcons, dividerBitmap, dividerTitle, dragPlan, menuBarAvailability, normalizeMenuBarItems, parseStatusWindows, splitByDivider, type MenuBarIcon, type StatusWindowRow } from '../../core/menubar-items';
import { run } from '../../core/platform';
import { settings, updateSettings } from '../store';
import { featureOn, onFeature } from './features';
import { permissionNeeded } from './permission-nudge';

const isMac = process.platform === 'darwin';
/** Darwin 20–24 are macOS 11–15; Darwin 25 is macOS 26. */
const macMajor = () => { if (!isMac) return 0; const d = Number(os.release().split('.')[0]); return d >= 25 ? d + 1 : d - 9; };
let showRoute: (route: string) => void = () => undefined;

let divider: Tray | null = null;
/** the icons are shown for a moment (a click on the divider, or a change) */
let peeking = false;
let peekTimer: NodeJS.Timeout | undefined;
let pollTimer: NodeJS.Timeout | undefined;
let last: MenuBarIcon[] = [];
let changed = false;

const conf = () => normalizeMenuBarItems(settings().menuBarItems);

function availability() {
  return menuBarAvailability({ platform: process.platform, macMajor: macMajor(), accessibility: isMac ? systemPreferences.isTrustedAccessibilityClient(false) : undefined });
}

async function jxa(script: string, timeout = 6000): Promise<string> {
  const r = await run('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script], timeout);
  if (!r.ok) {
    if (/not allowed|1002|-1719|assistive/i.test(r.stderr ?? '')) {
      permissionNeeded('accessibility', 'menuBarItems');
      throw new Error('Allow Keeper in System Settings → Privacy & Security → Accessibility.');
    }
    throw new Error((r.stderr || 'The menu bar did not answer').split('\n')[0]);
  }
  return r.stdout.trim();
}

/** Every status window, as rows (CGWindowList through the ObjC bridge; no permission needed for owners and places). */
async function icons(): Promise<MenuBarIcon[]> {
  if (!isMac) return [];
  const out = await jxa(`ObjC.import('CoreGraphics');const a=ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(0,0)))||[];JSON.stringify(a.filter(d=>d.kCGWindowLayer===25).map(d=>({owner:d.kCGWindowOwnerName||'',pid:d.kCGWindowOwnerPID,number:d.kCGWindowNumber,layer:d.kCGWindowLayer,x:d.kCGWindowBounds.X,y:d.kCGWindowBounds.Y,width:d.kCGWindowBounds.Width,height:d.kCGWindowBounds.Height})))`);
  return parseStatusWindows(JSON.parse(out || '[]') as StatusWindowRow[], [process.pid]);
}

function dividerBounds(): { x: number; width: number } | undefined {
  if (!divider) return undefined;
  const b = divider.getBounds();
  return b.width ? { x: b.x, width: b.width } : undefined;
}

function screenWidth() {
  return Math.max(...screen.getAllDisplays().map((d) => d.bounds.width), 1440);
}

/** The divider's look: wide while hiding (and not peeking), a dot when a hidden icon changed. */
function paint() {
  if (!divider) return;
  const hiding = conf().hiding && !peeking;
  divider.setTitle(dividerTitle(hiding, changed, screenWidth()));
  divider.setToolTip(hiding ? 'Hidden menu bar icons: click to show them' : 'Keeper’s divider: icons to its left can be hidden');
}

function peek(on: boolean) {
  clearTimeout(peekTimer);
  peeking = on;
  if (on) changed = false;
  paint();
  const secs = conf().autoHideSeconds;
  if (on && conf().hiding && secs > 0) peekTimer = setTimeout(() => peek(false), secs * 1000);
}

async function drawer() {
  if (!divider) return;
  let hidden: MenuBarIcon[] = [];
  try { hidden = splitByDivider(await icons(), dividerBounds()?.x).hidden; } catch { /* no list: the menu still offers the basics */ }
  const menu = Menu.buildFromTemplate([
    ...(hidden.length ? hidden.map((i) => ({ label: i.app, click: () => void press(i.id) })) : [{ label: 'No hidden icons', enabled: false }]),
    { type: 'separator' },
    { label: peeking || !conf().hiding ? 'Hide them' : 'Show them', click: () => peek(!(peeking || !conf().hiding)) },
    { label: 'Menu bar icons settings…', click: () => showRoute('settings:menubar') },
  ]);
  divider.popUpContextMenu(menu);
}

/** Opens one icon's menu: shows the hidden ones first, then presses it through Accessibility. */
async function press(id: string): Promise<boolean> {
  if (!isMac) return false;
  const pid = Number(id.split(':')[0]);
  if (!Number.isInteger(pid)) return false;
  peek(true);
  await new Promise((r) => setTimeout(r, 350));
  const icon = (await icons()).find((i) => i.id === id);
  // The app's second menu bar holds its status items; the one nearest the icon's place is pressed.
  const x = icon ? icon.x + icon.width / 2 : -1;
  const r = await jxa(`const se=Application('System Events');const p=se.processes.whose({unixId:${pid}})[0];const items=p.menuBars[1].menuBarItems();let best=null,bd=1e9;for(const it of items){const q=it.position()[0]+it.size()[0]/2;const d=Math.abs(q-(${x}));if(${x}<0||d<bd){bd=d;best=it}}if(best){best.actions['AXPress'].perform();'true'}else{'false'}`);
  return r === 'true';
}

/** Moves an icon across the divider with a ⌘-drag, then puts the pointer back. */
async function move(id: string, to: 'hide' | 'show'): Promise<{ ok: boolean; message?: string }> {
  if (!isMac || !divider) return { ok: false, message: 'Only on a Mac.' };
  if (!systemPreferences.isTrustedAccessibilityClient(false)) {
    permissionNeeded('accessibility', 'menuBarItems');
    return { ok: false, message: 'Moving icons needs Accessibility: System Settings → Privacy & Security → Accessibility → Keeper.' };
  }
  const wasPeeking = peeking;
  peek(true);
  await new Promise((r) => setTimeout(r, 400));
  const now = await icons();
  const icon = now.find((i) => i.id === id);
  const div = dividerBounds();
  if (!icon || !div) return { ok: false, message: 'That icon is not in the menu bar now.' };
  if (icon.system) return { ok: false, message: 'macOS keeps this one where it is.' };
  const top = screen.getPrimaryDisplay().bounds.y;
  const plan = dragPlan(icon, div, to, top + Math.round((screen.getPrimaryDisplay().workArea.y - top) / 2 || 12));
  const steps = 8;
  const path = Array.from({ length: steps }, (_, i) => ({ x: Math.round(plan.from.x + ((plan.to.x - plan.from.x) * (i + 1)) / steps), y: plan.to.y }));
  // kCGEventLeftMouseDown 1, LeftMouseDragged 6, LeftMouseUp 2, MouseMoved 5; ⌘ is flag bit 20; posted at the HID tap (0).
  await jxa(`ObjC.import('CoreGraphics');const cmd=0x100000;const here=$.CGEventGetLocation($.CGEventCreate($()));function ev(t,x,y,f){const e=$.CGEventCreateMouseEvent($(),t,{x:x,y:y},0);$.CGEventSetFlags(e,f);$.CGEventPost(0,e);delay(0.02)}ev(5,${plan.from.x},${plan.from.y},0);ev(1,${plan.from.x},${plan.from.y},cmd);${path.map((p) => `ev(6,${p.x},${p.y},cmd);`).join('')}ev(2,${plan.to.x},${plan.to.y},cmd);ev(5,here.x,here.y,0);'ok'`, 8000);
  await new Promise((r) => setTimeout(r, 300));
  if (!wasPeeking && to === 'hide') peek(false);
  const after = splitByDivider(await icons(), dividerBounds()?.x);
  const ok = (to === 'hide' ? after.hidden : after.shown).some((i) => i.id === id);
  return ok ? { ok } : { ok, message: 'The icon did not move. Try ⌘-dragging it past Keeper’s divider by hand.' };
}

async function status(): Promise<MenuBarStatus> {
  const a = availability();
  let list: MenuBarIcon[] = [];
  let note: string | undefined;
  if (isMac && featureOn('menuBarItems')) {
    try { list = await icons(); } catch (e) { note = e instanceof Error ? e.message : String(e); }
  }
  const { shown, hidden } = splitByDivider(list, dividerBounds()?.x);
  return { availability: a, shown, hidden, hiding: conf().hiding, peeking, divider: !!divider, note };
}

// ---------------------------------------------------------------- the divider and its watch

function startPoll() {
  clearInterval(pollTimer);
  if (!divider || !conf().showOnChange) return;
  // Only while hiding, and only to notice a hidden icon change (a badge, a timer): every 5 seconds.
  pollTimer = setInterval(() => {
    if (!conf().hiding || peeking) return;
    void icons().then((next) => {
      const hiddenNow = splitByDivider(next, dividerBounds()?.x).hidden;
      const was = splitByDivider(last, dividerBounds()?.x).hidden;
      if (last.length && changedIcons(was, hiddenNow).length) { changed = true; peek(true); }
      last = next;
    }).catch(() => undefined);
  }, 5000);
}

function startDivider() {
  if (!isMac || divider) return;
  const bmp = dividerBitmap(2);
  const img = nativeImage.createFromBitmap(Buffer.from(bmp.data), { width: bmp.width, height: bmp.height, scaleFactor: 2 });
  img.setTemplateImage(true);
  divider = new Tray(img);
  divider.setIgnoreDoubleClickEvents(true);
  divider.on('click', () => peek(!(peeking || !conf().hiding)));
  divider.on('right-click', () => void drawer());
  paint();
  startPoll();
}

function stopDivider() {
  clearTimeout(peekTimer);
  clearInterval(pollTimer);
  divider?.destroy();
  divider = null;
  peeking = false;
  changed = false;
  last = [];
}

/** Settings changed: hiding, the auto-hide time or watching for changes. */
export function menuBarSettingsChanged() {
  if (!divider) return;
  paint();
  startPoll();
}

/** show: opens a page of Keeper's main window (main.ts showMain). */
export function startMenuBarItems(show: (route: string) => void) {
  showRoute = show;
  onFeature('menuBarItems', (on) => (on && isMac ? startDivider() : stopDivider()), { now: true });
  app.on('before-quit', stopDivider);
}

export const menuBarApi: MenuBarApi = {
  status,
  setHiding: async (on: boolean) => {
    await updateSettings({ menuBarItems: { ...conf(), hiding: !!on } });
    peeking = false;
    paint();
    return status();
  },
  peek: async () => { peek(true); return status(); },
  press: (id: string) => press(String(id)),
  move: (id: string, to: 'hide' | 'show') => move(String(id), to === 'show' ? 'show' : 'hide'),
  openSettings: async () => {
    if (isMac) await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
    else if (process.platform === 'win32') await shell.openExternal('ms-settings:taskbar');
  },
};
