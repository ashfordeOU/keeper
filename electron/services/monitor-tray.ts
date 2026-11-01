// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Live readings in the menu bar (macOS) and the notification area / tray
// (Windows, Linux): one item per reading or all in one, as text, a
// sparkline or both, red under strain. Clicking one opens a small pop-over
// with details; its menu has the readings, Health and the tool launcher.
// Readings run only while the items are shown (see monitor-live.ts).

import { BrowserWindow, Menu, nativeImage, nativeTheme, screen, Tray, type NativeImage } from 'electron';
import {
  inkFor, metricText, metricValue, renderIcon, scaleFor, strainOf, toBgra, trayTitle, trayTooltip, TRAY_METRICS,
  type LiveReading, type MonitorSettings, type TrayMetric,
} from '../../core/monitor-tray';
import { featureOn, onFeature } from './features';
import { liveState, onLive, unwatchLive, watchLive } from './monitor-live';
import { monitorSettings, onMonitorSettings } from './monitor-settings';
import { keepUnmanaged, overlayOptions } from './unmanaged';

const isMac = process.platform === 'darwin';
const trays = new Map<string, Tray>();
const tips = new Map<string, string>();
let off: (() => void) | null = null;
let popover: BrowserWindow | null = null;
let lastMenuAt = 0;

export interface TrayDeps {
  preload: string;
  load: (win: BrowserWindow, view: string) => void;
  lockDown: (win: BrowserWindow) => void;
  showMain: (route?: string) => void;
  openLauncher: () => void;
}
let deps: TrayDeps | null = null;

function history(metric: TrayMetric, s: MonitorSettings): (number | undefined)[] {
  return liveState().recent.map((r) => metricValue(metric, r, s.tray));
}

/** The picture for one item (or for the combined item, the first metric's graph). */
export function trayImage(metric: TrayMetric, r: LiveReading | undefined, s: MonitorSettings, opts: { withText?: boolean } = {}): NativeImage {
  const vals = history(metric, s);
  const nums = vals.filter((v): v is number => v !== undefined && Number.isFinite(v));
  const strain = r ? strainOf(metric, r) : 'ok';
  const dark = isMac ? true : nativeTheme.shouldUseDarkColorsForSystemIntegratedUI ?? nativeTheme.shouldUseDarkColors;
  const color = inkFor(strain, isMac ? false : dark, s.tray.strainColor);
  // macOS: a graph beside the text; elsewhere the number is drawn into the picture.
  const text = opts.withText && r ? metricText(metric, r, s.tray).replace(/[↓↑]/g, '').split(' ')[0] : undefined;
  const width = isMac ? (s.tray.style === 'text' ? 2 : 48) : 32;
  const height = isMac ? 36 : 32;
  const bmp = renderIcon({ width, height, values: vals, max: scaleFor(metric, nums), text, color, frame: isMac && s.tray.style !== 'text', graph: s.tray.style !== 'text' });
  const img = nativeImage.createFromBitmap(Buffer.from(toBgra(bmp)), { width, height, scaleFactor: 2 });
  // A black picture with no colour lets macOS draw it to suit a light or dark menu bar.
  if (isMac && !(s.tray.strainColor && strain !== 'ok')) img.setTemplateImage(true);
  return img;
}

function menu(r: LiveReading | undefined, s: MonitorSettings): Menu {
  const lines = TRAY_METRICS.filter((m) => r && metricValue(m.id, r, s.tray) !== undefined).map((m) => ({ label: `${m.label}: ${metricText(m.id, r!, s.tray)}`, enabled: false }));
  return Menu.buildFromTemplate([
    ...(lines.length ? lines : [{ label: 'Reading…', enabled: false }]),
    { type: 'separator' },
    { label: 'Show Details…', click: () => togglePopover() },
    { label: 'Open Health', click: () => deps?.showMain('health') },
    { label: 'History', click: () => deps?.showMain('health:history') },
    { label: 'Processes', click: () => deps?.showMain('health:processes') },
    ...(featureOn('toolLauncher') ? [{ label: 'Tool Launcher…', accelerator: s.launcherShortcut || undefined, click: () => deps?.openLauncher() }] : []),
    { type: 'separator' },
    { label: 'Menu-bar Readings Settings…', click: () => deps?.showMain('health:settings') },
  ]);
}

function update(r: LiveReading) {
  const s = monitorSettings();
  const now = Date.now();
  // Linux keeps the menu open-able only if it is set ahead; refresh its numbers now and then, not every reading.
  const refreshMenu = now - lastMenuAt > (process.platform === 'linux' ? 10_000 : 60_000);
  if (refreshMenu) lastMenuAt = now;
  for (const [key, tray] of trays) {
    if (tray.isDestroyed()) continue;
    const metrics = key === 'combined' ? s.tray.metrics : [key as TrayMetric];
    const first = metrics[0];
    if (isMac) {
      tray.setImage(trayImage(first, r, s));
      tray.setTitle(s.tray.style === 'graph' && key !== 'combined' ? '' : trayTitle(metrics, r, s.tray), { fontType: 'monospacedDigit' });
    } else {
      tray.setImage(trayImage(first, r, s, { withText: s.tray.style !== 'graph' }));
    }
    const tip = key === 'combined' ? trayTooltip(r, s.tray) : `${TRAY_METRICS.find((m) => m.id === key)?.label}: ${metricText(key as TrayMetric, r, s.tray)}`;
    tray.setToolTip(tip);
    tips.set(key, tip);
    // macOS opens the pop-over on click and the menu on right-click; elsewhere the menu is set ahead.
    if (refreshMenu && !isMac) tray.setContextMenu(menu(r, s));
  }
  if (popover && !popover.isDestroyed() && popover.isVisible()) popover.webContents.send('event:sysmon-live', r);
}

function wanted(s: MonitorSettings): string[] {
  if (!featureOn('monitorTray') || !s.surfaces.tray) return [];
  return s.tray.layout === 'combined' ? ['combined'] : [...s.tray.metrics];
}

/** Makes the tray items match the settings: adds, removes and restarts readings. */
export function syncTray() {
  const s = monitorSettings();
  const want = wanted(s);
  for (const [key, tray] of trays) {
    if (!want.includes(key)) {
      tray.destroy();
      trays.delete(key);
      tips.delete(key);
    }
  }
  // macOS places each new item to the left of the last; create in reverse there so they read in order.
  for (const key of isMac ? [...want].reverse() : want) {
    if (trays.has(key)) continue;
    const t = new Tray(nativeImage.createEmpty());
    t.setToolTip('Reading…');
    if (isMac) t.setTitle('…', { fontType: 'monospacedDigit' });
    t.on('click', () => togglePopover(t));
    t.on('right-click', () => t.popUpContextMenu(menu(liveState().latest, monitorSettings())));
    if (!isMac) t.setContextMenu(menu(undefined, s));
    trays.set(key, t);
  }
  if (want.length) {
    watchLive('tray', s.tray.intervalSec * 1000, s.tray.metrics);
    off ??= onLive(update);
    const latest = liveState().latest;
    if (latest) update(latest);
  } else {
    unwatchLive('tray');
    off?.();
    off = null;
    popover?.close();
  }
}

/** Where a pop-over of this size goes: under the clicked item when the system says where it is; else at the cursor. */
export function popoverBounds(anchor: Tray | undefined, w: number, h: number): { x: number; y: number; width: number; height: number } {
  const b = anchor && !anchor.isDestroyed() ? anchor.getBounds() : undefined;
  const pt = b && b.width ? { x: b.x + b.width / 2, y: b.y + b.height } : screen.getCursorScreenPoint();
  const wa = screen.getDisplayNearestPoint(pt).workArea;
  const x = Math.round(Math.min(Math.max(wa.x + 8, pt.x - w / 2), wa.x + wa.width - w - 8));
  const top = pt.y < wa.y + wa.height / 2;
  const y = Math.round(top ? Math.max(wa.y + 4, pt.y + 4) : Math.min(wa.y + wa.height - h - 4, pt.y - h - 4));
  return { x, y, width: w, height: h };
}

/** The small window of details under the menu-bar readings. */
export function togglePopover(anchor?: Tray) {
  if (!deps) return;
  if (popover && !popover.isDestroyed() && popover.isVisible()) {
    popover.hide();
    return;
  }
  const w = 340;
  const h = 460;
  if (!popover || popover.isDestroyed()) {
    popover = new BrowserWindow({
      ...overlayOptions('popover'),
      width: w, height: h, frame: false, resizable: false, show: false, skipTaskbar: true, alwaysOnTop: true, fullscreenable: false, transparent: isMac,
      backgroundColor: isMac ? '#00000000' : nativeTheme.shouldUseDarkColors ? '#1b1b20' : '#fbfbfa', vibrancy: isMac ? 'popover' : undefined,
      webPreferences: { preload: deps.preload, contextIsolation: true, sandbox: true, backgroundThrottling: true },
    });
    keepUnmanaged(popover, 'popover');
    deps.lockDown(popover);
    deps.load(popover, 'sysmon-popover');
    popover.on('blur', () => {
      if (!popover?.webContents.isDevToolsOpened()) popover?.hide();
    });
    popover.on('hide', () => unwatchLive('popover'));
    popover.on('closed', () => {
      unwatchLive('popover');
      popover = null;
    });
  }
  popover.setBounds(popoverBounds(anchor, w, h));
  watchLive('popover', 1000);
  popover.show();
  popover.focus();
}

/** Starts the menu-bar readings when their feature and surface are on. */
export function initMonitorTray(d: TrayDeps) {
  deps = d;
  onFeature('monitorTray', () => syncTray(), { now: true });
  onFeature('health', () => syncTray());
  onMonitorSettings((next, prev) => {
    if (JSON.stringify(next.tray) !== JSON.stringify(prev.tray) || next.surfaces.tray !== prev.surfaces.tray) {
      // A new layout or set of readings: start the items again.
      for (const t of trays.values()) t.destroy();
      trays.clear();
      syncTray();
    }
  });
  nativeTheme.on('updated', () => {
    const latest = liveState().latest;
    if (latest && trays.size) update(latest);
  });
}

/** Pictures of every reading as data URLs, for the settings preview and tests. */
export function trayPreview(): { metric: string; image: string; title: string }[] {
  const s = monitorSettings();
  const r = liveState().latest;
  return s.tray.metrics.map((m) => ({ metric: m, image: trayImage(m, r, s, { withText: !isMac && s.tray.style !== 'graph' }).toDataURL(), title: r ? metricText(m, r, s.tray) : '' }));
}

/** Which items are in the tray right now and what their tooltips say (Settings and tests). */
export function trayState(): { items: string[]; tooltips: string[] } {
  const order = wanted(monitorSettings());
  const keys = [...trays.keys()].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return { items: keys, tooltips: keys.map((k) => tips.get(k) ?? '') };
}
