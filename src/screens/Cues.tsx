// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Cues: the home for notes, checklists, links and files tied to an app, a
// site, a page or a time. They pop up beside the app or page they belong to;
// this page is where they are found, sorted, edited and set up.

import { useEffect, useMemo, useState } from 'react';
import type { CueSettings } from '../../core/cues/api';
import { counts, FILTERS, filterCues, sections, type CueFilter, type CueSort } from '../../core/cues/dashboard';
import type { CueTemplate } from '../../core/cues/model';
import { api } from '../api';
import { Composer, CueCard, useCues } from '../cues/parts';
import { Icon } from '../components/Icon';
import { PageHead, Toggle } from '../components/ui';
import { useStore } from '../state';
import { Row } from './IslandSettings';
import '../styles/cues.css';

type Tab = 'cues' | 'checklists' | 'settings';

export function Cues() {
  const { route, toast } = useStore();
  const [st] = useCues();
  const initialTab: Tab = route.arg === 'settings' ? 'settings' : route.arg === 'checklists' ? 'checklists' : 'cues';
  const [tab, setTab] = useState<Tab>(initialTab);
  const [filter, setFilter] = useState<CueFilter>('all');
  const [sort, setSort] = useState<CueSort>('updated');
  const [q, setQ] = useState('');
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  useEffect(() => { if (route.arg === 'settings' || route.arg === 'checklists') setTab(route.arg); }, [route.arg]);
  // A cue opened from the tray, a notification or search: scroll to it.
  useEffect(() => {
    if (!route.arg || route.arg === 'settings' || route.arg === 'checklists' || !st) return;
    const el = document.querySelector(`[data-cue="${CSS.escape(route.arg)}"]`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el?.classList.add('flash');
  }, [route.arg, st]);

  const list = useMemo(() => (st ? filterCues(st.cues, { filter, q, sort, now }) : []), [st, filter, q, sort, now]);
  const n = useMemo(() => (st ? counts(st.cues, now) : null), [st, now]);
  const sec = useMemo(() => (st ? sections(st.cues, now) : { today: [], upcoming: [] }), [st, now]);
  if (!st) return <div className="page"><PageHead title="Cues" sub="Cues are switched off in Settings → Features." /></div>;
  // With the Due today / Upcoming sections showing, the rest is listed once below them.
  const sectioned = filter === 'all' && !q ? new Set([...sec.today, ...sec.upcoming].map((c) => c.id)) : new Set<string>();
  const rest = list.filter((c) => !sectioned.has(c.id));
  const here = st.showing.map((id) => st.cues.find((c) => c.id === id)).filter((c) => !!c && !c.done && !c.deletedAt);
  const textSize = st.settings.textSize;

  return (
    <div className="page cues-page" data-testid="cues-page">
      <PageHead title="Cues" sub="Notes, checklists, links and files that come back in the app, on the site or at the time they belong to.">
        <div className="seg" role="tablist">
          {(['cues', 'checklists', 'settings'] as Tab[]).map((t) => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t === 'cues' ? 'Cues' : t === 'checklists' ? 'Checklists' : 'Settings'}</button>)}
        </div>
      </PageHead>

      {tab === 'cues' ? (
        <div className="cues-top">
          <div>
            <div className="cues-filters">
              {FILTERS.map((f) => (
                <button key={f.id} className={`chip ${filter === f.id ? 'on' : ''}`} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                  {f.label} <span className="n">{n?.[f.id] ?? 0}</span>
                </button>
              ))}
              <span className="grow" />
              <input className="input cues-search" placeholder="Search cues" aria-label="Search cues" value={q} onChange={(e) => setQ(e.target.value)} />
              <select className="input" aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as CueSort)}>
                <option value="updated">Recently changed</option><option value="due">Due time</option><option value="created">Newest</option><option value="title">A–Z</option>
              </select>
            </div>
            {filter === 'all' && !q && (sec.today.length || sec.upcoming.length) ? (
              <>
                {sec.today.length ? <div className="cues-section"><h3>Due today</h3><div className="cues-list">{sec.today.map((c) => <CueCard key={c.id} cue={c} now={now} textSize={textSize} />)}</div></div> : null}
                {sec.upcoming.length ? <div className="cues-section"><h3>Upcoming</h3><div className="cues-list">{sec.upcoming.map((c) => <CueCard key={c.id} cue={c} now={now} textSize={textSize} />)}</div></div> : null}
                <div className="cues-section"><h3>Everything open</h3></div>
              </>
            ) : null}
            {rest.length ? (
              <div className="cues-list">{rest.map((c) => <CueCard key={c.id} cue={c} now={now} textSize={textSize} />)}</div>
            ) : (
              <div className="empty"><Icon name="pin" size={28} /><b>{list.length ? 'Nothing else open' : q ? 'No cues match' : filter === 'deleted' ? 'Nothing deleted in the last 30 days' : 'No cues here yet'}</b><span>Write one on the right, press {st.settings.shortcut.replace('CommandOrControl', navigator.platform.includes('Mac') ? '⌘' : 'Ctrl').replace(/\+/g, ' ')} in any app, or use the browser extension’s button.</span></div>
            )}
          </div>
          <div className="cues-side">
            <div className="card pad">
              <b style={{ display: 'block', marginBottom: 8 }}>New cue</b>
              <Composer st={st} onSaved={(c) => toast(`Saved “${c.title}”`)} />
            </div>
            {here.length ? (
              <div className="card pad cues-here">
                <b><Icon name="pin" size={12} /> Here now</b>
                <div className="muted small" style={{ margin: '4px 0 8px' }}>{st.front?.url ? new URL(st.front.url).hostname : st.front?.app}</div>
                {here.map((c) => <CueCard key={c!.id} cue={c!} now={now} compact />)}
              </div>
            ) : null}
            <div className="card pad small muted">
              <b style={{ color: 'var(--text)' }}>Where cues appear</b>
              <p style={{ margin: '6px 0 0' }}>{st.watcher}</p>
              {!st.browserLinked ? <p style={{ margin: '6px 0 0' }}>Page and site cues need Keeper’s browser extension (Browser tabs page).</p> : null}
            </div>
          </div>
        </div>
      ) : null}

      {tab === 'checklists' ? <Checklists templates={st.templates} /> : null}
      {tab === 'settings' ? <CueSettingsView s={st.settings} folder={st.folder} /> : null}
    </div>
  );
}

function Checklists({ templates }: { templates: CueTemplate[] }) {
  const { toast } = useStore();
  const [edit, setEdit] = useState<{ id?: string; name: string; text: string } | null>(null);
  const save = async () => {
    if (!edit) return;
    await api.cues.saveTemplate({ id: edit.id, name: edit.name, items: edit.text.split('\n').map((l) => l.replace(/^[-*•]\s*(\[[ xX]\]\s*)?/, '').trim()).filter(Boolean) });
    setEdit(null);
  };
  return (
    <div className="cues-top">
      <div className="card pad">
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
          <b className="grow">Reusable checklists</b>
          <button className="btn sm primary" onClick={() => setEdit({ name: '', text: '' })}><Icon name="plus" size={11} /> New checklist</button>
        </div>
        {!templates.length ? <div className="muted small">Make a checklist once and run it whenever you need it — from here, the Island or a new cue. Each run can skip steps.</div> : null}
        {templates.map((t) => (
          <div key={t.id} className="tpl-row">
            <Icon name="listCheck" size={14} />
            <div className="grow"><b>{t.name}</b> <span className="muted small">· {t.items.length} steps</span></div>
            <button className="btn sm" onClick={() => void api.cues.startTemplate(t.id).then((c) => toast(`Started “${c.title}”`))}>Start</button>
            <button className="btn sm ghost" onClick={() => setEdit({ id: t.id, name: t.name, text: t.items.join('\n') })}>Edit</button>
            <button className="btn sm ghost icon" aria-label="Delete checklist" onClick={() => void api.cues.removeTemplate(t.id)}><Icon name="trash" size={12} /></button>
          </div>
        ))}
      </div>
      <div className="cues-side">
        {edit ? (
          <div className="card pad" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <b>{edit.id ? 'Edit checklist' : 'New checklist'}</b>
            <input className="input" placeholder="Name" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            <textarea className="input cue-input" rows={8} placeholder={'One step per line'} value={edit.text} onChange={(e) => setEdit({ ...edit, text: e.target.value })} />
            <div className="cue-actions"><button className="btn sm primary" disabled={!edit.name.trim()} onClick={() => void save()}>Save</button><button className="btn sm ghost" onClick={() => setEdit(null)}>Cancel</button></div>
          </div>
        ) : <div className="card pad small muted">Tip: on any checklist cue, “Save as checklist” keeps its steps for next time.</div>}
      </div>
    </div>
  );
}

function CueSettingsView({ s, folder }: { s: CueSettings; folder: string }) {
  const { toast } = useStore();
  const set = (p: Partial<CueSettings>) => void api.cues.setSettings(p).catch((e) => toast(String(e)));
  return (
    <div className="card pad settings-list" style={{ maxWidth: 760 }}>
      <h3 style={{ marginTop: 0 }}>Where cues appear</h3>
      <Row title="Pop up beside the app or page" desc="A small card next to the window the cue belongs to, without taking the keyboard."><Toggle on={s.popup} onChange={(v) => set({ popup: v })} /></Row>
      <Row title="In the Island" desc="A cue badge in the pill; the Island’s Cues tool lists them."><Toggle on={s.island} onChange={(v) => set({ island: v })} /></Row>
      <Row title="System notification when due"><Toggle on={s.notify} onChange={(v) => set({ notify: v })} /></Row>
      <Row title="Menu bar / tray" desc="New cue here, and today’s cues."><Toggle on={s.tray} onChange={(v) => set({ tray: v })} /></Row>
      <Row title="Shortcut for a new cue here" desc="Works in any app; attaches the cue to the page or app in front."><input className="input" style={{ width: 220 }} value={s.shortcut} onChange={(e) => set({ shortcut: e.target.value })} /></Row>
      <h3>Behaviour</h3>
      <Row title="Quiet time before showing again" desc="After a cue showed in a place, wait this long before it shows there again."><span><input className="input" type="number" min={0} max={1440} style={{ width: 80 }} value={s.cooldownMin} onChange={(e) => set({ cooldownMin: Number(e.target.value) })} /> min</span></Row>
      <Row title="Offer a cue after time on a page" desc="With the browser extension: after a while on one page, the Island asks once whether to leave a cue there."><Toggle on={s.captureHint} onChange={(v) => set({ captureHint: v })} /></Row>
      {s.captureHint ? (
        <Row title="After / at most every"><span><input className="input" type="number" min={1} max={120} style={{ width: 70 }} value={s.hintAfterMin} onChange={(e) => set({ hintAfterMin: Number(e.target.value) })} /> min · <input className="input" type="number" min={5} max={1440} style={{ width: 80 }} value={s.hintEveryMin} onChange={(e) => set({ hintEveryMin: Number(e.target.value) })} /> min</span></Row>
      ) : null}
      <Row title="A copied link starts a link cue" desc="In the Island’s Cues tool."><Toggle on={s.linkOnCopy} onChange={(v) => set({ linkOnCopy: v })} /></Row>
      <Row title="Typing suggestions" desc="Tab finishes phrases you often write in cues. Learnt on this computer only."><Toggle on={s.suggestions} onChange={(v) => set({ suggestions: v })} /></Row>
      <Row title="Card text size"><span><input type="range" min={9} max={28} value={s.textSize} onChange={(e) => set({ textSize: Number(e.target.value) })} /> {s.textSize} pt</span></Row>
      <h3>Files and sync</h3>
      <Row title="Cues folder" desc={<>Each cue is a Markdown file: <code>{folder}</code></>}>
        <span className="btn-row">
          <button className="btn sm" onClick={() => void api.cues.openFolder()}>Show</button>
          <button className="btn sm" onClick={() => void api.settings.pickFolder().then((p) => p && set({ folder: p }))}>Change…</button>
        </span>
      </Row>
      <Row title="Sync with your devices" desc="Adds the Cues folder to Keeper Sync, so cues follow you."><button className="btn sm" onClick={() => void api.cues.syncWithDevices().then((r) => toast(r.message))}>Sync this folder</button></Row>
      <Row title="Export" desc="All cues in one Markdown file."><button className="btn sm" onClick={() => void api.cues.exportMarkdown().then((p) => p && toast(`Saved ${p}`))}>Export…</button></Row>
    </div>
  );
}
