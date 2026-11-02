// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Places & Tracks outside its own page: command palette entries ("Where is my
// laptop?"), "Show on Map" in the file browser's right-click menu, and the
// sidebar entry. Places & Tracks → Settings → Where it appears chooses which.

import { useEffect, useMemo, useState } from 'react';
import type { LivePosition, TracksConfig } from '../../core/tracks/api';
import { api } from '../api';
import type { Route } from '../state';
import { openNative } from '../lib/native';

let cached: TracksConfig | null = null;
let livePos: LivePosition[] = [];
let liveOn = false;
const subs = new Set<() => void>();
let started = false;
let version = 0;

async function refresh() {
  try {
    const o = await api.tracks.brief();
    cached = o.config;
    liveOn = o.features.tracks && o.features.live;
    livePos = o.live;
  } catch {
    /* switched off */
  }
  version++;
  for (const f of subs) f();
}

function start() {
  if (started) return;
  started = true;
  void refresh();
  // Only a change to Places & Tracks or the features list asks again; nothing polls.
  api.on('tracks-changed', () => void refresh());
  api.on('features-changed', () => void refresh());
}

/** Places & Tracks settings, kept fresh (shared by every part of the window). */
export function useTracksConfig(): TracksConfig | null {
  const [, setN] = useState(0);
  useEffect(() => {
    start();
    const f = () => setN((n) => n + 1);
    subs.add(f);
    return () => { subs.delete(f); };
  }, []);
  return cached;
}

export function useSurface(which: keyof TracksConfig['surfaces']): boolean {
  const c = useTracksConfig();
  return c ? c.surfaces[which] !== false : true;
}

/** Files that "Show on Map" can open. */
export const MAP_FILE = /\.(gpx|fit|tcx|kml|kmz|geojson|jpe?g|heic|heif|tiff?|dng)$/i;

export interface PaletteCommand {
  id: string;
  label: string;
  group: 'Go to' | 'Actions';
  icon: string;
  keywords?: string;
  run: () => unknown;
}

/** Command palette entries: one "Where is …?" per device, item and person, and the page itself. */
export function useTracksCommands(go: (r: Route) => void): PaletteCommand[] {
  const on = useSurface('palette');
  const v = version;
  return useMemo(() => (!on ? [] : [
    { id: 'tracks', label: 'Places & Tracks', group: 'Go to' as const, icon: 'map', keywords: 'timeline location history trips map gps activities where', run: () => go({ name: 'tracks' }) },
    { id: 'tracks-trips', label: 'Trips', group: 'Go to' as const, icon: 'map', keywords: 'travel itinerary holiday vacation countries', run: () => go({ name: 'tracks', arg: 'trips' }) },
    { id: 'tracks-activities', label: 'Activities (runs, rides, walks)', group: 'Go to' as const, icon: 'bolt', keywords: 'workout run ride gpx fit pace personal records heatmap', run: () => go({ name: 'tracks', arg: 'activities' }) },
    { id: 'tracks-import', label: 'Import Tracks or Location History…', group: 'Actions' as const, icon: 'down', keywords: 'gpx fit tcx kml google timeline takeout apple health', run: () => go({ name: 'tracks', arg: 'import' }) },
    { id: 'tracks-search', label: 'When Was I Last In…', group: 'Actions' as const, icon: 'search', keywords: 'last visit place timeline search where was i', run: () => go({ name: 'tracks', arg: 'search' }) },
    ...(liveOn ? livePos.map((p) => ({ id: `tracks-where-${p.id}`, label: `Where Is ${p.kind === 'person' || /^my /i.test(p.name) ? '' : 'My '}${p.name}?`, group: 'Actions' as const, icon: 'map', keywords: `where find locate ${p.kind} ${p.name} location`, run: () => go({ name: 'tracks', arg: `live:${p.id}` }) })) : []),
    // Devices, items and people Find My reported open in Find My itself; the rest in Maps.
    ...(liveOn ? livePos.map((p) => (p.source === 'findmy'
      ? { id: `tracks-findmy-${p.id}`, label: `Open ${p.name} in Find My`, group: 'Actions' as const, icon: 'map', keywords: `find my locate ${p.kind} ${p.name} play sound lost`, run: () => openNative('findMy') }
      : { id: `tracks-maps-${p.id}`, label: `Show ${p.name} in Maps`, group: 'Actions' as const, icon: 'map', keywords: `maps directions ${p.kind} ${p.name}`, run: () => openNative('maps', { lat: p.lat, lon: p.lon, label: p.name }) })) : []),
  ]), [on, v, go]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** "Show on Map" for a track file or a photo in the right-click menu (when it fits and is wanted). */
export function tracksFileMenu(path: string, go: (r: Route) => void): { label: string; icon: string; run: () => void }[] {
  if (cached && cached.surfaces.fileMenu === false) return [];
  if (!MAP_FILE.test(path)) return [];
  return [{ label: 'Show on Map', icon: 'map', run: () => go({ name: 'tracks', arg: `file:${path}` }) }];
}

// Start listening once anything imports this module (the palette or the file menu).
if (typeof window !== 'undefined') setTimeout(start, 0);
