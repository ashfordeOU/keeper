// SPDX-License-Identifier: AGPL-3.0-or-later
// Measures what the Island has to fit around: the Mac's notch and menu-bar
// items, the Linux desktop, whether this is a laptop. Read once at start and
// again when screens change, never on a timer.

import { app, screen } from 'electron';
import { existsSync, promises as fsp, readdirSync } from 'node:fs';
import { chooseDisplays, desktopOf, needsXWayland, place, type DisplayChoice, type DisplayInfo, type PlaceEnv, type PlaceOptions, type Placement, type Rect } from '../../core/island-place';
import { cameraUsers, parseConsentStore } from '../../core/island-activities';
import { run } from '../../core/platform';
import { settings } from '../store';

let env: PlaceEnv = {
  platform: process.platform,
  desktop: process.platform === 'linux' ? desktopOf(process.env.XDG_CURRENT_DESKTOP) : undefined,
  hasBattery: hasBattery(),
};

function hasBattery(): boolean {
  if (process.platform !== 'linux') return false;
  try {
    return readdirSync('/sys/class/power_supply').some((n) => /^BAT/i.test(n));
  } catch {
    return false;
  }
}

/**
 * macOS: the notch (from NSScreen's safe area and the two "auxiliary" areas
 * beside it, macOS 12+) and the frames of menu-bar status items (window layer
 * 25; frames need no permission). One short JavaScript-for-Automation run.
 */
const MAC_SCRIPT = `
ObjC.import('AppKit'); ObjC.import('CoreGraphics');
var out = { screens: [], items: [] };
var list = $.NSScreen.screens;
for (var i = 0; i < list.count; i++) {
  var s = list.objectAtIndex(i), f = s.frame, top = 0, l = null, r = null;
  try { top = s.safeAreaInsets.top; } catch (e) {}
  try { l = s.auxiliaryTopLeftArea; r = s.auxiliaryTopRightArea; } catch (e) {}
  var id = ObjC.unwrap(s.deviceDescription.objectForKey('NSScreenNumber'));
  var notch = null;
  if (top > 0 && l && r && l.size && r.size && l.size.width > 0) notch = { x: l.origin.x + l.size.width, width: r.origin.x - (l.origin.x + l.size.width), height: top };
  out.screens.push({ id: id, x: f.origin.x, width: f.size.width, notch: notch });
}
var wins = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly, 0))) || [];
for (var j = 0; j < wins.length; j++) { var w = wins[j]; if (w.kCGWindowLayer === 25 && w.kCGWindowBounds) out.items.push(w.kCGWindowBounds); }
JSON.stringify(out);`;

interface MacScreens {
  screens: { id: number; x: number; width: number; notch: { x: number; width: number; height: number } | null }[];
  items: { X: number; Y: number; Width: number; Height: number }[];
}

async function readMac(): Promise<Partial<PlaceEnv>> {
  const out: Partial<PlaceEnv> = {};
  const model = await run('/usr/sbin/sysctl', ['-n', 'hw.model'], 3000);
  if (model.ok) out.macModel = model.stdout.trim();
  const r = await run('/usr/bin/osascript', ['-l', 'JavaScript', '-e', MAC_SCRIPT], 6000);
  if (r.ok) {
    try {
      const m = JSON.parse(r.stdout.trim()) as MacScreens;
      out.notchRects = {};
      for (const s of m.screens) if (s.notch && s.notch.width > 0) out.notchRects[s.id] = { x: s.notch.x, y: 0, width: s.notch.width, height: s.notch.height };
      // Keeper's own Island windows sit on layer 25 too; leave them out.
      out.menuBarItems = m.items.filter((b) => b.Height <= 40 && b.Width < 600).map((b): Rect => ({ x: b.X, y: b.Y, width: b.Width, height: b.Height }));
    } catch {
      /* older macOS: the model table and menu-bar height are enough */
    }
  }
  return out;
}

let usingXWayland = false;

/**
 * Wayland does not let ordinary windows choose where they go or stay on top,
 * so with the Island on, Keeper runs through XWayland (Settings can turn this
 * off). Must be called before the app is ready.
 */
export function applyWaylandSwitch() {
  const s = settings().island;
  if (!s.enabled || s.x11OnWayland === false || !needsXWayland(process.env, process.platform)) return;
  if (app.commandLine.hasSwitch('ozone-platform')) return;
  app.commandLine.appendSwitch('ozone-platform', 'x11');
  usingXWayland = true;
}

let refreshing: Promise<void> | null = null;

/** Re-reads what depends on the hardware and the menu bar (start, screens changed, wake). */
export function refreshPlaceEnv(): Promise<void> {
  refreshing ??= (async () => {
    const extra = process.platform === 'darwin' ? await readMac().catch(() => ({})) : {};
    // Menu-bar items include the Island's own windows; those are filtered by width above,
    // and the Island in the menu bar never measures itself because it is placed after this.
    env = { ...env, ...extra, hasBattery: hasBattery() };
  })().finally(() => (refreshing = null));
  return refreshing;
}

export function placeEnv(): PlaceEnv {
  return env;
}

export function displayInfo(d: Electron.Display): DisplayInfo {
  const rot = [0, 90, 180, 270].includes(d.rotation) ? (d.rotation as DisplayInfo['rotation']) : 0;
  return {
    id: d.id, bounds: d.bounds, workArea: d.workArea, scaleFactor: d.scaleFactor, internal: !!d.internal,
    rotation: rot, touch: d.touchSupport === 'available', primary: d.id === screen.getPrimaryDisplay().id,
  };
}

export function placeOptions(): Partial<PlaceOptions> {
  const s = settings().island;
  return {
    edge: s.edge, size: s.size ?? 'normal', blendNotch: s.blendNotch ?? true, cameraEdge: s.cameraEdge ?? 'auto',
    followCamera: s.followCamera ?? true, offsetX: s.offsetX ?? 0, offsetY: s.offsetY ?? 0,
  };
}

export function placementFor(d: Electron.Display): Placement {
  return place(displayInfo(d), env, placeOptions());
}

export function wantedDisplays(): Electron.Display[] {
  const all = screen.getAllDisplays();
  const choice = (settings().island.displays ?? 'primary') as DisplayChoice;
  const cursor = choice === 'mouse' ? screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id : undefined;
  return chooseDisplays(all.map((d) => ({ ...d, internal: !!d.internal })), choice, screen.getPrimaryDisplay().id, cursor)
    .map((x) => all.find((d) => d.id === x.id)!)
    .filter(Boolean);
}

/** Everything Settings needs to draw the screen preview. */
export function placementPreview() {
  const primary = screen.getPrimaryDisplay().id;
  return {
    platform: env.platform, desktop: env.desktop, macModel: env.macModel, wayland: process.env.XDG_SESSION_TYPE === 'wayland',
    xwayland: usingXWayland,
    displays: screen.getAllDisplays().map((d) => ({ info: displayInfo(d), placement: placementFor(d), primary: d.id === primary, label: d.label || '' })),
    wanted: wantedDisplays().map((d) => d.id),
  };
}

// ---------------------------------------------------------------- camera in use

/**
 * Apps using a camera right now. Windows: the consent store (one `reg` call).
 * Linux: the webcam driver's reference count (one small file) and, only when
 * it says a camera is open, which process has /dev/video* open. macOS shows
 * its own green light and offers no way to ask, so nothing is reported there.
 */
export async function cameraInUse(): Promise<string[]> {
  if (process.platform === 'win32') {
    const r = await run('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\webcam', '/s'], 5000);
    return r.ok ? parseConsentStore(r.stdout) : [];
  }
  if (process.platform === 'linux') {
    const ref = '/sys/module/uvcvideo/refcnt';
    if (!existsSync(ref)) return [];
    const n = Number((await fsp.readFile(ref, 'utf8').catch(() => '0')).trim());
    if (!n) return [];
    return cameraUsers(await videoFds());
  }
  return [];
}

async function videoFds(): Promise<{ pid: number; name: string; target: string }[]> {
  const out: { pid: number; name: string; target: string }[] = [];
  const uid = process.getuid?.();
  for (const p of await fsp.readdir('/proc').catch(() => [] as string[])) {
    if (!/^\d+$/.test(p)) continue;
    try {
      if (uid !== undefined && (await fsp.stat(`/proc/${p}`)).uid !== uid) continue;
      for (const fd of await fsp.readdir(`/proc/${p}/fd`)) {
        const target = await fsp.readlink(`/proc/${p}/fd/${fd}`).catch(() => '');
        if (target.startsWith('/dev/video')) {
          out.push({ pid: +p, name: (await fsp.readFile(`/proc/${p}/comm`, 'utf8')).trim(), target });
          break;
        }
      }
    } catch {
      /* the process ended, or is not ours */
    }
  }
  return out;
}
