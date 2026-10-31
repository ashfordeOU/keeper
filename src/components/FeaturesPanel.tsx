// SPDX-License-Identifier: AGPL-3.0-or-later
// Settings → Features: every part of Keeper with an on/off switch and what it
// costs, presets, and Customize sidebar.

import { useMemo, useState } from 'react';
import { currentPreset, FEATURE_GROUPS, FEATURES, featureDef, PRESETS, type CostLevel } from '../../core/features';
import { api } from '../api';
import { useFeatureStates } from '../features';
import { useStore } from '../state';
import { Icon } from './Icon';
import { SECTION_COLOR, SECTION_IDS } from './NavSection';
import { Toggle } from './ui';
import '../styles/features.css';

const COST_WORD: Record<CostLevel, string> = { none: 'No background cost', low: 'Light', medium: 'Moderate', high: 'Heavy while it works' };

export function FeaturesPanel() {
  const { settings, info, toast } = useStore();
  const states = useFeatureStates();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const preset = settings ? currentPreset(settings) : undefined;
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return FEATURES.filter((f) => !f.platforms || f.platforms.includes((info?.platform ?? '') as NodeJS.Platform))
      .filter((f) => !t || `${f.name} ${f.description} ${f.group} ${f.cost.background ?? ''}`.toLowerCase().includes(t));
  }, [q, info?.platform]);
  if (!settings || !states) return null;

  const set = async (id: string, on: boolean) => {
    setBusy(id);
    try {
      await api.features.set(id, on);
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
      </div>
      <div className="feature-search">
        <Icon name="search" size={14} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a feature" aria-label="Find a feature" />
      </div>
      {FEATURE_GROUPS.map((g) => {
        const rows = list.filter((f) => f.group === g);
        if (!rows.length) return null;
        return (
          <div key={g} className="feature-group">
            <div className="feature-group-title">{g}</div>
            {rows.map((f) => {
              const st = states.get(f.id);
              const wanted = f.id === 'login' ? !!st?.wanted : st?.wanted ?? true;
              return (
                <div key={f.id} className={`feature-row ${st?.on === false ? 'off' : ''}`}>
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
                    {st?.blockedBy?.length && wanted ? (
                      <div className="small warn-text">Off until {st.blockedBy.map((b) => featureDef(b)?.name ?? b).join(' and ')} {st.blockedBy.length > 1 ? 'are' : 'is'} on</div>
                    ) : null}
                  </div>
                  <Toggle on={wanted} onChange={(v) => !f.always && busy !== f.id && void set(f.id, v)} />
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

const SECTION_NAMES: Record<string, string> = { library: 'Library', saved: 'Saved searches', favorites: 'Favorites', locations: 'Locations', tags: 'Tags', tidy: 'Tidy', system: 'System', more: 'More' };

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
            <button className="btn sm ghost icon" title="Move up" disabled={i === 0} onClick={() => move(i, -1)}><Icon name="arrowUp" size={13} /></button>
            <button className="btn sm ghost icon" title="Move down" disabled={i === order.length - 1} onClick={() => move(i, 1)}><Icon name="chevronDown" size={13} /></button>
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
