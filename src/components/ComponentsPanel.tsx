// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Downloadable parts of Keeper (ffmpeg, ONNX Runtime, rclone) and add-on apps
// (Monorail) in the interface. Small pieces other screens drop in:
//
//   useComponents()             the list and the add-ons, kept fresh ("components-changed")
//   useEnsureComponents()       for the welcome tour: ensure(featureIds) after a preset
//   <ComponentNeeds featureId>  inline "Download <part> (<size>)" with progress (a Features row)
//   <ComponentPrompt featureId> the same as a banner on a feature's own page / first use
//   <ComponentsSection />       every part with its size on disk, "Download everything for
//                               offline use", "Free up space", and the add-on apps

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AddonInfo } from '../../core/api-components';
import { downloadLabel, formatBytes, missingFor, offlineTotal, usable, type ComponentId, type ComponentInfo } from '../../core/components';
import { api } from '../api';
import { useStore } from '../state';
import { Icon } from './Icon';
import '../styles/features.css';

const clean = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

let shared: ComponentInfo[] | null = null;
const subs = new Set<(l: ComponentInfo[]) => void>();
let loading: Promise<void> | null = null;
function reload() {
  loading ??= api.components.list().then((l) => { shared = l; for (const s of subs) s(l); }).catch(() => undefined).finally(() => { loading = null; });
  return loading;
}
let wired = false;
function wire() {
  if (wired) return;
  wired = true;
  api.on('components-changed', () => void reload());
  api.on('features-changed', () => void reload());
}

/** Every component's state, shared by all screens and refreshed on "components-changed". */
export function useComponents(): { list: ComponentInfo[] | null; refresh: () => void } {
  const [list, setList] = useState<ComponentInfo[] | null>(shared);
  useEffect(() => {
    wire();
    subs.add(setList);
    if (!shared) void reload();
    return () => { subs.delete(setList); };
  }, []);
  return { list, refresh: () => void reload() };
}

/** Add-on apps (Monorail on a Mac), refreshed while they install. */
export function useAddons(): { addons: AddonInfo[] | null; refresh: () => void } {
  const [addons, setAddons] = useState<AddonInfo[] | null>(null);
  const refresh = useCallback(() => void api.components.addons().then(setAddons).catch(() => undefined), []);
  useEffect(() => {
    refresh();
    const a = api.on('ashforde-changed', refresh);
    const b = api.on('components-changed', refresh);
    return () => { a(); b(); };
  }, [refresh]);
  return { addons, refresh };
}

/**
 * For the welcome tour (and anything that switches several features at once):
 *
 *   const { ensure, pending, busy } = useEnsureComponents();
 *   await ensure(featureIdsOfThePreset);   // downloads what they need; never installs add-on apps
 *   pending(featureIds)                    // the parts still missing, with sizes, to show before
 *   offerAddons(featureIds)                // add-on apps the preset could offer (Install is a separate button)
 */
export function useEnsureComponents() {
  const { list } = useComponents();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const ensure = useCallback(async (featureIds: string[], o?: { partly?: boolean }) => {
    setBusy(true);
    setError(undefined);
    try {
      return await api.components.ensureFor(featureIds, o);
    } catch (e) {
      setError(clean(e));
      return shared ?? [];
    } finally {
      setBusy(false);
    }
  }, []);
  const pending = useCallback((featureIds: string[]) => {
    if (!list) return [];
    const seen = new Map<ComponentId, ComponentInfo>();
    for (const f of featureIds) for (const c of missingFor(f, list)) seen.set(c.id, c);
    return [...seen.values()];
  }, [list]);
  const offerAddons = useCallback((featureIds: string[], platform: string) => (platform === 'darwin' && featureIds.includes('monorail') ? ['monorail'] : []), []);
  const downloading = (list ?? []).filter((c) => c.state === 'downloading' || c.state === 'verifying');
  const progress = downloading.length ? downloading.reduce((n, c) => n + (c.progress ?? 0), 0) / downloading.length : undefined;
  return { ensure, pending, offerAddons, busy: busy || downloading.length > 0, progress, error, list };
}

function Progress({ c }: { c: ComponentInfo }) {
  const p = c.progress ?? 0;
  return (
    <span className="component-progress" role="progressbar" aria-label={`${c.name} download`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p * 100)}>
      <span className={`progress ${c.state === 'verifying' ? 'indeterminate' : ''}`}><i style={{ width: c.state === 'verifying' ? undefined : `${Math.round(p * 100)}%` }} /></span>
      <span className="small muted">{c.state === 'verifying' ? 'Checking…' : `${Math.round(p * 100)}% of ${formatBytes(c.downloadSize)}`}</span>
    </span>
  );
}

/** One part's download control: button, progress with Cancel, or the problem with Retry. */
export function ComponentDownload({ c, why }: { c: ComponentInfo & { partly?: string }; why?: string }) {
  const { toast } = useStore();
  const go = () => void api.components.download(c.id).catch((e) => toast(clean(e)));
  if (c.state === 'downloading' || c.state === 'verifying') {
    return (
      <div className="component-need" data-testid={`component-${c.id}`} data-state={c.state}>
        <Progress c={c} />
        <button className="btn sm ghost" onClick={() => void api.components.cancel(c.id)}>Cancel</button>
      </div>
    );
  }
  return (
    <div className="component-need" data-testid={`component-${c.id}`} data-state={c.state}>
      <button className="btn sm" onClick={go}><Icon name="download" size={12} /> {downloadLabel(c)}</button>
      {why ? <span className="small muted">for {why}</span> : null}
      {c.state === 'outdated' ? <span className="small muted">for this version of Keeper</span> : null}
      {c.error ? <span className={`small ${c.offline ? 'muted' : 'warn-text'}`}>{c.error}{c.offline ? '' : ' '}{!c.offline ? <button className="btn sm ghost" onClick={go}>Retry</button> : null}</span> : null}
    </div>
  );
}

/** Inline in a Features row: what a switched-on feature still needs to download, or its size on disk. */
export function ComponentNeeds({ featureId, on }: { featureId: string; on: boolean }) {
  const { list } = useComponents();
  if (!list) return null;
  const needs = missingFor(featureId, list);
  if (on && needs.length) return <div className="component-needs">{needs.map((c) => <ComponentDownload key={c.id} c={c} why={c.partly} />)}</div>;
  const here = list.filter((c) => usable(c.state) && c.sizeOnDisk > 0 && c.neededBy.includes(featureId));
  if (!on || !here.length) return null;
  return <div className="small muted component-disk">Downloaded: {here.map((c) => `${c.name} ${formatBytes(c.sizeOnDisk)}`).join(' · ')}</div>;
}

/**
 * A banner on a feature's own page (and the first-use prompt): shown while the
 * feature is on but a part it needs is missing. `only` limits it to parts the
 * page needs right now (e.g. Convert asks for ffmpeg only when a video is chosen).
 */
export function ComponentPrompt({ featureId, only, title }: { featureId: string; only?: ComponentId[]; title?: string }) {
  const { list } = useComponents();
  if (!list) return null;
  const needs = missingFor(featureId, list).filter((c) => !only || only.includes(c.id));
  if (!needs.length) return null;
  return (
    <div className="card component-prompt" role="status" data-testid={`component-prompt-${featureId}`}>
      <Icon name="download" size={16} />
      <div className="grow">
        <b>{title ?? 'One more part to download'}</b>
        <div className="small muted">{needs.map((c) => c.description).join(' ')} It is downloaded once from Keeper’s own release and checked before use.</div>
        {needs.map((c) => <ComponentDownload key={c.id} c={c} why={c.partly} />)}
      </div>
    </div>
  );
}

const STATE_WORD: Record<ComponentInfo['state'], string> = {
  bundled: 'Included in this installer', installed: 'Downloaded', dev: 'Development copy', missing: 'Not downloaded', outdated: 'Needs the new version',
  downloading: 'Downloading', verifying: 'Checking', error: 'Not downloaded', unavailable: 'Not available on this computer',
};

/** Settings: every part with its state and size, offline download, free up space, and the add-on apps. */
export function ComponentsSection({ platform }: { platform: string }) {
  const { list } = useComponents();
  const { toast } = useStore();
  const total = useMemo(() => (list ? offlineTotal(list) : { ids: [], bytes: 0 }), [list]);
  const onDisk = (list ?? []).filter((c) => c.state === 'installed' || c.state === 'outdated').reduce((n, c) => n + c.sizeOnDisk, 0);
  if (!list) return null;
  return (
    <div className="components-section" data-testid="components">
      <div className="feature-group-title">Downloadable parts</div>
      <div className="small muted" style={{ marginBottom: 8 }}>Keeper downloads these when a feature that needs them is switched on, from its own release, and checks each one before use.</div>
      {list.map((c) => (
        <div key={c.id} className="feature-row" data-testid={`components-row-${c.id}`} data-state={c.state}>
          <div className="grow">
            <div className="feature-name">{c.name}</div>
            <div className="small muted">{c.description}</div>
            <div className="small muted">
              {STATE_WORD[c.state]}
              {c.sizeOnDisk ? ` · ${formatBytes(c.sizeOnDisk)} on disk` : usable(c.state) || c.state === 'unavailable' ? '' : ` · ${c.estimate ? 'about ' : ''}${formatBytes(c.downloadSize)} to download`}
              {c.neededBy.length ? ` · used by ${c.neededBy.length} feature${c.neededBy.length > 1 ? 's' : ''} that are on` : ''}
            </div>
            {!usable(c.state) && c.state !== 'unavailable' && c.state !== 'missing' ? <ComponentDownload c={c} /> : null}
          </div>
          {c.state === 'missing' ? <button className="btn sm" onClick={() => void api.components.download(c.id).catch((e) => toast(clean(e)))}>Download</button> : null}
          {c.state === 'installed' || c.state === 'outdated' ? <button className="btn sm ghost" onClick={() => void api.components.remove(c.id).then(() => toast(`Freed ${formatBytes(c.sizeOnDisk)}`))}>Free up space</button> : null}
        </div>
      ))}
      <div className="feature-row">
        <div className="grow small muted">{total.ids.length ? `Everything for offline use: ${formatBytes(total.bytes)} more.` : 'Everything is on this computer.'}{onDisk ? ` Downloaded parts use ${formatBytes(onDisk)}.` : ''}</div>
        {total.ids.length ? <button className="btn sm" data-testid="components-download-all" onClick={() => void api.components.downloadAll().catch((e) => toast(clean(e)))}>Download everything for offline use</button> : null}
        {onDisk ? <button className="btn sm ghost" onClick={() => void api.components.removeAll().then(() => toast(`Freed ${formatBytes(onDisk)}`))}>Free up space</button> : null}
      </div>
      <AddonsSection platform={platform} />
    </div>
  );
}

/** Add-on apps (Monorail): description, size, installed and latest version, Install / Update / Open / Uninstall. */
export function AddonsSection({ platform }: { platform: string }) {
  const { addons, refresh } = useAddons();
  const { toast } = useStore();
  const [working, setWorking] = useState<string | null>(null);
  if (!addons) return null;
  const shown = addons.filter((a) => a.visible);
  const hidden = addons.filter((a) => !a.visible);
  const act = async (a: AddonInfo, action: 'install' | 'update' | 'open' | 'uninstall') => {
    setWorking(`${a.id}:${action}`);
    try {
      await api.components.addonAction(a.id, action);
    } catch (e) {
      toast(clean(e));
    } finally {
      setWorking(null);
      refresh();
    }
  };
  const label = { install: 'Install', update: 'Update', open: 'Open', uninstall: 'Uninstall' } as const;
  return (
    <>
      <div className="feature-group-title" style={{ marginTop: 12 }}>Add-on apps</div>
      {shown.map((a) => (
        <div key={a.id} className="feature-row" data-testid={`addon-${a.id}`}>
          <div className="grow">
            <div className="feature-name">{a.name}</div>
            <div className="small muted">{a.description}</div>
            <div className="small muted" data-testid={`addon-${a.id}-line`}>
              {a.line}{a.latest && !a.installed ? ` · latest ${a.latest}` : ''}{a.size ? ` · ${formatBytes(a.size)}${a.installed ? ' on disk' : ''}` : ''}
            </div>
            {a.busy?.progress !== undefined ? <span className="progress"><i style={{ width: `${Math.round(a.busy.progress * 100)}%` }} /></span> : null}
            {a.error ? <div className="small warn-text">{a.error}</div> : null}
          </div>
          {a.actions.map((x) => (
            <button key={x} className={`btn sm ${x === 'uninstall' ? 'ghost' : ''}`} disabled={!!working} onClick={() => void act(a, x)}>{working === `${a.id}:${x}` ? '…' : label[x]}</button>
          ))}
        </div>
      ))}
      {hidden.map((a) => <div key={a.id} className="small muted" data-testid={`addon-${a.id}-note`}>{a.note}</div>)}
      {!shown.length && !hidden.length && platform ? null : null}
    </>
  );
}
