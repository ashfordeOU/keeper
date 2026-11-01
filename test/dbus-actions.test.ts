// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper's actions on a private dbus-daemon, called the way a desktop
// assistant or a script would. Skipped where dbus-daemon is missing.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import * as dbus from 'dbus-next';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACTIONS_BUS_NAME, ACTIONS_OBJECT_PATH, exportActions, LINUX_ACTIONS, plainParams } from '../electron/services/platform/dbus-actions';
import { handleIntentUrl, PAGES } from '../electron/services/intents';

const hasDaemon = process.platform === 'linux' && spawnSync('dbus-daemon', ['--version']).status === 0;

describe('keeper:// links for assistants', () => {
  it('opens pages, starts the focus timer, locks folders and runs automations', async () => {
    const did: string[] = [];
    const d = { showMain: (r?: string) => did.push(`page:${r}`), focus: (a: string, m?: number) => did.push(`focus:${a}:${m ?? ''}`), runRule: async (n: string) => did.push(`rule:${n}`), relockAll: async () => { did.push('lock'); return 2; } };
    expect(handleIntentUrl('keeper://go?page=health', d)).toBe(true);
    expect(handleIntentUrl('keeper://go?page=../../etc', d)).toBe(false);
    expect(handleIntentUrl('keeper://focus?minutes=999', d)).toBe(true);
    expect(handleIntentUrl('keeper://focus?minutes=0', d)).toBe(true);
    expect(handleIntentUrl('keeper://lock-all', d)).toBe(true);
    expect(handleIntentUrl('keeper://automation?name=Tidy%20downloads', d)).toBe(true);
    expect(handleIntentUrl('keeper://automation', d)).toBe(false);
    expect(handleIntentUrl('https://example.com/go', d)).toBe(false);
    await new Promise((r) => setTimeout(r, 10));
    expect(did).toEqual(['page:health', 'focus:start:240', 'focus:stop:', 'lock', 'rule:Tidy downloads']);
    expect(PAGES).toContain('agents');
  });
  it('reads D-Bus variants as plain strings', () => {
    expect(plainParams({ page: new dbus.Variant('s', 'health'), minutes: new dbus.Variant('u', 25), on: new dbus.Variant('b', true), skip: new dbus.Variant('as', ['x']) })).toEqual({ page: 'health', minutes: '25', on: 'true' });
  });
});

describe.skipIf(!hasDaemon)('Keeper actions over D-Bus', () => {
  let daemon: ChildProcess;
  let exported: { stop(): void };
  let client: dbus.MessageBus;
  const opened: string[] = [];

  beforeAll(async () => {
    daemon = spawn('dbus-daemon', ['--session', '--nofork', '--print-address=1'], { stdio: ['ignore', 'pipe', 'inherit'] });
    const address = await new Promise<string>((resolve) => daemon.stdout!.once('data', (d: Buffer) => resolve(d.toString().trim())));
    exported = await exportActions({
      openUrl: (u) => opened.push(u),
      ask: async (q) => `You asked: ${q}`,
      search: async (q, n) => [`/home/me/${q}.pdf`].slice(0, n),
    }, dbus.sessionBus({ busAddress: address }));
    client = dbus.sessionBus({ busAddress: address });
  });

  afterAll(() => {
    client?.disconnect();
    exported?.stop();
    daemon?.kill();
  });

  it('lists, runs, answers and searches', async () => {
    const obj = await client.getProxyObject(ACTIONS_BUS_NAME, ACTIONS_OBJECT_PATH);
    const a = obj.getInterface(ACTIONS_BUS_NAME);
    const list: [string, string, string][] = await a.ListActions();
    expect(list.map((x) => x[0])).toEqual(LINUX_ACTIONS.map((x) => x[0]));
    expect(await a.Run('open-page', { page: new dbus.Variant('s', 'health') })).toBe('ok');
    expect(await a.Run('focus', { minutes: new dbus.Variant('u', 10) })).toBe('ok');
    expect(opened).toEqual(['keeper://go?page=health', 'keeper://focus?minutes=10']);
    await expect(a.Run('format-disk', {})).rejects.toThrow(/No action called/);
    expect(await a.Ask('when does my passport expire?')).toBe('You asked: when does my passport expire?');
    expect(await a.Search('taxes', 5)).toEqual(['/home/me/taxes.pdf']);
  });
});
