// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage-aware decluttering: when each part's pages were last opened, kept in
// page-use.json in Keeper's data folder and never sent anywhere. The Fix-it
// List gets a gentle row for a part unopened for 30 days, with Turn it off and
// Undo (core/declutter.ts). Settings → Features → "Suggest turning off parts I
// don't use" switches the suggestions off; the counting is a few bytes a day.

import { app, ipcMain } from 'electron';
import { promises as fsp, readFileSync } from 'node:fs';
import path from 'node:path';
import { declutterFindings, declutterPatch, featureOfFinding, noteUse, normalizeUse, unusedParts, type PageUse } from '../../core/declutter';
import { featureDef, featureStates } from '../../core/features';
import { featureOfRoute } from '../../core/nav';
import { settings, updateSettings } from '../store';
import { registerAutoFix, registerFindings } from './guide';

let use: PageUse | null = null;
let dirty = false;
let timer: ReturnType<typeof setTimeout> | null = null;

const file = () => path.join(app.getPath('userData'), 'page-use.json');

function load(): PageUse {
  if (use) return use;
  try {
    use = normalizeUse(JSON.parse(readFileSync(file(), 'utf8')), Date.now());
  } catch {
    use = normalizeUse(null, Date.now());
    dirty = true;
    later();
  }
  return use;
}

function later() {
  if (timer) return;
  // At most one small write a minute.
  timer = setTimeout(() => {
    timer = null;
    if (!dirty || !use) return;
    dirty = false;
    const tmp = `${file()}.${process.pid}.tmp`;
    void fsp.writeFile(tmp, JSON.stringify(use)).then(() => fsp.rename(tmp, file())).catch(() => undefined);
  }, 60_000);
  timer.unref?.();
}

/** A page was opened: its part counts as used today. */
export function pageOpened(routeName: string) {
  const id = featureOfRoute(routeName);
  if (!id) return;
  const u = load();
  const last = u.parts[id]?.last ?? 0;
  // Once an hour is plenty to know a part is used.
  if (Date.now() - last < 3600_000) return;
  use = noteUse(u, id, Date.now());
  dirty = true;
  later();
}

export function registerPageUse() {
  ipcMain.handle('pageUse.opened', (_e, name: unknown) => { if (typeof name === 'string' && name.length < 40) pageOpened(name); });
  registerFindings('declutter', () => {
    if (settings().declutter === false) return [];
    return declutterFindings(unusedParts(featureStates(settings()), load(), Date.now()));
  });
  registerAutoFix('declutter.off', {
    async preview(f) {
      const id = featureOfFinding(f.id);
      const def = id ? featureDef(id) : undefined;
      return { summary: `Turn off ${def?.name ?? 'this part'}`, items: def ? [{ label: def.name, detail: def.description }] : [], undoable: true, warning: 'Nothing you made is removed. Turn it on again in Settings → Features, or with Undo.' };
    },
    async apply(f) {
      const id = featureOfFinding(f.id);
      if (!id) return { ok: false, message: 'Not a part Keeper knows.' };
      await updateSettings(declutterPatch(settings(), id, false));
      return { ok: true, message: `${featureDef(id)?.name ?? 'It'} is off.`, undoable: true };
    },
    async undo(f) {
      const id = featureOfFinding(f.id);
      if (!id) return { ok: false, message: 'Not a part Keeper knows.' };
      await updateSettings(declutterPatch(settings(), id, true));
      // Turned back on: it counts as used today, so it is not suggested again at once.
      use = noteUse(load(), id, Date.now());
      dirty = true;
      later();
      return { ok: true, message: `${featureDef(id)?.name ?? 'It'} is on again.` };
    },
  });
}
