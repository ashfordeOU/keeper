// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Dictation's Linux password-field guard over AT-SPI: the pure parts, then the
// real D-Bus path against a private dbus-daemon where a stand-in desktop
// answers as the accessibility bus does (org.a11y.Bus, the registry's root,
// an app with a window, a text field and a password field, and "focused"
// state-change signals). This container has no at-spi2-core, so real apps are
// not part of this test.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findFocused, focusFromSignal, hasState, passwordFocused, REGISTRY, ROLE_PASSWORD_TEXT, STATE_ACTIVE, STATE_FOCUSED, type AtspiCalls, type AtspiRef } from '../electron/services/voice/atspi';

const bits = (...b: number[]) => { const w = [0, 0]; for (const x of b) w[x >> 5] |= 1 << (x & 31); return w.map((x) => x >>> 0); };
const ROLE_TEXT = 61;

/** A desktop: registry → app → window → [label, text field, password field]. */
function desk(focus: 'text' | 'pw' | null) {
  const nodes: Record<string, { role: number; states: number[]; kids: string[] }> = {
    [REGISTRY.path]: { role: 14, states: bits(), kids: ['/app'] },
    '/app': { role: 75, states: bits(), kids: ['/app/old', '/app/win'] },
    '/app/old': { role: 23, states: bits(), kids: ['/app/old/x'] },
    '/app/old/x': { role: ROLE_TEXT, states: bits(STATE_FOCUSED), kids: [] }, // focused in an inactive window: ignored
    '/app/win': { role: 23, states: bits(STATE_ACTIVE), kids: ['/app/win/label', '/app/win/form'] },
    '/app/win/label': { role: 29, states: bits(), kids: [] },
    '/app/win/form': { role: 39, states: bits(), kids: ['/app/win/text', '/app/win/pw'] },
    '/app/win/text': { role: ROLE_TEXT, states: bits(focus === 'text' ? STATE_FOCUSED : 0), kids: [] },
    '/app/win/pw': { role: ROLE_PASSWORD_TEXT, states: bits(focus === 'pw' ? STATE_FOCUSED : 0), kids: [] },
  };
  return nodes;
}
const fake = (nodes: ReturnType<typeof desk>): AtspiCalls => ({
  role: async (r) => nodes[r.path].role,
  states: async (r) => nodes[r.path].states,
  children: async (r) => nodes[r.path].kids.map((p) => ({ bus: r.path === REGISTRY.path ? ':1.app' : r.bus, path: p })),
});

describe('voice: AT-SPI password guard (logic)', () => {
  it('reads state bits and focus signals', () => {
    expect(hasState(bits(STATE_FOCUSED), STATE_FOCUSED)).toBe(true);
    expect(hasState(bits(STATE_ACTIVE, 40), 40)).toBe(true);
    expect(hasState(bits(STATE_ACTIVE), STATE_FOCUSED)).toBe(false);
    expect(focusFromSignal({ interface: 'org.a11y.atspi.Event.Object', member: 'StateChanged', sender: ':1.9', path: '/o/1', body: ['focused', 1, 0, null, null] })).toEqual({ bus: ':1.9', path: '/o/1' });
    expect(focusFromSignal({ interface: 'org.a11y.atspi.Event.Object', member: 'StateChanged', sender: ':1.9', path: '/o/1', body: ['focused', 0, 0, null, null] })).toBeNull();
    expect(focusFromSignal({ interface: 'org.a11y.atspi.Event.Object', member: 'StateChanged', sender: ':1.9', path: '/o/1', body: ['checked', 1, 0, null, null] })).toBeNull();
  });
  it('finds the focused field under the active window and says whether it is a password field', async () => {
    expect(await findFocused(fake(desk('pw')))).toEqual({ bus: ':1.app', path: '/app/win/pw' });
    expect(await passwordFocused(fake(desk('pw')))).toBe(true);
    expect(await passwordFocused(fake(desk('text')))).toBe(false);
    expect(await passwordFocused(fake(desk(null)))).toBeNull();
    expect(await passwordFocused(fake(desk('pw')), null, { nodes: 2 })).toBeNull(); // gives up rather than hang on a huge tree
    // a remembered focus that moved on is not trusted: it looks again
    expect(await passwordFocused(fake(desk('pw')), { bus: ':1.app', path: '/app/win/text' })).toBe(true);
  });
});

const nameOf = (b: unknown) => (b as { name: string }).name;
const hasDaemon = spawnSync('dbus-daemon', ['--version']).status === 0;

describe.skipIf(!hasDaemon)('voice: AT-SPI password guard over a real D-Bus', () => {
  let daemon: ChildProcess;
  let address = '';
  let desktop: import('dbus-next').MessageBus;
  let nodes = desk('pw');
  const registered: string[] = [];
  let atspi: typeof import('../electron/services/voice/atspi');

  beforeAll(async () => {
    daemon = spawn('dbus-daemon', ['--session', '--nofork', '--print-address=1'], { stdio: ['ignore', 'pipe', 'ignore'] });
    address = await new Promise<string>((resolve) => daemon.stdout!.once('data', (d) => resolve(String(d).trim())));
    const dbus = await import('dbus-next');
    desktop = dbus.sessionBus({ busAddress: address });
    await desktop.requestName('org.a11y.Bus', 0);
    await desktop.requestName('org.a11y.atspi.Registry', 0);
    desktop.addMethodHandler((m: import('dbus-next').Message) => {
      const reply = (sig: string, body: unknown[]) => { desktop.send(dbus.Message.newMethodReturn(m, sig, body)); return true; };
      if (m.interface === 'org.a11y.Bus' && m.member === 'GetAddress') return reply('s', [address]);
      if (m.interface === 'org.a11y.atspi.Registry' && m.member === 'RegisterEvent') { registered.push(String(m.body[0])); return reply('', []); }
      const n = nodes[m.path];
      if (m.interface !== 'org.a11y.atspi.Accessible' || !n) return false;
      if (m.member === 'GetRole') return reply('u', [n.role]);
      if (m.member === 'GetState') return reply('au', [n.states]);
      if (m.member === 'GetChildren') return reply('a(so)', [n.kids.map((p) => [nameOf(desktop), p])]);
      return false;
    });
    process.env.DBUS_SESSION_BUS_ADDRESS = address;
    delete process.env.AT_SPI_BUS_ADDRESS;
    atspi = await import('../electron/services/voice/atspi');
  });
  afterAll(() => {
    atspi?.stopAtspi();
    desktop?.disconnect();
    daemon?.kill();
  });

  it('finds the accessibility bus, registers for focus changes, and spots the password field', async () => {
    expect(await atspi.linuxPasswordFocused()).toBe(true);
    expect(registered).toContain('object:state-changed:focused');
    expect(await atspi.atspiAvailable()).toBe(true);
  });

  it('follows focus changes the desktop announces', async () => {
    const dbus = await import('dbus-next');
    nodes = desk('text');
    const sig = dbus.Message.newSignal('/app/win/text', 'org.a11y.atspi.Event.Object', 'StateChanged', 'siiv(so)', ['focused', 1, 0, new dbus.Variant('i', 0), [nameOf(desktop), '/org/a11y/atspi/null']]);
    desktop.send(sig);
    await new Promise((r) => setTimeout(r, 100));
    expect(await atspi.linuxPasswordFocused()).toBe(false);
    nodes = desk('pw');
    desktop.send(dbus.Message.newSignal('/app/win/pw', 'org.a11y.atspi.Event.Object', 'StateChanged', 'siiv(so)', ['focused', 1, 0, new dbus.Variant('i', 0), [nameOf(desktop), '/org/a11y/atspi/null']]));
    await new Promise((r) => setTimeout(r, 100));
    expect(await atspi.linuxPasswordFocused()).toBe(true);
  });

  it('says "can’t tell" when nothing is focused, so the app exclusions decide', async () => {
    nodes = desk(null);
    expect(await atspi.linuxPasswordFocused()).toBeNull();
  });
});

void (null as unknown as AtspiRef);
