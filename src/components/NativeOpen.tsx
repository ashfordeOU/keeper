// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// "Open in Maps" and "Directions" for anything with a place, and "Open in
// Find My" for devices and people Find My reported. They follow Settings →
// Open with, so a Mac opens Apple Maps unless Google Maps is the choice.

import type { MouseEvent } from 'react';
import { openNative } from '../lib/native';
import { useStore } from '../state';
import { Icon } from './Icon';

export interface PlaceRef { lat?: number; lon?: number; label?: string; address?: string }

export function MapButtons({ place, findMy, compact }: { place: PlaceRef; findMy?: boolean; compact?: boolean }) {
  const { toast } = useStore();
  const run = (e: MouseEvent, f: () => Promise<void>) => { e.stopPropagation(); void f(); };
  const cls = compact ? 'btn ghost sm icon' : 'btn sm';
  return (
    <span className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
      <button className={cls} title="Open in Maps" aria-label="Open in Maps" onClick={(e) => run(e, () => openNative('maps', place, toast))}><Icon name="map" size={12} />{compact ? null : ' Open in Maps'}</button>
      <button className={cls} title="Directions" aria-label="Directions" onClick={(e) => run(e, () => openNative('maps', { ...place, directions: true }, toast))}><Icon name="send" size={12} />{compact ? null : ' Directions'}</button>
      {findMy ? <button className={cls} title="Open in Find My" aria-label="Open in Find My" onClick={(e) => run(e, () => openNative('findMy', {}, toast))}><Icon name="external" size={12} />{compact ? null : ' Open in Find My'}</button> : null}
    </span>
  );
}
