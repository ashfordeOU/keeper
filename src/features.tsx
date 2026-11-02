// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Features in the interface: which are on (from the settings the main process
// broadcasts), which pages and commands to hide, and the sidebar the person
// customised.

import { useMemo } from 'react';
import { commandHidden, featureDef, featureStates, hiddenRoutes, presetPatch, type FeatureState } from '../core/features';
import { featureOfRoute, navHiddenRoutes, titleOf } from '../core/nav';
import { api } from './api';
import { Empty, PageHead } from './components/ui';
import { useStore } from './state';

export function useFeatureStates(): Map<string, FeatureState> | null {
  const { settings, info, boot } = useStore();
  // Safe mode: the same features off as in the main process (the "Files only" preset), for this run only.
  return useMemo(() => (settings ? featureStates(boot.safeMode ? { ...settings, ...presetPatch(settings, 'files') } : settings, info?.platform ?? '') : null), [settings, info?.platform, boot.safeMode]);
}

export function useFeature(id: string): boolean {
  return useFeatureStates()?.get(id)?.on ?? true;
}

/** Pages whose feature is off. */
export function useHiddenRoutes(): Set<string> {
  const st = useFeatureStates();
  return useMemo(() => (st ? new Set([...hiddenRoutes(st), ...navHiddenRoutes(st)]) : new Set<string>()), [st]);
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

/** Shown instead of a page whose feature is off (reached from a link or a shortcut): the page keeps its title. */
export function FeatureOff({ route }: { route: string }) {
  const { go } = useStore();
  const f = featureDef(featureOfRoute(route) ?? '');
  if (!f) return null;
  const title = titleOf({ name: route }) ?? f.name;
  return (
    <div className="feature-off">
      <PageHead title={title} />
      <Empty icon="power" title={`${title} is turned off`} action={<>
        <button className="btn primary" onClick={() => void api.features.set(f.id, true)}>Turn on</button>
        <button className="btn" onClick={() => go({ name: 'settings', arg: 'features' })}>All features</button>
      </>}>{f.description}</Empty>
    </div>
  );
}
