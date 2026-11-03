// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Crash reports for Ashforde (Settings → Privacy): off until switched on, and
// "See what's sent": the next batch and the last one, field by field and as
// the exact text, with what is never sent. Reuses the usage stats viewer's look.

import { useEffect, useState } from 'react';
import type { CrashReportsStatus } from '../../core/api-crash';
import { CRASH_FIELDS, NEVER_SENT_CRASH, type CrashBody } from '../../core/crash-report';
import { api } from '../api';
import { useStore } from '../state';
import { Icon } from './Icon';
import { Toggle } from './ui';
import '../styles/usage-stats.css';

const when = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function BodyView({ body, testid }: { body: CrashBody; testid: string }) {
  const [raw, setRaw] = useState(false);
  return (
    <div className="ustats-payload" data-testid={testid}>
      {body.reports.map((r, i) => (
        <div key={i} className="ustats-group">
          <div className="ustats-group-name">Report {i + 1} of {body.reports.length}</div>
          {CRASH_FIELDS.map((f) => (
            <div key={f.key} className="ustats-row">
              <code className="ustats-key">{f.key}</code>
              <span className="ustats-val">{Array.isArray(r[f.key]) ? ((r[f.key] as string[]).length ? (r[f.key] as string[]).join('\n') : 'none') : String(r[f.key])}</span>
              <span className="ustats-about small muted">{f.about}</span>
            </div>
          ))}
        </div>
      ))}
      <button className="btn sm ghost" onClick={() => setRaw(!raw)}><Icon name="code" size={12} /> {raw ? 'Hide' : 'Show'} the exact text</button>
      {raw ? <pre className="ustats-json" data-testid={`${testid}-json`}>{JSON.stringify(body, null, 2)}</pre> : null}
    </div>
  );
}

export function CrashReportsPanel() {
  const { toast } = useStore();
  const [s, setS] = useState<CrashReportsStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'next' | 'last'>('next');
  const act = async (p: Promise<CrashReportsStatus>) => { try { setS(await p); } catch (e) { toast(e instanceof Error ? e.message : String(e)); } };
  useEffect(() => {
    void api.crashReports.status().then(setS).catch(() => undefined);
    return api.on('features-changed', () => void api.crashReports.status().then(setS).catch(() => undefined));
  }, []);
  // While the viewer is open it stays current.
  useEffect(() => {
    if (!open) return;
    const load = () => void api.crashReports.status().then(setS).catch(() => undefined);
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [open]);
  if (!s) return <div className="small muted">Loading…</div>;
  return (
    <div className="ustats" data-testid="crash-panel">
      <div className="ustats-switch">
        <div className="grow">
          <div style={{ fontWeight: 550 }}>Send crash reports</div>
          <div className="small muted">{s.locked ? s.offText : 'Only when something goes wrong: Keeper’s version, the kind of computer, and where in Keeper’s code. Never the error’s message, your files or names.'}</div>
        </div>
        {s.locked ? <span className="badge">Off</span> : <Toggle on={s.on} label="Send crash reports" onChange={(v) => void act(api.crashReports.setOn(v))} />}
      </div>
      <p className="trust-line" style={{ margin: '8px 0' }}>Off until you switch it on · Anonymous, no ID · Sent together, at most every 30 minutes · Kept 90 days</p>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button className="btn sm" data-testid="crash-see" aria-expanded={open} onClick={() => setOpen(!open)}><Icon name="eye" size={12} /> {open ? 'Hide what’s sent' : 'See what’s sent'}</button>
        {s.next ? <button className="btn sm ghost" data-testid="crash-clear" onClick={() => void act(api.crashReports.clear()).then(() => toast('Deleted what was waiting'))}><Icon name="trash" size={12} /> Delete what is waiting</button> : null}
      </div>
      {open ? (
        <div className="ustats-viewer" data-testid="crash-viewer">
          <div className="seg" role="tablist">
            <button role="tab" aria-selected={tab === 'next'} className={tab === 'next' ? 'on' : ''} onClick={() => setTab('next')}>Waiting {s.waiting ? <span className="muted">{s.waiting}</span> : null}</button>
            <button role="tab" aria-selected={tab === 'last'} className={tab === 'last' ? 'on' : ''} onClick={() => setTab('last')}>Last sent</button>
          </div>
          {tab === 'next' ? (s.next ? <><div className="small muted">{s.on ? 'Goes with the next send, to ' : 'Nothing is sent while this is off. It would go to '}{s.host}.</div><BodyView body={s.next} testid="crash-next" /></> : <div className="small muted" data-testid="crash-none">Nothing is waiting{s.on ? '. Good news.' : ', and nothing is collected while this is off.'}</div>)
            : s.last ? <><div className="small muted">Sent {when(s.last.at)} to {s.host}.</div><BodyView body={s.last.body} testid="crash-last" /></> : <div className="small muted">Nothing sent yet.</div>}
          <div className="ustats-never">
            <b className="small">Never sent</b>
            <ul className="small muted">{NEVER_SENT_CRASH.map((x) => <li key={x}>{x}</li>)}</ul>
          </div>
        </div>
      ) : null}
    </div>
  );
}
