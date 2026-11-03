// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Focus Blocking: what is blocked now and why, block a list for a while,
// the lists of sites and apps, schedules, and how strict it is. Also the
// small window Keeper shows over an app that is blocked.

import { useEffect, useState } from 'react';
import type { BlockedApp, FocusBlockStatus } from '../../core/api-focus';
import { clock, minutesText, normalizeSite, parseClock, type BlockList, type BlockSchedule, type FocusBlockOptions } from '../../core/focus-block';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { PageHead, Toggle } from '../components/ui';
import { Tabs } from '../components/Tabs';
import { useStore } from '../state';
import { Row } from './IslandSettings';
import '../styles/focus.css';

type Tab = 'lists' | 'schedules' | 'settings';
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function useFocusBlock(): [FocusBlockStatus | null, (s: FocusBlockStatus) => void] {
  const [st, setSt] = useState<FocusBlockStatus | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => void api.focusBlock.status().then((s) => { if (live) setSt(s); }).catch(() => undefined);
    load();
    const off = api.on('focusblock-changed', load);
    const off2 = api.on('settings-changed', load);
    // Passes and schedules end with the clock: look again every half minute while the page is open.
    const t = setInterval(load, 30_000);
    return () => { live = false; off(); off2(); clearInterval(t); };
  }, []);
  return [st, setSt];
}

export function FocusBlock() {
  const { toast } = useStore();
  const [st, setSt] = useFocusBlock();
  const [tab, setTab] = useState<Tab>('lists');
  if (!st) return <div className="page"><PageHead title="Focus Blocking" /></div>;
  const run = async (p: Promise<FocusBlockStatus>) => {
    try { setSt(await p); } catch (e) { toast(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <div className="page fb-page" data-testid="focus-block-page">
      <PageHead title="Focus Blocking" sub="Keep the sites and apps that pull you away out of reach while you focus, on a schedule or for a while." />
      <Hero st={st} run={run} />
      <Reach st={st} />
      <Tabs label="Focus blocking" value={tab} onChange={setTab} items={[{ id: 'lists', label: 'Lists' }, { id: 'schedules', label: 'Schedules' }, { id: 'settings', label: 'Settings' }]} />
      {tab === 'lists' ? <Lists st={st} run={run} /> : tab === 'schedules' ? <Schedules st={st} run={run} /> : <Options st={st} />}
    </div>
  );
}

function Hero({ st, run }: { st: FocusBlockStatus; run: (p: Promise<FocusBlockStatus>) => void }) {
  const b = st.block;
  const [list, setList] = useState(st.data.focusList ?? st.data.lists[0]?.id ?? '');
  const [strict, setStrict] = useState(false);
  useEffect(() => { if (!st.data.lists.some((l) => l.id === list)) setList(st.data.focusList ?? st.data.lists[0]?.id ?? ''); }, [st.data.lists, st.data.focusList, list]);
  return (
    <section className={`card fb-hero${b.on ? ' on' : ''}`} aria-labelledby="fb-hero-title" data-testid="fb-hero">
      <div className="fb-hero-icon" aria-hidden><Icon name="block" size={26} /></div>
      <div className="fb-hero-body">
        <h2 id="fb-hero-title" className="fb-hero-title">{b.on ? 'Blocking distractions' : 'Nothing is blocked right now'}</h2>
        {b.on ? (
          <>
            <p className="muted" data-testid="fb-line">{b.lists.join(', ')}{b.until ? ` · until ${clock(b.until)}` : ''} · {b.reasons.map((r) => r.label).join(', ')}</p>
            <p className="muted small">{b.sites.length} site{b.sites.length === 1 ? '' : 's'} and {b.apps.length} app{b.apps.length === 1 ? '' : 's'}{b.strict ? ' · strict mode' : ''}{st.blockedToday ? ` · stopped ${st.blockedToday} time${st.blockedToday === 1 ? '' : 's'} today` : ''}</p>
            {st.passes.length ? <p className="small">Open for a moment: {st.passes.map((p) => `${p.target} until ${clock(p.until)}`).join(', ')}</p> : null}
          </>
        ) : (
          <p className="muted">{st.data.focusList && st.options.withFocus ? `Focus sessions block “${st.data.lists.find((l) => l.id === st.data.focusList)?.name ?? ''}”.` : 'Pick a list and how long.'}{st.blockedToday ? ` Stopped ${st.blockedToday} time${st.blockedToday === 1 ? '' : 's'} today.` : ''}</p>
        )}
      </div>
      <div className="fb-hero-ctl">
        {b.on ? (
          <button className="btn" data-testid="fb-stop" disabled={b.strict} title={b.strict ? 'Strict mode: the block ends on time' : undefined} onClick={() => run(api.focusBlock.stop())}>{b.strict ? 'Strict until it ends' : 'Stop blocking'}</button>
        ) : st.data.lists.length ? (
          <>
            <label className="fb-inline">
              <span className="sr-only">List to block</span>
              <select className="input" value={list} onChange={(e) => setList(e.target.value)} aria-label="List to block" data-testid="fb-start-list">
                {st.data.lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </label>
            {[30, 60, 120].map((m) => <button key={m} className="btn sm primary" data-testid={`fb-start-${m}`} onClick={() => run(api.focusBlock.start(list, m, strict))}>{m < 60 ? `${m} min` : `${m / 60} hour${m === 60 ? '' : 's'}`}</button>)}
            <label className="fb-inline small"><input type="checkbox" checked={strict} onChange={(e) => setStrict(e.target.checked)} /> Strict</label>
          </>
        ) : null}
      </div>
    </section>
  );
}

/** Where blocking reaches on this computer, and how to reach further. */
function Reach({ st }: { st: FocusBlockStatus }) {
  const { go } = useStore();
  return (
    <div className="fb-reach" data-testid="fb-reach">
      <div className={`fb-reach-item${st.browsers.length ? ' ok' : ''}`}>
        <Icon name="globe" size={15} />
        <div>
          <b>Browsers</b>
          <div className="muted small">{st.browsers.length ? `${st.browsers.join(', ')} show${st.browsers.length === 1 ? 's' : ''} a calm page instead of a blocked site.` : 'Add Keeper’s browser extension for a calm page instead of a blocked site.'}</div>
          {!st.browsers.length ? <button className="btn sm ghost" onClick={() => go({ name: 'health', arg: 'apps' })}>Set up the extension</button> : null}
        </div>
      </div>
      <div className={`fb-reach-item${st.dnsFilter ? ' ok' : ''}`}>
        <Icon name="shield" size={15} />
        <div>
          <b>Every other app</b>
          <div className="muted small">{st.dnsFilter ? 'The firewall’s DNS filter blocks these sites for every app too.' : 'Turn on the DNS filter in the firewall to block sites in every app, not only browsers.'}</div>
          {!st.dnsFilter ? <button className="btn sm ghost" onClick={() => go({ name: 'firewall' })}>Open the firewall</button> : null}
        </div>
      </div>
      <div className={`fb-reach-item${st.appsSupported ? ' ok' : ''}`}>
        <Icon name="app" size={15} />
        <div>
          <b>Apps</b>
          <div className="muted small">{st.appsSupported ? 'A blocked app that comes to the front gets a Keeper window over it.' : 'This desktop does not tell Keeper which app is in front (Wayland), so apps cannot be blocked here. Sites still can.'}</div>
        </div>
      </div>
    </div>
  );
}

function Lists({ st, run }: { st: FocusBlockStatus; run: (p: Promise<FocusBlockStatus>) => void }) {
  const [running, setRunning] = useState<string[]>([]);
  useEffect(() => { void api.focusBlock.runningApps().then(setRunning).catch(() => undefined); }, []);
  const locked = st.block.on && st.block.strict;
  return (
    <div className="fb-lists">
      <datalist id="fb-running-apps">{running.map((a) => <option key={a} value={a} />)}</datalist>
      {st.data.lists.map((l) => <ListCard key={l.id} list={l} st={st} run={run} locked={locked && st.block.lists.includes(l.name)} />)}
      <button className="btn" data-testid="fb-new-list" onClick={() => run(api.focusBlock.saveList({ id: '', name: 'New list', sites: [], apps: [] }))}><Icon name="plus" size={14} /> New list</button>
    </div>
  );
}

function ListCard({ list, st, run, locked }: { list: BlockList; st: FocusBlockStatus; run: (p: Promise<FocusBlockStatus>) => void; locked: boolean }) {
  const { toast } = useStore();
  const [name, setName] = useState(list.name);
  const [site, setSite] = useState('');
  const [appName, setAppName] = useState('');
  useEffect(() => setName(list.name), [list.name]);
  const save = (patch: Partial<BlockList>) => run(api.focusBlock.saveList({ ...list, ...patch }));
  const addSites = () => {
    const parts = site.split(/[\s,]+/).filter(Boolean);
    const ok = parts.map(normalizeSite).filter((s): s is string => !!s);
    if (!ok.length) { if (parts.length) toast('That doesn’t look like a website, for example news.example.com'); return; }
    setSite('');
    save({ sites: [...new Set([...list.sites, ...ok])] });
  };
  const addApp = () => {
    const a = appName.trim();
    if (!a) return;
    setAppName('');
    save({ apps: [...new Set([...list.apps, a])] });
  };
  const forFocus = st.data.focusList === list.id;
  return (
    <section className="card fb-list" aria-label={`List ${list.name}`} data-testid={`fb-list-${list.id}`}>
      <div className="fb-list-head">
        <input className="input fb-list-name" value={name} aria-label="List name" disabled={locked} onChange={(e) => setName(e.target.value)} onBlur={() => { if (name.trim() && name !== list.name) save({ name: name.trim() }); }} />
        <label className="fb-inline small"><input type="radio" name="fb-focus-list" checked={forFocus} onChange={() => run(api.focusBlock.setFocusList(list.id))} /> Block during Focus sessions</label>
        <button className="btn sm ghost" aria-label={`Remove the list ${list.name}`} disabled={locked} onClick={() => run(api.focusBlock.removeList(list.id))}><Icon name="trash" size={14} /></button>
      </div>
      <div className="fb-list-part">
        <div className="fb-part-title">Sites</div>
        <div className="chips">
          {list.sites.map((s) => <span key={s} className="chip">{s}{locked ? null : <button aria-label={`Remove ${s}`} onClick={() => save({ sites: list.sites.filter((x) => x !== s) })}><Icon name="close" size={11} /></button>}</span>)}
          {!list.sites.length ? <span className="muted small">No sites yet.</span> : null}
        </div>
        {!locked ? (
          <form className="fb-add" onSubmit={(e) => { e.preventDefault(); addSites(); }}>
            <input className="input" value={site} placeholder="Add a site, like news.example.com" aria-label={`Add a site to ${list.name}`} onChange={(e) => setSite(e.target.value)} data-testid={`fb-add-site-${list.id}`} />
            <button className="btn sm" type="submit">Add</button>
          </form>
        ) : null}
      </div>
      <div className="fb-list-part">
        <div className="fb-part-title">Apps</div>
        <div className="chips">
          {list.apps.map((a) => <span key={a} className="chip">{a}{locked ? null : <button aria-label={`Remove ${a}`} onClick={() => save({ apps: list.apps.filter((x) => x !== a) })}><Icon name="close" size={11} /></button>}</span>)}
          {!list.apps.length ? <span className="muted small">No apps yet.</span> : null}
        </div>
        {!locked ? (
          <form className="fb-add" onSubmit={(e) => { e.preventDefault(); addApp(); }}>
            <input className="input" list="fb-running-apps" value={appName} placeholder="Add an app by name" aria-label={`Add an app to ${list.name}`} onChange={(e) => setAppName(e.target.value)} />
            <button className="btn sm" type="submit">Add</button>
          </form>
        ) : null}
      </div>
    </section>
  );
}

function Schedules({ st, run }: { st: FocusBlockStatus; run: (p: Promise<FocusBlockStatus>) => void }) {
  const save = (s: BlockSchedule) => run(api.focusBlock.saveSchedule(s));
  if (!st.data.lists.length) return <p className="muted">Make a list first.</p>;
  return (
    <div className="fb-schedules">
      <p className="muted small">A schedule blocks its list on the days and hours you choose. An end before the start runs past midnight.</p>
      {st.data.schedules.map((s) => (
        <div key={s.id} className="card fb-schedule" role="group" aria-label="Schedule" data-testid="fb-schedule">
          <select className="input" value={s.listId} aria-label="List" onChange={(e) => save({ ...s, listId: e.target.value })}>
            {st.data.lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <div className="fb-days" role="group" aria-label="Days">
            {DAYS.map((d, i) => {
              const on = s.days.includes(i);
              return <button key={d} className={`fb-day${on ? ' on' : ''}`} aria-pressed={on} onClick={() => save({ ...s, days: on ? s.days.filter((x) => x !== i) : [...s.days, i] })}>{d}</button>;
            })}
          </div>
          <label className="fb-inline small">From <input className="input fb-time" type="time" value={minutesText(s.start)} onChange={(e) => { const m = parseClock(e.target.value); if (m !== undefined) save({ ...s, start: m }); }} /></label>
          <label className="fb-inline small">to <input className="input fb-time" type="time" value={minutesText(s.end)} onChange={(e) => { const m = parseClock(e.target.value); if (m !== undefined) save({ ...s, end: m }); }} /></label>
          <Toggle on={s.on} label="Schedule on" onChange={(v) => save({ ...s, on: v })} />
          <button className="btn sm ghost" aria-label="Remove this schedule" onClick={() => run(api.focusBlock.removeSchedule(s.id))}><Icon name="trash" size={14} /></button>
        </div>
      ))}
      <button className="btn" data-testid="fb-add-schedule" onClick={() => save({ id: '', listId: st.data.lists[0].id, days: [1, 2, 3, 4, 5], start: 9 * 60, end: 12 * 60, on: true })}><Icon name="plus" size={14} /> Add a schedule</button>
    </div>
  );
}

function Options({ st }: { st: FocusBlockStatus }) {
  const { updateSettings } = useStore();
  const o = st.options;
  const set = (patch: Partial<FocusBlockOptions>) => void updateSettings({ focusBlock: { ...o, ...patch } });
  return (
    <div className="card pad fb-options">
      <Row title="Block during Focus sessions" desc="Your Focus list is blocked whenever a Focus session runs."><Toggle on={o.withFocus} label="Block during Focus sessions" onChange={(v) => set({ withFocus: v })} /></Row>
      <Row title="Strict mode" desc="No short visits and no early stop until a block ends. Quitting Keeper, or an administrator on this computer, can still end it."><Toggle on={o.strict} label="Strict mode" onChange={(v) => set({ strict: v })} /></Row>
      <Row title="Length of a short visit" desc="How long “Let me in” opens a blocked site or app.">
        <select className="input" value={o.passMinutes} aria-label="Length of a short visit" onChange={(e) => set({ passMinutes: Number(e.target.value) })}>{[1, 3, 5, 10, 15].map((m) => <option key={m} value={m}>{m} minute{m === 1 ? '' : 's'}</option>)}</select>
      </Row>
      <Row title="Pause before a short visit" desc="A few seconds to think before a blocked site opens.">
        <select className="input" value={o.waitSeconds} aria-label="Pause before a short visit" onChange={(e) => set({ waitSeconds: Number(e.target.value) })}>{[0, 5, 10, 30, 60].map((m) => <option key={m} value={m}>{m ? `${m} seconds` : 'No pause'}</option>)}</select>
      </Row>
      <Row title="Close blocked apps" desc="Quit a blocked app when it comes to the front, instead of covering it."><Toggle on={o.closeApps} label="Close blocked apps" onChange={(v) => set({ closeApps: v })} /></Row>
    </div>
  );
}

/** The small window over a blocked app (view=blocked). */
export function BlockedWindow() {
  const [b, setB] = useState<BlockedApp | null>(null);
  const [waiting, setWaiting] = useState<number | null>(null);
  const [note, setNote] = useState('');
  useEffect(() => {
    const load = () => void api.focusBlock.blockedApp().then((x) => { setB(x); setWaiting(null); setNote(''); });
    load();
    return api.on('focusblock-changed', load);
  }, []);
  useEffect(() => {
    if (waiting === null || waiting <= 0) return;
    const t = setTimeout(() => setWaiting(waiting - 1), 1000);
    return () => clearTimeout(t);
  }, [waiting]);
  if (!b) return null;
  return (
    <main className="fb-window" aria-labelledby="fb-window-title" data-testid="fb-window">
      <div className="fb-hero-icon" aria-hidden><Icon name="block" size={22} /></div>
      <h1 id="fb-window-title" className="fb-window-title">{b.app} can wait</h1>
      <p className="muted">{b.line}</p>
      {waiting === null ? (
        <div className="fb-window-actions">
          <button className="btn primary" autoFocus onClick={() => void api.focusBlock.closeApp()}>Close {b.app}</button>
          {!b.strict ? <button className="btn" onClick={() => setWaiting(b.waitSeconds)}>Let me in for {b.passMinutes} minute{b.passMinutes === 1 ? '' : 's'}</button> : null}
          <button className="btn ghost" onClick={() => void api.focusBlock.dismiss()}>Not now</button>
        </div>
      ) : (
        <div className="fb-window-wait" aria-live="polite">
          <p>Take a breath. Is this what you meant to do?</p>
          <div className="fb-window-actions">
            <button className="btn" onClick={() => setWaiting(null)}>Never mind</button>
            <button className="btn primary" disabled={waiting > 0} onClick={async () => {
              const r = await api.focusBlock.pass(b.app);
              if (r.ok) void api.focusBlock.dismiss();
              else { setNote(r.message ?? 'Not now.'); setWaiting(null); }
            }}>{waiting > 0 ? `Open it (${waiting})` : 'Open it'}</button>
          </div>
        </div>
      )}
      {b.strict ? <p className="muted small">Strict mode is on, so there are no short visits until the block ends.</p> : null}
      {note ? <p className="small" role="status">{note}</p> : null}
    </main>
  );
}
