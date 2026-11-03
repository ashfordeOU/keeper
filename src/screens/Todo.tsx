// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Fix-it List (was To do): everything Keeper found worth doing about space, storage, security,
// privacy, speed, the network, backups and updates — most important first —
// each with a fix that is done for you or walked through step by step. Each row
// opens to show exactly what was found (gathered only then), and has Trust,
// Snooze, Ignore, Show in Finder / the browser's page and Fix; several rows can
// be trusted or snoozed at once. Similar findings are shown together.

import { useEffect, useId, useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { SNOOZE_CHOICES } from '../../core/guide/aggregate';
import { groupRows, severityWord, type Row } from '../../core/guide/group';
import { AREAS, type Area, type FindingDetails, type FindingView } from '../../core/guide/types';
import { formatBytes, relativeTime } from '../../core/format';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Check, ContextMenu, Empty, PageHead, type MenuItem } from '../components/ui';
import { AREA_ICON, AREA_LABEL, gtTodo, openGuide, SEV_CLASS, useGuideLang, useGuideList, useHowTo } from '../guide';
import { useStore } from '../state';

type Show = 'open' | 'later';
type Menu = { x: number; y: number; items: MenuItem[]; label: string } | null;

const PLAT = typeof navigator !== 'undefined' ? navigator.platform : '';
const FM = /Mac/i.test(PLAT) ? 'Finder' : /Win/i.test(PLAT) ? 'Explorer' : 'the file manager';

export function Todo() {
  const lang = useGuideLang();
  const { toast } = useStore();
  const [list, reload] = useGuideList();
  const [area, setArea] = useState<Area | 'all'>('all');
  const [show, setShow] = useState<Show>('open');
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<Menu>(null);
  const how = useHowTo(q);
  const open = list?.findings.filter((f) => f.status === 'open') ?? [];
  const later = list?.findings.filter((f) => f.status === 'snoozed' || f.status === 'ignored' || f.status === 'trusted') ?? [];
  const shown = (show === 'open' ? open : later).filter((f) => area === 'all' || f.area === area);
  const rows = useMemo(() => groupRows(shown), [shown]);
  const freeable = open.reduce((n, f) => n + (f.impactBytes ?? 0), 0);
  // Selection only holds what is on screen.
  const visible = new Set(shown.map((f) => f.id));
  const picked = [...selected].filter((id) => visible.has(id));
  useEffect(() => setSelected(new Set()), [show, area]);

  const toggle = (ids: string[], on: boolean) => setSelected((s) => {
    const n = new Set(s);
    for (const id of ids) if (on) n.add(id); else n.delete(id);
    return n;
  });

  const trust = async (ids: string[]) => {
    await api.guide.trust(ids);
    reload();
    toggle(ids, false);
    toast(ids.length === 1 ? 'Trusted. It comes back if it changes.' : `${ids.length} items trusted. Each comes back if it changes.`, { label: 'Undo', run: () => void Promise.all(ids.map((id) => api.guide.untrust(id))).then(reload) });
  };
  const snooze = async (ids: string[], ms: number, label: string) => {
    await api.guide.setStates(ids, { snoozedUntil: Date.now() + ms });
    reload();
    toggle(ids, false);
    toast(`${ids.length === 1 ? 'Snoozed' : `${ids.length} items snoozed`} for ${label}.`, { label: 'Undo', run: () => void api.guide.setStates(ids, { snoozedUntil: undefined }).then(reload) });
  };
  const ignore = async (ids: string[]) => {
    await api.guide.setStates(ids, { ignored: true });
    reload();
    toggle(ids, false);
    toast('Ignored. It stays under Snoozed, ignored and trusted.', { label: 'Undo', run: () => void api.guide.setStates(ids, { ignored: undefined }).then(reload) });
  };
  const bringBack = async (f: FindingView) => {
    if (f.status === 'trusted') await api.guide.untrust(f.id);
    else await api.guide.setState(f.id, null);
    reload();
  };
  const snoozeMenu = (e: ReactMouseEvent<HTMLElement>, ids: string[]) => {
    const r = e.currentTarget.getBoundingClientRect();
    setMenu({ x: r.left, y: r.bottom + 4, label: 'Snooze for', items: SNOOZE_CHOICES.map((c) => ({ label: c.label, icon: 'clock', run: () => void snooze(ids, c.ms, c.label) })) });
  };
  const actions: RowActions = { trust: (id) => void trust([id]), snoozeMenu, ignore: (id) => void ignore([id]), bringBack: (f) => void bringBack(f), setMenu, toast };

  const allOn = shown.length > 0 && picked.length === shown.length;
  return (
    <div className="todo">
      <PageHead title={gtTodo(lang)} sub={list ? <>{open.length ? `${open.length} thing${open.length === 1 ? '' : 's'} worth doing` : 'Nothing to do — all good.'}{freeable ? ` · up to ${formatBytes(freeable)} to free` : ''}{list.checkedAt ? ` · checked ${relativeTime(list.checkedAt)}` : ''}</> : 'Checking…'}>
        <button className="btn" disabled={busy} onClick={async () => { setBusy(true); await api.guide.refresh(); reload(); setBusy(false); }}>{busy ? <div className="spinner" /> : <Icon name="refresh" size={14} />} Check again</button>
      </PageHead>

      <div className="howto">
        <Icon name="search" size={15} />
        <input className="input" placeholder="How do I…? — free up space, stop apps watching my camera, encrypt my disk…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="How do I" />
      </div>
      {q ? (
        <div className="howto-results">
          {how.length ? how.map((h) => <button key={h.id} className="chip" onClick={() => openGuide(h.id)}><Icon name={AREA_ICON[h.area as Area] ?? 'sparkle'} size={13} /> {h.title}</button>) : <span className="small muted">No guide for that yet — try “free up space”, “camera”, “encrypt”, “backup”, “trackers”.</span>}
        </div>
      ) : null}

      <div className="seg" style={{ margin: '14px 0 10px' }}>
        <button className={area === 'all' ? 'on' : ''} onClick={() => setArea('all')}>All</button>
        {AREAS.filter((a) => (list?.summary.byArea[a] ?? 0) > 0 || a === area).map((a) => (
          <button key={a} className={area === a ? 'on' : ''} onClick={() => setArea(a)}>{AREA_LABEL[a]} <span className="count">{list?.summary.byArea[a] ?? 0}</span></button>
        ))}
        <span className="grow" />
        {later.length || show === 'later' ? <button className={show === 'later' ? 'on' : ''} data-testid="fixit-later-tab" onClick={() => setShow(show === 'later' ? 'open' : 'later')}>Snoozed, ignored and trusted ({later.length})</button> : null}
      </div>

      {shown.length && show === 'open' ? (
        <div className={`fx-bulk ${picked.length ? 'on' : ''}`} role="toolbar" aria-label="Selected items">
          <Check on={allOn} onChange={(v) => setSelected(v ? new Set(shown.map((f) => f.id)) : new Set())} label="Select all" />
          <span className="small muted grow">{picked.length ? `${picked.length} selected` : 'Select several to trust or snooze them together'}</span>
          {picked.length ? (
            <>
              <button className="btn sm" data-testid="fixit-bulk-trust" onClick={() => void trust(picked)}><Icon name="check" size={12} /> Trust selected</button>
              <button className="btn sm" data-testid="fixit-bulk-snooze" aria-haspopup="menu" onClick={(e) => snoozeMenu(e, picked)}><Icon name="clock" size={12} /> Snooze selected <Icon name="chevronDown" size={11} /></button>
              <button className="btn sm ghost" onClick={() => setSelected(new Set())}>Clear</button>
            </>
          ) : null}
        </div>
      ) : null}

      {!list ? null : shown.length ? (
        <div className="findings fx-list">
          {rows.map((r) => (r.kind === 'one'
            ? <FixRow key={r.finding.id} f={r.finding} later={show === 'later'} selected={selected.has(r.finding.id)} onSelect={(on) => toggle([r.finding.id], on)} actions={actions} />
            : <GroupRow key={r.key} g={r} later={show === 'later'} selected={selected} toggle={toggle} actions={actions} />))}
        </div>
      ) : (
        <Empty icon="check" title={show === 'open' ? 'Nothing to do — all good.' : 'Nothing snoozed, ignored or trusted'}>
          <span className="small">Keeper checks space, security, privacy, backups and updates a minute after it starts and twice a day.</span>
        </Empty>
      )}

      {menu ? <ContextMenu x={menu.x} y={menu.y} items={menu.items} label={menu.label} onClose={() => setMenu(null)} /> : null}

      <h3 style={{ margin: '22px 0 8px' }}>Guides</h3>
      <div className="guide-flows">
        <GuideList />
      </div>
    </div>
  );
}

interface RowActions {
  trust(id: string): void;
  snoozeMenu(e: ReactMouseEvent<HTMLElement>, ids: string[]): void;
  ignore(id: string): void;
  bringBack(f: FindingView): void;
  setMenu(m: Menu): void;
  toast(text: string): void;
}

function GroupRow({ g, later, selected, toggle, actions }: { g: Extract<Row<FindingView>, { kind: 'group' }>; later: boolean; selected: Set<string>; toggle: (ids: string[], on: boolean) => void; actions: RowActions }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ids = g.items.map((f) => f.id);
  const all = ids.every((x) => selected.has(x));
  return (
    <div className={`fx-group ${open ? 'open' : ''}`} data-testid="fixit-group">
      <div className="finding fx-head">
        {!later ? <Check on={all} onChange={(v) => toggle(ids, v)} label={`Select all ${g.items.length}: ${g.title}`} /> : null}
        <button className="fx-toggle" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(!open)}>
          <Icon name={open ? 'chevronDown' : 'chevronRight'} size={13} />
          <Icon name={AREA_ICON[g.items[0].area]} size={16} />
          <span className="grow fx-text"><span className="finding-title">{g.title}</span><span className="small muted fx-why">{g.items.slice(0, 3).map((f) => shortName(f)).join(', ')}{g.items.length > 3 ? ` and ${g.items.length - 3} more` : ''}</span></span>
        </button>
        <span className={`badge ${SEV_CLASS[g.severity]}`}>{severityWord(g.severity)}</span>
        {!later ? <button className="btn sm" onClick={(e) => actions.snoozeMenu(e, ids)} aria-haspopup="menu" aria-label={`Snooze all ${g.items.length}`}>Snooze all <Icon name="chevronDown" size={11} /></button> : null}
      </div>
      {open ? (
        <div id={id} className="fx-children" role="group" aria-label={g.title}>
          {g.items.map((f) => <FixRow key={f.id} f={f} later={later} selected={selected.has(f.id)} onSelect={(on) => toggle([f.id], on)} actions={actions} />)}
        </div>
      ) : null}
    </div>
  );
}

/** A short name for a finding inside a group ("Readwise Highlighter", "Docker Desktop"). */
function shortName(f: FindingView): string {
  const s = f.subject;
  if (s?.kind === 'extension') return s.name;
  if (s?.kind === 'certificate') return s.name;
  if (s?.kind === 'login-item') return s.tool?.name ?? s.label ?? s.name;
  return f.title;
}

function statusLine(f: FindingView): string | null {
  if (f.status === 'trusted') return `Trusted ${f.state.trusted ? relativeTime(f.state.trusted.at) : ''}. It comes back if it changes.`;
  if (f.status === 'snoozed' && f.state.snoozedUntil) return `Snoozed until ${new Date(f.state.snoozedUntil).toLocaleDateString()}`;
  if (f.status === 'ignored') return 'Ignored';
  return null;
}

function FixRow({ f, later, selected, onSelect, actions }: { f: FindingView; later: boolean; selected: boolean; onSelect: (on: boolean) => void; actions: RowActions }) {
  const [open, setOpen] = useState(false);
  const [d, setD] = useState<FindingDetails | null | undefined>(undefined);
  const id = useId();
  const s = f.subject;
  // Gathered only when opened: signatures, file contents and certificates are read then, never on page load.
  useEffect(() => {
    if (!open || d !== undefined) return;
    let alive = true;
    void api.guide.details(f.id).then((x) => alive && setD(x)).catch(() => alive && setD(null));
    return () => { alive = false; };
  }, [open, d, f.id]);
  const status = statusLine(f);
  const more = (e: ReactMouseEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const items: MenuItem[] = [{ label: 'Ignore (always)', icon: 'eyeOff', run: () => actions.ignore(f.id) }];
    if (s && s.kind !== 'extension') items.push({ label: `Show in ${FM}`, icon: 'reveal', run: () => void api.guide.reveal(f.id, 'file').then((x) => { if (!x.ok && x.message) actions.toast(x.message); }) });
    if (s?.kind === 'extension') items.push({ label: `Open in ${s.browser}’s extensions page`, icon: 'external', run: () => void api.guide.reveal(f.id, 'extension').then((x) => { if (x.message) actions.toast(x.message); }) });
    actions.setMenu({ x: r.right - 240, y: r.bottom + 4, label: 'More actions', items });
  };
  // Clicking the row (not a button in it) opens or closes the details.
  const onRowClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button, a, input, [role="checkbox"]')) return;
    setOpen((o) => !o);
  };
  return (
    <div className={`fx-row ${open ? 'open' : ''} ${selected ? 'picked' : ''}`} data-testid="fixit-row" data-id={f.id}>
      <div className="finding fx-head" onClick={onRowClick}>
        {!later ? <Check on={selected} onChange={onSelect} label={`Select “${f.title}”`} /> : null}
        <button className="fx-toggle" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(!open)} title={open ? 'Hide details' : 'Show details'}>
          <Icon name={open ? 'chevronDown' : 'chevronRight'} size={13} />
          <Icon name={AREA_ICON[f.area]} size={16} />
          <span className="grow fx-text">
            <span className="finding-title">{f.title}{f.impact ? <span className="muted small"> · {f.impact}</span> : null}</span>
            <span className="small muted fx-why">{status ?? (f.changed ? `Changed since you trusted it. ${f.why}` : f.why)}</span>
          </span>
        </button>
        <span className={`badge ${SEV_CLASS[f.severity]}`}>{severityWord(f.severity)}</span>
        {later ? (
          <button className="btn sm" data-testid="fixit-bring-back" onClick={() => actions.bringBack(f)}><Icon name="undo" size={12} /> {f.status === 'trusted' ? 'Stop trusting' : 'Undo'}</button>
        ) : (
          <span className="fx-actions">
            <button className="btn sm" data-testid="fixit-trust" title="It is mine and fine: hide it until it changes" onClick={() => actions.trust(f.id)}>{s ? 'Trust' : 'Keep it'}</button>
            <button className="btn sm" data-testid="fixit-snooze" aria-haspopup="menu" onClick={(e) => actions.snoozeMenu(e, [f.id])}>Snooze <Icon name="chevronDown" size={11} /></button>
            <button className="btn sm ghost" aria-haspopup="menu" aria-label={`More actions for “${f.title}”`} onClick={more}>More</button>
            <button className="btn sm primary" data-testid="fixit-fix" onClick={() => openGuide(f.id)}>{f.fix.kind === 'auto' ? f.fix.label : 'Fix'}</button>
          </span>
        )}
      </div>
      {open ? (
        <div id={id} className="fx-details" data-testid="fixit-details" role="region" aria-label={`Details: ${f.title}`}>
          {d === undefined ? <div className="small muted fx-loading"><div className="spinner" /> Looking closer…</div> : d === null ? <div className="small muted">{f.detail ?? 'No more details.'}</div> : <Details d={d} f={f} />}
        </div>
      ) : null}
    </div>
  );
}

function openUrl(url: string) {
  void api.system.openExternal(url);
}

function Details({ d, f }: { d: FindingDetails; f: FindingView }) {
  return (
    <>
      {d.sections.map((sec) => (
        <section key={sec.title} className="fx-sec">
          <h4>{sec.title}</h4>
          {sec.rows.length ? (
            <dl className="fx-dl">
              {sec.rows.map((r, i) => (
                <div key={i} className="fx-dl-row">
                  <dt>{r.label}</dt>
                  <dd className={r.mono ? 'mono' : ''}>{r.url ? <button className="link-like" onClick={() => openUrl(r.url!)}>{r.value} <Icon name="external" size={11} /></button> : r.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {sec.text ? <pre className="fx-pre" tabIndex={0} aria-label={sec.title}>{sec.text}</pre> : null}
        </section>
      ))}
      <section className="fx-sec">
        <h4>Why it is on the list</h4>
        <p className="small">{d.why}</p>
        {d.confidence ? <p className="small muted">{d.confidence}</p> : null}
        {f.changed ? <p className="small warn-text">You trusted this before; it has changed since (a new program, new permissions or another signer).</p> : null}
      </section>
      <div className="btn-row fx-detail-actions">
        {d.actions.reveal ? <button className="btn sm" onClick={() => void api.guide.reveal(f.id, 'file')}><Icon name="reveal" size={12} /> Show in {FM}</button> : null}
        {d.actions.extensionPage ? <button className="btn sm" onClick={() => void api.guide.reveal(f.id, 'extension')}><Icon name="external" size={12} /> Open in {d.actions.extensionPage}’s extensions page</button> : null}
        {d.learnMore ? <button className="link-like small" onClick={() => openUrl(d.learnMore!.url)}>{d.learnMore.label} <Icon name="external" size={11} /></button> : null}
      </div>
    </>
  );
}

function GuideList() {
  const flows = useHowTo('');
  return <>{flows.map((h) => <button key={h.id} className="guide-flow" onClick={() => openGuide(h.id)}><Icon name={AREA_ICON[h.area as Area] ?? 'sparkle'} size={15} /><span>{h.title}</span><Icon name="chevronRight" size={13} /></button>)}</>;
}
