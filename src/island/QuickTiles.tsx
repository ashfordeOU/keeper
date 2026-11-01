// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// A few Quick Controls as tiles in the Island's Controls tab. Weakening a
// setting, or one that only Settings can change, goes to the full page.

import { useEffect, useState } from 'react';
import type { ControlsView } from '../../core/api-controls';
import { api } from '../api';
import { Icon } from '../components/Icon';
import '../styles/controls.css';

const TILES: [string, string][] = [['wifi', 'Wi-Fi'], ['bluetooth', 'Bluetooth'], ['vpn', 'VPN'], ['osFirewall', 'Firewall'], ['dnsFilter', 'DNS filter'], ['camera', 'Camera'], ['microphone', 'Microphone'], ['airdrop', 'AirDrop']];
const say = (msg: string) => window.dispatchEvent(new CustomEvent('island-toast', { detail: msg }));

export function QuickTiles() {
  const [view, setView] = useState<ControlsView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    const load = () => void api.controls.list().then(setView).catch(() => undefined);
    load();
    return api.on('controls-changed', load);
  }, []);
  if (!view) return <div className="muted small">Reading settings…</div>;
  const st = new Map(view.states.map((s) => [s.id, s]));
  const tiles = TILES.filter(([id]) => { const s = st.get(id); return s && s.how !== 'none'; });
  // Quick Controls switched off in Features: no tiles.
  if (!tiles.length) return null;
  const flip = async (id: string) => {
    const s = st.get(id)!;
    if (s.how === 'guide' || typeof s.value !== 'boolean') { void api.controls.open(id); return; }
    setBusy(id);
    try {
      const r = await api.controls.set(id, !s.value);
      if (r.needsConfirm) { say('That lowers protection: confirm it on the Quick Controls page.'); void api.controls.showPage(); }
      else { if (r.view) setView(r.view); say(r.message); }
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="tile" data-testid="island-qc">
      <div className="ctl-head"><Icon name="shield" size={13} /> Quick controls
        <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={() => void api.controls.showPage()}>All…</button></div>
      <div className="qc-tiles">
        {tiles.map(([id, label]) => {
          const s = st.get(id)!;
          const on = s.value === true;
          return (
            <button key={id} className={`qc-tile ${on ? 'on' : ''}`} disabled={busy === id} onClick={() => void flip(id)} title={s.note} aria-pressed={on}>
              <b>{label}</b>
              <span className="s">{s.how === 'guide' ? 'Settings' : s.value === null ? '—' : on ? 'On' : 'Off'}{s.how === 'admin' ? ' · 🔒' : ''}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
