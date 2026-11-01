// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// System → Keeper's processes: every part of Keeper that runs, what it uses,
// whether it has restarted, and Stop / Restart / Disable for each; "Stop all
// background work now"; safe mode; and the problems Keeper noted (kept on this
// computer, never sent anywhere).

import { useEffect, useState } from 'react';
import type { KeeperProcess, LimitsStatus, SessionLog } from '../../core/api-session';
import { formatBytes, relativeTime } from '../../core/format';
import { api } from '../api';
import { useStore } from '../state';
import { Icon } from './Icon';
import '../styles/processes.css';

const KIND: Record<KeeperProcess['kind'], string> = { main: 'Main', window: 'Window', gpu: 'Graphics', service: 'Service', helper: 'Helper', utility: 'Helper', other: 'Other' };

export function ProcessesPanel() {
  const { toast } = useStore();
  const [list, setList] = useState<KeeperProcess[] | null>(null);
  const [held, setHeld] = useState(0);
  const [log, setLog] = useState<SessionLog | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [limits, setLimits] = useState<LimitsStatus | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => {
      // Read only while this page is open and visible.
      if (document.visibilityState !== 'visible') return;
      void api.svc.list().then((l) => alive && setList(l)).catch(() => undefined);
      void api.svc.held().then((h) => alive && setHeld(h)).catch(() => undefined);
      void api.svc.limits?.().then((l) => alive && setLimits(l)).catch(() => undefined);
    };
    load();
    void api.session.log().then((l) => alive && setLog(l)).catch(() => undefined);
    const t = window.setInterval(load, 3000);
    const off = api.on('svc-changed' as 'navigate', load as never);
    return () => { alive = false; window.clearInterval(t); off(); };
  }, []);

  const act = async (id: string, what: 'stop' | 'restart') => {
    setBusy(id + what);
    try {
      setList(await api.svc[what](id));
    } finally {
      setBusy(null);
    }
  };

  const totalCpu = (list ?? []).reduce((a, p) => a + p.cpu, 0);
  const totalMem = (list ?? []).reduce((a, p) => a + p.memory, 0);

  return (
    <div className="kproc-panel">
      <div className="kproc-head">
        <div className="grow">
          <div style={{ fontWeight: 650 }}>{list ? `${list.length} processes · ${totalCpu.toFixed(1)}% of a core · ${formatBytes(totalMem)}` : 'Reading…'}</div>
          <div className="small muted">Parts that can fail on their own run in their own process: if one stops, the rest of Keeper carries on and it starts again. Terminals keep running even when Keeper’s windows close.</div>
        </div>
        {held ? (
          <button className="btn primary" onClick={() => void api.svc.stopAllWork(true).then(() => { setHeld(0); toast('Background work resumed'); })}><Icon name="play" size={13} /> Resume background work</button>
        ) : (
          <button className="btn danger" title="Indexing, reading text, meaning search, sync, backups and regular checks stop for an hour or until you resume" onClick={() => void api.svc.stopAllWork().then((r) => { setHeld(r.heldUntil); toast(`Stopped: ${r.stopped.join(', ')}`); })}><Icon name="pause" size={13} /> Stop all background work</button>
        )}
      </div>
      {held ? <div className="kproc-held small"><Icon name="pause" size={12} /> Background work is stopped until {new Date(held).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} or until you resume it.</div> : null}

      <div className="kproc-table" role="table">
        {(list ?? []).map((p) => (
          <div key={p.id} className={`kproc-row state-${p.state}`} role="row">
            <span className={`kproc-dot ${p.state}`} title={p.state} />
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="kproc-name">{p.label} <span className="kproc-kind">{KIND[p.kind]}</span>{p.restarts ? <span className="kproc-kind warn">restarted {p.restarts}×</span> : null}</div>
              <div className="small muted ellipsis">{p.detail}{p.lastCrash ? ` · last stopped ${relativeTime(p.lastCrash.at)}: ${p.lastCrash.reason}` : ''}</div>
            </div>
            <span className="kproc-num">{p.pid ? `${p.cpu.toFixed(1)}%` : '—'}</span>
            <span className="kproc-num">{p.pid ? formatBytes(p.memory) : '—'}</span>
            <span className="kproc-num muted small">{p.startedAt && p.pid ? relativeTime(p.startedAt) : p.pid ? '' : 'not running'}</span>
            <span className="kproc-actions">
              {p.canStop ? <button className="btn sm" disabled={!!busy} onClick={() => void act(p.id, 'stop')}>Stop</button> : null}
              {p.canRestart ? <button className="btn sm" disabled={!!busy} onClick={() => void act(p.id, 'restart')}>{p.id === 'main' ? 'Restart Keeper' : p.kind === 'window' ? 'Reload' : 'Restart'}</button> : null}
              {p.feature ? <button className="btn sm ghost" title="Switch this feature off (Settings → Features)" onClick={() => void api.features.set(p.feature!, false).then(() => toast(`${p.label} switched off`))}>Disable</button> : null}
            </span>
          </div>
        ))}
      </div>

      {limits ? (
        <div className="kproc-limits small" data-testid="kproc-limits">
          <div><b>Keeper’s own limits</b> · checked every 15 s</div>
          <div className="muted">
            Processor: if all of Keeper stays above {limits.limits.cpuCeiling}% of a core for {Math.round(limits.limits.cpuSustainMs / 60_000)} min while you are not using it, background work pauses for {Math.round(limits.limits.cpuHoldMs / 60_000)} min and the Island says what paused.
            {' '}Memory: a service past {formatBytes(limits.limits.hostMemory)} restarts, a hidden window past {formatBytes(limits.limits.hiddenWindowMemory)} reloads (tabs kept), a helper past {formatBytes(limits.limits.helperMemory)} stops.
            {' '}At most {limits.limits.maxHelpers} helper programs at once ({limits.helpers} now). Now: {limits.cpu}%{limits.overSince ? `, above the ceiling since ${relativeTime(limits.overSince)}` : ''}.
          </div>
          {limits.events.length ? limits.events.slice(0, 5).map((e, i) => <div key={i}><span className="muted">{relativeTime(e.at)}</span> · {e.what}</div>) : <div className="muted">Keeper has not needed to step back.</div>}
        </div>
      ) : null}

      <div className="kproc-foot">
        <button className="btn" onClick={() => void api.session.relaunch(true)} title="Starts Keeper with only the library on; nothing is changed or deleted"><Icon name="shield" size={13} /> Restart in safe mode</button>
        <button className="btn ghost" onClick={() => void api.session.report().then((r) => { void navigator.clipboard.writeText(r); toast('Report copied'); })}><Icon name="copy" size={13} /> Copy report</button>
        {log?.dumps.length ? <button className="btn ghost" onClick={() => void api.session.openDumps()}><Icon name="reveal" size={13} /> Crash reports ({log.dumps.length})</button> : null}
      </div>

      <details className="kproc-log">
        <summary>Problems Keeper noted {log ? `(${log.log.length})` : ''}</summary>
        {log?.log.length ? log.log.slice(0, 40).map((e, i) => (
          <div key={i} className="small"><span className="muted">{relativeTime(e.at)}</span> · <b>{e.kind.replace(/-/g, ' ')}</b> · {e.detail}</div>
        )) : <div className="small muted">Nothing so far. Crash reports and this log stay on this computer.</div>}
      </details>
    </div>
  );
}
