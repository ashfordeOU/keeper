// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The one Import flow of Mail, Calendar, Reminders and Contacts: choose where
// from, read the plain steps, watch it come in (with Cancel), then a summary
// with Undo. The same four steps in every part (core/pim/import-flow.ts).

import { useEffect, useMemo, useState } from 'react';
import { FLOW_STEPS, percent, type FoundSource, type ImportArea, type ImportProgress, type ImportResult, type ImportSourceInfo } from '../../core/pim/import-flow';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Modal } from '../components/ui';
import { useStore } from '../state';
import '../styles/pim-import.css';

const clean = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

const TITLES: Record<ImportArea, string> = { mail: 'Import mail', calendar: 'Import a calendar', reminders: 'Import tasks', contacts: 'Import contacts' };
const FROM_WORDS: Record<ImportArea, string> = { mail: 'mail', calendar: 'events', reminders: 'tasks', contacts: 'contacts' };

type Step = 0 | 1 | 2 | 3;

/** Step dots: where you are in the flow. */
function Steps({ at }: { at: Step }) {
  return (
    <ol className="imp-steps" aria-label="Steps">
      {FLOW_STEPS.map((s, i) => <li key={s} className={i === at ? 'on' : i < at ? 'done' : ''} aria-current={i === at ? 'step' : undefined}><span className="imp-dot" aria-hidden />{s}</li>)}
    </ol>
  );
}

export function ImportDialog({ area, onClose, onOpen }: { area: ImportArea; onClose: () => void; /** show what came in (a mail folder "account:path", a calendar id) */ onOpen?: (where: string) => void }) {
  const { toast } = useStore();
  const [sources, setSources] = useState<ImportSourceInfo[]>([]);
  const [found, setFound] = useState<FoundSource[]>([]);
  const [history, setHistory] = useState<ImportResult[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [step, setStep] = useState<Step>(0);
  const [src, setSrc] = useState<ImportSourceInfo | null>(null);
  const [paths, setPaths] = useState<string[]>([]);
  const [token, setToken] = useState('');
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api.pim.importSources(area).then(setSources);
    void api.pim.foundSources().then(setFound).catch(() => setFound([]));
    void api.pim.importHistory().then((h) => setHistory(h.filter((x) => x.area === area)));
  }, [area]);
  useEffect(() => api.on('pim-import', (p: ImportProgress) => setProgress((cur) => (!cur || cur.id === p.id || cur.phase === 'reading' ? p : cur))), []);

  const mine = useMemo(() => found.filter((f) => sources.some((s) => s.id === f.source && !s.unavailable)), [found, sources]);

  const choose = (s: ImportSourceInfo, f?: FoundSource) => {
    setSrc(s);
    setPaths(f ? [f.ref] : []);
    setToken('');
    setError(null);
    setStep(1);
  };

  const pick = async () => {
    if (!src) return;
    const got = await api.pim.pickImport(src.id);
    if (got.length) { setPaths(got); setError(null); }
  };

  const start = async () => {
    if (!src) return;
    setStep(2);
    setBusy(true);
    setError(null);
    setProgress(null);
    try {
      const r = await api.pim.runImport({ source: src.id, paths: paths.length ? paths : undefined, token: token.trim() || undefined });
      setResult(r);
      setHistory((h) => [r, ...h.filter((x) => x.id !== r.id)]);
      setStep(3);
    } catch (e) {
      setError(clean(e));
      setStep(1);
    } finally {
      setBusy(false);
    }
  };

  const undo = async (id: string) => {
    const r = await api.pim.undoImport(id).catch((e) => { toast(clean(e)); return null; });
    if (!r) return;
    setHistory((h) => h.map((x) => (x.id === id ? r : x)));
    if (result?.id === id) setResult(r);
    toast('Import taken back');
  };

  const ready = !!src && (src.pick === 'signin' || src.pick === 'found' ? true : src.pick === 'token' ? !!token.trim() || paths.length > 0 : paths.length > 0);
  const pct = progress ? percent(progress) : undefined;

  return (
    <Modal title={TITLES[area]} onClose={() => { if (progress && step === 2) void api.pim.cancelImport(progress.id); onClose(); }} width={640} testId="import-dialog">
      <Steps at={step} />

      {step === 0 ? (
        <div className="imp-body" data-testid="import-choose">
          <p className="imp-lede">Bring your {FROM_WORDS[area]} from another app. Everything stays on this computer.</p>
          {mine.length ? (
            <section aria-label="Found on this computer">
              <h4 className="imp-kicker">Found on this computer</h4>
              <div className="imp-grid">
                {mine.map((f) => {
                  const s = sources.find((x) => x.id === f.source)!;
                  return (
                    <button key={`${f.source}:${f.ref}`} className="imp-card found" onClick={() => choose(s, f)} data-testid={`import-found-${f.source}`}>
                      <span className="imp-card-icon"><Icon name={s.icon} size={18} /></span>
                      <span className="imp-card-text"><b>{s.id === 'thunderbird' ? `Thunderbird · ${f.label}` : f.label}</b><small>{f.detail ?? s.hint}</small></span>
                    </button>
                  );
                })}
              </div>
            </section>
          ) : null}
          <section aria-label="From a file or an app">
            <h4 className="imp-kicker">{mine.length ? 'Or from' : 'From'}</h4>
            <div className="imp-grid">
              {sources.filter((s) => !(s.pick === 'found' && mine.some((f) => f.source === s.id))).map((s) => (
                <button key={s.id} className={`imp-card ${s.unavailable ? 'off' : ''}`} onClick={() => choose(s)} data-testid={`import-source-${s.id}`} title={s.unavailable}>
                  <span className="imp-card-icon"><Icon name={s.icon} size={18} /></span>
                  <span className="imp-card-text"><b>{s.label}</b><small>{s.unavailable ? (s.platforms ? 'Only on a Mac' : 'Not yet') : s.hint}</small></span>
                </button>
              ))}
            </div>
          </section>
          {history.length ? (
            <div className="imp-history">
              <button className="link-like small" aria-expanded={showHistory} onClick={() => setShowHistory(!showHistory)}><Icon name="history" size={13} /> Past imports ({history.length})</button>
              {showHistory ? (
                <ul data-testid="import-history">
                  {history.map((h) => (
                    <li key={h.id}>
                      <span className="grow"><b>{h.label}</b> <span className="muted small">{h.summary} · {new Date(h.at).toLocaleDateString()}</span></span>
                      {h.undone ? <span className="muted small">Taken back</span> : <button className="btn xs ghost" onClick={() => void undo(h.id)}><Icon name="undo" size={12} /> Undo</button>}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {step === 1 && src ? (
        <div className="imp-body" data-testid="import-ready">
          <div className="imp-head"><span className="imp-card-icon big"><Icon name={src.icon} size={22} /></span><div><h3>{src.label}</h3><small className="muted">{src.hint}</small></div></div>
          {src.unavailable ? <div className="banner subtle" role="note"><Icon name="info" size={14} /> {src.unavailable}</div> : (
            <>
              <ol className="imp-howto">{src.steps.map((s) => <li key={s}>{s}</li>)}</ol>
              {src.pick === 'file' || src.pick === 'folder' || src.pick === 'token' ? (
                <div className="imp-pick">
                  <button className={`btn ${paths.length ? '' : 'primary'}`} onClick={() => void pick()} data-testid="import-pick"><Icon name={src.pick === 'folder' ? 'folder' : 'document'} size={14} /> {paths.length ? 'Choose again' : src.pick === 'folder' ? 'Choose folder' : 'Choose file'}</button>
                  {paths.length ? <span className="imp-picked small" title={paths.join('\n')}>{paths.length === 1 ? paths[0].split(/[\\/]/).pop() : `${paths.length} chosen`}</span> : null}
                </div>
              ) : null}
              {src.pick === 'token' ? <label className="field"><span>Or paste your API token</span><input className="input" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Used once, never kept" /></label> : null}
              {src.pick === 'found' && paths[0] ? <div className="imp-picked small" title={paths[0]}><Icon name="folder" size={13} /> {paths[0]}</div> : null}
            </>
          )}
          {error ? <div className="banner warn" role="alert"><Icon name="warning" size={14} /> {error}</div> : null}
          <div className="imp-foot">
            <span className="imp-trust small muted">On this computer · Nothing changes in the other app · Undo anytime</span>
            <button className="btn ghost" onClick={() => { setStep(0); setSrc(null); }}>Back</button>
            {src.unavailable ? null : <button className="btn primary" disabled={!ready || busy} onClick={() => void start()} data-testid="import-start">{src.pick === 'signin' ? 'Sign in and import' : 'Import'}</button>}
          </div>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="imp-body imp-running" data-testid="import-progress" aria-live="polite">
          <h3>{progress?.phase === 'reading' || !progress ? 'Reading…' : `Adding ${(progress.done ?? 0).toLocaleString()}${progress.total ? ` of ${progress.total.toLocaleString()}` : ''}`}</h3>
          <div className={`imp-bar ${pct === undefined ? 'busy' : ''}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Import progress"><span style={{ width: `${pct ?? 30}%` }} /></div>
          <p className="small muted">{progress?.current ? `Now: ${progress.current}` : src?.pick === 'signin' ? 'Finish signing in in your browser…' : 'This can take a while for a big mailbox. You can keep working.'}</p>
          <div className="imp-foot"><span className="grow" /><button className="btn" onClick={() => progress && void api.pim.cancelImport(progress.id)} disabled={!progress}>Stop</button></div>
        </div>
      ) : null}

      {step === 3 && result ? (
        <div className="imp-body imp-done" data-testid="import-summary">
          <span className="imp-done-mark" aria-hidden><Icon name="check" size={26} stroke={2.4} /></span>
          <h3>{result.cancelled ? 'Stopped part way' : result.added ? 'All in' : 'Nothing new'}</h3>
          <p className="imp-summary">{result.summary}</p>
          {result.notes?.length ? <ul className="imp-notes small muted">{result.notes.map((n) => <li key={n}>{n}</li>)}</ul> : null}
          <div className="imp-foot">
            {result.undone ? <span className="muted small grow">Taken back</span> : <button className="btn ghost" onClick={() => void undo(result.id)} data-testid="import-undo"><Icon name="undo" size={13} /> Undo</button>}
            <span className="grow" />
            <button className="btn ghost" onClick={() => { setStep(0); setSrc(null); setResult(null); setPaths([]); }}>Import more</button>
            {result.open && onOpen && !result.undone ? <button className="btn primary" onClick={() => { onOpen(result.open!); onClose(); }}>Show</button> : <button className="btn primary" onClick={onClose}>Done</button>}
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
