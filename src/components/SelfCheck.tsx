// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Check Keeper and Make a problem report (Settings → About, the palette). The
// check shows a green or amber row per part, each amber one with a Fix. The
// report shows every file it will hold, already cleaned of names, folders,
// addresses and tokens, before it is saved; nothing is sent.

import { useEffect, useState } from 'react';
import type { CheckRow, ReportFile } from '../../core/selfcheck';
import { checkSummary } from '../../core/selfcheck';
import { errorText } from '../../core/ipc-error';
import { api } from '../api';
import { useStore, type RouteName } from '../state';
import { Icon } from './Icon';
import { Modal } from './ui';
import '../styles/attention.css';

type View = 'check' | 'report';

/** Opens Check Keeper (or the problem report) from anywhere. */
export function openSelfCheck(view: View = 'check') {
  window.dispatchEvent(new CustomEvent('keeper-selfcheck', { detail: view }));
}

/** Mounted once in the main window: listens for openSelfCheck(). */
export function SelfCheckHost() {
  const [view, setView] = useState<View | null>(null);
  useEffect(() => {
    const open = (e: Event) => setView(((e as CustomEvent).detail as View) ?? 'check');
    window.addEventListener('keeper-selfcheck', open);
    return () => window.removeEventListener('keeper-selfcheck', open);
  }, []);
  if (!view) return null;
  return <SelfCheckSheet view={view} setView={setView} onClose={() => setView(null)} />;
}

function SelfCheckSheet({ view, setView, onClose }: { view: View; setView: (v: View) => void; onClose: () => void }) {
  return (
    <Modal sheet title={view === 'check' ? 'Check Keeper' : 'Problem report'} onClose={onClose} testId="selfcheck-sheet">
      {view === 'check' ? <Check onReport={() => setView('report')} onClose={onClose} /> : <Report onBack={() => setView('check')} />}
    </Modal>
  );
}

function Check({ onReport, onClose }: { onReport: () => void; onClose: () => void }) {
  const { go, toast } = useStore();
  const [rows, setRows] = useState<CheckRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const run = () => { setRows(null); void api.selfCheck.run().then((r) => setRows(r.rows)).catch((e) => { toast(errorText(e)); setRows([]); }); };
  useEffect(run, []); // eslint-disable-line react-hooks/exhaustive-deps
  const fix = async (r: CheckRow) => {
    const f = r.fix!;
    if (f.route) {
      const i = f.route.indexOf(':');
      go(i < 0 ? { name: f.route as RouteName } : { name: f.route.slice(0, i) as RouteName, arg: f.route.slice(i + 1) });
      onClose();
      return;
    }
    if (f.action === 'report') { onReport(); return; }
    setBusy(r.id);
    try {
      const res = await api.selfCheck.fix(f.action!);
      toast(res.message);
      run();
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <div className="small muted check-status" data-testid="selfcheck-summary">{rows ? checkSummary(rows) : 'Checking each part…'}</div>
      <div className="check-rows" role="list" aria-label="Checks">
        {(rows ?? []).map((r) => (
          <div key={r.id} className={`check-item ${r.state}`} role="listitem" data-testid="selfcheck-row" data-id={r.id} data-state={r.state}>
            <span className={`check-dot ${r.state}`} role="img" aria-label={r.state === 'ok' ? 'Good' : 'To look at'} />
            <div className="grow">
              <div className="check-label">{r.label}</div>
              <div className="small muted">{r.detail}</div>
            </div>
            {r.fix && r.state === 'amber' ? <button className="btn sm" data-testid="selfcheck-fix" disabled={busy === r.id} onClick={() => void fix(r)}>{busy === r.id ? <span className="spinner" /> : null}{r.fix.label}</button> : null}
          </div>
        ))}
        {!rows ? <div className="check-loading"><span className="spinner" /></div> : null}
      </div>
      <div className="check-foot">
        <button className="btn sm ghost" onClick={run} disabled={!rows}><Icon name="refresh" size={13} /> Check again</button>
        <span className="grow" />
        <button className="btn sm primary" data-testid="selfcheck-report" onClick={onReport}><Icon name="bug" size={13} /> Make a problem report</button>
      </div>
    </>
  );
}

function Report({ onBack }: { onBack: () => void }) {
  const { toast } = useStore();
  const [files, setFiles] = useState<ReportFile[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => { void api.selfCheck.reportPreview().then((f) => { setFiles(f); setOpen(f[0]?.name ?? null); }).catch((e) => toast(errorText(e))); }, [toast]);
  const save = async () => {
    const r = await api.selfCheck.reportSave();
    toast(r.message);
    if (r.ok && r.path) setSaved(r.path);
  };
  const kb = (t: string) => `${Math.max(1, Math.round(new Blob([t]).size / 1024))} KB`;
  return (
    <>
      <p className="small muted report-lead">What’s inside, as it will be saved. Names, folders, e-mail addresses, keys and tokens are taken out. Nothing is sent.</p>
      <div className="report-files" data-testid="report-files">
        {!files ? <div className="check-loading"><span className="spinner" /></div> : files.map((f) => (
          <div key={f.name} className={`report-file ${open === f.name ? 'open' : ''}`}>
            <button className="report-file-head" aria-expanded={open === f.name} data-testid="report-file" onClick={() => setOpen(open === f.name ? null : f.name)}>
              <Icon name={open === f.name ? 'chevronDown' : 'chevronRight'} size={12} />
              <span className="grow"><b>{f.name}</b><span className="small muted"> · {f.what}</span></span>
              <span className="small muted">{kb(f.text)}</span>
            </button>
            {open === f.name ? <pre className="report-text" tabIndex={0} aria-label={f.name} data-testid="report-text">{f.text.slice(0, 20000)}{f.text.length > 20000 ? '\n…' : ''}</pre> : null}
          </div>
        ))}
      </div>
      {saved ? <div className="small report-saved" data-testid="report-saved"><Icon name="check" size={12} /> Saved to {saved.split(/[\\/]/).pop()}</div> : null}
      <div className="check-foot">
        <button className="btn sm ghost" onClick={onBack}><Icon name="chevronLeft" size={12} /> Back</button>
        <span className="grow" />
        <button className="btn sm primary" data-testid="report-save" disabled={!files} onClick={() => void save()}><Icon name="down" size={13} /> Save report…</button>
      </div>
    </>
  );
}
