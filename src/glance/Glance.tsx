// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The glance under the owl in the menu bar: a header with one line of status,
// four reading tiles, the Keep Awake switch, rows of the moment, four quick
// actions (the rest under More) and the three newest downloads, with Open
// Keeper, Settings and Quit at the bottom. Every tile and row opens its page.
// Arrow keys move between everything that can be pressed, Enter opens, Escape
// closes More and then the glance. The numbers come from the main process
// every 2 s while it is open (electron/services/glance.ts), and the window
// takes the height of what is drawn here, so nothing scrolls.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ACTION_INFO, middleTruncate, shortBytes, type GlanceActionId, type GlanceCard, type GlanceTile, type GlanceView } from '../../core/glance';
import { kindOf } from '../../core/classify';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { OwlMark } from '../components/OwlMark';
import '../styles/glance.css';

const TILE_ICON: Record<GlanceTile['id'], string> = { weather: 'sun', storage: 'disk', system: 'cpu', network: 'globe' };
const ROW_ICON: Record<string, string> = { usage: 'sparkle', calendar: 'calendar', tip: 'info' };
const DIRECT_KINDS = new Set(['image', 'video', 'audio', 'document', 'archive', 'installer', 'app', 'code']);

function Tile({ t }: { t: GlanceTile }) {
  return (
    <button className={`gl-tile ${t.tone}`} data-testid={`glance-card-${t.id}`} onClick={() => void api.glance.open(t.open)} title={t.hint} aria-label={`${t.label}: ${t.value}, ${t.sub}`}>
      <span className="gl-tile-top"><Icon name={TILE_ICON[t.id]} size={13} /><span className="gl-label">{t.label}</span></span>
      <span className="gl-value">{t.value}</span>
      <span className="gl-sub">{t.sub}</span>
      <span className="gl-bar" aria-hidden>{t.bar !== undefined ? <i style={{ width: `${Math.max(2, Math.min(100, t.bar))}%` }} /> : null}</span>
    </button>
  );
}

function Row({ c }: { c: GlanceCard }) {
  return (
    <button className={`gl-row gl-press ${c.tone ?? ''}`} data-testid={`glance-card-${c.id}`} onClick={() => void api.glance.open(c.open)} title={c.hint ?? (c.id === 'tip' ? c.value : undefined)} aria-label={`${c.title}: ${c.value}${c.detail ? `, ${c.detail}` : ''}`}>
      <span className="gl-row-ic"><Icon name={ROW_ICON[c.id] ?? 'info'} size={14} /></span>
      <span className="gl-row-txt">
        <span className="gl-row-title">{c.title}</span>
        <span className="gl-row-sub">{c.id === 'tip' ? c.value : `${c.value}${c.detail ? ` · ${c.detail}` : ''}`}</span>
      </span>
      {c.bar !== undefined ? <span className="gl-mini" aria-hidden><i style={{ width: `${Math.max(2, Math.min(100, c.bar))}%` }} /></span> : <Icon name="chevronRight" size={13} />}
    </button>
  );
}

function Action({ id, onRun }: { id: GlanceActionId; onRun: (id: GlanceActionId) => void }) {
  const a = ACTION_INFO[id];
  return (
    <button className="gl-act" data-testid={`glance-action-${id}`} onClick={() => onRun(id)} title={a.label} aria-label={a.label}>
      <span className="gl-act-ic"><Icon name={a.icon} size={16} /></span>
      <span className="gl-act-label">{a.short}</span>
    </button>
  );
}

/** Before the first reading arrives: the same shapes, quietly. */
function Placeholder() {
  return (
    <div className="gl-tiles" aria-busy="true" aria-label="Reading">
      {[0, 1, 2, 3].map((k) => <span key={k} className="gl-tile gl-ghost" aria-hidden><span /><span /><span /></span>)}
    </div>
  );
}

export function Glance() {
  const [v, setV] = useState<GlanceView | null>(null);
  const [more, setMore] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const fit = useRef<HTMLDivElement>(null);
  const refresh = () => void api.glance.view().then(setV).catch(() => undefined);

  useEffect(() => {
    refresh();
    const off = api.on('glance', (x) => setV(x));
    // Opened again later: fresh numbers at once, More folded away.
    const vis = () => { if (document.visibilityState === 'visible') { setMore(false); refresh(); } };
    document.addEventListener('visibilitychange', vis);
    return () => { off(); document.removeEventListener('visibilitychange', vis); };
  }, []);

  // The window takes the height of what is drawn (the frame's border included).
  useLayoutEffect(() => {
    const el = fit.current;
    if (!el) return;
    const send = () => void api.glance.fit(Math.ceil(el.getBoundingClientRect().height) + 2).catch(() => undefined);
    send();
    const ro = new ResizeObserver(send);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Keyboard: arrows move through everything that can be pressed, Escape folds More, then closes.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (more) { setMore(false); root.current?.querySelector<HTMLElement>('[data-testid="glance-more"]')?.focus(); } else void api.glance.close();
        return;
      }
      if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      const all = [...(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? [])];
      const i = all.indexOf(document.activeElement as HTMLElement);
      const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1;
      all[(i + step + all.length) % all.length]?.focus();
      e.preventDefault();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [more]);

  const run = (id: GlanceActionId) => void api.glance.run(id);
  const toggleAwake = () => {
    if (!v?.awake) return;
    const on = !v.awake.on;
    setV({ ...v, awake: { on, text: on ? 'On until you turn it off' : 'Off, the computer can sleep' } });
    void api.awake.toggle().catch(() => undefined).finally(refresh);
  };
  const s = v?.settings.sections;
  const status = v?.status ?? { tone: 'ok' as const, text: 'Reading…' };

  return (
    <div className="glance" ref={root} role="dialog" aria-label="Keeper" data-testid="glance">
      <div className="gl-fit" ref={fit}>
        <header className="gl-top">
          <OwlMark tile size={26} title="Keeper" />
          <div className="gl-top-txt">
            <span className="gl-brand">Keeper</span>
            {status.open ? (
              <button className={`gl-status ${status.tone}`} data-testid="glance-status" onClick={() => void api.glance.open(status.open!)}><i aria-hidden />{status.text}</button>
            ) : (
              <span className={`gl-status ${status.tone}`} data-testid="glance-status" role="status"><i aria-hidden />{status.text}</span>
            )}
          </div>
        </header>

        {!v ? <Placeholder /> : v.tiles.length ? (
          <div className="gl-tiles" role="list" aria-label="Readings">
            {v.tiles.map((t) => <div role="listitem" key={t.id}><Tile t={t} /></div>)}
          </div>
        ) : null}

        {v && (v.awake || v.rows.length) ? (
          <div className="gl-rows">
            {v.awake ? (
              <div className={`gl-row gl-awake${v.awake.on ? ' on' : ''}`} data-testid="glance-card-awake" role="group" aria-label={`Keep Awake: ${v.awake.text}`}>
                <span className="gl-row-ic"><Icon name="coffee" size={14} /></span>
                <label className="gl-row-txt" htmlFor="gl-awake-switch">
                  <span className="gl-row-title">Keep Awake</span>
                  <span className="gl-row-sub">{v.awake.text}</span>
                </label>
                <button id="gl-awake-switch" role="switch" aria-checked={v.awake.on} aria-label="Keep Awake" data-testid="glance-awake-switch" className={`toggle${v.awake.on ? ' on' : ''}`} onClick={toggleAwake} />
              </div>
            ) : null}
            {v.rows.map((c) => <Row key={c.id} c={c} />)}
          </div>
        ) : null}

        {v && s?.actions && (v.actions.length || v.more.length) ? (
          <section className="gl-sec" aria-labelledby="gl-actions-title">
            <div className="gl-head">
              <h2 id="gl-actions-title">Quick actions</h2>
              <button className="gl-link" data-testid="glance-edit" onClick={() => void api.glance.open('settings:menubar')}>Edit</button>
            </div>
            <div className="gl-acts" role="toolbar" aria-label="Quick actions">
              {v.actions.map((a) => <Action key={a} id={a} onRun={run} />)}
              {v.more.length ? (
                <button className={`gl-act${more ? ' open' : ''}`} data-testid="glance-more" aria-expanded={more} aria-controls="gl-more" onClick={() => setMore(!more)} title={more ? 'Fewer actions' : 'More actions'}>
                  <span className="gl-act-ic"><Icon name={more ? 'minus' : 'plus'} size={16} /></span>
                  <span className="gl-act-label">{more ? 'Less' : 'More'}</span>
                </button>
              ) : null}
            </div>
            {more ? (
              <div className="gl-acts gl-more" id="gl-more" role="toolbar" aria-label="More actions" data-testid="glance-more-panel">
                {v.more.map((a) => <Action key={a} id={a} onRun={run} />)}
              </div>
            ) : null}
          </section>
        ) : null}

        {v && s?.downloads ? (
          <section className="gl-sec" aria-labelledby="gl-dl-title" data-testid="glance-downloads">
            <div className="gl-head">
              <h2 id="gl-dl-title">Recent downloads</h2>
              <button className="gl-link" data-testid="glance-see-all" onClick={() => void api.glance.open('downloads')}>See all<Icon name="chevronRight" size={12} /></button>
            </div>
            {v.recent.length ? (
              <div className="gl-files" role="list">
                {v.recent.map((f) => {
                  const kind = kindOf(f.name);
                  const icon = DIRECT_KINDS.has(kind) ? kind : 'other';
                  return (
                    <div role="listitem" key={f.path}>
                      <button className="gl-file gl-press" onClick={() => void api.glance.openFile(f.path, 'open')} onContextMenu={(e) => { e.preventDefault(); void api.glance.openFile(f.path, 'show'); }} title={`${f.name}${f.source ? ` · from ${f.source}` : ''}\nRight-click to show it in its folder`} aria-label={`${f.name}, ${shortBytes(f.size)}`}>
                        <span className="gl-file-ic" style={{ color: `var(--c-${icon})` }}><Icon name={icon} size={14} /></span>
                        <span className="gl-file-name">{middleTruncate(f.name, 34)}</span>
                        <span className="gl-file-size">{shortBytes(f.size)}</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="gl-empty" data-testid="glance-downloads-empty">
                <span className="gl-empty-ic" aria-hidden><Icon name="down" size={16} /></span>
                <span className="gl-empty-txt"><b>No downloads yet</b><small>New files in Downloads show up here.</small></span>
              </div>
            )}
          </section>
        ) : null}

        <footer className="gl-foot">
          <button className="gl-primary" data-testid="glance-open" onClick={() => void api.glance.open('home')}>Open Keeper</button>
          <span className="gl-foot-end">
            <button className="gl-quiet" onClick={() => void api.glance.open('settings:menubar')} title="Settings"><Icon name="settings" size={14} />Settings</button>
            <button className="gl-quiet" onClick={() => void api.glance.open('action:quit')} title="Quit Keeper"><Icon name="power" size={14} />Quit</button>
          </span>
        </footer>
      </div>
    </div>
  );
}
