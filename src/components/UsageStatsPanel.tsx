// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Anonymous usage stats: the switch, exactly what is sent (the last report and
// the next one), the install ID and its reset, and the firewall switch for this
// connection. Used in Settings → Privacy, the welcome tour and the firewall.

import { useEffect, useState } from 'react';
import { NEVER_SENT, SCHEMA_GROUPS, USAGE_SCHEMA, type PingBody, type UsagePayload, type UsageStatsStatus } from '../../core/telemetry';
import { api } from '../api';
import { useStore } from '../state';
import { Icon } from './Icon';
import { Toggle } from './ui';
import '../styles/usage-stats.css';

export function useUsageStats(): [UsageStatsStatus | null, (p: Promise<UsageStatsStatus>) => Promise<void>] {
  const [s, setS] = useState<UsageStatsStatus | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => void api.usageStats?.status().then((x) => live && setS(x)).catch(() => undefined);
    load();
    const off = api.on('features-changed', load);
    return () => { live = false; off(); };
  }, []);
  const act = async (p: Promise<UsageStatsStatus>) => { try { setS(await p); } catch { /* shown on the next load */ } };
  return [s, act];
}

const portOf = (u: string) => { try { const x = new URL(u); return x.port || (x.protocol === 'http:' ? '80' : '443'); } catch { return '443'; } };
const when = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function show(v: unknown): string {
  if (Array.isArray(v)) return v.length ? v.join(', ') : 'none';
  if (v && typeof v === 'object') { const e = Object.entries(v); return e.length ? e.map(([k, x]) => `${k} ${x}`).join(', ') : 'none'; }
  return String(v);
}

/** One report, field by field with what each means, and the exact text below. */
function PayloadView({ body, testid }: { body: PingBody; testid: string }) {
  const [raw, setRaw] = useState(false);
  const p: UsagePayload | undefined = body.pings[body.pings.length - 1];
  if (!p) return <div className="small muted">Nothing.</div>;
  const rows = Object.entries(USAGE_SCHEMA).map(([path, spec]) => {
    const [a, b] = path.split('.');
    const v = b ? (p as unknown as Record<string, Record<string, unknown>>)[a][b] : (p as unknown as Record<string, unknown>)[a];
    return { path, a: b ? a : '', v, about: spec.about };
  });
  return (
    <div className="ustats-payload" data-testid={testid}>
      {body.pings.length > 1 ? <div className="small muted">{body.pings.length} days in one go (days that could not be sent earlier). The newest:</div> : null}
      {(['', ...SCHEMA_GROUPS] as string[]).map((g) => (
        <div key={g || 'top'} className="ustats-group">
          {g ? <div className="ustats-group-name">{g}</div> : null}
          {rows.filter((r) => r.a === g).map((r) => (
            <div key={r.path} className="ustats-row">
              <code className="ustats-key">{r.path.split('.').pop()}</code>
              <span className="ustats-val">{show(r.v)}</span>
              <span className="ustats-about small muted">{r.about}</span>
            </div>
          ))}
        </div>
      ))}
      <button className="btn sm ghost" onClick={() => setRaw(!raw)}><Icon name="code" size={12} /> {raw ? 'Hide' : 'Show'} the exact text</button>
      {raw ? <pre className="ustats-json" data-testid={`${testid}-json`}>{JSON.stringify(body, null, 2)}</pre> : null}
    </div>
  );
}

/** "See exactly what's sent": the next report and the last one, side by side on wide screens. */
export function UsageStatsViewer({ s }: { s: UsageStatsStatus }) {
  const [tab, setTab] = useState<'next' | 'last'>('next');
  return (
    <div className="ustats-viewer" data-testid="ustats-viewer">
      <div className="seg" role="tablist">
        <button role="tab" aria-selected={tab === 'next'} className={tab === 'next' ? 'on' : ''} onClick={() => setTab('next')}>Next report</button>
        <button role="tab" aria-selected={tab === 'last'} className={tab === 'last' ? 'on' : ''} onClick={() => setTab('last')}>Last sent</button>
      </div>
      {tab === 'next' ? (
        s.next ? (
          <>
            <div className="small muted">{s.on ? 'Built just now from today’s numbers. It goes once a day, when your computer is idle and online.' : 'Built just now so you can see it. Nothing is sent while this is off.'}</div>
            <PayloadView body={s.next} testid="ustats-next" />
          </>
        ) : <div className="small muted">Not available right now.</div>
      ) : s.last ? (
        <>
          <div className="small muted">Sent {when(s.last.at)} to {s.host}.</div>
          <PayloadView body={s.last.body} testid="ustats-last" />
        </>
      ) : <div className="small muted" data-testid="ustats-last-none">Nothing sent yet.</div>}
      <div className="ustats-never">
        <b className="small">Never sent</b>
        <ul className="small muted">{NEVER_SENT.map((x) => <li key={x}>{x}</li>)}</ul>
      </div>
    </div>
  );
}

/** The switch, with the off reason when the computer decides. */
export function UsageStatsSwitch({ s, act, compact }: { s: UsageStatsStatus; act: (p: Promise<UsageStatsStatus>) => Promise<void>; compact?: boolean }) {
  return (
    <div className={`ustats-switch ${compact ? 'compact' : ''}`}>
      <div className="grow">
        <div style={{ fontWeight: 550 }}>Share anonymous usage stats</div>
        <div className="small muted">
          {s.locked ? s.offText : 'Once a day: Keeper’s version, the kind of computer, which features and pages you use, and crash counts. No files, searches or names.'}
        </div>
      </div>
      {s.locked ? <span className="badge" data-testid="ustats-locked">Off</span> : <Toggle on={s.switchOn} label="Share anonymous usage stats" onChange={(v) => void act(api.usageStats.setOn(v))} />}
    </div>
  );
}

/** Settings → Privacy. */
export function UsageStatsPanel() {
  const { toast } = useStore();
  const [s, act] = useUsageStats();
  const [open, setOpen] = useState(false);
  if (!s) return <div className="small muted">Loading…</div>;
  return (
    <div className="ustats" data-testid="ustats-panel">
      <UsageStatsSwitch s={s} act={act} />
      <p className="small muted" style={{ margin: '8px 0' }}>
        This helps Ashforde see how many copies of Keeper are in use, on what kinds of computers, and which features matter, so the next versions get better.
        It is anonymous by design and stays off once you switch it off: nothing more is sent, not even a goodbye.
      </p>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button className="btn sm" data-testid="ustats-see" aria-expanded={open} onClick={() => setOpen(!open)}><Icon name="eye" size={12} /> {open ? 'Hide what’s sent' : 'See exactly what’s sent'}</button>
        <button className="btn sm ghost" data-testid="ustats-reset" onClick={() => void act(api.usageStats.resetId()).then(() => toast('You have a new anonymous ID'))}><Icon name="refresh" size={12} /> Reset my anonymous ID</button>
      </div>
      {open ? <UsageStatsViewer s={s} /> : null}
      <div className="ustats-facts small">
        <div><span className="muted">Your anonymous ID</span> <code data-testid="ustats-id">{s.installId}</code></div>
        <div><span className="muted">Sent to</span> <code>{s.host}</code> <span className="muted">(HTTPS, at most once a day)</span></div>
        <div><span className="muted">Status</span> <span data-testid="ustats-state">{!s.on ? 'Off' : s.blockedByFirewall ? 'Blocked by your firewall rule' : s.lastAttempt ? s.lastAttempt.result : 'Waiting for the first report'}</span>{s.queued ? <span className="muted"> · {s.queued} day{s.queued === 1 ? '' : 's'} waiting</span> : null}{s.last ? <span className="muted"> · last sent {when(s.last.at)}</span> : null}</div>
      </div>
      <OwnConnectionRow s={s} act={act} />
      <details className="small muted ustats-more">
        <summary>Other ways to switch it off</summary>
        <ul>
          <li>Set <code>KEEPER_TELEMETRY=0</code> in the environment.</li>
          <li>Set <code>DO_NOT_TRACK=1</code> in the environment.</li>
          <li>Administrators: put <code>{'{ "usageStats": false }'}</code> in <code>{s.policyFile}</code>.</li>
        </ul>
      </details>
    </div>
  );
}

/** This connection in Keeper's firewall, like any other app's. */
export function OwnConnectionRow({ s, act }: { s: UsageStatsStatus; act: (p: Promise<UsageStatsStatus>) => Promise<void> }) {
  return (
    <div className="ustats-conn" data-testid="ustats-conn">
      <Icon name="shield" size={14} />
      <div className="grow">
        <div><b>Keeper</b> → {s.host} <span className="muted small">port {portOf(s.endpoint)} · anonymous usage stats</span></div>
        <div className="small muted">{s.blockedByFirewall ? 'Blocked by a rule in Keeper’s firewall.' : 'Allowed. Blocking it in Keeper’s firewall stops it too.'}</div>
      </div>
      <button className="btn sm" data-testid="ustats-block" onClick={() => void act(api.usageStats.setBlocked(!s.blockedByFirewall))}>{s.blockedByFirewall ? 'Allow' : 'Block'}</button>
    </div>
  );
}

/** The firewall's card: Keeper's own connections, listed like any other app's. */
export function KeeperOwnConnections() {
  const [s, act] = useUsageStats();
  if (!s) return null;
  return (
    <section className="card pad">
      <h3>Keeper’s own connections</h3>
      <OwnConnectionRow s={s} act={act} />
      <div className="small muted" style={{ marginTop: 6 }}>Usage stats are {s.on ? 'on' : 'off'}. Change them in Settings → Privacy.</div>
    </section>
  );
}

/** The welcome tour's step: what is sent, the switch, and the viewer. */
export function TourUsageStats() {
  const [s, act] = useUsageStats();
  const [open, setOpen] = useState(false);
  if (!s) return null;
  return (
    <div className="col" style={{ gap: 8 }} data-testid="tour-ustats">
      <UsageStatsSwitch s={s} act={act} compact />
      <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} data-testid="tour-ustats-see" onClick={() => setOpen(!open)}><Icon name="eye" size={12} /> {open ? 'Hide' : 'See exactly what’s sent'}</button>
      {open ? <div className="tour-ustats-scroll"><UsageStatsViewer s={s} /></div> : null}
    </div>
  );
}
