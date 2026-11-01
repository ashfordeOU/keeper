// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Wallpaper, vibes, ambient sound and folder icons in the main process:
// IPC (window.keeper.ambience), the schedule, the floating sound mixer, the
// tray menu, global shortcuts, AI abilities and `keeper ambience`.
//
// Cost when off: nothing. No windows, no timers. The schedule runs one check a
// minute through the governor only while it has rules; the sleep timer is one
// timeout; the full-screen check runs only while a wallpaper window is open.

import { app, BrowserWindow, dialog, globalShortcut, ipcMain, nativeImage, powerMonitor, screen, type MenuItemConstructorOptions } from 'electron';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { registerAbility } from '../../../core/abilities/registry';
import { audible, describeMix, normalizeMix, SLEEP_CHOICES, SOUNDS, type SoundMix } from '../../../core/scenes/ambient';
import type { AmbienceState } from '../../../core/scenes/api';
import { clampParams, describeSource, normalizeSource, paletteById, PALETTES, sceneById, sceneSource, SCENES, surprise as surpriseSource } from '../../../core/scenes/catalog';
import { pngsToIco, upsertRecord, type FolderIconRecord, type FolderIconSpec } from '../../../core/scenes/folder-icons';
import { stillRefreshMs } from '../../../core/scenes/policy';
import type { NamedPalette, WallpaperSource } from '../../../core/scenes/types';
import { themeById } from '../../../core/themes';
import { applyVibeSound, applyVibeWallpaper, describeRule, newId, normalizeVibe, scheduledVibe, scheduleStep, STARTER_VIBES, stepVibe, wallpaperFor, type AmbienceSettings, type ScheduleContext, type Vibe, type VibeRule } from '../../../core/vibes';
import { replaceWidgets, setArranging, setWidgetTint } from '../../ipc/widgets';
import { registerKeeperMethod } from '../brain';
import { featureOn, onFeature } from '../features';
import { poll } from '../governor';
import { allowRoot } from '../preview';
import { settings, updateSettings } from '../../store';
import { applyFolderIcon, folderIconsHow, getDesktopPicture, lockScreenNote, restoreFolderIcon, setDesktopPicture } from './desktop';
import { ambience, onAmbience, updateAmbience } from './store';
import { captureStill, initWallpaperWindows, liveInfo, measureCost, setUserPaused, stopWallpaper, strategyHere, strategyNote, syncWallpaper, wallpaperPaused } from './windows';

export interface AmbienceDeps {
  preload: string;
  lockDown(win: BrowserWindow): void;
  broadcast(channel: string, ...args: unknown[]): void;
  /** opens the main window on a route */
  show(route?: string): void;
  updateTray(): void;
  alert(title: string, detail?: string): void;
  /** Keeper's focus timer */
  startFocus(minutes: number): void;
  focusActive(): boolean;
  battery(): { percent: number; charging: boolean } | null;
}

let deps: AmbienceDeps;
const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const dataDir = () => path.join(app.getPath('userData'), 'wallpaper');
const iconDir = () => path.join(app.getPath('userData'), 'folder-icons');

function load(win: BrowserWindow, query: Record<string, string>) {
  if (DEV_URL) void win.loadURL(`${DEV_URL}?${new URLSearchParams(query)}`);
  else void win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { query });
}

// ---------------------------------------------------------------- state

function state(): AmbienceState {
  const a = ambience();
  const strategy = strategyHere();
  const sched = scheduledVibe(a.schedule, scheduleContext());
  return {
    settings: a,
    displays: screen.getAllDisplays().map((d, i) => ({
      id: String(d.id),
      label: d.label || (d.id === screen.getPrimaryDisplay().id ? 'Main display' : `Display ${i + 1}`),
      primary: d.id === screen.getPrimaryDisplay().id,
      width: d.size.width,
      height: d.size.height,
      scaleFactor: d.scaleFactor,
      source: wallpaperFor(a.wallpaper, d.id),
      live: liveInfo(String(d.id)),
    })),
    strategy,
    strategyNote: strategyNote(strategy),
    scheduled: { vibe: a.schedule.enabled ? sched.vibe : null, rule: a.schedule.enabled && sched.rule ? describeRule(sched.rule, a.vibes) : null },
    features: { wallpaper: featureOn('wallpaper'), vibes: featureOn('vibes'), ambientSound: featureOn('ambientSound'), folderIcons: featureOn('folderIcons') },
    caps: { live: strategy === 'desktop-window' || strategy === 'workerw', still: true, folderIcons: true, folderIconsHow: folderIconsHow(), lockScreen: lockScreenNote() },
    platform: process.platform,
  };
}

let changedTimer: NodeJS.Timeout | undefined;
function changed() {
  // Several changes in a row (a vibe switch) make one update.
  clearTimeout(changedTimer);
  changedTimer = setTimeout(() => {
    deps.broadcast('ambience-changed');
    deps.updateTray();
  }, 30);
}

// ---------------------------------------------------------------- wallpaper

function tintFrom(src: WallpaperSource) {
  setWidgetTint(src.kind === 'scene' ? paletteById(src.palette, ambience().palettes).colors[2] : null);
}

let stillStop: (() => void) | null = null;
let stillBusy = false;

/** Sets the desktop picture from a still frame of the main display's wallpaper. */
async function setStill(): Promise<{ ok: boolean; path?: string; how?: string; error?: string }> {
  if (stillBusy) return { ok: false, error: 'Already making a picture' };
  stillBusy = true;
  try {
    const a = ambience();
    const src = wallpaperFor(a.wallpaper, screen.getPrimaryDisplay().id);
    if (src.kind === 'none') return { ok: false, error: 'Choose a wallpaper first' };
    if (!a.previousDesktop) {
      const prev = await getDesktopPicture();
      if (prev) await updateAmbience({ previousDesktop: { platform: process.platform, value: prev } });
    }
    const file = await captureStill(src, dataDir());
    const r = await setDesktopPicture(file);
    return { ...r, path: file };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    stillBusy = false;
  }
}

/** Still-frame mode (Wayland, or chosen): keep the desktop picture fresh now and then, through the governor. */
function syncStillMode() {
  const a = ambience();
  const wantStill = featureOn('wallpaper') && a.wallpaper.enabled && !wallpaperPaused() && (strategyHere() === 'still' || a.wallpaper.matchDesktopPicture);
  stillStop?.();
  stillStop = null;
  if (!wantStill) return;
  const src = wallpaperFor(a.wallpaper, screen.getPrimaryDisplay().id);
  const every = stillRefreshMs(src);
  // A pause after the last change first (dragging a slider is many changes), then now and then.
  clearTimeout(stillSoon);
  stillSoon = setTimeout(() => void setStill(), 3000);
  const stop = poll('wallpaper-still', { baseMs: every ?? 6 * 3600_000, pauseWhenLocked: true, idleFactor: 2 }, () => setStill(), { feature: 'wallpaper', now: false });
  stillStop = () => { clearTimeout(stillSoon); stop(); };
}
let stillSoon: NodeJS.Timeout | undefined;

let fallbackShown = false;
function fallbackToStill(reason: string) {
  if (fallbackShown) return;
  fallbackShown = true;
  deps.alert('Live wallpaper fell back to a still picture', reason);
  void setStill();
}

async function setWallpaper(display: string, source: WallpaperSource) {
  const src = normalizeSource(source);
  await updateAmbience((a) => ({
    wallpaper: display === 'all' ? { ...a.wallpaper, default: src, perDisplay: {} } : { ...a.wallpaper, perDisplay: { ...a.wallpaper.perDisplay, [display]: src } },
  }));
}

// ---------------------------------------------------------------- vibes

async function applyVibe(id: string, how: 'manual' | 'schedule' = 'manual') {
  const v = ambience().vibes.find((x) => x.id === id);
  if (!v) throw new Error(`No vibe “${id}”`);
  await updateAmbience((a) => ({
    activeVibe: v.id,
    wallpaper: applyVibeWallpaper(a.wallpaper, v),
    sound: featureOn('ambientSound') ? applyVibeSound(a.sound, v) : a.sound,
  }));
  const patch: Record<string, unknown> = {};
  if (v.theme) Object.assign(patch, { theme: themeById(v.theme).id, look: v.theme === 'minimal' ? 'minimal' : 'playful', themeSeasons: false });
  if (v.appearance) patch.appearance = v.appearance;
  if (Object.keys(patch).length) await updateSettings(patch);
  if (v.widgets && featureOn('widgets')) await replaceWidgets(v.widgets);
  if (v.focusMinutes) deps.startFocus(v.focusMinutes);
  if (how === 'schedule') deps.alert(`${v.emoji} ${v.name}`, 'Switched by your schedule');
  return state();
}

/** A vibe from what is on screen and playing now. */
async function captureVibe(name: string, emoji = '✨') {
  const a = ambience();
  const s = settings();
  const v: Vibe = {
    id: newId('v'), name: name.trim() || 'My vibe', emoji, wallpaper: a.wallpaper.default,
    perDisplay: Object.keys(a.wallpaper.perDisplay).length ? { ...a.wallpaper.perDisplay } : undefined,
    theme: s.theme || null, appearance: s.appearance ?? null,
    sound: { playing: a.sound.playing, mix: { ...a.sound.mix }, master: a.sound.master },
    widgets: structuredClone(s.widgets ?? []), focusMinutes: null,
  };
  await updateAmbience((x) => ({ vibes: [...x.vibes, v], activeVibe: v.id }));
  return state();
}

// ---------------------------------------------------------------- schedule

function scheduleContext(): ScheduleContext {
  const a = ambience();
  const place = a.schedule.location ?? (settings().island?.place ? { lat: settings().island.place!.lat, lon: settings().island.place!.lon } : null);
  const b = deps?.battery?.() ?? null;
  let onBattery = false;
  try { onBattery = powerMonitor.isOnBatteryPower(); } catch { /* not ready */ }
  return { now: Date.now(), place, manualSun: a.schedule.manualSun, onBattery, batteryPercent: b?.percent ?? null, focusActive: deps?.focusActive?.() ?? false };
}

let lastKey: string | null = null;
let stopSchedule: (() => void) | null = null;

function checkSchedule() {
  const a = ambience();
  const step = scheduleStep(a.schedule, scheduleContext(), lastKey);
  lastKey = step.key;
  if (step.switchTo && step.switchTo !== a.activeVibe) void applyVibe(step.switchTo, 'schedule').catch(() => undefined);
}

function syncSchedule() {
  const a = ambience();
  const want = featureOn('vibes') && a.schedule.enabled && a.schedule.rules.some((r) => r.enabled);
  if (!want) { stopSchedule?.(); stopSchedule = null; return; }
  // One look a minute (slower while away); rule boundaries are minute-precise.
  stopSchedule ??= poll('vibes-schedule', { baseMs: 60_000, idleFactor: 2, maxMs: 5 * 60_000 }, checkSchedule, { feature: 'vibes' });
}

// ---------------------------------------------------------------- sound (the floating mixer)

let mixer: BrowserWindow | null = null;
let sleepTimer: NodeJS.Timeout | undefined;

function ensureMixer(show: boolean) {
  if (!mixer || mixer.isDestroyed()) {
    mixer = new BrowserWindow({
      width: 360, height: 540, frame: false, transparent: true, resizable: false, show: false, skipTaskbar: true, alwaysOnTop: true,
      fullscreenable: false, minimizable: false, maximizable: false, hasShadow: true, backgroundColor: '#00000000', title: 'Ambient sound',
      // Sound keeps playing while the panel is hidden.
      webPreferences: { preload: deps.preload, contextIsolation: true, sandbox: true, backgroundThrottling: false },
    });
    mixer.setAlwaysOnTop(true, 'floating');
    mixer.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    deps.lockDown(mixer);
    load(mixer, { view: 'ambient' });
    const win = mixer;
    // A window destroyed earlier may report "closed" after a new one exists: only forget this one.
    win.on('closed', () => { if (mixer === win) mixer = null; });
    win.on('blur', () => { if (mixer === win && !win.isDestroyed() && !win.webContents.isDevToolsOpened()) win.hide(); maybeDropMixer(); });
  }
  if (show) {
    const p = screen.getCursorScreenPoint();
    const wa = screen.getDisplayNearestPoint(p).workArea;
    const [w, h] = mixer.getSize();
    mixer.setPosition(Math.round(Math.min(Math.max(wa.x + 8, p.x - w / 2), wa.x + wa.width - w - 8)), Math.round(Math.min(Math.max(wa.y + 8, p.y + 12), wa.y + wa.height - h - 8)));
    if (mixer.webContents.isLoading()) mixer.once('ready-to-show', () => mixer?.show());
    else mixer.show();
  }
}

/** Nothing to hear and nothing to show: the panel (and its audio) goes away entirely. */
function maybeDropMixer() {
  if (!mixer || mixer.isDestroyed() || mixer.isVisible()) return;
  if (!audible(ambience().sound) || !featureOn('ambientSound')) { mixer.destroy(); mixer = null; }
}

function syncSound() {
  const s = ambience().sound;
  clearTimeout(sleepTimer);
  if (!featureOn('ambientSound')) { mixer?.destroy(); mixer = null; return; }
  if (audible(s)) ensureMixer(false);
  else maybeDropMixer();
  if (s.playing && s.sleepAt) {
    const left = s.sleepAt - Date.now();
    sleepTimer = setTimeout(() => void updateAmbience((a) => ({ sound: { ...a.sound, playing: false, sleepAt: null } })), Math.max(0, left));
    sleepTimer.unref?.();
  }
}

// ---------------------------------------------------------------- folder icons

async function applyIcons(folders: string[], spec: FolderIconSpec, png: string) {
  const m = /^data:image\/png;base64,(.+)$/.exec(png);
  if (!m) throw new Error('The icon picture is missing');
  const bytes = Buffer.from(m[1], 'base64');
  await fsp.mkdir(iconDir(), { recursive: true });
  const id = `icon-${Date.now().toString(36)}`;
  const pngFile = path.join(iconDir(), `${id}.png`);
  const icoFile = path.join(iconDir(), `${id}.ico`);
  await fsp.writeFile(pngFile, bytes);
  // Windows wants an .ico: 256 (PNG inside) plus smaller sizes made from it.
  const img = nativeImage.createFromBuffer(bytes);
  const sizes = [256, 48, 32, 16].map((n) => ({ size: n, png: new Uint8Array(img.resize({ width: n, height: n, quality: 'best' }).toPNG()) }));
  await fsp.writeFile(icoFile, pngsToIco(sizes));
  const done: string[] = [];
  const failed: { folder: string; error: string }[] = [];
  let records = ambience().folderIcons;
  for (const folder of folders) {
    const r = await applyFolderIcon(folder, pngFile, icoFile);
    if (!r.ok) { failed.push({ folder, error: r.error ?? 'Failed' }); continue; }
    done.push(folder);
    const rec: FolderIconRecord = { folder, appliedAt: Date.now(), spec: { pattern: spec.pattern, color: spec.color, color2: spec.color2, symbol: spec.symbol, hasImage: !!spec.image }, iconFile: process.platform === 'win32' ? icoFile : pngFile, platform: process.platform, previous: r.previous };
    records = upsertRecord(records, rec);
  }
  await updateAmbience({ folderIcons: records });
  return { done, failed };
}

async function restoreIcons(folders: string[]) {
  const done: string[] = [];
  const failed: { folder: string; error: string }[] = [];
  let records = ambience().folderIcons;
  for (const folder of folders) {
    const rec = records.find((r) => r.folder === folder);
    if (!rec) { failed.push({ folder, error: 'Keeper did not change this folder' }); continue; }
    const r = await restoreFolderIcon(rec);
    if (!r.ok) { failed.push({ folder, error: r.error ?? 'Failed' }); continue; }
    done.push(folder);
    records = records.filter((x) => x.folder !== folder);
  }
  await updateAmbience({ folderIcons: records });
  return { done, failed };
}

// ---------------------------------------------------------------- IPC

function registerIpc() {
  const h = (name: string, fn: (...args: never[]) => unknown) => ipcMain.handle(`ambience.${name}`, (_e, ...args) => fn(...(args as never[])));
  h('state', () => state());
  h('set', async (patch: Partial<AmbienceSettings>) => { await updateAmbience(patch); return state(); });
  h('setWallpaper', async (display: string, src: WallpaperSource) => { await setWallpaper(display, src); return state(); });
  h('setPlaying', async (on: boolean) => {
    if (on && !featureOn('wallpaper')) {
      const { setFeature } = await import('../features');
      await setFeature('wallpaper', true);
    }
    if (ambience().wallpaper.enabled !== on) await updateAmbience((a) => ({ wallpaper: { ...a.wallpaper, enabled: on } }));
    setUserPaused(false);
    syncWallpaper();
    syncStillMode();
    return state();
  });
  h('surprise', async () => { const a = ambience(); await setWallpaper('all', surpriseSource(Math.random, a.wallpaper.default, a.palettes)); return state(); });
  h('applyVibe', (id: string) => applyVibe(id));
  h('stepVibe', async (dir: 1 | -1) => { const v = stepVibe(ambience().vibes, ambience().activeVibe, dir === -1 ? -1 : 1); return v ? applyVibe(v.id) : state(); });
  h('saveVibe', async (v: Vibe) => {
    const n = normalizeVibe(v);
    if (!n) throw new Error('That vibe is not complete');
    await updateAmbience((a) => ({ vibes: a.vibes.some((x) => x.id === n.id) ? a.vibes.map((x) => (x.id === n.id ? n : x)) : [...a.vibes, n] }));
    return state();
  });
  h('removeVibe', async (id: string) => {
    await updateAmbience((a) => ({ vibes: a.vibes.filter((x) => x.id !== id), activeVibe: a.activeVibe === id ? null : a.activeVibe, schedule: { ...a.schedule, rules: a.schedule.rules.filter((r) => r.vibe !== id), fallback: a.schedule.fallback === id ? null : a.schedule.fallback } }));
    return state();
  });
  h('captureVibe', (name: string, emoji?: string) => captureVibe(name, emoji));
  h('resetStarters', async () => {
    await updateAmbience((a) => ({ vibes: [...STARTER_VIBES.map((v) => structuredClone(v)), ...a.vibes.filter((v) => !STARTER_VIBES.some((s) => s.id === v.id))] }));
    return state();
  });
  h('saveRules', async (rules: VibeRule[]) => { await updateAmbience((a) => ({ schedule: { ...a.schedule, rules } })); lastKey = null; checkSchedule(); return state(); });
  h('savePalette', async (p: NamedPalette) => { await updateAmbience((a) => ({ palettes: [...a.palettes.filter((x) => x.id !== p.id), { ...p, custom: true }] })); return state(); });
  h('removePalette', async (id: string) => { await updateAmbience((a) => ({ palettes: a.palettes.filter((x) => x.id !== id) })); return state(); });
  h('pickMedia', async (kind: 'video' | 'image' | 'folder') => {
    const filters = kind === 'video' ? [{ name: 'Videos', extensions: ['mp4', 'webm', 'mov', 'm4v', 'ogv'] }] : kind === 'image' ? [{ name: 'Pictures', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'bmp'] }] : undefined;
    const r = await dialog.showOpenDialog({ properties: kind === 'folder' ? ['openDirectory'] : ['openFile'], filters });
    const p = r.canceled ? null : r.filePaths[0] ?? null;
    if (p) allowRoot(kind === 'folder' ? p : path.dirname(p));
    return p;
  });
  h('setStill', () => setStill());
  h('restoreDesktop', async () => {
    const prev = ambience().previousDesktop;
    if (!prev || prev.platform !== process.platform) return { ok: false, error: 'Keeper has not changed the desktop picture' };
    const r = await setDesktopPicture(prev.value);
    if (r.ok) await updateAmbience({ previousDesktop: null });
    return { ok: r.ok, error: r.error };
  });
  h('cost', () => measureCost());
  h('setMix', async (mix: SoundMix, master?: number) => { await updateAmbience((a) => ({ sound: { ...a.sound, mix: normalizeMix(mix), master: typeof master === 'number' ? Math.min(1, Math.max(0, master)) : a.sound.master } })); return state(); });
  h('setSoundPlaying', async (on: boolean) => { await updateAmbience((a) => ({ sound: { ...a.sound, playing: on, sleepAt: on ? a.sound.sleepAt : null } })); return state(); });
  h('sleep', async (minutes: number | null) => { await updateAmbience((a) => ({ sound: { ...a.sound, sleepAt: minutes && minutes > 0 ? Date.now() + minutes * 60_000 : null } })); return state(); });
  h('openMixer', () => { if (featureOn('ambientSound')) ensureMixer(true); });
  h('closeMixer', () => { mixer?.hide(); maybeDropMixer(); });
  h('pickFolders', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'multiSelections'] });
    return r.canceled ? [] : r.filePaths;
  });
  h('applyFolderIcon', (folders: string[], spec: FolderIconSpec, png: string) => applyIcons(folders, spec, png));
  h('restoreFolderIcon', (folders: string[]) => restoreIcons(folders));
  h('folderIcons', () => ambience().folderIcons);
  // What the tray's submenu shows right now (labels only), for Settings previews and tests.
  const strip = (items: MenuItemConstructorOptions[]): unknown[] => items.filter((i) => i.type !== 'separator').map((i) => ({ label: i.label, checked: i.checked, enabled: i.enabled !== false, submenu: Array.isArray(i.submenu) ? strip(i.submenu) : undefined }));
  h('trayPreview', () => strip(ambienceTrayItems()));
}

// ---------------------------------------------------------------- tray, shortcuts

/** The tray's “Desktop & Vibes” submenu (empty when the person turned the tray off for it). */
export function ambienceTrayItems(): MenuItemConstructorOptions[] {
  if (!deps) return [];
  const a = ambience();
  if (!a.surfaces.tray || (!featureOn('vibes') && !featureOn('wallpaper') && !featureOn('ambientSound'))) return [];
  const sub: MenuItemConstructorOptions[] = [];
  if (featureOn('vibes')) {
    sub.push({ label: 'Vibes', enabled: false });
    for (const v of a.vibes.slice(0, 16)) sub.push({ label: `${v.emoji}  ${v.name}`, type: 'radio', checked: a.activeVibe === v.id, click: () => void applyVibe(v.id) });
    sub.push({ type: 'separator' });
  }
  if (featureOn('wallpaper')) {
    sub.push({ label: a.wallpaper.enabled ? (wallpaperPaused() ? 'Resume Wallpaper' : 'Pause Wallpaper') : 'Turn On Live Wallpaper', click: () => {
      if (!a.wallpaper.enabled) void updateAmbience((x) => ({ wallpaper: { ...x.wallpaper, enabled: true } }));
      else { setUserPaused(!wallpaperPaused()); syncStillMode(); changed(); }
    } });
    sub.push({ label: 'Surprise Me', click: () => { const x = ambience(); void setWallpaper('all', surpriseSource(Math.random, x.wallpaper.default, x.palettes)); } });
    sub.push({ label: 'Scenes', submenu: SCENES.map((s) => ({ label: s.name, type: 'radio' as const, checked: a.wallpaper.default.kind === 'scene' && a.wallpaper.default.scene === s.id, click: () => void setWallpaper('all', sceneSource(s.id)) })) });
  }
  if (featureOn('ambientSound')) {
    sub.push({ label: a.sound.playing ? `Stop Sound (${describeMix(a.sound.mix)})` : 'Play Ambient Sound', click: () => void updateAmbience((x) => ({ sound: { ...x.sound, playing: !x.sound.playing, sleepAt: null } })) });
    sub.push({ label: 'Sound Mixer…', click: () => ensureMixer(true) });
    sub.push({ label: 'Sleep Timer', submenu: [
      ...SLEEP_CHOICES.map((m) => ({ label: m < 60 ? `${m} minutes` : `${m / 60} hour${m === 60 ? '' : 's'}`, click: () => void updateAmbience((x) => ({ sound: { ...x.sound, playing: true, sleepAt: Date.now() + m * 60_000 } })) })),
      { type: 'separator' as const },
      { label: 'Off', enabled: !!a.sound.sleepAt, click: () => void updateAmbience((x) => ({ sound: { ...x.sound, sleepAt: null } })) },
    ] });
  }
  if (featureOn('widgets')) sub.push({ label: 'Arrange Widgets', click: () => setArranging(true) });
  sub.push({ type: 'separator' }, { label: 'Wallpaper & Vibes…', click: () => deps.show('ambience') });
  const active = a.vibes.find((v) => v.id === a.activeVibe);
  return [{ label: active ? `Vibe: ${active.emoji} ${active.name}` : 'Desktop & Vibes', submenu: sub }];
}

/** Registered by main.ts after it clears every shortcut. */
export function registerAmbienceShortcuts() {
  if (!deps) return;
  const a = ambience();
  if (!a.surfaces.shortcuts) return;
  const reg = (acc: string, fn: () => void) => {
    try { if (acc && !globalShortcut.isRegistered(acc)) globalShortcut.register(acc, fn); } catch { /* taken or invalid */ }
  };
  if (featureOn('vibes')) {
    reg(a.shortcuts.next, () => { const v = stepVibe(ambience().vibes, ambience().activeVibe, 1); if (v) void applyVibe(v.id).then(() => deps.alert(`${v.emoji} ${v.name}`)); });
    reg(a.shortcuts.previous, () => { const v = stepVibe(ambience().vibes, ambience().activeVibe, -1); if (v) void applyVibe(v.id).then(() => deps.alert(`${v.emoji} ${v.name}`)); });
  }
  if (featureOn('wallpaper')) {
    reg(a.shortcuts.surprise, () => { const x = ambience(); void setWallpaper('all', surpriseSource(Math.random, x.wallpaper.default, x.palettes)); });
    reg(a.shortcuts.pause, () => { setUserPaused(!wallpaperPaused()); changed(); deps.alert(wallpaperPaused() ? 'Wallpaper paused' : 'Wallpaper playing'); });
  }
  if (featureOn('ambientSound')) reg(a.shortcuts.mixer, () => (mixer?.isVisible() ? mixer.hide() : ensureMixer(true)));
}

// ---------------------------------------------------------------- AI abilities and the command line

function registerAbilities() {
  const ok = (content: string, summary = content) => ({ content, summary });
  registerAbility({
    name: 'list_vibes', label: 'List desktop vibes', group: 'System', defaultPermission: 'allow', network: 'never', readOnly: true,
    description: 'Lists the desktop vibes (wallpaper + theme + ambient sound + widgets bundles), which one is active, the built-in wallpaper scenes and ambient sounds.',
    parameters: { type: 'object', properties: {} },
    describe: () => 'List desktop vibes',
  }, async () => {
    const a = ambience();
    return ok(JSON.stringify({ active: a.activeVibe, vibes: a.vibes.map((v) => ({ id: v.id, name: v.name, wallpaper: v.wallpaper ? describeSource(v.wallpaper) : null })), scenes: SCENES.map((s) => ({ id: s.id, name: s.name, category: s.category })), palettes: [...PALETTES, ...a.palettes].map((p) => p.id), sounds: SOUNDS.map((s) => s.id) }), `${a.vibes.length} vibes`);
  });
  registerAbility({
    name: 'set_vibe', label: 'Switch the desktop vibe', group: 'System', defaultPermission: 'ask', network: 'never', readOnly: false,
    description: 'Switches the desktop vibe by id or name: its wallpaper, theme, ambient sound and widget layout change together.',
    parameters: { type: 'object', properties: { vibe: { type: 'string' } }, required: ['vibe'] },
    describe: (x) => `Switch the desktop vibe to “${String(x.vibe ?? '')}”`,
  }, async (x) => {
    const q = String(x.vibe ?? '').toLowerCase();
    const v = ambience().vibes.find((y) => y.id === q || y.name.toLowerCase() === q) ?? ambience().vibes.find((y) => y.name.toLowerCase().includes(q));
    if (!v) return { content: `No vibe matches “${q}”`, summary: 'No such vibe', isError: true };
    await applyVibe(v.id);
    return ok(`Switched to ${v.name}`);
  });
  registerAbility({
    name: 'set_wallpaper', label: 'Change the live wallpaper', group: 'System', defaultPermission: 'ask', network: 'never', readOnly: false,
    description: 'Sets the live wallpaper to a built-in scene (see list_vibes for ids), optionally with a palette and speed 0–3, or "surprise" for a random one.',
    parameters: { type: 'object', properties: { scene: { type: 'string' }, palette: { type: 'string' }, speed: { type: 'number' } }, required: ['scene'] },
    describe: (x) => `Set the wallpaper to ${String(x.scene ?? '')}`,
  }, async (x) => {
    const id = String(x.scene ?? '');
    const a = ambience();
    const src = id === 'surprise' ? surpriseSource(Math.random, a.wallpaper.default, a.palettes) : sceneById(id) ? sceneSource(id, typeof x.palette === 'string' ? x.palette : undefined, clampParams({ speed: typeof x.speed === 'number' ? x.speed : 1 })) : null;
    if (!src) return { content: `No scene “${id}”`, summary: 'No such scene', isError: true };
    await setWallpaper('all', src);
    return ok(`Wallpaper: ${describeSource(src)}${featureOn('wallpaper') && a.wallpaper.enabled ? '' : ' (live wallpaper is off; it shows when turned on)'}`);
  });
  registerAbility({
    name: 'ambient_sound', label: 'Play ambient sound', group: 'System', defaultPermission: 'ask', network: 'never', readOnly: false,
    description: 'Plays a mix of ambient sounds made on this computer (levels 0–1 per sound: rain, cafe, waves, stream, wind, fire, night, white, pink, brown), stops it, or sets a sleep timer in minutes.',
    parameters: { type: 'object', properties: { mix: { type: 'object' }, stop: { type: 'boolean' }, sleep_minutes: { type: 'number' } } },
    describe: (x) => (x.stop ? 'Stop ambient sound' : `Play ambient sound${x.sleep_minutes ? ` for ${x.sleep_minutes} min` : ''}`),
  }, async (x) => {
    if (x.stop) { await updateAmbience((a) => ({ sound: { ...a.sound, playing: false, sleepAt: null } })); return ok('Sound stopped'); }
    await updateAmbience((a) => ({ sound: { ...a.sound, playing: true, mix: x.mix ? normalizeMix(x.mix) : a.sound.mix, sleepAt: typeof x.sleep_minutes === 'number' && x.sleep_minutes > 0 ? Date.now() + x.sleep_minutes * 60_000 : a.sound.sleepAt } }));
    return ok(`Playing ${describeMix(ambience().sound.mix)}`);
  });
}

function registerCli() {
  // keeper ambience status|vibes|vibe <name>|next|prev|surprise|scene <id> [palette]|pause|play|sound <mix…>|stop|sleep <min>|still|restore
  registerKeeperMethod('keeper/ambience', async (p) => {
    const cmd = String(p.cmd ?? 'status');
    const args = (p.args as string[] | undefined) ?? [];
    const a = ambience();
    const summary = () => {
      const s = state();
      return { vibe: s.settings.activeVibe, wallpaper: describeSource(s.settings.wallpaper.default), playing: featureOn('wallpaper') && s.settings.wallpaper.enabled && !wallpaperPaused(), strategy: s.strategy, sound: s.settings.sound.playing ? describeMix(s.settings.sound.mix) : 'off', displays: s.displays.map((d) => ({ id: d.id, label: d.label, wallpaper: describeSource(d.source), live: d.live })) };
    };
    if (cmd === 'status') return summary();
    if (cmd === 'vibes') return a.vibes.map((v) => ({ id: v.id, name: `${v.emoji} ${v.name}`, active: v.id === a.activeVibe }));
    if (cmd === 'scenes') return SCENES.map((s) => ({ id: s.id, name: s.name, category: s.category }));
    if (cmd === 'vibe') {
      const q = args.join(' ').toLowerCase();
      const v = a.vibes.find((y) => y.id === q || y.name.toLowerCase() === q) ?? a.vibes.find((y) => y.name.toLowerCase().includes(q));
      if (!v) throw new Error(`No vibe matches “${q}”. Try: keeper ambience vibes`);
      await applyVibe(v.id);
      return summary();
    }
    if (cmd === 'next' || cmd === 'prev') { const v = stepVibe(a.vibes, a.activeVibe, cmd === 'next' ? 1 : -1); if (v) await applyVibe(v.id); return summary(); }
    if (cmd === 'surprise') { await setWallpaper('all', surpriseSource(Math.random, a.wallpaper.default, a.palettes)); return summary(); }
    if (cmd === 'scene') { if (!sceneById(args[0] ?? '')) throw new Error('Usage: keeper ambience scene <id> [palette]. See keeper ambience scenes'); await setWallpaper('all', sceneSource(args[0], args[1])); return summary(); }
    if (cmd === 'pause' || cmd === 'play') { setUserPaused(cmd === 'pause'); if (cmd === 'play' && !a.wallpaper.enabled) await updateAmbience((x) => ({ wallpaper: { ...x.wallpaper, enabled: true } })); changed(); return summary(); }
    if (cmd === 'sound') {
      const mix: SoundMix = {};
      for (const t of args) { const [k, v] = t.split('='); if (SOUNDS.some((s) => s.id === k)) mix[k as keyof SoundMix] = v ? Number(v) : 0.6; }
      await updateAmbience((x) => ({ sound: { ...x.sound, playing: true, mix: Object.keys(mix).length ? normalizeMix(mix) : x.sound.mix } }));
      return summary();
    }
    if (cmd === 'stop') { await updateAmbience((x) => ({ sound: { ...x.sound, playing: false, sleepAt: null } })); return summary(); }
    if (cmd === 'sleep') { const m = Number(args[0]); await updateAmbience((x) => ({ sound: { ...x.sound, playing: true, sleepAt: m > 0 ? Date.now() + m * 60_000 : null } })); return summary(); }
    if (cmd === 'still') return setStill();
    if (cmd === 'restore') { const prev = a.previousDesktop; return prev ? setDesktopPicture(prev.value) : { ok: false, error: 'Keeper has not changed the desktop picture' }; }
    throw new Error('Usage: keeper ambience status|vibes|vibe <name>|next|prev|surprise|scenes|scene <id> [palette]|pause|play|sound rain=0.6 cafe=0.3|stop|sleep <min>|still|restore');
  });
}

// ---------------------------------------------------------------- start

export function registerAmbience(d: AmbienceDeps) {
  deps = d;
  initWallpaperWindows({ preload: d.preload, lockDown: d.lockDown, changed, fallbackStill: fallbackToStill });
  registerIpc();
  registerAbilities();
  registerCli();
  // Never start making sound at login on its own: playing resumes only when asked.
  if (ambience().sound.playing) void updateAmbience((a) => ({ sound: { ...a.sound, playing: false, sleepAt: null } }));
  onAmbience((next, prev) => {
    if (JSON.stringify(next.wallpaper) !== JSON.stringify(prev.wallpaper)) { syncWallpaper(); syncStillMode(); tintFrom(next.wallpaper.default); }
    if (JSON.stringify(next.sound) !== JSON.stringify(prev.sound)) syncSound();
    if (JSON.stringify(next.schedule) !== JSON.stringify(prev.schedule)) syncSchedule();
    if (JSON.stringify(next.surfaces) !== JSON.stringify(prev.surfaces) || JSON.stringify(next.shortcuts) !== JSON.stringify(prev.shortcuts)) {
      // main.ts re-registers every shortcut on a settings change; ask it to by touching nothing but the shortcut map.
      for (const acc of Object.values(prev.shortcuts)) { try { if (acc && globalShortcut.isRegistered(acc)) globalShortcut.unregister(acc); } catch { /* ignore */ } }
      registerAmbienceShortcuts();
    }
    changed();
  });
  onFeature('wallpaper', (on) => {
    if (on) { syncWallpaper(); syncStillMode(); } else { stopWallpaper(); stillStop?.(); stillStop = null; }
    changed();
  }, { now: true });
  onFeature('vibes', () => { syncSchedule(); changed(); }, { now: true });
  onFeature('ambientSound', () => { syncSound(); changed(); }, { now: true });
  onFeature('folderIcons', () => changed());
  tintFrom(ambience().wallpaper.default);
}

export { ambienceTrayItems as trayItems };
