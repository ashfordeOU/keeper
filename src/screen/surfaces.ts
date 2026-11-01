// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Which places show remote access (tray, Island, palette, right-click menu),
// read once from Keeper Link's settings and kept fresh, for code that needs
// the answer right away (menus are built synchronously).

import { useEffect, useState } from 'react';
import { surfaceOn, type Surface, type SurfaceItem } from '../../core/link/surfaces';
import { api } from '../api';

let chosen: Record<string, string[]> | undefined;
let devices: { id: string; name: string; online: boolean }[] = [];
let started = false;
const subs = new Set<() => void>();

function start() {
  if (started) return;
  started = true;
  const load = () =>
    void api.link?.state?.().then((s) => {
      chosen = s.settings.surfaces;
      devices = s.devices.map((d) => ({ id: d.id, name: d.name, online: d.online }));
      subs.forEach((f) => f());
    }).catch(() => undefined);
  load();
  api.on?.('link-changed', load);
}

/** Right now, from what was last read (everything on until it has been read). */
export function shownIn(item: SurfaceItem, place: Surface): boolean {
  start();
  return surfaceOn(chosen, item, place);
}

export function knownDevices() {
  start();
  return devices;
}

export function useSurface(item: SurfaceItem, place: Surface): boolean {
  const [, tick] = useState(0);
  useEffect(() => {
    start();
    const f = () => tick((n) => n + 1);
    subs.add(f);
    return () => void subs.delete(f);
  }, []);
  return surfaceOn(chosen, item, place);
}
