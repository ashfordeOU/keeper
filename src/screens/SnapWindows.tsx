// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Snap Windows: whether this computer lets Keeper move windows, a shortcut for
// each place on screen (halves first; thirds and quarters a tab away), and
// layouts saved per set of screens, brought back in one click.

import { useEffect, useState, type KeyboardEvent } from 'react';
import type { SnapStatus } from '../../core/api-snap';
import { relativeTime } from '../../core/format';
import { normalizeSnapSettings, SNAP_ACTIONS, SNAP_GROUPS, type SnapAction, type SnapGroup, type SnapLayout } from '../../core/snap';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Tabs } from '../components/Tabs';
import { ContextMenu, Empty, PageHead } from '../components/ui';
import { useStore } from '../state';
import { KeyRecorder } from './settings/SettingRow';
import '../styles/desk.css';

export function SnapWindows() {
  const { toast } = useStore();
  const [st, setSt] = useState<SnapStatus | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => void api.snap.status().then((s) => { if (live) setSt(s); }).catch(() => undefined);
    load();
    const off = api.on('settings-changed', load);
    return () => { live = false; off(); };
  }, []);
  if (!st) return <div className="page"><PageHead title="Snap Windows" /></div>;
  const run = async (p: Promise<SnapStatus>) => {
    try { setSt(await p); } catch (e) { toast(e instanceof Error ? e.message : String(e)); }
  };
  const a = st.availability;
  const blocked = a.state === 'wayland' || a.state === 'missing' || a.state === 'unsupported';
  return (
    <div className="page desk-page" data-testid="snap-page">
      <PageHead title="Snap Windows" sub="Put the window in front into place with one shortcut." />
      {blocked ? (
        <section className="card desk-card">
          <Empty icon="columns" title={a.state === 'missing' ? 'One small tool is missing' : 'Not possible on this desktop'} hint={a.hint}>
            {a.line}
          </Empty>
        </section>
      ) : (
        <>
          <Status st={st} />
          <Shortcuts st={st} />
          <Layouts st={st} run={run} />
        </>
      )}
    </div>
  );
}

function Status({ st }: { st: SnapStatus }) {
  const a = st.availability;
  const ok = a.state === 'ready';
  return (
    <div className={`desk-status ${ok ? 'ok' : 'warn'}`} data-testid="snap-status" role="status">
      <span className="desk-dot" aria-hidden />
      <div className="grow">
        <div>{a.line}</div>
        {a.hint ? <div className="small muted">{a.hint}</div> : null}
      </div>
      {a.state === 'permission' ? <button className="btn sm" onClick={() => void api.snap.openPermission()}>Open Accessibility</button> : null}
    </div>
  );
}

/** A small screen with the action's place filled in. */
function Place({ area, next }: { area: [number, number, number, number]; next?: boolean }) {
  return (
    <span className={`snap-place ${next ? 'next' : ''}`} aria-hidden>
      <span className="snap-fill" style={{ left: `${area[0] * 100}%`, top: `${area[1] * 100}%`, width: `${area[2] * 100}%`, height: `${area[3] * 100}%` }} />
      {next ? <Icon name="chevronRight" size={12} /> : null}
    </span>
  );
}

function Shortcuts({ st }: { st: SnapStatus }) {
  const { settings, updateSettings } = useStore();
  const [group, setGroup] = useState<SnapGroup>('Halves');
  if (!settings) return null;
  const snap = normalizeSnapSettings(settings.snap);
  const off = st.availability.state === 'monorail';
  const set = (id: SnapAction, acc: string) => void updateSettings({ snap: { ...snap, shortcuts: { ...snap.shortcuts, [id]: acc } } });
  // Backspace or Delete while a shortcut is being recorded clears it.
  const clearKey = (id: SnapAction) => (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if ((e.key === 'Backspace' || e.key === 'Delete') && t.classList.contains('rec')) { e.preventDefault(); e.stopPropagation(); set(id, ''); t.blur(); }
  };
  return (
    <section className="card desk-card" aria-labelledby="snap-keys-title">
      <div className="desk-card-head stack">
        <div>
          <h2 id="snap-keys-title" className="desk-title">Shortcuts</h2>
          <div className="small muted">{off ? 'These keys stay free while Monorail runs.' : 'Click a shortcut and press new keys. Backspace clears it.'}</div>
        </div>
        <Tabs label="Kinds of places" value={group} onChange={setGroup} items={SNAP_GROUPS.map((g) => ({ id: g, label: g }))} />
      </div>
      <div className="snap-grid" data-testid="snap-grid">
        {SNAP_ACTIONS.filter((x) => x.group === group).map((x) => (
          <div key={x.id} className="snap-tile" data-testid={`snap-tile-${x.id}`} onKeyDownCapture={clearKey(x.id)}>
            <Place area={x.area} next={x.id === 'nextDisplay'} />
            <div className="snap-tile-body">
              <div className="snap-tile-label">{x.label}</div>
              <KeyRecorder label={x.label} value={snap.shortcuts[x.id]} onChange={(acc) => set(x.id, acc)} />
              {st.taken[x.id] ? <div className="small warn-text">Taken by {st.taken[x.id]}</div> : null}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Layouts({ st, run }: { st: SnapStatus; run: (p: Promise<SnapStatus>) => void }) {
  const { toast } = useStore();
  const [menu, setMenu] = useState<{ x: number; y: number; l: SnapLayout } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await run(api.snap.saveLayout('')); toast(`Saved how your windows sit on “${st.screens.name}”`); } finally { setBusy(false); }
  };
  const restore = async (l: SnapLayout) => {
    try {
      const r = await api.snap.restoreLayout(l.id);
      toast(r.moved ? `Moved ${r.moved} window${r.moved === 1 ? '' : 's'}${r.missing.length ? ` · not open: ${r.missing.slice(0, 3).join(', ')}` : ''}` : 'None of its apps are open');
    } catch (e) { toast(e instanceof Error ? e.message : String(e)); }
  };
  const saveBtn = <button className="btn primary" disabled={busy} data-testid="snap-save" onClick={() => void save()}>Save this layout</button>;
  return (
    <section className="card desk-card" aria-labelledby="snap-layouts-title" data-testid="snap-layouts">
      <div className="desk-card-head">
        <div>
          <h2 id="snap-layouts-title" className="desk-title">Saved layouts</h2>
          <div className="small muted">On this computer · {st.screens.count === 1 ? 'one screen' : `${st.screens.count} screens`} now</div>
        </div>
        {st.layouts.length ? saveBtn : null}
      </div>
      {st.layouts.length ? (
        <ul className="desk-list" aria-label="Saved layouts">
          {st.layouts.map((l) => (
            <li key={l.id} className="desk-row" data-testid={`snap-layout-${l.id}`} onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, l }); }}>
              <Icon name="columns" size={16} />
              <div className="grow">
                {renaming === l.id ? (
                  <input className="input sm" autoFocus defaultValue={l.name} aria-label="Layout name"
                    onBlur={(e) => { setRenaming(null); if (e.target.value.trim() && e.target.value.trim() !== l.name) run(api.snap.renameLayout(l.id, e.target.value)); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenaming(null); }} />
                ) : <div className="desk-row-name">{l.name}{l.screens === st.screens.key ? <span className="badge accent">These screens</span> : null}</div>}
                <div className="small muted">{l.windows.length} window{l.windows.length === 1 ? '' : 's'} · {screensText(l.screens)} · saved {relativeTime(l.savedAt)}</div>
              </div>
              <button className="btn sm ghost" data-testid={`snap-restore-${l.id}`} onClick={() => void restore(l)}>Restore</button>
              <button className="btn sm ghost icon" aria-label={`More for ${l.name}`} title="More" onClick={(e) => setMenu({ x: e.clientX, y: e.clientY, l })}><Icon name="more" size={14} /></button>
            </li>
          ))}
        </ul>
      ) : (
        <Empty compact icon="columns" title="No saved layouts yet" action={saveBtn} hint="Saved per set of screens, so docked and on the go each have their own.">
          Arrange your windows once, save, and bring them back in one click.
        </Empty>
      )}
      {menu ? (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} label={menu.l.name} items={[
          { label: 'Restore', icon: 'columns', run: () => void restore(menu.l) },
          { label: 'Rename', icon: 'rename', run: () => setRenaming(menu.l.id) },
          { sep: true, label: '' },
          { label: 'Delete', icon: 'trash', danger: true, testId: 'snap-delete', run: () => run(api.snap.removeLayout(menu.l.id)) },
        ]} />
      ) : null}
    </section>
  );
}

function screensText(key: string): string {
  const n = key ? key.split('+').length : 0;
  return n <= 1 ? 'one screen' : `${n} screens`;
}
