// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// IPC for remote screens (view and control other Keeper devices, phones on
// this screen, Wake-on-LAN) and the cross-device "Send to" sheet.

import { app, ipcMain, type BrowserWindow } from 'electron';
import path from 'node:path';
import type { ControlMessage, InputEvent, Quality } from '../../core/screen/types';
import { readText, writeText } from '../services/clip';
import { featureOn, onFeature } from '../services/features';
import { linkNode } from '../services/link';
import { setScreenService } from '../services/link/access';
import { ScreenService } from '../services/screen';
import { hardwareEncodeSwitches } from '../../core/screen/extras';
import { unattendedInstalledSync } from '../services/screen/unattended';
import { injector, requestMacPermissions } from '../services/screen/injector';
import { airplay, airplayStart, airplayStop, androidConnect, androidDevices, androidDrop, androidMirror, androidPair, androidStatus, androidStop, installAndroidTools, stopPhones } from '../services/screen/phones';

const DEV_URL = process.env.VITE_DEV_SERVER_URL;

// Direct screen connections between Keeper devices on the same network need the
// real local addresses in WebRTC, not the random .local names Chromium uses by
// default (those need multicast DNS, which many networks block). Set before the app is ready.
{
  const cur = app.commandLine.getSwitchValue('disable-features');
  app.commandLine.appendSwitch('disable-features', [cur, 'WebRtcHideLocalIpsWithMdns'].filter(Boolean).join(','));
  // Let Chromium use the graphics card's video encoder for remote screens where it can.
  const hw = hardwareEncodeSwitches(process.platform);
  if (hw.length) {
    const en = app.commandLine.getSwitchValue('enable-features');
    app.commandLine.appendSwitch('enable-features', [en, ...hw].filter(Boolean).join(','));
  }
}

function loadView(win: BrowserWindow, query: Record<string, string>) {
  if (DEV_URL) void win.loadURL(`${DEV_URL}?${new URLSearchParams(query)}`);
  else void win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { query });
}

function handle(name: string, fn: (...args: never[]) => unknown) {
  ipcMain.handle(name, async (_e, ...args) => fn(...(args as never[])));
}

let svc: ScreenService | null = null;

export async function registerScreenIpc(d: { broadcast: (channel: string, ...args: unknown[]) => void; show: (route?: string) => void; preload: string; alert: (title: string, detail?: string) => void }) {
  svc = new ScreenService({
    node: linkNode,
    broadcast: d.broadcast,
    show: d.show,
    preload: d.preload,
    loadView,
    alert: d.alert,
    clipboard: { read: readText, write: writeText },
    videos: () => app.getPath('videos'),
    unattended: unattendedInstalledSync,
  });
  setScreenService(svc);
  const need = () => svc!;
  handle('screen.state', () => need().state());
  handle('screen.session', (sid: string) => need().session(sid));
  handle('screen.view', (device: string, o?: { control?: boolean; quality?: Quality; prefer?: 'auto' | 'frames'; tab?: boolean }) => need().view(device, o));
  handle('screen.sources', (sid: string) => need().sources(sid));
  handle('screen.setControl', (sid: string, on: boolean) => need().setControl(sid, on));
  handle('screen.print', (sid: string, file: string) => need().print(sid, file));
  handle('screen.reboot', (sid: string) => need().rebootAndReconnect(sid));
  handle('screen.invites', () => need().invites());
  handle('screen.joinInvite', (id: string, tab?: boolean) => need().joinInvite(id, tab));
  handle('screen.stop', (sid: string) => need().stop(sid));
  handle('screen.answer', (id: string, ok: boolean, control: boolean) => need().answer(id, ok, control));
  handle('screen.setPolicy', (p: never) => need().setPolicy(p));
  handle('screen.displays', () => need().displays());
  handle('screen.source', (sid: string) => need().source(sid));
  handle('screen.signal', (sid: string, m: ControlMessage) => need().signal(sid, m));
  handle('screen.frame', (sid: string, jpeg: Uint8Array, w: number, h: number) => need().frame(sid, jpeg, w, h));
  handle('screen.saveRecording', (bytes: Uint8Array, name: string) => need().saveRecording(bytes, name));
  handle('screen.wake', (device: string) => need().wake(device));
  handle('screen.learn', (device: string) => need().learn(device));
  handle('screen.control', async () => injector().status());
  handle('screen.requestPermissions', () => requestMacPermissions());
  handle('screen.android', () => androidStatus());
  handle('screen.androidInstall', () => installAndroidTools((f) => d.broadcast('screen-android-progress', f)));
  handle('screen.androidDevices', () => androidDevices());
  handle('screen.androidPair', (hp: string, code: string) => androidPair(hp, code));
  handle('screen.androidConnect', (hp: string) => androidConnect(hp));
  const phonesOn = () => {
    if (!featureOn('mirroring')) throw new Error('Phones on this screen are switched off in Settings → Features');
  };
  handle('screen.androidMirror', (o: never) => (phonesOn(), androidMirror(o)));
  handle('screen.androidStop', (serial: string) => androidStop(serial));
  handle('screen.androidDrop', (serial: string, files: string[]) => androidDrop(serial, files));
  handle('screen.airplay', () => airplay());
  handle('screen.airplayStart', (name: string) => (phonesOn(), airplayStart(name)));
  onFeature('mirroring', (on) => !on && stopPhones());
  handle('screen.airplayStop', () => airplayStop());
  // Fire-and-forget from the viewer window: input batches and frame acknowledgements.
  ipcMain.on('screen.input', (_e, sid: string, events: InputEvent[]) => svc?.sendInput(sid, events));
  ipcMain.on('screen.ack', (_e, sid: string, seq: number) => svc?.ack(sid, seq));
  ipcMain.on('screen.ready', (_e, sid: string) => svc?.windowReady(sid));
  // Link starts in the background; attach once its node exists.
  for (let i = 0; i < 120 && !linkNode(); i++) await new Promise((r) => setTimeout(r, 250));
  await svc.start();
}

export function stopScreen() {
  svc?.stopAll();
  stopPhones();
}
