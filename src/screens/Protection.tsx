// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Protection: is the security built into your system switched on and current?

import { useState } from 'react';
import { relativeTime } from '../../core/format';
import type { ProtectionReport } from '../../core/types';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Empty, Loading, PageHead } from '../components/ui';
import { useAsync } from '../state';
import '../styles/screens-b.css';

const STATUS = {
  ok: { label: 'On', cls: 'ok', color: 'var(--ok)' },
  warn: { label: 'Check', cls: 'warn', color: 'var(--warn)' },
  off: { label: 'Off', cls: 'danger', color: 'var(--danger)' },
  unknown: { label: 'Unknown', cls: '', color: 'var(--text-3)' },
} as const;

export function Ring({ value, size = 140, stroke = 12, color, label, sub }: { value: number; size?: number; stroke?: number; color?: string; label: string; sub?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--bg-sunk)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color ?? 'var(--accent)'} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${(v / 100) * c} ${c}`} style={{ transition: 'stroke-dasharray .6s var(--ease)' }} />
      </svg>
      <div className="lbl"><b>{label}</b>{sub ? <span className="small muted">{sub}</span> : null}</div>
    </div>
  );
}

export function Protection() {
  const first = useAsync(() => api.protection.check(), []);
  const [report, setReport] = useState<ProtectionReport | null>(null);
  const [busy, setBusy] = useState(false);
  const data = report ?? first.data;

  const recheck = async () => {
    setBusy(true);
    try {
      setReport(await api.protection.check());
    } finally {
      setBusy(false);
    }
  };

  const color = !data ? undefined : data.score >= 85 ? 'var(--ok)' : data.score >= 60 ? 'var(--warn)' : 'var(--danger)';
  return (
    <div>
      <PageHead title="Protection" sub="A quick check that the protection built into your system is switched on and up to date.">
        <button className="btn" onClick={recheck} disabled={busy}>{busy ? <div className="spinner" /> : <Icon name="refresh" size={14} />} Check again</button>
      </PageHead>
      {first.loading && !data ? <Loading label="Checking…" /> : null}
      {first.error ? <Empty icon="warning" title="Could not run the check">{first.error}</Empty> : null}
      {data ? (
        <div className="grid" style={{ gridTemplateColumns: 'minmax(220px, 260px) 1fr', alignItems: 'start' }}>
          <div className="card pad col" style={{ alignItems: 'center', gap: 10 }}>
            <Ring value={data.score} color={color} label={String(data.score)} sub="of 100" />
            <div style={{ fontWeight: 600 }}>{data.score >= 85 ? 'Well protected' : data.score >= 60 ? 'A few things to check' : 'Needs attention'}</div>
            <div className="small muted">Checked {relativeTime(data.checkedAt)}</div>
          </div>
          <div className="card">
            {data.checks.map((c) => (
              <div key={c.id} className="check-row">
                <span className="status-dot" style={{ background: STATUS[c.status].color }} />
                <div className="grow">
                  <div className="row"><b>{c.name}</b><span className={`badge ${STATUS[c.status].cls}`}>{STATUS[c.status].label}</span></div>
                  <div className="small muted">{c.description}</div>
                  {c.detail ? <div className="small">{c.detail}</div> : null}
                  {c.fix && c.status !== 'ok' ? <div className="small" style={{ color: 'var(--accent)', marginTop: 2 }}>How to fix: {c.fix}</div> : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <p className="small muted" style={{ marginTop: 16 }}><Icon name="info" size={12} /> Keeper is not an antivirus. It only reads the status of the protection your operating system already has and never changes it.</p>
    </div>
  );
}
