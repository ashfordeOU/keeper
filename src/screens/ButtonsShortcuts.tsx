// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Buttons & Shortcuts (experimental): what this computer allows, a job for each
// mouse button (in every app or one), and shortcuts changed in one app.

import { useEffect, useState } from 'react';
import type { InputRemapStatus } from '../../core/api-remap';
import { buttonPresets, MOUSE_BUTTONS, normalizeInputRemap, type InputRemapSettings, type KeyRemap, type MouseButton, type MouseMapping } from '../../core/input-remap';
import { accelLabel } from '../../core/shortcuts';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Empty, PageHead } from '../components/ui';
import { useStore } from '../state';
import { KeyRecorder } from './settings/SettingRow';
import '../styles/desk.css';

const newId = (p: string) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export function ButtonsShortcuts() {
  const { settings, updateSettings, info } = useStore();
  const [st, setSt] = useState<InputRemapStatus | null>(null);
  const [apps, setApps] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    const load = () => void api.remap.status().then((s) => { if (live) setSt(s); }).catch(() => undefined);
    load();
    void api.remap.runningApps().then(setApps).catch(() => undefined);
    const off = api.on('settings-changed', load);
    const t = setInterval(load, 5000);
    return () => { live = false; off(); clearInterval(t); };
  }, []);
  if (!settings || !st) return <div className="page"><PageHead title="Buttons & Shortcuts" /></div>;
  const c = normalizeInputRemap(settings.inputRemap);
  const save = (patch: Partial<InputRemapSettings>) => void updateSettings({ inputRemap: { ...c, ...patch } });
  const platform = info?.platform ?? '';
  const a = st.availability;
  return (
    <div className="page desk-page" data-testid="buttons-page">
      <PageHead title="Buttons & Shortcuts" sub={<>Give mouse buttons a job, and change a shortcut in one app. <span className="badge">Experimental</span></>} />
      <div className="desk-card card" aria-label="On this computer">
        {([['Mouse buttons', a.mouse], ['App shortcuts', a.keys]] as const).map(([name, s]) => (
          <div key={name} className={`desk-status ${s.state === 'ready' ? 'ok' : 'warn'}`} role="status" data-testid={`remap-status-${name === 'Mouse buttons' ? 'mouse' : 'keys'}`}>
            <span className="desk-dot" aria-hidden />
            <div className="grow">
              <div><b>{name}</b> · {s.line}</div>
              {s.hint ? <div className="small muted">{s.hint}</div> : null}
            </div>
          </div>
        ))}
      </div>
      <datalist id="remap-apps">{apps.map((x) => <option key={x} value={x} />)}</datalist>
      <MouseCard c={c} save={save} st={st} platform={platform} />
      <KeysCard c={c} save={save} st={st} />
      {platform === 'darwin' ? <p className="small muted">Not built yet: a scroll direction for the mouse apart from the trackpad. macOS has one setting for both.</p> : null}
    </div>
  );
}

function MouseCard({ c, save, st, platform }: { c: InputRemapSettings; save: (p: Partial<InputRemapSettings>) => void; st: InputRemapStatus; platform: string }) {
  const presets = buttonPresets(platform);
  const set = (m: MouseMapping) => save({ mouse: c.mouse.map((x) => (x.id === m.id ? m : x)) });
  const add = () => {
    const used = new Set(c.mouse.map((m) => m.button));
    const button = MOUSE_BUTTONS.find((b) => !used.has(b.id))?.id ?? 'back';
    save({ mouse: [...c.mouse, { id: newId('m'), button, app: '', keys: presets[button === 'forward' ? 1 : 0].keys }] });
  };
  const addBtn = <button className="btn primary" data-testid="remap-add-button" onClick={add}><Icon name="plus" size={13} /> Add a button</button>;
  const last = st.lastPress;
  return (
    <section className="card desk-card" aria-labelledby="remap-mouse-title" data-testid="remap-mouse">
      <div className="desk-card-head">
        <div>
          <h2 id="remap-mouse-title" className="desk-title">Mouse buttons</h2>
          <div className="small muted">{st.listening ? `Listening · ${st.listening}` : st.note || (c.mouse.length ? 'Not listening' : 'The back, forward and middle buttons.')}{last ? ` · last heard: ${MOUSE_BUTTONS.find((b) => b.id === last.button)?.label.toLowerCase()}${last.sent ? `, sent ${accelLabel(last.sent, platform)}` : ''}` : ''}</div>
        </div>
        {c.mouse.length ? addBtn : null}
      </div>
      {c.mouse.length ? (
        <ul className="desk-list" aria-label="Mouse buttons">
          {c.mouse.map((m) => {
            const preset = presets.find((p) => p.keys === m.keys)?.id ?? 'other';
            return (
              <li key={m.id} className="desk-row remap-row" data-testid={`remap-mouse-${m.id}`}>
                <select className="input" aria-label="Button" value={m.button} onChange={(e) => set({ ...m, button: e.target.value as MouseButton })}>
                  {MOUSE_BUTTONS.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
                </select>
                <input className="input" list="remap-apps" aria-label="In which app" placeholder="Every app" value={m.app} onChange={(e) => set({ ...m, app: e.target.value })} />
                <select className="input" aria-label="Does" value={preset} onChange={(e) => { const p = presets.find((x) => x.id === e.target.value); set({ ...m, keys: p ? p.keys : m.keys }); }}>
                  {presets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                  <option value="other">Other keys…</option>
                </select>
                {preset === 'other' ? <KeyRecorder label="Keys it sends" value={m.keys} onChange={(acc) => set({ ...m, keys: acc })} /> : <span className="small muted remap-keys">{accelLabel(m.keys, platform)}</span>}
                <button className="btn sm ghost icon" aria-label="Remove this button’s job" title="Remove" onClick={() => save({ mouse: c.mouse.filter((x) => x.id !== m.id) })}><Icon name="close" size={12} /></button>
              </li>
            );
          })}
        </ul>
      ) : (
        <Empty compact icon="keyboard" title="No buttons have a job yet" action={addBtn} hint="Back and forward side buttons are the usual start.">
          Pick a button, an app (or every app) and what it does.
        </Empty>
      )}
    </section>
  );
}

function KeysCard({ c, save, st }: { c: InputRemapSettings; save: (p: Partial<InputRemapSettings>) => void; st: InputRemapStatus }) {
  const set = (k: KeyRemap) => save({ keys: c.keys.map((x) => (x.id === k.id ? k : x)) });
  const add = () => save({ keys: [...c.keys, { id: newId('k'), app: st.front && !/keeper/i.test(st.front) ? st.front : '', from: '', to: '' }] });
  const addBtn = <button className="btn" data-testid="remap-add-shortcut" onClick={add}><Icon name="plus" size={13} /> Add an app shortcut</button>;
  return (
    <section className="card desk-card" aria-labelledby="remap-keys-title" data-testid="remap-keys">
      <div className="desk-card-head">
        <div>
          <h2 id="remap-keys-title" className="desk-title">App shortcuts</h2>
          <div className="small muted">Only while that app is in front; other apps keep the keys.</div>
        </div>
        {c.keys.length ? addBtn : null}
      </div>
      {c.keys.length ? (
        <ul className="desk-list" aria-label="App shortcuts">
          {c.keys.map((k) => (
            <li key={k.id} className="desk-row remap-row" data-testid={`remap-key-${k.id}`}>
              <input className="input" list="remap-apps" aria-label="App" placeholder="App name" value={k.app} onChange={(e) => set({ ...k, app: e.target.value })} />
              <span className="small muted">When I press</span>
              <KeyRecorder label="When I press" value={k.from} onChange={(acc) => set({ ...k, from: acc })} />
              <span className="small muted">send</span>
              <KeyRecorder label="Send instead" value={k.to} onChange={(acc) => set({ ...k, to: acc })} />
              <button className="btn sm ghost icon" aria-label="Remove this app shortcut" title="Remove" onClick={() => save({ keys: c.keys.filter((x) => x.id !== k.id) })}><Icon name="close" size={12} /></button>
            </li>
          ))}
        </ul>
      ) : (
        <Empty compact icon="keyboard" title="No app shortcuts yet" action={addBtn}>
          For example, in your notes app, make a key you keep missing do what you meant.
        </Empty>
      )}
    </section>
  );
}
