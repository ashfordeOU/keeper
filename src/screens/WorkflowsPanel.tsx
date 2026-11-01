// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Workflows: tools joined into steps drawn as a chain of nodes. Each step's
// results flow into the next. Saved workflows run on the chosen files, on a
// folder, on new files in a watched folder, or on a schedule.

import { useEffect, useState } from 'react';
import { TOOL_INFO, type ConvertCategory, type ConvertOp, type ConvertResult, type ConvertTool } from '../../core/convert-types';
import { checkWorkflow, EXAMPLE_WORKFLOWS, nextRun, type Workflow } from '../../core/filekit/workflow';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { useStore } from '../state';

const CAT_LABEL: Record<ConvertCategory, string> = { video: 'Video', audio: 'Audio', image: 'Pictures', pdf: 'PDF', doc: 'Documents', file: 'Any file', convert: 'Convert to…' };
const uid = () => Math.random().toString(36).slice(2, 10);

export function WorkflowsPanel({ files, renderOptions, defaults }: { files: string[]; renderOptions: (op: ConvertOp, set: (o: ConvertOp) => void) => React.ReactNode; defaults: (t: ConvertTool) => ConvertOp }) {
  const { toast } = useStore();
  const [list, setList] = useState<Workflow[]>([]);
  const [edit, setEdit] = useState<Workflow | null>(null);
  const [sel, setSel] = useState(0);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ConvertResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { void api.filekit.workflows().then(setList); }, []);

  const fresh = (base?: Omit<Workflow, 'id' | 'created'>): Workflow => ({ ...(base ?? { name: 'New workflow', steps: [{ id: uid(), op: defaults('pdf.merge') }] }), steps: (base?.steps ?? [{ id: uid(), op: defaults('pdf.merge') }]).map((s) => ({ ...s, id: uid() })), id: uid(), created: Date.now() });
  const problems = edit ? checkWorkflow(edit) : [];
  const setStep = (i: number, op: ConvertOp) => edit && setEdit({ ...edit, steps: edit.steps.map((s, j) => (j === i ? { ...s, op } : s)) });
  const move = (i: number, d: number) => {
    if (!edit) return;
    const steps = [...edit.steps];
    const j = i + d;
    if (j < 0 || j >= steps.length) return;
    [steps[i], steps[j]] = [steps[j], steps[i]];
    setEdit({ ...edit, steps });
    setSel(j);
  };
  const save = async () => {
    if (!edit) return;
    try {
      setList(await api.filekit.saveWorkflow(edit));
      toast(`Saved “${edit.name}”`);
      setError(null);
    } catch (e) { setError(clean(e)); }
  };
  const run = async (w: Workflow, inputs?: string[]) => {
    setBusy(true); setResult(null); setError(null);
    try {
      if (edit && edit.id === w.id) setList(await api.filekit.saveWorkflow(edit));
      setResult(await api.filekit.runWorkflow(w.id, inputs));
      setList(await api.filekit.workflows());
    } catch (e) { setError(clean(e)); } finally { setBusy(false); }
  };
  const step = edit?.steps[sel];
  const schedOk = !edit?.schedule || !!nextRun(edit.schedule, new Date());

  return (
    <div className="flow-wrap">
      <div className="flow-list">
        <button className="btn primary" onClick={() => { setEdit(fresh()); setSel(0); setResult(null); }}><Icon name="plus" size={14} /> New workflow</button>
        {list.map((w) => (
          <button key={w.id} className={`conv-tool ${edit?.id === w.id ? 'on' : ''}`} onClick={() => { setEdit(structuredClone(w)); setSel(0); setResult(null); setError(null); }}>
            <b>{w.name}</b>
            <span>{w.steps.map((s) => TOOL_INFO[s.op.tool]?.label ?? s.op.tool).join(' → ')}</span>
            {w.watch || w.schedule ? <span>{[w.watch ? `watches ${w.watch.split(/[\\/]/).pop()}` : '', w.schedule ?? ''].filter(Boolean).join(' · ')}</span> : null}
            {w.lastRun ? <span>{w.lastRun.ok ? '✓' : '✕'} {new Date(w.lastRun.at).toLocaleString()}</span> : null}
          </button>
        ))}
        <div className="small muted" style={{ marginTop: 6 }}>Start from an example:</div>
        {EXAMPLE_WORKFLOWS.map((x) => (
          <button key={x.name} className="btn ghost sm" style={{ justifyContent: 'flex-start' }} onClick={() => { setEdit(fresh(x)); setSel(0); setResult(null); }}>{x.name}</button>
        ))}
      </div>

      <div className="card pad">
        {!edit ? (
          <div className="col" style={{ gap: 8 }}>
            <h2>Workflows</h2>
            <div className="small muted">Join tools into steps that run one after another: the files each step makes go into the next. Save a workflow and run it on files, on a folder, on new files as they arrive in a folder, or on a schedule.</div>
          </div>
        ) : (
          <div className="col" style={{ gap: 12 }}>
            <input className="input" aria-label="Workflow name" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} style={{ fontSize: 16, fontWeight: 600 }} />
            <div className="flow-graph" aria-label="Steps">
              <span className="flow-io">Files</span>
              {edit.steps.map((s, i) => (
                <div key={s.id} style={{ display: 'contents' }}>
                  <span className="flow-edge" />
                  <div className={`flow-node ${sel === i ? 'on' : ''}`} onClick={() => setSel(i)} role="button" tabIndex={0} aria-label={`Step ${i + 1}: ${TOOL_INFO[s.op.tool]?.label}`}>
                    <span className="n">Step {i + 1} · {CAT_LABEL[TOOL_INFO[s.op.tool]?.category ?? 'file']}</span>
                    <b>{TOOL_INFO[s.op.tool]?.label ?? s.op.tool}</b>
                    <div className="tools">
                      <button className="btn ghost sm icon" title="Earlier" aria-label="Earlier" disabled={i === 0} onClick={(e) => { e.stopPropagation(); move(i, -1); }}><Icon name="chevronLeft" size={12} /></button>
                      <button className="btn ghost sm icon" title="Later" aria-label="Later" disabled={i === edit.steps.length - 1} onClick={(e) => { e.stopPropagation(); move(i, 1); }}><Icon name="chevronRight" size={12} /></button>
                      <button className="btn ghost sm icon" title="Remove step" aria-label="Remove step" disabled={edit.steps.length === 1} onClick={(e) => { e.stopPropagation(); setEdit({ ...edit, steps: edit.steps.filter((_, j) => j !== i) }); setSel(Math.max(0, Math.min(sel, edit.steps.length - 2))); }}><Icon name="close" size={12} /></button>
                    </div>
                  </div>
                </div>
              ))}
              <span className="flow-edge" />
              <button className="flow-io" onClick={() => { setEdit({ ...edit, steps: [...edit.steps, { id: uid(), op: defaults('pdf.compress') }] }); setSel(edit.steps.length); }}>+ Add step</button>
              <span className="flow-edge" />
              <span className="flow-io">Results</span>
            </div>

            {step ? (
              <div className="card pad" style={{ background: 'var(--bg)' }}>
                <label className="conv-field">
                  <span className="conv-label">Step {sel + 1} tool</span>
                  <select className="input" value={step.op.tool} onChange={(e) => setStep(sel, defaults(e.target.value as ConvertTool))}>
                    {(Object.keys(CAT_LABEL) as ConvertCategory[]).map((c) => (
                      <optgroup key={c} label={CAT_LABEL[c]}>
                        {(Object.keys(TOOL_INFO) as ConvertTool[]).filter((t) => TOOL_INFO[t].category === c).map((t) => <option key={t} value={t}>{TOOL_INFO[t].label}</option>)}
                      </optgroup>
                    ))}
                  </select>
                </label>
                <div className="col" style={{ gap: 10, marginTop: 10 }}>{renderOptions(step.op, (o) => setStep(sel, o))}</div>
              </div>
            ) : null}

            <details>
              <summary className="small">Run automatically</summary>
              <div className="col" style={{ gap: 10, marginTop: 8 }}>
                <div className="conv-field">
                  <span className="conv-label">Watch a folder: new files run through the workflow</span>
                  <div className="row">
                    <span className="ellipsis small grow">{edit.watch ?? 'No folder'}</span>
                    <button className="btn sm" onClick={() => void api.settings.pickFolder().then((d) => d && setEdit({ ...edit, watch: d }))}>Choose…</button>
                    {edit.watch ? <button className="btn sm ghost" onClick={() => setEdit({ ...edit, watch: undefined })}>Stop watching</button> : null}
                  </div>
                </div>
                <label className="conv-field">
                  <span className="conv-label">Only files named</span>
                  <input className="input" placeholder="*.pdf" value={edit.pattern ?? ''} onChange={(e) => setEdit({ ...edit, pattern: e.target.value || undefined })} />
                </label>
                <label className="conv-field">
                  <span className="conv-label">Schedule</span>
                  <input className="input" placeholder="daily 08:30 · weekdays 18:00 · weekly mon 09:00 · hourly · every 30m" value={edit.schedule ?? ''} onChange={(e) => setEdit({ ...edit, schedule: e.target.value || undefined })} />
                  {!schedOk ? <span className="small" style={{ color: 'var(--danger)' }}>Not a schedule Keeper understands</span> : edit.schedule ? <span className="small muted">Next: {nextRun(edit.schedule, new Date())?.toLocaleString()} — on {edit.input?.length ? `${edit.input.length} chosen item${edit.input.length === 1 ? '' : 's'}` : edit.watch ? 'the watched folder' : 'nothing yet (choose below)'}; waits until the computer is not busy</span> : null}
                </label>
                {edit.schedule ? (
                  <div className="row small">
                    <button className="btn sm" onClick={() => void api.settings.pickFolder().then((d) => d && setEdit({ ...edit, input: [d] }))}>Scheduled runs use this folder…</button>
                    {edit.input?.length ? <span className="ellipsis">{edit.input[0]}</span> : null}
                  </div>
                ) : null}
                <div className="conv-field">
                  <span className="conv-label">Save results to</span>
                  <div className="row">
                    <span className="ellipsis small grow">{edit.outDir ?? 'A new folder next to the files'}</span>
                    <button className="btn sm" onClick={() => void api.settings.pickFolder().then((d) => d && setEdit({ ...edit, outDir: d }))}>Choose…</button>
                  </div>
                </div>
              </div>
            </details>

            {problems.length ? <div className="conv-warn small"><Icon name="warning" size={14} /> {problems[0]}</div> : null}
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div className="row">
                <button className="btn" disabled={!!problems.length || !schedOk} onClick={() => void save()}>Save</button>
                {list.some((w) => w.id === edit.id) ? <button className="btn ghost" onClick={() => void api.filekit.deleteWorkflow(edit.id).then((l) => { setList(l); setEdit(null); })}>Delete</button> : null}
              </div>
              <div className="row">
                <button className="btn" disabled={busy || !!problems.length} onClick={() => void api.settings.pickFolder().then((d) => d && void save().then(() => run(edit, [d])))}>Run on a folder…</button>
                <button className="btn primary" disabled={busy || !!problems.length || !files.length} title={files.length ? undefined : 'Add files at the top first'} onClick={() => void save().then(() => run(edit, files))}>
                  {busy ? <span className="spinner" /> : <Icon name="sparkle" size={14} />} {busy ? 'Working…' : `Run on ${files.length} file${files.length === 1 ? '' : 's'}`}
                </button>
              </div>
            </div>
            {error ? <div className="conv-error small"><Icon name="warning" size={14} /> {error}</div> : null}
            {result ? (
              <div className="conv-result">
                {result.message ? <div className="badge ok" style={{ height: 'auto', padding: '4px 10px' }}>{result.message}</div> : null}
                {result.outputs.slice(0, 30).map((o) => (
                  <div key={o} className="conv-out">
                    <Icon name="check" size={14} style={{ color: 'var(--ok)' }} />
                    <span className="ellipsis grow" title={o}>{o.split(/[\\/]/).pop()}</span>
                    <button className="btn sm" onClick={() => void api.files.open(o)}>Open</button>
                    <button className="btn sm ghost" onClick={() => void api.files.reveal(o)}>Show</button>
                  </div>
                ))}
                {result.failed?.map((f) => <div key={f.path} className="conv-error small"><b>{f.path.split(/[\\/]/).pop()}</b>: {f.reason}</div>)}
                {result.details ? <pre className="mono small" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{result.details}</pre> : null}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

const clean = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
