// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Remote screens over Keeper Link.
//
//   viewer device                       host device
//   ─────────────                       ───────────
//   viewer window ⇄ main ── Link ──▶ main ⇄ host window (small banner that
//                       'screen.ctl' stream          captures the screen)
//                       ◀─ 'screen.frames' stream (fallback picture)
//                       ◀════ WebRTC video (direct, when it connects) ════
//
// The control stream carries the request, the consent answer, the WebRTC offer
// and answer (with their certificate fingerprints), input, chat, clipboard and
// acknowledgements. It is inside the Link channel, so only paired devices can
// speak on it, and every request is checked against the device's permissions
// and asked about on this screen unless the person chose otherwise.

import { app, BrowserWindow, desktopCapturer, Notification, screen } from 'electron';
import crypto from 'node:crypto';
import dgram from 'node:dgram';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Mux, Stream } from '../../../core/link/mux';
import { call } from '../../../core/link/mux';
import { auditTitle, decide, DEFAULT_POLICY, idleExpired, type ScreenPolicy } from '../../../core/screen/consent';
import { decodeFrame, Deframer, encodeFrame, FrameGate, lengthPrefixed } from '../../../core/screen/frames';
import { sanitize } from '../../../core/screen/input';
import { audioPlan, displayAt, followDecision, inviteValid, privacyPlan, sanitizeStroke, type DisplayMode, type Stroke, type ViewerInvite } from '../../../core/screen/extras';
import type { ControlMessage, HostDisplay, HostExtras, InputEvent, Quality, ScreenPath, ScreenSession } from '../../../core/screen/types';
import { magicPacket, wakeableInterfaces } from '../../../core/screen/wol';
import type { LinkNode } from '../link/node';
import { featureOn, onFeature } from '../features';
import { injector } from './injector';
import { trayChanged } from '../link/surfaces';
import { keepUnmanaged, overlayOptions } from '../unmanaged';
import { topClearOfSlider } from '../ashforde/monorail';

type Broadcast = (channel: string, ...args: unknown[]) => void;

export interface ScreenDeps {
  node: () => LinkNode | null;
  broadcast: Broadcast;
  show: (route?: string) => void;
  preload: string;
  loadView: (win: BrowserWindow, query: Record<string, string>) => void;
  alert: (title: string, detail?: string) => void;
  clipboard: { read(): string | Promise<string>; write(text: string): unknown };
  /** where viewer recordings go */
  videos: () => string;
  /** the unattended service is installed here */
  unattended?: () => boolean;
}

interface Sess extends ScreenSession {
  ctl?: Stream;
  frames?: Stream;
  gate: FrameGate;
  win?: BrowserWindow;
  displays: HostDisplay[];
  lastActivity: number;
  quality: Quality;
  /** phone sessions: the newest frame waiting to be fetched */
  latest?: { seq: number; header: { w: number; h: number; at: number }; jpeg: Uint8Array };
  idleTimer?: NodeJS.Timeout;
  controlNote?: string;
  /** messages for a window that has not said it is listening yet */
  backlog?: [string, unknown][];
  ready?: boolean;
  /** shown in a Keeper tab instead of its own window */
  tab?: boolean;
  /** host: view-only invites handed out, and sessions that joined this one */
  invites?: ViewerInvite[];
  parent?: string;
  /** host: one display, all, or the one with the pointer */
  mode?: DisplayMode;
  followTimer?: NodeJS.Timeout;
  followSince?: number;
  cursorTimer?: NodeJS.Timeout;
  /** host: windows drawn over the screen (annotation, blanking) */
  drawWin?: BrowserWindow;
  blankWin?: BrowserWindow;
  blocked?: boolean;
  strokes?: Stroke[];
  /** viewer: restart the host and connect again when it is back */
  reconnect?: boolean;
}

interface Stored {
  policy: ScreenPolicy;
  /** network cards learned from paired devices, for Wake-on-LAN */
  wake: Record<string, { mac: string; broadcast: string }[]>;
  log: { at: number; title: string }[];
}

const send = (st: Stream | undefined, m: ControlMessage | Record<string, unknown>) => st?.write(lengthPrefixed(new TextEncoder().encode(JSON.stringify(m)))).catch(() => undefined);

export class ScreenService {
  private sessions = new Map<string, Sess>();
  private asks = new Map<string, (r: { ok: boolean; control: boolean }) => void>();
  private data: Stored = { policy: { ...DEFAULT_POLICY }, wake: {}, log: [] };
  private file = () => path.join(app.getPath('userData'), 'screen.json');

  constructor(private d: ScreenDeps) {}

  async start() {
    try {
      const j = JSON.parse(await fsp.readFile(this.file(), 'utf8')) as Partial<Stored>;
      this.data = { policy: { ...DEFAULT_POLICY, ...(j.policy ?? {}) }, wake: j.wake ?? {}, log: j.log ?? [] };
    } catch {
      /* first run */
    }
    // Switching the feature off ends every session at once.
    onFeature('remoteScreen', (on) => !on && this.stopAll());
    const node = this.d.node();
    if (!node) return;
    // Permissions are checked in incoming() (decide), so a refused device hears why, not just "not allowed".
    node.registerStream('screen.ctl', null, (st, device) => void this.incoming(st, device));
    // The picture coming back for a session this device started: checked against its own sessions.
    node.registerStream('screen.frames', null, (st, device) => this.incomingFrames(st, device));
    node.registerRpc('screen.shot', 'screenView', (p) => this.shot(String(p.$device ?? '')));
    node.registerRpc('screen.invite', null, (p) => this.invited(String(p.$device ?? ''), p));
    node.registerControl('remote.connect', async (p) => ({ sid: await this.view(String(p.device), { control: !p.view }) }));
    node.registerControl('remote.screenshot', async (p) => this.screenshotOf(String(p.device)));
    node.registerControl('remote.wake', async (p) => this.wake(String(p.device)));
    node.registerControl('remote.help', async (p) => {
      if (p.code) {
        const g = await node.help.join(String(p.code), String(p.password ?? ''), String(p.name ?? node.state().me.name));
        return { sid: await this.view(g.id, { control: false }), name: g.name };
      }
      return node.help.start();
    });
    node.registerRpc('wol.info', null, () => wakeableInterfaces(os.networkInterfaces() as never));
    node.registerRpc('wol.wake', null, async (p) => {
      await sendMagic(String(p.mac), String(p.broadcast));
      return true;
    });
    node.registerCompanionOp('screen.start', (h, _b, cid) => this.phoneStart(cid, !!h.control));
    node.registerCompanionOp('screen.frame', async (h) => this.phoneFrame(String(h.sid), Number(h.after) || 0));
    node.registerCompanionOp('screen.input', async (h, _b, cid) => {
      const s = this.sessions.get(String(h.sid));
      if (!s || s.peer !== `phone:${cid}`) throw new Error('No such session');
      this.input(s, Array.isArray(h.events) ? h.events : []);
      return { r: true };
    });
    node.registerCompanionOp('screen.stop', async (h, _b, cid) => {
      const s = this.sessions.get(String(h.sid));
      if (s && s.peer === `phone:${cid}`) this.end(s, 'The phone stopped watching');
      return { r: true };
    });
  }

  private save() {
    this.data.log = this.data.log.slice(0, 200);
    void fsp.writeFile(this.file(), JSON.stringify(this.data, null, 2), { mode: 0o600 }).catch(() => undefined);
  }

  // ---------------------------------------------------------------- what the windows see

  state() {
    return {
      sessions: [...this.sessions.values()].map(publicSession),
      policy: this.data.policy,
      log: this.data.log.slice(0, 50),
      wake: Object.fromEntries(Object.entries(this.data.wake).map(([k, v]) => [k, v.length > 0])),
    };
  }

  session(id: string) {
    const s = this.sessions.get(id);
    return s ? { ...publicSession(s), displays: s.displays, controlNote: s.controlNote } : null;
  }

  setPolicy(p: Partial<ScreenPolicy>) {
    this.data.policy = { ...this.data.policy, ...p, unattended: { ...this.data.policy.unattended, ...(p.unattended ?? {}) } };
    this.save();
    this.changed();
    return this.data.policy;
  }

  private changed() {
    trayChanged();
    this.d.broadcast('screen-state', this.state());
  }

  async displays(): Promise<HostDisplay[]> {
    const prim = screen.getPrimaryDisplay().id;
    return screen.getAllDisplays().map((d, i) => ({
      id: String(d.id), label: d.label || (d.id === prim ? 'Main screen' : `Screen ${i + 1}`),
      x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height, scale: d.scaleFactor, primary: d.id === prim,
    }));
  }

  /** The capture source for a display (desktopCapturer ids are not display ids). */
  async source(sid: string): Promise<{ id: string; width: number; height: number } | null> {
    const s = this.sessions.get(sid);
    if (!s || s.role !== 'host') return null;
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } });
    const i = Math.max(0, s.displays.findIndex((d) => d.id === s.display));
    const src = sources.find((x) => x.display_id === s.display) ?? sources[i] ?? sources[0];
    const disp = s.displays[i];
    if (!src) return null;
    return { id: src.id, width: Math.round((disp?.width ?? 1920) * (disp?.scale ?? 1)), height: Math.round((disp?.height ?? 1080) * (disp?.scale ?? 1)) };
  }

  /** Every display's capture source (for "All screens"), with where each display sits. */
  async sources(sid: string): Promise<{ id: string; width: number; height: number; display: HostDisplay }[]> {
    const s = this.sessions.get(sid);
    if (!s || s.role !== 'host') return [];
    const list = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } });
    return s.displays.map((d, i) => {
      const src = list.find((x) => x.display_id === d.id) ?? list[i];
      return src ? { id: src.id, width: Math.round(d.width * d.scale), height: Math.round(d.height * d.scale), display: d } : null;
    }).filter((x): x is { id: string; width: number; height: number; display: HostDisplay } => !!x);
  }

  // ---------------------------------------------------------------- viewing another device

  /** Starts watching a paired device's screen; opens the viewer window. */
  async view(device: string, opts: { control?: boolean; quality?: Quality; prefer?: 'auto' | 'frames'; tab?: boolean; join?: { sid: string; token: string } } = {}): Promise<string> {
    const node = this.d.node();
    if (!node) throw new Error('Keeper Link is starting');
    if (!featureOn('remoteScreen')) throw new Error('Remote screens are switched off in Settings → Features');
    const dev = node.peer(device);
    if (!dev) throw new Error('That device is not paired');
    const help = dev.help === 'helper';
    const mux = await node.connect(device);
    if (!help) void this.learnWake(device, mux);
    const sid = crypto.randomUUID();
    const s: Sess = {
      id: sid, peer: device, peerName: dev.name, role: 'viewer', control: !!opts.control && !opts.join && !help, state: 'asking', started: Date.now(),
      gate: new FrameGate(), displays: [], lastActivity: Date.now(), quality: opts.quality ?? 'auto', tab: !!opts.tab, help, joined: !!opts.join,
    };
    this.sessions.set(sid, s);
    const st = mux.open({ k: 'screen.ctl', sid });
    s.ctl = st;
    this.readCtl(s, st);
    void send(st, { t: 'start', sid, control: s.control, quality: s.quality, name: node.state().me.name, prefer: opts.prefer, join: opts.join, help });
    if (!s.tab) this.openViewer(s);
    this.changed();
    return sid;
  }

  private openViewer(s: Sess) {
    const w = new BrowserWindow({
      width: 1180, height: 760, minWidth: 480, minHeight: 320, title: `${s.peerName} — Keeper`, show: true, backgroundColor: '#000000',
      webPreferences: { preload: this.d.preload, contextIsolation: true, sandbox: true, backgroundThrottling: false },
    });
    s.win = w;
    this.d.loadView(w, { view: 'screenviewer', sid: s.id });
    w.on('closed', () => {
      s.win = undefined;
      if (s.state !== 'ended') this.end(s, 'Closed the viewer');
    });
  }

  // ---------------------------------------------------------------- being viewed

  private async incoming(st: Stream, device: string) {
    const node = this.d.node();
    const dev = node?.peer(device);
    let s: Sess | undefined;
    const first = new Promise<ControlMessage | null>((resolve) => {
      const de = new Deframer((m) => {
        const msg = parse(m);
        if (!s) return resolve(msg);
        void this.onCtl(s, msg);
      });
      st.ondata = (c) => de.push(c);
      st.onend = () => (s ? this.end(s, 'The other device stopped') : resolve(null));
      st.onreset = (r) => (s ? this.end(s, r) : resolve(null));
      void st.start();
      setTimeout(() => resolve(null), 15_000);
    });
    const start = await first;
    if (!start || start.t !== 'start' || !dev) {
      st.reset('bad start');
      return;
    }
    const parent = start.join ? this.sessions.get(start.join.sid) : undefined;
    const decision = !featureOn('remoteScreen')
      ? { do: 'deny' as const, reason: 'Remote screens are switched off on that computer' }
      : dev.help === 'host'
        ? // Help: the code and password were the consent to be seen. Control only when the person here gives it.
          ({ do: 'allow' as const, control: false })
        : dev.help
          ? { do: 'deny' as const, reason: 'Not in a help session' }
          : start.join
            ? parent && parent.role === 'host' && parent.state !== 'ended' && inviteValid(parent.invites?.find((i) => i.token === start.join!.token), device, start.join.token) && dev.permissions.screenView
              ? ({ do: 'allow' as const, control: false })
              : { do: 'deny' as const, reason: 'That invitation has expired' }
            : decide({ from: 'device', id: device, wantsControl: start.control, perms: dev.permissions }, this.data.policy);
    if (decision.do === 'deny') {
      await send(st, { t: 'bye', reason: decision.reason });
      st.end();
      return;
    }
    let control = decision.control;
    if (decision.do === 'ask') {
      const r = await this.ask(dev.name, control);
      if (!r.ok) {
        await send(st, { t: 'bye', reason: `${node?.state().me.name ?? 'The other computer'} said no` });
        st.end();
        return;
      }
      control = r.control;
    }
    s = await this.hostSession(start.sid, device, dev.name, control, start.quality, start.prefer === 'frames' ? 'frames' : 'p2p', { help: dev.help === 'host', parent: parent?.id });
    s.ctl = st;
    const inj = await injector().status();
    if (control && !inj.available) {
      s.control = false;
      s.controlNote = inj.reason;
    }
    await send(st, { t: 'hello', displays: s.displays, display: s.display!, os: process.platform, control: s.control, controlNote: s.controlNote ?? (s.help ? 'View only. The person you are helping can let you control their computer.' : undefined), extras: await this.extras(s) });
    this.openHost(s);
    this.startCursor(s);
  }

  /** What this host can offer in the session (sound, privacy, windows), for the viewer's menus. */
  private async extras(s: Sess): Promise<HostExtras> {
    const mac = process.platform === 'darwin' ? Number(os.release().split('.')[0]) - 9 : 0;
    const a = audioPlan(process.platform, mac);
    const pr = privacyPlan(process.platform);
    const windows = s.help ? [] : await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 1, height: 1 } }).then((l) => l.filter((w) => w.name && !/^Keeper —/.test(w.name)).slice(0, 40).map((w) => ({ id: w.id, name: w.name.slice(0, 80) })), () => []);
    return { audio: a.how !== 'none' && featureOn('screenExtras'), audioNote: a.note, blank: pr.blank, blankNote: pr.blankNote, block: pr.block, blockNote: pr.blockNote, windows, unattended: !!this.d.unattended?.(), help: s.help, viewers: [...this.sessions.values()].filter((x) => x.role === 'host' && x.state !== 'ended').length };
  }

  /** The host's pointer, ten times a second while it moves, for the viewer's cursor overlay. */
  private startCursor(s: Sess) {
    let last = '';
    s.cursorTimer = setInterval(() => {
      if (s.state === 'ended') return clearInterval(s.cursorTimer);
      const p = screen.getCursorScreenPoint();
      const d = s.displays.find((x) => x.id === s.display) ?? s.displays[0];
      if (!d) return;
      const x = (p.x - d.x) / d.width;
      const y = (p.y - d.y) / d.height;
      const key = `${x.toFixed(3)},${y.toFixed(3)}`;
      if (key === last) return;
      last = key;
      if (x >= 0 && x <= 1 && y >= 0 && y <= 1) void send(s.ctl, { t: 'cursor', x, y });
      // Follow the pointer: switch screens when it stays on another one for a moment.
      if (s.mode === 'follow') {
        const under = displayAt(s.displays, p.x, p.y)?.id;
        const dec = followDecision(s.display, under, s.followSince ?? Date.now(), Date.now());
        s.followSince = dec.since;
        if (dec.switchTo) {
          s.display = dec.switchTo;
          this.toWin(s, 'screen-signal', { t: 'display', id: dec.switchTo });
          void send(s.ctl, { t: 'display', id: dec.switchTo });
        }
      }
    }, 100);
    s.cursorTimer.unref?.();
  }

  private async hostSession(sid: string, peer: string, peerName: string, control: boolean, quality: Quality, path: ScreenPath, more: { help?: boolean; parent?: string } = {}): Promise<Sess> {
    const displays = await this.displays();
    const s: Sess = {
      id: /^[\w-]{8,64}$/.test(sid) && !this.sessions.has(sid) ? sid : crypto.randomUUID(), peer, peerName, role: 'host', control, state: 'connecting', path,
      display: (displays.find((d) => d.primary) ?? displays[0])?.id, started: Date.now(), gate: new FrameGate(), displays, lastActivity: Date.now(), quality,
      help: more.help, parent: more.parent, joined: !!more.parent, mode: 'one',
    };
    this.sessions.set(s.id, s);
    s.idleTimer = setInterval(() => {
      if (idleExpired(Date.now(), s.lastActivity, this.data.policy)) this.end(s, 'Ended after a while with no activity');
    }, 30_000);
    s.idleTimer.unref?.();
    this.d.alert(`${peerName} is ${control ? 'controlling' : 'viewing'} this screen`, more.help ? 'Help session: view only until you allow control. Stop from the banner.' : 'Stop sharing from the banner at the top of the screen.');
    this.changed();
    return s;
  }

  /** The small always-on-top banner that also does the capturing. */
  private openHost(s: Sess) {
    const area = screen.getPrimaryDisplay().workArea;
    // A second viewer joins an existing session: its capture runs in a hidden window; the first banner says how many watch.
    const joined = !!s.parent;
    const width = s.help ? 560 : 480;
    const w = new BrowserWindow({
      ...overlayOptions('sharing'),
      width, height: 46, x: Math.round(area.x + area.width / 2 - width / 2), y: topClearOfSlider(area, area.y + 6), frame: false, resizable: false, movable: true,
      alwaysOnTop: true, skipTaskbar: true, focusable: true, show: !joined, transparent: false, backgroundColor: '#1c1c1e', title: 'Keeper — sharing this screen',
      webPreferences: { preload: this.d.preload, contextIsolation: true, sandbox: true, backgroundThrottling: false },
    });
    keepUnmanaged(w, 'sharing');
    w.setAlwaysOnTop(true, 'screen-saver');
    w.setContentProtection(false);
    s.win = w;
    this.d.loadView(w, { view: 'screenhost', sid: s.id });
    w.on('closed', () => {
      s.win = undefined;
      if (s.state !== 'ended') this.end(s, 'Stopped sharing');
    });
  }

  private ask(name: string, control: boolean): Promise<{ ok: boolean; control: boolean }> {
    const id = crypto.randomUUID();
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        this.asks.delete(id);
        resolve({ ok: false, control: false });
      }, 60_000);
      this.asks.set(id, (r) => {
        clearTimeout(t);
        this.asks.delete(id);
        resolve(r);
      });
      this.d.broadcast('screen-ask', { id, name, control });
      this.d.show();
      if (Notification.isSupported()) new Notification({ title: `${name} wants to ${control ? 'control' : 'see'} this screen`, body: 'Open Keeper to allow or refuse.' }).show();
    });
  }

  answer(id: string, ok: boolean, control: boolean) {
    this.asks.get(id)?.({ ok, control });
  }

  // ---------------------------------------------------------------- the control stream

  private readCtl(s: Sess, st: Stream) {
    const de = new Deframer((m) => void this.onCtl(s, parse(m)));
    st.ondata = (c) => de.push(c);
    st.onend = () => this.end(s, 'The other device stopped');
    st.onreset = (r) => this.end(s, r || 'The connection closed');
    void st.start();
  }

  private async onCtl(s: Sess, m: ControlMessage | null) {
    if (!m) return;
    s.lastActivity = Date.now();
    switch (m.t) {
      case 'hello':
        if (s.role !== 'viewer') return;
        s.displays = m.displays;
        s.display = m.display;
        s.control = m.control;
        s.controlNote = m.controlNote;
        s.state = 'connecting';
        this.toWin(s, 'screen-signal', m);
        this.changed();
        return;
      case 'sdp':
      case 'ice':
      case 'path':
      case 'stats':
        if (m.t === 'path') s.path = m.path;
        if (m.t === 'path' || m.t === 'sdp') {
          s.state = 'live';
          this.changed();
        }
        this.toWin(s, 'screen-signal', m);
        return;
      case 'input':
        if (s.role === 'host') this.input(s, m.events);
        return;
      case 'ack':
        s.gate.ack(m.seq, Date.now());
        return;
      case 'display':
        if (s.role === 'host' && s.displays.some((d) => d.id === m.id)) {
          s.display = m.id;
          this.toWin(s, 'screen-signal', m);
        }
        return;
      case 'quality':
        s.quality = m.q;
        this.toWin(s, 'screen-signal', m);
        return;
      case 'chat':
        this.toWin(s, 'screen-signal', m);
        if (s.role === 'host') this.d.alert(`${s.peerName}: ${m.text.slice(0, 120)}`);
        return;
      case 'clip':
        // The host takes clipboard text only from a viewer allowed to control it; the viewer takes the host's answer.
        if (s.role === 'host' && !s.control) return;
        await this.d.clipboard.write(m.text.slice(0, 1_000_000));
        this.toWin(s, 'screen-signal', { t: 'clip-done' });
        return;
      case 'clipget':
        if (s.role === 'host' && s.control) await send(s.ctl, { t: 'clip', text: String(await this.d.clipboard.read()) });
        return;
      case 'grant':
        // The host gave or took back control (viewer side).
        if (s.role !== 'viewer') return;
        s.control = m.control;
        this.toWin(s, 'screen-signal', m);
        this.changed();
        return;
      case 'mode':
        if (s.role !== 'host' || !['one', 'all', 'follow'].includes(m.mode)) return;
        // Several screens at once and following the pointer are Remote screen extras.
        if (m.mode !== 'one' && !featureOn('screenExtras')) return;
        s.mode = m.mode;
        this.toWin(s, 'screen-signal', m);
        return;
      case 'voice':
        // Voice chat is one of the Remote screen extras.
        if (!featureOn('screenExtras')) return;
        this.toWin(s, 'screen-signal', m);
        return;
      case 'window':
      case 'tune':
        this.toWin(s, 'screen-signal', m);
        return;
      case 'cursor':
        if (s.role === 'viewer') this.toWin(s, 'screen-signal', m);
        return;
      case 'privacy':
        if (s.role === 'host' && s.control) await this.privacy(s, m);
        return;
      case 'draw':
        if (s.role === 'host' && !s.joined && featureOn('screenExtras')) this.draw(s, m);
        return;
      case 'invite':
        if (s.role === 'host' && !s.help && !s.joined && featureOn('screenExtras')) {
          const inv: ViewerInvite = { token: crypto.randomBytes(18).toString('base64url'), device: String(m.device ?? ''), expires: Date.now() + 10 * 60_000 };
          s.invites = [...(s.invites ?? []).filter((i) => i.expires > Date.now()), inv].slice(-10);
          await send(s.ctl, { t: 'invited', device: inv.device, token: inv.token });
        }
        return;
      case 'invited':
        if (s.role === 'viewer') await this.passInvite(s, m.device, m.token);
        return;
      case 'switch':
        if (s.role === 'host' && !s.help && !s.joined) {
          const peer = s.peer;
          this.end(s, 'Switched sides');
          void this.view(peer, { control: false }).catch((e) => this.d.alert('Could not switch sides', e instanceof Error ? e.message : String(e)));
        }
        return;
      case 'reboot':
        if (s.role === 'host' && s.control && !s.help) {
          const { powerCommand } = await import('../../../core/link/actions');
          const c = powerCommand('restart', process.platform);
          this.d.node()?.audit({ kind: 'power', direction: 'in', device: s.peer, deviceName: s.peerName, title: `${s.peerName} restarted this computer from a screen session`, ok: true });
          this.end(s, 'Restarting');
          const { run } = await import('../../../core/platform');
          setTimeout(() => void run(c.file, c.args, 20_000), 500);
        }
        return;
      case 'printed':
        this.toWin(s, 'screen-signal', m);
        return;
      case 'bye':
        this.end(s, m.reason, false);
        return;
    }
  }

  /** Host: darken this screen for people in the room, and/or block its own keyboard and mouse. */
  private async privacy(s: Sess, m: { blank?: boolean; block?: boolean }) {
    const pr = privacyPlan(process.platform);
    if (m.blank !== undefined && pr.blank) {
      if (m.blank && !s.blankWin) {
        const d = screen.getAllDisplays().find((x) => String(x.id) === s.display) ?? screen.getPrimaryDisplay();
        const w = new BrowserWindow({ ...d.bounds, frame: false, show: false, alwaysOnTop: true, skipTaskbar: true, focusable: false, backgroundColor: '#000000', webPreferences: { sandbox: true, contextIsolation: true } });
        // Hidden from screen capture (Windows 10 2004+, macOS): the viewer still sees the real screen.
        w.setContentProtection(true);
        w.setAlwaysOnTop(true, 'screen-saver');
        w.setIgnoreMouseEvents(true);
        void w.loadURL('data:text/html,' + encodeURIComponent('<body style="margin:0;background:#000;color:#666;font:15px system-ui;display:grid;place-items:center;height:100vh">This screen is being used from another computer.</body>'));
        w.showInactive();
        s.blankWin = w;
      } else if (!m.blank && s.blankWin) {
        s.blankWin.destroy();
        s.blankWin = undefined;
      }
    }
    if (m.block !== undefined) {
      const ok = (await injector().block?.(m.block)) ?? false;
      s.blocked = m.block && ok;
      if (m.block && !ok) await send(s.ctl, { t: 'chat', text: pr.block ? 'Blocking the keyboard and mouse here needs Keeper to run as administrator (or the unattended service).' : pr.blockNote ?? 'Not possible here.', at: Date.now() });
    }
  }

  /** Host: draws the viewer's strokes over this screen (click-through), for teaching. */
  private draw(s: Sess, m: { stroke?: unknown; clear?: boolean }) {
    if (m.clear) {
      s.strokes = [];
      s.drawWin?.destroy();
      s.drawWin = undefined;
      return;
    }
    const stroke = sanitizeStroke(m.stroke);
    if (!stroke) return;
    s.strokes = [...(s.strokes ?? []), stroke].slice(-500);
    if (!s.drawWin || s.drawWin.isDestroyed()) {
      const d = screen.getAllDisplays().find((x) => String(x.id) === s.display) ?? screen.getPrimaryDisplay();
      const w = new BrowserWindow({ ...d.bounds, frame: false, transparent: true, show: false, alwaysOnTop: true, skipTaskbar: true, focusable: false, hasShadow: false, webPreferences: { sandbox: true, contextIsolation: true } });
      w.setIgnoreMouseEvents(true);
      w.setAlwaysOnTop(true, 'screen-saver');
      const html = '<body style="margin:0;background:transparent;overflow:hidden"><canvas id=c></canvas><script>const c=document.getElementById("c");c.width=innerWidth;c.height=innerHeight;window.drawStroke=(s)=>{const x=c.getContext("2d");x.strokeStyle=s.color;x.lineWidth=s.width;x.lineCap="round";x.lineJoin="round";x.beginPath();s.points.forEach((p,i)=>i?x.lineTo(p[0]*c.width,p[1]*c.height):x.moveTo(p[0]*c.width,p[1]*c.height));x.stroke();};</script></body>';
      void w.loadURL('data:text/html,' + encodeURIComponent(html)).then(() => {
        for (const st of s.strokes ?? []) void w.webContents.executeJavaScript(`drawStroke(${JSON.stringify(st)})`).catch(() => undefined);
      });
      w.showInactive();
      s.drawWin = w;
      return;
    }
    void s.drawWin.webContents.executeJavaScript(`window.drawStroke && drawStroke(${JSON.stringify(stroke)})`).catch(() => undefined);
  }

  /** Viewer: the host made an invite; hand it to the invited device over Link. */
  private async passInvite(s: Sess, device: string, token: string) {
    const node = this.d.node();
    if (!node || !device) return;
    try {
      await call(await node.connect(device), 'screen.invite', { host: s.peer, hostName: s.peerName, sid: s.id, token }, 10_000);
      this.toWin(s, 'screen-signal', { t: 'chat', text: `Invited ${node.peer(device)?.name ?? 'the other device'} to watch`, at: Date.now() });
    } catch (e) {
      this.toWin(s, 'screen-signal', { t: 'chat', text: `Could not invite: ${e instanceof Error ? e.message : String(e)}`, at: Date.now() });
    }
  }

  private pendingInvites = new Map<string, { host: string; hostName: string; sid: string; token: string; from: string }>();

  /** Another device invites this one to watch a session, view-only. */
  private invited(from: string, p: Record<string, unknown>) {
    const node = this.d.node();
    const host = String(p.host ?? '');
    if (!node?.peer(host) || node.peer(host)?.help) throw new Error('This device is not paired with that computer');
    const id = crypto.randomUUID();
    const inv = { host, hostName: String(p.hostName ?? 'a computer').slice(0, 80), sid: String(p.sid ?? ''), token: String(p.token ?? ''), from: node.peer(from)?.name ?? 'A device' };
    this.pendingInvites.set(id, inv);
    setTimeout(() => this.pendingInvites.delete(id), 10 * 60_000).unref?.();
    this.d.broadcast('screen-invite', { id, from: inv.from, hostName: inv.hostName });
    if (Notification.isSupported()) new Notification({ title: `${inv.from} invites you to watch ${inv.hostName}`, body: 'Open Keeper to watch (view only).' }).show();
    return true;
  }

  /** Accept an invitation to watch (view-only). */
  async joinInvite(id: string, tab = false): Promise<string> {
    if (!featureOn('screenExtras')) throw new Error('Watching as a second viewer is part of “More while sharing a screen”, turned off in Settings → Features');
    const inv = this.pendingInvites.get(id);
    if (!inv) throw new Error('That invitation has expired');
    this.pendingInvites.delete(id);
    return this.view(inv.host, { control: false, join: { sid: inv.sid, token: inv.token }, tab });
  }

  invites() {
    return [...this.pendingInvites.entries()].map(([id, v]) => ({ id, from: v.from, hostName: v.hostName }));
  }

  /** Host banner: give the viewer control, or take it back. */
  async setControl(sid: string, on: boolean) {
    const s = this.sessions.get(sid);
    if (!s || s.role !== 'host' || s.state === 'ended' || s.joined) return false;
    // A paired computer gets control only with "Control this computer"; help sessions and phones are the person's choice here.
    const peer = this.d.node()?.peer(s.peer);
    if (on && !s.help && !s.peer.startsWith('phone:') && !peer?.permissions.screenControl) {
      this.d.alert(`${s.peerName} may not control this computer`, 'Turn on “Control this computer” for it under Devices first.');
      return false;
    }
    if (on) {
      const inj = await injector().status();
      if (!inj.available) {
        s.controlNote = inj.reason;
        this.d.alert('Control is not possible here', inj.reason);
        return false;
      }
    } else {
      injector().stop();
      if (s.blocked) await injector().block?.(false);
      s.blocked = false;
      s.blankWin?.destroy();
      s.blankWin = undefined;
    }
    s.control = on;
    this.d.node()?.audit({ kind: s.help ? 'help' : 'screen', direction: 'in', device: s.peer, deviceName: s.peerName, title: on ? `You let ${s.peerName} control this computer` : `You took control back from ${s.peerName}`, ok: true });
    await send(s.ctl, { t: 'grant', control: on });
    this.toWin(s, 'screen-signal', { t: 'grant', control: on });
    this.changed();
    return true;
  }

  /** A screenshot for another device (`keeper remote screenshot`): needs "See this screen", and asks unless "Let it in without asking". */
  private async shot(device: string) {
    const node = this.d.node();
    const dev = node?.peer(device);
    if (!dev || dev.help) throw new Error('Not allowed');
    if (!featureOn('remoteScreen')) throw new Error('Remote screens are switched off on that computer');
    if (!(this.data.policy.unattended[device] && dev.permissions.screenControl)) {
      const r = await this.ask(`${dev.name} (one screenshot)`, false);
      if (!r.ok) throw new Error(`${node!.state().me.name} said no`);
    }
    const d = screen.getPrimaryDisplay();
    const src = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(d.size.width * d.scaleFactor), height: Math.round(d.size.height * d.scaleFactor) } });
    const pick = src.find((x) => x.display_id === String(d.id)) ?? src[0];
    if (!pick) throw new Error('No screen to capture');
    node!.audit({ kind: 'screen', direction: 'in', device, deviceName: dev.name, title: `${dev.name} took a screenshot of this screen`, ok: true });
    return { jpeg: pick.thumbnail.toJPEG(85).toString('base64'), width: pick.thumbnail.getSize().width, height: pick.thumbnail.getSize().height };
  }

  async screenshotOf(device: string): Promise<{ jpeg: string; width: number; height: number }> {
    const node = this.d.node();
    if (!node) throw new Error('Keeper Link is starting');
    const r = await call<{ jpeg: string; width: number; height: number }>(await node.connect(device), 'screen.shot', {}, 90_000);
    node.audit({ kind: 'screen', direction: 'out', device, deviceName: node.peer(device)?.name ?? device, title: `Took a screenshot of ${node.peer(device)?.name ?? device}`, ok: true });
    return r;
  }

  /** Viewer: restart the other computer and open the session again when it is back. */
  async rebootAndReconnect(sid: string) {
    const s = this.sessions.get(sid);
    if (!s || s.role !== 'viewer' || !s.control || s.help) throw new Error('Only a session with control can restart the other computer');
    const device = s.peer;
    const tab = s.tab;
    await send(s.ctl, { t: 'reboot' });
    this.d.node()?.audit({ kind: 'power', direction: 'out', device, deviceName: s.peerName, title: `Restarted ${s.peerName} from a screen session`, ok: true });
    void (async () => {
      const node = this.d.node();
      await new Promise((r) => setTimeout(r, 20_000));
      for (let i = 0; i < 60; i++) {
        const ok = await node?.check(device).then((r) => r.ok, () => false);
        if (ok) {
          await this.view(device, { control: true, tab }).catch(() => undefined);
          return;
        }
        await new Promise((r) => setTimeout(r, 10_000));
      }
    })();
  }

  private toWin(s: Sess, channel: string, m: unknown) {
    // A window that is still loading would miss early messages (a quick refusal, the offer): keep them until it is listening.
    if (!s.ready) {
      (s.backlog ??= []).push([channel, m]);
      return;
    }
    if (s.tab && s.role === 'viewer') return this.d.broadcast(channel, s.id, m);
    if (s.win && !s.win.isDestroyed()) s.win.webContents.send(`event:${channel}`, s.id, m);
  }

  /** The host banner or viewer window is listening: hand over what arrived before. */
  windowReady(sid: string) {
    const s = this.sessions.get(sid);
    if (!s) return;
    // A tab can be closed and opened again: send what the window needs to start over.
    s.ready = true;
    for (const [ch, m] of s.backlog?.splice(0) ?? []) this.toWin(s, ch, m);
  }

  /** From this device's windows (host banner or viewer) to the other side. */
  signal(sid: string, m: ControlMessage) {
    const s = this.sessions.get(sid);
    if (!s) return;
    if (m.t === 'path') {
      s.path = m.path;
      s.state = 'live';
      this.changed();
    }
    if (m.t === 'display' && s.role === 'viewer') s.display = m.id;
    if (m.t === 'quality') s.quality = m.q;
    if (m.t === 'control' && s.role === 'host') s.control = s.control && m.on;
    if (m.t === 'mode' && s.role === 'viewer') s.mode = m.mode;
    void send(s.ctl, m);
  }

  /** Viewer: print a file on the other computer's default printer. */
  async print(sid: string, file: string) {
    if (!featureOn('screenExtras')) throw new Error('Printing on the other computer is part of “More while sharing a screen”, turned off in Settings → Features');
    const s = this.sessions.get(sid);
    const node = this.d.node();
    if (!s || !node || s.help) throw new Error('No such session');
    const { remotePrint } = await import('../link/ops');
    await remotePrint(node, s.peer, file);
  }

  private input(s: Sess, raw: unknown[]) {
    if (s.role !== 'host' || !s.control || s.state === 'ended') return;
    const events = raw.slice(0, 500).map(sanitize).filter((e): e is InputEvent => !!e);
    const d = s.displays.find((x) => x.id === s.display) ?? s.displays[0];
    if (!events.length || !d) return;
    s.lastActivity = Date.now();
    if (s.mode === 'all' && s.displays.length > 1) {
      // Positions are across the box of all displays: send each event to the display it lands on.
      void import('../../../core/screen/extras').then(({ mapFromAll }) => {
        for (const e of events) {
          if ('x' in e && 'y' in e) {
            const hit = mapFromAll(s.displays, e.x, e.y);
            if (hit) injector().send([{ ...e, x: hit.x, y: hit.y } as InputEvent], hit.display);
          } else injector().send([e], d);
        }
      });
      return;
    }
    injector().send(events, d);
  }

  /** The viewer window sends input; it goes over the control stream. */
  sendInput(sid: string, events: InputEvent[]) {
    const s = this.sessions.get(sid);
    if (!s || s.role !== 'viewer' || !s.control) return;
    s.lastActivity = Date.now();
    void send(s.ctl, { t: 'input', events });
  }

  ack(sid: string, seq: number) {
    const s = this.sessions.get(sid);
    if (s) void send(s.ctl, { t: 'ack', seq });
  }

  // ---------------------------------------------------------------- the fallback picture

  /** A JPEG from the host banner window; returns false when the viewer is still behind (try again shortly). */
  async frame(sid: string, jpeg: Uint8Array, w: number, h: number): Promise<boolean> {
    const s = this.sessions.get(sid);
    if (!s || s.role !== 'host' || s.state === 'ended') return false;
    const now = Date.now();
    if (s.peer.startsWith('phone:')) {
      s.latest = { seq: (s.latest?.seq ?? 0) + 1, header: { w, h, at: now }, jpeg: new Uint8Array(jpeg) };
      return true;
    }
    if (!s.gate.ready(now)) return false;
    const seq = s.gate.sent(now);
    try {
      if (!s.frames) {
        const node = this.d.node();
        const mux = await node!.connect(s.peer);
        s.frames = mux.open({ k: 'screen.frames', sid: s.id });
        s.frames.ondata = () => undefined;
        void s.frames.start();
      }
      await s.frames.write(lengthPrefixed(encodeFrame({ seq, w, h, at: now, display: s.display }, new Uint8Array(jpeg))));
      return true;
    } catch {
      s.frames = undefined;
      return false;
    }
  }

  private incomingFrames(st: Stream, device: string) {
    const s = this.sessions.get(String(st.meta.sid));
    if (!s || s.role !== 'viewer' || s.peer !== device) return st.reset('no such session');
    const de = new Deframer((m) => {
      const f = decodeFrame(m);
      if (f) this.toWin(s, 'screen-frame', { header: f.header, jpeg: f.jpeg });
    });
    st.ondata = (c) => de.push(c);
    st.onend = () => undefined;
    void st.start();
  }

  // ---------------------------------------------------------------- phones

  private async phoneStart(cid: string, wantsControl: boolean) {
    const node = this.d.node();
    const webHelper = cid.startsWith('helpweb:');
    const name = webHelper ? `${cid.split(':').slice(2).join(':') || 'Helper'} (web browser)` : node?.companionName(cid) ?? 'A phone';
    if (!featureOn('remoteScreen')) throw new Error('Remote screens are switched off on this computer');
    let r = { ok: true, control: false };
    if (!webHelper) {
      const decision = decide({ from: 'phone', id: cid, wantsControl }, this.data.policy);
      if (decision.do === 'deny') throw new Error(decision.reason);
      r = await this.ask(name, wantsControl);
      if (!r.ok) throw new Error('The computer did not allow it');
    }
    const s = await this.hostSession(crypto.randomUUID(), `phone:${cid}`, name, r.control, 'speed', 'frames', { help: webHelper });
    s.state = 'live';
    const inj = await injector().status();
    if (s.control && !inj.available) {
      s.control = false;
      s.controlNote = inj.reason;
    }
    this.openHost(s);
    return { r: { sid: s.id, control: s.control, note: s.controlNote, displays: s.displays, display: s.display } };
  }

  private phoneFrame(sid: string, after: number) {
    const s = this.sessions.get(sid);
    if (!s || !s.peer.startsWith('phone:')) throw new Error('No such session');
    s.lastActivity = Date.now();
    if (s.state === 'ended') return { r: { ended: true, reason: s.ended?.reason } };
    if (!s.latest || s.latest.seq <= after) return { r: { none: true, control: s.control } };
    return { r: { seq: s.latest.seq, ...s.latest.header, control: s.control }, body: s.latest.jpeg };
  }

  // ---------------------------------------------------------------- ending

  stop(sid: string) {
    const s = this.sessions.get(sid);
    if (s) this.end(s, s.role === 'host' ? 'Stopped sharing' : 'Stopped watching');
  }

  stopAll() {
    for (const s of [...this.sessions.values()]) this.end(s, 'Keeper is closing');
  }

  private end(s: Sess, reason: string, tell = true) {
    if (s.state === 'ended') return;
    s.state = 'ended';
    s.ended = { at: Date.now(), reason };
    clearInterval(s.idleTimer);
    if (tell) void send(s.ctl, { t: 'bye', reason });
    try {
      s.ctl?.end();
      s.frames?.end();
    } catch {
      /* already closed */
    }
    this.toWin(s, 'screen-signal', { t: 'bye', reason });
    // Let the window show why it ended for a moment (viewer); the host banner goes at once.
    const w = s.win;
    if (w && !w.isDestroyed() && s.role === 'host') w.close();
    if (s.role === 'host') injector().stop();
    clearInterval(s.cursorTimer);
    if (s.blocked) void injector().block?.(false);
    s.blankWin?.destroy();
    s.drawWin?.destroy();
    s.blankWin = s.drawWin = undefined;
    // Viewers who joined this session go with it.
    for (const j of this.sessions.values()) if (j.parent === s.id && j.state !== 'ended') this.end(j, reason);
    const node = this.d.node();
    node?.audit({ kind: s.help ? 'help' : 'screen', direction: s.role === 'host' ? 'in' : 'out', device: s.peer, deviceName: s.peerName, title: s.help ? (s.role === 'host' ? `${s.peerName} helped you` : `You helped ${s.peerName}`) : auditTitle(s), detail: reason, ok: true, at: s.started, until: Date.now() } as never);
    // Help leaves nothing behind: the connection goes too.
    if (s.help && s.peer.startsWith('help:')) node?.help.end(s.peer, reason);
    this.data.log.unshift({ at: Date.now(), title: s.help ? (s.role === 'host' ? `${s.peerName} helped you (help session)` : `You helped ${s.peerName} (help session)`) : auditTitle(s) });
    this.save();
    setTimeout(() => this.sessions.delete(s.id), 30_000).unref?.();
    this.changed();
  }

  // ---------------------------------------------------------------- Wake-on-LAN

  private async learnWake(device: string, mux: Mux) {
    try {
      const list = await call<{ mac: string; broadcast: string }[]>(mux, 'wol.info', {}, 5000);
      if (Array.isArray(list) && list.length) {
        this.data.wake[device] = list.slice(0, 6).map((x) => ({ mac: String(x.mac), broadcast: String(x.broadcast) }));
        this.save();
      }
    } catch {
      /* an older Keeper on the other side */
    }
  }

  /** Learns the device's network cards now (while it is awake). */
  async learn(device: string) {
    const node = this.d.node();
    if (!node) return false;
    await this.learnWake(device, await node.connect(device));
    return !!this.data.wake[device]?.length;
  }

  /** Wakes a sleeping device: from here, and through every other awake device on the same networks. */
  async wake(device: string): Promise<{ sent: number; via: string[] }> {
    const cards = this.data.wake[device];
    if (!cards?.length) throw new Error('Keeper has not learned this device’s network card yet. Connect to it once while it is awake.');
    let sent = 0;
    for (const c of cards) if (await sendMagic(c.mac, c.broadcast).then(() => true, () => false)) sent++;
    const via: string[] = [];
    const node = this.d.node();
    for (const other of node?.state().devices ?? []) {
      if (other.id === device || !other.online) continue;
      try {
        const mux = await node!.connect(other.id);
        for (const c of cards) await call(mux, 'wol.wake', { mac: c.mac, broadcast: c.broadcast }, 4000);
        via.push(other.name);
      } catch {
        /* that device is not on the same network or refused */
      }
    }
    return { sent, via };
  }

  async saveRecording(bytes: Uint8Array, name: string): Promise<string> {
    const dir = path.join(this.d.videos(), 'Keeper');
    await fsp.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${name.replace(/[\\/:*?"<>|]/g, '-').slice(0, 80)} ${new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '.')}.webm`);
    await fsp.writeFile(file, bytes);
    return file;
  }
}

function parse(m: Uint8Array): ControlMessage | null {
  try {
    const o = JSON.parse(new TextDecoder().decode(m));
    return o && typeof o.t === 'string' ? (o as ControlMessage) : null;
  } catch {
    return null;
  }
}

function publicSession(s: Sess): ScreenSession {
  return { id: s.id, peer: s.peer, peerName: s.peerName, role: s.role, control: s.control, state: s.state, path: s.path, display: s.display, started: s.started, ended: s.ended, help: s.help, joined: s.joined };
}

function sendMagic(mac: string, broadcast: string): Promise<void> {
  const pkt = magicPacket(mac);
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(broadcast)) return Promise.reject(new Error('bad broadcast address'));
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket('udp4');
    sock.once('error', (e) => {
      sock.close();
      reject(e);
    });
    sock.bind(() => {
      sock.setBroadcast(true);
      // Port 9 (discard) is what most cards listen on; 7 for the rest.
      sock.send(pkt, 9, broadcast, () => sock.send(pkt, 7, broadcast, () => {
        sock.close();
        resolve();
      }));
    });
  });
}
