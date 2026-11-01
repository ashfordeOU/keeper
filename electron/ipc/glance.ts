// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// IPC for the glance (electron/services/glance.ts): what it shows, its quick
// actions, and its settings (Settings → Menu bar).

import { BrowserWindow, ipcMain, shell } from 'electron';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import { normalizeGlanceSettings, type GlanceActionId, type GlanceInputs, type GlanceSettings } from '../../core/glance';
import type { IslandService } from '../services/island';
import { glanceSettings, glanceView, hideGlance, initGlance, showGlance, type GlanceRecent } from '../services/glance';
import { liveState, unwatchLive, watchLive } from '../services/monitor-live';
import { settings, updateSettings } from '../store';

export interface GlanceIpcDeps {
  preload: string;
  load: (win: BrowserWindow, view: string) => void;
  lockDown: (win: BrowserWindow) => void;
  showMain: (route?: string) => void;
  islandSvc: () => IslandService | undefined;
  recent: (n: number) => { list: GlanceRecent[]; total: number };
  run: (action: GlanceActionId) => void;
  quit: () => void;
}

let wifi: { at: number; name?: string } | undefined;

async function inputs(d: GlanceIpcDeps): Promise<GlanceInputs> {
  const now = Date.now();
  const out: GlanceInputs = { now };
  const isl = d.islandSvc();
  const st = isl?.state();
  const w = st?.weather;
  if (w) {
    const code = w.current.code;
    const { describeCode } = await import('../../core/weather');
    out.weather = { place: w.place.name, temp: w.current.temp, units: w.units === 'imperial' ? 'f' : 'c', summary: describeCode(code).label, nowcast: w.nowcast };
  }
  // The disk the home folder is on.
  const fs = await fsp.statfs(os.homedir()).catch(() => null);
  if (fs) out.disk = { total: Number(fs.blocks) * Number(fs.bsize), free: Number(fs.bavail) * Number(fs.bsize), name: process.platform === 'win32' ? `${os.homedir().slice(0, 2)} drive` : 'Main disk' };
  // This computer and the network from the live readings (running only while the glance is open).
  watchLive('glance', 2000, ['cpu', 'mem', 'net', 'battery']);
  const r = liveState().latest;
  const mem = { used: os.totalmem() - os.freemem(), total: os.totalmem() };
  out.system = { cpu: r?.cpu ?? 0, memUsed: r?.memUsed ?? mem.used, memTotal: r?.memTotal ?? mem.total, battery: r?.battery !== undefined ? { percent: r.battery, charging: !!r.charging } : st?.battery ? { percent: st.battery.percent, charging: st.battery.charging } : undefined };
  if (!wifi || now - wifi.at > 60_000) {
    const { wifiName } = await import('../services/devices');
    wifi = { at: now, name: await wifiName().catch(() => undefined) };
  }
  const online = Object.values(os.networkInterfaces()).some((l) => l?.some((a) => !a.internal && a.family === 'IPv4'));
  out.network = { downBps: r?.netIn, upBps: r?.netOut, wifi: wifi.name, online };
  if (isl) out.awake = { on: isl.awake.on, until: isl.awake.until, reason: isl.awake.reason };
  try {
    const { usage } = await import('../services/island-tools');
    out.usage = (await usage()).flatMap((u) => u.windows.filter((x) => typeof x.usedPercent === 'number').map((x) => ({ label: `${u.label} · ${x.label}`, percent: x.usedPercent!, resetsAt: x.resetsAt })));
  } catch {
    /* no AI tools here */
  }
  const next = (st?.events ?? []).filter((e) => !e.allDay && e.end > now).sort((a, b) => a.start - b.start)[0];
  if (next) out.next = { title: next.title, start: next.start, link: (next as { url?: string }).url };
  return out;
}

export function registerGlanceIpc(d: GlanceIpcDeps) {
  initGlance({ preload: d.preload, load: d.load, lockDown: d.lockDown, settings: () => settings().glance, inputs: () => inputs(d), recent: d.recent });
  ipcMain.handle('glance.view', () => glanceView());
  // Opens it as a click on the owl would (the command palette, tests).
  ipcMain.handle('glance.show', () => showGlance(null, 'click'));
  ipcMain.handle('glance.settings', () => glanceSettings());
  ipcMain.handle('glance.setSettings', async (_e, patch: Partial<GlanceSettings>) => {
    const next = normalizeGlanceSettings({ ...glanceSettings(), ...patch });
    await updateSettings({ glance: next });
    return next;
  });
  ipcMain.handle('glance.close', () => { hideGlance(); unwatchLive('glance'); });
  ipcMain.handle('glance.run', (_e, id: GlanceActionId) => { hideGlance(); d.run(id); });
  // A card or "See all": a page in the main window, a meeting link, or a quick action.
  ipcMain.handle('glance.open', (_e, target: string) => {
    hideGlance();
    if (target === 'action:quit') d.quit();
    else if (target.startsWith('action:')) d.run(target.slice(7) as GlanceActionId);
    else if (/^link:https?:\/\//.test(target)) void shell.openExternal(target.slice(5));
    else d.showMain(target);
  });
  ipcMain.handle('glance.openFile', (_e, p: string, how: 'open' | 'show') => {
    hideGlance();
    // Only the downloads the glance listed.
    if (!d.recent(50).list.some((f) => f.path === p)) return;
    if (how === 'show') shell.showItemInFolder(p);
    else void shell.openPath(p);
  });
}
