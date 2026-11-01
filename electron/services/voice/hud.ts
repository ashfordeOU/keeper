// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The listening pill: a small floating window that never takes focus from the
// app you're typing in. It also records: the microphone (and on Windows the
// computer's sound) is captured here and streamed to the main process as
// 16 kHz samples. Made on first use; let go two minutes after the last.

import { BrowserWindow, desktopCapturer, screen, session } from 'electron';
import path from 'node:path';
import type { Corner } from '../../../core/voice/types';

export type HudShape = 'pill' | 'review' | 'offer' | 'meeting' | 'hidden';

const SIZES: Record<Exclude<HudShape, 'hidden'>, { w: number; h: number }> = {
  pill: { w: 420, h: 76 },
  review: { w: 460, h: 220 },
  offer: { w: 400, h: 168 },
  meeting: { w: 360, h: 76 },
};

const DEV_URL = process.env.VITE_DEV_SERVER_URL;

export class Hud {
  private win: BrowserWindow | null = null;
  private loaded: Promise<void> | null = null;
  private idle?: NodeJS.Timeout;
  shape: HudShape = 'hidden';

  constructor(private o: { preload: string; lockDown(w: BrowserWindow): void; corner(): Corner }) {}

  get alive() { return !!this.win && !this.win.isDestroyed(); }
  get webContents() { return this.alive ? this.win!.webContents : null; }

  ensure(): Promise<void> {
    clearTimeout(this.idle);
    if (this.alive && this.loaded) return this.loaded;
    const ses = session.fromPartition('keeper-voice');
    // Windows: the computer's sound comes from loopback capture of the screen's audio.
    if (process.platform === 'win32') {
      ses.setDisplayMediaRequestHandler((_req, cb) => {
        void desktopCapturer.getSources({ types: ['screen'] }).then((s) => cb({ video: s[0], audio: 'loopback' }), () => cb({}));
      });
    }
    ses.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'media' || perm === 'display-capture'));
    const win = new BrowserWindow({
      width: SIZES.pill.w, height: SIZES.pill.h, show: false, frame: false, transparent: true, resizable: false, movable: false,
      alwaysOnTop: true, skipTaskbar: true, focusable: false, hasShadow: false, fullscreenable: false, minimizable: false, maximizable: false,
      title: 'Keeper Voice',
      webPreferences: { preload: this.o.preload, contextIsolation: true, sandbox: false, partition: 'keeper-voice', backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.o.lockDown(win);
    this.win = win;
    win.on('closed', () => { this.win = null; this.loaded = null; this.shape = 'hidden'; });
    this.loaded = new Promise<void>((resolve) => {
      win.webContents.once('did-finish-load', () => resolve());
      if (DEV_URL) void win.loadURL(`${DEV_URL}?view=voice`);
      else void win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { query: { view: 'voice' } });
    });
    return this.loaded;
  }

  send(channel: string, ...args: unknown[]) {
    if (this.alive) this.win!.webContents.send(`event:${channel}`, ...args);
  }

  /** Shows the window in the chosen corner of the screen with the pointer. */
  show(shape: HudShape) {
    this.shape = shape;
    if (!this.alive) return;
    if (shape === 'hidden') { this.win!.hide(); return; }
    const { w, h } = SIZES[shape];
    const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const c = this.o.corner();
    const m = 18;
    const x = c.endsWith('left') ? d.x + m : c.endsWith('right') ? d.x + d.width - w - m : Math.round(d.x + (d.width - w) / 2);
    const y = c.startsWith('top') ? d.y + m + (c === 'top' ? 36 : 0) : d.y + d.height - h - m;
    this.win!.setBounds({ x, y, width: w, height: h });
    this.win!.showInactive();
  }

  /** Lets the window go a while after nothing needs it. */
  releaseSoon(ms = 120_000) {
    clearTimeout(this.idle);
    this.idle = setTimeout(() => { if (this.shape === 'hidden') this.destroy(); }, ms);
    this.idle.unref?.();
  }

  destroy() {
    clearTimeout(this.idle);
    if (this.alive) this.win!.destroy();
    this.win = null;
    this.loaded = null;
  }
}
