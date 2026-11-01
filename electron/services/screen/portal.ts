// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Controlling a Linux Wayland desktop through xdg-desktop-portal's
// RemoteDesktop portal (with ScreenCast, whose stream the pointer positions
// refer to). The system shows its own dialog the first time; Keeper keeps the
// restore token so later sessions start without asking again. When the portal
// is missing or the person declines, sessions stay view-only with a clear
// message (core/screen/portal.ts WAYLAND_VIEW_ONLY).

import { app } from 'electron';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { coalesce } from '../../../core/screen/input';
import { evdevButton, evdevKey, newToken, parseStreams, PORTAL_BUS, PORTAL_PATH, RD_IFACE, requestPath, responseError, SC_IFACE, selectDevicesOptions, selectSourcesOptions, toStream, WAYLAND_VIEW_ONLY, type PortalStream } from '../../../core/screen/portal';
import type { HostDisplay, InputEvent } from '../../../core/screen/types';
import type { Injector, InjectorStatus } from './injector';

type Bus = import('dbus-next').MessageBus;
type DbusMod = typeof import('dbus-next');

const tokenFile = () => path.join(app.getPath('userData'), 'screen-portal.json');

export class PortalInjector implements Injector {
  private dbus: DbusMod | null = null;
  private bus: Bus | null = null;
  private session: string | null = null;
  private stream: PortalStream | null = null;
  private starting: Promise<string | null> | null = null;
  private lastError: string | null = null;
  private queue: InputEvent[] = [];
  private busy = false;
  private display?: HostDisplay;

  private async connect(): Promise<{ bus: Bus; d: DbusMod }> {
    if (this.bus && this.dbus) return { bus: this.bus, d: this.dbus };
    const d = await import('dbus-next');
    this.dbus = d;
    this.bus = d.sessionBus();
    return { bus: this.bus, d };
  }

  async status(): Promise<InjectorStatus> {
    if (this.lastError) return { available: false, reason: this.lastError };
    try {
      const { bus } = await this.connect();
      const obj = await bus.getProxyObject(PORTAL_BUS, PORTAL_PATH);
      obj.getInterface(RD_IFACE);
      return { available: true, reason: 'The first time, the system asks you to allow remote control; Keeper remembers your answer.' };
    } catch {
      return { available: false, reason: WAYLAND_VIEW_ONLY };
    }
  }

  /** Calls a portal method that answers through a Request object, and waits for its Response. */
  private async request(iface: string, member: string, signature: string, body: unknown[], token: string): Promise<Record<string, unknown>> {
    const { bus, d } = await this.connect();
    const reqPath = requestPath((bus as unknown as { name?: string }).name ?? '', token);
    const rule = `type='signal',interface='org.freedesktop.portal.Request',member='Response',path='${reqPath}'`;
    await bus.call(new d.Message({ destination: 'org.freedesktop.DBus', path: '/org/freedesktop/DBus', interface: 'org.freedesktop.DBus', member: 'AddMatch', signature: 's', body: [rule] }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        bus.removeListener('message', onMsg);
        reject(new Error('The system did not answer'));
      }, 120_000);
      const onMsg = (m: import('dbus-next').Message) => {
        if (m.path !== reqPath || m.member !== 'Response') return;
        clearTimeout(timer);
        bus.removeListener('message', onMsg);
        const [code, results] = m.body as [number, Record<string, { value: unknown }>];
        const err = responseError(code);
        if (err) return reject(new Error(err));
        resolve(Object.fromEntries(Object.entries(results ?? {}).map(([k, v]) => [k, v?.value])));
      };
      bus.on('message', onMsg);
      bus
        .call(new d.Message({ destination: PORTAL_BUS, path: PORTAL_PATH, interface: iface, member, signature, body }))
        .catch((e: Error) => {
          clearTimeout(timer);
          bus.removeListener('message', onMsg);
          reject(e);
        });
    });
  }

  private variants(o: Record<string, [string, unknown]>) {
    const V = this.dbus!.Variant;
    return Object.fromEntries(Object.entries(o).map(([k, [sig, v]]) => [k, new V(sig, v)]));
  }

  /** Starts a remote desktop session (asks the person the first time). */
  private start(): Promise<string | null> {
    if (this.session) return Promise.resolve(this.session);
    this.starting ??= (async () => {
      try {
        await this.connect();
        const saved = await fsp.readFile(tokenFile(), 'utf8').then((t) => (JSON.parse(t) as { restore?: string }).restore).catch(() => undefined);
        const t0 = newToken();
        const created = await this.request(RD_IFACE, 'CreateSession', 'a{sv}', [this.variants({ handle_token: ['s', t0], session_handle_token: ['s', newToken('keepers')] })], t0);
        const session = String(created.session_handle ?? '');
        if (!session) throw new Error('The system did not start a session');
        let t = newToken();
        await this.request(RD_IFACE, 'SelectDevices', 'oa{sv}', [session, this.variants(selectDevicesOptions(t, saved))], t);
        t = newToken();
        await this.request(SC_IFACE, 'SelectSources', 'oa{sv}', [session, this.variants(selectSourcesOptions(t))], t);
        t = newToken();
        const started = await this.request(RD_IFACE, 'Start', 'osa{sv}', [session, '', this.variants({ handle_token: ['s', t] })], t);
        this.stream = parseStreams(started.streams)[0] ?? null;
        if (typeof started.restore_token === 'string') await fsp.writeFile(tokenFile(), JSON.stringify({ restore: started.restore_token }), { mode: 0o600 }).catch(() => undefined);
        this.session = session;
        return session;
      } catch (e) {
        this.lastError = e instanceof Error ? e.message : WAYLAND_VIEW_ONLY;
        return null;
      } finally {
        this.starting = null;
      }
    })();
    return this.starting;
  }

  send(events: InputEvent[], display: HostDisplay) {
    this.queue.push(...events);
    this.display = display;
    void this.pump();
  }

  private async pump() {
    if (this.busy) return;
    this.busy = true;
    try {
      const session = await this.start();
      if (!session || !this.bus || !this.dbus) {
        this.queue = [];
        return;
      }
      const d = this.dbus;
      const call = (member: string, signature: string, body: unknown[]) => this.bus!.call(new d.Message({ destination: PORTAL_BUS, path: PORTAL_PATH, interface: RD_IFACE, member, signature, body })).catch(() => undefined);
      const none = {};
      while (this.queue.length) {
        for (const e of coalesce(this.queue.splice(0))) {
          const disp = this.display ?? { width: 1920, height: 1080 };
          if ((e.t === 'move' || e.t === 'down' || e.t === 'up' || e.t === 'wheel') && this.stream) {
            const p = toStream(e.x, e.y, this.stream, { width: disp.width, height: disp.height });
            await call('NotifyPointerMotionAbsolute', 'oa{sv}udd', [session, none, this.stream.node, p.x, p.y]);
          }
          if (e.t === 'down' || e.t === 'up') await call('NotifyPointerButton', 'oa{sv}iu', [session, none, evdevButton(e.button), e.t === 'down' ? 1 : 0]);
          else if (e.t === 'wheel') {
            if (Math.round(e.dy)) await call('NotifyPointerAxisDiscrete', 'oa{sv}ui', [session, none, 0, Math.sign(e.dy) * Math.max(1, Math.round(Math.abs(e.dy)))]);
            if (Math.round(e.dx)) await call('NotifyPointerAxisDiscrete', 'oa{sv}ui', [session, none, 1, Math.sign(e.dx) * Math.max(1, Math.round(Math.abs(e.dx)))]);
          } else if (e.t === 'key') {
            const k = evdevKey(e.code);
            if (k !== null) await call('NotifyKeyboardKeycode', 'oa{sv}iu', [session, none, k, e.down ? 1 : 0]);
          } else if (e.t === 'text') {
            // Text without a keyboard layout map: letters, digits and space only.
            for (const ch of e.text.slice(0, 500)) {
              const code = /[a-z]/i.test(ch) ? `Key${ch.toUpperCase()}` : /\d/.test(ch) ? `Digit${ch}` : ch === ' ' ? 'Space' : ch === '\n' ? 'Enter' : '';
              const k = code ? evdevKey(code) : null;
              if (k === null) continue;
              const shift = /[A-Z]/.test(ch);
              if (shift) await call('NotifyKeyboardKeycode', 'oa{sv}iu', [session, none, 42, 1]);
              await call('NotifyKeyboardKeycode', 'oa{sv}iu', [session, none, k, 1]);
              await call('NotifyKeyboardKeycode', 'oa{sv}iu', [session, none, k, 0]);
              if (shift) await call('NotifyKeyboardKeycode', 'oa{sv}iu', [session, none, 42, 0]);
            }
          }
        }
      }
    } finally {
      this.busy = false;
    }
  }

  stop() {
    this.queue = [];
    const s = this.session;
    this.session = null;
    this.stream = null;
    if (s && this.bus && this.dbus) void this.bus.call(new this.dbus.Message({ destination: PORTAL_BUS, path: s, interface: 'org.freedesktop.portal.Session', member: 'Close' })).catch(() => undefined);
  }
}

/** Wayland without X11 (or with KEEPER_WAYLAND_PORTAL=1): use the portal. */
export function usePortal(): boolean {
  return process.platform === 'linux' && (process.env.KEEPER_WAYLAND_PORTAL === '1' || (process.env.XDG_SESSION_TYPE === 'wayland' && !process.env.DISPLAY));
}
