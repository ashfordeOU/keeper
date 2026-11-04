// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Settings → Battery and speed → What each part uses: measured now, against
// its budget (core/perf-budgets.ts), with Turn off for parts that can be. Read
// every few seconds only while shown.

import { useEffect, useState } from 'react';
import type { KeeperProcess } from '../../core/api-session';
import { budgetLine, costLine, partCosts, usingLine } from '../../core/perf-budgets';
import { api } from '../api';
import { useStore } from '../state';
import '../styles/parts-cost.css';

/** Keeper's processes, read every 3 s while the page is visible. */
export function useKeeperProcesses(): KeeperProcess[] | null {
  const [list, setList] = useState<KeeperProcess[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => { if (document.visibilityState === 'visible') void api.svc.list().then((l) => alive && setList(l), () => undefined); };
    load();
    const t = window.setInterval(load, 3000);
    return () => { alive = false; window.clearInterval(t); };
  }, []);
  return list;
}

export function PartsCostPanel() {
  const { toast, go } = useStore();
  const list = useKeeperProcesses();
  const [all, setAll] = useState(false);
  if (!list) return <div className="small muted">Measuring…</div>;
  const costs = partCosts(list);
  const shown = all ? costs : costs.slice(0, 6);
  return (
    <div className="pcost" data-testid="parts-cost">
      <div className="pcost-head">
        <div className="pcost-total" data-testid="parts-cost-total">{usingLine(list)}</div>
        <div className="small muted">Measured now · Each part has a budget · Off parts use nothing</div>
      </div>
      <div className="pcost-list" role="table" aria-label="What each part uses">
        {shown.map((c) => (
          <div key={c.id} className={`pcost-row${c.over ? ' over' : ''}`} role="row">
            <span className="grow pcost-name" role="cell">{c.label}</span>
            <span className="pcost-num" role="cell">{costLine(c)}</span>
            <span className={`pcost-budget small ${c.over ? 'warn-text' : 'muted'}`} role="cell">{budgetLine(c)}</span>
            <span className="pcost-act" role="cell">
              {c.feature ? <button className="btn sm ghost" onClick={() => void api.features.set(c.feature!, false).then(() => toast(`${c.label} turned off`))}>Turn off</button> : null}
            </span>
          </div>
        ))}
      </div>
      <div className="btn-row pcost-foot">
        {costs.length > 6 ? <button className="btn sm ghost" onClick={() => setAll(!all)}>{all ? 'Fewer' : `All ${costs.length}`}</button> : null}
        <button className="btn sm ghost" onClick={() => go({ name: 'health', arg: 'keeper' })}>Restart or stop a part</button>
      </div>
    </div>
  );
}

/** One line for About: "Keeper is using 410 MB", with the breakdown one click away. */
export function UsingLine() {
  const list = useKeeperProcesses();
  const { go } = useStore();
  if (!list) return null;
  return <button className="link-like" data-testid="about-using" onClick={() => go({ name: 'settings', arg: 'battery' })}>{usingLine(list)}</button>;
}
