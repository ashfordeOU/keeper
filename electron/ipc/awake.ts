// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// IPC, the command line, keeper:// links and the separate menu-bar item for
// Keep Awake (electron/services/awake).

import path from 'node:path';
import { app, ipcMain, Menu, nativeImage, Tray } from 'electron';
import { describeSpec, fmtDuration, fmtRemaining, parseDuration, specFromCli, specFromOptions, type AwakeSettings, type IconStyle, type SessionSpec } from '../../core/awake-engine';
import type { AwakeStatus } from '../../core/api-awake';
import { svgFor, trayColor } from '../../core/awake-icons';
import type { KeepAwakeState } from '../../core/api';
import { AwakeService } from '../services/awake';
import { registerKeeperMethod } from '../services/brain';
import { runningApps } from '../services/devices';
import { featureOn, onFeature } from '../services/features';
import type { IslandService } from '../services/island';
import { onSettings, settings } from '../store';

function handle(name: string, fn: (...args: never[]) => unknown) {
  ipcMain.handle(name, async (_e, ...args) => fn(...(args as never[])));
}

let svc: AwakeService;
let showPage = () => {};

function islandState(s: AwakeStatus): KeepAwakeState {
  if (!s.session) return { on: false };
  return {
    on: true,
    since: s.session.startedAt,
    until: s.session.endsAt,
    reason: s.session.reason,
    options: { allowDisplaySleep: s.session.options.display === 'allow-sleep', onlyOnPower: s.session.options.onlyOnPower, stopBelowBattery: s.session.options.endBelowBattery || undefined },
  };
}

export { specFromCli, specFromOptions };

export function awake(): AwakeService {
  return svc;
}

export function registerAwakeIpc(c: { islandSvc: IslandService; broadcast: (channel: string, ...args: unknown[]) => void; updateTray: () => void; show: (route: string) => void }) {
  showPage = () => c.show('awake');
  let lastJson = '';
  svc = new AwakeService({
    notify: (title, detail) => c.islandSvc.alert({ kind: 'info', title, detail }),
    changed: (st) => {
      c.islandSvc.mirrorAwake(islandState(st), st.matching);
      const j = JSON.stringify(st);
      if (j === lastJson) return;
      lastJson = j;
      c.broadcast('awake-changed', st);
      c.updateTray();
      menuBar.update(st);
    },
    live: () => ({ audioPlaying: !!c.islandSvc.playing?.playing, agents: c.islandSvc.agents.length, events: c.islandSvc.events, battery: c.islandSvc.battery }),
  });
  // The Island, tray, shortcut, palette and Focus sessions all go through the service.
  c.islandSvc.awakeDriver = (on, options, reason) => {
    if (!on) void svc.stop();
    else void svc.begin(specFromOptions(options, reason)).catch((e) => c.islandSvc.alert({ kind: 'info', title: 'Keep Awake is off', detail: e instanceof Error ? e.message : String(e) }));
    const spec = specFromOptions(options, reason);
    return on ? { on: true, since: Date.now(), until: options.until ?? (options.minutes ? Date.now() + options.minutes * 60_000 : undefined), reason: reason ?? describeSpec(spec), options } : { on: false };
  };
  void svc.start();

  handle('awake.status', () => svc.status());
  handle('awake.start', (spec?: SessionSpec) => svc.begin({ source: 'manual', ...(spec ?? {}) }));
  handle('awake.stop', () => svc.stop());
  handle('awake.toggle', (spec?: SessionSpec) => svc.toggle({ source: 'manual', ...(spec ?? {}) }));
  handle('awake.extend', (minutes: number) => svc.extend(Number(minutes) || 15));
  handle('awake.parse', (text: string) => parseDuration(String(text ?? ''), Date.now()) ?? null);
  handle('awake.settings', () => settings().awake);
  handle('awake.setSettings', (patch: Partial<AwakeSettings>) => svc.saveSettings(patch));
  handle('awake.saveTrigger', (rule) => svc.saveTrigger(rule));
  handle('awake.removeTrigger', (id: string) => svc.removeTrigger(id));
  handle('awake.reorderTriggers', (ids: string[]) => svc.reorderTriggers(ids));
  handle('awake.testTrigger', (rule) => svc.testTrigger(rule));
  handle('awake.blockers', () => svc.blockers());
  handle('awake.stats', () => svc.stats());
  handle('awake.resetStats', () => svc.resetStats());
  handle('awake.apps', () => runningApps().then((a) => a.sort((x, y) => x.localeCompare(y))));
  handle('awake.setupClosedDisplay', () => svc.setupClosedDisplay());

  // `keeper awake on|off|toggle|status|extend [--for 30m] [--until 18:30] [--while-app Name] …`
  registerKeeperMethod('keeper/awake', async (p) => {
    const cmd = String(p.cmd ?? 'status');
    if (cmd === 'status') return svc.status();
    if (cmd === 'off' || cmd === 'stop') return svc.stop();
    if (cmd === 'extend') return svc.extend(parseDuration(String(p.for ?? '15m'), Date.now())?.minutes ?? 15);
    if (cmd === 'blockers') return svc.blockers();
    if (cmd === 'stats') return svc.stats();
    const spec = specFromCli(p);
    if (cmd === 'toggle') return svc.toggle(spec);
    return svc.begin(spec);
  });

  menuBar.init(svc);
  onFeature('keepAwake', () => menuBar.update(svc.status()));
  // Showing or hiding its own menu-bar icon (Settings) takes effect straight away.
  onSettings((next, prev) => { if (next.awake?.menuItem !== prev?.awake?.menuItem) void menuBar.update(svc.status()); });
}

/** keeper://awake?for=30m | ?until=18:30 | ?app=Name ; keeper://awake/off (or ?do=off) ; keeper://awake/toggle ; /extend?for=30m */
export function handleAwakeLink(u: URL) {
  if (!svc) return;
  const verb = u.pathname.replace(/^\/+/, '') || u.searchParams.get('do') || (u.searchParams.get('on') === 'false' ? 'off' : 'on');
  const p: Record<string, unknown> = { source: 'link' };
  for (const [k, v] of u.searchParams) p[k] = v;
  if (p.app) p['while-app'] = p.app;
  if (p.minutes) p.for = p.minutes;
  const run = async () => {
    if (verb === 'off') return svc.stop();
    if (verb === 'toggle') return svc.toggle(specFromCli(p));
    if (verb === 'extend') return svc.extend(parseDuration(String(p.for ?? '15m'), Date.now())?.minutes ?? 15);
    return svc.begin(specFromCli(p));
  };
  void run().catch(() => undefined);
}

// ---------------------------------------------------------------- the separate menu-bar / tray item

const iconCache = new Map<string, Electron.NativeImage>();

async function icon(style: IconStyle, on: boolean): Promise<Electron.NativeImage> {
  const key = `${style}:${on}`;
  const hit = iconCache.get(key);
  if (hit) return hit;
  const mac = process.platform === 'darwin';
  // macOS: black template images the system tints; elsewhere colour (the owl in Keeper's gradient while awake).
  const svg = Buffer.from(svgFor(style, on, mac ? '#000000' : trayColor(on), { colour: !mac }));
  let img = nativeImage.createEmpty();
  try {
    const sharp = (await import('sharp')).default;
    const one = await sharp(svg, { density: 72 }).resize(22, 22).png().toBuffer();
    const two = await sharp(svg, { density: 144 }).resize(44, 44).png().toBuffer();
    img = nativeImage.createFromBuffer(one, { scaleFactor: 1 });
    img.addRepresentation({ scaleFactor: 2, buffer: two });
    if (mac) img.setTemplateImage(true);
  } catch {
    /* no image library: fall back to Keeper's own tray picture */
  }
  if (img.isEmpty()) {
    const file = path.join(__dirname, '..', 'build', mac ? 'trayTemplate.png' : 'tray-color.png');
    img = nativeImage.createFromPath(file);
    if (!mac && !img.isEmpty()) img = img.resize({ width: process.platform === 'win32' ? 16 : 22, quality: 'best' });
  }
  iconCache.set(key, img);
  return img;
}

/** Keep Awake's own menu-bar item is showing (it shows the time left itself). */
export function awakeItemShown(): boolean {
  return !!menuBar.tray && !menuBar.tray.isDestroyed();
}

const menuBar = {
  tray: null as Tray | null,
  svc: null as AwakeService | null,
  timer: null as NodeJS.Timeout | null,
  last: '',
  init(s: AwakeService) {
    this.svc = s;
    void this.update(s.status());
  },
  async update(st: AwakeStatus) {
    const cfg = settings().awake;
    const want = cfg.menuItem && featureOn('keepAwake') && app.isReady();
    if (!want) {
      this.tray?.destroy();
      this.tray = null;
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      return;
    }
    if (!this.tray) {
      this.tray = new Tray(await icon(cfg.iconStyle, st.on));
      // Left click toggles; right click opens the menu (like the menu-bar item people expect).
      this.tray.on('click', () => void this.svc?.toggle({ source: 'manual' }));
      this.tray.on('right-click', () => this.tray?.popUpContextMenu(this.menu(this.svc!.status())));
    }
    const key = `${cfg.iconStyle}:${st.on}`;
    if (key !== this.last) {
      this.last = key;
      this.tray.setImage(await icon(cfg.iconStyle, st.on));
    }
    this.tray.setToolTip(st.on ? `Keeping awake · ${st.session!.reason}` : 'Keep Awake is off');
    this.tray.setContextMenu(process.platform === 'darwin' ? null : this.menu(st));
    // The remaining time next to the icon (macOS), refreshed once a minute only while a timed session runs.
    const title = () => {
      const s = this.svc!.status();
      return process.platform === 'darwin' && cfg.showRemaining && s.session?.endsAt ? ` ${fmtRemaining(s.session.endsAt - Date.now()).replace(/:\d\d$/, '')}` : '';
    };
    this.tray.setTitle?.(title());
    if (st.session?.endsAt && cfg.showRemaining && process.platform === 'darwin') {
      this.timer ??= setInterval(() => this.tray?.setTitle?.(title()), 30_000);
    } else if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  },
  menu(st: AwakeStatus): Menu {
    const s = this.svc!;
    const cfg = settings().awake;
    const start = (spec: SessionSpec) => void s.begin({ source: 'manual', ...spec });
    const left = st.session?.endsAt ? ` (${fmtDuration(st.session.endsAt - Date.now())} left)` : '';
    return Menu.buildFromTemplate([
      { label: st.on ? `Keeping awake${left}` : 'Keep Awake is off', enabled: false },
      ...(st.on ? [{ label: st.session!.reason, enabled: false }] : []),
      { type: 'separator' },
      st.on ? { label: 'Turn off', click: () => void s.stop() } : { label: 'Indefinitely', click: () => start({}) },
      { label: 'For…', submenu: cfg.quick.map((m) => ({ label: fmtDuration(m * 60_000), click: () => start({ minutes: m }) })) },
      ...(st.on && st.session?.endsAt ? [{ label: 'Add…', submenu: [15, 30, 60].map((m) => ({ label: `${m} min`, click: () => void s.extend(m) })) }] : []),
      { label: 'While…', submenu: [
        { label: 'A download finishes', click: () => start({ while: [{ kind: 'job', value: 'download' }] }) },
        { label: 'Sound is playing', click: () => start({ while: [{ kind: 'audio' }] }) },
        { label: 'On power', click: () => start({ while: [{ kind: 'power' }] }) },
        { label: 'An external display is connected', click: () => start({ while: [{ kind: 'display' }] }) },
        { label: 'An AI agent or terminal runs', click: () => start({ while: [{ kind: 'agent' }] }) },
      ] },
      { label: 'Let the screen sleep', type: 'checkbox', checked: cfg.defaults.display === 'allow-sleep', click: () => void s.saveSettings({ defaults: { ...cfg.defaults, display: cfg.defaults.display === 'allow-sleep' ? 'keep-on' : 'allow-sleep' } }) },
      { type: 'separator' },
      { label: 'Triggers', submenu: cfg.triggers.length ? cfg.triggers.map((t) => ({ label: t.name, type: 'checkbox' as const, checked: t.enabled, click: () => void s.saveTrigger({ ...t, enabled: !t.enabled }) })) : [{ label: 'None yet', enabled: false }] },
      { label: 'Keep Awake settings…', click: () => showPage() },
      { label: 'Hide this icon', click: () => void s.saveSettings({ menuItem: false }) },
    ]);
  },
};
