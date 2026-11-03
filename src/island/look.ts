// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The Island's colours from Keeper's settings: the active theme in the mode on screen, the look chosen in
// Settings → Island → Look, and the colour of what is going on (core/island-look.ts does the work). Used by the
// Island itself and by the preview in Settings, so both always agree.

import { useEffect, useMemo, useState } from 'react';
import type { IslandSettings } from '../../core/api';
import { islandPalette, type IslandPalette } from '../../core/island-look';
import { resolveMode, themeById } from '../../core/themes';
import type { Settings } from '../../core/types';
import { activeThemeId, onSystemAppearance } from '../theme';

const systemDark = () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;

/** The system's light or dark appearance, followed as it changes. */
export function useSystemDark(): boolean {
  const [dark, setDark] = useState(systemDark);
  useEffect(() => onSystemAppearance(() => setDark(systemDark())), []);
  return dark;
}

type ThemeBits = Pick<Settings, 'theme' | 'look' | 'appearance' | 'accent' | 'themeSeasons' | 'hemisphere'>;
type LookBits = Pick<IslandSettings, 'look' | 'lookIntensity' | 'lookPreset' | 'lookAccent'>;

/** The palette for these settings (null settings: Keeper's default theme). */
export function paletteFor(s: (ThemeBits & { island?: Partial<IslandSettings> }) | null | undefined, look: Partial<LookBits> | undefined, live: string | undefined, dark: boolean): IslandPalette {
  const t = themeById(s ? activeThemeId(s) : undefined);
  const mode = resolveMode(t, s?.appearance ?? 'system', dark);
  const tokens = (mode === 'dark' ? t.dark : t.light) ?? t.dark ?? t.light!;
  return islandPalette({ tokens, mode, look: look?.look, lookIntensity: look?.lookIntensity, lookPreset: look?.lookPreset, lookAccent: look?.lookAccent, live, appAccent: s?.accent || undefined });
}

/** The palette, worked out again only when something it depends on changes. */
export function useIslandPalette(s: (ThemeBits & { island?: Partial<IslandSettings> }) | null | undefined, look: Partial<LookBits> | undefined, live?: string): IslandPalette {
  const dark = useSystemDark();
  return useMemo(
    () => paletteFor(s, look, live, dark),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s?.theme, s?.look, s?.themeSeasons, s?.hemisphere, s?.appearance, s?.accent, s?.island?.place?.lat, look?.look, look?.lookIntensity, look?.lookPreset, look?.lookAccent, live, dark],
  );
}
