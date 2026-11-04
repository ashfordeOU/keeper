// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Protection: is the security built into your system switched on and current?

import { useState } from 'react';
import { relativeTime } from '../../core/format';
import type { ProtectionReport } from '../../core/types';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Empty, Loading, PageHead } from '../components/ui';
import { useAsync } from '../state';
import { calmScore, worthLine } from '../../core/attention';
import '../styles/screens-b.css';

const STATUS = {
  ok: { label: 'On', cls: 'ok', color: 'var(--ok)' },
  warn: { label: 'Check', cls: '', color: 'color-mix(in srgb, var(--warn) 45%, var(--bg-sunk))' },
  // Calm: "off" is worth fixing, not an alarm.
  off: { label: 'Off', cls: 'warn', color: 'var(--warn)' },
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

  // What is off comes first, in calm words; the score is a small detail beside it (core/attention.ts).
  const toFix = data?.checks.filter((c) => c.status === 'off' || c.status === 'warn').length ?? 0;
  return (
    <div>
      <PageHead title="Protection" sub="Is your system’s own protection on and up to date?">
        <button className="btn" onClick={recheck} disabled={busy}>{busy ? <div className="spinner" /> : <Icon name="refresh" size={14} />} Check again</button>
      </PageHead>
      {first.loading && !data ? <Loading label="Checking…" /> : null}
      {first.error ? <Empty icon="warning" title="Could not run the check">{first.error}</Empty> : null}
      {data ? (
        <>
          <section className="prot-head" data-testid="prot-attention">
            <h2>{worthLine(toFix)}</h2>
            <div className="small muted">{calmScore(data.score)} · Score <span data-testid="prot-score">{data.score} of 100</span> · Checked {relativeTime(data.checkedAt)}</div>
          </section>
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
        </>
      ) : null}
      <p className="small muted" style={{ marginTop: 16 }}><Icon name="info" size={12} /> Keeper is not an antivirus. It only reads the status of the protection your operating system already has and never changes it.</p>
    </div>
  );
}
