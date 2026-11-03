// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Stage mode everywhere Keeper reaches: IPC for the Stage page and the Island,
// the tray menu, global shortcuts, keeper://stage links, `keeper stage` and
// `keeper display` on the command line, and abilities any AI can use (with
// the person's permission). Also the older "Presentation mode", which now
// runs through Stage with its original behaviour.

import { ipcMain } from 'electron';
import { registerAbility } from '../../core/abilities/registry';
import type { StagePreset, StageSettings, StageStatus } from '../../core/stage/types';
import { registerKeeperMethod } from '../services/brain';
import { listDisplays, listInputs, setDisplay, setInput } from '../services/display-control';
import { featureOn, onFeature } from '../services/features';
import type { IslandService } from '../services/island';
import { StageService } from '../services/stage';
import { forgetDisplays, nudge, registerDisplayKeys } from '../services/stage/display-keys';
import { overlayState } from '../services/stage/overlay';
import { drawing, drawState, setDrawHooks, setDrawing, toggleDrawing } from '../services/stage/draw';
import { runningApps } from '../services/devices';

function handle(name: string, fn: (...args: never[]) => unknown) {
  ipcMain.handle(name, async (_e, ...args) => fn(...(args as never[])));
}

let svc: StageService | null = null;
export const stage = () => svc;

export interface StageCtx {
  islandSvc: IslandService;
  broadcast: (channel: string, ...args: unknown[]) => void;
  updateTray: () => void;
  show: (route: string) => void;
  /** re-registers every global shortcut (Keeper's own function, so turning features off frees them) */
  reregister: () => void;
  recording: () => boolean;
  /** the preload of Keeper's floating windows (the drawing sheet) */
  capturePreload: string;
}

const str = (v: unknown) => String(v ?? '');

export function registerStageIpc(c: StageCtx) {
  stageShow = c.show;
  let lastJson = '';
  svc = new StageService({
    notify: (title, detail) => c.islandSvc.alert({ kind: 'info', title, detail }),
    changed: (st) => {
      c.islandSvc.refresh();
      const j = JSON.stringify(st);
      if (j === lastJson) return;
      lastJson = j;
      c.broadcast('stage-changed', st);
      c.updateTray();
    },
    awake: async (on, o) => {
      const { awakeService } = await import('../services/awake');
      const a = awakeService();
      if (!a || !featureOn('keepAwake')) return { ok: false, mine: false, notice: 'Keep Awake is switched off in Settings → Features' };
      if (!on) {
        if (a.session && ['Stage mode', 'Presentation mode'].includes(a.session.reason)) await a.stop('Stage mode ended', true);
        return { ok: true, mine: true };
      }
      if (a.session) return { ok: true, mine: false, notice: 'Already keeping awake (your own session stays as it is)' };
      try {
        const st = await a.begin({ source: 'presentation', reason: o.reason, options: { focus: o.focus } });
        return { ok: true, mine: true, notice: o.focus ? st.notice : undefined };
      } catch (e) {
        return { ok: false, mine: false, notice: e instanceof Error ? e.message : String(e) };
      }
    },
    focus: async (on) => {
      const { awakeService } = await import('../services/awake');
      const a = awakeService();
      if (!a) return { notice: 'Keep Awake is not running' };
      return a.focusOnly(on);
    },
    recording: c.recording,
    presenting: (on) => c.islandSvc.modeHook?.('presentation', on),
    // Monorail (macOS): its layout survives "hide other apps", and its overlays stay out of the picture.
    arranger: process.platform === 'darwin' ? {
      beforeHide: async () => (await import('../services/ashforde/coexist')).stageWillHide(),
      afterShow: async () => (await import('../services/ashforde/coexist')).stageShown(),
      changed: (on) => void import('../services/ashforde/coexist').then((m) => m.stageChanged(on)),
    } : undefined,
  });
  c.islandSvc.stageView = (s) => svc!.islandView(s);
  void svc.init().then(() => c.reregister());
  onFeature('stage', () => { c.reregister(); c.updateTray(); });
  onFeature('displayKeys', () => c.reregister());
  // Draw on screen: its shortcut comes and goes with the switch; switching it off ends drawing.
  drawPreload = c.capturePreload;
  setDrawHooks({
    save: (patch) => void svc!.saveSettings({ draw: { ...svc!.cfg.draw, ...patch } }),
    changed: (on) => { c.broadcast('stage-draw', on); c.updateTray(); },
  });
  onFeature('drawOnScreen', (on) => { if (!on) void setDrawing(false); c.reregister(); c.updateTray(); });

  const s = svc;
  handle('stage.status', () => s.status());
  handle('stage.start', (preset?: string, opts?: { reason?: string; skipCountdown?: boolean }) => s.start(preset, { reason: opts?.reason ?? 'Stage page', skipCountdown: opts?.skipCountdown }));
  handle('stage.stop', () => s.stop());
  handle('stage.toggle', (preset?: string) => s.toggle(preset, 'Island'));
  handle('stage.extend', (m: number) => s.extend(Number(m) || 15));
  handle('stage.settings', () => s.cfg);
  handle('stage.setSettings', async (patch: Partial<StageSettings>) => { const r = await s.saveSettings(patch); c.reregister(); c.updateTray(); return r; });
  handle('stage.savePreset', async (p: StagePreset) => { const r = await s.savePreset(p); c.reregister(); return r; });
  handle('stage.removePreset', async (id: string) => { const r = await s.removePreset(id); c.reregister(); return r; });
  handle('stage.support', () => s.support());
  handle('stage.journal', () => s.journalNow());
  handle('stage.detect', () => s.detect());
  handle('stage.modes', async () => (await (await import('../services/stage/exec')).displayModes())?.modes ?? []);
  handle('stage.apps', () => runningApps().then((a) => a.sort((x, y) => x.localeCompare(y))));
  handle('stage.preview', (what: 'spotlight' | 'clicks' | 'keys' | 'countdown' | 'backdrop') => s.preview(what));
  handle('stage.displayInputs', (id: string) => listInputs(id));
  handle('stage.setDisplayInput', async (id: string, code: number) => { await setInput(id, Number(code)); forgetDisplays(); });
  // For the end-to-end test and diagnostics: what the overlays draw right now.
  handle('stage.overlays', () => overlayState());
  handle('stage.draw', (on?: boolean) => drawNow(on));
  handle('stage.drawState', () => drawState());
  // The tray menu's Stage items as text (diagnostics and the end-to-end test).
  handle('stage.tray', () => stageTrayItems().flatMap((i) => [i.label ?? '', ...((i.submenu as Electron.MenuItemConstructorOptions[] | undefined) ?? []).map((x) => `  ${x.label ?? '—'}`)]));

  // `keeper stage on|off|toggle|status|presets|journal|detect [--preset Recording]`
  registerKeeperMethod('keeper/stage', async (p) => {
    const cmd = str(p.cmd || 'status');
    const preset = p.preset ? str(p.preset) : undefined;
    if (cmd === 'status') return s.status();
    if (cmd === 'on' || cmd === 'start') return s.start(preset, { reason: 'Command line', skipCountdown: !!p.now });
    if (cmd === 'off' || cmd === 'stop') return s.stop();
    if (cmd === 'toggle') return s.toggle(preset, 'Command line');
    if (cmd === 'extend') return s.extend(Number(p.minutes ?? p.for ?? 15) || 15);
    if (cmd === 'presets') return s.cfg.presets.map((x) => ({ id: x.id, name: x.name, builtIn: !!x.builtIn, countdown: x.countdown, limitMin: x.limitMin }));
    if (cmd === 'journal') return s.journalNow();
    if (cmd === 'detect') return s.detect();
    if (cmd === 'support') return s.support();
    throw new Error('Usage: keeper stage on|off|toggle|status|extend|presets|journal|detect|support [--preset Recording]');
  });
  // `keeper display list | set <id> brightness|contrast|volume <0-100> | inputs <id> | input <id> <code> | up|down brightness|volume`
  registerKeeperMethod('keeper/display', async (p) => {
    const cmd = str(p.cmd || 'list');
    if (cmd === 'list') return listDisplays();
    if (cmd === 'set') { await setDisplay(str(p.id), str(p.control) as 'brightness', Number(p.value)); return { ok: true }; }
    if (cmd === 'inputs') return listInputs(str(p.id));
    if (cmd === 'input') { await setInput(str(p.id), parseInt(str(p.code), str(p.code).startsWith('0x') ? 16 : 10)); return { ok: true }; }
    if (cmd === 'up' || cmd === 'down') return { value: await nudge(s.cfg.displayKeys, str(p.control) === 'volume' ? 'volume' : 'brightness', cmd === 'up' ? 1 : -1) };
    throw new Error('Usage: keeper display list | set ID brightness 60 | inputs ID | input ID 0x11 | up|down brightness|volume');
  });

  // ---------------------------------------------------------------- abilities for any AI
  const view = (st: StageStatus) => JSON.stringify({ on: st.on, preset: st.presetName, since: st.since, endsAt: st.endsAt, reason: st.reason, changes: st.applied.map((a) => `${a.label}${a.ok ? '' : ' (not possible)'}${a.note ? ` — ${a.note}` : ''}`) });
  registerAbility({
    name: 'stage_status', label: 'Is Stage mode on?', group: 'System', defaultPermission: 'allow', network: 'never', readOnly: true,
    description: 'Says whether Keeper\'s Stage mode (a clean screen for recording, presenting or screenshots) is on, with which preset and what it changed, and lists the presets.',
    parameters: { type: 'object', properties: {} },
    describe: () => 'See whether Stage mode is on',
  }, async () => ({ content: JSON.stringify({ ...JSON.parse(view(s.status())), presets: s.cfg.presets.map((x) => x.name) }), summary: s.on ? `on (${s.status().presetName})` : 'off' }));
  registerAbility({
    name: 'stage_start', label: 'Start Stage mode', group: 'System', defaultPermission: 'ask', network: 'never', readOnly: false,
    description: 'Starts Keeper\'s Stage mode with a preset ("Recording", "Presenting", "Screenshot" or one of the person\'s own): hides desktop icons, the Dock and other apps, turns on Do Not Disturb and so on, as the preset says. Everything is put back when it stops.',
    parameters: { type: 'object', properties: { preset: { type: 'string' } } },
    describe: (a) => `Start Stage mode${a.preset ? ` (${str(a.preset)})` : ''}`,
  }, async (a) => {
    if (!featureOn('stage')) return { content: 'Stage mode is switched off in Settings → Features.', summary: 'off', isError: true };
    const st = await s.start(a.preset ? str(a.preset) : undefined, { reason: 'Asked by an AI', skipCountdown: true });
    return { content: view(st), summary: `Stage on (${st.presetName})` };
  });
  registerAbility({
    name: 'stage_stop', label: 'Stop Stage mode', group: 'System', defaultPermission: 'allow', network: 'never', readOnly: false,
    description: 'Ends Keeper\'s Stage mode and puts every change back.',
    parameters: { type: 'object', properties: {} },
    describe: () => 'Stop Stage mode and put everything back',
  }, async () => {
    const st = await s.stop();
    return { content: JSON.stringify(st.lastRevert ?? []), summary: 'Stage off' };
  });
  registerAbility({
    name: 'display_input', label: 'Switch a monitor\'s input', group: 'System', defaultPermission: 'ask', network: 'never', readOnly: false,
    description: 'Lists external monitors (DDC/CI) and their input sources, or switches one to another input (HDMI 1, DisplayPort 1, USB-C…). Call without "code" to list. The monitor goes dark if nothing is connected to the new input.',
    parameters: { type: 'object', properties: { display: { type: 'string', description: 'a display id from the list' }, code: { type: 'number', description: 'the input code to switch to' } } },
    describe: (a) => (a.code !== undefined ? `Switch ${str(a.display)} to input ${str(a.code)}` : 'List monitors and their inputs'),
  }, async (a) => {
    if (!featureOn('displayControl')) return { content: 'External display controls are switched off.', summary: 'off', isError: true };
    if (a.code === undefined) {
      const { displays, note } = await listDisplays();
      const withInputs = await Promise.all(displays.map(async (d) => ({ ...d, ...(await listInputs(d.id).catch(() => ({ inputs: [] }))) })));
      return { content: JSON.stringify({ displays: withInputs, note }), summary: `${displays.length} displays` };
    }
    await setInput(str(a.display), Number(a.code));
    return { content: 'Switched.', summary: 'switched' };
  });
}

/** The Stage shortcut, each preset's own shortcut and the display keys (called from Keeper's shortcut registration). */
export function registerStageShortcuts(reg: (acc: string, fn: () => void, owner?: string) => void) {
  if (!svc) return;
  const s = svc;
  if (featureOn('stage') && s.cfg.surfaces.shortcut) {
    reg(s.cfg.shortcut, () => void s.toggle(undefined, 'Shortcut').catch(() => undefined), 'Stage');
    for (const p of s.cfg.presets) if (p.shortcut) reg(p.shortcut, () => void s.toggle(p.id, 'Shortcut').catch(() => undefined), `Stage: ${p.name}`);
  }
  if (featureOn('displayKeys')) registerDisplayKeys(s.cfg.displayKeys);
  if (featureOn('drawOnScreen') && s.cfg.draw.shortcut) reg(s.cfg.draw.shortcut, () => void drawNow().catch(() => undefined), 'Draw on screen');
}

let drawPreload = '';
/** Starts or ends Draw on screen (nothing: switches it). */
export async function drawNow(on?: boolean): Promise<boolean> {
  if (!svc) return false;
  if (on === false) return setDrawing(false);
  if (!featureOn('drawOnScreen')) {
    if (on) throw new Error('Draw on screen is switched off in Settings → Features.');
    return false;
  }
  return on === true ? setDrawing(true, svc.cfg.draw, drawPreload) : toggleDrawing(svc.cfg.draw, drawPreload);
}

/** Stage in the tray menu: start a preset, or the live state and Stop. */
export function stageTrayItems(): Electron.MenuItemConstructorOptions[] {
  if (!svc || !featureOn('stage') || !svc.cfg.surfaces.tray) return [];
  const s = svc;
  const st = s.status();
  if (st.on || st.countdownEndsAt) {
    const mins = st.since ? Math.floor((Date.now() - st.since) / 60_000) : 0;
    return [{ label: `● Stage: ${st.presetName ?? 'starting…'}${st.on ? ` · ${mins} min` : ''}`, submenu: [
      { label: 'Stop Stage', accelerator: s.cfg.surfaces.shortcut ? s.cfg.shortcut : undefined, click: () => void s.stop() },
      { label: 'Add 15 minutes', enabled: st.on, click: () => void s.extend(15) },
      ...drawItem(s),
    ] }];
  }
  return [{ label: 'Stage', submenu: [
    ...s.cfg.presets.map((p) => ({ label: p.name, accelerator: p.id === s.cfg.preset && s.cfg.surfaces.shortcut ? s.cfg.shortcut : p.shortcut || undefined, click: () => void s.start(p.id, { reason: 'Menu bar' }).catch(() => undefined) })),
    ...drawItem(s),
    { type: 'separator' as const },
    { label: 'Stage Settings…', click: () => stageShow?.('stage') },
  ] }];
}

/** "Draw on Screen" (or "Stop Drawing") in Stage's tray menu, while that switch is on. */
function drawItem(s: StageService): Electron.MenuItemConstructorOptions[] {
  if (!featureOn('drawOnScreen')) return [];
  return [{ label: drawing() ? 'Stop Drawing' : 'Draw on Screen', accelerator: s.cfg.draw.shortcut || undefined, click: () => void drawNow().catch(() => undefined) }];
}

let stageShow: ((route: string) => void) | undefined;
export function setStageShow(fn: (route: string) => void) { stageShow = fn; }

/** keeper://stage/on?preset=recording · keeper://stage/off · keeper://stage/toggle */
export function handleStageLink(u: URL) {
  if (!svc) return;
  const verb = u.pathname.replace(/^\/+/, '') || u.searchParams.get('do') || 'toggle';
  const preset = u.searchParams.get('preset') ?? undefined;
  const s = svc;
  if (verb === 'off' || verb === 'stop') void s.stop();
  else if (verb === 'on' || verb === 'start') void s.start(preset, { reason: 'Link' }).catch(() => undefined);
  else void s.toggle(preset, 'Link').catch(() => undefined);
}

/** The older "Presentation mode" (Island, palette, Monorail): runs through Stage now, with the same behaviour. */
export function stagePresentation(on: boolean): Promise<boolean> {
  return svc ? svc.presentation(on) : Promise.resolve(false);
}
