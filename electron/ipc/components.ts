// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// IPC for downloadable components and add-on apps (window.keeper.components).
// Settings → Features, feature pages, first-use prompts and the welcome tour
// all use it; it broadcasts "components-changed" whenever something moves.

import { ipcMain } from 'electron';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import type { AddonInfo } from '../../core/api-components';
import { addonRow, componentsFor, isComponentId, OPTIONAL_ADDONS, type ComponentId } from '../../core/components';
import { ASHFORDE_APPS } from '../../core/ashforde/apps';
import * as mono from '../services/ashforde/monorail';
import * as comp from '../services/components';
import { listFeatures } from '../services/features';
import { settings } from '../store';

function handle(name: string, fn: (...args: never[]) => unknown) {
  ipcMain.handle(name, async (_e, ...args) => fn(...(args as never[])));
}

const id = (x: unknown): ComponentId => {
  if (typeof x !== 'string' || !isComponentId(x)) throw new Error(`Unknown part: ${String(x)}`);
  return x;
};

async function dirSize(p: string): Promise<number> {
  let n = 0;
  const walk = async (q: string) => {
    const st = await fsp.lstat(q);
    if (st.isDirectory()) for (const c of await fsp.readdir(q)) await walk(path.join(q, c));
    else n += st.size;
  };
  await walk(p).catch(() => undefined);
  return n;
}

/** Monorail (and later add-ons) as rows next to the components; hidden off a Mac. */
async function addons(): Promise<AddonInfo[]> {
  const out: AddonInfo[] = [];
  for (const a of OPTIONAL_ADDONS) {
    const def = ASHFORDE_APPS.find((x) => x.id === a.id);
    if (!def) continue;
    const offered = a.platforms.includes(process.platform);
    const st = offered ? await mono.status().catch(() => null) : null;
    const row = addonRow(a.id, process.platform, st, a.platforms);
    let size: number | undefined;
    let latest = row.latest;
    if (st?.installed && st.path) size = await dirSize(st.path);
    if (offered && st?.supported && !st.installed) {
      const info = await mono.latestInfo().catch(() => undefined);
      size = info?.size;
      latest = info?.version ?? latest;
    }
    out.push({ ...row, latest, name: def.name, description: def.tagline, size, homepage: def.homepage });
  }
  return out;
}

export function registerComponentsIpc(c: { broadcast: (channel: string, ...args: unknown[]) => void; alert?: (title: string, detail?: string) => void }) {
  const onFeatures = () => listFeatures().filter((f) => f.on).map((f) => f.id);
  comp.initComponents({ onFeatures, notice: c.alert, previousVersion: settings().lastRunVersion || undefined });
  comp.onComponentsChanged(() => c.broadcast('components-changed'));

  handle('components.list', () => comp.list());
  handle('components.sizes', () => comp.sizes());
  handle('components.download', (x: string) => comp.download(id(x)));
  handle('components.cancel', (x: string) => comp.cancel(id(x)));
  handle('components.remove', (x: string) => comp.remove(id(x)));
  handle('components.removeAll', () => comp.removeAll());
  handle('components.downloadAll', () => comp.downloadAll());
  handle('components.ensureFor', (ids: string[], o?: { partly?: boolean }) => comp.ensureComponentsFor(Array.isArray(ids) ? ids.map(String) : [], { partly: o?.partly }));
  handle('components.check', (x: string) => comp.check(id(x)));
  handle('components.switchedOn', async (featureId: string) => {
    const f = String(featureId);
    // The person's own switch: an add-on app installs (never from a preset), and parts start downloading.
    if (f === 'monorail' && mono.isMac()) {
      const st = await mono.status().catch(() => null);
      if (st?.supported && !st.installed && !st.busy) void mono.install().catch(() => undefined).finally(() => c.broadcast('components-changed'));
    }
    if (componentsFor([f]).length) void comp.ensureComponentsFor([f]).catch(() => undefined);
    return comp.list();
  });
  handle('components.addons', () => addons());
  handle('components.addonAction', async (addon: string, action: string) => {
    if (addon !== 'monorail') throw new Error('Unknown add-on');
    if (!mono.isMac()) throw new Error('Monorail runs on macOS for now.');
    if (action === 'install') await mono.install();
    else if (action === 'update') await mono.update();
    else if (action === 'open') await mono.launch();
    else if (action === 'uninstall') await mono.uninstall(false);
    else throw new Error('Unknown action');
    c.broadcast('ashforde-changed');
    return addons();
  });
}

export { ensureComponentsFor } from '../services/components';
