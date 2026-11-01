// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Quick Controls: network, firewall, privacy and security switches in one
// place. Each says honestly how it can be changed here: directly, after the
// system's administrator prompt, or only in the system's Settings (Keeper opens
// the right page). Weakening changes ask first; every change can be undone.

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ControlsResult, ControlsView } from '../../core/api-controls';
import { GROUPS } from '../../core/controls/catalog';
import { matches, type Plan } from '../../core/controls/plan';
import type { ControlDef, ControlState, ControlValue, How } from '../../core/controls/types';
import type { PermissionGrant } from '../../core/security/types';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Modal, PageHead, Toggle } from '../components/ui';
import { useStore } from '../state';
import '../styles/controls.css';

export const HOW_LABEL: Record<How, string> = { direct: 'Direct', admin: 'Needs password', guide: 'Opens Settings', none: 'Not on this system' };

type Pending = { title: string; warnings: string[]; go: () => Promise<ControlsResult> };

/** Shared by the page and the Island tiles: switch one, asking first when it weakens protection. */
export function useControls() {
  const { toast } = useStore();
  const [view, setView] = useState<ControlsView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  const load = useCallback((refresh = false) => api.controls.list(refresh).then(setView).catch(() => undefined), []);
  useEffect(() => {
    void load();
    return api.on('controls-changed', () => void load());
  }, [load]);

  const handle = useCallback(async (key: string, title: string, run: (confirm: boolean) => Promise<ControlsResult>) => {
    setBusy(key);
    try {
      const r = await run(false);
      if (r.needsConfirm) {
        setPending({ title, warnings: r.needsConfirm.warnings, go: () => run(true) });
        return;
      }
      if (r.view) setView(r.view);
      toast(r.message);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [toast]);

  const set = useCallback((def: ControlDef, value: ControlValue) => handle(def.id, def.label, (c) => api.controls.set(def.id, value, { confirmWeaker: c })), [handle]);

  const confirm = useCallback(async () => {
    if (!pending) return;
    const p = pending;
    setPending(null);
    setBusy('confirm');
    try {
      const r = await p.go();
      if (r.view) setView(r.view);
      toast(r.message);
    } finally {
      setBusy(null);
    }
  }, [pending, toast]);

  return { view, load, busy, set, handle, pending, setPending, confirm };
}

export function WeakenDialog({ pending, onCancel, onConfirm }: { pending: Pending; onCancel: () => void; onConfirm: () => void }) {
  return (
    <Modal title="Less protection — are you sure?" onClose={onCancel} width={460}>
      <div className="qc-warn" data-testid="qc-warn">
        <Icon name="warning" size={18} />
        <div>
          {pending.warnings.map((w) => <p key={w}>{w}</p>)}
          <p className="muted">You can undo this from the change list on the Quick Controls page.</p>
        </div>
      </div>
      <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
        <button className="btn" onClick={onCancel} autoFocus>Keep it as it is</button>
        <button className="btn danger" onClick={onConfirm} data-testid="qc-confirm">Change anyway</button>
      </div>
    </Modal>
  );
}

/** the switch, choice or button for one control */
export function ControlInput({ def, st, busy, onSet }: { def: ControlDef; st: ControlState; busy: boolean; onSet: (v: ControlValue) => void }) {
  if (st.how === 'none') return <span className="muted qc-na">Not here</span>;
  if (st.how === 'guide') {
    return <button className="btn sm" onClick={() => void api.controls.open(def.id)} data-testid={`qc-open-${def.id}`}><Icon name="external" size={12} /> Open Settings</button>;
  }
  if (def.kind === 'choice') {
    return (
      <select value={typeof st.value === 'string' ? st.value : ''} disabled={busy} onChange={(e) => onSet(e.target.value)} aria-label={def.label} data-testid={`qc-${def.id}`}>
        {typeof st.value !== 'string' || !def.choices?.some((c) => c.value === st.value) ? <option value="">{st.value === 'other' ? 'Another service' : 'Unknown'}</option> : null}
        {def.choices?.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
      </select>
    );
  }
  if (typeof st.value !== 'boolean') {
    return (
      <span className="btn-row">
        <button className="btn sm" disabled={busy} onClick={() => onSet(true)}>On</button>
        <button className="btn sm" disabled={busy} onClick={() => onSet(false)}>Off</button>
      </span>
    );
  }
  return <span data-testid={`qc-${def.id}`} className={busy ? 'qc-busy' : ''}><Toggle on={st.value} onChange={(v) => onSet(v)} label={def.label} /></span>;
}

export function Controls() {
  const { route } = useStore();
  const { view, load, busy, set, handle, pending, setPending, confirm } = useControls();
  const [q, setQ] = useState(route.q ?? '');
  const [planFor, setPlanFor] = useState<{ id: string; plan: Plan } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // "preset:<id>" from the command palette opens that preset's preview.
  useEffect(() => {
    const m = route.arg?.match(/^preset:(.+)$/);
    if (m) void api.controls.preview(m[1]).then((plan) => setPlanFor({ id: m[1], plan }));
  }, [route.arg]);

  const states = useMemo(() => new Map(view?.states.map((s) => [s.id, s]) ?? []), [view]);
  if (!view) return <div className="page"><PageHead title="Quick Controls" sub="Reading this computer’s settings…" /></div>;

  const shown = view.defs.filter((d) => matches(d, q));
  const counts = view.states.reduce((a, s) => ({ ...a, [s.how]: (a[s.how] ?? 0) + 1 }), {} as Record<How, number>);

  const applyPreset = (id: string) => {
    const p = view.presets.find((x) => x.id === id)!;
    setPlanFor(null);
    void handle(`preset:${id}`, p.name, (c) => api.controls.applyPreset(id, { confirmWeaker: c }));
  };

  return (
    <div className="page qc-page" data-testid="qc-page">
      <PageHead title="Quick Controls" sub="Switch network, firewall, privacy and security settings. Where the system does not let apps change something, Keeper opens the right Settings page.">
        {view.dryRun ? <span className="chip qc-dry" title="Test run: system changes are written to a file">Test run</span> : null}
        <button className="btn sm" disabled={refreshing} onClick={() => { setRefreshing(true); void load(true).finally(() => setRefreshing(false)); }}><Icon name="refresh" size={13} /> {refreshing ? 'Reading…' : 'Read again'}</button>
      </PageHead>

      <div className="qc-summary muted">
        {(['direct', 'admin', 'guide', 'none'] as How[]).filter((h) => counts[h]).map((h) => <span key={h} className={`qc-how qc-how-${h}`}>{counts[h]} {HOW_LABEL[h].toLowerCase()}</span>)}
      </div>

      <div className="card qc-presets" data-testid="qc-presets">
        <div className="qc-h">Presets</div>
        <div className="qc-preset-grid">
          {view.presets.map((p) => (
            <div key={p.id} className="qc-preset">
              <b>{p.name}</b>
              <span className="muted">{p.desc}</span>
              <button className="btn sm" disabled={!!busy} data-testid={`qc-preset-${p.id}`} onClick={() => void api.controls.preview(p.id).then((plan) => setPlanFor({ id: p.id, plan }))}>Review and apply…</button>
            </div>
          ))}
        </div>
        {view.profiles.length ? (
          <div className="qc-bind">
            <span className="muted">Apply a preset when the firewall switches profile (changes that need a password, or that lower protection, wait for you):</span>
            {view.profiles.map((pr) => (
              <label key={pr.id} className="qc-bind-row">
                <span>{pr.name}{pr.active ? ' (now)' : ''}</span>
                <select value={view.bindings[pr.id] ?? ''} onChange={(e) => void api.controls.bind(pr.id, e.target.value || null).then(() => load())}>
                  <option value="">No preset</option>
                  {view.presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
            ))}
          </div>
        ) : null}
      </div>

      <div className="qc-search">
        <Icon name="search" size={14} />
        <input placeholder="Find a setting" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a setting" data-testid="qc-search" />
      </div>

      {GROUPS.map((g) => {
        const defs = shown.filter((d) => d.group === g.id);
        if (!defs.length) return null;
        return (
          <div key={g.id} className="card qc-group" data-testid={`qc-group-${g.id}`}>
            <div className="qc-h">{g.label}</div>
            {defs.map((d) => {
              const st = states.get(d.id) ?? { id: d.id, value: null, how: 'none' as How };
              return (
                <div key={d.id} className={`qc-row ${st.how === 'none' ? 'off' : ''}`} data-testid={`qc-row-${d.id}`} data-how={st.how} data-value={st.value === null ? '' : String(st.value)}>
                  <div className="qc-txt">
                    <div className="qc-label">{d.label} <span className={`qc-how qc-how-${st.how}`}>{HOW_LABEL[st.how]}</span>{d.keeper ? <span className="qc-how qc-how-keeper">Keeper</span> : null}</div>
                    <div className="muted qc-desc">{d.desc}{st.note ? ` ${st.note}` : ''}</div>
                  </div>
                  <ControlInput def={d} st={st} busy={busy === d.id} onSet={(v) => void set(d, v)} />
                </div>
              );
            })}
            {g.id === 'privacy' ? <PerApp /> : null}
          </div>
        );
      })}
      {!shown.length ? <div className="muted" style={{ padding: 16 }}>Nothing matches “{q}”.</div> : null}

      <div className="card qc-log" data-testid="qc-log">
        <div className="qc-h">Changes</div>
        {view.log.length ? view.log.slice(0, 30).map((e) => (
          <div key={e.id} className={`qc-log-row ${e.undone ? 'undone' : ''}`}>
            <div className="qc-txt">
              <div>{e.title}</div>
              <div className="muted qc-desc">{new Date(e.at).toLocaleString()} · {e.changes.map((c) => `${view.defs.find((d) => d.id === c.id)?.label ?? c.id}: ${fmt(c.from)} → ${fmt(c.to)}`).join(', ')}</div>
            </div>
            {e.undone ? <span className="muted">Undone</span> : <button className="btn sm" disabled={!!busy} data-testid="qc-undo" onClick={() => void handle(`undo:${e.id}`, `Undo ${e.title}`, (c) => api.controls.undo(e.id, { confirmWeaker: c }))}>Undo</button>}
          </div>
        )) : <div className="muted qc-desc" style={{ padding: '6px 14px 12px' }}>Changes made here are listed so you can put them back.</div>}
      </div>

      {planFor ? <PresetDialog view={view} planFor={planFor} onClose={() => setPlanFor(null)} onApply={() => applyPreset(planFor.id)} /> : null}
      {pending ? <WeakenDialog pending={pending} onCancel={() => setPending(null)} onConfirm={() => void confirm()} /> : null}
    </div>
  );
}

const fmt = (v: ControlValue | null) => (v === null ? '?' : v === true ? 'on' : v === false ? 'off' : String(v));

function PresetDialog({ view, planFor, onClose, onApply }: { view: ControlsView; planFor: { id: string; plan: Plan }; onClose: () => void; onApply: () => void }) {
  const p = view.presets.find((x) => x.id === planFor.id);
  const { plan } = planFor;
  const doable = plan.items.filter((i) => i.how === 'direct' || i.how === 'admin');
  const guided = plan.items.filter((i) => i.how === 'guide');
  return (
    <Modal title={p?.name ?? 'Preset'} onClose={onClose} width={500}>
      <div className="qc-plan" data-testid="qc-plan">
        <p className="muted">{p?.desc}</p>
        {doable.length ? (
          <ul>
            {doable.map((i) => (
              <li key={i.id} className={i.weakening ? 'weak' : ''}>
                {i.label}: {fmt(i.from)} → <b>{fmt(i.to)}</b>{i.how === 'admin' ? <span className="qc-how qc-how-admin">password</span> : null}{i.weakening ? <span className="qc-how qc-how-weak">less protection</span> : null}
              </li>
            ))}
          </ul>
        ) : <p>Nothing for Keeper to change: this computer already matches.</p>}
        {guided.length ? <p className="muted">Change in Settings yourself: {guided.map((g) => g.label).join(', ')}.</p> : null}
        {plan.skipped.length ? <p className="muted">Not on this system: {plan.skipped.map((s) => s.label).join(', ')}.</p> : null}
        {doable.some((i) => i.how === 'admin') ? <p className="muted">The system asks for your password once for all of these.</p> : null}
      </div>
      <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!doable.length} onClick={onApply} data-testid="qc-apply">Apply</button>
      </div>
    </Modal>
  );
}

function PerApp() {
  const { toast } = useStore();
  const [data, setData] = useState<{ grants: PermissionGrant[]; notes: string[] } | null>(null);
  const [open, setOpen] = useState(false);
  const read = () => void api.controls.perApp().then(setData).catch(() => setData({ grants: [], notes: ['Could not read app permissions.'] }));
  const grants = (data?.grants ?? []).filter((g) => ['camera', 'microphone', 'location', 'screen'].includes(g.service));
  return (
    <div className="qc-perapp">
      <button className="btn sm ghost" onClick={() => { setOpen(!open); if (!data) read(); }} data-testid="qc-perapp">
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} /> Each app’s camera, microphone and location access
      </button>
      {open ? (
        <div className="qc-perapp-list">
          {!data ? <div className="muted">Reading…</div> : grants.length ? grants.map((g) => (
            <div key={`${g.app}|${g.service}|${g.raw}`} className="qc-row">
              <div className="qc-txt"><div className="qc-label">{g.app}</div><div className="muted qc-desc">{g.service}{g.inUse ? ' · in use now' : ''}</div></div>
              <Toggle on={g.allowed} label={`${g.app} ${g.service}`} onChange={(v) => void api.controls.perAppSet(g, v).then((r) => { toast(r.message); read(); })} />
            </div>
          )) : <div className="muted">No app has asked for these yet.</div>}
          {data?.notes.map((n) => <div key={n} className="muted qc-desc">{n}</div>)}
        </div>
      ) : null}
    </div>
  );
}
