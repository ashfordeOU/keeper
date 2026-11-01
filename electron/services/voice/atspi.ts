// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Linux: is the focused field a password field? Asked through AT-SPI, the
// desktop's accessibility bus (the one screen readers use), over D-Bus:
//   1. the session bus tells where the accessibility bus is (org.a11y.Bus.GetAddress);
//   2. Keeper listens for "focused" state changes there, so it knows the focused object;
//   3. when a take starts it asks that object for its role: PASSWORD_TEXT (40) means a password field.
// Before the first focus change is seen, it looks for the focused object
// under the active window (a bounded search). When AT-SPI is not running, or
// an app does not expose its fields, the answer is "can't say" (null) and the
// per-app exclusion list remains the guard.

import type { Message, MessageBus } from 'dbus-next';

export const ROLE_PASSWORD_TEXT = 40;
export const STATE_ACTIVE = 1;
export const STATE_FOCUSED = 12;
export const REGISTRY = { bus: 'org.a11y.atspi.Registry', path: '/org/a11y/atspi/accessible/root' };
const ACCESSIBLE = 'org.a11y.atspi.Accessible';

export interface AtspiRef {
  bus: string;
  path: string;
}

/** The few calls the guard needs; a real bus or a test's stand-in. */
export interface AtspiCalls {
  role(r: AtspiRef): Promise<number>;
  states(r: AtspiRef): Promise<number[]>;
  children(r: AtspiRef): Promise<AtspiRef[]>;
}

/** AT-SPI states are a bit set in 32-bit words. */
export const hasState = (words: number[], bit: number) => (((words[bit >> 5] ?? 0) >>> (bit & 31)) & 1) === 1;

/** A "focused" StateChanged signal that turned focus on: the object that now has the focus. */
export function focusFromSignal(m: Pick<Message, 'interface' | 'member' | 'sender' | 'path' | 'body'>): AtspiRef | null {
  if (m.interface !== 'org.a11y.atspi.Event.Object' || m.member !== 'StateChanged') return null;
  const [detail, on] = (m.body ?? []) as [string, number];
  if (detail !== 'focused' || on !== 1 || !m.sender || !m.path) return null;
  return { bus: m.sender, path: m.path };
}

const isNull = (r: AtspiRef) => !r.path || r.path === '/org/a11y/atspi/null';

/** The focused object under the active window, looked for breadth-first and within limits. */
export async function findFocused(a: AtspiCalls, limits: { nodes?: number; until?: number } = {}): Promise<AtspiRef | null> {
  const max = limits.nodes ?? 600;
  const until = limits.until ?? Date.now() + 800;
  const apps = await a.children(REGISTRY).catch(() => [] as AtspiRef[]);
  let seen = 0;
  for (const app of apps) {
    for (const win of await a.children(app).catch(() => [] as AtspiRef[])) {
      if (isNull(win) || !hasState(await a.states(win).catch(() => []), STATE_ACTIVE)) continue;
      const queue = [win];
      while (queue.length) {
        if (++seen > max || Date.now() > until) return null;
        const n = queue.shift()!;
        const st = await a.states(n).catch(() => [] as number[]);
        if (n !== win && hasState(st, STATE_FOCUSED)) return n;
        for (const c of await a.children(n).catch(() => [] as AtspiRef[])) if (!isNull(c)) queue.push(c);
      }
      return null;
    }
  }
  return null;
}

/** true: a password field has the focus; false: something else has; null: cannot tell. */
export async function passwordFocused(a: AtspiCalls, tracked?: AtspiRef | null, limits?: { nodes?: number; until?: number }): Promise<boolean | null> {
  let f = tracked ?? null;
  // a remembered focus is trusted only while it still says it is focused
  if (f && !hasState(await a.states(f).catch(() => []), STATE_FOCUSED)) f = null;
  f ??= await findFocused(a, limits);
  if (!f) return null;
  const role = await a.role(f).catch(() => -1);
  return role < 0 ? null : role === ROLE_PASSWORD_TEXT;
}

/** AT-SPI calls over a dbus-next connection to the accessibility bus. */
export function busCalls(bus: MessageBus, Msg: typeof Message, timeoutMs = 400): AtspiCalls {
  const call = async (r: AtspiRef, member: string): Promise<unknown[]> => {
    const reply = await Promise.race([
      bus.call(new Msg({ destination: r.bus, path: r.path, interface: ACCESSIBLE, member })),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
    if (!reply) throw new Error('no answer');
    return reply.body as unknown[];
  };
  return {
    role: async (r) => Number((await call(r, 'GetRole'))[0]),
    states: async (r) => ((await call(r, 'GetState'))[0] as number[]).map(Number),
    children: async (r) => ((await call(r, 'GetChildren'))[0] as [string, string][]).map(([b, p]) => ({ bus: b, path: p })),
  };
}

// ---------------------------------------------------------------- the live connection

interface Conn { bus: MessageBus; calls: AtspiCalls; tracked: AtspiRef | null }
let conn: Conn | null = null;
let starting: Promise<Conn | null> | null = null;
let failedAt = 0;

/** Where the accessibility bus is: $AT_SPI_BUS_ADDRESS, else asked of the session bus. */
async function a11yAddress(dbus: typeof import('dbus-next')): Promise<string | null> {
  if (process.env.AT_SPI_BUS_ADDRESS) return process.env.AT_SPI_BUS_ADDRESS;
  if (!process.env.DBUS_SESSION_BUS_ADDRESS) return null;
  const session = dbus.sessionBus();
  try {
    const reply = await Promise.race([
      session.call(new dbus.Message({ destination: 'org.a11y.Bus', path: '/org/a11y/bus', interface: 'org.a11y.Bus', member: 'GetAddress' })),
      new Promise<null>((r) => setTimeout(() => r(null), 1500)),
    ]);
    return reply ? String(reply.body[0]) : null;
  } catch {
    return null;
  } finally {
    session.disconnect();
  }
}

async function connect(): Promise<Conn | null> {
  const dbus = await import('dbus-next');
  const addr = await a11yAddress(dbus);
  if (!addr) return null;
  const bus = dbus.sessionBus({ busAddress: addr });
  bus.on('error', () => undefined);
  const c: Conn = { bus, calls: busCalls(bus, dbus.Message), tracked: null };
  bus.on('message', (m: Message) => {
    const f = focusFromSignal(m);
    if (f) c.tracked = f;
  });
  // ask the registry to send focus changes (newer and older spellings), and receive them
  const reg = (signature: string, body: unknown[]) => bus.call(new dbus.Message({ destination: 'org.a11y.atspi.Registry', path: '/org/a11y/atspi/registry', interface: 'org.a11y.atspi.Registry', member: 'RegisterEvent', signature, body })).then(() => true, () => false);
  if (!(await reg('sass', ['object:state-changed:focused', [], '']))) await reg('s', ['object:state-changed:focused']);
  await bus.call(new dbus.Message({ destination: 'org.freedesktop.DBus', path: '/org/freedesktop/DBus', interface: 'org.freedesktop.DBus', member: 'AddMatch', signature: 's', body: ["type='signal',interface='org.a11y.atspi.Event.Object',member='StateChanged'"] })).catch(() => undefined);
  return c;
}

/** Linux password-field check (null when AT-SPI cannot say). The connection stays open for focus tracking. */
export async function linuxPasswordFocused(): Promise<boolean | null> {
  if (!conn) {
    if (Date.now() - failedAt < 60_000) return null;
    starting ??= connect().catch(() => null);
    conn = await starting;
    starting = null;
    if (!conn) { failedAt = Date.now(); return null; }
  }
  return passwordFocused(conn.calls, conn.tracked).catch(() => null);
}

/** Whether an accessibility bus can be reached (for the Dictation page). */
export async function atspiAvailable(): Promise<boolean> {
  if (conn) return true;
  if (!process.env.AT_SPI_BUS_ADDRESS && !process.env.DBUS_SESSION_BUS_ADDRESS) return false;
  return (await linuxPasswordFocused().then(() => !!conn).catch(() => false));
}

export function stopAtspi() {
  conn?.bus.disconnect();
  conn = null;
  failedAt = 0;
}
