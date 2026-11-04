// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Settings → Features: every part of Keeper with an on/off switch and what it
// costs, the mode it follows (modes replaced the presets), your own modes
// (saved sets of parts), and Customize sidebar.

import { useEffect, useMemo, useState } from 'react';
import { currentSet, FEATURES, featureDef, featureOffered, NAV_GROUPS, PRESETS, type CostLevel, type FeatureSet } from '../../core/features';
import { api } from '../api';
import { useFeatureStates } from '../features';
import { useStore } from '../state';
import { Icon } from './Icon';
import { SuitePanel } from './SuitePanel';
import { LaunchersPanel } from './LaunchersPanel';
import { SECTION_COLOR, SECTION_IDS, SECTION_NAMES, SECTION_PLATFORMS } from './NavSection';
import { Toggle } from './ui';
import { modeOf, modeTitle } from '../../core/modes';
import { ComponentNeeds, ComponentsSection } from './ComponentsPanel';
import '../styles/features.css';

const COST_WORD: Record<CostLevel, string> = { none: 'Nothing until you use it', low: 'Light', medium: 'Some', high: 'Heavy while working' };

export function FeaturesPanel() {
  const { settings, info, toast, go } = useStore();
  const states = useFeatureStates();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
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
    return FEATURES.filter((f) => featureOffered(f, info?.platform ?? ''))
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
      {/* Modes replaced the presets (Recommended, Light, Files only, Everything): one choice that shapes Keeper. */}
      <div className="feature-mode" data-testid="features-mode">
        <div className="grow">
          <div className="feature-name">Mode: {modeTitle(modeOf(settings))}</div>
          <div className="small muted">A mode sets which parts are on. Your own switches below are kept for that mode.</div>
        </div>
        <button className="btn sm" data-testid="features-change-mode" onClick={() => go({ name: 'settings', arg: 'general#mode' })}>Change mode…</button>
      </div>
      <div className="feature-sets" data-testid="feature-sets">
        <div className="feature-group-title">My modes</div>
        <div className="small muted feature-sets-line">Save the parts that are on now as a mode of your own, to use again or on battery.</div>
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
          <input className="input grow" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Name it, e.g. Travel" aria-label="Name for my mode" />
          <button className="btn sm" disabled={!newName.trim()} onClick={() => void api.features.saveSet(newName).then((r) => { setSets(r); setNewName(''); toast('Saved'); })}>Save as my mode</button>
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
      {/* Keeper Mail, Keeper Calendar and Keeper Notes as icons of their own. */}
      <LaunchersPanel />
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
  const { settings, updateSettings, info } = useStore();
  if (!settings) return null;
  const here = (id: string) => !SECTION_PLATFORMS[id] || SECTION_PLATFORMS[id].includes(info?.platform ?? '');
  const order = [...(settings.sidebarOrder?.length ? settings.sidebarOrder : []), ...SECTION_IDS.filter((s) => !settings.sidebarOrder?.includes(s))].filter(here);
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
        // Find by type is off unless asked for (its own setting); the rest show unless hidden.
        const shown = id === 'types' ? !!settings.sidebarTypes : !hidden.includes(`section:${id}`);
        return (
          <div key={id} className="sidebar-custom-row">
            <i className="sec-dot" style={{ background: SECTION_COLOR[id] }} />
            <span className="grow">{SECTION_NAMES[id] ?? id}</span>
            <button className="btn sm ghost icon" title="Move up" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><Icon name="arrowUp" size={13} /></button>
            <button className="btn sm ghost icon" title="Move down" aria-label="Move down" disabled={i === order.length - 1} onClick={() => move(i, 1)}><Icon name="chevronDown" size={13} /></button>
            <Toggle label={`Show ${SECTION_NAMES[id] ?? id}`} on={shown} onChange={(v) => (id === 'types' ? void updateSettings({ sidebarTypes: v }) : toggle(`section:${id}`, v))} />
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
