// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Settings → Menu bar → Other apps' icons. On a Mac: whether icons left of
// Keeper's divider are hidden, which icons are in view and which are hidden,
// and moving one across. Windows and Linux: what the system offers instead.

import { useEffect, useState } from 'react';
import type { MenuBarStatus } from '../../core/api-menubar';
import type { MenuBarIcon } from '../../core/menubar-items';
import { api } from '../api';
import { useStore } from '../state';
import { Icon } from './Icon';
import { Empty, Toggle } from './ui';
import '../styles/desk.css';

export function MenuBarItemsPanel() {
  const { toast } = useStore();
  const [st, setSt] = useState<MenuBarStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = () => void api.menuBar.status().then(setSt).catch(() => undefined);
  useEffect(load, []);
  if (!st) return <div className="small muted">Looking at the menu bar…</div>;
  const a = st.availability;
  if (a.state === 'windows' || a.state === 'unsupported') {
    return (
      <div className="desk-status" data-testid="menubar-items" role="status">
        <span className="desk-dot" aria-hidden />
        <div className="grow">
          <div>{a.line}</div>
          {a.hint ? <div className="small muted">{a.hint}</div> : null}
        </div>
        {a.state === 'windows' ? <button className="btn sm" onClick={() => void api.menuBar.openSettings()}>Open taskbar settings</button> : null}
      </div>
    );
  }
  const move = async (i: MenuBarIcon, to: 'hide' | 'show') => {
    setBusy(i.id);
    try {
      const r = await api.menuBar.move(i.id, to);
      toast(r.ok ? (to === 'hide' ? `${i.app} is hidden now` : `${i.app} stays in view now`) : r.message ?? 'It did not move');
      load();
    } finally { setBusy(null); }
  };
  const row = (i: MenuBarIcon, to: 'hide' | 'show') => (
    <li key={i.id} className="desk-row">
      <Icon name="app" size={15} />
      <span className="grow">{i.app}</span>
      {i.system ? <span className="small muted">Stays put</span> : (
        <>
          {to === 'show' ? <button className="btn sm ghost" onClick={() => void api.menuBar.press(i.id)}>Open</button> : null}
          <button className="btn sm ghost" disabled={busy === i.id} onClick={() => void move(i, to)}>{to === 'hide' ? 'Hide' : 'Keep in view'}</button>
        </>
      )}
    </li>
  );
  return (
    <div className="mbi" data-testid="menubar-items">
      <div className={`desk-status ${a.state === 'ready' ? 'ok' : 'warn'}`} role="status">
        <span className="desk-dot" aria-hidden />
        <div className="grow">
          <div>{a.line}</div>
          {a.hint ? <div className="small muted">{a.hint}</div> : null}
        </div>
        {a.state === 'permission' ? <button className="btn sm" onClick={() => void api.menuBar.openSettings()}>Open Accessibility</button> : null}
      </div>
      <label className="mbi-switch">
        <span className="grow">Hide the icons left of the divider<span className="small muted"> · Click the divider to see them</span></span>
        <Toggle label="Hide the icons left of the divider" on={st.hiding} onChange={(v) => void api.menuBar.setHiding(v).then(setSt)} />
      </label>
      {st.note ? <p className="small muted">{st.note}</p> : null}
      <div className="mbi-cols">
        <section aria-labelledby="mbi-hidden">
          <h3 id="mbi-hidden" className="mbi-title">Hidden <span className="muted">{st.hidden.length}</span></h3>
          {st.hidden.length ? <ul className="desk-list">{st.hidden.map((i) => row(i, 'show'))}</ul> : <Empty compact icon="eyeOff" title="Nothing hidden yet">⌘-drag an icon left of Keeper’s divider, or press Hide.</Empty>}
        </section>
        <section aria-labelledby="mbi-shown">
          <h3 id="mbi-shown" className="mbi-title">In view <span className="muted">{st.shown.length}</span></h3>
          <ul className="desk-list">{st.shown.map((i) => row(i, 'hide'))}</ul>
        </section>
      </div>
    </div>
  );
}
