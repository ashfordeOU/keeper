// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Site and server monitors: the list with each one's state and uptime, and the
// selected one's response times, uptime over a day, a week and a month, its
// certificate and its last checks. Add one, or import a plain list.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MonitorDetail, MonitorsOverview, MonitorView } from '../../core/api-monitors';
import { INTERVALS, KIND_LABEL, monitorProblems, parseMonitorList, spanWords, type DnsType, type MonitorKind, type SiteMonitor } from '../../core/site-monitor';
import { relativeTime } from '../../core/format';
import { api } from '../api';
import { Chart } from '../components/Chart';
import { FirstRun, PulseArt } from '../components/FirstRun';
import { Icon } from '../components/Icon';
import { Loading, Modal, PageHead, Toggle } from '../components/ui';
import { useStore } from '../state';
import '../styles/extras.css';
import '../styles/monitors.css';

type Draft = Partial<SiteMonitor> & { kind: MonitorKind; target: string };

const KIND_ICON: Record<MonitorKind, string> = { http: 'globe', tcp: 'plug', ping: 'pulse', dns: 'server' };
const every = (s: number) => (s < 60 ? `${s} seconds` : s < 3600 ? `${s / 60} minute${s === 60 ? '' : 's'}` : 'hour');
const pct = (v?: number) => (v === undefined ? '—' : `${v >= 99.995 ? '100' : v.toFixed(v >= 99 ? 2 : 1)}%`);
const target = (m: SiteMonitor) => (m.kind === 'http' ? m.target.replace(/^https?:\/\//, '').replace(/\/$/, '') : m.kind === 'tcp' ? `${m.target} port ${m.port}` : m.kind === 'dns' ? `${m.target} · ${m.dnsType ?? 'A'}` : m.target);

function stateWords(m: MonitorView, now = Date.now()): string {
  if (m.rt.state === 'paused') return 'Paused';
  if (m.rt.state === 'pending') return m.rt.last ? (m.rt.last.ok ? 'Up' : 'Checking again…') : 'First check…';
  return `${m.rt.state === 'up' ? 'Up' : 'Down'} for ${spanWords(now - m.rt.since)}`;
}
const dotOf = (m: MonitorView) => (m.rt.state === 'up' ? 'up' : m.rt.state === 'down' ? 'down' : m.rt.state === 'paused' ? 'paused' : 'warn');

export function Monitors() {
  const { toast } = useStore();
  const [ov, setOv] = useState<MonitorsOverview | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [detail, setDetail] = useState<MonitorDetail | null>(null);
  const [filter, setFilter] = useState<'all' | 'down'>('all');
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<Draft | null>(null);
  const [importing, setImporting] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);

  const load = useCallback(async () => {
    const o = await api.monitors.overview();
    setOv(o);
    setSel((s) => (s && o.monitors.some((m) => m.id === s) ? s : o.monitors.find((m) => m.rt.state === 'down')?.id ?? o.monitors[0]?.id ?? null));
  }, []);
  useEffect(() => {
    void load();
    return api.on('monitors-changed', () => void load());
  }, [load]);
  useEffect(() => {
    if (!sel) { setDetail(null); return; }
    let live = true;
    void api.monitors.detail(sel).then((d) => live && setDetail(d)).catch(() => undefined);
    return () => { live = false; };
  }, [sel, ov]);
  // The "for 12 min" words stay current.
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);

  const shown = useMemo(() => (ov?.monitors ?? []).filter((m) => (filter === 'all' || m.rt.state === 'down') && (!q.trim() || `${m.name} ${m.target}`.toLowerCase().includes(q.trim().toLowerCase()))), [ov, filter, q]);
  const fail = (e: unknown) => toast(e instanceof Error ? e.message : String(e));

  if (!ov) return <div className="page"><PageHead title="Monitors" /><Loading /></div>;
  const newDraft = (): Draft => ({ kind: 'http', target: 'https://', interval: 300, timeout: 10, tlsDays: 14, alerts: true, on: true });
  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const i = shown.findIndex((m) => m.id === sel);
    const next = shown[Math.max(0, Math.min(shown.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (next) { setSel(next.id); listRef.current?.querySelector<HTMLButtonElement>(`[data-id="${next.id}"]`)?.focus(); }
  };
  const m = detail?.monitor;
  const total = ov.monitors.length;

  return (
    <div className="page mo-page" data-testid="monitors-page">
      <PageHead title="Monitors" sub="Your sites and servers, checked on a schedule. You hear when one goes down.">
        {total ? <button className="btn ghost" onClick={() => setImporting(true)} data-testid="mo-import"><Icon name="down" size={14} /> Import</button> : null}
        {total ? <button className="btn primary" onClick={() => setEdit(newDraft())} data-testid="mo-add"><Icon name="plus" size={14} /> Add a monitor</button> : null}
      </PageHead>

      {!total ? (
        <FirstRun testid="mo-first" kicker="Monitors" title="Know first when a site goes down" mark="first"
          line="Keeper checks your websites, servers and ports on a schedule, keeps their uptime and response times, and tells you the moment one stops answering."
          art={<PulseArt />}
          action={<button className="btn primary" onClick={() => setEdit(newDraft())} data-testid="mo-add"><Icon name="plus" size={14} /> Add a monitor</button>}
          more={<button className="btn ghost" onClick={() => setImporting(true)} data-testid="mo-import"><Icon name="down" size={14} /> Import a list</button>}
          trust={['Runs on this computer', 'Only the addresses you add', 'Alerts to the Island and your phone']} />
      ) : (
        <>
          <div className="mo-bar">
            <div className="capsule" role="group" aria-label="Show">
              <div className="seg">
                <button className={filter === 'all' ? 'on' : ''} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All <span className="muted">{total}</span></button>
                <button className={filter === 'down' ? 'on' : ''} aria-pressed={filter === 'down'} onClick={() => setFilter('down')} data-testid="mo-filter-down">Down <span className="muted">{ov.counts.down}</span></button>
              </div>
              <input className="input" placeholder="Search" aria-label="Search monitors" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <p className="trust-line" data-testid="mo-summary">{ov.counts.up} up{ov.counts.down ? ` · ${ov.counts.down} down` : ''}{ov.counts.paused ? ` · ${ov.counts.paused} paused` : ''}{ov.counts.pending ? ` · ${ov.counts.pending} checking` : ''} · Checked from this computer</p>
          </div>
          <div className="mo-layout">
            <ul className="mo-list" ref={listRef} onKeyDown={onListKey} aria-label="Monitors" data-testid="mo-list">
              {shown.map((x) => (
                <li key={x.id}>
                  <button className={`mo-row${x.id === sel ? ' on' : ''}`} data-id={x.id} aria-current={x.id === sel ? 'true' : undefined} onClick={() => setSel(x.id)} data-testid="mo-row">
                    <span className={`sdot ${dotOf(x)}`} aria-hidden />
                    <span className="mo-row-text">
                      <span className="mo-row-name">{x.name}</span>
                      <span className="muted small">{x.rt.state === 'down' && x.rt.last?.message ? x.rt.last.message : x.rt.last?.unsupported ? `Paused · ${x.rt.last.message}` : stateWords(x, now)}</span>
                    </span>
                    <span className="mo-row-num">
                      <b className="num">{pct(x.uptime24)}</b>
                      <span className="muted small num">{x.rt.last?.ms !== undefined && x.rt.last.ok ? `${x.rt.last.ms} ms` : ''}</span>
                    </span>
                  </button>
                </li>
              ))}
              {!shown.length ? <li className="mo-none muted small">{filter === 'down' ? 'Nothing is down.' : 'No monitor matches.'}</li> : null}
            </ul>

            {m && detail ? (
              <section className="xpanel mo-detail" aria-label={m.name} data-testid="mo-detail">
                <div className="mo-head">
                  <div className={`mo-badge ${dotOf(m)}`} aria-hidden><Icon name={KIND_ICON[m.kind]} size={20} /></div>
                  <div className="mo-head-text">
                    <h2>{m.name}</h2>
                    <div className="muted small">{KIND_LABEL[m.kind]} · {target(m)} · every {every(m.interval)}</div>
                  </div>
                  <div className="mo-head-ctl">
                    <button className="btn sm" disabled={m.checking || !m.on} onClick={() => void api.monitors.checkNow(m.id).catch(fail)} data-testid="mo-check">{m.checking ? 'Checking…' : 'Check now'}</button>
                    <button className="btn sm ghost icon" title="Change this monitor" aria-label="Change this monitor" onClick={() => setEdit({ ...m })} data-testid="mo-edit"><Icon name="settings" size={14} /></button>
                    <Toggle on={m.on} label={m.on ? 'Checking' : 'Paused'} onChange={(on) => void api.monitors.setOn(m.id, on).then(setOv, fail)} />
                  </div>
                </div>
                <div className={`mo-state ${dotOf(m)}`} role="status" data-testid="mo-state">
                  <span className={`sdot ${dotOf(m)}`} aria-hidden />
                  <b>{stateWords(m, now)}</b>
                  {m.rt.last ? <span className="muted small">Last check {relativeTime(m.rt.last.at)}{m.rt.last.ok ? (m.rt.last.message ? ` · ${m.rt.last.message}` : '') : ` · ${m.rt.last.message ?? 'failed'}`}</span> : null}
                </div>
                <div className="mo-tiles">
                  <Tile label="Today" value={pct(m.uptime24)} note="uptime" />
                  <Tile label="7 days" value={pct(m.uptime7)} note="uptime" />
                  <Tile label="30 days" value={pct(m.uptime30)} note="uptime" />
                  <Tile label="Typical" value={m.typicalMs !== undefined ? `${m.typicalMs} ms` : '—'} note="response" />
                  {m.kind === 'http' && m.target.startsWith('https:') ? <Tile label="Certificate" value={m.rt.last?.tlsDays !== undefined ? `${m.rt.last.tlsDays} days` : '—'} note="until it expires" warn={m.rt.last?.tlsDays !== undefined && m.rt.last.tlsDays <= m.tlsDays} /> : null}
                </div>
                <div className="mo-chart" data-testid="mo-chart">
                  <div className="xkicker">Response time, last 24 hours</div>
                  {detail.series.some((s) => s.ms !== null) ? (
                    <Chart height={150} labels={detail.series.map((s) => new Date(s.t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))}
                      series={[{ label: 'Response', color: 'var(--accent)', values: detail.series.map((s) => s.ms), format: (v) => `${Math.round(v)} ms` }]} min={0} yFormat={(v) => `${Math.round(v)} ms`} />
                  ) : <p className="muted small">The chart fills in as checks come in.</p>}
                  <div className="mo-strip" aria-label="Up and down over the last 24 hours">
                    {detail.series.map((s, i) => <i key={i} className={s.ok === null ? '' : s.ok ? 'up' : 'down'} title={`${new Date(s.t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}: ${s.ok === null ? 'no checks' : s.ok ? 'up' : 'down'}`} />)}
                  </div>
                </div>
                <details className="mo-recent">
                  <summary><b>Recent checks</b> <span className="muted small">{detail.recent.length}</span></summary>
                  <ul>
                    {detail.recent.map((r, i) => (
                      <li key={i}><span className={`sdot ${r.ok ? 'up' : 'down'}`} aria-hidden /> <span className="num">{new Date(r.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span> <span className="grow">{r.ok ? (r.message ?? (r.status ? `Answered ${r.status}` : 'Answered')) : r.message}</span> <span className="muted num">{r.ms !== undefined ? `${r.ms} ms` : ''}</span></li>
                    ))}
                  </ul>
                </details>
              </section>
            ) : <div className="xpanel mo-detail mo-empty muted">Choose a monitor to see its history.</div>}
          </div>
        </>
      )}

      {edit ? <MonitorSheet start={edit} onClose={() => setEdit(null)} onSaved={(v) => { setEdit(null); setSel(v.id); toast(edit.id ? 'Saved' : `Watching ${v.name}`); }} onRemoved={() => { setEdit(null); setSel(null); toast('Removed'); }} /> : null}
      {importing ? <ImportSheet onClose={() => setImporting(false)} onDone={(r) => { setImporting(false); toast(`${r.added} monitor${r.added === 1 ? '' : 's'} added${r.skipped.length ? `, ${r.skipped.length} skipped` : ''}`); }} /> : null}
    </div>
  );
}

function Tile({ label, value, note, warn }: { label: string; value: string; note: string; warn?: boolean }) {
  return (
    <div className={`mo-tile${warn ? ' warn' : ''}`}>
      <span className="xkicker">{label}</span>
      <b className="num">{value}</b>
      <span className="muted small">{note}</span>
    </div>
  );
}

function MonitorSheet({ start, onClose, onSaved, onRemoved }: { start: Draft; onClose: () => void; onSaved: (v: MonitorView) => void; onRemoved: () => void }) {
  const [d, setD] = useState<Draft>(start);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const problems = monitorProblems(d);
  const set = (p: Partial<Draft>) => { setD({ ...d, ...p }); setErr(''); };
  const setKind = (kind: MonitorKind) => set({ kind, target: kind === 'http' ? (d.target.startsWith('http') ? d.target : `https://${d.target}`) : d.target.replace(/^https?:\/\//, '').replace(/\/.*$/, ''), port: kind === 'tcp' ? d.port ?? 443 : undefined });
  const save = async () => {
    setBusy(true);
    try { onSaved(await api.monitors.save(d)); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const isNew = !start.id;
  return (
    <Modal title={isNew ? 'Add a monitor' : `Change ${start.name}`} onClose={onClose} width={540}>
      <div className="xform" data-testid="mo-sheet">
        <div className="seg" role="radiogroup" aria-label="What to check">
          {(Object.keys(KIND_LABEL) as MonitorKind[]).map((k) => (
            <button key={k} role="radio" aria-checked={d.kind === k} className={d.kind === k ? 'on' : ''} onClick={() => setKind(k)} data-testid={`mo-kind-${k}`}><Icon name={KIND_ICON[k]} size={13} /> {KIND_LABEL[k]}</button>
          ))}
        </div>
        {d.kind === 'tcp' ? (
          <div className="xform-row">
            <label>Host<input className="input" value={d.target} onChange={(e) => set({ target: e.target.value })} placeholder="example.com" data-testid="mo-target" autoFocus /></label>
            <label>Port<input className="input" type="number" min={1} max={65535} value={d.port ?? ''} onChange={(e) => set({ port: Number(e.target.value) || undefined })} data-testid="mo-port" /></label>
          </div>
        ) : (
          <label>{d.kind === 'http' ? 'Address' : 'Host'}<input className="input" value={d.target} onChange={(e) => set({ target: e.target.value })} placeholder={d.kind === 'http' ? 'https://example.com' : 'example.com'} data-testid="mo-target" autoFocus /></label>
        )}
        <div className="xform-row">
          <label>Name<input className="input" value={d.name ?? ''} onChange={(e) => set({ name: e.target.value })} placeholder="Shown in alerts" data-testid="mo-name" /></label>
          <label>Check every
            <select className="input" value={d.interval ?? 300} onChange={(e) => set({ interval: Number(e.target.value) })} data-testid="mo-interval">
              {INTERVALS.map((s) => <option key={s} value={s}>{every(s)}</option>)}
            </select>
          </label>
        </div>
        <label className="mo-inline"><Toggle on={d.alerts !== false} onChange={(v) => set({ alerts: v })} label="Tell me when it goes down" /> Tell me when it goes down or comes back</label>
        <details className="xmore">
          <summary>More settings</summary>
          <div className="xform">
            {d.kind === 'http' ? (
              <>
                <div className="xform-row">
                  <label>A word on the page<input className="input" value={d.keyword ?? ''} onChange={(e) => set({ keyword: e.target.value || undefined })} placeholder="Optional" data-testid="mo-keyword" /></label>
                  <label>Up when it answers<input className="input" value={d.expect ?? ''} onChange={(e) => set({ expect: e.target.value || undefined })} placeholder="200-399" /></label>
                </div>
                {d.keyword ? <label className="mo-inline"><input type="checkbox" checked={!!d.keywordAbsent} onChange={(e) => set({ keywordAbsent: e.target.checked })} /> Down when the word is there (an error message)</label> : null}
                <label>Warn before the certificate expires
                  <select className="input" value={d.tlsDays ?? 14} onChange={(e) => set({ tlsDays: Number(e.target.value) })}>
                    <option value={0}>Never</option><option value={7}>A week before</option><option value={14}>Two weeks before</option><option value={30}>A month before</option>
                  </select>
                </label>
              </>
            ) : null}
            {d.kind === 'dns' ? (
              <div className="xform-row">
                <label>Record
                  <select className="input" value={d.dnsType ?? 'A'} onChange={(e) => set({ dnsType: e.target.value as DnsType })}>
                    {['A', 'AAAA', 'CNAME', 'MX', 'TXT'].map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </label>
                <label>The answer includes<input className="input" value={d.dnsExpect ?? ''} onChange={(e) => set({ dnsExpect: e.target.value || undefined })} placeholder="Optional, e.g. 93.184.216.34" /></label>
              </div>
            ) : null}
            <label>Give up after
              <select className="input" value={d.timeout ?? 10} onChange={(e) => set({ timeout: Number(e.target.value) })}>
                {[5, 10, 20, 30].map((s) => <option key={s} value={s}>{s} seconds</option>)}
              </select>
            </label>
          </div>
        </details>
        {err ? <p className="xform-err" role="alert">{err}</p> : null}
        <div className="xform-foot">
          {!isNew ? <button className="btn ghost danger" onClick={() => { if (confirm(`Remove ${start.name}? Its history goes too.`)) void api.monitors.remove(start.id!).then(onRemoved); }} data-testid="mo-remove">Remove</button> : null}
          <span className="grow" />
          {problems.length ? <span className="xform-note">{problems[0]}</span> : null}
          <button className="btn primary" disabled={busy || !!problems.length} onClick={() => void save()} data-testid="mo-save">{busy ? 'Saving…' : isNew ? 'Start watching' : 'Save'}</button>
        </div>
      </div>
    </Modal>
  );
}

const EXAMPLE = `https://example.com
Shop, https://shop.example.com
tcp mail.example.com:993
ping 192.168.1.1
dns example.com MX`;

function ImportSheet({ onClose, onDone }: { onClose: () => void; onDone: (r: { added: number; skipped: string[] }) => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const preview = useMemo(() => parseMonitorList(text), [text]);
  return (
    <Modal title="Import monitors" onClose={onClose} width={560}>
      <div className="xform" data-testid="mo-import-sheet">
        <label>One per line: an address, a host and port, ping or dns
          <textarea className="input mono" rows={7} value={text} onChange={(e) => setText(e.target.value)} placeholder={EXAMPLE} data-testid="mo-import-text" />
        </label>
        <p className="xform-note" role="status">{text.trim() ? `${preview.monitors.length} to add${preview.skipped.length ? ` · ${preview.skipped.length} not understood: ${preview.skipped.slice(0, 2).join(', ')}` : ''}` : 'Paste a list from a spreadsheet or another tool. Websites are checked every 5 minutes.'}</p>
        <div className="xform-foot">
          <button className="btn ghost" onClick={() => void api.monitors.exportList().then((t) => { void api.files.copyText(t); })}>Copy my list</button>
          <span className="grow" />
          <button className="btn primary" disabled={busy || !preview.monitors.length} onClick={() => { setBusy(true); void api.monitors.importList(text).then(onDone).finally(() => setBusy(false)); }} data-testid="mo-import-go">Import {preview.monitors.length || ''}</button>
        </div>
      </div>
    </Modal>
  );
}
