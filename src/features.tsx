// SPDX-License-Identifier: AGPL-3.0-or-later
// Features in the interface: which are on (from the settings the main process
// broadcasts), which pages and commands to hide, and the sidebar the person
// customised.

import { useMemo } from 'react';
import { commandHidden, FEATURES, featureStates, hiddenRoutes, type FeatureState } from '../core/features';
import { api } from './api';
import { Icon } from './components/Icon';
import { useStore } from './state';

export function useFeatureStates(): Map<string, FeatureState> | null {
  const { settings, info } = useStore();
  return useMemo(() => (settings ? featureStates(settings, info?.platform ?? '') : null), [settings, info?.platform]);
}

export function useFeature(id: string): boolean {
  return useFeatureStates()?.get(id)?.on ?? true;
}

/** Pages whose feature is off. */
export function useHiddenRoutes(): Set<string> {
  const st = useFeatureStates();
  return useMemo(() => (st ? hiddenRoutes(st) : new Set<string>()), [st]);
}

/** Palette commands of features that are off, and commands that open hidden pages. */
export function useCommandFilter(): (id: string) => boolean {
  const st = useFeatureStates();
  const routes = useHiddenRoutes();
  return useMemo(() => (id: string) => !st || (!commandHidden(st, id) && !routes.has(id)), [st, routes]);
}

/** The key a sidebar entry is hidden by in "Customize sidebar…". */
export const navKey = (name: string, arg?: string) => `nav:${name}${arg ? `:${arg}` : ''}`;
export const sectionKey = (id: string) => `section:${id}`;

/** Shown instead of a page whose feature is off (reached from a link or a shortcut). */
export function FeatureOff({ route }: { route: string }) {
  const { go } = useStore();
  const f = FEATURES.find((x) => x.routes?.includes(route));
  if (!f) return null;
  return (
    <div className="empty" style={{ paddingTop: 80 }}>
      <Icon name="power" size={28} />
      <h2 style={{ margin: '10px 0 4px' }}>{f.name} is switched off</h2>
      <p className="muted" style={{ maxWidth: 420, margin: '0 auto 14px' }}>{f.description}</p>
      <div className="btn-row" style={{ justifyContent: 'center' }}>
        <button className="btn primary" onClick={() => void api.features.set(f.id, true)}>Turn on {f.name}</button>
        <button className="btn" onClick={() => go({ name: 'settings', arg: 'features' })}>All features</button>
      </div>
    </div>
  );
}
