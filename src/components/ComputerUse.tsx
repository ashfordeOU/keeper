// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Settings for letting an AI use this computer, and the pictures in the
// activity log of what it saw.

import { useEffect, useState } from 'react';
import { normalizeAgentSettings } from '../../core/agents-config';
import { DEFAULT_BLOCKED_APPS, DEFAULT_BLOCKED_TITLES, type ComputerPolicy } from '../../core/computer';
import type { ComputerState } from '../../core/api-agents';
import { api } from '../api';
import { useStore } from '../state';
import { Icon } from './Icon';

const MODES: [ComputerPolicy['permission'], string, string][] = [
  ['off', 'Off', 'No AI may see the screen or use the mouse and keyboard.'],
  ['ask', 'Ask each time', 'Each AI asks once per session; the Island shows it while it works.'],
  ['allow', 'Allowed', 'AIs you use may start without asking; the Island still shows it, and Stop always works.'],
];

const ENGINES: [ComputerPolicy['accessibilityEngine'], string, string][] = [
  ['auto', 'Automatic', 'Reads and presses controls with agent-desktop, which comes with Keeper; falls back to the system scripts when it cannot.'],
  ['builtin', 'Built-in', 'Only the system scripts (System Events, UI Automation, AT-SPI): slower, but use it if an app misbehaves.'],
];

export function useComputerState(): ComputerState {
  const [s, setS] = useState<ComputerState>({ sessions: [], stopShortcut: '' });
  useEffect(() => {
    void api.agents.computerState().then(setS).catch(() => undefined);
    return api.on('computer-state', setS);
  }, []);
  return s;
}

export function ComputerUsePanel() {
  const { settings, updateSettings } = useStore();
  const a = normalizeAgentSettings(settings?.agents);
  const p = a.computer;
  const state = useComputerState();
  const save = (patch: Partial<ComputerPolicy>) => updateSettings({ agents: { ...a, computer: { ...p, ...patch } } });
  const [apps, setApps] = useState(p.blockedApps.join(', '));
  const [titles, setTitles] = useState(p.blockedTitles.join(', '));
  const list = (t: string) => t.split(',').map((x) => x.trim()).filter(Boolean);
  return (
    <div className="card perm-group computer-use">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontWeight: 650 }}><Icon name="laptop" size={14} /> Use this computer</div>
          <div className="small muted">Lets an AI see the screen, move the pointer, click, type, open apps and press buttons — in Keeper’s Assistant (any AI you set up) and in agents connected to Keeper (Claude Code, Codex, Cursor…). Stop it any time from the Island or with <kbd>{state.stopShortcut || '⌃⌥⌘.'}</kbd>.</div>
        </div>
      </div>
      <div className="seg" style={{ marginTop: 10 }}>
        {MODES.map(([m, l, d]) => <button key={m} title={d} className={p.permission === m ? 'on' : ''} onClick={() => void save({ permission: m })}>{l}</button>)}
      </div>
      <div className="small muted" style={{ marginTop: 6 }}>{MODES.find(([m]) => m === p.permission)?.[2]}</div>
      {state.sessions.length ? (
        <div className="row computer-live" style={{ marginTop: 10 }}>
          <span className="dot error" />
          <div className="grow">{state.sessions.map((s) => s.client).join(', ')} {state.sessions.length === 1 ? 'is' : 'are'} using this computer</div>
          <button className="btn sm danger" onClick={() => void api.agents.computerStop()}>Stop</button>
        </div>
      ) : null}
      {p.permission !== 'off' ? (
        <div className="col" style={{ gap: 10, marginTop: 12 }}>
          <label className="small">
            <div style={{ fontWeight: 600 }}>Apps it may never see or use</div>
            <textarea className="input" rows={2} value={apps} onChange={(e) => setApps(e.target.value)} onBlur={() => void save({ blockedApps: list(apps) })} />
            <button className="link-like small" onClick={() => { setApps(DEFAULT_BLOCKED_APPS.join(', ')); void save({ blockedApps: [...DEFAULT_BLOCKED_APPS] }); }}>Reset to password managers, keychains and terminals</button>
          </label>
          <label className="small">
            <div style={{ fontWeight: 600 }}>Windows whose title contains</div>
            <textarea className="input" rows={2} value={titles} onChange={(e) => setTitles(e.target.value)} onBlur={() => void save({ blockedTitles: list(titles) })} />
            <button className="link-like small" onClick={() => { setTitles(DEFAULT_BLOCKED_TITLES.join(', ')); void save({ blockedTitles: [...DEFAULT_BLOCKED_TITLES] }); }}>Reset to banking and wallets</button>
          </label>
          <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
            <label className="small">At most <input className="input sm" type="number" min={5} max={600} value={p.maxActionsPerMinute} onChange={(e) => void save({ maxActionsPerMinute: Number(e.target.value) })} style={{ width: 70 }} /> actions a minute</label>
            <label className="small">End after <input className="input sm" type="number" min={1} max={240} value={p.idleMinutes} onChange={(e) => void save({ idleMinutes: Number(e.target.value) })} style={{ width: 60 }} /> idle minutes</label>
            <label className="small">or <input className="input sm" type="number" min={1} max={1440} value={p.maxMinutes} onChange={(e) => void save({ maxMinutes: Number(e.target.value) })} style={{ width: 70 }} /> minutes in all</label>
          </div>
          <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="small" style={{ fontWeight: 600 }}>Accessibility engine</span>
            <div className="seg">
              {ENGINES.map(([e, l, d]) => <button key={e} title={d} className={p.accessibilityEngine === e ? 'on' : ''} onClick={() => void save({ accessibilityEngine: e })}>{l}</button>)}
            </div>
            <span className="small muted">{ENGINES.find(([e]) => e === p.accessibilityEngine)?.[2]}</span>
          </div>
          <div className="small muted">Passwords, keys and card numbers are never typed by an AI; Keeper fills saved sign-ins itself (below). Every action, with a small picture of what the AI saw, is listed below.</div>
        </div>
      ) : null}
    </div>
  );
}

/** A picture from the activity log, loaded only when shown. */
export function AuditShot({ file }: { file: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    void api.agents.computerShot(file).then(setSrc).catch(() => undefined);
  }, [file]);
  if (!src) return null;
  return (
    <>
      <img className="audit-shot" src={src} alt="What the AI saw" onClick={() => setOpen(true)} />
      {open ? <div className="audit-shot-big" onClick={() => setOpen(false)}><img src={src} alt="What the AI saw" /></div> : null}
    </>
  );
}
