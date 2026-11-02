// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Settings → Features: every part of Keeper with an on/off switch and what it
// costs, presets, and Customize sidebar.

import { useEffect, useMemo, useState } from 'react';
import { currentPreset, currentSet, FEATURES, featureDef, NAV_GROUPS, PRESETS, type ComputerContext, type CostLevel, type FeatureSet } from '../../core/features';
import { api } from '../api';
import { useFeatureStates } from '../features';
import { useStore } from '../state';
import { Icon } from './Icon';
import { SuitePanel } from './SuitePanel';
import { SECTION_COLOR, SECTION_IDS, SECTION_NAMES } from './NavSection';
import { Toggle } from './ui';
import { ComponentNeeds, ComponentsSection } from './ComponentsPanel';
import '../styles/features.css';

const COST_WORD: Record<CostLevel, string> = { none: 'Nothing until you use it', low: 'Light', medium: 'Some', high: 'Heavy while working' };

export function FeaturesPanel() {
  const { settings, info, toast } = useStore();
  const states = useFeatureStates();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [ctx, setCtx] = useState<ComputerContext | undefined>();
  useEffect(() => { void api.setup?.context().then(setCtx).catch(() => undefined); }, []);
  const preset = settings ? currentPreset(settings, ctx) : undefined;
  const [sets, setSets] = useState<{ sets: FeatureSet[]; onBattery: string; onPower: string } | null>(null);
  const [live, setLive] = useState<Record<string, { name: string; everyMs: number | null; runs: number }[]>>({});
  const [newName, setNewName] = useState('');
  useEffect(() => { void api.features.sets().then(setSets); }, [settings?.featureSets]);
  // What each feature has running now: looked up while this page is open, every 5 seconds.
  useEffect(() => {
    const load = () => void api.features.live().then((l) => setLive(Object.fromEntries(l.map((x) => [x.id, x.checks]))));
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);
  const mySet = settings && sets ? currentSet(settings, sets.sets, info?.platform ?? '') : undefined;
  const choices = [...PRESETS.map((p) => ({ ref: `preset:${p.id}`, name: p.name })), ...(sets?.sets ?? []).map((x) => ({ ref: x.id, name: x.name }))];
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return FEATURES.filter((f) => !f.platforms || f.platforms.includes((info?.platform ?? '') as NodeJS.Platform))
      .filter((f) => !t || `${f.name} ${f.description} ${NAV_GROUPS.find((g) => g.id === f.navGroup)?.title ?? f.group} ${f.cost.background ?? ''}`.toLowerCase().includes(t));
  }, [q, info?.platform]);
  if (!settings || !states) return null;

  const set = async (id: string, on: boolean) => {
    setBusy(id);
    try {
      await api.features.set(id, on);
      // The person's own switch: the parts it needs start downloading (and an add-on app installs).
      if (on) void api.components.switchedOn(id).catch(() => undefined);
      const f = featureDef(id);
      const needs = on ? (f?.requires ?? []).filter((r) => !states.get(r)?.on) : [];
      if (needs.length) toast(`Also turned on ${needs.map((r) => featureDef(r)?.name).join(', ')}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="features">
      <div className="feature-presets" role="radiogroup" aria-label="Presets">
        {PRESETS.map((p) => (
          <button key={p.id} role="radio" aria-checked={preset === p.id} className={`feature-preset ${preset === p.id ? 'on' : ''}`} onClick={() => void api.features.preset(p.id)} title={p.description}>
            <b>{p.name}</b>
            <span className="small muted">{p.description}</span>
          </button>
        ))}
        {/* Anything else is Custom: the person's own mix. */}
        <button role="radio" aria-checked={!preset} aria-disabled className={`feature-preset ${!preset ? 'on' : ''}`} data-testid="preset-custom" title="Your own mix of parts">
          <b>Custom</b>
          <span className="small muted">Your own mix of parts.</span>
        </button>
      </div>
      <div className="feature-sets" data-testid="feature-sets">
        <div className="feature-group-title">Your sets</div>
        {(sets?.sets ?? []).map((x) => (
          <div key={x.id} className={`feature-row ${mySet === x.id ? 'current' : ''}`}>
            <div className="grow"><div className="feature-name">{x.name}{mySet === x.id ? <span className="badge" style={{ marginLeft: 6 }}>In use</span> : null}</div>
              <div className="small muted">{Object.values(x.features).filter(Boolean).length} features on</div></div>
            <button className="btn sm" onClick={() => void api.features.applySet(x.id)}>Use</button>
            <button className="btn sm" title="Save the current choices into this set" onClick={() => void api.features.saveSet(x.name, x.id).then(setSets)}>Update</button>
            <button className="btn sm ghost icon" aria-label={`Remove ${x.name}`} onClick={() => void api.features.removeSet(x.id).then(setSets)}><Icon name="close" size={12} /></button>
          </div>
        ))}
        <div className="feature-row">
          <input className="input grow" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Name for the current choices, e.g. Travel" aria-label="New set name" />
          <button className="btn sm" disabled={!newName.trim()} onClick={() => void api.features.saveSet(newName).then((r) => { setSets(r); setNewName(''); toast('Saved'); })}>Save as a set</button>
        </div>
        <div className="feature-row">
          <div className="grow"><div className="feature-name">Switch by power source</div><div className="small muted">Use a lighter set on battery and everything on power, automatically.</div></div>
          <label className="small">On battery{' '}
            <select className="input" value={sets?.onBattery ?? ''} onChange={(e) => sets && void api.features.setPowerSets(e.target.value, sets.onPower).then(setSets)}>
              <option value="">Leave as is</option>{choices.map((c) => <option key={c.ref} value={c.ref}>{c.name}</option>)}
            </select></label>
          <label className="small">On power{' '}
            <select className="input" value={sets?.onPower ?? ''} onChange={(e) => sets && void api.features.setPowerSets(sets.onBattery, e.target.value).then(setSets)}>
              <option value="">Leave as is</option>{choices.map((c) => <option key={c.ref} value={c.ref}>{c.name}</option>)}
            </select></label>
        </div>
      </div>
      <SuitePanel />
      <div className="feature-search">
        <Icon name="search" size={14} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a feature" aria-label="Find a feature" />
      </div>
      {/* The same groups, in the same order, as the sidebar's sections. */}
      {NAV_GROUPS.map(({ id: g, title }) => {
        const rows = list.filter((f) => f.navGroup === g);
        if (!rows.length) return null;
        return (
          <div key={g} className="feature-group" data-group={g}>
            <div className="feature-group-title">{title}</div>
            {rows.map((f) => {
              const st = states.get(f.id);
              const wanted = f.id === 'login' ? !!st?.wanted : st?.wanted ?? true;
              return (
                <div key={f.id} data-feature={f.id} className={`feature-row ${st?.on === false ? 'off' : ''}`}>
                  <div className="grow">
                    <div className="feature-name">{f.name}{f.always ? <span className="badge" style={{ marginLeft: 6 }}>Always on</span> : null}</div>
                    <div className="small muted">{f.description}</div>
                    <div className="feature-cost small">
                      <span className={`cost-dot ${f.cost.level}`} />
                      {COST_WORD[f.cost.level]}
                      {f.cost.background ? <> · {f.cost.background}</> : null}
                      {f.cost.windows ? <> · {f.cost.windows}</> : null}
                      {f.cost.memory ? <> · {f.cost.memory}</> : null}
                    </div>
                    {st?.on && live[f.id]?.length ? (
                      <div className="small muted feature-live" data-testid={`feature-live-${f.id}`}>
                        Now: {live[f.id].map((c) => `${c.name.replace(/^[^.]*\./, '')} ${c.everyMs === null ? 'paused' : `every ${c.everyMs >= 60_000 ? `${Math.round(c.everyMs / 60_000)} min` : `${Math.round(c.everyMs / 1000) || '<1'} s`}`}`).join(' · ')}
                      </div>
                    ) : st?.on === false ? <div className="small muted feature-live">Now: nothing running</div> : null}
                    <ComponentNeeds featureId={f.id} on={!!st?.on} />
                    {st?.blockedBy?.length && wanted ? (
                      <div className="small warn-text">Needs {st.blockedBy.map((b) => featureDef(b)?.name ?? b).join(' and ')}. <button className="link-btn" onClick={() => void set(f.id, true)}>Turn on {st.blockedBy.length > 1 ? 'all' : 'both'}</button></div>
                    ) : null}
                  </div>
                  <Toggle on={wanted} onChange={(v) => !f.always && busy !== f.id && void set(f.id, v)} />
                </div>
              );
            })}
          </div>
        );
      })}
      <ComponentsSection platform={info?.platform ?? ''} />
    </div>
  );
}

/** Settings → Sidebar: show, hide and reorder the sidebar's sections; bring back hidden entries. */
export function SidebarPanel() {
  const { settings, updateSettings } = useStore();
  if (!settings) return null;
  const order = [...(settings.sidebarOrder?.length ? settings.sidebarOrder : []), ...SECTION_IDS.filter((s) => !settings.sidebarOrder?.includes(s))];
  const hidden = settings.sidebarHidden ?? [];
  const move = (i: number, d: -1 | 1) => {
    const next = [...order];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    void updateSettings({ sidebarOrder: next });
  };
  const toggle = (key: string, show: boolean) => void updateSettings({ sidebarHidden: show ? hidden.filter((h) => h !== key) : [...hidden, key] });
  const hiddenEntries = hidden.filter((h) => h.startsWith('nav:'));
  return (
    <div className="sidebar-custom">
      {order.map((id, i) => {
        const shown = !hidden.includes(`section:${id}`);
        return (
          <div key={id} className="sidebar-custom-row">
            <i className="sec-dot" style={{ background: SECTION_COLOR[id] }} />
            <span className="grow">{SECTION_NAMES[id] ?? id}</span>
            <button className="btn sm ghost icon" title="Move up" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><Icon name="arrowUp" size={13} /></button>
            <button className="btn sm ghost icon" title="Move down" aria-label="Move down" disabled={i === order.length - 1} onClick={() => move(i, 1)}><Icon name="chevronDown" size={13} /></button>
            <Toggle on={shown} onChange={(v) => toggle(`section:${id}`, v)} />
          </div>
        );
      })}
      {hiddenEntries.length ? (
        <div className="small" style={{ marginTop: 10 }}>
          Hidden entries:{' '}
          {hiddenEntries.map((h) => (
            <button key={h} className="chip" onClick={() => toggle(h, true)} title="Show again">{h.slice(4).replace(/:.*$/, '')} <Icon name="plus" size={11} /></button>
          ))}
        </div>
      ) : null}
      <div className="row" style={{ justifyContent: 'space-between', marginTop: 12 }}>
        <span className="small muted">Right-click a section title to hide it from the sidebar; pages of switched-off features hide on their own.</span>
        <button className="btn sm" onClick={() => void updateSettings({ sidebarOrder: [], sidebarHidden: [] })}>Reset</button>
      </div>
    </div>
  );
}
