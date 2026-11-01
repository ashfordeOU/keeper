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
import type { ControlMessage, HostDisplay, InputEvent, Quality, ScreenPath, ScreenSession } from '../../../core/screen/types';
import { magicPacket, wakeableInterfaces } from '../../../core/screen/wol';
import type { LinkNode } from '../link/node';
import { featureOn, onFeature } from '../features';
import { injector } from './injector';

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

  // ---------------------------------------------------------------- viewing another device

  /** Starts watching a paired device's screen; opens the viewer window. */
  async view(device: string, opts: { control?: boolean; quality?: Quality; prefer?: 'auto' | 'frames' } = {}): Promise<string> {
    const node = this.d.node();
    if (!node) throw new Error('Keeper Link is starting');
    if (!featureOn('remoteScreen')) throw new Error('Remote screens are switched off in Settings → Features');
    const dev = node.state().devices.find((x) => x.id === device);
    if (!dev) throw new Error('That device is not paired');
    const mux = await node.connect(device);
    void this.learnWake(device, mux);
    const sid = crypto.randomUUID();
    const s: Sess = {
      id: sid, peer: device, peerName: dev.name, role: 'viewer', control: !!opts.control, state: 'asking', started: Date.now(),
      gate: new FrameGate(), displays: [], lastActivity: Date.now(), quality: opts.quality ?? 'auto',
    };
    this.sessions.set(sid, s);
    const st = mux.open({ k: 'screen.ctl', sid });
    s.ctl = st;
    this.readCtl(s, st);
    void send(st, { t: 'start', sid, control: s.control, quality: s.quality, name: node.state().me.name, prefer: opts.prefer });
    this.openViewer(s);
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
    const dev = node?.state().devices.find((x) => x.id === device);
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
    const decision = featureOn('remoteScreen')
      ? decide({ from: 'device', id: device, wantsControl: start.control, perms: dev.permissions }, this.data.policy)
      : { do: 'deny' as const, reason: 'Remote screens are switched off on that computer' };
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
    s = await this.hostSession(start.sid, device, dev.name, control, start.quality, start.prefer === 'frames' ? 'frames' : 'p2p');
    s.ctl = st;
    const inj = await injector().status();
    if (control && !inj.available) {
      s.control = false;
      s.controlNote = inj.reason;
    }
    await send(st, { t: 'hello', displays: s.displays, display: s.display!, os: process.platform, control: s.control, controlNote: s.controlNote });
    this.openHost(s);
  }

  private async hostSession(sid: string, peer: string, peerName: string, control: boolean, quality: Quality, path: ScreenPath): Promise<Sess> {
    const displays = await this.displays();
    const s: Sess = {
      id: /^[\w-]{8,64}$/.test(sid) ? sid : crypto.randomUUID(), peer, peerName, role: 'host', control, state: 'connecting', path,
      display: (displays.find((d) => d.primary) ?? displays[0])?.id, started: Date.now(), gate: new FrameGate(), displays, lastActivity: Date.now(), quality,
    };
    this.sessions.set(s.id, s);
    s.idleTimer = setInterval(() => {
      if (idleExpired(Date.now(), s.lastActivity, this.data.policy)) this.end(s, 'Ended after a while with no activity');
    }, 30_000);
    s.idleTimer.unref?.();
    this.d.alert(`${peerName} is ${control ? 'controlling' : 'viewing'} this screen`, 'Stop sharing from the banner at the top of the screen.');
    this.changed();
    return s;
  }

  /** The small always-on-top banner that also does the capturing. */
  private openHost(s: Sess) {
    const area = screen.getPrimaryDisplay().workArea;
    const w = new BrowserWindow({
      width: 420, height: 46, x: Math.round(area.x + area.width / 2 - 210), y: area.y + 6, frame: false, resizable: false, movable: true,
      alwaysOnTop: true, skipTaskbar: true, focusable: true, show: true, transparent: false, backgroundColor: '#1c1c1e', title: 'Keeper — sharing this screen',
      webPreferences: { preload: this.d.preload, contextIsolation: true, sandbox: true, backgroundThrottling: false },
    });
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
      case 'bye':
        this.end(s, m.reason, false);
        return;
    }
  }

  private toWin(s: Sess, channel: string, m: unknown) {
    // A window that is still loading would miss early messages (a quick refusal, the offer): keep them until it is listening.
    if (!s.ready) {
      (s.backlog ??= []).push([channel, m]);
      return;
    }
    if (s.win && !s.win.isDestroyed()) s.win.webContents.send(`event:${channel}`, s.id, m);
  }

  /** The host banner or viewer window is listening: hand over what arrived before. */
  windowReady(sid: string) {
    const s = this.sessions.get(sid);
    if (!s) return;
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
    void send(s.ctl, m);
  }

  private input(s: Sess, raw: unknown[]) {
    if (s.role !== 'host' || !s.control || s.state === 'ended') return;
    const events = raw.slice(0, 500).map(sanitize).filter((e): e is InputEvent => !!e);
    const d = s.displays.find((x) => x.id === s.display) ?? s.displays[0];
    if (!events.length || !d) return;
    s.lastActivity = Date.now();
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
    const name = node?.companionName(cid) ?? 'A phone';
    const decision = featureOn('remoteScreen') ? decide({ from: 'phone', id: cid, wantsControl }, this.data.policy) : { do: 'deny' as const, reason: 'Remote screens are switched off on this computer' };
    if (decision.do === 'deny') throw new Error(decision.reason);
    const r = await this.ask(name, wantsControl);
    if (!r.ok) throw new Error('The computer did not allow it');
    const s = await this.hostSession(crypto.randomUUID(), `phone:${cid}`, name, r.control, 'speed', 'frames');
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
    if (!s.latest || s.latest.seq <= after) return { r: { none: true } };
    return { r: { seq: s.latest.seq, ...s.latest.header }, body: s.latest.jpeg };
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
    this.data.log.unshift({ at: Date.now(), title: auditTitle(s) });
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
  return { id: s.id, peer: s.peer, peerName: s.peerName, role: s.role, control: s.control, state: s.state, path: s.path, display: s.display, started: s.started, ended: s.ended };
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
