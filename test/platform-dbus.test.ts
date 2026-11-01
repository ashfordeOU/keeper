// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Runs Keeper's GNOME and KRunner search providers on a private dbus-daemon
// and calls them the way the desktop does. Skipped where dbus-daemon is missing.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import * as dbus from 'dbus-next';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BrainHit } from '../core/brain-contract';
import { GNOME_BUS_NAME, GNOME_OBJECT_PATH, KRUNNER_BUS_NAME, KRUNNER_OBJECT_PATH } from '../core/platform-integrations';
import { exportProvider, type Exported } from '../electron/services/platform/dbus-providers';

const hasDaemon = process.platform === 'linux' && spawnSync('dbus-daemon', ['--version']).status === 0;

const HITS: BrainHit[] = [
  { path: '/home/me/Documents/Tax return 2025.pdf', name: 'Tax return 2025.pdf', kind: 'document', size: 1000, mtime: 1, score: 0.95, snippet: 'Total   refund   due' },
  { path: '/home/me/Pictures/receipt.png', name: 'receipt.png', kind: 'image', size: 10, mtime: 2, score: 0.5 },
];

describe.skipIf(!hasDaemon)('desktop search providers over D-Bus', () => {
  let daemon: ChildProcess;
  let address = '';
  const opened: string[] = [];
  const searched: string[] = [];
  const revealed: string[] = [];
  const queries: string[] = [];
  let gnome: Exported;
  let krunner: Exported;
  let client: dbus.MessageBus;

  beforeAll(async () => {
    daemon = spawn('dbus-daemon', ['--session', '--nofork', '--print-address=1'], { stdio: ['ignore', 'pipe', 'inherit'] });
    address = await new Promise<string>((resolve) => daemon.stdout!.once('data', (d: Buffer) => resolve(d.toString().trim())));
    const deps = {
      home: '/home/me',
      search: async (q: string) => { queries.push(q); return q.includes('nothing') ? [] : HITS; },
      open: (p: string) => opened.push(p),
      searchInKeeper: (q: string) => searched.push(q),
      reveal: (p: string) => revealed.push(p),
    };
    gnome = await exportProvider('gnome', deps, dbus.sessionBus({ busAddress: address }));
    krunner = await exportProvider('krunner', deps, dbus.sessionBus({ busAddress: address }));
    client = dbus.sessionBus({ busAddress: address });
  });

  afterAll(() => {
    client?.disconnect();
    gnome?.stop();
    krunner?.stop();
    daemon?.kill();
  });

  it('GNOME: finds, describes, opens and hands over a search', async () => {
    const obj = await client.getProxyObject(GNOME_BUS_NAME, GNOME_OBJECT_PATH);
    const sp = obj.getInterface('org.gnome.Shell.SearchProvider2');
    const ids: string[] = await sp.GetInitialResultSet(['tax', 'return']);
    expect(queries.at(-1)).toBe('tax return');
    expect(ids).toEqual(['f:/home/me/Documents/Tax return 2025.pdf', 'f:/home/me/Pictures/receipt.png']);
    expect(await sp.GetInitialResultSet(['t'])).toEqual([]);
    expect(await sp.GetSubsearchResultSet(ids, ['nothing'])).toEqual([]);

    const metas: Record<string, dbus.Variant>[] = await sp.GetResultMetas([ids[0], 'f:/unknown']);
    expect(metas).toHaveLength(1);
    expect(metas[0].name.value).toBe('Tax return 2025.pdf');
    expect(metas[0].description.value).toBe('~/Documents — Total refund due');
    expect(metas[0].gicon.value).toBe('x-office-document');

    await sp.ActivateResult(ids[0], ['tax'], 0);
    expect(opened).toContain('/home/me/Documents/Tax return 2025.pdf');
    await sp.LaunchSearch(['tax', 'return'], 0);
    expect(searched).toContain('tax return');
  });

  it('KRunner: matches with subtext and file urls, runs actions', async () => {
    const obj = await client.getProxyObject(KRUNNER_BUS_NAME, KRUNNER_OBJECT_PATH);
    const r = obj.getInterface('org.kde.krunner1');
    expect(await r.Actions()).toEqual([['reveal', 'Show in folder', 'folder-open']]);
    const matches = await r.Match('receipt');
    expect(matches).toHaveLength(2);
    const [id, text, icon, type, relevance, props] = matches[0];
    expect([id, text, icon, type]).toEqual(['f:/home/me/Documents/Tax return 2025.pdf', 'Tax return 2025.pdf', 'x-office-document', 100]);
    expect(relevance).toBeCloseTo(0.95);
    expect(props.subtext.value).toBe('~/Documents');
    expect(props.urls.value).toEqual(['file:///home/me/Documents/Tax%20return%202025.pdf']);
    expect(matches[1][3]).toBe(70);
    await r.Run(matches[1][0], 'reveal');
    expect(revealed).toEqual(['/home/me/Pictures/receipt.png']);
    await r.Run(matches[1][0], '');
    expect(opened).toContain('/home/me/Pictures/receipt.png');
  });

  it('refuses to start a second provider under the same name', async () => {
    await expect(exportProvider('gnome', { search: async () => [], open: () => undefined, searchInKeeper: () => undefined }, dbus.sessionBus({ busAddress: address }))).rejects.toThrow(/already provides/);
  });
});
