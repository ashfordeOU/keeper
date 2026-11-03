// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Import notes: pick the app → a few plain steps → what will come in →
// progress (with Cancel) → what came in, what was skipped and why → Undo.
// Export: Markdown folder, the whole vault as .zip, Evernote .enex, or one
// note as a web page or PDF.

import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Modal } from '../components/ui';
import { availableHere, EXPORT_CHOICES, IMPORT_SOURCES, type ExportFormat, type ImportProgress, type ImportSource, type ImportSummary } from '../../core/notes/import-sources';
import type { OpenVault } from '../../core/api-notes';
import { NotesArt } from './art';

const PLATFORM = /Mac/i.test(navigator.platform) ? 'darwin' : /Win/i.test(navigator.platform) ? 'win32' : 'linux';
const n = (x: number, one: string, many = `${one}s`) => `${x.toLocaleString()} ${x === 1 ? one : many}`;

type Preview = Awaited<ReturnType<typeof api.notes.importPreview>>;
type Step = { at: 'pick' } | { at: 'steps'; src: ImportSource } | { at: 'reading'; src: ImportSource } | { at: 'ready'; src: ImportSource; pre: Preview } | { at: 'writing'; src: ImportSource; pre: Preview } | { at: 'done'; src: ImportSource; sum: ImportSummary; undone?: { removed: number; kept: string[] } };

export function ImportDialog({ vault, onClose, onDone, onOpenFolder }: { vault: OpenVault; onClose: () => void; onDone: () => void; onOpenFolder: (folder: string) => void }) {
  const [step, setStep] = useState<Step>({ at: 'pick' });
  const [path, setPath] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [folder, setFolder] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [prog, setProg] = useState<ImportProgress | null>(null);
  const [earlier, setEarlier] = useState<ImportSummary[]>([]);
  const [showSkipped, setShowSkipped] = useState(false);

  useEffect(() => { void api.notes.imports(vault.id).then(setEarlier).catch(() => undefined); }, [vault.id]);
  useEffect(() => api.on('notes-import', (p) => setProg(p)), []);

  const choose = (src: ImportSource) => { setStep({ at: 'steps', src }); setPath(null); setFields({}); setErr(null); setNeedsPassword(false); };
  const check = async (src: ImportSource) => {
    setErr(null);
    setStep({ at: 'reading', src });
    try {
      const pre = await api.notes.importPreview(vault.id, src.id, { path: path ?? undefined, fields });
      if (pre.needsPassword) { setNeedsPassword(true); setErr('This backup is encrypted. Type its password.'); setStep({ at: 'steps', src }); return; }
      setFolder(pre.folder);
      setStep({ at: 'ready', src, pre });
    } catch (e) {
      setErr((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
      setStep({ at: 'steps', src });
    }
  };
  const go = async (src: ImportSource, pre: Preview) => {
    setStep({ at: 'writing', src, pre });
    setProg({ job: pre.job, phase: 'writing', done: 0, total: pre.notes + pre.attachments });
    try {
      const sum = await api.notes.importRun(pre.job, { folder });
      setStep({ at: 'done', src, sum });
      onDone();
    } catch (e) {
      setErr((e as Error).message);
      setStep({ at: 'ready', src, pre });
    }
  };
  const undo = async (sum: ImportSummary, src?: ImportSource) => {
    const r = await api.notes.importUndo(vault.id, sum.job);
    onDone();
    if (src) setStep({ at: 'done', src, sum, undone: r });
    setEarlier((l) => l.filter((x) => x.job !== sum.job));
  };

  const busy = step.at === 'reading' || step.at === 'writing';
  const title = step.at === 'pick' ? 'Import notes' : step.at === 'done' ? (step.undone ? 'Import undone' : 'Notes imported') : `From ${step.src.name}`;
  const canCheck = step.at === 'steps' && (step.src.pick === 'none' || !!path) && (step.src.fields ?? []).every((f) => f.optional || fields[f.key]?.trim()) && (!needsPassword || !!fields.password);

  return (
    <Modal title={title} onClose={() => { if (step.at === 'writing' && prog) void api.notes.importCancel(prog.job); onClose(); }} width={640} testId="notes-import">
      {step.at === 'pick' ? (
        <div className="ni-pick">
          <p className="nt-lead">Choose where your notes are now. They are copied into this vault as Markdown files.</p>
          <div className="ni-apps" role="list">
            {IMPORT_SOURCES.map((s) => {
              const ok = availableHere(s, PLATFORM);
              return (
                <button key={s.id} role="listitem" className="ni-app" disabled={!ok} onClick={() => choose(s)} title={ok ? s.name : `${s.name} needs a Mac`}>
                  <span className="ni-app-mark" aria-hidden>{s.name.slice(0, 1)}</span>
                  <span className="ni-app-name">{s.name}</span>
                  {!ok ? <span className="ni-badge">Mac only</span> : s.pick === 'none' && s.fields ? <span className="ni-badge">Sign-in</span> : null}
                </button>
              );
            })}
          </div>
          {earlier.length ? (
            <div className="ni-earlier">
              <h3 className="nt-sec-title">Earlier imports</h3>
              {earlier.slice(0, 4).map((e) => (
                <div key={e.job} className="ni-earlier-row">
                  <span><strong>{e.folder}</strong> <span className="nt-dim">{n(e.notes, 'note')} · {new Date(e.at).toLocaleDateString()}</span></span>
                  <button className="btn sm ghost" onClick={() => void undo(e)}><Icon name="undo" size={12} /> Undo</button>
                </div>
              ))}
            </div>
          ) : null}
          <div className="nt-trust">On this computer · Your app is never changed · Undo anytime</div>
        </div>
      ) : null}

      {step.at === 'steps' || step.at === 'reading' ? (
        <div className="ni-steps">
          <ol className="ni-list">{step.src.steps.map((s, i) => <li key={i}><span className="ni-num" aria-hidden>{i + 1}</span>{s}</li>)}</ol>
          {step.src.note ? <p className="nt-dim ni-note">{step.src.note}</p> : null}
          {step.src.pick !== 'none' ? (
            <div className="ni-choose">
              <button className="btn" disabled={busy} onClick={() => void api.notes.importPick(step.src.id).then((p) => p && setPath(p))}><Icon name={step.src.pick === 'folder' ? 'folder' : 'document'} size={13} /> {step.src.pick === 'folder' ? 'Choose folder…' : 'Choose file…'}</button>
              {step.src.pick === 'either' ? <button className="btn ghost" disabled={busy} onClick={() => void api.notes.importPick(step.src.id, 'folder').then((p) => p && setPath(p))}>Or a folder…</button> : null}
              <span className="ni-path" title={path ?? ''}>{path ? path.split(/[\\/]/).pop() : 'Nothing chosen yet'}</span>
            </div>
          ) : null}
          {(step.src.fields ?? []).filter((f) => !(f.key === 'password' && !needsPassword && step.src.id === 'standardnotes')).map((f) => (
            <label key={f.key} className="ni-field">
              <span>{f.label}</span>
              <input className="nt-prompt-input" type={f.secret ? 'password' : 'text'} placeholder={f.placeholder} value={fields[f.key] ?? ''} onChange={(e) => setFields((x) => ({ ...x, [f.key]: e.target.value }))} autoComplete="off" />
            </label>
          ))}
          {err ? <div className="nt-base-err" role="alert"><Icon name="warning" size={13} /> {err}</div> : null}
          {step.at === 'reading' ? <div className="ni-progress" role="status"><div className="progress indeterminate"><i /></div><span>Reading your notes…</span></div> : null}
          <div className="nt-modal-actions">
            <button className="btn ghost" disabled={busy} onClick={() => setStep({ at: 'pick' })}>Back</button>
            <span className="nt-spacer" />
            <button className="btn primary" disabled={!canCheck || busy} onClick={() => void check(step.src)}>Continue</button>
          </div>
        </div>
      ) : null}

      {step.at === 'ready' ? (
        <div className="ni-ready">
          <div className="ni-big"><strong>{n(step.pre.notes, 'note')}</strong>{step.pre.attachments ? <span> and {n(step.pre.attachments, 'picture or file', 'pictures and files')}</span> : null}</div>
          {step.pre.sample.length ? <ul className="ni-sample">{step.pre.sample.map((s) => <li key={s}><span className="nt-kind kind-note" aria-hidden />{s}</li>)}{step.pre.notes > step.pre.sample.length ? <li className="nt-dim">and {n(step.pre.notes - step.pre.sample.length, 'more')}</li> : null}</ul> : null}
          {step.pre.skipped.length ? <p className="nt-dim">{n(step.pre.skipped.length, 'note')} will be left out (locked or in the trash).</p> : null}
          <label className="ni-field"><span>Put them in the folder</span><input className="nt-prompt-input" value={folder} onChange={(e) => setFolder(e.target.value)} /></label>
          {err ? <div className="nt-base-err" role="alert"><Icon name="warning" size={13} /> {err}</div> : null}
          <div className="nt-modal-actions">
            <button className="btn ghost" onClick={() => setStep({ at: 'steps', src: step.src })}>Back</button>
            <span className="nt-spacer" />
            <button className="btn primary" disabled={!step.pre.notes || !folder.trim()} onClick={() => void go(step.src, step.pre)}>Import {n(step.pre.notes, 'note')}</button>
          </div>
        </div>
      ) : null}

      {step.at === 'writing' ? (
        <div className="ni-writing" role="status" aria-live="polite">
          <div className="progress"><i style={{ width: `${prog && prog.total ? Math.round((prog.done / prog.total) * 100) : 0}%` }} /></div>
          <div className="ni-count">{prog ? `${prog.done.toLocaleString()} of ${prog.total.toLocaleString()}` : 'Starting…'}</div>
          <p className="nt-dim">You can keep working. Cancel stops after the current few notes; Undo takes back what was written.</p>
          <div className="nt-modal-actions"><button className="btn" onClick={() => prog && void api.notes.importCancel(prog.job)}>Cancel</button></div>
        </div>
      ) : null}

      {step.at === 'done' ? (
        <div className="ni-done">
          <NotesArt kind="import" />
          {step.undone ? (
            <>
              <h2>Removed {n(step.undone.removed, 'file')}</h2>
              {step.undone.kept.length ? <p className="nt-lead">{n(step.undone.kept.length, 'note')} you changed since were kept.</p> : <p className="nt-lead">The vault is as it was before.</p>}
              <div className="nt-modal-actions"><button className="btn primary" onClick={onClose}>Done</button></div>
            </>
          ) : (
            <>
              <h2>{step.sum.cancelled ? 'Stopped part way' : <>Your notes are <em>here</em></>}</h2>
              <p className="nt-lead">{n(step.sum.notes, 'note')}{step.sum.attachments ? ` and ${n(step.sum.attachments, 'file')}` : ''} in “{step.sum.folder}”.</p>
              {step.sum.skipped.length ? (
                <div className="ni-skipped">
                  <button className="nt-sec-toggle" aria-expanded={showSkipped} onClick={() => setShowSkipped((s) => !s)}><Icon name={showSkipped ? 'chevronDown' : 'chevronRight'} size={11} /> {n(step.sum.skipped.length, 'item')} left out</button>
                  {showSkipped ? <ul>{step.sum.skipped.map((s, i) => <li key={i}><strong>{s.title}</strong> <span className="nt-dim">{s.why}</span></li>)}</ul> : null}
                </div>
              ) : null}
              <div className="nt-modal-actions">
                <button className="btn ghost" onClick={() => void undo(step.sum, step.src)}><Icon name="undo" size={13} /> Undo import</button>
                <span className="nt-spacer" />
                <button className="btn" onClick={() => { onOpenFolder(step.sum.folder); onClose(); }}>Show notes</button>
                <button className="btn primary" onClick={onClose}>Done</button>
              </div>
            </>
          )}
        </div>
      ) : null}
    </Modal>
  );
}

export function ExportDialog({ vault, path, onClose, toast }: { vault: OpenVault; path: string | null; onClose: () => void; toast: (t: string) => void }) {
  const note = path && /\.md$/.test(path) ? path : null;
  const [scope, setScope] = useState<'note' | 'all'>(note ? 'note' : 'all');
  const [format, setFormat] = useState<ExportFormat>(note ? 'pdf' : 'markdown');
  const [plain, setPlain] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const choices = useMemo(() => EXPORT_CHOICES.filter((c) => (scope === 'all' ? !c.one : c.id !== 'zip')), [scope]);
  useEffect(() => { if (!choices.some((c) => c.id === format)) setFormat(choices[0].id); }, [choices, format]);
  const run = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api.notes.exportNotes(vault.id, format, { paths: scope === 'note' && note ? [note] : undefined, plain });
      if (r) { toast(`Exported ${n(r.files, 'file')}`); onClose(); }
    } catch (e) { setErr((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); }
    finally { setBusy(false); }
  };
  return (
    <Modal title="Export notes" onClose={onClose} width={520} testId="notes-export">
      {note ? (
        <div className="nt-seg nt-seg-fill ni-scope" role="radiogroup" aria-label="What to export">
          <button role="radio" aria-checked={scope === 'note'} className={scope === 'note' ? 'on' : ''} onClick={() => setScope('note')}>This note</button>
          <button role="radio" aria-checked={scope === 'all'} className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>All notes</button>
        </div>
      ) : null}
      <div className="ni-formats" role="radiogroup" aria-label="Format">
        {choices.map((c) => (
          <label key={c.id} className={`ni-format ${format === c.id ? 'on' : ''}`}>
            <input type="radio" name="fmt" checked={format === c.id} onChange={() => setFormat(c.id)} />
            <span><strong>{c.name}</strong><span className="nt-dim">{c.help}</span></span>
          </label>
        ))}
      </div>
      {format === 'markdown' ? <label className="ni-check"><input type="checkbox" checked={plain} onChange={(e) => setPlain(e.target.checked)} /> Plain links, for apps without [[links]]</label> : null}
      {err ? <div className="nt-base-err" role="alert"><Icon name="warning" size={13} /> {err}</div> : null}
      <div className="nt-modal-actions">
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={busy} onClick={() => void run()}><Icon name="exportOut" size={13} /> {busy ? 'Exporting…' : 'Export…'}</button>
      </div>
    </Modal>
  );
}
