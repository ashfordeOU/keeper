// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// "App settings" for one app: network, bandwidth, VPN routing, CPU and memory,
// pause, login, notifications, look, language, volume, graphics card, default
// app and keep-awake. Used on the App controls page and from Applications,
// Processes and Network Activity. Each control says what this system can do.

import { useCallback, useEffect, useState } from 'react';
import type { AppRef, ControlId } from '../../core/appctl';
import type { AppControlInfo, AppControlState } from '../../core/api-settingsplus';
import type { PermissionGrant } from '../../core/security/types';
import { api } from '../api';
import { Icon } from './Icon';
import { Modal, Toggle } from './ui';
import { useStore } from '../state';
import '../styles/controls.css';
import '../styles/settingsplus.css';

const SUPPORT: Record<string, string> = { yes: 'Works here', partial: 'Partly', guide: 'Opens Settings', no: 'Not on this system' };

function NumberSet({ value, unit, min, max, onSet, placeholder }: { value?: number; unit: string; min: number; max: number; onSet: (v: number) => void; placeholder?: string }) {
  const [v, setV] = useState(value ? String(value) : '');
  useEffect(() => setV(value ? String(value) : ''), [value]);
  return (
    <form className="sp-ctl" onSubmit={(e) => { e.preventDefault(); onSet(Number(v) || 0); }}>
      <input className="input" type="number" min={min} max={max} value={v} placeholder={placeholder ?? 'No limit'} onChange={(e) => setV(e.target.value)} />
      <span className="muted small">{unit}</span>
      <button className="btn sm">Set</button>
      {value ? <button type="button" className="btn ghost sm" onClick={() => onSet(0)}>Remove</button> : null}
    </form>
  );
}

export function AppSettingsPanel({ app }: { app: AppRef }) {
  const { toast } = useStore();
  const [infos, setInfos] = useState<AppControlInfo[]>([]);
  const [st, setSt] = useState<AppControlState | null>(null);
  const [grants, setGrants] = useState<PermissionGrant[]>([]);
  const [confirm, setConfirm] = useState<{ patch: Partial<AppControlState>; commands: string[]; notes: string[] } | null>(null);
  const [ports, setPorts] = useState('');
  const [types, setTypes] = useState('');

  const load = useCallback(() => {
    void api.appctl.get(app).then(setSt);
    void api.controls.perApp().then((r) => setGrants(r.grants.filter((g) => g.app.toLowerCase().includes(app.name.toLowerCase()) || (app.path && g.path === app.path)))).catch(() => undefined);
  }, [app]);
  useEffect(() => { void api.appctl.controls().then(setInfos); load(); }, [load]);

  const apply = async (patch: Partial<AppControlState>) => {
    const r = await api.appctl.set(app, patch);
    setSt(r.state);
    toast(r.ok ? r.message || 'Done' : r.message);
  };
  const change = async (patch: Partial<AppControlState>) => {
    const p = await api.appctl.preview(app, patch);
    if (p.error) { toast(p.error); return; }
    if (p.commands.length) setConfirm({ patch, commands: p.commands, notes: p.notes });
    else await apply(patch);
  };

  if (!st) return <div className="muted">Loading…</div>;
  const info = (id: ControlId) => infos.find((i) => i.id === id);
  const row = (id: ControlId, ctl: React.ReactNode) => {
    const i = info(id);
    if (!i) return null;
    const off = i.support === 'no';
    return (
      <div key={id} className={`qc-row ${off ? 'off' : ''}`} data-testid={`appctl-${id}`}>
        <div className="qc-txt">
          <div className="qc-label">{i.title} <span className={`qc-how sp-support-${i.support}`}>{SUPPORT[i.support]}</span>{i.admin ? <span className="qc-how qc-how-admin">Needs password</span> : null}</div>
          <div className="muted qc-desc">{i.description}{i.note ? ` ${i.note}` : ''}</div>
        </div>
        {off || i.support === 'guide' ? null : <div className="sp-ctl">{ctl}</div>}
      </div>
    );
  };
  const running = !!app.pid;

  return (
    <div className="card" data-testid="app-settings-panel">
      <div className="qc-h">{app.name} <span className="muted small">{app.path ?? ''}{app.pid ? ` · process ${app.pid}` : ' · not running'}</span></div>
      {row('network', (
        <select className="input" value={st.network ?? ''} onChange={(e) => void change({ network: (e.target.value || undefined) as never })}>
          <option value="">Firewall decides</option><option value="allow">Always allow</option><option value="deny">Block</option>
        </select>
      ))}
      {row('bandwidth', (
        <>
          {info('bandwidth')?.support === 'partial' ? <input className="input" placeholder="Ports, e.g. 443 8080" value={ports} onChange={(e) => setPorts(e.target.value)} style={{ width: 130 }} /> : null}
          <NumberSet value={st.bandwidthKbps} unit="kbit/s up" min={8} max={10_000_000} onSet={(v) => void change({ bandwidthKbps: v, bandwidthPorts: ports.split(/[\s,]+/).map(Number).filter(Boolean) })} />
        </>
      ))}
      {row('vpn', (
        <select className="input" value={st.vpn ?? ''} onChange={(e) => e.target.value && void change({ vpn: e.target.value as 'vpn' | 'bypass' })}>
          <option value="">Like everything else</option><option value="vpn">Only through the VPN</option><option value="bypass">Around the VPN</option>
        </select>
      ))}
      {row('dns', <Toggle on={!!st.dnsException} onChange={(v) => void change({ dnsException: v })} label="Skip DNS blocklists" />)}
      {row('privacy', grants.length ? (
        <div className="sp-site">{grants.map((g) => <label key={g.raw + g.service}>{g.service}<Toggle on={g.allowed} onChange={(v) => void api.controls.perAppSet(g, v).then((r) => { toast(r.message); load(); })} /></label>)}</div>
      ) : <span className="muted small">No recorded permissions</span>)}
      {row('priority', (
        <select className="input" disabled={!running} value={st.priority ?? 'normal'} onChange={(e) => void change({ priority: e.target.value as never })}>
          <option value="low">Background</option><option value="below">Below normal</option><option value="normal">Normal</option><option value="above">Above normal</option><option value="high">High</option>
        </select>
      ))}
      {row('cpuLimit', running ? <NumberSet value={st.cpuPercent} unit="% of one core" min={1} max={6400} onSet={(v) => void change({ cpuPercent: v })} /> : <span className="muted small">Start the app first</span>)}
      {row('memLimit', running ? <NumberSet value={st.memMB} unit="MB" min={16} max={1 << 22} onSet={(v) => void change({ memMB: v })} /> : <span className="muted small">Start the app first</span>)}
      {row('suspend', running ? <button className="btn sm" onClick={() => void apply({ paused: !st.paused })}><Icon name={st.paused ? 'play' : 'pause'} size={12} /> {st.paused ? 'Resume' : 'Pause'}</button> : null)}
      {row('autoSuspend', <NumberSet value={st.autoSuspendMin} unit="min after leaving it" min={1} max={240} onSet={(v) => void apply({ autoSuspendMin: v })} placeholder="Off" />)}
      {row('startAtLogin', <Toggle on={!!st.startAtLogin} onChange={(v) => void change({ startAtLogin: v })} label="Start at login" />)}
      {row('notifications', <Toggle on={st.notifications !== false} onChange={(v) => void change({ notifications: v })} label="Notifications" />)}
      {row('appearance', <Toggle on={!!st.alwaysLight} onChange={(v) => void change({ alwaysLight: v })} label="Always light" />)}
      {row('language', (
        <select className="input" value={st.language ?? ''} onChange={(e) => void change({ language: e.target.value })}>
          <option value="">System language</option>
          {['en', 'en-GB', 'de', 'fr', 'es', 'it', 'nl', 'pt', 'pt-BR', 'sv', 'da', 'fi', 'nb', 'pl', 'cs', 'tr', 'ru', 'uk', 'ar', 'he', 'hi', 'ja', 'ko', 'zh-Hans', 'zh-Hant'].map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
      ))}
      {row('volume', running ? <input type="range" min={0} max={100} defaultValue={st.volume ?? 100} onMouseUp={(e) => void apply({ volume: Number((e.target as HTMLInputElement).value) })} aria-label="App volume" /> : null)}
      {row('gpu', (
        <select className="input" value={st.gpu ?? ''} onChange={(e) => void change({ gpu: e.target.value === '' ? (null as never) : (Number(e.target.value) as 0 | 1 | 2) })}>
          <option value="">Let Windows decide</option><option value="1">Power saving</option><option value="2">High performance</option>
        </select>
      ))}
      {row('defaultFor', (
        <form className="sp-ctl" onSubmit={(e) => { e.preventDefault(); void change({ defaultFor: types.split(/[\s,]+/).filter(Boolean) }); }}>
          <input className="input" placeholder={navigator.platform.startsWith('Mac') ? 'public.plain-text' : 'text/plain'} value={types} onChange={(e) => setTypes(e.target.value)} />
          <button className="btn sm">Set</button>
        </form>
      ))}
      {row('keepAwake', <Toggle on={!!st.keepAwake} onChange={(v) => void change({ keepAwake: v })} label="Keep awake while running" />)}
      <div className="sp-more"><button className="btn ghost sm" onClick={() => void api.appctl.clear(app).then((r) => { toast(r.message); load(); })}>Remove everything Keeper set for this app</button></div>

      {confirm ? (
        <Modal title={`Change ${app.name}`} onClose={() => setConfirm(null)} width={600}>
          <div className="muted small">Keeper will run exactly this:</div>
          <pre className="sp-cmds" data-testid="appctl-commands">{confirm.commands.join('\n')}</pre>
          {confirm.notes.map((n) => <div key={n} className="muted small">{n}</div>)}
          <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="btn" onClick={() => setConfirm(null)}>Cancel</button>
            <button className="btn primary" onClick={() => { const p = confirm.patch; setConfirm(null); void apply(p); }}>Apply</button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
